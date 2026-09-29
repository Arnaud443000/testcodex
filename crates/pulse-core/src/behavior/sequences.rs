//! What the trader does right after losing: results of the trades entered
//! after two losses in a row, and how exposure changes after a loss compared
//! with after a win. See CLAUDE.md, "Compléments du moteur (lot 8 bis)".

use super::discipline::{TradeDiscipline, mean_score, of_closed};
use super::{Context, ExposureBasis, exposures};
use crate::error::Result;
use crate::money::Decimal;
use crate::settings::{self, BehaviorSettings};
use crate::stats::distribution::median;
use crate::stats::pnl::{self, Outcome, checked};
use crate::stats::summary::{Summary, analyze};
use crate::stats::{Closed, Ledger, StatsQuery, TradeFacts, load};
use rusqlite::Connection;
use serde::Serialize;

/// Below this many trades in either group, the "after two losses" gaps are `None`.
pub const MIN_SEQUENCE_TRADES: usize = 5;
/// Below this many comparable cases, a mean or median size change is `None`.
pub const MIN_SIZE_CASES: usize = 5;

impl Context<'_> {
    /// The two last trades of the account at `t`'s entry are both losses.
    fn after_two_losses(&self, t: &TradeFacts) -> bool {
        let last: Vec<Outcome> = self.history(t).take(2).map(|c| c.figures.outcome).collect();
        last == [Outcome::Loss, Outcome::Loss]
    }
}

// --- After two losses ------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SequenceGroup {
    pub summary: Summary,
    /// Mean discipline score; `None` below 5 scored trades.
    pub discipline_score: Option<f64>,
    pub scored_trade_count: usize,
    /// In exit order.
    pub trade_ids: Vec<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AfterLossesReport {
    /// Trades whose account's two last closed trades at entry were losses.
    pub after_two_losses: SequenceGroup,
    /// Every other trade of the selection.
    pub others: SequenceGroup,
    pub min_trade_count: usize,
    /// A group has fewer than [`MIN_SEQUENCE_TRADES`] trades: every gap is `None`.
    pub sample_too_small: bool,
    /// Gaps: after two losses − others.
    pub win_rate_difference: Option<f64>,
    pub avg_net_pnl_difference: Option<Decimal>,
    /// Also needs 5 trades with an R on each side.
    pub expectancy_r_difference: Option<f64>,
    /// Also needs 5 scored trades on each side.
    pub discipline_difference: Option<f64>,
}

fn group(trades: &[&Closed], scores: &[&TradeDiscipline], risk_free_daily: f64) -> Result<SequenceGroup> {
    let (discipline_score, scored_trade_count) = mean_score(scores.iter().copied());
    Ok(SequenceGroup {
        summary: analyze(trades, risk_free_daily)?.summary,
        discipline_score,
        scored_trade_count,
        trade_ids: trades.iter().map(|c| c.facts.id).collect(),
    })
}

pub fn after_losses(ledger: &Ledger, query: &StatsQuery, settings: &BehaviorSettings) -> Result<AfterLossesReport> {
    let ctx = Context::new(ledger, settings.clone())?;
    let set = ctx.replay.selected(query);
    let scores = of_closed(&ctx, &set)?;
    let (mut after, mut others) = ((Vec::new(), Vec::new()), (Vec::new(), Vec::new()));
    for (c, score) in set.iter().zip(&scores) {
        let g = if ctx.after_two_losses(c.facts) { &mut after } else { &mut others };
        g.0.push(*c);
        g.1.push(score);
    }
    let after = group(&after.0, &after.1, query.risk_free_daily)?;
    let others = group(&others.0, &others.1, query.risk_free_daily)?;
    let (a, o) = (&after.summary, &others.summary);
    let sample_too_small = a.trade_count < MIN_SEQUENCE_TRADES || o.trade_count < MIN_SEQUENCE_TRADES;
    let enough = !sample_too_small;
    let gap = |x: Option<f64>, y: Option<f64>| x.zip(y).map(|(x, y)| x - y).filter(|_| enough);
    let with_r = |s: &Summary| s.expectancy_r.filter(|_| s.r_trade_count >= MIN_SEQUENCE_TRADES);
    let avg_net_pnl_difference = match (a.avg_net_pnl, o.avg_net_pnl) {
        (Some(x), Some(y)) if enough => Some(checked(x.checked_sub(y))?),
        _ => None,
    };
    Ok(AfterLossesReport {
        min_trade_count: MIN_SEQUENCE_TRADES,
        sample_too_small,
        win_rate_difference: gap(a.win_rate, o.win_rate),
        avg_net_pnl_difference,
        expectancy_r_difference: gap(with_r(a), with_r(o)),
        discipline_difference: gap(after.discipline_score, others.discipline_score),
        after_two_losses: after,
        others,
    })
}

pub fn after_losses_report(conn: &Connection, query: &StatsQuery) -> Result<AfterLossesReport> {
    after_losses(&load(conn, &query.account_ids)?, query, &settings::behavior(conn)?)
}

// --- Size change after a loss ---------------------------------------------------------

/// A trade compared with the previous trade of its account.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SizeChangeCase {
    pub trade_id: i64,
    pub previous_trade_id: i64,
    pub basis: ExposureBasis,
    /// Exposure / previous exposure − 1 (0.23 = +23 %).
    pub change: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SizeChangeGroup {
    /// Outcome of the previous trade: `win`, `loss` or `breakeven`.
    pub previous_outcome: Outcome,
    /// Comparable cases (same basis as the revenge detection).
    pub case_count: usize,
    /// No planned stop on one side and a different instrument.
    pub not_comparable_count: usize,
    /// Cases where the exposure grew (change > 0).
    pub increased_count: usize,
    /// `None` below [`MIN_SIZE_CASES`] cases.
    pub mean_change: Option<f64>,
    pub median_change: Option<f64>,
    /// In exit order of the trades.
    pub cases: Vec<SizeChangeCase>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SizeChangeReport {
    pub after_loss: SizeChangeGroup,
    pub after_win: SizeChangeGroup,
    pub after_breakeven: SizeChangeGroup,
    /// Trades without an earlier closed trade on their account.
    pub no_previous_count: usize,
    pub trade_count: usize,
    pub min_case_count: usize,
    /// Mean change after a loss − mean change after a win.
    pub loss_vs_win: Option<f64>,
}

fn size_group(previous_outcome: Outcome, cases: Vec<SizeChangeCase>, not_comparable_count: usize) -> SizeChangeGroup {
    let changes: Vec<f64> = cases.iter().map(|c| c.change).collect();
    let enough = changes.len() >= MIN_SIZE_CASES;
    SizeChangeGroup {
        previous_outcome,
        case_count: cases.len(),
        not_comparable_count,
        increased_count: changes.iter().filter(|c| **c > 0.0).count(),
        mean_change: enough.then(|| changes.iter().sum::<f64>() / changes.len() as f64),
        median_change: median(changes).filter(|_| enough),
        cases,
    }
}

pub fn size_change(ledger: &Ledger, query: &StatsQuery, settings: &BehaviorSettings) -> Result<SizeChangeReport> {
    let ctx = Context::new(ledger, settings.clone())?;
    let set = ctx.replay.selected(query);
    let outcomes = [Outcome::Loss, Outcome::Win, Outcome::Breakeven];
    let mut cases: [Vec<SizeChangeCase>; 3] = Default::default();
    let mut not_comparable = [0usize; 3];
    let mut no_previous_count = 0;
    for c in &set {
        let Some(p) = ctx.previous(c.facts) else {
            no_previous_count += 1;
            continue;
        };
        let k = outcomes.iter().position(|o| *o == p.figures.outcome).expect("three outcomes");
        match exposures(c.facts, p)?.and_then(|(basis, mine, theirs)| Some((basis, pnl::ratio(mine, theirs)?))) {
            Some((basis, ratio)) => cases[k].push(SizeChangeCase { trade_id: c.facts.id, previous_trade_id: p.facts.id, basis, change: ratio - 1.0 }),
            None => not_comparable[k] += 1,
        }
    }
    let [loss, win, breakeven] = cases;
    let after_loss = size_group(Outcome::Loss, loss, not_comparable[0]);
    let after_win = size_group(Outcome::Win, win, not_comparable[1]);
    Ok(SizeChangeReport {
        loss_vs_win: after_loss.mean_change.zip(after_win.mean_change).map(|(l, w)| l - w),
        after_loss,
        after_win,
        after_breakeven: size_group(Outcome::Breakeven, breakeven, not_comparable[2]),
        no_previous_count,
        trade_count: set.len(),
        min_case_count: MIN_SIZE_CASES,
    })
}

pub fn size_change_report(conn: &Connection, query: &StatsQuery) -> Result<SizeChangeReport> {
    size_change(&load(conn, &query.account_ids)?, query, &settings::behavior(conn)?)
}
