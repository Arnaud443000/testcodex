//! Trend insights (spec 3.5.1): progressive drifts over the last trades, and
//! dangerous patterns repeated over the analysis window. Each series is read
//! from an existing report (risk %, discipline score, fees, rule adherence,
//! size change, patterns); only the averaging over the two halves is done here.

use super::{Drift, EPSILON, Half, InsightDetail, InsightPeriod, PeriodBasis, Priority, Scope, Source, TREND_MIN_HALF, TREND_WINDOW, level};
use super::{EvidenceFilter, Insight};
use crate::behavior::{self, ComponentKey, MIN_SCORED_TRADES, MistakeSource};
use crate::error::Result;
use crate::money::Decimal;
use crate::stats::analyses::{self, FeeGranularity, SCALING_VERDICT_BAND};
use crate::stats::pnl::{checked, ratio};
use crate::stats::{StatsQuery, replay, risk};
use std::collections::HashMap;

/// Minimum gap of the discipline score between the halves, in points (the lot 8 bis gap).
pub const DISCIPLINE_TREND_GAP: f64 = behavior::DISCIPLINE_GAP;
/// A drop of the plan component of at least this much (0.25 = 25 points).
pub const PLAN_DROP: f64 = 0.25;
/// A rise of the mean fees per trade of at least this much (0.25 = +25 %).
pub const FEES_UP: f64 = 0.25;
/// A rule needs this many checks in the window before its trend is an insight.
pub const RULE_MIN_CHECKS: usize = 10;
/// A drop of a rule's adherence of at least this much (0.25 = 25 points).
pub const RULE_DROP: f64 = 0.25;
/// At most this many rules are reported.
pub const MAX_RULES: usize = 2;
/// Mean exposure change after a loss, and its gap with after a win, from this much.
pub const SIZE_AFTER_LOSS: f64 = 0.20;
/// Revenge trades or overtrading days needed in the window.
pub const PATTERN_MIN_COUNT: usize = 2;

/// The trend window: the last closed trades of the account in exit order, and its two halves.
struct Window {
    ids: Vec<i64>,
    exits: HashMap<i64, i64>,
    older: Vec<i64>,
    recent: Vec<i64>,
}

impl Window {
    fn of(scope: &Scope) -> Result<Option<Window>> {
        let r = replay(scope.ledger)?;
        let last: Vec<_> = r.closed.iter().skip(r.closed.len().saturating_sub(TREND_WINDOW)).collect();
        let half = last.len() / 2;
        if half < TREND_MIN_HALF {
            return Ok(None);
        }
        let ids: Vec<i64> = last.iter().map(|c| c.facts.id).collect();
        Ok(Some(Window {
            exits: last.iter().map(|c| (c.facts.id, c.exit_time)).collect(),
            // With an odd count the trade in the middle belongs to neither half.
            older: ids[..half].to_vec(),
            recent: ids[ids.len() - half..].to_vec(),
            ids,
        }))
    }

    /// Reports only need the trades closed from the window's first exit on (a superset of the window).
    fn query(&self, scope: &Scope) -> StatsQuery {
        StatsQuery { account_ids: vec![scope.account_id], from: Some(self.exits[&self.ids[0]]), ..StatsQuery::default() }
    }

    fn period(&self) -> InsightPeriod {
        InsightPeriod {
            basis: PeriodBasis::LastTrades,
            from: Some(self.exits[&self.ids[0]]),
            to: Some(self.exits[&self.ids[self.ids.len() - 1]]),
            trade_count: self.ids.len(),
            days: None,
        }
    }

    fn half(&self, ids: &[i64], value_count: usize) -> Half {
        Half { trade_count: ids.len(), value_count, from: self.exits[&ids[0]], to: self.exits[&ids[ids.len() - 1]], trade_ids: ids.to_vec() }
    }

    /// Mean of the values of each half, when both have at least `min` of them.
    fn means(&self, values: &HashMap<i64, f64>, min: usize) -> Option<((f64, usize), (f64, usize))> {
        let mean = |ids: &[i64]| {
            let v: Vec<f64> = ids.iter().filter_map(|id| values.get(id).copied()).collect();
            (v.len() >= min).then(|| (v.iter().sum::<f64>() / v.len() as f64, v.len()))
        };
        mean(&self.older).zip(mean(&self.recent))
    }
}

/// Exact mean of the amounts of `ids` found in `values`.
fn mean_amount(ids: &[i64], values: &HashMap<i64, Decimal>) -> Result<Decimal> {
    let (mut total, mut n) = (Decimal::ZERO, 0u32);
    for v in ids.iter().filter_map(|id| values.get(id)) {
        total = checked(total.checked_add(*v))?;
        n += 1;
    }
    if n == 0 { Ok(Decimal::ZERO) } else { checked(total.checked_div(Decimal::from(n))) }
}

pub(super) fn collect(scope: &Scope, out: &mut Vec<Insight>) -> Result<()> {
    if let Some(w) = Window::of(scope)? {
        risk_drift(scope, &w, out)?;
        discipline(scope, &w, out)?;
        fees(scope, &w, out)?;
    }
    rules(scope, out)?;
    size_after_loss(scope, out)?;
    patterns(scope, out)?;
    Ok(())
}

/// Mean risk in % of capital (the lot-8 risk report, as in the scaling of lot 16).
fn risk_drift(scope: &Scope, w: &Window, out: &mut Vec<Insight>) -> Result<()> {
    let report = risk::risk(scope.ledger, &w.query(scope), scope.settings)?;
    let pct: HashMap<i64, f64> = report.trades.iter().filter_map(|t| Some((t.trade_id, t.risk_pct?))).collect();
    let money: HashMap<i64, Decimal> =
        report.trades.iter().filter(|t| t.risk_pct.is_some()).filter_map(|t| Some((t.trade_id, t.initial_risk?))).collect();
    let Some(((older, n_older), (recent, n_recent))) = w.means(&pct, TREND_MIN_HALF) else { return Ok(()) };
    if older <= 0.0 {
        return Ok(());
    }
    let change = recent / older - 1.0;
    let direction = if change >= SCALING_VERDICT_BAND - EPSILON {
        Drift::Up
    } else if change <= -SCALING_VERDICT_BAND + EPSILON {
        Drift::Down
    } else {
        return Ok(());
    };
    let (older_avg_risk, recent_avg_risk) = (mean_amount(&w.older, &money)?, mean_amount(&w.recent, &money)?);
    let risk_change = ratio(checked(recent_avg_risk.checked_sub(older_avg_risk))?, older_avg_risk);
    let (priority, key) = match direction {
        Drift::Up => (Priority::High, "riskDrift.up"),
        Drift::Down => (Priority::Low, "riskDrift.down"),
    };
    let detail = InsightDetail::RiskDrift {
        direction,
        older: w.half(&w.older, n_older),
        recent: w.half(&w.recent, n_recent),
        older_avg_risk_pct: older,
        recent_avg_risk_pct: recent,
        change,
        older_avg_risk,
        recent_avg_risk,
        risk_change,
        threshold: SCALING_VERDICT_BAND,
    };
    out.push(scope.insight(priority, key, direction.as_str(), level(change, 0.10), w.period(), Source::Risk, w.ids.clone(), None, detail, 0));
    Ok(())
}

/// Mean discipline score, and mean plan component, of each half (the lot-8 discipline report).
fn discipline(scope: &Scope, w: &Window, out: &mut Vec<Insight>) -> Result<()> {
    let report = behavior::discipline(scope.ledger, &w.query(scope), scope.settings)?;
    let scores: HashMap<i64, f64> = report.trades.iter().filter_map(|t| Some((t.trade_id, t.score?))).collect();
    let plan: HashMap<i64, f64> = report
        .trades
        .iter()
        .filter_map(|t| Some((t.trade_id, t.components.iter().find(|c| c.key == ComponentKey::Plan)?.value?)))
        .collect();

    if let Some(((older, n_older), (recent, n_recent))) = w.means(&scores, MIN_SCORED_TRADES.max(TREND_MIN_HALF)) {
        let difference = recent - older;
        let direction = if difference <= -DISCIPLINE_TREND_GAP + EPSILON {
            Some(Drift::Down)
        } else if difference >= DISCIPLINE_TREND_GAP - EPSILON {
            Some(Drift::Up)
        } else {
            None
        };
        if let Some(direction) = direction {
            let (priority, key) = match direction {
                Drift::Down => (Priority::High, "disciplineTrend.down"),
                Drift::Up => (Priority::Low, "disciplineTrend.up"),
            };
            let detail = InsightDetail::DisciplineTrend {
                direction,
                older: w.half(&w.older, n_older),
                recent: w.half(&w.recent, n_recent),
                older_score: older,
                recent_score: recent,
                difference,
                threshold: DISCIPLINE_TREND_GAP,
            };
            let lvl = level(difference, 10.0);
            out.push(scope.insight(priority, key, direction.as_str(), lvl, w.period(), Source::Discipline, w.ids.clone(), None, detail, 0));
        }
    }

    if let Some(((older, n_older), (recent, n_recent))) = w.means(&plan, TREND_MIN_HALF) {
        let difference = recent - older;
        if difference <= -PLAN_DROP + EPSILON {
            let detail = InsightDetail::PlanDrop {
                older: w.half(&w.older, n_older),
                recent: w.half(&w.recent, n_recent),
                older_rate: older,
                recent_rate: recent,
                difference,
                threshold: PLAN_DROP,
            };
            let lvl = level(difference, 0.10);
            out.push(scope.insight(Priority::Medium, "planDrop", "plan", lvl, w.period(), Source::Discipline, w.ids.clone(), None, detail, 0));
        }
    }
    Ok(())
}

/// Mean fees per trade of each half, from the fee report's cumulative curve.
fn fees(scope: &Scope, w: &Window, out: &mut Vec<Insight>) -> Result<()> {
    let report = analyses::fees(scope.ledger, &w.query(scope), FeeGranularity::Month)?;
    let mut per_trade = HashMap::with_capacity(report.curve.len());
    let mut previous = Decimal::ZERO;
    for p in &report.curve {
        per_trade.insert(p.trade_id, checked(p.cumulative_fees.checked_sub(previous))?);
        previous = p.cumulative_fees;
    }
    let (older, recent) = (mean_amount(&w.older, &per_trade)?, mean_amount(&w.recent, &per_trade)?);
    // Every trade has fees (0 included), and each half holds at least TREND_MIN_HALF trades.
    if older <= Decimal::ZERO {
        return Ok(());
    }
    let Some(change) = ratio(checked(recent.checked_sub(older))?, older) else { return Ok(()) };
    if change < FEES_UP - EPSILON {
        return Ok(());
    }
    let detail = InsightDetail::FeesUp {
        older: w.half(&w.older, w.older.len()),
        recent: w.half(&w.recent, w.recent.len()),
        older_avg_fees: older,
        recent_avg_fees: recent,
        change,
        threshold: FEES_UP,
    };
    out.push(scope.insight(Priority::Medium, "feesUp", "fees", level(change, FEES_UP), w.period(), Source::Fees, w.ids.clone(), None, detail, 0));
    Ok(())
}

/// Rules whose adherence trend (lot 8) drops, with enough checks in the analysis window.
fn rules(scope: &Scope, out: &mut Vec<Insight>) -> Result<()> {
    let report = behavior::rule_adherence(scope.ledger, &scope.analysis, scope.rules)?;
    let mut drops: Vec<(f64, &behavior::RuleAdherence)> = report
        .rules
        .iter()
        .filter(|r| r.checks >= RULE_MIN_CHECKS)
        .filter_map(|r| Some((r.trend?, r)))
        .filter(|(trend, _)| *trend <= -RULE_DROP + EPSILON)
        .collect();
    // Strongest drop first; the sort is stable, so ties keep the rule list order.
    drops.sort_by(|a, b| a.0.total_cmp(&b.0));
    let r = replay(scope.ledger)?;
    let selected = r.selected(&scope.analysis);
    for (order, (trend, rule)) in drops.into_iter().take(MAX_RULES).enumerate() {
        let trade_ids =
            selected.iter().filter(|c| c.facts.journal.rule_checks.iter().any(|k| k.rule_id == rule.rule_id)).map(|c| c.facts.id).collect();
        let detail = InsightDetail::RuleAdherenceDrop {
            rule_id: rule.rule_id,
            text: rule.text.clone(),
            checks: rule.checks,
            respected: rule.respected,
            rate: rule.rate,
            trend,
            threshold: RULE_DROP,
            min_checks: RULE_MIN_CHECKS,
        };
        let filter = Some(EvidenceFilter::Mistake { source: MistakeSource::Rule, id: rule.rule_id });
        let period = scope.analysis_period(selected.len());
        let subject = rule.rule_id.to_string();
        out.push(scope.insight(Priority::Medium, "ruleAdherenceDrop", &subject, level(trend, 0.10), period, Source::RuleAdherence, trade_ids, filter, detail, order));
    }
    Ok(())
}

/// Exposure after a loss against after a win (lot 8 bis size change).
fn size_after_loss(scope: &Scope, out: &mut Vec<Insight>) -> Result<()> {
    let r = behavior::size_change(scope.ledger, &scope.analysis, scope.settings)?;
    let (Some(after_loss), Some(after_win), Some(gap)) = (r.after_loss.mean_change, r.after_win.mean_change, r.loss_vs_win) else {
        return Ok(());
    };
    if after_loss < SIZE_AFTER_LOSS - EPSILON || gap < SIZE_AFTER_LOSS - EPSILON {
        return Ok(());
    }
    let detail = InsightDetail::SizeUpAfterLoss {
        after_loss_mean: after_loss,
        after_loss_median: r.after_loss.median_change,
        after_win_mean: after_win,
        loss_vs_win: gap,
        after_loss_cases: r.after_loss.case_count,
        after_win_cases: r.after_win.case_count,
        increased_count: r.after_loss.increased_count,
        threshold: SIZE_AFTER_LOSS,
    };
    let trade_ids = r.after_loss.cases.iter().map(|c| c.trade_id).collect();
    let period = scope.analysis_period(r.trade_count);
    out.push(scope.insight(Priority::High, "sizeUpAfterLoss", "afterLoss", level(gap, 0.10), period, Source::SizeChange, trade_ids, None, detail, 0));
    Ok(())
}

/// Revenge trades and overtrading days repeated over the analysis window (lot 8 patterns).
fn patterns(scope: &Scope, out: &mut Vec<Insight>) -> Result<()> {
    let p = behavior::patterns(scope.ledger, &[], &scope.analysis, scope.settings)?;
    let trade_count = replay(scope.ledger)?.selected(&scope.analysis).len();
    let count = p.revenge_trades.len();
    if count >= PATTERN_MIN_COUNT {
        let detail = InsightDetail::RevengePattern {
            count,
            net_pnl: p.revenge_summary.net_pnl,
            win_rate: p.revenge_summary.win_rate,
            window_min: scope.settings.revenge_window_min,
            size_factor: scope.settings.revenge_size_factor,
            min_count: PATTERN_MIN_COUNT,
        };
        let trade_ids = p.revenge_trades.iter().map(|t| t.trade_id).collect();
        let period = scope.analysis_period(trade_count);
        out.push(scope.insight(Priority::High, "revengePattern", "revenge", count as u32, period, Source::Patterns, trade_ids, None, detail, 0));
    }
    if let (Some(limit), true) = (p.max_trades_per_day, p.overtrading_days.len() >= PATTERN_MIN_COUNT) {
        let trade_ids: Vec<i64> = p.overtrading_days.iter().flat_map(|d| d.trade_ids.iter().copied()).collect();
        let day_count = p.overtrading_days.len();
        let detail = InsightDetail::OvertradingPattern {
            day_count,
            limit,
            days: p.overtrading_days.iter().map(|d| d.day.clone()).collect(),
            trade_count: trade_ids.len(),
            min_count: PATTERN_MIN_COUNT,
        };
        let period = scope.analysis_period(trade_count);
        out.push(scope.insight(Priority::Medium, "overtradingPattern", "overtrading", day_count as u32, period, Source::Patterns, trade_ids, None, detail, 0));
    }
    Ok(())
}
