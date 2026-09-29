//! Emotions and results (spec 3.4.2), streaks (3.4.3), in plan vs off plan
//! (3.4.4) and first trade of the day vs the next ones (3.4.10). The
//! indicators of each group are the statistics engine's [`Summary`].

use super::Context;
use super::discipline::{TradeDiscipline, mean_score, of_closed};
use crate::error::Result;
use crate::money::Decimal;
use crate::settings::{self, BehaviorSettings};
use crate::stats::pnl::{Outcome, checked};
use crate::stats::segments::{Segment, SegmentBy, groups, split};
use crate::stats::summary::{Summary, analyze};
use crate::stats::{Closed, Ledger, StatsQuery, load, replay};
use crate::trades::EmotionMoment;
use rusqlite::Connection;
use serde::Serialize;
use std::collections::HashMap;

// --- Emotions (3.4.2) ---------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmotionReport {
    /// One segment per emotion declared at any moment; "none" = no emotion at all.
    pub any: Vec<Segment>,
    pub before: Vec<Segment>,
    pub during: Vec<Segment>,
    pub after: Vec<Segment>,
}

pub fn emotions(ledger: &Ledger, query: &StatsQuery) -> Result<EmotionReport> {
    let r = replay(ledger)?;
    let set = r.selected(query);
    let by = |moment| split(&set, SegmentBy::Emotion(moment), query.risk_free_daily);
    Ok(EmotionReport {
        any: by(None)?,
        before: by(Some(EmotionMoment::Before))?,
        during: by(Some(EmotionMoment::During))?,
        after: by(Some(EmotionMoment::After))?,
    })
}

pub fn emotion_report(conn: &Connection, query: &StatsQuery) -> Result<EmotionReport> {
    emotions(&load(conn, &query.account_ids)?, query)
}

// --- Streaks (3.4.3) ----------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Streak {
    /// `win` or `loss`.
    pub outcome: Outcome,
    pub length: usize,
    pub net_pnl: Decimal,
    pub first_trade_id: i64,
    pub last_trade_id: i64,
    /// Exit instants of the first and last trade.
    pub from: i64,
    pub to: i64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreakReport {
    /// The streak ending with the last trade of the period; `None` when that
    /// trade is a breakeven or there is no trade.
    pub current: Option<Streak>,
    pub longest_win: Option<Streak>,
    pub longest_loss: Option<Streak>,
    pub trade_count: usize,
}

/// Consecutive wins or losses in exit order; a breakeven ends a streak.
pub(crate) fn streaks_of(set: &[&Closed]) -> Result<StreakReport> {
    let mut all: Vec<Streak> = Vec::new();
    let mut open: Option<Streak> = None;
    for c in set {
        let o = c.figures.outcome;
        match open.as_mut() {
            Some(s) if s.outcome == o => {
                s.length += 1;
                s.net_pnl = checked(s.net_pnl.checked_add(c.figures.net_pnl))?;
                s.last_trade_id = c.facts.id;
                s.to = c.exit_time;
            }
            _ => {
                all.extend(open.take());
                if o != Outcome::Breakeven {
                    open = Some(Streak {
                        outcome: o,
                        length: 1,
                        net_pnl: c.figures.net_pnl,
                        first_trade_id: c.facts.id,
                        last_trade_id: c.facts.id,
                        from: c.exit_time,
                        to: c.exit_time,
                    });
                }
            }
        }
    }
    let current = open.clone();
    all.extend(open);
    // Longest; on a tie the most recent (later in `all`) wins.
    let longest = |o: Outcome| all.iter().filter(|s| s.outcome == o).fold(None::<&Streak>, |best, s| match best {
        Some(b) if b.length > s.length => Some(b),
        _ => Some(s),
    });
    Ok(StreakReport {
        longest_win: longest(Outcome::Win).cloned(),
        longest_loss: longest(Outcome::Loss).cloned(),
        current,
        trade_count: set.len(),
    })
}

pub fn streaks(ledger: &Ledger, query: &StatsQuery) -> Result<StreakReport> {
    let r = replay(ledger)?;
    streaks_of(&r.selected(query))
}

pub fn streak_report(conn: &Connection, query: &StatsQuery) -> Result<StreakReport> {
    streaks(&load(conn, &query.account_ids)?, query)
}

// --- In plan vs off plan (3.4.4) ------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanReport {
    /// Always four groups, in this order: "yes" (in plan), "partial", "no" (off plan), "none" (not declared).
    pub groups: Vec<Segment>,
}

/// The segments of `by` for exactly `keys`, in that order; a missing one is an empty segment.
fn fixed(set: &[&Closed], by: SegmentBy, keys: &[(&str, &str)], risk_free_daily: f64) -> Result<Vec<Segment>> {
    let mut found = split(set, by, risk_free_daily)?;
    keys.iter()
        .map(|&(key, label)| match found.iter().position(|s| s.key == key) {
            Some(i) => Ok(found.swap_remove(i)),
            None => Ok(Segment { key: key.into(), label: label.into(), summary: analyze(&[], risk_free_daily)?.summary }),
        })
        .collect()
}

pub fn plan(ledger: &Ledger, query: &StatsQuery) -> Result<PlanReport> {
    let r = replay(ledger)?;
    let keys = [("yes", "Yes"), ("partial", "Partial"), ("no", "No"), ("none", "None")];
    Ok(PlanReport { groups: fixed(&r.selected(query), SegmentBy::PlanFollowed, &keys, query.risk_free_daily)? })
}

pub fn plan_report(conn: &Connection, query: &StatsQuery) -> Result<PlanReport> {
    plan(&load(conn, &query.account_ids)?, query)
}

// --- First trade of the day (3.4.10) -----------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RankGroup {
    pub key: String,
    pub label: String,
    pub summary: Summary,
    /// Mean discipline score; `None` below the minimum sample.
    pub discipline_score: Option<f64>,
    pub scored_trade_count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FirstTradeReport {
    pub first: RankGroup,
    pub subsequent: RankGroup,
    /// Always "1", "2", "3", "4+".
    pub by_rank: Vec<RankGroup>,
}

pub fn first_trade(ledger: &Ledger, query: &StatsQuery, settings: &BehaviorSettings) -> Result<FirstTradeReport> {
    let ctx = Context::new(ledger, settings.clone())?;
    let set = ctx.replay.selected(query);
    let scores = of_closed(&ctx, &set)?;
    let by_id: HashMap<i64, &TradeDiscipline> = scores.iter().map(|t| (t.trade_id, t)).collect();
    let rank_groups = |by: SegmentBy, keys: &[(&str, &str)]| -> Result<Vec<RankGroup>> {
        let found = groups(&set, by);
        keys.iter()
            .map(|&(key, label)| {
                let trades = found.iter().find(|g| g.key == key).map(|g| g.trades.clone()).unwrap_or_default();
                let (discipline_score, scored_trade_count) = mean_score(trades.iter().filter_map(|c| by_id.get(&c.facts.id).copied()));
                Ok(RankGroup {
                    key: key.into(),
                    label: label.into(),
                    summary: analyze(&trades, query.risk_free_daily)?.summary,
                    discipline_score,
                    scored_trade_count,
                })
            })
            .collect()
    };
    let mut halves = rank_groups(SegmentBy::FirstOfDay, &[("first", "First trade of the day"), ("subsequent", "Subsequent trades")])?;
    let subsequent = halves.pop().expect("two groups");
    let first = halves.pop().expect("two groups");
    let by_rank = rank_groups(SegmentBy::DayRank, &[("1", "1"), ("2", "2"), ("3", "3"), ("4+", "4+")])?;
    Ok(FirstTradeReport { first, subsequent, by_rank })
}

pub fn first_trade_report(conn: &Connection, query: &StatsQuery) -> Result<FirstTradeReport> {
    first_trade(&load(conn, &query.account_ids)?, query, &settings::behavior(conn)?)
}
