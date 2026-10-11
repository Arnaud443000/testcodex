//! Strategy backtests (cahier 3.3.16 complement): a place to note, case by case, whether a strategy
//! works over the long run.
//!
//! A backtest is a **hypothesis under test, not a trade**: it never produces real PnL and never enters
//! a performance statistic. Results are R-multiples typed by the trader (exact decimals in the
//! database, `f64` ratios in the reports).
//!
//! - A *session* holds the strategy (name, asset, timeframe, entry conditions, exit rules).
//! - A *case* is one occurrence of the setup: observed in the past (`past`) or seen live (`live`),
//!   whether the setup was really valid, the planned R:R, the R actually obtained and `max_r`, the
//!   furthest the price went in the trade's favour (in R) **before the stop was hit or the trade ended**.
//! - Performance counts only **valid** setups that were entered (`yes` + an outcome other than
//!   `no_entry`); `doubtful` ones join only when asked. Invalid setups feed the validity rate.
//! - "What if the TP had been further": see [`scenarios`]. It is a simulation on the cases that carry
//!   a `max_r`, never advice, and it names a best TP only from [`MIN_SAMPLE`] cases.

use crate::error::{CoreError, Result};
use crate::money::{self, Decimal};
use crate::stats::{self, StatsQuery};
use crate::tags::{self, TagKind};
use crate::trades::Direction;
use crate::util::{check_tz_offset, clean_text, text_enum};
use rusqlite::{Connection, OptionalExtension, params};
use rust_decimal::prelude::ToPrimitive;
use serde::{Deserialize, Serialize};

/// Below this many cases, a result is shown but flagged `lowSample` and no "best" is named.
pub const MIN_SAMPLE: usize = 30;
/// Take-profit levels (in R) tested by the simulation.
pub const TP_LEVELS: &[f64] = &[0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0];
const MAX_R: i64 = 1000;

text_enum!(
    /// Where the trader stands on the strategy (their own call, never computed).
    BacktestStatus {
        Running => "running",
        Validated => "validated",
        Rejected => "rejected",
    }
);

text_enum!(
    /// How the case was found: studied on past charts, or seen live on the market.
    Observation {
        Past => "past",
        Live => "live",
    }
);

text_enum!(
    /// Did the setup really meet the entry conditions?
    SetupValidity {
        Yes => "yes",
        No => "no",
        Doubtful => "doubtful",
    }
);

text_enum!(
    /// How the case ended. `NoEntry`: valid setup, but the entry was never triggered.
    CaseOutcome {
        Tp => "tp",
        Sl => "sl",
        Manual => "manual",
        NoEntry => "no_entry",
    }
);

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BacktestData {
    pub name: String,
    #[serde(default)]
    pub asset: String,
    #[serde(default)]
    pub timeframe: String,
    /// Entry conditions, free text (one per line works well).
    #[serde(default)]
    pub entry_conditions: String,
    #[serde(default)]
    pub exit_rules: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default = "default_status")]
    pub status: BacktestStatus,
    /// Optional `setup` tag, to compare the backtest with the real trades of that setup.
    #[serde(default)]
    pub setup_tag_id: Option<i64>,
}

fn default_status() -> BacktestStatus {
    BacktestStatus::Running
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Backtest {
    pub id: i64,
    #[serde(flatten)]
    pub data: BacktestData,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaseData {
    /// Unix milliseconds, UTC: when the setup occurred.
    pub occurred_at: i64,
    #[serde(default)]
    pub tz_offset_min: i32,
    #[serde(default)]
    pub direction: Option<Direction>,
    pub observation: Observation,
    pub setup_valid: SetupValidity,
    pub outcome: CaseOutcome,
    /// R:R planned before the trade (> 0).
    #[serde(default)]
    pub planned_rr: Option<Decimal>,
    /// R actually obtained (−1 = stopped out). Required unless `no_entry`.
    #[serde(default)]
    pub result_r: Option<Decimal>,
    /// Furthest favourable excursion in R before the stop was hit or the trade ended (≥ 0).
    #[serde(default)]
    pub max_r: Option<Decimal>,
    #[serde(default)]
    pub notes: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BacktestCase {
    pub id: i64,
    pub backtest_id: i64,
    #[serde(flatten)]
    pub data: CaseData,
}

// --- Sessions -----------------------------------------------------------------------------

pub fn create(conn: &Connection, data: &BacktestData) -> Result<Backtest> {
    let d = validate(conn, data, None)?;
    conn.execute(
        "INSERT INTO backtests (name, asset, timeframe, entry_conditions, exit_rules, notes, status, setup_tag_id)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        params![d.name, d.asset, d.timeframe, d.entry_conditions, d.exit_rules, d.notes, d.status, d.setup_tag_id],
    )?;
    get(conn, conn.last_insert_rowid())
}

pub fn get(conn: &Connection, id: i64) -> Result<Backtest> {
    conn.query_row(
        "SELECT id, name, asset, timeframe, entry_conditions, exit_rules, notes, status, setup_tag_id FROM backtests WHERE id = ?1",
        [id],
        |r| {
            Ok(Backtest {
                id: r.get(0)?,
                data: BacktestData {
                    name: r.get(1)?,
                    asset: r.get(2)?,
                    timeframe: r.get(3)?,
                    entry_conditions: r.get(4)?,
                    exit_rules: r.get(5)?,
                    notes: r.get(6)?,
                    status: r.get(7)?,
                    setup_tag_id: r.get(8)?,
                },
            })
        },
    )
    .optional()?
    .ok_or_else(|| CoreError::NotFound(format!("backtest {id}")))
}

/// Replaces every field of a backtest session.
pub fn update(conn: &Connection, id: i64, data: &BacktestData) -> Result<Backtest> {
    get(conn, id)?;
    let d = validate(conn, data, Some(id))?;
    conn.execute(
        "UPDATE backtests SET name = ?1, asset = ?2, timeframe = ?3, entry_conditions = ?4, exit_rules = ?5,
             notes = ?6, status = ?7, setup_tag_id = ?8 WHERE id = ?9",
        params![d.name, d.asset, d.timeframe, d.entry_conditions, d.exit_rules, d.notes, d.status, d.setup_tag_id, id],
    )?;
    get(conn, id)
}

/// Deletes the session and all its cases.
pub fn delete(conn: &Connection, id: i64) -> Result<()> {
    get(conn, id)?;
    conn.execute("DELETE FROM backtests WHERE id = ?1", [id])?;
    Ok(())
}

fn validate(conn: &Connection, d: &BacktestData, own_id: Option<i64>) -> Result<BacktestData> {
    let name = clean_text("name", &d.name)?;
    if name.chars().count() > 80 {
        return Err(CoreError::Invalid("name must be at most 80 characters".into()));
    }
    let clash: Option<i64> = conn
        .query_row("SELECT id FROM backtests WHERE lower(trim(name)) = lower(?1)", [&name], |r| r.get(0))
        .optional()?;
    if clash.is_some_and(|c| Some(c) != own_id) {
        return Err(CoreError::Invalid(format!("a backtest named {name:?} already exists")));
    }
    if let Some(tag) = d.setup_tag_id {
        let tag = tags::get(conn, tag).map_err(|_| CoreError::Invalid("unknown tag".into()))?;
        if tag.kind != TagKind::Setup {
            return Err(CoreError::Invalid("a backtest can only be linked to a setup tag".into()));
        }
    }
    let short = |field: &str, s: &str, max: usize| -> Result<String> {
        let s = s.trim().to_string();
        if s.chars().count() > max {
            return Err(CoreError::Invalid(format!("{field} must be at most {max} characters")));
        }
        Ok(s)
    };
    Ok(BacktestData {
        name,
        asset: short("asset", &d.asset, 40)?,
        timeframe: short("timeframe", &d.timeframe, 20)?,
        entry_conditions: short("entry conditions", &d.entry_conditions, 4000)?,
        exit_rules: short("exit rules", &d.exit_rules, 4000)?,
        notes: short("notes", &d.notes, 4000)?,
        status: d.status,
        setup_tag_id: d.setup_tag_id,
    })
}

// --- Cases --------------------------------------------------------------------------------

pub fn add_case(conn: &Connection, backtest_id: i64, data: &CaseData) -> Result<BacktestCase> {
    get(conn, backtest_id)?;
    let d = validate_case(data)?;
    conn.execute(
        "INSERT INTO backtest_cases (backtest_id, occurred_at, tz_offset_min, direction, observation, setup_valid,
             outcome, planned_rr, result_r, max_r, notes) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
        params![
            backtest_id,
            d.occurred_at,
            d.tz_offset_min,
            d.direction,
            d.observation,
            d.setup_valid,
            d.outcome,
            money::opt_to_db(d.planned_rr),
            money::opt_to_db(d.result_r),
            money::opt_to_db(d.max_r),
            d.notes
        ],
    )?;
    get_case(conn, conn.last_insert_rowid())
}

pub fn get_case(conn: &Connection, id: i64) -> Result<BacktestCase> {
    load_cases(conn, "id = ?1", id)?.pop().ok_or_else(|| CoreError::NotFound(format!("backtest case {id}")))
}

/// Cases of a session, oldest first (then by id).
pub fn list_cases(conn: &Connection, backtest_id: i64) -> Result<Vec<BacktestCase>> {
    get(conn, backtest_id)?;
    load_cases(conn, "backtest_id = ?1", backtest_id)
}

/// Replaces every field of a case (the session it belongs to does not change).
pub fn update_case(conn: &Connection, id: i64, data: &CaseData) -> Result<BacktestCase> {
    get_case(conn, id)?;
    let d = validate_case(data)?;
    conn.execute(
        "UPDATE backtest_cases SET occurred_at = ?1, tz_offset_min = ?2, direction = ?3, observation = ?4,
             setup_valid = ?5, outcome = ?6, planned_rr = ?7, result_r = ?8, max_r = ?9, notes = ?10 WHERE id = ?11",
        params![
            d.occurred_at,
            d.tz_offset_min,
            d.direction,
            d.observation,
            d.setup_valid,
            d.outcome,
            money::opt_to_db(d.planned_rr),
            money::opt_to_db(d.result_r),
            money::opt_to_db(d.max_r),
            d.notes,
            id
        ],
    )?;
    get_case(conn, id)
}

pub fn delete_case(conn: &Connection, id: i64) -> Result<()> {
    get_case(conn, id)?;
    conn.execute("DELETE FROM backtest_cases WHERE id = ?1", [id])?;
    Ok(())
}

fn validate_case(d: &CaseData) -> Result<CaseData> {
    check_tz_offset(d.tz_offset_min)?;
    let limit = Decimal::from(MAX_R);
    let bounded = |field: &str, v: Option<Decimal>| -> Result<()> {
        match v {
            Some(x) if x.abs() > limit => Err(CoreError::Invalid(format!("{field} must be between -{MAX_R} and {MAX_R}"))),
            _ => Ok(()),
        }
    };
    bounded("planned R:R", d.planned_rr)?;
    bounded("result R", d.result_r)?;
    bounded("max R", d.max_r)?;
    if d.planned_rr.is_some_and(|x| x <= Decimal::ZERO) {
        return Err(CoreError::Invalid("planned R:R must be greater than zero".into()));
    }
    if d.max_r.is_some_and(|x| x < Decimal::ZERO) {
        return Err(CoreError::Invalid("max R cannot be negative (0 = the price never went in favour)".into()));
    }
    let mut out = d.clone();
    out.notes = d.notes.trim().to_string();
    if out.notes.chars().count() > 4000 {
        return Err(CoreError::Invalid("notes must be at most 4000 characters".into()));
    }
    if d.outcome == CaseOutcome::NoEntry {
        // Never entered: there is no result, and no excursion to measure.
        out.result_r = None;
        out.max_r = None;
        return Ok(out);
    }
    let result = d.result_r.ok_or_else(|| CoreError::Invalid("the result in R is required once the trade was entered".into()))?;
    match d.outcome {
        CaseOutcome::Tp if result <= Decimal::ZERO => {
            return Err(CoreError::Invalid("a take-profit hit must have a positive result".into()));
        }
        CaseOutcome::Sl if result > Decimal::ZERO => {
            return Err(CoreError::Invalid("a stop-loss hit cannot have a positive result".into()));
        }
        _ => {}
    }
    if d.max_r.is_some_and(|m| m < result) {
        return Err(CoreError::Invalid("max R cannot be below the result: the price went at least that far".into()));
    }
    Ok(out)
}

fn load_cases(conn: &Connection, cond: &str, arg: i64) -> Result<Vec<BacktestCase>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT id, backtest_id, occurred_at, tz_offset_min, direction, observation, setup_valid, outcome,
                planned_rr, result_r, max_r, notes
         FROM backtest_cases WHERE {cond} ORDER BY occurred_at, id"
    ))?;
    let rows = stmt
        .query_map([arg], |r| {
            Ok(BacktestCase {
                id: r.get(0)?,
                backtest_id: r.get(1)?,
                data: CaseData {
                    occurred_at: r.get(2)?,
                    tz_offset_min: r.get(3)?,
                    direction: r.get(4)?,
                    observation: r.get(5)?,
                    setup_valid: r.get(6)?,
                    outcome: r.get(7)?,
                    planned_rr: money::opt_col(r, 8)?,
                    result_r: money::opt_col(r, 9)?,
                    max_r: money::opt_col(r, 10)?,
                    notes: r.get(11)?,
                },
            })
        })?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

// --- Reports ------------------------------------------------------------------------------

/// Which cases count as "performance".
#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportOptions {
    /// Also count `doubtful` setups (valid ones always count).
    #[serde(default)]
    pub include_doubtful: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Validity {
    pub yes: usize,
    pub no: usize,
    pub doubtful: usize,
    /// Valid / (valid + invalid); doubtful ones are left out. `None` when none is decided.
    pub rate: Option<f64>,
}

/// Results of a set of entered cases, in R. Undefined values are `None`, never 0.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerfSummary {
    pub trade_count: usize,
    pub win_count: usize,
    pub loss_count: usize,
    pub breakeven_count: usize,
    pub win_rate: Option<f64>,
    /// Mean R per case.
    pub expectancy_r: Option<f64>,
    pub total_r: f64,
    pub avg_win_r: Option<f64>,
    /// Average loss, as a positive number.
    pub avg_loss_r: Option<f64>,
    /// Gains / losses in R; `None` without any loss (the interface shows "∞" when there are gains).
    pub profit_factor: Option<f64>,
    pub avg_planned_rr: Option<f64>,
    pub avg_max_r: Option<f64>,
    /// Largest fall of the cumulative R curve from a peak (start = 0), ≥ 0.
    pub max_drawdown_r: f64,
    pub low_sample: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CurvePoint {
    pub case_id: i64,
    pub occurred_at: i64,
    pub result_r: f64,
    pub cumulative_r: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Scenario {
    pub tp_r: f64,
    /// Cases whose price went at least that far.
    pub reached_count: usize,
    pub win_rate: Option<f64>,
    pub expectancy_r: Option<f64>,
    pub total_r: f64,
    /// Simulated total − real total on the same cases (positive: a further TP would have paid more).
    pub difference_r: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TpScenarios {
    /// Entered cases that carry a `max_r`: the only ones the simulation can use.
    pub sample_count: usize,
    /// Entered cases without a `max_r`, left out of the simulation.
    pub missing_max_r_count: usize,
    pub low_sample: bool,
    /// What really happened, on the same cases.
    pub actual_total_r: f64,
    pub actual_expectancy_r: Option<f64>,
    pub actual_win_rate: Option<f64>,
    pub levels: Vec<Scenario>,
    /// TP (in R) with the highest total; ties go to the lowest. `None` below [`MIN_SAMPLE`] cases.
    pub best_tp_r: Option<f64>,
}

/// Backtest compared with the real trades carrying the linked setup tag (all active accounts, all time).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RealComparison {
    pub tag_id: i64,
    pub trade_count: usize,
    pub win_rate: Option<f64>,
    pub expectancy_r: Option<f64>,
    pub r_trade_count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BacktestReport {
    pub backtest_id: i64,
    pub case_count: usize,
    pub validity: Validity,
    /// Valid setups whose entry never triggered.
    pub no_entry_count: usize,
    /// Cases counted as performance (see [`ReportOptions`]).
    pub overall: PerfSummary,
    pub past: PerfSummary,
    pub live: PerfSummary,
    pub long: PerfSummary,
    pub short: PerfSummary,
    pub curve: Vec<CurvePoint>,
    pub scenarios: TpScenarios,
    pub real: Option<RealComparison>,
}

/// One line of the list of backtests.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BacktestListItem {
    #[serde(flatten)]
    pub backtest: Backtest,
    pub case_count: usize,
    pub validity_rate: Option<f64>,
    pub overall: PerfSummary,
}

pub fn list(conn: &Connection) -> Result<Vec<BacktestListItem>> {
    let mut stmt = conn.prepare("SELECT id FROM backtests ORDER BY lower(name), id")?;
    let ids = stmt.query_map([], |r| r.get::<_, i64>(0))?.collect::<std::result::Result<Vec<_>, _>>()?;
    ids.into_iter()
        .map(|id| {
            let backtest = get(conn, id)?;
            let cases = load_cases(conn, "backtest_id = ?1", id)?;
            let r = build_report(&backtest, &cases, ReportOptions::default());
            Ok(BacktestListItem { backtest, case_count: r.case_count, validity_rate: r.validity.rate, overall: r.overall })
        })
        .collect()
}

pub fn report(conn: &Connection, backtest_id: i64, options: ReportOptions) -> Result<BacktestReport> {
    let backtest = get(conn, backtest_id)?;
    let cases = load_cases(conn, "backtest_id = ?1", backtest_id)?;
    let mut report = build_report(&backtest, &cases, options);
    if let Some(tag_id) = backtest.data.setup_tag_id {
        // A mixed-currency selection cannot be reported: the comparison is then simply left out.
        report.real = stats::report(conn, &StatsQuery { tag_ids: vec![tag_id], ..StatsQuery::default() })
            .ok()
            .filter(|r| r.summary.trade_count > 0)
            .map(|r| RealComparison {
                tag_id,
                trade_count: r.summary.trade_count,
                win_rate: r.summary.win_rate,
                expectancy_r: r.summary.expectancy_r,
                r_trade_count: r.summary.r_trade_count,
            });
    }
    Ok(report)
}

/// An entered case with its numbers as `f64`.
#[derive(Debug, Clone, Copy)]
struct Taken<'a> {
    case: &'a BacktestCase,
    result: f64,
}

fn f(d: Decimal) -> f64 {
    d.to_f64().unwrap_or(0.0)
}

/// Pure report from a session and its cases (the SQLite part is only [`report`]).
pub fn build_report(backtest: &Backtest, cases: &[BacktestCase], options: ReportOptions) -> BacktestReport {
    let count = |v: SetupValidity| cases.iter().filter(|c| c.data.setup_valid == v).count();
    let (yes, no, doubtful) = (count(SetupValidity::Yes), count(SetupValidity::No), count(SetupValidity::Doubtful));
    let counts = |c: &BacktestCase| match c.data.setup_valid {
        SetupValidity::Yes => true,
        SetupValidity::Doubtful => options.include_doubtful,
        SetupValidity::No => false,
    };
    let eligible: Vec<&BacktestCase> = cases.iter().filter(|c| counts(c)).collect();
    let no_entry_count = cases.iter().filter(|c| c.data.setup_valid == SetupValidity::Yes && c.data.outcome == CaseOutcome::NoEntry).count();
    let mut taken: Vec<Taken> = eligible
        .iter()
        .filter(|c| c.data.outcome != CaseOutcome::NoEntry)
        .filter_map(|c| c.data.result_r.map(|r| Taken { case: c, result: f(r) }))
        .collect();
    taken.sort_by_key(|t| (t.case.data.occurred_at, t.case.id));

    let subset = |keep: &dyn Fn(&Taken) -> bool| summarize(&taken.iter().copied().filter(|t| keep(t)).collect::<Vec<_>>());
    let mut cumulative = 0.0;
    let curve = taken
        .iter()
        .map(|t| {
            cumulative += t.result;
            CurvePoint { case_id: t.case.id, occurred_at: t.case.data.occurred_at, result_r: t.result, cumulative_r: cumulative }
        })
        .collect();
    let pairs: Vec<(f64, Option<f64>)> = taken.iter().map(|t| (t.result, t.case.data.max_r.map(f))).collect();

    BacktestReport {
        backtest_id: backtest.id,
        case_count: cases.len(),
        validity: Validity { yes, no, doubtful, rate: (yes + no > 0).then(|| yes as f64 / (yes + no) as f64) },
        no_entry_count,
        overall: summarize(&taken),
        past: subset(&|t| t.case.data.observation == Observation::Past),
        live: subset(&|t| t.case.data.observation == Observation::Live),
        long: subset(&|t| t.case.data.direction == Some(Direction::Long)),
        short: subset(&|t| t.case.data.direction == Some(Direction::Short)),
        curve,
        scenarios: scenarios(&pairs),
        real: None,
    }
}

fn mean(sum: f64, n: usize) -> Option<f64> {
    (n > 0).then(|| sum / n as f64)
}

fn summarize(taken: &[Taken]) -> PerfSummary {
    let n = taken.len();
    let wins: Vec<f64> = taken.iter().map(|t| t.result).filter(|r| *r > 0.0).collect();
    let losses: Vec<f64> = taken.iter().map(|t| t.result).filter(|r| *r < 0.0).collect();
    let total: f64 = taken.iter().map(|t| t.result).sum();
    let gains: f64 = wins.iter().sum();
    let lost: f64 = -losses.iter().sum::<f64>();
    let planned: Vec<f64> = taken.iter().filter_map(|t| t.case.data.planned_rr.map(f)).collect();
    let max_r: Vec<f64> = taken.iter().filter_map(|t| t.case.data.max_r.map(f)).collect();
    let (mut peak, mut run, mut drawdown) = (0.0f64, 0.0f64, 0.0f64);
    for t in taken {
        run += t.result;
        peak = peak.max(run);
        drawdown = drawdown.max(peak - run);
    }
    PerfSummary {
        trade_count: n,
        win_count: wins.len(),
        loss_count: losses.len(),
        breakeven_count: n - wins.len() - losses.len(),
        win_rate: mean(wins.len() as f64, n),
        expectancy_r: mean(total, n),
        total_r: total,
        avg_win_r: mean(gains, wins.len()),
        avg_loss_r: mean(lost, losses.len()),
        profit_factor: (lost > 0.0).then(|| gains / lost),
        avg_planned_rr: mean(planned.iter().sum(), planned.len()),
        avg_max_r: mean(max_r.iter().sum(), max_r.len()),
        max_drawdown_r: drawdown,
        low_sample: n < MIN_SAMPLE,
    }
}

/// "What if the TP had been at X R?" on `(result, max_r)` pairs of entered cases.
///
/// For each tested TP: if the price went at least that far (`max_r ≥ tp`) the case would have paid
/// exactly `tp`; otherwise it keeps its real result (the price never got there, so a further TP
/// changes nothing). Cases without `max_r` are left out and counted. Because `max_r` is measured
/// *before the stop*, a case stopped out after going to 2.5 R pays +2 at a 2 R TP, which is the point
/// of the exercise; the trader is responsible for noting it honestly.
pub fn scenarios(pairs: &[(f64, Option<f64>)]) -> TpScenarios {
    let usable: Vec<(f64, f64)> = pairs.iter().filter_map(|(r, m)| m.map(|m| (*r, m))).collect();
    let n = usable.len();
    let actual_total: f64 = usable.iter().map(|(r, _)| r).sum();
    let levels: Vec<Scenario> = TP_LEVELS
        .iter()
        .map(|&tp| {
            let sim: Vec<f64> = usable.iter().map(|&(r, m)| if m >= tp { tp } else { r }).collect();
            let total: f64 = sim.iter().sum();
            Scenario {
                tp_r: tp,
                reached_count: usable.iter().filter(|(_, m)| *m >= tp).count(),
                win_rate: mean(sim.iter().filter(|r| **r > 0.0).count() as f64, n),
                expectancy_r: mean(total, n),
                total_r: total,
                difference_r: total - actual_total,
            }
        })
        .collect();
    let low_sample = n < MIN_SAMPLE;
    let best_tp_r = (!low_sample)
        .then(|| {
            levels.iter().fold(None::<&Scenario>, |best, s| match best {
                Some(b) if s.total_r <= b.total_r + 1e-9 => Some(b),
                _ => Some(s),
            })
        })
        .flatten()
        .map(|s| s.tp_r);
    TpScenarios {
        sample_count: n,
        missing_max_r_count: pairs.len() - n,
        low_sample,
        actual_total_r: actual_total,
        actual_expectancy_r: mean(actual_total, n),
        actual_win_rate: mean(usable.iter().filter(|(r, _)| *r > 0.0).count() as f64, n),
        levels,
        best_tp_r,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::dec;
    use crate::{db, tags};

    fn session(name: &str) -> BacktestData {
        BacktestData {
            name: name.into(),
            asset: "EURUSD".into(),
            timeframe: "M15".into(),
            entry_conditions: "Cassure + retest".into(),
            exit_rules: String::new(),
            notes: String::new(),
            status: BacktestStatus::Running,
            setup_tag_id: None,
        }
    }

    fn case(day: i64, outcome: CaseOutcome, result: &str, max: Option<&str>) -> CaseData {
        CaseData {
            occurred_at: day * 86_400_000,
            tz_offset_min: 0,
            direction: Some(Direction::Long),
            observation: Observation::Past,
            setup_valid: SetupValidity::Yes,
            outcome,
            planned_rr: Some(dec("2")),
            result_r: Some(dec(result)),
            max_r: max.map(dec),
            notes: String::new(),
        }
    }

    /// Hand-computed journal "B": five valid, entered cases.
    /// results +2, −1, −1, +2, +1 → total 3, 3 wins, 2 losses, WR 0.6, expectancy 0.6, PF 5/2,
    /// cumulative 2, 1, 0, 2, 3 → max drawdown 2. max_r: 3, 0.5, 2.5, 2, 1.2.
    fn journal_b(conn: &Connection) -> Backtest {
        let b = create(conn, &session("Cassure")).unwrap();
        for (day, outcome, r, m) in [
            (1, CaseOutcome::Tp, "2", "3"),
            (2, CaseOutcome::Sl, "-1", "0.5"),
            (3, CaseOutcome::Sl, "-1", "2.5"),
            (4, CaseOutcome::Tp, "2", "2"),
            (5, CaseOutcome::Manual, "1", "1.2"),
        ] {
            add_case(conn, b.id, &case(day, outcome, r, Some(m))).unwrap();
        }
        b
    }

    #[test]
    fn nominal_performance_in_r() {
        let conn = db::open_in_memory().unwrap();
        let b = journal_b(&conn);
        let r = report(&conn, b.id, ReportOptions::default()).unwrap();
        let o = &r.overall;
        assert_eq!((o.trade_count, o.win_count, o.loss_count, o.breakeven_count), (5, 3, 2, 0));
        assert_eq!(o.win_rate, Some(0.6));
        assert_eq!(o.total_r, 3.0);
        assert_eq!(o.expectancy_r, Some(0.6));
        assert!((o.avg_win_r.unwrap() - 5.0 / 3.0).abs() < 1e-12);
        assert_eq!(o.avg_loss_r, Some(1.0));
        assert_eq!(o.profit_factor, Some(2.5));
        assert_eq!(o.avg_planned_rr, Some(2.0));
        assert!((o.avg_max_r.unwrap() - 1.84).abs() < 1e-12);
        assert_eq!(o.max_drawdown_r, 2.0);
        assert!(o.low_sample);
        let curve: Vec<f64> = r.curve.iter().map(|p| p.cumulative_r).collect();
        assert_eq!(curve, vec![2.0, 1.0, 0.0, 2.0, 3.0]);
        assert_eq!(r.validity, Validity { yes: 5, no: 0, doubtful: 0, rate: Some(1.0) });
    }

    #[test]
    fn tp_scenarios_match_the_hand_computation() {
        let conn = db::open_in_memory().unwrap();
        let b = journal_b(&conn);
        let s = report(&conn, b.id, ReportOptions::default()).unwrap().scenarios;
        assert_eq!((s.sample_count, s.missing_max_r_count), (5, 0));
        assert_eq!(s.actual_total_r, 3.0);
        let total = |tp: f64| s.levels.iter().find(|l| l.tp_r == tp).unwrap();
        // tp 0.5: 0.5 on every case (all went ≥ 0.5) = 2.5
        assert_eq!(total(0.5).total_r, 2.5);
        // tp 1: 1, −1, 1, 1, 1 = 3 ; 4 cases went ≥ 1
        assert_eq!(total(1.0).total_r, 3.0);
        assert_eq!(total(1.0).reached_count, 4);
        assert_eq!(total(1.0).win_rate, Some(0.8));
        // tp 2: 2, −1, 2, 2, 1 = 6 → +3 against reality
        assert_eq!(total(2.0).total_r, 6.0);
        assert_eq!(total(2.0).difference_r, 3.0);
        assert_eq!(total(2.0).reached_count, 3);
        // tp 2.5: 2.5, −1, 2.5, 2 (max 2 < 2.5, keeps its +2), 1 = 7
        assert_eq!(total(2.5).total_r, 7.0);
        // tp 3: 3, −1, −1 (max 2.5 < 3), 2, 1 = 4 ; tp 4 and 5: 2, −1, −1, 2, 1 = 3
        assert_eq!(total(3.0).total_r, 4.0);
        assert_eq!(total(5.0).total_r, 3.0);
        // Only 5 cases: shown, but no "best" is named.
        assert!(s.low_sample);
        assert_eq!(s.best_tp_r, None);
    }

    #[test]
    fn best_tp_is_named_from_thirty_cases_and_ties_go_to_the_lowest() {
        let one: Vec<(f64, Option<f64>)> = vec![(2.0, Some(3.0)), (-1.0, Some(0.5)), (-1.0, Some(2.5)), (2.0, Some(2.0)), (1.0, Some(1.2))];
        let thirty: Vec<_> = one.iter().cycle().take(30).copied().collect();
        let s = scenarios(&thirty);
        assert!(!s.low_sample);
        assert_eq!(s.best_tp_r, Some(2.5));
        assert_eq!(s.levels.iter().find(|l| l.tp_r == 2.5).unwrap().total_r, 42.0);
        // Same total at every level → the lowest TP.
        let flat = vec![(0.0, Some(0.0)); 30];
        assert_eq!(scenarios(&flat).best_tp_r, Some(0.5));
    }

    #[test]
    fn cases_without_max_r_are_left_out_of_scenarios_and_counted() {
        let s = scenarios(&[(2.0, Some(2.0)), (-1.0, None), (1.0, None)]);
        assert_eq!((s.sample_count, s.missing_max_r_count), (1, 2));
        assert_eq!(s.actual_total_r, 2.0);
        let empty = scenarios(&[]);
        assert_eq!((empty.sample_count, empty.actual_total_r, empty.actual_expectancy_r, empty.best_tp_r), (0, 0.0, None, None));
        assert!(empty.levels.iter().all(|l| l.expectancy_r.is_none() && l.win_rate.is_none()));
    }

    #[test]
    fn empty_and_one_sided_reports_use_none_not_zero() {
        let conn = db::open_in_memory().unwrap();
        let b = create(&conn, &session("Vide")).unwrap();
        let r = report(&conn, b.id, ReportOptions::default()).unwrap();
        assert_eq!(r.case_count, 0);
        assert_eq!(r.validity.rate, None);
        assert_eq!((r.overall.win_rate, r.overall.expectancy_r, r.overall.profit_factor), (None, None, None));
        assert!(r.curve.is_empty() && r.real.is_none());
        // Only winners: no loss → profit factor undefined, average loss undefined.
        add_case(&conn, b.id, &case(1, CaseOutcome::Tp, "2", None)).unwrap();
        let r = report(&conn, b.id, ReportOptions::default()).unwrap();
        assert_eq!((r.overall.profit_factor, r.overall.avg_loss_r, r.overall.win_rate), (None, None, Some(1.0)));
        assert_eq!(r.scenarios.missing_max_r_count, 1);
    }

    #[test]
    fn validity_no_entry_and_doubtful_cases() {
        let conn = db::open_in_memory().unwrap();
        let b = create(&conn, &session("Mix")).unwrap();
        add_case(&conn, b.id, &case(1, CaseOutcome::Tp, "2", Some("2"))).unwrap(); // valid, entered
        let mut invalid = case(2, CaseOutcome::Sl, "-1", None);
        invalid.setup_valid = SetupValidity::No;
        add_case(&conn, b.id, &invalid).unwrap(); // invalid: not performance
        let mut doubtful = case(3, CaseOutcome::Sl, "-1", None);
        doubtful.setup_valid = SetupValidity::Doubtful;
        add_case(&conn, b.id, &doubtful).unwrap();
        let mut skipped = case(4, CaseOutcome::NoEntry, "0", Some("5"));
        skipped.result_r = None;
        add_case(&conn, b.id, &skipped).unwrap(); // valid, never entered

        let r = report(&conn, b.id, ReportOptions::default()).unwrap();
        assert_eq!(r.validity, Validity { yes: 2, no: 1, doubtful: 1, rate: Some(2.0 / 3.0) });
        assert_eq!((r.no_entry_count, r.overall.trade_count, r.overall.total_r), (1, 1, 2.0));
        let r = report(&conn, b.id, ReportOptions { include_doubtful: true }).unwrap();
        assert_eq!((r.overall.trade_count, r.overall.total_r, r.overall.loss_count), (2, 1.0, 1));
        // The never-entered case carries no result and no excursion.
        let stored = list_cases(&conn, b.id).unwrap();
        assert_eq!((stored[3].data.result_r, stored[3].data.max_r), (None, None));
    }

    #[test]
    fn past_live_and_direction_breakdowns() {
        let conn = db::open_in_memory().unwrap();
        let b = create(&conn, &session("Obs")).unwrap();
        add_case(&conn, b.id, &case(1, CaseOutcome::Tp, "2", None)).unwrap();
        let mut live = case(2, CaseOutcome::Sl, "-1", None);
        live.observation = Observation::Live;
        live.direction = Some(Direction::Short);
        add_case(&conn, b.id, &live).unwrap();
        let r = report(&conn, b.id, ReportOptions::default()).unwrap();
        assert_eq!((r.past.trade_count, r.past.total_r), (1, 2.0));
        assert_eq!((r.live.trade_count, r.live.total_r), (1, -1.0));
        assert_eq!((r.long.trade_count, r.short.trade_count), (1, 1));
        assert_eq!(r.live.win_rate, Some(0.0));
    }

    #[test]
    fn breakeven_interrupts_nothing_and_counts_in_the_denominator() {
        let conn = db::open_in_memory().unwrap();
        let b = create(&conn, &session("BE")).unwrap();
        add_case(&conn, b.id, &case(1, CaseOutcome::Manual, "0", None)).unwrap();
        add_case(&conn, b.id, &case(2, CaseOutcome::Tp, "1", None)).unwrap();
        let o = report(&conn, b.id, ReportOptions::default()).unwrap().overall;
        assert_eq!((o.win_count, o.loss_count, o.breakeven_count), (1, 0, 1));
        assert_eq!(o.win_rate, Some(0.5));
        assert_eq!(o.profit_factor, None);
    }

    #[test]
    fn validates_cases() {
        let conn = db::open_in_memory().unwrap();
        let b = create(&conn, &session("V")).unwrap();
        let add = |c: CaseData| add_case(&conn, b.id, &c);
        assert!(add(case(1, CaseOutcome::Tp, "-1", None)).is_err(), "a TP cannot lose");
        assert!(add(case(1, CaseOutcome::Tp, "0", None)).is_err());
        assert!(add(case(1, CaseOutcome::Sl, "1", None)).is_err(), "a stop cannot win");
        assert!(add(case(1, CaseOutcome::Sl, "0", None)).is_ok(), "stopped at breakeven");
        let mut no_result = case(1, CaseOutcome::Manual, "1", None);
        no_result.result_r = None;
        assert!(add(no_result).is_err(), "result required once entered");
        assert!(add(case(1, CaseOutcome::Tp, "2", Some("1.5"))).is_err(), "max R below the result");
        assert!(add(case(1, CaseOutcome::Sl, "-1", Some("-0.1"))).is_err());
        let mut rr = case(1, CaseOutcome::Tp, "2", None);
        rr.planned_rr = Some(Decimal::ZERO);
        assert!(add(rr).is_err());
        assert!(add(case(1, CaseOutcome::Tp, "5000", None)).is_err());
        let mut tz = case(1, CaseOutcome::Tp, "2", None);
        tz.tz_offset_min = 5000;
        assert!(add(tz).is_err());
        assert!(add_case(&conn, 999, &case(1, CaseOutcome::Tp, "2", None)).is_err(), "unknown backtest");
        assert_eq!(list_cases(&conn, b.id).unwrap().len(), 1, "only the valid stop-at-breakeven case");
    }

    #[test]
    fn crud_updates_cases_and_cascades() {
        let conn = db::open_in_memory().unwrap();
        let b = create(&conn, &session("  Cassure   NY ")).unwrap();
        assert_eq!(b.data.name, "Cassure NY");
        assert!(create(&conn, &session("cassure ny")).is_err(), "unique, case and spacing aside");
        assert!(create(&conn, &session("   ")).is_err());
        let mut d = b.data.clone();
        d.status = BacktestStatus::Validated;
        d.notes = "  ok ".into();
        let u = update(&conn, b.id, &d).unwrap();
        assert_eq!((u.data.status, u.data.notes.as_str()), (BacktestStatus::Validated, "ok"));
        assert!(update(&conn, b.id, &d).is_ok(), "keeping its own name is fine");

        let c = add_case(&conn, b.id, &case(1, CaseOutcome::Tp, "2", None)).unwrap();
        let mut cd = c.data.clone();
        cd.outcome = CaseOutcome::Sl;
        cd.result_r = Some(dec("-1"));
        let c2 = update_case(&conn, c.id, &cd).unwrap();
        assert_eq!((c2.backtest_id, c2.data.result_r), (b.id, Some(dec("-1"))));
        delete_case(&conn, c.id).unwrap();
        assert!(get_case(&conn, c.id).is_err());

        add_case(&conn, b.id, &case(1, CaseOutcome::Tp, "2", None)).unwrap();
        delete(&conn, b.id).unwrap();
        assert!(get(&conn, b.id).is_err());
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM backtest_cases", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn lists_sessions_with_quick_figures() {
        let conn = db::open_in_memory().unwrap();
        assert!(list(&conn).unwrap().is_empty());
        let b = journal_b(&conn);
        create(&conn, &session("Alpha")).unwrap();
        let l = list(&conn).unwrap();
        assert_eq!(l.iter().map(|i| i.backtest.data.name.as_str()).collect::<Vec<_>>(), vec!["Alpha", "Cassure"]);
        let c = l.iter().find(|i| i.backtest.id == b.id).unwrap();
        assert_eq!((c.case_count, c.overall.trade_count, c.overall.expectancy_r), (5, 5, Some(0.6)));
        assert_eq!(l[0].overall.expectancy_r, None);
    }

    #[test]
    fn links_only_to_a_setup_tag() {
        let conn = db::open_in_memory().unwrap();
        let setup = tags::create(&conn, TagKind::Setup, "Cassure test").unwrap();
        let emotion = tags::create(&conn, TagKind::Emotion, "Calme test").unwrap();
        let mut d = session("Lien");
        d.setup_tag_id = Some(emotion.id);
        assert!(create(&conn, &d).is_err());
        d.setup_tag_id = Some(9999);
        assert!(create(&conn, &d).is_err());
        d.setup_tag_id = Some(setup.id);
        let b = create(&conn, &d).unwrap();
        // No real trade with this setup yet → no comparison.
        assert!(report(&conn, b.id, ReportOptions::default()).unwrap().real.is_none());
    }

    #[test]
    fn compares_with_real_trades_of_the_linked_setup() {
        use crate::trades::{self, TradeData};
        let conn = db::open_in_memory().unwrap();
        let account = crate::test_support::account(&conn, "10000");
        let instrument = crate::test_support::instrument(&conn, "EURUSD", "100000");
        let setup = tags::create(&conn, TagKind::Setup, "Cassure test").unwrap();
        let mut t = TradeData::new(account, instrument, Direction::Long, dec("1"), dec("1.1000"), 1_000);
        t.multiplier = Some(dec("1"));
        t.exit_time = Some(2_000);
        t.exit_price = Some(dec("1.1020"));
        t.planned_sl = Some(dec("1.0990"));
        t.tag_ids = vec![setup.id];
        trades::create(&conn, &t).unwrap();
        let mut d = session("Lien réel");
        d.setup_tag_id = Some(setup.id);
        let b = create(&conn, &d).unwrap();
        let real = report(&conn, b.id, ReportOptions::default()).unwrap().real.unwrap();
        assert_eq!((real.tag_id, real.trade_count, real.win_rate), (setup.id, 1, Some(1.0)));
        assert!((real.expectancy_r.unwrap() - 2.0).abs() < 1e-9, "+0.0020 for 0.0010 at risk");
    }
}
