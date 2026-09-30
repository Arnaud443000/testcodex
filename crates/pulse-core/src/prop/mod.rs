//! Prop firm account tracking (lot 33): how much room is left before each rule of the firm is
//! broken. Definitions: CLAUDE.md, "Suivi prop firm (lot 33)".
//!
//! Golden rule: Pulse does **not** replace the firm's dashboard. Every figure comes from the
//! **closed** trades only (the unrealized loss of open positions, which most firms count, is not
//! known to Pulse); open trades are counted, never guessed. Deposits and withdrawals are ignored
//! (firms have none; the UI says so when there are some).
//!
//! [`compute`] is pure (money in [`Decimal`], `f64` only for unitless ratios); [`status`] reads the
//! database around it.

pub mod rules;

pub use rules::{DailyReference, Limit, LimitMode, MaxLossKind, PropRules, PropRulesInput, ResetZone};

use crate::error::Result;
use crate::money::Decimal;
use crate::news::zones::{self, DAY_MS, Zone, offset_min, paris_day, paris_hhmm, to_utc_first};
use crate::reminder::parse_time;
use crate::stats::pnl::{checked, ratio};
use crate::stats::time::parse_day;
use crate::stats::{self, replay};
use rusqlite::Connection;
use serde::Serialize;

const MIN_MS: i64 = 60_000;

/// A rule is "watch" from this share used (in %), "critical" from [`CRITICAL_PERCENT`], "reached"
/// at 100 % (equality = reached). The UI reads these values from the status, never hard-codes them.
pub const WARNING_PERCENT: u32 = 70;
pub const CRITICAL_PERCENT: u32 = 90;

/// Where a rule stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Level {
    /// Below [`WARNING_PERCENT`] used.
    Ok,
    /// From [`WARNING_PERCENT`].
    Warning,
    /// From [`CRITICAL_PERCENT`].
    Critical,
    /// Limit touched or exceeded (consistency: cap exceeded).
    Reached,
}

/// Level of `consumed` against `limit` (> 0), compared exactly in `Decimal`.
fn level(consumed: Decimal, limit: Decimal) -> Result<Level> {
    if consumed >= limit {
        return Ok(Level::Reached);
    }
    let used = checked(consumed.checked_mul(Decimal::ONE_HUNDRED))?;
    Ok(if used >= checked(limit.checked_mul(Decimal::from(CRITICAL_PERCENT)))? {
        Level::Critical
    } else if used >= checked(limit.checked_mul(Decimal::from(WARNING_PERCENT)))? {
        Level::Warning
    } else {
        Level::Ok
    })
}

// ---------------------------------------------------------------------------------------------
// Trading days

/// First instant at which `zone`'s clock shows `minute` on local `day` (days since 1970-01-01).
/// A time skipped by the spring change resets when the clock jumps (first time shown after it).
pub fn reset_instant(zone: Zone, day: i64, minute: u32) -> i64 {
    (minute..24 * 60)
        .find_map(|m| to_utc_first(zone, day, m))
        // Unreachable for Paris and New York (their gap is one hour at 02:00); a safe fallback.
        .unwrap_or(day * DAY_MS + i64::from(minute) * MIN_MS - i64::from(offset_min(zone, day * DAY_MS)) * MIN_MS)
}

/// The trading day containing `t`: the local `day` whose reset instant is ≤ `t` < the next one's.
/// It is named by the local date (in `zone`) on which it **starts**.
pub fn trading_day(zone: Zone, reset_minute: u32, t: i64) -> i64 {
    let local = (t + i64::from(offset_min(zone, t)) * MIN_MS).div_euclid(DAY_MS);
    if t >= reset_instant(zone, local, reset_minute) { local } else { local - 1 }
}

/// A trading day with its bounds, displayed in Paris time.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TradingDay {
    /// Local date "YYYY-MM-DD" (in the reset zone) on which it starts.
    pub key: String,
    pub starts_at: i64,
    pub ends_at: i64,
    pub starts_paris_day: String,
    pub starts_paris_time: String,
    pub ends_paris_day: String,
    pub ends_paris_time: String,
}

fn describe_day(zone: Zone, reset_minute: u32, day: i64) -> TradingDay {
    let (starts_at, ends_at) = (reset_instant(zone, day, reset_minute), reset_instant(zone, day + 1, reset_minute));
    TradingDay {
        key: zones::day_key_of(day),
        starts_at,
        ends_at,
        starts_paris_day: paris_day(starts_at),
        starts_paris_time: paris_hhmm(starts_at),
        ends_paris_day: paris_day(ends_at),
        ends_paris_time: paris_hhmm(ends_at),
    }
}

// ---------------------------------------------------------------------------------------------
// Input and output

/// A closed trade as the prop rules see it.
#[derive(Debug, Clone, PartialEq)]
pub struct ClosedTrade {
    pub id: i64,
    pub exit_time: i64,
    pub net_pnl: Decimal,
}

/// Everything [`compute`] needs, as it stood at `now`.
#[derive(Debug, Clone, PartialEq)]
pub struct PropInput {
    pub rules: PropRules,
    pub currency: String,
    pub initial_capital: Decimal,
    /// Closed trades of the account (any date, any order).
    pub closed: Vec<ClosedTrade>,
    pub open_trade_count: usize,
    pub cash_flow_count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyLossStatus {
    pub rule: Limit,
    pub reference: DailyReference,
    /// Base of a limit in percent: the initial capital, or the balance when the trading day started.
    pub reference_balance: Decimal,
    /// In money; `None` when a percent of a reference ≤ 0 gives no usable limit.
    pub limit: Option<Decimal>,
    /// Net PnL of the trades closed in the current trading day.
    pub day_net_pnl: Decimal,
    /// max(0, −day net PnL).
    pub loss: Decimal,
    /// limit − loss (negative once exceeded).
    pub remaining: Option<Decimal>,
    /// loss / limit.
    pub used: Option<f64>,
    pub level: Option<Level>,
    pub trade_count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MaxLossStatus {
    pub rule: Limit,
    pub kind: MaxLossKind,
    pub locks_at_initial: bool,
    /// In money (a percent is taken of the initial capital); `None` when it is not > 0.
    pub limit: Option<Decimal>,
    /// Highest balance reached after a closed trade (starts at the initial capital).
    pub peak: Decimal,
    /// The balance must stay above this floor.
    pub floor: Option<Decimal>,
    /// Trailing with the lock: the floor has stopped at the initial capital.
    pub floor_locked: bool,
    /// balance − floor (negative once the floor is broken).
    pub remaining: Option<Decimal>,
    /// 1 − remaining / limit, never below 0.
    pub used: Option<f64>,
    pub level: Option<Level>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfitTargetStatus {
    pub rule: Limit,
    /// In money (a percent is taken of the initial capital); `None` when it is not > 0.
    pub target: Option<Decimal>,
    /// balance − initial capital.
    pub gain: Decimal,
    /// max(0, target − gain).
    pub remaining: Option<Decimal>,
    /// gain / target (may be negative).
    pub progress: Option<f64>,
    pub reached: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TradingDaysStatus {
    /// Distinct trading days with at least one counted closed trade.
    pub count: u32,
    pub minimum: Option<u32>,
    /// max(0, minimum − count).
    pub missing: Option<u32>,
    pub done: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayPnl {
    pub day: TradingDay,
    pub net_pnl: Decimal,
    pub trade_count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsistencyStatus {
    /// The cap, in percent (30 = 30 %).
    pub max_best_day_percent: Decimal,
    /// Net PnL since the start of the challenge.
    pub total_profit: Decimal,
    /// The best trading day (highest net PnL; ties: the earliest).
    pub best_day: Option<DayPnl>,
    /// best day / total profit, only when both are > 0.
    pub share: Option<f64>,
    /// cap × total profit / 100: how much the best day may weigh (total profit > 0 only).
    pub best_day_allowed: Option<Decimal>,
    /// best day × 100 > cap × total (equality = respected).
    pub violated: Option<bool>,
    /// share / cap; `Reached` only when violated (equality = respected, so at most `Critical`).
    pub used: Option<f64>,
    pub level: Option<Level>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NextReset {
    pub at: i64,
    pub in_ms: i64,
    pub paris_day: String,
    pub paris_time: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Thresholds {
    pub warning_percent: u32,
    pub critical_percent: u32,
}

/// Where a prop account stands at `now`, from its closed trades only.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PropStatus {
    pub account_id: i64,
    pub currency: String,
    pub rules: PropRules,
    pub thresholds: Thresholds,
    pub now: i64,
    /// First instant counted: 00:00 of `started_on` in the reset zone.
    pub started_at: i64,
    pub initial_capital: Decimal,
    /// Initial capital + net PnL of the counted closed trades (deposits and withdrawals ignored).
    pub balance: Decimal,
    /// balance − initial capital.
    pub net_pnl: Decimal,
    pub closed_trade_count: usize,
    /// Closed before `started_on`: not counted.
    pub before_start_count: usize,
    /// Open trades: ignored (their unrealized loss is unknown to Pulse).
    pub open_trade_count: usize,
    /// Deposits / withdrawals on the account: ignored by these limits.
    pub cash_flow_count: usize,
    /// Last counted closed trade (exit order): the event behind an alert.
    pub last_trade_id: Option<i64>,
    pub last_exit_at: Option<i64>,
    pub trading_day: TradingDay,
    pub next_reset: NextReset,
    pub daily_loss: Option<DailyLossStatus>,
    pub max_loss: Option<MaxLossStatus>,
    pub profit_target: Option<ProfitTargetStatus>,
    pub trading_days: TradingDaysStatus,
    pub consistency: Option<ConsistencyStatus>,
    /// Setting `alerts.prop` (filled by [`status`]; `true` from [`compute`]).
    pub alerts_enabled: bool,
}

/// percent × base / 100, or the amount; `None` when not > 0.
fn money_of(rule: &Limit, base: Decimal) -> Result<Option<Decimal>> {
    let v = match rule.mode {
        LimitMode::Amount => rule.value,
        LimitMode::Percent => checked(checked(rule.value.checked_mul(base))?.checked_div(Decimal::ONE_HUNDRED))?,
    };
    Ok((v > Decimal::ZERO).then_some(v))
}

fn add(a: Decimal, b: Decimal) -> Result<Decimal> {
    checked(a.checked_add(b))
}

fn sub(a: Decimal, b: Decimal) -> Result<Decimal> {
    checked(a.checked_sub(b))
}

/// The pure computation. `now` decides the current trading day; the trades are taken as given
/// (the caller has already dropped what did not exist yet at `now`).
pub fn compute(input: &PropInput, now: i64) -> Result<PropStatus> {
    let r = &input.rules;
    let zone = r.reset_zone.zone();
    let reset_minute = parse_time(&r.reset_time).unwrap_or(0);
    let start_day = parse_day(&r.started_on).unwrap_or(i64::MIN / DAY_MS);
    let started_at = reset_instant(zone, start_day, 0);
    let day_of = |t: i64| trading_day(zone, reset_minute, t);

    let mut trades: Vec<&ClosedTrade> = input.closed.iter().collect();
    trades.sort_by_key(|t| (t.exit_time, t.id));
    let before_start_count = trades.iter().filter(|t| t.exit_time < started_at).count();
    trades.retain(|t| t.exit_time >= started_at);

    let initial = input.initial_capital;
    let today = day_of(now);
    let today_start = reset_instant(zone, today, reset_minute);
    let (mut balance, mut peak) = (initial, initial);
    let mut day_start_balance = initial;
    let (mut day_net, mut day_count) = (Decimal::ZERO, 0usize);
    // Net PnL per trading day, in day order.
    let mut days: Vec<(i64, Decimal, usize)> = Vec::new();
    for t in &trades {
        if t.exit_time < today_start {
            day_start_balance = add(day_start_balance, t.net_pnl)?;
        }
        balance = add(balance, t.net_pnl)?;
        peak = peak.max(balance);
        let d = day_of(t.exit_time);
        if d == today {
            day_net = add(day_net, t.net_pnl)?;
            day_count += 1;
        }
        match days.last_mut() {
            Some((day, pnl, n)) if *day == d => {
                *pnl = add(*pnl, t.net_pnl)?;
                *n += 1;
            }
            _ => days.push((d, t.net_pnl, 1)),
        }
    }
    let net_pnl = sub(balance, initial)?;

    // Daily loss.
    let daily_loss = match r.daily_loss {
        None => None,
        Some(rule) => {
            let reference_balance = match r.daily_reference {
                DailyReference::InitialBalance => initial,
                DailyReference::DayStartBalance => day_start_balance,
            };
            let limit = money_of(&rule, reference_balance)?;
            let loss = if day_net < Decimal::ZERO { -day_net } else { Decimal::ZERO };
            let (remaining, used, lvl) = match limit {
                Some(l) => (Some(sub(l, loss)?), ratio(loss, l), Some(level(loss, l)?)),
                None => (None, None, None),
            };
            Some(DailyLossStatus {
                rule,
                reference: r.daily_reference,
                reference_balance,
                limit,
                day_net_pnl: day_net,
                loss,
                remaining,
                used,
                level: lvl,
                trade_count: day_count,
            })
        }
    };

    // Maximum loss.
    let max_loss = match r.max_loss {
        None => None,
        Some(rule) => {
            let limit = money_of(&rule, initial)?;
            let (floor, floor_locked) = match limit {
                None => (None, false),
                Some(l) => match r.max_loss_kind {
                    MaxLossKind::Static => (Some(sub(initial, l)?), false),
                    MaxLossKind::Trailing => {
                        let trailing = sub(peak, l)?;
                        if r.trailing_locks_at_initial && trailing >= initial { (Some(initial), true) } else { (Some(trailing), false) }
                    }
                },
            };
            let (remaining, used, lvl) = match (limit, floor) {
                (Some(l), Some(f)) => {
                    let remaining = sub(balance, f)?;
                    let consumed = sub(l, remaining)?;
                    let used = ratio(consumed, l).map(|u| u.max(0.0));
                    (Some(remaining), used, Some(level(consumed, l)?))
                }
                _ => (None, None, None),
            };
            Some(MaxLossStatus { rule, kind: r.max_loss_kind, locks_at_initial: r.trailing_locks_at_initial, limit, peak, floor, floor_locked, remaining, used, level: lvl })
        }
    };

    // Profit target.
    let profit_target = match r.profit_target {
        None => None,
        Some(rule) => {
            let target = money_of(&rule, initial)?;
            let (remaining, progress, reached) = match target {
                Some(t) => {
                    let left = sub(t, net_pnl)?;
                    (Some(left.max(Decimal::ZERO)), ratio(net_pnl, t), Some(net_pnl >= t))
                }
                None => (None, None, None),
            };
            Some(ProfitTargetStatus { rule, target, gain: net_pnl, remaining, progress, reached })
        }
    };

    // Trading days.
    let count = days.len() as u32;
    let trading_days = TradingDaysStatus {
        count,
        minimum: r.min_trading_days,
        missing: r.min_trading_days.map(|m| m.saturating_sub(count)),
        done: r.min_trading_days.map(|m| count >= m),
    };

    // Consistency: the best day (ties: the earliest) against the total profit.
    let consistency = match r.consistency_max_best_day_percent {
        None => None,
        Some(cap) => {
            let best = days.iter().fold(None::<&(i64, Decimal, usize)>, |b, d| match b {
                Some(b) if b.1 >= d.1 => Some(b),
                _ => Some(d),
            });
            let best_day = best.map(|&(d, pnl, n)| DayPnl { day: describe_day(zone, reset_minute, d), net_pnl: pnl, trade_count: n });
            let total = net_pnl;
            let best_day_allowed =
                if total > Decimal::ZERO { Some(checked(checked(cap.checked_mul(total))?.checked_div(Decimal::ONE_HUNDRED))?) } else { None };
            let (share, violated, used, lvl) = match best {
                Some(&(_, b, _)) if total > Decimal::ZERO && b > Decimal::ZERO => {
                    let lhs = checked(b.checked_mul(Decimal::ONE_HUNDRED))?; // best × 100
                    let rhs = checked(cap.checked_mul(total))?; // cap × total
                    let violated = lhs > rhs;
                    let lvl = if violated { Level::Reached } else { level(lhs, rhs)?.min(Level::Critical) };
                    (ratio(b, total), Some(violated), ratio(lhs, rhs), Some(lvl))
                }
                _ => (None, None, None, None),
            };
            Some(ConsistencyStatus { max_best_day_percent: cap, total_profit: total, best_day, share, best_day_allowed, violated, used, level: lvl })
        }
    };

    let next = reset_instant(zone, today + 1, reset_minute);
    Ok(PropStatus {
        account_id: r.account_id,
        currency: input.currency.clone(),
        rules: r.clone(),
        thresholds: Thresholds { warning_percent: WARNING_PERCENT, critical_percent: CRITICAL_PERCENT },
        now,
        started_at,
        initial_capital: initial,
        balance,
        net_pnl,
        closed_trade_count: trades.len(),
        before_start_count,
        open_trade_count: input.open_trade_count,
        cash_flow_count: input.cash_flow_count,
        last_trade_id: trades.last().map(|t| t.id),
        last_exit_at: trades.last().map(|t| t.exit_time),
        trading_day: describe_day(zone, reset_minute, today),
        next_reset: NextReset { at: next, in_ms: next - now, paris_day: paris_day(next), paris_time: paris_hhmm(next) },
        daily_loss,
        max_loss,
        profit_target,
        trading_days,
        consistency,
        alerts_enabled: true,
    })
}

/// Reads the account as it stood at `now` (later trades do not exist yet, a trade closed after
/// `now` is still open) and computes its status; `None` when it has no rules. A non-prop account
/// is refused (`prop:notProp`).
pub fn status(conn: &Connection, account_id: i64, now: i64) -> Result<Option<PropStatus>> {
    let account = rules::require_prop_account(conn, account_id)?;
    let Some(r) = rules::get(conn, account_id)? else { return Ok(None) };
    let ledger = crate::alerts::as_of(&stats::load(conn, &[account_id])?, now);
    let replayed = replay(&ledger)?;
    let closed = replayed.closed.iter().map(|c| ClosedTrade { id: c.facts.id, exit_time: c.exit_time, net_pnl: c.figures.net_pnl }).collect();
    let input = PropInput {
        rules: r,
        currency: account.currency,
        initial_capital: account.initial_capital,
        closed,
        open_trade_count: ledger.trades.iter().filter(|t| t.exit_time.is_none()).count(),
        cash_flow_count: ledger.capital_moves.len(),
    };
    let mut s = compute(&input, now)?;
    s.alerts_enabled = crate::alerts::prop::enabled(conn)?;
    Ok(Some(s))
}

#[cfg(test)]
mod tests;
