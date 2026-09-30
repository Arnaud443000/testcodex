//! Idées à surveiller : une fiche par actif qui dure plusieurs jours. Le fil de notes est daté et **n'est
//! jamais réécrit** : chaque modification ou complément ajoute une entrée. Les prix sont des décimaux exacts.

use super::review::AnalysisSettings;
use super::{TIMEFRAMES, day_number, day_of, opt_text};
use crate::error::{CoreError, Result};
use crate::money::{self, Decimal};
use crate::util::text_enum;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

pub const MAX_NOTE_CHARS: usize = 4000;
pub const MAX_INVALIDATION_CHARS: usize = 2000;

text_enum!(IdeaStatus {
    Active => "active",
    Closed => "closed",
});

text_enum!(IdeaOutcome {
    Worked => "worked",
    Invalidated => "invalidated",
    NoFollowUp => "noFollowUp",
});

text_enum!(NoteKind {
    Created => "created",
    Edit => "edit",
    Complement => "complement",
    Snooze => "snooze",
    Closed => "closed",
});

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeaNote {
    pub id: i64,
    pub created_at: i64,
    pub kind: NoteKind,
    /// Texte du trader ; vide pour un report. Les libellés (« Reportée jusqu'au… ») sont ceux de l'interface.
    pub body: String,
    /// Donnée de l'entrée : jour de retour (report) ou résultat (clôture).
    pub data: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Idea {
    pub id: i64,
    pub instrument_id: i64,
    pub symbol: String,
    pub timeframes: Vec<String>,
    pub note: String,
    pub level_low: Option<Decimal>,
    pub level_high: Option<Decimal>,
    pub invalidation: Option<String>,
    pub created_at: i64,
    /// Dernière mise à jour **du contenu** (un report ou « Toujours valable » n'y touche pas).
    pub updated_at: i64,
    pub last_reviewed_at: Option<i64>,
    pub status: IdeaStatus,
    pub outcome: Option<IdeaOutcome>,
    pub closed_at: Option<i64>,
    /// Jour local "AAAA-MM-JJ" jusqu'auquel l'idée est reportée ; `None` = pas de report.
    pub snoozed_until_day: Option<String>,
    pub snooze_count: u32,
    pub notes: Vec<IdeaNote>,
}

/// Une idée avec ce que les règles de la revue en disent à un instant donné.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeaView {
    #[serde(flatten)]
    pub idea: Idea,
    /// Jours locaux écoulés depuis la dernière mise à jour du contenu.
    pub age_days: i64,
    /// Active, sans mise à jour depuis `analysis.stale_days` jours ou plus, et pas en report : « à revoir ».
    pub stale: bool,
    /// Reportée et le jour de retour n'est pas encore arrivé.
    pub snoozed: bool,
    /// Un report dont le jour est arrivé : l'idée revient en tête de la revue.
    pub returned: bool,
    pub reviewed_today: bool,
    /// Elle figure dans la revue du matin d'aujourd'hui.
    pub in_review: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeaInput {
    pub instrument_id: i64,
    #[serde(default)]
    pub timeframes: Vec<String>,
    pub note: String,
    /// Prix bas / haut du niveau ou de la zone, facultatifs (chaînes décimales).
    #[serde(default)]
    pub level_low: Option<String>,
    #[serde(default)]
    pub level_high: Option<String>,
    #[serde(default)]
    pub invalidation: Option<String>,
}

struct Clean {
    timeframes: Vec<String>,
    note: String,
    low: Option<Decimal>,
    high: Option<Decimal>,
    invalidation: Option<String>,
}

fn price(field: &str, s: &Option<String>) -> Result<Option<Decimal>> {
    let Some(t) = s.as_deref().map(str::trim).filter(|t| !t.is_empty()) else { return Ok(None) };
    let d = money::parse(field, t)?;
    if d <= Decimal::ZERO {
        return Err(CoreError::Invalid(format!("{field} must be greater than zero")));
    }
    Ok(Some(d))
}

fn clean(conn: &Connection, input: &IdeaInput) -> Result<Clean> {
    crate::instruments::get(conn, input.instrument_id)?;
    if let Some(bad) = input.timeframes.iter().find(|t| !TIMEFRAMES.contains(&t.as_str())) {
        return Err(CoreError::Invalid(format!("unknown time frame {bad:?}")));
    }
    let timeframes = TIMEFRAMES.iter().filter(|t| input.timeframes.iter().any(|x| x == *t)).map(|t| t.to_string()).collect();
    let note = opt_text("note", Some(&input.note), MAX_NOTE_CHARS)?.ok_or_else(|| CoreError::Invalid("the note is required".into()))?;
    let (low, high) = (price("low level", &input.level_low)?, price("high level", &input.level_high)?);
    if let (Some(l), Some(h)) = (low, high)
        && l > h
    {
        return Err(CoreError::Invalid("the low level must not be above the high level".into()));
    }
    Ok(Clean { timeframes, note, low, high, invalidation: opt_text("invalidation", input.invalidation.as_deref(), MAX_INVALIDATION_CHARS)? })
}

pub(crate) fn add_note(conn: &Connection, idea_id: i64, at: i64, kind: NoteKind, body: &str, data: Option<&str>) -> Result<()> {
    conn.execute(
        "INSERT INTO idea_notes (idea_id, created_at, kind, body, data) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![idea_id, at, kind, body, data],
    )?;
    Ok(())
}

/// Crée une idée ; son texte de départ est la première entrée du fil.
pub fn create(conn: &Connection, input: &IdeaInput, now: i64) -> Result<Idea> {
    let c = clean(conn, input)?;
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "INSERT INTO ideas (instrument_id, timeframes, note, level_low, level_high, invalidation, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        params![
            input.instrument_id,
            serde_json::to_string(&c.timeframes).unwrap_or_else(|_| "[]".into()),
            c.note,
            c.low.map(money::to_db),
            c.high.map(money::to_db),
            c.invalidation,
            now
        ],
    )?;
    let id = tx.last_insert_rowid();
    add_note(&tx, id, now, NoteKind::Created, &c.note, None)?;
    tx.commit()?;
    get(conn, id)
}

const COLUMNS: &str = "i.id, i.instrument_id, n.symbol, i.timeframes, i.note, i.level_low, i.level_high, i.invalidation, i.created_at,
    i.updated_at, i.last_reviewed_at, i.status, i.outcome, i.closed_at, i.snoozed_until_day, i.snooze_count";

fn row(r: &rusqlite::Row) -> rusqlite::Result<Idea> {
    let frames: String = r.get(3)?;
    Ok(Idea {
        id: r.get(0)?,
        instrument_id: r.get(1)?,
        symbol: r.get(2)?,
        timeframes: serde_json::from_str(&frames).unwrap_or_default(),
        note: r.get(4)?,
        level_low: money::opt_col(r, 5)?,
        level_high: money::opt_col(r, 6)?,
        invalidation: r.get(7)?,
        created_at: r.get(8)?,
        updated_at: r.get(9)?,
        last_reviewed_at: r.get(10)?,
        status: r.get(11)?,
        outcome: r.get(12)?,
        closed_at: r.get(13)?,
        snoozed_until_day: r.get(14)?,
        snooze_count: r.get(15)?,
        notes: Vec::new(),
    })
}

fn notes_of(conn: &Connection, idea_id: i64) -> Result<Vec<IdeaNote>> {
    let mut stmt = conn.prepare("SELECT id, created_at, kind, body, data FROM idea_notes WHERE idea_id = ?1 ORDER BY created_at, id")?;
    let rows = stmt.query_map([idea_id], |r| {
        Ok(IdeaNote { id: r.get(0)?, created_at: r.get(1)?, kind: r.get(2)?, body: r.get(3)?, data: r.get(4)? })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

const FROM: &str = "FROM ideas i JOIN instruments n ON n.id = i.instrument_id";

pub fn get(conn: &Connection, id: i64) -> Result<Idea> {
    let mut idea = conn
        .query_row(&format!("SELECT {COLUMNS} {FROM} WHERE i.id = ?1"), [id], row)
        .optional()?
        .ok_or_else(|| CoreError::NotFound(format!("idea {id}")))?;
    idea.notes = notes_of(conn, id)?;
    Ok(idea)
}

pub(crate) fn require_active(conn: &Connection, id: i64) -> Result<Idea> {
    let idea = get(conn, id)?;
    if idea.status != IdeaStatus::Active {
        return Err(CoreError::Invalid("the idea is closed".into()));
    }
    Ok(idea)
}

/// Les idées (actives ou clôturées) avec leurs notes, dans l'ordre : actives les plus anciennes
/// d'abord, clôturées les plus récentes d'abord. Filtre facultatif par actif.
pub fn list(conn: &Connection, status: IdeaStatus, instrument_id: Option<i64>) -> Result<Vec<Idea>> {
    let order = if status == IdeaStatus::Active { "i.updated_at, i.id" } else { "i.closed_at DESC, i.id DESC" };
    let mut stmt = conn.prepare(&format!(
        "SELECT {COLUMNS} {FROM} WHERE i.status = ?1 AND (?2 IS NULL OR i.instrument_id = ?2) ORDER BY {order}"
    ))?;
    let ideas = stmt.query_map(params![status, instrument_id], row)?.collect::<rusqlite::Result<Vec<_>>>()?;
    ideas.into_iter().map(|mut i| {
        i.notes = notes_of(conn, i.id)?;
        Ok(i)
    }).collect()
}

/// Ce que les règles de la revue disent de l'idée au jour local `today` ("AAAA-MM-JJ", nombre `today_n`).
pub(crate) fn view(idea: Idea, s: &AnalysisSettings, today: &str, today_n: i64, tz: i32) -> IdeaView {
    let active = idea.status == IdeaStatus::Active;
    let age_days = today_n - day_number(idea.updated_at, tz);
    let snoozed = active && idea.snoozed_until_day.as_deref().is_some_and(|d| d > today);
    let returned = active && idea.snoozed_until_day.as_deref().is_some_and(|d| d <= today);
    let stale = active && !snoozed && age_days >= i64::from(s.stale_days);
    let reviewed_today = idea.last_reviewed_at.is_some_and(|t| day_of(t, tz) == today);
    // Créée ou mise à jour un jour précédent (le contenu ne change jamais sans `updated_at`).
    let touched_before = age_days >= 1;
    let in_review = active && !snoozed && !reviewed_today && touched_before;
    IdeaView { idea, age_days, stale, snoozed, returned, reviewed_today, in_review }
}

/// Idées avec leurs indicateurs à l'instant `now` (jour local du PC, `tz_offset_min`).
pub fn list_views(conn: &Connection, status: IdeaStatus, instrument_id: Option<i64>, now: i64, tz: i32) -> Result<Vec<IdeaView>> {
    let s = super::review::settings(conn)?;
    let (today, n) = (day_of(now, tz), day_number(now, tz));
    Ok(list(conn, status, instrument_id)?.into_iter().map(|i| view(i, &s, &today, n, tz)).collect())
}

/// Modifie le contenu d'une idée active. Un nouveau texte **ajoute** une entrée au fil (l'ancien reste) ;
/// tout changement de contenu met à jour `updated_at` et annule le report. Rien ne change : rien n'est écrit.
pub fn update(conn: &Connection, id: i64, input: &IdeaInput, now: i64) -> Result<Idea> {
    let old = require_active(conn, id)?;
    let c = clean(conn, input)?;
    let changed = old.instrument_id != input.instrument_id
        || old.timeframes != c.timeframes
        || old.note != c.note
        || old.level_low != c.low
        || old.level_high != c.high
        || old.invalidation != c.invalidation;
    if !changed {
        return Ok(old);
    }
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE ideas SET instrument_id = ?2, timeframes = ?3, note = ?4, level_low = ?5, level_high = ?6, invalidation = ?7,
                updated_at = ?8, snoozed_until_day = NULL WHERE id = ?1",
        params![
            id,
            input.instrument_id,
            serde_json::to_string(&c.timeframes).unwrap_or_else(|_| "[]".into()),
            c.note,
            c.low.map(money::to_db),
            c.high.map(money::to_db),
            c.invalidation,
            now
        ],
    )?;
    if old.note != c.note {
        add_note(&tx, id, now, NoteKind::Edit, &c.note, None)?;
    }
    tx.commit()?;
    get(conn, id)
}

/// Ajoute un complément daté (« Compléter ») : met à jour le contenu, annule le report, compte comme revue du jour.
pub fn complete(conn: &Connection, id: i64, body: &str, now: i64) -> Result<Idea> {
    require_active(conn, id)?;
    let body = opt_text("note", Some(body), MAX_NOTE_CHARS)?.ok_or_else(|| CoreError::Invalid("the note is required".into()))?;
    let tx = conn.unchecked_transaction()?;
    add_note(&tx, id, now, NoteKind::Complement, &body, None)?;
    tx.execute("UPDATE ideas SET updated_at = ?2, last_reviewed_at = ?2, snoozed_until_day = NULL WHERE id = ?1", params![id, now])?;
    tx.commit()?;
    get(conn, id)
}

/// Clôture l'idée avec un résultat et une raison courte facultative ; annule le report.
pub fn close(conn: &Connection, id: i64, outcome: IdeaOutcome, reason: Option<&str>, now: i64) -> Result<Idea> {
    require_active(conn, id)?;
    let reason = opt_text("reason", reason, 500)?.unwrap_or_default();
    let tx = conn.unchecked_transaction()?;
    add_note(&tx, id, now, NoteKind::Closed, &reason, Some(outcome.as_str()))?;
    tx.execute(
        "UPDATE ideas SET status = 'closed', outcome = ?2, closed_at = ?3, last_reviewed_at = ?3, snoozed_until_day = NULL WHERE id = ?1",
        params![id, outcome, now],
    )?;
    tx.commit()?;
    get(conn, id)
}

/// Supprime vraiment l'idée, son fil de notes et ses liens avec les trades (les trades restent).
pub fn delete(conn: &Connection, id: i64) -> Result<()> {
    get(conn, id)?;
    conn.execute("DELETE FROM ideas WHERE id = ?1", [id])?;
    Ok(())
}
