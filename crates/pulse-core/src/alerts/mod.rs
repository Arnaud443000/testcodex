//! Guard-rail alerts (spec 3.6.1 – 3.6.7): thresholds and their evaluation.
//! Every definition is documented in CLAUDE.md, "Alertes à seuils (lot 12)".
//!
//! [`evaluate`] is pure: from a [`Ledger`], an instant and the thresholds, it
//! returns the alerts active at that instant, for each account of the ledger on
//! its own. Nothing an account does ever raises an alert on another one.

pub mod log;
// Lot 25: 3.6.8, trade taken during a major economic news.
pub mod news;
// Lot 33: prop firm rules (daily loss, maximum loss, consistency).
pub mod prop;
pub mod settings;

pub use log::{AlertRecord, active_alerts, dismiss, history};
pub use settings::AlertSettings;

use crate::behavior::{Context, ExposureBasis};
use crate::error::Result;
use crate::money::Decimal;
use crate::settings::BehaviorSettings;
use crate::stats::pnl::{Outcome, checked};
use crate::stats::{Closed, Ledger, TradeFacts, risk, time};
use crate::tags::TagKind;
use crate::trade_view::session_for;
use serde::Serialize;

const DAY_MS: i64 = 86_400_000;
const MIN_MS: i64 = 60_000;
/// Trades of history needed before a session can be called unusual.
pub const MIN_SESSION_HISTORY: usize = 20;
/// A session is unusual below this share (in %) of the trades entered before.
pub const UNUSUAL_SESSION_PERCENT: usize = 10;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Severity {
    Critical,
    Warning,
}

/// Where a count stands against a "maximum allowed" limit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LimitLevel {
    /// Exactly the maximum: the last allowed trade has been taken.
    Reached,
    /// Beyond the maximum.
    Exceeded,
}

/// Loss of the day or of the week against its limits (spec 3.6.3).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LossDetail {
    /// First local day of the period, "YYYY-MM-DD" (today, or this week's Monday).
    pub period_start: String,
    pub currency: Option<String>,
    /// Net loss of the trades closed in the period, as a positive amount.
    pub loss: Decimal,
    /// Real balance of the account when the period started (deposits and withdrawals included).
    pub reference_balance: Decimal,
    /// loss / reference balance (0.03 = 3 %); `None` when that balance is not positive.
    pub loss_pct: Option<f64>,
    pub threshold_amount: Option<Decimal>,
    /// In percent (3 = 3 %).
    pub threshold_percent: Option<Decimal>,
    pub amount_reached: bool,
    pub percent_reached: bool,
}

/// What each alert says; `kind` is the discriminant sent to the UI.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum AlertDetail {
    /// 3.6.1: losing trades in a row, closed today.
    ConsecutiveLosses { count: u32, threshold: u32, trade_ids: Vec<i64> },
    /// 3.6.2: trades entered today against `behavior.max_trades_per_day`.
    TradesPerDay { level: LimitLevel, count: u32, threshold: u32, day: String },
    /// 3.6.2: trades entered in the sliding window ending now.
    TradesPerWindow { level: LimitLevel, count: u32, threshold: u32, window_min: u32 },
    /// 3.6.3.
    DailyLoss(LossDetail),
    WeeklyLoss(LossDetail),
    /// 3.6.4: the lot-8 revenge detection, on a trade entered today.
    Revenge { previous_trade_id: i64, gap_ms: i64, basis: ExposureBasis, ratio: Option<f64>, size_factor: Decimal, window_min: u32 },
    /// 3.6.5: entered outside the allowed local hours.
    OutsideHours { local_time: String, trading_hours: String },
    /// 3.6.5: entered in a session the trader rarely trades.
    UnusualSession { session: String, session_count: usize, history_count: usize, share: f64 },
    /// 3.6.6: no valid planned stop loss.
    NoStopLoss { open: bool },
    /// 3.6.8 (lot 25): entered around a major news while the trader's news trades did worse.
    NewsTrade {
        events: Vec<news::NewsEventRef>,
        event_count: usize,
        window_before_min: u32,
        window_after_min: u32,
        comparison: news::NewsComparison,
    },
    /// Lot 33: a prop firm rule nearing or reaching its limit (closed trades only).
    PropDailyLoss(prop::PropAlertDetail),
    PropMaxLoss(prop::PropAlertDetail),
    PropConsistency(prop::PropAlertDetail),
}

impl AlertDetail {
    fn rank(&self) -> u8 {
        match self {
            AlertDetail::ConsecutiveLosses { .. } => 0,
            AlertDetail::TradesPerDay { .. } => 1,
            AlertDetail::TradesPerWindow { .. } => 2,
            AlertDetail::DailyLoss(_) => 3,
            AlertDetail::WeeklyLoss(_) => 4,
            AlertDetail::Revenge { .. } => 5,
            AlertDetail::OutsideHours { .. } => 6,
            AlertDetail::UnusualSession { .. } => 7,
            AlertDetail::NoStopLoss { .. } => 8,
            AlertDetail::NewsTrade { .. } => 9,
            AlertDetail::PropDailyLoss(_) => 10,
            AlertDetail::PropMaxLoss(_) => 11,
            AlertDetail::PropConsistency(_) => 12,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Alert {
    /// Stable identity (`kind:account:scope`): a dismissed alert never comes back under it.
    pub id: String,
    pub account_id: i64,
    pub severity: Severity,
    /// Translation key of the message, e.g. `tradesPerDay.exceeded`; values are in the detail.
    pub message_key: &'static str,
    /// Instant of the triggering event (exit of the last loss, entry of the trade…), Unix ms.
    pub at: i64,
    /// The trade the alert is about, or the last one that triggered it.
    pub trade_id: Option<i64>,
    #[serde(flatten)]
    pub detail: AlertDetail,
}

/// The ledger as it stood at `now`: later trades and flows do not exist yet,
/// and a trade closed after `now` is still open. Also used by the insights (lot 19).
pub(crate) fn as_of(ledger: &Ledger, now: i64) -> Ledger {
    let mut l = ledger.clone();
    l.trades.retain(|t| t.entry_time <= now);
    for t in &mut l.trades {
        if t.exit_time.is_some_and(|e| e > now) {
            t.exit_time = None;
            t.position.exit_price = None;
        }
    }
    l.capital_moves.retain(|m| m.at <= now);
    l
}

fn local_day(ms: i64, tz: i32) -> i64 {
    time::local_day_number(ms, tz)
}

/// First instant of a local day, for the caller's offset.
fn day_start(day: i64, tz_offset_min: i32) -> i64 {
    day * DAY_MS - i64::from(tz_offset_min) * MIN_MS
}

fn hhmm(minutes: u32) -> String {
    format!("{:02}:{:02}", minutes / 60, minutes % 60)
}

/// Name and comparison key of a trade's session: its session tag, else the one deduced from the hour.
fn session_of(t: &TradeFacts) -> (String, String) {
    let name = t.tags.iter().find(|g| g.kind == TagKind::Session).map_or(session_for(t.entry_time), |g| g.name.as_str());
    (name.to_string(), name.trim().to_lowercase())
}

fn level(count: u32, max: u32) -> Option<(LimitLevel, Severity, &'static str, &'static str)> {
    match count.cmp(&max) {
        std::cmp::Ordering::Less => None,
        std::cmp::Ordering::Equal => Some((LimitLevel::Reached, Severity::Warning, "tradesPerDay.reached", "tradesPerWindow.reached")),
        std::cmp::Ordering::Greater => Some((LimitLevel::Exceeded, Severity::Critical, "tradesPerDay.exceeded", "tradesPerWindow.exceeded")),
    }
}

/// Loss of the trades `closed` in a period, against the limits, `balance` being the account's
/// balance when the period started; `None` when no limit is reached.
fn loss(
    currency: &Option<String>,
    closed: &[&Closed],
    balance: Decimal,
    period_start: String,
    amount: Option<Decimal>,
    percent: Option<Decimal>,
) -> Result<Option<LossDetail>> {
    if amount.is_none() && percent.is_none() {
        return Ok(None);
    }
    let mut total = Decimal::ZERO;
    for c in closed {
        total = checked(total.checked_add(c.figures.net_pnl))?;
    }
    if total >= Decimal::ZERO {
        return Ok(None);
    }
    let loss = -total;
    let amount_reached = amount.is_some_and(|a| loss >= a);
    let percent_reached = match percent {
        Some(p) if balance > Decimal::ZERO => checked(loss.checked_mul(Decimal::ONE_HUNDRED))? >= checked(p.checked_mul(balance))?,
        _ => false,
    };
    if !amount_reached && !percent_reached {
        return Ok(None);
    }
    Ok(Some(LossDetail {
        period_start,
        currency: currency.clone(),
        loss,
        reference_balance: balance,
        loss_pct: risk::risk_fraction(Some(loss), balance),
        threshold_amount: amount,
        threshold_percent: percent,
        amount_reached,
        percent_reached,
    }))
}

fn reached_scope(d: &LossDetail) -> &'static str {
    match (d.amount_reached, d.percent_reached) {
        (true, true) => "amount+percent",
        (true, false) => "amount",
        _ => "percent",
    }
}

/// Alerts active at `now` for every account of the ledger, each on its own.
/// `tz_offset_min` is the trader's offset now: it decides what "today" and "this week" are.
pub fn evaluate(ledger: &Ledger, now: i64, tz_offset_min: i32, behavior: &BehaviorSettings, s: &AlertSettings) -> Result<Vec<Alert>> {
    let ledger = as_of(ledger, now);
    let ctx = Context::new(&ledger, behavior.clone())?;
    let today = local_day(now, tz_offset_min);
    let monday = today - (today + 3).rem_euclid(7);
    let hours = s.trading_hours.as_deref().and_then(settings::parse_hours);
    let mut out = Vec::new();

    for account in &ledger.accounts {
        let acc = account.id;
        let mut push = |severity, message_key, at, trade_id: Option<i64>, scope: String, detail: AlertDetail| {
            let kind = message_key_kind(message_key);
            out.push(Alert { id: format!("{kind}:{acc}:{scope}"), account_id: acc, severity, message_key, at, trade_id, detail });
        };
        // Entry order (ties: id), open trades included.
        let mut entered: Vec<&TradeFacts> = ledger.trades.iter().filter(|t| t.account_id == acc).collect();
        entered.sort_by_key(|t| (t.entry_time, t.id));
        let is_today = |t: &TradeFacts| local_day(t.entry_time, t.tz_offset_min) == today;
        let entered_today: Vec<&TradeFacts> = entered.iter().copied().filter(|t| is_today(t)).collect();
        // Exit order (ties: id).
        let closed: Vec<&Closed> = ctx.replay.closed.iter().filter(|c| c.facts.account_id == acc).collect();
        let closed_on = |from: i64| -> Vec<&Closed> {
            closed.iter().copied().filter(|c| (from..=today).contains(&local_day(c.exit_time, c.facts.tz_offset_min))).collect()
        };
        let closed_today = closed_on(today);

        // 3.6.1 — losses in a row today.
        if let Some(threshold) = s.consecutive_losses {
            let streak: Vec<&Closed> = closed_today.iter().rev().take_while(|c| c.figures.outcome == Outcome::Loss).copied().collect();
            if let Some(last) = streak.first().filter(|_| streak.len() as u32 >= threshold) {
                let trade_ids = streak.iter().rev().map(|c| c.facts.id).collect();
                let detail = AlertDetail::ConsecutiveLosses { count: streak.len() as u32, threshold, trade_ids };
                push(Severity::Warning, "consecutiveLosses", last.exit_time, Some(last.facts.id), last.facts.id.to_string(), detail);
            }
        }

        // 3.6.2 — trades per day (lot-8 limit) and in the sliding window.
        if let (Some(max), Some(last)) = (behavior.max_trades_per_day, entered_today.last()) {
            let count = entered_today.len() as u32;
            if let Some((level, severity, key, _)) = level(count, max) {
                let detail = AlertDetail::TradesPerDay { level, count, threshold: max, day: time::day_key(now, tz_offset_min) };
                push(severity, key, last.entry_time, Some(last.id), last.id.to_string(), detail);
            }
        }
        if let Some(max) = s.burst_max_trades {
            let window_start = now - i64::from(s.burst_window_min) * MIN_MS;
            let recent: Vec<&TradeFacts> = entered.iter().copied().filter(|t| t.entry_time > window_start).collect();
            if let (Some(last), Some((level, severity, _, key))) = (recent.last(), level(recent.len() as u32, max)) {
                let detail = AlertDetail::TradesPerWindow { level, count: recent.len() as u32, threshold: max, window_min: s.burst_window_min };
                push(severity, key, last.entry_time, Some(last.id), last.id.to_string(), detail);
            }
        }

        // 3.6.3 — stop for today / for the week.
        let periods = [
            (today, closed_today, s.daily_loss_amount, s.daily_loss_percent, "dailyLoss"),
            (monday, closed_on(monday), s.weekly_loss_amount, s.weekly_loss_percent, "weeklyLoss"),
        ];
        for (first_day, list, amount, percent, key) in periods {
            let start = day_start(first_day, tz_offset_min);
            let start_key = time::day_key(start, tz_offset_min);
            // Every event strictly before the period's first instant.
            let balance = ctx.balances.at(acc, start - 1);
            let found = loss(&ledger.currency, &list, balance, start_key.clone(), amount, percent)?;
            if let (Some(d), Some(last)) = (found, list.last()) {
                let scope = format!("{start_key}:{}", reached_scope(&d));
                let detail = if key == "dailyLoss" { AlertDetail::DailyLoss(d) } else { AlertDetail::WeeklyLoss(d) };
                push(Severity::Critical, key, last.exit_time, Some(last.facts.id), scope, detail);
            }
        }

        // 3.6.4, 3.6.5 — trades entered today.
        for (i, t) in entered.iter().enumerate().filter(|(_, t)| is_today(t)) {
            if s.revenge
                && let Some(r) = ctx.revenge(t)?
            {
                let detail = AlertDetail::Revenge {
                    previous_trade_id: r.previous_trade_id,
                    gap_ms: r.gap_ms,
                    basis: r.basis,
                    ratio: r.ratio,
                    size_factor: behavior.revenge_size_factor,
                    window_min: behavior.revenge_window_min,
                };
                push(Severity::Warning, "revenge", t.entry_time, Some(t.id), t.id.to_string(), detail);
            }
            if let (Some(range), Some(text)) = (hours, s.trading_hours.as_ref()) {
                let minute = ((t.entry_time + i64::from(t.tz_offset_min) * MIN_MS).rem_euclid(DAY_MS) / MIN_MS) as u32;
                if !settings::in_hours(minute, range) {
                    let detail = AlertDetail::OutsideHours { local_time: hhmm(minute), trading_hours: text.trim().to_string() };
                    push(Severity::Warning, "outsideHours", t.entry_time, Some(t.id), t.id.to_string(), detail);
                }
            }
            let history = &entered[..i];
            if s.unusual_session && history.len() >= MIN_SESSION_HISTORY {
                let (name, key) = session_of(t);
                let same = history.iter().filter(|h| session_of(h).1 == key).count();
                if same * 100 < UNUSUAL_SESSION_PERCENT * history.len() {
                    let share = same as f64 / history.len() as f64;
                    let detail = AlertDetail::UnusualSession { session: name, session_count: same, history_count: history.len(), share };
                    push(Severity::Warning, "unusualSession", t.entry_time, Some(t.id), t.id.to_string(), detail);
                }
            }
        }

        // 3.6.6 — no stop loss: open positions (any day) and trades entered today.
        if s.no_stop_loss {
            for t in &entered {
                let open = t.exit_time.is_none();
                if (open || is_today(t)) && risk::initial_risk(t)?.is_none() {
                    let (severity, key) = if open { (Severity::Critical, "noStopLoss.open") } else { (Severity::Warning, "noStopLoss.closed") };
                    push(severity, key, t.entry_time, Some(t.id), t.id.to_string(), AlertDetail::NoStopLoss { open });
                }
            }
        }
    }
    sort(&mut out);
    Ok(out)
}

/// Critical first, then the order of CLAUDE.md's table, then the trade.
pub(crate) fn sort(alerts: &mut [Alert]) {
    alerts.sort_by(|a, b| (a.severity, a.detail.rank(), a.trade_id, &a.id).cmp(&(b.severity, b.detail.rank(), b.trade_id, &b.id)));
}

/// `tradesPerDay.exceeded` → `tradesPerDay`.
pub(crate) fn message_key_kind(key: &str) -> &str {
    key.split('.').next().unwrap_or(key)
}

#[cfg(test)]
mod tests;
