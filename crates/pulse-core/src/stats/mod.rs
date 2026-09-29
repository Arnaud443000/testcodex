//! Statistics engine (spec 3.3.1 – 3.3.7, 3.3.9, 3.7.10; glossary section 7).
//!
//! Everything is recomputed from source data on each call; nothing is cached.
//! The engine is pure: [`load`] reads a [`Ledger`] from SQLite, [`compute`]
//! and [`segments`] turn it into figures.
//!
//! How capital is handled (spec 3.7.10): deposits and withdrawals move the
//! balance but are never a gain or a loss. Money figures (PnL, money drawdown)
//! ignore them entirely. Percentages use time-weighted returns: each trade's
//! return is its net PnL divided by the real balance just before it (initial
//! capital + flows so far + earlier PnL), and returns are chained. Without
//! flows this equals the plain "balance / starting balance" curve; with flows,
//! a deposit never shows up as performance.

pub mod dashboard;
mod load;
pub mod pnl;
pub(crate) mod risk;
pub(crate) mod segments;
pub(crate) mod summary;
pub mod time;

pub use load::load;
pub use pnl::{Figures, Outcome, Position};
pub use segments::{Segment, SegmentBy};
pub use summary::{DayResult, EquityPoint, Summary};

use crate::error::Result;
use crate::instruments::AssetClass;
use crate::money::Decimal;
use crate::tags::TagKind;
use crate::trades::{Direction, EmotionMoment, ExecutionType, PlanFollowed};
use pnl::checked;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TagRef {
    pub id: i64,
    pub kind: TagKind,
    pub name: String,
}

/// One trade as the engine sees it.
#[derive(Debug, Clone, PartialEq)]
pub struct TradeFacts {
    pub id: i64,
    pub account_id: i64,
    pub instrument_id: i64,
    pub symbol: String,
    pub asset_class: AssetClass,
    pub position: Position,
    pub entry_time: i64,
    pub exit_time: Option<i64>,
    pub tz_offset_min: i32,
    pub execution_type: Option<ExecutionType>,
    pub tags: Vec<TagRef>,
    pub journal: Journal,
}

/// What the trader declared about a trade (spec 3.2), for the behavioural analysis.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Journal {
    pub plan_followed: Option<PlanFollowed>,
    pub emotions: Vec<(EmotionMoment, TagRef)>,
    pub rule_checks: Vec<RuleCheckFact>,
    /// Ticked lines and total lines of the trade's checklist copy (0 / 0 when none).
    pub checklist_checked: usize,
    pub checklist_total: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct RuleCheckFact {
    pub rule_id: i64,
    pub text: String,
    pub respected: bool,
}

/// A deposit (+) or withdrawal (−) at an instant.
#[derive(Debug, Clone, PartialEq)]
pub struct CapitalMove {
    pub account_id: i64,
    pub at: i64,
    pub amount: Decimal,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AccountCapital {
    pub id: i64,
    pub initial_capital: Decimal,
}

/// Source data for one account, or several accounts sharing a currency.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Ledger {
    /// `None` when no account is selected.
    pub currency: Option<String>,
    /// Sum of the initial capitals of `accounts`.
    pub initial_capital: Decimal,
    /// Each account on its own, for per-account balances (risk in % of capital).
    pub accounts: Vec<AccountCapital>,
    pub capital_moves: Vec<CapitalMove>,
    pub trades: Vec<TradeFacts>,
}

/// Which trades to measure. Balances always use the full history of the
/// selected accounts; filters only choose which closed trades are aggregated.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsQuery {
    /// Accounts to include (all when empty); they must share one currency.
    #[serde(default)]
    pub account_ids: Vec<i64>,
    /// Exit-time window `[from, to)`, Unix ms: a trade counts when it is closed.
    #[serde(default)]
    pub from: Option<i64>,
    #[serde(default)]
    pub to: Option<i64>,
    #[serde(default)]
    pub direction: Option<Direction>,
    /// Any of these instruments (all when empty).
    #[serde(default)]
    pub instrument_ids: Vec<i64>,
    /// Trades carrying every one of these tags.
    #[serde(default)]
    pub tag_ids: Vec<i64>,
    /// Risk-free rate per trading day for the Sharpe ratio (0 by default).
    #[serde(default)]
    pub risk_free_daily: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub currency: Option<String>,
    pub initial_capital: Decimal,
    /// All-time totals, shown for information: never part of performance.
    pub total_deposits: Decimal,
    pub total_withdrawals: Decimal,
    /// Initial capital + deposits − withdrawals + all realized net PnL (spec 2.1).
    pub current_capital: Decimal,
    /// Open trades matching the filters (their PnL is not realized yet).
    pub open_trade_count: usize,
    pub summary: Summary,
    /// One point per closed trade, in exit order.
    pub equity_curve: Vec<EquityPoint>,
    /// Net PnL per local exit day (calendar, heatmap).
    pub daily: Vec<DayResult>,
}

/// A closed trade replayed against the account balance.
#[derive(Debug, Clone)]
pub(crate) struct Closed<'a> {
    pub facts: &'a TradeFacts,
    pub exit_time: i64,
    pub figures: Figures,
    /// Net PnL / balance just before it (all flows up to its exit included);
    /// `None` when that balance is not positive.
    pub ret: Option<f64>,
    /// 1 for the first trade entered on its local day on its account, 2 for the next… (see [`day_ranks`]).
    pub day_rank: u32,
}

pub fn compute(ledger: &Ledger, query: &StatsQuery) -> Result<Report> {
    let replay = replay(ledger)?;
    let selected = replay.selected(query);
    let analysis = summary::analyze(&selected, query.risk_free_daily)?;
    let open_trade_count = ledger.trades.iter().filter(|t| t.exit_time.is_none() && matches(t, query)).count();
    Ok(Report {
        currency: ledger.currency.clone(),
        initial_capital: ledger.initial_capital,
        total_deposits: replay.deposits,
        total_withdrawals: replay.withdrawals,
        current_capital: replay.final_balance,
        open_trade_count,
        summary: analysis.summary,
        equity_curve: analysis.curve,
        daily: analysis.daily,
    })
}

/// The indicators of `compute`, broken down by segment (spec 3.3.9, 3.3.10).
pub fn segments(ledger: &Ledger, query: &StatsQuery, by: SegmentBy) -> Result<Vec<Segment>> {
    let replay = replay(ledger)?;
    let selected = replay.selected(query);
    segments::split(&selected, by, query.risk_free_daily)
}

/// Loads the selected accounts and computes their report.
pub fn report(conn: &Connection, query: &StatsQuery) -> Result<Report> {
    compute(&load(conn, &query.account_ids)?, query)
}

pub fn segment_report(conn: &Connection, query: &StatsQuery, by: SegmentBy) -> Result<Vec<Segment>> {
    segments(&load(conn, &query.account_ids)?, query, by)
}

pub(crate) fn in_window(exit_time: i64, q: &StatsQuery) -> bool {
    q.from.is_none_or(|f| exit_time >= f) && q.to.is_none_or(|t| exit_time < t)
}

pub(crate) fn matches(t: &TradeFacts, q: &StatsQuery) -> bool {
    q.direction.is_none_or(|d| t.position.direction == d)
        && (q.instrument_ids.is_empty() || q.instrument_ids.contains(&t.instrument_id))
        && q.tag_ids.iter().all(|id| t.tags.iter().any(|tag| tag.id == *id))
}

pub(crate) struct Replay<'a> {
    /// In exit order (ties: trade id).
    pub closed: Vec<Closed<'a>>,
    pub deposits: Decimal,
    pub withdrawals: Decimal,
    pub final_balance: Decimal,
    pub day_ranks: HashMap<i64, u32>,
}

impl Replay<'_> {
    /// The closed trades matching the query window and filters, in exit order.
    pub(crate) fn selected(&self, query: &StatsQuery) -> Vec<&Closed<'_>> {
        self.closed.iter().filter(|c| in_window(c.exit_time, query) && matches(c.facts, query)).collect()
    }
}

/// Rank of each trade among the trades entered on the same local day on the
/// same account (entry order, ties: id), open trades included: 1 = first trade of the day.
pub(crate) fn day_ranks(ledger: &Ledger) -> HashMap<i64, u32> {
    let mut order: Vec<&TradeFacts> = ledger.trades.iter().collect();
    order.sort_by_key(|t| (t.account_id, time::local_day_number(t.entry_time, t.tz_offset_min), t.entry_time, t.id));
    let mut ranks = HashMap::with_capacity(order.len());
    let mut previous: Option<(i64, i64)> = None;
    let mut rank = 0;
    for t in order {
        let day = (t.account_id, time::local_day_number(t.entry_time, t.tz_offset_min));
        rank = if previous == Some(day) { rank + 1 } else { 1 };
        previous = Some(day);
        ranks.insert(t.id, rank);
    }
    ranks
}

/// Walks closed trades in exit order (ties: trade id) and applies each
/// deposit/withdrawal before any trade closing at the same instant or later.
pub(crate) fn replay(ledger: &Ledger) -> Result<Replay<'_>> {
    let mut trades: Vec<(&TradeFacts, i64, Figures)> = Vec::new();
    for t in &ledger.trades {
        if let (Some(exit), Some(f)) = (t.exit_time, pnl::figures(&t.position)?) {
            trades.push((t, exit, f));
        }
    }
    trades.sort_by_key(|(t, exit, _)| (*exit, t.id));
    let mut moves: Vec<&CapitalMove> = ledger.capital_moves.iter().collect();
    moves.sort_by_key(|m| m.at);

    let day_ranks = day_ranks(ledger);
    let mut balance = ledger.initial_capital;
    let mut next_move = 0;
    let mut closed = Vec::with_capacity(trades.len());
    for (facts, exit_time, figures) in trades {
        while next_move < moves.len() && moves[next_move].at <= exit_time {
            balance = checked(balance.checked_add(moves[next_move].amount))?;
            next_move += 1;
        }
        let ret = if balance > Decimal::ZERO { pnl::ratio(figures.net_pnl, balance) } else { None };
        balance = checked(balance.checked_add(figures.net_pnl))?;
        let day_rank = day_ranks.get(&facts.id).copied().unwrap_or(1);
        closed.push(Closed { facts, exit_time, figures, ret, day_rank });
    }
    for m in &moves[next_move..] {
        balance = checked(balance.checked_add(m.amount))?;
    }
    let (mut deposits, mut withdrawals) = (Decimal::ZERO, Decimal::ZERO);
    for m in &moves {
        if m.amount > Decimal::ZERO {
            deposits = checked(deposits.checked_add(m.amount))?;
        } else {
            withdrawals = checked(withdrawals.checked_sub(m.amount))?;
        }
    }
    Ok(Replay { closed, deposits, withdrawals, final_balance: balance, day_ranks })
}

#[cfg(test)]
mod tests;
