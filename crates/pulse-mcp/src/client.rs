//! Proxy side of the bridge: reads `mcp-endpoint.json`, connects to **127.0.0.1** only, runs the mutual
//! challenge (see [`crate::bridge`]) and sends one tool call. The token never leaves this process: only
//! proofs computed from it do, and nothing else is sent before Pulse has proved it knows the token too.

use crate::bridge::{self, Endpoint, EndpointError, Line};
use serde_json::{json, Value};
use std::io::{BufReader, Write};
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, TcpStream};
use std::path::Path;
use std::time::Duration;

#[derive(Debug, Clone, Copy)]
pub struct Timeouts {
    pub connect: Duration,
    /// Handshake lines.
    pub handshake: Duration,
    /// The tool itself (Pulse computes the report while we wait).
    pub reply: Duration,
}

impl Default for Timeouts {
    fn default() -> Self {
        Timeouts { connect: Duration::from_secs(2), handshake: Duration::from_secs(5), reply: Duration::from_secs(30) }
    }
}

/// Why a call could not reach Pulse. Each maps to a clear French text for the MCP client ([`CallError::message`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CallError {
    /// No endpoint file: Pulse is closed, locked or the access is off.
    NotRunning,
    /// Unreadable endpoint file, or one that names another address than 127.0.0.1.
    BadEndpoint,
    /// Nothing listens on the file's port (stale file).
    Unreachable,
    /// The program on the port did not prove it is Pulse: nothing was requested from it.
    NotPulse,
    /// Pulse closed the connection after our proof (access cut or renewed meanwhile).
    Refused,
    /// Pulse already has 4 connections open.
    Busy,
    Timeout,
    /// A malformed or cut reply.
    Protocol,
    /// Arguments too large to send (> 64 KiB).
    TooLarge,
    /// The operating system gave no random numbers.
    Random,
}

impl CallError {
    pub fn code(self) -> &'static str {
        match self {
            CallError::NotRunning => "mcp:notRunning",
            CallError::BadEndpoint => "mcp:badEndpoint",
            CallError::Unreachable => "mcp:unreachable",
            CallError::NotPulse => "mcp:notPulse",
            CallError::Refused => "mcp:refused",
            CallError::Busy => "mcp:busy",
            CallError::Timeout => "mcp:timeout",
            CallError::Protocol => "mcp:protocol",
            CallError::TooLarge => "mcp:tooLarge",
            CallError::Random => "mcp:random",
        }
    }

    /// Text returned to the MCP client as a tool error (`isError`), in French like the rest of Pulse.
    pub fn message(self) -> &'static str {
        match self {
            CallError::NotRunning | CallError::Unreachable => {
                "Pulse n'est pas ouvert, est verrouillé ou l'accès MCP est désactivé. Ouvrez Pulse, déverrouillez-le si besoin, puis activez « Accès MCP (Claude Code) » dans Paramètres."
            }
            CallError::BadEndpoint => "Le fichier de connexion de Pulse est illisible. Coupez puis réactivez l'accès MCP dans Pulse (Paramètres > Accès MCP).",
            CallError::NotPulse => {
                "Le programme qui écoute sur le port indiqué ne s'est pas identifié comme Pulse : aucune demande ne lui a été envoyée. Coupez puis réactivez l'accès MCP dans Pulse."
            }
            CallError::Refused => "Pulse a refusé la connexion (accès coupé ou renouvelé entre-temps). Réessayez ; si cela persiste, réactivez l'accès MCP dans Pulse.",
            CallError::Busy => "Pulse traite déjà 4 demandes en même temps : réessayez dans un instant.",
            CallError::Timeout => "Pulse n'a pas répondu à temps. Réessayez avec une période plus courte ou un seul compte.",
            CallError::Protocol => "Réponse de Pulse illisible. Vérifiez que Pulse et pulse-mcp ont la même version.",
            CallError::TooLarge => "Paramètres trop volumineux (64 Kio au plus).",
            CallError::Random => "Le générateur aléatoire du système est indisponible : impossible de s'authentifier auprès de Pulse.",
        }
    }
}

/// What Pulse answered: `text` is handed to the MCP client exactly as received.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reply {
    pub text: String,
    pub is_error: bool,
}

/// Reads the endpoint file of `data_dir` and calls one tool.
pub fn call(data_dir: &Path, tool: &str, arguments: &Value, timeouts: Timeouts) -> Result<Reply, CallError> {
    let text = match std::fs::read_to_string(data_dir.join(bridge::ENDPOINT_FILE)) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err(CallError::NotRunning),
        Err(_) => return Err(CallError::BadEndpoint),
    };
    if text.len() > 4_096 {
        return Err(CallError::BadEndpoint);
    }
    let endpoint = Endpoint::parse(&text).map_err(|e| match e {
        EndpointError::NotLoopback | EndpointError::Invalid | EndpointError::Version => CallError::BadEndpoint,
    })?;
    call_endpoint(&endpoint, tool, arguments, timeouts)
}

fn io_error(e: &std::io::Error) -> CallError {
    match e.kind() {
        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut => CallError::Timeout,
        _ => CallError::Protocol,
    }
}

/// One call on a known endpoint. The address is always 127.0.0.1, whatever else is known.
pub fn call_endpoint(endpoint: &Endpoint, tool: &str, arguments: &Value, timeouts: Timeouts) -> Result<Reply, CallError> {
    let request = json!({ "tool": tool, "arguments": arguments }).to_string();
    if request.len() >= bridge::MAX_REQUEST_LINE {
        return Err(CallError::TooLarge);
    }
    let addr = SocketAddr::V4(SocketAddrV4::new(Ipv4Addr::LOCALHOST, endpoint.port));
    // Any failure to connect means nobody (Pulse) answers on that port: a stale file. Windows retries a closed
    // loopback port for about a second and reports a timeout instead of a refusal, so both are « unreachable ».
    let stream = TcpStream::connect_timeout(&addr, timeouts.connect).map_err(|_| CallError::Unreachable)?;
    if !stream.peer_addr().is_ok_and(|a| a.ip().is_loopback()) {
        return Err(CallError::NotPulse);
    }
    let _ = stream.set_nodelay(true);
    stream.set_read_timeout(Some(timeouts.handshake)).map_err(|e| io_error(&e))?;
    stream.set_write_timeout(Some(timeouts.handshake)).map_err(|e| io_error(&e))?;
    let mut writer = stream.try_clone().map_err(|e| io_error(&e))?;
    let mut reader = BufReader::new(stream);

    // 1. Hello from the listener: anything unexpected means it is not Pulse.
    let hello = read_json(&mut reader, bridge::MAX_HANDSHAKE_LINE).map_err(|e| if e == CallError::Protocol { CallError::NotPulse } else { e })?;
    if hello.get("protocol").and_then(Value::as_str) != Some(bridge::PROTOCOL) || hello.get("version").and_then(Value::as_u64) != Some(bridge::VERSION) {
        return Err(CallError::NotPulse);
    }
    if hello.get("busy") == Some(&Value::Bool(true)) {
        return Err(CallError::Busy);
    }
    let server_nonce = bridge::hex_field(&hello, "nonce", bridge::NONCE_BYTES).ok_or(CallError::NotPulse)?;

    // 2. Our proof (never the token).
    let client_nonce = bridge::random::<{ bridge::NONCE_BYTES }>().ok_or(CallError::Random)?;
    let proof = bridge::client_proof(&endpoint.token, endpoint.port, &server_nonce, &client_nonce);
    let auth = json!({ "nonce": bridge::hex(&client_nonce), "proof": bridge::hex(&proof) }).to_string();
    write_line(&mut writer, &auth)?;

    // 3. Pulse's proof, checked before anything else is sent.
    let answer = match read_json(&mut reader, bridge::MAX_HANDSHAKE_LINE) {
        Err(CallError::Protocol) => return Err(CallError::Refused),
        other => other?,
    };
    let server = bridge::hex_field(&answer, "proof", 32).ok_or(CallError::NotPulse)?;
    if !bridge::verify_server_proof(&endpoint.token, endpoint.port, &server_nonce, &client_nonce, &server) {
        return Err(CallError::NotPulse);
    }

    // 4. The call.
    reader.get_ref().set_read_timeout(Some(timeouts.reply)).map_err(|e| io_error(&e))?;
    write_line(&mut writer, &request)?;
    let reply = read_json(&mut reader, bridge::MAX_REPLY_LINE)?;
    match (reply.get("text").and_then(Value::as_str), reply.get("isError").and_then(Value::as_bool)) {
        (Some(text), Some(is_error)) => Ok(Reply { text: text.to_owned(), is_error }),
        _ => Err(CallError::Protocol),
    }
}

fn write_line(w: &mut TcpStream, line: &str) -> Result<(), CallError> {
    let mut bytes = Vec::with_capacity(line.len() + 1);
    bytes.extend_from_slice(line.as_bytes());
    bytes.push(b'\n');
    w.write_all(&bytes).and_then(|_| w.flush()).map_err(|e| io_error(&e))
}

/// One JSON object line. EOF, a too long line, invalid UTF-8 or JSON → `Protocol` (or `Timeout`).
fn read_json(r: &mut BufReader<TcpStream>, max: usize) -> Result<Value, CallError> {
    match bridge::read_line(r, max) {
        Ok(Line::Line(bytes)) => match serde_json::from_slice::<Value>(&bytes) {
            Ok(v @ Value::Object(_)) => Ok(v),
            _ => Err(CallError::Protocol),
        },
        Ok(Line::TooLong | Line::Eof) => Err(CallError::Protocol),
        Err(e) => Err(io_error(&e)),
    }
}
