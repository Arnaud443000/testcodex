//! Behavioural analysis (spec 3.4, 3.2.9): discipline score and the reports
//! that read the trader's declarations (plan, rules, checklist, emotions) next
//! to the results. Every formula is documented in CLAUDE.md, "Analyse
//! comportementale (lot 8)".
//!
//! Like `stats`, the engine is pure: each report has a function over a
//! [`Ledger`] and a thin wrapper that loads it from SQLite with the user's
//! [`BehaviorSettings`].

mod analysis;
mod discipline;
mod mistakes;
mod patterns;

pub use analysis::{
    EmotionReport, FirstTradeReport, PlanReport, RankGroup, Streak, StreakReport, emotion_report, emotions, first_trade,
    first_trade_report, plan, plan_report, streak_report, streaks,
};
pub use mistakes::{
    MIN_CHECKS_FOR_TREND, Mistake, MistakeReport, MistakeSource, MonthAdherence, RuleAdherence, RuleAdherenceReport,
    mistake_report, mistakes, rule_adherence, rule_adherence_report,
};
pub use patterns::{Hesitation, MissedFacts, OvertradingDay, PatternReport, RevengeTrade, load_missed, pattern_report, patterns};
pub use discipline::{
    Component, ComponentKey, ComponentSummary, DayDiscipline, DisciplineReport, MIN_SCORED_TRADES, Quadrant, Quadrants,
    TradeDiscipline, WELL_EXECUTED_SCORE, WEIGHTS, discipline, discipline_report, score, trade_discipline,
};

use crate::error::Result;
use crate::money::Decimal;
use crate::settings::BehaviorSettings;
use crate::stats::pnl::{self, Outcome, checked};
use crate::stats::risk::{self, Balances};
use crate::stats::{Closed, Ledger, Replay, TradeFacts, replay};
use serde::Serialize;
use std::collections::HashMap;

/// What a revenge trade is compared on (see CLAUDE.md).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ExposureBasis {
    /// Initial risk in money: both trades have a planned stop.
    Risk,
    /// Size × multiplier: same instrument, at least one trade without a stop.
    Size,
}

/// A trade taken too big too soon after a loss (spec 3.4.5).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Revenge {
    /// The losing trade it follows.
    pub previous_trade_id: i64,
    /// From that trade's exit to this trade's entry, in ms.
    pub gap_ms: i64,
    pub basis: ExposureBasis,
    /// This trade's exposure / the losing trade's.
    pub ratio: Option<f64>,
}

/// History shared by every behavioural report.
pub(crate) struct Context<'a> {
    pub replay: Replay<'a>,
    pub balances: Balances,
    pub settings: BehaviorSettings,
    /// Positions in `replay.closed` of each account's trades (exit order).
    by_account: HashMap<i64, Vec<usize>>,
    /// Position in `replay.closed` of each closed trade.
    closed_index: HashMap<i64, usize>,
}

impl<'a> Context<'a> {
    pub fn new(ledger: &'a Ledger, settings: BehaviorSettings) -> Result<Self> {
        let replay = replay(ledger)?;
        let balances = Balances::new(ledger, &replay.closed)?;
        let mut by_account: HashMap<i64, Vec<usize>> = HashMap::new();
        let mut closed_index = HashMap::with_capacity(replay.closed.len());
        for (i, c) in replay.closed.iter().enumerate() {
            by_account.entry(c.facts.account_id).or_default().push(i);
            closed_index.insert(c.facts.id, i);
        }
        Ok(Context { replay, balances, settings, by_account, closed_index })
    }

    pub fn closed(&self, trade_id: i64) -> Option<&Closed<'a>> {
        self.closed_index.get(&trade_id).map(|&i| &self.replay.closed[i])
    }

    /// 1 = first trade entered on its local day on its account.
    pub fn day_rank(&self, trade_id: i64) -> u32 {
        self.replay.day_ranks.get(&trade_id).copied().unwrap_or(1)
    }

    pub fn overtrading(&self, trade_id: i64) -> bool {
        self.settings.max_trades_per_day.is_some_and(|max| self.day_rank(trade_id) > max)
    }

    /// Real balance of the trade's account at its entry; the trade's own PnL
    /// never counts, even when it closed at the instant it opened.
    pub fn balance_at_entry(&self, t: &TradeFacts) -> Result<Decimal> {
        self.balances.at_entry(t, self.closed(t.id))
    }

    /// The last trade of the same account closed at or before `t`'s entry.
    fn previous(&self, t: &TradeFacts) -> Option<&Closed<'a>> {
        let list = self.by_account.get(&t.account_id)?;
        let n = list.partition_point(|&i| self.replay.closed[i].exit_time <= t.entry_time);
        list[..n].iter().rev().map(|&i| &self.replay.closed[i]).find(|c| c.facts.id != t.id)
    }

    pub fn revenge(&self, t: &TradeFacts) -> Result<Option<Revenge>> {
        let Some(p) = self.previous(t) else { return Ok(None) };
        let gap_ms = t.entry_time - p.exit_time;
        if p.figures.outcome != Outcome::Loss || gap_ms > i64::from(self.settings.revenge_window_min) * 60_000 {
            return Ok(None);
        }
        let (basis, mine, theirs) = match (risk::initial_risk(t)?, p.figures.initial_risk) {
            (Some(mine), Some(theirs)) => (ExposureBasis::Risk, mine, theirs),
            _ if t.instrument_id == p.facts.instrument_id => {
                let size = |f: &TradeFacts| checked(f.position.size.checked_mul(f.position.multiplier));
                (ExposureBasis::Size, size(t)?, size(p.facts)?)
            }
            _ => return Ok(None),
        };
        if mine < checked(theirs.checked_mul(self.settings.revenge_size_factor))? {
            return Ok(None);
        }
        Ok(Some(Revenge { previous_trade_id: p.facts.id, gap_ms, basis, ratio: pnl::ratio(mine, theirs) }))
    }
}

#[cfg(test)]
mod tests;

#[cfg(test)]
mod analysis_tests;
