//! Step-3 analyses (spec 3.3.13, 3.3.15, 3.3.16, 3.3.17): by asset, fees over
//! time, strategies side by side, system vs discretionary. See CLAUDE.md,
//! "Statistiques d'étape 3". Same base as the rest of the engine: closed trades
//! counted where they close, net PnL as reference, deposits and withdrawals
//! never involved, `None` when undefined.

use super::pnl::{checked, ratio};
use super::segments::{SegmentBy, groups};
use super::summary::{Summary, analyze};
use super::dashboard::{Comparison, Period, compare};
use super::{Ledger, StatsQuery, compute, load, replay, time};
use crate::error::Result;
use crate::instruments::AssetClass;
use crate::money::Decimal;
use crate::tags::TagKind;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};

/// Closed trades a group needs before its figures stand on their own; below
/// it a group is shown but flagged `low_sample`. Same threshold as the discipline score.
pub const MIN_SAMPLE: usize = 5;

fn low_sample(summary: &Summary) -> bool {
    summary.trade_count < MIN_SAMPLE
}

/// Fees / gross PnL, only when the gross is positive: a share of a zero or
/// negative gross means nothing (fees do not "eat" a loss).
fn fees_share_of_gross(fees: Decimal, gross: Decimal) -> Option<f64> {
    if gross > Decimal::ZERO { ratio(fees, gross) } else { None }
}

// --- by asset (3.3.13) -----------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssetRow {
    pub instrument_id: i64,
    pub symbol: String,
    pub asset_class: AssetClass,
    pub summary: Summary,
    pub fees_share_of_gross: Option<f64>,
    pub low_sample: bool,
}

/// One row per instrument with a closed trade, best net PnL first (ties: symbol).
pub fn assets(ledger: &Ledger, query: &StatsQuery) -> Result<Vec<AssetRow>> {
    let replay = replay(ledger)?;
    let selected = replay.selected(query);
    let mut rows = Vec::new();
    for g in groups(&selected, SegmentBy::Instrument) {
        let first = g.trades[0].facts;
        let summary = analyze(&g.trades, query.risk_free_daily)?.summary;
        rows.push(AssetRow {
            instrument_id: first.instrument_id,
            symbol: first.symbol.clone(),
            asset_class: first.asset_class,
            fees_share_of_gross: fees_share_of_gross(summary.fees, summary.gross_pnl),
            low_sample: low_sample(&summary),
            summary,
        });
    }
    rows.sort_by(|a, b| b.summary.net_pnl.cmp(&a.summary.net_pnl).then_with(|| a.symbol.to_uppercase().cmp(&b.symbol.to_uppercase())));
    Ok(rows)
}

pub fn asset_report(conn: &Connection, query: &StatsQuery) -> Result<Vec<AssetRow>> {
    assets(&load(conn, &query.account_ids)?, query)
}

// --- fees over time (3.3.15) -----------------------------------------------------

/// Size of the periods of the fee table. Local exit day; a week runs Monday to Sunday.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FeeGranularity {
    Day,
    Week,
    #[default]
    Month,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeePoint {
    pub trade_id: i64,
    /// Exit instant, Unix ms UTC.
    pub time: i64,
    pub cumulative_fees: Decimal,
    pub cumulative_gross_pnl: Decimal,
    pub cumulative_net_pnl: Decimal,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeePeriod {
    /// "YYYY-MM-DD" (day, or the Monday of the week) or "YYYY-MM" (month).
    pub key: String,
    pub trade_count: usize,
    pub gross_pnl: Decimal,
    pub fees: Decimal,
    pub net_pnl: Decimal,
    pub fees_share_of_gross: Option<f64>,
    /// Fees from the start of the queried window to the end of this period.
    pub cumulative_fees: Decimal,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeeReport {
    pub trade_count: usize,
    /// Trades whose fees are not zero.
    pub trades_with_fees: usize,
    pub gross_pnl: Decimal,
    /// Positive = cost, negative = credit (positive swap).
    pub fees: Decimal,
    pub net_pnl: Decimal,
    pub fees_share_of_gross: Option<f64>,
    pub fees_per_trade: Option<Decimal>,
    /// One point per closed trade, in exit order.
    pub curve: Vec<FeePoint>,
    /// Periods holding at least one closed trade, in time order.
    pub periods: Vec<FeePeriod>,
}

fn period_key(exit_time: i64, tz: i32, by: FeeGranularity) -> String {
    match by {
        FeeGranularity::Day => time::day_key(exit_time, tz),
        FeeGranularity::Month => time::day_key(exit_time, tz)[..7].to_string(),
        FeeGranularity::Week => {
            let back = i64::from(time::weekday(exit_time, tz)) - 1;
            time::day_key(exit_time - back * 86_400_000, tz)
        }
    }
}

pub fn fees(ledger: &Ledger, query: &StatsQuery, by: FeeGranularity) -> Result<FeeReport> {
    let replay = replay(ledger)?;
    let selected = replay.selected(query);
    let zero = Decimal::ZERO;
    let (mut gross, mut fees, mut net) = (zero, zero, zero);
    let mut with_fees = 0;
    let mut curve = Vec::with_capacity(selected.len());
    // key → (trades, gross, fees, net)
    let mut periods: BTreeMap<String, (usize, Decimal, Decimal, Decimal)> = BTreeMap::new();
    for c in &selected {
        let f = &c.figures;
        gross = checked(gross.checked_add(f.gross_pnl))?;
        fees = checked(fees.checked_add(f.fees))?;
        net = checked(net.checked_add(f.net_pnl))?;
        if !f.fees.is_zero() {
            with_fees += 1;
        }
        curve.push(FeePoint { trade_id: c.facts.id, time: c.exit_time, cumulative_fees: fees, cumulative_gross_pnl: gross, cumulative_net_pnl: net });
        let p = periods.entry(period_key(c.exit_time, c.facts.tz_offset_min, by)).or_insert((0, zero, zero, zero));
        p.0 += 1;
        p.1 = checked(p.1.checked_add(f.gross_pnl))?;
        p.2 = checked(p.2.checked_add(f.fees))?;
        p.3 = checked(p.3.checked_add(f.net_pnl))?;
    }
    let mut running = zero;
    let mut rows = Vec::with_capacity(periods.len());
    for (key, (trade_count, p_gross, p_fees, p_net)) in periods {
        running = checked(running.checked_add(p_fees))?;
        rows.push(FeePeriod {
            key,
            trade_count,
            gross_pnl: p_gross,
            fees: p_fees,
            net_pnl: p_net,
            fees_share_of_gross: fees_share_of_gross(p_fees, p_gross),
            cumulative_fees: running,
        });
    }
    let n = selected.len();
    Ok(FeeReport {
        trade_count: n,
        trades_with_fees: with_fees,
        gross_pnl: gross,
        fees,
        net_pnl: net,
        fees_share_of_gross: fees_share_of_gross(fees, gross),
        fees_per_trade: if n == 0 { None } else { fees.checked_div(Decimal::from(n)) },
        curve,
        periods: rows,
    })
}

pub fn fee_report(conn: &Connection, query: &StatsQuery, by: FeeGranularity) -> Result<FeeReport> {
    fees(&load(conn, &query.account_ids)?, query, by)
}

// --- strategies (3.3.16): one strategy = one "setup" tag ------------------------

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StrategyPoint {
    pub trade_id: i64,
    pub time: i64,
    /// Cumulative net PnL of this strategy alone, starting at 0.
    pub cumulative_net_pnl: Decimal,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StrategyRow {
    /// `None` for the trades without a setup ("no strategy").
    pub tag_id: Option<i64>,
    pub name: String,
    pub summary: Summary,
    /// Closed trades of the strategy / closed trades of the selection.
    pub share_of_trades: Option<f64>,
    pub low_sample: bool,
    pub curve: Vec<StrategyPoint>,
}

/// One row per setup tag holding a closed trade (by name), then trades without a setup.
/// A trade carries at most one setup, so the rows partition the selection.
pub fn strategies(ledger: &Ledger, query: &StatsQuery) -> Result<Vec<StrategyRow>> {
    let replay = replay(ledger)?;
    let selected = replay.selected(query);
    let total = selected.len();
    let mut rows = Vec::new();
    for g in groups(&selected, SegmentBy::Tag(TagKind::Setup)) {
        let summary = analyze(&g.trades, query.risk_free_daily)?.summary;
        let mut cumulative = Decimal::ZERO;
        let mut curve = Vec::with_capacity(g.trades.len());
        for c in &g.trades {
            cumulative = checked(cumulative.checked_add(c.figures.net_pnl))?;
            curve.push(StrategyPoint { trade_id: c.facts.id, time: c.exit_time, cumulative_net_pnl: cumulative });
        }
        rows.push(StrategyRow {
            tag_id: g.key.parse().ok(),
            name: g.label,
            share_of_trades: (total > 0).then(|| g.trades.len() as f64 / total as f64),
            low_sample: low_sample(&summary),
            summary,
            curve,
        });
    }
    Ok(rows)
}

pub fn strategy_report(conn: &Connection, query: &StatsQuery) -> Result<Vec<StrategyRow>> {
    strategies(&load(conn, &query.account_ids)?, query)
}

// --- system vs discretionary (3.3.17): the trade's `execution_type` -------------

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionBlock {
    pub summary: Summary,
    pub low_sample: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionReport {
    pub system: ExecutionBlock,
    pub discretionary: ExecutionBlock,
    /// Trades whose type was never set: never guessed, never counted in the gaps.
    pub unclassified: ExecutionBlock,
    /// Trades each side needs before a gap is quoted ([`MIN_SAMPLE`]), so the UI never hard-codes it.
    pub min_sample: usize,
    /// Both `system` and `discretionary` reach `min_sample`.
    pub comparable: bool,
    /// System − discretionary, in fraction points (0.10 = +10 points).
    pub win_rate_delta: Option<f64>,
    pub expectancy_r_delta: Option<f64>,
    pub avg_net_pnl_delta: Option<Decimal>,
}

pub fn executions(ledger: &Ledger, query: &StatsQuery) -> Result<ExecutionReport> {
    let replay = replay(ledger)?;
    let selected = replay.selected(query);
    let split = groups(&selected, SegmentBy::ExecutionType);
    let block = |key: &str| -> Result<ExecutionBlock> {
        let trades = split.iter().find(|g| g.key == key).map(|g| g.trades.as_slice()).unwrap_or(&[]);
        let summary = analyze(trades, query.risk_free_daily)?.summary;
        Ok(ExecutionBlock { low_sample: low_sample(&summary), summary })
    };
    let (system, discretionary, unclassified) = (block("system")?, block("discretionary")?, block("none")?);
    let comparable = !system.low_sample && !discretionary.low_sample;
    let (s, d) = (&system.summary, &discretionary.summary);
    let diff = |a: Option<f64>, b: Option<f64>| if comparable { a.zip(b).map(|(a, b)| a - b) } else { None };
    let avg_net_pnl_delta = match (comparable, s.avg_net_pnl, d.avg_net_pnl) {
        (true, Some(a), Some(b)) => Some(checked(a.checked_sub(b))?),
        _ => None,
    };
    Ok(ExecutionReport {
        win_rate_delta: diff(s.win_rate, d.win_rate),
        expectancy_r_delta: diff(s.expectancy_r, d.expectancy_r),
        avg_net_pnl_delta,
        min_sample: MIN_SAMPLE,
        comparable,
        system,
        discretionary,
        unclassified,
    })
}

pub fn execution_report(conn: &Connection, query: &StatsQuery) -> Result<ExecutionReport> {
    executions(&load(conn, &query.account_ids)?, query)
}

// --- opportunity cost (3.3.18) -------------------------------------------------------

/// One closed trade that has both a valid planned target and a price after its exit.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpportunityTrade {
    pub trade_id: i64,
    pub symbol: String,
    pub direction: crate::trades::Direction,
    pub exit_price: Decimal,
    pub planned_tp: Decimal,
    pub price_after_exit: Decimal,
    /// (price after − exit) × side × size × multiplier: positive when the price kept going the trade's way.
    pub move_after_exit: Decimal,
    /// Same move with the price after exit capped at the planned target, floored at 0.
    pub left_on_table: Decimal,
    pub net_pnl: Decimal,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpportunityReport {
    /// Closed trades of the selection.
    pub trade_count: usize,
    /// Trades with both data: the only ones measured.
    pub eligible_count: usize,
    pub excluded_count: usize,
    /// No planned take profit on the right side of the entry. Overlaps `without_price_after_count`.
    pub without_target_count: usize,
    pub without_price_after_count: usize,
    pub min_sample: usize,
    pub low_sample: bool,
    pub total_left_on_table: Decimal,
    /// Trades that left something on the table.
    pub left_count: usize,
    /// Average over those trades; `None` when there are none.
    pub left_per_early_exit: Option<Decimal>,
    /// Trades whose price went against them after the exit, and the money the exit spared (positive, uncapped).
    pub avoided_count: usize,
    pub total_avoided: Decimal,
    pub net_pnl_of_eligible: Decimal,
    /// Biggest amount left first (ties: trade id).
    pub trades: Vec<OpportunityTrade>,
}

/// `price_after_exit` maps a trade id to the price typed by hand after the exit.
pub fn opportunity(ledger: &Ledger, price_after_exit: &HashMap<i64, Decimal>, query: &StatsQuery) -> Result<OpportunityReport> {
    let replay = replay(ledger)?;
    let selected = replay.selected(query);
    let zero = Decimal::ZERO;
    let (mut without_target, mut without_after) = (0, 0);
    let (mut left_total, mut avoided_total, mut net_total) = (zero, zero, zero);
    let (mut left_count, mut avoided_count) = (0, 0);
    let mut trades = Vec::new();
    for c in &selected {
        let p = &c.facts.position;
        let target = p.planned_tp.filter(|tp| tp.checked_sub(p.entry_price).is_some_and(|d| d * p.direction.sign() > zero));
        let after = price_after_exit.get(&c.facts.id).copied();
        without_target += usize::from(target.is_none());
        without_after += usize::from(after.is_none());
        let (Some(tp), Some(after), Some(exit)) = (target, after, p.exit_price) else { continue };
        let cost = |to: Decimal| crate::trade_view::opportunity_cost(p.direction, Some(exit), Some(to), p.size, p.multiplier);
        let moved = cost(after)?.unwrap_or(zero);
        let capped = if p.direction.sign() > zero { after.min(tp) } else { after.max(tp) };
        let left = cost(capped)?.unwrap_or(zero).max(zero);
        left_total = checked(left_total.checked_add(left))?;
        net_total = checked(net_total.checked_add(c.figures.net_pnl))?;
        if left > zero {
            left_count += 1;
        }
        if moved < zero {
            avoided_count += 1;
            avoided_total = checked(avoided_total.checked_sub(moved))?;
        }
        trades.push(OpportunityTrade {
            trade_id: c.facts.id,
            symbol: c.facts.symbol.clone(),
            direction: p.direction,
            exit_price: exit,
            planned_tp: tp,
            price_after_exit: after,
            move_after_exit: moved,
            left_on_table: left,
            net_pnl: c.figures.net_pnl,
        });
    }
    trades.sort_by(|a, b| b.left_on_table.cmp(&a.left_on_table).then(a.trade_id.cmp(&b.trade_id)));
    let eligible = trades.len();
    Ok(OpportunityReport {
        trade_count: selected.len(),
        eligible_count: eligible,
        excluded_count: selected.len() - eligible,
        without_target_count: without_target,
        without_price_after_count: without_after,
        min_sample: MIN_SAMPLE,
        low_sample: eligible < MIN_SAMPLE,
        total_left_on_table: left_total,
        left_count,
        left_per_early_exit: if left_count == 0 { None } else { left_total.checked_div(Decimal::from(left_count)) },
        avoided_count,
        total_avoided: avoided_total,
        net_pnl_of_eligible: net_total,
        trades,
    })
}

pub fn opportunity_report(conn: &Connection, query: &StatsQuery) -> Result<OpportunityReport> {
    let ledger = load(conn, &query.account_ids)?;
    let mut stmt = conn.prepare("SELECT id, price_after_exit FROM trades WHERE price_after_exit IS NOT NULL")?;
    let mut after = HashMap::new();
    for row in stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, crate::money::col(r, 1)?)))? {
        let (id, price) = row?;
        after.insert(id, price);
    }
    opportunity(&ledger, &after, query)
}

// --- same period one year earlier (3.3.19) ---------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YearComparisonQuery {
    #[serde(default)]
    pub account_ids: Vec<i64>,
    pub period: Period,
    /// The current instant and the user's UTC offset, supplied by the shell (as for the dashboard).
    pub now_ms: i64,
    #[serde(default)]
    pub tz_offset_min: i32,
}

/// Why nothing can be compared with last year.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PreviousEmptyReason {
    /// The first trade of the accounts is later than the end of last year's window.
    HistoryTooShort,
    /// The history reaches back far enough but holds no closed trade in that window.
    NoTrades,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YearComparison {
    /// `false` for "all time": nothing precedes it.
    pub available: bool,
    /// Current window `[from, to)` and the same calendar dates one year earlier.
    pub from: Option<i64>,
    pub to: Option<i64>,
    pub previous_from: Option<i64>,
    pub previous_to: Option<i64>,
    pub min_sample: usize,
    pub current: Summary,
    pub current_empty: bool,
    pub current_low_sample: bool,
    /// `None` when `available` is false.
    pub previous: Option<Summary>,
    pub previous_empty: bool,
    pub previous_low_sample: bool,
    pub previous_reason: Option<PreviousEmptyReason>,
    /// Same gaps as the dashboard; `None` when last year is empty or unavailable (never a gap against nothing).
    pub comparison: Option<Comparison>,
}

/// The local calendar day one year earlier (29 February becomes 28 February).
fn day_minus_one_year(day: i64) -> i64 {
    let (y, m, d) = time::civil_from_days(day);
    let d = d.min(u32::from(time::days_in_month(y - 1, m)));
    time::days_from_civil(y - 1, m, d).unwrap_or(day - 365)
}

pub fn year_comparison(ledger: &Ledger, q: &YearComparisonQuery) -> Result<YearComparison> {
    const DAY_MS: i64 = 86_400_000;
    let stats = |from: Option<i64>, to: Option<i64>| StatsQuery { account_ids: q.account_ids.clone(), from, to, ..StatsQuery::default() };
    let midnight = |day: i64| day * DAY_MS - i64::from(q.tz_offset_min) * 60_000;
    let Some(n) = q.period.days() else {
        let current = compute(ledger, &stats(None, None))?.summary;
        return Ok(YearComparison {
            available: false,
            from: None,
            to: None,
            previous_from: None,
            previous_to: None,
            min_sample: MIN_SAMPLE,
            current_empty: current.trade_count == 0,
            current_low_sample: low_sample(&current),
            current,
            previous: None,
            previous_empty: false,
            previous_low_sample: false,
            previous_reason: None,
            comparison: None,
        });
    };
    let today = time::local_day_number(q.now_ms, q.tz_offset_min);
    let (first, last) = (today + 1 - n, today);
    let (from, to) = (midnight(first), midnight(last + 1));
    let (previous_from, previous_to) = (midnight(day_minus_one_year(first)), midnight(day_minus_one_year(last) + 1));
    let current = compute(ledger, &stats(Some(from), Some(to)))?.summary;
    let previous = compute(ledger, &stats(Some(previous_from), Some(previous_to)))?.summary;
    let previous_empty = previous.trade_count == 0;
    let previous_reason = previous_empty.then(|| match ledger.trades.iter().map(|t| t.entry_time).min() {
        Some(first_entry) if first_entry >= previous_to => PreviousEmptyReason::HistoryTooShort,
        _ => PreviousEmptyReason::NoTrades,
    });
    let comparison = if previous_empty { None } else { Some(compare(&current, &previous)?) };
    Ok(YearComparison {
        available: true,
        from: Some(from),
        to: Some(to),
        previous_from: Some(previous_from),
        previous_to: Some(previous_to),
        min_sample: MIN_SAMPLE,
        current_empty: current.trade_count == 0,
        current_low_sample: low_sample(&current),
        previous_low_sample: low_sample(&previous),
        current,
        previous: Some(previous),
        previous_empty,
        previous_reason,
        comparison,
    })
}

pub fn year_comparison_report(conn: &Connection, q: &YearComparisonQuery) -> Result<YearComparison> {
    year_comparison(&load(conn, &q.account_ids)?, q)
}
