//! Activation, deactivation, password change, and the recovery at startup of one of them
//! interrupted by a crash. Every step is described in CLAUDE.md « Verrouillage (lot 22) ».
//!
//! Single rule at startup: **if `pulse.db` exists, it is authoritative** (it is only ever
//! created complete, by a rename). Otherwise `pulse.db.enc` is.

use super::files::{self, BACKUPS_DIR, LockState, Transition, fail_point};
use super::store::{self, Store, guarded, memory_conn, same_data, write_encrypted};
use crate::error::{CoreError, Result};
use crate::screenshots;
use pulse_lock::envelope::{self, FileKind};
use pulse_lock::{DataKey, KdfParams, LockError, Password, Unlocked, policy};
use rusqlite::{Connection, MAIN_DB, OpenFlags};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

/// What was found on disk before opening anything.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupInfo {
    /// `pulse.db.enc` is the database: the password is needed before anything can be read.
    pub encrypted: bool,
    /// Something to tell the user without blocking (`lock:inconsistentFiles`).
    pub warning: Option<String>,
}

/// Called once at startup, **before** opening the database: finishes or rolls back an
/// activation / deactivation interrupted by a crash, and says which file is the database. On a
/// folder where the lock was never used, it reads nothing but file names and writes nothing.
pub fn startup(data_dir: &Path) -> Result<StartupInfo> {
    let plain = files::plain_path(data_dir);
    let enc = files::enc_path(data_dir);
    let transition = LockState::load(data_dir).transition;
    // Temporary files are never authoritative (they are renamed only once complete).
    if transition.is_some() {
        files::remove_if_exists(&files::tmp_of(&plain))?;
        files::remove_if_exists(&files::tmp_of(&enc))?;
    }
    if plain.exists() {
        if enc.exists() {
            if transition.is_none() {
                // Unexplained: touch nothing, open pulse.db as before, tell the user.
                return Ok(StartupInfo { encrypted: false, warning: Some(LockError::InconsistentFiles.to_string()) });
            }
            // Activation before its switch, or deactivation after its switch.
            files::remove_if_exists(&enc)?;
        }
        LockState::set_transition(data_dir, None)?;
        return Ok(StartupInfo { encrypted: false, warning: None });
    }
    if enc.exists() {
        // The transition, if any, is finished after the password is given (screenshots).
        return Ok(StartupInfo { encrypted: true, warning: None });
    }
    LockState::set_transition(data_dir, None)?;
    Ok(StartupInfo { encrypted: false, warning: None })
}

impl Store {
    /// Encrypts the open plain database with a new password. `confirmed` = the user ticked
    /// "a lost password means lost data". `encrypt_copies` = also encrypt the plaintext copies
    /// already in `backups/`. Before the switch any failure leaves `pulse.db` untouched.
    pub fn enable(&mut self, password: &Password, confirmed: bool, encrypt_copies: bool, params: KdfParams) -> Result<()> {
        if self.is_encrypted() {
            return Err(LockError::AlreadyEncrypted.into());
        }
        if !confirmed {
            return Err(LockError::NotConfirmed.into());
        }
        policy::check_new(password)?;
        let dir = self.data_dir().to_path_buf();
        let keys = Arc::new(Unlocked::create(password, params)?);
        LockState::set_transition(&dir, Some(Transition::Enable))?;
        let enc = files::enc_path(&dir);
        let tmp = files::tmp_of(&enc);

        // (2) to (4): encrypted copy, read back through the real unlock path, compared, renamed.
        let copied = (|| -> Result<Connection> {
            fail_point("enable:start")?;
            let image = self.conn().serialize(MAIN_DB)?;
            let sealed = keys.seal(&image)?;
            drop(image);
            write_file_synced(&tmp, &sealed)?;
            fail_point("enable:written")?;
            let (mut plain, _) = envelope::open(&files::read(&tmp)?, password)?;
            let copy = memory_conn(&mut plain)?;
            same_data(self.conn(), &copy)?;
            fail_point("enable:verified")?;
            fs::rename(&tmp, &enc).map_err(LockError::from)?;
            fail_point("enable:renamed")?;
            Ok(copy)
        })();
        let copy = match copied {
            Ok(c) => c,
            Err(e) => {
                let _ = files::remove_if_exists(&tmp);
                let _ = files::remove_if_exists(&enc);
                let _ = LockState::set_transition(&dir, None);
                return Err(e);
            }
        };

        // (5) The switch: close the plain file, then delete it.
        let plain_conn = self.swap_conn(copy);
        if let Err((plain_conn, e)) = plain_conn.close() {
            let _ = self.swap_conn(plain_conn);
            let _ = files::remove_if_exists(&enc);
            let _ = LockState::set_transition(&dir, None);
            return Err(e.into());
        }
        let removed = (|| -> Result<()> {
            fail_point("enable:closed")?;
            let plain = files::plain_path(&dir);
            for suffix in ["-wal", "-shm"] {
                let mut name = plain.clone().into_os_string();
                name.push(suffix);
                files::remove_if_exists(&PathBuf::from(name))?;
            }
            files::remove_if_exists(&plain)
        })();
        if let Err(e) = removed {
            // pulse.db is still there, so it stays authoritative: go back to it.
            if files::plain_path(&dir).exists() {
                let _ = self.swap_conn(crate::db::open(&dir)?);
                let _ = files::remove_if_exists(&enc);
                let _ = LockState::set_transition(&dir, None);
                return Err(e);
            }
        }
        self.set_encrypted(keys.clone());

        // (6) and (7): screenshots, optional copies, then done. A failure here is finished at
        // the next unlock (the transition stays written).
        fail_point("enable:switched")?;
        seal_screenshots(&dir, &keys)?;
        fail_point("enable:screenshots")?;
        if encrypt_copies {
            encrypt_plain_copies(&dir, &keys)?;
        }
        LockState::set_transition(&dir, None)
    }

    /// Decrypts the database back to a plain `pulse.db` (and the screenshots). Needs the password.
    pub fn disable(&mut self, password: &Password, now_ms: i64) -> Result<()> {
        let Some(keys) = self.keys() else { return Err(LockError::NotEncrypted.into()) };
        let dir = self.data_dir().to_path_buf();
        guarded(&dir, now_ms, || Ok(keys.verify(password)?))?;
        self.flush()?;
        LockState::set_transition(&dir, Some(Transition::Disable))?;
        let plain = files::plain_path(&dir);
        let tmp = files::tmp_of(&plain);

        let copied = (|| -> Result<()> {
            fail_point("disable:start")?;
            open_screenshots(&dir, keys.data_key())?;
            fail_point("disable:screenshots")?;
            files::remove_if_exists(&tmp)?;
            self.conn().execute("VACUUM INTO ?1", [tmp.to_string_lossy().as_ref()])?;
            sync_file(&tmp)?;
            fail_point("disable:written")?;
            let copy = Connection::open_with_flags(&tmp, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
            same_data(self.conn(), &copy)?;
            drop(copy);
            fail_point("disable:verified")?;
            fs::rename(&tmp, &plain).map_err(LockError::from)?; // the switch
            Ok(())
        })();
        if let Err(e) = copied {
            let _ = files::remove_if_exists(&tmp);
            // Still encrypted: put back the screenshots already decrypted.
            let _ = seal_screenshots(&dir, &keys);
            let _ = LockState::set_transition(&dir, None);
            return Err(e);
        }
        fail_point("disable:renamed")?; // tests: a crash right after the switch
        let file_conn = match crate::db::open(&dir) {
            Ok(c) => c,
            Err(e) => {
                // Undo the switch: the encrypted file is complete and becomes authoritative again.
                let _ = fs::rename(&plain, &tmp);
                let _ = files::remove_if_exists(&tmp);
                let _ = seal_screenshots(&dir, &keys);
                let _ = LockState::set_transition(&dir, None);
                return Err(e);
            }
        };
        drop(self.set_plain(file_conn));
        fail_point("disable:switched")?;
        files::remove_if_exists(&files::enc_path(&dir))?;
        LockState::set_transition(&dir, None)
    }

    /// Same data key, new password: only the database file is written again (atomically).
    pub fn change_password(&mut self, old: &Password, new: &Password, params: KdfParams, now_ms: i64) -> Result<()> {
        let Some(keys) = self.keys() else { return Err(LockError::NotEncrypted.into()) };
        let dir = self.data_dir().to_path_buf();
        guarded(&dir, now_ms, || Ok(keys.verify(old)?))?;
        let new_keys = Arc::new(keys.rewrap(new, params)?);
        let enc = files::enc_path(&dir);
        let tmp = files::tmp_of(&enc);
        let written = (|| -> Result<()> {
            let image = self.conn().serialize(MAIN_DB)?;
            let sealed = new_keys.seal(&image)?;
            drop(image);
            write_file_synced(&tmp, &sealed)?;
            fail_point("password:written")?;
            let (mut plain, _) = envelope::open(&files::read(&tmp)?, new)?;
            same_data(self.conn(), &memory_conn(&mut plain)?)?;
            fs::rename(&tmp, &enc).map_err(LockError::from)?;
            Ok(())
        })();
        if let Err(e) = written {
            let _ = files::remove_if_exists(&tmp);
            return Err(e);
        }
        self.replace_keys(new_keys);
        Ok(())
    }

    /// Checks the password of the open encrypted database (for example before showing a
    /// sensitive setting), under the wrong-password counter.
    pub fn verify_password(&self, password: &Password, now_ms: i64) -> Result<()> {
        let Some(keys) = self.keys() else { return Err(LockError::NotEncrypted.into()) };
        guarded(self.data_dir(), now_ms, || Ok(keys.verify(password)?))
    }
}

fn write_file_synced(path: &Path, bytes: &[u8]) -> Result<()> {
    use std::io::Write;
    let mut f = fs::File::create(path).map_err(LockError::from)?;
    f.write_all(bytes).map_err(LockError::from)?;
    f.sync_all().map_err(LockError::from)?;
    Ok(())
}

fn sync_file(path: &Path) -> Result<()> {
    fs::OpenOptions::new().read(true).write(true).open(path).and_then(|f| f.sync_all()).map_err(|e| LockError::from(e).into())
}

fn screenshot_files(dir: &Path) -> Result<Vec<PathBuf>> {
    let Ok(entries) = fs::read_dir(dir.join(screenshots::DIR)) else { return Ok(Vec::new()) };
    let mut out = Vec::new();
    for e in entries {
        let path = e.map_err(LockError::from)?.path();
        let is_tmp = path.extension().is_some_and(|x| x == "tmp");
        if path.is_file() && !is_tmp {
            out.push(path);
        }
    }
    out.sort();
    Ok(out)
}

/// Encrypts, in place and one by one, every screenshot still in plaintext. Idempotent: an
/// interruption leaves a mix that stays readable (the format is detected when reading).
pub(crate) fn seal_screenshots(dir: &Path, keys: &Unlocked) -> Result<usize> {
    let mut n = 0;
    for path in screenshot_files(dir)? {
        let bytes = files::read(&path)?;
        if FileKind::of(&bytes) == FileKind::EncryptedBlob {
            continue;
        }
        files::write_atomic(&path, &envelope::seal_blob(keys.data_key(), &bytes)?)?;
        n += 1;
    }
    Ok(n)
}

/// Decrypts, in place, every encrypted screenshot (deactivation).
pub(crate) fn open_screenshots(dir: &Path, dek: &DataKey) -> Result<usize> {
    let mut n = 0;
    for path in screenshot_files(dir)? {
        let bytes = files::read(&path)?;
        if FileKind::of(&bytes) != FileKind::EncryptedBlob {
            continue;
        }
        files::write_atomic(&path, &envelope::open_blob(dek, &bytes)?)?;
        n += 1;
    }
    Ok(n)
}

/// Plaintext SQLite copies in `backups/` of the data folder (automatic copies made before a
/// migration or a restore, before the lock was enabled).
pub fn plain_copies(data_dir: &Path) -> Vec<String> {
    let Ok(entries) = fs::read_dir(data_dir.join(BACKUPS_DIR)) else { return Vec::new() };
    let mut out: Vec<String> = entries
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_file() && is_plain_sqlite(p))
        .filter_map(|p| p.file_name().map(|n| n.to_string_lossy().into_owned()))
        .collect();
    out.sort();
    out
}

fn is_plain_sqlite(path: &Path) -> bool {
    use std::io::Read;
    let mut head = [0u8; 16];
    fs::File::open(path).and_then(|mut f| f.read_exact(&mut head)).is_ok() && FileKind::of(&head) == FileKind::PlainSqlite
}

/// Encrypts each plaintext copy of `backups/` into `<name>.enc`, checks that it reads back
/// identical, then deletes the plaintext copy.
fn encrypt_plain_copies(dir: &Path, keys: &Unlocked) -> Result<usize> {
    let mut n = 0;
    for name in plain_copies(dir) {
        let path = dir.join(BACKUPS_DIR).join(&name);
        let bytes = files::read(&path)?;
        let sealed = keys.seal(&bytes)?;
        let dest = dir.join(BACKUPS_DIR).join(format!("{name}.enc"));
        files::write_atomic(&dest, &sealed)?;
        let back = envelope::open_with_key(&files::read(&dest)?, keys.data_key())?;
        if back[..] != bytes[..] {
            let _ = files::remove_if_exists(&dest);
            return Err(LockError::VerifyFailed.into());
        }
        files::remove_if_exists(&path)?;
        n += 1;
    }
    Ok(n)
}

/// For a backup folder: opens its encrypted database with its own password (the one in force
/// when the backup was made), in memory.
pub(crate) fn open_encrypted_backup(folder: &Path, password: Option<&Password>) -> Result<(Connection, Unlocked)> {
    let Some(password) = password else { return Err(LockError::BackupPasswordRequired.into()) };
    let file = files::read(&folder.join(files::ENC_FILE))?;
    let (mut image, keys) = envelope::open(&file, password)?;
    let conn = memory_conn(&mut image).map_err(|e| match e {
        CoreError::Lock(LockError::Corrupt) => CoreError::Invalid("pulse.db.enc is damaged".into()),
        other => other,
    })?;
    Ok((conn, keys))
}

/// Writes an encrypted copy of `conn` (backups, safety copies).
pub(crate) fn write_encrypted_copy(conn: &Connection, keys: &Unlocked, path: &Path) -> Result<()> {
    write_encrypted(conn, keys, path)
}

pub(crate) use store::guarded as with_attempts;
