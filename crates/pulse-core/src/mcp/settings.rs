//! `mcp.*` rows of the `settings` table (lot 37). Every row missing = the access is off and unusable:
//! no consent, no account exposed, « until Pulse closes », not started at the next launch.

use crate::accounts;
use crate::error::{CoreError, Result};
use crate::settings::{read, write};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

const CONSENT_AT: &str = "mcp.consent_at";
const ACCOUNTS: &str = "mcp.accounts";
const DURATION: &str = "mcp.duration";
const AUTOSTART: &str = "mcp.autostart";

/// How long an activation lasts. Whatever the choice, the access also goes off when Pulse closes or locks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum McpDuration {
    #[default]
    #[serde(rename = "untilClose")]
    UntilClose,
    #[serde(rename = "1h")]
    OneHour,
    #[serde(rename = "4h")]
    FourHours,
}

impl McpDuration {
    pub fn as_str(self) -> &'static str {
        match self {
            McpDuration::UntilClose => "untilClose",
            McpDuration::OneHour => "1h",
            McpDuration::FourHours => "4h",
        }
    }

    fn parse(s: &str) -> Option<McpDuration> {
        match s {
            "untilClose" => Some(McpDuration::UntilClose),
            "1h" => Some(McpDuration::OneHour),
            "4h" => Some(McpDuration::FourHours),
            _ => None,
        }
    }

    /// End of an activation started at `now`; `None` = until Pulse closes.
    pub fn expires_at(self, now: i64) -> Option<i64> {
        match self {
            McpDuration::UntilClose => None,
            McpDuration::OneHour => Some(now + 3_600_000),
            McpDuration::FourHours => Some(now + 4 * 3_600_000),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpSettings {
    /// When the user ticked the explanation (ms UTC); `None` = never, or withdrawn.
    pub consent_at: Option<i64>,
    /// Accounts the tools may read (ticked by the user; none by default).
    pub account_ids: Vec<i64>,
    pub duration: McpDuration,
    /// « Rester activé au prochain démarrage » (off by default).
    pub autostart: bool,
}

/// What the settings page changes (consent is recorded on its own).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpSettingsUpdate {
    pub account_ids: Vec<i64>,
    pub duration: McpDuration,
    pub autostart: bool,
}

pub(crate) fn error(code: &str) -> CoreError {
    CoreError::Invalid(format!("mcp:{code}"))
}

pub fn get(conn: &Connection) -> Result<McpSettings> {
    let account_ids = match read(conn, ACCOUNTS)? {
        Some(text) => serde_json::from_str::<Vec<i64>>(&text).unwrap_or_default(),
        None => Vec::new(),
    };
    Ok(McpSettings {
        consent_at: read(conn, CONSENT_AT)?.and_then(|s| s.parse().ok()),
        account_ids,
        duration: read(conn, DURATION)?.as_deref().and_then(McpDuration::parse).unwrap_or_default(),
        autostart: read(conn, AUTOSTART)?.as_deref() == Some("on"),
    })
}

/// Only active accounts can be exposed (`mcp:invalidAccount` otherwise, nothing written).
pub fn set(conn: &Connection, update: &McpSettingsUpdate) -> Result<McpSettings> {
    let active: Vec<i64> = accounts::list_active(conn)?.iter().map(|a| a.id).collect();
    let mut ids = update.account_ids.clone();
    ids.sort_unstable();
    ids.dedup();
    if ids.iter().any(|id| !active.contains(id)) {
        return Err(error("invalidAccount"));
    }
    let tx = conn.unchecked_transaction()?;
    write(&tx, ACCOUNTS, (!ids.is_empty()).then(|| serde_json::to_string(&ids).unwrap_or_else(|_| "[]".into())))?;
    write(&tx, DURATION, (update.duration != McpDuration::UntilClose).then(|| update.duration.as_str().to_owned()))?;
    write(&tx, AUTOSTART, update.autostart.then(|| "on".to_owned()))?;
    tx.commit()?;
    get(conn)
}

pub fn record_consent(conn: &Connection, now_ms: i64) -> Result<McpSettings> {
    write(conn, CONSENT_AT, Some(now_ms.to_string()))?;
    get(conn)
}

/// Withdraws the consent; « start at the next launch » goes with it (it would need the consent).
pub fn withdraw_consent(conn: &Connection) -> Result<McpSettings> {
    let tx = conn.unchecked_transaction()?;
    write(&tx, CONSENT_AT, None)?;
    write(&tx, AUTOSTART, None)?;
    tx.commit()?;
    get(conn)
}

/// The accounts the tools may read right now: the ticked ones that still exist and are not archived.
pub fn exposed_accounts(conn: &Connection, settings: &McpSettings) -> Result<Vec<i64>> {
    let active: Vec<i64> = accounts::list_active(conn)?.iter().map(|a| a.id).collect();
    Ok(settings.account_ids.iter().copied().filter(|id| active.contains(id)).collect())
}

/// Why the access cannot be turned on (`None` = it can).
pub fn cannot_enable(conn: &Connection, settings: &McpSettings) -> Result<Option<&'static str>> {
    if settings.consent_at.is_none() {
        return Ok(Some("consentRequired"));
    }
    if exposed_accounts(conn, settings)?.is_empty() {
        return Ok(Some("noAccount"));
    }
    Ok(None)
}
