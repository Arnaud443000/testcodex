//! Cases computed by hand. Forex EURUSD: multiplier 100 000, step 0.01.

use super::*;
use crate::cash_flows::{self, CashFlowKind, NewCashFlow};
use crate::db;
use crate::test_support::{account, dec, instrument};
use crate::trades::{self, TradeData};

fn input(dir: Direction, entry: &str, stop: &str, risk: RiskWanted, balance: &str) -> SizingInput {
    SizingInput {
        direction: dir,
        entry: dec(entry),
        stop: dec(stop),
        take_profit: None,
        risk,
        balance: dec(balance),
        multiplier: dec("100000"),
        size_step: dec("0.01"),
        size_step_is_default: true,
        max_risk_percent: None,
    }
}

fn pct(p: &str) -> RiskWanted {
    RiskWanted::Percent(dec(p))
}

fn amt(a: &str) -> RiskWanted {
    RiskWanted::Amount(dec(a))
}

fn refused(i: &SizingInput) -> Refusal {
    size(i).unwrap_err()
}

#[test]
fn forex_long_one_percent() {
    // 1 % of 10 000 = 100. Stop 50 pips away: 0.0050 × 100 000 = 500 per lot → 0.2 lot, risk exactly 100.
    let r = size(&input(Direction::Long, "1.1000", "1.0950", pct("1"), "10000")).unwrap();
    assert_eq!(r.size, dec("0.20"));
    assert_eq!(r.raw_size, dec("0.2"));
    assert_eq!(r.risk_wanted, dec("100"));
    assert_eq!(r.risk_actual, dec("100"));
    assert_eq!(r.risk_actual_percent, Some(dec("1")));
    assert_eq!(r.risk_gap, Decimal::ZERO);
    assert_eq!(r.stop_distance, dec("0.0050"));
    assert!(r.size_step_is_default && !r.exceeds_max_risk && r.reward_risk.is_none());
}

#[test]
fn percent_and_amount_give_the_same_size() {
    let a = size(&input(Direction::Long, "1.1000", "1.0950", pct("1"), "10000")).unwrap();
    let b = size(&input(Direction::Long, "1.1000", "1.0950", amt("100"), "10000")).unwrap();
    assert_eq!(a.size, b.size);
    assert_eq!(a.risk_actual, b.risk_actual);
}

#[test]
fn rounds_down_so_real_risk_is_strictly_below() {
    // Stop 30 pips: 300 per lot → raw 0.3333…, kept 0.33, real risk 99 < 100, gap 1.
    let r = size(&input(Direction::Long, "1.1000", "1.0970", pct("1"), "10000")).unwrap();
    assert_eq!(r.raw_size, dec("0.33333333"));
    assert_eq!(r.size, dec("0.33"));
    assert_eq!(r.risk_actual, dec("99"));
    assert!(r.risk_actual < r.risk_wanted);
    assert_eq!(r.risk_gap, dec("1"));
    assert_eq!(r.risk_actual_percent, Some(dec("0.99")));
}

#[test]
fn index_with_take_profit() {
    // NAS100, multiplier 1: 0.5 % of 25 000 = 125; stop 50 points → 2.5 contracts. TP 150 points: gain 375, 3 R.
    let mut i = input(Direction::Long, "18000", "17950", pct("0.5"), "25000");
    i.multiplier = Decimal::ONE;
    i.take_profit = Some(dec("18150"));
    let r = size(&i).unwrap();
    assert_eq!(r.size, dec("2.5"));
    assert_eq!(r.risk_actual, dec("125"));
    assert_eq!(r.reward_amount, Some(dec("375")));
    assert_eq!(r.reward_risk, Some(3.0));
}

#[test]
fn crypto_tiny_prices_eight_decimals() {
    // Distance 0.00000034; 50 / 0.00000034 = 147 058 823.529411…, step 0.0001 → 147 058 823.5294.
    // Real risk 147 058 823.5294 × 0.00000034 = 49.999999999996.
    let mut i = input(Direction::Long, "0.00001234", "0.00001200", amt("50"), "1000");
    i.multiplier = Decimal::ONE;
    i.size_step = dec("0.0001");
    let r = size(&i).unwrap();
    assert_eq!(r.size, dec("147058823.5294"));
    assert_eq!(r.risk_actual, dec("49.999999999996"));
    assert_eq!(r.risk_gap, dec("0.000000000004"));
    // Exact case: distance 0.000005, risk 10 → 2 000 000.
    let mut e = input(Direction::Long, "0.00002000", "0.00001500", amt("10"), "1000");
    e.multiplier = Decimal::ONE;
    assert_eq!(size(&e).unwrap().size, dec("2000000"));
}

#[test]
fn short_mirrors_long() {
    let mut i = input(Direction::Short, "1.1000", "1.1050", amt("100"), "10000");
    i.take_profit = Some(dec("1.0900"));
    let r = size(&i).unwrap();
    assert_eq!(r.size, dec("0.20"));
    assert_eq!(r.reward_amount, Some(dec("200")));
    assert_eq!(r.reward_risk, Some(2.0));
}

#[test]
fn take_profit_on_the_wrong_side_gives_no_ratio_but_still_a_size() {
    for tp in ["1.0900", "1.1000"] {
        let mut i = input(Direction::Long, "1.1000", "1.0950", pct("1"), "10000");
        i.take_profit = Some(dec(tp));
        let r = size(&i).unwrap();
        assert_eq!(r.size, dec("0.20"));
        assert!(r.take_profit_wrong_side && r.reward_risk.is_none() && r.reward_amount.is_none());
    }
    let mut short = input(Direction::Short, "1.1000", "1.1050", pct("1"), "10000");
    short.take_profit = Some(dec("1.1100"));
    assert!(size(&short).unwrap().take_profit_wrong_side);
}

#[test]
fn zero_size_is_refused_with_the_risk_of_the_minimum_size() {
    // 0.1 % of 1 000 = 1; 500 per lot → raw 0.002 → 0.00. The minimum 0.01 lot would risk 5.
    let refusal = refused(&input(Direction::Long, "1.1000", "1.0950", pct("0.1"), "1000"));
    assert_eq!(refusal, Refusal::SizeZero { risk_at_minimum: dec("5") });
    assert_eq!(refusal.code(), "sizeZero");
    assert_eq!(refusal.detail().as_deref(), Some("5"));
}

#[test]
fn limit_exceeded_equal_and_saved_by_rounding() {
    let with_limit = |risk: RiskWanted| {
        let mut i = input(Direction::Long, "1.1000", "1.0950", risk, "10000");
        i.max_risk_percent = Some(dec("1"));
        size(&i).unwrap()
    };
    let over = with_limit(pct("2"));
    assert_eq!(over.size, dec("0.40"));
    assert!(over.exceeds_max_risk);
    assert_eq!(over.max_risk_amount, Some(dec("100")));
    // Exactly 1 % = the limit: respected.
    assert!(!with_limit(pct("1")).exceeds_max_risk);
    // Wanted 100.5 (> limit) but the rounded-down size risks exactly 100: respected.
    let saved = with_limit(amt("100.5"));
    assert_eq!(saved.size, dec("0.20"));
    assert!(!saved.exceeds_max_risk);
    // Finer step 0.00001 lot (0.005 of risk per step): 100.007 / 500 = 0.200014 → 0.20001 lot, real risk 100.005 > 100.
    let mut fine = input(Direction::Long, "1.1000", "1.0950", amt("100.007"), "10000");
    fine.max_risk_percent = Some(dec("1"));
    fine.size_step = dec("0.00001");
    let r = size(&fine).unwrap();
    assert_eq!(r.risk_actual, dec("100.005"));
    assert!(r.exceeds_max_risk);
    // No limit: never a warning.
    assert!(!size(&input(Direction::Long, "1.1000", "1.0950", pct("50"), "10000")).unwrap().exceeds_max_risk);
}

#[test]
fn wrong_side_or_equal_stop_is_refused() {
    assert_eq!(refused(&input(Direction::Long, "1.1000", "1.1050", pct("1"), "10000")), Refusal::StopWrongSide);
    assert_eq!(refused(&input(Direction::Short, "1.1000", "1.0950", pct("1"), "10000")), Refusal::StopWrongSide);
    assert_eq!(refused(&input(Direction::Long, "1.1000", "1.1000", pct("1"), "10000")), Refusal::StopEqualsEntry);
    assert_eq!(refused(&input(Direction::Short, "1.1000", "1.10", pct("1"), "10000")), Refusal::StopEqualsEntry);
}

#[test]
fn invalid_prices_risk_multiplier_and_step_are_refused() {
    let base = || input(Direction::Long, "1.1000", "1.0950", pct("1"), "10000");
    let mut i = base();
    i.entry = Decimal::ZERO;
    assert_eq!(refused(&i), Refusal::PriceNotPositive);
    let mut i = base();
    i.stop = dec("-1");
    assert_eq!(refused(&i), Refusal::PriceNotPositive);
    let mut i = base();
    i.take_profit = Some(Decimal::ZERO);
    assert_eq!(refused(&i), Refusal::PriceNotPositive);
    assert_eq!(refused(&input(Direction::Long, "1.1", "1.0950", amt("0"), "10000")), Refusal::RiskNotPositive);
    assert_eq!(refused(&input(Direction::Long, "1.1", "1.0950", pct("-1"), "10000")), Refusal::RiskNotPositive);
    assert_eq!(refused(&input(Direction::Long, "1.1", "1.0950", pct("100.01"), "10000")), Refusal::RiskPercentTooHigh);
    let mut i = base();
    i.multiplier = Decimal::ZERO;
    assert_eq!(refused(&i), Refusal::MultiplierNotPositive);
    let mut i = base();
    i.size_step = Decimal::ZERO;
    assert_eq!(refused(&i), Refusal::StepNotPositive);
}

#[test]
fn zero_or_negative_balance() {
    // Percent mode needs a positive balance; amount mode still works, without percentages or limit check.
    assert_eq!(refused(&input(Direction::Long, "1.1", "1.0950", pct("1"), "0")), Refusal::BalanceNotPositive);
    assert_eq!(refused(&input(Direction::Long, "1.1", "1.0950", pct("1"), "-50")), Refusal::BalanceNotPositive);
    let mut i = input(Direction::Long, "1.1000", "1.0950", amt("100"), "-50");
    i.max_risk_percent = Some(dec("1"));
    let r = size(&i).unwrap();
    assert_eq!(r.size, dec("0.20"));
    assert!(r.risk_actual_percent.is_none() && r.risk_wanted_percent.is_none());
    assert!(!r.exceeds_max_risk && r.max_risk_amount.is_none());
}

#[test]
fn stock_step_and_custom_step() {
    let mut i = input(Direction::Long, "50", "48", pct("1"), "10000");
    i.multiplier = Decimal::ONE;
    i.size_step = Decimal::ONE;
    assert_eq!(size(&i).unwrap().size, dec("50"));
    // 105 / 2 = 52.5 → whole shares 52 (risk 104) ; step 5 → 50 (risk 100).
    let mut j = input(Direction::Long, "50", "48", amt("105"), "10000");
    j.multiplier = Decimal::ONE;
    j.size_step = Decimal::ONE;
    assert_eq!(size(&j).unwrap().size, dec("52"));
    j.size_step = dec("5");
    let r = size(&j).unwrap();
    assert_eq!((r.size, r.risk_actual, r.risk_gap), (dec("50"), dec("100"), dec("5")));
}

#[test]
fn very_large_numbers_never_panic() {
    // 1e20 risk on a 1-per-unit stop: exact.
    let mut big = input(Direction::Long, "100", "99", amt("100000000000000000000"), "10000");
    big.multiplier = Decimal::ONE;
    big.size_step = Decimal::ONE;
    assert_eq!(size(&big).unwrap().size, dec("100000000000000000000"));
    // distance 5e19 × multiplier 1e10 overflows: a refusal, not a crash.
    let mut over = input(Direction::Long, "100000000000000000000", "50000000000000000000", amt("100"), "10000");
    over.multiplier = dec("10000000000");
    assert_eq!(refused(&over), Refusal::Overflow);
    let mut max = input(Direction::Long, "1", "0.5", pct("100"), "79228162514264337593543950335");
    max.multiplier = dec("1000");
    assert!(matches!(size(&max), Ok(_) | Err(Refusal::Overflow)));
}

#[test]
fn default_steps_per_class() {
    assert_eq!(default_size_step(AssetClass::Forex), dec("0.01"));
    assert_eq!(default_size_step(AssetClass::Index), dec("0.01"));
    assert_eq!(default_size_step(AssetClass::Commodity), dec("0.01"));
    assert_eq!(default_size_step(AssetClass::Other), dec("0.01"));
    assert_eq!(default_size_step(AssetClass::Crypto), dec("0.0001"));
    assert_eq!(default_size_step(AssetClass::Stock), dec("1"));
    assert_eq!(default_size_step(AssetClass::Future), dec("1"));
}

fn request(account_id: i64, instrument_id: i64) -> SizingRequest {
    SizingRequest {
        account_id,
        instrument_id,
        direction: Direction::Long,
        entry_price: dec("1.1000"),
        stop_loss: dec("1.0950"),
        take_profit: None,
        risk_mode: RiskMode::Percent,
        risk_value: dec("1"),
        multiplier: None,
        size_step: None,
    }
}

#[test]
fn balance_is_capital_plus_flows_plus_closed_net_pnl() {
    let conn = db::open_in_memory().unwrap();
    let a = account(&conn, "10000");
    let i = instrument(&conn, "EURUSD", "100000");
    cash_flows::create(
        &conn,
        &NewCashFlow { account_id: a, kind: CashFlowKind::Deposit, amount: dec("500"), occurred_at: 1_000, tz_offset_min: 0, note: String::new() },
    )
    .unwrap();
    // Closed loser: −10 (size 1, multiplier 1). An open trade must not count.
    let mut t = TradeData::new(a, i, Direction::Long, dec("1"), dec("100"), 2_000);
    t.multiplier = Some(dec("1"));
    t.exit_price = Some(dec("90"));
    t.exit_time = Some(3_000);
    trades::create(&conn, &t).unwrap();
    let mut open = TradeData::new(a, i, Direction::Long, dec("1"), dec("100"), 4_000);
    open.multiplier = Some(dec("1"));
    trades::create(&conn, &open).unwrap();

    // Balance 10 490; 1 % = 104.90; 500 per lot → raw 0.2098 → 0.20 lot, real risk 100.
    let SizingOutcome::Ok { result, currency } = calculate(&conn, &request(a, i)).unwrap() else { panic!("expected a result") };
    assert_eq!(currency, "USD");
    assert_eq!(result.balance, dec("10490"));
    assert_eq!(result.risk_wanted, dec("104.9"));
    assert_eq!(result.size, dec("0.20"));
    assert_eq!(result.risk_actual, dec("100"));
    assert_eq!(result.risk_gap, dec("4.9"));

    // The multiplier and the step can be overridden.
    let mut r = request(a, i);
    r.multiplier = Some(dec("10"));
    r.size_step = Some(dec("1"));
    let SizingOutcome::Ok { result, .. } = calculate(&conn, &r).unwrap() else { panic!() };
    assert!(!result.size_step_is_default);
    assert_eq!(result.size, dec("2098"));

    // The limit comes from behavior.max_risk_percent (0.9 % of 10 490 = 94.41 < 100: exceeded).
    let s = settings::BehaviorSettings { max_risk_percent: Some(dec("0.9")), ..settings::behavior(&conn).unwrap() };
    settings::set_behavior(&conn, &s).unwrap();
    let SizingOutcome::Ok { result, .. } = calculate(&conn, &request(a, i)).unwrap() else { panic!() };
    assert!(result.exceeds_max_risk);
    assert_eq!(result.max_risk_amount, Some(dec("94.41")));
}

#[test]
fn outcome_serializes_with_a_status_and_a_code() {
    let conn = db::open_in_memory().unwrap();
    let a = account(&conn, "10000");
    let i = instrument(&conn, "EURUSD", "100000");
    let mut r = request(a, i);
    r.stop_loss = dec("1.1050");
    let out = calculate(&conn, &r).unwrap();
    assert_eq!(serde_json::to_value(&out).unwrap(), serde_json::json!({"status": "refused", "code": "stopWrongSide", "detail": null}));
    let ok = serde_json::to_value(calculate(&conn, &request(a, i)).unwrap()).unwrap();
    assert_eq!(ok["status"], "ok");
    assert_eq!(ok["result"]["size"], "0.20");
    assert_eq!(ok["currency"], "USD");
    assert!(calculate(&conn, &request(999, i)).is_err(), "unknown account is a real error");
}
