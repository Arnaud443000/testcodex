//! Files of the lock in the data folder: names, atomic writes, the small state file, and (tests
//! only) simulated failures between two steps.

use crate::db::DB_FILE;
use crate::error::Result;
use pulse_lock::LockError;
use pulse_lock::attempts::Attempts;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

/// The encrypted database (replaces `pulse.db` while the lock is active).
pub const ENC_FILE: &str = "pulse.db.enc";
/// Plaintext state of the lock: wrong-password counter and the step of an activation or
/// deactivation in progress. No secret, no trading data.
pub const STATE_FILE: &str = "pulse-lock.json";
pub(crate) const BACKUPS_DIR: &str = "backups";

pub(crate) fn plain_path(dir: &Path) -> PathBuf {
    dir.join(DB_FILE)
}

pub(crate) fn enc_path(dir: &Path) -> PathBuf {
    dir.join(ENC_FILE)
}

/// `name` → `name.tmp`, next to it (same volume, so the final rename is atomic).
pub(crate) fn tmp_of(path: &Path) -> PathBuf {
    let mut name = path.file_name().expect("file path").to_os_string();
    name.push(".tmp");
    path.with_file_name(name)
}

/// Writes `bytes` to `path.tmp`, flushes it to disk, then renames it over `path`: a crash leaves
/// either the old file or the new one, never a half-written one.
pub(crate) fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = tmp_of(path);
    let written = (|| -> std::io::Result<()> {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        drop(f);
        // On Windows, `rename` replaces an existing file (MoveFileExW with REPLACE_EXISTING).
        fs::rename(&tmp, path)?;
        sync_dir(path);
        Ok(())
    })();
    if let Err(e) = written {
        let _ = fs::remove_file(&tmp);
        return Err(LockError::from(e).into());
    }
    Ok(())
}

/// Makes the rename durable where the platform allows it (not possible on Windows, where the
/// file system journals renames itself).
fn sync_dir(path: &Path) {
    #[cfg(unix)]
    if let Some(d) = path.parent().and_then(|dir| fs::File::open(dir).ok()) {
        let _ = d.sync_all();
    }
    #[cfg(not(unix))]
    let _ = path;
}

pub(crate) fn remove_if_exists(path: &Path) -> Result<()> {
    match fs::remove_file(path) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(LockError::from(e).into()),
        _ => Ok(()),
    }
}

pub(crate) fn read(path: &Path) -> Result<Vec<u8>> {
    fs::read(path).map_err(|e| LockError::from(e).into())
}

/// An activation or deactivation that started and has not finished yet.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Transition {
    Enable,
    Disable,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct LockState {
    pub failures: u32,
    pub last_failure_ms: i64,
    pub transition: Option<Transition>,
}

impl LockState {
    /// A missing or unreadable file counts as "no failure, nothing in progress": it must never
    /// stop the user from opening their data.
    pub(crate) fn load(dir: &Path) -> LockState {
        fs::read(dir.join(STATE_FILE)).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
    }

    pub(crate) fn save(&self, dir: &Path) -> Result<()> {
        let json = serde_json::to_vec_pretty(self).expect("plain struct");
        write_atomic(&dir.join(STATE_FILE), &json)
    }

    pub(crate) fn attempts(&self) -> Attempts {
        Attempts { failures: self.failures, last_failure_ms: self.last_failure_ms }
    }

    pub(crate) fn set_attempts(&mut self, a: Attempts) {
        self.failures = a.failures;
        self.last_failure_ms = a.last_failure_ms;
    }

    pub(crate) fn set_transition(dir: &Path, t: Option<Transition>) -> Result<()> {
        let mut s = LockState::load(dir);
        if s.transition == t {
            // Nothing to change (and no file is created just to say "nothing in progress").
            return Ok(());
        }
        s.transition = t;
        s.save(dir)
    }
}

#[cfg(test)]
thread_local! {
    /// Name of the step at which the next [`fail_point`] of this thread fails (tests only).
    pub(crate) static FAIL_AT: std::cell::RefCell<Option<&'static str>> = const { std::cell::RefCell::new(None) };
}

/// A named step between two operations. In tests, it can be made to fail to prove that an
/// interruption at that exact point leaves usable data. Does nothing in the application.
pub(crate) fn fail_point(_name: &'static str) -> Result<()> {
    #[cfg(test)]
    {
        let hit = FAIL_AT.with(|f| {
            let mut f = f.borrow_mut();
            if *f == Some(_name) {
                *f = None;
                true
            } else {
                false
            }
        });
        if hit {
            return Err(LockError::Io("Simulated".into()).into());
        }
    }
    Ok(())
}
