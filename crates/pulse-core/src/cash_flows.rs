//! Deposits and withdrawals (spec 3.7.10). They change the account balance but
//! are always excluded from performance: they are never a gain or a loss.

use crate::accounts;
use crate::error::{CoreError, Result};
use crate::money::{self, Decimal};
use crate::util::{check_tz_offset, ids_condition, text_enum};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

text_enum!(CashFlowKind {
    Deposit => "deposit",
    Withdrawal => "withdrawal",
});

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CashFlow {
    pub id: i64,
    pub account_id: i64,
    pub kind: CashFlowKind,
    /// Always positive; the kind gives the direction.
    pub amount: Decimal,
    /// Unix milliseconds, UTC.
    pub occurred_at: i64,
    pub tz_offset_min: i32,
    pub note: String,
}

impl CashFlow {
    /// +amount for a deposit, −amount for a withdrawal.
    pub fn signed_amount(&self) -> Decimal {
        match self.kind {
            CashFlowKind::Deposit => self.amount,
            CashFlowKind::Withdrawal => -self.amount,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewCashFlow {
    pub account_id: i64,
    pub kind: CashFlowKind,
    pub amount: Decimal,
    pub occurred_at: i64,
    #[serde(default)]
    pub tz_offset_min: i32,
    #[serde(default)]
    pub note: String,
}

pub fn create(conn: &Connection, new: &NewCashFlow) -> Result<CashFlow> {
    if accounts::get(conn, new.account_id)?.archived {
        return Err(crate::error::CoreError::Invalid(accounts::ACCOUNT_ARCHIVED.into()));
    }
    money::require_positive("amount", new.amount)?;
    check_tz_offset(new.tz_offset_min)?;
    conn.execute(
        "INSERT INTO cash_flows (account_id, kind, amount, occurred_at, tz_offset_min, note)
         VALUES (?1,?2,?3,?4,?5,?6)",
        params![
            new.account_id,
            new.kind,
            money::to_db(new.amount),
            new.occurred_at,
            new.tz_offset_min,
            new.note.trim()
        ],
    )?;
    get(conn, conn.last_insert_rowid())
}

pub fn get(conn: &Connection, id: i64) -> Result<CashFlow> {
    conn.query_row(&format!("{SELECT} WHERE id = ?1"), [id], row)
        .optional()?
        .ok_or_else(|| CoreError::NotFound(format!("deposit/withdrawal {id}")))
}

/// Chronological list for the given accounts (all accounts when empty).
pub fn list(conn: &Connection, account_ids: &[i64]) -> Result<Vec<CashFlow>> {
    let mut stmt = conn.prepare(&format!(
        "{SELECT} WHERE {} ORDER BY occurred_at, id",
        ids_condition("account_id", account_ids)
    ))?;
    let rows = stmt.query_map([], row)?.collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn delete(conn: &Connection, id: i64) -> Result<()> {
    get(conn, id)?;
    conn.execute("DELETE FROM cash_flows WHERE id = ?1", [id])?;
    Ok(())
}

const SELECT: &str = "SELECT id, account_id, kind, amount, occurred_at, tz_offset_min, note FROM cash_flows";

fn row(r: &rusqlite::Row) -> rusqlite::Result<CashFlow> {
    Ok(CashFlow {
        id: r.get(0)?,
        account_id: r.get(1)?,
        kind: r.get(2)?,
        amount: money::col(r, 3)?,
        occurred_at: r.get(4)?,
        tz_offset_min: r.get(5)?,
        note: r.get(6)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::test_support::account;

    fn flow(account_id: i64, kind: CashFlowKind, amount: &str, at: i64) -> NewCashFlow {
        NewCashFlow {
            account_id,
            kind,
            amount: money::parse("amount", amount).unwrap(),
            occurred_at: at,
            tz_offset_min: 120,
            note: String::new(),
        }
    }

    #[test]
    fn records_signed_flows_in_time_order() {
        let conn = db::open_in_memory().unwrap();
        let a = account(&conn, "10000");
        let b = account(&conn, "0");
        create(&conn, &flow(a, CashFlowKind::Withdrawal, "250.50", 2_000)).unwrap();
        create(&conn, &flow(a, CashFlowKind::Deposit, "1000", 1_000)).unwrap();
        create(&conn, &flow(b, CashFlowKind::Deposit, "5", 1_500)).unwrap();
        let flows = list(&conn, &[a]).unwrap();
        let signed: Vec<String> = flows.iter().map(|f| f.signed_amount().to_string()).collect();
        assert_eq!(signed, ["1000", "-250.50"]);
        assert_eq!(list(&conn, &[]).unwrap().len(), 3);
        delete(&conn, flows[0].id).unwrap();
        assert_eq!(list(&conn, &[a]).unwrap().len(), 1);
    }

    #[test]
    fn rejects_invalid_flows() {
        let conn = db::open_in_memory().unwrap();
        let a = account(&conn, "0");
        assert!(create(&conn, &flow(a, CashFlowKind::Deposit, "0", 1)).is_err());
        assert!(create(&conn, &flow(a, CashFlowKind::Deposit, "-5", 1)).is_err());
        assert!(create(&conn, &flow(999, CashFlowKind::Deposit, "5", 1)).is_err());
        let mut bad_tz = flow(a, CashFlowKind::Deposit, "5", 1);
        bad_tz.tz_offset_min = 900;
        assert!(create(&conn, &bad_tz).is_err());
    }
}
