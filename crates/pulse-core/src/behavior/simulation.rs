//! "Gain if the plan had been followed" (spec 3.3.14, simple version): the real
//! net PnL next to the one without the off-plan trades. A simulation, never
//! advice: trades are removed, exits are not replayed. See CLAUDE.md,
//! "Compléments du moteur (lot 8 bis)".

use crate::error::Result;
use crate::money::Decimal;
use crate::stats::pnl::checked;
use crate::stats::summary::analyze;
use crate::stats::{Closed, Ledger, StatsQuery, load, replay};
use crate::trades::PlanFollowed;
use rusqlite::Connection;
use serde::Serialize;

/// Results of a set of trades. No percentage: real balances mean nothing in a simulation.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SimulatedResult {
    pub trade_count: usize,
    pub net_pnl: Decimal,
    pub win_rate: Option<f64>,
    pub expectancy_r: Option<f64>,
    pub r_trade_count: usize,
    pub profit_factor: Option<f64>,
    pub total_gains: Decimal,
    pub total_losses: Decimal,
    /// On the cumulative net PnL of the trades kept, in money.
    pub max_drawdown: Decimal,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Scenario {
    pub excluded_trade_count: usize,
    pub excluded_net_pnl: Decimal,
    pub result: SimulatedResult,
    /// Simulated net PnL − real net PnL (positive: the removed trades cost money).
    /// `None` when no trade of the selection declares its plan.
    pub difference: Option<Decimal>,
    /// In exit order.
    pub excluded_trade_ids: Vec<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanSimulation {
    /// Trades whose plan compliance is declared (yes, partial or no).
    pub declared_trade_count: usize,
    pub actual: SimulatedResult,
    /// Without the trades off plan (`no`).
    pub without_off_plan: Scenario,
    /// Without the trades off plan or partly in plan (`no`, `partial`).
    pub without_off_plan_or_partial: Scenario,
}

fn result(set: &[&Closed]) -> Result<SimulatedResult> {
    let s = analyze(set, 0.0)?.summary;
    Ok(SimulatedResult {
        trade_count: s.trade_count,
        net_pnl: s.net_pnl,
        win_rate: s.win_rate,
        expectancy_r: s.expectancy_r,
        r_trade_count: s.r_trade_count,
        profit_factor: s.profit_factor,
        total_gains: s.total_gains,
        total_losses: s.total_losses,
        max_drawdown: s.max_drawdown,
    })
}

fn scenario(set: &[&Closed], actual: &SimulatedResult, declared: bool, excluded: &[PlanFollowed]) -> Result<Scenario> {
    let (out, kept): (Vec<&Closed>, Vec<&Closed>) =
        set.iter().partition(|c| c.facts.journal.plan_followed.is_some_and(|p| excluded.contains(&p)));
    let result = result(&kept)?;
    let mut excluded_net_pnl = Decimal::ZERO;
    for c in &out {
        excluded_net_pnl = checked(excluded_net_pnl.checked_add(c.figures.net_pnl))?;
    }
    let difference = if declared { Some(checked(result.net_pnl.checked_sub(actual.net_pnl))?) } else { None };
    Ok(Scenario {
        excluded_trade_count: out.len(),
        excluded_net_pnl,
        excluded_trade_ids: out.iter().map(|c| c.facts.id).collect(),
        difference,
        result,
    })
}

pub fn plan_simulation(ledger: &Ledger, query: &StatsQuery) -> Result<PlanSimulation> {
    let r = replay(ledger)?;
    let set = r.selected(query);
    let declared_trade_count = set.iter().filter(|c| c.facts.journal.plan_followed.is_some()).count();
    let declared = declared_trade_count > 0;
    let actual = result(&set)?;
    Ok(PlanSimulation {
        declared_trade_count,
        without_off_plan: scenario(&set, &actual, declared, &[PlanFollowed::No])?,
        without_off_plan_or_partial: scenario(&set, &actual, declared, &[PlanFollowed::No, PlanFollowed::Partial])?,
        actual,
    })
}

pub fn plan_simulation_report(conn: &Connection, query: &StatsQuery) -> Result<PlanSimulation> {
    plan_simulation(&load(conn, &query.account_ids)?, query)
}
