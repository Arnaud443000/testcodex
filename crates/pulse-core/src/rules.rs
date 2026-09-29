//! Personal rules (spec 2.4, 3.6.9): short statements the trader ticks as
//! respected or not on each trade.

use crate::error::{CoreError, Result};
use crate::util::clean_text;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    pub id: i64,
    pub text: String,
    pub archived: bool,
    pub position: i64,
}

/// New rules go to the end of the list.
pub fn create(conn: &Connection, text: &str) -> Result<Rule> {
    let text = clean_text("rule", text)?;
    conn.execute(
        "INSERT INTO rules (text, position) VALUES (?1, (SELECT COALESCE(MAX(position), 0) + 1 FROM rules))",
        [text],
    )?;
    get(conn, conn.last_insert_rowid())
}

pub fn get(conn: &Connection, id: i64) -> Result<Rule> {
    conn.query_row(&format!("{SELECT} WHERE id = ?1"), [id], row)
        .optional()?
        .ok_or_else(|| CoreError::NotFound(format!("rule {id}")))
}

pub fn list(conn: &Connection, include_archived: bool) -> Result<Vec<Rule>> {
    let mut stmt = conn.prepare(&format!("{SELECT} WHERE (?1 OR archived = 0) ORDER BY position, id"))?;
    let rows = stmt.query_map([include_archived], row)?.collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn update_text(conn: &Connection, id: i64, text: &str) -> Result<Rule> {
    get(conn, id)?;
    conn.execute("UPDATE rules SET text = ?1 WHERE id = ?2", params![clean_text("rule", text)?, id])?;
    get(conn, id)
}

/// Archiving hides a rule from new trades while keeping its adherence history.
pub fn set_archived(conn: &Connection, id: i64, archived: bool) -> Result<Rule> {
    get(conn, id)?;
    conn.execute("UPDATE rules SET archived = ?1 WHERE id = ?2", params![archived, id])?;
    get(conn, id)
}

/// Deletes a rule that was never ticked on a trade; otherwise it must be archived.
pub fn delete(conn: &Connection, id: i64) -> Result<()> {
    get(conn, id)?;
    let used: bool =
        conn.query_row("SELECT EXISTS (SELECT 1 FROM trade_rule_checks WHERE rule_id = ?1)", [id], |r| r.get(0))?;
    if used {
        return Err(CoreError::Invalid("this rule has history on trades: archive it instead".into()));
    }
    conn.execute("DELETE FROM rules WHERE id = ?1", [id])?;
    Ok(())
}

const SELECT: &str = "SELECT id, text, archived, position FROM rules";

fn row(r: &rusqlite::Row) -> rusqlite::Result<Rule> {
    Ok(Rule { id: r.get(0)?, text: r.get(1)?, archived: r.get(2)?, position: r.get(3)? })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    #[test]
    fn creates_in_order_edits_and_archives() {
        let conn = db::open_in_memory().unwrap();
        let a = create(&conn, "Max 3 trades per day").unwrap();
        let b = create(&conn, " No trading   after 3 pm ").unwrap();
        assert_eq!(b.text, "No trading after 3 pm");
        assert!(b.position > a.position);
        assert!(create(&conn, "  ").is_err());
        assert_eq!(update_text(&conn, a.id, "Max 2 trades per day").unwrap().text, "Max 2 trades per day");
        set_archived(&conn, a.id, true).unwrap();
        assert_eq!(list(&conn, false).unwrap(), vec![get(&conn, b.id).unwrap()]);
        assert_eq!(list(&conn, true).unwrap().len(), 2);
        delete(&conn, b.id).unwrap();
        assert!(matches!(get(&conn, b.id), Err(CoreError::NotFound(_))));
    }
}
