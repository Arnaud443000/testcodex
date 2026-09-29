//! Lot 17 analyses: accounts side by side (spec 3.7.6), risk-per-trade
//! benchmark (3.4.11) and exposure by asset class (3.7.9). See CLAUDE.md,
//! "Comparaisons et exposition (lot 17)". Same base as the rest of the engine:
//! closed trades counted where they close, net PnL, deposits and withdrawals
//! never involved, exact `Decimal` money, `None` when undefined.
//!
//! Currencies are never mixed: [`compare_accounts`] computes each account on
//! its own and never adds money across accounts; the benchmark and the
//! exposure go through [`load`], which refuses accounts of different currencies.

use super::analyses::MIN_SAMPLE;
use super::pnl::{checked, ratio};
use super::risk::{self, TradeRisk};
use super::summary::Summary;
use super::{Ledger, StatsQuery, compute, load, replay, time};
use crate::accounts;
use crate::error::Result;
use crate::instruments::AssetClass;
use crate::money::Decimal;
use crate::settings::{self, BehaviorSettings};
use crate::trades::Direction;
use rusqlite::Connection;
use rust_decimal::prelude::ToPrimitive;
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};

/// Gap of fees share (in fraction points) from which a fees hint is raised.
pub const FEES_GAP_THRESHOLD: f64 = 0.10;
/// Gap of average R from which an execution hint is raised.
pub const R_GAP_THRESHOLD: f64 = 0.25;
/// Evaluated trades needed before a compliance trend is quoted.
pub const MIN_TREND_TRADES: usize = 4;
/// Compliance-rate gap (fraction points) from which a trend is "improving" / "worsening".
pub const TREND_GAP: f64 = 0.10;
const EPS: f64 = 1e-12;

// --- accounts side by side (3.7.6) -----------------------------------------------

/// The account fields the comparison shows.
#[derive(Debug, Clone, PartialEq)]
pub struct AccountRef {
    pub id: i64,
    pub name: String,
    pub broker: String,
    pub currency: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountRow {
    pub account_id: i64,
    pub name: String,
    pub broker: String,
    pub currency: String,
    pub summary: Summary,
    /// Fees / closed trades (positive = cost); `None` without a trade.
    pub fees_per_trade: Option<Decimal>,
    /// Fees / gross PnL, only when the gross is positive.
    pub fees_share_of_gross: Option<f64>,
    /// Fewer than [`MIN_SAMPLE`] closed trades: shown, never used for a hint.
    pub low_sample: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum HintKind {
    /// `account_id` pays a larger share of its gross PnL in fees than `other_account_id`.
    Fees,
    /// `account_id` has a lower average R than `other_account_id`.
    Execution,
}

/// A lead to check, never a conclusion.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountHint {
    pub kind: HintKind,
    pub account_id: i64,
    pub other_account_id: i64,
    /// Fees: gap of fees share (0.10 = 10 points). Execution: gap of average R.
    pub gap: f64,
    /// Instruments with a closed trade on both accounts in the selection.
    pub shared_instruments: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountComparison {
    /// One row per account, by name.
    pub rows: Vec<AccountRow>,
    /// Distinct currencies of the rows, sorted.
    pub currencies: Vec<String>,
    /// More than one currency: money figures must not be compared or added.
    pub mixed_currencies: bool,
    pub min_sample: usize,
    pub fees_gap_threshold: f64,
    pub r_gap_threshold: f64,
    pub hints: Vec<AccountHint>,
}

/// Each account is computed alone from its own ledger, so accounts of
/// different currencies can sit side by side without any sum between them.
pub fn compare_accounts(accounts: &[(AccountRef, Ledger)], query: &StatsQuery) -> Result<AccountComparison> {
    let mut list: Vec<&(AccountRef, Ledger)> = accounts.iter().collect();
    list.sort_by(|a, b| a.0.name.to_lowercase().cmp(&b.0.name.to_lowercase()).then(a.0.id.cmp(&b.0.id)));
    let mut rows = Vec::with_capacity(list.len());
    let mut instruments: Vec<BTreeSet<i64>> = Vec::with_capacity(list.len());
    for (meta, ledger) in &list {
        let summary = compute(ledger, query)?.summary;
        let r = replay(ledger)?;
        instruments.push(r.selected(query).iter().map(|c| c.facts.instrument_id).collect());
        rows.push(AccountRow {
            account_id: meta.id,
            name: meta.name.clone(),
            broker: meta.broker.clone(),
            currency: meta.currency.clone(),
            fees_per_trade: if summary.trade_count == 0 { None } else { summary.fees.checked_div(Decimal::from(summary.trade_count)) },
            fees_share_of_gross: if summary.gross_pnl > Decimal::ZERO { ratio(summary.fees, summary.gross_pnl) } else { None },
            low_sample: summary.trade_count < MIN_SAMPLE,
            summary,
        });
    }
    let mut hints = Vec::new();
    for i in 0..rows.len() {
        for j in i + 1..rows.len() {
            let (a, b) = (&rows[i], &rows[j]);
            let shared = instruments[i].intersection(&instruments[j]).count();
            if a.low_sample || b.low_sample || shared == 0 {
                continue;
            }
            if let (Some(fa), Some(fb)) = (a.fees_share_of_gross, b.fees_share_of_gross)
                && (fa - fb).abs() >= FEES_GAP_THRESHOLD - EPS
            {
                let (hi, lo) = if fa > fb { (a, b) } else { (b, a) };
                hints.push(AccountHint { kind: HintKind::Fees, account_id: hi.account_id, other_account_id: lo.account_id, gap: (fa - fb).abs(), shared_instruments: shared });
            }
            if a.summary.r_trade_count >= MIN_SAMPLE
                && b.summary.r_trade_count >= MIN_SAMPLE
                && let (Some(ra), Some(rb)) = (a.summary.expectancy_r, b.summary.expectancy_r)
                && (ra - rb).abs() >= R_GAP_THRESHOLD - EPS
            {
                let (lo, hi) = if ra < rb { (a, b) } else { (b, a) };
                hints.push(AccountHint { kind: HintKind::Execution, account_id: lo.account_id, other_account_id: hi.account_id, gap: (ra - rb).abs(), shared_instruments: shared });
            }
        }
    }
    hints.sort_by_key(|h| (h.kind, h.account_id, h.other_account_id));
    let currencies: Vec<String> = rows.iter().map(|r| r.currency.clone()).collect::<BTreeSet<_>>().into_iter().collect();
    Ok(AccountComparison {
        mixed_currencies: currencies.len() > 1,
        currencies,
        rows,
        min_sample: MIN_SAMPLE,
        fees_gap_threshold: FEES_GAP_THRESHOLD,
        r_gap_threshold: R_GAP_THRESHOLD,
        hints,
    })
}

/// Loads each selected account (all active accounts when the list is empty) on its own.
pub fn account_comparison(conn: &Connection, query: &StatsQuery) -> Result<AccountComparison> {
    let list = if query.account_ids.is_empty() {
        accounts::list_active(conn)?
    } else {
        query.account_ids.iter().map(|&id| accounts::get(conn, id)).collect::<Result<_>>()?
    };
    let mut loaded = Vec::with_capacity(list.len());
    for a in list {
        let ledger = load(conn, &[a.id])?;
        loaded.push((AccountRef { id: a.id, name: a.name, broker: a.broker, currency: a.currency }, ledger));
    }
    compare_accounts(&loaded, query)
}

// --- risk-per-trade benchmark (3.4.11) -------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RiskViolation {
    pub trade_id: i64,
    pub account_id: i64,
    pub symbol: String,
    pub direction: Direction,
    pub exit_time: i64,
    pub initial_risk: Decimal,
    pub balance_at_entry: Decimal,
    /// Risk / balance at entry (0.015 = 1.5 %).
    pub risk_pct: f64,
    /// The limit in money at the balance at entry.
    pub limit_amount: Decimal,
    /// `risk_pct` − limit, as a fraction (0.005 = half a point over).
    pub excess_pct: f64,
    /// `risk_pct` / limit (1.5 = 50 % above the limit).
    pub over_factor: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RiskMonth {
    /// "YYYY-MM", local exit month.
    pub key: String,
    pub evaluated_count: usize,
    pub over_count: usize,
    pub compliance_rate: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ComplianceTrend {
    NotEnoughData,
    Improving,
    Stable,
    Worsening,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RiskBenchmark {
    /// The user's limit in percent (1.5 = 1.5 %); `None` = no limit set, nothing evaluated.
    pub limit_percent: Option<Decimal>,
    /// Closed trades of the period.
    pub trade_count: usize,
    /// Trades with a limit, a valid stop and a positive balance at entry.
    pub evaluated_count: usize,
    pub without_stop_count: usize,
    pub respected_count: usize,
    pub over_count: usize,
    pub compliance_rate: Option<f64>,
    pub avg_risk_pct: Option<f64>,
    pub max_risk_pct: Option<f64>,
    pub trend: ComplianceTrend,
    /// Compliance of the older / recent half of the evaluated trades.
    pub older_rate: Option<f64>,
    pub recent_rate: Option<f64>,
    pub min_trend_trades: usize,
    /// One per local exit month holding an evaluated trade, in time order.
    pub months: Vec<RiskMonth>,
    /// Evaluated trades in exit order, for the chart.
    pub points: Vec<TradeRisk>,
    /// Trades over the limit, most recent first.
    pub violations: Vec<RiskViolation>,
}

fn rate(respected: usize, total: usize) -> Option<f64> {
    (total > 0).then(|| respected as f64 / total as f64)
}

pub fn risk_benchmark(ledger: &Ledger, query: &StatsQuery, settings: &BehaviorSettings) -> Result<RiskBenchmark> {
    let replay = replay(ledger)?;
    let selected = replay.selected(query);
    let report = risk::risk(ledger, query, settings)?;
    let limit = settings.max_risk_percent;
    let limit_fraction = limit.and_then(|l| l.to_f64()).map(|l| l / 100.0);
    let mut points = Vec::new();
    let mut violations = Vec::new();
    let mut months: BTreeMap<String, (usize, usize)> = BTreeMap::new();
    for (c, t) in selected.iter().zip(&report.trades) {
        let Some(ok) = t.within_limit else { continue };
        points.push(t.clone());
        let key = time::day_key(c.exit_time, c.facts.tz_offset_min)[..7].to_string();
        let m = months.entry(key).or_insert((0, 0));
        m.0 += 1;
        if ok {
            continue;
        }
        m.1 += 1;
        if let (Some(risk), Some(pct), Some(lf), Some(l)) = (t.initial_risk, t.risk_pct, limit_fraction, limit) {
            let limit_amount = checked(l.checked_mul(t.balance_at_entry).and_then(|v| v.checked_div(Decimal::ONE_HUNDRED)))?;
            violations.push(RiskViolation {
                trade_id: t.trade_id,
                account_id: c.facts.account_id,
                symbol: c.facts.symbol.clone(),
                direction: c.facts.position.direction,
                exit_time: t.exit_time,
                initial_risk: risk,
                balance_at_entry: t.balance_at_entry,
                risk_pct: pct,
                limit_amount,
                excess_pct: pct - lf,
                over_factor: pct / lf,
            });
        }
    }
    violations.reverse();
    let evaluated = points.len();
    let over = violations.len();
    // Halves of the evaluated trades in exit order; an odd count ignores the middle one.
    let half = evaluated / 2;
    let count_ok = |s: &[TradeRisk]| s.iter().filter(|t| t.within_limit == Some(true)).count();
    let (older_rate, recent_rate) = if evaluated >= MIN_TREND_TRADES {
        (rate(count_ok(&points[..half]), half), rate(count_ok(&points[evaluated - half..]), half))
    } else {
        (None, None)
    };
    let trend = match (older_rate, recent_rate) {
        (Some(o), Some(r)) if r - o >= TREND_GAP - EPS => ComplianceTrend::Improving,
        (Some(o), Some(r)) if o - r >= TREND_GAP - EPS => ComplianceTrend::Worsening,
        (Some(_), Some(_)) => ComplianceTrend::Stable,
        _ => ComplianceTrend::NotEnoughData,
    };
    Ok(RiskBenchmark {
        limit_percent: limit,
        trade_count: report.trade_count,
        evaluated_count: evaluated,
        without_stop_count: report.without_stop_count,
        respected_count: evaluated - over,
        over_count: over,
        compliance_rate: rate(evaluated - over, evaluated),
        avg_risk_pct: report.avg_risk_pct,
        max_risk_pct: report.max_risk_pct,
        trend,
        older_rate,
        recent_rate,
        min_trend_trades: MIN_TREND_TRADES,
        months: months
            .into_iter()
            .map(|(key, (n, o))| RiskMonth { key, evaluated_count: n, over_count: o, compliance_rate: rate(n - o, n) })
            .collect(),
        points,
        violations,
    })
}

pub fn risk_benchmark_report(conn: &Connection, query: &StatsQuery) -> Result<RiskBenchmark> {
    risk_benchmark(&load(conn, &query.account_ids)?, query, &settings::behavior(conn)?)
}

// --- exposure by asset class (3.7.9) ---------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExposureRow {
    pub asset_class: AssetClass,
    pub trade_count: usize,
    /// Trades with a valid stop, hence a known risk.
    pub risk_trade_count: usize,
    pub without_stop_count: usize,
    /// Sum of the initial risks, in the account currency.
    pub risk_amount: Decimal,
    /// `risk_amount` / total risk; `None` when the total is zero or no risk is known.
    pub share_of_risk: Option<f64>,
    /// Sum of each trade's risk in % of its balance at entry (0.035 = 3.5 %); `None` without one.
    pub risk_pct_of_capital: Option<f64>,
    /// Mean risk % per trade; `None` without one.
    pub avg_risk_pct: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExposureReport {
    pub currency: Option<String>,
    pub trade_count: usize,
    pub without_stop_count: usize,
    pub total_risk: Decimal,
    pub total_risk_pct: Option<f64>,
    /// Risk decreasing (ties: class name); only classes with a closed trade.
    pub rows: Vec<ExposureRow>,
}

#[derive(Default)]
struct Acc {
    trades: usize,
    with_risk: usize,
    without_stop: usize,
    amount: Decimal,
    pct_sum: f64,
    pct_n: usize,
}

pub fn exposure(ledger: &Ledger, query: &StatsQuery, settings: &BehaviorSettings) -> Result<ExposureReport> {
    let replay = replay(ledger)?;
    let selected = replay.selected(query);
    let report = risk::risk(ledger, query, settings)?;
    let mut by_class: BTreeMap<AssetClass, Acc> = BTreeMap::new();
    let mut total = Decimal::ZERO;
    let mut total_pct = 0.0;
    let mut total_pct_n = 0;
    for (c, t) in selected.iter().zip(&report.trades) {
        let a = by_class.entry(c.facts.asset_class).or_default();
        a.trades += 1;
        match t.initial_risk {
            Some(r) => {
                a.with_risk += 1;
                a.amount = checked(a.amount.checked_add(r))?;
                total = checked(total.checked_add(r))?;
            }
            None => a.without_stop += 1,
        }
        if let Some(p) = t.risk_pct {
            a.pct_sum += p;
            a.pct_n += 1;
            total_pct += p;
            total_pct_n += 1;
        }
    }
    let mut rows: Vec<ExposureRow> = by_class
        .into_iter()
        .map(|(asset_class, a)| ExposureRow {
            asset_class,
            trade_count: a.trades,
            risk_trade_count: a.with_risk,
            without_stop_count: a.without_stop,
            share_of_risk: if a.with_risk > 0 { ratio(a.amount, total) } else { None },
            risk_pct_of_capital: (a.pct_n > 0).then_some(a.pct_sum),
            avg_risk_pct: (a.pct_n > 0).then(|| a.pct_sum / a.pct_n as f64),
            risk_amount: a.amount,
        })
        .collect();
    rows.sort_by(|a, b| b.risk_amount.cmp(&a.risk_amount).then_with(|| a.asset_class.as_str().cmp(b.asset_class.as_str())));
    Ok(ExposureReport {
        currency: ledger.currency.clone(),
        trade_count: selected.len(),
        without_stop_count: report.without_stop_count,
        total_risk: total,
        total_risk_pct: (total_pct_n > 0).then_some(total_pct),
        rows,
    })
}

pub fn exposure_report(conn: &Connection, query: &StatsQuery) -> Result<ExposureReport> {
    exposure(&load(conn, &query.account_ids)?, query, &settings::behavior(conn)?)
}
