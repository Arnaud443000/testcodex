//! Known-result tests of the voluntary pause (lot 35). Every expected value is computed by hand
//! in the comments. The pause is a reminder: nothing here can refuse a trade.

use super::*;
use crate::accounts;
use crate::behavior::tests::{all, approx, ledger, trade};
use crate::behavior::Verdict;
use crate::db;
use crate::stats::TradeFacts;
use crate::test_support::{account, dec, instrument};
use crate::trades::{Direction, PlanFollowed};

const T0: i64 = 1_800_000_000_000; // an arbitrary instant
const DAY: i64 = 86_400_000;
const SEP_1: i64 = 20_697 * DAY;

fn minutes(n: u32) -> NewPause {
    NewPause { length: PauseLength::Minutes { minutes: n }, reason: None, note: None, tz_offset_min: 0 }
}

fn utc(y: i64, m: u32, d: u32, hh: i64, mm: i64) -> i64 {
    time::days_from_civil(y, m, d).unwrap() * DAY + hh * 3_600_000 + mm * MIN_MS
}

fn raw(id: i64, started: i64, planned: i64, ended: Option<i64>) -> Pause {
    Pause { id, started_at: started, planned_end_at: planned, ended_at: ended, tz_offset_min: 0, reason: None, note: None }
}

// --- Durations --------------------------------------------------------------------------

#[test]
fn a_pause_lasts_from_1_to_480_minutes_and_a_refusal_writes_nothing() {
    let conn = db::open_in_memory().unwrap();
    for bad in [0, 481, 10_000] {
        assert!(matches!(start(&conn, &minutes(bad), T0), Err(CoreError::Invalid(_))), "{bad} minutes");
    }
    let n: i64 = conn.query_row("SELECT COUNT(*) FROM pauses", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 0);
    let one = start(&conn, &minutes(1), T0).unwrap();
    assert_eq!(one.planned_end_at - one.started_at, MIN_MS);
    let max = start(&conn, &minutes(480), T0 + DAY).unwrap();
    assert_eq!(max.planned_end_at - max.started_at, 480 * MIN_MS);
    // The schema itself refuses an inverted pause (last-resort guard).
    assert!(conn.execute("INSERT INTO pauses (started_at, planned_end_at, tz_offset_min) VALUES (10, 10, 0)", []).is_err());
    assert!(conn.execute("INSERT INTO pauses (started_at, planned_end_at, ended_at, tz_offset_min) VALUES (10, 20, 5, 0)", []).is_err());
}

#[test]
fn reason_and_note_are_checked_and_trimmed() {
    let conn = db::open_in_memory().unwrap();
    let ok = NewPause { reason: Some("emotion".into()), note: Some("  Je respire.  ".into()), ..minutes(15) };
    let p = start(&conn, &ok, T0).unwrap();
    assert_eq!((p.reason.as_deref(), p.note.as_deref()), (Some("emotion"), Some("Je respire.")));
    let blank = NewPause { reason: Some("  ".into()), note: Some("   ".into()), ..minutes(15) };
    let p = start(&conn, &blank, T0 + MIN_MS).unwrap();
    assert_eq!((p.reason, p.note), (None, None));
    for bad in [
        NewPause { reason: Some("punishment".into()), ..minutes(15) },
        NewPause { note: Some("é".repeat(141)), ..minutes(15) },
        NewPause { note: Some("deux\nlignes".into()), ..minutes(15) },
        NewPause { tz_offset_min: 900, ..minutes(15) },
    ] {
        assert!(matches!(start(&conn, &bad, T0 + 2 * MIN_MS), Err(CoreError::Invalid(_))), "{bad:?}");
    }
    let edge = NewPause { note: Some("é".repeat(140)), ..minutes(15) };
    assert!(start(&conn, &edge, T0 + 3 * MIN_MS).is_ok(), "140 characters fit, counted as characters");
}

// --- End of a pause ---------------------------------------------------------------------

#[test]
fn a_pause_ends_by_itself_at_the_minute_and_the_end_is_excluded() {
    let conn = db::open_in_memory().unwrap();
    let p = start(&conn, &minutes(30), T0).unwrap();
    assert_eq!(current(&conn, T0 - 1).unwrap(), None, "not started yet");
    let c = current(&conn, T0).unwrap().unwrap();
    assert_eq!((c.remaining_ms, c.remaining_min), (30 * MIN_MS, 30));
    let c = current(&conn, T0 + 10 * MIN_MS + 1).unwrap().unwrap();
    assert_eq!(c.remaining_min, 20, "rounded up: 19 min 59.999 s left shows 20");
    let c = current(&conn, p.planned_end_at - 1).unwrap().unwrap();
    assert_eq!((c.remaining_ms, c.remaining_min), (1, 1));
    assert_eq!(current(&conn, p.planned_end_at).unwrap(), None, "[start ; end): exactly at the end it is over");
    // Nothing was written by reading: the row is untouched.
    let ended: Option<i64> = conn.query_row("SELECT ended_at FROM pauses", [], |r| r.get(0)).unwrap();
    assert_eq!(ended, None);
    let rows = list(&conn, &[], 10, p.planned_end_at + 5 * MIN_MS).unwrap();
    assert_eq!((rows[0].status, rows[0].planned_ms, rows[0].actual_ms), (PauseStatus::Completed, 30 * MIN_MS, 30 * MIN_MS));
}

#[test]
fn a_pause_survives_a_restart() {
    let dir = tempfile::tempdir().unwrap();
    {
        let conn = db::open(dir.path()).unwrap();
        start(&conn, &NewPause { reason: Some("loss".into()), ..minutes(60) }, T0).unwrap();
    } // the application quits
    let conn = db::open(dir.path()).unwrap(); // and starts again 20 minutes later
    let c = current(&conn, T0 + 20 * MIN_MS).unwrap().unwrap();
    assert_eq!((c.remaining_min, c.pause.reason.as_deref()), (40, Some("loss")));
    assert_eq!(current(&conn, T0 + 61 * MIN_MS).unwrap(), None, "restarted after the end: over");
}

#[test]
fn ending_early_writes_the_real_end_and_is_idempotent() {
    let conn = db::open_in_memory().unwrap();
    start(&conn, &minutes(60), T0).unwrap();
    let ended = end(&conn, T0 + 10 * MIN_MS).unwrap().unwrap();
    assert_eq!(ended.ended_at, Some(T0 + 10 * MIN_MS));
    assert_eq!(current(&conn, T0 + 11 * MIN_MS).unwrap(), None);
    assert_eq!(end(&conn, T0 + 12 * MIN_MS).unwrap(), None, "already over: not an error");
    let row = &list(&conn, &[], 10, T0 + DAY).unwrap()[0];
    assert_eq!((row.status, row.planned_ms, row.actual_ms), (PauseStatus::EndedEarly, 60 * MIN_MS, 10 * MIN_MS));
    // An end that arrives after the planned end changes nothing.
    start(&conn, &minutes(5), T0 + DAY).unwrap();
    assert_eq!(end(&conn, T0 + DAY + 6 * MIN_MS).unwrap(), None);
}

#[test]
fn an_inconsistent_clock_is_refused() {
    let conn = db::open_in_memory().unwrap();
    start(&conn, &minutes(60), T0).unwrap();
    // "Now" is before the start of the running pause: refuse to start or end anything.
    assert!(matches!(end(&conn, T0 - MIN_MS), Err(CoreError::Invalid(_))));
    assert!(matches!(start(&conn, &minutes(10), T0 - MIN_MS), Err(CoreError::Invalid(_))));
    assert!(current(&conn, T0).unwrap().is_some(), "the pause is untouched");
}

#[test]
fn starting_another_pause_replaces_the_running_one() {
    let conn = db::open_in_memory().unwrap();
    let a = start(&conn, &minutes(60), T0).unwrap();
    let b = start(&conn, &minutes(15), T0 + 10 * MIN_MS).unwrap();
    let rows = list(&conn, &[], 10, T0 + 11 * MIN_MS).unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!((rows[0].pause.id, rows[0].status), (b.id, PauseStatus::Running));
    assert_eq!((rows[1].pause.id, rows[1].pause.ended_at, rows[1].status), (a.id, Some(T0 + 10 * MIN_MS), PauseStatus::EndedEarly));
    assert_eq!(current(&conn, T0 + 11 * MIN_MS).unwrap().unwrap().pause.id, b.id, "only one at a time");
    let running: i64 = conn.query_row("SELECT COUNT(*) FROM pauses WHERE ended_at IS NULL AND planned_end_at > ?1", [T0 + 11 * MIN_MS], |r| r.get(0)).unwrap();
    assert_eq!(running, 1);
    // A pause that had already ended by itself is left as it was (no invented early end).
    let c = start(&conn, &minutes(5), T0 + DAY).unwrap();
    let after = start(&conn, &minutes(5), T0 + DAY + 30 * MIN_MS).unwrap();
    assert!(after.id > c.id);
    let ended: Option<i64> = conn.query_row("SELECT ended_at FROM pauses WHERE id = ?1", [c.id], |r| r.get(0)).unwrap();
    assert_eq!(ended, None);
}

// --- « Jusqu'à demain matin » -----------------------------------------------------------

#[test]
fn until_tomorrow_is_the_next_local_midnight_for_the_given_offset() {
    let tomorrow = |tz| NewPause { length: PauseLength::UntilTomorrow, tz_offset_min: tz, ..minutes(1) };
    // Paris in summer (+120): 2026-09-01 22:30 UTC is 00:30 on 2 Sept, so it ends 00:00 on 3 Sept = 22:00 UTC on 2 Sept.
    let p = start(&db::open_in_memory().unwrap(), &tomorrow(120), utc(2026, 9, 1, 22, 30)).unwrap();
    assert_eq!(p.planned_end_at, utc(2026, 9, 2, 22, 0));
    // New York in summer (−240): 2026-09-01 03:00 UTC is 23:00 on 31 Aug, so it ends 00:00 on 1 Sept = 04:00 UTC.
    let p = start(&db::open_in_memory().unwrap(), &tomorrow(-240), utc(2026, 9, 1, 3, 0)).unwrap();
    assert_eq!(p.planned_end_at, utc(2026, 9, 1, 4, 0));
    // Exactly local midnight: the next one is a full day later, never "now".
    let p = start(&db::open_in_memory().unwrap(), &tomorrow(0), utc(2026, 9, 5, 0, 0)).unwrap();
    assert_eq!(p.planned_end_at, utc(2026, 9, 6, 0, 0));
    // One minute before midnight: a 1-minute pause (allowed for this choice only).
    let p = start(&db::open_in_memory().unwrap(), &tomorrow(0), utc(2026, 9, 7, 23, 59)).unwrap();
    assert_eq!(p.planned_end_at - p.started_at, MIN_MS);
}

#[test]
fn until_tomorrow_follows_the_clock_change_and_keeps_its_instant() {
    let conn = db::open_in_memory().unwrap();
    let tomorrow = |tz| NewPause { length: PauseLength::UntilTomorrow, tz_offset_min: tz, ..minutes(1) };
    // Paris goes back one hour on 25 Oct 2026 (03:00 → 02:00). Evening of the 24th at +120: ends 00:00 local = 22:00 UTC.
    let before = start(&conn, &tomorrow(120), utc(2026, 10, 24, 20, 0)).unwrap();
    assert_eq!(before.planned_end_at, utc(2026, 10, 24, 22, 0));
    // The 25th at noon, offset now +60: ends 00:00 local on the 26th = 23:00 UTC on the 25th (a 25-hour day).
    let after = start(&conn, &tomorrow(60), utc(2026, 10, 25, 12, 0)).unwrap();
    assert_eq!(after.planned_end_at, utc(2026, 10, 25, 23, 0));
    // Only instants are stored: the offset that is later in force changes nothing for the first one.
    assert_eq!(list(&conn, &[], 10, utc(2026, 10, 25, 12, 0)).unwrap()[1].pause.planned_end_at, utc(2026, 10, 24, 22, 0));
}

// --- Settings ---------------------------------------------------------------------------

#[test]
fn settings_default_off_round_trip_and_bounds() {
    let conn = db::open_in_memory().unwrap();
    assert_eq!(settings(&conn).unwrap(), Settings { suggest_after_losses: None, default_minutes: 30 });
    let custom = Settings { suggest_after_losses: Some(3), default_minutes: 45 };
    assert_eq!(set_settings(&conn, &custom).unwrap(), custom);
    assert_eq!(set_settings(&conn, &Settings { suggest_after_losses: None, ..custom }).unwrap().suggest_after_losses, None);
    // `off` written by hand is read as off.
    conn.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('pause.suggest_after_losses', 'off')", []).unwrap();
    assert_eq!(settings(&conn).unwrap().suggest_after_losses, None);
    for bad in [
        Settings { suggest_after_losses: Some(1), ..custom },
        Settings { suggest_after_losses: Some(11), ..custom },
        Settings { default_minutes: 0, ..custom },
        Settings { default_minutes: 481, ..custom },
    ] {
        assert!(matches!(set_settings(&conn, &bad), Err(CoreError::Invalid(_))), "{bad:?}");
    }
    assert_eq!(settings(&conn).unwrap().default_minutes, 45, "nothing was written by the refusals");
}

// --- Suggestion -------------------------------------------------------------------------

#[test]
fn a_pause_is_only_proposed_from_the_losses_in_a_row_of_today() {
    // Day 0: loss, loss, loss (closed at 10:00, 11:00, 12:00); day 1: gain then loss.
    let l = |id: i64, day: i64, hh: i64| trade(id, Direction::Long, "100", Some("90"), "1", Some("90"), day, hh * 60 - 60, hh * 60);
    let win = trade(4, Direction::Long, "100", Some("110"), "1", Some("90"), 1, 8 * 60, 9 * 60);
    let led = ledger("10000", vec![l(1, 0, 10), l(2, 0, 11), l(3, 0, 12), win, l(5, 1, 11)]);
    let at = |day: i64, hh: i64| SEP_1 + day * DAY + hh * 3_600_000;
    let sug = |now, threshold| suggestion(&led, now, 0, threshold).unwrap();
    assert_eq!(sug(at(0, 13), Some(3)), Some(Suggestion { account_id: 1, losses: 3, threshold: 3 }));
    assert_eq!(sug(at(0, 13), Some(4)), None, "3 losses, threshold 4");
    assert_eq!(sug(at(0, 13), None), None, "off: never");
    assert_eq!(sug(at(0, 11) + 30 * MIN_MS, Some(3)), None, "at 11:30 only two losses had closed");
    assert_eq!(sug(at(1, 12), Some(2)), None, "the losses of yesterday do not count; today: gain then loss = 1");
    assert_eq!(sug(at(1, 12), Some(3)), None);
}

// --- Report: trades taken during a pause ------------------------------------------------

/// A long at 100 with a stop at 90 (risk 10, R = PnL / 10), entered on day `day` at 09:00 and
/// closed at 10:00, with the given exit price and plan.
fn taken(id: i64, day: i64, exit: &str, plan: PlanFollowed) -> TradeFacts {
    let mut t = trade(id, Direction::Long, "100", Some(exit), "1", Some("90"), day, 9 * 60, 10 * 60);
    t.journal.plan_followed = Some(plan);
    t
}

fn entry(t: &TradeFacts) -> i64 {
    t.entry_time
}

#[test]
fn the_pause_interval_is_closed_at_the_start_and_open_at_the_end() {
    use PlanFollowed::Yes;
    let t: Vec<TradeFacts> = (1..=8).map(|i| taken(i, i - 1, "110", Yes)).collect();
    let pauses = [
        // t1: entry exactly at the start → during.
        raw(1, entry(&t[0]), entry(&t[0]) + 30 * MIN_MS, None),
        // t2: the pause ends exactly at the entry → outside.
        raw(2, entry(&t[1]) - 30 * MIN_MS, entry(&t[1]), None),
        // t3: one millisecond after the start, one before the end → during.
        raw(3, entry(&t[2]) - 1, entry(&t[2]) + 1, None),
        // t4: the pause starts one millisecond after the entry (trade entered just before) → outside.
        raw(4, entry(&t[3]) + 1, entry(&t[3]) + 30 * MIN_MS, None),
        // t5: ended early, before the entry, although planned later → outside.
        raw(5, entry(&t[4]) - 20 * MIN_MS, entry(&t[4]) + 20 * MIN_MS, Some(entry(&t[4]) - 5 * MIN_MS)),
        // t6: ended early, after the entry → during.
        raw(6, entry(&t[5]) - 20 * MIN_MS, entry(&t[5]) + 20 * MIN_MS, Some(entry(&t[5]) + 5 * MIN_MS)),
        // t7: entered right after the real end = the planned end → outside. t8 has no pause.
        raw(7, entry(&t[6]) - 30 * MIN_MS, entry(&t[6]) - 1, None),
    ];
    let r = pause_report(&ledger("10000", t), &all(), &BehaviorSettings::default(), &pauses).unwrap();
    assert_eq!(r.during.trade_ids, vec![1, 3, 6]);
    assert_eq!(r.others.trade_ids, vec![2, 4, 5, 7, 8]);
    assert_eq!((r.trade_count, r.pause_count), (8, 7));
    approx(r.share_during, 3.0 / 8.0);
    // A trade typed after the fact keeps its real entry instant: it only matches a pause that
    // contained that instant (the ledger has no "typed at" time, and nothing else is used).
    assert!(!pauses[3].contains(entry(&taken(9, 3, "110", Yes))));
}

/// Journal P — ten trades, one per day, long 100 → exit with a stop at 90 (risk 10).
/// Default settings: no revenge (23 h between trades), no limit: a trade scores
/// (stop 10 + behavior 10 [+ plan 30 if followed]) / (20 or 50) = 100 with the plan followed, 40 without it.
///
/// | group  | trades            | exits               | net                  | R                      | plan |
/// |--------|-------------------|---------------------|----------------------|------------------------|------|
/// | during | 5 (ids 1–5)       | 90 90 95 110 90     | −10 −10 −5 +10 −10   | −1 −1 −0.5 +1 −1       | no   |
/// | others | 5 (ids 6–10)      | 110 115 100 120 105 | +10 +15 0 +20 +5     | 1 1.5 0 2 0.5          | yes  |
///
/// during: net −25, mean −5, expectancy −0.5 R, discipline 40. others: net +50, mean +10, 1.0 R, 100.
/// Gaps: −15 money, −1.5 R (lower: ≤ −0.25), −60 points (lower: ≤ −10).
fn journal_p() -> (Vec<TradeFacts>, Vec<Pause>) {
    let exits = ["90", "90", "95", "110", "90", "110", "115", "100", "120", "105"];
    let t: Vec<TradeFacts> = exits
        .iter()
        .enumerate()
        .map(|(i, x)| taken(i as i64 + 1, i as i64, x, if i < 5 { PlanFollowed::No } else { PlanFollowed::Yes }))
        .collect();
    let pauses = t[..5].iter().enumerate().map(|(i, tr)| raw(i as i64 + 1, entry(tr) - MIN_MS, entry(tr) + 30 * MIN_MS, None)).collect();
    (t, pauses)
}

#[test]
fn five_trades_per_group_give_a_cautious_comparison() {
    let (t, pauses) = journal_p();
    let r = pause_report(&ledger("10000", t), &all(), &BehaviorSettings::default(), &pauses).unwrap();
    assert_eq!((r.during.summary.trade_count, r.others.summary.trade_count, r.trade_count), (5, 5, 10));
    assert!(!r.sample_too_small);
    approx(r.share_during, 0.5);
    assert_eq!(r.during.summary.net_pnl, dec("-25"));
    assert_eq!(r.others.summary.net_pnl, dec("50"));
    assert_eq!(r.avg_net_pnl_difference, Some(dec("-15")));
    approx(r.expectancy_r.present, -0.5);
    approx(r.expectancy_r.absent, 1.0);
    approx(r.expectancy_r.difference, -1.5);
    assert_eq!(r.expectancy_r.verdict, Verdict::Lower);
    approx(r.discipline.present, 40.0);
    approx(r.discipline.absent, 100.0);
    approx(r.discipline.difference, -60.0);
    assert_eq!(r.discipline.verdict, Verdict::Lower);
}

#[test]
fn four_trades_in_a_group_quote_no_comparison() {
    let (t, mut pauses) = journal_p();
    pauses.pop(); // trade 5 is no longer during a pause: 4 during, 6 others
    let r = pause_report(&ledger("10000", t), &all(), &BehaviorSettings::default(), &pauses).unwrap();
    assert_eq!((r.during.summary.trade_count, r.others.summary.trade_count), (4, 6));
    assert!(r.sample_too_small);
    assert_eq!(r.min_trade_count, 5);
    approx(r.share_during, 0.4); // the count and the share are still given
    assert_eq!(r.avg_net_pnl_difference, None);
    assert_eq!((r.expectancy_r.verdict, r.expectancy_r.difference), (Verdict::NotEnoughData, None));
    assert_eq!((r.discipline.verdict, r.discipline.difference), (Verdict::NotEnoughData, None));
    assert_eq!(r.discipline.present, None, "under 5 scored trades the mean itself is hidden");
}

#[test]
fn similar_results_are_reported_as_similar() {
    let (mut t, pauses) = journal_p();
    // Same plan and exits on both sides: no gap at all.
    for (i, tr) in t.iter_mut().enumerate() {
        tr.journal.plan_followed = Some(PlanFollowed::Yes);
        tr.position.exit_price = Some(dec(["110", "95", "100", "115", "105"][i % 5]));
    }
    let r = pause_report(&ledger("10000", t), &all(), &BehaviorSettings::default(), &pauses).unwrap();
    assert_eq!((r.expectancy_r.verdict, r.discipline.verdict), (Verdict::Similar, Verdict::Similar));
    approx(r.expectancy_r.difference, 0.0);
    assert_eq!(r.avg_net_pnl_difference, Some(dec("0")));
}

#[test]
fn without_any_pause_nothing_is_during() {
    let (t, _) = journal_p();
    let r = pause_report(&ledger("10000", t), &all(), &BehaviorSettings::default(), &[]).unwrap();
    assert_eq!((r.pause_count, r.during.summary.trade_count, r.others.summary.trade_count), (0, 0, 10));
    approx(r.share_during, 0.0);
    assert!(r.sample_too_small);
    assert_eq!(r.avg_net_pnl_difference, None);
    // No trade at all: no share either.
    let empty = pause_report(&ledger("10000", vec![]), &all(), &BehaviorSettings::default(), &[]).unwrap();
    assert_eq!((empty.trade_count, empty.share_during), (0, None));
}

#[test]
fn two_pauses_both_count_and_the_period_limits_trades_and_pauses() {
    let (t, pauses) = journal_p();
    // Keep only pauses 1 and 4 (trades 1 and 4).
    let two = vec![pauses[0].clone(), pauses[3].clone()];
    let led = ledger("10000", t);
    let r = pause_report(&led, &all(), &BehaviorSettings::default(), &two).unwrap();
    assert_eq!((r.pause_count, r.during.trade_ids.clone()), (2, vec![1, 4]));
    // The period is the usual one: trades closed in [from ; to). Days 0–3 → trades 1–4, pauses started in it: 1 and 4.
    let q = StatsQuery { from: Some(SEP_1), to: Some(SEP_1 + 4 * DAY), ..StatsQuery::default() };
    let r = pause_report(&led, &q, &BehaviorSettings::default(), &two).unwrap();
    assert_eq!((r.trade_count, r.pause_count, r.during.trade_ids.clone()), (4, 2, vec![1, 4]));
    let q = StatsQuery { from: Some(SEP_1 + DAY), to: Some(SEP_1 + 3 * DAY), ..StatsQuery::default() };
    let r = pause_report(&led, &q, &BehaviorSettings::default(), &two).unwrap();
    assert_eq!((r.trade_count, r.pause_count, r.during.trade_ids.clone()), (2, 0, vec![]));
}

// --- Through SQLite ---------------------------------------------------------------------

#[test]
fn report_and_list_read_the_database() {
    let conn = db::open_in_memory().unwrap();
    let acc = account(&conn, "10000");
    let ins = instrument(&conn, "EURUSD", "100000");
    let entry_at = T0 + 10 * MIN_MS;
    let mut data = crate::trades::TradeData::new(acc, ins, Direction::Long, dec("1"), dec("1.1000"), entry_at);
    data.exit_price = Some(dec("1.1100"));
    data.exit_time = Some(entry_at + 30 * MIN_MS);
    crate::trades::create(&conn, &data).unwrap();
    // Open trade entered during the pause counts in the list, not in the closed-trade report.
    let open = crate::trades::TradeData::new(acc, ins, Direction::Long, dec("1"), dec("1.1000"), entry_at + 5 * MIN_MS);
    crate::trades::create(&conn, &open).unwrap();
    start(&conn, &minutes(60), T0).unwrap();
    let rows = list(&conn, &[], 10, T0 + 20 * MIN_MS).unwrap();
    assert_eq!((rows[0].trade_count, rows[0].status), (2, PauseStatus::Running));
    assert_eq!(list(&conn, &[acc], 10, T0).unwrap()[0].trade_count, 2);
    assert_eq!(list(&conn, &[acc + 99], 10, T0).unwrap()[0].trade_count, 0);
    let r = report(&conn, &StatsQuery::default()).unwrap();
    assert_eq!((r.trade_count, r.during.summary.trade_count, r.pause_count), (1, 1, 1));
    // Mixed currencies do not break the list of pauses.
    accounts::create(&conn, &accounts::NewAccount { name: "EUR".into(), kind: "personal".into(), broker: String::new(), currency: "EUR".into(), initial_capital: dec("1") }).unwrap();
    assert!(list(&conn, &[], 10, T0).is_ok());
    // Suggestion through SQLite: off by default, never while a pause runs.
    assert_eq!(suggestion_report(&conn, &[acc], T0, 0).unwrap(), None);
}

#[test]
fn a_pause_never_blocks_a_trade() {
    // The pause is a reminder: a trade can always be created while one runs.
    let conn = db::open_in_memory().unwrap();
    let acc = account(&conn, "10000");
    let ins = instrument(&conn, "EURUSD", "100000");
    start(&conn, &minutes(60), T0).unwrap();
    let data = crate::trades::TradeData::new(acc, ins, Direction::Long, dec("1"), dec("1.1000"), T0 + MIN_MS);
    assert!(crate::trades::create(&conn, &data).is_ok());
}
