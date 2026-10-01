//! The rules of a prop firm account (lot 33), one row of `prop_rules` (migration v16) per `prop`
//! account. Everything is set by the trader: firms differ, nothing is guessed (see CLAUDE.md,
//! "Suivi prop firm (lot 33)").
//!
//! Refusals are translatable codes carried by [`CoreError::Invalid`]: `prop:<code>[:<field>]`.

use crate::accounts;
use crate::error::{CoreError, Result};
use crate::money::{self, Decimal};
use crate::reminder::parse_time;
use crate::stats::time::parse_day;
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};

/// Longest phase label, in characters.
pub const MAX_PHASE_LABEL_CHARS: usize = 60;
/// Largest minimum number of trading days accepted.
pub const MAX_MIN_TRADING_DAYS: u32 = 1000;

/// A limit or a target, in percent of a reference balance or in money.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LimitMode {
    Percent,
    Amount,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Limit {
    pub mode: LimitMode,
    /// Percent (5 = 5 %) or money in the account currency.
    pub value: Decimal,
}

/// Base of a daily loss limit in percent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DailyReference {
    /// The account's initial capital (the same limit every day).
    InitialBalance,
    /// The balance when the trading day started (closed trades only).
    DayStartBalance,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MaxLossKind {
    /// Floor = initial capital − limit.
    Static,
    /// Floor = highest balance reached − limit.
    Trailing,
}

/// Zone of the reset time. Only the two zones Pulse knows the daylight-saving rules of
/// (`news::zones`); any other is refused, never guessed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ResetZone {
    Paris,
    NewYork,
}

impl ResetZone {
    pub fn zone(self) -> crate::news::zones::Zone {
        match self {
            ResetZone::Paris => crate::news::zones::Zone::Paris,
            ResetZone::NewYork => crate::news::zones::Zone::NewYork,
        }
    }
}

/// Validated rules of one account.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PropRules {
    pub account_id: i64,
    /// Free text ("Évaluation 1", "Financé"…), no effect on any figure.
    pub phase_label: Option<String>,
    /// "YYYY-MM-DD": trades closed before 00:00 of that day in `reset_zone` do not count.
    pub started_on: String,
    pub daily_loss: Option<Limit>,
    pub daily_reference: DailyReference,
    pub max_loss: Option<Limit>,
    pub max_loss_kind: MaxLossKind,
    /// Trailing only: the floor stops at the initial capital once it gets there.
    pub trailing_locks_at_initial: bool,
    /// "HH:MM": the trading day changes at this time in `reset_zone`.
    pub reset_time: String,
    pub reset_zone: ResetZone,
    pub profit_target: Option<Limit>,
    pub min_trading_days: Option<u32>,
    /// E.g. 30: the best trading day must not be more than 30 % of the total profit.
    pub consistency_max_best_day_percent: Option<Decimal>,
}

/// A limit as typed: `mode` and `value` as strings, so a wrong value is a coded refusal
/// rather than a deserialization error.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LimitInput {
    pub mode: String,
    pub value: String,
}

/// What the rule editor sends. Enumerations are strings (`percent` / `amount`,
/// `initialBalance` / `dayStartBalance`, `static` / `trailing`, `paris` / `newYork`).
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PropRulesInput {
    #[serde(default)]
    pub phase_label: Option<String>,
    pub started_on: String,
    #[serde(default)]
    pub daily_loss: Option<LimitInput>,
    pub daily_reference: String,
    #[serde(default)]
    pub max_loss: Option<LimitInput>,
    pub max_loss_kind: String,
    #[serde(default)]
    pub trailing_locks_at_initial: bool,
    pub reset_time: String,
    pub reset_zone: String,
    #[serde(default)]
    pub profit_target: Option<LimitInput>,
    #[serde(default)]
    pub min_trading_days: Option<u32>,
    #[serde(default)]
    pub consistency_max_best_day_percent: Option<String>,
}

fn refuse<T>(code: &str) -> Result<T> {
    Err(CoreError::Invalid(format!("prop:{code}")))
}

/// Reads a limit: percent > 0 and ≤ 100, money > 0.
fn limit(field: &str, input: &LimitInput) -> Result<Limit> {
    let mode = match input.mode.trim() {
        "percent" => LimitMode::Percent,
        "amount" => LimitMode::Amount,
        _ => return refuse(&format!("invalidMode:{field}")),
    };
    let Ok(value) = money::parse(field, &input.value) else { return refuse(&format!("invalidNumber:{field}")) };
    match mode {
        LimitMode::Percent if value <= Decimal::ZERO || value > Decimal::ONE_HUNDRED => refuse(&format!("percentOutOfRange:{field}")),
        LimitMode::Amount if value <= Decimal::ZERO => refuse(&format!("amountNotPositive:{field}")),
        _ => Ok(Limit { mode, value }),
    }
}

/// Validates what the editor sent (the first problem found is refused, nothing is written).
pub fn validate(account_id: i64, input: &PropRulesInput) -> Result<PropRules> {
    let phase_label = input.phase_label.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    if phase_label.as_ref().is_some_and(|s| s.chars().count() > MAX_PHASE_LABEL_CHARS) {
        return refuse("phaseLabelTooLong");
    }
    let started_on = input.started_on.trim();
    if started_on.len() != 10 || parse_day(started_on).is_none() {
        return refuse("invalidStartDay");
    }
    let daily_loss = input.daily_loss.as_ref().map(|l| limit("dailyLoss", l)).transpose()?;
    let daily_reference = match input.daily_reference.trim() {
        "initialBalance" => DailyReference::InitialBalance,
        "dayStartBalance" => DailyReference::DayStartBalance,
        _ => return refuse("invalidDailyReference"),
    };
    let max_loss = input.max_loss.as_ref().map(|l| limit("maxLoss", l)).transpose()?;
    let max_loss_kind = match input.max_loss_kind.trim() {
        "static" => MaxLossKind::Static,
        "trailing" => MaxLossKind::Trailing,
        _ => return refuse("invalidMaxLossKind"),
    };
    let reset_time = input.reset_time.trim();
    if parse_time(reset_time).is_none() {
        return refuse("invalidResetTime");
    }
    let reset_zone = match input.reset_zone.trim() {
        "paris" => ResetZone::Paris,
        "newYork" => ResetZone::NewYork,
        _ => return refuse("unknownZone"),
    };
    let profit_target = input.profit_target.as_ref().map(|l| limit("profitTarget", l)).transpose()?;
    if input.min_trading_days.is_some_and(|n| !(1..=MAX_MIN_TRADING_DAYS).contains(&n)) {
        return refuse("minTradingDaysOutOfRange");
    }
    let consistency = match input.consistency_max_best_day_percent.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        None => None,
        Some(s) => {
            let Ok(v) = money::parse("consistency", s) else { return refuse("invalidNumber:consistency") };
            if v <= Decimal::ZERO || v > Decimal::ONE_HUNDRED {
                return refuse("percentOutOfRange:consistency");
            }
            Some(v)
        }
    };
    Ok(PropRules {
        account_id,
        phase_label,
        started_on: started_on.to_string(),
        daily_loss,
        daily_reference,
        max_loss,
        max_loss_kind,
        trailing_locks_at_initial: input.trailing_locks_at_initial,
        reset_time: reset_time.to_string(),
        reset_zone,
        profit_target,
        min_trading_days: input.min_trading_days,
        consistency_max_best_day_percent: consistency,
    })
}

/// Refuses an unknown account or one that is not a prop firm account.
pub fn require_prop_account(conn: &Connection, account_id: i64) -> Result<accounts::Account> {
    let account = accounts::get(conn, account_id)?;
    if account.kind != "prop" {
        return refuse("notProp");
    }
    Ok(account)
}

fn mode_db(l: &Option<Limit>) -> (Option<&'static str>, Option<String>) {
    match l {
        None => (None, None),
        Some(l) => (Some(if l.mode == LimitMode::Percent { "percent" } else { "amount" }), Some(money::to_db(l.value))),
    }
}

/// Validates and saves the rules of a prop account (replacing any previous ones).
pub fn set(conn: &Connection, account_id: i64, input: &PropRulesInput, now: i64) -> Result<PropRules> {
    require_prop_account(conn, account_id)?;
    let r = validate(account_id, input)?;
    let (dm, dv) = mode_db(&r.daily_loss);
    let (mm, mv) = mode_db(&r.max_loss);
    let (tm, tv) = mode_db(&r.profit_target);
    conn.execute(
        "INSERT INTO prop_rules (account_id, phase_label, started_on, daily_loss_mode, daily_loss_value, daily_reference,
                                 max_loss_mode, max_loss_value, max_loss_kind, trailing_locks_at_initial, reset_time,
                                 reset_zone, profit_target_mode, profit_target_value, min_trading_days,
                                 consistency_max_best_day_percent, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)
         ON CONFLICT(account_id) DO UPDATE SET
            phase_label = excluded.phase_label, started_on = excluded.started_on,
            daily_loss_mode = excluded.daily_loss_mode, daily_loss_value = excluded.daily_loss_value,
            daily_reference = excluded.daily_reference, max_loss_mode = excluded.max_loss_mode,
            max_loss_value = excluded.max_loss_value, max_loss_kind = excluded.max_loss_kind,
            trailing_locks_at_initial = excluded.trailing_locks_at_initial, reset_time = excluded.reset_time,
            reset_zone = excluded.reset_zone, profit_target_mode = excluded.profit_target_mode,
            profit_target_value = excluded.profit_target_value, min_trading_days = excluded.min_trading_days,
            consistency_max_best_day_percent = excluded.consistency_max_best_day_percent, updated_at = excluded.updated_at",
        params![
            account_id,
            r.phase_label,
            r.started_on,
            dm,
            dv,
            if r.daily_reference == DailyReference::InitialBalance { "initial_balance" } else { "day_start_balance" },
            mm,
            mv,
            if r.max_loss_kind == MaxLossKind::Static { "static" } else { "trailing" },
            r.trailing_locks_at_initial,
            r.reset_time,
            if r.reset_zone == ResetZone::Paris { "paris" } else { "new_york" },
            tm,
            tv,
            r.min_trading_days,
            money::opt_to_db(r.consistency_max_best_day_percent),
            now,
        ],
    )?;
    get(conn, account_id)?.ok_or_else(|| CoreError::NotFound(format!("prop rules of account {account_id}")))
}

fn read_limit(r: &Row, mode: usize, value: usize) -> rusqlite::Result<Option<Limit>> {
    let m: Option<String> = r.get(mode)?;
    let Some(m) = m else { return Ok(None) };
    let value = money::col(r, value)?;
    Ok(Some(Limit { mode: if m == "percent" { LimitMode::Percent } else { LimitMode::Amount }, value }))
}

/// The rules of an account, `None` when none are set.
pub fn get(conn: &Connection, account_id: i64) -> Result<Option<PropRules>> {
    Ok(conn
        .query_row(
            "SELECT account_id, phase_label, started_on, daily_loss_mode, daily_loss_value, daily_reference,
                    max_loss_mode, max_loss_value, max_loss_kind, trailing_locks_at_initial, reset_time, reset_zone,
                    profit_target_mode, profit_target_value, min_trading_days, consistency_max_best_day_percent
             FROM prop_rules WHERE account_id = ?1",
            [account_id],
            |r| {
                Ok(PropRules {
                    account_id: r.get(0)?,
                    phase_label: r.get(1)?,
                    started_on: r.get(2)?,
                    daily_loss: read_limit(r, 3, 4)?,
                    daily_reference: if r.get::<_, String>(5)? == "initial_balance" {
                        DailyReference::InitialBalance
                    } else {
                        DailyReference::DayStartBalance
                    },
                    max_loss: read_limit(r, 6, 7)?,
                    max_loss_kind: if r.get::<_, String>(8)? == "static" { MaxLossKind::Static } else { MaxLossKind::Trailing },
                    trailing_locks_at_initial: r.get(9)?,
                    reset_time: r.get(10)?,
                    reset_zone: if r.get::<_, String>(11)? == "paris" { ResetZone::Paris } else { ResetZone::NewYork },
                    profit_target: read_limit(r, 12, 13)?,
                    min_trading_days: r.get(14)?,
                    consistency_max_best_day_percent: money::opt_col(r, 15)?,
                })
            },
        )
        .optional()?)
}

/// Removes the rules of an account (nothing happens when there are none).
pub fn delete(conn: &Connection, account_id: i64) -> Result<()> {
    accounts::get(conn, account_id)?;
    conn.execute("DELETE FROM prop_rules WHERE account_id = ?1", [account_id])?;
    Ok(())
}
