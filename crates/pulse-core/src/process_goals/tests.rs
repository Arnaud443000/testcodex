//! Process goals: journals computed by hand. Unless stated otherwise the account starts at 10 000 USD,
//! the instrument has a multiplier of 1, trades are long, entered at 100 with a size of 1, a stop at 90
//! (risk 10 = 0.1 % of the balance) and closed at 101 (+1): no loss, so no revenge and a balance ≥ 10 000.

use super::*;
use crate::accounts::{self, NewAccount};
use crate::db;
use crate::migrations;
use crate::test_support::{account, dec, instrument};
use crate::trades::{self, Direction as Dir, PlanFollowed, RuleCheck, TradeData};

const H: i64 = 3_600_000;
const MIN: i64 = 60_000;

fn at(y: i64, m: u32, d: u32, hour: i64) -> i64 {
    time::days_from_civil(y, m, d).unwrap() * DAY_MS + hour * H
}

fn day(y: i64, m: u32, d: u32) -> i64 {
    time::days_from_civil(y, m, d).unwrap()
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
    /// Entered at `entry`, closed one hour later at `exit` (price).
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

    /// A plain trade (stop at 90, +1).
    fn trade(&self, entry: i64) -> i64 {
        self.put(self.data(entry, "101", Some("90")))
    }

    fn goal(&self, kind: PeriodKind, key: &str, metric: ProcessMetric, target: &str) -> ProcessGoal {
        set(&self.conn, &NewProcessGoal { period_kind: kind, period_key: key.into(), metric, target: dec(target) }).unwrap()
    }

    fn week(&self, key: &str, metric: ProcessMetric, target: &str) -> ProcessGoal {
        self.goal(PeriodKind::Week, key, metric, target)
    }

    fn progress(&self, kind: PeriodKind, key: &str, now: i64) -> ProcessProgress {
        progress(
            &self.conn,
            &ProgressQuery {
                account_ids: vec![],
                period_kind: kind,
                period_key: key.into(),
                now_ms: now,
                tz_offset_min: 0,
                boundary_offsets: BTreeMap::new(),
            },
        )
        .unwrap()
    }

    fn one(&self, kind: PeriodKind, key: &str, metric: ProcessMetric, now: i64) -> ProcessGoalProgress {
        self.progress(kind, key, now).goals.into_iter().find(|g| g.goal.metric == metric).unwrap()
    }

    fn settings(&self, max_trades_per_day: Option<u32>, max_risk_percent: Option<&str>) {
        let s = BehaviorSettings { max_trades_per_day, max_risk_percent: max_risk_percent.map(dec), ..BehaviorSettings::default() };
        settings::set_behavior(&self.conn, &s).unwrap();
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

    /// The same window as the goals, for the source reports.
    fn window(&self, key: &str) -> StatsQuery {
        let p = self.progress(PeriodKind::Week, key, at(2026, 9, 30, 12)).period;
        StatsQuery { from: Some(p.from), to: Some(p.to), ..Default::default() }
    }
}

/// Week 38 of 2026 is Monday 14 → Sunday 20 September. "During" is Wednesday 16, "after" is 30 September.
const W38: &str = "2026-W38";
fn during() -> i64 {
    at(2026, 9, 16, 18)
}
fn after() -> i64 {
    at(2026, 9, 30, 12)
}

// --- Periods ------------------------------------------------------------------------------

#[test]
fn iso_weeks_and_months_follow_the_calendar() {
    let w38 = Period::parse(PeriodKind::Week, W38).unwrap();
    assert_eq!((w38.first_day, w38.days, w38.last_day()), (day(2026, 9, 14), 7, day(2026, 9, 20)));
    assert_eq!(Period::containing(PeriodKind::Week, day(2026, 9, 20)).key, W38, "Sunday closes the week");
    assert_eq!(Period::containing(PeriodKind::Week, day(2026, 9, 21)).key, "2026-W39");
    assert_eq!((w38.previous().key, w38.next().key), ("2026-W37".to_string(), "2026-W39".to_string()));

    // 1 January 2026 is a Thursday: 2026 has a week 53, Monday 28 December 2026 → Sunday 3 January 2027.
    let w53 = Period::parse(PeriodKind::Week, "2026-W53").unwrap();
    assert_eq!((w53.first_day, w53.last_day()), (day(2026, 12, 28), day(2027, 1, 3)));
    assert_eq!(Period::containing(PeriodKind::Week, day(2027, 1, 3)).key, "2026-W53");
    assert_eq!(w53.next().key, "2027-W01");
    assert_eq!(Period::parse(PeriodKind::Week, "2027-W01").unwrap().first_day, day(2027, 1, 4));
    // Monday 29 December 2025 → Sunday 4 January 2026 is week 1 of 2026, and follows 2025-W52.
    let w01 = Period::parse(PeriodKind::Week, "2026-W01").unwrap();
    assert_eq!((w01.first_day, w01.last_day()), (day(2025, 12, 29), day(2026, 1, 4)));
    assert_eq!(Period::containing(PeriodKind::Week, day(2025, 12, 31)).key, "2026-W01");
    assert_eq!(w01.previous().key, "2025-W52");
    // 2025 has no week 53 (1 January 2025 was a Wednesday, not a leap year); 2020 had one (Wednesday, leap).
    assert!(Period::parse(PeriodKind::Week, "2025-W53").is_err());
    assert!(Period::parse(PeriodKind::Week, "2020-W53").is_ok());

    let feb = Period::parse(PeriodKind::Month, "2028-02").unwrap();
    assert_eq!((feb.days, feb.previous().key, feb.next().key), (29, "2028-01".to_string(), "2028-03".to_string()));
    assert_eq!(Period::parse(PeriodKind::Month, "2026-01").unwrap().previous().key, "2025-12");
    for (kind, key) in [
        (PeriodKind::Week, "2026-W00"),
        (PeriodKind::Week, "2026-W54"),
        (PeriodKind::Week, "2026-38"),
        (PeriodKind::Week, "2026-W3"),
        (PeriodKind::Week, "2026-W+1"),
        (PeriodKind::Month, "2026-13"),
        (PeriodKind::Month, "2026-9"),
        (PeriodKind::Month, "2026-W38"),
        (PeriodKind::Month, "+026-09"),
    ] {
        assert!(Period::parse(kind, key).is_err(), "{key}");
    }
}

// --- Goals: set, list, delete, copy, validation -------------------------------------------

#[test]
fn sets_replaces_lists_and_deletes_goals() {
    let b = book();
    let g = b.week(W38, ProcessMetric::NoStopTrades, "0");
    assert_eq!((g.period_kind, g.period_key.as_str(), g.metric, g.target), (PeriodKind::Week, W38, ProcessMetric::NoStopTrades, dec("0")));
    let again = b.week(W38, ProcessMetric::NoStopTrades, "2.0");
    assert_eq!((again.id, again.target.to_string().as_str()), (g.id, "2"), "same period and metric: the target changes, stored whole");
    b.week(W38, ProcessMetric::RulesRespectRate, "90.5");
    b.week(W38, ProcessMetric::JournalDays, "5");
    b.week("2026-W39", ProcessMetric::NoStopTrades, "0");
    b.goal(PeriodKind::Month, "2026-09", ProcessMetric::NoStopTrades, "3");
    let listed = list(&b.conn, PeriodKind::Week, W38).unwrap();
    assert_eq!(
        listed.iter().map(|g| g.metric).collect::<Vec<_>>(),
        vec![ProcessMetric::NoStopTrades, ProcessMetric::RulesRespectRate, ProcessMetric::JournalDays],
        "in the order of the metrics"
    );
    assert_eq!(list(&b.conn, PeriodKind::Month, "2026-09").unwrap().len(), 1, "weeks and months are apart");
    delete(&b.conn, g.id).unwrap();
    assert_eq!(list(&b.conn, PeriodKind::Week, W38).unwrap().len(), 2);
    assert!(matches!(delete(&b.conn, g.id), Err(CoreError::NotFound(_))));
    assert!(matches!(get(&b.conn, g.id), Err(CoreError::NotFound(_))));
    assert!(list(&b.conn, PeriodKind::Week, "2026-W60").is_err());
}

#[test]
fn refuses_invalid_targets_and_writes_nothing() {
    let b = book();
    let refused = [
        (PeriodKind::Week, W38, ProcessMetric::NoStopTrades, "-1"),
        (PeriodKind::Week, W38, ProcessMetric::NoStopTrades, "1.5"),
        (PeriodKind::Week, W38, ProcessMetric::NoStopTrades, "10001"),
        (PeriodKind::Week, W38, ProcessMetric::RiskBreaches, "0.5"),
        (PeriodKind::Week, W38, ProcessMetric::RulesRespectRate, "0"),
        (PeriodKind::Week, W38, ProcessMetric::RulesRespectRate, "100.01"),
        (PeriodKind::Week, W38, ProcessMetric::PlanFollowRate, "-5"),
        (PeriodKind::Week, W38, ProcessMetric::JournalDays, "0"),
        (PeriodKind::Week, W38, ProcessMetric::JournalDays, "8"),
        (PeriodKind::Week, W38, ProcessMetric::JournalDays, "2.5"),
        (PeriodKind::Month, "2026-09", ProcessMetric::JournalDays, "32"),
        (PeriodKind::Week, "2026-09", ProcessMetric::NoStopTrades, "0"),
        (PeriodKind::Month, "2026-W38", ProcessMetric::NoStopTrades, "0"),
    ];
    for (kind, key, metric, target) in refused {
        let new = NewProcessGoal { period_kind: kind, period_key: key.into(), metric, target: dec(target) };
        assert!(matches!(set(&b.conn, &new), Err(CoreError::Invalid(_))), "{key} {metric:?} {target}");
    }
    let count: i64 = b.conn.query_row("SELECT COUNT(*) FROM process_goals", [], |r| r.get(0)).unwrap();
    assert_eq!(count, 0, "nothing written");
    // The bounds themselves are accepted.
    for (kind, key, metric, target) in [
        (PeriodKind::Week, W38, ProcessMetric::NoStopTrades, "0"),
        (PeriodKind::Week, W38, ProcessMetric::OvertradingDays, "10000"),
        (PeriodKind::Week, W38, ProcessMetric::RulesRespectRate, "100"),
        (PeriodKind::Week, W38, ProcessMetric::PlanFollowRate, "0.01"),
        (PeriodKind::Week, W38, ProcessMetric::JournalDays, "7"),
        (PeriodKind::Month, "2026-09", ProcessMetric::JournalDays, "31"),
        (PeriodKind::Month, "2026-09", ProcessMetric::JournalDays, "1"),
    ] {
        b.goal(kind, key, metric, target);
    }
    // The schema refuses what the module would never write.
    assert!(b.conn.execute("INSERT INTO process_goals (period_kind, period_key, metric, target) VALUES ('day', '2026-09-14', 'journal_days', '1')", []).is_err());
    assert!(b.conn.execute("INSERT INTO process_goals (period_kind, period_key, metric, target) VALUES ('week', '2026-09', 'journal_days', '1')", []).is_err());
    assert!(b.conn.execute("INSERT INTO process_goals (period_kind, period_key, metric, target) VALUES ('week', '2026-W40', 'net_pnl', '1')", []).is_err());
    assert!(b.conn.execute("INSERT INTO process_goals (period_kind, period_key, metric, target) VALUES ('week', '2026-W40', 'journal_days', '-1')", []).is_err());
    assert!(b.conn.execute("INSERT INTO process_goals (period_kind, period_key, metric, target) VALUES ('week', '2026-W38', 'journal_days', '3')", []).is_err(), "unique");
}

#[test]
fn copies_the_previous_period_without_overwriting() {
    let b = book();
    b.week("2026-W37", ProcessMetric::NoStopTrades, "0");
    b.week("2026-W37", ProcessMetric::RulesRespectRate, "90");
    b.week(W38, ProcessMetric::NoStopTrades, "2");
    let copied = copy_from_previous(&b.conn, PeriodKind::Week, W38).unwrap();
    let target = |m| copied.iter().find(|g| g.metric == m).map(|g| g.target);
    assert_eq!(target(ProcessMetric::NoStopTrades), Some(dec("2")), "an existing goal is kept");
    assert_eq!(target(ProcessMetric::RulesRespectRate), Some(dec("90")));
    assert_eq!(copy_from_previous(&b.conn, PeriodKind::Week, W38).unwrap().len(), 2, "twice: nothing more");
    assert!(copy_from_previous(&b.conn, PeriodKind::Week, "2026-W36").unwrap().is_empty(), "nothing before: nothing copied");
    // Across the new year, and for months.
    b.week("2025-W52", ProcessMetric::JournalDays, "5");
    assert_eq!(copy_from_previous(&b.conn, PeriodKind::Week, "2026-W01").unwrap()[0].target, dec("5"));
    b.goal(PeriodKind::Month, "2025-12", ProcessMetric::JournalDays, "20");
    let jan = copy_from_previous(&b.conn, PeriodKind::Month, "2026-01").unwrap();
    assert_eq!((jan.len(), jan[0].period_key.as_str(), jan[0].target), (1, "2026-01", dec("20")));
    assert!(list(&b.conn, PeriodKind::Week, "2026-W01").unwrap().iter().all(|g| g.period_kind == PeriodKind::Week));
}

// --- Metrics ------------------------------------------------------------------------------

/// W38: three trades, one without a stop (Tuesday) → 1 trade without a stop.
#[test]
fn no_stop_trades_counts_the_stop_loss_component_of_the_score() {
    let b = book();
    b.trade(at(2026, 9, 14, 9));
    let naked = b.put(b.data(at(2026, 9, 15, 9), "101", None));
    b.trade(at(2026, 9, 16, 9));
    b.trade(at(2026, 9, 21, 9)); // next week
    b.week(W38, ProcessMetric::NoStopTrades, "1");
    let g = b.one(PeriodKind::Week, W38, ProcessMetric::NoStopTrades, during());
    assert_eq!((g.value, g.trade_count, g.trade_ids.clone(), g.status), (Some(1.0), 3, vec![naked], Status::RespectedSoFar), "exactly the ceiling");
    assert_eq!((g.direction, g.unit, g.numerator, g.required_setting), (GoalDirection::AtMost, Unit::Count, None, None));
    // Same count as the discipline report over the same window.
    let report = behavior::discipline_report(&b.conn, &b.window(W38)).unwrap();
    assert_eq!(report.trades.iter().filter(|t| !t.has_stop_loss).count(), 1);
    assert_eq!(report.trades.len(), g.trade_count);
    // Just above the ceiling: exceeded at once, during the week.
    b.week(W38, ProcessMetric::NoStopTrades, "0");
    assert_eq!(b.one(PeriodKind::Week, W38, ProcessMetric::NoStopTrades, during()).status, Status::Exceeded);
    assert_eq!(b.one(PeriodKind::Week, W38, ProcessMetric::NoStopTrades, after()).status, Status::Exceeded);
    // A week without a closed trade has no data (never "0 trade without a stop" by default).
    b.week("2026-W37", ProcessMetric::NoStopTrades, "0");
    let empty = b.one(PeriodKind::Week, "2026-W37", ProcessMetric::NoStopTrades, after());
    assert_eq!((empty.value, empty.trade_count, empty.status), (None, 0, Status::NoData));
}

/// Daily limit 2. Tuesday 15: three trades entered (9 h, 10 h, 11 h) → the third is beyond the limit;
/// Thursday 17: two trades → nothing. One overtrading day.
#[test]
fn overtrading_days_come_from_the_patterns_report_and_need_the_daily_limit() {
    let b = book();
    b.trade(at(2026, 9, 15, 9));
    b.trade(at(2026, 9, 15, 10));
    let third = b.trade(at(2026, 9, 15, 11));
    b.trade(at(2026, 9, 17, 9));
    b.trade(at(2026, 9, 17, 10));
    b.week(W38, ProcessMetric::OvertradingDays, "1");

    // Without the setting: never an error, never a number.
    let g = b.one(PeriodKind::Week, W38, ProcessMetric::OvertradingDays, during());
    assert_eq!((g.value, g.status, g.required_setting, g.streak), (None, Status::SettingRequired, Some(RequiredSetting::MaxTradesPerDay), 0));
    assert_eq!(b.progress(PeriodKind::Week, W38, during()).max_trades_per_day, None);

    b.settings(Some(2), None);
    let g = b.one(PeriodKind::Week, W38, ProcessMetric::OvertradingDays, during());
    assert_eq!((g.value, g.days.clone(), g.trade_ids.clone(), g.status), (Some(1.0), vec!["2026-09-15".to_string()], vec![third], Status::RespectedSoFar));
    let report = behavior::pattern_report(&b.conn, &b.window(W38)).unwrap();
    assert_eq!(report.overtrading_days.len() as f64, g.value.unwrap());
    assert_eq!(b.one(PeriodKind::Week, W38, ProcessMetric::OvertradingDays, after()).status, Status::Respected);
    b.week(W38, ProcessMetric::OvertradingDays, "0");
    assert_eq!(b.one(PeriodKind::Week, W38, ProcessMetric::OvertradingDays, during()).status, Status::Exceeded);
    // No trade: no data, even with the limit set.
    b.week("2026-W37", ProcessMetric::OvertradingDays, "0");
    assert_eq!(b.one(PeriodKind::Week, "2026-W37", ProcessMetric::OvertradingDays, after()).status, Status::NoData);
}

/// A loss (stop 90, closed at 95 at 10 h) followed at 10 h 30 by a trade twice the risk (size 2): revenge
/// (window 60 min, factor 1.5). The trade after that is size 1 again: not a revenge.
#[test]
fn revenge_trades_come_from_the_patterns_report() {
    let b = book();
    b.put(b.data(at(2026, 9, 15, 9), "95", Some("90")));
    let mut big = b.data(at(2026, 9, 15, 10) + 30 * MIN, "101", Some("90"));
    big.size = dec("2");
    let revenge = b.put(big);
    b.trade(at(2026, 9, 16, 9));
    b.week(W38, ProcessMetric::RevengeTrades, "1");
    let g = b.one(PeriodKind::Week, W38, ProcessMetric::RevengeTrades, during());
    assert_eq!((g.value, g.trade_ids.clone(), g.trade_count, g.status), (Some(1.0), vec![revenge], 3, Status::RespectedSoFar));
    let report = behavior::pattern_report(&b.conn, &b.window(W38)).unwrap();
    assert_eq!(report.revenge_trades.iter().map(|r| r.trade_id).collect::<Vec<_>>(), g.trade_ids);
    b.week(W38, ProcessMetric::RevengeTrades, "0");
    assert_eq!(b.one(PeriodKind::Week, W38, ProcessMetric::RevengeTrades, after()).status, Status::Exceeded);
    b.week("2026-W37", ProcessMetric::RevengeTrades, "0");
    assert_eq!(b.one(PeriodKind::Week, "2026-W37", ProcessMetric::RevengeTrades, after()).value, None);
}

/// Limit 0.1 % of the balance. Monday: stop 90 → risk 10 on 10 000 = exactly 0.1 % (respected).
/// Tuesday: stop 80 → risk 20 on 10 001 = 0.19998 % (over). Wednesday: no stop (not evaluated).
#[test]
fn risk_breaches_come_from_the_risk_benchmark_and_need_the_limit() {
    let b = book();
    b.trade(at(2026, 9, 14, 9));
    let over = b.put(b.data(at(2026, 9, 15, 9), "101", Some("80")));
    b.put(b.data(at(2026, 9, 16, 9), "101", None));
    b.week(W38, ProcessMetric::RiskBreaches, "1");
    let g = b.one(PeriodKind::Week, W38, ProcessMetric::RiskBreaches, during());
    assert_eq!((g.status, g.required_setting, g.value), (Status::SettingRequired, Some(RequiredSetting::MaxRiskPercent), None));

    b.settings(None, Some("0.1"));
    let g = b.one(PeriodKind::Week, W38, ProcessMetric::RiskBreaches, during());
    assert_eq!((g.value, g.trade_ids.clone(), g.status), (Some(1.0), vec![over], Status::RespectedSoFar));
    let bench = comparisons::risk_benchmark_report(&b.conn, &b.window(W38)).unwrap();
    assert_eq!((bench.over_count, bench.evaluated_count, bench.without_stop_count), (1, 2, 1));
    assert_eq!(bench.violations[0].trade_id, over);
    assert_eq!(b.progress(PeriodKind::Week, W38, during()).max_risk_percent, Some(dec("0.1")));
    b.week(W38, ProcessMetric::RiskBreaches, "0");
    assert_eq!(b.one(PeriodKind::Week, W38, ProcessMetric::RiskBreaches, during()).status, Status::Exceeded);

    // A week whose only trade has no stop: nothing evaluated → no data, never "0 breach".
    b.put(b.data(at(2026, 9, 8, 9), "101", None));
    b.week("2026-W37", ProcessMetric::RiskBreaches, "0");
    let g = b.one(PeriodKind::Week, "2026-W37", ProcessMetric::RiskBreaches, after());
    assert_eq!((g.value, g.trade_count, g.status), (None, 1, Status::NoData));
}

/// Rules A and B. Nine checks respected and one not (A ticked on 5 trades, B on 5, one B not respected):
/// 9 / 10 = 90 % — 90 × 10 = 900 = 9 × 100, reached exactly (as a float, 0.9 × 100 is 90.00000000000001).
#[test]
fn rules_respect_rate_is_the_global_rate_of_the_adherence_report() {
    let b = book();
    let ra = rules::create(&b.conn, "Attendre la clôture").unwrap().id;
    let rb = rules::create(&b.conn, "Pas de trade avant 9 h").unwrap().id;
    for n in 0..5 {
        let mut t = b.data(at(2026, 9, 14 + n, 9), "101", Some("90"));
        t.rule_checks = vec![RuleCheck { rule_id: ra, respected: true }, RuleCheck { rule_id: rb, respected: n != 2 }];
        b.put(t);
    }
    b.trade(at(2026, 9, 18, 15)); // nothing ticked: not in the rate
    b.week(W38, ProcessMetric::RulesRespectRate, "90");
    let g = b.one(PeriodKind::Week, W38, ProcessMetric::RulesRespectRate, during());
    assert_eq!((g.numerator, g.denominator, g.status, g.unit), (Some(9), Some(10), Status::Reached, Unit::Percent));
    assert!((g.value.unwrap() - 90.0).abs() < 1e-9);
    let report = behavior::rule_adherence_report(&b.conn, &b.window(W38)).unwrap();
    assert_eq!((report.respected, report.checks), (9, 10));
    // Just above the rate: in progress, then missed.
    b.week(W38, ProcessMetric::RulesRespectRate, "90.01");
    assert_eq!(b.one(PeriodKind::Week, W38, ProcessMetric::RulesRespectRate, during()).status, Status::InProgress);
    assert_eq!(b.one(PeriodKind::Week, W38, ProcessMetric::RulesRespectRate, after()).status, Status::Missed);
    // No rule ticked: no data.
    b.trade(at(2026, 9, 8, 9));
    b.week("2026-W37", ProcessMetric::RulesRespectRate, "50");
    let g = b.one(PeriodKind::Week, "2026-W37", ProcessMetric::RulesRespectRate, after());
    assert_eq!((g.value, g.numerator, g.trade_count, g.status), (None, None, 1, Status::NoData));
}

/// Plans: yes, yes, yes, partial, not filled in → 4 declared: below 5, no data. One more "yes":
/// 4 in plan out of 5 declared = 80 %.
#[test]
fn plan_follow_rate_reads_the_plan_groups_and_needs_five_declared_plans() {
    let b = book();
    let plans = [Some(PlanFollowed::Yes), Some(PlanFollowed::Yes), Some(PlanFollowed::Yes), Some(PlanFollowed::Partial), None];
    for (n, plan) in plans.into_iter().enumerate() {
        let mut t = b.data(at(2026, 9, 14 + n as u32, 9), "101", Some("90"));
        t.plan_followed = plan;
        b.put(t);
    }
    b.week(W38, ProcessMetric::PlanFollowRate, "80");
    let g = b.one(PeriodKind::Week, W38, ProcessMetric::PlanFollowRate, during());
    assert_eq!((g.value, g.trade_count, g.status), (None, 5, Status::NoData));

    let mut t = b.data(at(2026, 9, 19, 9), "101", Some("90"));
    t.plan_followed = Some(PlanFollowed::Yes);
    b.put(t);
    let g = b.one(PeriodKind::Week, W38, ProcessMetric::PlanFollowRate, during());
    assert_eq!((g.numerator, g.denominator, g.status), (Some(4), Some(5), Status::Reached), "exactly 80 %");
    assert!((g.value.unwrap() - 80.0).abs() < 1e-9);
    let groups = behavior::plan_report(&b.conn, &b.window(W38)).unwrap().groups;
    assert_eq!(groups.iter().map(|g| g.summary.trade_count).collect::<Vec<_>>(), vec![4, 1, 0, 1]);
    b.week(W38, ProcessMetric::PlanFollowRate, "80.5");
    assert_eq!(b.one(PeriodKind::Week, W38, ProcessMetric::PlanFollowRate, during()).status, Status::InProgress);
    assert_eq!(b.one(PeriodKind::Week, W38, ProcessMetric::PlanFollowRate, after()).status, Status::Missed);
}

/// Journal entries on Monday 14, Wednesday 16 and Sunday 20 (inside W38), Sunday 13 and Monday 21 (outside).
#[test]
fn journal_days_count_the_local_days_with_an_entry() {
    let b = book();
    for d in ["2026-09-13", "2026-09-14", "2026-09-16", "2026-09-20", "2026-09-21"] {
        b.journal(d);
    }
    // A blank entry is never stored.
    journal::save(
        &b.conn,
        &JournalEntry {
            day: "2026-09-17".into(),
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
    b.week(W38, ProcessMetric::JournalDays, "3");
    let g = b.one(PeriodKind::Week, W38, ProcessMetric::JournalDays, during());
    assert_eq!((g.value, g.trade_count, g.status), (Some(3.0), 0, Status::Reached), "no trade needed, exactly the target");
    assert_eq!(g.days, vec!["2026-09-14", "2026-09-16", "2026-09-20"]);
    assert_eq!(journal::list(&b.conn, Some("2026-09-14"), Some("2026-09-20")).unwrap().len(), 3);
    b.week(W38, ProcessMetric::JournalDays, "4");
    assert_eq!(b.one(PeriodKind::Week, W38, ProcessMetric::JournalDays, during()).status, Status::InProgress);
    assert_eq!(b.one(PeriodKind::Week, W38, ProcessMetric::JournalDays, after()).status, Status::Missed);
    // Zero entries is a value (0), not "no data".
    b.week("2026-W36", ProcessMetric::JournalDays, "1");
    let g = b.one(PeriodKind::Week, "2026-W36", ProcessMetric::JournalDays, after());
    assert_eq!((g.value, g.status), (Some(0.0), Status::Missed));
    // Month: the whole of September (13, 14, 16, 20, 21).
    b.goal(PeriodKind::Month, "2026-09", ProcessMetric::JournalDays, "5");
    let g = b.one(PeriodKind::Month, "2026-09", ProcessMetric::JournalDays, during());
    assert_eq!((g.value, g.status), (Some(5.0), Status::Reached));
}

// --- Statuses, periods, currencies ----------------------------------------------------------

#[test]
fn statuses_depend_on_the_end_of_the_period() {
    let b = book();
    b.trade(at(2026, 9, 14, 9));
    b.journal("2026-09-14");
    b.week(W38, ProcessMetric::NoStopTrades, "0");
    b.week(W38, ProcessMetric::JournalDays, "2");
    let st = |now| {
        let p = b.progress(PeriodKind::Week, W38, now);
        (p.period.state, p.goals.iter().map(|g| g.status).collect::<Vec<_>>())
    };
    // Sunday 20 at 23 h (UTC, offset 0) is still the week.
    assert_eq!(st(at(2026, 9, 20, 23)), (PeriodState::Current, vec![Status::RespectedSoFar, Status::InProgress]));
    assert_eq!(st(at(2026, 9, 21, 0)), (PeriodState::Past, vec![Status::Respected, Status::Missed]));
    assert_eq!(st(at(2026, 9, 1, 0)).0, PeriodState::Future);
    b.journal("2026-09-19");
    assert_eq!(st(at(2026, 9, 20, 23)).1, vec![Status::RespectedSoFar, Status::Reached], "a floor is reached before the end");
    let p = b.progress(PeriodKind::Week, W38, during()).period;
    assert_eq!((p.first_day.as_str(), p.last_day.as_str(), p.previous_key.as_str(), p.next_key.as_str()), ("2026-09-14", "2026-09-20", "2026-W37", "2026-W39"));
    assert_eq!((p.from, p.to), (at(2026, 9, 14, 0), at(2026, 9, 21, 0)));
    assert!(b.progress(PeriodKind::Week, "2026-W39", during()).goals.is_empty(), "no goal, nothing to report");
}

/// Summer time ends in Paris on Sunday 25 October 2026 (UTC+2 → UTC+1). Week 43 runs from Monday 19
/// 00:00 (+2, i.e. 18 October 22:00 UTC) to Monday 26 00:00 (+1, i.e. 25 October 23:00 UTC).
/// Trades without a stop: A closed Monday 19 at 00:30 (+2), B closed Sunday 25 at 23:30 (+1),
/// C closed Monday 26 at 00:30 (+1).
#[test]
fn a_week_across_the_daylight_saving_change_uses_the_offset_of_each_bound() {
    let b = book();
    let closed_at = |utc: i64, tz: i32| {
        let mut t = b.data(utc - H, "101", None);
        t.tz_offset_min = tz;
        b.put(t)
    };
    let a = closed_at(at(2026, 10, 18, 22) + 30 * MIN, 120);
    let bb = closed_at(at(2026, 10, 25, 22) + 30 * MIN, 60);
    let c = closed_at(at(2026, 10, 25, 23) + 30 * MIN, 60);
    b.week("2026-W43", ProcessMetric::NoStopTrades, "5");
    b.week("2026-W44", ProcessMetric::NoStopTrades, "5");
    let now = at(2026, 11, 5, 12);
    let q = |key: &str, offsets: &[(&str, i32)]| {
        progress(
            &b.conn,
            &ProgressQuery {
                account_ids: vec![],
                period_kind: PeriodKind::Week,
                period_key: key.into(),
                now_ms: now,
                tz_offset_min: 60,
                boundary_offsets: offsets.iter().map(|(d, o)| (d.to_string(), *o)).collect(),
            },
        )
        .unwrap()
    };
    let offsets = [("2026-10-19", 120), ("2026-10-26", 60), ("2026-11-02", 60)];
    let w43 = q("2026-W43", &offsets);
    assert_eq!((w43.period.from, w43.period.to), (at(2026, 10, 18, 22), at(2026, 10, 25, 23)));
    assert_eq!(w43.goals[0].trade_ids, vec![a, bb]);
    assert_eq!(q("2026-W44", &offsets).goals[0].trade_ids, vec![c]);
    // With the offset of today only (+1), the Monday 00:30 trade (+2) would fall in the week before.
    assert_eq!(q("2026-W43", &[]).goals[0].trade_ids, vec![bb]);
    // An absurd offset is refused.
    let bad = ProgressQuery {
        account_ids: vec![],
        period_kind: PeriodKind::Week,
        period_key: "2026-W43".into(),
        now_ms: now,
        tz_offset_min: 60,
        boundary_offsets: [("2026-10-19".to_string(), 2000)].into_iter().collect(),
    };
    assert!(progress(&b.conn, &bad).is_err());
}

/// Week 1 of 2026 runs from Monday 29 December 2025 to Sunday 4 January 2026: a trade closed on
/// 31 December 2025 counts in 2026-W01, one closed on 28 December in 2025-W52.
#[test]
fn the_iso_week_across_the_new_year() {
    let b = book();
    let dec31 = b.put(b.data(at(2025, 12, 31, 9), "101", None));
    let jan2 = b.put(b.data(at(2026, 1, 2, 9), "101", None));
    let dec28 = b.put(b.data(at(2025, 12, 28, 9), "101", None));
    b.week("2026-W01", ProcessMetric::NoStopTrades, "1");
    b.week("2025-W52", ProcessMetric::NoStopTrades, "1");
    let w01 = b.one(PeriodKind::Week, "2026-W01", ProcessMetric::NoStopTrades, at(2026, 1, 10, 0));
    assert_eq!((w01.trade_ids.clone(), w01.status), (vec![dec31, jan2], Status::Exceeded));
    let w52 = b.progress(PeriodKind::Week, "2025-W52", at(2026, 1, 10, 0));
    assert_eq!((w52.goals[0].trade_ids.clone(), w52.goals[0].status), (vec![dec28], Status::Respected));
    assert_eq!((w52.period.first_day.as_str(), w52.period.next_key.as_str()), ("2025-12-22", "2026-W01"));
    // And the long week 53 of 2026.
    b.week("2026-W53", ProcessMetric::NoStopTrades, "0");
    let jan3 = b.put(b.data(at(2027, 1, 3, 9), "101", None));
    let w53 = b.one(PeriodKind::Week, "2026-W53", ProcessMetric::NoStopTrades, at(2027, 1, 3, 20));
    assert_eq!((w53.trade_ids.clone(), w53.status), (vec![jan3], Status::Exceeded));
}

#[test]
fn accounts_in_different_currencies_are_refused_like_everywhere() {
    let b = book();
    let eur = accounts::create(
        &b.conn,
        &NewAccount { name: "Euro".into(), kind: "personal".into(), broker: String::new(), currency: "EUR".into(), initial_capital: dec("5000") },
    )
    .unwrap()
    .id;
    b.week(W38, ProcessMetric::JournalDays, "1");
    let q = |ids: Vec<i64>| {
        progress(
            &b.conn,
            &ProgressQuery {
                account_ids: ids,
                period_kind: PeriodKind::Week,
                period_key: W38.into(),
                now_ms: during(),
                tz_offset_min: 0,
                boundary_offsets: BTreeMap::new(),
            },
        )
    };
    assert!(matches!(q(vec![]), Err(CoreError::Invalid(_))), "all active accounts: USD and EUR");
    assert!(matches!(q(vec![b.a, eur]), Err(CoreError::Invalid(_))));
    assert_eq!(q(vec![eur]).unwrap().currency.as_deref(), Some("EUR"));
    assert_eq!(q(vec![b.a]).unwrap().currency.as_deref(), Some("USD"));
}

/// Two USD accounts, daily limit 1: each account over the limit on the same day is its own overtrading day,
/// and one account never makes the other's trades count.
#[test]
fn several_accounts_of_one_currency_are_measured_together_and_each_history_stays_its_own() {
    let b = book();
    let second = account(&b.conn, "10000");
    b.settings(Some(1), None);
    b.trade(at(2026, 9, 15, 9));
    b.trade(at(2026, 9, 15, 10));
    let mut t = b.data(at(2026, 9, 15, 9) + 30 * MIN, "101", Some("90"));
    t.account_id = second;
    b.put(t);
    let mut t = b.data(at(2026, 9, 15, 11), "101", Some("90"));
    t.account_id = second;
    b.put(t);
    b.week(W38, ProcessMetric::OvertradingDays, "5");
    let g = b.one(PeriodKind::Week, W38, ProcessMetric::OvertradingDays, during());
    assert_eq!((g.value, g.days.clone()), (Some(2.0), vec!["2026-09-15".to_string(), "2026-09-15".to_string()]));
    let only_second = progress(
        &b.conn,
        &ProgressQuery {
            account_ids: vec![second],
            period_kind: PeriodKind::Week,
            period_key: W38.into(),
            now_ms: during(),
            tz_offset_min: 0,
            boundary_offsets: BTreeMap::new(),
        },
    )
    .unwrap();
    assert_eq!(only_second.goals[0].value, Some(1.0));
}

// --- Streaks --------------------------------------------------------------------------------

/// "No trade without a stop" every week from W34 to W39. W34: a trade without a stop (exceeded);
/// W35 to W38: trades with a stop (respected). Seen from W39 (running): 4 weeks in a row.
#[test]
fn streaks_count_the_previous_successful_periods_in_a_row() {
    let b = book();
    b.put(b.data(at(2026, 8, 18, 9), "101", None)); // W34
    for d in [25, 1, 8, 15] {
        let (m, d) = if d > 20 { (8, d) } else { (9, d) };
        b.trade(at(2026, m, d, 9)); // W35, W36, W37, W38
    }
    for w in 34..=39 {
        b.week(&format!("2026-W{w}"), ProcessMetric::NoStopTrades, "0");
    }
    let streak = |key: &str| b.one(PeriodKind::Week, key, ProcessMetric::NoStopTrades, at(2026, 9, 23, 12)).streak;
    assert_eq!(streak("2026-W39"), 4, "W35 to W38; W34 failed");
    assert_eq!(streak("2026-W38"), 3, "from a past week: the weeks before it");
    assert_eq!(streak("2026-W35"), 0);
    // The running week never counts in its own streak nor in the next one's.
    assert_eq!(b.one(PeriodKind::Week, "2026-W39", ProcessMetric::NoStopTrades, at(2026, 9, 17, 12)).streak, 0, "W38 not over yet");

    // Interrupted by a failure: a trade without a stop in W37.
    let naked = b.put(b.data(at(2026, 9, 9, 9), "101", None));
    assert_eq!(streak("2026-W39"), 1);
    trades::delete(&b.conn, naked).unwrap();
    assert_eq!(streak("2026-W39"), 4);
    // Interrupted by a week without a goal.
    let w37 = list(&b.conn, PeriodKind::Week, "2026-W37").unwrap().remove(0);
    delete(&b.conn, w37.id).unwrap();
    assert_eq!(streak("2026-W39"), 1);
    b.week("2026-W37", ProcessMetric::NoStopTrades, "0");
    // Interrupted by "no data": no closed trade in W37.
    let w37_trade = trades::list(&b.conn, &Default::default()).unwrap().into_iter().find(|t| t.data.entry_time == at(2026, 9, 8, 9)).unwrap();
    trades::delete(&b.conn, w37_trade.id).unwrap();
    assert_eq!(streak("2026-W39"), 1);
    // A metric that needs a missing setting has no streak.
    b.week("2026-W38", ProcessMetric::OvertradingDays, "0");
    b.week("2026-W39", ProcessMetric::OvertradingDays, "0");
    assert_eq!(b.one(PeriodKind::Week, "2026-W39", ProcessMetric::OvertradingDays, at(2026, 9, 23, 12)).streak, 0);
}

/// One journal entry every Monday for 60 weeks and a one-day goal each week: the streak stops at 52.
#[test]
fn a_streak_is_capped_at_fifty_two_periods() {
    let b = book();
    let mut p = Period::parse(PeriodKind::Week, "2026-W38").unwrap();
    for _ in 0..60 {
        p = p.previous();
        b.journal(&day_string(p.first_day));
        b.week(&p.key, ProcessMetric::JournalDays, "1");
    }
    b.week(W38, ProcessMetric::JournalDays, "1");
    assert_eq!(b.one(PeriodKind::Week, W38, ProcessMetric::JournalDays, during()).streak, MAX_STREAK);
    // Months: a goal in July and August, reached; September running.
    b.goal(PeriodKind::Month, "2026-07", ProcessMetric::JournalDays, "2");
    b.goal(PeriodKind::Month, "2026-08", ProcessMetric::JournalDays, "2");
    b.goal(PeriodKind::Month, "2026-09", ProcessMetric::JournalDays, "2");
    assert_eq!(b.one(PeriodKind::Month, "2026-09", ProcessMetric::JournalDays, during()).streak, 2);
}

// --- Migration ------------------------------------------------------------------------------

#[test]
fn the_migration_adds_process_goals_and_keeps_existing_data() {
    let v = migrations::process_goals_version();
    let mut conn = Connection::open_in_memory().unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    migrations::migrate_to(&mut conn, v - 1).unwrap();
    let a = account(&conn, "10000");
    let i = instrument(&conn, "EURUSD", "1");
    let trade = trades::create(&conn, &TradeData::new(a, i, Dir::Long, dec("1"), dec("100"), at(2026, 9, 14, 9))).unwrap();
    crate::goals::set(&conn, &crate::goals::NewGoal { month: "2026-09".into(), metric: crate::goals::GoalMetric::NetPnl, target: dec("500") }).unwrap();
    crate::goals::set(&conn, &crate::goals::NewGoal { month: "2026-09".into(), metric: crate::goals::GoalMetric::DisciplineScore, target: dec("80") })
        .unwrap();
    conn.execute("INSERT INTO settings (key, value) VALUES ('behavior.max_trades_per_day', '3')", []).unwrap();
    let goals_before: Vec<(i64, String, String, String)> = conn
        .prepare("SELECT id, month, metric, target FROM goals ORDER BY id")
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();

    migrations::migrate_to(&mut conn, v).unwrap();
    assert_eq!(migrations::current_version(&conn).unwrap(), v);
    let goals_after: Vec<(i64, String, String, String)> = conn
        .prepare("SELECT id, month, metric, target FROM goals ORDER BY id")
        .unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    assert_eq!(goals_after, goals_before, "the result goals are untouched");
    assert_eq!(trades::get(&conn, trade.id).unwrap().data.account_id, a);
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM process_goals", [], |r| r.get(0)).unwrap();
    assert_eq!(count, 0, "starts empty");
    assert_eq!(settings::behavior(&conn).unwrap().max_trades_per_day, Some(3));
    // Usable at once, next to the result goals of the same month.
    set(&conn, &NewProcessGoal { period_kind: PeriodKind::Month, period_key: "2026-09".into(), metric: ProcessMetric::NoStopTrades, target: dec("0") })
        .unwrap();
    assert_eq!(crate::goals::list(&conn, "2026-09").unwrap().len(), 2);
    migrations::migrate(&mut conn).unwrap();
    assert_eq!(list(&conn, PeriodKind::Month, "2026-09").unwrap().len(), 1);
}
