//! Keys of the unlocked data folders.
//!
//! While an encrypted database is open, its keys are registered here for its data folder, so
//! that code which only knows the folder (screenshots, including the AI analysis of lot 20, and
//! backups) encrypts and decrypts with them. Invariant: **a folder is encrypted if and only if a
//! key is registered for it**; a plain database never registers anything, so the unlocked path
//! is unchanged. The keys are removed when the database is locked or closed (and wiped when the
//! last reference is dropped).

use pulse_lock::Unlocked;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

static KEYS: Mutex<Vec<(PathBuf, Arc<Unlocked>)>> = Mutex::new(Vec::new());

fn with<T>(f: impl FnOnce(&mut Vec<(PathBuf, Arc<Unlocked>)>) -> T) -> T {
    let mut guard = KEYS.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    f(&mut guard)
}

pub(crate) fn register(dir: &Path, keys: Arc<Unlocked>) {
    with(|all| {
        all.retain(|(d, _)| d != dir);
        all.push((dir.to_path_buf(), keys));
    });
}

pub(crate) fn unregister(dir: &Path) {
    with(|all| all.retain(|(d, _)| d != dir));
}

/// Keys of `dir` when its database is encrypted and unlocked.
pub(crate) fn current(dir: &Path) -> Option<Arc<Unlocked>> {
    with(|all| all.iter().find(|(d, _)| d == dir).map(|(_, k)| k.clone()))
}
