//! Process goals (lot 34): weekly and monthly targets on what depends only on the trader —
//! "no trade without a stop this week", "at most 3 overtrading days", "90 % of my rules respected".
//!
//! **No new formula.** Each metric re-reads a report that already exists, with its definitions,
//! thresholds, "no data = `None`" cases and selection (closed trades whose exit is in the period):
//!
//! | Metric | Kind | Source |
//! |---|---|---|
//! | `no_stop_trades` | ceiling | `behavior::discipline` — trades whose `stopLoss` component is 0 (`has_stop_loss = false`) |
//! | `overtrading_days` | ceiling | `behavior::patterns` — `overtrading_days` (needs `behavior.max_trades_per_day`) |
//! | `revenge_trades` | ceiling | `behavior::patterns` — `revenge_trades` |
//! | `risk_breaches` | ceiling | `stats::comparisons::risk_benchmark` — `violations` (needs `behavior.max_risk_percent`) |
//! | `rules_respect_rate` | floor, % | `behavior::rule_adherence` — `respected / checks` of all rules |
//! | `plan_follow_rate` | floor, % | `behavior::plan` — group `yes` / groups `yes + partial + no` |
//! | `journal_days` | floor | `journal::list` — local days of the period with an entry (never blank) |
//!
//! The goals table (`goals.rs`, result goals) is not touched: process goals live in `process_goals`
//! (migration v17 in the numbering of the parallel lots). See CLAUDE.md, "Objectifs de comportement (lot 34)".

use crate::behavior;
use crate::error::{CoreError, Result};
use crate::journal::{self, JournalEntry};
use crate::money::{self, Decimal};
use crate::rules::{self, Rule};
use crate::settings::{self, BehaviorSettings};
use crate::stats::comparisons;
use crate::stats::{self, Ledger, StatsQuery, time};
use crate::util::text_enum;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};

const DAY_MS: i64 = 86_400_000;
/// A streak never counts more than a year of weeks.
pub const MAX_STREAK: u32 = 52;
/// Largest ceiling a count goal accepts.
pub const MAX_COUNT_TARGET: i64 = 10_000;
/// Below this many trades with a declared plan, the plan rate is `None` (same as `stats::analyses::MIN_SAMPLE`).
pub const MIN_PLAN_TRADES: usize = stats::analyses::MIN_SAMPLE;

text_enum!(
    /// What a process goal measures.
    ProcessMetric {
        NoStopTrades => "no_stop_trades",
        OvertradingDays => "overtrading_days",
        RevengeTrades => "revenge_trades",
        RiskBreaches => "risk_breaches",
        RulesRespectRate => "rules_respect_rate",
        PlanFollowRate => "plan_follow_rate",
        JournalDays => "journal_days",
    }
);

text_enum!(
    /// A local ISO week (Monday → Sunday, "YYYY-Www") or a local calendar month ("YYYY-MM").
    PeriodKind {
        Week => "week",
        Month => "month",
    }
);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GoalDirection {
    /// A ceiling not to cross (counts of mistakes).
    AtMost,
    /// A floor to reach (rates, journal days).
    AtLeast,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Unit {
    /// A number of trades or of days.
    Count,
    /// A percentage, 0 to 100.
    Percent,
}

/// Threshold of the discipline settings a metric needs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum RequiredSetting {
    MaxTradesPerDay,
    MaxRiskPercent,
}

impl ProcessMetric {
    pub fn direction(self) -> GoalDirection {
        match self {
            ProcessMetric::NoStopTrades | ProcessMetric::OvertradingDays | ProcessMetric::RevengeTrades | ProcessMetric::RiskBreaches => {
                GoalDirection::AtMost
            }
            _ => GoalDirection::AtLeast,
        }
    }

    pub fn unit(self) -> Unit {
        match self {
            ProcessMetric::RulesRespectRate | ProcessMetric::PlanFollowRate => Unit::Percent,
            _ => Unit::Count,
        }
    }

    pub fn required_setting(self) -> Option<RequiredSetting> {
        match self {
            ProcessMetric::OvertradingDays => Some(RequiredSetting::MaxTradesPerDay),
            ProcessMetric::RiskBreaches => Some(RequiredSetting::MaxRiskPercent),
            _ => None,
        }
    }
}

// --- Periods ------------------------------------------------------------------------------

/// A week or a month of local days.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Period {
    pub kind: PeriodKind,
    pub key: String,
    /// First local day, in days since 1970-01-01.
    pub first_day: i64,
    /// Number of local days (7 for a week, 28 to 31 for a month).
    pub days: i64,
}

fn weekday_of_day(day: i64) -> i64 {
    // 1970-01-01 was a Thursday (ISO 4); 1 = Monday.
    (day + 3).rem_euclid(7) + 1
}

/// Number of ISO weeks of an ISO year: 53 when 1 January is a Thursday, or a Wednesday in a leap year.
fn weeks_in_iso_year(year: i64) -> i64 {
    let jan1 = weekday_of_day(time::days_from_civil(year, 1, 1).unwrap_or_default());
    let leap = time::days_in_month(year, 2) == 29;
    if jan1 == 4 || (leap && jan1 == 3) { 53 } else { 52 }
}

/// Monday of week 1 of an ISO year: the week holding 4 January.
fn iso_year_start(year: i64) -> i64 {
    let jan4 = time::days_from_civil(year, 1, 4).unwrap_or_default();
    jan4 - (weekday_of_day(jan4) - 1)
}

impl Period {
    pub fn parse(kind: PeriodKind, key: &str) -> Result<Period> {
        match kind {
            PeriodKind::Week => {
                let bad = || CoreError::Invalid(format!("invalid week {key:?} (expected YYYY-Www)"));
                let (y, w) = key.split_once("-W").ok_or_else(bad)?;
                if y.len() != 4 || w.len() != 2 || !y.bytes().chain(w.bytes()).all(|b| b.is_ascii_digit()) {
                    return Err(bad());
                }
                let (year, week): (i64, i64) = (y.parse().map_err(|_| bad())?, w.parse().map_err(|_| bad())?);
                if week < 1 || week > weeks_in_iso_year(year) {
                    return Err(bad());
                }
                Ok(Period { kind, key: key.into(), first_day: iso_year_start(year) + (week - 1) * 7, days: 7 })
            }
            PeriodKind::Month => {
                let bad = || CoreError::Invalid(format!("invalid month {key:?} (expected YYYY-MM)"));
                let (y, m) = key.split_once('-').ok_or_else(bad)?;
                if y.len() != 4 || m.len() != 2 || !y.bytes().chain(m.bytes()).all(|b| b.is_ascii_digit()) {
                    return Err(bad());
                }
                let (year, month): (i64, u32) = (y.parse().map_err(|_| bad())?, m.parse().map_err(|_| bad())?);
                let first_day = time::days_from_civil(year, month, 1).ok_or_else(bad)?;
                Ok(Period { kind, key: key.into(), first_day, days: i64::from(time::days_in_month(year, month)) })
            }
        }
    }

    /// The period holding a local day.
    pub fn containing(kind: PeriodKind, day: i64) -> Period {
        let (y, m, _) = time::civil_from_days(day);
        match kind {
            PeriodKind::Month => Period::parse(kind, &format!("{y:04}-{m:02}")).expect("a real month"),
            PeriodKind::Week => {
                let monday = day - (weekday_of_day(day) - 1);
                // The ISO year is the year of the week's Thursday.
                let (iso_year, _, _) = time::civil_from_days(monday + 3);
                let week = (monday - iso_year_start(iso_year)) / 7 + 1;
                Period { kind, key: format!("{iso_year:04}-W{week:02}"), first_day: monday, days: 7 }
            }
        }
    }

    pub fn last_day(&self) -> i64 {
        self.first_day + self.days - 1
    }

    pub fn previous(&self) -> Period {
        Period::containing(self.kind, self.first_day - 1)
    }

    pub fn next(&self) -> Period {
        Period::containing(self.kind, self.first_day + self.days)
    }
}

pub(crate) fn day_string(day: i64) -> String {
    let (y, m, d) = time::civil_from_days(day);
    format!("{y:04}-{m:02}-{d:02}")
}

/// Refuses an impossible UTC offset or an unreadable day in `boundary_offsets`.
pub(crate) fn check_offsets(tz_offset_min: i32, boundary_offsets: &BTreeMap<String, i32>) -> Result<()> {
    for (day, offset) in boundary_offsets {
        time::parse_day(day).ok_or_else(|| CoreError::Invalid(format!("invalid day {day:?}")))?;
        if offset.abs() > 18 * 60 {
            return Err(CoreError::Invalid(format!("invalid UTC offset {offset}")));
        }
    }
    if tz_offset_min.abs() > 18 * 60 {
        return Err(CoreError::Invalid(format!("invalid UTC offset {tz_offset_min}")));
    }
    Ok(())
}

/// UTC instant of local midnight at the start of `day`: the offset of that very day when given
/// (daylight-saving change), the offset of now otherwise.
pub(crate) fn midnight_of(day: i64, tz_offset_min: i32, boundary_offsets: &BTreeMap<String, i32>) -> i64 {
    let offset = boundary_offsets.get(&day_string(day)).copied().unwrap_or(tz_offset_min);
    day * DAY_MS - i64::from(offset) * 60_000
}

/// `[from, to)` in Unix ms, UTC, of a period's local days.
pub(crate) fn window_of(p: &Period, tz_offset_min: i32, boundary_offsets: &BTreeMap<String, i32>) -> (i64, i64) {
    (midnight_of(p.first_day, tz_offset_min, boundary_offsets), midnight_of(p.first_day + p.days, tz_offset_min, boundary_offsets))
}

// --- Goals --------------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessGoal {
    pub id: i64,
    pub period_kind: PeriodKind,
    pub period_key: String,
    pub metric: ProcessMetric,
    /// A whole number for counts and journal days; a percentage (0 < t ≤ 100) for rates.
    pub target: Decimal,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewProcessGoal {
    pub period_kind: PeriodKind,
    pub period_key: String,
    pub metric: ProcessMetric,
    pub target: Decimal,
}

fn whole(target: Decimal) -> Option<i64> {
    use rust_decimal::prelude::ToPrimitive;
    (target.fract().is_zero()).then(|| target.trunc().to_i64()).flatten()
}

/// Checks a target and returns the value to store (whole numbers without decimals: "3.0" → "3").
pub fn validate_target(kind: PeriodKind, metric: ProcessMetric, target: Decimal) -> Result<Decimal> {
    let invalid = |msg: &str| Err(CoreError::Invalid(msg.into()));
    match metric {
        ProcessMetric::RulesRespectRate | ProcessMetric::PlanFollowRate => {
            if target <= Decimal::ZERO || target > Decimal::ONE_HUNDRED {
                return invalid("a rate target is a percentage above 0 and at most 100");
            }
            Ok(target)
        }
        ProcessMetric::JournalDays => {
            let max = if kind == PeriodKind::Week { 7 } else { 31 };
            match whole(target) {
                Some(n) if (1..=max).contains(&n) => Ok(Decimal::from(n)),
                _ => invalid(if kind == PeriodKind::Week {
                    "a weekly journal target is a whole number of days from 1 to 7"
                } else {
                    "a monthly journal target is a whole number of days from 1 to 31"
                }),
            }
        }
        _ => match whole(target) {
            Some(n) if (0..=MAX_COUNT_TARGET).contains(&n) => Ok(Decimal::from(n)),
            _ => invalid("a ceiling is a whole number from 0 to 10000"),
        },
    }
}

/// Creates the goal of a period and metric, or changes its target when it exists.
/// Nothing is written when a value is refused.
pub fn set(conn: &Connection, new: &NewProcessGoal) -> Result<ProcessGoal> {
    let period = Period::parse(new.period_kind, &new.period_key)?;
    let target = validate_target(new.period_kind, new.metric, new.target)?;
    conn.execute(
        "INSERT INTO process_goals (period_kind, period_key, metric, target) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(period_kind, period_key, metric) DO UPDATE SET target = ?4",
        params![period.kind, period.key, new.metric, money::to_db(target)],
    )?;
    let id: i64 = conn.query_row(
        "SELECT id FROM process_goals WHERE period_kind = ?1 AND period_key = ?2 AND metric = ?3",
        params![period.kind, period.key, new.metric],
        |r| r.get(0),
    )?;
    get(conn, id)
}

pub fn get(conn: &Connection, id: i64) -> Result<ProcessGoal> {
    conn.query_row(&format!("{SELECT} WHERE id = ?1"), [id], row)
        .optional()?
        .ok_or_else(|| CoreError::NotFound(format!("process goal {id}")))
}

/// The goals of a period, in the order of the metrics.
pub fn list(conn: &Connection, kind: PeriodKind, key: &str) -> Result<Vec<ProcessGoal>> {
    let period = Period::parse(kind, key)?;
    let mut stmt = conn.prepare(&format!("{SELECT} WHERE period_kind = ?1 AND period_key = ?2"))?;
    let mut rows = stmt.query_map(params![period.kind, period.key], row)?.collect::<std::result::Result<Vec<_>, _>>()?;
    rows.sort_by_key(|g| g.metric);
    Ok(rows)
}

pub fn delete(conn: &Connection, id: i64) -> Result<()> {
    get(conn, id)?;
    conn.execute("DELETE FROM process_goals WHERE id = ?1", [id])?;
    Ok(())
}

/// Copies the goals of the previous period of the same kind, leaving alone the metrics that already
/// have a goal. Returns the goals of the period.
pub fn copy_from_previous(conn: &Connection, kind: PeriodKind, key: &str) -> Result<Vec<ProcessGoal>> {
    let period = Period::parse(kind, key)?;
    let previous = period.previous();
    conn.execute(
        "INSERT OR IGNORE INTO process_goals (period_kind, period_key, metric, target)
         SELECT period_kind, ?3, metric, target FROM process_goals WHERE period_kind = ?1 AND period_key = ?2 ORDER BY id",
        params![kind, previous.key, period.key],
    )?;
    list(conn, kind, key)
}

const SELECT: &str = "SELECT id, period_kind, period_key, metric, target FROM process_goals";

fn row(r: &rusqlite::Row) -> rusqlite::Result<ProcessGoal> {
    Ok(ProcessGoal { id: r.get(0)?, period_kind: r.get(1)?, period_key: r.get(2)?, metric: r.get(3)?, target: money::col(r, 4)? })
}

// --- Progress -----------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Status {
    /// Ceiling not crossed, period still running.
    RespectedSoFar,
    /// Ceiling crossed (final, even before the period ends).
    Exceeded,
    /// Ceiling not crossed, period over.
    Respected,
    /// Floor reached (final).
    Reached,
    /// Floor not reached yet, period still running.
    InProgress,
    /// Floor not reached, period over.
    Missed,
    /// The source report has no value (no closed trade, no rule ticked, too few plans declared…).
    NoData,
    /// The discipline threshold the metric needs is not set.
    SettingRequired,
}

impl Status {
    fn is_success(self) -> bool {
        matches!(self, Status::Respected | Status::Reached)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PeriodState {
    Past,
    Current,
    Future,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgressQuery {
    /// Accounts to measure (all active ones when empty); they must share one currency.
    #[serde(default)]
    pub account_ids: Vec<i64>,
    pub period_kind: PeriodKind,
    pub period_key: String,
    /// Unix ms, UTC: tells which periods are over.
    pub now_ms: i64,
    /// The trader's UTC offset now, in minutes (Paris in summer: 120).
    #[serde(default)]
    pub tz_offset_min: i32,
    /// Offset in effect at local midnight of some days ("YYYY-MM-DD" → minutes), for periods whose
    /// bounds are on the other side of a daylight-saving change; any other bound uses `tz_offset_min`.
    #[serde(default)]
    pub boundary_offsets: BTreeMap<String, i32>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PeriodInfo {
    pub kind: PeriodKind,
    pub key: String,
    /// First and last local days, "YYYY-MM-DD".
    pub first_day: String,
    pub last_day: String,
    /// `[from, to)` in Unix ms, UTC: the exit window of the trades counted.
    pub from: i64,
    pub to: i64,
    pub state: PeriodState,
    pub previous_key: String,
    pub next_key: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessGoalProgress {
    pub goal: ProcessGoal,
    pub direction: GoalDirection,
    pub unit: Unit,
    /// Count, or percentage (0–100) for a rate; `None` = no data or setting required.
    pub value: Option<f64>,
    /// For a rate: what is counted over what (rules respected / rules ticked; trades in plan / trades
    /// with a declared plan). `None` for a count.
    pub numerator: Option<usize>,
    pub denominator: Option<usize>,
    /// Closed trades of the period (the selection every report uses).
    pub trade_count: usize,
    pub status: Status,
    pub required_setting: Option<RequiredSetting>,
    /// Consecutive previous periods of the same kind, over and successful, with a goal on this metric.
    pub streak: u32,
    /// Trades in question, as the source report lists them (no stop, revenge, beyond the daily limit,
    /// over the risk limit); empty for the other metrics.
    pub trade_ids: Vec<i64>,
    /// Local days in question: overtrading days, days with a journal entry.
    pub days: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessProgress {
    pub period: PeriodInfo,
    pub currency: Option<String>,
    pub max_trades_per_day: Option<u32>,
    pub max_risk_percent: Option<Decimal>,
    pub goals: Vec<ProcessGoalProgress>,
}

/// What a metric measured on one period.
#[derive(Debug, Clone, PartialEq)]
struct Measure {
    value: Option<f64>,
    /// Exact comparison: a count, or `numerator / denominator` × 100 for a rate.
    count: Option<usize>,
    ratio: Option<(usize, usize)>,
    trade_count: usize,
    setting_required: bool,
    trade_ids: Vec<i64>,
    days: Vec<String>,
}

impl Measure {
    fn empty(trade_count: usize) -> Measure {
        Measure { value: None, count: None, ratio: None, trade_count, setting_required: false, trade_ids: Vec::new(), days: Vec::new() }
    }

    fn count(n: usize, trade_count: usize) -> Measure {
        Measure { value: Some(n as f64), count: Some(n), ..Measure::empty(trade_count) }
    }

    fn rate(numerator: usize, denominator: usize, trade_count: usize) -> Measure {
        Measure {
            value: Some(numerator as f64 * 100.0 / denominator as f64),
            ratio: Some((numerator, denominator)),
            ..Measure::empty(trade_count)
        }
    }

    /// −1 below the target, 0 exactly on it, +1 above; `None` without a value. Exact: integers and decimals.
    fn compare(&self, target: Decimal) -> Option<std::cmp::Ordering> {
        if let Some(n) = self.count {
            return Some(Decimal::from(n as u64).cmp(&target));
        }
        let (num, den) = self.ratio?;
        let left = Decimal::from(num as u64).checked_mul(Decimal::ONE_HUNDRED)?;
        let right = target.checked_mul(Decimal::from(den as u64))?;
        Some(left.cmp(&right))
    }
}

/// Everything the metrics read, loaded once.
struct Sources {
    ledger: Ledger,
    settings: BehaviorSettings,
    rules: Vec<Rule>,
    missed: Vec<behavior::MissedFacts>,
    journal: Vec<JournalEntry>,
    tz_offset_min: i32,
    boundary_offsets: BTreeMap<String, i32>,
    account_ids: Vec<i64>,
}

impl Sources {
    fn load(conn: &Connection, q: &ProgressQuery) -> Result<Sources> {
        check_offsets(q.tz_offset_min, &q.boundary_offsets)?;
        let ledger = stats::load(conn, &q.account_ids)?;
        let accounts: Vec<i64> = ledger.accounts.iter().map(|a| a.id).collect();
        Ok(Sources {
            missed: behavior::load_missed(conn, &accounts)?,
            settings: settings::behavior(conn)?,
            rules: rules::list(conn, true)?,
            journal: journal::list(conn, None, None)?,
            ledger,
            tz_offset_min: q.tz_offset_min,
            boundary_offsets: q.boundary_offsets.clone(),
            account_ids: q.account_ids.clone(),
        })
    }

    fn window(&self, p: &Period) -> (i64, i64) {
        window_of(p, self.tz_offset_min, &self.boundary_offsets)
    }

    fn query(&self, p: &Period) -> StatsQuery {
        let (from, to) = self.window(p);
        StatsQuery { account_ids: self.account_ids.clone(), from: Some(from), to: Some(to), ..Default::default() }
    }

    fn measure(&self, p: &Period, metric: ProcessMetric) -> Result<Measure> {
        let q = self.query(p);
        let trade_count = stats::replay(&self.ledger)?.selected(&q).len();
        let none_without_trades = |m: Measure| if trade_count == 0 { Measure::empty(0) } else { m };
        Ok(match metric {
            ProcessMetric::NoStopTrades => {
                let report = behavior::discipline(&self.ledger, &q, &self.settings)?;
                let ids: Vec<i64> = report.trades.iter().filter(|t| !t.has_stop_loss).map(|t| t.trade_id).collect();
                none_without_trades(Measure { trade_ids: ids.clone(), ..Measure::count(ids.len(), trade_count) })
            }
            ProcessMetric::RevengeTrades => {
                let report = behavior::patterns(&self.ledger, &self.missed, &q, &self.settings)?;
                let ids: Vec<i64> = report.revenge_trades.iter().map(|r| r.trade_id).collect();
                none_without_trades(Measure { trade_ids: ids.clone(), ..Measure::count(ids.len(), trade_count) })
            }
            ProcessMetric::OvertradingDays => {
                if self.settings.max_trades_per_day.is_none() {
                    return Ok(Measure { setting_required: true, ..Measure::empty(trade_count) });
                }
                let report = behavior::patterns(&self.ledger, &self.missed, &q, &self.settings)?;
                let days = &report.overtrading_days;
                none_without_trades(Measure {
                    trade_ids: days.iter().flat_map(|d| d.trade_ids.iter().copied()).collect(),
                    days: days.iter().map(|d| d.day.clone()).collect(),
                    ..Measure::count(days.len(), trade_count)
                })
            }
            ProcessMetric::RiskBreaches => {
                if self.settings.max_risk_percent.is_none() {
                    return Ok(Measure { setting_required: true, ..Measure::empty(trade_count) });
                }
                let report = comparisons::risk_benchmark(&self.ledger, &q, &self.settings)?;
                if report.evaluated_count == 0 {
                    // Nothing could be measured (no trade, or none with a stop and a positive balance):
                    // never a success by default.
                    Measure::empty(trade_count)
                } else {
                    let mut ids: Vec<i64> = report.violations.iter().map(|v| v.trade_id).collect();
                    ids.reverse(); // exit order, like the other lists
                    Measure { trade_ids: ids, ..Measure::count(report.over_count, trade_count) }
                }
            }
            ProcessMetric::RulesRespectRate => {
                let report = behavior::rule_adherence(&self.ledger, &q, &self.rules)?;
                if report.checks == 0 { Measure::empty(trade_count) } else { Measure::rate(report.respected, report.checks, trade_count) }
            }
            ProcessMetric::PlanFollowRate => {
                let report = behavior::plan(&self.ledger, &q)?;
                let count = |key: &str| report.groups.iter().find(|g| g.key == key).map_or(0, |g| g.summary.trade_count);
                let (yes, declared) = (count("yes"), count("yes") + count("partial") + count("no"));
                if declared < MIN_PLAN_TRADES { Measure::empty(trade_count) } else { Measure::rate(yes, declared, trade_count) }
            }
            ProcessMetric::JournalDays => {
                let (first, last) = (day_string(p.first_day), day_string(p.last_day()));
                let mut days: Vec<String> =
                    self.journal.iter().filter(|e| e.day >= first && e.day <= last && !e.is_blank()).map(|e| e.day.clone()).collect();
                days.sort();
                Measure { days: days.clone(), ..Measure::count(days.len(), trade_count) }
            }
        })
    }
}

fn status(m: &Measure, direction: GoalDirection, target: Decimal, over: bool) -> Status {
    use std::cmp::Ordering::*;
    if m.setting_required {
        return Status::SettingRequired;
    }
    match (m.compare(target), direction) {
        (None, _) => Status::NoData,
        (Some(Greater), GoalDirection::AtMost) => Status::Exceeded,
        (Some(_), GoalDirection::AtMost) if over => Status::Respected,
        (Some(_), GoalDirection::AtMost) => Status::RespectedSoFar,
        (Some(Less), GoalDirection::AtLeast) if over => Status::Missed,
        (Some(Less), GoalDirection::AtLeast) => Status::InProgress,
        (Some(_), GoalDirection::AtLeast) => Status::Reached,
    }
}

/// Every goal of the period with its value, status, streak and the trades or days in question.
pub fn progress(conn: &Connection, q: &ProgressQuery) -> Result<ProcessProgress> {
    let period = Period::parse(q.period_kind, &q.period_key)?;
    let sources = Sources::load(conn, q)?;
    let today = time::local_day_number(q.now_ms, q.tz_offset_min);
    let is_over = |p: &Period| today > p.last_day();
    let (from, to) = sources.window(&period);
    let state = if is_over(&period) {
        PeriodState::Past
    } else if today < period.first_day {
        PeriodState::Future
    } else {
        PeriodState::Current
    };
    let info = PeriodInfo {
        kind: period.kind,
        key: period.key.clone(),
        first_day: day_string(period.first_day),
        last_day: day_string(period.last_day()),
        from,
        to,
        state,
        previous_key: period.previous().key,
        next_key: period.next().key,
    };

    // Targets of every period of this kind, for the streaks.
    let mut targets: HashMap<(String, ProcessMetric), Decimal> = HashMap::new();
    {
        let mut stmt = conn.prepare(&format!("{SELECT} WHERE period_kind = ?1"))?;
        for g in stmt.query_map([q.period_kind], row)? {
            let g = g?;
            targets.insert((g.period_key, g.metric), g.target);
        }
    }

    let goals = list(conn, q.period_kind, &q.period_key)?;
    let mut out = Vec::with_capacity(goals.len());
    for goal in goals {
        let m = sources.measure(&period, goal.metric)?;
        let direction = goal.metric.direction();
        let st = status(&m, direction, goal.target, is_over(&period));

        let mut streak = 0;
        let mut p = period.previous();
        while streak < MAX_STREAK && is_over(&p) {
            let Some(&target) = targets.get(&(p.key.clone(), goal.metric)) else { break };
            if !status(&sources.measure(&p, goal.metric)?, direction, target, true).is_success() {
                break;
            }
            streak += 1;
            p = p.previous();
        }

        out.push(ProcessGoalProgress {
            direction,
            unit: goal.metric.unit(),
            value: m.value,
            numerator: m.ratio.map(|r| r.0),
            denominator: m.ratio.map(|r| r.1),
            trade_count: m.trade_count,
            status: st,
            required_setting: goal.metric.required_setting().filter(|_| m.setting_required),
            streak,
            trade_ids: m.trade_ids,
            days: m.days,
            goal,
        });
    }
    Ok(ProcessProgress {
        period: info,
        currency: sources.ledger.currency.clone(),
        max_trades_per_day: sources.settings.max_trades_per_day,
        max_risk_percent: sources.settings.max_risk_percent,
        goals: out,
    })
}

#[cfg(test)]
mod tests;
