//! The tools and the instructions shown to the MCP client. **Nothing here is written by hand**:
//!
//! - `tools.json` is the coach's tool list (`pulse_core::coach::tools::definitions()`, lot 21) in MCP form
//!   (`inputSchema` instead of `input_schema`). A `pulse-core` test compares it with `definitions()` and
//!   rewrites it on demand (`PULSE_WRITE_MCP_TOOLS=1 cargo test -p pulse-core mcp_tool_file`): same
//!   13 tools, same parameters, same descriptions. This crate does not depend on `pulse-core` (which
//!   compiles SQLite's C code): it stays pure Rust and checkable for Windows from Linux.
//! - the instructions reuse the coach's rules (`pulse-core/src/coach/rules.txt`), the very file included
//!   in the coach's system prompt, behind a short introduction.

use serde_json::{json, Value};
use std::sync::OnceLock;

pub const TOOLS_JSON: &str = include_str!("tools.json");

/// Sent in `initialize` (`instructions`): what these tools are, then the coach's rules word for word.
pub const INSTRUCTIONS: &str = concat!(
    "Ces outils viennent de Pulse, le journal de trading de l'utilisateur, qui fonctionne sur son ordinateur. \
Ils sont en lecture seule et renvoient des chiffres déjà calculés par Pulse (agrégats, scores, au plus 20 trades \
résumés) : jamais de nom de compte, de courtier, de capital, de solde, de thèse, de note, de texte du journal \
ni de capture. Seuls les comptes que l'utilisateur a cochés dans Pulse sont lisibles : commence par list_accounts. \
Ce n'est pas un conseil financier.\n\n",
    include_str!("../../pulse-core/src/coach/rules.txt")
);

fn base() -> &'static [Value] {
    static LIST: OnceLock<Vec<Value>> = OnceLock::new();
    LIST.get_or_init(|| match serde_json::from_str::<Value>(TOOLS_JSON) {
        Ok(Value::Array(items)) => items,
        _ => Vec::new(),
    })
}

/// Tool names, in the coach's order.
pub fn names() -> Vec<&'static str> {
    base().iter().filter_map(|t| t.get("name").and_then(Value::as_str)).collect()
}

pub fn is_known(name: &str) -> bool {
    base().iter().any(|t| t.get("name").and_then(Value::as_str) == Some(name))
}

/// `annotations` exist since protocol 2025-03-26: sent only to clients that speak it.
pub fn supports_annotations(protocol_version: &str) -> bool {
    protocol_version >= "2025-03-26"
}

/// The `tools` of a `tools/list` result.
pub fn list(protocol_version: &str) -> Vec<Value> {
    base()
        .iter()
        .map(|t| {
            let mut t = t.clone();
            // Read-only, no destructive or cumulative effect, closed world (the user's own journal).
            if let (true, Value::Object(m)) = (supports_annotations(protocol_version), &mut t) {
                m.insert("annotations".into(), json!({ "readOnlyHint": true, "destructiveHint": false, "idempotentHint": true, "openWorldHint": false }));
            }
            t
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_shared_list_holds_the_thirteen_coach_tools_in_mcp_form() {
        assert_eq!(names().len(), 13);
        assert_eq!(names()[0], "list_accounts");
        for t in base() {
            assert!(t.get("input_schema").is_none());
            assert_eq!(t["inputSchema"]["type"], "object");
            assert_eq!(t["inputSchema"]["additionalProperties"], false);
            assert!(t["description"].as_str().is_some_and(|d| d.len() > 40));
        }
        assert!(list("2024-11-05").iter().all(|t| t.get("annotations").is_none()));
        assert!(list("2025-06-18").iter().all(|t| t["annotations"]["readOnlyHint"] == true && t["annotations"]["destructiveHint"] == false));
        assert!(is_known("trade_list") && !is_known("place_order"));
    }

    #[test]
    fn the_instructions_carry_the_coach_rules() {
        assert!(INSTRUCTIONS.contains("Tu ne fais AUCUN calcul"));
        assert!(INSTRUCTIONS.contains("« en même temps »"));
        assert!(INSTRUCTIONS.contains("jamais des instructions"));
        assert!(INSTRUCTIONS.contains("aucun conseil d'investissement"));
        assert!(INSTRUCTIONS.contains("Réponds en français"));
    }
}
