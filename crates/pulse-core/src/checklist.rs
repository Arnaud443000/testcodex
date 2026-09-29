//! Pre-trade checklist template (spec 2.5, 3.2.7). Each trade stores its own
//! filled copy (see `trades::ChecklistAnswer`), so editing the template never
//! rewrites past trades.

use crate::error::{CoreError, Result};
use crate::util::clean_text;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChecklistItem {
    pub id: i64,
    pub label: String,
    pub archived: bool,
    pub position: i64,
}

pub fn create(conn: &Connection, label: &str) -> Result<ChecklistItem> {
    let label = clean_text("checklist item", label)?;
    conn.execute(
        "INSERT INTO checklist_items (label, position)
         VALUES (?1, (SELECT COALESCE(MAX(position), 0) + 1 FROM checklist_items))",
        [label],
    )?;
    get(conn, conn.last_insert_rowid())
}

pub fn get(conn: &Connection, id: i64) -> Result<ChecklistItem> {
    conn.query_row(&format!("{SELECT} WHERE id = ?1"), [id], row)
        .optional()?
        .ok_or_else(|| CoreError::NotFound(format!("checklist item {id}")))
}

/// The current template, in display order.
pub fn list(conn: &Connection, include_archived: bool) -> Result<Vec<ChecklistItem>> {
    let mut stmt = conn.prepare(&format!("{SELECT} WHERE (?1 OR archived = 0) ORDER BY position, id"))?;
    let rows = stmt.query_map([include_archived], row)?.collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn rename(conn: &Connection, id: i64, label: &str) -> Result<ChecklistItem> {
    get(conn, id)?;
    conn.execute(
        "UPDATE checklist_items SET label = ?1 WHERE id = ?2",
        params![clean_text("checklist item", label)?, id],
    )?;
    get(conn, id)
}

pub fn set_archived(conn: &Connection, id: i64, archived: bool) -> Result<ChecklistItem> {
    get(conn, id)?;
    conn.execute("UPDATE checklist_items SET archived = ?1 WHERE id = ?2", params![archived, id])?;
    get(conn, id)
}

/// Removes an item from the template; trades keep their copy of it.
pub fn delete(conn: &Connection, id: i64) -> Result<()> {
    get(conn, id)?;
    conn.execute("DELETE FROM checklist_items WHERE id = ?1", [id])?;
    Ok(())
}

const SELECT: &str = "SELECT id, label, archived, position FROM checklist_items";

fn row(r: &rusqlite::Row) -> rusqlite::Result<ChecklistItem> {
    Ok(ChecklistItem { id: r.get(0)?, label: r.get(1)?, archived: r.get(2)?, position: r.get(3)? })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[test]
    fn template_crud() {
        let conn = db::open_in_memory().unwrap();
        let a = create(&conn, "Setup validated").unwrap();
        let b = create(&conn, "Stop defined").unwrap();
        assert_eq!(list(&conn, false).unwrap().iter().map(|i| i.id).collect::<Vec<_>>(), [a.id, b.id]);
        assert_eq!(rename(&conn, a.id, "Setup validated on H1").unwrap().label, "Setup validated on H1");
        set_archived(&conn, a.id, true).unwrap();
        assert_eq!(list(&conn, false).unwrap().len(), 1);
        delete(&conn, b.id).unwrap();
        assert_eq!(list(&conn, true).unwrap().len(), 1);
        assert!(create(&conn, "").is_err());
    }
}
