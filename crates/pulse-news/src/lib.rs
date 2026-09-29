//! Economic calendar fetch (lot 25, see CLAUDE.md, "Calendrier économique"): with `pulse-ai`, the
//! only network code of Pulse. Called on demand, or at most once per Paris day at opening, by one
//! Tauri command that first asks `pulse-core` whether a fetch may start (`news::settings::prepare_fetch`).
//!
//! A source is one implementation of [`CalendarProvider`]: [`IcsUrl`], an iCalendar feed at the
//! address the trader typed (no address is built in), and [`ForexFactory`] (lot 28), the free,
//! unofficial weekly export the trader chose, at its two fixed addresses (current week, then next
//! week when published).
//!
//! What leaves: `GET <address>` with `Host`, `User-Agent: Pulse`, `Accept: text/calendar` (ICS) or
//! `Accept: application/json` (Forex Factory); no cookie, no body, no trading data, no identifier
//! (checked by the fake-server tests). No redirection is followed. Errors are codes the interface
//! translates (`news:<code>`): they never carry the answer.

use pulse_core::news::{FetchPlan, Parsed, SourceKind, ff, ics};
use std::fmt;
use std::time::Duration;
use ureq::Agent;

/// Largest answer read (the same bound as a file).
pub const MAX_RESPONSE_BYTES: u64 = pulse_core::news::MAX_BYTES as u64;
pub const USER_AGENT: &str = "Pulse";
pub const ACCEPT: &str = "text/calendar";
pub const ACCEPT_JSON: &str = "application/json";
/// Part of an error answer read to recognise the "Request Denied" page.
const ERROR_BODY_BYTES: u64 = 64 * 1024;

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
    /// The "Request Denied" page of Forex Factory: too many downloads (2 every 5 minutes, per third parties).
    RequestDenied,
    /// JSON that cannot be read (cut, corrupted).
    InvalidJson,
    /// Valid JSON of another shape than expected (the source's format has changed).
    UnexpectedJson,
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
            NewsError::RequestDenied => "requestDenied",
            NewsError::InvalidJson => "invalidJson",
            NewsError::UnexpectedJson => "unexpectedJson",
        }
    }
}

impl fmt::Display for NewsError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "news:{}", self.code())
    }
}

impl std::error::Error for NewsError {}

/// Timeouts, no redirection, no compression, only `User-Agent: Pulse` and `Accept` added.
fn agent(t: Timeouts, https_only: bool, accept: &str) -> Agent {
    Agent::new_with_config(
        Agent::config_builder()
            .https_only(https_only)
            .http_status_as_error(false)
            .timeout_connect(Some(t.connect))
            .timeout_global(Some(t.total))
            .max_redirects(0)
            .user_agent(USER_AGENT)
            .accept(accept)
            .accept_encoding(ureq::config::AutoHeaderValue::None)
            .build(),
    )
}

/// An iCalendar feed at the trader's address (HTTPS only).
pub struct IcsUrl {
    agent: Agent,
}

impl IcsUrl {
    pub fn new() -> IcsUrl {
        IcsUrl { agent: agent(Timeouts::default(), true, ACCEPT) }
    }

    /// Plain HTTP allowed: the tests' local fake server only.
    pub fn for_tests(timeouts: Timeouts) -> IcsUrl {
        IcsUrl { agent: agent(timeouts, false, ACCEPT) }
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

/// The "Request Denied" page (or its wording) in an answer.
fn is_denied_page(body: &[u8]) -> bool {
    let text = String::from_utf8_lossy(body).to_ascii_lowercase();
    text.contains("request denied") || text.contains("exceeded the limit")
}

/// One `GET`: the body of a 2xx answer (bounded), otherwise a translatable error.
fn get(agent: &Agent, url: &str) -> Result<Vec<u8>, NewsError> {
    let mut response = agent.get(url).call().map_err(transport_error)?;
    let status = response.status().as_u16();
    if !(200..300).contains(&status) {
        // A refused download may come with an error status: its page says so.
        let denied = (400..500).contains(&status)
            && response.body_mut().with_config().limit(ERROR_BODY_BYTES).read_to_vec().is_ok_and(|b| is_denied_page(&b));
        return Err(if denied { NewsError::RequestDenied } else { status_error(status) });
    }
    response.body_mut().with_config().limit(MAX_RESPONSE_BYTES).read_to_vec().map_err(transport_error)
}

/// `news:<code>` of pulse-core's readers → the network error shown.
fn core_error(e: pulse_core::error::CoreError) -> NewsError {
    let text = e.to_string();
    match text.rsplit("news:").next().unwrap_or("") {
        "fileTooLarge" => NewsError::TooLarge,
        "empty" => NewsError::Empty,
        "requestDenied" => NewsError::RequestDenied,
        "invalidJson" => NewsError::InvalidJson,
        "unexpectedJson" => NewsError::UnexpectedJson,
        _ => NewsError::UnexpectedResponse,
    }
}

/// Reads an ICS answer body into events (pure: also used on corrupted answers in the tests).
pub(crate) fn read_body(body: &[u8], plan: &FetchPlan) -> Result<Parsed, NewsError> {
    if body.iter().all(u8::is_ascii_whitespace) {
        return Err(NewsError::Empty);
    }
    if body.iter().find(|b| !b.is_ascii_whitespace()) == Some(&b'<') && is_denied_page(body) {
        return Err(NewsError::RequestDenied);
    }
    ics::parse(body, &plan.defaults).map_err(core_error)
}

impl CalendarProvider for IcsUrl {
    fn id(&self) -> &'static str {
        "icsUrl"
    }

    fn fetch(&self, plan: &FetchPlan) -> Result<Parsed, NewsError> {
        read_body(&get(&self.agent, &plan.url)?, plan)
    }
}

/// Forex Factory's weekly export (lot 28): the current week, then the next one. Two requests at
/// most per fetch, which is the site's limit (2 every 5 minutes, per third parties); Pulse makes
/// at most one fetch every 5 minutes. The next week is optional: its failure (not published yet,
/// refused) keeps the current week and is reported in [`Parsed::partial`]. The current week's
/// failure stops everything (the next week is not even asked).
pub struct ForexFactory {
    agent: Agent,
    this_week: String,
    next_week: String,
}

impl ForexFactory {
    pub fn new() -> ForexFactory {
        ForexFactory { agent: agent(Timeouts::default(), true, ACCEPT_JSON), this_week: ff::THIS_WEEK_URL.into(), next_week: ff::NEXT_WEEK_URL.into() }
    }

    /// Plain HTTP on the tests' local fake server (`base` = `http://127.0.0.1:port`), same paths.
    pub fn for_tests(base: &str, timeouts: Timeouts) -> ForexFactory {
        ForexFactory {
            agent: agent(timeouts, false, ACCEPT_JSON),
            this_week: format!("{base}/ff_calendar_thisweek.json"),
            next_week: format!("{base}/ff_calendar_nextweek.json"),
        }
    }

    fn week(&self, url: &str) -> Result<Parsed, NewsError> {
        ff::parse(&get(&self.agent, url)?).map_err(core_error)
    }
}

impl Default for ForexFactory {
    fn default() -> Self {
        ForexFactory::new()
    }
}

impl CalendarProvider for ForexFactory {
    fn id(&self) -> &'static str {
        "forexFactory"
    }

    fn fetch(&self, _plan: &FetchPlan) -> Result<Parsed, NewsError> {
        let current = self.week(&self.this_week)?;
        if current.events.is_empty() {
            // An empty current week is not believable: nothing is replaced.
            return Err(NewsError::Empty);
        }
        match self.week(&self.next_week) {
            Ok(next) => Ok(ff::merge(current, next)),
            Err(e) => Ok(Parsed { partial: Some(e.to_string()), ..current }),
        }
    }
}

/// The provider of an online source (`None`: no online source).
pub fn provider(source: SourceKind) -> Option<Box<dyn CalendarProvider>> {
    match source {
        SourceKind::None => None,
        SourceKind::IcsUrl => Some(Box::new(IcsUrl::new())),
        SourceKind::ForexFactory => Some(Box::new(ForexFactory::new())),
    }
}

#[cfg(test)]
mod tests;
