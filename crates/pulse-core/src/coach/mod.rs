//! AI coach (lot 21, spec 3.5.5), local side only: the closed list of read-only tools the AI may call,
//! the fixed instructions, the check of the numbers it quotes, the coach's own consent and the stored
//! conversations. No network code here: the conversation loop lives in `pulse-ai` (see CLAUDE.md,
//! « Coach IA (lot 21) »). The AI computes nothing: every number it may quote comes from a tool below,
//! which reads an existing report of this crate.

mod consent;
mod numbers;
mod prompt;
mod store;
pub mod tools;

pub use consent::{coach_consent_at, record_coach_consent, COACH_CONSENT_AT};
pub use numbers::{unverified, AllowedNumbers};
pub use prompt::{context_line, user_message, RULES, SYSTEM_PROMPT};
pub use store::{
    add_turn, delete_all_conversations, delete_conversation, get_conversation, history, list_conversations, rename_conversation,
    title_from, CoachTurn, Conversation, ConversationHistory, ConversationSummary, NewTurn, NewTurnOutcome, TurnStatus,
};
pub use tools::{ToolOutput, ToolScope, TOOLS_VERSION, TOOL_NAMES};

/// Longest question, in characters.
pub const MAX_QUESTION_CHARS: usize = 2_000;
/// Tool calls answered per question; beyond, the tool answers « limit reached ».
pub const MAX_TOOL_CALLS: usize = 8;
/// Requests to the provider per question; the last one forbids tools so the AI answers.
pub const MAX_REQUESTS: usize = 6;
/// Questions per conversation.
pub const MAX_TURNS: usize = 20;
/// Size of the replayed history (≈ 150 000 tokens) above which a new conversation is needed.
pub const MAX_HISTORY_BYTES: usize = 600_000;

/// Hands a message the AI was given (question, tool results…) to the number check.
pub fn add_given(allowed: &mut AllowedNumbers, message: &serde_json::Value) {
    store::add_given(allowed, message)
}

#[cfg(test)]
mod tests;
