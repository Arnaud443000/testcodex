//! Known-result tests for the insights (see CLAUDE.md, "Insights automatiques
//! (lot 19)"). Every expected value is computed by hand in the comments. All
//! trades are longs entered at 100 with a stop at 90 (risk = 10 × size),
//! multiplier 1, so R = (exit − 100) / 10 before fees.

use super::*;
use crate::instruments::AssetClass;
use crate::journal::JournalEntry;
use crate::rules::Rule;
use crate::stats::{Journal, Position, RuleCheckFact, TagRef, TradeFacts};
use crate::tags::TagKind;
use crate::test_support::dec;
use crate::trades::{Direction, EmotionMoment, PlanFollowed};

const DAY: i64 = 86_400_000;
const HOUR: i64 = 3_600_000;
/// Tuesday 2026-09-29 00:00 UTC ("today").
const TUE: i64 = 20_725 * DAY;
const NOW: i64 = TUE + 20 * HOUR;

/// Account 1, entered on day `day` (0 = today, −1 = yesterday…) at 09:00 UTC, closed at 10:00.
fn trade(id: i64, day: i64, size: &str, exit: &str) -> TradeFacts {
    TradeFacts {
        id,
        account_id: 1,
        instrument_id: 1,
        symbol: "TEST".into(),
        asset_class: AssetClass::Other,
        position: Position {
            direction: Direction::Long,
            size: dec(size),
            multiplier: Decimal::ONE,
            entry_price: dec("100"),
            exit_price: Some(dec(exit)),
            planned_sl: Some(dec("90")),
            planned_tp: None,
            fees: Decimal::ZERO,
        },
        entry_time: TUE + day * DAY + 9 * HOUR,
        exit_time: Some(TUE + day * DAY + 10 * HOUR),
        tz_offset_min: 0,
        execution_type: None,
        tags: Vec::new(),
        journal: Journal::default(),
    }
}

fn ledger(trades: Vec<TradeFacts>) -> Ledger {
    let mut accounts: Vec<i64> = trades.iter().map(|t| t.account_id).collect();
    accounts.sort();
    accounts.dedup();
    if accounts.is_empty() {
        accounts.push(1);
    }
    Ledger {
        currency: Some("USD".into()),
        initial_capital: dec("10000") * Decimal::from(accounts.len()),
        accounts: accounts.iter().map(|&id| AccountCapital { id, initial_capital: dec("10000") }).collect(),
        capital_moves: Vec::new(),
        trades,
    }
}

fn run_with(l: &Ledger, now: i64, settings: &BehaviorSettings, journal: &[JournalEntry], rules: &[Rule]) -> Vec<Insight> {
    evaluate(l, now, 0, settings, journal, rules).unwrap()
}

fn run(l: &Ledger) -> Vec<Insight> {
    run_with(l, NOW, &BehaviorSettings::default(), &[], &[])
}

fn keys(v: &[Insight]) -> Vec<&'static str> {
    v.iter().map(|i| i.message_key).collect()
}

fn find<'a>(v: &'a [Insight], key: &str) -> &'a Insight {
    v.iter().find(|i| i.message_key == key).unwrap_or_else(|| panic!("no {key} in {:?}", keys(v)))
}

#[track_caller]
fn approx(actual: f64, expected: f64) {
    assert!((actual - expected).abs() < 1e-9, "expected {expected}, got {actual}");
}

fn tag(id: i64, kind: TagKind, name: &str) -> TagRef {
    TagRef { id, kind, name: name.into() }
}

// --- 3.5.1 Trends ---------------------------------------------------------------------------

/// Journal R — 20 trades, one per day (days −19 … 0), all closed at 100 (net 0, so the balance
/// stays 10 000). Trades 1–10: size 10 → risk 100 → 1 % ; trades 11–20: size `recent` → risk 10 × size.
fn journal_r(recent: &str) -> Vec<TradeFacts> {
    (1..=20).map(|i| trade(i, i - 20, if i <= 10 { "10" } else { recent }, "100")).collect()
}

#[test]
fn risk_drift_up_on_the_last_twenty_trades() {
    // Recent risk 123 → 1.23 %: change = 1.23 / 1 − 1 = +23 % ≥ 20 % → up, level ⌊2.3⌋ = 2.
    let v = run(&ledger(journal_r("12.3")));
    assert_eq!(keys(&v), ["riskDrift.up"], "nothing else: breakevens, score 100 everywhere, no tags");
    let i = &v[0];
    assert_eq!((i.situation.as_str(), i.level, i.id.as_str()), ("riskDrift:1:up", 2, "riskDrift:1:up:2"));
    assert_eq!((i.priority, i.category, i.source), (Priority::High, Category::Trend, Source::Risk));
    assert_eq!(i.trade_ids, (1..=20).collect::<Vec<_>>());
    assert_eq!(i.period, InsightPeriod { basis: PeriodBasis::LastTrades, from: Some(TUE - 19 * DAY + 10 * HOUR), to: Some(TUE + 10 * HOUR), trade_count: 20, days: None });
    let InsightDetail::RiskDrift { direction, older, recent, older_avg_risk_pct, recent_avg_risk_pct, change, older_avg_risk, recent_avg_risk, risk_change, threshold } = &i.detail else {
        panic!("{:?}", i.detail)
    };
    assert_eq!(*direction, Drift::Up);
    assert_eq!((older.trade_count, older.value_count, older.trade_ids.clone()), (10, 10, (1..=10).collect::<Vec<_>>()));
    assert_eq!((recent.trade_count, recent.from, recent.to), (10, TUE - 9 * DAY + 10 * HOUR, TUE + 10 * HOUR));
    approx(*older_avg_risk_pct, 0.01);
    approx(*recent_avg_risk_pct, 0.0123);
    approx(*change, 0.23);
    assert_eq!((*older_avg_risk, *recent_avg_risk), (dec("100"), dec("123")));
    approx(risk_change.unwrap(), 0.23);
    approx(*threshold, 0.20);
}

#[test]
fn risk_drift_threshold_down_and_too_small_samples() {
    // Exactly +20 % (size 12 → 1.2 %): reached, level 2. +19 % (size 11.9): nothing.
    let v = run(&ledger(journal_r("12")));
    assert_eq!((keys(&v), v[0].level), (vec!["riskDrift.up"], 2));
    assert!(run(&ledger(journal_r("11.9"))).is_empty());
    // Size 7.5 → 0.75 %: −25 % → down, low priority, level 2.
    let v = run(&ledger(journal_r("7.5")));
    assert_eq!((keys(&v), v[0].priority, v[0].situation.as_str(), v[0].level), (vec!["riskDrift.down"], Priority::Low, "riskDrift:1:down", 2));
    // Nine trades: two halves of 4 < 5 → no trend at all.
    let mut nine = journal_r("12.3");
    nine.retain(|t| t.id > 11);
    assert!(run(&ledger(nine)).is_empty());
    // Twenty trades, but only 4 of the recent half have a stop: no risk drift. The 6 trades
    // without stop score (0 + 10) / 20 = 50, the others 100: recent mean (4 × 100 + 6 × 50) / 10
    // = 70 against 100 → discipline −30 points (level 3).
    let mut t = journal_r("12.3");
    for x in &mut t[14..] {
        x.position.planned_sl = None;
    }
    let v = run(&ledger(t));
    assert_eq!(keys(&v), ["disciplineTrend.down"]);
    let InsightDetail::DisciplineTrend { older_score, recent_score, difference, .. } = &v[0].detail else { panic!() };
    approx(*older_score, 100.0);
    approx(*recent_score, 70.0);
    approx(*difference, -30.0);
    assert_eq!(v[0].level, 3);
}

#[test]
fn a_trend_disappears_once_the_situation_settles_and_accounts_stay_apart() {
    // Ten more trades at 1.23 % (days 1–10): the last twenty are all at 1.23 % → no drift.
    let mut t = journal_r("12.3");
    t.extend((21..=30).map(|i| trade(i, i - 20, "12.3", "100")));
    assert!(run_with(&ledger(t), NOW + 10 * DAY, &BehaviorSettings::default(), &[], &[]).is_empty());

    // Account 2 trades at 1 % only, at 11:00 the same days: its insights never mix with account 1's.
    let mut both = journal_r("12.3");
    both.extend((101..=120).map(|i| {
        let mut x = trade(i, i - 120, "10", "100");
        x.account_id = 2;
        x.entry_time += 2 * HOUR;
        x.exit_time = x.exit_time.map(|e| e + 2 * HOUR);
        x
    }));
    let v = run(&ledger(both.clone()));
    assert_eq!(v.iter().map(|i| (i.account_id, i.message_key)).collect::<Vec<_>>(), [(1, "riskDrift.up")]);
    assert_eq!(v[0].trade_ids, (1..=20).collect::<Vec<_>>(), "account 2's trades are not in account 1's window");
    // The same trades on a single account: the last twenty mix both (ten at 1 % of each… by exit order,
    // days −9 … 0 of both accounts) → 1 % and 1.23 % alternate in both halves: no drift.
    for x in &mut both {
        x.account_id = 1;
    }
    assert!(run(&ledger(both)).iter().all(|i| i.message_key != "riskDrift.up"));
}

/// Journal P — 20 trades at size 1 closed at 100 (score components: plan, stop 1, behaviour 1).
/// Trades 1–10 plan `older`, trades 11–20 alternate `recent_odd` / `recent_even`.
fn journal_p(older: PlanFollowed, recent: [PlanFollowed; 2]) -> Vec<TradeFacts> {
    (1..=20)
        .map(|i| {
            let mut t = trade(i, i - 20, "1", "100");
            t.journal.plan_followed = Some(if i <= 10 { older } else { recent[(i % 2) as usize] });
            t
        })
        .collect()
}

#[test]
fn discipline_and_plan_trends() {
    use PlanFollowed::{Partial, Yes};
    // Scores: plan yes (30 + 10 + 10) / 50 = 100 ; partial (15 + 20) / 50 = 70.
    // Recent half: 5 partial + 5 yes → 85 against 100 → −15 points (level 1).
    // Plan component: 0.75 against 1 → −0.25, exactly the threshold (level ⌊2.5⌋ = 2).
    let v = run(&ledger(journal_p(Yes, [Partial, Yes])));
    assert_eq!(keys(&v), ["disciplineTrend.down", "planDrop"], "high priority first");
    let InsightDetail::DisciplineTrend { direction, difference, older, recent, .. } = &v[0].detail else { panic!() };
    assert_eq!((*direction, older.value_count, recent.value_count, v[0].level), (Drift::Down, 10, 10, 1));
    approx(*difference, -15.0);
    let InsightDetail::PlanDrop { older_rate, recent_rate, difference, .. } = &v[1].detail else { panic!() };
    approx(*older_rate, 1.0);
    approx(*recent_rate, 0.75);
    approx(*difference, -0.25);
    assert_eq!((v[1].priority, v[1].level, v[1].source), (Priority::Medium, 2, Source::Discipline));

    // The other way round: discipline +15 → `up` (low priority); a rising plan is not an insight.
    let v = run(&ledger(journal_p(Partial, [Partial, Yes])));
    assert_eq!(keys(&v), ["disciplineTrend.up"]);
    assert_eq!(v[0].priority, Priority::Low);

    // Plan undeclared on the recent half: no plan values there → no plan insight; the score
    // without plan is (10 + 10) / 20 = 100 → no discipline trend either.
    let mut t = journal_p(Yes, [Yes, Yes]);
    for x in &mut t[10..] {
        x.journal.plan_followed = None;
    }
    assert!(run(&ledger(t)).is_empty());
}

#[test]
fn fees_rising_by_a_quarter() {
    // Journal F — 20 trades at size 1 closed at 100, fees 2 (trades 1–10) then 2.5 (11–20):
    // +25 % exactly → feesUp, level 1. Net −2 / −2.5: every trade is a loss, but the exposure never
    // changes (no size insight), the trades are a day apart (no revenge) and the risk % moves by
    // less than 1 % (balance 10 000 → 9 955).
    let t: Vec<TradeFacts> = (1..=20)
        .map(|i| {
            let mut t = trade(i, i - 20, "1", "100");
            t.position.fees = dec(if i <= 10 { "2" } else { "2.5" });
            t
        })
        .collect();
    let v = run(&ledger(t.clone()));
    assert_eq!(keys(&v), ["feesUp"]);
    let InsightDetail::FeesUp { older_avg_fees, recent_avg_fees, change, .. } = &v[0].detail else { panic!() };
    assert_eq!((*older_avg_fees, *recent_avg_fees, v[0].level, v[0].source), (dec("2"), dec("2.5"), 1, Source::Fees));
    approx(*change, 0.25);
    // No fees before: the change is undefined → nothing.
    let mut free = t;
    for x in &mut free[..10] {
        x.position.fees = Decimal::ZERO;
    }
    assert!(run(&ledger(free)).is_empty());
}

#[test]
fn a_rule_respected_less_often() {
    // Journal G — 12 trades closed at 100 (breakeven: no mistake has a cost).
    // Rule 1 on all 12: respected on 1–8, broken on 9–12 → trend = 2/6 − 6/6 = −0.6667 (level 6).
    // Rule 2 on all 12, always respected → trend 0. Rule 3 on 5–12 (8 checks < 10): ignored.
    let rules: Vec<Rule> = (1..=3).map(|id| Rule { id, text: format!("Règle {id}"), archived: false, position: id }).collect();
    let t: Vec<TradeFacts> = (1..=12)
        .map(|i| {
            let mut t = trade(i, i - 12, "1", "100");
            t.journal.rule_checks.push(RuleCheckFact { rule_id: 1, text: "Règle 1".into(), respected: i <= 8 });
            t.journal.rule_checks.push(RuleCheckFact { rule_id: 2, text: "Règle 2".into(), respected: true });
            if i >= 5 {
                t.journal.rule_checks.push(RuleCheckFact { rule_id: 3, text: "Règle 3".into(), respected: i <= 8 });
            }
            t
        })
        .collect();
    let v = run_with(&ledger(t), NOW, &BehaviorSettings::default(), &[], &rules);
    // Discipline (halves of 6): trades 1–8 score 100; 9–12: rules 1/3 → (25/3 + 20) / 45 = 62.963.
    // Recent (7–12): (2 × 100 + 4 × 62.963) / 6 = 75.309 → −24.69 points.
    assert_eq!(keys(&v), ["disciplineTrend.down", "ruleAdherenceDrop"]);
    approx(match &v[0].detail {
        InsightDetail::DisciplineTrend { difference, .. } => *difference,
        _ => panic!(),
    }, (2.0 * 100.0 + 4.0 * (100.0 * (25.0 / 3.0 + 20.0) / 45.0)) / 6.0 - 100.0);
    let r = &v[1];
    let InsightDetail::RuleAdherenceDrop { rule_id, checks, respected, rate, trend, .. } = &r.detail else { panic!() };
    assert_eq!((*rule_id, *checks, *respected, r.level, r.situation.as_str()), (1, 12, 8, 6, "ruleAdherenceDrop:1:1"));
    approx(rate.unwrap(), 8.0 / 12.0);
    approx(*trend, 2.0 / 6.0 - 1.0);
    assert_eq!(r.filter, Some(EvidenceFilter::Mistake { source: MistakeSource::Rule, id: 1 }));
    assert_eq!(r.trade_ids, (1..=12).collect::<Vec<_>>());
    assert_eq!(r.period, InsightPeriod { basis: PeriodBasis::Days, from: Some(TUE - 89 * DAY), to: Some(TUE + DAY), trade_count: 12, days: Some(90) });
}

/// Journal S — losses at size 1 (exit 90, −10) and wins at size 1.3 (exit 110, +13), alternating from
/// a loss, one trade a day: after each loss the risk goes 10 → 13 (+30 %), after each win 13 → 10 (−23.08 %).
fn journal_s(n: i64) -> Vec<TradeFacts> {
    (1..=n).map(|i| if i % 2 == 1 { trade(i, i - n, "1", "90") } else { trade(i, i - n, "1.3", "110") }).collect()
}

#[test]
fn size_up_after_a_loss() {
    // 11 trades: 5 cases after a loss (+30 %), 5 after a win (10 / 13 − 1): lossVsWin = 0.3 + 3/13 = 0.5308 (level 5).
    let v = run(&ledger(journal_s(11)));
    assert_eq!(keys(&v), ["sizeUpAfterLoss"]);
    let InsightDetail::SizeUpAfterLoss { after_loss_mean, after_win_mean, loss_vs_win, after_loss_cases, after_win_cases, increased_count, .. } = &v[0].detail else {
        panic!()
    };
    approx(*after_loss_mean, 0.3);
    approx(*after_win_mean, 10.0 / 13.0 - 1.0);
    approx(*loss_vs_win, 0.3 - (10.0 / 13.0 - 1.0));
    assert_eq!((*after_loss_cases, *after_win_cases, *increased_count, v[0].level), (5, 5, 5, 5));
    assert_eq!((v[0].trade_ids.clone(), v[0].priority), (vec![2, 4, 6, 8, 10], Priority::High));
    // 9 trades: 4 cases on each side → the report has no mean → nothing.
    assert!(run(&ledger(journal_s(9))).is_empty());
}

/// Journal V — per day: a loss at size 1 (09:00 → 09:30, exit 90), then 15 minutes later a trade at
/// size 2 (09:45 → 10:30, exit 90, −20): twice the risk of the loss → revenge; with a limit of one
/// trade a day, the second trade is also overtrading.
fn journal_v(days: &[i64]) -> Vec<TradeFacts> {
    let mut out = Vec::new();
    for (k, &day) in days.iter().enumerate() {
        let id = 2 * k as i64 + 1;
        let mut first = trade(id, day, "1", "90");
        first.exit_time = Some(TUE + day * DAY + 9 * HOUR + 30 * 60_000);
        let mut second = trade(id + 1, day, "2", "90");
        second.entry_time = TUE + day * DAY + 9 * HOUR + 45 * 60_000;
        second.exit_time = Some(TUE + day * DAY + 10 * HOUR + 30 * 60_000);
        out.extend([first, second]);
    }
    out
}

#[test]
fn revenge_and_overtrading_repeated_over_the_window() {
    let limit = BehaviorSettings { max_trades_per_day: Some(1), ..BehaviorSettings::default() };
    let v = run_with(&ledger(journal_v(&[-3, -1])), NOW, &limit, &[], &[]);
    assert_eq!(keys(&v), ["revengePattern", "overtradingPattern"]);
    let InsightDetail::RevengePattern { count, net_pnl, win_rate, window_min, size_factor, .. } = &v[0].detail else { panic!() };
    assert_eq!((*count, *net_pnl, *window_min, *size_factor, v[0].level), (2, dec("-40"), 60, dec("1.5"), 2));
    approx(win_rate.unwrap(), 0.0);
    assert_eq!(v[0].trade_ids, [2, 4]);
    let InsightDetail::OvertradingPattern { day_count, limit: l, days, trade_count, .. } = &v[1].detail else { panic!() };
    assert_eq!((*day_count, *l, days.clone(), *trade_count), (2, 1, vec!["2026-09-26".to_string(), "2026-09-28".to_string()], 2));

    // A single revenge trade (and a single overtrading day): below the minimum of 2 → nothing.
    assert!(run_with(&ledger(journal_v(&[-3])), NOW, &limit, &[], &[]).is_empty());
    // 100 days later, the trades are out of the 90-day window: the insights are gone.
    assert!(run_with(&ledger(journal_v(&[-3, -1])), NOW + 100 * DAY, &limit, &[], &[]).is_empty());
    // Without a daily limit, no overtrading.
    assert_eq!(keys(&run(&ledger(journal_v(&[-3, -1])))), ["revengePattern"]);
}

// --- 3.5.2 Best / weakest segment ------------------------------------------------------------

/// Journal B — 25 trades, one a day (days −24 … 0), size 1:
/// setup Breakout (10): exits 120 × 6 (+2 R) and 95 × 4 (−0.5 R) → expectancy (12 − 2) / 10 = 1.0;
/// setup Range (10): exits 110 × 3 (+1 R) and 90 × 7 (−1 R) → −0.4;
/// setup News (3): exits 130 (+3 R) → 3.0, but only 3 trades with an R (not eligible);
/// no setup (2): exits 100 (0 R).
/// Baseline: (10 − 4 + 9 + 0) / 25 = 0.6. Sessions: Breakout and News in Londres
/// (13 trades, (10 + 9) / 13 = 1.4615), Range and the others in New York (12, −4 / 12 = −0.3333).
fn journal_b(with_range: bool) -> Vec<TradeFacts> {
    let breakout = tag(10, TagKind::Setup, "Breakout");
    let range = tag(11, TagKind::Setup, "Range");
    let news = tag(12, TagKind::Setup, "News");
    let london = tag(20, TagKind::Session, "Londres");
    let new_york = tag(21, TagKind::Session, "New York");
    let mut plan: Vec<(&str, Vec<TagRef>)> = Vec::new();
    for k in 0..10 {
        plan.push((if k < 6 { "120" } else { "95" }, vec![breakout.clone(), london.clone()]));
        if with_range {
            plan.push((if k < 3 { "110" } else { "90" }, vec![range.clone(), new_york.clone()]));
        }
    }
    for _ in 0..3 {
        plan.push(("130", vec![news.clone(), london.clone()]));
    }
    for _ in 0..2 {
        plan.push(("100", vec![new_york.clone()]));
    }
    let n = plan.len() as i64;
    plan.into_iter()
        .enumerate()
        .map(|(k, (exit, tags))| {
            let mut t = trade(k as i64 + 1, k as i64 + 1 - n, "1", exit);
            t.tags = tags;
            t
        })
        .collect()
}

#[test]
fn best_and_weakest_setup_and_session() {
    let v = run(&ledger(journal_b(true)));
    // Nothing else stands out: same risk on every trade (balances move by less than 1 %), score 100.
    assert_eq!(keys(&v), ["weakSegment.setup", "weakSegment.session", "bestSegment.setup", "bestSegment.session"]);
    let get = |key: &str| match &find(&v, key).detail {
        InsightDetail::BestSegment(h) | InsightDetail::WeakSegment(h) => (**h).clone(),
        _ => panic!(),
    };
    let best = get("bestSegment.setup");
    assert_eq!((best.tag_id, best.name.as_str(), best.summary.trade_count, best.eligible_count), (10, "Breakout", 10, 2), "News has only 3 trades");
    approx(best.summary.expectancy_r.unwrap(), 1.0);
    approx(best.baseline_expectancy_r, 0.6);
    approx(best.gap, 0.4);
    assert_eq!(best.baseline_r_trade_count, 25);
    let i = find(&v, "bestSegment.setup");
    assert_eq!((i.situation.as_str(), i.level, i.priority, i.category), ("bestSegment:1:setup:10", 0, Priority::Low, Category::Highlight));
    assert_eq!(i.filter, Some(EvidenceFilter::Setup { tag_id: 10 }));
    assert_eq!(i.trade_ids.len(), 10);
    let weak = get("weakSegment.setup");
    assert_eq!(weak.tag_id, 11);
    approx(weak.summary.expectancy_r.unwrap(), -0.4);
    approx(weak.gap, -1.0);
    assert_eq!(find(&v, "weakSegment.setup").priority, Priority::Medium);
    let london = get("bestSegment.session");
    assert_eq!((london.tag_id, london.summary.trade_count), (20, 13));
    approx(london.summary.expectancy_r.unwrap(), 19.0 / 13.0);
    assert_eq!(find(&v, "bestSegment.session").filter, None, "no session filter in the trade list");
    let ny = get("weakSegment.session");
    approx(ny.summary.expectancy_r.unwrap(), -4.0 / 12.0);

    // Without Range: one eligible setup, one eligible session (New York has 2 trades) → no highlight.
    assert!(run(&ledger(journal_b(false))).iter().all(|i| i.category != Category::Highlight));
}

#[test]
fn no_trade_no_insight() {
    assert!(run(&ledger(Vec::new())).is_empty());
    assert!(run(&Ledger::default()).is_empty());
    // Open trades never count, and a trade entered after `now` does not exist yet.
    let mut t = journal_r("12.3");
    for x in &mut t[10..] {
        x.exit_time = None;
        x.position.exit_price = None;
    }
    assert!(run(&ledger(t)).is_empty());
    assert!(run_with(&ledger(journal_r("12.3")), TUE - 12 * DAY, &BehaviorSettings::default(), &[], &[]).is_empty());
}

#[test]
fn serialized_shape() {
    let v = run(&ledger(journal_r("12.3")));
    let json = serde_json::to_value(&v[0]).unwrap();
    assert_eq!(json["kind"], "riskDrift");
    assert_eq!(json["messageKey"], "riskDrift.up");
    assert_eq!(json["category"], "trend");
    assert_eq!(json["priority"], "high");
    assert_eq!(json["source"], "risk");
    assert_eq!(json["direction"], "up");
    assert_eq!(json["olderAvgRisk"], "100");
    assert_eq!(json["period"]["basis"], "lastTrades");
    assert!(json.get("order").is_none());
}
