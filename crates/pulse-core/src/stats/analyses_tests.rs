//! Known-result tests for the step-3 analyses (spec 3.3.13, 3.3.15 – 3.3.17).
//! Every expected value is computed by hand below.
//!
//! Journal F — capital 10 000, multiplier 1, one trade per day (entry 10:00,
//! exit 11:00 UTC), days counted from Tue 1 Sept 2026:
//!
//! | # | date        | asset  | side  | entry → exit | size | SL  | fees | gross | net  | R     | setup | type |
//! |---|-------------|--------|-------|--------------|------|-----|------|-------|------|-------|-------|------|
//! | 1 | Tue 1 Sep   | EURUSD | long  | 100 → 110    | 10   | 95  | 2    | +100  | +98  | +1.96 | Alpha | sys  |
//! | 2 | Wed 2 Sep   | EURUSD | short | 50 → 53      | 20   | 52  | 4    | −60   | −64  | −1.6  | Alpha | sys  |
//! | 3 | Mon 7 Sep   | EURUSD | long  | 200 → 205    | 4    | 195 | 0    | +20   | +20  | +1    | Beta  | disc |
//! | 4 | Tue 8 Sep   | BTCUSD | long  | 20 → 26      | 50   | —   | 6    | +300  | +294 | —     | Beta  | disc |
//! | 5 | Mon 14 Sep  | BTCUSD | long  | 10 → 9       | 36   | —   | 0    | −36   | −36  | —     | Beta  | —    |
//! | 6 | Tue 15 Sep  | BTCUSD | long  | 30 → 27      | 10   | —   | −1   | −30   | −29  | —     | —     | —    |
//! | 7 | Thu 1 Oct   | XAUUSD | long  | 100 → 100    | 1    | —   | 1    | 0     | −1   | —     | Alpha | sys  |
//! | 8 | Fri 2 Oct   | EURUSD | long  | 30 → (open)  | 1    | —   | 0    |       |      |       | —     | —    |
//!
//! Totals over the 7 closed trades: gross +294, fees 12, net +282.

use super::analyses::*;
use super::tests::{DAY, SEP_1, all, approx, ledger, trade};
use super::*;
use crate::instruments::AssetClass;
use crate::tags::TagKind;
use crate::test_support::dec;
use crate::trades::Direction::{Long, Short};
use crate::trades::ExecutionType;

const ALPHA: i64 = 10;
const BETA: i64 = 11;

fn tag(id: i64, name: &str) -> TagRef {
    TagRef { id, kind: TagKind::Setup, name: name.into() }
}

fn asset(mut t: TradeFacts, id: i64, symbol: &str, class: AssetClass) -> TradeFacts {
    t.instrument_id = id;
    t.symbol = symbol.into();
    t.asset_class = class;
    t
}

fn tagged(mut t: TradeFacts, setup: Option<(i64, &str)>, kind: Option<ExecutionType>) -> TradeFacts {
    t.tags = setup.map(|(id, name)| tag(id, name)).into_iter().collect();
    t.execution_type = kind;
    t
}

fn journal_f() -> Vec<TradeFacts> {
    use AssetClass::{Commodity, Crypto, Forex};
    use ExecutionType::{Discretionary as D, System as S};
    vec![
        tagged(asset(trade(1, Long, "100", Some("110"), "10", Some("95"), "2", 0), 1, "EURUSD", Forex), Some((ALPHA, "Alpha")), Some(S)),
        tagged(asset(trade(2, Short, "50", Some("53"), "20", Some("52"), "4", 1), 1, "EURUSD", Forex), Some((ALPHA, "Alpha")), Some(S)),
        tagged(asset(trade(3, Long, "200", Some("205"), "4", Some("195"), "0", 6), 1, "EURUSD", Forex), Some((BETA, "Beta")), Some(D)),
        tagged(asset(trade(4, Long, "20", Some("26"), "50", None, "6", 7), 2, "BTCUSD", Crypto), Some((BETA, "Beta")), Some(D)),
        tagged(asset(trade(5, Long, "10", Some("9"), "36", None, "0", 13), 2, "BTCUSD", Crypto), Some((BETA, "Beta")), None),
        tagged(asset(trade(6, Long, "30", Some("27"), "10", None, "-1", 14), 2, "BTCUSD", Crypto), None, None),
        tagged(asset(trade(7, Long, "100", Some("100"), "1", None, "1", 30), 3, "XAUUSD", Commodity), Some((ALPHA, "Alpha")), Some(S)),
        asset(trade(8, Long, "30", None, "1", None, "0", 31), 1, "EURUSD", Forex),
    ]
}

fn f() -> Ledger {
    ledger("10000", journal_f(), vec![])
}

fn d(s: &str) -> Decimal {
    dec(s)
}

// --- by asset --------------------------------------------------------------------

#[test]
fn assets_journal_f() {
    let rows = assets(&f(), &all()).unwrap();
    // Sorted by net PnL: BTCUSD +229, EURUSD +54, XAUUSD −1.
    assert_eq!(rows.iter().map(|r| r.symbol.as_str()).collect::<Vec<_>>(), ["BTCUSD", "EURUSD", "XAUUSD"]);
    let (btc, eur, xau) = (&rows[0], &rows[1], &rows[2]);

    // EURUSD: trades 1, 2, 3 → gross 100 − 60 + 20 = 60, fees 2 + 4 + 0 = 6, net 54; open trade 8 ignored.
    assert_eq!((eur.instrument_id, eur.asset_class), (1, AssetClass::Forex));
    assert_eq!((eur.summary.trade_count, eur.summary.gross_pnl, eur.summary.fees, eur.summary.net_pnl), (3, d("60"), d("6"), d("54")));
    approx(eur.summary.win_rate, 2.0 / 3.0);
    // R of trades 1, 2, 3 = 1.96, −1.6, 1 → mean 1.36 / 3.
    approx(eur.summary.expectancy_r, 1.36 / 3.0);
    approx(eur.fees_share_of_gross, 0.1); // 6 / 60
    assert!(eur.low_sample); // 3 < 5

    // BTCUSD: trades 4, 5, 6 → gross 300 − 36 − 30 = 234, fees 6 + 0 − 1 = 5 (a credit counts), net 229.
    assert_eq!((btc.summary.trade_count, btc.summary.gross_pnl, btc.summary.fees, btc.summary.net_pnl), (3, d("234"), d("5"), d("229")));
    approx(btc.summary.win_rate, 1.0 / 3.0);
    assert_eq!(btc.summary.expectancy_r, None); // no planned stop, no R
    approx(btc.fees_share_of_gross, 5.0 / 234.0);

    // XAUUSD: one breakeven-before-fees trade: gross 0, fees 1, net −1 (a loss).
    assert_eq!((xau.summary.trade_count, xau.summary.loss_count, xau.summary.net_pnl), (1, 1, d("-1")));
    assert_eq!(xau.fees_share_of_gross, None); // gross is not positive
    assert_eq!(xau.summary.win_rate, Some(0.0));
}

#[test]
fn assets_zero_trade_single_trade_and_open_only() {
    assert!(assets(&ledger("1000", vec![], vec![]), &all()).unwrap().is_empty());
    // Only an open trade: no closed trade, no row.
    let open = ledger("1000", vec![trade(1, Long, "10", None, "1", None, "0", 0)], vec![]);
    assert!(assets(&open, &all()).unwrap().is_empty());
    // One trade, no fees: 10 → 12 × 3 = +6.
    let one = ledger("1000", vec![trade(1, Long, "10", Some("12"), "3", None, "0", 0)], vec![]);
    let rows = assets(&one, &all()).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!((rows[0].summary.net_pnl, rows[0].summary.fees, rows[0].low_sample), (d("6"), d("0"), true));
    approx(rows[0].fees_share_of_gross, 0.0); // 0 / 6: no fees, and that is a real 0 %
}

#[test]
fn assets_respect_window_and_filters() {
    // From day 7 on: trades 4 – 7 only, so EURUSD disappears and BTCUSD has 3 trades.
    let q = StatsQuery { from: Some(SEP_1 + 7 * DAY), ..all() };
    let rows = assets(&f(), &q).unwrap();
    assert_eq!(rows.iter().map(|r| (r.symbol.as_str(), r.summary.trade_count)).collect::<Vec<_>>(), [("BTCUSD", 3), ("XAUUSD", 1)]);
    // Direction filter: the only short is trade 2.
    let q = StatsQuery { direction: Some(Short), ..all() };
    let rows = assets(&f(), &q).unwrap();
    assert_eq!((rows.len(), rows[0].symbol.as_str(), rows[0].summary.net_pnl), (1, "EURUSD", d("-64")));
}

// --- fees over time --------------------------------------------------------------

#[test]
fn fees_journal_f_by_month() {
    let r = fees(&f(), &all(), FeeGranularity::Month).unwrap();
    assert_eq!((r.trade_count, r.trades_with_fees), (7, 5)); // trades 3 and 5 have zero fees
    assert_eq!((r.gross_pnl, r.fees, r.net_pnl), (d("294"), d("12"), d("282")));
    approx(r.fees_share_of_gross, 12.0 / 294.0);
    // 12 / 7 = 1.714285 714285 … repeating, rounded to the 28 decimals a Decimal holds.
    assert_eq!(r.fees_per_trade, Some(d("1.7142857142857142857142857143")));

    // Cumulative curve, exit order: (fees, gross, net).
    let expected = [
        ("2", "100", "98"),
        ("6", "40", "34"),
        ("6", "60", "54"),
        ("12", "360", "348"),
        ("12", "324", "312"),
        ("11", "294", "283"),
        ("12", "294", "282"),
    ];
    assert_eq!(r.curve.iter().map(|p| p.trade_id).collect::<Vec<_>>(), [1, 2, 3, 4, 5, 6, 7]);
    for (p, (fee, gross, net)) in r.curve.iter().zip(expected) {
        assert_eq!((p.cumulative_fees, p.cumulative_gross_pnl, p.cumulative_net_pnl), (d(fee), d(gross), d(net)));
    }
    // The gap gross − net is the cumulative fees.
    assert!(r.curve.iter().all(|p| p.cumulative_gross_pnl - p.cumulative_net_pnl == p.cumulative_fees));

    // September: trades 1 – 6 (gross 294, fees 2 + 4 + 0 + 6 + 0 − 1 = 11, net 283); October: trade 7.
    assert_eq!(r.periods.iter().map(|p| p.key.as_str()).collect::<Vec<_>>(), ["2026-09", "2026-10"]);
    let (sep, oct) = (&r.periods[0], &r.periods[1]);
    assert_eq!((sep.trade_count, sep.gross_pnl, sep.fees, sep.net_pnl, sep.cumulative_fees), (6, d("294"), d("11"), d("283"), d("11")));
    approx(sep.fees_share_of_gross, 11.0 / 294.0);
    assert_eq!((oct.trade_count, oct.gross_pnl, oct.fees, oct.net_pnl, oct.cumulative_fees), (1, d("0"), d("1"), d("-1"), d("12")));
    assert_eq!(oct.fees_share_of_gross, None); // gross 0
}

#[test]
fn fees_by_week_and_by_day() {
    let weeks = fees(&f(), &all(), FeeGranularity::Week).unwrap();
    // Weeks start on Monday: trades 1, 2 → Mon 31 Aug; 3, 4 → Mon 7 Sep; 5, 6 → Mon 14 Sep; 7 → Mon 28 Sep.
    let rows: Vec<_> = weeks.periods.iter().map(|p| (p.key.as_str(), p.trade_count, p.gross_pnl, p.fees, p.net_pnl, p.cumulative_fees)).collect();
    assert_eq!(
        rows,
        [
            ("2026-08-31", 2, d("40"), d("6"), d("34"), d("6")),
            ("2026-09-07", 2, d("320"), d("6"), d("314"), d("12")),
            ("2026-09-14", 2, d("-66"), d("-1"), d("-65"), d("11")),
            ("2026-09-28", 1, d("0"), d("1"), d("-1"), d("12")),
        ]
    );
    approx(weeks.periods[0].fees_share_of_gross, 6.0 / 40.0);
    approx(weeks.periods[1].fees_share_of_gross, 6.0 / 320.0);
    assert_eq!(weeks.periods[2].fees_share_of_gross, None); // negative gross
    // Sunday belongs to the week that started six days earlier.
    let sunday = ledger("1000", vec![trade(1, Long, "10", Some("11"), "1", None, "1", 5)], vec![]); // Sun 6 Sep
    assert_eq!(fees(&sunday, &all(), FeeGranularity::Week).unwrap().periods[0].key, "2026-08-31");

    let days = fees(&f(), &all(), FeeGranularity::Day).unwrap();
    assert_eq!(
        days.periods.iter().map(|p| p.key.as_str()).collect::<Vec<_>>(),
        ["2026-09-01", "2026-09-02", "2026-09-07", "2026-09-08", "2026-09-14", "2026-09-15", "2026-10-01"]
    );
    assert_eq!(days.periods.iter().map(|p| p.cumulative_fees).collect::<Vec<_>>(), [d("2"), d("6"), d("6"), d("12"), d("12"), d("11"), d("12")]);
}

#[test]
fn fees_use_the_local_exit_day_and_the_queried_window() {
    // Trade 7 at UTC−12 closes on Wed 30 Sep locally, so it stays in September.
    let mut trades = journal_f();
    trades[6].tz_offset_min = -720;
    let r = fees(&ledger("10000", trades, vec![]), &all(), FeeGranularity::Month).unwrap();
    assert_eq!(r.periods.iter().map(|p| (p.key.as_str(), p.trade_count)).collect::<Vec<_>>(), [("2026-09", 7)]);

    // Window from 8 Sept: trades 4 – 7, cumulative fees restart at that window: 6, 6, 5, 6.
    let q = StatsQuery { from: Some(SEP_1 + 7 * DAY), ..all() };
    let r = fees(&f(), &q, FeeGranularity::Month).unwrap();
    assert_eq!((r.trade_count, r.fees, r.gross_pnl), (4, d("6"), d("234")));
    assert_eq!(r.curve.iter().map(|p| p.cumulative_fees).collect::<Vec<_>>(), [d("6"), d("6"), d("5"), d("6")]);
}

#[test]
fn deposits_and_withdrawals_never_touch_the_fee_analysis() {
    let with_flows = ledger("10000", journal_f(), vec![(SEP_1 + DAY, "5000"), (SEP_1 + 10 * DAY, "-2000")]);
    for by in [FeeGranularity::Day, FeeGranularity::Week, FeeGranularity::Month] {
        assert_eq!(fees(&with_flows, &all(), by).unwrap(), fees(&f(), &all(), by).unwrap());
    }
    // Money figures and counts are identical. (Percentages such as the return are time-weighted
    // on the real balance and legitimately differ once capital moves; see CLAUDE.md, lot 3.)
    let money = |s: &Summary| (s.trade_count, s.gross_pnl, s.fees, s.net_pnl, s.total_gains, s.total_losses, s.win_rate);
    let (a, b) = (assets(&with_flows, &all()).unwrap(), assets(&f(), &all()).unwrap());
    assert_eq!(a.iter().map(|r| money(&r.summary)).collect::<Vec<_>>(), b.iter().map(|r| money(&r.summary)).collect::<Vec<_>>());
    let (a, b) = (strategies(&with_flows, &all()).unwrap(), strategies(&f(), &all()).unwrap());
    assert_eq!(a.iter().map(|r| (money(&r.summary), r.curve.clone())).collect::<Vec<_>>(), b.iter().map(|r| (money(&r.summary), r.curve.clone())).collect::<Vec<_>>());
    let (a, b) = (executions(&with_flows, &all()).unwrap(), executions(&f(), &all()).unwrap());
    assert_eq!((money(&a.system.summary), money(&a.discretionary.summary)), (money(&b.system.summary), money(&b.discretionary.summary)));
}

#[test]
fn fees_edge_cases() {
    // Zero trade.
    let none = fees(&ledger("1000", vec![], vec![]), &all(), FeeGranularity::Month).unwrap();
    assert_eq!((none.trade_count, none.fees, none.fees_share_of_gross, none.fees_per_trade), (0, d("0"), None, None));
    assert!(none.curve.is_empty() && none.periods.is_empty());
    // One trade: 10 → 15 × 2 = +10 gross, fees 3 → net +7, share 3 / 10.
    let one = fees(&ledger("1000", vec![trade(1, Long, "10", Some("15"), "2", None, "3", 0)], vec![]), &all(), FeeGranularity::Month).unwrap();
    assert_eq!((one.trades_with_fees, one.fees, one.net_pnl, one.fees_per_trade), (1, d("3"), d("7"), Some(d("3"))));
    approx(one.fees_share_of_gross, 0.3);
    // No fees at all: nothing counted, share is a true 0 %, the curve stays flat.
    let free = ledger("1000", vec![trade(1, Long, "10", Some("15"), "2", None, "0", 0), trade(2, Long, "10", Some("11"), "1", None, "0", 1)], vec![]);
    let r = fees(&free, &all(), FeeGranularity::Month).unwrap();
    assert_eq!((r.trades_with_fees, r.fees, r.gross_pnl), (0, d("0"), d("11")));
    approx(r.fees_share_of_gross, 0.0);
    assert!(r.curve.iter().all(|p| p.cumulative_fees.is_zero()));
    // A net credit (swap): fees −2 on +10 gross → share −0.2.
    let credit = fees(&ledger("1000", vec![trade(1, Long, "10", Some("15"), "2", None, "-2", 0)], vec![]), &all(), FeeGranularity::Month).unwrap();
    assert_eq!((credit.fees, credit.net_pnl), (d("-2"), d("12")));
    approx(credit.fees_share_of_gross, -0.2);
    // Negative gross: no share.
    let loss = fees(&ledger("1000", vec![trade(1, Long, "10", Some("8"), "2", None, "1", 0)], vec![]), &all(), FeeGranularity::Month).unwrap();
    assert_eq!((loss.gross_pnl, loss.fees, loss.fees_share_of_gross), (d("-4"), d("1"), None));
}

// --- strategies ------------------------------------------------------------------

#[test]
fn strategies_journal_f() {
    let rows = strategies(&f(), &all()).unwrap();
    // Alphabetical, then the trades without setup.
    assert_eq!(rows.iter().map(|r| (r.tag_id, r.name.as_str())).collect::<Vec<_>>(), [(Some(ALPHA), "Alpha"), (Some(BETA), "Beta"), (None, "None")]);
    let (alpha, beta, none) = (&rows[0], &rows[1], &rows[2]);

    // Alpha: trades 1, 2, 7 → net 98 − 64 − 1 = 33, gross 100 − 60 + 0 = 40, fees 2 + 4 + 1 = 7; 1 win of 3.
    assert_eq!((alpha.summary.trade_count, alpha.summary.net_pnl, alpha.summary.gross_pnl, alpha.summary.fees), (3, d("33"), d("40"), d("7")));
    approx(alpha.summary.win_rate, 1.0 / 3.0);
    approx(alpha.share_of_trades, 3.0 / 7.0);
    assert_eq!(alpha.curve.iter().map(|p| (p.trade_id, p.cumulative_net_pnl)).collect::<Vec<_>>(), [(1, d("98")), (2, d("34")), (7, d("33"))]);

    // Beta: trades 3, 4, 5 → net 20 + 294 − 36 = 278; curve 20, 314, 278.
    assert_eq!((beta.summary.trade_count, beta.summary.net_pnl), (3, d("278")));
    assert_eq!(beta.curve.iter().map(|p| p.cumulative_net_pnl).collect::<Vec<_>>(), [d("20"), d("314"), d("278")]);
    approx(beta.summary.win_rate, 2.0 / 3.0);

    // No setup: trade 6 alone, −29.
    assert_eq!((none.summary.trade_count, none.summary.net_pnl, none.low_sample), (1, d("-29"), true));
    approx(none.share_of_trades, 1.0 / 7.0);

    // A partition: the groups add up to the whole selection.
    assert_eq!(rows.iter().map(|r| r.summary.trade_count).sum::<usize>(), 7);
    assert_eq!(rows.iter().fold(Decimal::ZERO, |a, r| a + r.summary.net_pnl), d("282"));
    assert!(rows.iter().all(|r| r.low_sample)); // 3, 3 and 1 trades: nothing reaches 5
}

#[test]
fn strategies_sample_threshold_and_empty_cases() {
    assert!(strategies(&ledger("1000", vec![], vec![]), &all()).unwrap().is_empty());
    // Exactly MIN_SAMPLE trades is enough; one less is not.
    let five: Vec<_> = (0..5).map(|i| tagged(trade(i + 1, Long, "10", Some("11"), "1", None, "0", i), Some((ALPHA, "Alpha")), None)).collect();
    assert!(!strategies(&ledger("1000", five.clone(), vec![]), &all()).unwrap()[0].low_sample);
    assert!(strategies(&ledger("1000", five[..4].to_vec(), vec![]), &all()).unwrap()[0].low_sample);
    // A single trade without any setup: one "none" row holding 100 %.
    let solo = strategies(&ledger("1000", vec![trade(1, Long, "10", Some("11"), "1", None, "0", 0)], vec![]), &all()).unwrap();
    assert_eq!((solo.len(), solo[0].tag_id, solo[0].share_of_trades), (1, None, Some(1.0)));
    // Filtering on a tag keeps its trades in their own strategy only.
    let q = StatsQuery { tag_ids: vec![BETA], ..all() };
    let rows = strategies(&f(), &q).unwrap();
    assert_eq!(rows.iter().map(|r| (r.name.as_str(), r.summary.trade_count)).collect::<Vec<_>>(), [("Beta", 3)]);
}

// --- system vs discretionary -----------------------------------------------------

#[test]
fn executions_journal_f_is_not_comparable() {
    let r = executions(&f(), &all()).unwrap();
    // System: trades 1, 2, 7 → 98 − 64 − 1 = +33. Discretionary: trades 3, 4 → 20 + 294 = +314.
    // Unclassified: trades 5, 6 → −36 − 29 = −65.
    assert_eq!((r.system.summary.trade_count, r.system.summary.net_pnl), (3, d("33")));
    assert_eq!((r.discretionary.summary.trade_count, r.discretionary.summary.net_pnl), (2, d("314")));
    assert_eq!((r.unclassified.summary.trade_count, r.unclassified.summary.net_pnl), (2, d("-65")));
    // Too few trades on both sides: no gap is quoted.
    assert!(!r.comparable);
    assert_eq!(r.min_sample, 5);
    assert_eq!((r.win_rate_delta, r.expectancy_r_delta, r.avg_net_pnl_delta), (None, None, None));
    assert!(r.system.low_sample && r.discretionary.low_sample && r.unclassified.low_sample);
}

/// Journal G — long 100 → exit, size 1, SL 90 (risk 10), no fees, one per day.
/// System exits 110, 110, 110, 95, 95 → net +10 +10 +10 −5 −5, R +1 +1 +1 −0.5 −0.5:
///   win rate 3/5 = 0.6, mean R = 2 / 5 = 0.4, average net = 20 / 5 = 4.
/// Discretionary exits 110, 95, 95, 95, 100 → net +10 −5 −5 −5 0, R +1 −0.5 −0.5 −0.5 0:
///   win rate 1/5 = 0.2, mean R = −0.5 / 5 = −0.1, average net = −5 / 5 = −1.
fn journal_g(unclassified: usize) -> Vec<TradeFacts> {
    let mut trades = Vec::new();
    let mut add = |kind: Option<ExecutionType>, exit: &str| {
        let id = trades.len() as i64 + 1;
        trades.push(tagged(trade(id, Long, "100", Some(exit), "1", Some("90"), "0", id), None, kind));
    };
    for exit in ["110", "110", "110", "95", "95"] {
        add(Some(ExecutionType::System), exit);
    }
    for exit in ["110", "95", "95", "95", "100"] {
        add(Some(ExecutionType::Discretionary), exit);
    }
    for _ in 0..unclassified {
        add(None, "120"); // +20 each, never part of the gaps
    }
    trades
}

#[test]
fn executions_comparable_gaps() {
    let r = executions(&ledger("10000", journal_g(3), vec![]), &all()).unwrap();
    assert!(r.comparable);
    approx(r.system.summary.win_rate, 0.6);
    approx(r.system.summary.expectancy_r, 0.4);
    assert_eq!(r.system.summary.avg_net_pnl, Some(d("4")));
    approx(r.discretionary.summary.win_rate, 0.2);
    approx(r.discretionary.summary.expectancy_r, -0.1);
    assert_eq!(r.discretionary.summary.avg_net_pnl, Some(d("-1")));
    // Gaps = system − discretionary: +0.4 points of win rate, +0.5 R, +5 per trade.
    approx(r.win_rate_delta, 0.4);
    approx(r.expectancy_r_delta, 0.5);
    assert_eq!(r.avg_net_pnl_delta, Some(d("5")));
    // The 3 unclassified trades (+20 each) are counted apart and change nothing above.
    assert_eq!((r.unclassified.summary.trade_count, r.unclassified.summary.net_pnl), (3, d("60")));
    let without = executions(&ledger("10000", journal_g(0), vec![]), &all()).unwrap();
    assert_eq!((without.win_rate_delta.is_some(), without.avg_net_pnl_delta), (true, Some(d("5"))));
    assert_eq!((without.unclassified.summary.trade_count, without.unclassified.summary.win_rate), (0, None));
}

#[test]
fn executions_zero_trade_and_one_sided() {
    let r = executions(&ledger("1000", vec![], vec![]), &all()).unwrap();
    assert!(!r.comparable);
    assert_eq!((r.system.summary.trade_count, r.discretionary.summary.trade_count, r.unclassified.summary.trade_count), (0, 0, 0));
    assert_eq!((r.system.summary.win_rate, r.system.summary.net_pnl), (None, d("0")));
    // Only system trades (5 of them): comparable needs both sides, so no gap.
    let only_system: Vec<_> = journal_g(0).into_iter().take(5).collect();
    let r = executions(&ledger("10000", only_system, vec![]), &all()).unwrap();
    assert_eq!((r.system.low_sample, r.discretionary.low_sample, r.comparable, r.win_rate_delta), (false, true, false, None));
}

// --- through the database (real tags, real execution type, real fees) ------------

mod database {
    use super::*;
    use crate::test_support::{account, instrument};
    use crate::trades::{self, TradeData};
    use crate::{db, tags};

    #[test]
    fn reports_read_setup_tags_execution_type_and_fees_from_the_database() {
        let conn = db::open_in_memory().unwrap();
        let acc = account(&conn, "1000");
        let inst = instrument(&conn, "EURUSD", "1");
        let breakout = tags::create(&conn, TagKind::Setup, "Breakout").unwrap();
        let add = |setup: Option<i64>, kind: Option<ExecutionType>, exit: &str, fees: &str, day: i64| {
            let mut t = TradeData::new(acc, inst, Long, dec("1"), dec("100"), SEP_1 + day * DAY + 10 * 3_600_000);
            t.exit_price = Some(dec(exit));
            t.exit_time = Some(SEP_1 + day * DAY + 11 * 3_600_000);
            t.fees = dec(fees);
            t.tag_ids = setup.into_iter().collect();
            t.execution_type = kind;
            trades::create(&conn, &t).unwrap();
        };
        add(Some(breakout.id), Some(ExecutionType::System), "110", "1.5", 0); // gross +10, net +8.5
        add(None, Some(ExecutionType::Discretionary), "95", "0.5", 1); // gross −5, net −5.5
        add(None, None, "101", "0", 2); // gross +1, net +1

        let q = StatsQuery { account_ids: vec![acc], ..all() };
        let a = asset_report(&conn, &q).unwrap();
        assert_eq!((a.len(), a[0].symbol.as_str(), a[0].summary.net_pnl, a[0].summary.fees), (1, "EURUSD", d("4"), d("2")));

        let f = fee_report(&conn, &q, FeeGranularity::Month).unwrap();
        assert_eq!((f.gross_pnl, f.fees, f.net_pnl, f.trades_with_fees), (d("6"), d("2"), d("4"), 2));
        approx(f.fees_share_of_gross, 2.0 / 6.0);

        let s = strategy_report(&conn, &q).unwrap();
        assert_eq!(s.iter().map(|r| (r.tag_id, r.summary.net_pnl)).collect::<Vec<_>>(), [(Some(breakout.id), d("8.5")), (None, d("-4.5"))]);

        let e = execution_report(&conn, &q).unwrap();
        assert_eq!((e.system.summary.net_pnl, e.discretionary.summary.net_pnl, e.unclassified.summary.net_pnl), (d("8.5"), d("-5.5"), d("1")));
    }

    #[test]
    fn empty_database() {
        let conn = db::open_in_memory().unwrap();
        assert!(asset_report(&conn, &all()).unwrap().is_empty());
        assert!(strategy_report(&conn, &all()).unwrap().is_empty());
        assert_eq!(fee_report(&conn, &all(), FeeGranularity::Month).unwrap().trade_count, 0);
        assert!(!execution_report(&conn, &all()).unwrap().comparable);
    }
}
