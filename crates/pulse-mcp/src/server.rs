//! A small MCP server over stdio, written by hand (no SDK): JSON-RPC 2.0, one message per line.
//!
//! Supported: `initialize` (protocol versions 2024-11-05, 2025-03-26, 2025-06-18 and 2025-11-25, the
//! « legacy » handshake era), `notifications/initialized`, `ping`, `tools/list`, `tools/call`. Nothing
//! else: no resources, no prompts, no requests from the server to the client. A client of the 2026-07-28
//! era probes with `server/discover`; the answer « méthode inconnue » (-32601) tells it to fall back to
//! `initialize` (versioning page of the 2026-07-28 specification, stdio backward compatibility).
//!
//! Robustness: invalid JSON, a line over 1 MiB, a batch (array) or an unknown method get a JSON-RPC error
//! and the loop goes on; a notification never gets an answer; the loop ends cleanly when stdin closes.
//! Only protocol messages go to the output: logs go to the `log` writer (stderr in the binary).

use crate::bridge::{self, Line};
use crate::tools;
use serde_json::{json, Map, Value};
use std::io::{self, BufRead, Write};

/// Newest first; `initialize` answers with the client's version when it is one of these.
pub const SUPPORTED_VERSIONS: [&str; 4] = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
pub const LATEST_VERSION: &str = SUPPORTED_VERSIONS[0];
/// Longest message accepted on stdin.
pub const MAX_LINE_BYTES: usize = 1 << 20;

pub const PARSE_ERROR: i64 = -32_700;
pub const INVALID_REQUEST: i64 = -32_600;
pub const METHOD_NOT_FOUND: i64 = -32_601;
pub const INVALID_PARAMS: i64 = -32_602;

/// Runs one tool. `text` is sent to the client exactly as given.
pub trait Backend {
    fn call(&self, tool: &str, arguments: &Value) -> ToolReply;
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolReply {
    pub text: String,
    pub is_error: bool,
}

#[derive(Debug, Default)]
pub struct Session {
    /// Version agreed at `initialize` (`None` before).
    pub version: Option<String>,
    pub initialized: bool,
}

fn error(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

fn result(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

/// Handles one decoded message; `None` = nothing to answer (notification, response).
pub fn handle(session: &mut Session, message: Value, backend: &dyn Backend, log: &mut dyn Write) -> Option<Value> {
    let obj = match message {
        Value::Object(m) => m,
        Value::Array(_) => return Some(error(Value::Null, INVALID_REQUEST, "Les lots JSON-RPC (tableaux) ne sont pas acceptés : un message par ligne.")),
        _ => return Some(error(Value::Null, INVALID_REQUEST, "Requête JSON-RPC invalide : un objet est attendu.")),
    };
    let id = obj.get("id").cloned();
    let method = obj.get("method");
    if method.is_none() && (obj.contains_key("result") || obj.contains_key("error")) {
        return None; // a response: this server never sends requests
    }
    let Some(id) = id else {
        // Notification: never answered, whatever it is.
        if obj.get("jsonrpc").and_then(Value::as_str) == Some("2.0") && method.and_then(Value::as_str) == Some("notifications/initialized") {
            session.initialized = true;
        }
        return None;
    };
    if !(id.is_string() || id.is_i64() || id.is_u64()) {
        return Some(error(Value::Null, INVALID_REQUEST, "Identifiant de requête invalide (chaîne ou entier attendu)."));
    }
    if obj.get("jsonrpc").and_then(Value::as_str) != Some("2.0") {
        return Some(error(id, INVALID_REQUEST, "Requête JSON-RPC invalide : « jsonrpc » doit valoir « 2.0 »."));
    }
    let Some(method) = method.and_then(Value::as_str) else {
        return Some(error(id, INVALID_REQUEST, "Requête JSON-RPC invalide : « method » manque."));
    };
    let params = obj.get("params").cloned().unwrap_or(Value::Null);
    let _ = writeln!(log, "pulse-mcp: {}", method.chars().take(60).collect::<String>());
    Some(match method {
        "initialize" => initialize(session, id, &params),
        "ping" => result(id, json!({})),
        "tools/list" => {
            let version = session.version.as_deref().unwrap_or(LATEST_VERSION);
            result(id, json!({ "tools": tools::list(version) }))
        }
        "tools/call" => call(id, &params, backend, log),
        _ => error(id, METHOD_NOT_FOUND, "Méthode inconnue : ce serveur ne propose que des outils (tools/list, tools/call)."),
    })
}

fn initialize(session: &mut Session, id: Value, params: &Value) -> Value {
    let Some(requested) = params.get("protocolVersion").and_then(Value::as_str) else {
        return error(id, INVALID_PARAMS, "initialize : protocolVersion manque.");
    };
    let version = SUPPORTED_VERSIONS.iter().find(|v| **v == requested).copied().unwrap_or(LATEST_VERSION);
    session.version = Some(version.to_owned());
    result(
        id,
        json!({
            "protocolVersion": version,
            "capabilities": { "tools": { "listChanged": false } },
            "serverInfo": { "name": "pulse", "version": env!("CARGO_PKG_VERSION") },
            "instructions": tools::INSTRUCTIONS,
        }),
    )
}

fn call(id: Value, params: &Value, backend: &dyn Backend, log: &mut dyn Write) -> Value {
    let Some(p) = params.as_object() else {
        return error(id, INVALID_PARAMS, "tools/call : paramètres manquants.");
    };
    let Some(name) = p.get("name").and_then(Value::as_str) else {
        return error(id, INVALID_PARAMS, "tools/call : « name » manque.");
    };
    if !tools::is_known(name) {
        let shown: String = name.chars().take(40).collect();
        return error(id, INVALID_PARAMS, &format!("Outil inconnu : {shown}. Outils disponibles : {}.", tools::names().join(", ")));
    }
    let arguments = match p.get("arguments") {
        None | Some(Value::Null) => Value::Object(Map::new()),
        Some(v @ Value::Object(_)) => v.clone(),
        Some(_) => return error(id, INVALID_PARAMS, "tools/call : « arguments » doit être un objet JSON."),
    };
    let reply = backend.call(name, &arguments);
    let _ = writeln!(log, "pulse-mcp: {name} → {}", if reply.is_error { "erreur" } else { "ok" });
    result(id, json!({ "content": [{ "type": "text", "text": reply.text }], "isError": reply.is_error }))
}

/// Reads messages from `input` until it closes, answers on `output` (one line each, flushed).
pub fn serve(mut input: impl BufRead, mut output: impl Write, backend: &dyn Backend, mut log: impl Write) -> io::Result<()> {
    let mut session = Session::default();
    loop {
        let answer = match bridge::read_line(&mut input, MAX_LINE_BYTES)? {
            Line::Eof => return Ok(()),
            Line::TooLong => Some(error(Value::Null, INVALID_REQUEST, "Message trop long (1 Mio au plus).")),
            Line::Line(bytes) if bytes.iter().all(u8::is_ascii_whitespace) => None,
            Line::Line(bytes) => match serde_json::from_slice::<Value>(&bytes) {
                Ok(message) => handle(&mut session, message, backend, &mut log),
                Err(_) => Some(error(Value::Null, PARSE_ERROR, "JSON illisible.")),
            },
        };
        if let Some(answer) = answer {
            let mut line = answer.to_string();
            line.push('\n');
            output.write_all(line.as_bytes())?;
            output.flush()?;
        }
    }
}
