//! The bridge inside Pulse (lot 37): a listener on **127.0.0.1** only, on a port chosen by the system,
//! announced in `mcp-endpoint.json` (port + ephemeral 256-bit token) while the access is on. Protocol:
//! `pulse_mcp::bridge` (mutual HMAC challenge; the token never travels).
//!
//! Bounds: 4 connections at once (a 5th gets « busy » and is closed), 60 tool calls per sliding minute
//! (beyond: an error result, the tool is not run, nothing blocks), bounded lines, a delay for each step of
//! a connection. A wrong or missing proof closes the connection at once: nothing is run, nothing more is
//! written. The tool itself runs through [`BridgeHost`], which holds the database only while the tool runs.
//!
//! [`Bridge::stop`] (also on drop) closes the port, removes the endpoint file and makes the token useless:
//! a new [`Bridge::start`] draws a new token.

use crate::error::{CoreError, Result};
use pulse_mcp::bridge::{self as wire, Endpoint, Line};
use pulse_mcp::server::ToolReply;
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::io::{BufReader, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

/// Runs one tool for the bridge (in the app: the coach's tools on the open database, with the log).
pub trait BridgeHost: Send + Sync + 'static {
    fn run_tool(&self, tool: &str, arguments: &Value) -> ToolReply;
}

/// Milliseconds since the Unix epoch; injectable for tests.
pub type Clock = Arc<dyn Fn() -> i64 + Send + Sync>;

pub fn system_clock() -> Clock {
    Arc::new(|| std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_millis() as i64))
}

#[derive(Debug, Clone, Copy)]
pub struct Limits {
    pub max_connections: usize,
    pub calls_per_minute: usize,
    /// Time allowed for the proxy's proof.
    pub handshake_timeout: Duration,
    /// Time allowed for the request line once authenticated.
    pub request_timeout: Duration,
    pub write_timeout: Duration,
}

impl Default for Limits {
    fn default() -> Self {
        Limits {
            max_connections: 4,
            calls_per_minute: 60,
            handshake_timeout: Duration::from_secs(5),
            request_timeout: Duration::from_secs(5),
            write_timeout: Duration::from_secs(10),
        }
    }
}

/// Counters of the current activation, shown in the settings (never the port nor the token).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct BridgeStats {
    /// Tool calls run since the access was turned on.
    pub calls: u64,
    /// Calls refused by the per-minute limit.
    pub refused: u64,
    pub last_call_at: Option<i64>,
}

struct Shared {
    stopped: AtomicBool,
    active: AtomicUsize,
    calls: AtomicU64,
    refused: AtomicU64,
    /// 0 = none yet.
    last_call_at: AtomicU64,
    recent: Mutex<VecDeque<i64>>,
}

pub struct Bridge {
    port: u16,
    endpoint_path: PathBuf,
    endpoint_text: String,
    shared: Arc<Shared>,
    thread: Option<JoinHandle<()>>,
}

pub fn endpoint_path(data_dir: &Path) -> PathBuf {
    data_dir.join(wire::ENDPOINT_FILE)
}

/// At startup: any endpoint file left by a Pulse that did not stop cleanly is removed (its port may
/// since belong to another program). Returns whether one was found.
pub fn remove_stale_endpoint(data_dir: &Path) -> Result<bool> {
    match std::fs::remove_file(endpoint_path(data_dir)) {
        Ok(()) => Ok(true),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e.into()),
    }
}

/// Only a loopback peer may talk to the bridge (the socket is bound to 127.0.0.1: this is a second lock).
pub fn is_allowed_peer(addr: &SocketAddr) -> bool {
    match addr.ip() {
        IpAddr::V4(ip) => ip.is_loopback(),
        IpAddr::V6(ip) => ip.to_ipv4_mapped().is_some_and(|v4| v4.is_loopback()),
    }
}

fn mcp_error(code: &str) -> CoreError {
    CoreError::Invalid(format!("mcp:{code}"))
}

/// The endpoint file is written whole or not at all (temporary file, then rename), readable by the
/// user only where the system allows it (Unix: 0600; Windows: the data folder's per-user rights).
fn write_endpoint(path: &Path, text: &str) -> Result<()> {
    let tmp = path.with_extension("json.tmp");
    let _ = std::fs::remove_file(&tmp);
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut f = options.open(&tmp)?;
    f.write_all(text.as_bytes())?;
    f.sync_all()?;
    drop(f);
    std::fs::rename(&tmp, path)?;
    Ok(())
}

impl Bridge {
    /// Opens the port and writes the endpoint file. `mcp:random` if the system gives no random numbers.
    pub fn start(data_dir: &Path, host: Arc<dyn BridgeHost>, limits: Limits, clock: Clock) -> Result<Bridge> {
        let token = wire::random::<{ wire::TOKEN_BYTES }>().ok_or_else(|| mcp_error("random"))?;
        let listener = TcpListener::bind(SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), 0))?;
        listener.set_nonblocking(true)?;
        let port = listener.local_addr()?.port();
        let endpoint = Endpoint { port, token, pid: std::process::id(), started_at: clock() };
        let endpoint_text = endpoint.to_json();
        let endpoint_path = endpoint_path(data_dir);
        write_endpoint(&endpoint_path, &endpoint_text)?;
        let shared = Arc::new(Shared {
            stopped: AtomicBool::new(false),
            active: AtomicUsize::new(0),
            calls: AtomicU64::new(0),
            refused: AtomicU64::new(0),
            last_call_at: AtomicU64::new(0),
            recent: Mutex::new(VecDeque::new()),
        });
        let s = Arc::clone(&shared);
        let thread = std::thread::Builder::new()
            .name("pulse-mcp-bridge".into())
            .spawn(move || accept_loop(listener, token, port, s, host, limits, clock))
            .map_err(CoreError::from);
        let thread = match thread {
            Ok(t) => t,
            Err(e) => {
                let _ = std::fs::remove_file(&endpoint_path);
                return Err(e);
            }
        };
        Ok(Bridge { port, endpoint_path, endpoint_text, shared, thread: Some(thread) })
    }

    /// For tests only: the settings never show it.
    pub fn port(&self) -> u16 {
        self.port
    }

    pub fn stats(&self) -> BridgeStats {
        let last = self.shared.last_call_at.load(Ordering::SeqCst);
        BridgeStats {
            calls: self.shared.calls.load(Ordering::SeqCst),
            refused: self.shared.refused.load(Ordering::SeqCst),
            last_call_at: (last > 0).then_some(last as i64),
        }
    }

    /// Closes the port, removes the endpoint file (if it is still ours) and refuses calls in flight.
    pub fn stop(mut self) {
        self.shutdown();
    }

    fn shutdown(&mut self) {
        self.shared.stopped.store(true, Ordering::SeqCst);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
        if std::fs::read_to_string(&self.endpoint_path).is_ok_and(|t| t == self.endpoint_text) {
            let _ = std::fs::remove_file(&self.endpoint_path);
        }
    }
}

impl Drop for Bridge {
    fn drop(&mut self) {
        self.shutdown();
    }
}

struct ActiveSlot(Arc<Shared>);

impl Drop for ActiveSlot {
    fn drop(&mut self) {
        self.0.active.fetch_sub(1, Ordering::SeqCst);
    }
}

fn accept_loop(listener: TcpListener, token: [u8; 32], port: u16, shared: Arc<Shared>, host: Arc<dyn BridgeHost>, limits: Limits, clock: Clock) {
    while !shared.stopped.load(Ordering::SeqCst) {
        match listener.accept() {
            Ok((stream, peer)) => {
                if !is_allowed_peer(&peer) {
                    continue; // dropped: closed without a word
                }
                // Windows: an accepted socket inherits the listener's non-blocking mode.
                if stream.set_nonblocking(false).is_err() {
                    continue;
                }
                let _ = stream.set_write_timeout(Some(limits.write_timeout));
                if shared.active.fetch_add(1, Ordering::SeqCst) >= limits.max_connections {
                    shared.active.fetch_sub(1, Ordering::SeqCst);
                    let mut s = stream;
                    let _ = writeln!(s, "{}", json!({ "protocol": wire::PROTOCOL, "version": wire::VERSION, "busy": true }));
                    continue;
                }
                // Released when the connection ends, or at once if its thread cannot start.
                let slot = ActiveSlot(Arc::clone(&shared));
                let (host, clock) = (Arc::clone(&host), Arc::clone(&clock));
                let _ = std::thread::Builder::new().name("pulse-mcp-conn".into()).spawn(move || {
                    let _ = connection(stream, &token, port, &slot.0, host.as_ref(), limits, clock.as_ref());
                    drop(slot);
                });
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(20)),
            Err(_) => std::thread::sleep(Duration::from_millis(20)),
        }
    }
}

fn reply_line(w: &mut TcpStream, text: &str, is_error: bool) -> std::io::Result<()> {
    let mut line = json!({ "text": text, "isError": is_error }).to_string();
    line.push('\n');
    w.write_all(line.as_bytes())?;
    w.flush()
}

fn error_text(code: &str, message: &str) -> String {
    json!({ "error": message, "code": format!("mcp:{code}") }).to_string()
}

/// One connection: challenge, one call, close. Any deviation closes it; nothing is run before the proof.
fn connection(stream: TcpStream, token: &[u8; 32], port: u16, shared: &Shared, host: &dyn BridgeHost, limits: Limits, clock: &(dyn Fn() -> i64 + Send + Sync)) -> std::io::Result<()> {
    stream.set_read_timeout(Some(limits.handshake_timeout))?;
    let mut w = stream.try_clone()?;
    let mut r = BufReader::new(stream);
    let Some(server_nonce) = wire::random::<{ wire::NONCE_BYTES }>() else { return Ok(()) };
    writeln!(w, "{}", json!({ "protocol": wire::PROTOCOL, "version": wire::VERSION, "nonce": wire::hex(&server_nonce) }))?;
    w.flush()?;

    // The proxy's proof: exactly two hex fields of 32 bytes, checked in constant time.
    let Line::Line(bytes) = wire::read_line(&mut r, wire::MAX_HANDSHAKE_LINE)? else { return Ok(()) };
    let Ok(auth) = serde_json::from_slice::<Value>(&bytes) else { return Ok(()) };
    let (Some(client_nonce), Some(proof)) = (wire::hex_field(&auth, "nonce", wire::NONCE_BYTES), wire::hex_field(&auth, "proof", 32)) else {
        return Ok(());
    };
    if !wire::verify_client_proof(token, port, &server_nonce, &client_nonce, &proof) || shared.stopped.load(Ordering::SeqCst) {
        return Ok(());
    }
    writeln!(w, "{}", json!({ "proof": wire::hex(&wire::server_proof(token, port, &server_nonce, &client_nonce)) }))?;
    w.flush()?;

    // The request.
    r.get_ref().set_read_timeout(Some(limits.request_timeout))?;
    let request = match wire::read_line(&mut r, wire::MAX_REQUEST_LINE)? {
        Line::Line(bytes) => bytes,
        Line::TooLong => return reply_line(&mut w, &error_text("tooLarge", "Requête trop volumineuse (64 Kio au plus)."), true),
        Line::Eof => return Ok(()),
    };
    let parsed = serde_json::from_slice::<Value>(&request).ok();
    let (Some(tool), Some(arguments)) = (
        parsed.as_ref().and_then(|v| v.get("tool")).and_then(Value::as_str),
        parsed.as_ref().and_then(|v| v.get("arguments")).filter(|a| a.is_object()),
    ) else {
        return reply_line(&mut w, &error_text("badRequest", "Requête illisible : outil et paramètres (objet JSON) attendus."), true);
    };
    if shared.stopped.load(Ordering::SeqCst) {
        return Ok(());
    }

    // At most `calls_per_minute` calls in any 60-second window: beyond, refused (not run), never queued.
    let now = clock();
    let allowed = match shared.recent.lock() {
        Ok(mut recent) => {
            while recent.front().is_some_and(|&t| t <= now - 60_000) {
                recent.pop_front();
            }
            if recent.len() < limits.calls_per_minute {
                recent.push_back(now);
                true
            } else {
                false
            }
        }
        Err(_) => false,
    };
    if !allowed {
        shared.refused.fetch_add(1, Ordering::SeqCst);
        return reply_line(&mut w, &error_text("tooManyCalls", "Trop d'appels : 60 par minute au plus. Réessayez dans une minute."), true);
    }
    let reply = host.run_tool(tool, arguments);
    shared.calls.fetch_add(1, Ordering::SeqCst);
    shared.last_call_at.store(clock().max(1) as u64, Ordering::SeqCst);
    reply_line(&mut w, &reply.text, reply.is_error)
}
