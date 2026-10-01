//! Dashboard and calendar figures (spec 3.3.1, 3.3.8): a period compared with
//! the one before it, KPI sparklines, a monthly heatmap and the trades of one day.
//!
//! Everything here is derived from the same replay as [`super::compute`], so the
//! numbers agree with the rest of the statistics. The UI only displays them.

use super::pnl::{Outcome, ratio};
use super::summary::{DayResult, Summary, analyze};
use super::{Closed, Report, StatsQuery, compute, in_window, load, matches, replay, time};
use crate::error::{CoreError, Result};
use crate::money::Decimal;
use crate::trades::Direction;
use rusqlite::Connection;
use rust_decimal::prelude::ToPrimitive;
use serde::{Deserialize, Serialize};

const DAY_MS: i64 = 86_400_000;
/// A sparkline shows at most this many of the latest trading days.
const SPARK_POINTS: usize = 30;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Period {
    Day,
    Week,
    Month,
    Quarter,
    Year,
    All,
}

impl Period {
    /// Length in local days: today, 7, 30, 90 and 365 days ending today; `None` for all time.
    pub(crate) fn days(self) -> Option<i64> {
        match self {
            Period::Day => Some(1),
            Period::Week => Some(7),
            Period::Month => Some(30),
            Period::Quarter => Some(90),
            Period::Year => Some(365),
            Period::All => None,
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardQuery {
    #[serde(default)]
    pub account_ids: Vec<i64>,
    pub period: Period,
    /// The current instant and the user's UTC offset, supplied by the shell
    /// (the engine never reads the clock, which keeps it testable).
    pub now_ms: i64,
    #[serde(default)]
    pub tz_offset_min: i32,
}

/// Change from the previous period to the current one. `None` when either side is undefined.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Comparison {
    pub trade_count: i64,
    pub net_pnl: Decimal,
    /// Relative change of net PnL, against the absolute previous value (0.5 = +50 %).
    pub net_pnl_pct: Option<f64>,
    /// In percentage points of win rate (0.05 = +5 points).
    pub win_rate: Option<f64>,
    pub profit_factor: Option<f64>,
    pub avg_win_loss_ratio: Option<f64>,
    pub expectancy_r: Option<f64>,
    /// Change of the maximum drawdown amount (positive = deeper drawdown).
    pub max_drawdown: Decimal,
}

/// Running value of each KPI at the end of each of the latest trading days of the period.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sparklines {
    pub net_pnl: Vec<Option<f64>>,
    pub win_rate: Vec<Option<f64>>,
    pub profit_factor: Vec<Option<f64>>,
    pub avg_win_loss_ratio: Vec<Option<f64>>,
    pub expectancy_r: Vec<Option<f64>>,
    pub max_drawdown: Vec<Option<f64>>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dashboard {
    /// Current period, with its equity curve and per-day results.
    pub report: Report,
    /// Window `[from, to)` in Unix ms; `None` bounds mean "since the beginning".
    pub from: Option<i64>,
    pub to: Option<i64>,
    pub previous_from: Option<i64>,
    pub previous_to: Option<i64>,
    /// `None` for all time (nothing precedes it).
    pub previous: Option<Summary>,
    pub comparison: Option<Comparison>,
    pub sparklines: Sparklines,
}

pub fn dashboard(conn: &Connection, q: &DashboardQuery) -> Result<Dashboard> {
    let ledger = load(conn, &q.account_ids)?;
    let stats_query = |from: Option<i64>, to: Option<i64>| StatsQuery { account_ids: q.account_ids.clone(), from, to, ..StatsQuery::default() };

    let (from, to, previous_from, previous_to) = match q.period.days() {
        Some(n) => {
            let today = time::local_day_number(q.now_ms, q.tz_offset_min);
            let midnight = |day: i64| day * DAY_MS - i64::from(q.tz_offset_min) * 60_000;
            let (to, from) = (midnight(today + 1), midnight(today + 1 - n));
            (Some(from), Some(to), Some(midnight(today + 1 - 2 * n)), Some(from))
        }
        None => (None, None, None, None),
    };
    let report = compute(&ledger, &stats_query(from, to))?;
    let previous = match q.period.days() {
        Some(_) => Some(compute(&ledger, &stats_query(previous_from, previous_to))?.summary),
        None => None,
    };
    let comparison = previous.as_ref().map(|p| compare(&report.summary, p)).transpose()?;

    // Sparklines: the KPI recomputed on the trades closed up to the end of each of the last trading days.
    let replayed = replay(&ledger)?;
    let query = stats_query(from, to);
    let selected: Vec<&Closed> = replayed.closed.iter().filter(|c| in_window(c.exit_time, &query) && matches(c.facts, &query)).collect();
    let mut sparklines = Sparklines::default();
    let day_ends: Vec<usize> = selected
        .iter()
        .enumerate()
        .filter(|(i, c)| {
            let day = |c: &Closed| time::day_key(c.exit_time, c.facts.tz_offset_min);
            selected.get(i + 1).is_none_or(|next| day(next) != day(c))
        })
        .map(|(i, _)| i + 1)
        .collect();
    for &end in day_ends.iter().skip(day_ends.len().saturating_sub(SPARK_POINTS)) {
        let s = analyze(&selected[..end], 0.0)?.summary;
        sparklines.net_pnl.push(s.net_pnl.to_f64());
        sparklines.win_rate.push(s.win_rate);
        sparklines.profit_factor.push(s.profit_factor);
        sparklines.avg_win_loss_ratio.push(s.avg_win_loss_ratio);
        sparklines.expectancy_r.push(s.expectancy_r);
        sparklines.max_drawdown.push(s.max_drawdown.to_f64());
    }
    Ok(Dashboard { report, from, to, previous_from, previous_to, previous, comparison, sparklines })
}

pub(crate) fn compare(now: &Summary, before: &Summary) -> Result<Comparison> {
    let diff = |a: Option<f64>, b: Option<f64>| a.zip(b).map(|(a, b)| a - b);
    let delta = now.net_pnl.checked_sub(before.net_pnl).ok_or_else(|| CoreError::Invalid("amount overflow".into()))?;
    let max_dd = now.max_drawdown.checked_sub(before.max_drawdown).ok_or_else(|| CoreError::Invalid("amount overflow".into()))?;
    Ok(Comparison {
        trade_count: now.trade_count as i64 - before.trade_count as i64,
        net_pnl: delta,
        net_pnl_pct: ratio(delta, before.net_pnl.abs()),
        win_rate: diff(now.win_rate, before.win_rate),
        profit_factor: diff(now.profit_factor, before.profit_factor),
        avg_win_loss_ratio: diff(now.avg_win_loss_ratio, before.avg_win_loss_ratio),
        expectancy_r: diff(now.expectancy_r, before.expectancy_r),
        max_drawdown: max_dd,
    })
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarQuery {
    #[serde(default)]
    pub account_ids: Vec<i64>,
    pub year: i64,
    /// 1–12.
    pub month: u32,
    #[serde(default)]
    pub tz_offset_min: i32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarDay {
    pub day_of_month: u8,
    #[serde(flatten)]
    pub result: DayResult,
    /// Net PnL against the largest absolute day of the month, in [−1, 1]: sets the heatmap shade.
    pub intensity: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Calendar {
    pub year: i64,
    pub month: u32,
    pub days_in_month: u8,
    /// ISO weekday of the 1st: 1 = Monday … 7 = Sunday.
    pub first_weekday: u8,
    pub currency: Option<String>,
    /// Only the days with at least one closed trade.
    pub days: Vec<CalendarDay>,
    pub summary: Summary,
}

pub fn calendar(conn: &Connection, q: &CalendarQuery) -> Result<Calendar> {
    let first = time::days_from_civil(q.year, q.month, 1).ok_or_else(|| CoreError::Invalid(format!("invalid month {}-{}", q.year, q.month)))?;
    let days_in_month = time::days_in_month(q.year, q.month);
    let midnight = |day: i64| day * DAY_MS - i64::from(q.tz_offset_min) * 60_000;
    let query = StatsQuery {
        account_ids: q.account_ids.clone(),
        from: Some(midnight(first)),
        to: Some(midnight(first + i64::from(days_in_month))),
        ..StatsQuery::default()
    };
    let report = compute(&load(conn, &q.account_ids)?, &query)?;
    let max_abs = report.daily.iter().filter_map(|d| d.net_pnl.abs().to_f64()).fold(0.0_f64, f64::max);
    let month_prefix = format!("{:04}-{:02}-", q.year, q.month);
    let days = report
        .daily
        .into_iter()
        // A trade recorded in another UTC offset can fall on the neighbouring month's day: leave it out.
        .filter(|d| d.day.starts_with(&month_prefix))
        .map(|d| CalendarDay {
            day_of_month: d.day[8..].parse().unwrap_or(0),
            intensity: if max_abs > 0.0 { (d.net_pnl.to_f64().unwrap_or(0.0) / max_abs).clamp(-1.0, 1.0) } else { 0.0 },
            result: d,
        })
        .collect();
    Ok(Calendar {
        year: q.year,
        month: q.month,
        days_in_month,
        first_weekday: time::weekday(midnight(first) + i64::from(q.tz_offset_min) * 60_000, q.tz_offset_min),
        currency: report.currency,
        days,
        summary: report.summary,
    })
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayTrade {
    pub trade_id: i64,
    pub symbol: String,
    pub direction: Direction,
    pub exit_time: i64,
    pub net_pnl: Decimal,
    pub r_multiple: Option<f64>,
    pub outcome: Outcome,
}

/// Closed trades whose local exit day is `day` ("YYYY-MM-DD"), in exit order.
pub fn day_trades(conn: &Connection, account_ids: &[i64], day: &str) -> Result<Vec<DayTrade>> {
    time::parse_day(day).ok_or_else(|| CoreError::Invalid(format!("invalid day {day:?}")))?;
    let ledger = load(conn, account_ids)?;
    let replayed = replay(&ledger)?;
    Ok(replayed
        .closed
        .iter()
        .filter(|c| time::day_key(c.exit_time, c.facts.tz_offset_min) == day)
        .map(|c| DayTrade {
            trade_id: c.facts.id,
            symbol: c.facts.symbol.clone(),
            direction: c.facts.position.direction,
            exit_time: c.exit_time,
            net_pnl: c.figures.net_pnl,
            r_multiple: c.figures.r_multiple,
            outcome: c.figures.outcome,
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cash_flows::{self, CashFlowKind, NewCashFlow};
    use crate::test_support::{account, dec, instrument};
    use crate::trades::{self, TradeData};
    use crate::db;

    const HOUR: i64 = 3_600_000;
    /// 2026-09-01 00:00 UTC (a Tuesday); September 29 is day offset 28.
    const SEP_1: i64 = 20_697 * DAY_MS;
    const NOW: i64 = SEP_1 + 28 * DAY_MS + 12 * HOUR;

    /// A closed trade of size 1 × multiplier 1, exited at 11:00 UTC on `day` days after 1 Sept.
    fn closed(conn: &Connection, a: i64, i: i64, dir: Direction, entry: &str, exit: &str, sl: Option<&str>, day: i64) -> i64 {
        let exit_time = SEP_1 + day * DAY_MS + 11 * HOUR;
        let mut t = TradeData::new(a, i, dir, dec("1"), dec(entry), exit_time - HOUR);
        t.multiplier = Some(dec("1"));
        t.exit_price = Some(dec(exit));
        t.exit_time = Some(exit_time);
        t.planned_sl = sl.map(dec);
        trades::create(conn, &t).unwrap().id
    }

    /// Hand-computed journal: see the expectations below.
    ///  day  0 (1 Sept)  +100
    ///  day 19 (20 Sept)  −2  } previous week (16–22 Sept)
    ///  day 20 (21 Sept)  +3  }
    ///  day 27 (28 Sept)  +10 (R = 10/5 = +2) and −4 (R = −4/5 = −0.8)  } this week (23–29 Sept)
    ///  day 28 (29 Sept)  +5 (short, no stop)                          }
    fn journal() -> (Connection, i64) {
        let conn = db::open_in_memory().unwrap();
        let a = account(&conn, "10000");
        let i = instrument(&conn, "TEST", "1");
        closed(&conn, a, i, Direction::Long, "100", "200", None, 0);
        closed(&conn, a, i, Direction::Long, "10", "8", None, 19);
        closed(&conn, a, i, Direction::Long, "10", "13", None, 20);
        closed(&conn, a, i, Direction::Long, "100", "110", Some("95"), 27);
        closed(&conn, a, i, Direction::Long, "100", "96", Some("95"), 27);
        closed(&conn, a, i, Direction::Short, "50", "45", None, 28);
        (conn, a)
    }

    fn query(period: Period) -> DashboardQuery {
        DashboardQuery { account_ids: vec![], period, now_ms: NOW, tz_offset_min: 0 }
    }

    #[track_caller]
    fn approx(actual: Option<f64>, expected: f64) {
        let a = actual.unwrap_or_else(|| panic!("expected {expected}, got None"));
        assert!((a - expected).abs() < 1e-12, "expected {expected}, got {a}");
    }

    #[test]
    fn week_against_the_previous_week() {
        let (conn, _) = journal();
        let d = dashboard(&conn, &query(Period::Week)).unwrap();
        // Window: 23 Sept 00:00 → 30 Sept 00:00 UTC.
        assert_eq!((d.from, d.to), (Some(SEP_1 + 22 * DAY_MS), Some(SEP_1 + 29 * DAY_MS)));
        assert_eq!(d.previous_to, d.from);
        let s = &d.report.summary;
        // Net 10 − 4 + 5 = 11; 2 wins of 3; gains 15, losses 4 → PF 3.75; 7.5 / 4 = 1.875.
        assert_eq!((s.trade_count, s.net_pnl), (3, dec("11")));
        approx(s.win_rate, 2.0 / 3.0);
        approx(s.profit_factor, 3.75);
        approx(s.avg_win_loss_ratio, 1.875);
        // R values +2 and −0.8 (the short has no stop): 0.5 × 2 − 0.5 × 0.8 = 0.6.
        approx(s.expectancy_r, 0.6);
        assert_eq!(s.max_drawdown, dec("4")); // 10 → 6
        assert_eq!(d.report.current_capital, dec("10112")); // 10 000 + all realized PnL (112)

        let p = d.previous.unwrap();
        assert_eq!((p.trade_count, p.net_pnl), (2, dec("1"))); // −2 + 3
        approx(p.profit_factor, 1.5);
        assert_eq!(p.expectancy_r, None);
        let c = d.comparison.unwrap();
        assert_eq!((c.trade_count, c.net_pnl), (1, dec("10")));
        approx(c.net_pnl_pct, 10.0); // +10 on a previous +1
        approx(c.win_rate, 2.0 / 3.0 - 0.5);
        approx(c.profit_factor, 2.25);
        approx(c.avg_win_loss_ratio, 1.875 - 1.5);
        assert_eq!(c.expectancy_r, None, "no expectancy last week: no change either");
        assert_eq!(c.max_drawdown, dec("2")); // 4 − 2
    }

    #[test]
    fn sparklines_follow_the_running_kpis_day_by_day() {
        let (conn, _) = journal();
        let sp = dashboard(&conn, &query(Period::Week)).unwrap().sparklines;
        // Two trading days: after 28 Sept (+10, −4) and after 29 Sept (+5).
        assert_eq!(sp.net_pnl, [Some(6.0), Some(11.0)]);
        assert_eq!(sp.win_rate, [Some(0.5), Some(2.0 / 3.0)]);
        assert_eq!(sp.profit_factor, [Some(2.5), Some(3.75)]);
        assert_eq!(sp.max_drawdown, [Some(4.0), Some(4.0)]);
        assert_eq!(sp.expectancy_r, [Some(0.6), Some(0.6)]);
    }

    #[test]
    fn a_deposit_never_changes_the_period_figures() {
        let (conn, a) = journal();
        let before = dashboard(&conn, &query(Period::Week)).unwrap();
        cash_flows::create(
            &conn,
            &NewCashFlow { account_id: a, kind: CashFlowKind::Deposit, amount: dec("5000"), occurred_at: SEP_1 + 27 * DAY_MS + 8 * HOUR, tz_offset_min: 0, note: String::new() },
        )
        .unwrap();
        cash_flows::create(
            &conn,
            &NewCashFlow { account_id: a, kind: CashFlowKind::Withdrawal, amount: dec("2000"), occurred_at: SEP_1 + 28 * DAY_MS + 8 * HOUR, tz_offset_min: 0, note: String::new() },
        )
        .unwrap();
        let after = dashboard(&conn, &query(Period::Week)).unwrap();
        assert_eq!(after.report.summary.net_pnl, before.report.summary.net_pnl);
        assert_eq!(after.report.equity_curve.iter().map(|p| p.cumulative_net_pnl).collect::<Vec<_>>(), before.report.equity_curve.iter().map(|p| p.cumulative_net_pnl).collect::<Vec<_>>());
        assert_eq!(after.sparklines, before.sparklines);
        // Only the balance moves: 10 000 + 112 of PnL + 5 000 deposited − 2 000 withdrawn.
        assert_eq!(after.report.current_capital, dec("13112"));
        assert_eq!((after.report.total_deposits, after.report.total_withdrawals), (dec("5000"), dec("2000")));
        let all = dashboard(&conn, &query(Period::All)).unwrap();
        assert_eq!(all.report.summary.net_pnl, dec("112"));
    }

    #[test]
    fn today_all_time_and_empty_windows() {
        let (conn, _) = journal();
        let day = dashboard(&conn, &query(Period::Day)).unwrap();
        assert_eq!((day.report.summary.trade_count, day.report.summary.net_pnl), (1, dec("5")));
        let yesterday = day.previous.unwrap(); // 28 Sept: +10 and −4
        assert_eq!((yesterday.trade_count, yesterday.net_pnl), (2, dec("6")));

        let all = dashboard(&conn, &query(Period::All)).unwrap();
        assert_eq!((all.from, all.previous, all.comparison), (None, None, None));
        assert_eq!((all.report.summary.trade_count, all.report.summary.net_pnl), (6, dec("112")));
        // Cumulative 100, 98, 101, 111, 107, 112: falls of 2 (100 → 98) and 4 (111 → 107).
        assert_eq!(all.report.summary.max_drawdown, dec("4"));

        // A window without trade: zeros and "undefined" values, never a crash.
        let empty = dashboard(&conn, &DashboardQuery { now_ms: SEP_1 - 400 * DAY_MS, ..query(Period::Month) }).unwrap();
        assert_eq!(empty.report.summary.trade_count, 0);
        assert_eq!(empty.report.summary.win_rate, None);
        assert!(empty.sparklines.net_pnl.is_empty());
        let c = empty.comparison.unwrap();
        assert_eq!((c.net_pnl, c.net_pnl_pct, c.win_rate), (dec("0"), None, None));

        // No account at all.
        let none = dashboard(&db::open_in_memory().unwrap(), &query(Period::Week)).unwrap();
        assert_eq!((none.report.currency, none.report.summary.trade_count), (None, 0));
    }

    #[test]
    fn the_period_follows_the_users_local_midnight() {
        let (conn, _) = journal();
        // At 23:30 UTC on 29 Sept, a UTC+2 user is already on 30 Sept: "today" is empty.
        let late = DashboardQuery { now_ms: SEP_1 + 28 * DAY_MS + 23 * HOUR + 30 * 60_000, tz_offset_min: 120, ..query(Period::Day) };
        let d = dashboard(&conn, &late).unwrap();
        assert_eq!(d.report.summary.trade_count, 0);
        assert_eq!(d.to.unwrap() - d.from.unwrap(), DAY_MS);
        assert_eq!(d.from, Some(SEP_1 + 29 * DAY_MS - 120 * 60_000)); // 30 Sept 00:00 at UTC+2
    }

    #[test]
    fn calendar_month_with_heatmap_intensity() {
        let (conn, _) = journal();
        let c = calendar(&conn, &CalendarQuery { account_ids: vec![], year: 2026, month: 9, tz_offset_min: 0 }).unwrap();
        assert_eq!((c.days_in_month, c.first_weekday), (30, 2)); // 1 Sept 2026 is a Tuesday
        let got: Vec<(u8, String, usize)> = c.days.iter().map(|d| (d.day_of_month, d.result.net_pnl.to_string(), d.result.trade_count)).collect();
        assert_eq!(
            got,
            [(1, "100".into(), 1), (20, "-2".into(), 1), (21, "3".into(), 1), (28, "6".into(), 2), (29, "5".into(), 1)]
        );
        // The best day (+100) sets the scale: 1, −0.02, 0.03, 0.06, 0.05.
        let shades: Vec<f64> = c.days.iter().map(|d| d.intensity).collect();
        for (s, e) in shades.iter().zip([1.0, -0.02, 0.03, 0.06, 0.05]) {
            assert!((s - e).abs() < 1e-12, "{s} vs {e}");
        }
        assert_eq!(c.summary.net_pnl, dec("112"));

        let oct = calendar(&conn, &CalendarQuery { account_ids: vec![], year: 2026, month: 10, tz_offset_min: 0 }).unwrap();
        assert_eq!((oct.days.len(), oct.first_weekday, oct.summary.trade_count), (0, 4, 0));
        let feb = calendar(&conn, &CalendarQuery { account_ids: vec![], year: 2028, month: 2, tz_offset_min: 0 }).unwrap();
        assert_eq!(feb.days_in_month, 29);
        assert!(calendar(&conn, &CalendarQuery { account_ids: vec![], year: 2026, month: 13, tz_offset_min: 0 }).is_err());
    }

    #[test]
    fn calendar_groups_by_the_local_day_of_the_trade() {
        let conn = db::open_in_memory().unwrap();
        let a = account(&conn, "1000");
        let i = instrument(&conn, "TEST", "1");
        // 30 Sept 23:30 UTC recorded at UTC+2 = 1 Oct 01:30 local.
        let exit = SEP_1 + 29 * DAY_MS + 23 * HOUR + 30 * 60_000;
        let mut t = TradeData::new(a, i, Direction::Long, dec("1"), dec("10"), exit - HOUR);
        t.multiplier = Some(dec("1"));
        t.exit_price = Some(dec("12"));
        t.exit_time = Some(exit);
        t.tz_offset_min = 120;
        trades::create(&conn, &t).unwrap();
        let month = |m| calendar(&conn, &CalendarQuery { account_ids: vec![], year: 2026, month: m, tz_offset_min: 120 }).unwrap();
        assert!(month(9).days.is_empty());
        assert_eq!(month(10).days.iter().map(|d| d.day_of_month).collect::<Vec<_>>(), [1]);
        assert_eq!(month(10).first_weekday, 4);
        assert_eq!(day_trades(&conn, &[], "2026-10-01").unwrap().len(), 1);
        assert!(day_trades(&conn, &[], "2026-09-30").unwrap().is_empty());
    }

    #[test]
    fn trades_of_one_day() {
        let (conn, a) = journal();
        let day = day_trades(&conn, &[a], "2026-09-28").unwrap();
        assert_eq!(day.len(), 2);
        assert_eq!((day[0].net_pnl, day[1].net_pnl), (dec("10"), dec("-4")));
        approx(day[0].r_multiple, 2.0);
        approx(day[1].r_multiple, -0.8);
        assert_eq!((day[0].outcome, day[1].outcome), (Outcome::Win, Outcome::Loss));
        assert!(day_trades(&conn, &[a], "2026-09-27").unwrap().is_empty());
        assert!(day_trades(&conn, &[a], "2026-02-30").is_err());
        assert!(day_trades(&conn, &[a], "28/09/2026").is_err());
    }
}
