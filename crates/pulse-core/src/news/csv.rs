//! Reading a calendar written in the Pulse CSV format (CLAUDE.md, lot 25): `;`-separated,
//! UTF-8, header `date;heure;devise;titre;importance;prevu;precedent;reel`, times in **Paris**
//! time. Pure: a bad line is skipped with its number and reason, never a panic.

use super::zones::{self, Zone};
use super::{Defaults, Importance, MAX_BYTES, MAX_EVENTS, NewEvent, Parsed, SkipReason, clean_title, clean_value, derived_uid, error};
use crate::error::Result;
use crate::stats::time::parse_day;

pub const HEADER: [&str; 8] = ["date", "heure", "devise", "titre", "importance", "prevu", "precedent", "reel"];

/// Lower case, without the accents a French header may carry.
fn fold(s: &str) -> String {
    s.trim()
        .to_lowercase()
        .chars()
        .map(|c| match c {
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'à' | 'â' => 'a',
            'î' | 'ï' => 'i',
            'ô' => 'o',
            'û' | 'ù' => 'u',
            other => other,
        })
        .collect()
}

/// Splits a line on `;`, with `"…"` quoting and `""` for a quote inside.
fn fields(line: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quoted = false;
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' if quoted && chars.peek() == Some(&'"') => {
                cur.push('"');
                chars.next();
            }
            '"' => quoted = !quoted,
            ';' if !quoted => out.push(std::mem::take(&mut cur)),
            other => cur.push(other),
        }
    }
    out.push(cur);
    out
}

/// "HH:MM" or "H:MM" → minute of the day.
fn minute(s: &str) -> Option<u32> {
    let (h, m) = s.split_once(':')?;
    if h.is_empty() || h.len() > 2 || m.len() != 2 || !h.bytes().chain(m.bytes()).all(|b| b.is_ascii_digit()) {
        return None;
    }
    let (h, m): (u32, u32) = (h.parse().ok()?, m.parse().ok()?);
    (h < 24 && m < 60).then_some(h * 60 + m)
}

fn importance(s: &str, default: Importance) -> Option<Importance> {
    match fold(s).as_str() {
        "" => Some(default),
        "faible" | "low" => Some(Importance::Low),
        "moyenne" | "moyen" | "medium" => Some(Importance::Medium),
        "forte" | "fort" | "elevee" | "high" => Some(Importance::High),
        _ => None,
    }
}

fn line_event(cells: &[String], defaults: &Defaults) -> std::result::Result<NewEvent, SkipReason> {
    if cells.len() < 5 {
        return Err(SkipReason::MissingColumns);
    }
    let cell = |i: usize| cells.get(i).map_or("", |c| c.trim());
    let day_text = cell(0);
    if day_text.is_empty() {
        return Err(SkipReason::MissingDate);
    }
    let day = parse_day(day_text).ok_or(SkipReason::InvalidDate)?;
    let starts_at = match cell(1) {
        "" => None,
        t => Some(zones::to_utc_first(Zone::Paris, day, minute(t).ok_or(SkipReason::InvalidTime)?).ok_or(SkipReason::NonexistentTime)?),
    };
    let currency = match cell(2) {
        "" => defaults.currency.clone().unwrap_or_default(),
        c if c.len() == 3 && c.bytes().all(|b| b.is_ascii_alphabetic()) => c.to_ascii_uppercase(),
        _ => return Err(SkipReason::InvalidCurrency),
    };
    let title = clean_title(cell(3)).ok_or(SkipReason::MissingTitle)?;
    let importance = importance(cell(4), defaults.importance).ok_or(SkipReason::InvalidImportance)?;
    let day = zones::day_key_of(day);
    let uid = derived_uid(&day, starts_at, &currency, &title);
    Ok(NewEvent {
        uid,
        starts_at,
        day,
        currency,
        title,
        importance,
        forecast: clean_value(cells.get(5).map(String::as_str)),
        previous: clean_value(cells.get(6).map(String::as_str)),
        actual: clean_value(cells.get(7).map(String::as_str)),
    })
}

/// Reads a Pulse CSV file. Errors (`news:fileTooLarge`, `news:csvHeader`) concern the whole file.
pub fn parse(bytes: &[u8], defaults: &Defaults) -> Result<Parsed> {
    if bytes.len() > MAX_BYTES {
        return Err(error("fileTooLarge"));
    }
    let text = String::from_utf8_lossy(bytes);
    let text = text.trim_start_matches('\u{feff}');
    let mut lines = text.split('\n').enumerate().map(|(i, l)| (i + 1, l.strip_suffix('\r').unwrap_or(l))).filter(|(_, l)| !l.trim().is_empty());
    let header_ok = lines.next().is_some_and(|(_, h)| {
        let names: Vec<String> = fields(h).iter().map(|f| fold(f)).collect();
        names.iter().map(String::as_str).eq(HEADER.iter().copied())
    });
    if !header_ok {
        return Err(error("csvHeader"));
    }
    let mut out = Parsed::default();
    for (number, line) in lines {
        let result = if out.events.len() >= MAX_EVENTS { Err(SkipReason::TooManyEvents) } else { line_event(&fields(line), defaults) };
        match result {
            Ok(e) => out.events.push(e),
            Err(reason) => out.skip(number, reason),
        }
    }
    Ok(out)
}
