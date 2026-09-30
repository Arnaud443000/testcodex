//! Prop firm alerts (lot 33): the daily loss, the maximum loss and the consistency rule of a prop
//! account nearing or reaching their limit. Pure evaluation of a [`PropStatus`] (closed trades
//! only), called by `alerts::active_alerts` after the other alerts, **without** changing
//! `alerts::evaluate` (same model as `alerts/news.rs`). See CLAUDE.md, "Suivi prop firm (lot 33)".
//!
//! Identity = (account, rule, challenge start, trading day for the daily loss, level): a worse
//! level is a new alert, a better one never is (see [`drop_improvements`]).

use super::{Alert, AlertDetail, Severity};
use crate::error::{CoreError, Result};
use crate::money::Decimal;
use crate::prop::{Level, PropStatus};
use crate::settings::{read, write};
use rusqlite::Connection;
use serde::Serialize;

/// Setting: `on` (default, also when missing) or `off`. No effect on an account without rules.
pub const PROP_ALERTS: &str = "alerts.prop";

pub fn enabled(conn: &Connection) -> Result<bool> {
    match read(conn, PROP_ALERTS)?.as_deref().map(str::trim) {
        None | Some("on") => Ok(true),
        Some("off") => Ok(false),
        Some(other) => Err(CoreError::Invalid(format!("{PROP_ALERTS} must be on or off, got {other:?}"))),
    }
}

pub fn set_enabled(conn: &Connection, on: bool) -> Result<bool> {
    write(conn, PROP_ALERTS, Some(if on { "on" } else { "off" }.into()))?;
    enabled(conn)
}

/// What a prop alert says (same shape for the three rules; unused fields are `None`).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PropAlertDetail {
    pub level: Level,
    pub currency: String,
    pub phase_label: Option<String>,
    /// Share of the limit used (consistency: share of the cap).
    pub used: Option<f64>,
    /// Money left before the limit (negative once exceeded); `None` for the consistency rule.
    pub remaining: Option<Decimal>,
    pub limit: Option<Decimal>,
    /// Daily loss: the trading day ("YYYY-MM-DD", the day it starts) and the next reset, in Paris time.
    pub trading_day: Option<String>,
    pub next_reset_paris_day: Option<String>,
    pub next_reset_paris_time: Option<String>,
    /// Consistency: best day / total profit, and the cap in percent.
    pub share: Option<f64>,
    pub max_best_day_percent: Option<Decimal>,
}

fn level_text(l: Level) -> &'static str {
    match l {
        Level::Ok => "ok",
        Level::Warning => "warning",
        Level::Critical => "critical",
        Level::Reached => "reached",
    }
}

fn level_of(text: &str) -> Option<Level> {
    match text {
        "warning" => Some(Level::Warning),
        "critical" => Some(Level::Critical),
        "reached" => Some(Level::Reached),
        _ => None,
    }
}

fn severity(l: Level) -> Severity {
    if l == Level::Warning { Severity::Warning } else { Severity::Critical }
}

/// The alerts of one prop account's status: one per rule at "watch" level or worse.
pub fn evaluate(s: &PropStatus) -> Vec<Alert> {
    let acc = s.account_id;
    let start = &s.rules.started_on;
    let at = s.last_exit_at.unwrap_or(s.now);
    let base = PropAlertDetail {
        level: Level::Ok,
        currency: s.currency.clone(),
        phase_label: s.rules.phase_label.clone(),
        used: None,
        remaining: None,
        limit: None,
        trading_day: None,
        next_reset_paris_day: None,
        next_reset_paris_time: None,
        share: None,
        max_best_day_percent: None,
    };
    let mut out = Vec::new();
    let mut push = |kind: &'static str, key: [&'static str; 3], scope: String, level: Level, detail: AlertDetail| {
        let message_key = match level {
            Level::Warning => key[0],
            Level::Critical => key[1],
            _ => key[2],
        };
        out.push(Alert {
            id: format!("{kind}:{acc}:{scope}:{}", level_text(level)),
            account_id: acc,
            severity: severity(level),
            message_key,
            at,
            trade_id: s.last_trade_id,
            detail,
        });
    };
    if let Some(d) = &s.daily_loss
        && let Some(level) = d.level.filter(|l| *l >= Level::Warning)
    {
        let detail = PropAlertDetail {
            level,
            used: d.used,
            remaining: d.remaining,
            limit: d.limit,
            trading_day: Some(s.trading_day.key.clone()),
            next_reset_paris_day: Some(s.next_reset.paris_day.clone()),
            next_reset_paris_time: Some(s.next_reset.paris_time.clone()),
            ..base.clone()
        };
        let keys = ["propDailyLoss.warning", "propDailyLoss.critical", "propDailyLoss.reached"];
        push("propDailyLoss", keys, format!("{start}:{}", s.trading_day.key), level, AlertDetail::PropDailyLoss(detail));
    }
    if let Some(m) = &s.max_loss
        && let Some(level) = m.level.filter(|l| *l >= Level::Warning)
    {
        let detail = PropAlertDetail { level, used: m.used, remaining: m.remaining, limit: m.limit, ..base.clone() };
        let keys = ["propMaxLoss.warning", "propMaxLoss.critical", "propMaxLoss.reached"];
        push("propMaxLoss", keys, start.clone(), level, AlertDetail::PropMaxLoss(detail));
    }
    if let Some(c) = &s.consistency
        && let Some(level) = c.level.filter(|l| *l >= Level::Warning)
    {
        let detail = PropAlertDetail { level, used: c.used, share: c.share, max_best_day_percent: Some(c.max_best_day_percent), ..base };
        let keys = ["propConsistency.warning", "propConsistency.critical", "propConsistency.reached"];
        push("propConsistency", keys, start.clone(), level, AlertDetail::PropConsistency(detail));
    }
    out
}

/// Drops an alert when the same rule and scope was already shown at a **worse** level: going
/// from critical back to watch is an improvement, never a new alert. `logged` = identities already
/// in the history.
pub fn drop_improvements(alerts: Vec<Alert>, logged: &[String]) -> Vec<Alert> {
    alerts
        .into_iter()
        .filter(|a| {
            let Some((scope, level)) = a.id.rsplit_once(':') else { return true };
            let Some(level) = level_of(level) else { return true };
            !logged.iter().any(|id| id.rsplit_once(':').is_some_and(|(s, l)| s == scope && level_of(l).is_some_and(|seen| seen > level)))
        })
        .collect()
}

/// Identities of the prop alerts already logged for an account.
pub(crate) fn logged_ids(conn: &Connection, account_id: i64) -> Result<Vec<String>> {
    let mut stmt = conn.prepare("SELECT alert_id FROM alert_log WHERE account_id = ?1 AND kind IN ('propDailyLoss','propMaxLoss','propConsistency')")?;
    let rows = stmt.query_map([account_id], |r| r.get::<_, String>(0))?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

/// The prop alerts of one account at `now`: nothing when the setting is off, the account is not a
/// prop account or has no rules.
pub(crate) fn for_account(conn: &Connection, account: &crate::accounts::Account, now: i64) -> Result<Vec<Alert>> {
    if account.kind != "prop" || !enabled(conn)? {
        return Ok(Vec::new());
    }
    let Some(status) = crate::prop::status(conn, account.id, now)? else { return Ok(Vec::new()) };
    Ok(drop_improvements(evaluate(&status), &logged_ids(conn, account.id)?))
}

#[cfg(test)]
mod tests;
