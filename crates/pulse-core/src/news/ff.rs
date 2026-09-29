//! Forex Factory weekly export (lot 28, see CLAUDE.md, "Calendrier économique : source Forex
//! Factory (lot 28)"). The trader chose this free, **unofficial** source knowing it has no written
//! licence and may change or disappear. Pure reader, no network here (`pulse-news` fetches).
//!
//! **Not checked on a real answer** (the development network blocks the site): the format comes
//! from documentation excerpts and third parties. The reader is therefore tolerant and precise:
//! - a JSON array of objects with `title`, `country` (in fact the **currency**, `All` = every
//!   currency), `date` (ISO 8601 **with its offset**), `impact` (`High` / `Medium` / `Low` /
//!   `Holiday` / `Non-Economic`), `forecast`, `previous` (text, possibly empty); other keys ignored;
//! - an iCalendar answer (the site also publishes `.ics`) is read by the ICS reader;
//! - the HTML "Request Denied" page (download limit exceeded) is `news:requestDenied`, any other
//!   HTML `news:unexpectedResponse`, broken JSON `news:invalidJson`, JSON of another shape
//!   `news:unexpectedJson`, nothing `news:empty`;
//! - an event without time (a holiday, "All Day", "Tentative", or a time of exactly 00:00:00 in
//!   its own offset, which is how an event without time is assumed to be written) is kept on its
//!   day, without time;
//! - a bad event is skipped with its position (1-based) and reason, never a panic, never guessed
//!   (a date without offset is refused).

use super::zones;
use super::{Defaults, Importance, MAX_BYTES, MAX_EVENTS, NewEvent, Parsed, SkipReason, clean_title, clean_value, derived_uid, error, ics, known_currency};
use crate::error::Result;
use crate::stats::time::days_from_civil;
use serde_json::Value;
use std::collections::HashSet;

/// The only host contacted for this source.
pub const HOST: &str = "nfs.faireconomy.media";
/// Current week (Sunday to Saturday, New York time, according to third parties).
pub const THIS_WEEK_URL: &str = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";
/// Next week, when published (a missing file is not an error).
pub const NEXT_WEEK_URL: &str = "https://nfs.faireconomy.media/ff_calendar_nextweek.json";

const DAY_MS: i64 = 86_400_000;
const MIN_MS: i64 = 60_000;

/// A date of the feed: local calendar day, local time (minutes, seconds) and its UTC offset.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Stamp {
    day: i64,
    minute: u32,
    second: u32,
    /// `None`: a date without time ("2026-10-05").
    offset_min: Option<i32>,
    has_time: bool,
}

fn num(s: &str) -> Option<u32> {
    (!s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())).then(|| s.parse().ok()).flatten()
}

/// `YYYY-MM-DD`, or `YYYY-MM-DDTHH:MM[:SS[.fff]]` followed by `Z`, `±HH:MM`, `±HHMM` or `±HH`.
/// A time without offset is `FloatingTime` (never guessed).
pub(crate) fn stamp(s: &str) -> std::result::Result<Stamp, SkipReason> {
    let s = s.trim();
    if s.is_empty() {
        return Err(SkipReason::MissingDate);
    }
    if !s.is_ascii() || s.len() < 10 {
        return Err(SkipReason::InvalidDate);
    }
    let (date, rest) = s.split_at(10);
    let b = date.as_bytes();
    if b[4] != b'-' || b[7] != b'-' {
        return Err(SkipReason::InvalidDate);
    }
    let day = match (num(&date[..4]), num(&date[5..7]), num(&date[8..10])) {
        (Some(y), Some(m), Some(d)) => days_from_civil(i64::from(y), m, d).ok_or(SkipReason::InvalidDate)?,
        _ => return Err(SkipReason::InvalidDate),
    };
    if rest.is_empty() {
        return Ok(Stamp { day, minute: 0, second: 0, offset_min: None, has_time: false });
    }
    let rest = rest.strip_prefix(['T', 't', ' ']).ok_or(SkipReason::InvalidDate)?;
    // Split the clock from the offset: the offset starts at `Z`, `+` or `-`.
    let cut = rest.find(['Z', 'z', '+', '-']).unwrap_or(rest.len());
    let (clock, zone) = rest.split_at(cut);
    let clock = clock.split_once('.').map_or(clock, |(c, frac)| if num(frac).is_some() { c } else { "!" });
    let parts: Vec<&str> = clock.split(':').collect();
    let (h, m, sec) = match parts.as_slice() {
        [h, m] => (num(h), num(m), Some(0)),
        [h, m, s] => (num(h), num(m), num(s)),
        _ => return Err(SkipReason::InvalidTime),
    };
    let (h, m, sec) = match (h, m, sec) {
        (Some(h), Some(m), Some(s)) if h < 24 && m < 60 && s < 60 => (h, m, s),
        _ => return Err(SkipReason::InvalidTime),
    };
    let offset_min = match zone {
        "" => return Err(SkipReason::FloatingTime),
        "Z" | "z" => 0,
        _ => {
            let sign = if zone.starts_with('-') { -1 } else { 1 };
            let digits = zone[1..].replace(':', "");
            let (oh, om) = match digits.len() {
                2 => (num(&digits), Some(0)),
                4 => (num(&digits[..2]), num(&digits[2..])),
                _ => (None, None),
            };
            match (oh, om) {
                (Some(oh), Some(om)) if oh <= 18 && om < 60 => sign * (oh as i32 * 60 + om as i32),
                _ => return Err(SkipReason::InvalidDate),
            }
        }
    };
    Ok(Stamp { day, minute: h * 60 + m, second: sec, offset_min: Some(offset_min), has_time: true })
}

impl Stamp {
    fn instant(&self) -> Option<i64> {
        let off = self.offset_min?;
        Some(self.day * DAY_MS + i64::from(self.minute) * MIN_MS + i64::from(self.second) * 1000 - i64::from(off) * MIN_MS)
    }

    /// Midnight exactly in its own offset: assumed to be an event without time (CLAUDE.md, lot 28).
    fn is_midnight(&self) -> bool {
        self.minute == 0 && self.second == 0
    }
}

fn text<'a>(o: &'a serde_json::Map<String, Value>, key: &str) -> Option<&'a str> {
    o.get(key).and_then(Value::as_str)
}

/// A value field: text as given, or a number written as the source wrote it; `""` → none.
fn value(o: &serde_json::Map<String, Value>, key: &str) -> Option<String> {
    match o.get(key)? {
        Value::String(s) => clean_value(Some(s)),
        Value::Number(n) => clean_value(Some(&n.to_string())),
        _ => None,
    }
}

/// `impact` → importance and whether the event is a holiday (always without time).
fn impact(s: &str) -> Option<(Importance, bool)> {
    match s.trim().to_ascii_lowercase().replace([' ', '_'], "-").as_str() {
        "high" => Some((Importance::High, false)),
        "medium" => Some((Importance::Medium, false)),
        "low" => Some((Importance::Low, false)),
        "holiday" => Some((Importance::Low, true)),
        "non-economic" | "noneconomic" | "none" => Some((Importance::Low, false)),
        _ => None,
    }
}

/// A `time` key, when present, saying there is no time ("All Day", "Tentative", "Day 1"…).
fn time_says_no_time(o: &serde_json::Map<String, Value>) -> bool {
    text(o, "time").is_some_and(|t| !t.trim().is_empty() && !t.contains(':'))
}

fn event(v: &Value) -> std::result::Result<NewEvent, SkipReason> {
    let o = v.as_object().ok_or(SkipReason::InvalidEntry)?;
    let title = text(o, "title").and_then(clean_title).ok_or(SkipReason::MissingTitle)?;
    let currency = match o.get("country") {
        None | Some(Value::Null) => return Err(SkipReason::MissingCurrency),
        Some(Value::String(c)) if c.trim().is_empty() || c.trim().eq_ignore_ascii_case("all") => String::new(),
        Some(Value::String(c)) => known_currency(c).ok_or(SkipReason::InvalidCurrency)?.to_string(),
        Some(_) => return Err(SkipReason::InvalidCurrency),
    };
    let (importance, holiday) = match o.get("impact") {
        None | Some(Value::Null) => return Err(SkipReason::MissingImportance),
        Some(Value::String(s)) if s.trim().is_empty() => return Err(SkipReason::MissingImportance),
        Some(Value::String(s)) => impact(s).ok_or(SkipReason::InvalidImportance)?,
        Some(_) => return Err(SkipReason::InvalidImportance),
    };
    let st = match o.get("date") {
        None | Some(Value::Null) => return Err(SkipReason::MissingDate),
        Some(Value::String(s)) => stamp(s)?,
        Some(_) => return Err(SkipReason::InvalidDate),
    };
    let timed = st.has_time && !holiday && !time_says_no_time(o) && !st.is_midnight();
    let (starts_at, day) = match st.instant() {
        Some(at) if timed => (Some(at), zones::paris_day(at)),
        _ => (None, zones::day_key_of(st.day)),
    };
    let uid = derived_uid(&day, starts_at, &currency, &title);
    Ok(NewEvent {
        uid,
        starts_at,
        day,
        currency,
        title,
        importance,
        forecast: value(o, "forecast"),
        previous: value(o, "previous"),
        actual: value(o, "actual"),
    })
}

/// Reads one weekly file. Whole-answer errors: `news:fileTooLarge`, `news:empty`,
/// `news:requestDenied`, `news:unexpectedResponse`, `news:invalidJson`, `news:unexpectedJson`
/// (also when not a single event of a non-empty list is readable: the format has changed, and the
/// stored events must stay). `[]` is an empty week, not an error.
pub fn parse(bytes: &[u8]) -> Result<Parsed> {
    if bytes.len() > MAX_BYTES {
        return Err(error("fileTooLarge"));
    }
    let text = String::from_utf8_lossy(bytes);
    let body = text.trim_start_matches('\u{feff}').trim();
    if body.is_empty() {
        return Err(error("empty"));
    }
    if body.starts_with('<') {
        let lower = body.to_ascii_lowercase();
        let denied = lower.contains("request denied") || lower.contains("exceeded the limit");
        return Err(error(if denied { "requestDenied" } else { "unexpectedResponse" }));
    }
    if body.as_bytes().get(..15).is_some_and(|b| b.eq_ignore_ascii_case(b"BEGIN:VCALENDAR")) {
        return ics::parse(bytes, &Defaults { importance: Importance::Medium, currency: None });
    }
    if !body.starts_with(['[', '{']) {
        return Err(error("unexpectedResponse"));
    }
    let json: Value = serde_json::from_str(body).map_err(|_| error("invalidJson"))?;
    let Value::Array(items) = json else { return Err(error("unexpectedJson")) };
    let mut out = Parsed::default();
    let mut seen = HashSet::new();
    for (i, item) in items.iter().enumerate() {
        let result = if out.events.len() >= MAX_EVENTS { Err(SkipReason::TooManyEvents) } else { event(item) };
        match result {
            Ok(e) if !seen.insert(e.uid.clone()) => out.skip(i + 1, SkipReason::Duplicate),
            Ok(e) => out.events.push(e),
            Err(reason) => out.skip(i + 1, reason),
        }
    }
    if !items.is_empty() && out.events.is_empty() {
        return Err(error("unexpectedJson"));
    }
    Ok(out)
}

/// The current week then the next one: an event present in both is kept once (the first copy).
pub fn merge(first: Parsed, second: Parsed) -> Parsed {
    let mut out = first;
    let mut seen: HashSet<String> = out.events.iter().map(|e| e.uid.clone()).collect();
    for e in second.events {
        if out.events.len() >= MAX_EVENTS {
            out.skipped_count += 1;
        } else if seen.insert(e.uid.clone()) {
            out.events.push(e);
        }
    }
    out.skipped_count += second.skipped_count;
    let room = ics::MAX_LISTED_SKIPS.saturating_sub(out.skipped.len());
    out.skipped.extend(second.skipped.into_iter().take(room));
    out
}

#[cfg(test)]
mod tests;
