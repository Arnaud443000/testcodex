//! « Ma liste » d'émotions (lot 30) : les tags `emotion` non archivés, proposés par défaut dans le
//! formulaire de trade. Un catalogue de suggestions en code permet de les ajouter en un clic.
//!
//! Règle centrale : **retirer = archiver**. Un trade ancien garde son émotion et les statistiques par
//! émotion (lot 8) ne changent pas ; seule une émotion jamais utilisée peut être supprimée pour de bon.

use crate::error::{CoreError, Result};
use crate::tags::{self, Tag, TagKind};
use crate::util::clean_text;
use rusqlite::{Connection, params};
use serde::Serialize;

/// Longueur maximale du nom d'une émotion, en caractères.
pub const MAX_NAME_CHARS: usize = 40;

const CATALOG_SOURCE: &str = include_str!("../catalog/emotions.txt");

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogGroup {
    pub key: String,
    pub label: String,
    pub emotions: Vec<String>,
}

/// Émotion de la liste avec son nombre d'utilisations (trades distincts, tous moments confondus).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmotionUsage {
    pub tag_id: i64,
    pub trade_count: i64,
}

/// Catalogue de suggestions, par famille (`@clé | libellé`, puis une émotion par ligne).
pub fn catalog() -> Vec<CatalogGroup> {
    let mut groups: Vec<CatalogGroup> = Vec::new();
    for line in CATALOG_SOURCE.lines().map(str::trim).filter(|l| !l.is_empty() && !l.starts_with('#')) {
        if let Some(head) = line.strip_prefix('@') {
            let (key, label) = head.split_once('|').unwrap_or((head, head));
            groups.push(CatalogGroup { key: key.trim().into(), label: label.trim().into(), emotions: Vec::new() });
        } else if let Some(g) = groups.last_mut() {
            g.emotions.push(line.into());
        }
    }
    groups
}

fn check_name(name: &str) -> Result<String> {
    let name = clean_text("emotion name", name)?;
    if name.chars().count() > MAX_NAME_CHARS {
        return Err(CoreError::Invalid(format!("emotion name is limited to {MAX_NAME_CHARS} characters")));
    }
    Ok(name)
}

fn emotion(conn: &Connection, id: i64) -> Result<Tag> {
    let tag = tags::get(conn, id)?;
    if tag.kind != TagKind::Emotion {
        return Err(CoreError::Invalid(format!("tag {} is not an emotion", tag.name)));
    }
    Ok(tag)
}

/// Ajoute une émotion à Ma liste : crée le tag, ou le réactive s'il était archivé. Jamais de doublon
/// (casse et espaces ignorés) ; une émotion déjà dans la liste est renvoyée telle quelle.
pub fn add_to_list(conn: &Connection, name: &str) -> Result<Tag> {
    tags::get_or_create(conn, TagKind::Emotion, &check_name(name)?)
}

/// Retire une émotion de Ma liste : **archivage**, jamais une suppression. Les trades existants et les
/// statistiques par émotion sont inchangés.
pub fn remove_from_list(conn: &Connection, id: i64) -> Result<Tag> {
    emotion(conn, id)?;
    tags::set_archived(conn, id, true)
}

/// Nombre de trades portant chaque émotion (toutes émotions, archivées comprises ; celles jamais
/// utilisées valent 0).
pub fn usage(conn: &Connection) -> Result<Vec<EmotionUsage>> {
    let mut stmt = conn.prepare(
        "SELECT t.id, COUNT(DISTINCT te.trade_id) FROM tags t
         LEFT JOIN trade_emotions te ON te.tag_id = t.id
         WHERE t.kind = 'emotion' GROUP BY t.id ORDER BY t.id",
    )?;
    let rows = stmt
        .query_map([], |r| Ok(EmotionUsage { tag_id: r.get(0)?, trade_count: r.get(1)? }))?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Supprime définitivement une émotion **jamais utilisée** ; sinon refuse (il faut la retirer).
pub fn delete_unused(conn: &Connection, id: i64) -> Result<()> {
    let tag = emotion(conn, id)?;
    let used: i64 = conn.query_row("SELECT COUNT(*) FROM trade_emotions WHERE tag_id = ?1", params![id], |r| r.get(0))?;
    if used > 0 {
        return Err(CoreError::Invalid(format!(
            "emotion {} is used on {used} trade emotion(s): remove it from the list instead of deleting it",
            tag.name
        )));
    }
    conn.execute("DELETE FROM tags WHERE id = ?1", params![id])?;
    Ok(())
}

#[cfg(test)]
mod tests;
