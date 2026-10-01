//! Known-result tests for the behavioural analysis. Every expected value is
//! computed by hand in the comments (see CLAUDE.md, "Analyse comportementale").

use super::*;
use crate::instruments::AssetClass;
use crate::stats::{AccountCapital, Journal, Position, RuleCheckFact, StatsQuery};
use crate::test_support::dec;
use crate::trades::{Direction, PlanFollowed};

const DAY: i64 = 86_400_000;
const MIN: i64 = 60_000;
/// 2026-09-01 00:00 UTC (day 20697), a Tuesday.
const SEP_1: i64 = 20_697 * DAY;

use Direction::{Long, Short};

/// A trade on account 1, instrument 1, multiplier 1, entered `day` days after
/// 1 Sept at `entry` minutes after midnight UTC and closed at `exit` minutes.
#[allow(clippy::too_many_arguments)] // one argument per column of the journal tables below
pub(crate) fn trade(id: i64, direction: Direction, entry_price: &str, exit_price: Option<&str>, size: &str, sl: Option<&str>, day: i64, entry: i64, exit: i64) -> TradeFacts {
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
            entry_price: dec(entry_price),
            exit_price: exit_price.map(dec),
            planned_sl: sl.map(dec),
            planned_tp: None,
            fees: Decimal::ZERO,
        },
        entry_time: SEP_1 + day * DAY + entry * MIN,
        exit_time: exit_price.map(|_| SEP_1 + day * DAY + exit * MIN),
        tz_offset_min: 0,
        execution_type: None,
        tags: Vec::new(),
        journal: Journal::default(),
    }
}

pub(crate) fn ledger(initial: &str, trades: Vec<TradeFacts>) -> Ledger {
    Ledger {
        currency: Some("USD".into()),
        initial_capital: dec(initial),
        accounts: vec![AccountCapital { id: 1, initial_capital: dec(initial) }],
        capital_moves: Vec::new(),
        trades,
    }
}

pub(super) fn rule(id: i64, respected: bool) -> RuleCheckFact {
    RuleCheckFact { rule_id: id, text: format!("Rule {id}"), respected }
}

pub(crate) fn all() -> StatsQuery {
    StatsQuery::default()
}

/// Limit 1 % of the balance, 2 trades per day, revenge within 60 min at 1.5×.
pub(super) fn strict() -> BehaviorSettings {
    BehaviorSettings { max_risk_percent: Some(dec("1")), max_trades_per_day: Some(2), ..BehaviorSettings::default() }
}

#[track_caller]
pub(crate) fn approx(actual: Option<f64>, expected: f64) {
    let a = actual.unwrap_or_else(|| panic!("expected {expected}, got None"));
    assert!((a - expected).abs() < 1e-9, "expected {expected}, got {a}");
}

/// Journal D — capital 10 000, multiplier 1, settings [`strict`]:
///
/// | # | day | in → out     | side  | price       | size | SL  | net  | risk | balance at entry | plan    | rules | checklist |
/// |---|-----|--------------|-------|-------------|------|-----|------|------|------------------|---------|-------|-----------|
/// | 1 | 0   | 09:00→10:00  | long  | 100 → 110   | 10   | 95  | +100 | 50   | 10 000           | yes     | ✓ ✓   | 3/4       |
/// | 2 | 0   | 10:30→11:00  | long  | 50 → 45     | 30   | 45  | −150 | 150  | 10 100           | partial | ✗     | —         |
/// | 3 | 0   | 11:30→12:00  | long  | 100 → 104   | 20   | 95  | +80  | 100  | 9 950            | no      | —     | —         |
/// | 4 | 1   | 09:00→09:30  | short | 200 → 210   | 5    | 204 | −50  | 20   | 10 030           | yes     | ✓     | 4/4       |
/// | 5 | 1   | 09:45→10:15  | long  | 200 → 190   | 10   | 196 | −100 | 40   | 9 980            | —       | —     | —         |
/// | 6 | 2   | 09:00→10:00  | long  | 10 → 10     | 1    | —   | 0    | —    | 9 880            | yes     | —     | —         |
/// | 7 | 2   | 11:00 (open) | long  | 10          | 1    | —   |      |      |                  |         |       |           |
///
/// Trade 3 is the 3rd trade of its day (limit 2): overtrading. Trade 5 follows
/// the loss of trade 4 by 15 min with twice its risk (40 vs 20): revenge.
pub(super) fn journal_d() -> Vec<TradeFacts> {
    let mut t = vec![
        trade(1, Long, "100", Some("110"), "10", Some("95"), 0, 9 * 60, 10 * 60),
        trade(2, Long, "50", Some("45"), "30", Some("45"), 0, 10 * 60 + 30, 11 * 60),
        trade(3, Long, "100", Some("104"), "20", Some("95"), 0, 11 * 60 + 30, 12 * 60),
        trade(4, Short, "200", Some("210"), "5", Some("204"), 1, 9 * 60, 9 * 60 + 30),
        trade(5, Long, "200", Some("190"), "10", Some("196"), 1, 9 * 60 + 45, 10 * 60 + 15),
        trade(6, Long, "10", Some("10"), "1", None, 2, 9 * 60, 10 * 60),
        trade(7, Long, "10", None, "1", None, 2, 11 * 60, 0),
    ];
    t[0].journal = Journal {
        plan_followed: Some(PlanFollowed::Yes),
        rule_checks: vec![rule(1, true), rule(2, true)],
        checklist_checked: 3,
        checklist_total: 4,
        ..Journal::default()
    };
    t[1].journal = Journal { plan_followed: Some(PlanFollowed::Partial), rule_checks: vec![rule(1, false)], ..Journal::default() };
    t[2].journal.plan_followed = Some(PlanFollowed::No);
    t[3].journal = Journal {
        plan_followed: Some(PlanFollowed::Yes),
        rule_checks: vec![rule(2, true)],
        checklist_checked: 4,
        checklist_total: 4,
        ..Journal::default()
    };
    t[5].journal.plan_followed = Some(PlanFollowed::Yes);
    t
}

/// Scores of journal D (weights plan 30, rules 25, checklist 15, SL 10, risk 10, behaviour 10):
/// 1: 30 + 25 + 0.75 × 15 + 10 + 10 + 10 = 96.25 (all six components)
/// 2: (0.5 × 30 + 0 + 10 + 0 + 10) / 85 × 100 = 3500 / 85 (no checklist; risk 150 > 1 % of 10 100)
/// 3: (0 + 10 + 0 + 0) / 60 × 100 = 50 / 3 (risk 100 > 99.5; overtrading)
/// 4: 100
/// 5: (10 + 10 + 0) / 30 × 100 = 200 / 3 (revenge)
/// 6: (30 + 0 + 10) / 50 × 100 = 80 (no stop: SL 0, risk left out)
const D_SCORES: [f64; 6] = [96.25, 3500.0 / 85.0, 50.0 / 3.0, 100.0, 200.0 / 3.0, 80.0];

fn values(t: &TradeDiscipline) -> Vec<Option<f64>> {
    t.components.iter().map(|c| c.value).collect()
}

#[test]
fn each_trade_is_scored_from_its_components() {
    let r = discipline(&ledger("10000", journal_d()), &all(), &strict()).unwrap();
    assert_eq!(r.trades.iter().map(|t| t.trade_id).collect::<Vec<_>>(), [1, 2, 3, 4, 5, 6], "closed trades only, exit order");
    for (t, expected) in r.trades.iter().zip(D_SCORES) {
        approx(t.score, expected);
    }
    let [t1, t2, t3, t4, t5, t6] = [0, 1, 2, 3, 4, 5].map(|i| &r.trades[i]);
    assert_eq!(values(t1), [Some(1.0), Some(1.0), Some(0.75), Some(1.0), Some(1.0), Some(1.0)]);
    assert_eq!(values(t2), [Some(0.5), Some(0.0), None, Some(1.0), Some(0.0), Some(1.0)]);
    assert_eq!(values(t3), [Some(0.0), None, None, Some(1.0), Some(0.0), Some(0.0)]);
    assert_eq!(values(t6), [Some(1.0), None, None, Some(0.0), None, Some(1.0)]);
    // Coverage = weights with data / 100.
    let coverage: Vec<f64> = r.trades.iter().map(|t| t.coverage).collect();
    assert_eq!(coverage, [1.0, 0.85, 0.6, 1.0, 0.3, 0.5]);
    // Explainable detail.
    assert_eq!((t1.rules_checked, t1.rules_respected, t1.checklist_checked, t1.checklist_total), (2, 2, 3, 4));
    approx(t1.risk_pct, 50.0 / 10_000.0);
    approx(t2.risk_pct, 150.0 / 10_100.0);
    approx(t3.risk_pct, 100.0 / 9_950.0);
    assert_eq!((t6.has_stop_loss, t6.risk_pct), (false, None));
    assert_eq!((t3.day_rank, t3.overtrading, t3.revenge.is_none()), (3, true, true));
    assert_eq!((t4.day_rank, t4.day.as_deref(), t4.net_pnl, t4.outcome), (1, Some("2026-09-02"), Some(dec("-50")), Some(Outcome::Loss)));
    let revenge = t5.revenge.as_ref().unwrap();
    assert_eq!((revenge.previous_trade_id, revenge.gap_ms, revenge.basis), (4, 15 * MIN, ExposureBasis::Risk));
    approx(revenge.ratio, 2.0);
    assert!(!t5.overtrading);
}

#[test]
fn period_score_components_days_and_quadrants() {
    let r = discipline(&ledger("10000", journal_d()), &all(), &strict()).unwrap();
    // Mean of the six trade scores ≈ 66.79.
    approx(r.score, D_SCORES.iter().sum::<f64>() / 6.0);
    assert_eq!((r.scored_trade_count, r.min_trade_count, r.sample_too_small), (6, 5, false));
    // Components: plan (1 + 0.5 + 0 + 1 + 1) / 5; rules (1 + 0 + 1) / 3; checklist (0.75 + 1) / 2;
    // SL 5 / 6; risk (1 + 0 + 0 + 1 + 1) / 5; behaviour 4 / 6.
    let comp: Vec<(usize, Option<f64>)> = r.components.iter().map(|c| (c.trade_count, c.average)).collect();
    let expected = [(5, 0.7), (3, 2.0 / 3.0), (2, 0.875), (6, 5.0 / 6.0), (5, 0.6), (6, 4.0 / 6.0)];
    for ((n, avg), (en, eavg)) in comp.into_iter().zip(expected) {
        assert_eq!(n, en);
        approx(avg, eavg);
    }
    // Days (local exit day): day 0 = trades 1–3, day 1 = trades 4–5, day 2 = trade 6.
    assert_eq!(r.days.iter().map(|d| (d.day.as_str(), d.trade_count)).collect::<Vec<_>>(), [("2026-09-01", 3), ("2026-09-02", 2), ("2026-09-03", 1)]);
    approx(r.days[0].score, (D_SCORES[0] + D_SCORES[1] + D_SCORES[2]) / 3.0);
    approx(r.days[1].score, 250.0 / 3.0); // (100 + 66.67) / 2
    approx(r.days[2].score, 80.0);
    // Quadrants (well executed ≥ 70): win 96.25 well; win 16.7 badly; loss 100 well; losses 41.2 and 66.7 badly.
    let q = &r.quadrants;
    let cell = |c: &Quadrant| (c.count, c.net_pnl);
    assert_eq!(cell(&q.well_executed_wins), (1, dec("100")));
    assert_eq!(cell(&q.poorly_executed_wins), (1, dec("80")));
    assert_eq!(cell(&q.well_executed_losses), (1, dec("-50")));
    assert_eq!(cell(&q.poorly_executed_losses), (2, dec("-250")));
    assert_eq!(cell(&q.breakevens), (1, dec("0")));
}

#[test]
fn without_thresholds_risk_is_left_out_and_nobody_overtrades() {
    let r = discipline(&ledger("10000", journal_d()), &all(), &BehaviorSettings::default()).unwrap();
    let t3 = &r.trades[2];
    // Trade 3: plan 0, SL 1, behaviour 1 → (0 + 10 + 10) / 50 = 40.
    assert_eq!((t3.overtrading, values(t3)[4]), (false, None));
    approx(t3.score, 40.0);
    assert_eq!(r.components[4].trade_count, 0);
    assert_eq!(r.components[4].average, None);
    // The revenge window and factor have defaults: trade 5 is still a revenge trade.
    assert!(r.trades[4].revenge.is_some());
}

#[test]
fn a_single_component_and_no_component() {
    let only_plan = [
        Component { key: ComponentKey::Plan, weight: 30, value: Some(0.5) },
        Component { key: ComponentKey::Rules, weight: 25, value: None },
    ];
    let (s, coverage) = score(&only_plan);
    approx(s, 50.0);
    assert_eq!(coverage, 30.0 / 55.0);
    let nothing = [Component { key: ComponentKey::Rules, weight: 25, value: None }];
    assert_eq!(score(&nothing), (None, 0.0));
    assert_eq!(score(&[]), (None, 0.0));
    assert_eq!(WEIGHTS.iter().map(|(_, w)| w).sum::<u32>(), 100);
}

#[test]
fn small_sample_and_empty_period() {
    // Day 0 only: 3 trades < 5 → no period score, but every trade keeps its score.
    let q = StatsQuery { from: Some(SEP_1), to: Some(SEP_1 + DAY), ..all() };
    let r = discipline(&ledger("10000", journal_d()), &q, &strict()).unwrap();
    assert_eq!((r.score, r.scored_trade_count, r.sample_too_small), (None, 3, true));
    approx(r.trades[0].score, 96.25);
    approx(r.days[0].score, (D_SCORES[0] + D_SCORES[1] + D_SCORES[2]) / 3.0);
    // History outside the window still counts: trade 3 stays the 3rd trade of its day.
    assert!(r.trades[2].overtrading);

    let empty = discipline(&ledger("10000", vec![]), &all(), &strict()).unwrap();
    assert_eq!((empty.score, empty.scored_trade_count, empty.sample_too_small), (None, 0, true));
    assert!(empty.trades.is_empty() && empty.days.is_empty());
    assert!(empty.components.iter().all(|c| c.trade_count == 0 && c.average.is_none()));
    assert_eq!(empty.quadrants.breakevens.count, 0);
    let none = discipline(&Ledger::default(), &all(), &strict()).unwrap();
    assert_eq!(none.score, None);
}

#[test]
fn revenge_on_size_and_its_boundaries() {
    // No stop: compared on size × multiplier, same instrument only.
    let pair = |size: &str, gap_min: i64, instrument: i64| {
        let loss = trade(1, Long, "100", Some("90"), "2", None, 0, 9 * 60, 10 * 60);
        let mut next = trade(2, Long, "100", Some("101"), size, None, 0, 10 * 60 + gap_min, 11 * 60 + gap_min);
        next.instrument_id = instrument;
        let l = ledger("1000", vec![loss, next]);
        let ctx = Context::new(&l, BehaviorSettings::default()).unwrap();
        ctx.revenge(&l.trades[1]).unwrap()
    };
    // 3 = 1.5 × 2 exactly, 60 min exactly: both limits are inclusive.
    let r = pair("3", 60, 1).unwrap();
    assert_eq!((r.basis, r.previous_trade_id, r.gap_ms), (ExposureBasis::Size, 1, 60 * MIN));
    approx(r.ratio, 1.5);
    assert!(pair("2.9", 60, 1).is_none(), "below the factor");
    assert!(pair("3", 61, 1).is_none(), "outside the window");
    assert!(pair("30", 5, 2).is_none(), "another instrument without stop cannot be compared");

    // After a win or a breakeven: never a revenge trade.
    let win = trade(1, Long, "100", Some("110"), "1", None, 0, 9 * 60, 10 * 60);
    let big = trade(2, Long, "100", Some("90"), "10", None, 0, 10 * 60 + 1, 11 * 60);
    let l = ledger("1000", vec![win, big]);
    assert!(Context::new(&l, BehaviorSettings::default()).unwrap().revenge(&l.trades[1]).unwrap().is_none());
}

#[test]
fn history_is_per_account() {
    // Account 2 trades the same day: it neither pushes trade 3 further nor becomes its "previous" trade.
    let mut trades = journal_d();
    let mut other = trade(20, Long, "10", Some("5"), "100", None, 0, 8 * 60, 11 * 60 + 20);
    other.account_id = 2;
    trades.push(other);
    let mut l = ledger("10000", trades);
    l.accounts.push(AccountCapital { id: 2, initial_capital: dec("500") });
    let r = discipline(&l, &StatsQuery { account_ids: vec![], ..all() }, &strict()).unwrap();
    let t3 = r.trades.iter().find(|t| t.trade_id == 3).unwrap();
    assert_eq!(t3.day_rank, 3);
    approx(t3.risk_pct, 100.0 / 9_950.0);
    let t20 = r.trades.iter().find(|t| t.trade_id == 20).unwrap();
    assert_eq!((t20.day_rank, t20.risk_pct), (1, None));
}

mod from_db {
    use super::*;
    use crate::cash_flows::{self, CashFlowKind, NewCashFlow};
    use crate::test_support::{account, instrument};
    use crate::trades::{self, ChecklistAnswer, RuleCheck, TradeData};
    use crate::{db, rules, settings};

    #[test]
    fn journal_rules_checklist_and_settings_come_from_the_database() {
        let conn = db::open_in_memory().unwrap();
        let a = account(&conn, "10000");
        let b = account(&conn, "100");
        let i = instrument(&conn, "TEST", "1");
        let r1 = rules::create(&conn, "Max 2 trades per day").unwrap();
        let r2 = rules::create(&conn, "No trading after 15:00").unwrap();
        settings::set_behavior(&conn, &strict()).unwrap();
        // Trade 1 of journal D, through the API.
        let mut t = TradeData::new(a, i, Long, dec("10"), dec("100"), SEP_1 + 9 * 60 * MIN);
        t.exit_price = Some(dec("110"));
        t.exit_time = Some(SEP_1 + 10 * 60 * MIN);
        t.planned_sl = Some(dec("95"));
        t.plan_followed = Some(PlanFollowed::Yes);
        t.rule_checks = vec![RuleCheck { rule_id: r1.id, respected: true }, RuleCheck { rule_id: r2.id, respected: true }];
        t.checklist = ["Setup", "Stop", "News", "Size"]
            .iter()
            .enumerate()
            .map(|(k, label)| ChecklistAnswer { item_id: None, label: (*label).into(), checked: k < 3 })
            .collect();
        let t1 = trades::create(&conn, &t).unwrap().id;
        let d = trade_discipline(&conn, t1).unwrap();
        approx(d.score, 96.25);
        assert_eq!((d.rules_checked, d.checklist_checked, d.checklist_total, d.plan_followed), (2, 3, 4, Some(PlanFollowed::Yes)));

        // A deposit before the entry of an open trade raises its balance: 150 / (10 100 + 900) of risk.
        cash_flows::create(
            &conn,
            &NewCashFlow { account_id: a, kind: CashFlowKind::Deposit, amount: dec("900"), occurred_at: SEP_1 + 10 * 60 * MIN, tz_offset_min: 0, note: String::new() },
        )
        .unwrap();
        let mut open = TradeData::new(a, i, Long, dec("30"), dec("50"), SEP_1 + 11 * 60 * MIN);
        open.planned_sl = Some(dec("45"));
        let open = trades::create(&conn, &open).unwrap().id;
        let d = trade_discipline(&conn, open).unwrap();
        approx(d.risk_pct, 150.0 / 11_000.0);
        assert_eq!((d.exit_time, d.outcome, d.day_rank), (None, None, 2));
        // 150 × 100 = 15 000 > 1 × 11 000: over the limit. Score (10 + 0 + 10) / 30 × 100.
        approx(d.score, 200.0 / 3.0);

        // Another account the same day does not change the rank on the first one.
        trades::create(&conn, &TradeData::new(b, i, Long, dec("1"), dec("10"), SEP_1 + 8 * 60 * MIN)).unwrap();
        assert_eq!(trade_discipline(&conn, open).unwrap().day_rank, 2);

        let report = discipline_report(&conn, &StatsQuery { account_ids: vec![a], ..all() }).unwrap();
        assert_eq!((report.trades.len(), report.score, report.sample_too_small), (1, None, true));
        assert_eq!(report.settings, strict());
        assert!(matches!(trade_discipline(&conn, 999), Err(crate::CoreError::NotFound(_))));
    }
}
