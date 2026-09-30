//! La revue du lendemain : règles déterministes, jour local du PC (`tz_offset_min` de l'appelant).
//!
//! Une idée est **à revoir ce matin** si elle est active, créée ou mise à jour un jour précédent, pas encore
//! revue aujourd'hui et pas reportée au-delà d'aujourd'hui. `analysis.last_review_day` ne sert qu'à la
//! bannière (« plus tard » la fait taire pour la journée). Rien ne s'écrit à la lecture.

use super::ideas::{self, IdeaOutcome, IdeaStatus, IdeaView, NoteKind};
use super::{DEFAULT_STALE_DAYS, MAX_SNOOZE_DAYS, MAX_STALE_DAYS, MIN_SNOOZE_DAYS, MIN_STALE_DAYS, REVIEW_VISIBLE, day_key_of, day_number, day_of};
use crate::error::{CoreError, Result};
use crate::settings::{read, write};
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};

const STALE_DAYS: &str = "analysis.stale_days";
const LAST_REVIEW_DAY: &str = "analysis.last_review_day";
const NO_ANALYSIS_ALERT: &str = "alerts.no_analysis";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisSettings {
    /// Jours sans mise à jour à partir desquels une idée passe en « à revoir » (1 à 60, 7 par défaut).
    pub stale_days: u32,
    /// Alerte facultative « trade pris sans analyse du jour » (éteinte par défaut).
    pub no_analysis_alert: bool,
}

impl Default for AnalysisSettings {
    fn default() -> Self {
        AnalysisSettings { stale_days: DEFAULT_STALE_DAYS, no_analysis_alert: false }
    }
}

pub fn settings(conn: &Connection) -> Result<AnalysisSettings> {
    let stale_days = match read(conn, STALE_DAYS)? {
        Some(s) => s.trim().parse().ok().filter(|n| (MIN_STALE_DAYS..=MAX_STALE_DAYS).contains(n)).unwrap_or(DEFAULT_STALE_DAYS),
        None => DEFAULT_STALE_DAYS,
    };
    Ok(AnalysisSettings { stale_days, no_analysis_alert: read(conn, NO_ANALYSIS_ALERT)?.as_deref() == Some("on") })
}

/// Valide puis enregistre les réglages ; rien n'est écrit si une valeur est hors bornes.
pub fn set_settings(conn: &Connection, s: &AnalysisSettings) -> Result<AnalysisSettings> {
    if !(MIN_STALE_DAYS..=MAX_STALE_DAYS).contains(&s.stale_days) {
        return Err(CoreError::Invalid(format!("the number of days must be between {MIN_STALE_DAYS} and {MAX_STALE_DAYS}")));
    }
    let tx = conn.unchecked_transaction()?;
    write(&tx, STALE_DAYS, Some(s.stale_days.to_string()))?;
    write(&tx, NO_ANALYSIS_ALERT, Some(if s.no_analysis_alert { "on" } else { "off" }.into()))?;
    tx.commit()?;
    settings(conn)
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewQueue {
    /// Jour local "AAAA-MM-JJ".
    pub day: String,
    /// Toutes les idées à revoir ce matin : retours de report d'abord, puis « à revoir » (les plus
    /// anciennes d'abord), puis les autres (les plus anciennes d'abord).
    pub items: Vec<IdeaView>,
    /// Combien l'interface montre d'abord (les autres sont derrière « Voir les N autres »).
    pub visible: usize,
    pub hidden: usize,
}

/// Les idées à revoir ce matin, dans l'ordre de la revue.
pub fn queue(conn: &Connection, now: i64, tz: i32) -> Result<ReviewQueue> {
    let mut items: Vec<IdeaView> = ideas::list_views(conn, IdeaStatus::Active, None, now, tz)?.into_iter().filter(|v| v.in_review).collect();
    // À rang égal : la plus ancienne mise à jour d'abord, puis l'identifiant.
    items.sort_by_key(|v| (!v.returned, !v.stale, v.idea.updated_at, v.idea.id));
    let visible = items.len().min(REVIEW_VISIBLE);
    Ok(ReviewQueue { day: day_of(now, tz), hidden: items.len() - visible, visible, items })
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewBanner {
    pub day: String,
    /// Idées à revoir (les idées reportées n'y comptent pas).
    pub count: usize,
}

/// La bannière « Revue du matin : N idées à revoir » : seulement si le jour local a changé depuis la
/// dernière revue **et** qu'il y a au moins une idée à revoir. Lecture seule.
pub fn banner(conn: &Connection, now: i64, tz: i32) -> Result<Option<ReviewBanner>> {
    let day = day_of(now, tz);
    if read(conn, LAST_REVIEW_DAY)?.as_deref() == Some(day.as_str()) {
        return Ok(None);
    }
    let count = queue(conn, now, tz)?.items.len();
    Ok((count > 0).then_some(ReviewBanner { day, count }))
}

/// « Plus tard » : la bannière se tait pour aujourd'hui ; les idées restent listées dans l'onglet Idées.
pub fn dismiss_banner(conn: &Connection, now: i64, tz: i32) -> Result<()> {
    write(conn, LAST_REVIEW_DAY, Some(day_of(now, tz)))
}

/// Quand plus rien n'est à revoir, la revue d'aujourd'hui est faite.
fn settle(conn: &Connection, now: i64, tz: i32) -> Result<()> {
    if queue(conn, now, tz)?.items.is_empty() {
        dismiss_banner(conn, now, tz)?;
    }
    Ok(())
}

/// « Toujours valable » : date de dernière revue mise à jour, le report est annulé, rien n'est ajouté au fil.
pub fn keep(conn: &Connection, id: i64, now: i64, tz: i32) -> Result<IdeaView> {
    ideas::require_active(conn, id)?;
    conn.execute("UPDATE ideas SET last_reviewed_at = ?2, snoozed_until_day = NULL WHERE id = ?1", params![id, now])?;
    settle(conn, now, tz)?;
    view(conn, id, now, tz)
}

/// « Compléter » : une note datée de plus (voir [`ideas::complete`]).
pub fn complete(conn: &Connection, id: i64, body: &str, now: i64, tz: i32) -> Result<IdeaView> {
    ideas::complete(conn, id, body, now)?;
    settle(conn, now, tz)?;
    view(conn, id, now, tz)
}

/// « Clôturer ».
pub fn close(conn: &Connection, id: i64, outcome: IdeaOutcome, reason: Option<&str>, now: i64, tz: i32) -> Result<IdeaView> {
    ideas::close(conn, id, outcome, reason, now)?;
    settle(conn, now, tz)?;
    view(conn, id, now, tz)
}

/// « Supprimer » (la confirmation est demandée par l'interface).
pub fn delete(conn: &Connection, id: i64, now: i64, tz: i32) -> Result<()> {
    ideas::delete(conn, id)?;
    settle(conn, now, tz)
}

/// « Redemander dans X jours » (1 à 30) : l'idée reste active, revient à `aujourd'hui + X` (jour local du PC),
/// compte comme revue du jour, ajoute une entrée au fil et un report au compteur. Ni le statut, ni la
/// création, ni le contenu (`updated_at`) ne changent. Reporter une idée déjà reportée est permis.
pub fn snooze(conn: &Connection, id: i64, days: u32, now: i64, tz: i32) -> Result<IdeaView> {
    if !(MIN_SNOOZE_DAYS..=MAX_SNOOZE_DAYS).contains(&days) {
        return Err(CoreError::Invalid(format!("the delay must be between {MIN_SNOOZE_DAYS} and {MAX_SNOOZE_DAYS} days")));
    }
    ideas::require_active(conn, id)?;
    let until = day_key_of(day_number(now, tz) + i64::from(days));
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        "UPDATE ideas SET snoozed_until_day = ?2, snooze_count = snooze_count + 1, last_reviewed_at = ?3 WHERE id = ?1",
        params![id, until, now],
    )?;
    ideas::add_note(&tx, id, now, NoteKind::Snooze, "", Some(&until))?;
    tx.commit()?;
    settle(conn, now, tz)?;
    view(conn, id, now, tz)
}

fn view(conn: &Connection, id: i64, now: i64, tz: i32) -> Result<IdeaView> {
    let s = settings(conn)?;
    Ok(ideas::view(ideas::get(conn, id)?, &s, &day_of(now, tz), day_number(now, tz), tz))
}
