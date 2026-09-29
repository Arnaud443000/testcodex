//! Traded instruments (EURUSD, NAS100, BTCUSD…), shared by all accounts.

use crate::error::{CoreError, Result};
use crate::money::{self, Decimal};
use crate::util::{clean_text, text_enum};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

text_enum!(
    /// Asset category, used for exposure by category (spec 3.7.9).
    AssetClass {
        Forex => "forex",
        Index => "index",
        Crypto => "crypto",
        Stock => "stock",
        Commodity => "commodity",
        Future => "future",
        Other => "other",
    }
);

#[allow(clippy::derivable_impls)] // the enum is declared by `text_enum!`
impl Default for AssetClass {
    fn default() -> Self {
        AssetClass::Other
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Instrument {
    pub id: i64,
    pub symbol: String,
    /// Full display name ("Solana"); empty for a custom instrument created without one.
    pub name: String,
    pub asset_class: AssetClass,
    /// Account-currency value of a 1.0 price move for a size of 1, copied onto
    /// each new trade as its `multiplier` (e.g. 100000 for EURUSD in lots on a USD account).
    pub default_multiplier: Decimal,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewInstrument {
    pub symbol: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub asset_class: AssetClass,
    #[serde(default = "one")]
    pub default_multiplier: Decimal,
}

fn one() -> Decimal {
    Decimal::ONE
}

/// Duplicate-detection key: "eur/usd", "EUR USD" and "EURUSD" are one instrument.
pub fn symbol_key(symbol: &str) -> String {
    symbol
        .chars()
        .filter(|c| c.is_alphanumeric() || *c == '.')
        .flat_map(char::to_uppercase)
        .collect()
}

pub fn create(conn: &Connection, new: &NewInstrument) -> Result<Instrument> {
    let symbol = clean_text("symbol", &new.symbol)?;
    let name = new.name.split_whitespace().collect::<Vec<_>>().join(" ");
    let key = symbol_key(&symbol);
    if key.is_empty() {
        return Err(CoreError::Invalid("symbol must contain letters or digits".into()));
    }
    money::require_positive("multiplier", new.default_multiplier)?;
    if let Some(existing) = get_by_symbol(conn, &symbol)? {
        return Err(CoreError::Invalid(format!("instrument {} already exists", existing.symbol)));
    }
    conn.execute(
        "INSERT INTO instruments (symbol, symbol_key, name, asset_class, default_multiplier) VALUES (?1,?2,?3,?4,?5)",
        params![symbol, key, name, new.asset_class, money::to_db(new.default_multiplier)],
    )?;
    get(conn, conn.last_insert_rowid())
}

pub fn get(conn: &Connection, id: i64) -> Result<Instrument> {
    conn.query_row(&format!("{SELECT} WHERE id = ?1"), [id], row)
        .optional()?
        .ok_or_else(|| CoreError::NotFound(format!("instrument {id}")))
}

pub fn get_by_symbol(conn: &Connection, symbol: &str) -> Result<Option<Instrument>> {
    Ok(conn.query_row(&format!("{SELECT} WHERE symbol_key = ?1"), [symbol_key(symbol)], row).optional()?)
}

pub fn list(conn: &Connection) -> Result<Vec<Instrument>> {
    let mut stmt = conn.prepare(&format!("{SELECT} ORDER BY symbol_key"))?;
    let rows = stmt.query_map([], row)?.collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

const SELECT: &str = "SELECT id, symbol, name, asset_class, default_multiplier FROM instruments";

fn row(r: &rusqlite::Row) -> rusqlite::Result<Instrument> {
    Ok(Instrument {
        id: r.get(0)?,
        symbol: r.get(1)?,
        name: r.get(2)?,
        asset_class: r.get(3)?,
        default_multiplier: money::col(r, 4)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    /// Number of built-in instruments seeded by migration v4 (data rows of catalog/assets.csv).
    fn catalog_size() -> usize {
        include_str!("../catalog/assets.csv").lines().filter(|l| !l.is_empty() && !l.starts_with('#')).count()
    }

    fn new(symbol: &str, mult: &str) -> NewInstrument {
        NewInstrument {
            symbol: symbol.into(),
            name: String::new(),
            asset_class: AssetClass::Forex,
            default_multiplier: money::parse("m", mult).unwrap(),
        }
    }

    #[test]
    fn creates_and_finds_by_normalized_symbol() {
        let conn = db::open_in_memory().unwrap();
        let eu = create(&conn, &new("MYPAIR", "100000")).unwrap();
        assert_eq!(eu.default_multiplier.to_string(), "100000");
        assert_eq!(get_by_symbol(&conn, "my/pair").unwrap().unwrap().id, eu.id);
        assert!(get_by_symbol(&conn, "NOPE123").unwrap().is_none());
        assert_eq!(list(&conn).unwrap().len(), catalog_size() + 1);
    }

    #[test]
    fn catalog_is_available_with_names_and_default_multipliers() {
        let conn = db::open_in_memory().unwrap();
        let sol = get_by_symbol(&conn, "SOLUSD").unwrap().unwrap();
        assert_eq!((sol.name.as_str(), sol.asset_class), ("Solana", AssetClass::Crypto));
        let eu = get_by_symbol(&conn, "EUR/USD").unwrap().unwrap();
        assert_eq!((eu.asset_class, eu.default_multiplier.to_string()), (AssetClass::Forex, "100000".to_string()));
        assert_eq!(get_by_symbol(&conn, "XAUUSD").unwrap().unwrap().default_multiplier.to_string(), "100");
    }

    #[test]
    fn refuses_duplicates_and_invalid_values() {
        let conn = db::open_in_memory().unwrap();
        // EURUSD is part of the built-in catalog: creating it again is a duplicate.
        assert!(create(&conn, &new("EUR/USD", "1")).is_err());
        create(&conn, &new("MYPAIR", "1")).unwrap();
        assert!(create(&conn, &new("my pair", "1")).is_err());
        assert!(create(&conn, &new("  ", "1")).is_err());
        assert!(create(&conn, &new("/", "1")).is_err());
        assert!(create(&conn, &new("NAS100", "0")).is_err());
        assert!(create(&conn, &new("NAS100", "-1")).is_err());
        assert!(matches!(get(&conn, 999), Err(CoreError::NotFound(_))));
    }
}
