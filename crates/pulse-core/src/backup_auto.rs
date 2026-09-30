//! Scheduled automatic backup (lot 32). See CLAUDE.md « Sauvegarde automatique (lot 32) ».
//!
//! Pulse is 100 % local: a broken PC loses the whole history. Once enabled, a backup is written
//! regularly into a folder chosen by the user (another drive, or a folder synchronised by
//! OneDrive / Google Drive). **There is no second backup engine**: every copy is made by the three
//! steps of `backup` (database copy, screenshots, read-back), so an automatic backup is exactly a
//! manual one (encrypted when the lock of lot 22 is active) under another name.
//!
//! What this module adds, all testable without the shell:
//! - the settings (`backup.auto.*` in the `settings` table, absent = disabled);
//! - the decision « is a backup due now? » ([`is_due`], pure);
//! - the timestamped name `pulse-auto-AAAAMMJJ-HHMM` (local time);
//! - the atomic write: `.pulse-auto-tmp-<id>` in the destination, read back, **then** renamed;
//!   on any failure the temporary folder is removed and nothing incomplete stays;
//! - the retention of the N most recent automatic backups, which only ever deletes folders whose
//!   name follows the pattern exactly **and** that read back as Pulse backups;
//! - the checks of the destination folder and translatable error codes (`backup:<code>`).
//!
//! The shell only reads the clock, holds the database for the database copy (phase 3 below), and
//! emits an event. The phases, in order:
//! 1. [`plan`] (database held): settings, decision, attempt recorded.
//! 2. [`Plan::stage`] (database free): destination checked, temporary folder created.
//! 3. [`Staged::copy_database`] (database held): `VACUUM INTO` or encrypted image, list of the
//!    screenshots taken at that instant (a screenshot is written while the database is held,
//!    so none of the listed files is half-written; screenshots are never modified afterwards).
//! 4. [`Copied::finish`] (database free): screenshots copied, read back, renamed, old ones pruned.
//! 5. [`record`] (database held): result written in the settings.

use crate::backup::{self, BackupInfo};
use crate::db::DB_FILE;
use crate::error::{CoreError, Result};
use crate::lock::{self, ENC_FILE, LockError};
use crate::screenshots;
use crate::settings;
use crate::stats::time;
use pulse_lock::Unlocked;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

#[cfg(test)]
mod tests;

// --- Settings keys (table `settings`, no migration) ---

pub const ENABLED_KEY: &str = "backup.auto.enabled";
pub const FOLDER_KEY: &str = "backup.auto.folder";
pub const FREQUENCY_KEY: &str = "backup.auto.frequency";
pub const KEEP_KEY: &str = "backup.auto.keep";
pub const LAST_SUCCESS_KEY: &str = "backup.auto.last_success_at";
pub const LAST_ATTEMPT_KEY: &str = "backup.auto.last_attempt_at";
pub const LAST_ERROR_KEY: &str = "backup.auto.last_error";
pub const INVITED_KEY: &str = "backup.auto.invited";

pub const DEFAULT_KEEP: u32 = 10;
pub const MAX_KEEP: u32 = 60;

const MINUTE: i64 = 60_000;
const HOUR: i64 = 60 * MINUTE;
const DAY: i64 = 24 * HOUR;
/// The shell checks this often while the application is open (and once at startup).
pub const CHECK_INTERVAL_MS: i64 = 30 * MINUTE;
/// Never two automatic attempts less than this apart.
pub const MIN_GAP_MS: i64 = 10 * MINUTE;
/// After a failure, the next automatic attempt waits at least this long (no tight loop).
pub const RETRY_AFTER_FAILURE_MS: i64 = 30 * MINUTE;
/// Daily: another local day **and** at least this long since the last success.
pub const DAILY_MIN_MS: i64 = 12 * HOUR;
pub const WEEKLY_MS: i64 = 7 * DAY;
/// « Plus tard » on the invitation hides it this long.
pub const INVITE_SNOOZE_MS: i64 = 14 * DAY;
/// A temporary folder of ours older than this is a leftover of a crash: removed at the next run.
const STALE_TMP_MS: i64 = 6 * HOUR;

pub const NAME_PREFIX: &str = "pulse-auto-";
pub const TMP_PREFIX: &str = ".pulse-auto-tmp-";
const PROBE_PREFIX: &str = ".pulse-write-test-";

// --- Errors ---

/// Errors of the automatic backup, displayed as translatable codes `backup:<code>`. They never
/// carry a path or data (the interface already knows the folder).
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum BackupError {
    /// No destination folder chosen.
    #[error("backup:noFolder")]
    NoFolder,
    #[error("backup:notAbsolute")]
    NotAbsolute,
    /// The folder does not exist (removed, USB key unplugged, drive disconnected).
    #[error("backup:folderNotFound")]
    FolderNotFound,
    #[error("backup:notAFolder")]
    NotAFolder,
    /// Inside the data folder of Pulse: no protection against a disk failure.
    #[error("backup:insideDataFolder")]
    InsideDataFolder,
    #[error("backup:notWritable")]
    NotWritable,
    #[error("backup:diskFull")]
    DiskFull,
    /// A file is held by another program (antivirus, synchronisation client).
    #[error("backup:fileInUse")]
    FileInUse,
    /// The copy did not read back as a healthy Pulse backup: it was discarded.
    #[error("backup:verifyFailed")]
    VerifyFailed,
    /// A backup with this name (same minute) already exists.
    #[error("backup:alreadyExists")]
    AlreadyExists,
    /// Another backup or a restore is running.
    #[error("backup:busy")]
    Busy,
    /// The application was locked during the backup: stopped, nothing kept.
    #[error("backup:locked")]
    Locked,
    /// The lock was enabled, disabled or its password changed during the backup: stopped.
    #[error("backup:interrupted")]
    Interrupted,
    #[error("backup:invalidKeep")]
    InvalidKeep,
    /// The backup succeeded but an old one could not be deleted.
    #[error("backup:pruneFailed")]
    PruneFailed,
    #[error("backup:io")]
    Io,
}

impl BackupError {
    /// The code without its prefix (stored in `backup.auto.last_error`).
    pub fn code(self) -> &'static str {
        match self {
            BackupError::NoFolder => "noFolder",
            BackupError::NotAbsolute => "notAbsolute",
            BackupError::FolderNotFound => "folderNotFound",
            BackupError::NotAFolder => "notAFolder",
            BackupError::InsideDataFolder => "insideDataFolder",
            BackupError::NotWritable => "notWritable",
            BackupError::DiskFull => "diskFull",
            BackupError::FileInUse => "fileInUse",
            BackupError::VerifyFailed => "verifyFailed",
            BackupError::AlreadyExists => "alreadyExists",
            BackupError::Busy => "busy",
            BackupError::Locked => "locked",
            BackupError::Interrupted => "interrupted",
            BackupError::InvalidKeep => "invalidKeep",
            BackupError::PruneFailed => "pruneFailed",
            BackupError::Io => "io",
        }
    }

    /// The code of an operating-system error (`raw_os_error`), when it says more than its kind.
    /// Pure, so that the Windows codes are tested on Linux too.
    pub fn from_os_code(raw: i32, windows: bool) -> Option<BackupError> {
        if windows {
            match raw {
                // ERROR_HANDLE_DISK_FULL, ERROR_DISK_FULL, ERROR_DISK_QUOTA_EXCEEDED
                39 | 112 | 1295 => Some(BackupError::DiskFull),
                // ERROR_SHARING_VIOLATION, ERROR_LOCK_VIOLATION, ERROR_USER_MAPPED_FILE
                32 | 33 | 1224 => Some(BackupError::FileInUse),
                // ERROR_FILE_NOT_FOUND, ERROR_PATH_NOT_FOUND, ERROR_NOT_READY (USB key removed),
                // ERROR_BAD_NETPATH, ERROR_DEV_NOT_EXIST
                2 | 3 | 21 | 53 | 55 => Some(BackupError::FolderNotFound),
                // ERROR_ACCESS_DENIED, ERROR_WRITE_PROTECT
                5 | 19 => Some(BackupError::NotWritable),
                _ => None,
            }
        } else {
            match raw {
                28 | 122 => Some(BackupError::DiskFull), // ENOSPC, EDQUOT
                16 | 26 => Some(BackupError::FileInUse), // EBUSY, ETXTBSY
                2 | 19 | 6 => Some(BackupError::FolderNotFound), // ENOENT, ENODEV, ENXIO
                13 | 1 | 30 => Some(BackupError::NotWritable), // EACCES, EPERM, EROFS
                _ => None,
            }
        }
    }

    fn from_io(e: &std::io::Error) -> BackupError {
        if let Some(code) = e.raw_os_error().and_then(|raw| BackupError::from_os_code(raw, cfg!(windows))) {
            return code;
        }
        BackupError::from_kind(&format!("{:?}", e.kind()))
    }

    /// From the name of an `io::ErrorKind` (the lock keeps only that name, see `LockError::Io`).
    fn from_kind(kind: &str) -> BackupError {
        match kind {
            "StorageFull" | "QuotaExceeded" | "FileTooLarge" => BackupError::DiskFull,
            "ResourceBusy" | "ExecutableFileBusy" => BackupError::FileInUse,
            "NotFound" => BackupError::FolderNotFound,
            "PermissionDenied" | "ReadOnlyFilesystem" => BackupError::NotWritable,
            _ => BackupError::Io,
        }
    }

    /// Classifies any error of the backup steps. Never panics, never keeps a message.
    pub fn from_core(e: &CoreError) -> BackupError {
        use rusqlite::ErrorCode;
        match e {
            CoreError::Backup(b) => *b,
            CoreError::Io(io) => BackupError::from_io(io),
            CoreError::Lock(LockError::Io(kind)) => BackupError::from_kind(kind),
            CoreError::Lock(LockError::Locked) => BackupError::Locked,
            CoreError::Lock(LockError::PersistFailed) => BackupError::Io,
            CoreError::Db(rusqlite::Error::SqliteFailure(f, _)) => match f.code {
                ErrorCode::DiskFull => BackupError::DiskFull,
                ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked => BackupError::FileInUse,
                ErrorCode::ReadOnly | ErrorCode::PermissionDenied => BackupError::NotWritable,
                ErrorCode::CannotOpen => BackupError::FolderNotFound,
                _ => BackupError::Io,
            },
            _ => BackupError::Io,
        }
    }
}

fn io_err(e: std::io::Error) -> BackupError {
    BackupError::from_io(&e)
}

// --- Simulated failures (tests only) ---

#[cfg(test)]
thread_local! {
    /// Step at which the next [`fail`] of this thread fails, and with which error (tests only).
    pub(crate) static FAIL_AT: std::cell::RefCell<Option<(&'static str, std::io::ErrorKind)>> = const { std::cell::RefCell::new(None) };
}

/// A named step. In tests it can be made to fail (disk full, file in use…) to prove that an
/// interruption at that exact point leaves nothing incomplete. Does nothing in the application.
fn fail(_step: &'static str) -> std::result::Result<(), BackupError> {
    #[cfg(test)]
    {
        let hit = FAIL_AT.with(|f| {
            let mut f = f.borrow_mut();
            match *f {
                Some((s, kind)) if s == _step => {
                    *f = None;
                    Some(kind)
                }
                _ => None,
            }
        });
        if let Some(kind) = hit {
            return Err(io_err(std::io::Error::from(kind)));
        }
    }
    Ok(())
}

// --- Settings ---

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "lowercase")]
pub enum Frequency {
    #[default]
    Daily,
    Weekly,
}

impl Frequency {
    fn as_str(self) -> &'static str {
        match self {
            Frequency::Daily => "daily",
            Frequency::Weekly => "weekly",
        }
    }

    fn parse(s: &str) -> Option<Frequency> {
        match s {
            "daily" => Some(Frequency::Daily),
            "weekly" => Some(Frequency::Weekly),
            _ => None,
        }
    }

    /// Nominal period, used for « the last success is older than 2 × the frequency ».
    pub fn period_ms(self) -> i64 {
        match self {
            Frequency::Daily => DAY,
            Frequency::Weekly => WEEKLY_MS,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoBackupSettings {
    pub enabled: bool,
    /// Absolute path of the destination folder.
    #[serde(default)]
    pub folder: Option<String>,
    #[serde(default)]
    pub frequency: Frequency,
    /// Number of automatic backups kept (1 to 60).
    pub keep: u32,
}

impl Default for AutoBackupSettings {
    fn default() -> Self {
        AutoBackupSettings { enabled: false, folder: None, frequency: Frequency::Daily, keep: DEFAULT_KEEP }
    }
}

fn read_i64(conn: &Connection, key: &str) -> Result<Option<i64>> {
    Ok(settings::read(conn, key)?.and_then(|v| v.trim().parse().ok()))
}

/// Stored settings. A value that cannot be read gives the default (it never blocks the user):
/// an unreadable « enabled » is « disabled ».
pub fn get_settings(conn: &Connection) -> Result<AutoBackupSettings> {
    let d = AutoBackupSettings::default();
    Ok(AutoBackupSettings {
        enabled: settings::read(conn, ENABLED_KEY)?.as_deref() == Some("on"),
        folder: settings::read(conn, FOLDER_KEY)?.map(|f| f.trim().to_string()).filter(|f| !f.is_empty()),
        frequency: settings::read(conn, FREQUENCY_KEY)?.and_then(|f| Frequency::parse(f.trim())).unwrap_or(d.frequency),
        keep: settings::read(conn, KEEP_KEY)?.and_then(|k| k.trim().parse().ok()).filter(|k| (1..=MAX_KEEP).contains(k)).unwrap_or(d.keep),
    })
}

/// Validates and saves the settings. Enabling needs a valid folder (`backup:noFolder`, or the code
/// of [`check_folder`]); a new folder is always checked. Disabling never checks the folder (it may
/// have disappeared). Returns what is now stored and the check of the folder, if any.
pub fn set_settings(conn: &Connection, data_dir: &Path, s: &AutoBackupSettings) -> Result<(AutoBackupSettings, Option<FolderCheck>)> {
    if !(1..=MAX_KEEP).contains(&s.keep) {
        return Err(BackupError::InvalidKeep.into());
    }
    let folder = s.folder.as_deref().map(str::trim).filter(|f| !f.is_empty());
    if s.enabled && folder.is_none() {
        return Err(BackupError::NoFolder.into());
    }
    let stored = get_settings(conn)?;
    let check = match folder {
        Some(f) if s.enabled || stored.folder.as_deref() != Some(f) => Some(check_folder(data_dir, f)?),
        _ => None,
    };
    let tx = conn.unchecked_transaction()?;
    settings::write(&tx, ENABLED_KEY, Some(if s.enabled { "on" } else { "off" }.into()))?;
    settings::write(&tx, FOLDER_KEY, folder.map(str::to_string))?;
    settings::write(&tx, FREQUENCY_KEY, Some(s.frequency.as_str().into()))?;
    settings::write(&tx, KEEP_KEY, Some(s.keep.to_string()))?;
    if s.enabled {
        // Accepting the offer in any way ends the invitation for good.
        settings::write(&tx, INVITED_KEY, Some("done".into()))?;
    }
    tx.commit()?;
    Ok((get_settings(conn)?, check))
}

// --- Destination folder ---

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderCheck {
    pub path: String,
    /// The folder seems to be on the same drive as the data: warn, do not refuse.
    pub same_drive: bool,
}

/// Checks a destination: absolute, existing folder, **not inside the data folder** of Pulse
/// (a disk failure would take both), and writable (a small file is created, flushed and removed).
pub fn check_folder(data_dir: &Path, folder: &str) -> Result<FolderCheck> {
    let path = Path::new(folder);
    if !path.is_absolute() {
        return Err(BackupError::NotAbsolute.into());
    }
    let meta = fs::metadata(path).map_err(|e| match BackupError::from_io(&e) {
        BackupError::Io | BackupError::NotWritable => BackupError::FolderNotFound,
        other => other,
    })?;
    if !meta.is_dir() {
        return Err(BackupError::NotAFolder.into());
    }
    let dest = fs::canonicalize(path).map_err(io_err)?;
    let data = fs::canonicalize(data_dir).unwrap_or_else(|_| data_dir.to_path_buf());
    if dest.starts_with(&data) {
        return Err(BackupError::InsideDataFolder.into());
    }
    probe_writable(&dest)?;
    Ok(FolderCheck { path: folder.to_string(), same_drive: same_drive(&data, &dest) })
}

/// Creates, flushes and removes a small file: the only reliable test of « can I write here ».
fn probe_writable(dir: &Path) -> std::result::Result<(), BackupError> {
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let probe = dir.join(format!("{PROBE_PREFIX}{}-{nanos}", std::process::id()));
    fail("probe").map_err(|_| BackupError::NotWritable)?;
    let written = (|| -> std::io::Result<()> {
        let mut f = fs::OpenOptions::new().write(true).create_new(true).open(&probe)?;
        f.write_all(b"pulse")?;
        f.sync_all()
    })();
    let _ = fs::remove_file(&probe);
    written.map_err(|e| match BackupError::from_io(&e) {
        BackupError::Io | BackupError::FolderNotFound => BackupError::NotWritable,
        other => other,
    })
}

/// Volume of a Windows path, from its text: `C:`, or `\\server\share` (UNC), with or without the
/// `\\?\` prefix of a canonical path; `None` if it has no volume. Pure (tested on Linux).
pub fn windows_volume(path: &str) -> Option<String> {
    let p = path.replace('/', "\\");
    let p = p.strip_prefix(r"\\?\UNC\").map(|rest| format!(r"\\{rest}")).unwrap_or(p);
    let p = p.strip_prefix(r"\\?\").map(str::to_string).unwrap_or(p);
    if let Some(rest) = p.strip_prefix(r"\\") {
        let mut parts = rest.split('\\').filter(|s| !s.is_empty());
        let (server, share) = (parts.next()?, parts.next()?);
        return Some(format!(r"\\{}\{}", server.to_lowercase(), share.to_lowercase()));
    }
    let b = p.as_bytes();
    (b.len() >= 2 && b[0].is_ascii_alphabetic() && b[1] == b':').then(|| format!("{}:", (b[0] as char).to_ascii_uppercase()))
}

/// « Seems to be on the same drive »: same device (Unix) or same volume (Windows). A heuristic:
/// two partitions of one physical disk count as different drives.
fn same_drive(data: &Path, dest: &Path) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        match (fs::metadata(data), fs::metadata(dest)) {
            (Ok(a), Ok(b)) => a.dev() == b.dev(),
            _ => false,
        }
    }
    #[cfg(not(unix))]
    {
        use std::path::Component;
        let vol = |p: &Path| p.components().next().and_then(|c| match c {
            Component::Prefix(_) => windows_volume(&p.to_string_lossy()),
            _ => None,
        });
        matches!((vol(data), vol(dest)), (Some(a), Some(b)) if a == b)
    }
}

// --- Decision ---

/// What the decision needs to know about the past attempts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct History {
    pub last_success_at: Option<i64>,
    pub last_attempt_at: Option<i64>,
}

impl History {
    /// The last attempt did not succeed (its instant is recorded before the work, the success
    /// with the same instant after it).
    pub fn last_failed(&self) -> bool {
        match (self.last_attempt_at, self.last_success_at) {
            (Some(a), Some(s)) => a > s,
            (Some(_), None) => true,
            _ => false,
        }
    }
}

fn start_of_next_local_day(ms: i64, tz_offset_min: i32) -> i64 {
    (time::local_day_number(ms, tz_offset_min) + 1) * DAY - i64::from(tz_offset_min) * MINUTE
}

/// Is an automatic backup due at `now`? Pure.
/// - never succeeded → yes;
/// - daily: another local day than the last success (with the current offset) **and** at least
///   12 h since it; weekly: at least 7 days;
/// - never two attempts less than 10 min apart; after a failure, 30 min before the next attempt;
/// - a clock that went back (last success in the future) does not stop the backups.
pub fn is_due(freq: Frequency, h: &History, now: i64, tz_offset_min: i32) -> bool {
    if let Some(a) = h.last_attempt_at {
        if (now - a).abs() < MIN_GAP_MS {
            return false;
        }
        if h.last_failed() && now > a && now - a < RETRY_AFTER_FAILURE_MS {
            return false;
        }
    }
    let Some(s) = h.last_success_at else { return true };
    let elapsed = now - s;
    if elapsed < 0 {
        return true;
    }
    match freq {
        Frequency::Daily => elapsed >= DAILY_MIN_MS && time::local_day_number(now, tz_offset_min) != time::local_day_number(s, tz_offset_min),
        Frequency::Weekly => elapsed >= WEEKLY_MS,
    }
}

/// Earliest instant (≥ `now`) at which [`is_due`] becomes true, for « prochaine prévue ». The
/// backup itself happens at the first check (every 30 min) after it.
pub fn next_due_at(freq: Frequency, h: &History, now: i64, tz_offset_min: i32) -> i64 {
    let mut t = match h.last_success_at {
        Some(s) if s <= now => match freq {
            Frequency::Daily => (s + DAILY_MIN_MS).max(start_of_next_local_day(s, tz_offset_min)),
            Frequency::Weekly => s + WEEKLY_MS,
        },
        _ => now,
    };
    if let Some(a) = h.last_attempt_at.filter(|a| *a <= now) {
        t = t.max(a + MIN_GAP_MS);
        if h.last_failed() {
            t = t.max(a + RETRY_AFTER_FAILURE_MS);
        }
    }
    t.max(now)
}

// --- Names ---

/// `pulse-auto-AAAAMMJJ-HHMM`, local time of `now` with the offset of the PC.
pub fn backup_name(now: i64, tz_offset_min: i32) -> String {
    let day = time::day_key(now, tz_offset_min).replace('-', "");
    let minutes = (now + i64::from(tz_offset_min) * MINUTE).div_euclid(MINUTE).rem_euclid(24 * 60);
    format!("{NAME_PREFIX}{day}-{:02}{:02}", minutes / 60, minutes % 60)
}

/// The instant written in an automatic backup name (`AAAAMMJJHHMM` as a sortable number), or
/// `None` if the name does not follow the pattern **exactly** (no suffix, ASCII digits, a real
/// date and time).
pub fn parse_name(name: &str) -> Option<u64> {
    let rest = name.strip_prefix(NAME_PREFIX)?;
    let b = rest.as_bytes();
    if b.len() != 13 || b[8] != b'-' {
        return None;
    }
    let digits = |r: std::ops::Range<usize>| -> Option<u64> {
        let s = &b[r];
        s.iter().all(u8::is_ascii_digit).then(|| s.iter().fold(0u64, |n, d| n * 10 + u64::from(d - b'0')))
    };
    let (y, m, d, hh, mm) = (digits(0..4)?, digits(4..6)?, digits(6..8)?, digits(9..11)?, digits(11..13)?);
    if !(1..=12).contains(&m) || d == 0 || d > u64::from(time::days_in_month(y as i64, m as u32)) || hh > 23 || mm > 59 {
        return None;
    }
    Some(((y * 100 + m) * 100 + d) * 10_000 + hh * 100 + mm)
}

// --- One backup at a time ---

static BUSY: Mutex<Vec<PathBuf>> = Mutex::new(Vec::new());

/// Held while an automatic backup, a manual backup or a restore of `data_dir` runs.
#[derive(Debug)]
pub struct BusyGuard {
    dir: PathBuf,
}

impl Drop for BusyGuard {
    fn drop(&mut self) {
        let mut all = BUSY.lock().unwrap_or_else(|p| p.into_inner());
        all.retain(|d| d != &self.dir);
    }
}

/// Marks a backup or a restore of `data_dir` as running; `backup:busy` if one already is.
pub fn exclusive(data_dir: &Path) -> Result<BusyGuard> {
    let mut all = BUSY.lock().unwrap_or_else(|p| p.into_inner());
    if all.iter().any(|d| d == data_dir) {
        return Err(BackupError::Busy.into());
    }
    all.push(data_dir.to_path_buf());
    Ok(BusyGuard { dir: data_dir.to_path_buf() })
}

// --- The five phases ---

/// Result of phase 1.
#[derive(Debug)]
pub enum Decision {
    /// The application is locked: nothing read, nothing written, no error.
    Locked,
    Disabled,
    NotDue,
    /// Another backup or a restore is running: this turn is skipped.
    Busy,
    Run(Plan),
}

/// A backup that will run (phase 1 done: the attempt is recorded).
#[derive(Debug)]
pub struct Plan {
    folder: PathBuf,
    keep: u32,
    started_at: i64,
    tz_offset_min: i32,
    _busy: BusyGuard,
}

/// Phase 1 (database held). `conn = None`: the application is locked, the turn is skipped
/// without error nor record. `manual` (« Sauvegarder maintenant »): no schedule, no delay, but a
/// folder is required. Records `last_attempt_at` before any work (a crash still counts).
pub fn plan(conn: Option<&Connection>, data_dir: &Path, now: i64, tz_offset_min: i32, manual: bool) -> Result<Decision> {
    let Some(conn) = conn else { return Ok(Decision::Locked) };
    let s = get_settings(conn)?;
    let folder = match (&s.folder, manual) {
        (None, true) => return Err(BackupError::NoFolder.into()),
        (None, false) => return Ok(Decision::Disabled),
        (Some(_), false) if !s.enabled => return Ok(Decision::Disabled),
        (Some(f), _) => PathBuf::from(f),
    };
    if !manual && !is_due(s.frequency, &history(conn)?, now, tz_offset_min) {
        return Ok(Decision::NotDue);
    }
    let busy = match exclusive(data_dir) {
        Ok(b) => b,
        Err(e) if manual => return Err(e),
        Err(_) => return Ok(Decision::Busy),
    };
    settings::write(conn, LAST_ATTEMPT_KEY, Some(now.to_string()))?;
    Ok(Decision::Run(Plan { folder, keep: s.keep, started_at: now, tz_offset_min, _busy: busy }))
}

impl Plan {
    pub fn started_at(&self) -> i64 {
        self.started_at
    }

    /// Phase 2 (database free): the destination is checked and the temporary folder created.
    pub fn stage(self, data_dir: &Path) -> std::result::Result<Staged, BackupError> {
        let folder = self.folder.to_string_lossy().into_owned();
        check_folder(data_dir, &folder).map_err(|e| BackupError::from_core(&e))?;
        remove_stale_tmp(&self.folder, self.started_at);
        let name = backup_name(self.started_at, self.tz_offset_min);
        if self.folder.join(&name).exists() {
            return Err(BackupError::AlreadyExists);
        }
        let tmp = TmpDir::create(&self.folder, self.started_at)?;
        fail("stage")?;
        Ok(Staged { plan: self, name, tmp })
    }
}

/// Our temporary folder in the destination: removed when dropped, unless it was renamed.
#[derive(Debug)]
struct TmpDir {
    path: Option<PathBuf>,
}

impl TmpDir {
    fn create(dest: &Path, now: i64) -> std::result::Result<TmpDir, BackupError> {
        static COUNTER: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let path = dest.join(format!("{TMP_PREFIX}{now}-{}-{n}", std::process::id()));
        fs::create_dir(&path).map_err(io_err)?;
        Ok(TmpDir { path: Some(path) })
    }

    fn path(&self) -> &Path {
        self.path.as_deref().expect("not committed yet")
    }

    /// Renames the folder to `to`; from then on it is not removed.
    fn commit(&mut self, to: &Path) -> std::result::Result<(), BackupError> {
        if to.exists() {
            return Err(BackupError::AlreadyExists);
        }
        fs::rename(self.path(), to).map_err(io_err)?;
        self.path = None;
        Ok(())
    }
}

impl Drop for TmpDir {
    fn drop(&mut self) {
        if let Some(p) = self.path.take() {
            let _ = fs::remove_dir_all(&p);
        }
    }
}

/// Removes our temporary folders left by a crash (older than 6 h by the instant in their name,
/// and holding nothing but what a backup writes). Anything else is never touched.
fn remove_stale_tmp(dest: &Path, now: i64) {
    let Ok(entries) = fs::read_dir(dest) else { return };
    for e in entries.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        let Some(rest) = name.strip_prefix(TMP_PREFIX) else { continue };
        let Some(at) = rest.split('-').next().and_then(|t| t.parse::<i64>().ok()) else { continue };
        let is_dir = e.file_type().is_ok_and(|t| t.is_dir());
        if is_dir && now - at > STALE_TMP_MS && only_backup_contents(&e.path(), true) {
            let _ = fs::remove_dir_all(e.path());
        }
    }
}

/// A folder holding nothing but what a backup writes: the database (`pulse.db` or `pulse.db.enc`,
/// plus, for a temporary folder, the files SQLite or the atomic write may leave next to it) and
/// a `screenshots` folder of plain files. Symbolic links are never followed.
fn only_backup_contents(dir: &Path, temporary: bool) -> bool {
    let Ok(entries) = fs::read_dir(dir) else { return false };
    for e in entries {
        let Ok(e) = e else { return false };
        let Ok(ft) = e.file_type() else { return false };
        let name = e.file_name().to_string_lossy().into_owned();
        let ok = if name == screenshots::DIR {
            ft.is_dir()
                && fs::read_dir(e.path()).is_ok_and(|shots| shots.flatten().all(|s| s.file_type().is_ok_and(|t| t.is_file())))
        } else {
            let allowed = name == DB_FILE
                || name == ENC_FILE
                || (temporary && [format!("{ENC_FILE}.tmp"), format!("{DB_FILE}-journal"), format!("{DB_FILE}-wal"), format!("{DB_FILE}-shm")].contains(&name));
            allowed && ft.is_file()
        };
        if !ok {
            return false;
        }
    }
    true
}

/// Phase 2 done: the temporary folder exists.
#[derive(Debug)]
pub struct Staged {
    plan: Plan,
    name: String,
    tmp: TmpDir,
}

impl Staged {
    /// Phase 3 (database held, for the duration of the copy only): the database copy (encrypted
    /// when the lock is active) and the list of the screenshots at this instant.
    pub fn copy_database(self, conn: &Connection, data_dir: &Path) -> std::result::Result<Copied, BackupError> {
        let keys = backup::write_database(conn, data_dir, self.tmp.path()).map_err(|e| BackupError::from_core(&e))?;
        fail("database")?;
        let shots = backup::screenshot_files(data_dir).map_err(|e| BackupError::from_core(&e))?;
        let schema = crate::migrations::current_version(conn).map_err(|e| BackupError::from_core(&e))?;
        Ok(Copied { staged: self, keys, shots, schema, data_dir: data_dir.to_path_buf() })
    }
}

/// Phase 3 done: the database is in the temporary folder.
pub struct Copied {
    staged: Staged,
    keys: Option<Arc<Unlocked>>,
    shots: Vec<PathBuf>,
    schema: u32,
    data_dir: PathBuf,
}

impl std::fmt::Debug for Copied {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Copied").field("staged", &self.staged).field("encrypted", &self.keys.is_some()).field("shots", &self.shots.len()).finish()
    }
}

/// A successful automatic backup.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Done {
    pub info: BackupInfo,
    pub name: String,
    /// Old automatic backups deleted by the retention.
    pub pruned: Vec<String>,
    /// `pruneFailed` when an old backup could not be deleted (the new one is kept anyway).
    pub prune_error: Option<BackupError>,
}

impl Serialize for BackupError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(self.code())
    }
}

/// The lock state must not have changed since the database copy: locked in between → stop
/// (nothing is read while locked); enabled, disabled or password changed → stop.
fn same_keys(keys: &Option<Arc<Unlocked>>, data_dir: &Path) -> std::result::Result<(), BackupError> {
    match (keys, lock::current_keys(data_dir)) {
        (None, None) => Ok(()),
        (Some(a), Some(b)) if Arc::ptr_eq(a, &b) => Ok(()),
        (Some(_), None) => Err(BackupError::Locked),
        _ => Err(BackupError::Interrupted),
    }
}

impl Copied {
    /// Phase 4 (database free): screenshots, read-back, rename, retention.
    pub fn finish(self) -> std::result::Result<Done, BackupError> {
        let Copied { mut staged, keys, shots, schema, data_dir } = self;
        same_keys(&keys, &data_dir)?;
        backup::copy_screenshot_files(&shots, staged.tmp.path(), keys.as_deref()).map_err(|e| BackupError::from_core(&e))?;
        fail("screenshots")?;
        // Read back: integrity, schema, tables, and every screenshot present.
        let info = backup::verify_copy(staged.tmp.path(), keys.as_deref()).map_err(|_| BackupError::VerifyFailed)?;
        fail("verify").map_err(|_| BackupError::VerifyFailed)?;
        if info.schema_version != schema || info.screenshots as usize != shots.len() || !only_backup_contents(staged.tmp.path(), true) {
            return Err(BackupError::VerifyFailed);
        }
        same_keys(&keys, &data_dir)?;
        let dest = staged.plan.folder.clone();
        let final_path = dest.join(&staged.name);
        fail("rename")?;
        staged.tmp.commit(&final_path)?;
        sync_dir(&dest);
        let info = BackupInfo { path: final_path.to_string_lossy().into_owned(), ..info };
        let (pruned, prune_error) = prune(&dest, &staged.name, staged.plan.keep, keys.as_deref());
        Ok(Done { info, name: std::mem::take(&mut staged.name), pruned, prune_error })
    }
}

fn sync_dir(dir: &Path) {
    #[cfg(unix)]
    if let Ok(d) = fs::File::open(dir) {
        let _ = d.sync_all();
    }
    #[cfg(not(unix))]
    let _ = dir;
}

// --- Retention ---

/// An automatic backup found in the destination folder (for the list and the retention).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoBackupEntry {
    pub name: String,
    pub path: String,
    /// Local date and time written in the name: `AAAA-MM-JJ HH:MM`.
    pub at: String,
    pub size_bytes: u64,
    pub encrypted: bool,
    /// Holds nothing but a database and screenshots (a quick look, not a full read-back).
    pub complete: bool,
}

fn label_of(key: u64) -> String {
    let (d, t) = (key / 10_000, key % 10_000);
    format!("{:04}-{:02}-{:02} {:02}:{:02}", d / 10_000, d / 100 % 100, d % 100, t / 100, t % 100)
}

fn dir_size(dir: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(dir) else { return 0 };
    entries
        .flatten()
        .map(|e| match e.file_type() {
            Ok(t) if t.is_dir() => dir_size(&e.path()),
            Ok(t) if t.is_file() => e.metadata().map(|m| m.len()).unwrap_or(0),
            _ => 0,
        })
        .sum()
}

/// Folders of `dest` whose name follows the pattern exactly (symbolic links excluded).
fn auto_folders(dest: &Path) -> Vec<(u64, String, PathBuf)> {
    let Ok(entries) = fs::read_dir(dest) else { return Vec::new() };
    let mut out: Vec<(u64, String, PathBuf)> = entries
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_dir()))
        .filter_map(|e| {
            let name = e.file_name().to_str()?.to_string();
            parse_name(&name).map(|k| (k, name, e.path()))
        })
        .collect();
    out.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.cmp(&a.1)));
    out
}

/// The automatic backups present in `folder`, newest first. Read-only, quick (no integrity check).
pub fn list(folder: &Path) -> Vec<AutoBackupEntry> {
    auto_folders(folder)
        .into_iter()
        .map(|(k, name, path)| AutoBackupEntry {
            at: label_of(k),
            size_bytes: dir_size(&path),
            encrypted: !path.join(DB_FILE).is_file() && path.join(ENC_FILE).is_file(),
            complete: only_backup_contents(&path, false) && (path.join(DB_FILE).is_file() || path.join(ENC_FILE).is_file()),
            path: path.to_string_lossy().into_owned(),
            name,
        })
        .collect()
}

/// A full read-back of an old automatic backup before deleting it: only the expected contents,
/// then a healthy Pulse database (a plain one; an encrypted one with the current data key).
/// Anything that cannot be proven to be one of our backups is **kept**.
fn verified_backup(path: &Path, keys: Option<&Unlocked>) -> bool {
    if !only_backup_contents(path, false) {
        return false;
    }
    if path.join(DB_FILE).is_file() {
        return backup::inspect(path).is_ok();
    }
    match keys {
        Some(k) if path.join(ENC_FILE).is_file() => backup::verify_copy(path, Some(k)).is_ok(),
        _ => false,
    }
}

/// Keeps the `keep` most recent automatic backups (the new one, `newest`, always counts and is
/// never deleted). Deletes only folders named exactly `pulse-auto-AAAAMMJJ-HHMM` that read back as
/// Pulse backups; a deletion that fails is reported, not retried in a loop.
fn prune(dest: &Path, newest: &str, keep: u32, keys: Option<&Unlocked>) -> (Vec<String>, Option<BackupError>) {
    let others: Vec<_> = auto_folders(dest).into_iter().filter(|(_, n, _)| n != newest).collect();
    // Ranking: a quick look (contents only) so that a stray folder does not take a slot...
    let kept_slots = keep.saturating_sub(1) as usize;
    let mut seen = 0usize;
    let (mut pruned, mut error) = (Vec::new(), None);
    for (_, name, path) in others {
        if !only_backup_contents(&path, false) {
            continue;
        }
        if seen < kept_slots {
            seen += 1;
            continue;
        }
        // ...and a full read-back before anything is deleted.
        if !verified_backup(&path, keys) {
            continue;
        }
        match fail("prune").map_err(|_| ()).and_then(|_| fs::remove_dir_all(&path).map_err(|_| ())) {
            Ok(()) => pruned.push(name),
            Err(()) => error = Some(BackupError::PruneFailed),
        }
    }
    (pruned, error)
}

// --- Phase 5: record ---

/// Phase 5 (database held): success → `last_success_at` = the instant of the attempt, error
/// cleared (or `pruneFailed` noted); failure → its code. `locked` and `busy` record nothing.
pub fn record(conn: &Connection, started_at: i64, result: &std::result::Result<Done, BackupError>) -> Result<()> {
    match result {
        Ok(done) => {
            let tx = conn.unchecked_transaction()?;
            settings::write(&tx, LAST_SUCCESS_KEY, Some(started_at.to_string()))?;
            settings::write(&tx, LAST_ERROR_KEY, done.prune_error.map(|e| e.code().to_string()))?;
            tx.commit()?;
        }
        Err(BackupError::Locked | BackupError::Busy) => {}
        Err(e) => settings::write(conn, LAST_ERROR_KEY, Some(e.code().to_string()))?,
    }
    Ok(())
}

/// All five phases at once, with one connection (tests, and any caller that may hold the
/// database throughout). `Ok(None)`: nothing to do (locked, disabled, not due, busy).
pub fn run(conn: Option<&Connection>, data_dir: &Path, now: i64, tz_offset_min: i32, manual: bool) -> Result<Option<std::result::Result<Done, BackupError>>> {
    let plan = match plan(conn, data_dir, now, tz_offset_min, manual)? {
        Decision::Run(p) => p,
        _ => return Ok(None),
    };
    let conn = conn.expect("a plan needs the database");
    let started = plan.started_at();
    let result = plan.stage(data_dir).and_then(|s| s.copy_database(conn, data_dir)).and_then(Copied::finish);
    record(conn, started, &result)?;
    Ok(Some(result))
}

// --- Status and invitation ---

/// What the interface shows (settings, last results, next backup, banners).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoBackupStatus {
    pub settings: AutoBackupSettings,
    pub last_success_at: Option<i64>,
    pub last_attempt_at: Option<i64>,
    /// Code of the last failure (`diskFull`…), or `pruneFailed` after a success.
    pub last_error: Option<String>,
    pub last_failed: bool,
    /// Enabled: the earliest instant of the next automatic backup.
    pub next_due_at: Option<i64>,
    /// Whole days since the last success.
    pub days_since_success: Option<i64>,
    /// Enabled and the last success is older than 2 × the frequency, or it never succeeded and
    /// the last attempt failed: the shell shows a banner.
    pub stale: bool,
    /// The invitation « Protégez votre historique » is due.
    pub invite: bool,
    /// The lock is active: backups are encrypted (with the password in force when they are made).
    pub encrypted: bool,
    pub check_interval_ms: i64,
}

pub fn history(conn: &Connection) -> Result<History> {
    Ok(History { last_success_at: read_i64(conn, LAST_SUCCESS_KEY)?, last_attempt_at: read_i64(conn, LAST_ATTEMPT_KEY)? })
}

fn invitation_open(value: Option<&str>, now: i64) -> bool {
    match value {
        None => true,
        Some(v) => v.strip_prefix("later:").and_then(|t| t.parse::<i64>().ok()).is_some_and(|until| now >= until),
    }
}

pub fn status(conn: &Connection, data_dir: &Path, now: i64, tz_offset_min: i32) -> Result<AutoBackupStatus> {
    let s = get_settings(conn)?;
    let h = history(conn)?;
    let last_error = settings::read(conn, LAST_ERROR_KEY)?.filter(|e| !e.is_empty());
    let active = s.enabled && s.folder.is_some();
    let stale = active
        && match h.last_success_at {
            Some(t) => now - t > 2 * s.frequency.period_ms(),
            None => h.last_failed() && last_error.is_some(),
        };
    let has_trades: bool = conn.query_row("SELECT EXISTS (SELECT 1 FROM trades)", [], |r| r.get(0))?;
    let invite = !s.enabled && has_trades && invitation_open(settings::read(conn, INVITED_KEY)?.as_deref(), now);
    Ok(AutoBackupStatus {
        last_success_at: h.last_success_at,
        last_attempt_at: h.last_attempt_at,
        last_failed: h.last_failed(),
        next_due_at: active.then(|| next_due_at(s.frequency, &h, now, tz_offset_min)),
        days_since_success: h.last_success_at.map(|t| (now - t).max(0) / DAY),
        stale,
        invite,
        encrypted: lock::current_keys(data_dir).is_some(),
        check_interval_ms: CHECK_INTERVAL_MS,
        last_error,
        settings: s,
    })
}

/// « Activer » ends the invitation (the interface then opens the settings: nothing is enabled
/// here). « Plus tard » hides it 14 days, once; a second « Plus tard » ends it.
pub fn answer_invite(conn: &Connection, now: i64, accept: bool) -> Result<()> {
    let current = settings::read(conn, INVITED_KEY)?;
    let next = if accept || current.as_deref().is_some_and(|v| v.starts_with("later:") || v == "done") {
        "done".to_string()
    } else {
        format!("later:{}", now + INVITE_SNOOZE_MS)
    };
    settings::write(conn, INVITED_KEY, Some(next))
}

impl From<BackupError> for CoreError {
    fn from(e: BackupError) -> Self {
        CoreError::Backup(e)
    }
}

