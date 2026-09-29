//! The only network code of Pulse (lot 20, see CLAUDE.md, "IA optionnelle"). It is called on
//! demand only, by two Tauri commands that first check the AI option is turned on.
//!
//! A provider is one implementation of [`Provider`]; Claude (Anthropic Messages API) is the
//! only one today. Errors are codes the interface translates: they never carry the key, the
//! request or the response body.

mod claude;

pub use claude::{Claude, API_BASE, ANTHROPIC_VERSION, FALLBACK_BETA};
pub use pulse_vault::ApiKey;

use std::fmt;
use std::time::Duration;

/// Provider-neutral request: one image, a system prompt and the text that follows the image.
#[derive(Clone, Copy)]
pub struct ImageRequest<'a> {
    pub model: &'a str,
    pub system: &'a str,
    pub image_media_type: &'a str,
    pub image_base64: &'a str,
    pub text: &'a str,
}

impl fmt::Debug for ImageRequest<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "ImageRequest({}, {}, {} base64 bytes)", self.model, self.image_media_type, self.image_base64.len())
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AnalysisReply {
    pub text: String,
    /// The model that actually answered (may differ after a server-side refusal fallback).
    pub model: String,
}

pub trait Provider: Send + Sync {
    /// Stable identifier stored with each comment (`anthropic`).
    fn id(&self) -> &'static str;
    /// Checks the key and access to the model without sending any trading data.
    fn check(&self, key: &ApiKey, model: &str) -> Result<(), AiError>;
    fn analyze_image(&self, key: &ApiKey, request: &ImageRequest) -> Result<AnalysisReply, AiError>;
}

#[derive(Debug, Clone, Copy)]
pub struct Timeouts {
    pub connect: Duration,
    pub check: Duration,
    pub analysis: Duration,
}

impl Default for Timeouts {
    fn default() -> Self {
        Timeouts { connect: Duration::from_secs(15), check: Duration::from_secs(30), analysis: Duration::from_secs(180) }
    }
}

/// What can go wrong once the request leaves; `code()` is what the interface translates (`ai:<code>`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AiError {
    InvalidKey,
    Forbidden,
    Billing,
    ModelNotFound,
    RateLimited,
    Overloaded,
    ServerError,
    ImageTooLarge,
    Rejected,
    Offline,
    Timeout,
    Refused,
    Truncated,
    UnexpectedResponse,
}

impl AiError {
    pub fn code(self) -> &'static str {
        match self {
            AiError::InvalidKey => "invalidKey",
            AiError::Forbidden => "forbidden",
            AiError::Billing => "billing",
            AiError::ModelNotFound => "modelNotFound",
            AiError::RateLimited => "rateLimited",
            AiError::Overloaded => "overloaded",
            AiError::ServerError => "serverError",
            AiError::ImageTooLarge => "imageTooLarge",
            AiError::Rejected => "rejected",
            AiError::Offline => "offline",
            AiError::Timeout => "timeout",
            AiError::Refused => "refused",
            AiError::Truncated => "truncated",
            AiError::UnexpectedResponse => "unexpectedResponse",
        }
    }
}

impl fmt::Display for AiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "ai:{}", self.code())
    }
}

impl std::error::Error for AiError {}

#[cfg(test)]
mod tests;
