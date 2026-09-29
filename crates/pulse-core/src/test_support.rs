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

pub(crate) fn instrument(conn: &Connection, symbol: &str, multiplier: &str) -> i64 {
    instruments::create(
        conn,
        &NewInstrument { symbol: symbol.into(), asset_class: AssetClass::Forex, default_multiplier: dec(multiplier) },
    )
    .unwrap()
    .id
}
