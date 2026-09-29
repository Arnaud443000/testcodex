//! Step-3 analyses (spec 3.3.13, 3.3.15, 3.3.16, 3.3.17): by asset, fees over
//! time, strategies side by side, system vs discretionary. See CLAUDE.md,
//! "Statistiques d'étape 3". Same base as the rest of the engine: closed trades
//! counted where they close, net PnL as reference, deposits and withdrawals
//! never involved, `None` when undefined.

use super::pnl::{checked, ratio};
use super::segments::{SegmentBy, groups};
use super::summary::{Summary, analyze};
use super::{Ledger, StatsQuery, load, replay, time};
use crate::error::Result;
use crate::instruments::AssetClass;
use crate::money::Decimal;
use crate::tags::TagKind;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

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
    /// Both `system` and `discretionary` reach [`MIN_SAMPLE`].
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
        comparable,
        system,
        discretionary,
        unclassified,
    })
}

pub fn execution_report(conn: &Connection, query: &StatsQuery) -> Result<ExecutionReport> {
    executions(&load(conn, &query.account_ids)?, query)
}
