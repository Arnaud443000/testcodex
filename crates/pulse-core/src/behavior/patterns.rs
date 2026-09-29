//! Dangerous patterns (spec 3.4.5): revenge trades, overtrading days, and
//! hesitation (setups and sessions often seen but not taken, 3.2.5).

use super::{Context, Revenge};
use crate::error::Result;
use crate::money::Decimal;
use crate::settings::{self, BehaviorSettings};
use crate::stats::summary::{Summary, analyze};
use crate::stats::{Ledger, StatsQuery, TagRef, load, time};
use crate::tags::TagKind;
use crate::trades::Direction;
use crate::util::ids_condition;
use rusqlite::Connection;
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};

/// A missed trade as the analysis sees it (spec 2.3).
#[derive(Debug, Clone, PartialEq)]
pub struct MissedFacts {
    pub id: i64,
    pub account_id: i64,
    pub instrument_id: i64,
    pub direction: Option<Direction>,
    pub occurred_at: i64,
    pub tags: Vec<TagRef>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevengeTrade {
    pub trade_id: i64,
    pub exit_time: i64,
    pub net_pnl: Decimal,
    #[serde(flatten)]
    pub revenge: Revenge,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OvertradingDay {
    pub account_id: i64,
    /// Local entry day "YYYY-MM-DD".
    pub day: String,
    /// Trades entered that day on that account, open ones included.
    pub trade_count: u32,
    pub limit: u32,
    /// The period's closed trades beyond the limit.
    pub trade_ids: Vec<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Hesitation {
    pub tag_id: i64,
    pub kind: TagKind,
    pub name: String,
    /// Closed trades of the period with this tag.
    pub taken: usize,
    /// Missed trades of the period with this tag.
    pub missed: usize,
    /// missed / (taken + missed).
    pub missed_share: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatternReport {
    pub revenge_trades: Vec<RevengeTrade>,
    /// Indicators of the revenge trades alone.
    pub revenge_summary: Summary,
    /// `None`: no daily limit set, so no overtrading detection.
    pub max_trades_per_day: Option<u32>,
    pub overtrading_days: Vec<OvertradingDay>,
    /// Setups, then sessions; by name.
    pub hesitation: Vec<Hesitation>,
    pub missed_trade_count: usize,
}

fn missed_matches(m: &MissedFacts, q: &StatsQuery) -> bool {
    (q.account_ids.is_empty() || q.account_ids.contains(&m.account_id))
        && q.from.is_none_or(|f| m.occurred_at >= f)
        && q.to.is_none_or(|t| m.occurred_at < t)
        && q.direction.is_none_or(|d| m.direction == Some(d))
        && (q.instrument_ids.is_empty() || q.instrument_ids.contains(&m.instrument_id))
        && q.tag_ids.iter().all(|id| m.tags.iter().any(|t| t.id == *id))
}

pub fn patterns(ledger: &Ledger, missed: &[MissedFacts], query: &StatsQuery, settings: &BehaviorSettings) -> Result<PatternReport> {
    let ctx = Context::new(ledger, settings.clone())?;
    let set = ctx.replay.selected(query);

    let mut revenge_trades = Vec::new();
    let mut revenge_set = Vec::new();
    for &c in &set {
        if let Some(revenge) = ctx.revenge(c.facts)? {
            revenge_trades.push(RevengeTrade { trade_id: c.facts.id, exit_time: c.exit_time, net_pnl: c.figures.net_pnl, revenge });
            revenge_set.push(c);
        }
    }

    let mut overtrading_days = Vec::new();
    if let Some(limit) = settings.max_trades_per_day {
        let mut per_day: HashMap<(i64, i64), u32> = HashMap::new();
        for t in &ledger.trades {
            *per_day.entry((t.account_id, time::local_day_number(t.entry_time, t.tz_offset_min))).or_default() += 1;
        }
        let mut days: BTreeMap<(i64, i64), OvertradingDay> = BTreeMap::new();
        for c in set.iter().filter(|c| c.day_rank > limit) {
            let t = c.facts;
            let key = (time::local_day_number(t.entry_time, t.tz_offset_min), t.account_id);
            days.entry(key)
                .or_insert_with(|| OvertradingDay {
                    account_id: t.account_id,
                    day: time::day_key(t.entry_time, t.tz_offset_min),
                    trade_count: per_day[&(key.1, key.0)],
                    limit,
                    trade_ids: Vec::new(),
                })
                .trade_ids
                .push(t.id);
        }
        overtrading_days = days.into_values().collect();
    }

    let chosen: Vec<&MissedFacts> = missed.iter().filter(|m| missed_matches(m, query)).collect();
    let mut hesitation: BTreeMap<(TagKind, String, i64), Hesitation> = BTreeMap::new();
    let mut count = |tag: &TagRef, taken: bool| {
        if matches!(tag.kind, TagKind::Setup | TagKind::Session) {
            let h = hesitation.entry((tag.kind, tag.name.to_lowercase(), tag.id)).or_insert_with(|| Hesitation {
                tag_id: tag.id,
                kind: tag.kind,
                name: tag.name.clone(),
                taken: 0,
                missed: 0,
                missed_share: None,
            });
            if taken { h.taken += 1 } else { h.missed += 1 }
        }
    };
    for c in &set {
        c.facts.tags.iter().for_each(|t| count(t, true));
    }
    for m in &chosen {
        m.tags.iter().for_each(|t| count(t, false));
    }
    let hesitation = hesitation
        .into_values()
        .map(|mut h| {
            h.missed_share = Some(h.missed as f64 / (h.taken + h.missed) as f64);
            h
        })
        .collect();

    Ok(PatternReport {
        revenge_trades,
        revenge_summary: analyze(&revenge_set, query.risk_free_daily)?.summary,
        max_trades_per_day: settings.max_trades_per_day,
        overtrading_days,
        hesitation,
        missed_trade_count: chosen.len(),
    })
}

/// Missed trades of the given accounts (all when empty), with their tags.
pub fn load_missed(conn: &Connection, account_ids: &[i64]) -> Result<Vec<MissedFacts>> {
    let cond = ids_condition("account_id", account_ids);
    let mut stmt =
        conn.prepare(&format!("SELECT id, account_id, instrument_id, direction, occurred_at FROM missed_trades WHERE {cond} ORDER BY id"))?;
    let mut missed = stmt
        .query_map([], |r| {
            Ok(MissedFacts {
                id: r.get(0)?,
                account_id: r.get(1)?,
                instrument_id: r.get(2)?,
                direction: r.get(3)?,
                occurred_at: r.get(4)?,
                tags: Vec::new(),
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    let index: HashMap<i64, usize> = missed.iter().enumerate().map(|(i, m)| (m.id, i)).collect();
    let mut stmt = conn.prepare(&format!(
        "SELECT mt.missed_trade_id, g.id, g.kind, g.name FROM missed_trade_tags mt JOIN tags g ON g.id = mt.tag_id
         WHERE mt.missed_trade_id IN (SELECT id FROM missed_trades WHERE {cond}) ORDER BY g.id"
    ))?;
    for row in stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, TagRef { id: r.get(1)?, kind: r.get(2)?, name: r.get(3)? })))? {
        let (id, tag) = row?;
        missed[index[&id]].tags.push(tag);
    }
    Ok(missed)
}

pub fn pattern_report(conn: &Connection, query: &StatsQuery) -> Result<PatternReport> {
    let ledger = load(conn, &query.account_ids)?;
    let accounts: Vec<i64> = ledger.accounts.iter().map(|a| a.id).collect();
    patterns(&ledger, &load_missed(conn, &accounts)?, query, &settings::behavior(conn)?)
}
