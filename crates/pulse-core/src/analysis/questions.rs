//! Le modèle de questions de l'analyse : ajouter, renommer, réordonner, désactiver. **Jamais de
//! suppression** : une question archivée disparaît du formulaire mais ses réponses passées restent lisibles
//! (la base l'impose aussi : les réponses référencent la question sans cascade).

use super::{TIMEFRAMES, opt_text};
use crate::error::{CoreError, Result};
use crate::util::text_enum;
use rusqlite::{Connection, params};
use serde::Serialize;
use serde_json::{Value, json};

text_enum!(QuestionKind {
    ShortText => "shortText",
    LongText => "longText",
    Choice => "choice",
    Trend => "trend",
    Conviction => "conviction",
    Setups => "setups",
    Emotions => "emotions",
    News => "news",
});

pub const MAX_LABEL_CHARS: usize = 200;
pub const MAX_CHOICES: usize = 12;
pub const MAX_CHOICE_CHARS: usize = 80;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Question {
    pub id: i64,
    /// Clé technique stable : celle des questions d'origine sert à traduire leur libellé.
    pub key: String,
    /// `None` = libellé d'origine (traduit côté interface depuis `key`).
    pub label: Option<String>,
    pub kind: QuestionKind,
    pub position: i64,
    pub archived: bool,
    /// `{"timeframes": [...]}` (tendance), `{"choices": [...]}` (choix unique), `{}` sinon.
    pub options: Value,
}

/// Espaces de bord retirés, espaces internes réduits à un seul.
fn squeeze(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

const COLUMNS: &str = "id, key, label, kind, position, archived, options";

fn row(r: &rusqlite::Row) -> rusqlite::Result<Question> {
    let options: String = r.get(6)?;
    Ok(Question {
        id: r.get(0)?,
        key: r.get(1)?,
        label: r.get(2)?,
        kind: r.get(3)?,
        position: r.get(4)?,
        archived: r.get::<_, i64>(5)? != 0,
        options: serde_json::from_str(&options).unwrap_or_else(|_| json!({})),
    })
}

pub fn get(conn: &Connection, id: i64) -> Result<Question> {
    conn.query_row(&format!("SELECT {COLUMNS} FROM analysis_questions WHERE id = ?1"), [id], row)
        .map_err(|e| match e {
            rusqlite::Error::QueryReturnedNoRows => CoreError::NotFound(format!("analysis question {id}")),
            e => e.into(),
        })
}

/// Questions dans l'ordre d'affichage ; les archivées seulement si demandé.
pub fn list(conn: &Connection, include_archived: bool) -> Result<Vec<Question>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} FROM analysis_questions WHERE (?1 OR archived = 0) ORDER BY position, id"
    ))?;
    let rows = stmt.query_map([include_archived], row)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// Valide les options d'une question et les met sous forme canonique.
pub fn clean_options(kind: QuestionKind, options: &Value) -> Result<Value> {
    match kind {
        QuestionKind::Trend => {
            let asked: Vec<&str> = options
                .get("timeframes")
                .and_then(Value::as_array)
                .map(|a| a.iter().filter_map(Value::as_str).collect())
                .unwrap_or_default();
            if let Some(bad) = asked.iter().find(|t| !TIMEFRAMES.contains(t)) {
                return Err(CoreError::Invalid(format!("unknown time frame {bad:?}")));
            }
            let chosen: Vec<&str> = TIMEFRAMES.iter().copied().filter(|t| asked.contains(t)).collect();
            if chosen.is_empty() {
                return Err(CoreError::Invalid("at least one time frame must be shown".into()));
            }
            Ok(json!({ "timeframes": chosen }))
        }
        QuestionKind::Choice => {
            let mut choices: Vec<String> = Vec::new();
            for c in options.get("choices").and_then(Value::as_array).into_iter().flatten() {
                if let Some(t) = opt_text("choice", c.as_str(), MAX_CHOICE_CHARS)? {
                    if !choices.iter().any(|x| x.eq_ignore_ascii_case(&t)) {
                        choices.push(t);
                    }
                }
            }
            if !(2..=MAX_CHOICES).contains(&choices.len()) {
                return Err(CoreError::Invalid(format!("a single-choice question needs 2 to {MAX_CHOICES} choices")));
            }
            Ok(json!({ "choices": choices }))
        }
        _ => Ok(json!({})),
    }
}

/// Ajoute une question personnalisée à la fin. Le bloc « annonces » n'existe qu'une fois (celui d'origine).
pub fn add(conn: &Connection, label: &str, kind: QuestionKind, options: &Value) -> Result<Question> {
    if kind == QuestionKind::News {
        return Err(CoreError::Invalid("the economic news block already exists".into()));
    }
    let label = opt_text("label", Some(&squeeze(label)), MAX_LABEL_CHARS)?.ok_or_else(|| CoreError::Invalid("label is required".into()))?;
    let options = clean_options(kind, options)?;
    let tx = conn.unchecked_transaction()?;
    let position: i64 = tx.query_row("SELECT COALESCE(MAX(position), 0) + 1 FROM analysis_questions", [], |r| r.get(0))?;
    tx.execute(
        "INSERT INTO analysis_questions (key, label, kind, position, options) VALUES ('pending', ?1, ?2, ?3, ?4)",
        params![label, kind, position, options.to_string()],
    )?;
    let id = tx.last_insert_rowid();
    tx.execute("UPDATE analysis_questions SET key = ?2 WHERE id = ?1", params![id, format!("custom_{id}")])?;
    tx.commit()?;
    get(conn, id)
}

/// Renomme une question et/ou change ses options. `label = None` remet le libellé d'origine (questions
/// d'origine seulement : une question ajoutée n'a pas de libellé d'origine). `options = None` les garde.
pub fn update(conn: &Connection, id: i64, label: Option<&str>, options: Option<&Value>) -> Result<Question> {
    let q = get(conn, id)?;
    let original = !q.key.starts_with("custom_");
    let new_label = match opt_text("label", label.map(squeeze).as_deref(), MAX_LABEL_CHARS)? {
        Some(l) => Some(l),
        None if original => None,
        None => return Err(CoreError::Invalid("label is required".into())),
    };
    let new_options = match options {
        Some(o) => clean_options(q.kind, o)?,
        None => q.options.clone(),
    };
    conn.execute(
        "UPDATE analysis_questions SET label = ?2, options = ?3 WHERE id = ?1",
        params![id, new_label, new_options.to_string()],
    )?;
    get(conn, id)
}

/// Descend (`delta > 0`) ou remonte (`delta < 0`) la question d'un rang parmi les questions affichées
/// (les archivées ne comptent pas) ; sans effet au bord de la liste.
pub fn move_by(conn: &Connection, id: i64, delta: i32) -> Result<Vec<Question>> {
    let shown = list(conn, false)?;
    let Some(at) = shown.iter().position(|q| q.id == id) else {
        get(conn, id)?;
        return Err(CoreError::Invalid("an archived question cannot be moved".into()));
    };
    let to = (at as i64 + i64::from(delta.signum())).clamp(0, shown.len() as i64 - 1) as usize;
    if to != at {
        let tx = conn.unchecked_transaction()?;
        let (a, b) = (&shown[at], &shown[to]);
        tx.execute("UPDATE analysis_questions SET position = ?2 WHERE id = ?1", params![a.id, -1])?;
        tx.execute("UPDATE analysis_questions SET position = ?2 WHERE id = ?1", params![b.id, a.position])?;
        tx.execute("UPDATE analysis_questions SET position = ?2 WHERE id = ?1", params![a.id, b.position])?;
        tx.commit()?;
    }
    list(conn, true)
}

/// Archive ou réactive une question. Les réponses déjà écrites ne changent pas.
pub fn set_archived(conn: &Connection, id: i64, archived: bool) -> Result<Question> {
    get(conn, id)?;
    conn.execute("UPDATE analysis_questions SET archived = ?2 WHERE id = ?1", params![id, archived])?;
    get(conn, id)
}
