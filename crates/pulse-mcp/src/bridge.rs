//! Wire protocol of the local bridge between `pulse-mcp` (the proxy started by the user's MCP client) and
//! Pulse itself (`pulse_core::mcp`). Defined once, here, and used by both sides.
//!
//! Transport: one TCP connection to `127.0.0.1` per tool call, lines of JSON (`\n`), each bounded.
//!
//! 1. Pulse → proxy, hello: `{"protocol":"pulse-mcp-bridge","version":1,"nonce":"<64 hex>"}`
//!    (`"busy":true` instead of a nonce when 4 connections are already open, then Pulse closes).
//! 2. proxy → Pulse: `{"nonce":"<64 hex>","proof":"<64 hex>"}`, proof = HMAC-SHA256(token, client label ‖
//!    port ‖ Pulse nonce ‖ proxy nonce). Pulse checks it in constant time; wrong or missing → it closes
//!    at once and writes nothing more.
//! 3. Pulse → proxy: `{"proof":"<64 hex>"}` = HMAC-SHA256(token, server label ‖ port ‖ both nonces). The proxy
//!    checks it in constant time **before** sending anything else: a program that took over the port of a
//!    stale endpoint file never receives a request, and never the token (the token never travels at all).
//! 4. proxy → Pulse: `{"tool":"…","arguments":{…}}`; Pulse → proxy: `{"text":"…","isError":bool}` where
//!    `text` is **exactly** the text handed to the MCP client (and written to Pulse's log). Then Pulse closes.

use hmac::{Hmac, KeyInit, Mac};
use serde_json::{json, Value};
use sha2::Sha256;
use std::io::{self, BufRead};

/// File written in Pulse's data folder while the access is on (deleted when it goes off).
pub const ENDPOINT_FILE: &str = "mcp-endpoint.json";
pub const PROTOCOL: &str = "pulse-mcp-bridge";
pub const VERSION: u64 = 1;
/// The only address the bridge listens on and the proxy connects to.
pub const HOST: &str = "127.0.0.1";
pub const TOKEN_BYTES: usize = 32;
pub const NONCE_BYTES: usize = 32;
/// Longest hello, proof or proof reply line.
pub const MAX_HANDSHAKE_LINE: usize = 1_024;
/// Longest tool request line (name + arguments).
pub const MAX_REQUEST_LINE: usize = 64 * 1_024;
/// Longest tool reply line (a tool result is capped at ~20 kB by `pulse-core`; JSON escaping can grow it).
pub const MAX_REPLY_LINE: usize = 256 * 1_024;

const CLIENT_LABEL: &[u8] = b"pulse-mcp bridge v1 client proof";
const SERVER_LABEL: &[u8] = b"pulse-mcp bridge v1 server proof";

/// Content of `mcp-endpoint.json`. Only `port` and `token` are used to connect; `host` is checked (the
/// proxy connects to 127.0.0.1 whatever the file says, and refuses a file that says otherwise).
#[derive(Clone, PartialEq, Eq)]
pub struct Endpoint {
    pub port: u16,
    pub token: [u8; TOKEN_BYTES],
    pub pid: u32,
    pub started_at: i64,
}

impl std::fmt::Debug for Endpoint {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Endpoint").field("port", &self.port).field("token", &"***").field("pid", &self.pid).finish()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EndpointError {
    /// Not JSON, missing field, bad token length…
    Invalid,
    /// Another address than 127.0.0.1.
    NotLoopback,
    /// Another protocol version.
    Version,
}

impl Endpoint {
    pub fn to_json(&self) -> String {
        json!({ "protocol": PROTOCOL, "version": VERSION, "host": HOST, "port": self.port, "token": hex(&self.token),
            "pid": self.pid, "startedAt": self.started_at })
        .to_string()
    }

    pub fn parse(text: &str) -> Result<Endpoint, EndpointError> {
        let v: Value = serde_json::from_str(text).map_err(|_| EndpointError::Invalid)?;
        if v.get("protocol").and_then(Value::as_str) != Some(PROTOCOL) {
            return Err(EndpointError::Invalid);
        }
        if v.get("version").and_then(Value::as_u64) != Some(VERSION) {
            return Err(EndpointError::Version);
        }
        if v.get("host").and_then(Value::as_str) != Some(HOST) {
            return Err(EndpointError::NotLoopback);
        }
        let port = v.get("port").and_then(Value::as_u64).filter(|p| (1..=65_535).contains(p)).ok_or(EndpointError::Invalid)? as u16;
        let token = v.get("token").and_then(Value::as_str).and_then(unhex).ok_or(EndpointError::Invalid)?;
        let token: [u8; TOKEN_BYTES] = token.try_into().map_err(|_| EndpointError::Invalid)?;
        let pid = v.get("pid").and_then(Value::as_u64).and_then(|p| u32::try_from(p).ok()).unwrap_or(0);
        let started_at = v.get("startedAt").and_then(Value::as_i64).unwrap_or(0);
        Ok(Endpoint { port, token, pid, started_at })
    }
}

type HmacSha256 = Hmac<Sha256>;

fn mac(token: &[u8], label: &[u8], port: u16, server_nonce: &[u8], client_nonce: &[u8]) -> HmacSha256 {
    // HMAC accepts a key of any length: this cannot fail.
    let mut m = <HmacSha256 as KeyInit>::new_from_slice(token).unwrap_or_else(|_| unreachable!("HMAC takes any key length"));
    m.update(label);
    m.update(&port.to_be_bytes());
    m.update(&(server_nonce.len() as u32).to_be_bytes());
    m.update(server_nonce);
    m.update(&(client_nonce.len() as u32).to_be_bytes());
    m.update(client_nonce);
    m
}

/// What the proxy sends to prove it knows the token.
pub fn client_proof(token: &[u8], port: u16, server_nonce: &[u8], client_nonce: &[u8]) -> Vec<u8> {
    mac(token, CLIENT_LABEL, port, server_nonce, client_nonce).finalize().into_bytes().to_vec()
}

/// What Pulse sends back to prove it knows the token too.
pub fn server_proof(token: &[u8], port: u16, server_nonce: &[u8], client_nonce: &[u8]) -> Vec<u8> {
    mac(token, SERVER_LABEL, port, server_nonce, client_nonce).finalize().into_bytes().to_vec()
}

/// Constant-time check of a proof sent by the proxy.
pub fn verify_client_proof(token: &[u8], port: u16, server_nonce: &[u8], client_nonce: &[u8], proof: &[u8]) -> bool {
    mac(token, CLIENT_LABEL, port, server_nonce, client_nonce).verify_slice(proof).is_ok()
}

/// Constant-time check of the proof sent back by Pulse.
pub fn verify_server_proof(token: &[u8], port: u16, server_nonce: &[u8], client_nonce: &[u8], proof: &[u8]) -> bool {
    mac(token, SERVER_LABEL, port, server_nonce, client_nonce).verify_slice(proof).is_ok()
}

/// Random bytes from the operating system (token, nonces).
pub fn random<const N: usize>() -> Option<[u8; N]> {
    let mut b = [0u8; N];
    getrandom::fill(&mut b).ok()?;
    Some(b)
}

pub fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        s.push(DIGITS[(b >> 4) as usize] as char);
        s.push(DIGITS[(b & 15) as usize] as char);
    }
    s
}

pub fn unhex(s: &str) -> Option<Vec<u8>> {
    if !s.len().is_multiple_of(2) || s.len() > 256 {
        return None;
    }
    let digit = |c: u8| match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    };
    s.as_bytes().chunks(2).map(|p| Some(digit(p[0])? << 4 | digit(p[1])?)).collect()
}

/// A hex field of exactly `n` bytes in a JSON line.
pub fn hex_field(v: &Value, key: &str, n: usize) -> Option<Vec<u8>> {
    v.get(key).and_then(Value::as_str).and_then(unhex).filter(|b| b.len() == n)
}

/// One line read with a size limit: a longer line is never buffered whole.
#[derive(Debug, PartialEq, Eq)]
pub enum Line {
    Line(Vec<u8>),
    /// The line was longer than the limit; its rest (up to the next `\n`) has been skipped.
    TooLong,
    Eof,
}

/// Reads up to `\n` (not included; a trailing `\r` is dropped). A last line without `\n` counts.
pub fn read_line(r: &mut impl BufRead, max: usize) -> io::Result<Line> {
    let mut out = Vec::new();
    let mut too_long = false;
    loop {
        let buf = match r.fill_buf() {
            Ok(b) => b,
            Err(e) if e.kind() == io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        };
        if buf.is_empty() {
            return Ok(if too_long {
                Line::TooLong
            } else if out.is_empty() {
                Line::Eof
            } else {
                Line::Line(trim_cr(out))
            });
        }
        let (chunk, found) = match buf.iter().position(|&b| b == b'\n') {
            Some(i) => (&buf[..i], Some(i)),
            None => (buf, None),
        };
        if !too_long {
            if out.len() + chunk.len() > max {
                too_long = true;
                out = Vec::new();
            } else {
                out.extend_from_slice(chunk);
            }
        }
        let used = found.map_or(buf.len(), |i| i + 1);
        r.consume(used);
        if found.is_some() {
            return Ok(if too_long { Line::TooLong } else { Line::Line(trim_cr(out)) });
        }
    }
}

fn trim_cr(mut v: Vec<u8>) -> Vec<u8> {
    if v.last() == Some(&b'\r') {
        v.pop();
    }
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_round_trip_and_refusals() {
        let e = Endpoint { port: 51_234, token: [7; 32], pid: 42, started_at: 1_000 };
        assert_eq!(Endpoint::parse(&e.to_json()), Ok(e.clone()));
        assert!(!format!("{e:?}").contains("0707"), "Debug never shows the token");
        let other_host = e.to_json().replace("127.0.0.1", "0.0.0.0");
        assert_eq!(Endpoint::parse(&other_host), Err(EndpointError::NotLoopback));
        let v2 = e.to_json().replace("\"version\":1", "\"version\":2");
        assert_eq!(Endpoint::parse(&v2), Err(EndpointError::Version));
        assert_eq!(Endpoint::parse("{"), Err(EndpointError::Invalid));
        assert_eq!(Endpoint::parse(&e.to_json().replace(&hex(&[7; 32]), "abcd")), Err(EndpointError::Invalid));
        assert_eq!(Endpoint::parse(&e.to_json().replace("51234", "0")), Err(EndpointError::Invalid));
    }

    #[test]
    fn proofs_depend_on_token_port_and_both_nonces() {
        let (t, sn, cn) = ([1u8; 32], [2u8; 32], [3u8; 32]);
        let p = client_proof(&t, 9, &sn, &cn);
        assert_eq!(p.len(), 32);
        assert!(verify_client_proof(&t, 9, &sn, &cn, &p));
        assert!(!verify_client_proof(&[9u8; 32], 9, &sn, &cn, &p), "another token");
        assert!(!verify_client_proof(&t, 10, &sn, &cn, &p), "another port (a relay through another port fails)");
        assert!(!verify_client_proof(&t, 9, &cn, &sn, &p), "nonces swapped");
        assert!(!verify_client_proof(&t, 9, &sn, &cn, &p[..31]), "truncated");
        assert!(!verify_server_proof(&t, 9, &sn, &cn, &p), "a client proof is not a server proof");
        assert!(verify_server_proof(&t, 9, &sn, &cn, &server_proof(&t, 9, &sn, &cn)));
    }

    #[test]
    fn hex_and_lines() {
        assert_eq!(hex(&[0, 255, 16]), "00ff10");
        assert_eq!(unhex("00fF10"), Some(vec![0, 255, 16]));
        assert_eq!(unhex("0g"), None);
        assert_eq!(unhex("abc"), None);
        let mut r = io::Cursor::new(b"abc\r\n0123456789xyz\nend".to_vec());
        assert_eq!(read_line(&mut r, 5).unwrap(), Line::Line(b"abc".to_vec()));
        assert_eq!(read_line(&mut r, 5).unwrap(), Line::TooLong);
        assert_eq!(read_line(&mut r, 5).unwrap(), Line::Line(b"end".to_vec()));
        assert_eq!(read_line(&mut r, 5).unwrap(), Line::Eof);
        let mut long = io::Cursor::new(vec![b'a'; 100]);
        assert_eq!(read_line(&mut long, 10).unwrap(), Line::TooLong);
        assert!(random::<32>().is_some_and(|a| a != [0; 32]));
    }
}
