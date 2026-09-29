//! Economic calendar fetch (lot 25, see CLAUDE.md, "Calendrier économique"): with `pulse-ai`, the
//! only network code of Pulse. Called on demand, or at most once per Paris day at opening, by one
//! Tauri command that first asks `pulse-core` whether a fetch may start (`news::settings::prepare_fetch`).
//!
//! A source is one implementation of [`CalendarProvider`]. Today: [`IcsUrl`], an iCalendar feed at
//! the address the trader typed (no address is built in). A dedicated provider (Forex Factory's
//! weekly export, a paid API) is one more implementation, added once the trader has chosen and its
//! format has been checked on a real answer.
//!
//! What leaves: `GET <address>` with `Host`, `User-Agent: Pulse`, `Accept: text/calendar`; no
//! cookie, no body, no trading data, no identifier (checked by the fake-server tests). Errors are
//! codes the interface translates (`news:<code>`): they never carry the answer.

use pulse_core::news::{FetchPlan, Parsed, ics};
use std::fmt;
use std::time::Duration;
use ureq::Agent;

/// Largest answer read (the same bound as a file).
pub const MAX_RESPONSE_BYTES: u64 = pulse_core::news::MAX_BYTES as u64;
pub const USER_AGENT: &str = "Pulse";
pub const ACCEPT: &str = "text/calendar";

pub trait CalendarProvider: Send + Sync {
    /// Stable identifier (`icsUrl`), as stored with the events.
    fn id(&self) -> &'static str;
    /// Fetches and reads the calendar; nothing is stored here.
    fn fetch(&self, plan: &FetchPlan) -> Result<Parsed, NewsError>;
}

#[derive(Debug, Clone, Copy)]
pub struct Timeouts {
    pub connect: Duration,
    pub total: Duration,
}

impl Default for Timeouts {
    fn default() -> Self {
        Timeouts { connect: Duration::from_secs(10), total: Duration::from_secs(30) }
    }
}

/// What can go wrong once the request leaves; `code()` is what the interface translates (`news:<code>`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum NewsError {
    /// No connection (no network, unknown host, TLS refused).
    Offline,
    Timeout,
    /// A 3xx answer: redirections are not followed (the documented request stays the only one).
    Redirected,
    /// 401 / 403.
    Forbidden,
    NotFound,
    RateLimited,
    /// Another 4xx.
    Rejected,
    ServerError,
    /// Beyond [`MAX_RESPONSE_BYTES`].
    TooLarge,
    /// A 200 without content.
    Empty,
    /// Not an iCalendar file (an HTML error page, garbage…).
    UnexpectedResponse,
}

impl NewsError {
    pub fn code(self) -> &'static str {
        match self {
            NewsError::Offline => "offline",
            NewsError::Timeout => "timeout",
            NewsError::Redirected => "redirected",
            NewsError::Forbidden => "forbidden",
            NewsError::NotFound => "notFound",
            NewsError::RateLimited => "rateLimited",
            NewsError::Rejected => "rejected",
            NewsError::ServerError => "serverError",
            NewsError::TooLarge => "tooLarge",
            NewsError::Empty => "empty",
            NewsError::UnexpectedResponse => "unexpectedResponse",
        }
    }
}

impl fmt::Display for NewsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "news:{}", self.code())
    }
}

impl std::error::Error for NewsError {}

/// An iCalendar feed at the trader's address (HTTPS only).
pub struct IcsUrl {
    agent: Agent,
}

impl IcsUrl {
    pub fn new() -> IcsUrl {
        IcsUrl::build(Timeouts::default(), true)
    }

    /// Plain HTTP allowed: the tests' local fake server only.
    pub fn for_tests(timeouts: Timeouts) -> IcsUrl {
        IcsUrl::build(timeouts, false)
    }

    fn build(t: Timeouts, https_only: bool) -> IcsUrl {
        let agent = Agent::new_with_config(
            Agent::config_builder()
                .https_only(https_only)
                .http_status_as_error(false)
                .timeout_connect(Some(t.connect))
                .timeout_global(Some(t.total))
                .max_redirects(0)
                .user_agent(USER_AGENT)
                .accept(ACCEPT)
                .accept_encoding(ureq::config::AutoHeaderValue::None)
                .build(),
        );
        IcsUrl { agent }
    }
}

impl Default for IcsUrl {
    fn default() -> Self {
        IcsUrl::new()
    }
}

fn transport_error(e: ureq::Error) -> NewsError {
    match e {
        ureq::Error::Timeout(_) => NewsError::Timeout,
        ureq::Error::Io(io) if io.kind() == std::io::ErrorKind::TimedOut => NewsError::Timeout,
        ureq::Error::BodyExceedsLimit(_) => NewsError::TooLarge,
        ureq::Error::TooManyRedirects | ureq::Error::RedirectFailed => NewsError::Redirected,
        ureq::Error::HostNotFound | ureq::Error::ConnectionFailed | ureq::Error::Io(_) | ureq::Error::Tls(_) => NewsError::Offline,
        _ => NewsError::UnexpectedResponse,
    }
}

pub(crate) fn status_error(status: u16) -> NewsError {
    match status {
        300..=399 => NewsError::Redirected,
        401 | 403 => NewsError::Forbidden,
        404 | 410 => NewsError::NotFound,
        429 => NewsError::RateLimited,
        400..=499 => NewsError::Rejected,
        _ => NewsError::ServerError,
    }
}

/// Reads an answer body into events (pure: also used on corrupted answers in the tests).
pub(crate) fn read_body(body: &[u8], plan: &FetchPlan) -> Result<Parsed, NewsError> {
    if body.iter().all(u8::is_ascii_whitespace) {
        return Err(NewsError::Empty);
    }
    ics::parse(body, &plan.defaults).map_err(|e| match e.to_string().as_str() {
        s if s.ends_with("news:fileTooLarge") => NewsError::TooLarge,
        _ => NewsError::UnexpectedResponse,
    })
}

impl CalendarProvider for IcsUrl {
    fn id(&self) -> &'static str {
        "icsUrl"
    }

    fn fetch(&self, plan: &FetchPlan) -> Result<Parsed, NewsError> {
        let mut response = self.agent.get(&plan.url).call().map_err(transport_error)?;
        let status = response.status().as_u16();
        if !(200..300).contains(&status) {
            return Err(status_error(status));
        }
        let body = response.body_mut().with_config().limit(MAX_RESPONSE_BYTES).read_to_vec().map_err(transport_error)?;
        read_body(&body, plan)
    }
}

#[cfg(test)]
mod tests;
