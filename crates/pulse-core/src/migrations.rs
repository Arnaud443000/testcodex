//! Versioned schema migrations, tracked with `PRAGMA user_version`.
//!
//! Rules: never edit a migration that has shipped; add a new one at the end of
//! `MIGRATIONS`. Each migration runs in its own transaction.

use crate::error::{CoreError, Result};
use rusqlite::Connection;

pub const MIGRATIONS: &[&str] = &[
    // v1 — foundations: accounts and key/value settings.
    // The full trade schema is designed in the next work package.
    "CREATE TABLE accounts (
        id              INTEGER PRIMARY KEY,
        name            TEXT    NOT NULL CHECK (length(trim(name)) > 0),
        kind            TEXT    NOT NULL CHECK (kind IN ('personal','prop','demo')),
        broker          TEXT    NOT NULL DEFAULT '',
        currency        TEXT    NOT NULL DEFAULT 'USD',
        initial_capital REAL    NOT NULL DEFAULT 0,
        created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );",
];

pub fn latest_version() -> u32 {
    MIGRATIONS.len() as u32
}

pub fn current_version(conn: &Connection) -> Result<u32> {
    Ok(conn.query_row("PRAGMA user_version", [], |r| r.get::<_, u32>(0))?)
}

/// Returns true when at least one migration is pending.
pub fn needs_migration(conn: &Connection) -> Result<bool> {
    Ok(current_version(conn)? < latest_version())
}

pub fn migrate(conn: &mut Connection) -> Result<()> {
    let current = current_version(conn)?;
    let latest = latest_version();
    if current > latest {
        return Err(CoreError::SchemaTooNew { found: current, supported: latest });
    }
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(current as usize) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", (i + 1) as u32)?;
        tx.commit()?;
    }
    Ok(())
}
