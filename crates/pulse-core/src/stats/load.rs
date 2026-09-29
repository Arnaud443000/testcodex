//! Reads a [`Ledger`] from the database.

use super::{AccountCapital, CapitalMove, Journal, Ledger, Position, RuleCheckFact, TagRef, TradeFacts};
use crate::accounts::{self, Account};
use crate::error::{CoreError, Result};
use crate::money::{self, Decimal};
use crate::util::ids_condition;
use crate::cash_flows;
use rusqlite::Connection;
use std::collections::HashMap;

/// Source data of the given accounts (all active accounts when empty). Refuses to
/// mix currencies: a consolidated view needs accounts in the same currency.
pub fn load(conn: &Connection, account_ids: &[i64]) -> Result<Ledger> {
    let accounts: Vec<Account> = if account_ids.is_empty() {
        accounts::list_active(conn)?
    } else {
        account_ids.iter().map(|&id| accounts::get(conn, id)).collect::<Result<_>>()?
    };
    let Some(first) = accounts.first() else { return Ok(Ledger::default()) };
    if let Some(other) = accounts.iter().find(|a| a.currency != first.currency) {
        return Err(CoreError::Invalid(format!(
            "accounts in different currencies ({} and {}) cannot be combined",
            first.currency, other.currency
        )));
    }
    let ids: Vec<i64> = accounts.iter().map(|a| a.id).collect();
    let mut initial_capital = Decimal::ZERO;
    for a in &accounts {
        initial_capital = super::checked(initial_capital.checked_add(a.initial_capital))?;
    }
    let capital_moves = cash_flows::list(conn, &ids)?
        .iter()
        .map(|f| CapitalMove { account_id: f.account_id, at: f.occurred_at, amount: f.signed_amount() })
        .collect();

    let cond = ids_condition("t.account_id", &ids);
    let mut stmt = conn.prepare(&format!(
        "SELECT t.id, t.account_id, t.instrument_id, i.symbol, i.asset_class, t.direction, t.size, t.multiplier,
                t.entry_price, t.exit_price, t.entry_time, t.exit_time, t.tz_offset_min, t.planned_sl,
                t.planned_tp, t.fees, t.execution_type, t.plan_followed
         FROM trades t JOIN instruments i ON i.id = t.instrument_id
         WHERE {cond} ORDER BY t.id"
    ))?;
    let mut trades = stmt
        .query_map([], |r| {
            Ok(TradeFacts {
                id: r.get(0)?,
                account_id: r.get(1)?,
                instrument_id: r.get(2)?,
                symbol: r.get(3)?,
                asset_class: r.get(4)?,
                position: Position {
                    direction: r.get(5)?,
                    size: money::col(r, 6)?,
                    multiplier: money::col(r, 7)?,
                    entry_price: money::col(r, 8)?,
                    exit_price: money::opt_col(r, 9)?,
                    planned_sl: money::opt_col(r, 13)?,
                    planned_tp: money::opt_col(r, 14)?,
                    fees: money::col(r, 15)?,
                },
                entry_time: r.get(10)?,
                exit_time: r.get(11)?,
                tz_offset_min: r.get(12)?,
                execution_type: r.get(16)?,
                tags: Vec::new(),
                journal: Journal { plan_followed: r.get(17)?, ..Journal::default() },
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;

    let index: HashMap<i64, usize> = trades.iter().enumerate().map(|(i, t)| (t.id, i)).collect();
    let mut stmt = conn.prepare(&format!(
        "SELECT tt.trade_id, g.id, g.kind, g.name
         FROM trade_tags tt JOIN tags g ON g.id = tt.tag_id JOIN trades t ON t.id = tt.trade_id
         WHERE {cond} ORDER BY g.id"
    ))?;
    for row in stmt.query_map([], |r| {
        Ok((r.get::<_, i64>(0)?, TagRef { id: r.get(1)?, kind: r.get(2)?, name: r.get(3)? }))
    })? {
        let (trade, tag) = row?;
        trades[index[&trade]].tags.push(tag);
    }

    let mut stmt = conn.prepare(&format!(
        "SELECT e.trade_id, e.moment, g.id, g.kind, g.name
         FROM trade_emotions e JOIN tags g ON g.id = e.tag_id JOIN trades t ON t.id = e.trade_id
         WHERE {cond} ORDER BY CASE e.moment WHEN 'before' THEN 0 WHEN 'during' THEN 1 ELSE 2 END, g.id"
    ))?;
    for row in stmt.query_map([], |r| {
        Ok((r.get::<_, i64>(0)?, r.get(1)?, TagRef { id: r.get(2)?, kind: r.get(3)?, name: r.get(4)? }))
    })? {
        let (trade, moment, tag) = row?;
        trades[index[&trade]].journal.emotions.push((moment, tag));
    }
    let mut stmt = conn.prepare(&format!(
        "SELECT c.trade_id, c.rule_id, r.text, c.respected
         FROM trade_rule_checks c JOIN rules r ON r.id = c.rule_id JOIN trades t ON t.id = c.trade_id
         WHERE {cond} ORDER BY r.position, r.id"
    ))?;
    for row in stmt.query_map([], |r| {
        Ok((r.get::<_, i64>(0)?, RuleCheckFact { rule_id: r.get(1)?, text: r.get(2)?, respected: r.get(3)? }))
    })? {
        let (trade, check) = row?;
        trades[index[&trade]].journal.rule_checks.push(check);
    }
    let mut stmt = conn.prepare(&format!(
        "SELECT c.trade_id, SUM(c.checked), COUNT(*)
         FROM trade_checklist c JOIN trades t ON t.id = c.trade_id
         WHERE {cond} GROUP BY c.trade_id"
    ))?;
    for row in stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?)))? {
        let (trade, checked, total) = row?;
        let j = &mut trades[index[&trade]].journal;
        (j.checklist_checked, j.checklist_total) = (checked as usize, total as usize);
    }

    let accounts = accounts.iter().map(|a| AccountCapital { id: a.id, initial_capital: a.initial_capital }).collect();
    Ok(Ledger { currency: Some(first.currency.clone()), initial_capital, accounts, capital_moves, trades })
}
