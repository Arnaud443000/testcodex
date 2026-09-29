//! Daily journal (spec 2.6, 3.2.6): one entry per local day, independent of
//! the individual trades, with two guided questions and the external factors
//! the trader declares (sleep, fatigue, late hours).

use crate::error::{CoreError, Result};
use crate::stats::pnl::Outcome;
use crate::stats::time;
use crate::trade_view;
use crate::trades::{Direction, TradeData, TradeFilter};
use crate::money::Decimal;
use crate::util::check_range;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JournalEntry {
    /// Local day, "YYYY-MM-DD".
    pub day: String,
    /// General mood of the day, 1 (bad) – 5 (great).
    #[serde(default)]
    pub mood: Option<u8>,
    /// Quality of last night's sleep, 1–5.
    #[serde(default)]
    pub sleep_quality: Option<u8>,
    /// Fatigue during the day, 1 (fresh) – 5 (exhausted).
    #[serde(default)]
    pub fatigue: Option<u8>,
    /// Traded late in the evening or at night.
    #[serde(default)]
    pub late_hours: bool,
    /// "What went well today".
    #[serde(default)]
    pub went_well: String,
    /// "What is worth improving".
    #[serde(default)]
    pub to_improve: String,
    #[serde(default)]
    pub notes: String,
}

impl JournalEntry {
    /// Nothing filled in: such an entry is never stored (it would count as "journal done").
    pub fn is_blank(&self) -> bool {
        self.mood.is_none()
            && self.sleep_quality.is_none()
            && self.fatigue.is_none()
            && !self.late_hours
            && self.went_well.trim().is_empty()
            && self.to_improve.trim().is_empty()
            && self.notes.trim().is_empty()
    }
}

/// Saves the entry of a day (creates or replaces it). A blank entry deletes the day's entry and returns `None`.
pub fn save(conn: &Connection, e: &JournalEntry) -> Result<Option<JournalEntry>> {
    time::parse_day(&e.day).ok_or_else(|| CoreError::Invalid(format!("invalid day {:?}", e.day)))?;
    for (field, v) in [("mood", e.mood), ("sleep quality", e.sleep_quality), ("fatigue", e.fatigue)] {
        check_range(field, v, 1, 5)?;
    }
    if e.is_blank() {
        conn.execute("DELETE FROM journal_entries WHERE day = ?1", [&e.day])?;
        return Ok(None);
    }
    conn.execute(
        "INSERT INTO journal_entries (day, mood, sleep_quality, fatigue, late_hours, went_well, to_improve, notes)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
         ON CONFLICT(day) DO UPDATE SET mood = ?2, sleep_quality = ?3, fatigue = ?4, late_hours = ?5,
             went_well = ?6, to_improve = ?7, notes = ?8, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')",
        params![e.day, e.mood, e.sleep_quality, e.fatigue, e.late_hours, e.went_well.trim(), e.to_improve.trim(), e.notes.trim()],
    )?;
    get(conn, &e.day)
}

pub fn get(conn: &Connection, day: &str) -> Result<Option<JournalEntry>> {
    Ok(conn.query_row(&format!("{SELECT} WHERE day = ?1"), [day], row).optional()?)
}

/// Entries whose day is in `[from, to]` (both optional, "YYYY-MM-DD"), most recent first.
pub fn list(conn: &Connection, from: Option<&str>, to: Option<&str>) -> Result<Vec<JournalEntry>> {
    let mut stmt = conn.prepare(&format!(
        "{SELECT} WHERE (?1 IS NULL OR day >= ?1) AND (?2 IS NULL OR day <= ?2) ORDER BY day DESC"
    ))?;
    let rows = stmt.query_map(params![from, to], row)?.collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn delete(conn: &Connection, day: &str) -> Result<()> {
    conn.execute("DELETE FROM journal_entries WHERE day = ?1", [day])?;
    Ok(())
}

const SELECT: &str = "SELECT day, mood, sleep_quality, fatigue, late_hours, went_well, to_improve, notes FROM journal_entries";

fn row(r: &rusqlite::Row) -> rusqlite::Result<JournalEntry> {
    Ok(JournalEntry {
        day: r.get(0)?,
        mood: r.get(1)?,
        sleep_quality: r.get(2)?,
        fatigue: r.get(3)?,
        late_hours: r.get(4)?,
        went_well: r.get(5)?,
        to_improve: r.get(6)?,
        notes: r.get(7)?,
    })
}

/// "À compléter" (spec 3.1.7): a trade entered in Quick add stays incomplete while
/// its thesis or its emotions are missing. The checklist is not part of the test:
/// without a template it cannot be filled.
pub fn is_incomplete(d: &TradeData) -> bool {
    d.thesis.trim().is_empty() || d.emotions.is_empty()
}

/// A trade entered on the day, as the journal page lists it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayTradeLine {
    pub trade_id: i64,
    pub symbol: String,
    pub direction: Direction,
    pub currency: String,
    pub entry_time: i64,
    /// `None` while the trade is open.
    pub net_pnl: Option<Decimal>,
    pub outcome: Option<Outcome>,
    pub incomplete: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayOverview {
    pub day: String,
    pub entry: Option<JournalEntry>,
    /// Trades entered that local day, oldest first.
    pub trades: Vec<DayTradeLine>,
    pub incomplete_count: usize,
}

/// The day's journal entry and the trades entered that day (local day of the entry instant).
pub fn day_overview(conn: &Connection, account_ids: &[i64], day: &str) -> Result<DayOverview> {
    time::parse_day(day).ok_or_else(|| CoreError::Invalid(format!("invalid day {day:?}")))?;
    let filter = TradeFilter { account_ids: account_ids.to_vec(), from: None, to: None, mistake: None };
    let mut trades: Vec<DayTradeLine> = trade_view::list(conn, &filter)?
        .into_iter()
        .filter(|v| time::day_key(v.trade.data.entry_time, v.trade.data.tz_offset_min) == day)
        .map(|v| DayTradeLine {
            trade_id: v.trade.id,
            symbol: v.symbol,
            direction: v.trade.data.direction,
            currency: v.currency,
            entry_time: v.trade.data.entry_time,
            net_pnl: v.figures.as_ref().map(|f| f.net_pnl),
            outcome: v.figures.as_ref().map(|f| f.outcome),
            incomplete: is_incomplete(&v.trade.data),
        })
        .collect();
    trades.sort_by_key(|t| (t.entry_time, t.trade_id));
    let incomplete_count = trades.iter().filter(|t| t.incomplete).count();
    Ok(DayOverview { day: day.to_string(), entry: get(conn, day)?, trades, incomplete_count })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::test_support::{account, dec, instrument};
    use crate::trades::{self, EmotionEntry, EmotionMoment};

    fn entry(day: &str) -> JournalEntry {
        JournalEntry {
            day: day.into(),
            mood: Some(4),
            sleep_quality: Some(2),
            fatigue: None,
            late_hours: true,
            went_well: " Patience ".into(),
            to_improve: String::new(),
            notes: String::new(),
        }
    }

    #[test]
    fn saves_replaces_lists_and_deletes_entries() {
        let conn = db::open_in_memory().unwrap();
        let saved = save(&conn, &entry("2026-09-29")).unwrap().unwrap();
        assert_eq!(saved.went_well, "Patience");
        assert_eq!(saved.mood, Some(4));
        assert!(saved.late_hours);
        // Same day: replaced, not duplicated.
        save(&conn, &JournalEntry { mood: Some(1), ..entry("2026-09-29") }).unwrap();
        save(&conn, &entry("2026-09-30")).unwrap();
        let all = list(&conn, None, None).unwrap();
        assert_eq!(all.iter().map(|e| e.day.as_str()).collect::<Vec<_>>(), ["2026-09-30", "2026-09-29"]);
        assert_eq!(get(&conn, "2026-09-29").unwrap().unwrap().mood, Some(1));
        assert_eq!(list(&conn, Some("2026-09-30"), None).unwrap().len(), 1);
        assert_eq!(list(&conn, None, Some("2026-09-29")).unwrap().len(), 1);
        delete(&conn, "2026-09-29").unwrap();
        assert!(get(&conn, "2026-09-29").unwrap().is_none());
    }

    #[test]
    fn a_blank_entry_is_never_stored() {
        let conn = db::open_in_memory().unwrap();
        save(&conn, &entry("2026-09-29")).unwrap();
        let blank = JournalEntry {
            day: "2026-09-29".into(),
            mood: None,
            sleep_quality: None,
            fatigue: None,
            late_hours: false,
            went_well: "  ".into(),
            to_improve: String::new(),
            notes: String::new(),
        };
        assert_eq!(save(&conn, &blank).unwrap(), None);
        assert!(get(&conn, "2026-09-29").unwrap().is_none(), "emptying an entry removes it");
    }

    #[test]
    fn rejects_invalid_entries() {
        let conn = db::open_in_memory().unwrap();
        assert!(save(&conn, &entry("2026-02-30")).is_err());
        assert!(save(&conn, &entry("29/09/2026")).is_err());
        assert!(save(&conn, &JournalEntry { mood: Some(6), ..entry("2026-09-29") }).is_err());
        assert!(save(&conn, &JournalEntry { fatigue: Some(0), ..entry("2026-09-29") }).is_err());
        assert!(list(&conn, None, None).unwrap().is_empty());
    }

    #[test]
    fn day_overview_lists_the_trades_entered_that_local_day_and_flags_incomplete_ones() {
        let conn = db::open_in_memory().unwrap();
        let a = account(&conn, "10000");
        let eu = instrument(&conn, "EURUSD", "100000");
        // 2026-09-29 23:30 UTC, trader at UTC+2: local day is the 30th.
        let late = 1_790_724_600_000;
        let day_ms = 86_400_000;
        let mut quick = TradeData::new(a, eu, Direction::Long, dec("1"), dec("1.1"), late);
        quick.tz_offset_min = 120;
        let quick = trades::create(&conn, &quick).unwrap();
        let mut full = TradeData::new(a, eu, Direction::Short, dec("1"), dec("1.1"), late + 1_000);
        full.tz_offset_min = 120;
        full.thesis = "Rejet de résistance".into();
        let calm = crate::tags::find(&conn, crate::tags::TagKind::Emotion, "calme").unwrap().unwrap();
        full.emotions = vec![EmotionEntry { moment: EmotionMoment::Before, tag_id: calm.id }];
        let full = trades::create(&conn, &full).unwrap();
        let mut other_day = TradeData::new(a, eu, Direction::Long, dec("1"), dec("1.1"), late - day_ms);
        other_day.tz_offset_min = 120;
        trades::create(&conn, &other_day).unwrap();

        save(&conn, &entry("2026-09-30")).unwrap();
        let o = day_overview(&conn, &[], "2026-09-30").unwrap();
        assert_eq!(o.trades.iter().map(|t| t.trade_id).collect::<Vec<_>>(), [quick.id, full.id]);
        assert_eq!((o.trades[0].incomplete, o.trades[1].incomplete), (true, false));
        assert_eq!(o.incomplete_count, 1);
        assert_eq!(o.trades[0].currency, "USD");
        assert!(o.entry.is_some());
        assert!(day_overview(&conn, &[], "2026-09-29").unwrap().entry.is_none());
        assert!(day_overview(&conn, &[], "nope").is_err());
    }
}
