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
