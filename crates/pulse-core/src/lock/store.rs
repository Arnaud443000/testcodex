//! The open database: plain (the usual `pulse.db` file, opened by `db::open` exactly as before)
//! or encrypted (an in-memory SQLite database loaded from `pulse.db.enc`, written back, encrypted,
//! after every change).

use super::files::{self, BACKUPS_DIR, LockState};
use super::keys;
use crate::db;
use crate::error::{CoreError, Result};
use crate::migrations;
use pulse_lock::{LockError, Password, Unlocked, Zeroizing, envelope};
use rusqlite::{Connection, MAIN_DB};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

pub(crate) struct Crypt {
    pub(crate) keys: Arc<Unlocked>,
    /// `total_changes` of the connection when the file was last written.
    persisted: u64,
    /// Changes that `total_changes` does not see (migrations, restore through the backup API).
    dirty: bool,
    /// The last write failed: the data is only in memory.
    failed: bool,
}

pub struct Store {
    conn: Connection,
    data_dir: PathBuf,
    crypt: Option<Crypt>,
}

impl Drop for Store {
    fn drop(&mut self) {
        if self.crypt.is_some() {
            keys::unregister(&self.data_dir);
        }
    }
}

impl Store {
    /// The plain database, opened exactly as without the lock (`db::open`).
    pub fn open_plain(data_dir: &Path) -> Result<Store> {
        Ok(Store { conn: db::open(data_dir)?, data_dir: data_dir.to_path_buf(), crypt: None })
    }

    /// Opens the encrypted database with the password. Wrong passwords are counted and slowed
    /// down (see `pulse_lock::attempts`); nothing is ever deleted. Pending migrations run in
    /// memory after an encrypted copy of the file is kept in `backups/`.
    pub fn unlock(data_dir: &Path, password: &Password, now_ms: i64) -> Result<Store> {
        let enc = files::enc_path(data_dir);
        if !enc.is_file() {
            return Err(LockError::NotEncrypted.into());
        }
        let file = files::read(&enc)?;
        let (mut image, keys) = guarded(data_dir, now_ms, || Ok(envelope::open(&file, password)?))?;
        let conn = memory_conn(&mut image)?;
        drop(image);
        let mut store = Store { conn, data_dir: data_dir.to_path_buf(), crypt: None };
        store.set_encrypted(Arc::new(keys));

        if migrations::current_version(&store.conn)? > migrations::latest_version() {
            migrations::migrate(&mut store.conn)?; // returns SchemaTooNew
        }
        if migrations::needs_migration(&store.conn)? {
            // Automatic copy before migration: the encrypted file itself, byte for byte.
            let version = migrations::current_version(&store.conn)?;
            let dir = data_dir.join(BACKUPS_DIR);
            fs::create_dir_all(&dir).map_err(LockError::from)?;
            let dest = dir.join(format!("pulse-pre-migration-v{version}.db.enc"));
            if !dest.exists() {
                files::write_atomic(&dest, &file)?;
            }
            migrations::migrate(&mut store.conn)?;
            store.mark_dirty();
        }
        // An activation or deactivation interrupted after the switch: finish it.
        if LockState::load(data_dir).transition.is_some() {
            let keys = store.keys().expect("encrypted");
            super::transition::seal_screenshots(data_dir, &keys)?;
            LockState::set_transition(data_dir, None)?;
        }
        store.flush()?;
        Ok(store)
    }

    pub fn conn(&self) -> &Connection {
        &self.conn
    }

    pub fn conn_mut(&mut self) -> &mut Connection {
        &mut self.conn
    }

    pub fn data_dir(&self) -> &Path {
        &self.data_dir
    }

    pub fn is_encrypted(&self) -> bool {
        self.crypt.is_some()
    }

    /// The last write of the encrypted file failed: recent changes are only in memory.
    pub fn persist_failed(&self) -> bool {
        self.crypt.as_ref().is_some_and(|c| c.failed)
    }

    pub(crate) fn keys(&self) -> Option<Arc<Unlocked>> {
        self.crypt.as_ref().map(|c| c.keys.clone())
    }

    /// Forces the next [`flush`](Self::flush) to write (for changes SQLite does not count).
    pub fn mark_dirty(&mut self) {
        if let Some(c) = &mut self.crypt {
            c.dirty = true;
        }
    }

    /// Encrypted database: writes the file if anything changed since the last write. Plain
    /// database: nothing to do (SQLite writes the file itself). On failure the data stays in
    /// memory, [`persist_failed`](Self::persist_failed) becomes true and the next call retries.
    pub fn flush(&mut self) -> Result<()> {
        let Some(c) = &mut self.crypt else { return Ok(()) };
        let changes = self.conn.total_changes();
        if !c.dirty && !c.failed && changes == c.persisted {
            return Ok(());
        }
        let written = files::fail_point("flush").and_then(|_| write_encrypted(&self.conn, &c.keys, &files::enc_path(&self.data_dir)));
        match written {
            Ok(()) => {
                c.persisted = changes;
                c.dirty = false;
                c.failed = false;
                Ok(())
            }
            Err(_) => {
                c.failed = true;
                Err(LockError::PersistFailed.into())
            }
        }
    }

    /// Writes what is pending, then closes the database and forgets the keys (lock). If the
    /// write fails the store is handed back untouched: locking must never lose data.
    pub fn close(mut self) -> std::result::Result<(), Box<(Store, CoreError)>> {
        if let Err(e) = self.flush() {
            return Err(Box::new((self, e)));
        }
        Ok(())
    }

    pub(crate) fn set_encrypted(&mut self, keys: Arc<Unlocked>) {
        keys::register(&self.data_dir, keys.clone());
        self.crypt = Some(Crypt { keys, persisted: self.conn.total_changes(), dirty: false, failed: false });
    }

    /// New keys for the same data (password change): the file must be written with them.
    pub(crate) fn replace_keys(&mut self, keys: Arc<Unlocked>) {
        keys::register(&self.data_dir, keys.clone());
        if let Some(c) = &mut self.crypt {
            c.keys = keys;
        }
    }

    pub(crate) fn set_plain(&mut self, conn: Connection) -> Connection {
        keys::unregister(&self.data_dir);
        self.crypt = None;
        std::mem::replace(&mut self.conn, conn)
    }

    pub(crate) fn swap_conn(&mut self, conn: Connection) -> Connection {
        std::mem::replace(&mut self.conn, conn)
    }
}

/// Runs a password check under the wrong-password counter: refused while a delay is running,
/// failure counted on a wrong password, counter reset on success.
pub(crate) fn guarded<T>(data_dir: &Path, now_ms: i64, f: impl FnOnce() -> Result<T>) -> Result<T> {
    let mut state = LockState::load(data_dir);
    let mut attempts = state.attempts();
    let wait = attempts.retry_after_ms(now_ms);
    if wait > 0 {
        return Err(LockError::RetryLater(wait).into());
    }
    match f() {
        Err(CoreError::Lock(LockError::WrongPassword)) => {
            attempts.record_failure(now_ms);
            state.set_attempts(attempts);
            state.save(data_dir)?;
            Err(LockError::WrongPassword.into())
        }
        Ok(v) => {
            if attempts.failures > 0 {
                attempts.reset();
                state.set_attempts(attempts);
                state.save(data_dir)?;
            }
            Ok(v)
        }
        Err(e) => Err(e),
    }
}

/// Encrypts the current image of `conn` and writes it atomically to `path`.
pub(crate) fn write_encrypted(conn: &Connection, keys: &Unlocked, path: &Path) -> Result<()> {
    let image = conn.serialize(MAIN_DB)?;
    let sealed = keys.seal(&image)?;
    drop(image);
    files::write_atomic(path, &sealed)
}

/// An in-memory database loaded from a decrypted SQLite image (never written to disk).
pub(crate) fn memory_conn(image: &mut Zeroizing<Vec<u8>>) -> Result<Connection> {
    let mut conn = Connection::open_in_memory()?;
    if !image.is_empty() {
        if image.len() < 100 || !image.starts_with(envelope::SQLITE_MAGIC) {
            return Err(LockError::Corrupt.into());
        }
        // An image of a WAL database cannot be used in memory (no WAL there): mark it as a
        // rollback-journal database (header bytes 18 and 19), which changes nothing to the data.
        for at in [18, 19] {
            if image[at] == 2 {
                image[at] = 1;
            }
        }
        let len = image.len();
        conn.deserialize_read_exact(MAIN_DB, &image[..], len, false).map_err(|_| LockError::Corrupt)?;
    }
    conn.pragma_update(None, "foreign_keys", "ON")?;
    // Temporary tables and sorts stay in memory: no plaintext temporary file.
    conn.pragma_update(None, "temp_store", "MEMORY")?;
    let check: String = conn.query_row("PRAGMA quick_check", [], |r| r.get(0)).map_err(|_| LockError::Corrupt)?;
    if check != "ok" {
        return Err(LockError::Corrupt.into());
    }
    Ok(conn)
}

/// What must be identical between a database and its copy: schema version and the number of
/// rows of every table.
pub(crate) fn fingerprint(conn: &Connection) -> Result<(u32, Vec<(String, i64)>)> {
    let version = migrations::current_version(conn)?;
    let tables: Vec<String> = conn
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")?
        .query_map([], |r| r.get(0))?
        .collect::<rusqlite::Result<_>>()?;
    let mut counts = Vec::with_capacity(tables.len());
    for t in tables {
        let n: i64 = conn.query_row(&format!("SELECT COUNT(*) FROM \"{}\"", t.replace('"', "\"\"")), [], |r| r.get(0))?;
        counts.push((t, n));
    }
    Ok((version, counts))
}

/// Full integrity check of a copy, then the same fingerprint as the original.
pub(crate) fn same_data(original: &Connection, copy: &Connection) -> Result<()> {
    let check: String = copy.query_row("PRAGMA integrity_check", [], |r| r.get(0)).map_err(|_| LockError::VerifyFailed)?;
    if check != "ok" || fingerprint(original)? != fingerprint(copy)? {
        return Err(LockError::VerifyFailed.into());
    }
    Ok(())
}
