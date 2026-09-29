//! Known-result tests for the complementary statistics (spec 3.3.8, 3.3.10 –
//! 3.3.12), on journal A of `tests.rs`:
//!
//! | # | day (entry 10:00 UTC) | side  | net  | risk | R    |
//! |---|-----------------------|-------|------|------|------|
//! | 1 | 0 Tue                 | long  | +100 | 50   | +2   |
//! | 2 | 1 Wed                 | short | −64  | 40   | −1.6 |
//! | 3 | 2 Thu                 | long  | 0    | 10   | 0    |
//! | 4 | 3 Fri                 | long  | +294 | —    | —    |
//! | 5 | 4 Sat                 | short | −100 | 50   | −2   |
//! | 6 | 5 Sun                 | long  | −36  | 18   | −2   |

use super::distribution::{R_HIGH, R_LOW, heatmap, long_short, r_distribution};
use super::risk::risk;
use super::tests::{DAY, SEP_1, all, approx, journal_a, ledger, trade};
use super::*;
use crate::settings::BehaviorSettings;
use crate::test_support::dec;
use crate::trades::Direction::{Long, Short};

fn counts(d: &distribution::RDistribution) -> Vec<(Option<f64>, usize)> {
    d.bins.iter().filter(|b| b.count > 0).map(|b| (b.from, b.count)).collect()
}

#[test]
fn r_multiple_distribution() {
    let d = r_distribution(&ledger("10000", journal_a(), vec![]), &all()).unwrap();
    // 16 classes of 0.5 R from −3 to +5, plus "< −3" and "≥ 5".
    assert_eq!(d.bins.len(), 18);
    assert_eq!((d.bins[0].from, d.bins[0].to, d.bins[1].from, d.bins[17].from, d.bins[17].to), (None, Some(R_LOW), Some(-3.0), Some(R_HIGH), None));
    // −1.6, −2, −2 → [−2, −1.5); 0 → [0, 0.5); 2 → [2, 2.5).
    assert_eq!(counts(&d), [(Some(-2.0), 3), (Some(0.0), 1), (Some(2.0), 1)]);
    assert_eq!((d.r_trade_count, d.no_r_count), (5, 1));
    approx(d.mean_r, -0.72); // = the expectancy of journal A
    approx(d.median_r, -1.6); // −2, −2, −1.6, 0, 2

    // Edges and open classes. Long 100, SL 90: R = (exit − 100) / 10.
    let r_of = |id, exit: &str| trade(id, Long, "100", Some(exit), "1", Some("90"), "0", 0);
    let edges = ledger("1000", vec![r_of(1, "65"), r_of(2, "70"), r_of(3, "149.95"), r_of(4, "150")], vec![]);
    let d = r_distribution(&edges, &all()).unwrap();
    // −3.5 → "< −3"; −3 → [−3, −2.5) (lower bound included); 4.995 → [4.5, 5); 5 → "≥ 5".
    assert_eq!(counts(&d), [(None, 1), (Some(-3.0), 1), (Some(4.5), 1), (Some(5.0), 1)]);
    approx(d.median_r, (-3.0 + 4.995) / 2.0); // even count: mean of the two middle values

    // No trade / no stop at all: empty classes, undefined mean and median.
    let empty = r_distribution(&ledger("1000", vec![], vec![]), &all()).unwrap();
    assert_eq!((empty.bins.len(), empty.r_trade_count, empty.mean_r, empty.median_r), (18, 0, None, None));
    let no_sl = r_distribution(&ledger("1000", vec![trade(1, Long, "1", Some("2"), "1", None, "0", 0)], vec![]), &all()).unwrap();
    assert_eq!((no_sl.no_r_count, no_sl.mean_r), (1, None));
    assert!(no_sl.bins.iter().all(|b| b.count == 0));
}

#[test]
fn weekday_hour_heatmap() {
    let mut trades = journal_a();
    trades[3].tz_offset_min = 120; // trade 4 entered 12:00 local
    trades.push(trade(8, Long, "100", Some("90"), "1", None, "0", 0)); // −10, same cell as trade 1
    let h = heatmap(&ledger("10000", trades, vec![]), &all()).unwrap();
    let cells: Vec<(u8, u8, usize, Decimal)> = h.cells.iter().map(|c| (c.weekday, c.hour, c.trade_count, c.net_pnl)).collect();
    assert_eq!(
        cells,
        [(2, 10, 2, dec("90")), (3, 10, 1, dec("-64")), (4, 10, 1, dec("0")), (5, 12, 1, dec("294")), (6, 10, 1, dec("-100")), (7, 10, 1, dec("-36"))]
    );
    assert_eq!(h.max_abs_net_pnl, dec("294"));
    approx(h.cells[0].win_rate, 0.5);
    assert_eq!(h.cells[3].intensity, 1.0);
    approx(Some(h.cells[1].intensity), -64.0 / 294.0);
    assert_eq!(h.cells[2].intensity, 0.0);

    let empty = heatmap(&ledger("10000", vec![], vec![]), &all()).unwrap();
    assert!(empty.cells.is_empty());
    assert_eq!(empty.max_abs_net_pnl, Decimal::ZERO);
    // Only breakevens: no scale, intensity 0.
    let flat = heatmap(&ledger("10000", vec![trade(1, Long, "5", Some("5"), "1", None, "0", 0)], vec![]), &all()).unwrap();
    assert_eq!(flat.cells[0].intensity, 0.0);
}

#[test]
fn long_against_short() {
    let r = long_short(&ledger("10000", journal_a(), vec![]), &all()).unwrap();
    // Long: 100 + 0 + 294 − 36 = 358 on 4; short: −64 − 100 = −164 on 2.
    assert_eq!((r.long.trade_count, r.long.net_pnl, r.short.trade_count, r.short.net_pnl), (4, dec("358"), 2, dec("-164")));
    approx(r.long_share, 4.0 / 6.0);
    approx(r.short.expectancy_r, -1.8); // (−1.6 − 2) / 2
    let longs_only = long_short(&ledger("1000", vec![trade(1, Long, "1", Some("2"), "1", None, "0", 0)], vec![]), &all()).unwrap();
    assert_eq!((longs_only.short.trade_count, longs_only.short.win_rate), (0, None));
    approx(longs_only.long_share, 1.0);
    let empty = long_short(&ledger("1000", vec![], vec![]), &all()).unwrap();
    assert_eq!((empty.long_share, empty.long.trade_count), (None, 0));
    // A short-only filter keeps both sides present.
    let q = StatsQuery { direction: Some(Short), ..all() };
    assert_eq!(long_short(&ledger("10000", journal_a(), vec![]), &q).unwrap().long.trade_count, 0);
}

fn limit(percent: &str) -> BehaviorSettings {
    BehaviorSettings { max_risk_percent: Some(dec(percent)), ..BehaviorSettings::default() }
}

#[test]
fn risk_in_percent_of_the_balance_at_entry() {
    // Balances at entry: 10 000, 10 100, 10 036, 10 036, 10 330, 10 230.
    let r = risk(&ledger("10000", journal_a(), vec![]), &all(), &limit("0.4")).unwrap();
    let balances: Vec<Decimal> = r.trades.iter().map(|t| t.balance_at_entry).collect();
    assert_eq!(balances, ["10000", "10100", "10036", "10036", "10330", "10230"].map(dec));
    let pcts = [50.0 / 10_000.0, 40.0 / 10_100.0, 10.0 / 10_036.0, 50.0 / 10_330.0, 18.0 / 10_230.0];
    approx(r.trades[0].risk_pct, pcts[0]);
    assert_eq!(r.trades[3].risk_pct, None, "trade 4 has no stop");
    approx(r.avg_risk_pct, pcts.iter().sum::<f64>() / 5.0);
    approx(r.max_risk_pct, 0.005);
    approx(r.median_risk_pct, 40.0 / 10_100.0);
    assert_eq!(r.without_stop_count, 1);
    // 0.4 % limit: trade 1 (5 000 > 4 000) and trade 5 (5 000 > 4 132) are over; trade 2 (4 000 ≤ 4 040) is not.
    let within: Vec<Option<bool>> = r.trades.iter().map(|t| t.within_limit).collect();
    assert_eq!(within, [Some(false), Some(true), Some(true), None, Some(false), Some(true)]);
    assert_eq!(r.over_limit_count, Some(2));
    // Limit in money at the current capital: 0.4 % × 10 194.
    assert_eq!((r.current_capital, r.limit_amount), (dec("10194"), Some(dec("40.776"))));

    // Without a limit: no verdict, no count.
    let free = risk(&ledger("10000", journal_a(), vec![]), &all(), &BehaviorSettings::default()).unwrap();
    assert_eq!((free.over_limit_count, free.limit_amount, free.trades[0].within_limit), (None, None, None));
    // Empty period and zero capital.
    let empty = risk(&ledger("10000", vec![], vec![]), &all(), &limit("1")).unwrap();
    assert_eq!((empty.trade_count, empty.avg_risk_pct, empty.median_risk_pct, empty.max_risk_pct, empty.over_limit_count), (0, None, None, None, Some(0)));
    let broke = risk(&ledger("0", vec![trade(1, Long, "100", Some("110"), "1", Some("90"), "0", 0)], vec![]), &all(), &limit("1")).unwrap();
    assert_eq!((broke.trades[0].risk_pct, broke.trades[0].within_limit), (None, None));
}

#[test]
fn deposits_move_the_balance_at_entry_and_a_trade_never_counts_its_own_pnl() {
    // A 5 000 deposit on day 1 at 09:00, before trade 2 enters at 10:00: 40 / (10 100 + 5 000).
    let r = risk(&ledger("10000", journal_a(), vec![(SEP_1 + DAY + 9 * 3_600_000, "5000")]), &all(), &limit("1")).unwrap();
    approx(r.trades[1].risk_pct, 40.0 / 15_100.0);
    approx(r.trades[0].risk_pct, 0.005);
    // A trade closed at the very instant it opened: its own +10 is not in its balance.
    let mut instant = trade(1, Long, "100", Some("110"), "1", Some("90"), "0", 0);
    instant.exit_time = Some(instant.entry_time);
    let r = risk(&ledger("1000", vec![instant], vec![]), &all(), &limit("1")).unwrap();
    assert_eq!(r.trades[0].balance_at_entry, dec("1000"));
}

mod from_db {
    use super::*;
    use crate::test_support::{account, instrument};
    use crate::trades::{self, TradeData};
    use crate::{db, settings};

    #[test]
    fn reports_from_the_database() {
        let conn = db::open_in_memory().unwrap();
        let a = account(&conn, "2000");
        let i = instrument(&conn, "TEST", "1");
        settings::set_behavior(&conn, &limit("1")).unwrap();
        let mut t = TradeData::new(a, i, Long, dec("2"), dec("100"), SEP_1 + 10 * 3_600_000);
        t.exit_price = Some(dec("130"));
        t.exit_time = Some(SEP_1 + 11 * 3_600_000);
        t.planned_sl = Some(dec("85"));
        trades::create(&conn, &t).unwrap();
        let q = StatsQuery { account_ids: vec![a], ..all() };
        // Risk 15 × 2 = 30 on 2 000 = 1.5 % > 1 %; R = 60 / 30 = 2.
        let r = risk::risk_report(&conn, &q).unwrap();
        approx(r.trades[0].risk_pct, 0.015);
        assert_eq!((r.over_limit_count, r.limit_amount), (Some(1), Some(dec("20.60"))));
        assert_eq!(distribution::r_distribution_report(&conn, &q).unwrap().median_r, Some(2.0));
        assert_eq!(distribution::heatmap_report(&conn, &q).unwrap().cells[0].weekday, 2);
        assert_eq!(distribution::long_short_report(&conn, &q).unwrap().long.trade_count, 1);
    }
}
