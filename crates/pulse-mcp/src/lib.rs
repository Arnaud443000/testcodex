//! Pulse's local MCP server (lot 37). The user's own MCP client (Claude Code) starts the `pulse-mcp`
//! binary and talks to it over stdio; `pulse-mcp` forwards each tool call to Pulse through a local bridge
//! on 127.0.0.1, authenticated by a mutual challenge. Read-only: the tools are the AI coach's (lot 21).
//! Pulse never calls an AI here and this crate has no network client: see CLAUDE.md, « Serveur MCP (lot 37) ».

pub mod bridge;
pub mod client;
pub mod server;
pub mod tools;

use serde_json::Value;
use std::path::{Path, PathBuf};

/// Pulse's Tauri identifier: its data folder is named after it.
pub const APP_IDENTIFIER: &str = "app.pulse.journal";

/// The data folder Pulse uses when none is given (`--data-dir`): the one Tauri picks for the identifier.
pub fn default_data_dir() -> Option<PathBuf> {
    let env = |k: &str| std::env::var_os(k).filter(|v| !v.is_empty()).map(PathBuf::from);
    let base = if cfg!(windows) {
        env("APPDATA")?
    } else if cfg!(target_os = "macos") {
        env("HOME")?.join("Library").join("Application Support")
    } else {
        env("XDG_DATA_HOME").or_else(|| env("HOME").map(|h| h.join(".local").join("share")))?
    };
    Some(base.join(APP_IDENTIFIER))
}

/// The backend of the binary: every call goes through the bridge of the running Pulse.
pub struct BridgeBackend {
    pub data_dir: PathBuf,
    pub timeouts: client::Timeouts,
}

impl BridgeBackend {
    pub fn new(data_dir: &Path) -> BridgeBackend {
        BridgeBackend { data_dir: data_dir.to_path_buf(), timeouts: client::Timeouts::default() }
    }
}

impl server::Backend for BridgeBackend {
    fn call(&self, tool: &str, arguments: &Value) -> server::ToolReply {
        match client::call(&self.data_dir, tool, arguments, self.timeouts) {
            Ok(r) => server::ToolReply { text: r.text, is_error: r.is_error },
            Err(e) => server::ToolReply { text: serde_json::json!({ "error": e.message(), "code": e.code() }).to_string(), is_error: true },
        }
    }
}
