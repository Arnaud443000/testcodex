//! Alerts as the trader sees them: evaluated on the stored data, written once
//! to the `alert_log` history (migration v8), and hidden for good once
//! dismissed. A worse situation has a new identity, so it shows again (see
//! CLAUDE.md, "Identité, historique et alertes masquées").

use super::{Alert, Severity, evaluate, settings};
use crate::accounts::{self, Account};
use crate::error::{CoreError, Result};
use crate::settings as behavior_settings;
use crate::stats::load;
use crate::util::ids_condition;
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;

/// One line of the alert history.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AlertRecord {
    pub alert_id: String,
    pub account_id: i64,
    pub kind: String,
    pub severity: Severity,
    pub trade_id: Option<i64>,
    pub first_seen_at: i64,
    pub dismissed_at: Option<i64>,
    /// The alert as it was first shown (same shape as [`Alert`]).
    pub alert: serde_json::Value,
}

fn chosen_accounts(conn: &Connection, account_ids: &[i64]) -> Result<Vec<Account>> {
    if account_ids.is_empty() { accounts::list_active(conn) } else { account_ids.iter().map(|&id| accounts::get(conn, id)).collect() }
}

/// Every alert active at `now` on the given accounts (active accounts when
/// empty), each account evaluated on its own. New alerts are written to the
/// history; dismissed ones are left out.
pub fn active_alerts(conn: &Connection, account_ids: &[i64], now: i64, tz_offset_min: i32) -> Result<Vec<Alert>> {
    let behavior = behavior_settings::behavior(conn)?;
    let thresholds = settings::get(conn)?;
    let news_settings = crate::news::settings::get(conn)?;
    let news_events = if news_settings.enabled && news_settings.alert {
        let horizon = now + i64::from(crate::news::settings::MAX_WINDOW_MIN) * 60_000;
        crate::news::store::high_events_between(conn, i64::MIN, horizon)?
    } else {
        Vec::new()
    };
    let mut alerts = Vec::new();
    for account in chosen_accounts(conn, account_ids)? {
        let ledger = load(conn, &[account.id])?;
        alerts.extend(evaluate(&ledger, now, tz_offset_min, &behavior, &thresholds)?);
        alerts.extend(super::news::evaluate(&ledger, &news_events, now, tz_offset_min, &news_settings)?);
    }
    super::sort(&mut alerts);

    let tx = conn.unchecked_transaction()?;
    let mut visible = Vec::with_capacity(alerts.len());
    for alert in alerts {
        let payload = serde_json::to_string(&alert).map_err(|e| CoreError::Invalid(format!("alert cannot be saved: {e}")))?;
        tx.execute(
            "INSERT OR IGNORE INTO alert_log (alert_id, account_id, kind, severity, trade_id, payload, first_seen_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![alert.id, alert.account_id, super::message_key_kind(alert.message_key), severity_text(alert.severity), alert.trade_id, payload, now],
        )?;
        let dismissed: Option<i64> =
            tx.query_row("SELECT dismissed_at FROM alert_log WHERE alert_id = ?1", [&alert.id], |r| r.get(0)).optional()?.flatten();
        if dismissed.is_none() {
            visible.push(alert);
        }
    }
    tx.commit()?;
    Ok(visible)
}

/// Hides an alert for good (its identity will never show again). Dismissing twice keeps the first instant.
pub fn dismiss(conn: &Connection, alert_id: &str, now: i64) -> Result<()> {
    let n = conn.execute("UPDATE alert_log SET dismissed_at = COALESCE(dismissed_at, ?2) WHERE alert_id = ?1", params![alert_id, now])?;
    if n == 0 {
        return Err(CoreError::NotFound(format!("alert {alert_id}")));
    }
    Ok(())
}

/// Alerts ever shown on the given accounts (all when empty), most recent first.
pub fn history(conn: &Connection, account_ids: &[i64], limit: u32) -> Result<Vec<AlertRecord>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT alert_id, account_id, kind, severity, trade_id, first_seen_at, dismissed_at, payload FROM alert_log
         WHERE {} ORDER BY first_seen_at DESC, rowid DESC LIMIT ?1",
        ids_condition("account_id", account_ids)
    ))?;
    let rows = stmt.query_map([limit], |r| {
        Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get::<_, String>(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get::<_, String>(7)?))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let (alert_id, account_id, kind, severity, trade_id, first_seen_at, dismissed_at, payload) = row?;
        out.push(AlertRecord {
            alert_id,
            account_id,
            kind,
            severity: if severity == "critical" { Severity::Critical } else { Severity::Warning },
            trade_id,
            first_seen_at,
            dismissed_at,
            alert: serde_json::from_str(&payload).map_err(|e| CoreError::Invalid(format!("unreadable alert in history: {e}")))?,
        });
    }
    Ok(out)
}

fn severity_text(s: Severity) -> &'static str {
    match s {
        Severity::Critical => "critical",
        Severity::Warning => "warning",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::alerts::AlertSettings;
    use crate::db;
    use crate::test_support::{account, dec, instrument};
    use crate::trades::{self, Direction, TradeData};

    const DAY: i64 = 86_400_000;
    const MIN: i64 = 60_000;
    /// Tuesday 2026-09-29 00:00 UTC.
    const TUE: i64 = 20_725 * DAY;

    /// A closed long EURUSD-like trade (multiplier 1): entry 100, stop 90, PnL = exit − 100.
    fn closed(conn: &Connection, account_id: i64, entry_min: i64, exit_price: &str) -> i64 {
        let inst = instrument(conn, "TEST", "1");
        let mut t = TradeData::new(account_id, inst, Direction::Long, dec("1"), dec("100"), TUE + entry_min * MIN);
        t.exit_price = Some(dec(exit_price));
        t.exit_time = Some(TUE + (entry_min + 10) * MIN);
        t.planned_sl = Some(dec("90"));
        trades::create(conn, &t).unwrap().id
    }

    fn only_losses_in_a_row(conn: &Connection) {
        let s = AlertSettings {
            consecutive_losses: Some(2),
            burst_max_trades: None,
            daily_loss_percent: None,
            weekly_loss_percent: None,
            unusual_session: false,
            ..AlertSettings::default()
        };
        settings::set(conn, &s).unwrap();
    }

    #[test]
    fn a_dismissed_alert_never_loops_but_a_worse_one_shows() {
        let conn = db::open_in_memory().unwrap();
        only_losses_in_a_row(&conn);
        let a = account(&conn, "10000");
        closed(&conn, a, 9 * 60, "95");
        let second = closed(&conn, a, 10 * 60, "97");
        let now = TUE + 15 * 60 * MIN;

        let active = active_alerts(&conn, &[], now, 0).unwrap();
        assert_eq!(active.iter().map(|x| x.id.as_str()).collect::<Vec<_>>(), [format!("consecutiveLosses:{a}:{second}")]);
        // Asked again (the banner polls): same alert, logged once, first-seen instant kept.
        assert_eq!(active_alerts(&conn, &[a], now + MIN, 0).unwrap(), active);
        let h = history(&conn, &[], 10).unwrap();
        assert_eq!((h.len(), h[0].first_seen_at, h[0].dismissed_at, h[0].kind.as_str()), (1, now, None, "consecutiveLosses"));
        assert_eq!(h[0].alert["count"], 2);

        dismiss(&conn, &active[0].id, now + 2 * MIN).unwrap();
        dismiss(&conn, &active[0].id, now + 3 * MIN).unwrap();
        assert!(active_alerts(&conn, &[], now + 5 * MIN, 0).unwrap().is_empty(), "dismissed: hidden");
        assert_eq!(history(&conn, &[a], 10).unwrap()[0].dismissed_at, Some(now + 2 * MIN), "first dismissal kept");

        // A third loss: a new alert (new identity), shown again.
        let third = closed(&conn, a, 11 * 60, "99");
        let active = active_alerts(&conn, &[], now + 6 * MIN, 0).unwrap();
        assert_eq!(active.iter().map(|x| x.id.as_str()).collect::<Vec<_>>(), [format!("consecutiveLosses:{a}:{third}")]);
        let h = history(&conn, &[], 10).unwrap();
        assert_eq!(h.iter().map(|r| r.trade_id).collect::<Vec<_>>(), [Some(third), Some(second)], "most recent first");
        assert!(matches!(dismiss(&conn, "nope:1:1", now), Err(CoreError::NotFound(_))));
    }

    #[test]
    fn accounts_are_evaluated_separately_even_in_other_currencies() {
        let conn = db::open_in_memory().unwrap();
        only_losses_in_a_row(&conn);
        let usd = account(&conn, "10000");
        let eur = accounts::create(
            &conn,
            &accounts::NewAccount { name: "EUR".into(), kind: "personal".into(), broker: String::new(), currency: "EUR".into(), initial_capital: dec("5000") },
        )
        .unwrap()
        .id;
        // One loss on each account: never two losses in a row for either of them.
        closed(&conn, usd, 9 * 60, "95");
        closed(&conn, eur, 9 * 60 + 30, "95");
        assert!(active_alerts(&conn, &[], TUE + 15 * 60 * MIN, 0).unwrap().is_empty());
        // A second loss on the EUR account only.
        let t = closed(&conn, eur, 10 * 60, "95");
        let active = active_alerts(&conn, &[], TUE + 15 * 60 * MIN, 0).unwrap();
        assert_eq!(active.iter().map(|x| (x.account_id, x.trade_id)).collect::<Vec<_>>(), [(eur, Some(t))]);
        assert!(active_alerts(&conn, &[usd], TUE + 15 * 60 * MIN, 0).unwrap().is_empty());
        // Archived accounts are left out by default, still readable when named.
        accounts::set_archived(&conn, eur, true).unwrap();
        assert!(active_alerts(&conn, &[], TUE + 15 * 60 * MIN, 0).unwrap().is_empty());
        assert_eq!(active_alerts(&conn, &[eur], TUE + 15 * 60 * MIN, 0).unwrap().len(), 1);
        assert_eq!(history(&conn, &[usd], 10).unwrap().len(), 0);
        assert_eq!(history(&conn, &[eur], 10).unwrap().len(), 1);
    }

    #[test]
    fn deleting_the_trade_keeps_the_history_and_deleting_the_account_removes_it() {
        let conn = db::open_in_memory().unwrap();
        only_losses_in_a_row(&conn);
        let a = account(&conn, "10000");
        let first = closed(&conn, a, 9 * 60, "95");
        let second = closed(&conn, a, 10 * 60, "95");
        assert_eq!(active_alerts(&conn, &[a], TUE + 15 * 60 * MIN, 0).unwrap().len(), 1);
        trades::delete(&conn, second).unwrap();
        assert!(active_alerts(&conn, &[a], TUE + 15 * 60 * MIN, 0).unwrap().is_empty(), "recomputed: gone");
        assert_eq!(history(&conn, &[a], 10).unwrap()[0].trade_id, Some(second), "history kept");
        trades::delete(&conn, first).unwrap();
        accounts::delete(&conn, a).unwrap();
        let left: i64 = conn.query_row("SELECT COUNT(*) FROM alert_log", [], |r| r.get(0)).unwrap();
        assert_eq!(left, 0);
    }
}
