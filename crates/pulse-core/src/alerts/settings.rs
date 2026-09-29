//! Thresholds of the guard-rail alerts (spec 3.6.7), in the key/value
//! `settings` table under `alerts.*`. A missing row means "use the default";
//! the value `off` disables an alert whose default is active. The daily trade
//! limit and the revenge definition are the lot-8 `behavior.*` settings, never
//! duplicated here (see CLAUDE.md, "Alertes à seuils").

use crate::error::{CoreError, Result};
use crate::money::{self, Decimal};
use crate::reminder::parse_time;
use crate::settings::{read, write};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

const CONSECUTIVE_LOSSES: &str = "alerts.consecutive_losses";
const BURST_MAX_TRADES: &str = "alerts.burst_max_trades";
const BURST_WINDOW_MIN: &str = "alerts.burst_window_min";
const DAILY_LOSS_PERCENT: &str = "alerts.daily_loss_percent";
const DAILY_LOSS_AMOUNT: &str = "alerts.daily_loss_amount";
const WEEKLY_LOSS_PERCENT: &str = "alerts.weekly_loss_percent";
const WEEKLY_LOSS_AMOUNT: &str = "alerts.weekly_loss_amount";
const REVENGE: &str = "alerts.revenge";
const TRADING_HOURS: &str = "alerts.trading_hours";
const UNUSUAL_SESSION: &str = "alerts.unusual_session";
const NO_STOP_LOSS: &str = "alerts.no_stop_loss";

const OFF: &str = "off";
const ON: &str = "on";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlertSettings {
    /// Losing trades in a row, today, that trigger the alert (2–20); `None` = off.
    pub consecutive_losses: Option<u32>,
    /// Maximum number of trades entered in the sliding window (1–100); `None` = off.
    pub burst_max_trades: Option<u32>,
    /// Length of the sliding window, in minutes (1–1440).
    pub burst_window_min: u32,
    /// Daily loss in percent of the balance at the start of the day (3 = 3 %); `None` = off.
    pub daily_loss_percent: Option<Decimal>,
    /// Daily loss in money, in each account's currency; `None` = off.
    pub daily_loss_amount: Option<Decimal>,
    pub weekly_loss_percent: Option<Decimal>,
    pub weekly_loss_amount: Option<Decimal>,
    pub revenge: bool,
    /// Allowed local hours "HH:MM-HH:MM" (start included, end excluded, may wrap midnight); `None` = off.
    pub trading_hours: Option<String>,
    pub unusual_session: bool,
    pub no_stop_loss: bool,
}

impl Default for AlertSettings {
    fn default() -> Self {
        AlertSettings {
            consecutive_losses: Some(3),
            burst_max_trades: Some(3),
            burst_window_min: 60,
            daily_loss_percent: Some(Decimal::from(3)),
            daily_loss_amount: None,
            weekly_loss_percent: Some(Decimal::from(6)),
            weekly_loss_amount: None,
            revenge: true,
            trading_hours: None,
            unusual_session: true,
            no_stop_loss: true,
        }
    }
}

/// "HH:MM-HH:MM" → (start, end) in minutes since midnight; `None` for anything
/// else, including an empty range (start = end).
pub fn parse_hours(s: &str) -> Option<(u32, u32)> {
    let (start, end) = s.split_once('-')?;
    let (start, end) = (parse_time(start.trim())?, parse_time(end.trim())?);
    (start != end).then_some((start, end))
}

/// Whether a local minute of the day falls in the allowed range.
pub(crate) fn in_hours(minute: u32, (start, end): (u32, u32)) -> bool {
    if start < end { (start..end).contains(&minute) } else { minute >= start || minute < end }
}

/// Reads one optional value: missing row → `default`, `off` → `None`.
fn optional<T: Clone>(conn: &Connection, key: &str, default: Option<T>, parse: impl Fn(&str) -> Result<T>) -> Result<Option<T>> {
    match read(conn, key)? {
        None => Ok(default),
        Some(v) if v.trim() == OFF => Ok(None),
        Some(v) => parse(v.trim()).map(Some),
    }
}

fn flag(conn: &Connection, key: &str, default: bool) -> Result<bool> {
    match read(conn, key)?.as_deref().map(str::trim) {
        None => Ok(default),
        Some(ON) => Ok(true),
        Some(OFF) => Ok(false),
        Some(other) => Err(CoreError::Invalid(format!("{key} must be on or off, got {other:?}"))),
    }
}

fn whole(key: &str, s: &str) -> Result<u32> {
    s.parse().map_err(|_| CoreError::Invalid(format!("{key} is not a valid whole number: {s:?}")))
}

pub fn get(conn: &Connection) -> Result<AlertSettings> {
    let d = AlertSettings::default();
    let decimal = |key: &'static str| move |s: &str| money::parse(key, s);
    Ok(AlertSettings {
        consecutive_losses: optional(conn, CONSECUTIVE_LOSSES, d.consecutive_losses, |s| whole(CONSECUTIVE_LOSSES, s))?,
        burst_max_trades: optional(conn, BURST_MAX_TRADES, d.burst_max_trades, |s| whole(BURST_MAX_TRADES, s))?,
        burst_window_min: read(conn, BURST_WINDOW_MIN)?.map(|s| whole(BURST_WINDOW_MIN, s.trim())).transpose()?.unwrap_or(d.burst_window_min),
        daily_loss_percent: optional(conn, DAILY_LOSS_PERCENT, d.daily_loss_percent, decimal(DAILY_LOSS_PERCENT))?,
        daily_loss_amount: optional(conn, DAILY_LOSS_AMOUNT, d.daily_loss_amount, decimal(DAILY_LOSS_AMOUNT))?,
        weekly_loss_percent: optional(conn, WEEKLY_LOSS_PERCENT, d.weekly_loss_percent, decimal(WEEKLY_LOSS_PERCENT))?,
        weekly_loss_amount: optional(conn, WEEKLY_LOSS_AMOUNT, d.weekly_loss_amount, decimal(WEEKLY_LOSS_AMOUNT))?,
        revenge: flag(conn, REVENGE, d.revenge)?,
        trading_hours: optional(conn, TRADING_HOURS, d.trading_hours, |s| {
            parse_hours(s).map(|_| s.to_string()).ok_or_else(|| CoreError::Invalid(format!("{TRADING_HOURS} must look like 09:00-17:30, got {s:?}")))
        })?,
        unusual_session: flag(conn, UNUSUAL_SESSION, d.unusual_session)?,
        no_stop_loss: flag(conn, NO_STOP_LOSS, d.no_stop_loss)?,
    })
}

fn validate(s: &AlertSettings) -> Result<()> {
    let invalid = |m: &str| Err(CoreError::Invalid(m.into()));
    if s.consecutive_losses.is_some_and(|n| !(2..=20).contains(&n)) {
        return invalid("the number of consecutive losses must be between 2 and 20");
    }
    if s.burst_max_trades.is_some_and(|n| !(1..=100).contains(&n)) {
        return invalid("the maximum number of trades in the window must be between 1 and 100");
    }
    if !(1..=24 * 60).contains(&s.burst_window_min) {
        return invalid("the trade window must be between 1 minute and 24 hours");
    }
    for p in [s.daily_loss_percent, s.weekly_loss_percent].into_iter().flatten() {
        if p <= Decimal::ZERO || p > Decimal::ONE_HUNDRED {
            return invalid("a loss limit in percent must be greater than 0 and at most 100");
        }
    }
    if [s.daily_loss_amount, s.weekly_loss_amount].into_iter().flatten().any(|a| a <= Decimal::ZERO) {
        return invalid("a loss limit in money must be greater than 0");
    }
    if s.trading_hours.as_deref().is_some_and(|h| parse_hours(h).is_none()) {
        return invalid("trading hours must look like 09:00-17:30, with a different start and end");
    }
    Ok(())
}

/// Validates and saves every threshold at once (nothing is written when one
/// is invalid); returns what is now stored.
pub fn set(conn: &Connection, s: &AlertSettings) -> Result<AlertSettings> {
    validate(s)?;
    let opt = |v: Option<String>| Some(v.unwrap_or_else(|| OFF.into()));
    let flag = |b: bool| Some(if b { ON } else { OFF }.to_string());
    let tx = conn.unchecked_transaction()?;
    write(&tx, CONSECUTIVE_LOSSES, opt(s.consecutive_losses.map(|n| n.to_string())))?;
    write(&tx, BURST_MAX_TRADES, opt(s.burst_max_trades.map(|n| n.to_string())))?;
    write(&tx, BURST_WINDOW_MIN, Some(s.burst_window_min.to_string()))?;
    write(&tx, DAILY_LOSS_PERCENT, opt(s.daily_loss_percent.map(money::to_db)))?;
    write(&tx, DAILY_LOSS_AMOUNT, opt(s.daily_loss_amount.map(money::to_db)))?;
    write(&tx, WEEKLY_LOSS_PERCENT, opt(s.weekly_loss_percent.map(money::to_db)))?;
    write(&tx, WEEKLY_LOSS_AMOUNT, opt(s.weekly_loss_amount.map(money::to_db)))?;
    write(&tx, REVENGE, flag(s.revenge))?;
    write(&tx, TRADING_HOURS, opt(s.trading_hours.as_ref().map(|h| h.trim().to_string())))?;
    write(&tx, UNUSUAL_SESSION, flag(s.unusual_session))?;
    write(&tx, NO_STOP_LOSS, flag(s.no_stop_loss))?;
    tx.commit()?;
    get(conn)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::test_support::dec;

    #[test]
    fn defaults_when_nothing_is_stored() {
        let conn = db::open_in_memory().unwrap();
        let s = get(&conn).unwrap();
        assert_eq!(s, AlertSettings::default());
        assert_eq!((s.consecutive_losses, s.burst_max_trades, s.burst_window_min), (Some(3), Some(3), 60));
        assert_eq!((s.daily_loss_percent, s.weekly_loss_percent), (Some(dec("3")), Some(dec("6"))));
        assert_eq!((s.daily_loss_amount, s.weekly_loss_amount, s.trading_hours.as_deref()), (None, None, None));
        assert!(s.revenge && s.unusual_session && s.no_stop_loss);
    }

    #[test]
    fn round_trip_and_off_disables_a_default() {
        let conn = db::open_in_memory().unwrap();
        let custom = AlertSettings {
            consecutive_losses: None,
            burst_max_trades: Some(5),
            burst_window_min: 30,
            daily_loss_percent: None,
            daily_loss_amount: Some(dec("250.50")),
            weekly_loss_percent: Some(dec("4.5")),
            weekly_loss_amount: Some(dec("1000")),
            revenge: false,
            trading_hours: Some("22:00-02:00".into()),
            unusual_session: false,
            no_stop_loss: false,
        };
        assert_eq!(set(&conn, &custom).unwrap(), custom);
        // A default that was switched off is stored as "off", not deleted (else the default would come back).
        let stored: String = conn.query_row("SELECT value FROM settings WHERE key = 'alerts.consecutive_losses'", [], |r| r.get(0)).unwrap();
        assert_eq!(stored, "off");
        assert_eq!(get(&conn).unwrap().daily_loss_amount.unwrap().to_string(), "250.50", "scale kept");
        // The lot-8 settings are untouched.
        assert_eq!(crate::settings::behavior(&conn).unwrap(), crate::settings::BehaviorSettings::default());
    }

    #[test]
    fn rejects_out_of_range_values_and_writes_nothing() {
        let conn = db::open_in_memory().unwrap();
        let d = AlertSettings::default();
        for bad in [
            AlertSettings { consecutive_losses: Some(1), ..d.clone() },
            AlertSettings { consecutive_losses: Some(21), ..d.clone() },
            AlertSettings { burst_max_trades: Some(0), ..d.clone() },
            AlertSettings { burst_window_min: 0, ..d.clone() },
            AlertSettings { burst_window_min: 1441, ..d.clone() },
            AlertSettings { daily_loss_percent: Some(dec("0")), ..d.clone() },
            AlertSettings { weekly_loss_percent: Some(dec("100.01")), ..d.clone() },
            AlertSettings { daily_loss_amount: Some(dec("0")), ..d.clone() },
            AlertSettings { trading_hours: Some("09:00-09:00".into()), ..d.clone() },
            AlertSettings { trading_hours: Some("9h-17h".into()), ..d.clone() },
            AlertSettings { trading_hours: Some("09:00-24:00".into()), ..d.clone() },
        ] {
            assert!(matches!(set(&conn, &bad), Err(CoreError::Invalid(_))), "{bad:?}");
        }
        let rows: i64 = conn.query_row("SELECT COUNT(*) FROM settings WHERE key LIKE 'alerts.%'", [], |r| r.get(0)).unwrap();
        assert_eq!(rows, 0);
        // Limits exactly at the bounds are accepted.
        let edge = AlertSettings {
            consecutive_losses: Some(20),
            burst_max_trades: Some(1),
            burst_window_min: 1440,
            daily_loss_percent: Some(dec("100")),
            ..d
        };
        assert_eq!(set(&conn, &edge).unwrap(), edge);
    }

    #[test]
    fn corrupt_rows_are_reported_not_ignored() {
        let conn = db::open_in_memory().unwrap();
        conn.execute("INSERT INTO settings (key, value) VALUES ('alerts.revenge', 'maybe')", []).unwrap();
        assert!(matches!(get(&conn), Err(CoreError::Invalid(_))));
    }

    #[test]
    fn hours_parse_and_wrap_midnight() {
        assert_eq!(parse_hours("09:00-17:30"), Some((540, 1050)));
        assert_eq!(parse_hours("22:00 - 02:00"), Some((1320, 120)));
        assert_eq!(parse_hours("09:00"), None);
        let day = parse_hours("09:00-17:30").unwrap();
        assert!(in_hours(540, day), "start included");
        assert!(!in_hours(1050, day), "end excluded");
        assert!(!in_hours(539, day));
        let night = parse_hours("22:00-02:00").unwrap();
        assert!(in_hours(1320, night) && in_hours(0, night) && in_hours(119, night));
        assert!(!in_hours(120, night) && !in_hours(1319, night) && !in_hours(600, night));
    }
}
