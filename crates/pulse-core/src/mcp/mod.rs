//! Local MCP access (lot 37): Pulse opens a bridge on 127.0.0.1 so that the user's own MCP client
//! (Claude Code, through the `pulse-mcp` binary) can call the AI coach's read-only tools. Pulse never
//! calls an AI here and opens no outgoing connection: see CLAUDE.md, « Serveur MCP (lot 37) ».

pub mod bridge;
pub mod exec;
pub mod install;
pub mod log;
pub mod runtime;
pub mod settings;

pub use bridge::{endpoint_path, remove_stale_endpoint, system_clock, Bridge, BridgeHost, BridgeStats, Clock, Limits};
pub use exec::{locked_reply, run_logged};
pub use install::{install_command, InstallCommand};
pub use log::McpCall;
pub use runtime::{expired, McpRuntime, RuntimeStatus, StopReason};
pub use settings::{McpDuration, McpSettings, McpSettingsUpdate};

use crate::error::Result;
use rusqlite::Connection;
use serde::Serialize;

/// Everything the settings page shows (never the port nor the token).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    pub settings: McpSettings,
    #[serde(flatten)]
    pub runtime: RuntimeStatus,
    /// Why it cannot be turned on now (`consentRequired`, `noAccount`), `None` = it can.
    pub cannot_enable: Option<String>,
    /// Rows in the « Données envoyées » log.
    pub log_count: i64,
}

/// `runtime` = [`McpRuntime::status`], taken first: the shell never holds the runtime and the database
/// at the same time.
pub fn status(conn: &Connection, runtime: RuntimeStatus) -> Result<McpStatus> {
    let s = settings::get(conn)?;
    Ok(McpStatus {
        cannot_enable: settings::cannot_enable(conn, &s)?.map(str::to_owned),
        settings: s,
        runtime,
        log_count: log::count(conn)?,
    })
}

#[cfg(test)]
mod bridge_tests;
#[cfg(test)]
mod tests;
