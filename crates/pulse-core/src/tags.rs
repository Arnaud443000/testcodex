//! Normalized, reusable tags (spec 3.1.5): created once, then picked from a list,
//! so a setup typed twice with different spelling never splits the statistics.

use crate::error::{CoreError, Result};
use crate::util::{clean_text, name_key, text_enum};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

text_enum!(TagKind {
    Setup => "setup",
    Timeframe => "timeframe",
    Session => "session",
    MarketCondition => "market_condition",
    Emotion => "emotion",
    Mistake => "mistake",
});

impl TagKind {
    /// A trade carries at most one tag of these kinds (one setup, one timeframe…);
    /// mistakes and emotions can be several.
    pub fn single_per_trade(self) -> bool {
        matches!(self, TagKind::Setup | TagKind::Timeframe | TagKind::Session | TagKind::MarketCondition)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tag {
    pub id: i64,
    pub kind: TagKind,
    pub name: String,
    pub archived: bool,
}

/// Creates a tag; refuses a name that already exists for this kind (case and spacing ignored).
pub fn create(conn: &Connection, kind: TagKind, name: &str) -> Result<Tag> {
    let name = clean_text("tag name", name)?;
    if let Some(existing) = find(conn, kind, &name)? {
        return Err(CoreError::Invalid(format!("tag {} already exists", existing.name)));
    }
    conn.execute(
        "INSERT INTO tags (kind, name, name_key) VALUES (?1,?2,?3)",
        params![kind, name, name_key(&name)],
    )?;
    get(conn, conn.last_insert_rowid())
}

/// Returns the existing tag with this name (un-archiving it) or creates it. Used by imports.
pub fn get_or_create(conn: &Connection, kind: TagKind, name: &str) -> Result<Tag> {
    match find(conn, kind, name)? {
        Some(t) if t.archived => set_archived(conn, t.id, false),
        Some(t) => Ok(t),
        None => create(conn, kind, name),
    }
}

pub fn find(conn: &Connection, kind: TagKind, name: &str) -> Result<Option<Tag>> {
    Ok(conn
        .query_row(&format!("{SELECT} WHERE kind = ?1 AND name_key = ?2"), params![kind, name_key(name)], row)
        .optional()?)
}

pub fn get(conn: &Connection, id: i64) -> Result<Tag> {
    conn.query_row(&format!("{SELECT} WHERE id = ?1"), [id], row)
        .optional()?
        .ok_or_else(|| CoreError::NotFound(format!("tag {id}")))
}

/// Tags of one kind (or all kinds), alphabetical; archived tags only on request.
pub fn list(conn: &Connection, kind: Option<TagKind>, include_archived: bool) -> Result<Vec<Tag>> {
    let mut stmt = conn.prepare(&format!(
        "{SELECT} WHERE (?1 IS NULL OR kind = ?1) AND (?2 OR archived = 0) ORDER BY kind, name_key"
    ))?;
    let rows = stmt
        .query_map(params![kind, include_archived], row)?
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Renaming keeps every trade linked to the tag.
pub fn rename(conn: &Connection, id: i64, name: &str) -> Result<Tag> {
    let tag = get(conn, id)?;
    let name = clean_text("tag name", name)?;
    if let Some(other) = find(conn, tag.kind, &name)?
        && other.id != id
    {
        return Err(CoreError::Invalid(format!("tag {} already exists", other.name)));
    }
    conn.execute("UPDATE tags SET name = ?1, name_key = ?2 WHERE id = ?3", params![name, name_key(&name), id])?;
    get(conn, id)
}

/// Archived tags disappear from suggestions but stay on past trades and in statistics.
pub fn set_archived(conn: &Connection, id: i64, archived: bool) -> Result<Tag> {
    get(conn, id)?;
    conn.execute("UPDATE tags SET archived = ?1 WHERE id = ?2", params![archived, id])?;
    get(conn, id)
}

const SELECT: &str = "SELECT id, kind, name, archived FROM tags";

fn row(r: &rusqlite::Row) -> rusqlite::Result<Tag> {
    Ok(Tag { id: r.get(0)?, kind: r.get(1)?, name: r.get(2)?, archived: r.get(3)? })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[test]
    fn starter_tags_are_seeded() {
        let conn = db::open_in_memory().unwrap();
        let sessions: Vec<_> = list(&conn, Some(TagKind::Session), false).unwrap().into_iter().map(|t| t.name).collect();
        assert_eq!(sessions, ["Asia", "London", "New York"]);
        assert!(list(&conn, Some(TagKind::Setup), false).unwrap().is_empty());
        assert!(!list(&conn, Some(TagKind::Emotion), false).unwrap().is_empty());
    }

    #[test]
    fn duplicate_names_are_detected_regardless_of_case_and_spacing() {
        let conn = db::open_in_memory().unwrap();
        let t = create(&conn, TagKind::Setup, "Breakout NY").unwrap();
        assert!(create(&conn, TagKind::Setup, "  breakout   ny ").is_err());
        assert_eq!(get_or_create(&conn, TagKind::Setup, "BREAKOUT NY").unwrap().id, t.id);
        // Same name under another kind is a different tag.
        assert_ne!(create(&conn, TagKind::Mistake, "Breakout NY").unwrap().id, t.id);
    }

    #[test]
    fn rename_and_archive() {
        let conn = db::open_in_memory().unwrap();
        let a = create(&conn, TagKind::Setup, "Breakout").unwrap();
        let b = create(&conn, TagKind::Setup, "Pullback").unwrap();
        assert!(rename(&conn, b.id, "breakout").is_err());
        assert_eq!(rename(&conn, a.id, "Breakout NY").unwrap().name, "Breakout NY");
        assert_eq!(rename(&conn, a.id, "breakout ny").unwrap().name, "breakout ny");
        set_archived(&conn, a.id, true).unwrap();
        assert_eq!(list(&conn, Some(TagKind::Setup), false).unwrap().len(), 1);
        assert_eq!(list(&conn, Some(TagKind::Setup), true).unwrap().len(), 2);
        assert!(!get_or_create(&conn, TagKind::Setup, "Breakout NY").unwrap().archived);
    }

    #[test]
    fn the_kind_of_a_tag_cannot_change_in_the_database() {
        let conn = db::open_in_memory().unwrap();
        let t = create(&conn, TagKind::Setup, "Breakout").unwrap();
        assert!(conn.execute("UPDATE tags SET kind = 'emotion' WHERE id = ?1", [t.id]).is_err());
    }
}
