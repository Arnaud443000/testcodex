//! `ai.*` rows of the `settings` table. A missing `ai.enabled` row means **off**: nothing
//! can reach the network until the user turns the option on. The API key is never here.

use crate::error::{CoreError, Result};
use crate::settings::{read, write};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

const ENABLED: &str = "ai.enabled";
const MODEL: &str = "ai.model";
const CONSENT_AT: &str = "ai.consent_at";

/// Model identifiers taken from the `claude-api` skill documentation (none guessed).
pub const DEFAULT_MODEL: &str = "claude-opus-5-5";
pub const SUGGESTED_MODELS: [&str; 3] = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-4-5"];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSettings {
    pub enabled: bool,
    pub model: String,
    /// When the user accepted the first-use explanation (ms UTC); `None` = never, or since turned off.
    pub consent_at: Option<i64>,
}

/// What the settings page can change (consent is recorded separately, from the send dialog).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSettingsUpdate {
    pub enabled: bool,
    pub model: String,
}

pub fn get_settings(conn: &Connection) -> Result<AiSettings> {
    Ok(AiSettings {
        enabled: read(conn, ENABLED)?.as_deref() == Some("on"),
        model: read(conn, MODEL)?.unwrap_or_else(|| DEFAULT_MODEL.to_owned()),
        consent_at: read(conn, CONSENT_AT)?.and_then(|s| s.parse().ok()),
    })
}

/// Validates then saves. Turning the option off also forgets the first-use consent, so turning
/// it back on shows the full explanation again before anything is sent.
pub fn set_settings(conn: &Connection, update: &AiSettingsUpdate) -> Result<AiSettings> {
    let model = validate_model(&update.model)?;
    let tx = conn.unchecked_transaction()?;
    write(&tx, ENABLED, update.enabled.then(|| "on".to_owned()))?;
    write(&tx, MODEL, (model != DEFAULT_MODEL).then_some(model))?;
    if !update.enabled {
        write(&tx, CONSENT_AT, None)?;
        // Lot 21: the coach's own consent goes too.
        write(&tx, crate::coach::COACH_CONSENT_AT, None)?;
    }
    tx.commit()?;
    get_settings(conn)
}

/// Recorded when the user ticks the first-use explanation. Refused while the option is off.
pub fn record_consent(conn: &Connection, now_ms: i64) -> Result<AiSettings> {
    if !get_settings(conn)?.enabled {
        return Err(CoreError::Invalid("the AI option is turned off".into()));
    }
    write(conn, CONSENT_AT, Some(now_ms.to_string()))?;
    get_settings(conn)
}

/// A Claude model identifier: `claude-` then lowercase letters, digits, dots and dashes. Whether the
/// model exists is for the API to say ("model not found"), never guessed here.
pub fn validate_model(raw: &str) -> Result<String> {
    let m = raw.trim();
    let rest = m.strip_prefix("claude-").unwrap_or("");
    let ok = !rest.is_empty()
        && m.len() <= 64
        && rest.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, '-' | '.'))
        && rest.starts_with(|c: char| c.is_ascii_alphanumeric());
    if ok { Ok(m.to_owned()) } else { Err(CoreError::Invalid("the model must look like claude-…".into())) }
}
