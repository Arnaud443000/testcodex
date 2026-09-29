//! Small fixtures shared by unit tests.

use crate::accounts::{self, NewAccount};
use crate::instruments::{self, AssetClass, NewInstrument};
use crate::money::{self, Decimal};
use rusqlite::Connection;

pub(crate) fn dec(s: &str) -> Decimal {
    money::parse("test value", s).unwrap()
}

pub(crate) fn account(conn: &Connection, initial_capital: &str) -> i64 {
    accounts::create(
        conn,
        &NewAccount {
            name: "Test account".into(),
            kind: "personal".into(),
            broker: String::new(),
            currency: "USD".into(),
            initial_capital: dec(initial_capital),
        },
    )
    .unwrap()
    .id
}

/// Returns the instrument for `symbol` with the given default multiplier. The built-in
/// catalog already holds common symbols (EURUSD…), so an existing one is reused and
/// its multiplier set to the value the test wants.
pub(crate) fn instrument(conn: &Connection, symbol: &str, multiplier: &str) -> i64 {
    if let Some(existing) = instruments::get_by_symbol(conn, symbol).unwrap() {
        conn.execute(
            "UPDATE instruments SET default_multiplier = ?1 WHERE id = ?2",
            rusqlite::params![multiplier, existing.id],
        )
        .unwrap();
        return existing.id;
    }
    instruments::create(
        conn,
        &NewInstrument { symbol: symbol.into(), name: String::new(), asset_class: AssetClass::Forex, default_multiplier: dec(multiplier) },
    )
    .unwrap()
    .id
}
