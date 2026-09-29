//! The coach's own consent (`ai.coach_consent_at`), distinct from the screenshot one (`ai.consent_at`):
//! the first question shows its own explanation. Turning the AI option off forgets both
//! (`ai::set_settings`).

use crate::ai;
use crate::error::{CoreError, Result};
use crate::settings::{read, write};
use rusqlite::Connection;

pub const COACH_CONSENT_AT: &str = "ai.coach_consent_at";

pub fn coach_consent_at(conn: &Connection) -> Result<Option<i64>> {
    Ok(read(conn, COACH_CONSENT_AT)?.and_then(|s| s.parse().ok()))
}

/// Recorded when the user ticks the coach's first-use explanation. Refused while the option is off.
pub fn record_coach_consent(conn: &Connection, now_ms: i64) -> Result<Option<i64>> {
    if !ai::get_settings(conn)?.enabled {
        return Err(CoreError::Invalid("the AI option is turned off".into()));
    }
    write(conn, COACH_CONSENT_AT, Some(now_ms.to_string()))?;
    coach_consent_at(conn)
}
