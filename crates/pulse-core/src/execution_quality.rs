//! Execution quality (spec 3.2.9): was the trade *well executed*, whatever its
//! result? This is the pivot of the guiding principle (spec 1.2): a trade can be
//! "winning but badly executed" or "losing but well executed", and the two must
//! never be confused.
//!
//! Score on a 0–100 scale:
//! - automatic: mean of the components that exist for the trade —
//!   checklist completion (ticked / total lines), declared plan compliance
//!   (yes 100, partly 50, no 0), personal rules (respected / checked);
//! - manual (1–5 stars, `Trade.execution_quality`): when the trader gives one it
//!   wins over the automatic score; star `n` is worth `(n − 1) × 25`.
//!
//! A trade counts as *well executed* from 70 points (4 stars = 75, 3 stars = 50).

use crate::error::Result;
use crate::money::Decimal;
use crate::period::{PeriodQuery, closed_trades};
use crate::stats::pnl::Outcome;
use crate::trades::{PlanFollowed, TradeData};
use rusqlite::Connection;
use serde::Serialize;

/// Minimum score (0–100) of a well-executed trade.
pub const GOOD_THRESHOLD: f64 = 70.0;

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Components {
    /// Ticked checklist lines / lines, in percent; `None` without a checklist.
    pub checklist: Option<f64>,
    /// Declared plan compliance in percent; `None` when not declared.
    pub plan: Option<f64>,
    /// Respected rules / checked rules, in percent; `None` when no rule was checked.
    pub rules: Option<f64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Source {
    Manual,
    Auto,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Grade {
    Good,
    Poor,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutionScore {
    pub components: Components,
    /// Mean of the available components, 0–100.
    pub auto_score: Option<f64>,
    /// The trader's own 1–5 mark.
    pub manual: Option<u8>,
    /// The score that counts: manual when given, automatic otherwise.
    pub score: Option<f64>,
    pub source: Option<Source>,
    /// `score` on the 1–5 scale of the stars: `1 + score / 25`.
    pub stars: Option<f64>,
    pub grade: Option<Grade>,
}

pub fn score(d: &TradeData) -> ExecutionScore {
    let components = Components {
        checklist: percent(d.checklist.iter().filter(|c| c.checked).count(), d.checklist.len()),
        plan: d.plan_followed.map(|p| match p {
            PlanFollowed::Yes => 100.0,
            PlanFollowed::Partial => 50.0,
            PlanFollowed::No => 0.0,
        }),
        rules: percent(d.rule_checks.iter().filter(|r| r.respected).count(), d.rule_checks.len()),
    };
    let parts: Vec<f64> = [components.checklist, components.plan, components.rules].into_iter().flatten().collect();
    let auto_score = (!parts.is_empty()).then(|| parts.iter().sum::<f64>() / parts.len() as f64);
    let (score, source) = match (d.execution_quality, auto_score) {
        (Some(stars), _) => (Some((f64::from(stars) - 1.0) * 25.0), Some(Source::Manual)),
        (None, Some(auto)) => (Some(auto), Some(Source::Auto)),
        (None, None) => (None, None),
    };
    ExecutionScore {
        components,
        auto_score,
        manual: d.execution_quality,
        score,
        source,
        stars: score.map(|s| 1.0 + s / 25.0),
        grade: score.map(|s| if s >= GOOD_THRESHOLD { Grade::Good } else { Grade::Poor }),
    }
}

fn percent(part: usize, whole: usize) -> Option<f64> {
    (whole > 0).then(|| part as f64 * 100.0 / whole as f64)
}

/// One cell of the win/loss × good/poor execution grid.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Quadrant {
    pub outcome: Outcome,
    pub grade: Grade,
    pub trade_count: usize,
    pub net_pnl: Decimal,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QualityReport {
    pub currency: Option<String>,
    /// Closed trades of the period.
    pub trade_count: usize,
    /// Closed trades with a score (manual or automatic).
    pub scored_count: usize,
    /// Closed trades with nothing to score (no checklist, plan, rule or star).
    pub unscored_count: usize,
    /// Mean score of the scored trades, 0–100.
    pub average_score: Option<f64>,
    /// The same on the 1–5 scale.
    pub average_stars: Option<f64>,
    /// Winning trades and losing trades × well / poorly executed: always four cells, in this order:
    /// win·good, win·poor, loss·good, loss·poor.
    pub quadrants: Vec<Quadrant>,
    /// Scored breakeven trades (in neither column).
    pub breakeven_count: usize,
}

pub fn report(conn: &Connection, q: &PeriodQuery) -> Result<QualityReport> {
    let trades = closed_trades(conn, q)?;
    let mut cells: Vec<Quadrant> = [Outcome::Win, Outcome::Loss]
        .into_iter()
        .flat_map(|outcome| {
            [Grade::Good, Grade::Poor].map(|grade| Quadrant { outcome, grade, trade_count: 0, net_pnl: Decimal::ZERO })
        })
        .collect();
    let (mut scored, mut sum, mut breakeven) = (0usize, 0.0_f64, 0usize);
    let mut currency: Option<String> = None;
    for v in &trades {
        currency.get_or_insert_with(|| v.currency.clone());
        let (Some(s), Some(f)) = (score(&v.trade.data).score, &v.figures) else { continue };
        scored += 1;
        sum += s;
        let grade = if s >= GOOD_THRESHOLD { Grade::Good } else { Grade::Poor };
        match cells.iter_mut().find(|c| c.outcome == f.outcome && c.grade == grade) {
            Some(cell) => {
                cell.trade_count += 1;
                cell.net_pnl = crate::stats::pnl::checked(cell.net_pnl.checked_add(f.net_pnl))?;
            }
            None => breakeven += 1,
        }
    }
    let average_score = (scored > 0).then(|| sum / scored as f64);
    Ok(QualityReport {
        currency,
        trade_count: trades.len(),
        scored_count: scored,
        unscored_count: trades.len() - scored,
        average_score,
        average_stars: average_score.map(|s| 1.0 + s / 25.0),
        quadrants: cells,
        breakeven_count: breakeven,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::test_support::{account, dec, instrument};
    use crate::trades::{self, ChecklistAnswer, Direction, RuleCheck};

    fn base() -> TradeData {
        TradeData::new(1, 1, Direction::Long, dec("1"), dec("100"), 0)
    }

    fn line(checked: bool) -> ChecklistAnswer {
        ChecklistAnswer { item_id: None, label: "x".into(), checked }
    }

    #[test]
    fn automatic_score_is_the_mean_of_the_available_components() {
        // checklist 3/4 = 75, plan partly = 50, rules 1/2 = 50  →  (75 + 50 + 50) / 3.
        let mut d = base();
        d.checklist = vec![line(true), line(true), line(true), line(false)];
        d.plan_followed = Some(PlanFollowed::Partial);
        d.rule_checks = vec![RuleCheck { rule_id: 1, respected: true }, RuleCheck { rule_id: 2, respected: false }];
        let s = score(&d);
        assert_eq!(s.components, Components { checklist: Some(75.0), plan: Some(50.0), rules: Some(50.0) });
        assert!((s.auto_score.unwrap() - 175.0 / 3.0).abs() < 1e-9);
        assert_eq!(s.source, Some(Source::Auto));
        assert_eq!(s.grade, Some(Grade::Poor));
        assert!((s.stars.unwrap() - (1.0 + 175.0 / 75.0)).abs() < 1e-9);
    }

    #[test]
    fn a_single_component_is_enough_and_a_perfect_trade_scores_100() {
        let mut d = base();
        d.plan_followed = Some(PlanFollowed::Yes);
        let s = score(&d);
        assert_eq!((s.auto_score, s.stars, s.grade), (Some(100.0), Some(5.0), Some(Grade::Good)));
        d.plan_followed = Some(PlanFollowed::No);
        assert_eq!(score(&d).auto_score, Some(0.0));
        assert_eq!(score(&d).stars, Some(1.0));
    }

    #[test]
    fn nothing_to_score_gives_no_score() {
        let s = score(&base());
        assert_eq!((s.auto_score, s.score, s.source, s.stars, s.grade), (None, None, None, None, None));
    }

    #[test]
    fn the_manual_mark_wins_over_the_automatic_score() {
        let mut d = base();
        d.plan_followed = Some(PlanFollowed::Yes);
        d.execution_quality = Some(2);
        let s = score(&d);
        assert_eq!((s.auto_score, s.score, s.source, s.grade), (Some(100.0), Some(25.0), Some(Source::Manual), Some(Grade::Poor)));
        d.execution_quality = Some(4);
        assert_eq!(score(&d).score, Some(75.0));
        assert_eq!(score(&d).grade, Some(Grade::Good));
        // Alone, without any auto component, a manual mark still counts.
        d.plan_followed = None;
        d.execution_quality = Some(5);
        assert_eq!((score(&d).score, score(&d).auto_score), (Some(100.0), None));
    }

    fn closed(conn: &Connection, a: i64, i: i64, exit: &str, plan: Option<PlanFollowed>, manual: Option<u8>) -> i64 {
        let mut d = TradeData::new(a, i, Direction::Long, dec("1"), dec("100"), 1_000);
        d.multiplier = Some(dec("1"));
        d.exit_price = Some(dec(exit));
        d.exit_time = Some(2_000);
        d.plan_followed = plan;
        d.execution_quality = manual;
        trades::create(conn, &d).unwrap().id
    }

    #[test]
    fn the_report_crosses_result_and_execution() {
        let conn = db::open_in_memory().unwrap();
        let a = account(&conn, "10000");
        let i = instrument(&conn, "EURUSD", "1");
        closed(&conn, a, i, "110", Some(PlanFollowed::Yes), None); // win, good   +10
        closed(&conn, a, i, "105", Some(PlanFollowed::Yes), Some(5)); // win, good   +5
        closed(&conn, a, i, "120", Some(PlanFollowed::No), None); // win, poor   +20
        closed(&conn, a, i, "90", Some(PlanFollowed::Yes), None); // loss, good  −10
        closed(&conn, a, i, "80", Some(PlanFollowed::No), None); // loss, poor  −20
        closed(&conn, a, i, "70", Some(PlanFollowed::No), None); // loss, poor  −30
        closed(&conn, a, i, "100", Some(PlanFollowed::Yes), None); // breakeven, scored
        closed(&conn, a, i, "101", None, None); // win, nothing to score

        let r = report(&conn, &PeriodQuery::default()).unwrap();
        assert_eq!((r.trade_count, r.scored_count, r.unscored_count, r.breakeven_count), (8, 7, 1, 1));
        let cell = |outcome, grade| r.quadrants.iter().find(|c| c.outcome == outcome && c.grade == grade).unwrap();
        assert_eq!((cell(Outcome::Win, Grade::Good).trade_count, cell(Outcome::Win, Grade::Good).net_pnl), (2, dec("15")));
        assert_eq!((cell(Outcome::Win, Grade::Poor).trade_count, cell(Outcome::Win, Grade::Poor).net_pnl), (1, dec("20")));
        assert_eq!((cell(Outcome::Loss, Grade::Good).trade_count, cell(Outcome::Loss, Grade::Good).net_pnl), (1, dec("-10")));
        assert_eq!((cell(Outcome::Loss, Grade::Poor).trade_count, cell(Outcome::Loss, Grade::Poor).net_pnl), (2, dec("-50")));
        // Scores: 100, 100 (5 stars), 0, 100, 0, 0, 100 → mean 400 / 7.
        assert!((r.average_score.unwrap() - 400.0 / 7.0).abs() < 1e-9);
        assert!((r.average_stars.unwrap() - (1.0 + 400.0 / 7.0 / 25.0)).abs() < 1e-9);
        assert_eq!(r.currency.as_deref(), Some("USD"));
    }

    #[test]
    fn empty_periods_and_windows_give_empty_reports() {
        let conn = db::open_in_memory().unwrap();
        let r = report(&conn, &PeriodQuery::default()).unwrap();
        assert_eq!((r.trade_count, r.scored_count, r.average_score, r.average_stars), (0, 0, None, None));
        assert_eq!(r.quadrants.len(), 4);
        let a = account(&conn, "100");
        let i = instrument(&conn, "EURUSD", "1");
        closed(&conn, a, i, "110", Some(PlanFollowed::Yes), None); // exit at 2 000
        let after = PeriodQuery { from: Some(2_001), ..Default::default() };
        assert_eq!(report(&conn, &after).unwrap().trade_count, 0);
        let around = PeriodQuery { from: Some(2_000), to: Some(2_001), ..Default::default() };
        assert_eq!(report(&conn, &around).unwrap().trade_count, 1);
    }
}
