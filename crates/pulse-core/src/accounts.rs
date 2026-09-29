use crate::error::{CoreError, Result};
use crate::money::{self, Decimal};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: i64,
    pub name: String,
    pub kind: String,
    pub broker: String,
    pub currency: String,
    pub initial_capital: Decimal,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewAccount {
    pub name: String,
    pub kind: String,
    #[serde(default)]
    pub broker: String,
    #[serde(default = "default_currency")]
    pub currency: String,
    #[serde(default)]
    pub initial_capital: Decimal,
}

fn default_currency() -> String {
    "USD".into()
}

pub fn create(conn: &Connection, new: &NewAccount) -> Result<Account> {
    let name = new.name.trim();
    if name.is_empty() {
        return Err(CoreError::Invalid("account name is required".into()));
    }
    if !matches!(new.kind.as_str(), "personal" | "prop" | "demo") {
        return Err(CoreError::Invalid(format!("unknown account kind: {}", new.kind)));
    }
    money::require_non_negative("initial capital", new.initial_capital)?;
    conn.execute(
        "INSERT INTO accounts (name, kind, broker, currency, initial_capital) VALUES (?1,?2,?3,?4,?5)",
        params![name, new.kind, new.broker.trim(), new.currency.trim(), money::to_db(new.initial_capital)],
    )?;
    get(conn, conn.last_insert_rowid())
}

pub fn get(conn: &Connection, id: i64) -> Result<Account> {
    conn.query_row(
        "SELECT id, name, kind, broker, currency, initial_capital FROM accounts WHERE id = ?1",
        [id],
        row,
    )
    .optional()?
    .ok_or_else(|| CoreError::NotFound(format!("account {id}")))
}

pub fn list(conn: &Connection) -> Result<Vec<Account>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, kind, broker, currency, initial_capital FROM accounts ORDER BY id",
    )?;
    let rows = stmt.query_map([], row)?.collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn row(r: &rusqlite::Row) -> rusqlite::Result<Account> {
    Ok(Account {
        id: r.get(0)?,
        name: r.get(1)?,
        kind: r.get(2)?,
        broker: r.get(3)?,
        currency: r.get(4)?,
        initial_capital: money::col(r, 5)?,
    })
}

/// Error message returned by [`delete`] when the account still owns data.
/// The interface maps it to a translated text.
pub const ACCOUNT_IN_USE: &str = "account_in_use";

/// Deletes an account that owns no data (no trade, deposit/withdrawal or missed
/// trade). An account with history is never deleted: it would erase the
/// journal, and the schema refuses it (`ON DELETE RESTRICT`).
pub fn delete(conn: &Connection, id: i64) -> Result<()> {
    get(conn, id)?; // NotFound if unknown
    let used: i64 = conn.query_row(
        "SELECT (SELECT COUNT(*) FROM trades        WHERE account_id = ?1)
              + (SELECT COUNT(*) FROM cash_flows    WHERE account_id = ?1)
              + (SELECT COUNT(*) FROM missed_trades WHERE account_id = ?1)",
        [id],
        |r| r.get(0),
    )?;
    if used > 0 {
        return Err(CoreError::Invalid(ACCOUNT_IN_USE.into()));
    }
    conn.execute("DELETE FROM accounts WHERE id = ?1", [id])?;
    Ok(())
}

#[cfg(test)]
mod delete_tests {
    use super::*;
    use crate::cash_flows::{self, CashFlowKind, NewCashFlow};
    use crate::db;
    use crate::test_support::{account, dec};

    #[test]
    fn deletes_an_empty_account_and_keeps_the_others() {
        let conn = db::open_in_memory().unwrap();
        let keep = account(&conn, "1000");
        let gone = account(&conn, "500");
        delete(&conn, gone).unwrap();
        let ids: Vec<i64> = list(&conn).unwrap().iter().map(|a| a.id).collect();
        assert_eq!(ids, vec![keep]);
    }

    #[test]
    fn refuses_to_delete_an_account_with_history() {
        let conn = db::open_in_memory().unwrap();
        let id = account(&conn, "1000");
        cash_flows::create(
            &conn,
            &NewCashFlow {
                account_id: id,
                kind: CashFlowKind::Deposit,
                amount: dec("250"),
                occurred_at: 0,
                tz_offset_min: 0,
                note: String::new(),
            },
        )
        .unwrap();
        match delete(&conn, id) {
            Err(CoreError::Invalid(m)) => assert_eq!(m, ACCOUNT_IN_USE),
            other => panic!("expected account_in_use, got {other:?}"),
        }
        assert_eq!(list(&conn).unwrap().len(), 1, "account must still exist");
    }

    #[test]
    fn deleting_an_unknown_account_is_not_found() {
        let conn = db::open_in_memory().unwrap();
        assert!(matches!(delete(&conn, 42), Err(CoreError::NotFound(_))));
    }
}
