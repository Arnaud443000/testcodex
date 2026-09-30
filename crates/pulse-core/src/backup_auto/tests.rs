//! Automatic backup tests (lot 32): real files in temporary folders, simulated failures at every
//! step, obvious throwaway passwords with cheap Argon2id parameters for the encrypted cases.

use super::*;
use crate::db;
use crate::lock::{KdfParams, Password, Store};
use crate::test_support::{account, dec, instrument};
use crate::trades::{self, Direction, TradeData};
use std::io::ErrorKind;

const FAST: KdfParams = KdfParams::INSECURE_FAST_FOR_TESTS;
/// 2023-11-14 22:13:20 UTC = 23:13:20 in Paris (UTC+1 in November).
const NOW: i64 = 1_700_000_000_000;
const TZ: i32 = 60;
const PNG: &[u8] = b"\x89PNG\r\n\x1a\nCAPTURE-CANARI-PIXELS";
const PW: &str = "phrase de test jetable";

fn pw(s: &str) -> Password {
    Password::new(s.into())
}

fn fail_at(step: &'static str, kind: ErrorKind) {
    FAIL_AT.with(|f| *f.borrow_mut() = Some((step, kind)));
}

/// A plain data folder with an account, an instrument, two trades (one with a screenshot, whose
/// thesis carries a « canary » that must never appear in an encrypted backup).
fn seeded(dir: &Path) -> Store {
    let store = Store::open_plain(dir).unwrap();
    let conn = store.conn();
    let (acc, ins) = (account(conn, "10000"), instrument(conn, "EURUSD", "100000"));
    let shot = screenshots::save_base64(dir, &screenshots::encode(PNG)).unwrap();
    for (i, exit) in ["1.0900", "1.0800"].iter().enumerate() {
        let mut t = TradeData::new(acc, ins, Direction::Long, dec("1.20"), dec("1.0842"), NOW - 86_400_000 + i as i64 * 3_600_000);
        t.exit_price = Some(dec(exit));
        t.exit_time = Some(NOW - 86_400_000 + i as i64 * 3_600_000 + 60_000);
        t.thesis = "These-CANARI".into();
        if i == 0 {
            t.screenshot_path = Some(shot.clone());
        }
        trades::create(conn, &t).unwrap();
    }
    store
}

fn enable(conn: &Connection, data: &Path, dest: &Path, keep: u32) {
    let s = AutoBackupSettings { enabled: true, folder: Some(dest.to_string_lossy().into_owned()), frequency: Frequency::Daily, keep };
    set_settings(conn, data, &s).unwrap();
}

/// Names in `dir`, sorted (hidden ones included).
fn names(dir: &Path) -> Vec<String> {
    let mut v: Vec<String> = fs::read_dir(dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
    v.sort();
    v
}

fn trade_count(conn: &Connection) -> i64 {
    conn.query_row("SELECT COUNT(*) FROM trades", [], |r| r.get(0)).unwrap()
}

fn all_files(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for e in fs::read_dir(dir).unwrap() {
        let p = e.unwrap().path();
        if p.is_dir() {
            out.extend(all_files(&p));
        } else {
            out.push(p);
        }
    }
    out
}

fn contains(hay: &[u8], needle: &[u8]) -> bool {
    hay.windows(needle.len()).any(|w| w == needle)
}

// --- Decision ---

const M: i64 = 60_000;
const H: i64 = 60 * M;
const D: i64 = 24 * H;
/// 2026-09-30 00:00 UTC.
const DAY0: i64 = 1_790_726_400_000;

fn ok(s: i64) -> History {
    History { last_success_at: Some(s), last_attempt_at: Some(s) }
}

#[test]
fn never_done_is_due_at_once() {
    assert!(is_due(Frequency::Daily, &History::default(), DAY0, 0));
    assert!(is_due(Frequency::Weekly, &History::default(), DAY0, 0));
    assert_eq!(next_due_at(Frequency::Daily, &History::default(), DAY0, 0), DAY0);
}

#[test]
fn daily_needs_another_local_day_and_twelve_hours() {
    let f = Frequency::Daily;
    // 08:00 then 23:59 the same day: 16 h, but the same local day.
    assert!(!is_due(f, &ok(DAY0 + 8 * H), DAY0 + 23 * H + 59 * M, 0));
    // 20:00 then 01:00 the next day: another day, but only 5 h.
    assert!(!is_due(f, &ok(DAY0 + 20 * H), DAY0 + D + H, 0));
    // Exactly 12 h and another day: due.
    assert!(is_due(f, &ok(DAY0 + 20 * H), DAY0 + D + 8 * H, 0));
    assert!(!is_due(f, &ok(DAY0 + 20 * H), DAY0 + D + 8 * H - 1, 0));
    assert_eq!(next_due_at(f, &ok(DAY0 + 20 * H), DAY0 + D, 0), DAY0 + D + 8 * H);
    // 08:00 → the next day starts at midnight, 12 h are reached at 20:00: midnight wins.
    assert_eq!(next_due_at(f, &ok(DAY0 + 8 * H), DAY0 + 9 * H, 0), DAY0 + D);
}

#[test]
fn the_local_day_follows_the_offset() {
    let f = Frequency::Daily;
    let (success, now) = (DAY0 + 10 * H, DAY0 + 23 * H); // 13 h apart, same UTC day
    assert!(!is_due(f, &ok(success), now, 0), "same day in UTC");
    // In Paris (UTC+2 in summer) 23:00 UTC is 01:00 the next day: another local day.
    assert!(is_due(f, &ok(success), now, 120));
    // In Los Angeles (UTC−7) both are on the same local day.
    assert!(!is_due(f, &ok(success), now, -420));
}

#[test]
fn weekly_needs_seven_days() {
    let f = Frequency::Weekly;
    assert!(!is_due(f, &ok(DAY0), DAY0 + 6 * D + 23 * H, 0));
    assert!(is_due(f, &ok(DAY0), DAY0 + 7 * D, 0));
    assert_eq!(next_due_at(f, &ok(DAY0), DAY0 + D, 0), DAY0 + 7 * D);
}

#[test]
fn never_two_attempts_within_ten_minutes_and_thirty_after_a_failure() {
    let f = Frequency::Daily;
    // Due by the frequency (the clock went back one day after the last success, so the success
    // looks « in the future »), and the last attempt was 9 or 11 minutes ago.
    let back = |ago: i64| History { last_success_at: Some(DAY0 + D), last_attempt_at: Some(DAY0 - ago) };
    assert!(!is_due(f, &back(9 * M), DAY0, 0), "9 min since the last attempt");
    assert!(is_due(f, &back(11 * M), DAY0, 0), "11 min: due (a clock that went back does not stop the backups)");
    // After a failure: not at 11 min, not at 29 min, yes at 30 min.
    let failed = |ago: i64| History { last_success_at: Some(DAY0 - 3 * D), last_attempt_at: Some(DAY0 - ago) };
    assert!(failed(M).last_failed());
    assert!(!is_due(f, &failed(11 * M), DAY0, 0));
    assert!(!is_due(f, &failed(29 * M), DAY0, 0));
    assert!(is_due(f, &failed(30 * M), DAY0, 0));
    assert_eq!(next_due_at(f, &failed(11 * M), DAY0, 0), DAY0 + 19 * M);
    // Never succeeded, failed 9 min ago → no; 31 min ago → yes.
    let never = |ago: i64| History { last_success_at: None, last_attempt_at: Some(DAY0 - ago) };
    assert!(!is_due(f, &never(9 * M), DAY0, 0));
    assert!(is_due(f, &never(31 * M), DAY0, 0));
}

// --- Names ---

#[test]
fn names_are_local_timestamps_and_the_pattern_is_exact() {
    assert_eq!(backup_name(NOW, TZ), "pulse-auto-20231114-2313");
    assert_eq!(backup_name(NOW, 0), "pulse-auto-20231114-2213");
    assert_eq!(backup_name(NOW, 120), "pulse-auto-20231115-0013", "after midnight in local time");
    assert_eq!(parse_name("pulse-auto-20231114-2313"), Some(202_311_142_313));
    for bad in [
        "pulse-auto-20231114-2313-copie",
        "pulse-auto-20231114-231",
        "pulse-auto-20231114-23130",
        "Pulse-auto-20231114-2313",
        "pulse-auto-20231114_2313",
        "pulse-auto-20231314-2313",
        "pulse-auto-20230230-1200",
        "pulse-auto-20231114-2413",
        "pulse-auto-20231114-2360",
        "pulse-auto-２０２３1114-2313",
        "pulse-backup-20231114-221320",
        " pulse-auto-20231114-2313",
        ".pulse-auto-tmp-1700000000000-1-0",
    ] {
        assert_eq!(parse_name(bad), None, "{bad}");
    }
    assert_eq!(parse_name("pulse-auto-20240229-0000"), Some(202_402_290_000), "leap day");
}

// --- Folder ---

#[test]
fn folders_inside_the_data_folder_missing_or_not_writable_are_refused() {
    let data = tempfile::tempdir().unwrap();
    let conn = db::open(data.path()).unwrap();
    let inside = data.path().join("sauvegardes");
    fs::create_dir(&inside).unwrap();
    let code = |r: Result<FolderCheck>| match r {
        Err(CoreError::Backup(b)) => b,
        other => panic!("{other:?}"),
    };
    assert_eq!(code(check_folder(data.path(), &inside.to_string_lossy())), BackupError::InsideDataFolder);
    assert_eq!(code(check_folder(data.path(), &data.path().to_string_lossy())), BackupError::InsideDataFolder);
    assert_eq!(code(check_folder(data.path(), &data.path().join("nope").to_string_lossy())), BackupError::FolderNotFound);
    assert_eq!(code(check_folder(data.path(), "relatif/dossier")), BackupError::NotAbsolute);
    let file = tempfile::NamedTempFile::new().unwrap();
    assert_eq!(code(check_folder(data.path(), &file.path().to_string_lossy())), BackupError::NotAFolder);
    // Not writable: simulated on every platform, and a real read-only folder where possible.
    let dest = tempfile::tempdir().unwrap();
    fail_at("probe", ErrorKind::PermissionDenied);
    assert_eq!(code(check_folder(data.path(), &dest.path().to_string_lossy())), BackupError::NotWritable);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let ro = tempfile::tempdir().unwrap();
        fs::set_permissions(ro.path(), fs::Permissions::from_mode(0o555)).unwrap();
        // root ignores permissions: /proc refuses new files even to root.
        let target = if fs::File::create(ro.path().join("x")).is_ok() { PathBuf::from("/proc") } else { ro.path().to_path_buf() };
        assert_eq!(code(check_folder(data.path(), &target.to_string_lossy())), BackupError::NotWritable);
        fs::set_permissions(ro.path(), fs::Permissions::from_mode(0o755)).unwrap();
    }
    // A good folder: accepted, the probe file is gone, same drive detected (both in /tmp).
    let check = check_folder(data.path(), &dest.path().to_string_lossy()).unwrap();
    assert!(names(dest.path()).is_empty(), "the write test leaves nothing");
    #[cfg(unix)]
    assert!(check.same_drive);
    let _ = (check, conn);
}

#[test]
fn windows_volumes_are_read_from_the_path_text() {
    assert_eq!(windows_volume(r"C:\Users\moi\AppData\Roaming\pulse").as_deref(), Some("C:"));
    assert_eq!(windows_volume(r"\\?\d:\Sauvegardes").as_deref(), Some("D:"));
    assert_eq!(windows_volume(r"\\NAS\Partage\pulse").as_deref(), Some(r"\\nas\partage"));
    assert_eq!(windows_volume(r"\\?\UNC\nas\partage\pulse").as_deref(), Some(r"\\nas\partage"));
    assert_eq!(windows_volume("/home/moi"), None);
    assert_ne!(windows_volume(r"C:\a"), windows_volume(r"E:\OneDrive\Pulse"));
}

#[test]
fn error_codes_are_translatable() {
    assert_eq!(BackupError::DiskFull.to_string(), "backup:diskFull");
    assert_eq!(CoreError::from(BackupError::FileInUse).to_string(), "backup:fileInUse");
    assert_eq!(BackupError::from_os_code(112, true), Some(BackupError::DiskFull));
    assert_eq!(BackupError::from_os_code(32, true), Some(BackupError::FileInUse), "sharing violation (antivirus, OneDrive)");
    assert_eq!(BackupError::from_os_code(21, true), Some(BackupError::FolderNotFound), "USB key removed");
    assert_eq!(BackupError::from_os_code(28, false), Some(BackupError::DiskFull));
    let full = rusqlite::Error::SqliteFailure(rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_FULL), None);
    assert_eq!(BackupError::from_core(&CoreError::Db(full)), BackupError::DiskFull);
    assert_eq!(BackupError::from_core(&CoreError::Lock(LockError::Io("StorageFull".into()))), BackupError::DiskFull);
    assert_eq!(BackupError::from_core(&CoreError::Io(std::io::Error::from(ErrorKind::NotFound))), BackupError::FolderNotFound);
}

// --- Settings ---

#[test]
fn settings_are_validated_and_enabling_needs_a_folder() {
    let data = tempfile::tempdir().unwrap();
    let dest = tempfile::tempdir().unwrap();
    let conn = db::open(data.path()).unwrap();
    assert_eq!(get_settings(&conn).unwrap(), AutoBackupSettings::default());
    let code = |r: Result<(AutoBackupSettings, Option<FolderCheck>)>| match r {
        Err(CoreError::Backup(b)) => b,
        other => panic!("{other:?}"),
    };
    let on = AutoBackupSettings { enabled: true, ..Default::default() };
    assert_eq!(code(set_settings(&conn, data.path(), &on)), BackupError::NoFolder);
    let inside = AutoBackupSettings { folder: Some(data.path().to_string_lossy().into_owned()), ..on.clone() };
    assert_eq!(code(set_settings(&conn, data.path(), &inside)), BackupError::InsideDataFolder);
    let folder = Some(dest.path().to_string_lossy().into_owned());
    for keep in [0, 61] {
        assert_eq!(code(set_settings(&conn, data.path(), &AutoBackupSettings { keep, folder: folder.clone(), ..on.clone() })), BackupError::InvalidKeep);
    }
    assert_eq!(get_settings(&conn).unwrap(), AutoBackupSettings::default(), "nothing written by a refusal");
    let good = AutoBackupSettings { enabled: true, folder: folder.clone(), frequency: Frequency::Weekly, keep: 60 };
    let (stored, check) = set_settings(&conn, data.path(), &good).unwrap();
    assert_eq!(stored, good);
    assert!(check.is_some());
    // The folder disappears: disabling still works (no check), enabling again is refused.
    drop(dest);
    let off = AutoBackupSettings { enabled: false, ..good.clone() };
    assert_eq!(set_settings(&conn, data.path(), &off).unwrap().0, off);
    assert_eq!(code(set_settings(&conn, data.path(), &good)), BackupError::FolderNotFound);
    // Unreadable stored values fall back to the defaults.
    settings::write(&conn, KEEP_KEY, Some("beaucoup".into())).unwrap();
    settings::write(&conn, FREQUENCY_KEY, Some("hourly".into())).unwrap();
    let s = get_settings(&conn).unwrap();
    assert_eq!((s.keep, s.frequency), (DEFAULT_KEEP, Frequency::Daily));
}

// --- A full run ---

#[test]
fn a_backup_is_written_under_its_final_name_only_once_verified() {
    let data = tempfile::tempdir().unwrap();
    let dest = tempfile::tempdir().unwrap();
    let store = seeded(data.path());
    let conn = store.conn();
    assert!(run(Some(conn), data.path(), NOW, TZ, false).unwrap().is_none(), "disabled by default");
    enable(conn, data.path(), dest.path(), 10);
    let done = run(Some(conn), data.path(), NOW, TZ, false).unwrap().unwrap().unwrap();
    assert_eq!(done.name, "pulse-auto-20231114-2313");
    assert_eq!((done.info.trades, done.info.screenshots, done.info.encrypted), (2, 1, false));
    assert_eq!(names(dest.path()), vec!["pulse-auto-20231114-2313"], "no temporary folder left");
    let folder = dest.path().join(&done.name);
    assert_eq!(names(&folder), vec!["pulse.db", "screenshots"], "exactly what backup::create writes");
    assert_eq!(fs::read(all_files(&folder.join("screenshots"))[0].clone()).unwrap(), PNG);
    let h = history(conn).unwrap();
    assert_eq!((h.last_success_at, h.last_attempt_at), (Some(NOW), Some(NOW)));
    // Not due again 11 minutes later (same day), nor the next morning before 12 h.
    assert!(run(Some(conn), data.path(), NOW + 11 * M, TZ, false).unwrap().is_none());
    assert!(run(Some(conn), data.path(), NOW + 8 * H, TZ, false).unwrap().is_none());
    // The list sees it.
    let listed = list(dest.path());
    assert_eq!(listed.len(), 1);
    assert_eq!((listed[0].at.as_str(), listed[0].encrypted, listed[0].complete), ("2023-11-14 23:13", false, true));
    assert!(listed[0].size_bytes > 0);
}

#[test]
fn a_failure_at_every_step_leaves_nothing_incomplete_and_the_previous_backup_intact() {
    let data = tempfile::tempdir().unwrap();
    let dest = tempfile::tempdir().unwrap();
    let store = seeded(data.path());
    let conn = store.conn();
    enable(conn, data.path(), dest.path(), 10);
    run(Some(conn), data.path(), NOW, TZ, true).unwrap().unwrap().unwrap();
    let before = names(dest.path());
    let first = dest.path().join("pulse-auto-20231114-2313");
    let first_db = fs::read(first.join(DB_FILE)).unwrap();
    for (i, (step, kind, code)) in [
        ("stage", ErrorKind::PermissionDenied, BackupError::NotWritable),
        ("database", ErrorKind::StorageFull, BackupError::DiskFull),
        ("screenshots", ErrorKind::StorageFull, BackupError::DiskFull),
        ("verify", ErrorKind::Other, BackupError::VerifyFailed),
        ("rename", ErrorKind::ResourceBusy, BackupError::FileInUse),
    ]
    .into_iter()
    .enumerate()
    {
        let at = NOW + (i as i64 + 1) * D;
        fail_at(step, kind);
        let result = run(Some(conn), data.path(), at, TZ, true).unwrap().unwrap();
        assert_eq!(result.unwrap_err(), code, "{step}");
        assert_eq!(names(dest.path()), before, "{step}: no temporary folder, no new backup");
        assert_eq!(fs::read(first.join(DB_FILE)).unwrap(), first_db, "{step}: the previous backup is intact");
        assert_eq!(settings::read(conn, LAST_ERROR_KEY).unwrap().as_deref(), Some(code.code()), "{step}");
        let h = history(conn).unwrap();
        assert_eq!((h.last_success_at, h.last_attempt_at, h.last_failed()), (Some(NOW), Some(at), true), "{step}: never counted as a success");
    }
    // The next attempt works and clears the error.
    run(Some(conn), data.path(), NOW + 9 * D, TZ, true).unwrap().unwrap().unwrap();
    assert_eq!(settings::read(conn, LAST_ERROR_KEY).unwrap(), None);
    assert_eq!(list(dest.path()).len(), 2);
}

#[test]
fn a_full_disk_gives_its_code_and_no_residual_folder() {
    let data = tempfile::tempdir().unwrap();
    let dest = tempfile::tempdir().unwrap();
    let store = seeded(data.path());
    enable(store.conn(), data.path(), dest.path(), 10);
    fail_at("database", ErrorKind::StorageFull);
    let r = run(Some(store.conn()), data.path(), NOW, TZ, false).unwrap().unwrap();
    assert_eq!(r.unwrap_err(), BackupError::DiskFull);
    assert!(names(dest.path()).is_empty());
    let st = status(store.conn(), data.path(), NOW + H, TZ).unwrap();
    assert_eq!((st.last_error.as_deref(), st.last_failed, st.stale), (Some("diskFull"), true, true), "never succeeded + failed → banner");
    // The retry waits 30 minutes after the failure.
    assert!(run(Some(store.conn()), data.path(), NOW + 29 * M, TZ, false).unwrap().is_none());
    assert!(run(Some(store.conn()), data.path(), NOW + 30 * M, TZ, false).unwrap().unwrap().is_ok());
}

// --- Retention ---

/// A copy of a real backup under another name (the test controls the dates).
fn copy_dir(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for e in fs::read_dir(from).unwrap() {
        let p = e.unwrap().path();
        if p.is_dir() {
            copy_dir(&p, &to.join(p.file_name().unwrap()));
        } else {
            fs::copy(&p, to.join(p.file_name().unwrap())).unwrap();
        }
    }
}

#[test]
fn retention_deletes_only_verified_automatic_backups_beyond_n() {
    let data = tempfile::tempdir().unwrap();
    let dest = tempfile::tempdir().unwrap();
    let store = seeded(data.path());
    let conn = store.conn();
    enable(conn, data.path(), dest.path(), 3);
    for i in 0..3 {
        run(Some(conn), data.path(), NOW + i * D, TZ, true).unwrap().unwrap().unwrap();
    }
    assert_eq!(list(dest.path()).len(), 3);
    let good = dest.path().join("pulse-auto-20231114-2313");
    // Things that must never be deleted, all with dates older than every real backup.
    fs::write(dest.path().join("notes.txt"), b"a moi").unwrap();
    crate::backup::create(conn, data.path(), dest.path(), NOW - 400 * D).unwrap(); // manual backup
    copy_dir(&good, &dest.path().join("pulse-auto-20200101-0000-copie")); // neighbour name
    copy_dir(&good, &dest.path().join("pulse-auto-20200101-000")); // neighbour name
    copy_dir(&good, &dest.path().join("pulse-auto-20200102-0000"));
    fs::write(dest.path().join("pulse-auto-20200102-0000/lisez-moi.txt"), b"x").unwrap(); // foreign file inside
    fs::create_dir(dest.path().join("pulse-auto-20200103-0000")).unwrap();
    fs::write(dest.path().join("pulse-auto-20200103-0000/pulse.db"), b"not sqlite, just text long enough to be read by SQLite").unwrap(); // unreadable
    fs::write(dest.path().join("pulse-auto-20200104-0000"), b"a file, not a folder").unwrap();
    #[cfg(unix)]
    std::os::unix::fs::symlink(&good, dest.path().join("pulse-auto-20200105-0000")).unwrap(); // link to a good one
    let untouchable: Vec<String> = names(dest.path()).into_iter().filter(|n| !n.starts_with("pulse-auto-2023")).collect();

    // N + 1 → the oldest automatic backup disappears, nothing else.
    let done = run(Some(conn), data.path(), NOW + 3 * D, TZ, true).unwrap().unwrap().unwrap();
    assert_eq!(done.pruned, vec!["pulse-auto-20231114-2313".to_string()]);
    assert_eq!(done.prune_error, None);
    let now: Vec<String> = names(dest.path());
    for n in &untouchable {
        assert!(now.contains(n), "{n} was deleted");
    }
    assert_eq!(fs::read(dest.path().join("notes.txt")).unwrap(), b"a moi");
    let autos: Vec<String> = now.iter().filter(|n| n.starts_with("pulse-auto-2023")).cloned().collect();
    assert_eq!(autos, vec!["pulse-auto-20231115-2313", "pulse-auto-20231116-2313", "pulse-auto-20231117-2313"]);
    // A deletion that fails is noted, the backup stays a success.
    fail_at("prune", ErrorKind::PermissionDenied);
    let done = run(Some(conn), data.path(), NOW + 4 * D, TZ, true).unwrap().unwrap().unwrap();
    assert_eq!(done.prune_error, Some(BackupError::PruneFailed));
    assert_eq!(settings::read(conn, LAST_ERROR_KEY).unwrap().as_deref(), Some("pruneFailed"));
    let h = history(conn).unwrap();
    assert!(!h.last_failed() && h.last_success_at == Some(NOW + 4 * D));
    // Keep = 1: only the new one stays (the new one is never deleted, even with N = 1).
    set_settings(conn, data.path(), &AutoBackupSettings { keep: 1, ..get_settings(conn).unwrap() }).unwrap();
    let done = run(Some(conn), data.path(), NOW + 5 * D, TZ, true).unwrap().unwrap().unwrap();
    assert_eq!(done.pruned.len(), 4);
    let autos: Vec<String> = names(dest.path()).into_iter().filter(|n| n.starts_with("pulse-auto-2023")).collect();
    assert_eq!(autos, vec!["pulse-auto-20231119-2313"]);
    for n in &untouchable {
        assert!(dest.path().join(n).exists() || fs::symlink_metadata(dest.path().join(n)).is_ok(), "{n} was deleted");
    }
    #[cfg(unix)]
    assert!(fs::symlink_metadata(dest.path().join("pulse-auto-20200105-0000")).unwrap().file_type().is_symlink());
}

#[test]
fn a_backup_dated_in_the_future_does_not_push_the_new_one_out() {
    let data = tempfile::tempdir().unwrap();
    let dest = tempfile::tempdir().unwrap();
    let store = seeded(data.path());
    enable(store.conn(), data.path(), dest.path(), 1);
    // The clock was ahead once: a backup named in 2030.
    run(Some(store.conn()), data.path(), NOW + 2400 * D, TZ, true).unwrap().unwrap().unwrap();
    let done = run(Some(store.conn()), data.path(), NOW, TZ, true).unwrap().unwrap().unwrap();
    assert!(dest.path().join(&done.name).is_dir(), "the new backup is always kept");
    assert_eq!(list(dest.path()).len(), 1);
}

#[test]
fn stale_temporary_folders_of_ours_are_cleaned_and_nothing_else() {
    let data = tempfile::tempdir().unwrap();
    let dest = tempfile::tempdir().unwrap();
    let store = seeded(data.path());
    enable(store.conn(), data.path(), dest.path(), 10);
    let old = format!("{TMP_PREFIX}{}-1-0", NOW - 7 * H);
    let recent = format!("{TMP_PREFIX}{}-1-0", NOW - H);
    let foreign = format!("{TMP_PREFIX}{}-2-0", NOW - 7 * H);
    for (n, f) in [(&old, "pulse.db"), (&recent, "pulse.db"), (&foreign, "photo.jpg")] {
        fs::create_dir(dest.path().join(n)).unwrap();
        fs::write(dest.path().join(n).join(f), b"x").unwrap();
    }
    run(Some(store.conn()), data.path(), NOW, TZ, true).unwrap().unwrap().unwrap();
    let left = names(dest.path());
    assert!(!left.contains(&old), "a crash leftover is removed");
    assert!(left.contains(&recent), "maybe in progress elsewhere: kept");
    assert!(left.contains(&foreign), "holds something else: kept");
}

// --- Lock (lot 22) ---

#[test]
fn with_the_lock_the_backup_is_encrypted_and_opens_with_the_password() {
    let data = tempfile::tempdir().unwrap();
    let dest = tempfile::tempdir().unwrap();
    let mut store = seeded(data.path());
    store.enable(&pw(PW), true, false, FAST).unwrap();
    enable(store.conn(), data.path(), dest.path(), 10);
    assert!(status(store.conn(), data.path(), NOW, TZ).unwrap().encrypted);
    let done = run(Some(store.conn()), data.path(), NOW, TZ, false).unwrap().unwrap().unwrap();
    assert!(done.info.encrypted);
    let folder = dest.path().join(&done.name);
    assert_eq!(names(&folder), vec!["pulse.db.enc", "screenshots"]);
    for f in all_files(&folder) {
        let bytes = fs::read(&f).unwrap();
        assert!(!contains(&bytes, b"CANARI"), "{f:?} holds plaintext");
        assert!(bytes.starts_with(b"PULSEENC") || bytes.starts_with(b"PULSEIMG"), "{f:?}");
    }
    assert!(matches!(backup::inspect(&folder), Err(CoreError::Lock(LockError::BackupPasswordRequired))));
    let info = backup::inspect_with(&folder, Some(&pw(PW))).unwrap();
    assert_eq!((info.trades, info.screenshots), (2, 1));
    assert!(list(dest.path())[0].encrypted);
}

#[test]
fn locked_means_nothing_is_read_or_written() {
    let data = tempfile::tempdir().unwrap();
    let dest = tempfile::tempdir().unwrap();
    let mut store = seeded(data.path());
    store.enable(&pw(PW), true, false, FAST).unwrap();
    enable(store.conn(), data.path(), dest.path(), 10);
    store.close().map_err(|_| "close").unwrap();
    let enc_before = fs::read(data.path().join(ENC_FILE)).unwrap();
    assert!(matches!(plan(None, data.path(), NOW, TZ, false).unwrap(), Decision::Locked));
    assert!(run(None, data.path(), NOW, TZ, false).unwrap().is_none());
    assert!(names(dest.path()).is_empty());
    assert_eq!(fs::read(data.path().join(ENC_FILE)).unwrap(), enc_before, "no record while locked");
}

#[test]
fn locking_during_the_backup_stops_it_without_leaving_anything() {
    let data = tempfile::tempdir().unwrap();
    let dest = tempfile::tempdir().unwrap();
    let mut store = seeded(data.path());
    store.enable(&pw(PW), true, false, FAST).unwrap();
    enable(store.conn(), data.path(), dest.path(), 10);
    let Decision::Run(p) = plan(Some(store.conn()), data.path(), NOW, TZ, false).unwrap() else { panic!() };
    let copied = p.stage(data.path()).unwrap().copy_database(store.conn(), data.path()).unwrap();
    store.close().map_err(|_| "close").unwrap(); // the application locks itself here
    assert_eq!(copied.finish().unwrap_err(), BackupError::Locked);
    assert!(names(dest.path()).is_empty());
}

#[test]
fn automatic_backups_restore_with_the_existing_restore() {
    // Plain.
    let data = tempfile::tempdir().unwrap();
    let dest = tempfile::tempdir().unwrap();
    let mut store = seeded(data.path());
    enable(store.conn(), data.path(), dest.path(), 10);
    let done = run(Some(store.conn()), data.path(), NOW, TZ, false).unwrap().unwrap().unwrap();
    account(store.conn(), "1"); // later work, undone by the restore
    let folder = dest.path().join(&done.name);
    store.restore_backup(&folder, true, None, NOW + H).unwrap();
    assert_eq!(trade_count(store.conn()), 2);
    assert_eq!(crate::accounts::list(store.conn()).unwrap().len(), 1);

    // Encrypted, restored with its password.
    let data2 = tempfile::tempdir().unwrap();
    let dest2 = tempfile::tempdir().unwrap();
    let mut store2 = seeded(data2.path());
    store2.enable(&pw(PW), true, false, FAST).unwrap();
    enable(store2.conn(), data2.path(), dest2.path(), 10);
    let done2 = run(Some(store2.conn()), data2.path(), NOW, TZ, false).unwrap().unwrap().unwrap();
    trades::delete(store2.conn(), 1).unwrap();
    let folder2 = dest2.path().join(&done2.name);
    assert!(matches!(store2.restore_backup(&folder2, true, None, NOW + H), Err(CoreError::Lock(LockError::BackupPasswordRequired))));
    store2.restore_backup(&folder2, true, Some(&pw(PW)), NOW + H).unwrap();
    assert_eq!(trade_count(store2.conn()), 2);
    // And into another, plain, Pulse (a new PC after a breakdown).
    let fresh = tempfile::tempdir().unwrap();
    let mut other = Store::open_plain(fresh.path()).unwrap();
    other.restore_backup(&folder2, true, Some(&pw(PW)), NOW + 2 * H).unwrap();
    assert_eq!(trade_count(other.conn()), 2);
    let shots = all_files(&fresh.path().join("screenshots"));
    assert_eq!(fs::read(&shots[0]).unwrap(), PNG, "screenshots decrypted into the plain Pulse");
}

// --- One at a time ---

#[test]
fn a_running_backup_or_restore_blocks_the_others() {
    let data = tempfile::tempdir().unwrap();
    let dest = tempfile::tempdir().unwrap();
    let mut store = seeded(data.path());
    enable(store.conn(), data.path(), dest.path(), 10);
    let held = exclusive(data.path()).unwrap();
    assert!(matches!(plan(Some(store.conn()), data.path(), NOW, TZ, false).unwrap(), Decision::Busy), "scheduled: skipped");
    assert!(matches!(run(Some(store.conn()), data.path(), NOW, TZ, true), Err(CoreError::Backup(BackupError::Busy))), "manual: refused");
    let other = tempfile::tempdir().unwrap();
    assert!(matches!(store.create_backup(other.path(), NOW), Err(CoreError::Backup(BackupError::Busy))));
    assert!(matches!(store.restore_backup(other.path(), true, None, NOW), Err(CoreError::Backup(BackupError::Busy))));
    assert_eq!(history(store.conn()).unwrap(), History::default(), "a skipped turn records nothing");
    drop(held);
    assert!(run(Some(store.conn()), data.path(), NOW, TZ, false).unwrap().unwrap().is_ok());
}

#[test]
fn two_simultaneous_runs_make_a_single_backup() {
    let data = tempfile::tempdir().unwrap();
    let dest = tempfile::tempdir().unwrap();
    let store = seeded(data.path());
    enable(store.conn(), data.path(), dest.path(), 10);
    drop(store);
    let barrier = Arc::new(std::sync::Barrier::new(2));
    let handles: Vec<_> = (0..2)
        .map(|_| {
            let (dir, barrier) = (data.path().to_path_buf(), barrier.clone());
            std::thread::spawn(move || {
                let conn = db::open(&dir).unwrap();
                barrier.wait();
                run(Some(&conn), &dir, NOW, TZ, false).unwrap().map(|r| r.is_ok())
            })
        })
        .collect();
    let results: Vec<Option<bool>> = handles.into_iter().map(|h| h.join().unwrap()).collect();
    assert_eq!(results.iter().filter(|r| **r == Some(true)).count(), 1, "{results:?}");
    assert_eq!(results.iter().filter(|r| r.is_none()).count(), 1, "the other one was skipped: {results:?}");
    assert_eq!(names(dest.path()), vec!["pulse-auto-20231114-2313"]);
}

// --- Status and invitation ---

#[test]
fn status_banner_and_invitation() {
    let data = tempfile::tempdir().unwrap();
    let dest = tempfile::tempdir().unwrap();
    let conn = db::open(data.path()).unwrap();
    // No trade yet: no invitation.
    assert!(!status(&conn, data.path(), NOW, TZ).unwrap().invite);
    let (acc, ins) = (account(&conn, "10000"), instrument(&conn, "EURUSD", "100000"));
    trades::create(&conn, &TradeData::new(acc, ins, Direction::Long, dec("1"), dec("1.1"), NOW)).unwrap();
    assert!(status(&conn, data.path(), NOW, TZ).unwrap().invite);
    // « Plus tard »: hidden 14 days, then shown once more; a second « Plus tard » ends it.
    answer_invite(&conn, NOW, false).unwrap();
    assert!(!status(&conn, data.path(), NOW + 14 * D - 1, TZ).unwrap().invite);
    assert!(status(&conn, data.path(), NOW + 14 * D, TZ).unwrap().invite);
    answer_invite(&conn, NOW + 14 * D, false).unwrap();
    assert!(!status(&conn, data.path(), NOW + 400 * D, TZ).unwrap().invite);

    // Enabled, one success: next due, banner after 2 × the frequency.
    enable(&conn, data.path(), dest.path(), 10);
    run(Some(&conn), data.path(), NOW, TZ, false).unwrap().unwrap().unwrap();
    let st = status(&conn, data.path(), NOW + H, TZ).unwrap();
    assert!(!st.invite && !st.stale && !st.last_failed && !st.encrypted);
    assert_eq!(st.next_due_at, Some(NOW + 12 * H), "23:13 + 12 h is already the next day");
    assert_eq!(st.days_since_success, Some(0));
    let st = status(&conn, data.path(), NOW + 2 * D, TZ).unwrap();
    assert!(!st.stale, "exactly 2 days: not yet");
    let st = status(&conn, data.path(), NOW + 2 * D + 1, TZ).unwrap();
    assert!(st.stale);
    assert_eq!(st.days_since_success, Some(2));
    // Weekly: 14 days.
    set_settings(&conn, data.path(), &AutoBackupSettings { frequency: Frequency::Weekly, ..get_settings(&conn).unwrap() }).unwrap();
    assert!(!status(&conn, data.path(), NOW + 13 * D, TZ).unwrap().stale);
    assert!(status(&conn, data.path(), NOW + 14 * D + 1, TZ).unwrap().stale);
    // Disabled: no banner, no next backup.
    set_settings(&conn, data.path(), &AutoBackupSettings { enabled: false, ..get_settings(&conn).unwrap() }).unwrap();
    let st = status(&conn, data.path(), NOW + 30 * D, TZ).unwrap();
    assert!(!st.stale && st.next_due_at.is_none());
}

#[test]
fn accepting_the_invitation_enables_nothing() {
    let data = tempfile::tempdir().unwrap();
    let conn = db::open(data.path()).unwrap();
    let (acc, ins) = (account(&conn, "10000"), instrument(&conn, "EURUSD", "100000"));
    trades::create(&conn, &TradeData::new(acc, ins, Direction::Long, dec("1"), dec("1.1"), NOW)).unwrap();
    answer_invite(&conn, NOW, true).unwrap();
    let st = status(&conn, data.path(), NOW, TZ).unwrap();
    assert!(!st.invite && !st.settings.enabled);
}
