//! Monthly goals (spec 2.8, 3.7.2): a target on a metric for a calendar month,
//! compared with what was actually achieved that month.
//!
//! Every figure comes from the same engines as the rest of the application
//! (`stats::report`, `execution_quality::report`); nothing is stored but the
//! target. The discipline score is not a goal metric yet: it will be added with
//! the behaviour module.
//!
//! - A trade counts in the month where it is **closed**, in the trader's local days
//!   (the offset is given by the caller, like the calendar).
//! - `at_least` metrics are reached once the actual value ≥ target; `at_most`
//!   metrics (max drawdown) are a ceiling: exceeded as soon as the actual value > limit.
//! - Without a closed trade in the month there is nothing to measure: `no_data`.
//! - "Month over" means the local day `today` is after the last day of the month.

use crate::error::{CoreError, Result};
use crate::execution_quality;
use crate::money::{self, Decimal};
use crate::period::PeriodQuery;
use crate::stats::pnl::ratio;
use crate::stats::{self, StatsQuery, time};
use crate::util::text_enum;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

const DAY_MS: i64 = 86_400_000;

text_enum!(
    /// What a goal measures.
    GoalMetric {
        NetPnl => "net_pnl",
        WinRate => "win_rate",
        ProfitFactor => "profit_factor",
        ExpectancyR => "expectancy_r",
        ExecutionQuality => "execution_quality",
        MaxDrawdown => "max_drawdown",
    }
);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Direction {
    /// The goal is a floor to reach.
    AtLeast,
    /// The goal is a ceiling not to cross.
    AtMost,
}

impl GoalMetric {
    pub fn direction(self) -> Direction {
        match self {
            GoalMetric::MaxDrawdown => Direction::AtMost,
            _ => Direction::AtLeast,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Goal {
    pub id: i64,
    /// "YYYY-MM".
    pub month: String,
    pub metric: GoalMetric,
    /// Money for `net_pnl` and `max_drawdown`; percent (0–100) for `win_rate`;
    /// 1–5 for `execution_quality`; a plain ratio otherwise.
    pub target: Decimal,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewGoal {
    pub month: String,
    pub metric: GoalMetric,
    pub target: Decimal,
}

/// Local calendar month "YYYY-MM" → (year, month).
fn parse_month(month: &str) -> Result<(i64, u32)> {
    let bad = || CoreError::Invalid(format!("invalid month {month:?} (expected YYYY-MM)"));
    let (y, m) = month.split_once('-').ok_or_else(bad)?;
    if y.len() != 4 || m.len() != 2 {
        return Err(bad());
    }
    let (year, m): (i64, u32) = (y.parse().map_err(|_| bad())?, m.parse().map_err(|_| bad())?);
    time::days_from_civil(year, m, 1).ok_or_else(bad)?;
    Ok((year, m))
}

/// Creates the goal of a month and metric, or changes its target when it exists.
pub fn set(conn: &Connection, new: &NewGoal) -> Result<Goal> {
    parse_month(&new.month)?;
    money::require_positive("target", new.target)?;
    match new.metric {
        GoalMetric::WinRate if new.target > Decimal::from(100) => {
            return Err(CoreError::Invalid("a win-rate target is a percentage: at most 100".into()));
        }
        GoalMetric::ExecutionQuality if new.target > Decimal::from(5) => {
            return Err(CoreError::Invalid("an execution-quality target is between 1 and 5 stars".into()));
        }
        _ => {}
    }
    conn.execute(
        "INSERT INTO goals (month, metric, target) VALUES (?1, ?2, ?3)
         ON CONFLICT(month, metric) DO UPDATE SET target = ?3",
        params![new.month, new.metric, money::to_db(new.target)],
    )?;
    let id: i64 = conn.query_row(
        "SELECT id FROM goals WHERE month = ?1 AND metric = ?2",
        params![new.month, new.metric],
        |r| r.get(0),
    )?;
    get(conn, id)
}

pub fn get(conn: &Connection, id: i64) -> Result<Goal> {
    conn.query_row(&format!("{SELECT} WHERE id = ?1"), [id], row)
        .optional()?
        .ok_or_else(|| CoreError::NotFound(format!("goal {id}")))
}

/// The goals of a month, in creation order.
pub fn list(conn: &Connection, month: &str) -> Result<Vec<Goal>> {
    parse_month(month)?;
    let mut stmt = conn.prepare(&format!("{SELECT} WHERE month = ?1 ORDER BY id"))?;
    let rows = stmt.query_map([month], row)?.collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn delete(conn: &Connection, id: i64) -> Result<()> {
    get(conn, id)?;
    conn.execute("DELETE FROM goals WHERE id = ?1", [id])?;
    Ok(())
}

/// Copies the goals of `from` to `to`, leaving alone the metrics that already have a goal in `to`.
/// Returns the goals of `to`.
pub fn copy_month(conn: &Connection, from: &str, to: &str) -> Result<Vec<Goal>> {
    parse_month(from)?;
    parse_month(to)?;
    conn.execute(
        "INSERT OR IGNORE INTO goals (month, metric, target)
         SELECT ?2, metric, target FROM goals WHERE month = ?1 ORDER BY id",
        params![from, to],
    )?;
    list(conn, to)
}

const SELECT: &str = "SELECT id, month, metric, target FROM goals";

fn row(r: &rusqlite::Row) -> rusqlite::Result<Goal> {
    Ok(Goal { id: r.get(0)?, month: r.get(1)?, metric: r.get(2)?, target: money::col(r, 3)? })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    /// Floor reached, or ceiling respected until the end of the month.
    Reached,
    InProgress,
    /// Month over and the floor was not reached.
    Missed,
    /// Ceiling crossed.
    Exceeded,
    /// No closed trade in the month, or a value that is not defined yet.
    NoData,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoalProgress {
    pub goal: Goal,
    pub direction: Direction,
    /// Closed trades of the month (all accounts asked for).
    pub trade_count: usize,
    pub currency: Option<String>,
    /// Actual value of a money metric (`net_pnl`, `max_drawdown`).
    pub actual_money: Option<Decimal>,
    /// Actual value of the other metrics (win rate in percent, stars…).
    /// A profit factor without any loss has none: the goal is then reached.
    pub actual_ratio: Option<f64>,
    /// Actual / target (≥ 0; above 1 means beyond the target, or over the ceiling).
    pub fraction: Option<f64>,
    pub status: Status,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressQuery {
    /// Accounts to measure (all when empty); they must share one currency.
    #[serde(default)]
    pub account_ids: Vec<i64>,
    /// "YYYY-MM".
    pub month: String,
    /// The trader's UTC offset in minutes: months are local months.
    #[serde(default)]
    pub tz_offset_min: i32,
    /// The trader's local day, "YYYY-MM-DD": tells whether the month is over.
    pub today: String,
}

/// Every goal of the month with its progress.
pub fn progress(conn: &Connection, q: &ProgressQuery) -> Result<Vec<GoalProgress>> {
    let (year, month) = parse_month(&q.month)?;
    time::parse_day(&q.today).ok_or_else(|| CoreError::Invalid(format!("invalid day {:?}", q.today)))?;
    let goals = list(conn, &q.month)?;
    if goals.is_empty() {
        return Ok(Vec::new());
    }
    let first = time::days_from_civil(year, month, 1).unwrap_or_default();
    let days = i64::from(time::days_in_month(year, month));
    let midnight = |day: i64| day * DAY_MS - i64::from(q.tz_offset_min) * 60_000;
    let (from, to) = (midnight(first), midnight(first + days));
    let report = stats::report(conn, &StatsQuery { account_ids: q.account_ids.clone(), from: Some(from), to: Some(to), ..Default::default() })?;
    let quality = execution_quality::report(conn, &PeriodQuery { account_ids: q.account_ids.clone(), from: Some(from), to: Some(to) })?;
    let last_day = format!("{}-{:02}", q.month, days);
    let month_over = q.today.as_str() > last_day.as_str();
    let s = &report.summary;

    Ok(goals
        .into_iter()
        .map(|goal| {
            let (actual_money, actual_ratio) = if s.trade_count == 0 {
                (None, None)
            } else {
                match goal.metric {
                    GoalMetric::NetPnl => (Some(s.net_pnl), None),
                    GoalMetric::MaxDrawdown => (Some(s.max_drawdown), None),
                    GoalMetric::WinRate => (None, s.win_rate.map(|w| w * 100.0)),
                    GoalMetric::ProfitFactor => (None, s.profit_factor),
                    GoalMetric::ExpectancyR => (None, s.expectancy_r),
                    GoalMetric::ExecutionQuality => (None, quality.average_stars),
                }
            };
            let direction = goal.metric.direction();
            // A profit factor with gains and no loss is unbounded: the floor is met.
            let unbounded = goal.metric == GoalMetric::ProfitFactor
                && s.trade_count > 0
                && s.profit_factor.is_none()
                && s.total_gains > Decimal::ZERO;
            let fraction = match (actual_money, actual_ratio) {
                (Some(m), _) => ratio(m, goal.target),
                (None, Some(r)) => goal.target.to_string().parse::<f64>().ok().filter(|t| *t > 0.0).map(|t| r / t),
                (None, None) => unbounded.then_some(1.0),
            }
            .map(|f| f.max(0.0));
            let status = match (fraction, direction) {
                (None, _) => Status::NoData,
                (Some(f), Direction::AtLeast) if f >= 1.0 => Status::Reached,
                (Some(_), Direction::AtLeast) if month_over => Status::Missed,
                (Some(f), Direction::AtMost) if f > 1.0 => Status::Exceeded,
                (Some(_), Direction::AtMost) if month_over => Status::Reached,
                (Some(_), _) => Status::InProgress,
            };
            GoalProgress {
                goal,
                direction,
                trade_count: s.trade_count,
                currency: report.currency.clone(),
                actual_money,
                actual_ratio,
                fraction,
                status,
            }
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::test_support::{account, dec, instrument};
    use crate::trades::{self, Direction as Dir, PlanFollowed, TradeData};

    fn new(month: &str, metric: GoalMetric, target: &str) -> NewGoal {
        NewGoal { month: month.into(), metric, target: dec(target) }
    }

    fn at(year: i64, month: u32, day: u32, hour: i64) -> i64 {
        time::days_from_civil(year, month, day).unwrap() * DAY_MS + hour * 3_600_000
    }

    /// Long at 100 with a stop at 90 (risk 10 for size 1, multiplier 1): R = net PnL / 10.
    fn trade(conn: &Connection, a: i64, i: i64, exit_day: (i64, u32, u32), exit_price: &str, plan: Option<PlanFollowed>) {
        let (y, m, d) = exit_day;
        let mut t = TradeData::new(a, i, Dir::Long, dec("1"), dec("100"), at(y, m, d, 11));
        t.multiplier = Some(dec("1"));
        t.planned_sl = Some(dec("90"));
        t.exit_price = Some(dec(exit_price));
        t.exit_time = Some(at(y, m, d, 12));
        t.plan_followed = plan;
        trades::create(conn, &t).unwrap();
    }

    /// September 2026: +10, +20, −10, +5 (net 25, 3 wins of 4, gains 35, losses 10, drawdown 10).
    fn september(conn: &Connection) -> (i64, i64) {
        let a = account(conn, "10000");
        let i = instrument(conn, "EURUSD", "1");
        for (d, exit) in [(3, "110"), (10, "120"), (17, "90"), (24, "105")] {
            trade(conn, a, i, (2026, 9, d), exit, Some(PlanFollowed::Yes));
        }
        (a, i)
    }

    fn progress_on(conn: &Connection, month: &str, today: &str) -> Vec<GoalProgress> {
        progress(conn, &ProgressQuery { account_ids: vec![], month: month.into(), tz_offset_min: 0, today: today.into() }).unwrap()
    }

    #[test]
    fn sets_replaces_lists_and_deletes_goals() {
        let conn = db::open_in_memory().unwrap();
        let g = set(&conn, &new("2026-09", GoalMetric::NetPnl, "500")).unwrap();
        assert_eq!((g.month.as_str(), g.metric, g.target), ("2026-09", GoalMetric::NetPnl, dec("500")));
        let again = set(&conn, &new("2026-09", GoalMetric::NetPnl, "750.50")).unwrap();
        assert_eq!((again.id, again.target), (g.id, dec("750.50")), "same month and metric: the target changes");
        set(&conn, &new("2026-09", GoalMetric::WinRate, "55")).unwrap();
        set(&conn, &new("2026-10", GoalMetric::NetPnl, "100")).unwrap();
        assert_eq!(list(&conn, "2026-09").unwrap().len(), 2);
        assert_eq!(list(&conn, "2026-11").unwrap().len(), 0);
        delete(&conn, g.id).unwrap();
        assert_eq!(list(&conn, "2026-09").unwrap().len(), 1);
        assert!(matches!(delete(&conn, g.id), Err(CoreError::NotFound(_))));
    }

    #[test]
    fn refuses_invalid_goals() {
        let conn = db::open_in_memory().unwrap();
        for (month, metric, target) in [
            ("2026-13", GoalMetric::NetPnl, "5"),
            ("2026-9", GoalMetric::NetPnl, "5"),
            ("sept", GoalMetric::NetPnl, "5"),
            ("2026-09", GoalMetric::NetPnl, "0"),
            ("2026-09", GoalMetric::NetPnl, "-5"),
            ("2026-09", GoalMetric::WinRate, "101"),
            ("2026-09", GoalMetric::ExecutionQuality, "5.5"),
        ] {
            assert!(set(&conn, &new(month, metric, target)).is_err(), "{month} {metric:?} {target}");
        }
        assert!(list(&conn, "2026-09").unwrap().is_empty());
        assert!(list(&conn, "nope").is_err());
        assert!(set(&conn, &new("2026-09", GoalMetric::WinRate, "100")).is_ok());
    }

    #[test]
    fn copies_a_month_without_overwriting() {
        let conn = db::open_in_memory().unwrap();
        set(&conn, &new("2026-08", GoalMetric::NetPnl, "500")).unwrap();
        set(&conn, &new("2026-08", GoalMetric::WinRate, "60")).unwrap();
        set(&conn, &new("2026-09", GoalMetric::NetPnl, "900")).unwrap();
        let copied = copy_month(&conn, "2026-08", "2026-09").unwrap();
        let by = |m| copied.iter().find(|g| g.metric == m).map(|g| g.target);
        assert_eq!(by(GoalMetric::NetPnl), Some(dec("900")), "an existing goal is kept");
        assert_eq!(by(GoalMetric::WinRate), Some(dec("60")));
        assert_eq!(copy_month(&conn, "2026-07", "2026-09").unwrap().len(), 2, "nothing to copy: nothing changes");
    }

    #[test]
    fn measures_each_metric_against_hand_computed_values() {
        let conn = db::open_in_memory().unwrap();
        september(&conn);
        for (m, target) in [
            (GoalMetric::NetPnl, "20"),
            (GoalMetric::WinRate, "80"),
            (GoalMetric::ProfitFactor, "3"),
            (GoalMetric::ExpectancyR, "0.5"),
            (GoalMetric::ExecutionQuality, "4"),
            (GoalMetric::MaxDrawdown, "15"),
        ] {
            set(&conn, &new("2026-09", m, target)).unwrap();
        }
        let p = progress_on(&conn, "2026-09", "2026-09-29");
        let of = |m| p.iter().find(|g| g.goal.metric == m).unwrap();
        assert!(p.iter().all(|g| g.trade_count == 4 && g.currency.as_deref() == Some("USD")));

        // Net PnL 25 against 20: reached, at 125 %.
        let pnl = of(GoalMetric::NetPnl);
        assert_eq!((pnl.actual_money, pnl.fraction, pnl.status), (Some(dec("25")), Some(1.25), Status::Reached));
        // Win rate 3/4 = 75 % against 80 %: 0.9375, still in progress.
        let wr = of(GoalMetric::WinRate);
        assert_eq!((wr.actual_ratio, wr.fraction, wr.status), (Some(75.0), Some(0.9375), Status::InProgress));
        // Profit factor 35 / 10 = 3.5 against 3.
        let pf = of(GoalMetric::ProfitFactor);
        assert!((pf.actual_ratio.unwrap() - 3.5).abs() < 1e-12);
        assert_eq!(pf.status, Status::Reached);
        // Expectancy: 0.75 × (3.5 / 3) − 0.25 × 1 = 0.625 R against 0.5.
        let ex = of(GoalMetric::ExpectancyR);
        assert!((ex.actual_ratio.unwrap() - 0.625).abs() < 1e-12);
        assert_eq!(ex.status, Status::Reached);
        // Every trade followed the plan: 5 stars against 4.
        let q = of(GoalMetric::ExecutionQuality);
        assert_eq!((q.actual_ratio, q.status), (Some(5.0), Status::Reached));
        // Max drawdown: peak 30, then 20 → 10, under the 15 ceiling; the month is not over.
        let dd = of(GoalMetric::MaxDrawdown);
        assert_eq!((dd.direction, dd.actual_money, dd.status), (Direction::AtMost, Some(dec("10")), Status::InProgress));
        assert!((dd.fraction.unwrap() - 10.0 / 15.0).abs() < 1e-12);
    }

    #[test]
    fn status_depends_on_the_end_of_the_month() {
        let conn = db::open_in_memory().unwrap();
        september(&conn);
        set(&conn, &new("2026-09", GoalMetric::NetPnl, "100")).unwrap();
        set(&conn, &new("2026-09", GoalMetric::MaxDrawdown, "15")).unwrap();
        set(&conn, &new("2026-09", GoalMetric::WinRate, "50")).unwrap();
        let by = |p: &[GoalProgress], m| p.iter().find(|g| g.goal.metric == m).unwrap().status;

        let during = progress_on(&conn, "2026-09", "2026-09-30");
        assert_eq!(by(&during, GoalMetric::NetPnl), Status::InProgress, "the 30th is still September");
        assert_eq!(by(&during, GoalMetric::MaxDrawdown), Status::InProgress);
        assert_eq!(by(&during, GoalMetric::WinRate), Status::Reached);
        let after = progress_on(&conn, "2026-09", "2026-10-01");
        assert_eq!(by(&after, GoalMetric::NetPnl), Status::Missed);
        assert_eq!(by(&after, GoalMetric::MaxDrawdown), Status::Reached, "ceiling respected all month");

        // A tighter ceiling is exceeded at once, even before the month ends.
        set(&conn, &new("2026-09", GoalMetric::MaxDrawdown, "9.99")).unwrap();
        assert_eq!(by(&progress_on(&conn, "2026-09", "2026-09-10"), GoalMetric::MaxDrawdown), Status::Exceeded);
        assert_eq!(progress_on(&conn, "2026-09", "2026-09-10").iter().find(|g| g.goal.metric == GoalMetric::MaxDrawdown).unwrap().fraction.map(|f| f > 1.0), Some(true));
    }

    #[test]
    fn a_month_without_closed_trade_has_no_data() {
        let conn = db::open_in_memory().unwrap();
        september(&conn);
        set(&conn, &new("2026-10", GoalMetric::NetPnl, "100")).unwrap();
        set(&conn, &new("2026-10", GoalMetric::MaxDrawdown, "50")).unwrap();
        let p = progress_on(&conn, "2026-10", "2026-11-15");
        assert!(p.iter().all(|g| g.status == Status::NoData && g.trade_count == 0 && g.fraction.is_none() && g.actual_money.is_none()));
        assert!(progress_on(&conn, "2026-11", "2026-11-15").is_empty(), "no goal, nothing to report");
    }

    #[test]
    fn a_profit_factor_without_loss_is_unbounded_and_a_loss_only_month_has_zero_progress() {
        let conn = db::open_in_memory().unwrap();
        let a = account(&conn, "10000");
        let i = instrument(&conn, "EURUSD", "1");
        trade(&conn, a, i, (2026, 9, 3), "110", None);
        trade(&conn, a, i, (2026, 9, 4), "105", None);
        set(&conn, &new("2026-09", GoalMetric::ProfitFactor, "2")).unwrap();
        let p = &progress_on(&conn, "2026-09", "2026-09-10")[0];
        assert_eq!((p.actual_ratio, p.status), (None, Status::Reached));

        let conn = db::open_in_memory().unwrap();
        let a = account(&conn, "10000");
        let i = instrument(&conn, "EURUSD", "1");
        trade(&conn, a, i, (2026, 9, 3), "95", None);
        set(&conn, &new("2026-09", GoalMetric::NetPnl, "50")).unwrap();
        let p = &progress_on(&conn, "2026-09", "2026-09-10")[0];
        assert_eq!((p.actual_money, p.fraction, p.status), (Some(dec("-5")), Some(0.0), Status::InProgress), "a loss never gives negative progress");
    }

    #[test]
    fn months_follow_the_local_time_of_the_trader() {
        let conn = db::open_in_memory().unwrap();
        let a = account(&conn, "10000");
        let i = instrument(&conn, "EURUSD", "1");
        // Closes 2026-09-30 23:30 UTC = 2026-10-01 01:30 at UTC+2: an October trade for that trader.
        trade(&conn, a, i, (2026, 9, 30), "110", None);
        let mut late = trades::list(&conn, &Default::default()).unwrap().remove(0).data;
        let id = trades::list(&conn, &Default::default()).unwrap()[0].id;
        late.exit_time = Some(at(2026, 9, 30, 23) + 30 * 60_000);
        late.tz_offset_min = 120;
        trades::update(&conn, id, &late).unwrap();
        set(&conn, &new("2026-09", GoalMetric::NetPnl, "5")).unwrap();
        set(&conn, &new("2026-10", GoalMetric::NetPnl, "5")).unwrap();
        let q = |month: &str, tz| progress(&conn, &ProgressQuery { account_ids: vec![], month: month.into(), tz_offset_min: tz, today: "2026-11-05".into() }).unwrap();
        assert_eq!(q("2026-09", 0)[0].trade_count, 1);
        assert_eq!(q("2026-10", 0)[0].trade_count, 0);
        assert_eq!(q("2026-09", 120)[0].trade_count, 0);
        assert_eq!(q("2026-10", 120)[0].trade_count, 1);
    }

    #[test]
    fn rejects_an_invalid_query() {
        let conn = db::open_in_memory().unwrap();
        let bad = |month: &str, today: &str| progress(&conn, &ProgressQuery { account_ids: vec![], month: month.into(), tz_offset_min: 0, today: today.into() });
        assert!(bad("2026-09", "2026-09-31").is_err());
        assert!(bad("2026-00", "2026-09-30").is_err());
    }
}
