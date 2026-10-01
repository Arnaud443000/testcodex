//! Prop firm rules (lot 33), with journals computed by hand. Instants are written in UTC; the
//! comments give the Paris / New York clock. Journal P1: capital 100 000, daily loss 5 % of the
//! initial capital (= 5 000), maximum loss 10 % static (= 10 000, floor 90 000), reset 00:00 Paris,
//! challenge started on 2026-09-01.

use super::rules::{LimitInput, PropRulesInput};
use super::*;
use crate::accounts::{self, NewAccount};
use crate::cash_flows::{self, CashFlowKind, NewCashFlow};
use crate::db;
use crate::error::CoreError;
use crate::stats::time::days_from_civil;
use crate::test_support::{dec, instrument};
use crate::trades::{self, Direction, TradeData};

const HOUR: i64 = 3_600_000;
const MIN: i64 = 60_000;

/// UTC instant of a date and time.
fn at(y: i64, m: u32, d: u32, h: i64, min: i64) -> i64 {
    days_from_civil(y, m, d).unwrap() * DAY_MS + h * HOUR + min * MIN
}

fn limit(mode: &str, value: &str) -> Option<LimitInput> {
    Some(LimitInput { mode: mode.into(), value: value.into() })
}

/// P1 as typed in the editor.
fn p1_input() -> PropRulesInput {
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
        profit_target: limit("percent", "8"),
        min_trading_days: Some(4),
        consistency_max_best_day_percent: None,
    }
}

fn rules_of(input: &PropRulesInput) -> PropRules {
    rules::validate(1, input).unwrap()
}

/// 2026-09-15 15:00 UTC = 17:00 in Paris (summer time): "today" is the Paris day 2026-09-15.
const NOW_Y: (i64, u32, u32) = (2026, 9, 15);
fn now() -> i64 {
    at(NOW_Y.0, NOW_Y.1, NOW_Y.2, 15, 0)
}

/// Closed trades (id, exit instant, net PnL).
fn trades(list: &[(i64, i64, &str)]) -> Vec<ClosedTrade> {
    list.iter().map(|&(id, exit_time, pnl)| ClosedTrade { id, exit_time, net_pnl: dec(pnl) }).collect()
}

fn run(rules: PropRules, capital: &str, closed: Vec<ClosedTrade>, now: i64) -> PropStatus {
    compute(&PropInput { rules, currency: "USD".into(), initial_capital: dec(capital), closed, open_trade_count: 0, cash_flow_count: 0 }, now).unwrap()
}

/// P1 with today's trades (exits at 08:00, 09:00… UTC on 2026-09-15) and nothing before.
fn p1_today(pnls: &[&str]) -> PropStatus {
    let list: Vec<(i64, i64, &str)> = pnls.iter().enumerate().map(|(i, p)| (i as i64 + 1, at(2026, 9, 15, 8 + i as i64, 0), *p)).collect();
    run(rules_of(&p1_input()), "100000", trades(&list), now())
}

// ---------------------------------------------------------------------------------------------
// Daily loss (P1: limit 5 000)

#[test]
fn daily_loss_exactly_at_the_limit_is_reached() {
    // Two trades today: −3 000 − 2 000 = −5 000 → loss 5 000 = limit: reached (equality = reached).
    let s = p1_today(&["-3000", "-2000"]);
    let d = s.daily_loss.unwrap();
    assert_eq!((d.limit, d.loss, d.remaining, d.day_net_pnl), (Some(dec("5000")), dec("5000"), Some(dec("0")), dec("-5000")));
    assert_eq!((d.used, d.level, d.trade_count), (Some(1.0), Some(Level::Reached), 2));
    assert_eq!(d.reference_balance, dec("100000"));
}

#[test]
fn daily_loss_one_cent_below_the_limit_is_critical() {
    // 4 999.99 / 5 000 = 99.9998 % → critical, 0.01 left.
    let d = p1_today(&["-4999.99"]).daily_loss.unwrap();
    assert_eq!((d.level, d.remaining), (Some(Level::Critical), Some(dec("0.01"))));
    // 4 500 = 90 % exactly → critical; 4 499.99 → warning.
    assert_eq!(p1_today(&["-4500"]).daily_loss.unwrap().level, Some(Level::Critical));
    assert_eq!(p1_today(&["-4499.99"]).daily_loss.unwrap().level, Some(Level::Warning));
}

#[test]
fn daily_loss_at_seventy_percent_is_a_warning_and_just_below_is_ok() {
    // 3 500 = 70 % exactly → warning.
    let d = p1_today(&["-3500"]).daily_loss.unwrap();
    assert_eq!((d.level, d.used, d.remaining), (Some(Level::Warning), Some(0.7), Some(dec("1500"))));
    // 3 499.50 = 69.99 % → ok.
    let d = p1_today(&["-3499.50"]).daily_loss.unwrap();
    assert_eq!(d.level, Some(Level::Ok));
    assert!((d.used.unwrap() - 0.6999).abs() < 1e-12);
}

#[test]
fn gains_of_the_day_offset_its_losses() {
    // −4 000 then +1 500: day −2 500 → loss 2 500 = 50 % → ok.
    let d = p1_today(&["-4000", "1500"]).daily_loss.unwrap();
    assert_eq!((d.loss, d.remaining, d.level, d.used), (dec("2500"), Some(dec("2500")), Some(Level::Ok), Some(0.5)));
    // A winning day: no loss at all.
    let d = p1_today(&["-1000", "3000"]).daily_loss.unwrap();
    assert_eq!((d.day_net_pnl, d.loss, d.remaining, d.level), (dec("2000"), dec("0"), Some(dec("5000")), Some(Level::Ok)));
}

#[test]
fn yesterdays_losses_do_not_count_today() {
    // 2026-09-14 21:59 UTC = 23:59 in Paris (still the 14th); 22:01 UTC = 00:01 on the 15th.
    let s = run(rules_of(&p1_input()), "100000", trades(&[(1, at(2026, 9, 14, 21, 59), "-4000"), (2, at(2026, 9, 14, 22, 1), "-1000")]), now());
    let d = s.daily_loss.unwrap();
    assert_eq!((d.loss, d.trade_count), (dec("1000"), 1));
    assert_eq!(s.balance, dec("95000"));
}

#[test]
fn the_day_start_balance_and_the_initial_capital_give_two_different_limits() {
    // Before today: +20 000 → balance at the start of the day 120 000. Today: −5 500.
    let history = [(1, at(2026, 9, 10, 10, 0), "20000"), (2, at(2026, 9, 15, 9, 0), "-5500")];
    // Initial capital: 5 % of 100 000 = 5 000 → 5 500 ≥ 5 000: reached.
    let initial = run(rules_of(&p1_input()), "100000", trades(&history), now()).daily_loss.unwrap();
    assert_eq!((initial.limit, initial.level, initial.remaining), (Some(dec("5000")), Some(Level::Reached), Some(dec("-500"))));
    // Balance at the start of the day: 5 % of 120 000 = 6 000 → 5 500 / 6 000 = 91.67 %: critical.
    let mut input = p1_input();
    input.daily_reference = "dayStartBalance".into();
    let day_start = run(rules_of(&input), "100000", trades(&history), now()).daily_loss.unwrap();
    assert_eq!((day_start.reference_balance, day_start.limit, day_start.remaining), (dec("120000"), Some(dec("6000")), Some(dec("500"))));
    assert_eq!(day_start.level, Some(Level::Critical));
}

#[test]
fn money_limits_and_percent_limits() {
    let mut input = p1_input();
    input.daily_loss = limit("amount", "2500");
    input.max_loss = limit("amount", "8000");
    input.profit_target = limit("amount", "6000.50");
    // Before today −6 000; today −2 500.
    let s = run(rules_of(&input), "100000", trades(&[(1, at(2026, 9, 3, 10, 0), "-6000"), (2, at(2026, 9, 15, 9, 0), "-2500")]), now());
    let d = s.daily_loss.unwrap();
    assert_eq!((d.limit, d.level), (Some(dec("2500")), Some(Level::Reached)));
    // Max 8 000 static: floor 92 000, balance 91 500 → −500 left, reached.
    let m = s.max_loss.unwrap();
    assert_eq!((m.limit, m.floor, m.remaining, m.level), (Some(dec("8000")), Some(dec("92000")), Some(dec("-500")), Some(Level::Reached)));
    assert!((m.used.unwrap() - 8500.0 / 8000.0).abs() < 1e-12);
    // The same amounts in percent of 100 000 give the same limits.
    let mut pct = p1_input();
    pct.daily_loss = limit("percent", "2.5");
    pct.max_loss = limit("percent", "8");
    let p = run(rules_of(&pct), "100000", trades(&[(1, at(2026, 9, 3, 10, 0), "-6000"), (2, at(2026, 9, 15, 9, 0), "-2500")]), now());
    assert_eq!((p.daily_loss.unwrap().limit, p.max_loss.unwrap().limit), (Some(dec("2500.0")), Some(dec("8000"))));
}

// ---------------------------------------------------------------------------------------------
// Maximum loss

#[test]
fn static_maximum_loss_uses_the_initial_capital() {
    // −6 000 on 09-02, −3 000 today → balance 91 000, floor 90 000, 1 000 left, 9 000 used = 90 %: critical.
    let s = run(rules_of(&p1_input()), "100000", trades(&[(1, at(2026, 9, 2, 10, 0), "-6000"), (2, at(2026, 9, 15, 9, 0), "-3000")]), now());
    let m = s.max_loss.unwrap();
    assert_eq!((m.limit, m.floor, m.remaining, m.peak), (Some(dec("10000")), Some(dec("90000")), Some(dec("1000")), dec("100000")));
    assert_eq!((m.level, m.floor_locked), (Some(Level::Critical), false));
    assert!((m.used.unwrap() - 0.9).abs() < 1e-12);
    // Above the initial capital, nothing is used (the share never goes below 0).
    let up = run(rules_of(&p1_input()), "100000", trades(&[(1, at(2026, 9, 2, 10, 0), "5000")]), now()).max_loss.unwrap();
    assert_eq!((up.remaining, up.used, up.level), (Some(dec("15000")), Some(0.0), Some(Level::Ok)));
}

#[test]
fn trailing_maximum_loss_follows_the_peak() {
    let mut input = p1_input();
    input.max_loss_kind = "trailing".into();
    // +6 000 (106 000), +8 000 (114 000 = peak), −9 000 (105 000).
    let journal = || trades(&[(1, at(2026, 9, 2, 10, 0), "6000"), (2, at(2026, 9, 3, 10, 0), "8000"), (3, at(2026, 9, 4, 10, 0), "-9000")]);
    // Without the lock: floor 114 000 − 10 000 = 104 000; 1 000 left; 9 000 used = 90 %: critical.
    let m = run(rules_of(&input), "100000", journal(), now()).max_loss.unwrap();
    assert_eq!((m.peak, m.floor, m.remaining, m.floor_locked, m.level), (dec("114000"), Some(dec("104000")), Some(dec("1000")), false, Some(Level::Critical)));
    // With the lock: the floor stops at the initial capital 100 000; 5 000 left; 50 %: ok.
    input.trailing_locks_at_initial = true;
    let m = run(rules_of(&input), "100000", journal(), now()).max_loss.unwrap();
    assert_eq!((m.floor, m.remaining, m.floor_locked, m.level), (Some(dec("100000")), Some(dec("5000")), true, Some(Level::Ok)));
    assert_eq!(m.used, Some(0.5));
    // The lock changes nothing while the trailing floor is below the initial capital:
    // +4 000 (104 000 = peak), −3 000 (101 000): floor 94 000, 7 000 left, 30 %.
    let small = trades(&[(1, at(2026, 9, 2, 10, 0), "4000"), (2, at(2026, 9, 3, 10, 0), "-3000")]);
    let m = run(rules_of(&input), "100000", small, now()).max_loss.unwrap();
    assert_eq!((m.floor, m.remaining, m.floor_locked, m.level), (Some(dec("94000")), Some(dec("7000")), false, Some(Level::Ok)));
}

#[test]
fn a_trailing_floor_breached_is_reached() {
    let mut input = p1_input();
    input.max_loss_kind = "trailing".into();
    // Peak 110 000 then −10 000 exactly: balance 100 000 = floor → reached (equality = reached).
    let m = run(rules_of(&input), "100000", trades(&[(1, at(2026, 9, 2, 10, 0), "10000"), (2, at(2026, 9, 3, 10, 0), "-10000")]), now())
        .max_loss
        .unwrap();
    assert_eq!((m.floor, m.remaining, m.level), (Some(dec("100000")), Some(dec("0")), Some(Level::Reached)));
}

// ---------------------------------------------------------------------------------------------
// Profit target, trading days, consistency

#[test]
fn profit_target_progress() {
    // Target 8 % = 8 000. +3 000 and +1 000: 4 000 = 50 %, 4 000 left.
    let s = run(rules_of(&p1_input()), "100000", trades(&[(1, at(2026, 9, 2, 10, 0), "3000"), (2, at(2026, 9, 3, 10, 0), "1000")]), now());
    let t = s.profit_target.unwrap();
    assert_eq!((t.target, t.gain, t.remaining, t.progress, t.reached), (Some(dec("8000")), dec("4000"), Some(dec("4000")), Some(0.5), Some(false)));
    // Exactly 8 000: reached, nothing left.
    let t = run(rules_of(&p1_input()), "100000", trades(&[(1, at(2026, 9, 2, 10, 0), "8000")]), now()).profit_target.unwrap();
    assert_eq!((t.reached, t.remaining, t.progress), (Some(true), Some(dec("0")), Some(1.0)));
    // A loss: negative progress, never "reached".
    let t = run(rules_of(&p1_input()), "100000", trades(&[(1, at(2026, 9, 2, 10, 0), "-2000")]), now()).profit_target.unwrap();
    assert_eq!((t.progress, t.remaining, t.reached), (Some(-0.25), Some(dec("10000")), Some(false)));
}

#[test]
fn trading_days_count_distinct_days_with_a_closed_trade() {
    // Three trades on two days (the 2nd twice), one on the 5th: 3 days; minimum 4 → 1 missing.
    let s = run(
        rules_of(&p1_input()),
        "100000",
        trades(&[(1, at(2026, 9, 2, 8, 0), "10"), (2, at(2026, 9, 2, 15, 0), "-20"), (3, at(2026, 9, 3, 8, 0), "5"), (4, at(2026, 9, 5, 8, 0), "1")]),
        now(),
    );
    assert_eq!(s.trading_days, TradingDaysStatus { count: 3, minimum: Some(4), missing: Some(1), done: Some(false) });
    // No minimum set: the count only.
    let mut input = p1_input();
    input.min_trading_days = None;
    let s = run(rules_of(&input), "100000", trades(&[(1, at(2026, 9, 2, 8, 0), "10")]), now());
    assert_eq!(s.trading_days, TradingDaysStatus { count: 1, minimum: None, missing: None, done: None });
    // More days than required: nothing missing.
    let mut input = p1_input();
    input.min_trading_days = Some(1);
    let s = run(rules_of(&input), "100000", trades(&[(1, at(2026, 9, 2, 8, 0), "10"), (2, at(2026, 9, 3, 8, 0), "10")]), now());
    assert_eq!((s.trading_days.missing, s.trading_days.done), (Some(0), Some(true)));
}

fn consistency(cap: &str, list: &[(i64, i64, &str)]) -> ConsistencyStatus {
    let mut input = p1_input();
    input.consistency_max_best_day_percent = Some(cap.into());
    run(rules_of(&input), "100000", trades(list), now()).consistency.unwrap()
}

#[test]
fn consistency_compares_the_best_day_with_the_total_profit() {
    // Days +3 000, +2 000 (two trades: +2 500 − 500), +1 000: total 6 000, best 3 000 = 50 %.
    let journal = [
        (1, at(2026, 9, 2, 8, 0), "3000"),
        (2, at(2026, 9, 3, 8, 0), "2500"),
        (3, at(2026, 9, 3, 9, 0), "-500"),
        (4, at(2026, 9, 4, 8, 0), "1000"),
    ];
    // Cap 50 %: equality = respected (level at most critical).
    let c = consistency("50", &journal);
    assert_eq!((c.total_profit, c.share, c.violated, c.level), (dec("6000"), Some(0.5), Some(false), Some(Level::Critical)));
    assert_eq!(c.best_day.as_ref().map(|b| (b.day.key.as_str(), b.net_pnl, b.trade_count)), Some(("2026-09-02", dec("3000"), 1)));
    assert_eq!(c.best_day_allowed, Some(dec("3000")));
    assert_eq!(c.used, Some(1.0));
    // Cap 49.99 %: violated → reached.
    let c = consistency("49.99", &journal);
    assert_eq!((c.violated, c.level), (Some(true), Some(Level::Reached)));
    // Cap 80 %: 50 / 80 = 62.5 % of the cap → ok.
    let c = consistency("80", &journal);
    assert_eq!((c.violated, c.level, c.used), (Some(false), Some(Level::Ok), Some(0.625)));
}

#[test]
fn consistency_is_undefined_without_a_total_profit() {
    // +1 000 then −2 000: total −1 000 ≤ 0 → no share, no verdict.
    let c = consistency("30", &[(1, at(2026, 9, 2, 8, 0), "1000"), (2, at(2026, 9, 3, 8, 0), "-2000")]);
    assert_eq!((c.share, c.violated, c.level, c.best_day_allowed), (None, None, None, None));
    assert_eq!(c.best_day.unwrap().net_pnl, dec("1000"));
    // Total exactly 0: undefined too.
    let c = consistency("30", &[(1, at(2026, 9, 2, 8, 0), "1000"), (2, at(2026, 9, 3, 8, 0), "-1000")]);
    assert_eq!(c.share, None);
    // Only losing days: the best day is not > 0.
    let c = consistency("30", &[(1, at(2026, 9, 2, 8, 0), "-1000")]);
    assert_eq!((c.share, c.violated), (None, None));
}

#[test]
fn a_single_winning_day_is_the_whole_profit() {
    // One day +2 000: best day = 100 % of the profit → violated for any cap below 100.
    let c = consistency("30", &[(1, at(2026, 9, 2, 8, 0), "1500"), (2, at(2026, 9, 2, 9, 0), "500")]);
    assert_eq!((c.share, c.violated, c.level), (Some(1.0), Some(true), Some(Level::Reached)));
    // Cap 100 %: equality, respected.
    let c = consistency("100", &[(1, at(2026, 9, 2, 8, 0), "2000")]);
    assert_eq!(c.violated, Some(false));
}

#[test]
fn the_best_day_on_a_tie_is_the_earliest() {
    let c = consistency("50", &[(1, at(2026, 9, 2, 8, 0), "1000"), (2, at(2026, 9, 3, 8, 0), "1000"), (3, at(2026, 9, 4, 8, 0), "500")]);
    assert_eq!(c.best_day.unwrap().day.key, "2026-09-02");
}

// ---------------------------------------------------------------------------------------------
// Start of the challenge, empty journal, open trades

#[test]
fn trades_closed_before_the_start_are_ignored() {
    // 2026-08-31 21:59 UTC = 23:59 in Paris: before the start (00:00 Paris on 09-01 = 08-31 22:00 UTC).
    let s = run(
        rules_of(&p1_input()),
        "100000",
        trades(&[(1, at(2026, 8, 31, 21, 59), "-9000"), (2, at(2026, 8, 31, 22, 0), "-1000")]),
        now(),
    );
    assert_eq!(s.started_at, at(2026, 8, 31, 22, 0));
    assert_eq!((s.before_start_count, s.closed_trade_count, s.balance), (1, 1, dec("99000")));
    assert_eq!(s.max_loss.unwrap().remaining, Some(dec("9000")));
}

#[test]
fn zero_trades() {
    let s = run(rules_of(&p1_input()), "100000", Vec::new(), now());
    assert_eq!((s.balance, s.net_pnl, s.closed_trade_count), (dec("100000"), dec("0"), 0));
    let d = s.daily_loss.unwrap();
    assert_eq!((d.loss, d.remaining, d.used, d.level, d.trade_count), (dec("0"), Some(dec("5000")), Some(0.0), Some(Level::Ok), 0));
    let m = s.max_loss.unwrap();
    assert_eq!((m.remaining, m.used, m.level), (Some(dec("10000")), Some(0.0), Some(Level::Ok)));
    assert_eq!(s.profit_target.unwrap().progress, Some(0.0));
    assert_eq!(s.trading_days.count, 0);
    assert_eq!(s.thresholds, Thresholds { warning_percent: 70, critical_percent: 90 });
}

#[test]
fn no_rule_set_means_no_figure() {
    let input = PropRulesInput {
        started_on: "2026-09-01".into(),
        daily_reference: "initialBalance".into(),
        max_loss_kind: "static".into(),
        reset_time: "17:00".into(),
        reset_zone: "newYork".into(),
        ..PropRulesInput::default()
    };
    let s = run(rules_of(&input), "100000", trades(&[(1, at(2026, 9, 2, 8, 0), "10")]), now());
    assert!(s.daily_loss.is_none() && s.max_loss.is_none() && s.profit_target.is_none() && s.consistency.is_none());
    assert_eq!(s.trading_days.count, 1);
}

#[test]
fn a_percent_of_a_zero_capital_gives_no_limit() {
    let s = run(rules_of(&p1_input()), "0", Vec::new(), now());
    let d = s.daily_loss.unwrap();
    assert_eq!((d.limit, d.remaining, d.used, d.level), (None, None, None, None));
    assert_eq!(s.max_loss.unwrap().level, None);
    assert_eq!(s.profit_target.unwrap().progress, None);
}

// ---------------------------------------------------------------------------------------------
// Trading day and reset time, summer and winter, Paris and New York, switch days included

fn day_of(zone: Zone, reset: &str, t: i64) -> String {
    zones::day_key_of(trading_day(zone, parse_time(reset).unwrap(), t))
}

#[test]
fn paris_midnight_reset_in_summer_and_winter() {
    // Summer (UTC+2): 00:00 Paris on 07-15 = 07-14 22:00 UTC.
    assert_eq!(day_of(Zone::Paris, "00:00", at(2026, 7, 14, 21, 59)), "2026-07-14");
    assert_eq!(day_of(Zone::Paris, "00:00", at(2026, 7, 14, 22, 1)), "2026-07-15");
    // Winter (UTC+1): 00:00 Paris on 01-15 = 01-14 23:00 UTC.
    assert_eq!(day_of(Zone::Paris, "00:00", at(2026, 1, 14, 22, 59)), "2026-01-14");
    assert_eq!(day_of(Zone::Paris, "00:00", at(2026, 1, 14, 23, 1)), "2026-01-15");
}

#[test]
fn paris_reset_on_the_switch_days() {
    // 2026-03-29 (spring): the day starts at 00:00 winter time (03-28 23:00 UTC) and ends at 00:00
    // summer time (03-29 22:00 UTC): 23 hours.
    assert_eq!(day_of(Zone::Paris, "00:00", at(2026, 3, 28, 22, 59)), "2026-03-28");
    assert_eq!(day_of(Zone::Paris, "00:00", at(2026, 3, 28, 23, 1)), "2026-03-29");
    assert_eq!(day_of(Zone::Paris, "00:00", at(2026, 3, 29, 21, 59)), "2026-03-29");
    assert_eq!(day_of(Zone::Paris, "00:00", at(2026, 3, 29, 22, 1)), "2026-03-30");
    // 2026-10-25 (autumn): starts 10-24 22:00 UTC, ends 10-25 23:00 UTC: 25 hours.
    assert_eq!(day_of(Zone::Paris, "00:00", at(2026, 10, 24, 21, 59)), "2026-10-24");
    assert_eq!(day_of(Zone::Paris, "00:00", at(2026, 10, 24, 22, 1)), "2026-10-25");
    assert_eq!(day_of(Zone::Paris, "00:00", at(2026, 10, 25, 22, 59)), "2026-10-25");
    assert_eq!(day_of(Zone::Paris, "00:00", at(2026, 10, 25, 23, 1)), "2026-10-26");
    // A reset time the spring change skips (02:30 on 03-29) happens when the clock jumps (01:00 UTC).
    assert_eq!(reset_instant(Zone::Paris, days_from_civil(2026, 3, 29).unwrap(), 150), at(2026, 3, 29, 1, 0));
    assert_eq!(day_of(Zone::Paris, "02:30", at(2026, 3, 29, 0, 59)), "2026-03-28");
    assert_eq!(day_of(Zone::Paris, "02:30", at(2026, 3, 29, 1, 1)), "2026-03-29");
    // A repeated one (02:30 on 10-25) resets the first time (summer time, 00:30 UTC).
    assert_eq!(reset_instant(Zone::Paris, days_from_civil(2026, 10, 25).unwrap(), 150), at(2026, 10, 25, 0, 30));
}

#[test]
fn new_york_five_pm_reset_in_summer_and_winter() {
    // Summer (UTC−4): 17:00 New York = 21:00 UTC. The day that starts on 07-14 at 17:00 is "2026-07-14".
    assert_eq!(day_of(Zone::NewYork, "17:00", at(2026, 7, 15, 20, 59)), "2026-07-14");
    assert_eq!(day_of(Zone::NewYork, "17:00", at(2026, 7, 15, 21, 1)), "2026-07-15");
    // Winter (UTC−5): 17:00 New York = 22:00 UTC.
    assert_eq!(day_of(Zone::NewYork, "17:00", at(2026, 1, 15, 21, 59)), "2026-01-14");
    assert_eq!(day_of(Zone::NewYork, "17:00", at(2026, 1, 15, 22, 1)), "2026-01-15");
    // Just after local midnight (01:00 New York) still belongs to the day that started at 17:00.
    assert_eq!(day_of(Zone::NewYork, "17:00", at(2026, 7, 15, 5, 0)), "2026-07-14");
}

#[test]
fn new_york_reset_on_the_switch_days() {
    // 2026-03-08 (spring, 02:00): 03-07 17:00 EST = 22:00 UTC, 03-08 17:00 EDT = 21:00 UTC (23 hours).
    assert_eq!(day_of(Zone::NewYork, "17:00", at(2026, 3, 7, 21, 59)), "2026-03-06");
    assert_eq!(day_of(Zone::NewYork, "17:00", at(2026, 3, 7, 22, 1)), "2026-03-07");
    assert_eq!(day_of(Zone::NewYork, "17:00", at(2026, 3, 8, 20, 59)), "2026-03-07");
    assert_eq!(day_of(Zone::NewYork, "17:00", at(2026, 3, 8, 21, 1)), "2026-03-08");
    // 2026-11-01 (autumn): 10-31 17:00 EDT = 21:00 UTC, 11-01 17:00 EST = 22:00 UTC (25 hours).
    assert_eq!(day_of(Zone::NewYork, "17:00", at(2026, 10, 31, 20, 59)), "2026-10-30");
    assert_eq!(day_of(Zone::NewYork, "17:00", at(2026, 10, 31, 21, 1)), "2026-10-31");
    assert_eq!(day_of(Zone::NewYork, "17:00", at(2026, 11, 1, 21, 59)), "2026-10-31");
    assert_eq!(day_of(Zone::NewYork, "17:00", at(2026, 11, 1, 22, 1)), "2026-11-01");
    // Three weeks when only New York has changed: 17:00 New York = 22:00 in Paris, not 23:00.
    let d = describe_day(Zone::NewYork, 17 * 60, days_from_civil(2026, 3, 10).unwrap());
    assert_eq!((d.starts_paris_time.as_str(), d.ends_paris_day.as_str(), d.ends_paris_time.as_str()), ("22:00", "2026-03-11", "22:00"));
}

#[test]
fn the_daily_loss_follows_the_reset_time() {
    // Reset 17:00 New York, summer. now = 07-15 21:30 UTC (17:30 New York): a new day has started.
    let mut input = p1_input();
    input.reset_time = "17:00".into();
    input.reset_zone = "newYork".into();
    input.started_on = "2026-07-01".into();
    let list = trades(&[(1, at(2026, 7, 15, 20, 59), "-4000"), (2, at(2026, 7, 15, 21, 1), "-1000")]);
    let s = run(rules_of(&input), "100000", list.clone(), at(2026, 7, 15, 21, 30));
    let d = s.daily_loss.unwrap();
    assert_eq!((d.loss, d.trade_count), (dec("1000"), 1), "the −4 000 closed one minute before the reset is yesterday's");
    assert_eq!((s.trading_day.key.as_str(), s.trading_day.starts_paris_time.as_str()), ("2026-07-15", "23:00"));
    // One minute before the reset (16:59 New York), only the first trade existed: it is today's.
    let s = run(rules_of(&input), "100000", list[..1].to_vec(), at(2026, 7, 15, 21, 0) - MIN);
    assert_eq!(s.daily_loss.unwrap().loss, dec("4000"));
}

#[test]
fn next_reset_is_given_in_paris_time() {
    // now = 07-15 18:48 UTC (20:48 Paris, 14:48 New York); reset 17:00 New York = 21:00 UTC = 23:00 Paris.
    let mut input = p1_input();
    input.reset_time = "17:00".into();
    input.reset_zone = "newYork".into();
    let s = run(rules_of(&input), "100000", Vec::new(), at(2026, 7, 15, 18, 48));
    assert_eq!(s.next_reset, NextReset { at: at(2026, 7, 15, 21, 0), in_ms: 2 * HOUR + 12 * MIN, paris_day: "2026-07-15".into(), paris_time: "23:00".into() });
    // Midnight Paris in winter: next reset 01-16 00:00 Paris = 01-15 23:00 UTC.
    let s = run(rules_of(&p1_input()), "100000", Vec::new(), at(2026, 1, 15, 12, 0));
    assert_eq!((s.next_reset.paris_day.as_str(), s.next_reset.paris_time.as_str(), s.next_reset.in_ms), ("2026-01-16", "00:00", 11 * HOUR));
}

// ---------------------------------------------------------------------------------------------
// Validation

fn refused(input: &PropRulesInput) -> String {
    match rules::validate(1, input) {
        Err(CoreError::Invalid(m)) => m,
        other => panic!("expected a refusal, got {other:?}"),
    }
}

#[test]
fn validation_refuses_every_bad_value_with_a_code() {
    let with = |f: &dyn Fn(&mut PropRulesInput)| {
        let mut i = p1_input();
        f(&mut i);
        i
    };
    assert_eq!(refused(&with(&|i| i.daily_loss = limit("percent", "0"))), "prop:percentOutOfRange:dailyLoss");
    assert!(rules::validate(1, &with(&|i| i.daily_loss = limit("percent", "100"))).is_ok(), "100 % is allowed");
    assert_eq!(refused(&with(&|i| i.max_loss = limit("percent", "100.01"))), "prop:percentOutOfRange:maxLoss");
    assert_eq!(refused(&with(&|i| i.max_loss = limit("amount", "-5"))), "prop:amountNotPositive:maxLoss");
    assert_eq!(refused(&with(&|i| i.profit_target = limit("amount", "0"))), "prop:amountNotPositive:profitTarget");
    assert_eq!(refused(&with(&|i| i.daily_loss = limit("euros", "5"))), "prop:invalidMode:dailyLoss");
    assert_eq!(refused(&with(&|i| i.daily_loss = limit("percent", "5,5"))), "prop:invalidNumber:dailyLoss");
    assert_eq!(refused(&with(&|i| i.reset_zone = "london".into())), "prop:unknownZone");
    assert_eq!(refused(&with(&|i| i.reset_zone = "Europe/Paris".into())), "prop:unknownZone");
    assert_eq!(refused(&with(&|i| i.reset_time = "24:00".into())), "prop:invalidResetTime");
    assert_eq!(refused(&with(&|i| i.reset_time = "9:00".into())), "prop:invalidResetTime");
    assert_eq!(refused(&with(&|i| i.started_on = "2026-02-30".into())), "prop:invalidStartDay");
    assert_eq!(refused(&with(&|i| i.daily_reference = "equity".into())), "prop:invalidDailyReference");
    assert_eq!(refused(&with(&|i| i.max_loss_kind = "relative".into())), "prop:invalidMaxLossKind");
    assert_eq!(refused(&with(&|i| i.min_trading_days = Some(0))), "prop:minTradingDaysOutOfRange");
    assert_eq!(refused(&with(&|i| i.consistency_max_best_day_percent = Some("0".into()))), "prop:percentOutOfRange:consistency");
    assert_eq!(refused(&with(&|i| i.consistency_max_best_day_percent = Some("-10".into()))), "prop:percentOutOfRange:consistency");
    assert_eq!(refused(&with(&|i| i.consistency_max_best_day_percent = Some("100.5".into()))), "prop:percentOutOfRange:consistency");
    assert_eq!(refused(&with(&|i| i.phase_label = Some("x".repeat(61)))), "prop:phaseLabelTooLong");
    // Empty optional text = not set; the label is trimmed.
    let ok = rules::validate(1, &with(&|i| {
        i.consistency_max_best_day_percent = Some("  ".into());
        i.phase_label = Some("  Financé ".into());
    }))
    .unwrap();
    assert_eq!((ok.consistency_max_best_day_percent, ok.phase_label.as_deref()), (None, Some("Financé")));
}

// ---------------------------------------------------------------------------------------------
// Database: prop accounts only, cascade, open trades, deposits, migration

fn account_of(conn: &rusqlite::Connection, kind: &str) -> i64 {
    accounts::create(
        conn,
        &NewAccount { name: format!("Compte {kind}"), kind: kind.into(), broker: String::new(), currency: "USD".into(), initial_capital: dec("100000") },
    )
    .unwrap()
    .id
}

fn trade(conn: &rusqlite::Connection, account_id: i64, entry: i64, exit: Option<(i64, &str)>) -> i64 {
    let inst = instrument(conn, "TEST", "1");
    let mut t = TradeData::new(account_id, inst, Direction::Long, dec("1"), dec("1000"), entry);
    if let Some((exit_time, price)) = exit {
        t.exit_time = Some(exit_time);
        t.exit_price = Some(dec(price));
    }
    trades::create(conn, &t).unwrap().id
}

#[test]
fn only_prop_accounts_have_rules() {
    let conn = db::open_in_memory().unwrap();
    let personal = account_of(&conn, "personal");
    assert!(matches!(rules::set(&conn, personal, &p1_input(), 1), Err(CoreError::Invalid(m)) if m == "prop:notProp"));
    assert!(matches!(status(&conn, personal, now()), Err(CoreError::Invalid(m)) if m == "prop:notProp"));
    assert!(matches!(rules::set(&conn, 999, &p1_input(), 1), Err(CoreError::NotFound(_))));
    // The database refuses it too.
    let direct = conn.execute(
        "INSERT INTO prop_rules (account_id, started_on, daily_reference, max_loss_kind, reset_time, reset_zone, updated_at)
         VALUES (?1, '2026-09-01', 'initial_balance', 'static', '00:00', 'paris', 0)",
        [personal],
    );
    assert!(direct.is_err());
    // A prop account: no rules yet, then saved, read back, replaced, deleted.
    let prop = account_of(&conn, "prop");
    assert_eq!(status(&conn, prop, now()).unwrap(), None);
    let saved = rules::set(&conn, prop, &p1_input(), 1).unwrap();
    assert_eq!(saved, PropRules { account_id: prop, ..rules_of(&p1_input()) });
    assert_eq!(rules::get(&conn, prop).unwrap(), Some(saved));
    let mut other = p1_input();
    other.max_loss_kind = "trailing".into();
    other.trailing_locks_at_initial = true;
    other.reset_zone = "newYork".into();
    other.reset_time = "17:00".into();
    other.daily_reference = "dayStartBalance".into();
    other.daily_loss = None;
    other.consistency_max_best_day_percent = Some("30".into());
    let replaced = rules::set(&conn, prop, &other, 2).unwrap();
    assert_eq!(rules::get(&conn, prop).unwrap(), Some(replaced.clone()));
    assert_eq!((replaced.daily_loss, replaced.consistency_max_best_day_percent), (None, Some(dec("30"))));
    // A refused input writes nothing.
    let mut bad = p1_input();
    bad.reset_zone = "tokyo".into();
    assert!(rules::set(&conn, prop, &bad, 3).is_err());
    assert_eq!(rules::get(&conn, prop).unwrap(), Some(replaced));
    rules::delete(&conn, prop).unwrap();
    rules::delete(&conn, prop).unwrap();
    assert_eq!(rules::get(&conn, prop).unwrap(), None);
}

#[test]
fn deleting_the_account_deletes_its_rules() {
    let conn = db::open_in_memory().unwrap();
    let prop = account_of(&conn, "prop");
    rules::set(&conn, prop, &p1_input(), 1).unwrap();
    accounts::delete(&conn, prop).unwrap();
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM prop_rules", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 0);
}

#[test]
fn status_from_the_database_ignores_open_trades_and_deposits() {
    let conn = db::open_in_memory().unwrap();
    let prop = account_of(&conn, "prop");
    rules::set(&conn, prop, &p1_input(), 1).unwrap();
    // Closed today: 1 000 → 900 on size 1, multiplier 1 = −100.
    trade(&conn, prop, at(2026, 9, 15, 8, 0), Some((at(2026, 9, 15, 9, 0), "900")));
    // Open: ignored (its unrealized loss is unknown), but counted.
    trade(&conn, prop, at(2026, 9, 15, 10, 0), None);
    // Closed after `now`: still open at `now`.
    trade(&conn, prop, at(2026, 9, 15, 10, 0), Some((at(2026, 9, 15, 16, 0), "0")));
    // Entered after `now`: does not exist yet.
    trade(&conn, prop, at(2026, 9, 15, 16, 0), Some((at(2026, 9, 15, 17, 0), "0")));
    // Closed before the start: ignored.
    trade(&conn, prop, at(2026, 8, 20, 8, 0), Some((at(2026, 8, 20, 9, 0), "500")));
    // A deposit: ignored by the limits, counted for the warning.
    cash_flows::create(&conn, &NewCashFlow { account_id: prop, kind: CashFlowKind::Deposit, amount: dec("5000"), occurred_at: at(2026, 9, 5, 8, 0), tz_offset_min: 120, note: String::new() })
        .unwrap();
    let s = status(&conn, prop, now()).unwrap().unwrap();
    assert_eq!((s.balance, s.closed_trade_count, s.open_trade_count, s.before_start_count, s.cash_flow_count), (dec("99900"), 1, 2, 1, 1));
    assert_eq!(s.daily_loss.unwrap().loss, dec("100"));
    assert_eq!(s.currency, "USD");
}

#[test]
fn migration_v16_keeps_existing_data() {
    let mut conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    crate::migrations::migrate_to(&mut conn, 14).unwrap();
    conn.execute_batch(
        "INSERT INTO accounts (id, name, kind, currency, initial_capital) VALUES (1, 'FTMO', 'prop', 'USD', '100000'), (2, 'Perso', 'personal', 'EUR', '5000');
         INSERT INTO settings (key, value) VALUES ('alerts.daily_loss_percent', '2');",
    )
    .unwrap();
    crate::migrations::migrate(&mut conn).unwrap();
    assert_eq!(crate::migrations::current_version(&conn).unwrap(), crate::migrations::latest_version());
    let all = accounts::list(&conn).unwrap();
    assert_eq!(all.iter().map(|a| (a.id, a.kind.as_str(), a.initial_capital.to_string())).collect::<Vec<_>>(), [
        (1, "prop", "100000".to_string()),
        (2, "personal", "5000".to_string())
    ]);
    assert_eq!(crate::settings::read(&conn, "alerts.daily_loss_percent").unwrap().as_deref(), Some("2"));
    assert!(rules::set(&conn, 1, &p1_input(), 1).is_ok());
    assert!(rules::set(&conn, 2, &p1_input(), 1).is_err());
}

#[test]
fn migration_v16_on_an_encrypted_database() {
    use crate::lock::{ENC_FILE, KdfParams, Password, Store};
    let dir = tempfile::tempdir().unwrap();
    let mut conn = rusqlite::Connection::open_in_memory().unwrap();
    crate::migrations::migrate_to(&mut conn, 14).unwrap();
    conn.execute("INSERT INTO accounts (id, name, kind, initial_capital) VALUES (1, 'FTMO', 'prop', '100000')", []).unwrap();
    let image = conn.serialize(rusqlite::MAIN_DB).unwrap().to_vec();
    let pw = || Password::new("phrase de test jetable".into());
    let keys = pulse_lock::Unlocked::create(&pw(), KdfParams::INSECURE_FAST_FOR_TESTS).unwrap();
    std::fs::write(dir.path().join(ENC_FILE), keys.seal(&image).unwrap()).unwrap();
    let store = Store::unlock(dir.path(), &pw(), 1).unwrap();
    assert_eq!(crate::migrations::current_version(store.conn()).unwrap(), crate::migrations::latest_version());
    rules::set(store.conn(), 1, &p1_input(), 1).unwrap();
    assert!(rules::get(store.conn(), 1).unwrap().is_some());
}

#[test]
fn an_account_that_is_no_longer_prop_keeps_its_rules_but_is_refused() {
    let conn = db::open_in_memory().unwrap();
    let prop = account_of(&conn, "prop");
    rules::set(&conn, prop, &p1_input(), 1).unwrap();
    let upd = accounts::AccountUpdate { name: "Compte".into(), kind: "personal".into(), broker: String::new(), currency: "USD".into(), initial_capital: dec("100000") };
    accounts::update(&conn, prop, &upd).unwrap();
    assert!(matches!(status(&conn, prop, now()), Err(CoreError::Invalid(m)) if m == "prop:notProp"));
    assert!(rules::get(&conn, prop).unwrap().is_some(), "kept: switching back to prop finds them again");
    accounts::update(&conn, prop, &accounts::AccountUpdate { kind: "prop".into(), ..upd }).unwrap();
    assert!(status(&conn, prop, now()).unwrap().is_some());
}
