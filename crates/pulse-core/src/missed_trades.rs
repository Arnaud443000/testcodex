//! Missed trades (spec 2.3, 3.2.5): setups seen but not taken. They never
//! produce PnL; they feed the confidence analysis.

use crate::error::{CoreError, Result};
use crate::tags::{self, TagKind};
use crate::trades::Direction;
use crate::util::{check_range, check_tz_offset, ids_condition};
use crate::{accounts, instruments};
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissedTradeData {
    pub account_id: i64,
    pub instrument_id: i64,
    #[serde(default)]
    pub direction: Option<Direction>,
    /// Unix milliseconds, UTC.
    pub occurred_at: i64,
    #[serde(default)]
    pub tz_offset_min: i32,
    /// Why it was not taken (fear, doubt…).
    #[serde(default)]
    pub reason: String,
    #[serde(default)]
    pub notes: String,
    /// Conviction in the setup, 1–10.
    #[serde(default)]
    pub conviction: Option<u8>,
    /// Setup, session, timeframe or market condition tags.
    #[serde(default)]
    pub tag_ids: Vec<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissedTrade {
    pub id: i64,
    #[serde(flatten)]
    pub data: MissedTradeData,
}

pub fn create(conn: &Connection, data: &MissedTradeData) -> Result<MissedTrade> {
    let tag_ids = validate(conn, data)?;
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO missed_trades (account_id, instrument_id, direction, occurred_at, tz_offset_min, reason, notes, conviction)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        params![
            data.account_id,
            data.instrument_id,
            data.direction,
            data.occurred_at,
            data.tz_offset_min,
            data.reason.trim(),
            data.notes.trim(),
            data.conviction
        ],
    )?;
    let id = tx.last_insert_rowid();
    for tag in tag_ids {
        tx.execute("INSERT INTO missed_trade_tags (missed_trade_id, tag_id) VALUES (?1,?2)", params![id, tag])?;
    }
    tx.commit()?;
    get(conn, id)
}

pub fn get(conn: &Connection, id: i64) -> Result<MissedTrade> {
    load(conn, &format!("id = {id}"))?
        .pop()
        .ok_or_else(|| CoreError::NotFound(format!("missed trade {id}")))
}

/// Most recent first, for the given accounts (all when empty).
pub fn list(conn: &Connection, account_ids: &[i64]) -> Result<Vec<MissedTrade>> {
    load(conn, &ids_condition("account_id", account_ids))
}

pub fn delete(conn: &Connection, id: i64) -> Result<()> {
    get(conn, id)?;
    conn.execute("DELETE FROM missed_trades WHERE id = ?1", [id])?;
    Ok(())
}

fn validate(conn: &Connection, d: &MissedTradeData) -> Result<BTreeSet<i64>> {
    let unknown = |what: &str| CoreError::Invalid(format!("unknown {what}"));
    accounts::get(conn, d.account_id).map_err(|_| unknown("account"))?;
    instruments::get(conn, d.instrument_id).map_err(|_| unknown("instrument"))?;
    check_tz_offset(d.tz_offset_min)?;
    check_range("conviction", d.conviction, 1, 10)?;
    let tag_ids: BTreeSet<i64> = d.tag_ids.iter().copied().collect();
    for &id in &tag_ids {
        let tag = tags::get(conn, id).map_err(|_| unknown("tag"))?;
        if matches!(tag.kind, TagKind::Emotion | TagKind::Mistake) {
            return Err(CoreError::Invalid(format!("{} cannot qualify a missed trade", tag.name)));
        }
    }
    Ok(tag_ids)
}

fn load(conn: &Connection, cond: &str) -> Result<Vec<MissedTrade>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT id, account_id, instrument_id, direction, occurred_at, tz_offset_min, reason, notes, conviction
         FROM missed_trades WHERE {cond} ORDER BY occurred_at DESC, id DESC"
    ))?;
    let mut rows = stmt
        .query_map([], |r| {
            Ok(MissedTrade {
                id: r.get(0)?,
                data: MissedTradeData {
                    account_id: r.get(1)?,
                    instrument_id: r.get(2)?,
                    direction: r.get(3)?,
                    occurred_at: r.get(4)?,
                    tz_offset_min: r.get(5)?,
                    reason: r.get(6)?,
                    notes: r.get(7)?,
                    conviction: r.get(8)?,
                    tag_ids: Vec::new(),
                },
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let mut stmt = conn.prepare(&format!(
        "SELECT missed_trade_id, tag_id FROM missed_trade_tags
         WHERE missed_trade_id IN (SELECT id FROM missed_trades WHERE {cond}) ORDER BY tag_id"
    ))?;
    let links = stmt
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let index: HashMap<i64, usize> = rows.iter().enumerate().map(|(i, m)| (m.id, i)).collect();
    for (missed, tag) in links {
        rows[index[&missed]].data.tag_ids.push(tag);
    }
    Ok(rows)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::test_support::{account, instrument};

    #[test]
    fn records_missed_trades_with_tags() {
        let conn = db::open_in_memory().unwrap();
        let a = account(&conn, "10000");
        let eu = instrument(&conn, "EURUSD", "100000");
        let setup = tags::create(&conn, TagKind::Setup, "Breakout NY").unwrap();
        let london = tags::find(&conn, TagKind::Session, "london").unwrap().unwrap();
        let m = create(
            &conn,
            &MissedTradeData {
                account_id: a,
                instrument_id: eu,
                direction: Some(Direction::Long),
                occurred_at: 1_000,
                tz_offset_min: 120,
                reason: " Fear after two losses ".into(),
                notes: String::new(),
                conviction: Some(4),
                tag_ids: vec![london.id, setup.id, setup.id],
            },
        )
        .unwrap();
        assert_eq!(m.data.reason, "Fear after two losses");
        let mut expected = vec![setup.id, london.id];
        expected.sort();
        assert_eq!(m.data.tag_ids, expected);
        assert_eq!(list(&conn, &[a]).unwrap(), vec![m.clone()]);
        delete(&conn, m.id).unwrap();
        assert!(list(&conn, &[]).unwrap().is_empty());
    }

    #[test]
    fn rejects_invalid_missed_trades() {
        let conn = db::open_in_memory().unwrap();
        let a = account(&conn, "0");
        let eu = instrument(&conn, "EURUSD", "100000");
        let calm = tags::find(&conn, TagKind::Emotion, "calm").unwrap().unwrap();
        let base = MissedTradeData {
            account_id: a,
            instrument_id: eu,
            direction: None,
            occurred_at: 0,
            tz_offset_min: 0,
            reason: String::new(),
            notes: String::new(),
            conviction: None,
            tag_ids: vec![],
        };
        assert!(create(&conn, &MissedTradeData { conviction: Some(11), ..base.clone() }).is_err());
        assert!(create(&conn, &MissedTradeData { tag_ids: vec![calm.id], ..base.clone() }).is_err());
        assert!(create(&conn, &MissedTradeData { instrument_id: 999, ..base.clone() }).is_err());
        assert!(create(&conn, &base).is_ok());
    }
}
