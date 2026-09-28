use crate::error::{CoreError, Result};
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: i64,
    pub name: String,
    pub kind: String,
    pub broker: String,
    pub currency: String,
    pub initial_capital: f64,
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
    pub initial_capital: f64,
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
    if !new.initial_capital.is_finite() || new.initial_capital < 0.0 {
        return Err(CoreError::Invalid("initial capital must be a positive number".into()));
    }
    conn.execute(
        "INSERT INTO accounts (name, kind, broker, currency, initial_capital) VALUES (?1,?2,?3,?4,?5)",
        params![name, new.kind, new.broker.trim(), new.currency.trim(), new.initial_capital],
    )?;
    get(conn, conn.last_insert_rowid())
}

pub fn get(conn: &Connection, id: i64) -> Result<Account> {
    Ok(conn.query_row(
        "SELECT id, name, kind, broker, currency, initial_capital FROM accounts WHERE id = ?1",
        [id],
        row,
    )?)
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
        initial_capital: r.get(5)?,
    })
}
