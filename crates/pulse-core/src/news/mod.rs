//! Economic calendar (lot 25, spec 3.6.8): events read from a file or received from a
//! provider, stored locally, shown in Paris time. **No network here**: `pulse-news` fetches,
//! this module parses, stores and answers. See CLAUDE.md, "Calendrier économique (lot 25)".

pub mod csv;
pub mod ics;
pub mod settings;
pub mod store;
pub mod zones;

pub use settings::{FetchPlan, FetchState, NewsSettings, NewsStatus, SourceKind};
pub use store::{Calendar, CalendarView, EventQuery, EventView, ImportSummary};

use crate::error::CoreError;
use serde::{Deserialize, Serialize};

/// Largest file or response read (2 MiB).
pub const MAX_BYTES: usize = 2 * 1024 * 1024;
/// Most events kept from one file or one fetch.
pub const MAX_EVENTS: usize = 5_000;
const MAX_TITLE_CHARS: usize = 200;
const MAX_VALUE_CHARS: usize = 40;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Importance {
    Low,
    Medium,
    High,
}

impl Importance {
    pub fn as_str(self) -> &'static str {
        match self {
            Importance::Low => "low",
            Importance::Medium => "medium",
            Importance::High => "high",
        }
    }

    pub fn parse(s: &str) -> Option<Importance> {
        match s {
            "low" => Some(Importance::Low),
            "medium" => Some(Importance::Medium),
            "high" => Some(Importance::High),
            _ => None,
        }
    }
}

/// An event as read from a source, before storage.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewEvent {
    /// Identity of the event in its source (ICS `UID`, or day + time + currency + title).
    pub uid: String,
    /// UTC instant in ms; `None` = no time given (the whole day).
    pub starts_at: Option<i64>,
    /// Paris day "YYYY-MM-DD" of a timed event, or the day given for an event without time.
    pub day: String,
    /// Three-letter currency code, "" when not given.
    pub currency: String,
    pub title: String,
    pub importance: Importance,
    /// As written by the source, unit included ("3.2%"): text, never added up.
    pub forecast: Option<String>,
    pub previous: Option<String>,
    pub actual: Option<String>,
}

/// What a file or a feed does not say itself, chosen by the trader.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Defaults {
    /// Importance of an event without one (ICS without `PRIORITY`, CSV cell left empty).
    pub importance: Importance,
    /// Currency of an event without one; `None` = not given (the event concerns every instrument).
    #[serde(default)]
    pub currency: Option<String>,
}

/// Why a line or an event of a file was left out.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SkipReason {
    /// No date (ICS `DTSTART`, CSV `date`).
    MissingDate,
    InvalidDate,
    InvalidTime,
    /// A time zone this version does not know (ICS `TZID` other than Paris, New York, UTC).
    UnsupportedTimeZone,
    /// An ICS time without zone ("floating"): its instant is unknown.
    FloatingTime,
    /// A local time the clock skipped (spring change).
    NonexistentTime,
    MissingTitle,
    InvalidImportance,
    InvalidCurrency,
    /// A CSV line with too few columns.
    MissingColumns,
    /// Beyond [`MAX_EVENTS`].
    TooManyEvents,
    /// An ICS event cut off before its `END:VEVENT` (truncated file).
    Incomplete,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Skipped {
    /// 1-based line number in the file (ICS: the `BEGIN:VEVENT` line).
    pub line: usize,
    pub reason: SkipReason,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Parsed {
    pub events: Vec<NewEvent>,
    /// The first skipped events (100 at most), with their line and reason.
    pub skipped: Vec<Skipped>,
    /// Every skipped event, listed or not.
    pub skipped_count: usize,
}

/// Translatable error of the calendar (`news:<code>`), carried as an invalid-input error.
pub fn error(code: &str) -> CoreError {
    CoreError::Invalid(format!("news:{code}"))
}

/// Main ISO 4217 currencies: a three-letter word is taken as a currency only if it is one of them.
pub const CURRENCIES: &[&str] = &[
    "USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD", "CNY", "CNH", "HKD", "SGD", "SEK", "NOK", "DKK", "PLN",
    "CZK", "HUF", "TRY", "ZAR", "MXN", "BRL", "INR", "KRW", "RUB", "ILS", "THB", "TWD", "IDR", "SAR", "AED",
];

pub fn known_currency(code: &str) -> Option<&'static str> {
    let up = code.trim().to_ascii_uppercase();
    CURRENCIES.iter().copied().find(|c| *c == up)
}

/// The two currencies of a forex symbol ("EURUSD", "EUR/USD"), when both are known currencies.
pub fn pair_currencies(symbol: &str) -> Option<[&'static str; 2]> {
    let letters: String = symbol.chars().filter(|c| !matches!(c, '/' | '.' | '-' | '_' | ' ')).collect();
    if letters.len() != 6 || !letters.is_ascii() {
        return None;
    }
    Some([known_currency(&letters[..3])?, known_currency(&letters[3..])?])
}

/// Printable text on one line, at most `max` characters.
pub(crate) fn clean_text(s: &str, max: usize) -> String {
    let one_line: String = s.chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    let squeezed = one_line.split_whitespace().collect::<Vec<_>>().join(" ");
    squeezed.chars().take(max).collect()
}

pub(crate) fn clean_value(s: Option<&str>) -> Option<String> {
    s.map(|v| clean_text(v, MAX_VALUE_CHARS)).filter(|v| !v.is_empty())
}

pub(crate) fn clean_title(s: &str) -> Option<String> {
    Some(clean_text(s, MAX_TITLE_CHARS)).filter(|t| !t.is_empty())
}

/// Key used when the source gives no identity: the same event read twice keeps the same key.
pub(crate) fn derived_uid(day: &str, starts_at: Option<i64>, currency: &str, title: &str) -> String {
    let time = starts_at.map_or_else(|| "-".to_string(), |t| t.to_string());
    format!("{day}|{time}|{currency}|{}", title.to_lowercase())
}

#[cfg(test)]
mod tests;
