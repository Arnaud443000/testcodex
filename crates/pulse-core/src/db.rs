use crate::error::Result;
use crate::migrations;
use rusqlite::Connection;
use std::path::{Path, PathBuf};

pub const DB_FILE: &str = "pulse.db";

/// Opens (or creates) the database in `data_dir`, backing it up first when a
/// migration is pending, then applies migrations.
pub fn open(data_dir: &Path) -> Result<Connection> {
    std::fs::create_dir_all(data_dir)?;
    let path = data_dir.join(DB_FILE);
    let existed = path.exists();
    let mut conn = Connection::open(&path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;

    if existed && migrations::needs_migration(&conn)? {
        backup_before_migration(&mut conn, data_dir)?;
    }
    migrations::migrate(&mut conn)?;
    Ok(conn)
}

/// In-memory database for tests.
pub fn open_in_memory() -> Result<Connection> {
    let mut conn = Connection::open_in_memory()?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    migrations::migrate(&mut conn)?;
    Ok(conn)
}

fn backup_before_migration(conn: &mut Connection, data_dir: &Path) -> Result<PathBuf> {
    let version = migrations::current_version(conn)?;
    let dir = data_dir.join("backups");
    std::fs::create_dir_all(&dir)?;
    let dest = dir.join(format!("pulse-pre-migration-v{version}.db"));
    // VACUUM INTO produces a consistent copy even with WAL enabled.
    conn.execute("VACUUM INTO ?1", [dest.to_string_lossy().as_ref()])?;
    Ok(dest)
}
