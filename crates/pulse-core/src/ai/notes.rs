//! AI comments on a trade's screenshot (table `ai_screenshot_notes`, migration v12). A comment is
//! only text to read: no statistic, score, alert or goal reads this table. It goes with its trade
//! (ON DELETE CASCADE), is left out of the CSV export, kept in backups, never sent back to the AI.

use super::context::SentFieldKey;
use crate::error::{CoreError, Result};
use rusqlite::{params, Connection};
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenshotNote {
    pub id: i64,
    pub trade_id: i64,
    pub created_at: i64,
    /// `anthropic` (or `simulation` in the browser mock).
    pub provider: String,
    /// The model that actually answered.
    pub model: String,
    /// What was sent with the image.
    pub sent: Vec<SentFieldKey>,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct NewScreenshotNote {
    pub trade_id: i64,
    pub provider: String,
    pub model: String,
    pub sent: Vec<SentFieldKey>,
    pub content: String,
}

const MAX_CONTENT_CHARS: usize = 100_000;

pub fn insert_note(conn: &Connection, note: &NewScreenshotNote, now_ms: i64) -> Result<ScreenshotNote> {
    let content = note.content.trim();
    if content.is_empty() {
        return Err(CoreError::Invalid("the AI comment is empty".into()));
    }
    if content.chars().count() > MAX_CONTENT_CHARS {
        return Err(CoreError::Invalid("the AI comment is too long".into()));
    }
    let sent = serde_json::to_string(&note.sent).map_err(|e| CoreError::Invalid(e.to_string()))?;
    conn.execute(
        "INSERT INTO ai_screenshot_notes (trade_id, created_at, provider, model, sent, content) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![note.trade_id, now_ms, note.provider.trim(), note.model.trim(), sent, content],
    )?;
    get(conn, conn.last_insert_rowid())
}

/// Most recent first.
pub fn list_notes(conn: &Connection, trade_id: i64) -> Result<Vec<ScreenshotNote>> {
    let mut stmt = conn.prepare(
        "SELECT id, trade_id, created_at, provider, model, sent, content FROM ai_screenshot_notes
         WHERE trade_id = ?1 ORDER BY created_at DESC, id DESC",
    )?;
    let rows = stmt.query_map([trade_id], row)?;
    Ok(rows.collect::<rusqlite::Result<_>>()?)
}

pub fn delete_note(conn: &Connection, id: i64) -> Result<()> {
    if conn.execute("DELETE FROM ai_screenshot_notes WHERE id = ?1", [id])? == 0 {
        return Err(CoreError::NotFound(format!("AI comment {id}")));
    }
    Ok(())
}

fn get(conn: &Connection, id: i64) -> Result<ScreenshotNote> {
    Ok(conn.query_row(
        "SELECT id, trade_id, created_at, provider, model, sent, content FROM ai_screenshot_notes WHERE id = ?1",
        [id],
        row,
    )?)
}

fn row(r: &rusqlite::Row) -> rusqlite::Result<ScreenshotNote> {
    let sent: String = r.get(5)?;
    Ok(ScreenshotNote {
        id: r.get(0)?,
        trade_id: r.get(1)?,
        created_at: r.get(2)?,
        provider: r.get(3)?,
        model: r.get(4)?,
        // Unknown keys (written by a newer version) are skipped rather than failing the read.
        sent: serde_json::from_str::<Vec<String>>(&sent).unwrap_or_default().iter().filter_map(|k| SentFieldKey::parse(k)).collect(),
        content: r.get(6)?,
    })
}
