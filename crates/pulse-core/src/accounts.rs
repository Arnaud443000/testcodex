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
    /// Archived: hidden from selectors and default totals, history kept.
    pub archived: bool,
    /// True when a trade, deposit/withdrawal or missed trade belongs to the account
    /// (its currency is then locked and it can only be archived, never deleted).
    pub has_history: bool,
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
        &format!("{SELECT} WHERE id = ?1"),
        [id],
        row,
    )
    .optional()?
    .ok_or_else(|| CoreError::NotFound(format!("account {id}")))
}

/// Every account, archived ones included.
pub fn list(conn: &Connection) -> Result<Vec<Account>> {
    let mut stmt = conn.prepare(&format!("{SELECT} ORDER BY id"))?;
    let rows = stmt.query_map([], row)?.collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Accounts that are not archived: what selectors and default totals use.
pub fn list_active(conn: &Connection) -> Result<Vec<Account>> {
    Ok(list(conn)?.into_iter().filter(|a| !a.archived).collect())
}

const SELECT: &str = "SELECT id, name, kind, broker, currency, initial_capital, archived,
       (SELECT COUNT(*) FROM trades        WHERE account_id = accounts.id)
     + (SELECT COUNT(*) FROM cash_flows    WHERE account_id = accounts.id)
     + (SELECT COUNT(*) FROM missed_trades WHERE account_id = accounts.id) > 0
FROM accounts";

fn row(r: &rusqlite::Row) -> rusqlite::Result<Account> {
    Ok(Account {
        id: r.get(0)?,
        name: r.get(1)?,
        kind: r.get(2)?,
        broker: r.get(3)?,
        currency: r.get(4)?,
        initial_capital: money::col(r, 5)?,
        archived: r.get(6)?,
        has_history: r.get(7)?,
    })
}

/// Error message when something new is added to an archived account.
pub const ACCOUNT_ARCHIVED: &str = "account_archived";

/// Editable fields of an account. The currency is part of it so the interface can
/// send the whole form, but it is refused once the account has history.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountUpdate {
    pub name: String,
    pub kind: String,
    #[serde(default)]
    pub broker: String,
    pub currency: String,
    pub initial_capital: Decimal,
}

/// Error message returned by [`update`] when the currency of an account with
/// history is changed (its amounts would silently change meaning).
pub const CURRENCY_LOCKED: &str = "currency_locked";

/// Edits an account. Changing the initial capital is allowed at any time: nothing
/// derived is stored, so returns in % are recomputed from the source data.
pub fn update(conn: &Connection, id: i64, upd: &AccountUpdate) -> Result<Account> {
    let current = get(conn, id)?;
    let name = upd.name.trim();
    if name.is_empty() {
        return Err(CoreError::Invalid("account name is required".into()));
    }
    if !matches!(upd.kind.as_str(), "personal" | "prop" | "demo") {
        return Err(CoreError::Invalid(format!("unknown account kind: {}", upd.kind)));
    }
    let currency = upd.currency.trim();
    if currency.is_empty() {
        return Err(CoreError::Invalid("currency is required".into()));
    }
    if current.has_history && currency != current.currency {
        return Err(CoreError::Invalid(CURRENCY_LOCKED.into()));
    }
    money::require_non_negative("initial capital", upd.initial_capital)?;
    conn.execute(
        "UPDATE accounts SET name=?1, kind=?2, broker=?3, currency=?4, initial_capital=?5 WHERE id=?6",
        params![name, upd.kind, upd.broker.trim(), currency, money::to_db(upd.initial_capital), id],
    )?;
    get(conn, id)
}

/// Archives or restores an account. History is untouched.
pub fn set_archived(conn: &Connection, id: i64, archived: bool) -> Result<Account> {
    get(conn, id)?; // NotFound if unknown
    conn.execute("UPDATE accounts SET archived = ?1 WHERE id = ?2", params![archived, id])?;
    get(conn, id)
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

#[cfg(test)]
mod edit_tests {
    use super::*;
    use crate::db;
    use crate::stats::{self, StatsQuery};
    use crate::test_support::{account, dec, instrument};
    use crate::trades::{self, Direction, TradeData};

    fn upd(name: &str, currency: &str, capital: &str) -> AccountUpdate {
        AccountUpdate { name: name.into(), kind: "prop".into(), broker: " IC ".into(), currency: currency.into(), initial_capital: dec(capital) }
    }

    /// One closed long trade: (110 − 100) × 1 × 100 = +1000.
    fn winning_trade(conn: &Connection, account_id: i64) -> i64 {
        let inst = instrument(conn, "TEST", "100");
        let mut d = TradeData::new(account_id, inst, Direction::Long, dec("1"), dec("100"), 1_000_000);
        d.exit_price = Some(dec("110"));
        d.exit_time = Some(1_060_000);
        trades::create(conn, &d).unwrap().id
    }

    #[test]
    fn update_edits_fields_and_trims() {
        let conn = db::open_in_memory().unwrap();
        let id = account(&conn, "1000");
        let a = update(&conn, id, &upd("  FTMO ", "USD", "25000.50")).unwrap();
        assert_eq!((a.name.as_str(), a.kind.as_str(), a.broker.as_str()), ("FTMO", "prop", "IC"));
        assert_eq!(a.initial_capital, dec("25000.50"));
        assert!(!a.has_history && !a.archived);
    }

    #[test]
    fn update_validates() {
        let conn = db::open_in_memory().unwrap();
        let id = account(&conn, "1000");
        assert!(update(&conn, id, &upd("  ", "USD", "1")).is_err());
        assert!(update(&conn, id, &upd("A", "", "1")).is_err());
        assert!(update(&conn, id, &upd("A", "USD", "-1")).is_err());
        let mut bad = upd("A", "USD", "1");
        bad.kind = "x".into();
        assert!(update(&conn, id, &bad).is_err());
        assert!(matches!(update(&conn, 99, &upd("A", "USD", "1")), Err(CoreError::NotFound(_))));
        assert_eq!(get(&conn, id).unwrap().name, "Test account", "nothing changed after refusals");
    }

    #[test]
    fn currency_is_free_when_empty_and_locked_with_history() {
        let conn = db::open_in_memory().unwrap();
        let id = account(&conn, "1000");
        assert_eq!(update(&conn, id, &upd("A", "EUR", "1000")).unwrap().currency, "EUR");
        winning_trade(&conn, id);
        assert!(get(&conn, id).unwrap().has_history);
        match update(&conn, id, &upd("A", "USD", "1000")) {
            Err(CoreError::Invalid(m)) => assert_eq!(m, CURRENCY_LOCKED),
            other => panic!("expected currency_locked, got {other:?}"),
        }
        // Same currency is fine: the other fields still change.
        assert_eq!(update(&conn, id, &upd("B", "EUR", "1000")).unwrap().name, "B");
    }

    #[test]
    fn capital_change_recomputes_returns_from_source_data() {
        let conn = db::open_in_memory().unwrap();
        let id = account(&conn, "10000");
        winning_trade(&conn, id);
        let q = StatsQuery { account_ids: vec![id], ..StatsQuery::default() };
        let before = stats::report(&conn, &q).unwrap();
        assert_eq!(before.summary.net_pnl, dec("1000"));
        assert!((before.summary.return_pct.unwrap() - 0.10).abs() < 1e-9);
        update(&conn, id, &upd("A", "USD", "20000")).unwrap();
        let after = stats::report(&conn, &q).unwrap();
        assert_eq!(after.summary.net_pnl, dec("1000"), "P&L in money is unchanged");
        assert!((after.summary.return_pct.unwrap() - 0.05).abs() < 1e-9, "1000 / 20000 = 5 %");
        assert_eq!(after.initial_capital, dec("20000"));
    }

    #[test]
    fn archived_account_leaves_defaults_but_keeps_history() {
        let conn = db::open_in_memory().unwrap();
        let keep = account(&conn, "1000");
        let old = account(&conn, "1000");
        winning_trade(&conn, keep);
        winning_trade(&conn, old);
        let all = || stats::report(&conn, &StatsQuery::default()).unwrap();
        assert_eq!(all().summary.trade_count, 2);

        assert!(set_archived(&conn, old, true).unwrap().archived);
        assert_eq!(list(&conn).unwrap().len(), 2, "still listed for Settings");
        assert_eq!(list_active(&conn).unwrap().iter().map(|a| a.id).collect::<Vec<_>>(), [keep]);
        let r = all();
        assert_eq!((r.summary.trade_count, r.initial_capital), (1, dec("1000")), "default totals skip it");
        let only_old = stats::report(&conn, &StatsQuery { account_ids: vec![old], ..StatsQuery::default() }).unwrap();
        assert_eq!(only_old.summary.trade_count, 1, "still readable when named");
        assert_eq!(trades::list(&conn, &Default::default()).unwrap().len(), 1);
        assert_eq!(trades::list(&conn, &trades::TradeFilter { account_ids: vec![old], ..Default::default() }).unwrap().len(), 1);
        match delete(&conn, old) {
            Err(CoreError::Invalid(m)) => assert_eq!(m, ACCOUNT_IN_USE),
            other => panic!("history must block deletion, got {other:?}"),
        }

        set_archived(&conn, old, false).unwrap();
        assert_eq!(all().summary.trade_count, 2);
    }

    #[test]
    fn nothing_new_can_be_added_to_an_archived_account() {
        let conn = db::open_in_memory().unwrap();
        let id = account(&conn, "1000");
        let inst = instrument(&conn, "TEST", "100");
        set_archived(&conn, id, true).unwrap();
        match trades::create(&conn, &TradeData::new(id, inst, Direction::Long, dec("1"), dec("100"), 0)) {
            Err(CoreError::Invalid(m)) => assert_eq!(m, ACCOUNT_ARCHIVED),
            other => panic!("expected account_archived, got {other:?}"),
        }
        assert!(matches!(set_archived(&conn, 99, true), Err(CoreError::NotFound(_))));
    }
}
