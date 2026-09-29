//! Known-result tests for the lot 8 bis reports (external factors, after two
//! losses, size change after a loss, plan simulation). Every expected value is
//! computed by hand in the comments (see CLAUDE.md, "Compléments du moteur").

use super::tests::{all, approx, ledger, trade};
use super::*;
use crate::journal::JournalEntry;
use crate::stats::{AccountCapital, StatsQuery};
use crate::test_support::dec;
use crate::trades::{Direction, PlanFollowed};

const DAY: i64 = 86_400_000;
const MIN: i64 = 60_000;
/// 2026-09-01 00:00 UTC, as in `tests.rs`.
const SEP_1: i64 = 20_697 * DAY;

use Direction::Long;

fn defaults() -> BehaviorSettings {
    BehaviorSettings::default()
}

/// A long at 100 with a stop at 90 (risk 10 × size), entered on day `day` at 09:00, closed at 10:00.
fn long(id: i64, exit: &str, day: i64) -> TradeFacts {
    trade(id, Long, "100", Some(exit), "1", Some("90"), day, 9 * 60, 10 * 60)
}

fn day_key(day: i64) -> String {
    time_key(SEP_1 + day * DAY)
}

fn time_key(ms: i64) -> String {
    crate::stats::time::day_key(ms, 0)
}

fn entry(day: i64) -> JournalEntry {
    JournalEntry {
        day: day_key(day),
        mood: None,
        sleep_quality: None,
        fatigue: None,
        late_hours: false,
        went_well: String::new(),
        to_improve: String::new(),
        notes: String::new(),
    }
}

// --- External factors (3.4.9) ---------------------------------------------------

/// Journal H — one trade per day on account 1, long 100 → exit, SL 90, size 1 (R = PnL / 10).
/// Default settings: no revenge (23 h between trades), no risk limit, so a trade scores
/// 100 with plan yes or undeclared ((30 + 10 + 10) / 50, (10 + 10) / 20) and 40 with plan no (20 / 50).
///
/// | day | exit | net | R    | plan | journal                              |
/// |-----|------|-----|------|------|--------------------------------------|
/// | 0   | 90   | −10 | −1   | no   | sleep 1, fatigue 5, late hours       |
/// | 1   | 90   | −10 | −1   | no   | sleep 2, late hours                  |
/// | 2   | 110  | +10 | +1   | yes  | sleep 2                              |
/// | 3   | 90   | −10 | −1   | no   | sleep 1                              |
/// | 4   | 95   | −5  | −0.5 | yes  | sleep 2                              |
/// | 5   | 120  | +20 | +2   | yes  | sleep 4, fatigue 1                   |
/// | 6   | 110  | +10 | +1   | yes  | sleep 3                              |
/// | 7   | 90   | −10 | −1   | yes  | sleep 5                              |
/// | 8   | 110  | +10 | +1   | yes  | sleep 4                              |
/// | 9   | 115  | +15 | +1.5 | yes  | sleep 3                              |
/// | 10  | 100  | 0   | 0    | —    | no entry                             |
/// | 11  | 105  | +5  | +0.5 | —    | mood 3 only                          |
///
/// Plus a journal entry on day 20 (sleep 1) without any trade: ignored.
fn journal_h() -> (Vec<TradeFacts>, Vec<JournalEntry>) {
    let exits = ["90", "90", "110", "90", "95", "120", "110", "90", "110", "115", "100", "105"];
    let mut t: Vec<TradeFacts> = exits.iter().enumerate().map(|(d, x)| long(d as i64 + 1, x, d as i64)).collect();
    for (d, plan) in t.iter_mut().zip([
        Some(PlanFollowed::No),
        Some(PlanFollowed::No),
        Some(PlanFollowed::Yes),
        Some(PlanFollowed::No),
        Some(PlanFollowed::Yes),
    ]) {
        d.journal.plan_followed = plan;
    }
    for d in &mut t[5..10] {
        d.journal.plan_followed = Some(PlanFollowed::Yes);
    }
    let sleep = [1, 2, 2, 1, 2, 4, 3, 5, 4, 3];
    let mut e: Vec<JournalEntry> = (0..10).map(|d| JournalEntry { sleep_quality: Some(sleep[d]), ..entry(d as i64) }).collect();
    e[0].fatigue = Some(5);
    e[0].late_hours = true;
    e[1].late_hours = true;
    e[5].fatigue = Some(1);
    e.push(JournalEntry { mood: Some(3), ..entry(11) });
    e.push(JournalEntry { sleep_quality: Some(1), ..entry(20) });
    (t, e)
}

fn factor(r: &ExternalFactorReport, key: FactorKey) -> &FactorReport {
    r.factors.iter().find(|f| f.key == key).unwrap()
}

#[test]
fn external_factors_compare_the_days_with_and_without_each_factor() {
    let (trades, entries) = journal_h();
    let r = external_factors(&ledger("10000", trades), &all(), &defaults(), &entries).unwrap();
    assert_eq!(r.factors.iter().map(|f| f.key).collect::<Vec<_>>(), FACTORS);
    assert_eq!((r.trade_count, r.trading_day_count, r.journal_day_count), (12, 12, 11));

    // Poor sleep: days 0–4 against days 5–9; days 10 (no entry) and 11 (sleep blank) undeclared.
    let s = factor(&r, FactorKey::PoorSleep);
    assert_eq!((s.present.day_count, s.present.summary.trade_count, s.present.trade_ids.clone()), (5, 5, vec![1, 2, 3, 4, 5]));
    assert_eq!((s.absent.day_count, s.absent.summary.trade_count), (5, 5));
    assert_eq!((s.undeclared_day_count, s.undeclared_trade_count), (2, 2));
    assert_eq!((s.present.summary.net_pnl, s.absent.summary.net_pnl), (dec("-25"), dec("45")));
    approx(s.present.summary.win_rate, 0.2);
    approx(s.absent.summary.win_rate, 0.8);
    // Discipline: (40 + 40 + 100 + 40 + 100) / 5 = 64 against 100 → −36 points.
    approx(s.discipline.present, 64.0);
    approx(s.discipline.absent, 100.0);
    approx(s.discipline.difference, -36.0);
    assert_eq!(s.discipline.verdict, Verdict::Lower);
    // Expectancy: (−1 − 1 + 1 − 1 − 0.5) / 5 = −0.5 against (2 + 1 − 1 + 1 + 1.5) / 5 = 0.9 → −1.4 R.
    approx(s.expectancy_r.present, -0.5);
    approx(s.expectancy_r.absent, 0.9);
    approx(s.expectancy_r.difference, -1.4);
    assert_eq!(s.expectancy_r.verdict, Verdict::Lower);
    // Mean net PnL per trade: −25 / 5 − 45 / 5 = −5 − 9.
    assert_eq!(s.avg_net_pnl_difference, Some(dec("-14")));

    // High fatigue: one day on each side (0 and 5), ten days undeclared: no verdict, no gap.
    let f = factor(&r, FactorKey::HighFatigue);
    assert_eq!((f.present.day_count, f.absent.day_count, f.undeclared_day_count, f.undeclared_trade_count), (1, 1, 10, 10));
    assert_eq!((f.discipline.present, f.discipline.difference, f.discipline.verdict), (None, None, Verdict::NotEnoughData));
    assert_eq!((f.expectancy_r.present, f.expectancy_r.verdict), (None, Verdict::NotEnoughData));
    assert_eq!(f.avg_net_pnl_difference, None);
    assert_eq!(f.present.summary.net_pnl, dec("-10"));

    // Late hours: ticked on days 0 and 1; every other entry (2–9, 11) counts as absent; day 10 has no entry.
    let l = factor(&r, FactorKey::LateHours);
    assert_eq!((l.present.day_count, l.absent.day_count, l.undeclared_day_count), (2, 9, 1));
    assert_eq!(l.present.summary.net_pnl, dec("-20"));
    // 9 scored trades on the absent side: its score exists, but 2 days with the factor give no verdict.
    approx(l.discipline.absent, (100.0 * 7.0 + 40.0 + 100.0) / 9.0);
    assert_eq!((l.discipline.difference, l.discipline.verdict), (None, Verdict::NotEnoughData));

    // Low mood: only day 11 declares a mood (3: absent).
    let m = factor(&r, FactorKey::LowMood);
    assert_eq!((m.present.day_count, m.absent.day_count, m.undeclared_day_count), (0, 1, 11));
    assert_eq!(m.present.summary.trade_count, 0);
    assert_eq!(m.expectancy_r.verdict, Verdict::NotEnoughData);
}

#[test]
fn external_factors_without_trades_or_journal() {
    let (_, entries) = journal_h();
    let r = external_factors(&ledger("10000", vec![]), &all(), &defaults(), &entries).unwrap();
    assert_eq!((r.trade_count, r.trading_day_count, r.journal_day_count), (0, 0, 0));
    assert_eq!(r.factors.len(), 4);
    for f in &r.factors {
        assert_eq!((f.present.day_count, f.absent.day_count, f.undeclared_day_count), (0, 0, 0));
        assert_eq!((f.discipline.verdict, f.expectancy_r.verdict), (Verdict::NotEnoughData, Verdict::NotEnoughData));
        assert_eq!((f.present.summary.win_rate, f.present.discipline_score), (None, None));
    }
    // Trades but no journal at all: everything is undeclared.
    let (trades, _) = journal_h();
    let r = external_factors(&ledger("10000", trades), &all(), &defaults(), &[]).unwrap();
    assert_eq!(r.journal_day_count, 0);
    assert!(r.factors.iter().all(|f| f.undeclared_day_count == 12 && f.undeclared_trade_count == 12));
}

#[test]
fn external_factors_with_two_accounts_count_shared_days_once() {
    // Account 2 trades on day 0 too (+30, R +3, no plan: score 100); the journal is shared.
    let (mut trades, entries) = journal_h();
    let mut other = trade(13, Long, "100", Some("130"), "1", Some("90"), 0, 9 * 60 + 30, 10 * 60 + 30);
    other.account_id = 2;
    trades.push(other);
    let mut l = ledger("10000", trades);
    l.accounts.push(AccountCapital { id: 2, initial_capital: dec("5000") });
    l.initial_capital = dec("15000");
    let r = external_factors(&l, &all(), &defaults(), &entries).unwrap();
    let s = factor(&r, FactorKey::PoorSleep);
    // Still 5 days, now 6 trades: net −25 + 30 = +5.
    assert_eq!((s.present.day_count, s.present.summary.trade_count, s.present.summary.net_pnl), (5, 6, dec("5")));
    // Discipline (40 + 40 + 100 + 40 + 100 + 100) / 6 = 70 → −30; R (−2.5 + 3) / 6 − 0.9.
    approx(s.discipline.difference, -30.0);
    approx(s.expectancy_r.present, 0.5 / 6.0);
    approx(s.expectancy_r.difference, 0.5 / 6.0 - 0.9);
    assert_eq!(s.expectancy_r.verdict, Verdict::Lower);
    assert_eq!((r.trade_count, r.trading_day_count), (13, 12));
}

#[test]
fn external_factors_use_the_local_entry_day_and_the_period_filter() {
    // Entered 1 Sept 23:30 UTC, closed 2 Sept 00:30: the 1st's journal applies.
    let overnight = trade(1, Long, "100", Some("110"), "1", Some("90"), 0, 23 * 60 + 30, 24 * 60 + 30);
    // Entered 2 Sept 23:00 UTC by a trader at UTC+2: local day 3 Sept.
    let mut shifted = trade(2, Long, "100", Some("90"), "1", Some("90"), 1, 23 * 60, 23 * 60 + 30);
    shifted.tz_offset_min = 120;
    let entries = vec![
        JournalEntry { late_hours: true, ..entry(0) },
        JournalEntry { sleep_quality: Some(5), ..entry(1) },
        JournalEntry { sleep_quality: Some(1), ..entry(2) },
    ];
    let r = external_factors(&ledger("10000", vec![overnight, shifted]), &all(), &defaults(), &entries).unwrap();
    let late = factor(&r, FactorKey::LateHours);
    assert_eq!((late.present.trade_ids.clone(), late.absent.trade_ids.clone()), (vec![1], vec![2]));
    let sleep = factor(&r, FactorKey::PoorSleep);
    assert_eq!((sleep.present.trade_ids.clone(), sleep.absent.trade_ids.clone(), sleep.undeclared_trade_count), (vec![2], vec![], 1));

    // The period is on exit: from 11 Sept, journal H keeps the trades of days 10 and 11.
    let from = |d: i64| StatsQuery { from: Some(SEP_1 + d * DAY), ..StatsQuery::default() };
    let r = external_factors(&ledger("10000", journal_h().0), &from(10), &defaults(), &journal_h().1).unwrap();
    assert_eq!(r.trade_count, 2);
    assert_eq!(factor(&r, FactorKey::LowMood).absent.trade_ids, vec![12]);
    assert_eq!(time_key(SEP_1 + DAY + 23 * 60 * MIN + 120 * MIN), "2026-09-03", "the shifted trade's local day");
}

#[test]
fn comparison_verdicts_and_thresholds() {
    let c = factors_compare(Some(75.0), Some(80.0), true, DISCIPLINE_GAP);
    assert_eq!((c.difference, c.verdict), (Some(-5.0), Verdict::Similar));
    assert_eq!(factors_compare(Some(70.0), Some(80.0), true, DISCIPLINE_GAP).verdict, Verdict::Lower);
    assert_eq!(factors_compare(Some(0.5), Some(0.25), true, EXPECTANCY_GAP_R).verdict, Verdict::Higher);
    // Not enough days: values stay visible, no gap.
    let c = factors_compare(Some(0.5), Some(0.25), false, EXPECTANCY_GAP_R);
    assert_eq!((c.present, c.difference, c.verdict), (Some(0.5), None, Verdict::NotEnoughData));
    assert_eq!(factors_compare(None, Some(1.0), true, 1.0).verdict, Verdict::NotEnoughData);
}

fn factors_compare(p: Option<f64>, a: Option<f64>, enough: bool, gap: f64) -> Comparison {
    super::factors::compare(p, a, enough, gap)
}

#[test]
fn external_factor_report_reads_the_daily_journal_from_sqlite() {
    use crate::test_support::{account, instrument};
    use crate::trades::{self, TradeData};
    let conn = crate::db::open_in_memory().unwrap();
    let a = account(&conn, "10000");
    let i = instrument(&conn, "TEST", "1");
    for d in 0..2 {
        let mut t = TradeData::new(a, i, Long, dec("1"), dec("100"), SEP_1 + d * DAY + 9 * 60 * MIN);
        t.exit_price = Some(dec(if d == 0 { "90" } else { "120" }));
        t.exit_time = Some(SEP_1 + d * DAY + 10 * 60 * MIN);
        t.planned_sl = Some(dec("90"));
        trades::create(&conn, &t).unwrap();
    }
    crate::journal::save(&conn, &JournalEntry { sleep_quality: Some(1), ..entry(0) }).unwrap();
    crate::journal::save(&conn, &JournalEntry { sleep_quality: Some(4), ..entry(1) }).unwrap();
    let r = external_factor_report(&conn, &StatsQuery::default()).unwrap();
    let s = factor(&r, FactorKey::PoorSleep);
    assert_eq!((s.present.summary.net_pnl, s.absent.summary.net_pnl), (dec("-10"), dec("20")));
    assert_eq!((r.journal_day_count, s.discipline.verdict), (2, Verdict::NotEnoughData));
}

// --- After two losses ---------------------------------------------------------------

/// Journal F — account 1, one long a day at 100 with SL 90 (risk 10 × size), 09:00 → 10:00,
/// except trade 7 (same day as 6, 10:30 → 11:00, size 2). Default settings: trade 7 follows
/// the loss of 6 by 30 min with twice its risk (20 vs 10), a revenge: score (10 + 0) / 20 = 50;
/// every other trade scores (10 + 10) / 20 = 100 (no plan, no rules, no risk limit).
///
/// | #  | day | exit | size | net | R    | two last closed at entry | after 2 losses |
/// |----|-----|------|------|-----|------|--------------------------|----------------|
/// | 1  | 0   | 90   | 1    | −10 | −1   | —                        | no             |
/// | 2  | 1   | 95   | 1    | −5  | −0.5 | 1                        | no             |
/// | 3  | 2   | 80   | 1    | −20 | −2   | 2 L, 1 L                 | yes            |
/// | 4  | 3   | 130  | 1    | +30 | +3   | 3 L, 2 L                 | yes            |
/// | 5  | 4   | 90   | 1    | −10 | −1   | 4 W, 3 L                 | no             |
/// | 6  | 5   | 90   | 1    | −10 | −1   | 5 L, 4 W                 | no             |
/// | 7  | 5   | 85   | 2    | −30 | −1.5 | 6 L, 5 L                 | yes            |
/// | 8  | 6   | 100  | 1    | 0   | 0    | 7 L, 6 L                 | yes            |
/// | 9  | 7   | 90   | 1    | −10 | −1   | 8 BE, 7 L                | no             |
/// | 10 | 8   | 95   | 1    | −5  | −0.5 | 9 L, 8 BE                | no (BE breaks) |
/// | 11 | 9   | 110  | 1    | +10 | +1   | 10 L, 9 L                | yes            |
/// | 12 | 10  | 120  | 1    | +20 | +2   | 11 W, 10 L               | no             |
/// | 13 | 11  | 110  | 1    | +10 | +1   | 12 W, 11 W               | no             |
fn journal_f() -> Vec<TradeFacts> {
    let exits = ["90", "95", "80", "130", "90", "90", "85", "100", "90", "95", "110", "120", "110"];
    exits
        .iter()
        .enumerate()
        .map(|(i, x)| {
            let id = i as i64 + 1;
            match id {
                7 => trade(7, Long, "100", Some(x), "2", Some("90"), 5, 10 * 60 + 30, 11 * 60),
                _ => long(id, x, if id < 7 { id - 1 } else { id - 2 }),
            }
        })
        .collect()
}

#[test]
fn after_two_losses_against_the_other_trades() {
    let r = after_losses(&ledger("10000", journal_f()), &all(), &defaults()).unwrap();
    let (a, o) = (&r.after_two_losses, &r.others);
    assert_eq!(a.trade_ids, [3, 4, 7, 8, 11]);
    assert_eq!(o.trade_ids, [1, 2, 5, 6, 9, 10, 12, 13]);
    assert!(!r.sample_too_small);
    // After: −20 + 30 − 30 + 0 + 10 = −10, 2 wins of 5, R (−2 + 3 − 1.5 + 0 + 1) / 5 = 0.1.
    assert_eq!((a.summary.net_pnl, a.summary.avg_net_pnl), (dec("-10"), Some(dec("-2"))));
    approx(a.summary.win_rate, 0.4);
    approx(a.summary.expectancy_r, 0.1);
    // Others: −10 − 5 − 10 − 10 − 10 − 5 + 20 + 10 = −20, 2 wins of 8, R −2 / 8.
    assert_eq!((o.summary.net_pnl, o.summary.avg_net_pnl), (dec("-20"), Some(dec("-2.5"))));
    approx(o.summary.win_rate, 0.25);
    approx(o.summary.expectancy_r, -0.25);
    // Discipline: (100 + 100 + 50 + 100 + 100) / 5 = 90 against 100.
    approx(a.discipline_score, 90.0);
    approx(o.discipline_score, 100.0);
    approx(r.win_rate_difference, 0.15);
    approx(r.expectancy_r_difference, 0.35);
    approx(r.discipline_difference, -10.0);
    assert_eq!(r.avg_net_pnl_difference, Some(dec("0.5")));
}

#[test]
fn after_two_losses_reads_history_outside_the_period_and_needs_five_trades() {
    // From day 6: trades 8–13. Trade 8 still follows 7 and 6 (before the period).
    let q = StatsQuery { from: Some(SEP_1 + 6 * DAY), ..StatsQuery::default() };
    let r = after_losses(&ledger("10000", journal_f()), &q, &defaults()).unwrap();
    assert_eq!((r.after_two_losses.trade_ids.clone(), r.others.trade_ids.len()), (vec![8, 11], 4));
    assert!(r.sample_too_small);
    assert_eq!((r.win_rate_difference, r.expectancy_r_difference, r.discipline_difference, r.avg_net_pnl_difference), (None, None, None, None));
    // Values stay visible: the UI shows them as "not enough trades".
    assert_eq!(r.after_two_losses.summary.net_pnl, dec("10"));

    let empty = after_losses(&ledger("10000", vec![]), &all(), &defaults()).unwrap();
    assert!(empty.sample_too_small);
    assert_eq!((empty.after_two_losses.summary.trade_count, empty.others.summary.win_rate), (0, None));
    assert_eq!(empty.expectancy_r_difference, None);
}

#[test]
fn after_two_losses_never_mixes_accounts() {
    // Account 2 loses twice on day 3 afternoon, then trades on day 4 at noon.
    let mut extra = vec![
        trade(21, Long, "100", Some("90"), "1", Some("90"), 3, 13 * 60, 14 * 60),
        trade(22, Long, "100", Some("90"), "1", Some("90"), 3, 15 * 60, 16 * 60),
        trade(23, Long, "100", Some("110"), "1", Some("90"), 4, 12 * 60, 13 * 60),
    ];
    for t in &mut extra {
        t.account_id = 2;
    }
    let mut l = ledger("10000", journal_f().into_iter().chain(extra).collect());
    l.accounts.push(AccountCapital { id: 2, initial_capital: dec("10000") });
    let r = after_losses(&l, &all(), &defaults()).unwrap();
    // Trade 5 (account 1, entered day 4 09:00) follows 4 W / 3 L of its own account: still not.
    // Exit order: 23 closes on day 4, before 7.
    assert_eq!(r.after_two_losses.trade_ids, [3, 4, 23, 7, 8, 11]);
    assert!(r.others.trade_ids.contains(&5));
}

// --- Size change after a loss -----------------------------------------------------------

fn changes(g: &SizeChangeGroup) -> Vec<(i64, i64, f64)> {
    g.cases.iter().map(|c| (c.trade_id, c.previous_trade_id, c.change)).collect()
}

#[test]
fn size_change_on_journal_f() {
    // Risk 10 × size everywhere: only 7 (size 2 after 6) and 8 (size 1 after 7) move.
    let r = size_change(&ledger("10000", journal_f()), &all(), &defaults()).unwrap();
    assert_eq!((r.trade_count, r.no_previous_count, r.min_case_count), (13, 1, 5));
    assert_eq!(
        changes(&r.after_loss),
        [(2, 1, 0.0), (3, 2, 0.0), (4, 3, 0.0), (6, 5, 0.0), (7, 6, 1.0), (8, 7, -0.5), (10, 9, 0.0), (11, 10, 0.0)]
    );
    assert!(r.after_loss.cases.iter().all(|c| c.basis == ExposureBasis::Risk));
    // Mean (1 − 0.5) / 8; median of [−0.5, 0 ×6, 1] = 0.
    approx(r.after_loss.mean_change, 0.0625);
    approx(r.after_loss.median_change, 0.0);
    assert_eq!((r.after_loss.increased_count, r.after_loss.not_comparable_count), (1, 0));
    // After a win: 5, 12, 13 — three cases, below the minimum.
    assert_eq!(changes(&r.after_win), [(5, 4, 0.0), (12, 11, 0.0), (13, 12, 0.0)]);
    assert_eq!((r.after_win.mean_change, r.after_win.median_change, r.loss_vs_win), (None, None, None));
    assert_eq!(changes(&r.after_breakeven), [(9, 8, 0.0)]);
    assert_eq!(r.after_breakeven.previous_outcome, Outcome::Breakeven);
}

/// Journal G — one long a day at 100, SL 90, alternating win (exit 110) and loss (exit 90).
///
/// | #  | outcome | size | previous | change              |
/// |----|---------|------|----------|---------------------|
/// | 1  | W       | 1    | —        |                     |
/// | 2  | L       | 1    | 1 W      | 0                   |
/// | 3  | W       | 2    | 2 L      | 2 / 1 − 1 = 1       |
/// | 4  | L       | 2    | 3 W      | 0                   |
/// | 5  | W       | 3    | 4 L      | 3 / 2 − 1 = 0.5     |
/// | 6  | L       | 3    | 5 W      | 0                   |
/// | 7  | W       | 3    | 6 L      | 0                   |
/// | 8  | L       | 1.5  | 7 W      | 1.5 / 3 − 1 = −0.5  |
/// | 9  | W       | 3    | 8 L      | 3 / 1.5 − 1 = 1     |
/// | 10 | L       | 3    | 9 W      | 0                   |
/// | 11 | W       | 6    | 10 L     | 6 / 3 − 1 = 1       |
/// | 12 | L       | 6    | 11 W     | 0                   |
#[test]
fn size_grows_after_losses_in_journal_g() {
    let sizes = ["1", "1", "2", "2", "3", "3", "3", "1.5", "3", "3", "6", "6"];
    let trades = sizes
        .iter()
        .enumerate()
        .map(|(i, size)| {
            let exit = if i % 2 == 0 { "110" } else { "90" };
            trade(i as i64 + 1, Long, "100", Some(exit), size, Some("90"), i as i64, 9 * 60, 10 * 60)
        })
        .collect();
    let r = size_change(&ledger("100000", trades), &all(), &defaults()).unwrap();
    // After a loss: [1, 0.5, 0, 1, 1] → mean 3.5 / 5 = 0.7, median 1, 4 increases.
    assert_eq!(changes(&r.after_loss).iter().map(|c| c.0).collect::<Vec<_>>(), [3, 5, 7, 9, 11]);
    approx(r.after_loss.mean_change, 0.7);
    approx(r.after_loss.median_change, 1.0);
    assert_eq!(r.after_loss.increased_count, 4);
    // After a win: [0, 0, 0, −0.5, 0, 0] → mean −0.5 / 6, median 0.
    approx(r.after_win.mean_change, -0.5 / 6.0);
    approx(r.after_win.median_change, 0.0);
    approx(r.loss_vs_win, 0.7 + 0.5 / 6.0);
    assert_eq!((r.after_breakeven.case_count, r.after_breakeven.mean_change), (0, None));
}

#[test]
fn size_change_compares_sizes_without_a_stop_and_never_across_accounts() {
    // 1: instrument 1, SL, size 2, loss. 2: same instrument, no SL, size 3: 3 / 2 − 1 on size × multiplier.
    // 3: instrument 2, no SL: not comparable with 2. Account 2 loses with size 100 between 1 and 2.
    let mut t = vec![
        trade(1, Long, "100", Some("90"), "2", Some("90"), 0, 9 * 60, 10 * 60),
        trade(2, Long, "100", Some("95"), "3", None, 1, 9 * 60, 10 * 60),
        trade(3, Long, "100", Some("110"), "1", None, 2, 9 * 60, 10 * 60),
        trade(4, Long, "100", Some("50"), "100", Some("90"), 0, 12 * 60, 13 * 60),
    ];
    t[2].instrument_id = 2;
    t[3].account_id = 2;
    let mut l = ledger("10000", t);
    l.accounts.push(AccountCapital { id: 2, initial_capital: dec("10000") });
    let r = size_change(&l, &all(), &defaults()).unwrap();
    assert_eq!(changes(&r.after_loss), [(2, 1, 0.5)]);
    assert_eq!(r.after_loss.cases[0].basis, ExposureBasis::Size);
    assert_eq!((r.after_loss.not_comparable_count, r.no_previous_count), (1, 2), "trades 1 and 4 open their accounts");

    let empty = size_change(&ledger("10000", vec![]), &all(), &defaults()).unwrap();
    assert_eq!((empty.trade_count, empty.no_previous_count, empty.after_loss.case_count), (0, 0, 0));
    assert_eq!((empty.after_loss.mean_change, empty.loss_vs_win), (None, None));
}

// --- Plan simulation -------------------------------------------------------------------

#[test]
fn plan_simulation_on_journal_d() {
    use super::tests::journal_d;
    // Journal D in exit order: 1 yes +100 (R 2), 2 partial −150 (R −1), 3 no +80 (R 0.8),
    // 4 yes −50 (R −2.5), 5 undeclared −100 (R −2.5), 6 yes 0 (no R); 7 is open.
    let r = plan_simulation(&ledger("10000", journal_d()), &all()).unwrap();
    assert_eq!(r.declared_trade_count, 5);
    // Actual: −120; 2 wins of 6; R (2 − 1 + 0.8 − 2.5 − 2.5) / 5; PF 180 / 300;
    // cumulative 100, −50, 30, −20, −120, −120 → drawdown 100 − (−120) = 220.
    let a = &r.actual;
    assert_eq!((a.trade_count, a.net_pnl, a.max_drawdown), (6, dec("-120"), dec("220")));
    approx(a.win_rate, 2.0 / 6.0);
    approx(a.expectancy_r, -0.64);
    approx(a.profit_factor, 0.6);

    // Without 3 (off plan): −200, i.e. 80 less; kept 1, 2, 4, 5, 6.
    let s = &r.without_off_plan;
    assert_eq!((s.excluded_trade_ids.clone(), s.excluded_net_pnl, s.difference), (vec![3], dec("80"), Some(dec("-80"))));
    // 1 win of 5; R (2 − 1 − 2.5 − 2.5) / 4 = −1; PF 100 / 300; cumulative 100, −50, −100, −200, −200 → 300.
    assert_eq!((s.result.trade_count, s.result.net_pnl, s.result.max_drawdown), (5, dec("-200"), dec("300")));
    approx(s.result.win_rate, 0.2);
    approx(s.result.expectancy_r, -1.0);
    approx(s.result.profit_factor, 1.0 / 3.0);

    // Without 2 and 3: −50, i.e. 70 more; kept 1, 4, 5, 6: 1 win of 4; R (2 − 2.5 − 2.5) / 3 = −1;
    // PF 100 / 150; cumulative 100, 50, −50, −50 → 150. Trade 5 (undeclared) is kept.
    let p = &r.without_off_plan_or_partial;
    assert_eq!((p.excluded_trade_ids.clone(), p.excluded_net_pnl, p.difference), (vec![2, 3], dec("-70"), Some(dec("70"))));
    assert_eq!((p.result.net_pnl, p.result.max_drawdown, p.result.r_trade_count), (dec("-50"), dec("150"), 3));
    approx(p.result.win_rate, 0.25);
    approx(p.result.expectancy_r, -1.0);
    approx(p.result.profit_factor, 2.0 / 3.0);
}

#[test]
fn plan_simulation_without_declared_plans_or_trades() {
    // Journal F declares no plan: nothing to simulate.
    let r = plan_simulation(&ledger("10000", journal_f()), &all()).unwrap();
    assert_eq!((r.declared_trade_count, r.without_off_plan.difference, r.without_off_plan.excluded_trade_count), (0, None, 0));
    assert_eq!(r.without_off_plan.result.net_pnl, r.actual.net_pnl);

    // Plans declared, none off plan: a real 0.
    let mut t = journal_f();
    t[0].journal.plan_followed = Some(PlanFollowed::Yes);
    let r = plan_simulation(&ledger("10000", t), &all()).unwrap();
    assert_eq!((r.without_off_plan.difference, r.without_off_plan_or_partial.difference), (Some(Decimal::ZERO), Some(Decimal::ZERO)));

    let empty = plan_simulation(&ledger("10000", vec![]), &all()).unwrap();
    assert_eq!((empty.actual.trade_count, empty.actual.win_rate, empty.without_off_plan.difference), (0, None, None));
}

#[test]
fn plan_simulation_follows_the_selection_of_two_accounts() {
    // Account 2 has one off-plan loss of 40; selecting only account 1's trades (via the
    // ledger) or both changes the result, never mixing balances.
    let mut t = journal_f();
    t[3].journal.plan_followed = Some(PlanFollowed::No); // trade 4, +30
    let mut other = trade(30, Long, "100", Some("60"), "1", Some("90"), 2, 12 * 60, 13 * 60);
    other.account_id = 2;
    other.journal.plan_followed = Some(PlanFollowed::No);
    t.push(other);
    let mut l = ledger("10000", t);
    l.accounts.push(AccountCapital { id: 2, initial_capital: dec("10000") });
    let r = plan_simulation(&l, &all()).unwrap();
    // Journal F totals −30; with trade 30: −70. Removing 4 (+30) and 30 (−40): +10 better.
    assert_eq!((r.actual.net_pnl, r.without_off_plan.excluded_net_pnl, r.without_off_plan.difference), (dec("-70"), dec("-10"), Some(dec("10"))));
    assert_eq!(r.without_off_plan.excluded_trade_ids, [30, 4]);
    // A period filter applies to the simulation like to any report: from day 3, trade 30 is out.
    let q = StatsQuery { from: Some(SEP_1 + 3 * DAY), ..StatsQuery::default() };
    let r = plan_simulation(&l, &q).unwrap();
    assert_eq!((r.without_off_plan.excluded_trade_ids.clone(), r.without_off_plan.difference), (vec![4], Some(dec("-30"))));
}

#[test]
fn plan_simulation_on_journal_h() {
    // Off plan: days 0, 1, 3 (−10 each). Actual: −25 (days 0–4) + 45 (days 5–9) + 0 + 5 = 25.
    let r = plan_simulation(&ledger("10000", journal_h().0), &all()).unwrap();
    assert_eq!((r.declared_trade_count, r.actual.net_pnl), (10, dec("25")));
    let s = &r.without_off_plan;
    assert_eq!((s.excluded_trade_ids.clone(), s.result.net_pnl, s.difference), (vec![1, 2, 4], dec("55"), Some(dec("30"))));
    // Kept: 9 trades, 6 wins; no partial plan, so both scenarios agree.
    approx(s.result.win_rate, 6.0 / 9.0);
    assert_eq!(r.without_off_plan_or_partial, r.without_off_plan);
}
