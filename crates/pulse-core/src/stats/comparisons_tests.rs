//! Known-result tests for the lot 17 analyses (spec 3.7.6, 3.4.11, 3.7.9).
//! Every expected value is computed by hand below.
//!
//! Journal C — two accounts side by side, multiplier 1, entry 100, size 10, SL 95
//! (risk 50), one trade per day, all on instrument 1 (EURUSD):
//!
//! Account 1 "Principal" (USD, capital 10 000), fees 2 each:
//! | # | exit | gross | net | R     |
//! |---|------|-------|-----|-------|
//! | 1 | 110  | +100  | +98 | +1.96 |
//! | 2 | 105  | +50   | +48 | +0.96 |
//! | 3 | 95   | −50   | −52 | −1.04 |
//! | 4 | 110  | +100  | +98 | +1.96 |
//! | 5 | 90   | −100  | −102| −2.04 |
//! | 6 | 100  | 0     | −2  | −0.04 |
//! Gross 100, fees 12, net 88; 3 wins / 3 losses → win rate 0.5; ΣR = 1.76 → mean R 1.76 / 6;
//! gains 244, losses 156 → PF 244 / 156; fees per trade 2; fees share 12 / 100 = 0.12;
//! cumulative net 98, 146, 94, 192, 90, 88 → max drawdown 192 − 88 = 104.
//!
//! Account 2 "Prop" (EUR, capital 5 000), fees 10 each:
//! | # | exit | gross | net | R    |
//! |---|------|-------|-----|------|
//! | 1 | 110  | +100  | +90 | +1.8 |
//! | 2 | 105  | +50   | +40 | +0.8 |
//! | 3 | 96   | −40   | −50 | −1.0 |
//! | 4 | 108  | +80   | +70 | +1.4 |
//! | 5 | 95   | −50   | −60 | −1.2 |
//! | 6 | 100  | 0     | −10 | −0.2 |
//! Gross 140, fees 60, net 80; 3 / 3 → 0.5; ΣR = 1.6 → mean R 1.6 / 6; fees per trade 10;
//! fees share 60 / 140. Fees gap vs account 1: 60/140 − 0.12 ≈ 0.3086 ≥ 0.10 → fees hint;
//! R gap: |1.76/6 − 1.6/6| = 0.02667 < 0.25 → no execution hint.
//! With trade 5 exiting at 85 instead (gross −150, net −160, R −3.2): gross 40, fees 60 (share 1.5),
//! ΣR = −0.4 → mean R −0.4 / 6; R gap = 2.16 / 6 = 0.36 ≥ 0.25 → both hints.
//!
//! Account 3 "Vide" (USD): no trade.

use super::comparisons::*;
use super::tests::{DAY, SEP_1, all, approx, ledger, trade};
use super::*;
use crate::instruments::AssetClass;
use crate::settings::BehaviorSettings;
use crate::test_support::dec;
use crate::trades::Direction::Long;

fn d(s: &str) -> Decimal {
    dec(s)
}

fn acct(id: i64, name: &str, currency: &str) -> AccountRef {
    AccountRef { id, name: name.into(), broker: format!("broker {id}"), currency: currency.into() }
}

fn on_account(id: i64, initial: &str, currency: &str, trades: Vec<TradeFacts>) -> Ledger {
    let trades = trades
        .into_iter()
        .map(|mut t| {
            t.account_id = id;
            t.id += id * 100;
            t
        })
        .collect();
    let mut l = ledger(initial, trades, vec![]);
    l.currency = Some(currency.into());
    l.accounts = vec![AccountCapital { id, initial_capital: dec(initial) }];
    l
}

fn series(exits: [&str; 6], fees: &str) -> Vec<TradeFacts> {
    exits.iter().enumerate().map(|(i, e)| trade(i as i64 + 1, Long, "100", Some(e), "10", Some("95"), fees, i as i64)).collect()
}

fn journal_c(second: [&str; 6], currency2: &str) -> Vec<(AccountRef, Ledger)> {
    vec![
        // Deliberately not in name order: the report sorts by name.
        (acct(2, "Prop", currency2), on_account(2, "5000", currency2, series(second, "10"))),
        (acct(3, "Vide", "USD"), on_account(3, "2000", "USD", vec![])),
        (acct(1, "Principal", "USD"), on_account(1, "10000", "USD", series(["110", "105", "95", "110", "90", "100"], "2"))),
    ]
}

const PROP: [&str; 6] = ["110", "105", "96", "108", "95", "100"];

#[test]
fn comparison_two_currencies_and_an_empty_account() {
    let r = compare_accounts(&journal_c(PROP, "EUR"), &all()).unwrap();
    assert_eq!(r.rows.iter().map(|x| x.name.as_str()).collect::<Vec<_>>(), ["Principal", "Prop", "Vide"]);
    assert_eq!((r.mixed_currencies, r.currencies.clone()), (true, vec!["EUR".to_string(), "USD".to_string()]));
    let (p, q, v) = (&r.rows[0], &r.rows[1], &r.rows[2]);

    assert_eq!((p.summary.trade_count, p.summary.gross_pnl, p.summary.fees, p.summary.net_pnl), (6, d("100"), d("12"), d("88")));
    approx(p.summary.win_rate, 0.5);
    approx(p.summary.expectancy_r, 1.76 / 6.0);
    approx(p.summary.profit_factor, 244.0 / 156.0);
    assert_eq!((p.summary.max_drawdown, p.fees_per_trade), (d("104"), Some(d("2"))));
    approx(p.fees_share_of_gross, 0.12);
    assert!(!p.low_sample);

    assert_eq!((q.currency.as_str(), q.summary.net_pnl, q.summary.fees, q.fees_per_trade), ("EUR", d("80"), d("60"), Some(d("10"))));
    approx(q.summary.expectancy_r, 1.6 / 6.0);
    approx(q.fees_share_of_gross, 60.0 / 140.0);

    // Account without a trade: an empty row, nothing invented.
    assert_eq!((v.summary.trade_count, v.fees_per_trade, v.summary.win_rate, v.summary.expectancy_r, v.fees_share_of_gross), (0, None, None, None, None));
    assert!(v.low_sample);

    // Fees hint only: Prop pays a larger share of its gross than Principal; no R hint (gap 0.0267).
    assert_eq!(r.hints.len(), 1);
    let h = &r.hints[0];
    assert_eq!((h.kind, h.account_id, h.other_account_id, h.shared_instruments), (HintKind::Fees, 2, 1, 1));
    assert!((h.gap - (60.0 / 140.0 - 0.12)).abs() < 1e-12);
}

#[test]
fn comparison_execution_hint_and_same_currency() {
    // Trade 5 of Prop exits at 85: mean R −0.4 / 6, fees share 1.5.
    let r = compare_accounts(&journal_c(["110", "105", "96", "108", "85", "100"], "USD"), &all()).unwrap();
    assert!(!r.mixed_currencies);
    assert_eq!(r.currencies, vec!["USD".to_string()]);
    approx(r.rows[1].summary.expectancy_r, -0.4 / 6.0);
    assert_eq!(r.hints.len(), 2);
    assert_eq!((r.hints[0].kind, r.hints[0].account_id, r.hints[0].other_account_id), (HintKind::Fees, 2, 1));
    assert_eq!((r.hints[1].kind, r.hints[1].account_id, r.hints[1].other_account_id), (HintKind::Execution, 2, 1));
    assert!((r.hints[1].gap - 2.16 / 6.0).abs() < 1e-12);
}

#[test]
fn comparison_no_hint_without_shared_instrument_or_sample() {
    // Prop trades another instrument: the gap cannot be blamed on the broker.
    let mut list = journal_c(["110", "105", "96", "108", "85", "100"], "USD");
    for t in &mut list[0].1.trades {
        t.instrument_id = 2;
    }
    assert!(compare_accounts(&list, &all()).unwrap().hints.is_empty());
    // Only 4 trades on Prop (window from day 2): below the minimum sample, no hint.
    let q = StatsQuery { from: Some(SEP_1 + 2 * DAY), ..all() };
    let r = compare_accounts(&journal_c(["110", "105", "96", "108", "85", "100"], "USD"), &q).unwrap();
    assert_eq!((r.rows[0].summary.trade_count, r.rows[1].summary.trade_count), (4, 4));
    assert!(r.rows[0].low_sample && r.rows[1].low_sample);
    assert!(r.hints.is_empty());
}

#[test]
fn comparison_single_and_no_account() {
    let one = vec![(acct(1, "Solo", "USD"), on_account(1, "1000", "USD", series(PROP, "0")))];
    let r = compare_accounts(&one, &all()).unwrap();
    assert_eq!((r.rows.len(), r.mixed_currencies, r.hints.len()), (1, false, 0));
    approx(r.rows[0].fees_share_of_gross, 0.0); // zero fees on a positive gross: a real 0 %
    let none = compare_accounts(&[], &all()).unwrap();
    assert_eq!((none.rows.len(), none.currencies.len(), none.mixed_currencies), (0, 0, false));
}

// --- Journal R — risk benchmark ----------------------------------------------------
//
// One account, capital 10 000, limit 1 % (max risk = 1 % of the balance at entry). Entry 100,
// SL 95 (risk = 5 × size), one trade per day. Exit is at 11:00 the same day, so each
// balance below includes every earlier trade.
//
// | # | day | size | risk | exit | net  | balance at entry | limit | verdict      |
// |---|-----|------|------|------|------|------------------|-------|--------------|
// | 1 | 0   | 10   | 50   | 110  | +100 | 10 000           | 100   | respected    |
// | 2 | 1   | 20   | 100  | 95   | −100 | 10 100           | 101   | respected    |
// | 3 | 2   | 30   | 150  | 100  | 0    | 10 000           | 100   | OVER (1.5×)  |
// | 4 | 3   | 20   | 100  | 105  | +100 | 10 000           | 100   | respected (exactly the limit) |
// | 5 | 4   | 10   | no SL| 90   | −100 | 10 100           | —     | not evaluated|
// | 6 | 30  | 25   | 125  | 96   | −100 | 10 000           | 100   | OVER (1.25×) |
// | 7 | 31  | 10   | 50   | 102  | +20  | 9 900            | 99    | respected    |
// | 8 | 32  | 22   | 110  | 100  | 0    | 9 920            | 99.2  | OVER         |
// | 9 | 33  | open |      |      |      |                  |       | ignored      |
// Days 0–4 are September, days 30–32 are October (1 Sept + 30 = 1 Oct).
// Evaluated 7, over 3, respected 4 → 4 / 7. Exit order of evaluated: ✓ ✓ ✗ ✓ ✗ ✓ ✗ (odd: the 4th is
// ignored) → older half ✓ ✓ ✗ = 2/3, recent half ✗ ✓ ✗ = 1/3, gap −1/3 → worsening.
// September: 4 evaluated (1, 2, 3, 4), 1 over → 0.75; October: 3 evaluated, 2 over → 1/3.

fn journal_r() -> Ledger {
    let t = |id, size: &str, sl: Option<&str>, exit: &str, day| trade(id, Long, "100", Some(exit), size, sl, "0", day);
    let mut open = trade(9, Long, "100", None, "10", Some("95"), "0", 33);
    open.exit_time = None;
    ledger(
        "10000",
        vec![
            t(1, "10", Some("95"), "110", 0),
            t(2, "20", Some("95"), "95", 1),
            t(3, "30", Some("95"), "100", 2),
            t(4, "20", Some("95"), "105", 3),
            t(5, "10", None, "90", 4),
            t(6, "25", Some("95"), "96", 30),
            t(7, "10", Some("95"), "102", 31),
            t(8, "22", Some("95"), "100", 32),
            open,
        ],
        vec![],
    )
}

fn limit(p: Option<&str>) -> BehaviorSettings {
    BehaviorSettings { max_risk_percent: p.map(dec), ..BehaviorSettings::default() }
}

#[test]
fn benchmark_journal_r() {
    let r = risk_benchmark(&journal_r(), &all(), &limit(Some("1"))).unwrap();
    assert_eq!(r.limit_percent, Some(d("1")));
    assert_eq!((r.trade_count, r.evaluated_count, r.without_stop_count, r.respected_count, r.over_count), (8, 7, 1, 4, 3));
    approx(r.compliance_rate, 4.0 / 7.0);
    // Mean of the seven risk fractions.
    let pcts = [50.0 / 10000.0, 100.0 / 10100.0, 150.0 / 10000.0, 100.0 / 10000.0, 125.0 / 10000.0, 50.0 / 9900.0, 110.0 / 9920.0];
    approx(r.avg_risk_pct, pcts.iter().sum::<f64>() / 7.0);
    approx(r.max_risk_pct, 0.015);

    // Violations, most recent first: trades 8, 6, 3.
    let ids: Vec<i64> = r.violations.iter().map(|v| v.trade_id).collect();
    assert_eq!(ids, [8, 6, 3]);
    let (v8, v6, v3) = (&r.violations[0], &r.violations[1], &r.violations[2]);
    assert_eq!((v3.initial_risk, v3.balance_at_entry, v3.limit_amount), (d("150"), d("10000"), d("100")));
    assert!((v3.risk_pct - 0.015).abs() < 1e-12 && (v3.excess_pct - 0.005).abs() < 1e-12 && (v3.over_factor - 1.5).abs() < 1e-9);
    assert!((v6.over_factor - 1.25).abs() < 1e-9 && (v6.excess_pct - 0.0025).abs() < 1e-12);
    assert_eq!((v8.initial_risk, v8.balance_at_entry, v8.limit_amount), (d("110"), d("9920"), d("99.2")));
    assert!((v8.risk_pct - 110.0 / 9920.0).abs() < 1e-12);
    assert!((v8.excess_pct - (110.0 / 9920.0 - 0.01)).abs() < 1e-12);
    assert_eq!((v8.symbol.as_str(), v8.direction), ("TEST", Long));

    // Trend: older 2/3, recent 1/3 → worsening.
    assert_eq!(r.trend, ComplianceTrend::Worsening);
    approx(r.older_rate, 2.0 / 3.0);
    approx(r.recent_rate, 1.0 / 3.0);
    assert_eq!(r.months.iter().map(|m| (m.key.as_str(), m.evaluated_count, m.over_count)).collect::<Vec<_>>(), [("2026-09", 4, 1), ("2026-10", 3, 2)]);
    approx(r.months[0].compliance_rate, 0.75);
    assert_eq!(r.points.len(), 7);
}

#[test]
fn benchmark_without_limit_is_empty() {
    let r = risk_benchmark(&journal_r(), &all(), &limit(None)).unwrap();
    assert_eq!(r.limit_percent, None);
    assert_eq!((r.evaluated_count, r.over_count, r.respected_count, r.compliance_rate), (0, 0, 0, None));
    assert!(r.violations.is_empty() && r.points.is_empty() && r.months.is_empty());
    assert_eq!(r.trend, ComplianceTrend::NotEnoughData);
    assert_eq!((r.trade_count, r.without_stop_count), (8, 1)); // still described
    approx(r.max_risk_pct, 0.015);
}

#[test]
fn benchmark_edge_cases() {
    // Zero trade.
    let r = risk_benchmark(&ledger("1000", vec![], vec![]), &all(), &limit(Some("1"))).unwrap();
    assert_eq!((r.trade_count, r.evaluated_count, r.compliance_rate, r.trend), (0, 0, None, ComplianceTrend::NotEnoughData));
    // Only trades without a stop: never an "over" by default.
    let no_sl = ledger("1000", vec![trade(1, Long, "10", Some("11"), "1", None, "0", 0)], vec![]);
    let r = risk_benchmark(&no_sl, &all(), &limit(Some("1"))).unwrap();
    assert_eq!((r.trade_count, r.without_stop_count, r.evaluated_count, r.over_count), (1, 1, 0, 0));
    // Three evaluated trades: below the trend minimum of 4, rate still quoted.
    let q = StatsQuery { to: Some(SEP_1 + 3 * DAY), ..all() }; // trades 1, 2, 3
    let r = risk_benchmark(&journal_r(), &q, &limit(Some("1"))).unwrap();
    assert_eq!((r.evaluated_count, r.over_count, r.trend, r.older_rate), (3, 1, ComplianceTrend::NotEnoughData, None));
    approx(r.compliance_rate, 2.0 / 3.0);
    // Exactly at the limit is respected; a stricter limit of 0.99 % turns trade 4 (1 %) into a violation.
    let r = risk_benchmark(&journal_r(), &all(), &limit(Some("0.99"))).unwrap();
    assert!(r.violations.iter().any(|v| v.trade_id == 4));
}

// --- Journal E — exposure by asset class -------------------------------------------
//
// Account 1 (capital 10 000) and account 2 (capital 5 000), same currency. Every trade exits at its
// entry price with no fees (net 0), so balances never move. Entry 100, SL 95 (risk = 5 × size).
//
// | # | acct | class     | size | risk | risk % of balance    |
// |---|------|-----------|------|------|----------------------|
// | 1 | 1    | forex     | 10   | 50   | 50 / 10 000 = 0.005  |
// | 2 | 1    | forex     | 20   | 100  | 100 / 10 000 = 0.01  |
// | 3 | 1    | crypto    | 40   | 200  | 200 / 10 000 = 0.02  |
// | 4 | 1    | crypto    | 10   | none | —                    |
// | 5 | 1    | index     | 10   | 50   | 0.005                |
// | 6 | 1    | commodity | 10   | none | —                    |
// | 7 | 2    | forex     | 20   | 100  | 100 / 5 000 = 0.02   |
// Total risk 500: crypto 200 (0.4), forex 250 (0.5), index 50 (0.1), commodity unknown.
// Order: forex 250, crypto 200, index 50, commodity 0. Forex: Σ% 0.035, mean 0.035 / 3.
// Total Σ% = 0.035 + 0.02 + 0.005 = 0.06.

fn journal_e() -> Ledger {
    use AssetClass::{Commodity, Crypto, Forex, Index};
    let t = |id, account, class, size: &str, sl: Option<&str>| {
        let mut x = trade(id, Long, "100", Some("100"), size, sl, "0", id);
        x.account_id = account;
        x.asset_class = class;
        x
    };
    Ledger {
        currency: Some("USD".into()),
        initial_capital: d("15000"),
        accounts: vec![AccountCapital { id: 1, initial_capital: d("10000") }, AccountCapital { id: 2, initial_capital: d("5000") }],
        capital_moves: vec![],
        trades: vec![
            t(1, 1, Forex, "10", Some("95")),
            t(2, 1, Forex, "20", Some("95")),
            t(3, 1, Crypto, "40", Some("95")),
            t(4, 1, Crypto, "10", None),
            t(5, 1, Index, "10", Some("95")),
            t(6, 1, Commodity, "10", None),
            t(7, 2, Forex, "20", Some("95")),
        ],
    }
}

#[test]
fn exposure_journal_e() {
    let r = exposure(&journal_e(), &all(), &BehaviorSettings::default()).unwrap();
    assert_eq!((r.trade_count, r.without_stop_count, r.total_risk, r.currency.as_deref()), (7, 2, d("500"), Some("USD")));
    approx(r.total_risk_pct, 0.06);
    let names: Vec<&str> = r.rows.iter().map(|x| x.asset_class.as_str()).collect();
    assert_eq!(names, ["forex", "crypto", "index", "commodity"]);
    let (fx, cr, ix, cm) = (&r.rows[0], &r.rows[1], &r.rows[2], &r.rows[3]);
    assert_eq!((fx.trade_count, fx.risk_trade_count, fx.risk_amount), (3, 3, d("250")));
    approx(fx.share_of_risk, 0.5);
    approx(fx.risk_pct_of_capital, 0.035);
    approx(fx.avg_risk_pct, 0.035 / 3.0);
    // Crypto: 2 trades, one without stop (adds no risk, stays counted).
    assert_eq!((cr.trade_count, cr.risk_trade_count, cr.without_stop_count, cr.risk_amount), (2, 1, 1, d("200")));
    approx(cr.share_of_risk, 0.4);
    approx(cr.risk_pct_of_capital, 0.02);
    approx(cr.avg_risk_pct, 0.02);
    approx(ix.share_of_risk, 0.1);
    // Commodity: only a trade without stop → risk unknown, never a measured 0 %.
    assert_eq!((cm.trade_count, cm.risk_trade_count, cm.risk_amount, cm.share_of_risk, cm.risk_pct_of_capital, cm.avg_risk_pct), (1, 0, d("0"), None, None, None));
    // Shares add up to 1.
    approx(Some(r.rows.iter().filter_map(|x| x.share_of_risk).sum::<f64>()), 1.0);
}

#[test]
fn exposure_window_filter_and_empty() {
    // From day 5 on: trades 5, 6, 7 → index 50, commodity unknown, forex 100 (acct 2).
    let q = StatsQuery { from: Some(SEP_1 + 5 * DAY), ..all() };
    let r = exposure(&journal_e(), &q, &BehaviorSettings::default()).unwrap();
    assert_eq!((r.trade_count, r.total_risk), (3, d("150")));
    assert_eq!(r.rows.iter().map(|x| x.asset_class.as_str()).collect::<Vec<_>>(), ["forex", "index", "commodity"]);
    approx(r.rows[0].share_of_risk, 100.0 / 150.0);
    approx(r.rows[0].risk_pct_of_capital, 0.02);
    // Zero trade.
    let e = exposure(&ledger("1000", vec![], vec![]), &all(), &BehaviorSettings::default()).unwrap();
    assert!(e.rows.is_empty());
    assert_eq!((e.trade_count, e.total_risk, e.total_risk_pct), (0, d("0"), None));
    // No account at all.
    let none = exposure(&Ledger::default(), &all(), &BehaviorSettings::default()).unwrap();
    assert_eq!((none.currency, none.rows.len()), (None, 0));
}

// --- through SQLite ------------------------------------------------------------------

#[test]
fn sqlite_comparison_accepts_two_currencies_but_benchmark_and_exposure_refuse() {
    use crate::accounts::{self, NewAccount};
    use crate::db;
    use crate::trades::{self, TradeData};
    let conn = db::open_in_memory().unwrap();
    let mk = |name: &str, currency: &str, capital: &str| {
        accounts::create(&conn, &NewAccount { name: name.into(), kind: "personal".into(), broker: "B".into(), currency: currency.into(), initial_capital: dec(capital) }).unwrap().id
    };
    let (usd, eur, empty) = (mk("Alpha", "USD", "1000"), mk("Beta", "EUR", "2000"), mk("Gamma", "USD", "500"));
    let instrument = crate::test_support::instrument(&conn, "EURUSD", "1");
    for (account, exit) in [(usd, "110"), (eur, "104")] {
        let mut t = TradeData::new(account, instrument, Long, dec("1"), dec("100"), SEP_1);
        t.multiplier = Some(dec("1"));
        t.exit_price = Some(dec(exit));
        t.exit_time = Some(SEP_1 + 3_600_000);
        trades::create(&conn, &t).unwrap();
    }
    // No account chosen = every active account; each computed alone.
    let r = account_comparison(&conn, &all()).unwrap();
    assert_eq!(r.rows.iter().map(|x| (x.name.as_str(), x.summary.net_pnl)).collect::<Vec<_>>(), [("Alpha", d("10")), ("Beta", d("4")), ("Gamma", d("0"))]);
    assert!(r.mixed_currencies);
    // A chosen subset.
    let sub = account_comparison(&conn, &StatsQuery { account_ids: vec![empty], ..all() }).unwrap();
    assert_eq!((sub.rows.len(), sub.rows[0].summary.trade_count, sub.mixed_currencies), (1, 0, false));
    // The other two analyses never mix currencies.
    assert!(risk_benchmark_report(&conn, &all()).is_err());
    assert!(exposure_report(&conn, &all()).is_err());
    let one = StatsQuery { account_ids: vec![usd], ..all() };
    assert_eq!(exposure_report(&conn, &one).unwrap().trade_count, 1);
    assert_eq!(risk_benchmark_report(&conn, &one).unwrap().limit_percent, None);
}
