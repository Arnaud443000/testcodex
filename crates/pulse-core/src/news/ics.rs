//! Reading an iCalendar file (RFC 5545, the subset an economic calendar uses). Pure: a
//! malformed line or event is skipped with its reason, never a panic; nothing is guessed
//! (an unknown time zone or a time without zone is refused). Rules in CLAUDE.md, lot 25.

use super::zones::{self, Zone};
use super::{Defaults, Importance, MAX_BYTES, MAX_EVENTS, NewEvent, Parsed, SkipReason, Skipped, clean_title, derived_uid, error, known_currency};
use crate::error::Result;
use crate::stats::time::days_from_civil;

/// Skipped events listed one by one (the count goes on beyond).
pub(crate) const MAX_LISTED_SKIPS: usize = 100;

struct Line {
    number: usize,
    name: String,
    params: Vec<(String, String)>,
    value: String,
}

impl Line {
    fn param(&self, key: &str) -> Option<&str> {
        self.params.iter().find(|(k, _)| k == key).map(|(_, v)| v.as_str())
    }
}

/// Unfolds the content lines: a line starting with a space or a tab continues the previous one.
fn unfold(text: &str) -> Vec<(usize, String)> {
    let mut lines: Vec<(usize, String)> = Vec::new();
    for (i, raw) in text.split('\n').enumerate() {
        let raw = raw.strip_suffix('\r').unwrap_or(raw);
        let continued = raw.starts_with(' ') || raw.starts_with('\t');
        match lines.last_mut() {
            Some(last) if continued => last.1.push_str(&raw[1..]),
            _ => lines.push((i + 1, raw.to_string())),
        }
    }
    lines
}

/// `NAME;P1=a;P2="b:c":value` → name, parameters, value (a colon inside quotes is not the separator).
fn split_line(number: usize, raw: &str) -> Option<Line> {
    let mut quoted = false;
    let mut colon = None;
    for (i, c) in raw.char_indices() {
        match c {
            '"' => quoted = !quoted,
            ':' if !quoted => {
                colon = Some(i);
                break;
            }
            _ => {}
        }
    }
    let colon = colon?;
    let (head, value) = (&raw[..colon], &raw[colon + 1..]);
    let mut parts = Vec::new();
    let (mut start, mut quoted) = (0, false);
    for (i, c) in head.char_indices() {
        match c {
            '"' => quoted = !quoted,
            ';' if !quoted => {
                parts.push(&head[start..i]);
                start = i + 1;
            }
            _ => {}
        }
    }
    parts.push(&head[start..]);
    let name = parts.first()?.trim().to_ascii_uppercase();
    if name.is_empty() {
        return None;
    }
    let params = parts[1..]
        .iter()
        .filter_map(|p| p.split_once('='))
        .map(|(k, v)| (k.trim().to_ascii_uppercase(), v.trim().trim_matches('"').to_string()))
        .collect();
    Some(Line { number, name, params, value: value.to_string() })
}

/// TEXT value: `\\`, `\;`, `\,` and `\n` escapes.
fn unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('n' | 'N') => out.push(' '),
            Some(e @ (',' | ';' | '\\')) => out.push(e),
            Some(other) => {
                out.push('\\');
                out.push(other);
            }
            None => out.push('\\'),
        }
    }
    out
}

fn digits(s: &str) -> Option<u32> {
    (!s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())).then(|| s.parse().ok()).flatten()
}

/// `YYYYMMDD` → days since 1970-01-01.
fn date(s: &str) -> Option<i64> {
    if s.len() != 8 || !s.is_ascii() {
        return None;
    }
    days_from_civil(i64::from(digits(&s[..4])?), digits(&s[4..6])?, digits(&s[6..8])?)
}

/// `DTSTART` → (instant or none, Paris day or the given day).
fn start(line: &Line) -> std::result::Result<(Option<i64>, String), SkipReason> {
    let value = line.value.trim();
    if value.is_empty() {
        return Err(SkipReason::MissingDate);
    }
    if line.param("VALUE").is_some_and(|v| v.eq_ignore_ascii_case("DATE")) || value.len() == 8 {
        let day = date(value).ok_or(SkipReason::InvalidDate)?;
        return Ok((None, zones::day_key_of(day)));
    }
    let (body, utc) = match value.strip_suffix('Z').or_else(|| value.strip_suffix('z')) {
        Some(b) => (b, true),
        None => (value, false),
    };
    let (d, t) = body.split_once(['T', 't']).ok_or(SkipReason::InvalidDate)?;
    let day = date(d).ok_or(SkipReason::InvalidDate)?;
    if t.len() != 6 || !t.is_ascii() {
        return Err(SkipReason::InvalidTime);
    }
    let (h, m, s) = (digits(&t[..2]), digits(&t[2..4]), digits(&t[4..6]));
    let (h, m, s) = match (h, m, s) {
        (Some(h), Some(m), Some(s)) if h < 24 && m < 60 && s < 60 => (h, m, s),
        _ => return Err(SkipReason::InvalidTime),
    };
    let zone = if utc {
        Zone::Utc
    } else {
        match line.param("TZID") {
            Some(tzid) => Zone::from_tzid(tzid).ok_or(SkipReason::UnsupportedTimeZone)?,
            None => return Err(SkipReason::FloatingTime),
        }
    };
    let at = zones::to_utc_first(zone, day, h * 60 + m).ok_or(SkipReason::NonexistentTime)? + i64::from(s) * 1000;
    Ok((Some(at), zones::paris_day(at)))
}

/// `PRIORITY` 1–4 high, 5 medium, 6–9 low (RFC 5545 §3.8.1.9); 0, absent or unreadable → `None`.
fn priority(value: &str) -> Option<Importance> {
    match value.trim().parse::<u8>().ok()? {
        1..=4 => Some(Importance::High),
        5 => Some(Importance::Medium),
        6..=9 => Some(Importance::Low),
        _ => None,
    }
}

fn event(lines: &[Line], defaults: &Defaults) -> std::result::Result<NewEvent, SkipReason> {
    let get = |name: &str| lines.iter().find(|l| l.name == name);
    let (starts_at, day) = start(get("DTSTART").ok_or(SkipReason::MissingDate)?)?;
    let title = get("SUMMARY").and_then(|l| clean_title(&unescape(&l.value))).ok_or(SkipReason::MissingTitle)?;
    let importance = get("PRIORITY").and_then(|l| priority(&l.value)).unwrap_or(defaults.importance);
    let from_categories = lines
        .iter()
        .filter(|l| l.name == "CATEGORIES")
        .flat_map(|l| l.value.split(',').map(|c| unescape(c.trim())).collect::<Vec<_>>())
        .find_map(|c| known_currency(&c));
    let currency = from_categories.map(str::to_string).or_else(|| defaults.currency.clone()).unwrap_or_default();
    let uid = get("UID")
        .and_then(|l| clean_title(&unescape(&l.value)))
        .unwrap_or_else(|| derived_uid(&day, starts_at, &currency, &title));
    Ok(NewEvent { uid, starts_at, day, currency, title, importance, forecast: None, previous: None, actual: None })
}

/// Reads an ICS file. Errors (`news:fileTooLarge`, `news:notIcs`) concern the whole file; a bad event is skipped.
pub fn parse(bytes: &[u8], defaults: &Defaults) -> Result<Parsed> {
    if bytes.len() > MAX_BYTES {
        return Err(error("fileTooLarge"));
    }
    let text = String::from_utf8_lossy(bytes);
    let text = text.trim_start_matches('\u{feff}');
    let lines = unfold(text);
    let first = lines.iter().find(|(_, l)| !l.trim().is_empty());
    if !first.is_some_and(|(_, l)| l.trim().eq_ignore_ascii_case("BEGIN:VCALENDAR")) {
        return Err(error("notIcs"));
    }
    let mut out = Parsed::default();
    // (line of BEGIN:VEVENT, its properties, depth of nested components such as VALARM).
    let mut current: Option<(usize, Vec<Line>, usize)> = None;
    for (number, raw) in &lines {
        let Some(line) = split_line(*number, raw) else { continue };
        let value = line.value.trim().to_ascii_uppercase();
        if let Some((begin, props, depth)) = current.as_mut() {
            match line.name.as_str() {
                "BEGIN" => *depth += 1,
                "END" if *depth > 0 => *depth -= 1,
                "END" if value == "VEVENT" => {
                    let (begin, props) = (*begin, std::mem::take(props));
                    current = None;
                    let result = if out.events.len() >= MAX_EVENTS { Err(SkipReason::TooManyEvents) } else { event(&props, defaults) };
                    match result {
                        Ok(e) => out.events.push(e),
                        Err(reason) => out.skip(begin, reason),
                    }
                }
                _ if *depth == 0 => props.push(line),
                _ => {}
            }
        } else if line.name == "BEGIN" && value == "VEVENT" {
            current = Some((line.number, Vec::new(), 0));
        }
    }
    if let Some((begin, _, _)) = current {
        out.skip(begin, SkipReason::Incomplete);
    }
    Ok(out)
}

impl Parsed {
    pub(crate) fn skip(&mut self, line: usize, reason: SkipReason) {
        self.skipped_count += 1;
        if self.skipped.len() < MAX_LISTED_SKIPS {
            self.skipped.push(Skipped { line, reason });
        }
    }
}
