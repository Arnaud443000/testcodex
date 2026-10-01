//! Proxy side of the bridge (lot 37), against fake listeners on real local sockets: the honest one, an
//! impostor that took over the port of a stale file, a silent one, a busy one, a dead port.

use pulse_mcp::bridge::{self, Endpoint, Line};
use pulse_mcp::client::{self, CallError, Reply, Timeouts};
use serde_json::{json, Value};
use std::io::{BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::thread::{self, JoinHandle};
use std::time::Duration;

const TOKEN: [u8; 32] = [0xA5; 32];

fn quick() -> Timeouts {
    Timeouts { connect: Duration::from_secs(1), handshake: Duration::from_millis(400), reply: Duration::from_millis(400) }
}

fn endpoint(port: u16) -> Endpoint {
    Endpoint { port, token: TOKEN, pid: 1, started_at: 0 }
}

fn line(r: &mut BufReader<TcpStream>) -> Value {
    match bridge::read_line(r, 100_000).unwrap() {
        Line::Line(b) => serde_json::from_slice(&b).unwrap(),
        other => panic!("{other:?}"),
    }
}

/// A listener that handles one connection with `f` and returns what it did.
fn listen<T: Send + 'static>(f: impl FnOnce(TcpStream, u16) -> T + Send + 'static) -> (u16, JoinHandle<T>) {
    let l = TcpListener::bind("127.0.0.1:0").unwrap();
    let port = l.local_addr().unwrap().port();
    (port, thread::spawn(move || f(l.accept().unwrap().0, port)))
}

/// The honest side, written from the protocol description: returns the request it received.
fn honest(stream: TcpStream, port: u16, token: [u8; 32]) -> Option<Value> {
    let mut w = stream.try_clone().unwrap();
    let mut r = BufReader::new(stream);
    let sn = [9u8; 32];
    writeln!(w, "{}", json!({ "protocol": bridge::PROTOCOL, "version": 1, "nonce": bridge::hex(&sn) })).unwrap();
    let auth = line(&mut r);
    let cn = bridge::hex_field(&auth, "nonce", 32)?;
    let proof = bridge::hex_field(&auth, "proof", 32)?;
    if !bridge::verify_client_proof(&token, port, &sn, &cn, &proof) {
        return None; // closes without a word
    }
    writeln!(w, "{}", json!({ "proof": bridge::hex(&bridge::server_proof(&token, port, &sn, &cn)) })).unwrap();
    let request = line(&mut r);
    writeln!(w, "{}", json!({ "text": "{\"ok\":1}", "isError": false })).unwrap();
    Some(request)
}

#[test]
fn a_call_to_the_honest_listener_goes_through() {
    let (port, h) = listen(|s, p| honest(s, p, TOKEN));
    let reply = client::call_endpoint(&endpoint(port), "discipline", &json!({ "period": "1S" }), quick()).unwrap();
    assert_eq!(reply, Reply { text: "{\"ok\":1}".into(), is_error: false });
    assert_eq!(h.join().unwrap(), Some(json!({ "tool": "discipline", "arguments": { "period": "1S" } })));
}

#[test]
fn an_old_token_is_refused_and_nothing_is_asked() {
    // Pulse was re-enabled: a new token. The proxy still holds the old one.
    let (port, h) = listen(|s, p| honest(s, p, [0x11; 32]));
    assert_eq!(client::call_endpoint(&endpoint(port), "discipline", &json!({}), quick()), Err(CallError::Refused));
    assert_eq!(h.join().unwrap(), None);
}

/// A program took over the port of a stale endpoint file. It plays the protocol as far as it can: it
/// never gets the token (nor anything derived from it but one proof bound to its own nonce and port), and
/// never a tool request, because it cannot prove it knows the token.
#[test]
fn an_impostor_on_the_port_never_receives_the_token_nor_a_request() {
    let (port, h) = listen(|stream, _| {
        let mut w = stream.try_clone().unwrap();
        writeln!(w, "{}", json!({ "protocol": bridge::PROTOCOL, "version": 1, "nonce": bridge::hex(&[1; 32]) })).unwrap();
        let mut got = Vec::new();
        let mut r = stream;
        r.set_read_timeout(Some(Duration::from_millis(300))).unwrap();
        let mut buf = [0u8; 4096];
        let mut answered = false;
        loop {
            match r.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    got.extend_from_slice(&buf[..n]);
                    if !answered && got.contains(&b'\n') {
                        answered = true; // a made-up "proof": it cannot compute the right one
                        writeln!(w, "{}", json!({ "proof": bridge::hex(&[2; 32]) })).unwrap();
                    }
                }
            }
        }
        got
    });
    assert_eq!(client::call_endpoint(&endpoint(port), "trade_list", &json!({ "order": "worst" }), quick()), Err(CallError::NotPulse));
    let got = h.join().unwrap();
    let text = String::from_utf8_lossy(&got);
    assert!(!text.contains(&bridge::hex(&TOKEN)), "the token in hex never goes on the wire");
    assert!(!got.windows(32).any(|w| w == TOKEN), "nor the raw token");
    assert!(!text.contains("trade_list") && !text.contains("worst"), "no request before the listener proved itself: {text}");
    assert_eq!(text.lines().count(), 1, "one line only: the proof");
}

#[test]
fn a_listener_that_is_not_pulse_or_does_not_answer() {
    let (port, h) = listen(|mut s, _| {
        s.write_all(b"HTTP/1.1 200 OK\r\n\r\n").unwrap();
        thread::sleep(Duration::from_millis(100));
    });
    assert_eq!(client::call_endpoint(&endpoint(port), "discipline", &json!({}), quick()), Err(CallError::NotPulse));
    h.join().unwrap();

    let (port, h) = listen(|s, _| {
        thread::sleep(Duration::from_millis(900));
        drop(s);
    });
    assert_eq!(client::call_endpoint(&endpoint(port), "discipline", &json!({}), quick()), Err(CallError::Timeout));
    h.join().unwrap();

    // Accepted, then closed without a word.
    let (port, h) = listen(|s, _| drop(s));
    assert_eq!(client::call_endpoint(&endpoint(port), "discipline", &json!({}), quick()), Err(CallError::NotPulse));
    h.join().unwrap();
}

#[test]
fn a_busy_pulse_and_a_pulse_that_answers_too_slowly() {
    let (port, h) = listen(|mut s, _| writeln!(s, "{}", json!({ "protocol": bridge::PROTOCOL, "version": 1, "busy": true })).unwrap());
    assert_eq!(client::call_endpoint(&endpoint(port), "discipline", &json!({}), quick()), Err(CallError::Busy));
    h.join().unwrap();

    let (port, h) = listen(|stream, port| {
        let mut w = stream.try_clone().unwrap();
        let mut r = BufReader::new(stream);
        let sn = [3u8; 32];
        writeln!(w, "{}", json!({ "protocol": bridge::PROTOCOL, "version": 1, "nonce": bridge::hex(&sn) })).unwrap();
        let auth = line(&mut r);
        let cn = bridge::hex_field(&auth, "nonce", 32).unwrap();
        writeln!(w, "{}", json!({ "proof": bridge::hex(&bridge::server_proof(&TOKEN, port, &sn, &cn)) })).unwrap();
        line(&mut r);
        thread::sleep(Duration::from_millis(900)); // the tool takes too long
    });
    assert_eq!(client::call_endpoint(&endpoint(port), "discipline", &json!({}), quick()), Err(CallError::Timeout));
    h.join().unwrap();
}

#[test]
fn endpoint_files_absent_stale_or_wrong() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(client::call(dir.path(), "discipline", &json!({}), quick()), Err(CallError::NotRunning));

    // Stale file: nothing listens on its port any more.
    let dead = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
    std::fs::write(dir.path().join(bridge::ENDPOINT_FILE), endpoint(dead).to_json()).unwrap();
    assert_eq!(client::call(dir.path(), "discipline", &json!({}), quick()), Err(CallError::Unreachable));

    // Another address than 127.0.0.1 is refused before any connection.
    std::fs::write(dir.path().join(bridge::ENDPOINT_FILE), endpoint(dead).to_json().replace("127.0.0.1", "192.168.1.20")).unwrap();
    assert_eq!(client::call(dir.path(), "discipline", &json!({}), quick()), Err(CallError::BadEndpoint));
    std::fs::write(dir.path().join(bridge::ENDPOINT_FILE), "not json").unwrap();
    assert_eq!(client::call(dir.path(), "discipline", &json!({}), quick()), Err(CallError::BadEndpoint));

    // Through the file, with the honest listener.
    let (port, h) = listen(|s, p| honest(s, p, TOKEN));
    std::fs::write(dir.path().join(bridge::ENDPOINT_FILE), endpoint(port).to_json()).unwrap();
    assert!(client::call(dir.path(), "discipline", &json!({}), quick()).is_ok());
    h.join().unwrap();
}

#[test]
fn arguments_too_large_are_not_sent() {
    let big = json!({ "symbol": "x".repeat(bridge::MAX_REQUEST_LINE) });
    assert_eq!(client::call_endpoint(&endpoint(1), "discipline", &big, quick()), Err(CallError::TooLarge));
    for e in [CallError::NotRunning, CallError::NotPulse, CallError::Busy, CallError::Timeout] {
        assert!(e.code().starts_with("mcp:") && !e.message().is_empty());
    }
}
