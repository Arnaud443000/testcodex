//! Local MCP access (lot 37): Pulse opens a bridge on 127.0.0.1 so that the user's own MCP client
//! (Claude Code, through the `pulse-mcp` binary) can call the AI coach's read-only tools. Pulse never
//! calls an AI here and opens no outgoing connection: see CLAUDE.md, « Serveur MCP (lot 37) ».

pub mod bridge;

pub use bridge::{endpoint_path, remove_stale_endpoint, system_clock, Bridge, BridgeHost, BridgeStats, Clock, Limits};

#[cfg(test)]
mod bridge_tests;
