//! Discipline score (spec 3.4.1) and computed execution quality (3.2.9).
//!
//! Score of a trade = 100 × Σ(weight × value) / Σ(weight) over the components
//! that have data; a component without data is left out and the weights are
//! renormalized, it never counts as 0. See CLAUDE.md for each component.

use super::{Context, Revenge};
use crate::error::{CoreError, Result};
use crate::money::Decimal;
use crate::settings::{self, BehaviorSettings};
use crate::stats::pnl::{Outcome, checked};
use crate::stats::risk;
use crate::stats::{Closed, Ledger, StatsQuery, TradeFacts, load, time};
use crate::trades::PlanFollowed;
use rusqlite::{Connection, OptionalExtension};
use serde::Serialize;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ComponentKey {
    /// Declared plan compliance: yes 1, partial 0.5, no 0.
    Plan,
    /// Personal rules respected / rules ticked on the trade.
    Rules,
    /// Checklist lines ticked / lines of the trade's copy.
    Checklist,
    /// A valid planned stop loss exists.
    StopLoss,
    /// Initial risk within the user's limit, in % of the balance at entry.
    Risk,
    /// Neither a revenge trade nor beyond the daily trade limit.
    Behavior,
}

/// Weights, in display order; they sum to 100.
pub const WEIGHTS: [(ComponentKey, u32); 6] = [
    (ComponentKey::Plan, 30),
    (ComponentKey::Rules, 25),
    (ComponentKey::Checklist, 15),
    (ComponentKey::StopLoss, 10),
    (ComponentKey::Risk, 10),
    (ComponentKey::Behavior, 10),
];

/// Below this many scored trades, a period or group score is `None`.
pub const MIN_SCORED_TRADES: usize = 5;
/// From this score a trade counts as well executed (spec 3.2.9).
pub const WELL_EXECUTED_SCORE: f64 = 70.0;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Component {
    pub key: ComponentKey,
    pub weight: u32,
    /// From 0 to 1; `None` when the trade has no data for it (left out of the score).
    pub value: Option<f64>,
}

/// Score from 0 to 100 and coverage (share of the weights that had data, 0 to 1).
/// `None` when no component has data.
pub fn score(components: &[Component]) -> (Option<f64>, f64) {
    let (mut weights, mut points) = (0u32, 0.0_f64);
    for c in components {
        if let Some(v) = c.value {
            weights += c.weight;
            points += f64::from(c.weight) * v;
        }
    }
    let total: u32 = components.iter().map(|c| c.weight).sum();
    let coverage = if total == 0 { 0.0 } else { f64::from(weights) / f64::from(total) };
    ((weights > 0).then(|| 100.0 * points / f64::from(weights)), coverage)
}

/// The score of one trade and everything it is made of.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TradeDiscipline {
    pub trade_id: i64,
    pub account_id: i64,
    pub entry_time: i64,
    /// `None` while the trade is open.
    pub exit_time: Option<i64>,
    /// Local exit day "YYYY-MM-DD"; `None` while open.
    pub day: Option<String>,
    pub net_pnl: Option<Decimal>,
    pub outcome: Option<Outcome>,
    pub score: Option<f64>,
    pub coverage: f64,
    pub components: Vec<Component>,
    pub plan_followed: Option<PlanFollowed>,
    pub rules_checked: usize,
    pub rules_respected: usize,
    pub checklist_total: usize,
    pub checklist_checked: usize,
    pub has_stop_loss: bool,
    /// Initial risk / balance at entry (0.01 = 1 %).
    pub risk_pct: Option<f64>,
    pub max_risk_percent: Option<Decimal>,
    pub revenge: Option<Revenge>,
    pub overtrading: bool,
    /// 1 = first trade entered on its local day on its account.
    pub day_rank: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ComponentSummary {
    pub key: ComponentKey,
    pub weight: u32,
    /// Trades that had data for this component.
    pub trade_count: usize,
    /// Mean value over those trades (0 to 1).
    pub average: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayDiscipline {
    /// Local exit day "YYYY-MM-DD".
    pub day: String,
    pub trade_count: usize,
    /// Mean trade score of the day (no minimum sample).
    pub score: Option<f64>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Quadrant {
    pub count: usize,
    pub net_pnl: Decimal,
}

/// Result against execution (spec 3.2.9): "winning but badly executed" and
/// "losing but well executed" must be visible.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Quadrants {
    pub threshold: f64,
    pub well_executed_wins: Quadrant,
    pub poorly_executed_wins: Quadrant,
    pub well_executed_losses: Quadrant,
    pub poorly_executed_losses: Quadrant,
    pub breakevens: Quadrant,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisciplineReport {
    /// Mean trade score of the period; `None` below [`MIN_SCORED_TRADES`].
    pub score: Option<f64>,
    pub scored_trade_count: usize,
    pub min_trade_count: usize,
    pub sample_too_small: bool,
    pub components: Vec<ComponentSummary>,
    pub days: Vec<DayDiscipline>,
    pub quadrants: Quadrants,
    /// Closed trades of the period, in exit order.
    pub trades: Vec<TradeDiscipline>,
    pub settings: BehaviorSettings,
}

pub(crate) fn of_trade(ctx: &Context, t: &TradeFacts) -> Result<TradeDiscipline> {
    let j = &t.journal;
    let settings = &ctx.settings;
    let plan = j.plan_followed.map(|p| match p {
        PlanFollowed::Yes => 1.0,
        PlanFollowed::Partial => 0.5,
        PlanFollowed::No => 0.0,
    });
    let rules_respected = j.rule_checks.iter().filter(|r| r.respected).count();
    let fraction = |part: usize, whole: usize| (whole > 0).then(|| part as f64 / whole as f64);
    let initial_risk = risk::initial_risk(t)?;
    let balance = ctx.balance_at_entry(t)?;
    let within = risk::within_limit(initial_risk, balance, settings.max_risk_percent)?;
    let revenge = ctx.revenge(t)?;
    let overtrading = ctx.overtrading(t.id);
    let value = |key: ComponentKey| match key {
        ComponentKey::Plan => plan,
        ComponentKey::Rules => fraction(rules_respected, j.rule_checks.len()),
        ComponentKey::Checklist => fraction(j.checklist_checked, j.checklist_total),
        ComponentKey::StopLoss => Some(if initial_risk.is_some() { 1.0 } else { 0.0 }),
        ComponentKey::Risk => within.map(|ok| if ok { 1.0 } else { 0.0 }),
        ComponentKey::Behavior => Some(if revenge.is_some() || overtrading { 0.0 } else { 1.0 }),
    };
    let components: Vec<Component> = WEIGHTS.iter().map(|&(key, weight)| Component { key, weight, value: value(key) }).collect();
    let (score, coverage) = score(&components);
    let closed = ctx.closed(t.id);
    Ok(TradeDiscipline {
        trade_id: t.id,
        account_id: t.account_id,
        entry_time: t.entry_time,
        exit_time: closed.map(|c| c.exit_time),
        day: closed.map(|c| time::day_key(c.exit_time, t.tz_offset_min)),
        net_pnl: closed.map(|c| c.figures.net_pnl),
        outcome: closed.map(|c| c.figures.outcome),
        score,
        coverage,
        components,
        plan_followed: j.plan_followed,
        rules_checked: j.rule_checks.len(),
        rules_respected,
        checklist_total: j.checklist_total,
        checklist_checked: j.checklist_checked,
        has_stop_loss: initial_risk.is_some(),
        risk_pct: risk::risk_fraction(initial_risk, balance),
        max_risk_percent: settings.max_risk_percent,
        revenge,
        overtrading,
        day_rank: ctx.day_rank(t.id),
    })
}

/// Mean of the scores; `None` below [`MIN_SCORED_TRADES`] scored trades.
pub(crate) fn mean_score<'x>(scores: impl Iterator<Item = &'x TradeDiscipline>) -> (Option<f64>, usize) {
    let values: Vec<f64> = scores.filter_map(|t| t.score).collect();
    let n = values.len();
    let mean = (n >= MIN_SCORED_TRADES).then(|| values.iter().sum::<f64>() / n as f64);
    (mean, n)
}

/// Scores of the given closed trades, in the same order.
pub(crate) fn of_closed(ctx: &Context, set: &[&Closed]) -> Result<Vec<TradeDiscipline>> {
    set.iter().map(|c| of_trade(ctx, c.facts)).collect()
}

pub fn discipline(ledger: &Ledger, query: &StatsQuery, settings: &BehaviorSettings) -> Result<DisciplineReport> {
    let ctx = Context::new(ledger, settings.clone())?;
    let trades = of_closed(&ctx, &ctx.replay.selected(query))?;
    let (score, scored_trade_count) = mean_score(trades.iter());

    let components = WEIGHTS
        .iter()
        .enumerate()
        .map(|(i, &(key, weight))| {
            let values: Vec<f64> = trades.iter().filter_map(|t| t.components[i].value).collect();
            let average = (!values.is_empty()).then(|| values.iter().sum::<f64>() / values.len() as f64);
            ComponentSummary { key, weight, trade_count: values.len(), average }
        })
        .collect();

    let mut by_day: BTreeMap<&str, (usize, Vec<f64>)> = BTreeMap::new();
    for t in &trades {
        let (count, scores) = by_day.entry(t.day.as_deref().unwrap_or_default()).or_default();
        *count += 1;
        scores.extend(t.score);
    }
    let days = by_day
        .into_iter()
        .map(|(day, (trade_count, scores))| DayDiscipline {
            day: day.to_string(),
            trade_count,
            score: (!scores.is_empty()).then(|| scores.iter().sum::<f64>() / scores.len() as f64),
        })
        .collect();

    let mut quadrants = Quadrants { threshold: WELL_EXECUTED_SCORE, ..Quadrants::default() };
    for t in &trades {
        let well = t.score.is_some_and(|s| s >= WELL_EXECUTED_SCORE);
        let q = match (t.outcome, well) {
            (Some(Outcome::Win), true) => &mut quadrants.well_executed_wins,
            (Some(Outcome::Win), false) => &mut quadrants.poorly_executed_wins,
            (Some(Outcome::Loss), true) => &mut quadrants.well_executed_losses,
            (Some(Outcome::Loss), false) => &mut quadrants.poorly_executed_losses,
            _ => &mut quadrants.breakevens,
        };
        q.count += 1;
        q.net_pnl = checked(q.net_pnl.checked_add(t.net_pnl.unwrap_or_default()))?;
    }

    Ok(DisciplineReport {
        score,
        scored_trade_count,
        min_trade_count: MIN_SCORED_TRADES,
        sample_too_small: score.is_none(),
        components,
        days,
        quadrants,
        trades,
        settings: settings.clone(),
    })
}

/// Loads the selected accounts and the user's thresholds, then scores the period.
pub fn discipline_report(conn: &Connection, query: &StatsQuery) -> Result<DisciplineReport> {
    discipline(&load(conn, &query.account_ids)?, query, &settings::behavior(conn)?)
}

/// Score of one trade (open or closed), against the history of its own account.
pub fn trade_discipline(conn: &Connection, trade_id: i64) -> Result<TradeDiscipline> {
    let account: i64 = conn
        .query_row("SELECT account_id FROM trades WHERE id = ?1", [trade_id], |r| r.get(0))
        .optional()?
        .ok_or_else(|| CoreError::NotFound(format!("trade {trade_id}")))?;
    let ledger = load(conn, &[account])?;
    let ctx = Context::new(&ledger, settings::behavior(conn)?)?;
    let facts = ledger.trades.iter().find(|t| t.id == trade_id).ok_or_else(|| CoreError::NotFound(format!("trade {trade_id}")))?;
    of_trade(&ctx, facts)
}
