//! Risk in percent of capital (spec 3.3.12).
//!
//! Risk % = initial risk / real balance of the trade's account at its entry,
//! where that balance = initial capital + deposits/withdrawals dated at or
//! before the entry + net PnL of the trades closed at or before the entry.

use super::distribution::median;
use super::pnl::{self, checked};
use super::{Closed, Ledger, StatsQuery, TradeFacts, load, replay};
use crate::error::Result;
use crate::money::Decimal;
use crate::settings::{self, BehaviorSettings};
use rusqlite::Connection;
use serde::Serialize;
use std::collections::HashMap;

/// Balance of each account over time.
pub(crate) struct Balances {
    accounts: HashMap<i64, Timeline>,
}

struct Timeline {
    initial: Decimal,
    /// (instant, balance after every event up to that instant), in time order.
    steps: Vec<(i64, Decimal)>,
}

impl Balances {
    pub fn new(ledger: &Ledger, closed: &[Closed]) -> Result<Self> {
        let mut events: HashMap<i64, Vec<(i64, Decimal)>> = HashMap::new();
        for m in &ledger.capital_moves {
            events.entry(m.account_id).or_default().push((m.at, m.amount));
        }
        for c in closed {
            events.entry(c.facts.account_id).or_default().push((c.exit_time, c.figures.net_pnl));
        }
        let mut accounts = HashMap::new();
        for a in &ledger.accounts {
            accounts.insert(a.id, Timeline { initial: a.initial_capital, steps: Vec::new() });
        }
        for (id, mut list) in events {
            list.sort_by_key(|(at, _)| *at);
            let timeline = accounts.entry(id).or_insert(Timeline { initial: Decimal::ZERO, steps: Vec::new() });
            let mut balance = timeline.initial;
            for (at, amount) in list {
                balance = checked(balance.checked_add(amount))?;
                timeline.steps.push((at, balance));
            }
        }
        Ok(Balances { accounts })
    }

    /// Balance of the account once every event dated at or before `at` is applied.
    pub fn at(&self, account_id: i64, at: i64) -> Decimal {
        let Some(t) = self.accounts.get(&account_id) else { return Decimal::ZERO };
        match t.steps.partition_point(|(time, _)| *time <= at) {
            0 => t.initial,
            n => t.steps[n - 1].1,
        }
    }

    /// Balance of the trade's account at its entry. `own` is the trade's
    /// closed record, if any: its PnL never counts, even when it closed at the
    /// instant it opened.
    pub fn at_entry(&self, t: &TradeFacts, own: Option<&Closed>) -> Result<Decimal> {
        let balance = self.at(t.account_id, t.entry_time);
        match own {
            Some(c) if c.exit_time <= t.entry_time => checked(balance.checked_sub(c.figures.net_pnl)),
            _ => Ok(balance),
        }
    }
}

/// Money lost if the planned stop is hit; open trades included.
pub(crate) fn initial_risk(t: &TradeFacts) -> Result<Option<Decimal>> {
    let p = &t.position;
    pnl::initial_risk(p.direction, p.entry_price, p.planned_sl, p.size, p.multiplier)
}

/// Risk / balance as a fraction (0.015 = 1.5 %); `None` without a risk or without a positive balance.
pub(crate) fn risk_fraction(risk: Option<Decimal>, balance: Decimal) -> Option<f64> {
    if balance <= Decimal::ZERO {
        return None;
    }
    pnl::ratio(risk?, balance)
}

/// Whether `risk ≤ max_percent % × balance`, compared exactly. `None` when
/// there is no limit, no risk, or no positive balance.
pub(crate) fn within_limit(risk: Option<Decimal>, balance: Decimal, max_percent: Option<Decimal>) -> Result<Option<bool>> {
    let (Some(risk), Some(max)) = (risk, max_percent) else { return Ok(None) };
    if balance <= Decimal::ZERO {
        return Ok(None);
    }
    let lhs = checked(risk.checked_mul(Decimal::ONE_HUNDRED))?;
    let rhs = checked(max.checked_mul(balance))?;
    Ok(Some(lhs <= rhs))
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TradeRisk {
    pub trade_id: i64,
    pub entry_time: i64,
    pub exit_time: i64,
    /// `None` without a valid planned stop.
    pub initial_risk: Option<Decimal>,
    pub balance_at_entry: Decimal,
    /// Initial risk / balance at entry (0.01 = 1 %).
    pub risk_pct: Option<f64>,
    /// `None` without a limit, a stop, or a positive balance.
    pub within_limit: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RiskReport {
    /// Closed trades of the period, in exit order.
    pub trades: Vec<TradeRisk>,
    pub trade_count: usize,
    pub without_stop_count: usize,
    pub avg_risk_pct: Option<f64>,
    pub median_risk_pct: Option<f64>,
    pub max_risk_pct: Option<f64>,
    /// The user's limit, in percent (1.5 = 1.5 %).
    pub max_risk_percent: Option<Decimal>,
    /// Trades over the limit; `None` without a limit.
    pub over_limit_count: Option<usize>,
    /// Initial capital + flows + realized PnL of the selected accounts, now.
    pub current_capital: Decimal,
    /// The limit in money at the current capital.
    pub limit_amount: Option<Decimal>,
}

pub fn risk(ledger: &Ledger, query: &StatsQuery, settings: &BehaviorSettings) -> Result<RiskReport> {
    let r = replay(ledger)?;
    let balances = Balances::new(ledger, &r.closed)?;
    let max = settings.max_risk_percent;
    let mut trades = Vec::new();
    for c in r.selected(query) {
        let initial_risk = c.figures.initial_risk;
        let balance = balances.at_entry(c.facts, Some(c))?;
        trades.push(TradeRisk {
            trade_id: c.facts.id,
            entry_time: c.facts.entry_time,
            exit_time: c.exit_time,
            initial_risk,
            balance_at_entry: balance,
            risk_pct: risk_fraction(initial_risk, balance),
            within_limit: within_limit(initial_risk, balance, max)?,
        });
    }
    let pcts: Vec<f64> = trades.iter().filter_map(|t| t.risk_pct).collect();
    let limit_amount = match max {
        Some(p) => Some(checked(p.checked_mul(r.final_balance).and_then(|v| v.checked_div(Decimal::ONE_HUNDRED)))?),
        None => None,
    };
    Ok(RiskReport {
        trade_count: trades.len(),
        without_stop_count: trades.iter().filter(|t| t.initial_risk.is_none()).count(),
        avg_risk_pct: (!pcts.is_empty()).then(|| pcts.iter().sum::<f64>() / pcts.len() as f64),
        max_risk_pct: pcts.iter().copied().reduce(f64::max),
        median_risk_pct: median(pcts),
        max_risk_percent: max,
        over_limit_count: max.map(|_| trades.iter().filter(|t| t.within_limit == Some(false)).count()),
        current_capital: r.final_balance,
        limit_amount,
        trades,
    })
}

pub fn risk_report(conn: &Connection, query: &StatsQuery) -> Result<RiskReport> {
    risk(&load(conn, &query.account_ids)?, query, &settings::behavior(conn)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stats::{AccountCapital, CapitalMove, replay};
    use crate::test_support::dec;

    #[test]
    fn limit_is_compared_exactly() {
        // 1.5 % of 10 000 = 150: a risk of exactly 150 is within the limit, 150.01 is not.
        let b = dec("10000");
        assert_eq!(within_limit(Some(dec("150")), b, Some(dec("1.5"))).unwrap(), Some(true));
        assert_eq!(within_limit(Some(dec("150.01")), b, Some(dec("1.5"))).unwrap(), Some(false));
        assert_eq!(within_limit(None, b, Some(dec("1.5"))).unwrap(), None);
        assert_eq!(within_limit(Some(dec("1")), b, None).unwrap(), None);
        assert_eq!(within_limit(Some(dec("1")), Decimal::ZERO, Some(dec("1"))).unwrap(), None);
        assert_eq!(risk_fraction(Some(dec("150")), b), Some(0.015));
        assert_eq!(risk_fraction(Some(dec("150")), dec("-5")), None);
        assert_eq!(risk_fraction(None, b), None);
    }

    #[test]
    fn balance_at_an_instant_is_per_account() {
        let ledger = Ledger {
            accounts: vec![AccountCapital { id: 1, initial_capital: dec("1000") }, AccountCapital { id: 2, initial_capital: dec("50") }],
            capital_moves: vec![
                CapitalMove { account_id: 1, at: 100, amount: dec("500") },
                CapitalMove { account_id: 2, at: 50, amount: dec("-20") },
            ],
            ..Ledger::default()
        };
        let r = replay(&ledger).unwrap();
        let b = Balances::new(&ledger, &r.closed).unwrap();
        // Events at the very instant count ("at or before").
        assert_eq!((b.at(1, 99), b.at(1, 100), b.at(2, 49), b.at(2, 50)), (dec("1000"), dec("1500"), dec("50"), dec("30")));
        assert_eq!(b.at(9, 0), Decimal::ZERO, "unknown account");
    }
}
