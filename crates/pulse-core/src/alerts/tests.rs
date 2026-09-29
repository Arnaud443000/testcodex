//! Known-result tests for the guard-rail alerts. Every expected value is
//! computed by hand in the comments (see CLAUDE.md, "Alertes à seuils").
//!
//! Journals: long trades on instrument 1, entry price 100, multiplier 1, so
//! net PnL = (exit − 100) × size and the risk with a stop at 90 is 10 × size.

use super::*;
use crate::instruments::AssetClass;
use crate::stats::{AccountCapital, CapitalMove, Journal, Position, TagRef};
use crate::test_support::dec;
use crate::trades::Direction;

const DAY: i64 = 86_400_000;
const HOUR: i64 = 3_600_000;
const MIN: i64 = 60_000;
/// 2026-09-28 00:00 UTC (day 20724), a Monday. "Today" in these tests is Tuesday 29 (day 1).
const MON: i64 = 20_724 * DAY;

/// Instant `day` days after Monday 28 at hh:mm UTC.
fn at(day: i64, h: i64, m: i64) -> i64 {
    MON + day * DAY + h * HOUR + m * MIN
}

/// Tuesday 29 at 15:00 UTC.
fn now() -> i64 {
    at(1, 15, 0)
}

fn trade(id: i64, account_id: i64, entry: i64, exit: Option<(i64, &str)>, size: &str, sl: Option<&str>) -> TradeFacts {
    TradeFacts {
        id,
        account_id,
        instrument_id: 1,
        symbol: "TEST".into(),
        asset_class: AssetClass::Other,
        position: Position {
            direction: Direction::Long,
            size: dec(size),
            multiplier: Decimal::ONE,
            entry_price: dec("100"),
            exit_price: exit.map(|(_, p)| dec(p)),
            planned_sl: sl.map(dec),
            planned_tp: None,
            fees: Decimal::ZERO,
        },
        entry_time: entry,
        exit_time: exit.map(|(t, _)| t),
        tz_offset_min: 0,
        execution_type: None,
        tags: Vec::new(),
        journal: Journal::default(),
    }
}

/// A closed trade of account 1 with a stop at 90, size 1: PnL = exit − 100.
fn closed(id: i64, entry: i64, exit: i64, exit_price: &str) -> TradeFacts {
    trade(id, 1, entry, Some((exit, exit_price)), "1", Some("90"))
}

fn ledger(accounts: &[(i64, &str)], trades: Vec<TradeFacts>) -> Ledger {
    let accounts: Vec<AccountCapital> = accounts.iter().map(|&(id, c)| AccountCapital { id, initial_capital: dec(c) }).collect();
    let mut initial_capital = Decimal::ZERO;
    for a in &accounts {
        initial_capital += a.initial_capital;
    }
    Ledger { currency: Some("USD".into()), initial_capital, accounts, capital_moves: Vec::new(), trades }
}

/// Every alert switched off, so each test looks at one alert only.
fn off() -> AlertSettings {
    AlertSettings {
        consecutive_losses: None,
        burst_max_trades: None,
        burst_window_min: 60,
        daily_loss_percent: None,
        daily_loss_amount: None,
        weekly_loss_percent: None,
        weekly_loss_amount: None,
        revenge: false,
        trading_hours: None,
        unusual_session: false,
        no_stop_loss: false,
    }
}

fn run(l: &Ledger, now: i64, s: &AlertSettings) -> Vec<Alert> {
    evaluate(l, now, 0, &BehaviorSettings::default(), s).unwrap()
}

fn ids(alerts: &[Alert]) -> Vec<&str> {
    alerts.iter().map(|a| a.id.as_str()).collect()
}

#[test]
fn no_data_no_alert() {
    let everything = AlertSettings {
        daily_loss_amount: Some(dec("1")),
        weekly_loss_amount: Some(dec("1")),
        trading_hours: Some("09:00-17:00".into()),
        consecutive_losses: Some(2),
        burst_max_trades: Some(1),
        ..AlertSettings::default()
    };
    let strict = BehaviorSettings { max_trades_per_day: Some(1), ..BehaviorSettings::default() };
    // An account without any trade, and a ledger without any account.
    assert!(evaluate(&ledger(&[(1, "10000")], vec![]), now(), 0, &strict, &everything).unwrap().is_empty());
    assert!(evaluate(&Ledger::default(), now(), 0, &strict, &everything).unwrap().is_empty());
    // Default settings on a quiet day: one small winning trade with a stop, inside the default limits.
    let quiet = ledger(&[(1, "10000")], vec![closed(1, at(1, 9, 0), at(1, 10, 0), "101")]);
    assert!(evaluate(&quiet, now(), 0, &BehaviorSettings::default(), &AlertSettings::default()).unwrap().is_empty());
}

#[test]
fn consecutive_losses_today_only_reset_by_a_breakeven() {
    // Monday: #1 −10 (yesterday, never counts).
    // Tuesday, exit order: #2 −5, #3 −3, #4 0 (breakeven: resets), #5 −1, #6 −2, #7 −4.
    // Losses in a row at the end of the day: #5, #6, #7 = 3.
    let l = ledger(
        &[(1, "10000")],
        vec![
            closed(1, at(0, 10, 0), at(0, 16, 0), "90"),
            closed(2, at(1, 9, 0), at(1, 9, 30), "95"),
            closed(3, at(1, 10, 0), at(1, 10, 30), "97"),
            closed(4, at(1, 11, 0), at(1, 11, 30), "100"),
            closed(5, at(1, 12, 0), at(1, 12, 20), "99"),
            closed(6, at(1, 13, 0), at(1, 13, 10), "98"),
            closed(7, at(1, 14, 0), at(1, 14, 10), "96"),
        ],
    );
    let s = AlertSettings { consecutive_losses: Some(3), ..off() };
    let alerts = run(&l, now(), &s);
    assert_eq!(ids(&alerts), ["consecutiveLosses:1:7"], "threshold exactly reached");
    let a = &alerts[0];
    assert_eq!((a.severity, a.message_key, a.at, a.trade_id), (Severity::Warning, "consecutiveLosses", at(1, 14, 10), Some(7)));
    assert_eq!(a.detail, AlertDetail::ConsecutiveLosses { count: 3, threshold: 3, trade_ids: vec![5, 6, 7] });

    // Threshold 4: the breakeven cut #2–#3 off and Monday's loss is another day.
    assert!(run(&l, now(), &AlertSettings { consecutive_losses: Some(4), ..off() }).is_empty());
    // At 13:30 #7 does not exist yet: only #5, #6.
    assert!(run(&l, at(1, 13, 30), &s).is_empty());
    // At 14:05 #7 is entered but still open: no outcome yet.
    assert!(run(&l, at(1, 14, 5), &s).is_empty());
    // Wednesday: nothing closed today.
    assert!(run(&l, at(2, 9, 0), &s).is_empty());
}

#[test]
fn trades_per_day_reuse_the_lot_8_limit_and_the_local_day() {
    // UTC+2 everywhere. Now = Tuesday 12:00 UTC = 14:00 local.
    // Account 1: #1 Monday 21:30 UTC = Monday 23:30 local (yesterday); #2 Monday 22:30 UTC = Tuesday 00:30 local (today);
    // #3 Tuesday 08:00 closed; #4 Tuesday 09:00 open → 3 trades today.
    // Account 2: #10–#13 on Tuesday → 4 trades today.
    let mut trades = vec![
        trade(1, 1, at(0, 21, 30), Some((at(0, 21, 45), "101")), "1", Some("90")),
        trade(2, 1, at(0, 22, 30), Some((at(0, 23, 0), "101")), "1", Some("90")),
        trade(3, 1, at(1, 8, 0), Some((at(1, 8, 30), "101")), "1", Some("90")),
        trade(4, 1, at(1, 9, 0), None, "1", Some("90")),
    ];
    for (i, id) in (10..14).enumerate() {
        trades.push(trade(id, 2, at(1, 7 + i as i64, 0), None, "1", Some("90")));
    }
    for t in &mut trades {
        t.tz_offset_min = 120;
    }
    let l = ledger(&[(1, "10000"), (2, "10000")], trades);
    let behavior = BehaviorSettings { max_trades_per_day: Some(3), ..BehaviorSettings::default() };
    let alerts = evaluate(&l, at(1, 12, 0), 120, &behavior, &off()).unwrap();
    // Critical first: account 2 exceeded its limit, account 1 reached it exactly.
    assert_eq!(ids(&alerts), ["tradesPerDay:2:13", "tradesPerDay:1:4"]);
    assert_eq!((alerts[0].severity, alerts[0].message_key, alerts[0].trade_id), (Severity::Critical, "tradesPerDay.exceeded", Some(13)));
    assert_eq!(alerts[0].detail, AlertDetail::TradesPerDay { level: LimitLevel::Exceeded, count: 4, threshold: 3, day: "2026-09-29".into() });
    assert_eq!((alerts[1].severity, alerts[1].message_key, alerts[1].at), (Severity::Warning, "tradesPerDay.reached", at(1, 9, 0)));
    assert_eq!(alerts[1].detail, AlertDetail::TradesPerDay { level: LimitLevel::Reached, count: 3, threshold: 3, day: "2026-09-29".into() });
    // No limit set (lot-8 default): no alert.
    assert!(evaluate(&l, at(1, 12, 0), 120, &BehaviorSettings::default(), &off()).unwrap().is_empty());
}

#[test]
fn trades_in_the_sliding_window() {
    // Window of 30 min ending at 15:00: ]14:30 ; 15:00]. #1 at 14:30 exactly is out; #2 at 14:31, #3 at 14:45 (open) are in.
    let mut trades = vec![
        closed(1, at(1, 14, 30), at(1, 14, 40), "101"),
        closed(2, at(1, 14, 31), at(1, 14, 50), "101"),
        trade(3, 1, at(1, 14, 45), None, "1", Some("90")),
    ];
    let s = AlertSettings { burst_max_trades: Some(2), burst_window_min: 30, ..off() };
    let alerts = run(&ledger(&[(1, "10000")], trades.clone()), now(), &s);
    assert_eq!(ids(&alerts), ["tradesPerWindow:1:3"]);
    assert_eq!((alerts[0].severity, alerts[0].message_key), (Severity::Warning, "tradesPerWindow.reached"));
    assert_eq!(alerts[0].detail, AlertDetail::TradesPerWindow { level: LimitLevel::Reached, count: 2, threshold: 2, window_min: 30 });
    // A third trade in the window: exceeded, and a new identity (the new trade).
    trades.push(trade(4, 1, at(1, 14, 50), None, "1", Some("90")));
    let alerts = run(&ledger(&[(1, "10000")], trades), now(), &s);
    assert_eq!(ids(&alerts), ["tradesPerWindow:1:4"]);
    assert_eq!((alerts[0].severity, alerts[0].message_key), (Severity::Critical, "tradesPerWindow.exceeded"));
    // The window crosses midnight: Tuesday 23:50 and Wednesday 00:05, seen at Wednesday 00:10.
    let night = ledger(&[(1, "10000")], vec![trade(1, 1, at(1, 23, 50), None, "1", Some("90")), trade(2, 1, at(2, 0, 5), None, "1", Some("90"))]);
    assert_eq!(ids(&run(&night, at(2, 0, 10), &s)), ["tradesPerWindow:1:2"]);
}

/// Account 1: capital 10 000; Monday deposit +1 000 and trade #1 +500; Tuesday deposit +5 000
/// at 08:00, then #2 −200 and #3 −145. Balance at Tuesday 00:00 = 10 000 + 1 000 + 500 = 11 500;
/// loss of the day = 345 = exactly 3 % of 11 500. The Tuesday deposit is neither a gain nor a loss.
fn losing_tuesday() -> Ledger {
    let mut l = ledger(
        &[(1, "10000")],
        vec![
            trade(1, 1, at(0, 10, 0), Some((at(0, 11, 0), "200")), "5", Some("90")),
            trade(2, 1, at(1, 9, 0), Some((at(1, 9, 30), "80")), "10", Some("90")),
            trade(3, 1, at(1, 10, 0), Some((at(1, 10, 30), "71")), "5", Some("90")),
        ],
    );
    l.capital_moves = vec![
        CapitalMove { account_id: 1, at: at(0, 9, 0), amount: dec("1000") },
        CapitalMove { account_id: 1, at: at(1, 8, 0), amount: dec("5000") },
    ];
    l
}

#[test]
fn daily_loss_in_percent_of_the_balance_at_the_start_of_the_day() {
    let l = losing_tuesday();
    let alerts = run(&l, now(), &AlertSettings { daily_loss_percent: Some(dec("3")), ..off() });
    assert_eq!(ids(&alerts), ["dailyLoss:1:2026-09-29:percent"], "3 % exactly reached");
    let a = &alerts[0];
    assert_eq!((a.severity, a.message_key, a.at, a.trade_id), (Severity::Critical, "dailyLoss", at(1, 10, 30), Some(3)));
    assert_eq!(
        a.detail,
        AlertDetail::DailyLoss(LossDetail {
            period_start: "2026-09-29".into(),
            currency: Some("USD".into()),
            loss: dec("345"),
            reference_balance: dec("11500"),
            loss_pct: Some(0.03),
            threshold_amount: None,
            threshold_percent: Some(dec("3")),
            amount_reached: false,
            percent_reached: true,
        })
    );
    // 3.01 % of 11 500 = 346.15 > 345: not reached.
    assert!(run(&l, now(), &AlertSettings { daily_loss_percent: Some(dec("3.01")), ..off() }).is_empty());
    // Money: 345 exactly reached; with both limits, one alert carrying both.
    let both = run(&l, now(), &AlertSettings { daily_loss_percent: Some(dec("3")), daily_loss_amount: Some(dec("345")), ..off() });
    assert_eq!(ids(&both), ["dailyLoss:1:2026-09-29:amount+percent"]);
    let money_only = run(&l, now(), &AlertSettings { daily_loss_amount: Some(dec("345")), ..off() });
    assert_eq!(ids(&money_only), ["dailyLoss:1:2026-09-29:amount"]);
    assert!(run(&l, now(), &AlertSettings { daily_loss_amount: Some(dec("345.01")), ..off() }).is_empty());
    // At 09:45 only #2 (−200) is closed: 200 < 345.
    assert!(run(&l, at(1, 9, 45), &AlertSettings { daily_loss_amount: Some(dec("345")), ..off() }).is_empty());
    // Monday was a winning day: no alert then.
    assert!(run(&l, at(0, 20, 0), &AlertSettings { daily_loss_amount: Some(dec("1")), daily_loss_percent: Some(dec("0.01")), ..off() }).is_empty());
}

#[test]
fn daily_loss_without_a_positive_balance_has_no_percent() {
    // Capital 0, #1 −50 today: no percentage can be computed, the money limit still works.
    let l = ledger(&[(1, "0")], vec![trade(1, 1, at(1, 9, 0), Some((at(1, 9, 30), "50")), "1", Some("40"))]);
    assert!(run(&l, now(), &AlertSettings { daily_loss_percent: Some(dec("0.01")), ..off() }).is_empty());
    let alerts = run(&l, now(), &AlertSettings { daily_loss_percent: Some(dec("0.01")), daily_loss_amount: Some(dec("50")), ..off() });
    let AlertDetail::DailyLoss(d) = &alerts[0].detail else { panic!("{alerts:?}") };
    assert_eq!((d.loss, d.reference_balance, d.loss_pct, d.amount_reached, d.percent_reached), (dec("50"), dec("0"), None, true, false));
}

#[test]
fn weekly_loss_from_monday_with_the_balance_before_monday() {
    // Sunday #1 −1 000 (last week: only lowers the reference balance), Monday #2 −280, Tuesday #3 +100.
    // Balance at Monday 00:00 = 9 000; loss of the week = 180 = exactly 2 % of 9 000. Tuesday is a winning day.
    let l = ledger(
        &[(1, "10000")],
        vec![
            trade(1, 1, at(-1, 10, 0), Some((at(-1, 11, 0), "0")), "10", Some("90")),
            trade(2, 1, at(0, 10, 0), Some((at(0, 11, 0), "30")), "4", Some("90")),
            trade(3, 1, at(1, 10, 0), Some((at(1, 11, 0), "200")), "1", Some("90")),
        ],
    );
    let s = AlertSettings { weekly_loss_percent: Some(dec("2")), daily_loss_percent: Some(dec("0.01")), ..off() };
    let alerts = run(&l, now(), &s);
    assert_eq!(ids(&alerts), ["weeklyLoss:1:2026-09-28:percent"]);
    let AlertDetail::WeeklyLoss(d) = &alerts[0].detail else { panic!() };
    assert_eq!((d.period_start.as_str(), d.loss, d.reference_balance, d.loss_pct), ("2026-09-28", dec("180"), dec("9000"), Some(0.02)));
    assert_eq!((alerts[0].trade_id, alerts[0].message_key), (Some(3), "weeklyLoss"));
    assert!(run(&l, now(), &AlertSettings { weekly_loss_percent: Some(dec("2.01")), ..off() }).is_empty());
    // The following Monday is a new week.
    assert!(run(&l, at(7, 9, 0), &s).is_empty());
}

#[test]
fn revenge_reuses_the_lot_8_detection_per_account() {
    // Account 1: #1 09:00 → 10:00, stop 90 (risk 10), −5. #2 at 10:30, stop 90, size 1.5 → risk 15 = 1.5 × 10,
    // exactly the default factor, 30 min after the loss (window 60): revenge.
    // Account 2: #10 closes at 10:20 with a big loss; if accounts were mixed it would be #2's "previous" trade
    // (risk 1 000 → ratio 0.015, no revenge). Monday: #3 −5 then #4 twice the risk 10 min later (yesterday: no alert).
    let l = ledger(
        &[(1, "10000"), (2, "10000")],
        vec![
            closed(1, at(1, 9, 0), at(1, 10, 0), "95"),
            trade(2, 1, at(1, 10, 30), None, "1.5", Some("90")),
            trade(10, 2, at(1, 10, 0), Some((at(1, 10, 20), "0")), "100", Some("90")),
            closed(3, at(0, 9, 0), at(0, 10, 0), "95"),
            trade(4, 1, at(0, 10, 10), Some((at(0, 11, 0), "101")), "2", Some("90")),
        ],
    );
    let s = AlertSettings { revenge: true, ..off() };
    let alerts = run(&l, now(), &s);
    assert_eq!(ids(&alerts), ["revenge:1:2"]);
    assert_eq!((alerts[0].severity, alerts[0].at, alerts[0].trade_id), (Severity::Warning, at(1, 10, 30), Some(2)));
    assert_eq!(
        alerts[0].detail,
        AlertDetail::Revenge {
            previous_trade_id: 1,
            gap_ms: 30 * MIN,
            basis: ExposureBasis::Risk,
            ratio: Some(1.5),
            size_factor: dec("1.5"),
            window_min: 60
        }
    );
    // On Monday at noon, the alert is #4, the very trade the lot-8 pattern report lists as a revenge on #3.
    assert_eq!(ids(&run(&l, at(0, 12, 0), &s)), ["revenge:1:4"]);
    let report = crate::behavior::patterns(&l, &[], &crate::stats::StatsQuery::default(), &BehaviorSettings::default()).unwrap();
    let listed: Vec<(i64, i64)> = report.revenge_trades.iter().map(|r| (r.trade_id, r.revenge.previous_trade_id)).collect();
    assert_eq!(listed, [(4, 3)], "#2 is still open, so the period report does not list it yet");
    // Switched off, or a stricter lot-8 factor: no alert.
    assert!(run(&l, now(), &off()).is_empty());
    let strict = BehaviorSettings { revenge_size_factor: dec("1.51"), ..BehaviorSettings::default() };
    assert!(evaluate(&l, now(), 0, &strict, &s).unwrap().is_empty());
}

#[test]
fn outside_trading_hours_in_local_time() {
    // UTC+2, allowed 09:00–17:30 local. #1 07:00 UTC = 09:00 (start included), #2 15:30 UTC = 17:30 (end excluded),
    // #3 06:59 UTC = 08:59.
    let mut trades = vec![
        trade(1, 1, at(1, 7, 0), None, "1", Some("90")),
        trade(2, 1, at(1, 15, 30), None, "1", Some("90")),
        trade(3, 1, at(1, 6, 59), None, "1", Some("90")),
    ];
    trades.iter_mut().for_each(|t| t.tz_offset_min = 120);
    let l = ledger(&[(1, "10000")], trades);
    let s = AlertSettings { trading_hours: Some("09:00-17:30".into()), ..off() };
    let alerts = evaluate(&l, at(1, 16, 0), 120, &BehaviorSettings::default(), &s).unwrap();
    assert_eq!(ids(&alerts), ["outsideHours:1:2", "outsideHours:1:3"]);
    assert_eq!(alerts[0].detail, AlertDetail::OutsideHours { local_time: "17:30".into(), trading_hours: "09:00-17:30".into() });
    assert_eq!(alerts[1].detail, AlertDetail::OutsideHours { local_time: "08:59".into(), trading_hours: "09:00-17:30".into() });
    assert!(evaluate(&l, at(1, 16, 0), 120, &BehaviorSettings::default(), &off()).unwrap().is_empty());
}

/// 18 trades in London (08:00 UTC; one tagged "LONDRES"), 2 in New York (15:00 UTC), on the 20 days before Monday.
fn session_history() -> Vec<TradeFacts> {
    (0..20)
        .map(|i| {
            let h = if i < 2 { 15 } else { 8 };
            let mut t = closed(100 + i, at(-20 + i, h, 0), at(-20 + i, h, 30), "101");
            if i == 5 {
                t.tags.push(TagRef { id: 50, kind: TagKind::Session, name: "LONDRES".into() });
            }
            t
        })
        .collect()
}

#[test]
fn unusual_session_needs_twenty_trades_and_less_than_ten_percent() {
    // Tuesday #1 at 15:00 UTC (New York): 2 of 20 = 10 % exactly → usual.
    // Tuesday #2 at 16:00 UTC tagged "Asie": 0 of 21 (history now includes #1) → unusual.
    let mut asia = trade(2, 1, at(1, 16, 0), None, "1", Some("90"));
    asia.tags.push(TagRef { id: 51, kind: TagKind::Session, name: "Asie".into() });
    let mut trades = session_history();
    trades.extend([trade(1, 1, at(1, 15, 0), None, "1", Some("90")), asia.clone()]);
    let s = AlertSettings { unusual_session: true, ..off() };
    let alerts = run(&ledger(&[(1, "10000")], trades), at(1, 20, 0), &s);
    assert_eq!(ids(&alerts), ["unusualSession:1:2"]);
    assert_eq!(alerts[0].detail, AlertDetail::UnusualSession { session: "Asie".into(), session_count: 0, history_count: 21, share: 0.0 });
    // Only 19 trades before: never an alert, even for a session never traded.
    let mut short: Vec<TradeFacts> = session_history().into_iter().skip(1).collect();
    short.push(trade(2, 1, at(1, 3, 0), None, "1", Some("90")));
    assert!(run(&ledger(&[(1, "10000")], short), at(1, 20, 0), &s).is_empty());
}

#[test]
fn no_stop_loss_on_open_positions_and_todays_trades() {
    // #1 entered Friday, still open, no stop → critical. #2 closed today without stop → warning.
    // #3 closed Monday without stop → nothing. #4 open with a stop → nothing.
    // #5 entered at 14:00 without stop, exits at 16:00: at 15:00 it is still open → critical.
    let l = ledger(
        &[(1, "10000")],
        vec![
            trade(1, 1, at(-3, 10, 0), None, "1", None),
            trade(2, 1, at(1, 9, 0), Some((at(1, 10, 0), "101")), "1", None),
            trade(3, 1, at(0, 9, 0), Some((at(0, 10, 0), "99")), "1", None),
            trade(4, 1, at(1, 11, 0), None, "1", Some("90")),
            trade(5, 1, at(1, 14, 0), Some((at(1, 16, 0), "101")), "1", None),
        ],
    );
    let s = AlertSettings { no_stop_loss: true, ..off() };
    let alerts = run(&l, now(), &s);
    assert_eq!(ids(&alerts), ["noStopLoss:1:1", "noStopLoss:1:5", "noStopLoss:1:2"]);
    let keys: Vec<(Severity, &str)> = alerts.iter().map(|a| (a.severity, a.message_key)).collect();
    assert_eq!(keys, [(Severity::Critical, "noStopLoss.open"), (Severity::Critical, "noStopLoss.open"), (Severity::Warning, "noStopLoss.closed")]);
    assert!(run(&l, now(), &off()).is_empty());
}

#[test]
fn two_accounts_are_evaluated_independently() {
    // Account 1 (10 000) and account 2 (20 000) both lose 300 today in three losing trades.
    // 3 % of 10 000 = 300 → reached for account 1; 3 % of 20 000 = 600 → not for account 2.
    // Losses in a row: each account has its own three → both alerted, each with its own trades.
    let mut trades = Vec::new();
    for (account, first_id) in [(1, 1), (2, 11)] {
        for k in 0..3 {
            trades.push(trade(first_id + k, account, at(1, 9 + k, 0), Some((at(1, 9 + k, 30), "0")), "1", Some("-1")));
        }
    }
    let l = ledger(&[(1, "10000"), (2, "20000")], trades);
    let s = AlertSettings { daily_loss_percent: Some(dec("3")), consecutive_losses: Some(3), ..off() };
    let alerts = run(&l, now(), &s);
    assert_eq!(ids(&alerts), ["dailyLoss:1:2026-09-29:percent", "consecutiveLosses:1:3", "consecutiveLosses:2:13"]);
    assert_eq!(alerts[2].detail, AlertDetail::ConsecutiveLosses { count: 3, threshold: 3, trade_ids: vec![11, 12, 13] });
}

#[test]
fn alerts_serialize_with_a_kind_and_a_message_key() {
    let alerts = run(&losing_tuesday(), now(), &AlertSettings { daily_loss_percent: Some(dec("3")), ..off() });
    let json = serde_json::to_value(&alerts[0]).unwrap();
    assert_eq!(json["id"], "dailyLoss:1:2026-09-29:percent");
    assert_eq!(json["kind"], "dailyLoss");
    assert_eq!(json["messageKey"], "dailyLoss");
    assert_eq!(json["severity"], "critical");
    assert_eq!(json["accountId"], 1);
    assert_eq!(json["tradeId"], 3);
    assert_eq!(json["loss"], "345");
    assert_eq!(json["referenceBalance"], "11500");
    assert_eq!(json["thresholdPercent"], "3");
    assert_eq!(json["thresholdAmount"], serde_json::Value::Null);
    assert_eq!(json["percentReached"], true);
    let l = ledger(&[(1, "10000")], vec![trade(1, 1, at(1, 14, 50), None, "1", Some("90"))]);
    let json = serde_json::to_value(&run(&l, now(), &AlertSettings { burst_max_trades: Some(1), ..off() })[0]).unwrap();
    assert_eq!((json["kind"].as_str(), json["level"].as_str(), json["windowMin"].as_u64()), (Some("tradesPerWindow"), Some("reached"), Some(60)));
}
