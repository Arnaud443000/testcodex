//! Log « Données envoyées » of the MCP access (lot 37, table `mcp_calls`, migration v20): one row per
//! tool call answered, with the **exact** text sent to the user's MCP client. The 500 latest rows are
//! kept. Never read by a statistic, a tool, an insight or an export.

use crate::error::Result;
use rusqlite::{params, Connection};
use serde::Serialize;

/// Rows kept.
pub const MAX_CALLS: i64 = 500;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpCall {
    pub id: i64,
    pub at: i64,
    pub tz_offset_min: i32,
    pub tool: String,
    /// Arguments as received (JSON text).
    pub params: String,
    /// Exactly what was sent (JSON text of the tool result, or of the error).
    pub result: String,
    pub is_error: bool,
    /// Size of `result`, in bytes.
    pub size: i64,
    pub duration_ms: i64,
}

pub struct NewCall<'a> {
    pub at: i64,
    pub tz_offset_min: i32,
    pub tool: &'a str,
    pub params: &'a str,
    pub result: &'a str,
    pub is_error: bool,
    pub duration_ms: i64,
}

/// Writes one row, then keeps only the latest [`MAX_CALLS`].
pub fn record(conn: &Connection, call: &NewCall) -> Result<()> {
    let tool: String = call.tool.chars().take(64).collect();
    let tool = if tool.is_empty() { "?".to_owned() } else { tool };
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO mcp_calls (at, tz_offset_min, tool, params, result, is_error, size, duration_ms) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![call.at, call.tz_offset_min, tool, call.params, call.result, call.is_error, call.result.len() as i64, call.duration_ms.max(0)],
    )?;
    tx.execute("DELETE FROM mcp_calls WHERE id NOT IN (SELECT id FROM mcp_calls ORDER BY id DESC LIMIT ?1)", [MAX_CALLS])?;
    tx.commit()?;
    Ok(())
}

/// Most recent first.
pub fn list(conn: &Connection, limit: Option<i64>) -> Result<Vec<McpCall>> {
    let mut stmt = conn.prepare(
        "SELECT id, at, tz_offset_min, tool, params, result, is_error, size, duration_ms FROM mcp_calls ORDER BY id DESC LIMIT ?1",
    )?;
    let rows = stmt
        .query_map([limit.unwrap_or(MAX_CALLS).clamp(1, MAX_CALLS)], |r| {
            Ok(McpCall {
                id: r.get(0)?,
                at: r.get(1)?,
                tz_offset_min: r.get(2)?,
                tool: r.get(3)?,
                params: r.get(4)?,
                result: r.get(5)?,
                is_error: r.get(6)?,
                size: r.get(7)?,
                duration_ms: r.get(8)?,
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// « Effacer le journal »: returns the number of rows removed.
pub fn clear(conn: &Connection) -> Result<usize> {
    Ok(conn.execute("DELETE FROM mcp_calls", [])?)
}

pub fn count(conn: &Connection) -> Result<i64> {
    Ok(conn.query_row("SELECT COUNT(*) FROM mcp_calls", [], |r| r.get(0))?)
}
