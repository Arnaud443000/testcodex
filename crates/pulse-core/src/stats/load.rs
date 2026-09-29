//! Reads a [`Ledger`] from the database.

use super::{CapitalMove, Ledger, Position, TagRef, TradeFacts};
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
        .map(|f| CapitalMove { at: f.occurred_at, amount: f.signed_amount() })
        .collect();

    let cond = ids_condition("t.account_id", &ids);
    let mut stmt = conn.prepare(&format!(
        "SELECT t.id, t.account_id, t.instrument_id, i.symbol, i.asset_class, t.direction, t.size, t.multiplier,
                t.entry_price, t.exit_price, t.entry_time, t.exit_time, t.tz_offset_min, t.planned_sl,
                t.planned_tp, t.fees, t.execution_type
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

    Ok(Ledger { currency: Some(first.currency.clone()), initial_capital, capital_moves, trades })
}
