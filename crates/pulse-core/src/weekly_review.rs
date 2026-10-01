//! Weekly review (lot 36): a weekly appointment with oneself. On Sunday Pulse prepares the **facts** of
//! the week, the trader answers three short questions and sets 1 to 3 intentions for the next week; the
//! week after, the trader says whether they were kept (the "intention loop").
//!
//! **No new formula.** Every fact re-reads a report that already exists, with its definitions, its
//! thresholds and its "no data = `None`" cases; each fact carries its own `None` with a reason, never a
//! 0 in place of an unknown value:
//!
//! | Fact | Source |
//! |---|---|
//! | net PnL, win rate, expectancy R | `stats::compute` (closed trades whose exit is in the week) |
//! | discipline score | `behavior::discipline` (`None` below 5 trades) |
//! | behaviour goals | `process_goals::progress` (statuses as they are) |
//! | pauses taken, trades taken during a pause | `pause::report` |
//! | ideas closed / to review | `analysis::ideas` (counts only) |
//! | costliest mistake | `behavior::mistakes`, first of the ranking by cost, only with at least 3 trades |
//! | journal days | `journal::list` |
//!
//! A statement of facts, never advice and never "because": the module neither compares nor concludes.
//! The week is the local ISO week of `process_goals` (key `YYYY-Www`, local bounds, `boundary_offsets`
//! for a daylight-saving change). The review itself is the trader's free text: it lives in two tables
//! (migration v20), is in the backup and encrypted with the lock, and no export, coach tool or MCP tool
//! reads it. See CLAUDE.md, "Bilan hebdomadaire (lot 36)".

use crate::analysis::ideas::{self, IdeaStatus};
use crate::behavior;
use crate::error::{CoreError, Result};
use crate::journal;
use crate::money::Decimal;
use crate::pause;
use crate::process_goals::{self, Period, PeriodInfo, PeriodKind, PeriodState, ProcessGoalProgress, ProgressQuery};
use crate::reminder;
use crate::settings;
use crate::stats::{self, StatsQuery, time};
use crate::util::{ids_condition, text_enum};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// Longest answer, in characters.
pub const MAX_ANSWER_CHARS: usize = 1000;
/// Longest intention, in characters.
pub const MAX_INTENTION_CHARS: usize = 200;
pub const MAX_INTENTIONS: usize = 3;
/// The costliest mistake is quoted only when it happened on at least this many trades.
pub const MIN_MISTAKE_TRADES: usize = 3;
/// A streak never counts more than a year of weeks.
pub const MAX_STREAK: u32 = 52;
/// Most reviews returned by [`list`].
pub const MAX_LIST: u32 = 520;

const KEY_ENABLED: &str = "review.reminder.enabled";
const KEY_TIME: &str = "review.reminder.time";
const KEY_DAY: &str = "review.reminder.day";
const KEY_LAST_SENT: &str = "review.reminder.last_sent_week";
const KEY_DISMISSED: &str = "review.reminder.dismissed_week";
pub const DEFAULT_TIME: &str = "18:00";
/// The reminder day is fixed: Sunday (ISO weekday 7).
pub const REMINDER_DAY: &str = "sunday";
const REMINDER_WEEKDAY: u8 = 7;

text_enum!(
    /// What the trader says about an intention, the week after.
    IntentionOutcome {
        Kept => "kept",
        Partly => "partly",
        NotKept => "notKept",
    }
);

fn invalid(code: &str) -> CoreError {
    CoreError::Invalid(format!("review:{code}"))
}

// --- Facts ----------------------------------------------------------------------------------

/// Why a fact is not available. Translated by the interface.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Reason {
    /// No trade closed in the week.
    NoClosedTrade,
    /// Trades closed, but none with a planned stop: no R.
    NoRTrade,
    /// Below the minimum of trades of the source report (discipline: 5).
    NotEnoughTrades,
    /// No behaviour goal was set for the week.
    NoGoals,
    /// No mistake tag and no broken rule in the week.
    NoMistake,
    /// The costliest mistake happened on fewer than [`MIN_MISTAKE_TRADES`] trades.
    NotEnoughMistakeTrades,
    /// The costliest mistake cost nothing (no losing trade among its trades).
    NoMistakeCost,
    /// Only meaningful for the running week (ideas to review are read at the present instant).
    OnlyCurrentWeek,
}

/// A value, or `None` with the reason.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Fact<T> {
    pub value: Option<T>,
    pub reason: Option<Reason>,
}

impl<T> Fact<T> {
    fn has(value: T) -> Fact<T> {
        Fact { value: Some(value), reason: None }
    }

    fn lacks(reason: Reason) -> Fact<T> {
        Fact { value: None, reason: Some(reason) }
    }

    fn of(value: Option<T>, reason: Reason) -> Fact<T> {
        match value {
            Some(v) => Fact::has(v),
            None => Fact::lacks(reason),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MistakeSource {
    Tag,
    Rule,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CostlyMistake {
    pub source: MistakeSource,
    pub id: i64,
    pub label: String,
    pub trade_count: usize,
    /// Sum of the losses of these trades, as a positive amount.
    pub cost: Decimal,
    pub trade_ids: Vec<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Facts {
    /// Trades closed in the week (0 is a real count).
    pub closed_trade_count: usize,
    pub net_pnl: Fact<Decimal>,
    pub win_rate: Fact<f64>,
    pub expectancy_r: Fact<f64>,
    /// Closed trades that have an R.
    pub r_trade_count: usize,
    pub discipline: Fact<f64>,
    /// Trades the discipline score is based on, and the minimum it needs.
    pub scored_trade_count: usize,
    pub min_scored_trade_count: usize,
    pub goals: Fact<Vec<ProcessGoalProgress>>,
    /// Pauses started in the week.
    pub pause_count: usize,
    /// Closed trades of the week entered during a pause.
    pub trades_during_pause: usize,
    /// Ideas to watch closed in the week.
    pub ideas_closed: usize,
    /// Ideas "to review" (not updated for a while), as of now: the running week only.
    pub ideas_to_review: Fact<usize>,
    pub costly_mistake: Fact<CostlyMistake>,
    /// Local days of the week with a journal entry.
    pub journal_days: usize,
}

// --- The review -----------------------------------------------------------------------------

/// The three short answers. Technical keys: the wording of the questions is the interface's.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Answers {
    #[serde(default)]
    pub went_well: String,
    #[serde(default)]
    pub do_differently: String,
    #[serde(default)]
    pub next_priority: String,
}

impl Answers {
    fn fields(&mut self) -> [&mut String; 3] {
        [&mut self.went_well, &mut self.do_differently, &mut self.next_priority]
    }

    fn is_empty(&self) -> bool {
        [&self.went_well, &self.do_differently, &self.next_priority].iter().all(|a| a.is_empty())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Intention {
    pub id: i64,
    /// 1 to 3.
    pub position: u8,
    pub text: String,
    /// `None` = not evaluated.
    pub outcome: Option<IntentionOutcome>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ReviewState {
    /// No review saved for the week.
    Todo,
    Draft,
    Done,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeeklyReview {
    pub id: i64,
    pub period_key: String,
    /// First and last local days, "YYYY-MM-DD".
    pub first_day: String,
    pub last_day: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub completed_at: Option<i64>,
    pub state: ReviewState,
    pub answers: Answers,
    pub intentions: Vec<Intention>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewInput {
    pub period_key: String,
    #[serde(default)]
    pub answers: Answers,
    /// 0 to 3 intentions, in order (an empty one is dropped).
    #[serde(default)]
    pub intentions: Vec<String>,
}

fn parse_week(key: &str) -> Result<Period> {
    Period::parse(PeriodKind::Week, key)
}

fn review_row(r: &rusqlite::Row) -> rusqlite::Result<(i64, String, i64, i64, Option<i64>, String)> {
    Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?))
}

const REVIEW_COLUMNS: &str = "id, period_key, created_at, updated_at, completed_at, answers";

fn intentions_of(conn: &Connection, review_id: i64) -> Result<Vec<Intention>> {
    let mut stmt = conn.prepare("SELECT id, position, body, outcome FROM weekly_intentions WHERE review_id = ?1 ORDER BY position")?;
    let rows = stmt.query_map([review_id], |r| {
        Ok(Intention { id: r.get(0)?, position: r.get(1)?, text: r.get(2)?, outcome: r.get(3)? })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn build(conn: &Connection, (id, key, created_at, updated_at, completed_at, answers): (i64, String, i64, i64, Option<i64>, String)) -> Result<WeeklyReview> {
    let period = parse_week(&key)?;
    Ok(WeeklyReview {
        id,
        first_day: process_goals::day_string(period.first_day),
        last_day: process_goals::day_string(period.last_day()),
        period_key: key,
        created_at,
        updated_at,
        completed_at,
        state: if completed_at.is_some() { ReviewState::Done } else { ReviewState::Draft },
        answers: serde_json::from_str(&answers).map_err(|e| CoreError::Invalid(format!("unreadable review answers: {e}")))?,
        intentions: intentions_of(conn, id)?,
    })
}

/// The review of a week, if one was saved.
pub fn review_of(conn: &Connection, period_key: &str) -> Result<Option<WeeklyReview>> {
    parse_week(period_key)?;
    let row = conn
        .query_row(&format!("SELECT {REVIEW_COLUMNS} FROM weekly_reviews WHERE period_key = ?1"), [period_key], review_row)
        .optional()?;
    row.map(|r| build(conn, r)).transpose()
}

fn clean_answers(mut answers: Answers) -> Result<Answers> {
    for field in answers.fields() {
        let cleaned = field.replace('\r', "");
        let cleaned = cleaned.trim();
        if cleaned.chars().count() > MAX_ANSWER_CHARS {
            return Err(invalid("answerTooLong"));
        }
        *field = cleaned.to_string();
    }
    Ok(answers)
}

fn clean_intentions(list: &[String]) -> Result<Vec<String>> {
    let kept: Vec<String> = list.iter().map(|s| s.split_whitespace().collect::<Vec<_>>().join(" ")).filter(|s| !s.is_empty()).collect();
    if kept.len() > MAX_INTENTIONS {
        return Err(invalid("tooManyIntentions"));
    }
    if kept.iter().any(|s| s.chars().count() > MAX_INTENTION_CHARS) {
        return Err(invalid("intentionTooLong"));
    }
    Ok(kept)
}

/// Saves the review of a week as a draft (creates it or replaces its answers and intentions); a review
/// already done stays done. An entirely empty review is refused and leaves nothing (nor changes what was
/// saved: use [`delete`] to remove one). An intention whose text did not change keeps its follow-up; a
/// changed one starts again not evaluated. A week that has not started yet is refused.
pub fn save(conn: &Connection, input: &ReviewInput, now: i64, tz_offset_min: i32) -> Result<WeeklyReview> {
    let period = parse_week(&input.period_key)?;
    let answers = clean_answers(input.answers.clone())?;
    let intentions = clean_intentions(&input.intentions)?;
    if answers.is_empty() && intentions.is_empty() {
        return Err(invalid("empty"));
    }
    if time::local_day_number(now, tz_offset_min) < period.first_day {
        return Err(invalid("future"));
    }
    let json = serde_json::to_string(&answers).map_err(|e| CoreError::Invalid(e.to_string()))?;
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO weekly_reviews (period_key, created_at, updated_at, answers) VALUES (?1, ?2, ?2, ?3)
         ON CONFLICT(period_key) DO UPDATE SET updated_at = ?2, answers = ?3",
        params![input.period_key, now, json],
    )?;
    let id: i64 = tx.query_row("SELECT id FROM weekly_reviews WHERE period_key = ?1", [&input.period_key], |r| r.get(0))?;
    let existing = intentions_of(&tx, id)?;
    for (i, text) in intentions.iter().enumerate() {
        let position = i as i64 + 1;
        match existing.iter().find(|e| i64::from(e.position) == position) {
            Some(e) if &e.text == text => {}
            Some(e) => {
                tx.execute("UPDATE weekly_intentions SET body = ?1, outcome = NULL, outcome_at = NULL WHERE id = ?2", params![text, e.id])?;
            }
            None => {
                tx.execute("INSERT INTO weekly_intentions (review_id, position, body) VALUES (?1, ?2, ?3)", params![id, position, text])?;
            }
        }
    }
    tx.execute("DELETE FROM weekly_intentions WHERE review_id = ?1 AND position > ?2", params![id, intentions.len() as i64])?;
    tx.commit()?;
    review_of(conn, &input.period_key)?.ok_or_else(|| CoreError::NotFound(format!("weekly review {}", input.period_key)))
}

/// Marks the saved review of a week as done. Completing twice keeps the first instant.
pub fn complete(conn: &Connection, period_key: &str, now: i64) -> Result<WeeklyReview> {
    parse_week(period_key)?;
    let changed = conn.execute(
        "UPDATE weekly_reviews SET completed_at = COALESCE(completed_at, ?2), updated_at = CASE WHEN completed_at IS NULL THEN ?2 ELSE updated_at END WHERE period_key = ?1",
        params![period_key, now],
    )?;
    if changed == 0 {
        return Err(CoreError::NotFound(format!("weekly review {period_key}")));
    }
    review_of(conn, period_key)?.ok_or_else(|| CoreError::NotFound(format!("weekly review {period_key}")))
}

/// Deletes the review of a week and its intentions. `false` when there was none.
pub fn delete(conn: &Connection, period_key: &str) -> Result<bool> {
    parse_week(period_key)?;
    Ok(conn.execute("DELETE FROM weekly_reviews WHERE period_key = ?1", [period_key])? > 0)
}

/// The saved reviews, most recent week first.
pub fn list(conn: &Connection, limit: u32) -> Result<Vec<WeeklyReview>> {
    let mut stmt = conn.prepare(&format!("SELECT {REVIEW_COLUMNS} FROM weekly_reviews ORDER BY period_key DESC LIMIT ?1"))?;
    let rows = stmt.query_map([limit.min(MAX_LIST)], review_row)?.collect::<rusqlite::Result<Vec<_>>>()?;
    rows.into_iter().map(|r| build(conn, r)).collect()
}

/// Says whether an intention was kept (`None` puts it back to "not evaluated").
pub fn set_intention_outcome(conn: &Connection, intention_id: i64, outcome: Option<IntentionOutcome>, now: i64) -> Result<Intention> {
    let changed = conn.execute(
        "UPDATE weekly_intentions SET outcome = ?2, outcome_at = ?3 WHERE id = ?1",
        params![intention_id, outcome, outcome.map(|_| now)],
    )?;
    if changed == 0 {
        return Err(CoreError::NotFound(format!("intention {intention_id}")));
    }
    Ok(conn.query_row("SELECT id, position, body, outcome FROM weekly_intentions WHERE id = ?1", [intention_id], |r| {
        Ok(Intention { id: r.get(0)?, position: r.get(1)?, text: r.get(2)?, outcome: r.get(3)? })
    })?)
}

/// Consecutive weeks before `period` where at least one intention was **kept**. A week without a review,
/// without intention, not evaluated, or where nothing was kept breaks the streak. Capped at 52.
fn streak(conn: &Connection, period: &Period) -> Result<u32> {
    let mut count = 0;
    let mut p = period.previous();
    while count < MAX_STREAK {
        let kept: i64 = conn.query_row(
            "SELECT COUNT(*) FROM weekly_intentions i JOIN weekly_reviews r ON r.id = i.review_id WHERE r.period_key = ?1 AND i.outcome = 'kept'",
            [&p.key],
            |r| r.get(0),
        )?;
        if kept == 0 {
            break;
        }
        count += 1;
        p = p.previous();
    }
    Ok(count)
}

// --- The view of a week ---------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewQuery {
    /// Accounts to read (all active ones when empty); they must share one currency.
    #[serde(default)]
    pub account_ids: Vec<i64>,
    pub period_key: String,
    /// Unix ms, UTC: tells whether the week is over, running or ahead.
    pub now_ms: i64,
    /// The trader's UTC offset now, in minutes.
    #[serde(default)]
    pub tz_offset_min: i32,
    /// Offset in effect at local midnight of some days ("YYYY-MM-DD" → minutes), for a week whose
    /// bounds are on the other side of a daylight-saving change (as for the behaviour goals).
    #[serde(default)]
    pub boundary_offsets: BTreeMap<String, i32>,
}

/// Intentions set in the review of the week before, to follow up.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LastWeekIntentions {
    pub period_key: String,
    pub first_day: String,
    pub last_day: String,
    pub intentions: Vec<Intention>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeeklyReviewView {
    pub period: PeriodInfo,
    pub currency: Option<String>,
    pub facts: Facts,
    pub review: Option<WeeklyReview>,
    /// `None` when the week before has no review, or no intention.
    pub last_week: Option<LastWeekIntentions>,
    /// Weeks in a row before this one where at least one intention was kept.
    pub streak: u32,
}

fn period_info(q: &ReviewQuery, period: &Period) -> PeriodInfo {
    let (from, to) = process_goals::window_of(period, q.tz_offset_min, &q.boundary_offsets);
    let today = time::local_day_number(q.now_ms, q.tz_offset_min);
    let state = if today > period.last_day() {
        PeriodState::Past
    } else if today < period.first_day {
        PeriodState::Future
    } else {
        PeriodState::Current
    };
    PeriodInfo {
        kind: period.kind,
        key: period.key.clone(),
        first_day: process_goals::day_string(period.first_day),
        last_day: process_goals::day_string(period.last_day()),
        from,
        to,
        state,
        previous_key: period.previous().key,
        next_key: period.next().key,
    }
}

fn mistake_fact(report: &behavior::MistakeReport) -> Fact<CostlyMistake> {
    let Some(top) = report.by_cost.first() else { return Fact::lacks(Reason::NoMistake) };
    if top.cost.is_zero() {
        return Fact::lacks(Reason::NoMistakeCost);
    }
    if top.trade_count < MIN_MISTAKE_TRADES {
        return Fact::lacks(Reason::NotEnoughMistakeTrades);
    }
    Fact::has(CostlyMistake {
        source: match top.source {
            behavior::MistakeSource::Tag => MistakeSource::Tag,
            behavior::MistakeSource::Rule => MistakeSource::Rule,
        },
        id: top.id,
        label: top.label.clone(),
        trade_count: top.trade_count,
        cost: top.cost,
        trade_ids: top.trade_ids.clone(),
    })
}

/// The facts of a week (nothing is stored: everything is recomputed from the source data).
pub fn facts(conn: &Connection, q: &ReviewQuery) -> Result<(Facts, Option<String>)> {
    let period = parse_week(&q.period_key)?;
    process_goals::check_offsets(q.tz_offset_min, &q.boundary_offsets)?;
    let info = period_info(q, &period);
    let query = StatsQuery { account_ids: q.account_ids.clone(), from: Some(info.from), to: Some(info.to), ..Default::default() };

    let ledger = stats::load(conn, &q.account_ids)?;
    let report = stats::compute(&ledger, &query)?;
    let behavior_settings = settings::behavior(conn)?;
    let discipline = behavior::discipline(&ledger, &query, &behavior_settings)?;
    let mistakes = behavior::mistakes(&ledger, &query)?;
    let pauses = pause::report(conn, &query)?;
    let goals = process_goals::progress(
        conn,
        &ProgressQuery {
            account_ids: q.account_ids.clone(),
            period_kind: PeriodKind::Week,
            period_key: q.period_key.clone(),
            now_ms: q.now_ms,
            tz_offset_min: q.tz_offset_min,
            boundary_offsets: q.boundary_offsets.clone(),
        },
    )?
    .goals;

    let s = &report.summary;
    let none_closed = s.trade_count == 0;
    let ideas_closed = ideas::list(conn, IdeaStatus::Closed, None)?
        .iter()
        .filter(|i| i.closed_at.is_some_and(|t| t >= info.from && t < info.to))
        .count();
    let ideas_to_review = if info.state == PeriodState::Current {
        Fact::has(ideas::list_views(conn, IdeaStatus::Active, None, q.now_ms, q.tz_offset_min)?.iter().filter(|v| v.stale).count())
    } else {
        Fact::lacks(Reason::OnlyCurrentWeek)
    };
    let journal_days = journal::list(conn, Some(&info.first_day), Some(&info.last_day))?.iter().filter(|e| !e.is_blank()).count();

    let facts = Facts {
        closed_trade_count: s.trade_count,
        net_pnl: if none_closed { Fact::lacks(Reason::NoClosedTrade) } else { Fact::has(s.net_pnl) },
        win_rate: Fact::of(s.win_rate, Reason::NoClosedTrade),
        expectancy_r: Fact::of(s.expectancy_r, if none_closed { Reason::NoClosedTrade } else { Reason::NoRTrade }),
        r_trade_count: s.r_trade_count,
        discipline: Fact::of(discipline.score, if none_closed { Reason::NoClosedTrade } else { Reason::NotEnoughTrades }),
        scored_trade_count: discipline.scored_trade_count,
        min_scored_trade_count: discipline.min_trade_count,
        goals: if goals.is_empty() { Fact::lacks(Reason::NoGoals) } else { Fact::has(goals) },
        pause_count: pauses.pause_count,
        trades_during_pause: pauses.during.summary.trade_count,
        ideas_closed,
        ideas_to_review,
        costly_mistake: mistake_fact(&mistakes),
        journal_days,
    };
    Ok((facts, report.currency))
}

/// The page of a week: facts, the saved review, the intentions of the week before and the streak.
pub fn get(conn: &Connection, q: &ReviewQuery) -> Result<WeeklyReviewView> {
    let period = parse_week(&q.period_key)?;
    let (facts, currency) = facts(conn, q)?;
    let previous = period.previous();
    let last_week = review_of(conn, &previous.key)?.filter(|r| !r.intentions.is_empty()).map(|r| LastWeekIntentions {
        period_key: r.period_key,
        first_day: r.first_day,
        last_day: r.last_day,
        intentions: r.intentions,
    });
    Ok(WeeklyReviewView {
        period: period_info(q, &period),
        currency,
        facts,
        review: review_of(conn, &q.period_key)?,
        last_week,
        streak: streak(conn, &period)?,
    })
}

// --- Status of the running week (widget) ----------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WeekStatus {
    pub period_key: String,
    pub first_day: String,
    pub last_day: String,
    pub state: ReviewState,
    /// The intentions in force: those of this week's review when it has some (set for the week to come),
    /// otherwise those of the week before's review (set for this week).
    pub intentions: Vec<Intention>,
    pub intentions_from: Option<String>,
}

/// Where the running week stands, without computing any fact.
pub fn status(conn: &Connection, now: i64, tz_offset_min: i32) -> Result<WeekStatus> {
    let period = Period::containing(PeriodKind::Week, time::local_day_number(now, tz_offset_min));
    let current = review_of(conn, &period.key)?;
    let state = current.as_ref().map_or(ReviewState::Todo, |r| r.state);
    let (intentions_from, intentions) = match current.filter(|r| !r.intentions.is_empty()) {
        Some(r) => (Some(r.period_key), r.intentions),
        None => match review_of(conn, &period.previous().key)?.filter(|r| !r.intentions.is_empty()) {
            Some(r) => (Some(r.period_key), r.intentions),
            None => (None, Vec::new()),
        },
    };
    Ok(WeekStatus {
        first_day: process_goals::day_string(period.first_day),
        last_day: process_goals::day_string(period.last_day()),
        period_key: period.key,
        state,
        intentions,
        intentions_from,
    })
}

// --- Sunday reminder ------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReminderSettings {
    pub enabled: bool,
    /// Local time of the reminder, "HH:MM".
    pub time: String,
    /// Always "sunday": the day is not a setting.
    pub day: String,
}

impl Default for ReminderSettings {
    fn default() -> Self {
        ReminderSettings { enabled: true, time: DEFAULT_TIME.into(), day: REMINDER_DAY.into() }
    }
}

fn setting(conn: &Connection, key: &str) -> Result<Option<String>> {
    Ok(conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0)).optional()?)
}

fn put(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute("INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = ?2", params![key, value])?;
    Ok(())
}

pub fn reminder_settings(conn: &Connection) -> Result<ReminderSettings> {
    let defaults = ReminderSettings::default();
    Ok(ReminderSettings {
        enabled: setting(conn, KEY_ENABLED)?.map_or(defaults.enabled, |v| v == "1"),
        time: setting(conn, KEY_TIME)?.filter(|t| reminder::parse_time(t).is_some()).unwrap_or(defaults.time),
        day: REMINDER_DAY.into(),
    })
}

pub fn set_reminder_settings(conn: &Connection, s: &ReminderSettings) -> Result<ReminderSettings> {
    if reminder::parse_time(&s.time).is_none() {
        return Err(invalid("badTime"));
    }
    if s.day != REMINDER_DAY {
        return Err(invalid("badDay"));
    }
    put(conn, KEY_ENABLED, if s.enabled { "1" } else { "0" })?;
    put(conn, KEY_TIME, &s.time)?;
    put(conn, KEY_DAY, REMINDER_DAY)?;
    reminder_settings(conn)
}

/// What the Sunday reminder is about.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Due {
    pub period_key: String,
    pub closed_trade_count: usize,
    pub journal_days: usize,
}

/// First local day of the week and first local day after it, "YYYY-MM-DD": the days whose midnight
/// offset the caller may need to give in `boundary_offsets` (the shell reads them from the system).
pub fn bound_days(period_key: &str) -> Result<(String, String)> {
    let p = parse_week(period_key)?;
    Ok((process_goals::day_string(p.first_day), process_goals::day_string(p.first_day + p.days)))
}

/// The week holding the local day of `now`.
pub fn current_week_key(now: i64, tz_offset_min: i32) -> String {
    Period::containing(PeriodKind::Week, time::local_day_number(now, tz_offset_min)).key
}

fn minutes_of_day(now: i64, tz_offset_min: i32) -> u32 {
    ((now + i64::from(tz_offset_min) * 60_000).rem_euclid(86_400_000) / 60_000) as u32
}

/// Closed trades (active accounts, whatever their currency: nothing is added up) and journal days of the
/// week: when both are 0 there is nothing to look back on and no banner.
fn week_activity(conn: &Connection, now: i64, tz_offset_min: i32, boundary_offsets: &BTreeMap<String, i32>) -> Result<Option<Due>> {
    process_goals::check_offsets(tz_offset_min, boundary_offsets)?;
    let period = Period::containing(PeriodKind::Week, time::local_day_number(now, tz_offset_min));
    let (from, to) = process_goals::window_of(&period, tz_offset_min, boundary_offsets);
    let closed: i64 = conn.query_row(
        &format!(
            "SELECT COUNT(*) FROM trades t WHERE {} AND t.exit_time IS NOT NULL AND t.exit_time >= ?1 AND t.exit_time < ?2",
            ids_condition("t.account_id", &[])
        ),
        [from, to],
        |r| r.get(0),
    )?;
    let days = journal::list(conn, Some(&process_goals::day_string(period.first_day)), Some(&process_goals::day_string(period.last_day())))?
        .iter()
        .filter(|e| !e.is_blank())
        .count();
    Ok((closed > 0 || days > 0).then_some(Due { period_key: period.key, closed_trade_count: closed as usize, journal_days: days }))
}

fn done(conn: &Connection, key: &str) -> Result<bool> {
    Ok(review_of(conn, key)?.is_some_and(|r| r.state == ReviewState::Done))
}

/// `Some` when the reminder must arm the banner now: enabled, Sunday, the local time has reached the
/// configured time (to the minute: 18:00 yes, 17:59 no), not yet sent for this week, the review of the
/// week not done, and something happened in the week. Remembers nothing: call [`mark_sent`] after.
pub fn reminder_check(conn: &Connection, now: i64, tz_offset_min: i32, boundary_offsets: &BTreeMap<String, i32>) -> Result<Option<Due>> {
    let s = reminder_settings(conn)?;
    if !s.enabled
        || time::weekday(now, tz_offset_min) != REMINDER_WEEKDAY
        || minutes_of_day(now, tz_offset_min) < reminder::parse_time(&s.time).unwrap_or(0)
    {
        return Ok(None);
    }
    let key = current_week_key(now, tz_offset_min);
    if setting(conn, KEY_LAST_SENT)?.as_deref() == Some(key.as_str()) || done(conn, &key)? {
        return Ok(None);
    }
    week_activity(conn, now, tz_offset_min, boundary_offsets)
}

pub fn reminder_mark_sent(conn: &Connection, period_key: &str) -> Result<()> {
    parse_week(period_key)?;
    put(conn, KEY_LAST_SENT, period_key)
}

/// For the in-app banner: the reminder was armed this week, was not put off, the review is not done and
/// the week had some activity. Read-only.
pub fn reminder_pending(conn: &Connection, now: i64, tz_offset_min: i32, boundary_offsets: &BTreeMap<String, i32>) -> Result<Option<Due>> {
    let key = current_week_key(now, tz_offset_min);
    if !reminder_settings(conn)?.enabled
        || setting(conn, KEY_LAST_SENT)?.as_deref() != Some(key.as_str())
        || setting(conn, KEY_DISMISSED)?.as_deref() == Some(key.as_str())
        || done(conn, &key)?
    {
        return Ok(None);
    }
    week_activity(conn, now, tz_offset_min, boundary_offsets)
}

/// « Plus tard » : the banner is silent for the rest of the week (the review stays open from the page).
pub fn reminder_dismiss(conn: &Connection, now: i64, tz_offset_min: i32) -> Result<()> {
    put(conn, KEY_DISMISSED, &current_week_key(now, tz_offset_min))
}

#[cfg(test)]
mod tests;
