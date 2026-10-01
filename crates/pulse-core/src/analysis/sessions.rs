//! Analyses de séance : une fiche datée (instant en ms UTC + décalage local), plusieurs par jour possibles,
//! faite de réponses à des questions guidées. Une question sans réponse reste **vide** (jamais 0 ni une
//! valeur par défaut) ; une analyse entièrement vide est refusée. Modifier une analyse ne supprime jamais
//! la réponse à une question archivée.

use super::questions::{self, QuestionKind};
use super::{TIMEFRAMES, day_of, opt_text};
use crate::error::{CoreError, Result};
use crate::tags::{self, TagKind};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

pub const MAX_SHORT_CHARS: usize = 300;
pub const MAX_LONG_CHARS: usize = 4000;
pub const MAX_TREND_NOTE_CHARS: usize = 500;
pub const MAX_NOTE_CHARS: usize = 2000;
pub const MAX_SETUPS: usize = 30;
pub const MAX_EMOTIONS: usize = 30;
pub const TRENDS: [&str; 4] = ["up", "down", "range", "unclear"];

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Answer {
    pub question_id: i64,
    pub value: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Analysis {
    pub id: i64,
    pub created_at: i64,
    pub tz_offset_min: i32,
    /// Jour local de `created_at` avec son propre décalage, "AAAA-MM-JJ".
    pub day: String,
    pub updated_at: i64,
    pub note: Option<String>,
    pub answers: Vec<Answer>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnswerInput {
    pub question_id: i64,
    /// `null`, `""`, `[]`… = vide : la réponse est effacée (ou jamais écrite).
    #[serde(default)]
    pub value: Value,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisInput {
    /// Instant de l'analyse ; `None` = maintenant. Modifiable (l'heure est proposée, pas imposée).
    #[serde(default)]
    pub created_at: Option<i64>,
    pub tz_offset_min: i32,
    #[serde(default)]
    pub note: Option<String>,
    #[serde(default)]
    pub answers: Vec<AnswerInput>,
}

/// Texte d'un champ JSON : `Ok(None)` si vide.
fn text(v: &Value, field: &str, max: usize) -> Result<Option<String>> {
    match v {
        Value::Null => Ok(None),
        Value::String(s) => opt_text(field, Some(s), max),
        _ => Err(CoreError::Invalid(format!("{field} must be text"))),
    }
}

fn ids_of(conn: &Connection, v: Option<&Value>, kind: TagKind, max: usize, field: &str) -> Result<Vec<i64>> {
    let mut out: Vec<i64> = Vec::new();
    for x in v.and_then(Value::as_array).into_iter().flatten() {
        let id = x.as_i64().ok_or_else(|| CoreError::Invalid(format!("{field} must be tag ids")))?;
        if tags::get(conn, id)?.kind != kind {
            return Err(CoreError::Invalid(format!("{field}: tag {id} has the wrong kind")));
        }
        if !out.contains(&id) {
            out.push(id);
        }
    }
    if out.len() > max {
        return Err(CoreError::Invalid(format!("{field} is limited to {max} items")));
    }
    Ok(out)
}

/// Réponse remise sous sa forme canonique ; `None` = vide (rien n'est écrit).
pub fn normalize(conn: &Connection, q: &questions::Question, value: &Value) -> Result<Option<Value>> {
    Ok(match q.kind {
        QuestionKind::ShortText => text(value, "answer", MAX_SHORT_CHARS)?.map(Value::String),
        QuestionKind::LongText => text(value, "answer", MAX_LONG_CHARS)?.map(Value::String),
        QuestionKind::Choice => match text(value, "answer", MAX_SHORT_CHARS)? {
            None => None,
            Some(c) => {
                let ok = q.options.get("choices").and_then(Value::as_array).is_some_and(|l| l.iter().any(|x| x.as_str() == Some(&c)));
                if !ok {
                    return Err(CoreError::Invalid(format!("{c:?} is not one of the choices")));
                }
                Some(Value::String(c))
            }
        },
        QuestionKind::Conviction => match value {
            Value::Null => None,
            v => {
                let n = v.as_i64().ok_or_else(|| CoreError::Invalid("conviction must be a whole number".into()))?;
                if !(1..=10).contains(&n) {
                    return Err(CoreError::Invalid("conviction must be between 1 and 10".into()));
                }
                Some(json!(n))
            }
        },
        QuestionKind::Trend => {
            let Some(map) = value.as_object() else {
                return if value.is_null() { Ok(None) } else { Err(CoreError::Invalid("trend answer must be an object".into())) };
            };
            let mut out = Map::new();
            for tf in TIMEFRAMES {
                let Some(entry) = map.get(tf).filter(|e| !e.is_null()) else { continue };
                let trend = match entry.get("trend") {
                    None | Some(Value::Null) => None,
                    Some(Value::String(t)) if TRENDS.contains(&t.as_str()) => Some(t.clone()),
                    Some(_) => return Err(CoreError::Invalid(format!("unknown trend for {tf}"))),
                };
                let note = text(entry.get("note").unwrap_or(&Value::Null), "trend note", MAX_TREND_NOTE_CHARS)?;
                if trend.is_some() || note.is_some() {
                    out.insert(tf.to_string(), json!({ "trend": trend, "note": note }));
                }
            }
            if let Some(bad) = map.keys().find(|k| !TIMEFRAMES.contains(&k.as_str())) {
                return Err(CoreError::Invalid(format!("unknown time frame {bad:?}")));
            }
            (!out.is_empty()).then_some(Value::Object(out))
        }
        QuestionKind::Setups => {
            let ids = ids_of(conn, Some(value), TagKind::Setup, MAX_SETUPS, "setups")?;
            (!ids.is_empty()).then(|| json!(ids))
        }
        QuestionKind::Emotions => {
            if value.is_null() {
                return Ok(None);
            }
            let note = text(value.get("text").unwrap_or(&Value::Null), "state", MAX_SHORT_CHARS)?;
            let ids = ids_of(conn, value.get("tagIds"), TagKind::Emotion, MAX_EMOTIONS, "emotions")?;
            (note.is_some() || !ids.is_empty()).then(|| json!({ "text": note, "tagIds": ids }))
        }
        QuestionKind::News => {
            if value.is_null() {
                return Ok(None);
            }
            text(value.get("note").unwrap_or(&Value::Null), "news note", 1000)?.map(|n| json!({ "note": n }))
        }
    })
}

fn answers_of(conn: &Connection, analysis_id: i64) -> Result<Vec<Answer>> {
    let mut stmt = conn.prepare(
        "SELECT a.question_id, a.value FROM analysis_answers a JOIN analysis_questions q ON q.id = a.question_id
         WHERE a.analysis_id = ?1 ORDER BY q.position, q.id",
    )?;
    let rows = stmt.query_map([analysis_id], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?)))?;
    let mut out = Vec::new();
    for row in rows {
        let (question_id, value) = row?;
        out.push(Answer { question_id, value: serde_json::from_str(&value).unwrap_or(Value::Null) });
    }
    Ok(out)
}

const COLUMNS: &str = "id, created_at, tz_offset_min, day, updated_at, note";

fn head(r: &rusqlite::Row) -> rusqlite::Result<Analysis> {
    Ok(Analysis {
        id: r.get(0)?,
        created_at: r.get(1)?,
        tz_offset_min: r.get(2)?,
        day: r.get(3)?,
        updated_at: r.get(4)?,
        note: r.get(5)?,
        answers: Vec::new(),
    })
}

fn load(conn: &Connection, mut a: Analysis) -> Result<Analysis> {
    a.answers = answers_of(conn, a.id)?;
    Ok(a)
}

pub fn get(conn: &Connection, id: i64) -> Result<Analysis> {
    let a = conn
        .query_row(&format!("SELECT {COLUMNS} FROM analyses WHERE id = ?1"), [id], head)
        .optional()?
        .ok_or_else(|| CoreError::NotFound(format!("analysis {id}")))?;
    load(conn, a)
}

fn check_tz(tz: i32) -> Result<()> {
    if !(-14 * 60..=14 * 60).contains(&tz) {
        return Err(CoreError::Invalid("the time zone offset is out of range".into()));
    }
    Ok(())
}

/// Écrit les réponses (fusion : une question absente de l'entrée garde sa réponse) et renvoie le nombre de
/// réponses que l'analyse contient ensuite.
fn write_answers(conn: &Connection, analysis_id: i64, answers: &[AnswerInput]) -> Result<i64> {
    for a in answers {
        let q = questions::get(conn, a.question_id)?;
        let value = normalize(conn, &q, &a.value)?;
        let existing: bool = conn
            .query_row("SELECT 1 FROM analysis_answers WHERE analysis_id = ?1 AND question_id = ?2", params![analysis_id, q.id], |_| Ok(true))
            .optional()?
            .is_some();
        match value {
            None => {
                conn.execute("DELETE FROM analysis_answers WHERE analysis_id = ?1 AND question_id = ?2", params![analysis_id, q.id])?;
            }
            Some(_) if q.archived && !existing => {
                return Err(CoreError::Invalid(format!("question {} is archived", q.key)));
            }
            Some(v) => {
                conn.execute(
                    "INSERT INTO analysis_answers (analysis_id, question_id, value) VALUES (?1, ?2, ?3)
                     ON CONFLICT (analysis_id, question_id) DO UPDATE SET value = excluded.value",
                    params![analysis_id, q.id, v.to_string()],
                )?;
            }
        }
    }
    Ok(conn.query_row("SELECT COUNT(*) FROM analysis_answers WHERE analysis_id = ?1", [analysis_id], |r| r.get(0))?)
}

/// Enregistre une nouvelle analyse. Refusée si elle ne contient aucune réponse.
pub fn create(conn: &Connection, input: &AnalysisInput, now: i64) -> Result<Analysis> {
    check_tz(input.tz_offset_min)?;
    let note = opt_text("note", input.note.as_deref(), MAX_NOTE_CHARS)?;
    let created_at = input.created_at.unwrap_or(now);
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO analyses (created_at, tz_offset_min, day, updated_at, note) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![created_at, input.tz_offset_min, day_of(created_at, input.tz_offset_min), now, note],
    )?;
    let id = tx.last_insert_rowid();
    if write_answers(&tx, id, &input.answers)? == 0 {
        return Err(CoreError::Invalid("an empty analysis is not saved".into()));
    }
    tx.commit()?;
    get(conn, id)
}

/// Modifie une analyse : l'heure, la note et les réponses données ; les autres réponses sont gardées.
pub fn update(conn: &Connection, id: i64, input: &AnalysisInput, now: i64) -> Result<Analysis> {
    let current = get(conn, id)?;
    check_tz(input.tz_offset_min)?;
    let note = opt_text("note", input.note.as_deref(), MAX_NOTE_CHARS)?;
    let created_at = input.created_at.unwrap_or(current.created_at);
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE analyses SET created_at = ?2, tz_offset_min = ?3, day = ?4, updated_at = ?5, note = ?6 WHERE id = ?1",
        params![id, created_at, input.tz_offset_min, day_of(created_at, input.tz_offset_min), now, note],
    )?;
    if write_answers(&tx, id, &input.answers)? == 0 {
        return Err(CoreError::Invalid("an empty analysis is not saved".into()));
    }
    tx.commit()?;
    get(conn, id)
}

/// Supprime une analyse, ses réponses et ses liens avec les trades (les trades restent).
pub fn delete(conn: &Connection, id: i64) -> Result<()> {
    get(conn, id)?;
    conn.execute("DELETE FROM analyses WHERE id = ?1", [id])?;
    Ok(())
}

fn query(conn: &Connection, sql: &str, args: &[&dyn rusqlite::ToSql]) -> Result<Vec<Analysis>> {
    let mut stmt = conn.prepare(sql)?;
    let rows = stmt.query_map(args, head)?;
    let heads = rows.collect::<rusqlite::Result<Vec<_>>>()?;
    heads.into_iter().map(|a| load(conn, a)).collect()
}

/// Analyses d'un jour local, de la plus ancienne à la plus récente (l'heure distingue les séances).
pub fn list_day(conn: &Connection, day: &str) -> Result<Vec<Analysis>> {
    super::check_day("day", day)?;
    query(conn, &format!("SELECT {COLUMNS} FROM analyses WHERE day = ?1 ORDER BY created_at, id"), &[&day])
}

/// Analyses des jours **strictement avant** `day`, les plus récentes d'abord, `limit` au plus
/// (pour l'historique replié par jour).
pub fn list_before(conn: &Connection, day: &str, limit: u32) -> Result<Vec<Analysis>> {
    super::check_day("day", day)?;
    query(conn, &format!("SELECT {COLUMNS} FROM analyses WHERE day < ?1 ORDER BY day DESC, created_at DESC, id DESC LIMIT ?2"), &[&day, &limit.min(500)])
}

/// La dernière analyse d'un jour local (la plus récente), s'il y en a une.
pub fn latest_of_day(conn: &Connection, day: &str) -> Result<Option<Analysis>> {
    Ok(list_day(conn, day)?.pop())
}
