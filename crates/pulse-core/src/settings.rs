//! User thresholds of the behavioural analysis, stored in the key/value
//! `settings` table (no migration needed). Nothing is imposed: a missing
//! limit disables what depends on it (see CLAUDE.md, "Analyse comportementale").

use crate::error::{CoreError, Result};
use crate::money::{self, Decimal};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

const MAX_RISK_PERCENT: &str = "behavior.max_risk_percent";
const MAX_TRADES_PER_DAY: &str = "behavior.max_trades_per_day";
const REVENGE_WINDOW_MIN: &str = "behavior.revenge_window_min";
const REVENGE_SIZE_FACTOR: &str = "behavior.revenge_size_factor";

pub const DEFAULT_REVENGE_WINDOW_MIN: u32 = 60;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BehaviorSettings {
    /// Maximum risk per trade in percent of the balance (1.5 = 1.5 %); `None` = no limit.
    #[serde(default)]
    pub max_risk_percent: Option<Decimal>,
    /// Maximum number of trades entered per local day; `None` = no limit.
    #[serde(default)]
    pub max_trades_per_day: Option<u32>,
    /// A trade entered at most this many minutes after a loss can be a revenge trade.
    pub revenge_window_min: u32,
    /// Exposure ratio (this trade / the losing one) from which it is a revenge trade.
    pub revenge_size_factor: Decimal,
}

impl Default for BehaviorSettings {
    fn default() -> Self {
        BehaviorSettings {
            max_risk_percent: None,
            max_trades_per_day: None,
            revenge_window_min: DEFAULT_REVENGE_WINDOW_MIN,
            revenge_size_factor: Decimal::new(15, 1),
        }
    }
}

pub fn behavior(conn: &Connection) -> Result<BehaviorSettings> {
    let d = BehaviorSettings::default();
    Ok(BehaviorSettings {
        max_risk_percent: read(conn, MAX_RISK_PERCENT)?.map(|s| money::parse(MAX_RISK_PERCENT, &s)).transpose()?,
        max_trades_per_day: read(conn, MAX_TRADES_PER_DAY)?.map(|s| int(MAX_TRADES_PER_DAY, &s)).transpose()?,
        revenge_window_min: read(conn, REVENGE_WINDOW_MIN)?
            .map(|s| int(REVENGE_WINDOW_MIN, &s))
            .transpose()?
            .unwrap_or(d.revenge_window_min),
        revenge_size_factor: read(conn, REVENGE_SIZE_FACTOR)?
            .map(|s| money::parse(REVENGE_SIZE_FACTOR, &s))
            .transpose()?
            .unwrap_or(d.revenge_size_factor),
    })
}

/// Validates and saves every threshold at once; returns what is now stored.
pub fn set_behavior(conn: &Connection, s: &BehaviorSettings) -> Result<BehaviorSettings> {
    if s.max_risk_percent.is_some_and(|p| p <= Decimal::ZERO || p > Decimal::ONE_HUNDRED) {
        return Err(CoreError::Invalid("the maximum risk per trade must be between 0 and 100 %".into()));
    }
    if s.max_trades_per_day == Some(0) {
        return Err(CoreError::Invalid("the maximum number of trades per day must be at least 1".into()));
    }
    if s.revenge_window_min == 0 || s.revenge_window_min > 24 * 60 {
        return Err(CoreError::Invalid("the revenge window must be between 1 minute and 24 hours".into()));
    }
    if s.revenge_size_factor < Decimal::ONE {
        return Err(CoreError::Invalid("the revenge size factor must be at least 1".into()));
    }
    let tx = conn.unchecked_transaction()?;
    write(&tx, MAX_RISK_PERCENT, s.max_risk_percent.map(money::to_db))?;
    write(&tx, MAX_TRADES_PER_DAY, s.max_trades_per_day.map(|n| n.to_string()))?;
    write(&tx, REVENGE_WINDOW_MIN, Some(s.revenge_window_min.to_string()))?;
    write(&tx, REVENGE_SIZE_FACTOR, Some(money::to_db(s.revenge_size_factor)))?;
    tx.commit()?;
    behavior(conn)
}

fn read(conn: &Connection, key: &str) -> Result<Option<String>> {
    Ok(conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0)).optional()?)
}

fn write(conn: &Connection, key: &str, value: Option<String>) -> Result<()> {
    match value {
        Some(v) => conn.execute(
            "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, v],
        )?,
        None => conn.execute("DELETE FROM settings WHERE key = ?1", [key])?,
    };
    Ok(())
}

fn int(key: &str, s: &str) -> Result<u32> {
    s.trim().parse().map_err(|_| CoreError::Invalid(format!("{key} is not a valid whole number: {s:?}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::test_support::dec;

    #[test]
    fn defaults_then_round_trip_and_clear() {
        let conn = db::open_in_memory().unwrap();
        assert_eq!(behavior(&conn).unwrap(), BehaviorSettings::default());
        assert_eq!(BehaviorSettings::default().revenge_size_factor, dec("1.5"));
        let custom = BehaviorSettings {
            max_risk_percent: Some(dec("1.50")),
            max_trades_per_day: Some(3),
            revenge_window_min: 30,
            revenge_size_factor: dec("2"),
        };
        assert_eq!(set_behavior(&conn, &custom).unwrap(), custom);
        assert_eq!(behavior(&conn).unwrap().max_risk_percent.unwrap().to_string(), "1.50");
        // Removing a limit deletes it.
        let cleared = set_behavior(&conn, &BehaviorSettings { max_risk_percent: None, max_trades_per_day: None, ..custom }).unwrap();
        assert_eq!((cleared.max_risk_percent, cleared.max_trades_per_day, cleared.revenge_window_min), (None, None, 30));
    }

    #[test]
    fn rejects_out_of_range_values() {
        let conn = db::open_in_memory().unwrap();
        let d = BehaviorSettings::default();
        for bad in [
            BehaviorSettings { max_risk_percent: Some(dec("0")), ..d.clone() },
            BehaviorSettings { max_risk_percent: Some(dec("100.01")), ..d.clone() },
            BehaviorSettings { max_trades_per_day: Some(0), ..d.clone() },
            BehaviorSettings { revenge_window_min: 0, ..d.clone() },
            BehaviorSettings { revenge_size_factor: dec("0.9"), ..d.clone() },
        ] {
            assert!(matches!(set_behavior(&conn, &bad), Err(CoreError::Invalid(_))), "{bad:?}");
        }
        assert_eq!(behavior(&conn).unwrap(), d, "nothing was written");
    }
}
