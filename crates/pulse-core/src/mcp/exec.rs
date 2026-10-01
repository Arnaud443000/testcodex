//! One tool call from the bridge, on the open database: the coach's own tool (`coach::tools::run`, same
//! projections, same safety nets), on the **exposed** accounts only, then the log. No log, no answer: if
//! the row cannot be written, the result is not sent (the user must be able to see everything that left).

use super::log::{self, NewCall};
use super::settings;
use crate::coach::tools::{self, ToolScope};
use pulse_mcp::server::ToolReply;
use rusqlite::Connection;
use serde_json::{json, Value};
use std::time::Instant;

fn error_reply(code: &str, message: &str) -> ToolReply {
    ToolReply { text: json!({ "error": message, "code": code }).to_string(), is_error: true }
}

/// Answer while Pulse is locked: nothing is read, nothing is logged (the database is closed).
pub fn locked_reply() -> ToolReply {
    error_reply("lock:locked", "Pulse est verrouillé : déverrouillez-le puis réactivez l'accès MCP pour que les outils répondent.")
}

/// Runs `tool` for the MCP client and logs exactly what is sent.
pub fn run_logged(conn: &Connection, now_ms: i64, tz_offset_min: i32, tool: &str, arguments: &Value) -> ToolReply {
    let started = Instant::now();
    let reply = match settings::get(conn).and_then(|s| Ok((settings::exposed_accounts(conn, &s)?, s.consent_at.is_some()))) {
        Err(_) => error_reply("mcp:unavailable", "Données indisponibles pour cette demande."),
        Ok((_, false)) => error_reply("mcp:consentRequired", "L'accès MCP n'est pas autorisé dans Pulse (consentement retiré)."),
        Ok((exposed, true)) if exposed.is_empty() => {
            error_reply("mcp:noAccount", "Aucun compte n'est ouvert à l'accès MCP : cochez au moins un compte dans Pulse (Paramètres > Accès MCP).")
        }
        Ok((exposed, true)) => {
            let scope = ToolScope { account_ids: exposed, now_ms, tz_offset_min };
            let out = tools::run(conn, &scope, tool, arguments);
            ToolReply { text: out.content.to_string(), is_error: out.is_error }
        }
    };
    let params = arguments.to_string();
    let call = NewCall {
        at: now_ms,
        tz_offset_min,
        tool,
        params: &params,
        result: &reply.text,
        is_error: reply.is_error,
        duration_ms: started.elapsed().as_millis().min(i64::MAX as u128) as i64,
    };
    match log::record(conn, &call) {
        Ok(()) => reply,
        Err(_) => error_reply("mcp:logFailed", "Le journal des données envoyées n'a pas pu être écrit : rien n'est envoyé."),
    }
}
