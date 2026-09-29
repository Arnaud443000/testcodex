//! Known-result tests for the glossary formulas (section 7). Every expected
//! value is computed by hand in the comments; tolerance 1e-12 for floats.

use super::*;
use crate::instruments::AssetClass;
use crate::tags::TagKind;
use crate::test_support::dec;
use crate::trades::{Direction, ExecutionType};

const DAY: i64 = 86_400_000;
const HOUR: i64 = 3_600_000;
/// 2026-09-01 00:00 UTC (day 20697), a Tuesday.
const SEP_1: i64 = 20_697 * DAY;

use Direction::{Long, Short};

/// A trade entered at 10:00 and closed at 11:00 UTC, `day` days after 1 Sept 2026.
#[allow(clippy::too_many_arguments)] // one argument per column of the journal tables below
fn trade(id: i64, direction: Direction, entry: &str, exit: Option<&str>, size: &str, sl: Option<&str>, fees: &str, day: i64) -> TradeFacts {
    TradeFacts {
        id,
        account_id: 1,
        instrument_id: 1,
        symbol: "TEST".into(),
        asset_class: AssetClass::Other,
        position: Position {
            direction,
            size: dec(size),
            multiplier: Decimal::ONE,
            entry_price: dec(entry),
            exit_price: exit.map(dec),
            planned_sl: sl.map(dec),
            planned_tp: None,
            fees: dec(fees),
        },
        entry_time: SEP_1 + day * DAY + 10 * HOUR,
        exit_time: exit.map(|_| SEP_1 + day * DAY + 11 * HOUR),
        tz_offset_min: 0,
        execution_type: None,
        tags: Vec::new(),
    }
}

fn ledger(initial: &str, trades: Vec<TradeFacts>, moves: Vec<(i64, &str)>) -> Ledger {
    Ledger {
        currency: Some("USD".into()),
        initial_capital: dec(initial),
        capital_moves: moves.into_iter().map(|(at, amount)| CapitalMove { at, amount: dec(amount) }).collect(),
        trades,
    }
}

fn all() -> StatsQuery {
    StatsQuery::default()
}

#[track_caller]
fn approx(actual: Option<f64>, expected: f64) {
    let a = actual.unwrap_or_else(|| panic!("expected {expected}, got None"));
    assert!((a - expected).abs() < 1e-12, "expected {expected}, got {a}");
}

/// Journal A — initial capital 10 000, multiplier 1, one trade per day:
///
/// | # | side  | entry → exit | size | SL   | fees | gross | net  | risk | R    |
/// |---|-------|--------------|------|------|------|-------|------|------|------|
/// | 1 | long  | 100 → 110    | 10   | 95   | 0    | +100  | +100 | 50   | +2   |
/// | 2 | short | 50 → 53      | 20   | 52   | 4    | −60   | −64  | 40   | −1.6 |
/// | 3 | long  | 200 → 200    | 1    | 190  | 0    | 0     | 0    | 10   | 0    |
/// | 4 | long  | 20 → 26      | 50   | —    | 6    | +300  | +294 | —    | —    |
/// | 5 | short | 80 → 90      | 10   | 85   | 0    | −100  | −100 | 50   | −2   |
/// | 6 | long  | 10 → 9       | 36   | 9.5  | 0    | −36   | −36  | 18   | −2   |
/// | 7 | long  | 30 → (open)  | 1    | —    | 0    |       |      |      |      |
fn journal_a() -> Vec<TradeFacts> {
    vec![
        trade(1, Long, "100", Some("110"), "10", Some("95"), "0", 0),
        trade(2, Short, "50", Some("53"), "20", Some("52"), "4", 1),
        trade(3, Long, "200", Some("200"), "1", Some("190"), "0", 2),
        trade(4, Long, "20", Some("26"), "50", None, "6", 3),
        trade(5, Short, "80", Some("90"), "10", Some("85"), "0", 4),
        trade(6, Long, "10", Some("9"), "36", Some("9.5"), "0", 5),
        trade(7, Long, "30", None, "1", None, "0", 6),
    ]
}

#[test]
fn pnl_win_rate_rr_profit_factor_and_expectancy() {
    let r = compute(&ledger("10000", journal_a(), vec![]), &all()).unwrap();
    let s = &r.summary;
    assert_eq!((s.trade_count, s.win_count, s.loss_count, s.breakeven_count), (6, 2, 3, 1));
    assert_eq!(r.open_trade_count, 1, "the open trade is excluded from realized stats");
    // PnL brut 100 − 60 + 0 + 300 − 100 − 36 = 204; frais 10; net 194.
    assert_eq!((s.gross_pnl, s.fees, s.net_pnl), (dec("204"), dec("10"), dec("194")));
    // Gains 100 + 294 = 394; pertes 64 + 100 + 36 = 200.
    assert_eq!((s.total_gains, s.total_losses), (dec("394"), dec("200")));
    // Win rate = 2 gagnants / 6 clôturés (le breakeven compte au dénominateur).
    approx(s.win_rate, 2.0 / 6.0);
    // Gain moyen 394 / 2 = 197; perte moyenne 200 / 3 = 66.67; R:R réel = 197 / 66.67 = 2.955.
    assert_eq!(s.avg_win, Some(dec("197")));
    assert_eq!(s.avg_loss.unwrap().round_dp(6), dec("66.666667"));
    approx(s.avg_win_loss_ratio, 2.955);
    // Profit factor = 394 / 200 = 1.97.
    approx(s.profit_factor, 1.97);
    // Expectancy sur les 5 trades avec SL: WR 1/5, R moyen des gains 2; taux de perte 3/5,
    // R moyen des pertes (1.6 + 2 + 2) / 3 = 1.8667 → 0.2 × 2 − 0.6 × 1.8667 = −0.72.
    approx(s.expectancy_r, -0.72);
    assert_eq!(s.r_trade_count, 5);
    // It equals the mean R: (2 − 1.6 + 0 − 2 − 2) / 5 = −0.72.
    approx(s.expectancy_r, (2.0 - 1.6 + 0.0 - 2.0 - 2.0) / 5.0);
    // Expectancy en argent: 194 / 6.
    assert_eq!(s.avg_net_pnl.unwrap().round_dp(6), dec("32.333333"));
}

#[test]
fn equity_curve_drawdowns_and_capital() {
    let r = compute(&ledger("10000", journal_a(), vec![]), &all()).unwrap();
    let s = &r.summary;
    // PnL cumulé: 100, 36, 36, 330, 230, 194.
    let cumulative: Vec<Decimal> = r.equity_curve.iter().map(|p| p.cumulative_net_pnl).collect();
    assert_eq!(cumulative, ["100", "36", "36", "330", "230", "194"].map(dec));
    // Max drawdown: sommet 330 → 194 = 136, toujours en cours.
    assert_eq!((s.max_drawdown, s.current_drawdown), (dec("136"), dec("136")));
    // En %: solde 10 330 → 10 194, soit 136 / 10 330 (l'autre creux, 64 / 10 100, est plus petit).
    approx(s.max_drawdown_pct, 136.0 / 10_330.0);
    approx(s.current_drawdown_pct, 136.0 / 10_330.0);
    // Sans flux, la courbe pondérée dans le temps vaut solde / solde initial: 10 194 / 10 000.
    approx(s.return_pct, 0.0194);
    approx(r.equity_curve.last().unwrap().growth, 1.0194);
    assert_eq!(r.current_capital, dec("10194"));
    assert_eq!(r.equity_curve[1].drawdown, dec("64"));
    // Calendar: one line per local exit day.
    let days: Vec<(&str, Decimal)> = r.daily.iter().map(|d| (d.day.as_str(), d.net_pnl)).collect();
    assert_eq!(
        days,
        [
            ("2026-09-01", dec("100")),
            ("2026-09-02", dec("-64")),
            ("2026-09-03", dec("0")),
            ("2026-09-04", dec("294")),
            ("2026-09-05", dec("-100")),
            ("2026-09-06", dec("-36")),
        ]
    );
}

#[test]
fn input_order_does_not_matter_and_ties_follow_trade_id() {
    let mut shuffled = journal_a();
    shuffled.reverse();
    let a = compute(&ledger("10000", journal_a(), vec![]), &all()).unwrap();
    let b = compute(&ledger("10000", shuffled, vec![]), &all()).unwrap();
    assert_eq!(a, b);
    // Same exit instant: trade 1 before trade 2.
    let mut same_time = vec![trade(2, Long, "100", Some("90"), "1", None, "0", 0), trade(1, Long, "100", Some("120"), "1", None, "0", 0)];
    same_time[0].exit_time = same_time[1].exit_time;
    let r = compute(&ledger("100", same_time, vec![]), &all()).unwrap();
    assert_eq!(r.equity_curve.iter().map(|p| p.trade_id).collect::<Vec<_>>(), [1, 2]);
}

/// Journal B — initial 1 000; deposit 8 900 at the very instant trade 2 closes
/// (applied first); withdrawal 4 500 one hour later.
///
/// | # | net  | balance before | return |
/// |---|------|----------------|--------|
/// | 1 | +100 | 1 000          | +10 %  |
/// | 2 | −500 | 10 000         | −5 %   |
/// | 3 | +250 | 5 000          | +5 %   |
fn journal_b() -> Ledger {
    let t2_exit = SEP_1 + DAY + 11 * HOUR;
    ledger(
        "1000",
        vec![
            trade(1, Long, "100", Some("110"), "10", None, "0", 0),
            trade(2, Long, "100", Some("50"), "10", None, "0", 1),
            trade(3, Long, "100", Some("125"), "10", None, "0", 2),
        ],
        vec![(t2_exit, "8900"), (t2_exit + HOUR, "-4500")],
    )
}

#[test]
fn deposits_and_withdrawals_are_never_performance() {
    let r = compute(&journal_b(), &all()).unwrap();
    let s = &r.summary;
    assert_eq!(s.net_pnl, dec("-150"));
    assert_eq!((r.total_deposits, r.total_withdrawals), (dec("8900"), dec("4500")));
    // Capital courant = 1 000 + 8 900 − 4 500 − 150.
    assert_eq!(r.current_capital, dec("5250"));
    // Rendement pondéré: 1.10 × 0.95 × 1.05 − 1 = 9.725 %, bien que le PnL soit négatif:
    // la perte de 500 porte sur un capital 10 fois plus gros que le gain de 100.
    approx(s.return_pct, 0.09725);
    let growth: Vec<f64> = r.equity_curve.iter().map(|p| p.growth.unwrap()).collect();
    for (g, expected) in growth.iter().zip([1.1, 1.045, 1.09725]) {
        approx(Some(*g), expected);
    }
    // Drawdown en argent sur le PnL cumulé 100, −400, −150: sommet 100 → −400 = 500; en cours 250.
    assert_eq!((s.max_drawdown, s.current_drawdown), (dec("500"), dec("250")));
    // En %: 1 − 1.045 / 1.1 = 5 %; en cours 1 − 1.09725 / 1.1 = 0.25 %.
    approx(s.max_drawdown_pct, 0.05);
    approx(s.current_drawdown_pct, 0.0025);

    // Money figures are identical without any flow: flows never enter them.
    let mut no_flows = journal_b();
    no_flows.capital_moves.clear();
    let n = compute(&no_flows, &all()).unwrap();
    assert_eq!((n.summary.net_pnl, n.summary.max_drawdown), (s.net_pnl, s.max_drawdown));
    assert_eq!(
        n.equity_curve.iter().map(|p| p.cumulative_net_pnl).collect::<Vec<_>>(),
        r.equity_curve.iter().map(|p| p.cumulative_net_pnl).collect::<Vec<_>>()
    );
}

#[test]
fn a_deposit_alone_is_not_a_trade() {
    let r = compute(&ledger("1000", vec![], vec![(SEP_1, "500")]), &all()).unwrap();
    assert_eq!((r.summary.trade_count, r.summary.net_pnl), (0, Decimal::ZERO));
    assert!(r.equity_curve.is_empty());
    assert_eq!(r.current_capital, dec("1500"));
}

#[test]
fn a_period_uses_the_real_balance_built_before_it() {
    let q = StatsQuery { from: Some(SEP_1 + DAY), to: Some(SEP_1 + 3 * DAY), ..all() };
    let r = compute(&journal_b(), &q).unwrap();
    let s = &r.summary;
    assert_eq!((s.trade_count, s.net_pnl), (2, dec("-250")));
    // Trade 2 returns −500 / 10 000 (not −500 / 1 000): 0.95 × 1.05 − 1 = −0.25 %.
    approx(s.return_pct, -0.0025);
    // Within the period the curve starts at 0: −500, −250.
    assert_eq!((s.max_drawdown, s.current_drawdown), (dec("500"), dec("250")));
    approx(s.max_drawdown_pct, 0.05);
    // The window is [from, to): a trade closing exactly at `to` is excluded.
    let q = StatsQuery { to: Some(SEP_1 + DAY + 11 * HOUR), ..all() };
    assert_eq!(compute(&journal_b(), &q).unwrap().summary.trade_count, 1);
    // Current capital is always all-time.
    assert_eq!(r.current_capital, dec("5250"));
}

/// Journal C — daily returns +10 %, −10 %, +10 % on a 1 000 account; day 3 is
/// made of two trades (+49.5 on 990, then +49.5 on 1 039.5) chaining to +10 %.
fn journal_c() -> Ledger {
    let mut late = trade(4, Long, "100", Some("104.95"), "10", None, "0", 2);
    late.exit_time = Some(SEP_1 + 2 * DAY + 15 * HOUR);
    ledger(
        "1000",
        vec![
            trade(1, Long, "100", Some("110"), "10", None, "0", 0),
            trade(2, Long, "100", Some("89"), "10", None, "0", 1),
            trade(3, Long, "100", Some("104.95"), "10", None, "0", 2),
            late,
        ],
        vec![],
    )
}

#[test]
fn sharpe_ratio_on_daily_returns() {
    // Rendements journaliers 0.1, −0.1, 0.1: moyenne 1/30; écart-type échantillon
    // √((2 × (1/15)² + (2/15)²) / 2) = 0.2 / √3 → Sharpe = (1/30) / (0.2/√3) = 1 / (2√3).
    let r = compute(&journal_c(), &all()).unwrap();
    approx(r.summary.sharpe, 1.0 / (2.0 * 3f64.sqrt()));
    assert_eq!(r.daily.len(), 3);
    assert_eq!(r.daily[2].trade_count, 2);
    // Avec un taux sans risque de 1 % par jour: (1/30 − 1/100) / (0.2/√3) = 7√3 / 60.
    let q = StatsQuery { risk_free_daily: 0.01, ..all() };
    approx(compute(&journal_c(), &q).unwrap().summary.sharpe, 7.0 * 3f64.sqrt() / 60.0);
}

#[test]
fn sharpe_edge_cases() {
    // A single trading day: no dispersion to measure.
    let one_day = ledger("1000", vec![trade(1, Long, "100", Some("110"), "1", None, "0", 0)], vec![]);
    assert_eq!(compute(&one_day, &all()).unwrap().summary.sharpe, None);
    // Identical daily returns (+10 % twice): standard deviation 0.
    let flat = ledger(
        "1000",
        vec![trade(1, Long, "100", Some("110"), "10", None, "0", 0), trade(2, Long, "100", Some("111"), "10", None, "0", 1)],
        vec![],
    );
    assert_eq!(compute(&flat, &all()).unwrap().summary.sharpe, None);
}

#[test]
fn empty_journal() {
    let r = compute(&ledger("10000", vec![], vec![]), &all()).unwrap();
    let s = &r.summary;
    assert_eq!((s.trade_count, s.net_pnl, s.max_drawdown, s.current_drawdown), (0, Decimal::ZERO, Decimal::ZERO, Decimal::ZERO));
    assert_eq!((s.win_rate, s.profit_factor, s.avg_win_loss_ratio, s.expectancy_r, s.sharpe), (None, None, None, None, None));
    assert_eq!((s.avg_win, s.avg_loss, s.avg_net_pnl), (None, None, None));
    assert_eq!((s.return_pct, s.max_drawdown_pct, s.current_drawdown_pct), (None, None, None));
    assert!(r.equity_curve.is_empty() && r.daily.is_empty());
    assert_eq!(r.current_capital, dec("10000"));
    // No account at all.
    let none = compute(&Ledger::default(), &all()).unwrap();
    assert_eq!((none.currency, none.summary.trade_count), (None, 0));
}

#[test]
fn only_winners() {
    let l = ledger(
        "1000",
        vec![trade(1, Long, "100", Some("110"), "1", Some("90"), "0", 0), trade(2, Long, "100", Some("105"), "1", Some("95"), "0", 1)],
        vec![],
    );
    let s = compute(&l, &all()).unwrap().summary;
    approx(s.win_rate, 1.0);
    // No loss: profit factor and R:R are undefined (the UI shows ∞ since gains > 0).
    assert_eq!((s.profit_factor, s.avg_win_loss_ratio, s.avg_loss), (None, None, None));
    assert_eq!((s.total_gains, s.total_losses), (dec("15"), Decimal::ZERO));
    // R = 1 and 1 → expectancy 1.
    approx(s.expectancy_r, 1.0);
    assert_eq!((s.max_drawdown, s.current_drawdown), (Decimal::ZERO, Decimal::ZERO));
    approx(s.max_drawdown_pct, 0.0);
}

#[test]
fn only_losers_and_first_trade_loss_drawdown() {
    let l = ledger(
        "1000",
        vec![trade(1, Long, "100", Some("50"), "1", Some("75"), "0", 0), trade(2, Short, "100", Some("125"), "1", Some("125"), "0", 1)],
        vec![],
    );
    let s = compute(&l, &all()).unwrap().summary;
    approx(s.win_rate, 0.0);
    // Pas de gain: profit factor 0 / 75 = 0; R:R réel indéfini (pas de gain moyen).
    approx(s.profit_factor, 0.0);
    assert_eq!(s.avg_win_loss_ratio, None);
    // R = −2 et −1 → expectancy = 0 × 0 − 1 × 1.5 = −1.5.
    approx(s.expectancy_r, -1.5);
    // Le drawdown part du capital de départ: 0 → −50 → −75.
    assert_eq!(s.max_drawdown, dec("75"));
    // 1 − (950/1000 × 925/950) = 7.5 %.
    approx(s.max_drawdown_pct, 0.075);
}

#[test]
fn breakeven_only_and_no_stop_loss() {
    let flat = ledger("1000", vec![trade(1, Long, "100", Some("100"), "1", Some("90"), "0", 0)], vec![]);
    let s = compute(&flat, &all()).unwrap().summary;
    assert_eq!((s.win_count, s.loss_count, s.breakeven_count), (0, 0, 1));
    approx(s.win_rate, 0.0);
    assert_eq!(s.profit_factor, None);
    approx(s.expectancy_r, 0.0);
    approx(s.return_pct, 0.0);

    // Without any planned SL there is no R, hence no expectancy in R, but the rest works.
    let no_sl = ledger(
        "1000",
        vec![trade(1, Long, "100", Some("110"), "1", None, "0", 0), trade(2, Long, "100", Some("95"), "1", None, "0", 1)],
        vec![],
    );
    let s = compute(&no_sl, &all()).unwrap().summary;
    assert_eq!((s.expectancy_r, s.r_trade_count), (None, 0));
    approx(s.profit_factor, 2.0);
    assert_eq!(s.avg_net_pnl, Some(dec("2.5")));
}

#[test]
fn percentages_are_undefined_without_positive_capital() {
    // Zero capital: returns cannot be measured, money figures still can.
    let zero = ledger("0", vec![trade(1, Long, "100", Some("110"), "1", None, "0", 0)], vec![]);
    let s = compute(&zero, &all()).unwrap().summary;
    assert_eq!(s.net_pnl, dec("10"));
    assert_eq!((s.return_pct, s.max_drawdown_pct, s.sharpe), (None, None, None));
    // Blown account: 100 − 150 = −50, then +20 on a negative balance.
    let blown = ledger(
        "100",
        vec![trade(1, Long, "100", Some("50"), "3", None, "0", 0), trade(2, Long, "100", Some("120"), "1", None, "0", 1)],
        vec![],
    );
    let s = compute(&blown, &all()).unwrap().summary;
    assert_eq!((s.max_drawdown, s.current_drawdown), (dec("150"), dec("130")));
    assert_eq!((s.return_pct, s.max_drawdown_pct, s.current_drawdown_pct), (None, None, None));
}

#[test]
fn filters_by_direction_instrument_and_tags() {
    let mut trades = journal_a();
    let breakout = TagRef { id: 10, kind: TagKind::Setup, name: "Breakout".into() };
    trades[0].tags.push(breakout.clone());
    trades[1].tags.push(breakout);
    trades[4].instrument_id = 2;
    let l = ledger("10000", trades, vec![]);
    let net = |q: StatsQuery| compute(&l, &q).unwrap().summary.net_pnl;
    assert_eq!(net(StatsQuery { direction: Some(Short), ..all() }), dec("-164"));
    assert_eq!(net(StatsQuery { instrument_ids: vec![2], ..all() }), dec("-100"));
    assert_eq!(net(StatsQuery { tag_ids: vec![10], ..all() }), dec("36"));
    assert_eq!(net(StatsQuery { tag_ids: vec![10], direction: Some(Short), ..all() }), dec("-64"));
    // Every listed tag is required.
    assert_eq!(compute(&l, &StatsQuery { tag_ids: vec![10, 99], ..all() }).unwrap().summary.trade_count, 0);
}

#[test]
fn segments_by_direction_tag_time_instrument_and_execution() {
    let mut trades = journal_a();
    let tag = |id, kind, name: &str| TagRef { id, kind, name: name.into() };
    trades[0].tags = vec![tag(10, TagKind::Setup, "Breakout")];
    trades[1].tags = vec![tag(10, TagKind::Setup, "Breakout"), tag(20, TagKind::Mistake, "Revenge trade"), tag(21, TagKind::Mistake, "Early exit")];
    trades[3].tags = vec![tag(11, TagKind::Setup, "Pullback")];
    trades[4].tags = vec![tag(21, TagKind::Mistake, "Early exit")];
    trades[3].tz_offset_min = 120; // entered 10:00 UTC = 12:00 local
    trades[4].instrument_id = 2;
    trades[4].symbol = "EURUSD".into();
    trades[5].instrument_id = 2;
    trades[5].symbol = "EURUSD".into();
    trades[0].execution_type = Some(ExecutionType::System);
    let l = ledger("10000", trades, vec![]);
    let seg = |by| -> Vec<(String, String, Decimal, usize)> {
        segments(&l, &all(), by)
            .unwrap()
            .into_iter()
            .map(|s| (s.key, s.label, s.summary.net_pnl, s.summary.trade_count))
            .collect()
    };
    let row = |k: &str, l: &str, net: &str, n| (k.to_string(), l.to_string(), dec(net), n);

    // Long: 100 + 0 + 294 − 36 = 358 on 4 trades; short: −64 − 100 = −164.
    assert_eq!(seg(SegmentBy::Direction), [row("long", "Long", "358", 4), row("short", "Short", "-164", 2)]);
    let long = segments(&l, &all(), SegmentBy::Direction).unwrap().remove(0).summary;
    approx(long.win_rate, 0.5);
    // Setups: Breakout 100 − 64, Pullback 294, none 0 − 100 − 36 (listed last). Sum = 194.
    assert_eq!(
        seg(SegmentBy::Tag(TagKind::Setup)),
        [row("10", "Breakout", "36", 2), row("11", "Pullback", "294", 1), row("none", "None", "-136", 3)]
    );
    // Mistakes: trade 2 counts in both of its mistakes.
    assert_eq!(
        seg(SegmentBy::Tag(TagKind::Mistake)),
        [row("21", "Early exit", "-164", 2), row("20", "Revenge trade", "-64", 1), row("none", "None", "358", 4)]
    );
    // 1 Sept 2026 is a Tuesday: trades 1 → 6 fall on Tuesday → Sunday.
    let weekdays = seg(SegmentBy::Weekday);
    assert_eq!(weekdays[0], row("2", "Tuesday", "100", 1));
    assert_eq!(weekdays[5], row("7", "Sunday", "-36", 1));
    assert_eq!(seg(SegmentBy::Hour), [row("10", "10:00", "-100", 5), row("12", "12:00", "294", 1)]);
    assert_eq!(seg(SegmentBy::Instrument), [row("2", "EURUSD", "-136", 2), row("1", "TEST", "330", 4)]);
    assert_eq!(seg(SegmentBy::ExecutionType), [row("system", "System", "100", 1), row("none", "None", "94", 5)]);
    assert_eq!(seg(SegmentBy::AssetClass), [row("other", "Other", "194", 6)]);
}

#[test]
fn local_offsets_group_trades_by_the_traders_day() {
    // Exits at 23:30 and 00:30 UTC seen from UTC−2 (21:30 and 22:30): same local day.
    let mut a = trade(1, Long, "100", Some("110"), "1", None, "0", 0);
    let mut b = trade(2, Long, "100", Some("90"), "1", None, "0", 0);
    a.exit_time = Some(SEP_1 + 23 * HOUR + 30 * 60_000);
    b.exit_time = Some(SEP_1 + DAY + 30 * 60_000);
    a.tz_offset_min = -120;
    b.tz_offset_min = -120;
    let r = compute(&ledger("1000", vec![a, b], vec![]), &all()).unwrap();
    assert_eq!(r.daily.len(), 1);
    assert_eq!((r.daily[0].day.as_str(), r.daily[0].net_pnl, r.daily[0].trade_count), ("2026-09-01", Decimal::ZERO, 2));
}

#[test]
fn overflowing_amounts_are_an_error() {
    let mut big = trade(1, Long, "0", Some("2"), "1", None, "0", 0);
    big.position.size = Decimal::MAX;
    assert!(matches!(compute(&ledger("0", vec![big], vec![]), &all()), Err(crate::CoreError::Invalid(_))));
}

// --- From the database -------------------------------------------------------

mod from_db {
    use super::*;
    use crate::cash_flows::{self, CashFlowKind, NewCashFlow};
    use crate::test_support::{account, instrument};
    use crate::trades::{self, TradeData};
    use crate::{accounts, db, tags};

    #[test]
    fn report_matches_journal_b_when_built_through_the_api() {
        let conn = db::open_in_memory().unwrap();
        let acc = account(&conn, "1000");
        let other = account(&conn, "50");
        let inst = instrument(&conn, "TEST", "1");
        let setup = tags::create(&conn, TagKind::Setup, "Breakout").unwrap();
        for t in journal_b().trades {
            let mut d = TradeData::new(acc, inst, t.position.direction, t.position.size, t.position.entry_price, t.entry_time);
            d.exit_price = t.position.exit_price;
            d.exit_time = t.exit_time;
            d.tag_ids = vec![setup.id];
            trades::create(&conn, &d).unwrap();
        }
        // An open trade and a trade on another account.
        trades::create(&conn, &TradeData::new(acc, inst, Long, dec("1"), dec("100"), SEP_1)).unwrap();
        let mut elsewhere = TradeData::new(other, inst, Long, dec("1"), dec("100"), SEP_1);
        elsewhere.exit_price = Some(dec("90"));
        elsewhere.exit_time = Some(SEP_1 + HOUR);
        trades::create(&conn, &elsewhere).unwrap();
        for m in journal_b().capital_moves {
            let kind = if m.amount > Decimal::ZERO { CashFlowKind::Deposit } else { CashFlowKind::Withdrawal };
            cash_flows::create(
                &conn,
                &NewCashFlow { account_id: acc, kind, amount: m.amount.abs(), occurred_at: m.at, tz_offset_min: 0, note: String::new() },
            )
            .unwrap();
        }

        let q = StatsQuery { account_ids: vec![acc], ..all() };
        let r = report(&conn, &q).unwrap();
        assert_eq!(r.currency.as_deref(), Some("USD"));
        assert_eq!((r.summary.trade_count, r.summary.net_pnl, r.open_trade_count), (3, dec("-150"), 1));
        assert_eq!(r.current_capital, dec("5250"));
        approx(r.summary.return_pct, 0.09725);
        let by_setup = segment_report(&conn, &q, SegmentBy::Tag(TagKind::Setup)).unwrap();
        assert_eq!((by_setup.len(), by_setup[0].label.as_str()), (1, "Breakout"));

        // Consolidated view of both USD accounts: capital 1 050, PnL −150 − 10.
        let both = report(&conn, &all()).unwrap();
        assert_eq!((both.initial_capital, both.summary.net_pnl, both.summary.trade_count), (dec("1050"), dec("-160"), 4));
    }

    #[test]
    fn refuses_to_mix_currencies_and_unknown_accounts() {
        let conn = db::open_in_memory().unwrap();
        account(&conn, "1000");
        accounts::create(
            &conn,
            &accounts::NewAccount {
                name: "EUR".into(),
                kind: "demo".into(),
                broker: String::new(),
                currency: "EUR".into(),
                initial_capital: dec("1"),
            },
        )
        .unwrap();
        assert!(matches!(report(&conn, &all()), Err(crate::CoreError::Invalid(_))));
        assert!(matches!(report(&conn, &StatsQuery { account_ids: vec![99], ..all() }), Err(crate::CoreError::NotFound(_))));
    }

    #[test]
    fn empty_database() {
        let conn = db::open_in_memory().unwrap();
        let r = report(&conn, &all()).unwrap();
        assert_eq!((r.currency, r.summary.trade_count), (None, 0));
    }
}
