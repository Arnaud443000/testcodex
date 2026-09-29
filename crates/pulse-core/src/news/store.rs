//! Stored events (`economic_events`, migration v14): upsert keeping a released value, purge,
//! and the lists the interface shows (Paris day and time already computed).

use super::zones;
use super::{Importance, NewEvent, Parsed, Skipped, error};
use crate::alerts::news::NewsEvent;
use crate::error::Result;
use crate::stats::time::parse_day;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

/// Events older than this many days (Paris) are deleted: the alert needs past news to classify past trades.
pub const RETENTION_DAYS: i64 = 730;
/// A fetched feed keeps the events from today − 7 to today + 60 (Paris days).
pub const FETCH_DAYS_BEFORE: i64 = 7;
pub const FETCH_DAYS_AFTER: i64 = 60;
/// Longest range a list may cover.
pub const MAX_LIST_DAYS: i64 = 370;
pub const MAX_UPCOMING: u32 = 50;

pub const SOURCE_FILE: &str = "file";
pub const SOURCE_ICS_URL: &str = "icsUrl";

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSummary {
    pub added: usize,
    pub updated: usize,
    /// Read correctly but outside the kept window (a fetched feed only).
    pub outside_window: usize,
    pub skipped: Vec<Skipped>,
    pub skipped_count: usize,
    /// Old events deleted by the purge that followed.
    pub purged: usize,
}

/// One event as the interface shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventView {
    pub id: i64,
    pub source: String,
    /// UTC instant (ms); `None` = no time given.
    pub starts_at: Option<i64>,
    /// Paris day "YYYY-MM-DD".
    pub day: String,
    /// Paris clock time "HH:MM"; `None` = no time given.
    pub paris_time: Option<String>,
    /// ISO weekday of `day`: 1 = Monday … 7 = Sunday.
    pub weekday: u8,
    /// "" when not given.
    pub currency: String,
    pub title: String,
    pub importance: Importance,
    pub forecast: Option<String>,
    pub previous: Option<String>,
    pub actual: Option<String>,
    pub updated_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventQuery {
    /// First and last Paris day, "YYYY-MM-DD", both included.
    pub from_day: String,
    pub to_day: String,
    /// Empty = every importance.
    #[serde(default)]
    pub importances: Vec<Importance>,
    /// Empty = every currency ("" selects events without currency).
    #[serde(default)]
    pub currencies: Vec<String>,
}

/// Inserts or updates events of one source. Same (source, uid): everything is replaced except
/// that a forecast, previous or actual value missing from the new copy keeps the stored one
/// (a released value is never erased). Returns (added, updated).
pub(crate) fn save(conn: &Connection, source: &str, events: &[NewEvent], now: i64) -> Result<(usize, usize)> {
    let tx = conn.unchecked_transaction()?;
    let (mut added, mut updated) = (0, 0);
    for e in events {
        let exists: Option<i64> =
            tx.query_row("SELECT id FROM economic_events WHERE source = ?1 AND uid = ?2", params![source, e.uid], |r| r.get(0)).optional()?;
        tx.execute(
            "INSERT INTO economic_events (source, uid, starts_at, day, currency, title, importance, forecast, previous, actual, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
             ON CONFLICT (source, uid) DO UPDATE SET
                starts_at = excluded.starts_at, day = excluded.day, currency = excluded.currency, title = excluded.title,
                importance = excluded.importance,
                forecast = COALESCE(excluded.forecast, forecast),
                previous = COALESCE(excluded.previous, previous),
                actual = COALESCE(excluded.actual, actual),
                updated_at = excluded.updated_at",
            params![source, e.uid, e.starts_at, e.day, e.currency, e.title, e.importance.as_str(), e.forecast, e.previous, e.actual, now],
        )?;
        if exists.is_some() { updated += 1 } else { added += 1 }
    }
    tx.commit()?;
    Ok((added, updated))
}

/// Deletes the events whose Paris day is more than [`RETENTION_DAYS`] before today.
pub fn purge(conn: &Connection, now: i64) -> Result<usize> {
    let limit = zones::day_key_of(zones::paris_day_number(now) - RETENTION_DAYS);
    Ok(conn.execute("DELETE FROM economic_events WHERE day < ?1", [limit])?)
}

/// Deletes every stored event (all sources).
pub fn clear(conn: &Connection) -> Result<usize> {
    Ok(conn.execute("DELETE FROM economic_events", [])?)
}

pub(crate) fn clear_source(conn: &Connection, source: &str) -> Result<usize> {
    Ok(conn.execute("DELETE FROM economic_events WHERE source = ?1", [source])?)
}

/// Stores a parsed file or feed, then purges. `window`: keep only the events of these Paris days.
pub(crate) fn store(conn: &Connection, source: &str, parsed: Parsed, now: i64, window: Option<(i64, i64)>) -> Result<ImportSummary> {
    let total = parsed.events.len();
    let kept: Vec<NewEvent> = match window {
        Some((from, to)) => parsed.events.into_iter().filter(|e| parse_day(&e.day).is_some_and(|d| (from..=to).contains(&d))).collect(),
        None => parsed.events,
    };
    let outside_window = total - kept.len();
    let (added, updated) = save(conn, source, &kept, now)?;
    let purged = purge(conn, now)?;
    Ok(ImportSummary { added, updated, outside_window, skipped: parsed.skipped, skipped_count: parsed.skipped_count, purged })
}

const COLUMNS: &str = "id, source, starts_at, day, currency, title, importance, forecast, previous, actual, updated_at";

fn view(r: &rusqlite::Row) -> rusqlite::Result<EventView> {
    let starts_at: Option<i64> = r.get(2)?;
    let day: String = r.get(3)?;
    let importance: String = r.get(6)?;
    Ok(EventView {
        id: r.get(0)?,
        source: r.get(1)?,
        starts_at,
        weekday: parse_day(&day).map_or(0, |d| ((d + 3).rem_euclid(7) + 1) as u8),
        day,
        paris_time: starts_at.map(zones::paris_hhmm),
        currency: r.get(4)?,
        title: r.get(5)?,
        // The CHECK constraint only lets these three values in.
        importance: Importance::parse(&importance).unwrap_or(Importance::Low),
        forecast: r.get(7)?,
        previous: r.get(8)?,
        actual: r.get(9)?,
        updated_at: r.get(10)?,
    })
}

fn matches(e: &EventView, q: &EventQuery) -> bool {
    (q.importances.is_empty() || q.importances.contains(&e.importance))
        && (q.currencies.is_empty() || q.currencies.iter().any(|c| c.trim().eq_ignore_ascii_case(&e.currency)))
}

/// Events of the given Paris days, in day order: events without time first, then by time, then title.
pub fn list(conn: &Connection, q: &EventQuery) -> Result<Vec<EventView>> {
    let (from, to) = match (parse_day(&q.from_day), parse_day(&q.to_day)) {
        (Some(f), Some(t)) if f <= t && t - f < MAX_LIST_DAYS => (f, t),
        _ => return Err(error("invalidRange")),
    };
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM economic_events WHERE day BETWEEN ?1 AND ?2
         ORDER BY day, starts_at IS NOT NULL, starts_at, title, id"
    ))?;
    let rows = stmt.query_map(params![zones::day_key_of(from), zones::day_key_of(to)], view)?;
    let mut out = Vec::new();
    for row in rows {
        let e = row?;
        if matches(&e, q) {
            out.push(e);
        }
    }
    Ok(out)
}

/// The next events from `now`: timed events not started yet, and events without time of today or later.
pub fn upcoming(conn: &Connection, now: i64, limit: u32, importances: &[Importance]) -> Result<Vec<EventView>> {
    let today = zones::paris_day(now);
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM economic_events
         WHERE (starts_at IS NOT NULL AND starts_at >= ?1) OR (starts_at IS NULL AND day >= ?2)
         ORDER BY day, starts_at IS NOT NULL, starts_at, title, id"
    ))?;
    let q = EventQuery { from_day: today.clone(), to_day: today, importances: importances.to_vec(), currencies: Vec::new() };
    let mut out = Vec::new();
    for row in stmt.query_map(params![now, q.from_day], view)? {
        let e = row?;
        if matches(&e, &q) {
            out.push(e);
            if out.len() >= limit.min(MAX_UPCOMING) as usize {
                break;
            }
        }
    }
    Ok(out)
}

/// Currencies present in the stored events (for the filter), sorted; events without currency are not listed.
pub fn currencies(conn: &Connection) -> Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT DISTINCT currency FROM economic_events WHERE currency <> '' ORDER BY currency")?;
    let rows = stmt.query_map([], |r| r.get(0))?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

pub fn count(conn: &Connection) -> Result<usize> {
    Ok(conn.query_row("SELECT COUNT(*) FROM economic_events", [], |r| r.get::<_, i64>(0))? as usize)
}

/// High-importance events with a time in `[from, to]` (UTC ms), in time order (ties: title, id).
pub(crate) fn high_events_between(conn: &Connection, from: i64, to: i64) -> Result<Vec<NewsEvent>> {
    let mut stmt = conn.prepare(
        "SELECT id, starts_at, currency, title FROM economic_events
         WHERE importance = 'high' AND starts_at IS NOT NULL AND starts_at BETWEEN ?1 AND ?2
         ORDER BY starts_at, title, id",
    )?;
    let rows = stmt.query_map(params![from, to], |r| Ok(NewsEvent { id: r.get(0)?, starts_at: r.get(1)?, currency: r.get(2)?, title: r.get(3)? }))?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

/// Paris days kept from a fetched feed, around `now`.
pub(crate) fn fetch_window(now: i64) -> (i64, i64) {
    let today = zones::paris_day_number(now);
    (today - FETCH_DAYS_BEFORE, today + FETCH_DAYS_AFTER)
}

/// Monday and Sunday (Paris days) of the week containing `now`.
pub fn paris_week(now: i64) -> (String, String) {
    let today = zones::paris_day_number(now);
    let monday = today - (today + 3).rem_euclid(7);
    (zones::day_key_of(monday), zones::day_key_of(monday + 6))
}

/// Which days the calendar page shows.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CalendarView {
    /// Today (Paris).
    Today,
    /// Monday to Sunday of the Paris week containing today.
    Week,
}

/// The calendar page: its days (Paris), the events, the currencies to filter on.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Calendar {
    pub today: String,
    pub from_day: String,
    pub to_day: String,
    pub events: Vec<EventView>,
    /// Every currency stored (not only this range's), sorted.
    pub currencies: Vec<String>,
}

pub fn calendar(conn: &Connection, now: i64, view: CalendarView, importances: &[Importance], currencies_filter: &[String]) -> Result<Calendar> {
    let today = zones::paris_day(now);
    let (from_day, to_day) = match view {
        CalendarView::Today => (today.clone(), today.clone()),
        CalendarView::Week => paris_week(now),
    };
    let q = EventQuery { from_day: from_day.clone(), to_day: to_day.clone(), importances: importances.to_vec(), currencies: currencies_filter.to_vec() };
    Ok(Calendar { events: list(conn, &q)?, currencies: currencies(conn)?, today, from_day, to_day })
}
