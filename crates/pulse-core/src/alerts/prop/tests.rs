//! Prop firm alerts (lot 33): journal P1 of `prop/tests.rs` (capital 100 000, daily loss 5 % of the
//! initial capital = 5 000, maximum loss 10 % static = 10 000, reset 00:00 Paris, started 2026-09-01).

use super::*;
use crate::accounts::{self, NewAccount};
use crate::alerts::{AlertSettings, active_alerts, dismiss, settings as alert_settings};
use crate::db;
use crate::prop::rules::{self, LimitInput, PropRulesInput};
use crate::stats::time::days_from_civil;
use crate::test_support::{dec, instrument};
use crate::trades::{self, Direction, TradeData};

const DAY: i64 = 86_400_000;
const HOUR: i64 = 3_600_000;

fn at(y: i64, m: u32, d: u32, h: i64) -> i64 {
    days_from_civil(y, m, d).unwrap() * DAY + h * HOUR
}

/// 2026-09-15 15:00 UTC = 17:00 in Paris.
fn now() -> i64 {
    at(2026, 9, 15, 15)
}

fn limit(mode: &str, value: &str) -> Option<LimitInput> {
    Some(LimitInput { mode: mode.into(), value: value.into() })
}

fn p1() -> PropRulesInput {
    PropRulesInput {
        phase_label: Some("Évaluation 1".into()),
        started_on: "2026-09-01".into(),
        daily_loss: limit("percent", "5"),
        daily_reference: "initialBalance".into(),
        max_loss: limit("percent", "10"),
        max_loss_kind: "static".into(),
        trailing_locks_at_initial: false,
        reset_time: "00:00".into(),
        reset_zone: "paris".into(),
        profit_target: None,
        min_trading_days: None,
        consistency_max_best_day_percent: None,
    }
}

/// A database with the lot-12 alerts switched off (only the prop alerts are looked at) and a prop account.
fn setup(kind: &str) -> (rusqlite::Connection, i64) {
    let conn = db::open_in_memory().unwrap();
    let off = AlertSettings {
        consecutive_losses: None,
        burst_max_trades: None,
        daily_loss_percent: None,
        weekly_loss_percent: None,
        revenge: false,
        unusual_session: false,
        no_stop_loss: false,
        ..AlertSettings::default()
    };
    alert_settings::set(&conn, &off).unwrap();
    let id = accounts::create(
        &conn,
        &NewAccount { name: "Défi".into(), kind: kind.into(), broker: String::new(), currency: "USD".into(), initial_capital: dec("100000") },
    )
    .unwrap()
    .id;
    (conn, id)
}

/// A closed trade: size 1, multiplier 1, entry 10 000 → PnL = exit − 10 000.
fn closed(conn: &rusqlite::Connection, account: i64, exit_at: i64, pnl: i64) -> i64 {
    let inst = instrument(conn, "TEST", "1");
    let mut t = TradeData::new(account, inst, Direction::Long, dec("1"), dec("10000"), exit_at - HOUR);
    t.exit_time = Some(exit_at);
    t.exit_price = Some(Decimal::from(10_000 + pnl));
    t.planned_sl = Some(dec("9000"));
    trades::create(conn, &t).unwrap().id
}

fn ids(conn: &rusqlite::Connection, now: i64) -> Vec<String> {
    active_alerts(conn, &[], now, 120).unwrap().into_iter().map(|a| a.id).filter(|id| id.starts_with("prop")).collect()
}

#[test]
fn the_daily_loss_alert_follows_the_levels() {
    let (conn, acc) = setup("prop");
    rules::set(&conn, acc, &p1(), 1).unwrap();
    // −3 000 today = 60 %: nothing.
    closed(&conn, acc, at(2026, 9, 15, 8), -3000);
    assert!(ids(&conn, now()).is_empty(), "below 70 %");
    // −500 more = 3 500 = 70 %: watch (warning).
    let t = closed(&conn, acc, at(2026, 9, 15, 9), -500);
    let active = active_alerts(&conn, &[], now(), 120).unwrap();
    assert_eq!(active.len(), 1);
    let a = &active[0];
    assert_eq!(a.id, format!("propDailyLoss:{acc}:2026-09-01:2026-09-15:warning"));
    assert_eq!((a.severity, a.message_key, a.trade_id, a.at), (Severity::Warning, "propDailyLoss.warning", Some(t), at(2026, 9, 15, 9)));
    let AlertDetail::PropDailyLoss(d) = &a.detail else { panic!("{a:?}") };
    assert_eq!((d.level, d.remaining, d.limit, d.used), (Level::Warning, Some(dec("1500")), Some(dec("5000")), Some(0.7)));
    assert_eq!((d.trading_day.as_deref(), d.next_reset_paris_time.as_deref(), d.phase_label.as_deref()), (Some("2026-09-15"), Some("00:00"), Some("Évaluation 1")));
    let json = serde_json::to_value(a).unwrap();
    assert_eq!((json["kind"].as_str(), json["remaining"].as_str()), (Some("propDailyLoss"), Some("1500")));
}

#[test]
fn a_worse_level_is_a_new_alert_a_dismissed_one_stays_hidden() {
    let (conn, acc) = setup("prop");
    rules::set(&conn, acc, &p1(), 1).unwrap();
    closed(&conn, acc, at(2026, 9, 15, 8), -3600);
    let warning = format!("propDailyLoss:{acc}:2026-09-01:2026-09-15:warning");
    assert_eq!(ids(&conn, now()), [warning.as_str()]);
    dismiss(&conn, &warning, now()).unwrap();
    // Same level, a bit worse (3 800 = 76 %): same identity, still hidden.
    closed(&conn, acc, at(2026, 9, 15, 9), -200);
    assert!(ids(&conn, now()).is_empty());
    // 4 600 = 92 %: critical, a new alert.
    closed(&conn, acc, at(2026, 9, 15, 10), -800);
    let critical = active_alerts(&conn, &[], now(), 120).unwrap();
    assert_eq!(critical.iter().map(|a| (a.id.as_str(), a.severity)).collect::<Vec<_>>(), [(format!("propDailyLoss:{acc}:2026-09-01:2026-09-15:critical").as_str(), Severity::Critical)]);
    // 5 000 = limit: reached, critical too, another new alert.
    closed(&conn, acc, at(2026, 9, 15, 11), -400);
    let reached = active_alerts(&conn, &[], now(), 120).unwrap();
    assert_eq!((reached[0].message_key, reached[0].severity), ("propDailyLoss.reached", Severity::Critical));
    // A win brings it back to 60 %: nothing (an improvement never raises an alert).
    closed(&conn, acc, at(2026, 9, 15, 12), 2000);
    assert!(ids(&conn, now()).is_empty());
    // Back to 76 % (critical and reached were seen for this day): no "new" watch alert either.
    closed(&conn, acc, at(2026, 9, 15, 13), -800);
    assert!(ids(&conn, now()).is_empty(), "an improvement from reached to watch is not a new alert");
    // The next trading day starts from zero: a new day, a new alert when it gets bad again.
    let tomorrow = at(2026, 9, 16, 15);
    closed(&conn, acc, at(2026, 9, 16, 8), -3500);
    let next: Vec<String> = ids(&conn, tomorrow).into_iter().filter(|i| i.starts_with("propDailyLoss")).collect();
    assert_eq!(next, [format!("propDailyLoss:{acc}:2026-09-01:2026-09-16:warning")]);
}

#[test]
fn an_improvement_to_a_level_never_shown_is_not_a_new_alert() {
    let (conn, acc) = setup("prop");
    rules::set(&conn, acc, &p1(), 1).unwrap();
    // Straight to 96 %: critical (never "watch" before).
    closed(&conn, acc, at(2026, 9, 15, 8), -4800);
    assert_eq!(ids(&conn, now()), [format!("propDailyLoss:{acc}:2026-09-01:2026-09-15:critical")]);
    // A win brings it to 76 %: the watch level was never shown, still nothing new.
    closed(&conn, acc, at(2026, 9, 15, 9), 1000);
    assert!(ids(&conn, now()).is_empty());
}

#[test]
fn maximum_loss_and_consistency_alerts() {
    let (conn, acc) = setup("prop");
    let mut input = p1();
    input.daily_loss = None;
    input.consistency_max_best_day_percent = Some("40".into());
    rules::set(&conn, acc, &input, 1).unwrap();
    // +3 000 on 09-02, +1 000 on 09-03: total 4 000, best day 75 % > 40 %: consistency reached.
    closed(&conn, acc, at(2026, 9, 2, 8), 3000);
    closed(&conn, acc, at(2026, 9, 3, 8), 1000);
    let active = active_alerts(&conn, &[], now(), 120).unwrap();
    assert_eq!(active.iter().map(|a| a.id.clone()).collect::<Vec<_>>(), [format!("propConsistency:{acc}:2026-09-01:reached")]);
    let AlertDetail::PropConsistency(c) = &active[0].detail else { panic!() };
    assert_eq!((c.share, c.max_best_day_percent, c.remaining), (Some(0.75), Some(dec("40")), None));
    // −11 000 on 09-04: balance 93 000, floor 90 000, 3 000 left = 70 % used: watch.
    closed(&conn, acc, at(2026, 9, 4, 8), -11000);
    let active = active_alerts(&conn, &[], now(), 120).unwrap();
    let max: Vec<&Alert> = active.iter().filter(|a| a.id.starts_with("propMaxLoss")).collect();
    assert_eq!(max.len(), 1);
    assert_eq!((max[0].id.clone(), max[0].severity), (format!("propMaxLoss:{acc}:2026-09-01:warning"), Severity::Warning));
    let AlertDetail::PropMaxLoss(m) = &max[0].detail else { panic!() };
    assert_eq!((m.remaining, m.limit), (Some(dec("3000")), Some(dec("10000"))));
    // Total now −7 000: consistency undefined, its alert is gone.
    assert!(active.iter().all(|a| !a.id.starts_with("propConsistency")));
}

#[test]
fn no_alert_without_rules_without_a_prop_account_or_when_switched_off() {
    // A prop account without rules: nothing.
    let (conn, acc) = setup("prop");
    closed(&conn, acc, at(2026, 9, 15, 8), -9000);
    assert!(ids(&conn, now()).is_empty());
    // A personal account: nothing, and no error either.
    let (conn2, personal) = setup("personal");
    closed(&conn2, personal, at(2026, 9, 15, 8), -9000);
    assert!(ids(&conn2, now()).is_empty());
    // Rules set, alerts.prop off: nothing; on again: the alert shows.
    rules::set(&conn, acc, &p1(), 1).unwrap();
    assert!(enabled(&conn).unwrap(), "on by default");
    assert!(!set_enabled(&conn, false).unwrap());
    assert!(ids(&conn, now()).is_empty());
    assert!(!crate::prop::status(&conn, acc, now()).unwrap().unwrap().alerts_enabled);
    set_enabled(&conn, true).unwrap();
    assert_eq!(ids(&conn, now()).len(), 2, "daily loss reached and maximum loss at 90 %");
    // A bad stored value is an error, never guessed.
    crate::settings::write(&conn, PROP_ALERTS, Some("maybe".into())).unwrap();
    assert!(enabled(&conn).is_err());
}

#[test]
fn drop_improvements_is_pure_and_keeps_worse_levels() {
    let (conn, acc) = setup("prop");
    rules::set(&conn, acc, &p1(), 1).unwrap();
    closed(&conn, acc, at(2026, 9, 15, 8), -3600);
    let s = crate::prop::status(&conn, acc, now()).unwrap().unwrap();
    let alerts = evaluate(&s);
    assert_eq!(alerts.len(), 1);
    let scope = format!("propDailyLoss:{acc}:2026-09-01:2026-09-15");
    // Seen before at a worse level: dropped. At the same or a better level: kept.
    assert!(drop_improvements(alerts.clone(), &[format!("{scope}:critical")]).is_empty());
    assert_eq!(drop_improvements(alerts.clone(), &[format!("{scope}:warning")]).len(), 1);
    assert_eq!(drop_improvements(alerts.clone(), &[format!("propDailyLoss:{acc}:2026-09-01:2026-09-14:reached")]).len(), 1, "another day");
    assert_eq!(drop_improvements(alerts, &[]).len(), 1);
}
