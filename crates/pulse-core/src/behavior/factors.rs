//! External factors declared in the daily journal against the quality of the
//! day's trades (spec 3.4.9). Describes what happened at the same time, never
//! a cause. See CLAUDE.md, "Compléments du moteur (lot 8 bis)".

use super::Context;
use super::discipline::{TradeDiscipline, mean_score, of_closed};
use crate::error::Result;
use crate::journal::{self, JournalEntry};
use crate::money::Decimal;
use crate::settings::{self, BehaviorSettings};
use crate::stats::pnl::checked;
use crate::stats::summary::{Summary, analyze};
use crate::stats::{Closed, Ledger, StatsQuery, load, time};
use rusqlite::Connection;
use serde::Serialize;
use std::collections::{BTreeSet, HashMap};

/// Below this many days on either side, a factor gets no verdict.
pub const MIN_FACTOR_DAYS: usize = 5;
/// Below this many trades with an R on a side, its expectancy is not compared.
pub const MIN_R_TRADES: usize = 5;
/// A discipline gap of at least this many points is a difference.
pub const DISCIPLINE_GAP: f64 = 10.0;
/// An expectancy gap of at least this many R is a difference.
pub const EXPECTANCY_GAP_R: f64 = 0.25;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FactorKey {
    /// Sleep quality 1–2 (3–5: absent).
    PoorSleep,
    /// Fatigue 4–5 (1–3: absent).
    HighFatigue,
    /// "Late hours" ticked (an entry without it: absent).
    LateHours,
    /// Mood 1–2 (3–5: absent).
    LowMood,
}

pub const FACTORS: [FactorKey; 4] = [FactorKey::PoorSleep, FactorKey::HighFatigue, FactorKey::LateHours, FactorKey::LowMood];

impl FactorKey {
    /// `Some(true)` present, `Some(false)` absent, `None` not declared that day.
    pub fn state(self, e: &JournalEntry) -> Option<bool> {
        match self {
            FactorKey::PoorSleep => e.sleep_quality.map(|v| v <= 2),
            FactorKey::HighFatigue => e.fatigue.map(|v| v >= 4),
            FactorKey::LateHours => Some(e.late_hours),
            FactorKey::LowMood => e.mood.map(|v| v <= 2),
        }
    }
}

/// How the days with the factor compare with the days without it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Verdict {
    NotEnoughData,
    /// Lower on the days with the factor.
    Lower,
    Similar,
    Higher,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Comparison {
    /// Value on the days with the factor; `None` below its own minimum sample.
    pub present: Option<f64>,
    pub absent: Option<f64>,
    /// present − absent; `None` when the verdict is `notEnoughData`.
    pub difference: Option<f64>,
    pub verdict: Verdict,
}

/// Compares two values once both sides have enough days; `gap` is the smallest meaningful difference.
pub(crate) fn compare(present: Option<f64>, absent: Option<f64>, enough_days: bool, gap: f64) -> Comparison {
    let difference = present.zip(absent).map(|(p, a)| p - a).filter(|_| enough_days);
    let verdict = match difference {
        None => Verdict::NotEnoughData,
        Some(d) if d <= -gap => Verdict::Lower,
        Some(d) if d >= gap => Verdict::Higher,
        Some(_) => Verdict::Similar,
    };
    Comparison { present, absent, difference, verdict }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FactorSide {
    /// Distinct local entry days with at least one trade.
    pub day_count: usize,
    pub summary: Summary,
    /// Mean discipline score of the trades; `None` below 5 scored trades.
    pub discipline_score: Option<f64>,
    pub scored_trade_count: usize,
    /// The trades, in exit order.
    pub trade_ids: Vec<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FactorReport {
    pub key: FactorKey,
    pub present: FactorSide,
    pub absent: FactorSide,
    /// Days (with trades) whose journal is missing or leaves this factor blank.
    pub undeclared_day_count: usize,
    pub undeclared_trade_count: usize,
    /// Discipline score, in points.
    pub discipline: Comparison,
    /// Expectancy in R, compared with at least 5 trades with an R per side.
    pub expectancy_r: Comparison,
    /// Mean net PnL per trade, present − absent; no verdict (it depends on size).
    /// `None` when the expectancy verdict lacks days.
    pub avg_net_pnl_difference: Option<Decimal>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalFactorReport {
    /// Always the four factors, in [`FACTORS`] order.
    pub factors: Vec<FactorReport>,
    pub trade_count: usize,
    /// Distinct local entry days of the trades, and those that have a journal entry.
    pub trading_day_count: usize,
    pub journal_day_count: usize,
    pub min_day_count: usize,
    pub min_r_trade_count: usize,
}

fn side(trades: &[&Closed], scores: &[&TradeDiscipline], days: &BTreeSet<String>, risk_free_daily: f64) -> Result<FactorSide> {
    let (discipline_score, scored_trade_count) = mean_score(scores.iter().copied());
    Ok(FactorSide {
        day_count: days.len(),
        summary: analyze(trades, risk_free_daily)?.summary,
        discipline_score,
        scored_trade_count,
        trade_ids: trades.iter().map(|c| c.facts.id).collect(),
    })
}

/// Expectancy in R when the side has enough trades with an R.
fn comparable_r(s: &Summary) -> Option<f64> {
    s.expectancy_r.filter(|_| s.r_trade_count >= MIN_R_TRADES)
}

pub fn external_factors(ledger: &Ledger, query: &StatsQuery, settings: &BehaviorSettings, entries: &[JournalEntry]) -> Result<ExternalFactorReport> {
    let ctx = Context::new(ledger, settings.clone())?;
    let set = ctx.replay.selected(query);
    let scores = of_closed(&ctx, &set)?;
    let journal: HashMap<&str, &JournalEntry> = entries.iter().map(|e| (e.day.as_str(), e)).collect();
    let days: Vec<String> = set.iter().map(|c| time::day_key(c.facts.entry_time, c.facts.tz_offset_min)).collect();
    let trading_days: BTreeSet<&str> = days.iter().map(String::as_str).collect();

    let factors = FACTORS
        .iter()
        .map(|&key| {
            let mut present = (Vec::new(), Vec::new(), BTreeSet::new());
            let mut absent = (Vec::new(), Vec::new(), BTreeSet::new());
            let mut undeclared: (usize, BTreeSet<&str>) = (0, BTreeSet::new());
            for ((c, score), day) in set.iter().zip(&scores).zip(&days) {
                let group = match journal.get(day.as_str()).and_then(|e| key.state(e)) {
                    Some(true) => &mut present,
                    Some(false) => &mut absent,
                    None => {
                        undeclared.0 += 1;
                        undeclared.1.insert(day);
                        continue;
                    }
                };
                group.0.push(*c);
                group.1.push(score);
                group.2.insert(day.clone());
            }
            let present = side(&present.0, &present.1, &present.2, query.risk_free_daily)?;
            let absent = side(&absent.0, &absent.1, &absent.2, query.risk_free_daily)?;
            let enough_days = present.day_count >= MIN_FACTOR_DAYS && absent.day_count >= MIN_FACTOR_DAYS;
            let avg_net_pnl_difference = match (present.summary.avg_net_pnl, absent.summary.avg_net_pnl) {
                (Some(p), Some(a)) if enough_days => Some(checked(p.checked_sub(a))?),
                _ => None,
            };
            Ok(FactorReport {
                key,
                discipline: compare(present.discipline_score, absent.discipline_score, enough_days, DISCIPLINE_GAP),
                expectancy_r: compare(comparable_r(&present.summary), comparable_r(&absent.summary), enough_days, EXPECTANCY_GAP_R),
                avg_net_pnl_difference,
                undeclared_day_count: undeclared.1.len(),
                undeclared_trade_count: undeclared.0,
                present,
                absent,
            })
        })
        .collect::<Result<Vec<_>>>()?;

    Ok(ExternalFactorReport {
        factors,
        trade_count: set.len(),
        trading_day_count: trading_days.len(),
        journal_day_count: trading_days.iter().filter(|d| journal.contains_key(*d)).count(),
        min_day_count: MIN_FACTOR_DAYS,
        min_r_trade_count: MIN_R_TRADES,
    })
}

/// Loads the selected accounts, the whole daily journal and the user's thresholds.
pub fn external_factor_report(conn: &Connection, query: &StatsQuery) -> Result<ExternalFactorReport> {
    let entries = journal::list(conn, None, None)?;
    external_factors(&load(conn, &query.account_ids)?, query, &settings::behavior(conn)?, &entries)
}
