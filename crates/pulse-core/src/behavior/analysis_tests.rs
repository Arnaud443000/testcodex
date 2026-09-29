//! Known-result tests for the 3.4.x analyses, on journal D of `tests.rs`.
//!
//! Journal D in exit order: 1 win +100, 2 loss −150, 3 win +80, 4 loss −50,
//! 5 loss −100, 6 breakeven 0 (7 is open). R: 1 → +2, 2 → −1, 3 → +0.8,
//! 4 → −2.5, 5 → −2.5, 6 → none (no stop).

use super::tests::{all, approx, journal_d, ledger, rule, strict, trade};
use super::*;
use crate::rules::Rule;
use crate::stats::segments::Segment;
use crate::stats::{StatsQuery, TagRef};
use crate::tags::TagKind;
use crate::test_support::dec;
use crate::trades::{Direction, EmotionMoment, PlanFollowed};

const DAY: i64 = 86_400_000;
const SEP_1: i64 = 20_697 * DAY;

fn tag(id: i64, kind: TagKind, name: &str) -> TagRef {
    TagRef { id, kind, name: name.into() }
}

/// Emotions: 1 calm before, relief after; 2 FOMO before and during; 3 calm before;
/// 4 none; 5 revenge before; 6 calm during.
/// Mistakes: "Early exit" on 1 and 3, "Moved stop" on 2 and 5 (2 also broke rule 1).
/// Setups: Breakout on 1, 2, 4; Pullback on 3. Session London on 1.
fn journal_e() -> Vec<TradeFacts> {
    use EmotionMoment::{After, Before, During};
    let (calm, fomo, revenge, relief) =
        (tag(100, TagKind::Emotion, "Calm"), tag(101, TagKind::Emotion, "FOMO"), tag(103, TagKind::Emotion, "Revenge"), tag(102, TagKind::Emotion, "Relief"));
    let (early, moved) = (tag(200, TagKind::Mistake, "Early exit"), tag(201, TagKind::Mistake, "Moved stop"));
    let (breakout, pullback, london) = (tag(10, TagKind::Setup, "Breakout"), tag(11, TagKind::Setup, "Pullback"), tag(30, TagKind::Session, "London"));
    let mut t = journal_d();
    t[0].journal.emotions = vec![(Before, calm.clone()), (After, relief)];
    t[1].journal.emotions = vec![(Before, fomo.clone()), (During, fomo)];
    t[2].journal.emotions = vec![(Before, calm.clone())];
    t[4].journal.emotions = vec![(Before, revenge)];
    t[5].journal.emotions = vec![(During, calm)];
    t[0].tags = vec![breakout.clone(), london, early.clone()];
    t[1].tags = vec![breakout.clone(), moved.clone()];
    t[2].tags = vec![pullback, early];
    t[3].tags = vec![breakout];
    t[4].tags = vec![moved];
    t
}

fn rows(segments: &[Segment]) -> Vec<(String, String, Decimal, usize)> {
    segments.iter().map(|s| (s.key.clone(), s.label.clone(), s.summary.net_pnl, s.summary.trade_count)).collect()
}

fn row(k: &str, l: &str, net: &str, n: usize) -> (String, String, Decimal, usize) {
    (k.into(), l.into(), dec(net), n)
}

#[test]
fn emotions_against_results() {
    let r = emotions(&ledger("10000", journal_e()), &all()).unwrap();
    // Any moment: calm = 1, 3, 6 (100 + 80 + 0); FOMO counts trade 2 once; "none" = trade 4, last.
    assert_eq!(
        rows(&r.any),
        [row("100", "Calm", "180", 3), row("101", "FOMO", "-150", 1), row("102", "Relief", "100", 1), row("103", "Revenge", "-100", 1), row("none", "None", "-50", 1)]
    );
    approx(r.any[0].summary.win_rate, 2.0 / 3.0);
    // Mean R of the calm trades that have one (1 and 3): (2 + 0.8) / 2.
    approx(r.any[0].summary.expectancy_r, 1.4);
    assert_eq!(rows(&r.before), [row("100", "Calm", "180", 2), row("101", "FOMO", "-150", 1), row("103", "Revenge", "-100", 1), row("none", "None", "-50", 2)]);
    // During: 100 + 80 − 50 − 100 = 30 without emotion.
    assert_eq!(rows(&r.during), [row("100", "Calm", "0", 1), row("101", "FOMO", "-150", 1), row("none", "None", "30", 4)]);
    assert_eq!(rows(&r.after), [row("102", "Relief", "100", 1), row("none", "None", "-220", 5)]);

    let empty = emotions(&ledger("10000", vec![]), &all()).unwrap();
    assert!(empty.any.is_empty() && empty.before.is_empty());
}

#[test]
fn streaks_current_and_records() {
    // W, L, W, L L, breakeven: the breakeven ends the losing streak.
    let r = streaks(&ledger("10000", journal_d()), &all()).unwrap();
    assert_eq!(r.current, None);
    let win = r.longest_win.unwrap();
    // Two wins of length 1: the most recent (trade 3) is kept.
    assert_eq!((win.outcome, win.length, win.first_trade_id, win.net_pnl), (Outcome::Win, 1, 3, dec("80")));
    let loss = r.longest_loss.unwrap();
    assert_eq!((loss.length, loss.first_trade_id, loss.last_trade_id, loss.net_pnl), (2, 4, 5, dec("-150")));
    assert_eq!(loss.to - loss.from, 45 * 60_000); // exits 09:30 and 10:15
    assert_eq!(r.trade_count, 6);

    // Without day 2, the period ends on the two losses: they are the current streak.
    let q = StatsQuery { to: Some(SEP_1 + 2 * DAY), ..all() };
    let current = streaks(&ledger("10000", journal_d()), &q).unwrap().current.unwrap();
    assert_eq!((current.outcome, current.length, current.last_trade_id), (Outcome::Loss, 2, 5));

    let empty = streaks(&ledger("10000", vec![]), &all()).unwrap();
    assert_eq!((empty.current, empty.longest_win, empty.longest_loss, empty.trade_count), (None, None, None, 0));
    // A single breakeven: no streak at all.
    let flat = streaks(&ledger("10000", vec![trade(1, Direction::Long, "10", Some("10"), "1", None, 0, 0, 60)]), &all()).unwrap();
    assert_eq!((flat.current, flat.longest_win), (None, None));
}

#[test]
fn in_plan_against_off_plan() {
    let r = plan(&ledger("10000", journal_d()), &all()).unwrap();
    // Yes = 1, 4, 6 (100 − 50 + 0); partial = 2; no = 3; not declared = 5.
    assert_eq!(
        rows(&r.groups),
        [row("yes", "Yes", "50", 3), row("partial", "Partial", "-150", 1), row("no", "No", "80", 1), row("none", "None", "-100", 1)]
    );
    approx(r.groups[0].summary.win_rate, 1.0 / 3.0);
    // Groups are always there, even empty.
    let empty = plan(&ledger("10000", vec![]), &all()).unwrap();
    assert_eq!(rows(&empty.groups), [row("yes", "Yes", "0", 0), row("partial", "Partial", "0", 0), row("no", "No", "0", 0), row("none", "None", "0", 0)]);
    assert_eq!(empty.groups[0].summary.win_rate, None);
}

#[test]
fn first_trade_of_the_day_against_the_next_ones() {
    let r = first_trade(&ledger("10000", journal_d()), &all(), &strict()).unwrap();
    // Ranks: 1 → 1, 2 → 2, 3 → 3, 4 → 1, 5 → 2, 6 → 1.
    assert_eq!((r.first.summary.trade_count, r.first.summary.net_pnl), (3, dec("50")));
    assert_eq!((r.subsequent.summary.trade_count, r.subsequent.summary.net_pnl), (3, dec("-170")));
    // 3 scored trades < 5: no group score.
    assert_eq!((r.first.discipline_score, r.first.scored_trade_count), (None, 3));
    let by_rank: Vec<(&str, usize, Decimal)> = r.by_rank.iter().map(|g| (g.key.as_str(), g.summary.trade_count, g.summary.net_pnl)).collect();
    assert_eq!(by_rank, [("1", 3, dec("50")), ("2", 2, dec("-250")), ("3", 1, dec("80")), ("4+", 0, dec("0"))]);

    // Five days with one trade each (plan yes, stop, no threshold): every score is
    // (30 + 10 + 10) / 50 = 100, so the first-trade group scores 100.
    let five: Vec<TradeFacts> = (0..5)
        .map(|d| {
            let mut t = trade(d + 1, Direction::Long, "100", Some("101"), "1", Some("99"), d, 9 * 60, 10 * 60);
            t.journal.plan_followed = Some(PlanFollowed::Yes);
            t
        })
        .collect();
    let r = first_trade(&ledger("10000", five), &all(), &BehaviorSettings::default()).unwrap();
    assert_eq!((r.first.discipline_score, r.first.scored_trade_count), (Some(100.0), 5));
    assert_eq!((r.subsequent.discipline_score, r.subsequent.summary.trade_count), (None, 0));
}

#[test]
fn recurring_mistakes_by_count_and_by_cost() {
    let r = mistakes(&ledger("10000", journal_e()), &all()).unwrap();
    // Trades 1, 2, 3, 5 carry a mistake (tag or broken rule); 4 and 6 do not.
    assert_eq!((r.trade_count, r.trades_with_mistake), (6, 4));
    let brief = |list: &[Mistake]| -> Vec<(MistakeSource, String, usize, Decimal, Decimal)> {
        list.iter().map(|m| (m.source, m.label.clone(), m.trade_count, m.net_pnl, m.cost)).collect()
    };
    // Moved stop: 2 and 5 (−150 − 100, cost 250); early exit: 1 and 3 (+180, cost 0);
    // rule 1 broken on trade 2 (cost 150). Count ties are broken by cost.
    assert_eq!(
        brief(&r.by_count),
        [
            (MistakeSource::Tag, "Moved stop".into(), 2, dec("-250"), dec("250")),
            (MistakeSource::Tag, "Early exit".into(), 2, dec("180"), dec("0")),
            (MistakeSource::Rule, "Rule 1".into(), 1, dec("-150"), dec("150")),
        ]
    );
    assert_eq!(r.by_cost.iter().map(|m| m.label.as_str()).collect::<Vec<_>>(), ["Moved stop", "Rule 1", "Early exit"]);
    let moved = &r.by_count[0];
    assert_eq!((moved.id, moved.trade_ids.clone()), (201, vec![2, 5]));
    approx(moved.share, 2.0 / 6.0);
    approx(moved.expectancy_r, (-1.0 - 2.5) / 2.0);

    let empty = mistakes(&ledger("10000", vec![]), &all()).unwrap();
    assert_eq!((empty.trade_count, empty.trades_with_mistake, empty.by_count.len()), (0, 0, 0));
}

fn rules_list() -> Vec<Rule> {
    let r = |id: i64, archived: bool| Rule { id, text: format!("Rule {id}"), archived, position: id };
    vec![r(1, false), r(2, false), r(3, false), r(4, true)]
}

#[test]
fn rule_adherence_rates_and_months() {
    // Journal D: rule 1 ✓ (trade 1) ✗ (trade 2); rule 2 ✓ (1) ✓ (4); rule 3 never; rule 4 archived, never.
    let r = rule_adherence(&ledger("10000", journal_d()), &all(), &rules_list()).unwrap();
    assert_eq!((r.checks, r.respected, r.trades_with_checks), (4, 3, 3));
    approx(r.rate, 0.75);
    type Brief = (i64, usize, usize, Option<f64>, Option<f64>);
    let brief: Vec<Brief> = r.rules.iter().map(|x| (x.rule_id, x.checks, x.respected, x.rate, x.trend)).collect();
    assert_eq!(brief, [(1, 2, 1, Some(0.5), None), (2, 2, 2, Some(1.0), None), (3, 0, 0, None, None)], "archived rule 4 never ticked is left out");
    assert_eq!(r.rules[0].monthly.iter().map(|m| (m.month.as_str(), m.checks, m.respected)).collect::<Vec<_>>(), [("2026-09", 2, 1)]);
    assert!(r.rules[2].monthly.is_empty());

    // Trend: ✗ ✗ ✓ ✓ ✓ from 28 Sept to 2 Oct. Older half ✗ ✗ = 0, newer half ✓ ✓ = 1, the middle
    // check is ignored → +1 (100 points better). Months: September 1 / 3, October 2 / 2.
    let five: Vec<TradeFacts> = [false, false, true, true, true]
        .iter()
        .enumerate()
        .map(|(k, &ok)| {
            let mut t = trade(k as i64 + 1, Direction::Long, "10", Some("11"), "1", None, 27 + k as i64, 9 * 60, 10 * 60);
            t.journal.rule_checks = vec![rule(4, ok)];
            t
        })
        .collect();
    let r = rule_adherence(&ledger("10000", five), &all(), &rules_list()).unwrap();
    let archived = r.rules.iter().find(|x| x.rule_id == 4).unwrap();
    assert!(archived.archived, "an archived rule ticked in the period is listed");
    approx(archived.trend, 1.0);
    approx(archived.rate, 0.6);
    let months: Vec<(&str, usize, usize)> = archived.monthly.iter().map(|m| (m.month.as_str(), m.checks, m.respected)).collect();
    assert_eq!(months, [("2026-09", 3, 1), ("2026-10", 2, 2)]);

    let empty = rule_adherence(&ledger("10000", vec![]), &all(), &rules_list()).unwrap();
    assert_eq!((empty.checks, empty.rate, empty.rules.len()), (0, None, 3));
}

fn missed(id: i64, direction: Option<Direction>, day: i64, tags: Vec<TagRef>) -> MissedFacts {
    MissedFacts { id, account_id: 1, instrument_id: 1, direction, occurred_at: SEP_1 + day * DAY + 3_600_000, tags }
}

#[test]
fn revenge_overtrading_and_hesitation() {
    let breakout = tag(10, TagKind::Setup, "Breakout");
    let london = tag(30, TagKind::Session, "London");
    let pullback = tag(11, TagKind::Setup, "Pullback");
    let missed_list = vec![
        missed(1, Some(Direction::Long), 0, vec![breakout.clone(), london]),
        missed(2, None, 1, vec![breakout]),
        missed(3, None, 10, vec![pullback]),
    ];
    let l = ledger("10000", journal_e());
    let r = patterns(&l, &missed_list, &all(), &strict()).unwrap();
    assert_eq!(r.revenge_trades.len(), 1);
    let t5 = &r.revenge_trades[0];
    assert_eq!((t5.trade_id, t5.revenge.previous_trade_id, t5.net_pnl), (5, 4, dec("-100")));
    assert_eq!((r.revenge_summary.trade_count, r.revenge_summary.net_pnl), (1, dec("-100")));
    assert_eq!(r.max_trades_per_day, Some(2));
    assert_eq!(r.overtrading_days.len(), 1);
    let day = &r.overtrading_days[0];
    assert_eq!((day.day.as_str(), day.trade_count, day.limit, day.trade_ids.clone()), ("2026-09-01", 3, 2, vec![3]));
    // Breakout: taken 1, 2, 4 and missed twice → 2 / 5; Pullback 1 / 2; London 1 / 2.
    let h: Vec<(&str, usize, usize, Option<f64>)> = r.hesitation.iter().map(|h| (h.name.as_str(), h.taken, h.missed, h.missed_share)).collect();
    assert_eq!(h, [("Breakout", 3, 2, Some(0.4)), ("Pullback", 1, 1, Some(0.5)), ("London", 1, 1, Some(0.5))]);
    assert_eq!(r.missed_trade_count, 3);

    // Longs only: missed trades without a side are left out, like trade 4 (short).
    let longs = patterns(&l, &missed_list, &StatsQuery { direction: Some(Direction::Long), ..all() }, &strict()).unwrap();
    let h: Vec<(&str, usize, usize)> = longs.hesitation.iter().map(|h| (h.name.as_str(), h.taken, h.missed)).collect();
    assert_eq!(h, [("Breakout", 2, 1), ("Pullback", 1, 0), ("London", 1, 1)]);
    approx(longs.hesitation[1].missed_share, 0.0);

    // No daily limit: no overtrading detection; nothing at all in an empty journal.
    let loose = patterns(&l, &[], &all(), &BehaviorSettings::default()).unwrap();
    assert_eq!((loose.max_trades_per_day, loose.overtrading_days.len(), loose.revenge_trades.len()), (None, 0, 1));
    let empty = patterns(&ledger("10000", vec![]), &[], &all(), &strict()).unwrap();
    assert!(empty.revenge_trades.is_empty() && empty.hesitation.is_empty() && empty.overtrading_days.is_empty());
    assert_eq!(empty.revenge_summary.trade_count, 0);
}

mod from_db {
    use super::*;
    use crate::missed_trades::{self, MissedTradeData};
    use crate::test_support::{account, instrument};
    use crate::trades::{self, EmotionEntry, RuleCheck, TradeData};
    use crate::{db, rules, tags};

    #[test]
    fn every_report_reads_the_journal_from_the_database() {
        let conn = db::open_in_memory().unwrap();
        let a = account(&conn, "1000");
        let i = instrument(&conn, "TEST", "1");
        let calm = tags::find(&conn, TagKind::Emotion, "calme").unwrap().unwrap();
        let early = tags::find(&conn, TagKind::Mistake, "sortie trop tôt").unwrap().unwrap();
        let setup = tags::create(&conn, TagKind::Setup, "Breakout").unwrap();
        let r1 = rules::create(&conn, "Max 2 trades").unwrap();
        let mut t = TradeData::new(a, i, Direction::Long, dec("1"), dec("100"), SEP_1);
        t.exit_price = Some(dec("90"));
        t.exit_time = Some(SEP_1 + 3_600_000);
        t.plan_followed = Some(PlanFollowed::No);
        t.tag_ids = vec![early.id, setup.id];
        t.emotions = vec![EmotionEntry { moment: EmotionMoment::Before, tag_id: calm.id }];
        t.rule_checks = vec![RuleCheck { rule_id: r1.id, respected: false }];
        let id = trades::create(&conn, &t).unwrap().id;
        missed_trades::create(
            &conn,
            &MissedTradeData {
                account_id: a,
                instrument_id: i,
                direction: None,
                occurred_at: SEP_1,
                tz_offset_min: 0,
                reason: "Doubt".into(),
                notes: String::new(),
                conviction: None,
                tag_ids: vec![setup.id],
            },
        )
        .unwrap();
        let q = StatsQuery { account_ids: vec![a], ..all() };

        assert_eq!(rows(&emotion_report(&conn, &q).unwrap().before)[0], row(&calm.id.to_string(), "Calme", "-10", 1));
        assert_eq!(streak_report(&conn, &q).unwrap().current.unwrap().length, 1);
        assert_eq!(plan_report(&conn, &q).unwrap().groups[2].summary.trade_count, 1);
        assert_eq!(first_trade_report(&conn, &q).unwrap().first.summary.trade_count, 1);
        let m = mistake_report(&conn, &q).unwrap();
        assert_eq!(m.by_cost.iter().map(|x| (x.label.as_str(), x.cost)).collect::<Vec<_>>(), [("Max 2 trades", dec("10")), ("Sortie trop tôt", dec("10"))]);
        assert_eq!(m.by_count[0].trade_ids, [id]);
        let r = rule_adherence_report(&conn, &q).unwrap();
        assert_eq!((r.checks, r.respected, r.rules[0].text.as_str()), (1, 0, "Max 2 trades"));
        let p = pattern_report(&conn, &q).unwrap();
        assert_eq!((p.missed_trade_count, p.hesitation[0].name.as_str(), p.hesitation[0].missed_share), (1, "Breakout", Some(0.5)));
    }
}
