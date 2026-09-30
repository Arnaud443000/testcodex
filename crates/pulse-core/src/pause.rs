//! Voluntary pause (lot 35): "I stop for X minutes" after a loss, so as not to enter a trade on
//! an emotional impulse. It is a **reminder, never a lock**: nothing here refuses, disables or
//! delays a trade. A pause is two instants (UTC ms), so it ends by itself at the planned time
//! and survives a restart: nothing runs in the background, `current` just compares instants.
//! See CLAUDE.md, « Pause volontaire (lot 35) ».
//!
//! - [`start`] / [`end`] / [`current`] / [`list`]: the pauses themselves (table `pauses`, v18).
//! - [`pause_report`]: the trades entered during a pause, compared with the others, with the
//!   project's usual caution (5 trades per group, 10 discipline points, 0.25 R). No new formula:
//!   discipline and statistics come from `behavior` and `stats`.
//! - [`Settings`]: `pause.suggest_after_losses` and `pause.default_minutes` (table `settings`).

use crate::alerts::as_of;
use crate::behavior::{Comparison, Context, DISCIPLINE_GAP, EXPECTANCY_GAP_R, comparable_r, compare, mean_score, of_closed};
use crate::error::{CoreError, Result};
use crate::money::Decimal;
use crate::settings::{self, BehaviorSettings};
use crate::stats::analyses::MIN_SAMPLE;
use crate::stats::pnl::{Outcome, checked};
use crate::stats::summary::{Summary, analyze};
use crate::stats::{Closed, Ledger, StatsQuery, load, time};
use rusqlite::{Connection, OptionalExtension, Row, params, params_from_iter};
use serde::{Deserialize, Serialize};

const MIN_MS: i64 = 60_000;
const DAY_MS: i64 = 86_400_000;

/// Length of a pause given in minutes.
pub const MIN_MINUTES: u32 = 1;
pub const MAX_MINUTES: u32 = 480;
pub const NOTE_MAX_CHARS: usize = 140;
/// Short reasons offered by the interface (translated there); the free text is `note`.
pub const REASONS: [&str; 5] = ["loss", "lossStreak", "fatigue", "emotion", "other"];

const SUGGEST_AFTER_LOSSES: &str = "pause.suggest_after_losses";
const DEFAULT_MINUTES: &str = "pause.default_minutes";
const OFF: &str = "off";
pub const DEFAULT_PAUSE_MINUTES: u32 = 30;

// --- Settings ------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    /// Losses in a row today from which the banner *proposes* a pause (2–10); `None` = never.
    /// It never starts anything by itself.
    pub suggest_after_losses: Option<u32>,
    /// Length preselected in the interface, in minutes (1–480).
    pub default_minutes: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Settings { suggest_after_losses: None, default_minutes: DEFAULT_PAUSE_MINUTES }
    }
}

fn setting_int(key: &str, s: &str) -> Result<u32> {
    s.trim().parse().map_err(|_| CoreError::Invalid(format!("{key} is not a valid whole number: {s:?}")))
}

pub fn settings(conn: &Connection) -> Result<Settings> {
    let suggest = match settings::read(conn, SUGGEST_AFTER_LOSSES)? {
        Some(v) if v.trim() != OFF => Some(setting_int(SUGGEST_AFTER_LOSSES, &v)?),
        _ => None,
    };
    let default_minutes = match settings::read(conn, DEFAULT_MINUTES)? {
        Some(v) => setting_int(DEFAULT_MINUTES, &v)?,
        None => DEFAULT_PAUSE_MINUTES,
    };
    Ok(Settings { suggest_after_losses: suggest, default_minutes })
}

/// Validates and saves both settings at once; returns what is now stored. Nothing is written
/// when a value is out of bounds.
pub fn set_settings(conn: &Connection, s: &Settings) -> Result<Settings> {
    if s.suggest_after_losses.is_some_and(|n| !(2..=10).contains(&n)) {
        return Err(CoreError::Invalid("the number of losses that suggests a pause must be between 2 and 10".into()));
    }
    if !(MIN_MINUTES..=MAX_MINUTES).contains(&s.default_minutes) {
        return Err(CoreError::Invalid(format!("the default pause must last between {MIN_MINUTES} and {MAX_MINUTES} minutes")));
    }
    let tx = conn.unchecked_transaction()?;
    settings::write(&tx, SUGGEST_AFTER_LOSSES, s.suggest_after_losses.map(|n| n.to_string()))?;
    settings::write(&tx, DEFAULT_MINUTES, Some(s.default_minutes.to_string()))?;
    tx.commit()?;
    settings(conn)
}

// --- Pauses --------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pause {
    pub id: i64,
    pub started_at: i64,
    pub planned_end_at: i64,
    /// When the trader ended it early; `None` while it runs or when it ended by itself.
    pub ended_at: Option<i64>,
    pub tz_offset_min: i32,
    pub reason: Option<String>,
    pub note: Option<String>,
}

impl Pause {
    /// Real end: the trader's click if any, else the planned end.
    pub fn effective_end(&self) -> i64 {
        self.ended_at.unwrap_or(self.planned_end_at)
    }

    /// A trade is taken during the pause when its **entry** instant is in `[start ; real end)`:
    /// exactly at the start = during, exactly at the end = outside.
    pub fn contains(&self, instant: i64) -> bool {
        (self.started_at..self.effective_end()).contains(&instant)
    }

    fn from_row(r: &Row) -> rusqlite::Result<Pause> {
        Ok(Pause {
            id: r.get(0)?,
            started_at: r.get(1)?,
            planned_end_at: r.get(2)?,
            ended_at: r.get(3)?,
            tz_offset_min: r.get(4)?,
            reason: r.get(5)?,
            note: r.get(6)?,
        })
    }
}

const COLUMNS: &str = "id, started_at, planned_end_at, ended_at, tz_offset_min, reason, note";

/// How long a pause lasts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PauseLength {
    /// 1 to 480 minutes.
    Minutes { minutes: u32 },
    /// Until 00:00 local time of the next day (for the caller's offset).
    UntilTomorrow,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewPause {
    pub length: PauseLength,
    /// One of [`REASONS`].
    #[serde(default)]
    pub reason: Option<String>,
    /// Free text, at most 140 characters.
    #[serde(default)]
    pub note: Option<String>,
    /// The trader's local offset now, in minutes: it fixes what "tomorrow morning" is.
    pub tz_offset_min: i32,
}

/// First instant of the local day after `now`'s.
fn next_local_midnight(now: i64, tz_offset_min: i32) -> i64 {
    let offset = i64::from(tz_offset_min) * MIN_MS;
    ((now + offset).div_euclid(DAY_MS) + 1) * DAY_MS - offset
}

fn planned_end(now: i64, n: &NewPause) -> Result<i64> {
    match n.length {
        PauseLength::Minutes { minutes } if (MIN_MINUTES..=MAX_MINUTES).contains(&minutes) => Ok(now + i64::from(minutes) * MIN_MS),
        PauseLength::Minutes { .. } => Err(CoreError::Invalid(format!("a pause lasts between {MIN_MINUTES} and {MAX_MINUTES} minutes"))),
        PauseLength::UntilTomorrow => Ok(next_local_midnight(now, n.tz_offset_min)),
    }
}

fn clean(n: &NewPause) -> Result<(Option<String>, Option<String>)> {
    let reason = n.reason.as_deref().map(str::trim).filter(|r| !r.is_empty());
    if reason.is_some_and(|r| !REASONS.contains(&r)) {
        return Err(CoreError::Invalid(format!("unknown pause reason: {:?}", n.reason)));
    }
    let note = n.note.as_deref().map(str::trim).filter(|t| !t.is_empty());
    if note.is_some_and(|t| t.chars().count() > NOTE_MAX_CHARS || t.chars().any(char::is_control)) {
        return Err(CoreError::Invalid(format!("the note of a pause is at most {NOTE_MAX_CHARS} characters, on one line")));
    }
    if !(-840..=840).contains(&n.tz_offset_min) {
        return Err(CoreError::Invalid("the time zone offset is out of range".into()));
    }
    Ok((reason.map(str::to_string), note.map(str::to_string)))
}

fn running(conn: &Connection, now: i64) -> Result<Option<Pause>> {
    Ok(conn
        .query_row(
            &format!("SELECT {COLUMNS} FROM pauses WHERE ended_at IS NULL AND started_at <= ?1 AND planned_end_at > ?1 ORDER BY started_at DESC, id DESC LIMIT 1"),
            [now],
            Pause::from_row,
        )
        .optional()?)
}

/// Starts a pause now. Only one runs at a time: the previous one, if still running, is closed at
/// this very instant (its real end), then the new one is written, all or nothing.
pub fn start(conn: &Connection, new: &NewPause, now: i64) -> Result<Pause> {
    let (reason, note) = clean(new)?;
    let end = planned_end(now, new)?;
    let tx = conn.unchecked_transaction()?;
    // A pause that starts after `now` means the clock went back: refuse rather than guess.
    let later: i64 = tx.query_row("SELECT COUNT(*) FROM pauses WHERE started_at > ?1 AND ended_at IS NULL AND planned_end_at > ?1", [now], |r| r.get(0))?;
    if later > 0 {
        return Err(CoreError::Invalid("a pause starts after the current instant (the clock went back?)".into()));
    }
    tx.execute("UPDATE pauses SET ended_at = ?1 WHERE ended_at IS NULL AND started_at <= ?1 AND planned_end_at > ?1", [now])?;
    tx.execute(
        "INSERT INTO pauses (started_at, planned_end_at, tz_offset_min, reason, note) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![now, end, new.tz_offset_min, reason, note],
    )?;
    let id = tx.last_insert_rowid();
    let pause = tx.query_row(&format!("SELECT {COLUMNS} FROM pauses WHERE id = ?1"), [id], Pause::from_row)?;
    tx.commit()?;
    Ok(pause)
}

/// Ends the running pause now (the real end is written, without judgement). `None` when none
/// runs (it may just have ended by itself): not an error.
pub fn end(conn: &Connection, now: i64) -> Result<Option<Pause>> {
    let later: i64 = conn.query_row("SELECT COUNT(*) FROM pauses WHERE started_at > ?1 AND ended_at IS NULL AND planned_end_at > ?1", [now], |r| r.get(0))?;
    if later > 0 {
        return Err(CoreError::Invalid("a pause starts after the current instant (the clock went back?)".into()));
    }
    let Some(p) = running(conn, now)? else { return Ok(None) };
    conn.execute("UPDATE pauses SET ended_at = ?1 WHERE id = ?2", params![now, p.id])?;
    Ok(Some(Pause { ended_at: Some(now), ..p }))
}

/// The running pause and what is left of it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentPause {
    pub pause: Pause,
    pub remaining_ms: i64,
    /// Minutes left, rounded up (1 until the very last millisecond).
    pub remaining_min: i64,
}

/// The pause running at `now`: started, not ended early, planned end not reached. Read only.
pub fn current(conn: &Connection, now: i64) -> Result<Option<CurrentPause>> {
    Ok(running(conn, now)?.map(|pause| {
        let remaining_ms = pause.planned_end_at - now;
        CurrentPause { remaining_min: (remaining_ms + MIN_MS - 1) / MIN_MS, remaining_ms, pause }
    }))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PauseStatus {
    Running,
    /// Reached its planned end by itself.
    Completed,
    /// The trader ended it before the planned end.
    EndedEarly,
}

/// One line of the list of pauses.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PauseRow {
    pub pause: Pause,
    pub status: PauseStatus,
    pub planned_ms: i64,
    /// Real length: until its real end, or elapsed so far when it runs.
    pub actual_ms: i64,
    /// Trades **entered** during the pause (all accounts asked, open trades included, whatever
    /// the period): the entry instant is in `[start ; real end)`.
    pub trade_count: usize,
}

fn describe(p: Pause, now: i64, entries: &[i64]) -> PauseRow {
    let status = match p.ended_at {
        Some(e) if e < p.planned_end_at => PauseStatus::EndedEarly,
        _ if now < p.planned_end_at => PauseStatus::Running,
        _ => PauseStatus::Completed,
    };
    let actual_end = if status == PauseStatus::Running { now.max(p.started_at) } else { p.effective_end() };
    PauseRow {
        status,
        planned_ms: p.planned_end_at - p.started_at,
        actual_ms: actual_end - p.started_at,
        trade_count: entries.iter().filter(|&&t| p.contains(t)).count(),
        pause: p,
    }
}

/// Entry instants of the trades of the given accounts (all active accounts when empty). Plain
/// SQL, not the statistics loader: a list of pauses must not fail because accounts mix currencies.
fn entry_times(conn: &Connection, account_ids: &[i64]) -> Result<Vec<i64>> {
    let (sql, ids): (String, Vec<i64>) = if account_ids.is_empty() {
        ("SELECT t.entry_time FROM trades t JOIN accounts a ON a.id = t.account_id WHERE a.archived = 0".into(), Vec::new())
    } else {
        let marks = vec!["?"; account_ids.len()].join(",");
        (format!("SELECT entry_time FROM trades WHERE account_id IN ({marks})"), account_ids.to_vec())
    };
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params_from_iter(ids), |r| r.get::<_, i64>(0))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// The most recent pauses first (at most `limit`), each with its status and trade count.
pub fn list(conn: &Connection, account_ids: &[i64], limit: u32, now: i64) -> Result<Vec<PauseRow>> {
    let mut stmt = conn.prepare(&format!("SELECT {COLUMNS} FROM pauses ORDER BY started_at DESC, id DESC LIMIT ?1"))?;
    let pauses: Vec<Pause> = stmt.query_map([limit.clamp(1, 500)], Pause::from_row)?.collect::<rusqlite::Result<_>>()?;
    let entries = entry_times(conn, account_ids)?;
    Ok(pauses.into_iter().map(|p| describe(p, now, &entries)).collect())
}

fn all_pauses(conn: &Connection) -> Result<Vec<Pause>> {
    let mut stmt = conn.prepare(&format!("SELECT {COLUMNS} FROM pauses ORDER BY started_at, id"))?;
    Ok(stmt.query_map([], Pause::from_row)?.collect::<rusqlite::Result<_>>()?)
}

// --- Suggestion ----------------------------------------------------------------------

/// Losses in a row today that reached the trader's own threshold. Only a proposal.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    pub account_id: i64,
    pub losses: u32,
    pub threshold: u32,
}

/// Pure: the longest current streak of losses among the trades each account **closed today** (local
/// day of `now`), counted like the alert of 3.6.1: exit order, a gain or a breakeven resets it.
/// Every account on its own. `None` when the threshold is not reached (or off).
pub fn suggestion(ledger: &Ledger, now: i64, tz_offset_min: i32, threshold: Option<u32>) -> Result<Option<Suggestion>> {
    let Some(threshold) = threshold else { return Ok(None) };
    let ledger = as_of(ledger, now);
    let ctx = Context::new(&ledger, BehaviorSettings::default())?;
    let today = time::local_day_number(now, tz_offset_min);
    let mut best: Option<Suggestion> = None;
    for account in &ledger.accounts {
        let losses = ctx
            .replay
            .closed
            .iter()
            .filter(|c| c.facts.account_id == account.id && time::local_day_number(c.exit_time, c.facts.tz_offset_min) == today)
            .rev()
            .take_while(|c| c.figures.outcome == Outcome::Loss)
            .count() as u32;
        if losses >= threshold && best.as_ref().is_none_or(|b| losses > b.losses) {
            best = Some(Suggestion { account_id: account.id, losses, threshold });
        }
    }
    Ok(best)
}

/// A pause is proposed when the setting is on, the threshold is reached and no pause runs.
pub fn suggestion_report(conn: &Connection, account_ids: &[i64], now: i64, tz_offset_min: i32) -> Result<Option<Suggestion>> {
    let threshold = settings(conn)?.suggest_after_losses;
    if threshold.is_none() || running(conn, now)?.is_some() {
        return Ok(None);
    }
    suggestion(&load(conn, account_ids)?, now, tz_offset_min, threshold)
}

// --- Report: trades entered during a pause ---------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PauseGroup {
    pub summary: Summary,
    /// Mean discipline score; `None` below 5 scored trades.
    pub discipline_score: Option<f64>,
    pub scored_trade_count: usize,
    /// In exit order.
    pub trade_ids: Vec<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PauseReport {
    /// Pauses started in the period (all of them when the period is unbounded).
    pub pause_count: usize,
    /// Closed trades of the period passing the filters.
    pub trade_count: usize,
    /// Entered during a pause: entry instant in `[start ; real end)`.
    pub during: PauseGroup,
    pub others: PauseGroup,
    /// Trades during a pause / trades of the period; `None` without any trade.
    pub share_during: Option<f64>,
    pub min_trade_count: usize,
    /// A group has fewer than [`MIN_SAMPLE`] trades: no comparison is quoted.
    pub sample_too_small: bool,
    /// Mean net PnL per trade, during − others (money, no verdict: it depends on size).
    pub avg_net_pnl_difference: Option<Decimal>,
    /// Expectancy in R, compared with at least 5 trades with an R per side.
    pub expectancy_r: Comparison,
    /// Discipline score, in points.
    pub discipline: Comparison,
}

fn group(trades: &[&Closed], scores: &[&crate::behavior::TradeDiscipline], risk_free_daily: f64) -> Result<PauseGroup> {
    let (discipline_score, scored_trade_count) = mean_score(scores.iter().copied());
    Ok(PauseGroup {
        summary: analyze(trades, risk_free_daily)?.summary,
        discipline_score,
        scored_trade_count,
        trade_ids: trades.iter().map(|c| c.facts.id).collect(),
    })
}

/// Pure. Describes what happened **at the same time**, never a cause, and orders nothing.
pub fn pause_report(ledger: &Ledger, query: &StatsQuery, settings: &BehaviorSettings, pauses: &[Pause]) -> Result<PauseReport> {
    let ctx = Context::new(ledger, settings.clone())?;
    let set = ctx.replay.selected(query);
    let scores = of_closed(&ctx, &set)?;
    let (mut during, mut others) = ((Vec::new(), Vec::new()), (Vec::new(), Vec::new()));
    for (c, score) in set.iter().zip(&scores) {
        let taken_during = pauses.iter().any(|p| p.contains(c.facts.entry_time));
        let g = if taken_during { &mut during } else { &mut others };
        g.0.push(*c);
        g.1.push(score);
    }
    let during = group(&during.0, &during.1, query.risk_free_daily)?;
    let others = group(&others.0, &others.1, query.risk_free_daily)?;
    let (d, o) = (&during.summary, &others.summary);
    let enough = d.trade_count >= MIN_SAMPLE && o.trade_count >= MIN_SAMPLE;
    let avg_net_pnl_difference = match (d.avg_net_pnl, o.avg_net_pnl) {
        (Some(x), Some(y)) if enough => Some(checked(x.checked_sub(y))?),
        _ => None,
    };
    Ok(PauseReport {
        pause_count: pauses.iter().filter(|p| query.from.is_none_or(|f| p.started_at >= f) && query.to.is_none_or(|t| p.started_at < t)).count(),
        trade_count: set.len(),
        share_during: (!set.is_empty()).then(|| d.trade_count as f64 / set.len() as f64),
        min_trade_count: MIN_SAMPLE,
        sample_too_small: !enough,
        avg_net_pnl_difference,
        expectancy_r: compare(comparable_r(d), comparable_r(o), enough, EXPECTANCY_GAP_R),
        discipline: compare(during.discipline_score, others.discipline_score, enough, DISCIPLINE_GAP),
        during,
        others,
    })
}

pub fn report(conn: &Connection, query: &StatsQuery) -> Result<PauseReport> {
    pause_report(&load(conn, &query.account_ids)?, query, &settings::behavior(conn)?, &all_pauses(conn)?)
}

#[cfg(test)]
mod tests;
