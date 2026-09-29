//! Optional password lock (lot 22, spec 3.7.13): the database and the screenshots encrypted
//! with a key derived from a password. **Off by default**: without it, the database is opened by
//! `db::open` exactly as before and nothing here runs. See CLAUDE.md « Verrouillage (lot 22) ».
//!
//! The cryptography lives in the `pulse-lock` crate (pure Rust); this module deals with the
//! files, SQLite and the order of the steps.
//!
//! - [`startup`]: before opening anything, which file is the database (and recovery after a crash).
//! - [`Store`]: the open database, plain (file) or encrypted (in memory, written back encrypted
//!   after every change); `unlock`, `enable`, `disable`, `change_password`, `flush`, `close`.
//! - Screenshots and backups follow automatically (registered keys, see `keys.rs`).

mod files;
mod keys;
mod store;
mod transition;
#[cfg(test)]
mod tests;

pub use files::{ENC_FILE, STATE_FILE};
pub use pulse_lock::{KdfParams, LockError, Password, policy::MIN_CHARS as MIN_PASSWORD_CHARS};
pub use store::Store;
pub use transition::{StartupInfo, plain_copies, startup};

pub(crate) use keys::current as current_keys;
pub(crate) use store::memory_conn as memory_conn_pub;
pub(crate) use transition::{open_encrypted_backup, with_attempts, write_encrypted_copy};

use crate::backup::{self, BackupInfo, RestoreResult};
use crate::error::Result;
use crate::settings;
use rusqlite::Connection;
use serde::Serialize;
use std::path::Path;

/// Setting (in the encrypted database): minutes without activity before Pulse locks itself.
/// Absent = never.
pub const IDLE_KEY: &str = "lock.idle_minutes";
pub const MAX_IDLE_MINUTES: u32 = 1440;

pub fn idle_minutes(conn: &Connection) -> Result<Option<u32>> {
    Ok(settings::read(conn, IDLE_KEY)?.and_then(|v| v.parse().ok()).filter(|m| (1..=MAX_IDLE_MINUTES).contains(m)))
}

pub fn set_idle_minutes(conn: &Connection, minutes: Option<u32>) -> Result<Option<u32>> {
    if minutes.is_some_and(|m| !(1..=MAX_IDLE_MINUTES).contains(&m)) {
        return Err(LockError::InvalidIdle.into());
    }
    settings::write(conn, IDLE_KEY, minutes.map(|m| m.to_string()))?;
    idle_minutes(conn)
}

/// What the interface needs to know about the lock (no secret).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LockStatus {
    /// The database is encrypted on disk.
    pub enabled: bool,
    /// Encrypted and not unlocked: nothing can be read.
    pub locked: bool,
    /// Milliseconds before the next password try is allowed (0 = now).
    pub retry_after_ms: u64,
    pub failures: u32,
    /// Only known when unlocked.
    pub idle_minutes: Option<u32>,
    /// The last write of the encrypted file failed: recent changes are only in memory.
    pub persist_failed: bool,
    /// `lock:inconsistentFiles` when both files were found at startup.
    pub warning: Option<String>,
    /// Plaintext copies in `backups/` (proposed for encryption at activation).
    pub plain_copies: Vec<String>,
    pub min_password_chars: usize,
}

pub fn status(data_dir: &Path, store: Option<&Store>, warning: Option<String>, now_ms: i64) -> Result<LockStatus> {
    let attempts = files::LockState::load(data_dir).attempts();
    let enabled = match store {
        Some(s) => s.is_encrypted(),
        None => files::enc_path(data_dir).is_file(),
    };
    Ok(LockStatus {
        enabled,
        locked: store.is_none(),
        retry_after_ms: attempts.retry_after_ms(now_ms),
        failures: attempts.failures,
        idle_minutes: match store {
            Some(s) if s.is_encrypted() => idle_minutes(s.conn())?,
            _ => None,
        },
        persist_failed: store.is_some_and(|s| s.persist_failed()),
        warning,
        plain_copies: if enabled { Vec::new() } else { plain_copies(data_dir) },
        min_password_chars: MIN_PASSWORD_CHARS,
    })
}

/// Describes a backup folder; an encrypted backup needs its own password (the one in force when
/// it was made), checked under the wrong-password counter.
pub fn inspect_backup(data_dir: &Path, folder: &Path, password: Option<&Password>, now_ms: i64) -> Result<BackupInfo> {
    if password.is_none() {
        return backup::inspect(folder);
    }
    with_attempts(data_dir, now_ms, || backup::inspect_with(folder, password))
}

impl Store {
    /// Restores a backup (plain or encrypted) into the open database, then writes the encrypted
    /// file if the lock is active. See `backup::restore_with`.
    pub fn restore_backup(&mut self, folder: &Path, confirmed: bool, password: Option<&Password>, now_ms: i64) -> Result<RestoreResult> {
        let dir = self.data_dir().to_path_buf();
        let result = if password.is_some() {
            with_attempts(&dir, now_ms, || backup::restore_with(self.conn_mut(), &dir, folder, confirmed, password, now_ms))?
        } else {
            backup::restore_with(self.conn_mut(), &dir, folder, confirmed, None, now_ms)?
        };
        self.mark_dirty();
        self.flush()?;
        Ok(result)
    }

    pub fn create_backup(&self, dest_dir: &Path, now_ms: i64) -> Result<BackupInfo> {
        backup::create(self.conn(), self.data_dir(), dest_dir, now_ms)
    }
}
