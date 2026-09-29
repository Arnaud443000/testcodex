//! Daily reminder to fill in the journal (spec 3.2.8). The rules live here so
//! they can be tested; the shell only asks `check` every minute and shows the
//! native notification when it answers `Some`.
//!
//! The reminder fires once a local day when all of these hold: it is enabled,
//! the local time has reached the configured time, at least one trade was
//! entered today, and something is left to do (no journal entry for the day, or
//! trades of the day still incomplete after a Quick add). Settings live in the
//! key/value `settings` table.

use crate::error::{CoreError, Result};
use crate::journal;
use crate::stats::time;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

const KEY_ENABLED: &str = "reminder.enabled";
const KEY_TIME: &str = "reminder.time";
const KEY_LAST_SENT: &str = "reminder.last_sent_day";

pub const DEFAULT_TIME: &str = "20:00";
const DAY_MS: i64 = 86_400_000;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderSettings {
    pub enabled: bool,
    /// Local time of the reminder, "HH:MM".
    pub time: String,
}

impl Default for ReminderSettings {
    fn default() -> Self {
        ReminderSettings { enabled: true, time: DEFAULT_TIME.into() }
    }
}

fn setting(conn: &Connection, key: &str) -> Result<Option<String>> {
    Ok(conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0)).optional()?)
}

fn put(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2",
        params![key, value],
    )?;
    Ok(())
}

/// "HH:MM" → minutes since midnight; `None` for anything else ("24:00", "9:5", "20h").
pub fn parse_time(s: &str) -> Option<u32> {
    let (h, m) = s.split_once(':')?;
    if h.len() != 2 || m.len() != 2 {
        return None;
    }
    let (h, m): (u32, u32) = (h.parse().ok()?, m.parse().ok()?);
    (h < 24 && m < 60).then_some(h * 60 + m)
}

pub fn get_settings(conn: &Connection) -> Result<ReminderSettings> {
    let defaults = ReminderSettings::default();
    Ok(ReminderSettings {
        enabled: setting(conn, KEY_ENABLED)?.map_or(defaults.enabled, |v| v == "1"),
        time: setting(conn, KEY_TIME)?.filter(|t| parse_time(t).is_some()).unwrap_or(defaults.time),
    })
}

pub fn set_settings(conn: &Connection, s: &ReminderSettings) -> Result<ReminderSettings> {
    if parse_time(&s.time).is_none() {
        return Err(CoreError::Invalid(format!("reminder time must look like 20:00, got {:?}", s.time)));
    }
    put(conn, KEY_ENABLED, if s.enabled { "1" } else { "0" })?;
    put(conn, KEY_TIME, &s.time)?;
    get_settings(conn)
}

/// What is left to do today.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Due {
    /// Local day, "YYYY-MM-DD".
    pub day: String,
    /// Trades entered today.
    pub trade_count: usize,
    /// Of them, those still to complete (Quick add).
    pub incomplete_count: usize,
    pub journal_missing: bool,
}

fn minutes_of_day(now_ms: i64, tz_offset_min: i32) -> u32 {
    ((now_ms + i64::from(tz_offset_min) * 60_000).rem_euclid(DAY_MS) / 60_000) as u32
}

/// Today's leftovers, whatever the settings; `None` when there is no trade today or nothing is left.
fn pending_work(conn: &Connection, now_ms: i64, tz_offset_min: i32) -> Result<Option<Due>> {
    let day = time::day_key(now_ms, tz_offset_min);
    let overview = journal::day_overview(conn, &[], &day)?;
    if overview.trades.is_empty() {
        return Ok(None);
    }
    let journal_missing = overview.entry.is_none();
    if !journal_missing && overview.incomplete_count == 0 {
        return Ok(None);
    }
    Ok(Some(Due { day, trade_count: overview.trades.len(), incomplete_count: overview.incomplete_count, journal_missing }))
}

/// `Some` when the notification must be shown now. It does not remember anything:
/// call [`mark_sent`] once the notification has been shown.
pub fn check(conn: &Connection, now_ms: i64, tz_offset_min: i32) -> Result<Option<Due>> {
    let settings = get_settings(conn)?;
    if !settings.enabled || minutes_of_day(now_ms, tz_offset_min) < parse_time(&settings.time).unwrap_or(0) {
        return Ok(None);
    }
    let Some(due) = pending_work(conn, now_ms, tz_offset_min)? else { return Ok(None) };
    if setting(conn, KEY_LAST_SENT)?.as_deref() == Some(due.day.as_str()) {
        return Ok(None);
    }
    Ok(Some(due))
}

pub fn mark_sent(conn: &Connection, day: &str) -> Result<()> {
    put(conn, KEY_LAST_SENT, day)
}

/// For the in-app banner: the reminder was already sent today and there is still work.
/// Also true when the notification could not be shown by the system.
pub fn pending(conn: &Connection, now_ms: i64, tz_offset_min: i32) -> Result<Option<Due>> {
    let day = time::day_key(now_ms, tz_offset_min);
    if setting(conn, KEY_LAST_SENT)?.as_deref() != Some(day.as_str()) {
        return Ok(None);
    }
    pending_work(conn, now_ms, tz_offset_min)
}

/// Title and body of the native notification (French, like the interface).
pub fn message(due: &Due) -> (String, String) {
    let plural = |n: usize, one: &str, many: &str| format!("{n} {}", if n > 1 { many } else { one });
    let mut todo = Vec::new();
    if due.journal_missing {
        todo.push("écrire votre journal du jour".to_string());
    }
    if due.incomplete_count > 0 {
        todo.push(format!("compléter {}", plural(due.incomplete_count, "trade saisi en Quick add", "trades saisis en Quick add")));
    }
    ("Pulse — votre journal du jour".into(), format!("Il reste à {}.", todo.join(" et ")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::journal::JournalEntry;
    use crate::test_support::{account, dec, instrument};
    use crate::trades::{self, Direction, TradeData};

    /// 2026-09-29 00:00 UTC.
    const MIDNIGHT: i64 = 1_790_640_000_000;
    const HOUR: i64 = 3_600_000;

    fn quick_trade(conn: &Connection, entry: i64, tz: i32) {
        let a = crate::accounts::list(conn).unwrap().first().map(|a| a.id).unwrap_or_else(|| account(conn, "1000"));
        let i = instrument(conn, "EURUSD", "1");
        let mut d = TradeData::new(a, i, Direction::Long, dec("1"), dec("1.1"), entry);
        d.tz_offset_min = tz;
        trades::create(conn, &d).unwrap();
    }

    fn write_journal(conn: &Connection, day: &str) {
        journal::save(
            conn,
            &JournalEntry {
                day: day.into(),
                mood: Some(3),
                sleep_quality: None,
                fatigue: None,
                late_hours: false,
                went_well: String::new(),
                to_improve: String::new(),
                notes: String::new(),
            },
        )
        .unwrap();
    }

    #[test]
    fn parses_reminder_times() {
        assert_eq!(parse_time("20:00"), Some(1200));
        assert_eq!(parse_time("00:05"), Some(5));
        assert_eq!(parse_time("23:59"), Some(1439));
        for bad in ["24:00", "9:30", "20:60", "20h", "", "20:0", "ab:cd"] {
            assert_eq!(parse_time(bad), None, "{bad}");
        }
    }

    #[test]
    fn settings_default_to_on_at_20_00_and_can_be_changed() {
        let conn = db::open_in_memory().unwrap();
        assert_eq!(get_settings(&conn).unwrap(), ReminderSettings { enabled: true, time: "20:00".into() });
        let saved = set_settings(&conn, &ReminderSettings { enabled: false, time: "18:30".into() }).unwrap();
        assert_eq!(saved, ReminderSettings { enabled: false, time: "18:30".into() });
        assert_eq!(get_settings(&conn).unwrap(), saved);
        assert!(set_settings(&conn, &ReminderSettings { enabled: true, time: "25:00".into() }).is_err());
        assert_eq!(get_settings(&conn).unwrap(), saved, "a refused change keeps the previous settings");
    }

    #[test]
    fn fires_once_after_the_time_when_a_trade_exists_and_the_journal_is_missing() {
        let conn = db::open_in_memory().unwrap();
        quick_trade(&conn, MIDNIGHT + 9 * HOUR, 0);
        assert_eq!(check(&conn, MIDNIGHT + 19 * HOUR + 59 * 60_000, 0).unwrap(), None, "before 20:00");
        let due = check(&conn, MIDNIGHT + 20 * HOUR, 0).unwrap().unwrap();
        assert_eq!(due, Due { day: "2026-09-29".into(), trade_count: 1, incomplete_count: 1, journal_missing: true });
        assert!(pending(&conn, MIDNIGHT + 20 * HOUR, 0).unwrap().is_none(), "not sent yet");
        mark_sent(&conn, &due.day).unwrap();
        assert_eq!(check(&conn, MIDNIGHT + 21 * HOUR, 0).unwrap(), None, "only once a day");
        assert_eq!(pending(&conn, MIDNIGHT + 21 * HOUR, 0).unwrap(), Some(due), "the banner stays while work is left");
        // The next day it can fire again.
        quick_trade(&conn, MIDNIGHT + 24 * HOUR + 9 * HOUR, 0);
        assert!(check(&conn, MIDNIGHT + 24 * HOUR + 20 * HOUR, 0).unwrap().is_some());
        assert!(pending(&conn, MIDNIGHT + 24 * HOUR + 20 * HOUR, 0).unwrap().is_none());
    }

    #[test]
    fn stays_silent_without_trade_when_disabled_or_when_all_is_done() {
        let conn = db::open_in_memory().unwrap();
        let evening = MIDNIGHT + 21 * HOUR;
        assert_eq!(check(&conn, evening, 0).unwrap(), None, "no trade today");

        quick_trade(&conn, MIDNIGHT + 9 * HOUR, 0);
        set_settings(&conn, &ReminderSettings { enabled: false, time: "20:00".into() }).unwrap();
        assert_eq!(check(&conn, evening, 0).unwrap(), None, "disabled");
        set_settings(&conn, &ReminderSettings { enabled: true, time: "20:00".into() }).unwrap();

        // The journal is written but the Quick add trade is still incomplete: still due, journal not missing.
        write_journal(&conn, "2026-09-29");
        let due = check(&conn, evening, 0).unwrap().unwrap();
        assert_eq!((due.journal_missing, due.incomplete_count), (false, 1));
        assert_eq!(message(&due).1, "Il reste à compléter 1 trade saisi en Quick add.");

        // Complete the trade: nothing left.
        let id = trades::list(&conn, &Default::default()).unwrap()[0].id;
        let mut d = trades::get(&conn, id).unwrap().data;
        d.thesis = "Raison".into();
        let calm = crate::tags::find(&conn, crate::tags::TagKind::Emotion, "calme").unwrap().unwrap();
        d.emotions = vec![trades::EmotionEntry { moment: trades::EmotionMoment::Before, tag_id: calm.id }];
        trades::update(&conn, id, &d).unwrap();
        assert_eq!(check(&conn, evening, 0).unwrap(), None);
    }

    #[test]
    fn uses_the_local_day_and_time_of_the_trader() {
        let conn = db::open_in_memory().unwrap();
        // Trader at UTC+2. Trade entered 2026-09-29 10:00 local (08:00 UTC).
        quick_trade(&conn, MIDNIGHT + 8 * HOUR, 120);
        // 19:30 UTC = 21:30 local, still the 29th: due.
        let due = check(&conn, MIDNIGHT + 19 * HOUR + 30 * 60_000, 120).unwrap().unwrap();
        assert_eq!(due.day, "2026-09-29");
        // 17:30 UTC = 19:30 local: before 20:00 local.
        assert_eq!(check(&conn, MIDNIGHT + 17 * HOUR + 30 * 60_000, 120).unwrap(), None);
        // 22:30 UTC = 00:30 local on the 30th: a new local day without trade.
        assert_eq!(check(&conn, MIDNIGHT + 22 * HOUR + 30 * 60_000, 120).unwrap(), None);
    }

    #[test]
    fn the_notification_text_is_in_french_with_the_right_plurals() {
        let both = Due { day: "2026-09-29".into(), trade_count: 3, incomplete_count: 2, journal_missing: true };
        let (title, body) = message(&both);
        assert_eq!(title, "Pulse — votre journal du jour");
        assert_eq!(body, "Il reste à écrire votre journal du jour et compléter 2 trades saisis en Quick add.");
        let only_journal = Due { incomplete_count: 0, ..both };
        assert_eq!(message(&only_journal).1, "Il reste à écrire votre journal du jour.");
    }
}
