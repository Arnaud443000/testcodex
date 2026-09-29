//! Claude through the Anthropic Messages API (raw HTTPS: there is no official Rust SDK).
//! Request shape, headers and error types follow the `claude-api` skill documentation.

use crate::{AiError, AnalysisReply, ApiKey, ImageRequest, Provider, Timeouts};
use serde_json::{json, Value};
use ureq::Agent;

pub const API_BASE: &str = "https://api.anthropic.com";
pub const ANTHROPIC_VERSION: &str = "2023-06-01";
/// Server-side refusal fallback, `"default"` form (Claude API only).
pub const FALLBACK_BETA: &str = "server-side-fallback-2026-07-01";
const MAX_TOKENS: u32 = 16_000;
const MAX_RESPONSE_BYTES: u64 = 2 * 1024 * 1024;

pub struct Claude {
    base: String,
    check_agent: Agent,
    analysis_agent: Agent,
}

impl Claude {
    /// The real service, HTTPS only.
    pub fn official() -> Claude {
        Claude::build(API_BASE, Timeouts::default(), true)
    }

    /// Another base URL (the tests' local fake server, over plain HTTP).
    pub fn with_base_url(base: &str, timeouts: Timeouts) -> Claude {
        Claude::build(base, timeouts, false)
    }

    pub(crate) fn build(base: &str, t: Timeouts, https_only: bool) -> Claude {
        let agent = |total| {
            Agent::new_with_config(
                Agent::config_builder()
                    .https_only(https_only)
                    // Status codes are read and mapped below, never turned into text.
                    .http_status_as_error(false)
                    .timeout_connect(Some(t.connect))
                    .timeout_global(Some(total))
                    .max_redirects(0)
                    .user_agent("Pulse")
                    .build(),
            )
        };
        Claude { base: base.trim_end_matches('/').to_owned(), check_agent: agent(t.check), analysis_agent: agent(t.analysis) }
    }
}

/// Models on which the server-side fallback is sent (`"default"` form: Claude Opus 5.5, Claude Sonnet 5.5).
pub(crate) fn uses_fallback(model: &str) -> bool {
    matches!(model, "claude-opus-5-5" | "claude-sonnet-5-5")
}

/// The JSON body: the image first, then the text (the order the documentation recommends).
/// No `thinking` and no sampling parameter: each model keeps its defaults.
pub(crate) fn request_body(r: &ImageRequest) -> Value {
    let mut body = json!({
        "model": r.model,
        "max_tokens": MAX_TOKENS,
        "system": r.system,
        "messages": [{
            "role": "user",
            "content": [
                { "type": "image", "source": { "type": "base64", "media_type": r.image_media_type, "data": r.image_base64 } },
                { "type": "text", "text": r.text }
            ]
        }]
    });
    if uses_fallback(r.model) {
        body["fallbacks"] = json!("default");
    }
    body
}

/// Maps a non-2xx answer, from its status then the API's `error.type`. The message itself is never kept.
pub(crate) fn status_error(status: u16, body: &str) -> AiError {
    let kind = serde_json::from_str::<Value>(body).ok().and_then(|v| v["error"]["type"].as_str().map(str::to_owned));
    match kind.as_deref() {
        Some("authentication_error") => return AiError::InvalidKey,
        Some("permission_error") => return AiError::Forbidden,
        Some("billing_error") => return AiError::Billing,
        Some("not_found_error") => return AiError::ModelNotFound,
        Some("request_too_large") => return AiError::ImageTooLarge,
        Some("rate_limit_error") => return AiError::RateLimited,
        Some("overloaded_error") => return AiError::Overloaded,
        _ => {}
    }
    match status {
        401 => AiError::InvalidKey,
        402 => AiError::Billing,
        403 => AiError::Forbidden,
        404 => AiError::ModelNotFound,
        413 => AiError::ImageTooLarge,
        429 => AiError::RateLimited,
        529 => AiError::Overloaded,
        500..=599 => AiError::ServerError,
        _ => AiError::Rejected,
    }
}

/// Reads a 200 answer: the text blocks joined (other blocks, e.g. `fallback` or `thinking`, are skipped).
pub(crate) fn parse_reply(body: &str) -> Result<AnalysisReply, AiError> {
    let v: Value = serde_json::from_str(body).map_err(|_| AiError::UnexpectedResponse)?;
    match v["stop_reason"].as_str() {
        Some("refusal") => return Err(AiError::Refused),
        Some("max_tokens") => return Err(AiError::Truncated),
        _ => {}
    }
    let blocks = v["content"].as_array().ok_or(AiError::UnexpectedResponse)?;
    let text: Vec<&str> = blocks.iter().filter(|b| b["type"] == "text").filter_map(|b| b["text"].as_str()).collect();
    let text = text.join("\n").trim().to_owned();
    let model = v["model"].as_str().ok_or(AiError::UnexpectedResponse)?.to_owned();
    if text.is_empty() {
        return Err(AiError::UnexpectedResponse);
    }
    Ok(AnalysisReply { text, model })
}

fn transport_error(e: ureq::Error) -> AiError {
    match e {
        ureq::Error::Timeout(_) => AiError::Timeout,
        ureq::Error::Io(io) if io.kind() == std::io::ErrorKind::TimedOut => AiError::Timeout,
        ureq::Error::HostNotFound | ureq::Error::ConnectionFailed | ureq::Error::Io(_) | ureq::Error::Tls(_) => AiError::Offline,
        _ => AiError::UnexpectedResponse,
    }
}

fn valid_model(model: &str) -> bool {
    !model.is_empty() && model.len() <= 64 && model.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '-' | '.'))
}

fn read(mut response: ureq::http::Response<ureq::Body>) -> Result<(u16, String), AiError> {
    let status = response.status().as_u16();
    let body = response.body_mut().with_config().limit(MAX_RESPONSE_BYTES).read_to_string().map_err(transport_error)?;
    Ok((status, body))
}

impl Provider for Claude {
    fn id(&self) -> &'static str {
        "anthropic"
    }

    fn check(&self, key: &ApiKey, model: &str) -> Result<(), AiError> {
        if !valid_model(model) {
            return Err(AiError::Rejected);
        }
        let response = self
            .check_agent
            .get(format!("{}/v1/models/{model}", self.base))
            .header("x-api-key", key.expose())
            .header("anthropic-version", ANTHROPIC_VERSION)
            .call()
            .map_err(transport_error)?;
        match read(response)? {
            (200, _) => Ok(()),
            (status, body) => Err(status_error(status, &body)),
        }
    }

    fn analyze_image(&self, key: &ApiKey, request: &ImageRequest) -> Result<AnalysisReply, AiError> {
        if !valid_model(request.model) {
            return Err(AiError::Rejected);
        }
        let body = request_body(request).to_string();
        let mut call = self
            .analysis_agent
            .post(format!("{}/v1/messages", self.base))
            .header("x-api-key", key.expose())
            .header("anthropic-version", ANTHROPIC_VERSION)
            .header("content-type", "application/json");
        if uses_fallback(request.model) {
            call = call.header("anthropic-beta", FALLBACK_BETA);
        }
        let response = call.send(body.as_bytes()).map_err(transport_error)?;
        match read(response)? {
            (200, body) => parse_reply(&body),
            (status, body) => Err(status_error(status, &body)),
        }
    }
}
