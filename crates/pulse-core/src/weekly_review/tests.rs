//! Weekly review: journals computed by hand. Unless stated otherwise the account starts at 10 000 USD, the
//! instrument has a multiplier of 1, trades are long, entered at 100 with a size of 1, a stop at 90
//! (risk 10, so +1 is +0.1 R) and closed at 101 (+1) one hour after their entry. Week 38 of 2026 is
//! Monday 14 → Sunday 20 September; "past" is 30 September, "during" is Wednesday 16 September 12:00.

use super::*;
use crate::accounts::{self, NewAccount};
use crate::analysis::ideas::{IdeaInput, IdeaOutcome};
use crate::coach::tools::{self, TOOL_NAMES, ToolScope};
use crate::db;
use crate::journal::JournalEntry;
use crate::pause::{NewPause, PauseLength};
use crate::process_goals::{NewProcessGoal, ProcessMetric, Status};
use crate::tags::{self, TagKind};
use crate::test_support::{account, dec, instrument};
use crate::trades::{self, Direction as Dir, TradeData};
use serde_json::json;

const H: i64 = 3_600_000;
const MIN: i64 = 60_000;
const DAY_MS: i64 = 86_400_000;
const W38: &str = "2026-W38";

fn atm(y: i64, m: u32, d: u32, hour: i64, minute: i64) -> i64 {
    time::days_from_civil(y, m, d).unwrap() * DAY_MS + hour * H + minute * MIN
}

fn at(y: i64, m: u32, d: u32, hour: i64) -> i64 {
    atm(y, m, d, hour, 0)
}

fn past() -> i64 {
    at(2026, 9, 30, 12)
}

fn during() -> i64 {
    at(2026, 9, 16, 12)
}

struct Book {
    conn: Connection,
    a: i64,
    i: i64,
}

fn book() -> Book {
    let conn = db::open_in_memory().unwrap();
    let a = account(&conn, "10000");
    let i = instrument(&conn, "EURUSD", "1");
    Book { conn, a, i }
}

impl Book {
    fn data(&self, entry: i64, exit: &str, sl: Option<&str>) -> TradeData {
        let mut t = TradeData::new(self.a, self.i, Dir::Long, dec("1"), dec("100"), entry);
        t.multiplier = Some(dec("1"));
        t.planned_sl = sl.map(dec);
        t.exit_price = Some(dec(exit));
        t.exit_time = Some(entry + H);
        t
    }

    fn put(&self, t: TradeData) -> i64 {
        trades::create(&self.conn, &t).unwrap().id
    }

    /// A plain trade: entered at `entry`, stop at 90, +1.
    fn trade(&self, entry: i64) -> i64 {
        self.put(self.data(entry, "101", Some("90")))
    }

    /// A plain trade that closes at `exit` exactly.
    fn closing_at(&self, exit: i64) -> i64 {
        self.trade(exit - H)
    }

    /// A losing trade of `loss` (stop at 90 is only a stop: the exit is wherever the loss is).
    fn losing(&self, entry: i64, loss: i64, tag: Option<i64>) -> i64 {
        let mut t = self.data(entry, &(100 - loss).to_string(), Some("90"));
        t.tag_ids = tag.into_iter().collect();
        self.put(t)
    }

    fn query(&self, key: &str, now: i64) -> ReviewQuery {
        ReviewQuery { account_ids: vec![], period_key: key.into(), now_ms: now, tz_offset_min: 0, boundary_offsets: BTreeMap::new() }
    }

    fn facts(&self, key: &str, now: i64) -> Facts {
        facts(&self.conn, &self.query(key, now)).unwrap().0
    }

    fn view(&self, key: &str, now: i64) -> WeeklyReviewView {
        get(&self.conn, &self.query(key, now)).unwrap()
    }

    fn goal(&self, key: &str, metric: ProcessMetric, target: &str) {
        process_goals::set(
            &self.conn,
            &NewProcessGoal { period_kind: PeriodKind::Week, period_key: key.into(), metric, target: dec(target) },
        )
        .unwrap();
    }

    fn journal(&self, day: &str) {
        let e = JournalEntry {
            day: day.into(),
            mood: Some(3),
            sleep_quality: None,
            fatigue: None,
            late_hours: false,
            went_well: String::new(),
            to_improve: String::new(),
            notes: String::new(),
        };
        journal::save(&self.conn, &e).unwrap();
    }

    fn input(&self, key: &str, intentions: &[&str]) -> ReviewInput {
        ReviewInput {
            period_key: key.into(),
            answers: Answers::default(),
            intentions: intentions.iter().map(|s| s.to_string()).collect(),
        }
    }

    /// A review of `key` whose intentions got these outcomes (saved long after, so never "future").
    fn seed(&self, key: &str, outcomes: &[Option<IntentionOutcome>]) -> WeeklyReview {
        let texts: Vec<String> = (1..=outcomes.len()).map(|n| format!("Intention {n} de {key}")).collect();
        let input = ReviewInput { period_key: key.into(), answers: Answers::default(), intentions: texts };
        let saved = save(&self.conn, &input, at(2027, 6, 1, 12), 0).unwrap();
        for (intention, outcome) in saved.intentions.iter().zip(outcomes) {
            set_intention_outcome(&self.conn, intention.id, *outcome, at(2027, 6, 1, 12)).unwrap();
        }
        review_of(&self.conn, key).unwrap().unwrap()
    }
}

fn approx(a: f64, b: f64) {
    assert!((a - b).abs() < 1e-9, "{a} != {b}");
}

fn is_review_error(e: CoreError, code: &str) -> bool {
    matches!(e, CoreError::Invalid(m) if m == format!("review:{code}"))
}

fn count(conn: &Connection, table: &str) -> i64 {
    conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0)).unwrap()
}

// --- Facts ----------------------------------------------------------------------------------

#[test]
fn a_week_without_any_trade_has_no_value_and_says_why_but_zero_counts_are_real() {
    let b = book();
    let f = b.facts(W38, past());
    assert_eq!(f.closed_trade_count, 0, "a count of 0 is a real count");
    assert_eq!((f.net_pnl.value, f.net_pnl.reason), (None, Some(Reason::NoClosedTrade)));
    assert_eq!((f.win_rate.value, f.win_rate.reason), (None, Some(Reason::NoClosedTrade)));
    assert_eq!((f.expectancy_r.value, f.expectancy_r.reason), (None, Some(Reason::NoClosedTrade)));
    assert_eq!((f.discipline.value, f.discipline.reason), (None, Some(Reason::NoClosedTrade)));
    assert_eq!((f.goals.value, f.goals.reason), (None, Some(Reason::NoGoals)));
    assert_eq!((f.costly_mistake.value, f.costly_mistake.reason), (None, Some(Reason::NoMistake)));
    assert_eq!((f.pause_count, f.trades_during_pause, f.ideas_closed, f.journal_days), (0, 0, 0, 0));
    assert_eq!((f.ideas_to_review.value, f.ideas_to_review.reason), (None, Some(Reason::OnlyCurrentWeek)), "past week");
    assert_eq!(f.ideas_to_review, b.facts(W38, at(2026, 9, 21, 9)).ideas_to_review, "the day after the week: still the past");
    assert_eq!(b.facts(W38, during()).ideas_to_review.value, Some(0), "the running week: a real 0");
    // The week ahead has nothing either, and nothing else breaks.
    let ahead = b.view("2026-W45", past());
    assert_eq!(ahead.period.state, PeriodState::Future);
    assert_eq!(ahead.facts.closed_trade_count, 0);
}

#[test]
fn four_trades_give_a_result_but_no_discipline_score() {
    // Four trades of +1 (stop 90, risk 10 → +0.1 R each), on Tuesday 15 September.
    let b = book();
    for h in [9, 11, 13, 15] {
        b.trade(at(2026, 9, 15, h));
    }
    let f = b.facts(W38, past());
    assert_eq!(f.closed_trade_count, 4);
    assert_eq!(f.net_pnl.value, Some(dec("4")));
    approx(f.win_rate.value.unwrap(), 1.0);
    approx(f.expectancy_r.value.unwrap(), 0.1);
    assert_eq!(f.r_trade_count, 4);
    // Below 5 trades the score of the period is undefined: not 100, not 0.
    assert_eq!((f.discipline.value, f.discipline.reason), (None, Some(Reason::NotEnoughTrades)));
    assert_eq!((f.scored_trade_count, f.min_scored_trade_count), (4, 5));
}

#[test]
fn five_trades_give_the_mean_discipline_score_and_no_r_without_a_stop() {
    // Four trades with a stop score 100 (stop 10 + behaviour 10 out of 20: the other components have no
    // data and are excluded); the fifth has no stop: (0 + 10) / 20 = 50. Mean = (4 × 100 + 50) / 5 = 90.
    let b = book();
    for h in [9, 11, 13, 15] {
        b.trade(at(2026, 9, 15, h));
    }
    b.put(b.data(at(2026, 9, 16, 9), "101", None));
    let f = b.facts(W38, past());
    assert_eq!(f.closed_trade_count, 5);
    assert_eq!(f.net_pnl.value, Some(dec("5")));
    approx(f.discipline.value.unwrap(), 90.0);
    assert_eq!((f.scored_trade_count, f.r_trade_count), (5, 4), "the trade without a stop has no R");
    approx(f.expectancy_r.value.unwrap(), 0.1);
}

#[test]
fn trades_with_no_stop_at_all_have_a_result_but_no_r() {
    let b = book();
    b.put(b.data(at(2026, 9, 15, 9), "101", None));
    let f = b.facts(W38, past());
    assert_eq!(f.net_pnl.value, Some(dec("1")));
    assert_eq!((f.expectancy_r.value, f.expectancy_r.reason), (None, Some(Reason::NoRTrade)));
    assert_eq!(f.r_trade_count, 0);
}

#[test]
fn deposits_and_withdrawals_are_never_performance() {
    let b = book();
    b.trade(at(2026, 9, 15, 9));
    crate::cash_flows::create(
        &b.conn,
        &crate::cash_flows::NewCashFlow {
            account_id: b.a,
            kind: crate::cash_flows::CashFlowKind::Deposit,
            amount: dec("5000"),
            occurred_at: at(2026, 9, 16, 9),
            tz_offset_min: 0,
            note: String::new(),
        },
    )
    .unwrap();
    assert_eq!(b.facts(W38, past()).net_pnl.value, Some(dec("1")));
}

#[test]
fn an_account_in_another_currency_is_refused_like_everywhere_else() {
    let b = book();
    b.trade(at(2026, 9, 15, 9));
    accounts::create(
        &b.conn,
        &NewAccount { name: "Euro".into(), kind: "personal".into(), broker: String::new(), currency: "EUR".into(), initial_capital: dec("1000") },
    )
    .unwrap();
    let err = get(&b.conn, &b.query(W38, past())).unwrap_err();
    assert!(err.to_string().contains("different currencies"), "{err}");
    // Choosing one account works.
    let mut q = b.query(W38, past());
    q.account_ids = vec![b.a];
    assert_eq!(get(&b.conn, &q).unwrap().facts.closed_trade_count, 1);
}

// --- The week: ISO bounds and daylight-saving time -------------------------------------------

#[test]
fn week_53_of_2026_and_week_1_of_2027_split_at_midnight_of_monday_4_january() {
    // 2026-W53: Monday 28 December 2026 → Sunday 3 January 2027. 2027-W01: Monday 4 January.
    let b = book();
    b.closing_at(at(2026, 12, 27, 23) + 59 * MIN); // Sunday 27 December 23:59: week 52
    b.closing_at(at(2026, 12, 28, 0)); //            Monday 28 December 00:00 exactly: week 53
    b.closing_at(at(2027, 1, 3, 23) + 59 * MIN); //  Sunday 3 January 23:59: week 53
    b.closing_at(at(2027, 1, 4, 0)); //              Monday 4 January 00:00 exactly: 2027 week 1
    let now = at(2027, 2, 1, 12);
    let counts: Vec<usize> = ["2026-W52", "2026-W53", "2027-W01"].iter().map(|k| b.facts(k, now).closed_trade_count).collect();
    assert_eq!(counts, [1, 2, 1]);
    let w53 = b.view("2026-W53", now).period;
    assert_eq!((w53.first_day.as_str(), w53.last_day.as_str()), ("2026-12-28", "2027-01-03"));
    assert_eq!((w53.previous_key.as_str(), w53.next_key.as_str()), ("2026-W52", "2027-W01"));
    assert_eq!((w53.to - w53.from) / DAY_MS, 7);
    assert_eq!(w53.state, PeriodState::Past);
}

#[test]
fn week_1_of_2026_starts_on_monday_29_december_2025() {
    let b = book();
    b.closing_at(at(2025, 12, 28, 23) + 59 * MIN); // Sunday: 2025 week 52
    b.closing_at(at(2025, 12, 29, 0)); //             Monday 00:00: 2026 week 1
    b.closing_at(at(2026, 1, 4, 23) + 59 * MIN); //   Sunday 4 January: 2026 week 1
    b.closing_at(at(2026, 1, 5, 0)); //               Monday 5 January: 2026 week 2
    let now = at(2026, 2, 1, 12);
    let counts: Vec<usize> = ["2025-W52", "2026-W01", "2026-W02"].iter().map(|k| b.facts(k, now).closed_trade_count).collect();
    assert_eq!(counts, [1, 2, 1]);
    let w01 = b.view("2026-W01", now).period;
    assert_eq!((w01.first_day.as_str(), w01.last_day.as_str(), w01.previous_key.as_str()), ("2025-12-29", "2026-01-04", "2025-W52"));
    assert!(get(&b.conn, &b.query("2025-W53", now)).is_err(), "2025 has no week 53");
    assert!(get(&b.conn, &b.query("2026-W00", now)).is_err());
    assert!(get(&b.conn, &b.query("2026-38", now)).is_err());
}

#[test]
fn the_week_of_the_clock_change_is_one_hour_longer_and_its_bounds_use_each_days_offset() {
    // Paris: UTC+2 until Sunday 25 October 2026 03:00, UTC+1 after. Week 43 = Monday 19 → Sunday 25 October.
    // Local Monday 00:00 is 18 October 22:00 UTC (+2); the next Monday 00:00 is 25 October 23:00 UTC (+1).
    let b = book();
    b.closing_at(atm(2026, 10, 18, 22, 30)); // Monday 19 October 00:30 local: in the week
    b.closing_at(at(2026, 10, 21, 9));
    b.closing_at(atm(2026, 10, 25, 22, 59)); // Sunday 25 October 23:59 local (+1): in the week
    b.closing_at(at(2026, 10, 25, 23)); //      Monday 26 October 00:00 local: next week
    let now = at(2026, 10, 27, 9);
    let mut q = b.query("2026-W43", now);
    q.tz_offset_min = 60; // the offset now
    q.boundary_offsets = BTreeMap::from([("2026-10-19".to_string(), 120)]);
    let with = get(&b.conn, &q).unwrap();
    assert_eq!(with.facts.closed_trade_count, 3);
    assert_eq!((with.period.to - with.period.from) / H, 169, "7 days and 1 hour");
    assert_eq!(with.period.from, atm(2026, 10, 18, 22, 0));
    assert_eq!(with.period.to, at(2026, 10, 25, 23));
    // Without the offset of that Monday the first trade falls out of the week: why the interface sends it.
    q.boundary_offsets.clear();
    assert_eq!(get(&b.conn, &q).unwrap().facts.closed_trade_count, 2);
    // The next week starts where this one ends.
    let mut next = b.query("2026-W44", now);
    next.tz_offset_min = 60;
    assert_eq!(get(&b.conn, &next).unwrap().facts.closed_trade_count, 1);
    // Impossible offsets are refused.
    q.tz_offset_min = 24 * 60;
    assert!(get(&b.conn, &q).is_err());
    q.tz_offset_min = 60;
    q.boundary_offsets = BTreeMap::from([("2026-10-19".to_string(), 99_999)]);
    assert!(get(&b.conn, &q).is_err());
}

// --- Behaviour goals, pauses, ideas, mistakes, journal ----------------------------------------

#[test]
fn the_goals_of_the_week_are_the_process_goals_statuses_as_they_are() {
    let b = book();
    for h in [9, 11, 13, 15] {
        b.trade(at(2026, 9, 15, h));
    }
    b.put(b.data(at(2026, 9, 16, 9), "101", None)); // no stop
    b.journal("2026-09-15");
    b.goal(W38, ProcessMetric::NoStopTrades, "0"); //       1 trade without a stop > 0
    b.goal(W38, ProcessMetric::RevengeTrades, "0"); //      0 revenge trades
    b.goal(W38, ProcessMetric::JournalDays, "2"); //        1 journal day < 2
    b.goal(W38, ProcessMetric::OvertradingDays, "1"); //    the daily limit is not set
    b.goal(W38, ProcessMetric::RulesRespectRate, "90"); //  no rule ticked

    let statuses = |now: i64| -> Vec<(ProcessMetric, Status)> {
        let f = b.facts(W38, now);
        let direct = process_goals::progress(
            &b.conn,
            &ProgressQuery {
                account_ids: vec![],
                period_kind: PeriodKind::Week,
                period_key: W38.into(),
                now_ms: now,
                tz_offset_min: 0,
                boundary_offsets: BTreeMap::new(),
            },
        )
        .unwrap()
        .goals;
        assert_eq!(f.goals.value.as_ref().unwrap(), &direct, "exactly what process_goals says");
        direct.iter().map(|g| (g.goal.metric, g.status)).collect()
    };
    let of = |list: &[(ProcessMetric, Status)], m: ProcessMetric| list.iter().find(|(k, _)| *k == m).unwrap().1;

    let over = statuses(past());
    assert_eq!(of(&over, ProcessMetric::NoStopTrades), Status::Exceeded);
    assert_eq!(of(&over, ProcessMetric::RevengeTrades), Status::Respected);
    assert_eq!(of(&over, ProcessMetric::JournalDays), Status::Missed);
    assert_eq!(of(&over, ProcessMetric::OvertradingDays), Status::SettingRequired);
    assert_eq!(of(&over, ProcessMetric::RulesRespectRate), Status::NoData);

    let running = statuses(during());
    assert_eq!(of(&running, ProcessMetric::NoStopTrades), Status::Exceeded, "crossed is final, even in the week");
    assert_eq!(of(&running, ProcessMetric::RevengeTrades), Status::RespectedSoFar);
    assert_eq!(of(&running, ProcessMetric::JournalDays), Status::InProgress);

    b.journal("2026-09-16");
    assert_eq!(of(&statuses(past()), ProcessMetric::JournalDays), Status::Reached, "2 days = the target exactly");
}

#[test]
fn pauses_started_in_the_week_and_trades_entered_during_one_are_counted() {
    let b = book();
    // A pause of the week before, and one of the week: 10:00 → 11:00 on Wednesday 16 September.
    let n = |minutes| NewPause { length: PauseLength::Minutes { minutes }, reason: None, note: None, tz_offset_min: 0 };
    pause::start(&b.conn, &n(60), at(2026, 9, 10, 10)).unwrap();
    pause::start(&b.conn, &n(60), at(2026, 9, 16, 10)).unwrap();
    b.trade(atm(2026, 9, 16, 9, 59)); // before
    b.trade(atm(2026, 9, 16, 10, 30)); // during
    b.trade(at(2026, 9, 16, 11)); //     exactly at the planned end: not during
    let f = b.facts(W38, past());
    assert_eq!((f.pause_count, f.trades_during_pause, f.closed_trade_count), (1, 1, 3));
    // The week before has the other pause and no trade.
    let before = b.facts("2026-W37", past());
    assert_eq!((before.pause_count, before.trades_during_pause), (1, 0));
}

#[test]
fn ideas_closed_in_the_week_are_counted_and_the_ones_to_review_only_for_the_running_week() {
    let b = book();
    let idea = |note: &str, created: i64| {
        ideas::create(&b.conn, &IdeaInput { instrument_id: b.i, timeframes: vec![], note: note.into(), level_low: None, level_high: None, invalidation: None }, created)
            .unwrap()
            .id
    };
    let old = idea("ancienne", at(2026, 9, 1, 9)); //  16 days before the 17th: to review (7 days or more)
    let recent = idea("récente", at(2026, 9, 15, 9)); // 1 day: not to review
    let closed_in = idea("clôturée dans la semaine", at(2026, 9, 2, 9));
    let closed_out = idea("clôturée après", at(2026, 9, 3, 9));
    ideas::close(&b.conn, closed_in, IdeaOutcome::Worked, None, at(2026, 9, 17, 9)).unwrap();
    ideas::close(&b.conn, closed_out, IdeaOutcome::Invalidated, None, at(2026, 9, 22, 9)).unwrap();
    let _ = (old, recent);
    let f = b.facts(W38, at(2026, 9, 18, 12));
    assert_eq!(f.ideas_closed, 1, "only the one closed in the week");
    assert_eq!(f.ideas_to_review.value, Some(1), "the old one only (the recent one is a day old)");
    assert_eq!(b.facts(W38, past()).ideas_to_review.reason, Some(Reason::OnlyCurrentWeek));
}

#[test]
fn the_costliest_mistake_needs_three_trades_and_a_real_cost() {
    let mistake = |b: &Book, name: &str| tags::create(&b.conn, TagKind::Mistake, name).unwrap().id;

    // 1. A tag on three losing trades: −10, −20, −30 → cost 60.
    let b = book();
    let fomo = mistake(&b, "FOMO");
    for (h, loss) in [(9, 10), (11, 20), (13, 30)] {
        b.losing(at(2026, 9, 15, h), loss, Some(fomo));
    }
    b.trade(at(2026, 9, 16, 9)); // a winner without any mistake
    let m = b.facts(W38, past()).costly_mistake.value.unwrap();
    assert_eq!((m.label.as_str(), m.trade_count, m.source), ("FOMO", 3, MistakeSource::Tag));
    assert_eq!((m.cost, m.id, m.trade_ids.len()), (dec("60"), fomo, 3));

    // 2. Another mistake costs more (2 × 50 = 100) but on two trades only: the first of the ranking by cost
    //    is the one that would be quoted, and it is not quoted below 3 trades: no fallback to the second.
    let slip = mistake(&b, "Glissement");
    b.losing(at(2026, 9, 17, 9), 50, Some(slip)); // exit at 50: −50
    b.losing(at(2026, 9, 17, 11), 50, Some(slip)); // and another −50
    let f = b.facts(W38, past());
    assert_eq!((f.costly_mistake.value, f.costly_mistake.reason), (None, Some(Reason::NotEnoughMistakeTrades)));

    // 3. Winning trades carrying a tag cost nothing.
    let b = book();
    let calm = mistake(&b, "Trop tôt");
    for h in [9, 11, 13] {
        let mut t = b.data(at(2026, 9, 15, h), "101", Some("90"));
        t.tag_ids = vec![calm];
        b.put(t);
    }
    assert_eq!(b.facts(W38, past()).costly_mistake.reason, Some(Reason::NoMistakeCost));

    // 4. Two trades only.
    let b = book();
    let two = mistake(&b, "Deux fois");
    b.losing(at(2026, 9, 15, 9), 10, Some(two));
    b.losing(at(2026, 9, 15, 11), 10, Some(two));
    assert_eq!(b.facts(W38, past()).costly_mistake.reason, Some(Reason::NotEnoughMistakeTrades));
}

#[test]
fn journal_days_are_the_filled_days_of_the_week_only() {
    let b = book();
    for day in ["2026-09-13", "2026-09-14", "2026-09-15", "2026-09-20", "2026-09-21"] {
        b.journal(day);
    }
    // A blank entry is never stored: it does not count.
    journal::save(
        &b.conn,
        &JournalEntry {
            day: "2026-09-16".into(),
            mood: None,
            sleep_quality: None,
            fatigue: None,
            late_hours: false,
            went_well: "  ".into(),
            to_improve: String::new(),
            notes: String::new(),
        },
    )
    .unwrap();
    assert_eq!(b.facts(W38, past()).journal_days, 3, "Monday 14, Tuesday 15 and Sunday 20; not the 13th nor the 21st");
}

// --- The review: save, draft, complete, delete ------------------------------------------------

fn sunday() -> i64 {
    at(2026, 9, 20, 19)
}

#[test]
fn an_entirely_empty_review_is_refused_and_leaves_nothing() {
    let b = book();
    for input in [
        ReviewInput { period_key: W38.into(), answers: Answers::default(), intentions: vec![] },
        ReviewInput { period_key: W38.into(), answers: Answers { went_well: "   \n ".into(), ..Answers::default() }, intentions: vec!["  ".into(), "".into()] },
    ] {
        assert!(is_review_error(save(&b.conn, &input, sunday(), 0).unwrap_err(), "empty"));
    }
    assert_eq!((count(&b.conn, "weekly_reviews"), count(&b.conn, "weekly_intentions")), (0, 0));
    assert!(review_of(&b.conn, W38).unwrap().is_none());
    // Emptying a saved review is refused too: it stays as it was (delete removes it).
    let mut input = b.input(W38, &["Un stop à chaque trade"]);
    save(&b.conn, &input, sunday(), 0).unwrap();
    input.intentions.clear();
    assert!(is_review_error(save(&b.conn, &input, sunday(), 0).unwrap_err(), "empty"));
    assert_eq!(review_of(&b.conn, W38).unwrap().unwrap().intentions.len(), 1);
}

#[test]
fn a_review_is_a_draft_then_done_and_stays_done_when_edited() {
    let b = book();
    let mut input = ReviewInput {
        period_key: W38.into(),
        answers: Answers { went_well: "  Mes stops  ".into(), ..Answers::default() },
        intentions: vec![],
    };
    let draft = save(&b.conn, &input, sunday(), 0).unwrap();
    assert_eq!((draft.state, draft.completed_at), (ReviewState::Draft, None));
    assert_eq!(draft.answers.went_well, "Mes stops", "trimmed");
    assert_eq!((draft.created_at, draft.updated_at), (sunday(), sunday()));
    assert_eq!((draft.first_day.as_str(), draft.last_day.as_str()), ("2026-09-14", "2026-09-20"));

    let done = complete(&b.conn, W38, sunday() + H).unwrap();
    assert_eq!((done.state, done.completed_at), (ReviewState::Done, Some(sunday() + H)));
    // Completing again keeps the first instant.
    assert_eq!(complete(&b.conn, W38, sunday() + 2 * H).unwrap().completed_at, Some(sunday() + H));

    input.answers.do_differently = "Moins de trades".into();
    let edited = save(&b.conn, &input, sunday() + 3 * H, 0).unwrap();
    assert_eq!((edited.state, edited.completed_at), (ReviewState::Done, Some(sunday() + H)));
    assert_eq!((edited.created_at, edited.updated_at), (sunday(), sunday() + 3 * H));
    assert_eq!(edited.answers.do_differently, "Moins de trades");
    assert_eq!(count(&b.conn, "weekly_reviews"), 1, "one row per week");

    assert!(matches!(complete(&b.conn, "2026-W10", sunday()).unwrap_err(), CoreError::NotFound(_)), "nothing to complete");
}

#[test]
fn answers_and_intentions_are_cleaned_and_bounded() {
    let b = book();
    // 0 to 3 intentions, empty ones dropped, whitespace collapsed, positions 1..n.
    let saved = save(&b.conn, &b.input(W38, &["", " Pas de   revanche ", "", "Journal chaque soir"]), sunday(), 0).unwrap();
    let texts: Vec<(u8, &str)> = saved.intentions.iter().map(|i| (i.position, i.text.as_str())).collect();
    assert_eq!(texts, [(1, "Pas de revanche"), (2, "Journal chaque soir")]);

    let too_many = b.input("2026-W37", &["a", "b", "c", "d"]);
    assert!(is_review_error(save(&b.conn, &too_many, sunday(), 0).unwrap_err(), "tooManyIntentions"));
    let long = "x".repeat(MAX_INTENTION_CHARS + 1);
    assert!(is_review_error(save(&b.conn, &b.input("2026-W37", &[&long]), sunday(), 0).unwrap_err(), "intentionTooLong"));
    let exact = "é".repeat(MAX_INTENTION_CHARS); // counted in characters, not bytes
    assert_eq!(save(&b.conn, &b.input("2026-W37", &[&exact]), sunday(), 0).unwrap().intentions[0].text.chars().count(), MAX_INTENTION_CHARS);
    let long_answer = Answers { next_priority: "y".repeat(MAX_ANSWER_CHARS + 1), ..Answers::default() };
    let input = ReviewInput { period_key: "2026-W36".into(), answers: long_answer, intentions: vec![] };
    assert!(is_review_error(save(&b.conn, &input, sunday(), 0).unwrap_err(), "answerTooLong"));
    assert!(review_of(&b.conn, "2026-W36").unwrap().is_none(), "a refusal writes nothing");
    // Another week key, or a week that has not begun.
    assert!(save(&b.conn, &b.input("2026-W99", &["a"]), sunday(), 0).is_err());
    assert!(is_review_error(save(&b.conn, &b.input("2026-W39", &["a"]), sunday(), 0).unwrap_err(), "future"));
    assert!(save(&b.conn, &b.input("2026-W39", &["a"]), at(2026, 9, 21, 0), 0).is_ok(), "Monday 00:00 starts week 39");
    // The local day decides: Sunday 23:30 UTC is already Monday in Paris (+2).
    assert!(save(&b.conn, &b.input("2026-W40", &["a"]), atm(2026, 9, 27, 23, 30), 120).is_ok());
    assert!(save(&b.conn, &b.input("2026-W41", &["a"]), atm(2026, 10, 4, 23, 30), -120).is_err());
}

#[test]
fn saving_again_keeps_the_follow_up_of_an_unchanged_intention_and_resets_a_changed_one() {
    let b = book();
    let first = save(&b.conn, &b.input(W38, &["Stops", "Journal", "Pauses"]), sunday(), 0).unwrap();
    for (i, o) in first.intentions.iter().zip([IntentionOutcome::Kept, IntentionOutcome::Partly, IntentionOutcome::NotKept]) {
        set_intention_outcome(&b.conn, i.id, Some(o), sunday()).unwrap();
    }
    // 1 unchanged, 2 reworded, 3 removed.
    let second = save(&b.conn, &b.input(W38, &["Stops", "Journal le soir"]), sunday() + H, 0).unwrap();
    let got: Vec<(&str, Option<IntentionOutcome>)> = second.intentions.iter().map(|i| (i.text.as_str(), i.outcome)).collect();
    assert_eq!(got, [("Stops", Some(IntentionOutcome::Kept)), ("Journal le soir", None)]);
    assert_eq!(second.intentions[0].id, first.intentions[0].id, "same row");
    assert_eq!(count(&b.conn, "weekly_intentions"), 2);
}

#[test]
fn deleting_a_review_deletes_its_intentions_and_only_its_own() {
    let b = book();
    save(&b.conn, &b.input(W38, &["a", "b"]), sunday(), 0).unwrap();
    save(&b.conn, &b.input("2026-W37", &["c"]), sunday(), 0).unwrap();
    assert_eq!(count(&b.conn, "weekly_intentions"), 3);
    assert!(delete(&b.conn, W38).unwrap());
    assert_eq!((count(&b.conn, "weekly_reviews"), count(&b.conn, "weekly_intentions")), (1, 1));
    assert!(!delete(&b.conn, W38).unwrap(), "already gone is not an error");
    assert!(review_of(&b.conn, "2026-W37").unwrap().is_some());
}

#[test]
fn reviews_are_listed_most_recent_week_first() {
    let b = book();
    for key in ["2026-W36", "2026-W38", "2026-W37"] {
        save(&b.conn, &b.input(key, &["x"]), sunday(), 0).unwrap();
    }
    let keys: Vec<String> = list(&b.conn, 10).unwrap().into_iter().map(|r| r.period_key).collect();
    assert_eq!(keys, ["2026-W38", "2026-W37", "2026-W36"]);
    assert_eq!(list(&b.conn, 2).unwrap().len(), 2);
}

// --- The intention loop ------------------------------------------------------------------------

#[test]
fn the_review_of_a_week_shows_the_intentions_set_the_week_before_and_their_follow_up() {
    let b = book();
    let w37 = save(&b.conn, &b.input("2026-W37", &["Un stop à chaque trade", "Pas de revanche"]), at(2026, 9, 13, 19), 0).unwrap();
    let view = b.view(W38, sunday());
    let last = view.last_week.unwrap();
    assert_eq!((last.period_key.as_str(), last.first_day.as_str(), last.last_day.as_str()), ("2026-W37", "2026-09-07", "2026-09-13"));
    let outcomes: Vec<Option<IntentionOutcome>> = last.intentions.iter().map(|i| i.outcome).collect();
    assert_eq!(outcomes, [None, None], "not evaluated until the trader says");
    assert!(view.review.is_none());

    // Tenue / En partie / Pas tenue, and « Je ne sais pas » puts it back to not evaluated.
    let (a, c) = (w37.intentions[0].id, w37.intentions[1].id);
    assert_eq!(set_intention_outcome(&b.conn, a, Some(IntentionOutcome::Kept), sunday()).unwrap().outcome, Some(IntentionOutcome::Kept));
    set_intention_outcome(&b.conn, c, Some(IntentionOutcome::NotKept), sunday()).unwrap();
    let again: Vec<Option<IntentionOutcome>> = b.view(W38, sunday()).last_week.unwrap().intentions.iter().map(|i| i.outcome).collect();
    assert_eq!(again, [Some(IntentionOutcome::Kept), Some(IntentionOutcome::NotKept)]);
    assert_eq!(set_intention_outcome(&b.conn, c, None, sunday()).unwrap().outcome, None);
    let at_set: Option<i64> = b.conn.query_row("SELECT outcome_at FROM weekly_intentions WHERE id = ?1", [c], |r| r.get(0)).unwrap();
    assert_eq!(at_set, None);
    assert!(matches!(set_intention_outcome(&b.conn, 9999, Some(IntentionOutcome::Kept), sunday()).unwrap_err(), CoreError::NotFound(_)));

    // Nothing before the first review, and answers alone are not intentions.
    assert!(b.view("2026-W37", sunday()).last_week.is_none());
    let only_answers = ReviewInput { period_key: "2026-W39".into(), answers: Answers { went_well: "x".into(), ..Answers::default() }, intentions: vec![] };
    save(&b.conn, &only_answers, at(2026, 9, 27, 19), 0).unwrap();
    assert!(b.view("2026-W40", at(2026, 10, 4, 19)).last_week.is_none());
}

#[test]
fn the_streak_counts_consecutive_weeks_with_a_kept_intention_and_is_broken_by_anything_else() {
    use IntentionOutcome::{Kept, NotKept, Partly};
    let b = book();
    // Three weeks in a row with at least one intention kept (the kept one is not always the first).
    b.seed("2026-W35", &[Some(NotKept), Some(Kept)]);
    b.seed("2026-W36", &[Some(Kept)]);
    b.seed("2026-W37", &[Some(Partly), Some(Kept), None]);
    assert_eq!(b.view(W38, sunday()).streak, 3, "3 weeks in a row");
    assert_eq!(b.view("2026-W37", sunday()).streak, 2, "the week itself is not counted");
    assert_eq!(b.view("2026-W35", sunday()).streak, 0);

    // Broken: a week not evaluated, a week with nothing kept, a week with no review.
    b.seed("2026-W38", &[None, None]);
    assert_eq!(b.view("2026-W39", sunday()).streak, 0, "last week was not evaluated");
    assert_eq!(b.view("2026-W40", sunday()).streak, 0, "a week without any review");
    let w38 = review_of(&b.conn, W38).unwrap().unwrap();
    set_intention_outcome(&b.conn, w38.intentions[0].id, Some(Partly), sunday()).unwrap();
    assert_eq!(b.view("2026-W39", sunday()).streak, 0, "partly is not kept");
    set_intention_outcome(&b.conn, w38.intentions[1].id, Some(Kept), sunday()).unwrap();
    assert_eq!(b.view("2026-W39", sunday()).streak, 4);
    // A hole in the middle: the streak stops there.
    delete(&b.conn, "2026-W36").unwrap();
    assert_eq!(b.view("2026-W39", sunday()).streak, 2);
}

#[test]
fn the_streak_never_exceeds_52() {
    let b = book();
    let mut p = Period::parse(PeriodKind::Week, "2026-W38").unwrap().previous();
    for _ in 0..60 {
        b.conn.execute("INSERT INTO weekly_reviews (period_key, created_at, updated_at) VALUES (?1, 0, 0)", [&p.key]).unwrap();
        let id = b.conn.last_insert_rowid();
        b.conn.execute("INSERT INTO weekly_intentions (review_id, position, body, outcome) VALUES (?1, 1, 'x', 'kept')", [id]).unwrap();
        p = p.previous();
    }
    assert_eq!(b.view(W38, sunday()).streak, MAX_STREAK);
}

// --- Status of the running week (widget) -----------------------------------------------------

#[test]
fn the_status_says_todo_draft_or_done_and_which_intentions_are_in_force() {
    let b = book();
    let wednesday = during();
    let s = status(&b.conn, wednesday, 0).unwrap();
    assert_eq!((s.period_key.as_str(), s.state, s.intentions.len(), s.intentions_from.clone()), (W38, ReviewState::Todo, 0, None));
    assert_eq!((s.first_day.as_str(), s.last_day.as_str()), ("2026-09-14", "2026-09-20"));

    // Intentions of last week's review are the ones in force.
    save(&b.conn, &b.input("2026-W37", &["Stops"]), at(2026, 9, 13, 19), 0).unwrap();
    let s = status(&b.conn, wednesday, 0).unwrap();
    assert_eq!((s.state, s.intentions_from.as_deref(), s.intentions.len()), (ReviewState::Todo, Some("2026-W37"), 1));

    // A draft of this week with its own intentions (for the week to come) takes over; without any, no.
    let draft = save(&b.conn, &b.input(W38, &["Journal"]), wednesday, 0).unwrap();
    let s = status(&b.conn, wednesday, 0).unwrap();
    assert_eq!((s.state, s.intentions_from.as_deref(), s.intentions[0].text.as_str()), (ReviewState::Draft, Some(W38), "Journal"));
    complete(&b.conn, W38, wednesday).unwrap();
    assert_eq!(status(&b.conn, wednesday, 0).unwrap().state, ReviewState::Done);
    let _ = draft;
    // The local day decides which week is running.
    assert_eq!(status(&b.conn, atm(2026, 9, 20, 23, 30), 120).unwrap().period_key, "2026-W39");
}

// --- Sunday reminder ---------------------------------------------------------------------------

fn sunday_at(hour: i64, minute: i64) -> i64 {
    atm(2026, 9, 20, hour, minute)
}

fn check(b: &Book, now: i64) -> Option<Due> {
    reminder_check(&b.conn, now, 0, &BTreeMap::new()).unwrap()
}

fn active_week(b: &Book) {
    b.trade(at(2026, 9, 15, 9));
}

#[test]
fn the_reminder_fires_at_exactly_18_00_on_sunday_and_not_a_minute_before() {
    let b = book();
    active_week(&b);
    assert_eq!(check(&b, sunday_at(17, 59)), None, "17:59");
    assert_eq!(check(&b, sunday_at(18, 0) - 1), None, "17:59:59.999");
    assert_eq!(
        check(&b, sunday_at(18, 0)),
        Some(Due { period_key: W38.into(), closed_trade_count: 1, journal_days: 0 }),
        "18:00 on the dot"
    );
    assert!(check(&b, sunday_at(23, 59)).is_some(), "and after, until it was sent");
    // The local time decides, not UTC: 16:00 UTC is 18:00 in Paris (+2), 15:59 is not.
    assert!(reminder_check(&b.conn, sunday_at(16, 0), 120, &BTreeMap::new()).unwrap().is_some());
    assert!(reminder_check(&b.conn, sunday_at(15, 59), 120, &BTreeMap::new()).unwrap().is_none());
}

#[test]
fn the_reminder_is_for_sunday_only_and_once_a_week() {
    let b = book();
    active_week(&b);
    for (d, label) in [(14, "Monday"), (15, "Tuesday"), (16, "Wednesday"), (17, "Thursday"), (18, "Friday"), (19, "Saturday")] {
        assert_eq!(check(&b, atm(2026, 9, d, 19, 0)), None, "{label}");
    }
    let due = check(&b, sunday_at(18, 0)).unwrap();
    reminder_mark_sent(&b.conn, &due.period_key).unwrap();
    assert_eq!(check(&b, sunday_at(18, 1)), None, "only once in the week");
    assert_eq!(check(&b, sunday_at(23, 59)), None);
    // The next Sunday is another week: it fires again when that week has activity, not before.
    let next = atm(2026, 9, 27, 18, 0);
    assert_eq!(check(&b, next), None, "nothing happened in week 39");
    b.trade(at(2026, 9, 22, 9));
    assert_eq!(check(&b, next).map(|d| d.period_key), Some("2026-W39".to_string()));
}

#[test]
fn no_closed_trade_and_no_journal_means_no_banner_and_nothing_remembered() {
    let b = book();
    assert_eq!(check(&b, sunday_at(18, 0)), None);
    assert_eq!(reminder_pending(&b.conn, sunday_at(18, 0), 0, &BTreeMap::new()).unwrap(), None);
    // An open trade is not a closed one.
    let mut open = b.data(at(2026, 9, 15, 9), "101", None);
    open.exit_price = None;
    open.exit_time = None;
    b.put(open);
    assert_eq!(check(&b, sunday_at(18, 0)), None);
    // A journal entry alone is enough, and it fires later the same Sunday (nothing was remembered).
    b.journal("2026-09-17");
    let due = check(&b, sunday_at(21, 0)).unwrap();
    assert_eq!((due.closed_trade_count, due.journal_days), (0, 1));
    // A trade of another week does not count.
    let c = book();
    c.trade(at(2026, 9, 8, 9));
    assert_eq!(check(&c, sunday_at(18, 0)), None);
}

#[test]
fn the_reminder_can_be_turned_off_and_moved_but_not_to_another_day() {
    let b = book();
    active_week(&b);
    assert_eq!(reminder_settings(&b.conn).unwrap(), ReminderSettings { enabled: true, time: "18:00".into(), day: "sunday".into() }, "on, 18:00, Sunday by default");

    let off = ReminderSettings { enabled: false, ..ReminderSettings::default() };
    assert_eq!(set_reminder_settings(&b.conn, &off).unwrap(), off);
    assert_eq!(check(&b, sunday_at(19, 0)), None, "off");
    assert_eq!(reminder_pending(&b.conn, sunday_at(19, 0), 0, &BTreeMap::new()).unwrap(), None);

    let later = ReminderSettings { enabled: true, time: "20:30".into(), day: "sunday".into() };
    set_reminder_settings(&b.conn, &later).unwrap();
    assert_eq!(check(&b, sunday_at(18, 0)), None);
    assert_eq!(check(&b, sunday_at(20, 29)), None);
    assert!(check(&b, sunday_at(20, 30)).is_some());

    for bad in [
        ReminderSettings { time: "25:00".into(), ..later.clone() },
        ReminderSettings { time: "18h".into(), ..later.clone() },
        ReminderSettings { time: "9:5".into(), ..later.clone() },
        ReminderSettings { day: "monday".into(), ..later.clone() },
    ] {
        assert!(matches!(set_reminder_settings(&b.conn, &bad), Err(CoreError::Invalid(m)) if m.starts_with("review:")), "{bad:?}");
    }
    assert_eq!(reminder_settings(&b.conn).unwrap(), later, "a refusal changes nothing");
}

#[test]
fn the_banner_waits_for_the_reminder_goes_away_when_put_off_or_done_and_never_outlives_the_week() {
    let b = book();
    active_week(&b);
    let pending = |now: i64| reminder_pending(&b.conn, now, 0, &BTreeMap::new()).unwrap();
    assert_eq!(pending(sunday_at(18, 30)), None, "not armed before the reminder fired");
    reminder_mark_sent(&b.conn, W38).unwrap();
    assert_eq!(pending(sunday_at(18, 30)).map(|d| d.period_key), Some(W38.to_string()));
    assert_eq!(pending(atm(2026, 9, 21, 9, 0)), None, "Monday is another week: no stale banner");

    reminder_dismiss(&b.conn, sunday_at(18, 31), 0).unwrap();
    assert_eq!(pending(sunday_at(18, 32)), None, "« Plus tard »");

    // Done: no banner either (even if it was not put off).
    let c = book();
    active_week(&c);
    reminder_mark_sent(&c.conn, W38).unwrap();
    save(&c.conn, &c.input(W38, &["x"]), sunday_at(18, 40), 0).unwrap();
    assert!(reminder_pending(&c.conn, sunday_at(18, 41), 0, &BTreeMap::new()).unwrap().is_some(), "a draft does not stop it");
    complete(&c.conn, W38, sunday_at(18, 42)).unwrap();
    assert_eq!(reminder_pending(&c.conn, sunday_at(18, 43), 0, &BTreeMap::new()).unwrap(), None, "done");
    assert_eq!(reminder_check(&c.conn, sunday_at(19, 0), 0, &BTreeMap::new()).unwrap(), None);
}

#[test]
fn the_week_bounds_given_to_the_shell_are_the_first_day_and_the_day_after_the_last() {
    assert_eq!(bound_days("2026-W43").unwrap(), ("2026-10-19".to_string(), "2026-10-26".to_string()));
    assert_eq!(bound_days("2026-W53").unwrap(), ("2026-12-28".to_string(), "2027-01-04".to_string()));
    assert!(bound_days("nope").is_err());
    assert_eq!(current_week_key(atm(2027, 1, 3, 23, 59), 0), "2026-W53");
    assert_eq!(current_week_key(atm(2027, 1, 4, 0, 0), 0), "2027-W01");
}

// --- Privacy -----------------------------------------------------------------------------------

const CANARY: &str = "CANARI-BILAN-7f3a";

#[test]
fn the_free_text_of_a_review_appears_in_no_coach_tool_result_and_no_tool_was_added() {
    let b = book();
    for h in [9, 11, 13, 15, 17] {
        b.trade(at(2026, 9, 15, h));
    }
    b.journal("2026-09-15");
    let input = ReviewInput {
        period_key: W38.into(),
        answers: Answers { went_well: format!("{CANARY} bien"), do_differently: format!("{CANARY} autrement"), next_priority: format!("{CANARY} priorité") },
        intentions: vec![format!("{CANARY} intention")],
    };
    save(&b.conn, &input, sunday(), 0).unwrap();
    assert_eq!(TOOL_NAMES.len(), 13, "no tool was added for the review");
    assert_eq!(tools::TOOLS_VERSION, 1);
    let scope = ToolScope::new(&b.conn, &[], past(), 0).unwrap();
    for name in TOOL_NAMES {
        for params in [json!({}), json!({"from": "2026-09-14", "to": "2026-09-20"}), json!({"period": "all"})] {
            let out = tools::run(&b.conn, &scope, name, &params);
            let text = serde_json::to_string(&out.content).unwrap();
            assert!(!text.contains("CANARI") && !text.to_lowercase().contains("weekly"), "{name}: {text}");
        }
    }
    // Neither the CSV export of the trades.
    let csv = crate::export::trades_csv(&b.conn, &crate::trades::TradeFilter::default()).unwrap();
    assert!(!String::from_utf8_lossy(&csv).contains("CANARI"));
}

#[test]
fn no_code_of_the_coach_the_mcp_server_the_exports_or_the_pdf_reads_the_review_tables() {
    let src = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut files = vec![src.join("export.rs")];
    for dir in ["coach", "mcp", "export_pdf"] {
        for entry in std::fs::read_dir(src.join(dir)).unwrap() {
            files.push(entry.unwrap().path());
        }
    }
    let mut checked = 0;
    for f in files.iter().filter(|f| f.extension().is_some_and(|e| e == "rs")) {
        let text = std::fs::read_to_string(f).unwrap();
        for forbidden in ["weekly_review", "weekly_intentions"] {
            assert!(!text.contains(forbidden), "{f:?} must not read the weekly review ({forbidden})");
        }
        checked += 1;
    }
    assert!(checked >= 10, "the scan found the files ({checked})");
}

#[test]
fn the_review_is_in_the_backup() {
    use crate::backup;
    let data = tempfile::tempdir().unwrap();
    let dest = tempfile::tempdir().unwrap();
    let conn = db::open(data.path()).unwrap();
    save(&conn, &ReviewInput { period_key: W38.into(), answers: Answers { went_well: CANARI_TEXT.into(), ..Answers::default() }, intentions: vec!["Stops".into()] }, sunday(), 0).unwrap();
    let info = backup::create(&conn, data.path(), dest.path(), 1_700_000_000_000).unwrap();
    let copy = Connection::open(std::path::Path::new(&info.path).join(db::DB_FILE)).unwrap();
    assert_eq!((count(&copy, "weekly_reviews"), count(&copy, "weekly_intentions")), (1, 1));
    let kept = review_of(&copy, W38).unwrap().unwrap();
    assert_eq!(kept.answers.went_well, CANARI_TEXT);
}

const CANARI_TEXT: &str = "Texte du bilan à sauvegarder";
