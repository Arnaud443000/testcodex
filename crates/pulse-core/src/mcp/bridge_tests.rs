//! The bridge (lot 37) on real local sockets: challenge, refusals, limits, endpoint file, tokens.

use super::bridge::*;
use pulse_mcp::bridge::{self as wire, Endpoint, Line};
use pulse_mcp::client::{self, CallError, Timeouts};
use pulse_mcp::server::ToolReply;
use serde_json::{json, Value};
use std::io::{BufReader, Read, Write};
use std::net::{Ipv4Addr, SocketAddr, SocketAddrV4, SocketAddrV6, TcpStream};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Counts the calls it runs and echoes them back.
#[derive(Default)]
struct Echo {
    calls: Mutex<Vec<(String, Value)>>,
    delay: Option<Duration>,
    entered: std::sync::atomic::AtomicBool,
}

impl BridgeHost for Echo {
    fn run_tool(&self, tool: &str, arguments: &Value) -> ToolReply {
        self.entered.store(true, Ordering::SeqCst);
        if let Some(d) = self.delay {
            std::thread::sleep(d);
        }
        self.calls.lock().unwrap().push((tool.to_owned(), arguments.clone()));
        ToolReply { text: json!({ "tool": tool, "arguments": arguments }).to_string(), is_error: false }
    }
}

impl Echo {
    fn count(&self) -> usize {
        self.calls.lock().unwrap().len()
    }
}

fn quick_limits() -> Limits {
    Limits { handshake_timeout: Duration::from_millis(300), request_timeout: Duration::from_millis(300), ..Limits::default() }
}

fn quick() -> Timeouts {
    Timeouts { connect: Duration::from_secs(1), handshake: Duration::from_secs(2), reply: Duration::from_secs(5) }
}

struct Setup {
    dir: tempfile::TempDir,
    host: Arc<Echo>,
    clock: Arc<AtomicI64>,
}

fn setup(host: Echo) -> Setup {
    Setup { dir: tempfile::tempdir().unwrap(), host: Arc::new(host), clock: Arc::new(AtomicI64::new(1_000_000)) }
}

impl Setup {
    fn start(&self, limits: Limits) -> Bridge {
        let c = Arc::clone(&self.clock);
        Bridge::start(self.dir.path(), self.host.clone(), limits, Arc::new(move || c.load(Ordering::SeqCst))).unwrap()
    }

    fn endpoint(&self) -> Endpoint {
        Endpoint::parse(&std::fs::read_to_string(endpoint_path(self.dir.path())).unwrap()).unwrap()
    }

    fn call(&self, tool: &str, args: Value) -> Result<client::Reply, CallError> {
        client::call(self.dir.path(), tool, &args, quick())
    }
}

/// A raw connection that has read the hello; returns (reader, writer, server nonce).
fn raw(port: u16) -> (BufReader<TcpStream>, TcpStream, Value) {
    let s = TcpStream::connect(SocketAddrV4::new(Ipv4Addr::LOCALHOST, port)).unwrap();
    s.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
    let w = s.try_clone().unwrap();
    let mut r = BufReader::new(s);
    let hello = match wire::read_line(&mut r, 4096).unwrap() {
        Line::Line(b) => serde_json::from_slice(&b).unwrap(),
        other => panic!("{other:?}"),
    };
    (r, w, hello)
}

/// Reads what is left until the bridge closes.
fn rest(r: &mut BufReader<TcpStream>) -> Vec<u8> {
    let mut out = Vec::new();
    let _ = r.read_to_end(&mut out);
    out
}

#[test]
fn a_correct_challenge_runs_the_tool_through_the_endpoint_file() {
    let s = setup(Echo::default());
    let bridge = s.start(Limits::default());
    let reply = s.call("discipline", json!({ "period": "1S" })).unwrap();
    assert!(!reply.is_error);
    assert_eq!(reply.text, r#"{"arguments":{"period":"1S"},"tool":"discipline"}"#, "the host's text, exactly");
    assert_eq!(s.host.count(), 1);
    assert_eq!(bridge.stats(), BridgeStats { calls: 1, refused: 0, last_call_at: Some(1_000_000) });
    let text = std::fs::read_to_string(endpoint_path(s.dir.path())).unwrap();
    let v: Value = serde_json::from_str(&text).unwrap();
    assert_eq!((v["host"].as_str(), v["port"].as_u64()), (Some("127.0.0.1"), Some(u64::from(bridge.port()))));
    assert_eq!(v["token"].as_str().unwrap().len(), 64, "256 bits");
    assert_eq!(v["pid"].as_u64(), Some(u64::from(std::process::id())));
}

#[test]
fn a_wrong_or_missing_proof_closes_at_once_and_runs_nothing() {
    let s = setup(Echo::default());
    let bridge = s.start(quick_limits());
    let ep = s.endpoint();

    // Wrong token.
    let (mut r, mut w, hello) = raw(bridge.port());
    let sn = wire::hex_field(&hello, "nonce", 32).unwrap();
    let cn = [4u8; 32];
    let bad = wire::client_proof(&[0u8; 32], ep.port, &sn, &cn);
    writeln!(w, "{}", json!({ "nonce": wire::hex(&cn), "proof": wire::hex(&bad) })).ok(); // the host may already have closed: a reset is a valid refusal (Windows)
    writeln!(w, "{}", json!({ "tool": "discipline", "arguments": {} })).ok(); // the host may already have closed: a reset is a valid refusal (Windows)
    assert!(rest(&mut r).is_empty(), "closed without a word");

    // Right token but a proof for another port (a relay) or with the nonces swapped.
    for proof in [wire::client_proof(&ep.token, ep.port + 1, &sn, &cn), wire::client_proof(&ep.token, ep.port, &cn, &sn)] {
        let (mut r, mut w, hello) = raw(bridge.port());
        let sn2 = wire::hex_field(&hello, "nonce", 32).unwrap();
        assert_ne!(sn, sn2, "a new nonce for every connection");
        writeln!(w, "{}", json!({ "nonce": wire::hex(&cn), "proof": wire::hex(&proof) })).ok(); // the host may already have closed: a reset is a valid refusal (Windows)
        assert!(rest(&mut r).is_empty());
    }

    // Replaying an old valid proof on a new connection (new nonce): refused.
    let (mut r, mut w, _) = raw(bridge.port());
    let replay = wire::client_proof(&ep.token, ep.port, &sn, &cn);
    writeln!(w, "{}", json!({ "nonce": wire::hex(&cn), "proof": wire::hex(&replay) })).ok(); // the host may already have closed: a reset is a valid refusal (Windows)
    assert!(rest(&mut r).is_empty());

    // No proof: garbage, an HTTP request (a web page trying http://127.0.0.1:port), an empty line, EOF.
    for garbage in ["hello", "GET / HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n", "", "{\"nonce\":\"00\"}"] {
        let (mut r, mut w, _) = raw(bridge.port());
        writeln!(w, "{garbage}").ok(); // the host may already have closed: a reset is a valid refusal (Windows)
        assert!(rest(&mut r).is_empty(), "{garbage:?}");
    }
    let (mut r, w, _) = raw(bridge.port());
    drop(w.shutdown(std::net::Shutdown::Write));
    assert!(rest(&mut r).is_empty());
    assert_eq!(s.host.count(), 0, "nothing was run");
}

#[test]
fn a_silent_client_is_dropped_after_the_delay() {
    let s = setup(Echo::default());
    let bridge = s.start(quick_limits());
    let (mut r, _w, _) = raw(bridge.port());
    let started = std::time::Instant::now();
    assert!(rest(&mut r).is_empty());
    assert!(started.elapsed() < Duration::from_secs(2), "closed after the handshake delay");
    // Authenticated but no request: dropped too, nothing run.
    let ep = s.endpoint();
    let (mut r, mut w, hello) = raw(bridge.port());
    let sn = wire::hex_field(&hello, "nonce", 32).unwrap();
    writeln!(w, "{}", json!({ "nonce": wire::hex(&[1; 32]), "proof": wire::hex(&wire::client_proof(&ep.token, ep.port, &sn, &[1; 32])) })).unwrap();
    let got = rest(&mut r);
    assert_eq!(String::from_utf8(got).unwrap().lines().count(), 1, "only the server proof");
    assert_eq!(s.host.count(), 0);
}

#[test]
fn only_loopback_peers_are_allowed() {
    assert!(is_allowed_peer(&SocketAddr::from(([127, 0, 0, 1], 5))));
    assert!(is_allowed_peer(&SocketAddr::from(([127, 9, 9, 9], 5))));
    assert!(!is_allowed_peer(&SocketAddr::from(([192, 168, 1, 2], 5))));
    assert!(!is_allowed_peer(&SocketAddr::from(([0, 0, 0, 0], 5))));
    let mapped = SocketAddrV6::new(Ipv4Addr::LOCALHOST.to_ipv6_mapped(), 5, 0, 0);
    assert!(is_allowed_peer(&SocketAddr::V6(mapped)));
    let lan = SocketAddrV6::new(Ipv4Addr::new(10, 0, 0, 1).to_ipv6_mapped(), 5, 0, 0);
    assert!(!is_allowed_peer(&SocketAddr::V6(lan)));
    // And the socket is bound to 127.0.0.1 only: another local address of the machine is refused.
    let s = setup(Echo::default());
    let bridge = s.start(Limits::default());
    let lan_ip = std::net::UdpSocket::bind("0.0.0.0:0").and_then(|u| u.connect("10.255.255.255:9").map(|_| u)).and_then(|u| u.local_addr());
    if let Ok(addr) = lan_ip.map(|a| a.ip()).map_err(drop).and_then(|ip| if ip.is_loopback() || ip.is_unspecified() { Err(()) } else { Ok(ip) }) {
        let tried = TcpStream::connect_timeout(&SocketAddr::new(addr, bridge.port()), Duration::from_millis(500));
        assert!(tried.is_err(), "{addr} must not reach the bridge");
    }
}

#[test]
fn at_most_four_connections_at_once() {
    let s = setup(Echo::default());
    let bridge = s.start(Limits::default());
    let open: Vec<_> = (0..4).map(|_| raw(bridge.port())).collect();
    assert!(open.iter().all(|(_, _, h)| h.get("nonce").is_some()));
    let (mut r, _w, hello) = raw(bridge.port());
    assert_eq!(hello["busy"], true);
    assert!(rest(&mut r).is_empty(), "then closed");
    assert_eq!(s.call("discipline", json!({})), Err(CallError::Busy));
    drop(open);
    std::thread::sleep(Duration::from_millis(200));
    assert!(s.call("discipline", json!({})).is_ok(), "a slot is free again");
}

#[test]
fn sixty_calls_per_minute_then_refused_without_blocking() {
    let s = setup(Echo::default());
    let bridge = s.start(Limits::default());
    for i in 0..60 {
        assert!(!s.call("risk", json!({ "i": i })).unwrap().is_error);
        s.clock.fetch_add(500, Ordering::SeqCst); // 60 calls within 30 s
    }
    let refused = s.call("risk", json!({})).unwrap();
    assert!(refused.is_error);
    let v: Value = serde_json::from_str(&refused.text).unwrap();
    assert_eq!(v["code"], "mcp:tooManyCalls");
    assert_eq!(s.host.count(), 60, "the 61st was not run");
    assert_eq!((bridge.stats().calls, bridge.stats().refused), (60, 1));
    // The window slides: 30 s later the first calls are older than a minute.
    s.clock.fetch_add(30_001, Ordering::SeqCst);
    assert!(!s.call("risk", json!({})).unwrap().is_error);
    assert_eq!(s.host.count(), 61);
}

#[test]
fn oversized_or_malformed_requests_are_refused_and_not_run() {
    let s = setup(Echo::default());
    let bridge = s.start(Limits::default());
    let ep = s.endpoint();
    let authed = || {
        let (r, mut w, hello) = raw(bridge.port());
        let sn = wire::hex_field(&hello, "nonce", 32).unwrap();
        writeln!(w, "{}", json!({ "nonce": wire::hex(&[7; 32]), "proof": wire::hex(&wire::client_proof(&ep.token, ep.port, &sn, &[7; 32])) })).unwrap();
        let mut r = r;
        let _proof = wire::read_line(&mut r, 4096).unwrap();
        (r, w)
    };
    let (mut r, mut w) = authed();
    w.write_all(&vec![b'x'; wire::MAX_REQUEST_LINE + 10]).ok(); // the host may already have closed: a reset is a valid refusal (Windows)
    w.write_all(b"\n").ok(); // the host may already have closed: a reset is a valid refusal (Windows)
    let text = String::from_utf8(rest(&mut r)).unwrap();
    assert!(text.contains("mcp:tooLarge"), "{text}");
    for bad in [r#"{"tool":"risk"}"#, r#"{"tool":"risk","arguments":[1]}"#, r#"{"arguments":{}}"#, "not json"] {
        let (mut r, mut w) = authed();
        writeln!(w, "{bad}").ok(); // the host may already have closed: a reset is a valid refusal (Windows)
        let text = String::from_utf8(rest(&mut r)).unwrap();
        assert!(text.contains("mcp:badRequest"), "{bad}: {text}");
    }
    assert_eq!(s.host.count(), 0);
}

#[test]
fn stopping_closes_the_port_removes_the_file_and_the_token_dies() {
    let s = setup(Echo::default());
    let bridge = s.start(Limits::default());
    let first = s.endpoint();
    let port = bridge.port();
    bridge.stop();
    assert!(!endpoint_path(s.dir.path()).exists(), "file removed");
    assert!(TcpStream::connect_timeout(&SocketAddr::from(([127, 0, 0, 1], port)), Duration::from_millis(500)).is_err(), "nothing listens");
    assert_eq!(s.call("risk", json!({})), Err(CallError::NotRunning));

    // Re-enabled: a new token; the old one is refused even on the new port.
    let bridge = s.start(Limits::default());
    let second = s.endpoint();
    assert_ne!(first.token, second.token);
    let old = Endpoint { port: bridge.port(), ..first };
    assert_eq!(client::call_endpoint(&old, "risk", &json!({}), quick()), Err(CallError::Refused));
    assert!(s.call("risk", json!({})).is_ok());
    // Dropping the bridge (app closing) removes the file too.
    drop(bridge);
    assert!(!endpoint_path(s.dir.path()).exists());
    assert_eq!(s.host.count(), 1);
}

#[test]
fn a_stale_file_is_removed_at_startup_and_a_newer_file_is_never_removed() {
    let s = setup(Echo::default());
    std::fs::write(endpoint_path(s.dir.path()), "{\"stale\":true}").unwrap();
    assert!(remove_stale_endpoint(s.dir.path()).unwrap());
    assert!(!remove_stale_endpoint(s.dir.path()).unwrap());
    // Stopping only removes the file it wrote.
    let bridge = s.start(Limits::default());
    std::fs::write(endpoint_path(s.dir.path()), "other").unwrap();
    bridge.stop();
    assert_eq!(std::fs::read_to_string(endpoint_path(s.dir.path())).unwrap(), "other");
}

#[test]
fn a_call_in_flight_when_the_access_is_cut_still_gets_its_answer_and_later_ones_nothing() {
    let s = setup(Echo { delay: Some(Duration::from_millis(300)), ..Echo::default() });
    let bridge = s.start(Limits::default());
    let dir = s.dir.path().to_path_buf();
    let pending = std::thread::spawn(move || client::call(&dir, "risk", &json!({}), quick()));
    while !s.host.entered.load(Ordering::SeqCst) {
        std::thread::sleep(Duration::from_millis(5));
    }
    bridge.stop();
    assert!(pending.join().unwrap().is_ok(), "the tool had started");
    assert_eq!(s.call("risk", json!({})), Err(CallError::NotRunning));
}

#[cfg(unix)]
#[test]
fn the_endpoint_file_is_readable_by_the_user_only() {
    use std::os::unix::fs::PermissionsExt;
    let s = setup(Echo::default());
    let _bridge = s.start(Limits::default());
    let mode = std::fs::metadata(endpoint_path(s.dir.path())).unwrap().permissions().mode();
    assert_eq!(mode & 0o777, 0o600);
}
