//! Aggregate indicators over a set of closed trades (glossary section 7).

use super::Closed;
use super::pnl::{Outcome, checked, ratio};
use super::time;
use crate::error::Result;
use crate::money::Decimal;
use serde::Serialize;
use std::collections::BTreeMap;

/// Undefined values are `None` (shown as "—"): e.g. no trade, or no loss for a
/// profit factor. When `profit_factor` is `None` but `total_gains > 0` and
/// `total_losses == 0`, the UI shows "∞".
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    /// Closed trades in the set.
    pub trade_count: usize,
    pub win_count: usize,
    pub loss_count: usize,
    pub breakeven_count: usize,
    /// PnL before fees.
    pub gross_pnl: Decimal,
    pub fees: Decimal,
    /// PnL after fees: the reference result.
    pub net_pnl: Decimal,
    /// Sum of the net PnL of winning trades (≥ 0).
    pub total_gains: Decimal,
    /// Sum of the net PnL of losing trades, as a positive amount.
    pub total_losses: Decimal,
    /// Time-weighted return of the set: Π(1 + rᵢ) − 1 (0.05 = +5 %).
    pub return_pct: Option<f64>,
    /// Winning trades / closed trades (breakevens count in the denominator).
    pub win_rate: Option<f64>,
    pub avg_win: Option<Decimal>,
    /// Average loss, as a positive amount.
    pub avg_loss: Option<Decimal>,
    /// Real R:R = average win / average loss.
    pub avg_win_loss_ratio: Option<f64>,
    /// Total gains / total losses.
    pub profit_factor: Option<f64>,
    /// Expectancy in R = WR × avg R of wins − LR × avg |R| of losses, over the
    /// `r_trade_count` trades that have a planned stop (equals their mean R).
    pub expectancy_r: Option<f64>,
    pub r_trade_count: usize,
    /// Expectancy in money: average net PnL per trade.
    pub avg_net_pnl: Option<Decimal>,
    /// (mean daily return − risk-free rate) / sample std-dev of daily returns,
    /// over local exit days with at least one trade; not annualized.
    pub sharpe: Option<f64>,
    /// Largest peak-to-trough fall of cumulative net PnL (≥ 0).
    pub max_drawdown: Decimal,
    /// Same on the time-weighted curve, as a fraction of the peak (0.1 = 10 %).
    pub max_drawdown_pct: Option<f64>,
    /// Fall from the last peak to now.
    pub current_drawdown: Decimal,
    pub current_drawdown_pct: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EquityPoint {
    pub trade_id: i64,
    /// Exit instant, Unix ms UTC.
    pub time: i64,
    /// Pure equity curve: cumulative net PnL, deposits and withdrawals excluded.
    pub cumulative_net_pnl: Decimal,
    /// Growth of 1 (1.05 = +5 %) on the time-weighted curve.
    pub growth: Option<f64>,
    pub drawdown: Decimal,
    pub drawdown_pct: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayResult {
    /// Local exit day, "YYYY-MM-DD".
    pub day: String,
    pub net_pnl: Decimal,
    pub trade_count: usize,
    pub win_count: usize,
    pub loss_count: usize,
}

pub(crate) struct Analysis {
    pub summary: Summary,
    pub curve: Vec<EquityPoint>,
    pub daily: Vec<DayResult>,
}

/// `set` must be in exit order (as produced by the replay).
pub(crate) fn analyze(set: &[&Closed], risk_free_daily: f64) -> Result<Analysis> {
    let zero = Decimal::ZERO;
    let (mut gross, mut fees, mut net, mut gains, mut losses) = (zero, zero, zero, zero, zero);
    let (mut wins, mut loss_count, mut breakevens) = (0usize, 0usize, 0usize);
    for c in set {
        let f = &c.figures;
        gross = checked(gross.checked_add(f.gross_pnl))?;
        fees = checked(fees.checked_add(f.fees))?;
        net = checked(net.checked_add(f.net_pnl))?;
        match f.outcome {
            Outcome::Win => {
                wins += 1;
                gains = checked(gains.checked_add(f.net_pnl))?;
            }
            Outcome::Loss => {
                loss_count += 1;
                losses = checked(losses.checked_sub(f.net_pnl))?;
            }
            Outcome::Breakeven => breakevens += 1,
        }
    }
    let n = set.len();
    let avg_win = average(gains, wins);
    let avg_loss = average(losses, loss_count);
    let (expectancy_r, r_trade_count) = expectancy_r(set);
    let (curve, dd) = equity_curve(set)?;
    let daily = daily(set)?;

    let summary = Summary {
        trade_count: n,
        win_count: wins,
        loss_count,
        breakeven_count: breakevens,
        gross_pnl: gross,
        fees,
        net_pnl: net,
        total_gains: gains,
        total_losses: losses,
        return_pct: dd.final_growth.map(|g| g - 1.0),
        win_rate: (n > 0).then(|| wins as f64 / n as f64),
        avg_win,
        avg_loss,
        avg_win_loss_ratio: avg_win.zip(avg_loss).and_then(|(w, l)| ratio(w, l)),
        profit_factor: ratio(gains, losses),
        expectancy_r,
        r_trade_count,
        avg_net_pnl: average(net, n),
        sharpe: sharpe(set, risk_free_daily),
        max_drawdown: dd.max,
        max_drawdown_pct: dd.max_pct,
        current_drawdown: dd.current,
        current_drawdown_pct: dd.current_pct,
    };
    Ok(Analysis { summary, curve, daily })
}

fn average(total: Decimal, count: usize) -> Option<Decimal> {
    if count == 0 { None } else { total.checked_div(Decimal::from(count)) }
}

/// Glossary: (win rate × average R of wins) − (loss rate × average |R| of losses),
/// on the trades that have an R. Rates use that same population.
fn expectancy_r(set: &[&Closed]) -> (Option<f64>, usize) {
    let rs: Vec<f64> = set.iter().filter_map(|c| c.figures.r_multiple).collect();
    if rs.is_empty() {
        return (None, 0);
    }
    let n = rs.len() as f64;
    let wins: Vec<f64> = rs.iter().copied().filter(|r| *r > 0.0).collect();
    let losses: Vec<f64> = rs.iter().copied().filter(|r| *r < 0.0).map(f64::abs).collect();
    let mean = |v: &[f64]| if v.is_empty() { 0.0 } else { v.iter().sum::<f64>() / v.len() as f64 };
    let win_rate = wins.len() as f64 / n;
    let loss_rate = losses.len() as f64 / n;
    (Some(win_rate * mean(&wins) - loss_rate * mean(&losses)), rs.len())
}

struct Drawdowns {
    max: Decimal,
    current: Decimal,
    max_pct: Option<f64>,
    current_pct: Option<f64>,
    final_growth: Option<f64>,
}

/// Cumulative net PnL (starting at 0) and the time-weighted growth curve
/// (starting at 1); drawdowns are measured from the running peak, the
/// starting point included.
fn equity_curve(set: &[&Closed]) -> Result<(Vec<EquityPoint>, Drawdowns)> {
    let mut cumulative = Decimal::ZERO;
    let mut peak = Decimal::ZERO;
    let mut max = Decimal::ZERO;
    let mut growth = Some(1.0_f64);
    let mut growth_peak = 1.0_f64;
    let mut max_pct = 0.0_f64;
    let mut points = Vec::with_capacity(set.len());
    for c in set {
        cumulative = checked(cumulative.checked_add(c.figures.net_pnl))?;
        peak = peak.max(cumulative);
        let drawdown = checked(peak.checked_sub(cumulative))?;
        max = max.max(drawdown);
        growth = growth.zip(c.ret).map(|(g, r)| g * (1.0 + r));
        let drawdown_pct = growth.map(|g| {
            growth_peak = growth_peak.max(g);
            1.0 - g / growth_peak
        });
        if let Some(p) = drawdown_pct {
            max_pct = max_pct.max(p);
        }
        points.push(EquityPoint {
            trade_id: c.facts.id,
            time: c.exit_time,
            cumulative_net_pnl: cumulative,
            growth,
            drawdown,
            drawdown_pct,
        });
    }
    let defined = !set.is_empty() && growth.is_some();
    Ok((
        points,
        Drawdowns {
            max,
            current: checked(peak.checked_sub(cumulative))?,
            max_pct: defined.then_some(max_pct),
            current_pct: growth.filter(|_| defined).map(|g| 1.0 - g / growth_peak),
            final_growth: growth.filter(|_| defined),
        },
    ))
}

fn daily(set: &[&Closed]) -> Result<Vec<DayResult>> {
    let mut days: BTreeMap<String, DayResult> = BTreeMap::new();
    for c in set {
        let key = time::day_key(c.exit_time, c.facts.tz_offset_min);
        let d = days.entry(key.clone()).or_insert_with(|| DayResult {
            day: key,
            net_pnl: Decimal::ZERO,
            trade_count: 0,
            win_count: 0,
            loss_count: 0,
        });
        d.net_pnl = checked(d.net_pnl.checked_add(c.figures.net_pnl))?;
        d.trade_count += 1;
        match c.figures.outcome {
            Outcome::Win => d.win_count += 1,
            Outcome::Loss => d.loss_count += 1,
            Outcome::Breakeven => {}
        }
    }
    Ok(days.into_values().collect())
}

/// Daily returns: the trades of a local exit day chained, Π(1 + rᵢ) − 1.
fn sharpe(set: &[&Closed], risk_free_daily: f64) -> Option<f64> {
    let mut days: BTreeMap<String, f64> = BTreeMap::new();
    for c in set {
        let growth = days.entry(time::day_key(c.exit_time, c.facts.tz_offset_min)).or_insert(1.0);
        *growth *= 1.0 + c.ret?;
    }
    let returns: Vec<f64> = days.into_values().map(|g| g - 1.0).collect();
    if returns.len() < 2 {
        return None;
    }
    let n = returns.len() as f64;
    let mean = returns.iter().sum::<f64>() / n;
    let variance = returns.iter().map(|r| (r - mean).powi(2)).sum::<f64>() / (n - 1.0);
    let sd = variance.sqrt();
    // Below 1e-12 the spread is rounding noise: identical returns have no Sharpe.
    (sd > 1e-12 && sd.is_finite()).then(|| (mean - risk_free_daily) / sd)
}
