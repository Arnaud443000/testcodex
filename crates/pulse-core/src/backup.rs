//! Manual backup and restore (spec 3.7).
//!
//! A backup is a folder holding `pulse.db` (a consistent copy made with
//! `VACUUM INTO`, safe while the app is running) and a `screenshots` folder.
//!
//! Restoring never touches the backup itself. The backup is checked first
//! (readable, healthy, known schema, not from a newer Pulse), migrated on a
//! temporary copy if it is older, the current database is saved to
//! `backups/` in the data folder, and only then are the pages of the live
//! database replaced with SQLite's online backup API. That works with the
//! connection the application keeps open, so no file is swapped underneath it.
//! Screenshots of the backup are copied in; none of the current ones is deleted.

use crate::db::DB_FILE;
use crate::error::{CoreError, Result};
use crate::{migrations, screenshots};
use rusqlite::{Connection, OpenFlags, backup};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    /// Folder of the backup.
    pub path: String,
    pub schema_version: u32,
    pub accounts: u32,
    pub trades: u32,
    pub screenshots: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RestoreResult {
    pub info: BackupInfo,
    /// Copy of the database as it was just before the restore.
    pub safety_copy: String,
}

fn invalid<T>(msg: impl Into<String>) -> Result<T> {
    Err(CoreError::Invalid(msg.into()))
}

/// Timestamp usable in a file name, from a UTC instant: "20261231-235959".
fn stamp(now_ms: i64) -> String {
    let secs = now_ms.div_euclid(1000);
    let day = crate::stats::time::day_key(now_ms, 0).replace('-', "");
    let s = secs.rem_euclid(86_400);
    format!("{day}-{:02}{:02}{:02}", s / 3600, s % 3600 / 60, s % 60)
}

/// Creates `pulse-backup-<stamp>` inside `dest_dir` (which must exist) and
/// returns what it contains.
pub fn create(conn: &Connection, data_dir: &Path, dest_dir: &Path, now_ms: i64) -> Result<BackupInfo> {
    if !dest_dir.is_dir() {
        return invalid("the destination folder does not exist");
    }
    let target = dest_dir.join(format!("pulse-backup-{}", stamp(now_ms)));
    if target.exists() {
        return invalid("a backup with this name already exists, try again in a moment");
    }
    fs::create_dir(&target)?;
    let result = (|| {
        conn.execute("VACUUM INTO ?1", [target.join(DB_FILE).to_string_lossy().as_ref()])?;
        copy_screenshots(&data_dir.join(screenshots::DIR), &target.join(screenshots::DIR))?;
        inspect(&target)
    })();
    if result.is_err() {
        // Do not leave a half-written backup that looks like a good one.
        let _ = fs::remove_dir_all(&target);
    }
    result
}

/// Checks that `folder` is a usable backup and describes it. Read-only.
pub fn inspect(folder: &Path) -> Result<BackupInfo> {
    let db_path = folder.join(DB_FILE);
    if !db_path.is_file() {
        return invalid("this folder does not contain a pulse.db file");
    }
    let conn = Connection::open_with_flags(&db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .and_then(|c| c.query_row("PRAGMA schema_version", [], |_| Ok(())).map(|_| c))
        .map_err(|_| CoreError::Invalid("pulse.db is not a readable database".into()))?;
    let version = migrations::current_version(&conn)?;
    if version > migrations::latest_version() {
        return Err(CoreError::SchemaTooNew { found: version, supported: migrations::latest_version() });
    }
    if version == 0 {
        return invalid("pulse.db is not a Pulse database");
    }
    let check: String = conn.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    if check != "ok" {
        return invalid("pulse.db is damaged (integrity check failed)");
    }
    let count = |table: &str| {
        conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get::<_, u32>(0))
            .map_err(|_| CoreError::Invalid(format!("pulse.db has no {table} table: not a Pulse database")))
    };
    // The trades table only exists from schema 2 on; older backups are still valid.
    let trades = if version >= 2 { count("trades")? } else { 0 };
    Ok(BackupInfo {
        path: folder.to_string_lossy().into_owned(),
        schema_version: version,
        accounts: count("accounts")?,
        trades,
        screenshots: count_files(&folder.join(screenshots::DIR)),
    })
}

/// Replaces the current data with the backup in `folder`. `confirmed` must be
/// true: the caller has shown what will be lost and the user agreed.
pub fn restore(conn: &mut Connection, data_dir: &Path, folder: &Path, confirmed: bool, now_ms: i64) -> Result<RestoreResult> {
    if !confirmed {
        return invalid("the restore was not confirmed");
    }
    let info = inspect(folder)?;

    // Work on a temporary copy so an older backup can be migrated without being modified.
    let tmp = tempdir_in(data_dir, now_ms)?;
    let outcome = (|| {
        let staged = tmp.join(DB_FILE);
        fs::copy(folder.join(DB_FILE), &staged)?;
        let mut src = Connection::open(&staged)?;
        migrations::migrate(&mut src)?;

        let safety = data_dir.join("backups").join(format!("pulse-avant-restauration-{}.db", stamp(now_ms)));
        fs::create_dir_all(data_dir.join("backups"))?;
        if safety.exists() {
            return invalid("a safety copy with this name already exists, try again in a moment");
        }
        conn.execute("VACUUM INTO ?1", [safety.to_string_lossy().as_ref()])?;

        backup::Backup::new(&src, conn)?.run_to_completion(256, Duration::ZERO, None)?;
        copy_screenshots(&folder.join(screenshots::DIR), &data_dir.join(screenshots::DIR))?;
        Ok(safety)
    })();
    let _ = fs::remove_dir_all(&tmp);
    Ok(RestoreResult { info, safety_copy: outcome?.to_string_lossy().into_owned() })
}

fn tempdir_in(data_dir: &Path, now_ms: i64) -> Result<PathBuf> {
    let dir = data_dir.join(format!("restore-tmp-{now_ms}"));
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn count_files(dir: &Path) -> u32 {
    fs::read_dir(dir).map(|d| d.filter_map(|e| e.ok()).filter(|e| e.path().is_file()).count() as u32).unwrap_or(0)
}

/// Copies every file of `from` into `to`, creating it; a missing `from` is fine
/// (no screenshot yet). Existing files with the same name are overwritten.
fn copy_screenshots(from: &Path, to: &Path) -> Result<()> {
    let Ok(entries) = fs::read_dir(from) else { return Ok(()) };
    fs::create_dir_all(to)?;
    for e in entries {
        let path = e?.path();
        if path.is_file() {
            fs::copy(&path, to.join(path.file_name().expect("file has a name")))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{account, dec, instrument};
    use crate::trades::{self, Direction, TradeData};
    use crate::{accounts, db};

    const NOW: i64 = 1_700_000_000_000; // 2023-11-14 22:13:20 UTC

    fn add_trade(conn: &Connection, acc: i64, ins: i64, entry: &str) {
        trades::create(conn, &TradeData::new(acc, ins, Direction::Long, dec("1.20"), dec(entry), NOW)).unwrap();
    }

    fn write_shot(data_dir: &Path, name: &str, bytes: &[u8]) {
        fs::create_dir_all(data_dir.join("screenshots")).unwrap();
        fs::write(data_dir.join("screenshots").join(name), bytes).unwrap();
    }

    #[test]
    fn stamp_is_utc_and_sortable() {
        assert_eq!(stamp(NOW), "20231114-221320");
        assert_eq!(stamp(0), "19700101-000000");
    }

    #[test]
    fn backup_copies_database_and_screenshots_while_the_app_runs() {
        let data = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();
        let conn = db::open(data.path()).unwrap(); // real file in WAL mode, like the app
        let (acc, ins) = (account(&conn, "10000"), instrument(&conn, "EURUSD", "100000"));
        add_trade(&conn, acc, ins, "1.0842");
        write_shot(data.path(), "a.png", b"AAA");
        let info = create(&conn, data.path(), dest.path(), NOW).unwrap();
        assert!(info.path.ends_with("pulse-backup-20231114-221320"));
        assert_eq!((info.accounts, info.trades, info.screenshots), (1, 1, 1));
        assert_eq!(info.schema_version, migrations::latest_version());
        let folder = dest.path().join("pulse-backup-20231114-221320");
        assert_eq!(fs::read(folder.join("screenshots/a.png")).unwrap(), b"AAA");
        // The copy is a stand-alone database with the exact stored decimals.
        let copy = Connection::open(folder.join(DB_FILE)).unwrap();
        let entry: String = copy.query_row("SELECT entry_price FROM trades", [], |r| r.get(0)).unwrap();
        assert_eq!(entry, "1.0842");
        // Same second again: refuses instead of mixing two backups.
        assert!(create(&conn, data.path(), dest.path(), NOW).is_err());
    }

    #[test]
    fn backup_into_a_missing_folder_is_refused_and_leaves_nothing() {
        let data = tempfile::tempdir().unwrap();
        let conn = db::open(data.path()).unwrap();
        assert!(create(&conn, data.path(), &data.path().join("nope"), NOW).is_err());
    }

    #[test]
    fn restore_replaces_data_keeps_a_safety_copy_and_the_live_connection_works() {
        let data = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();
        let mut conn = db::open(data.path()).unwrap();
        let (acc, ins) = (account(&conn, "10000"), instrument(&conn, "EURUSD", "100000"));
        add_trade(&conn, acc, ins, "1.0842");
        write_shot(data.path(), "old.png", b"OLD");
        let backup_info = create(&conn, data.path(), dest.path(), NOW).unwrap();
        let folder = PathBuf::from(&backup_info.path);

        // Later work that the restore must undo (and the safety copy must keep).
        add_trade(&conn, acc, ins, "1.1000");
        add_trade(&conn, acc, ins, "1.2000");
        write_shot(data.path(), "new.png", b"NEW");
        assert_eq!(trade_count(&conn), 3);

        let res = restore(&mut conn, data.path(), &folder, true, NOW + 60_000).unwrap();
        assert_eq!(res.info.trades, 1);
        assert_eq!(trade_count(&conn), 1, "back to the state of the backup");
        assert_eq!(accounts::list(&conn).unwrap().len(), 1);
        assert_eq!(fs::read(data.path().join("screenshots/old.png")).unwrap(), b"OLD");
        assert!(data.path().join("screenshots/new.png").exists(), "no current screenshot is deleted");

        let safety = Connection::open(&res.safety_copy).unwrap();
        assert_eq!(trade_count(&safety), 3, "the safety copy holds the data from before the restore");
        assert!(res.safety_copy.contains("pulse-avant-restauration-20231114-221420"));

        // The connection the app keeps open still works, and the change is on disk.
        add_trade(&conn, acc, ins, "1.3000");
        drop(conn);
        assert_eq!(trade_count(&db::open(data.path()).unwrap()), 2);
        assert!(!fs::read_dir(data.path()).unwrap().any(|e| e.unwrap().file_name().to_string_lossy().starts_with("restore-tmp")));
        // The backup folder itself was not modified.
        assert_eq!(trade_count(&Connection::open(folder.join(DB_FILE)).unwrap()), 1);
    }

    fn trade_count(conn: &Connection) -> i64 {
        conn.query_row("SELECT COUNT(*) FROM trades", [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn restore_needs_explicit_confirmation() {
        let data = tempfile::tempdir().unwrap();
        let dest = tempfile::tempdir().unwrap();
        let mut conn = db::open(data.path()).unwrap();
        let info = create(&conn, data.path(), dest.path(), NOW).unwrap();
        account(&conn, "1");
        assert!(restore(&mut conn, data.path(), Path::new(&info.path), false, NOW).is_err());
        assert_eq!(accounts::list(&conn).unwrap().len(), 1, "nothing changed");
        assert!(!data.path().join("backups").exists(), "no safety copy for a refused restore");
    }

    #[test]
    fn an_older_backup_is_migrated_on_a_copy_and_stays_untouched() {
        let data = tempfile::tempdir().unwrap();
        let old = tempfile::tempdir().unwrap();
        {
            let mut c = Connection::open(old.path().join(DB_FILE)).unwrap();
            migrations::migrate_to(&mut c, 1).unwrap();
            c.execute("INSERT INTO accounts (name, kind, initial_capital) VALUES ('Old', 'personal', 12345.67)", []).unwrap();
        }
        let info = inspect(old.path()).unwrap();
        assert_eq!((info.schema_version, info.accounts, info.trades), (1, 1, 0));
        let mut conn = db::open(data.path()).unwrap();
        restore(&mut conn, data.path(), old.path(), true, NOW).unwrap();
        assert_eq!(migrations::current_version(&conn).unwrap(), migrations::latest_version());
        let all = accounts::list(&conn).unwrap();
        assert_eq!((all.len(), all[0].name.as_str(), all[0].initial_capital.to_string().as_str()), (1, "Old", "12345.67"));
        let v: u32 = Connection::open(old.path().join(DB_FILE)).unwrap().query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, 1, "the backup file is still at its original version");
    }

    #[test]
    fn invalid_backups_are_rejected_and_the_data_is_kept() {
        let data = tempfile::tempdir().unwrap();
        let mut conn = db::open(data.path()).unwrap();
        account(&conn, "10000");
        let bad = tempfile::tempdir().unwrap();

        // No pulse.db.
        assert!(restore(&mut conn, data.path(), bad.path(), true, NOW).is_err());
        // Not a database at all.
        fs::write(bad.path().join(DB_FILE), b"this is not sqlite, just some text long enough to be read").unwrap();
        assert!(matches!(inspect(bad.path()), Err(CoreError::Invalid(_))));
        // A valid SQLite file that is not Pulse (user_version 0).
        fs::remove_file(bad.path().join(DB_FILE)).unwrap();
        Connection::open(bad.path().join(DB_FILE)).unwrap().execute_batch("CREATE TABLE x (a); INSERT INTO x VALUES (1);").unwrap();
        assert!(matches!(inspect(bad.path()), Err(CoreError::Invalid(_))));
        // Schema of a newer Pulse.
        let newer = tempfile::tempdir().unwrap();
        {
            let c = Connection::open(newer.path().join(DB_FILE)).unwrap();
            c.execute_batch("CREATE TABLE accounts (a); CREATE TABLE trades (a);").unwrap();
            c.pragma_update(None, "user_version", 999u32).unwrap();
        }
        assert!(matches!(restore(&mut conn, data.path(), newer.path(), true, NOW), Err(CoreError::SchemaTooNew { found: 999, .. })));
        // Right version but missing tables.
        let hollow = tempfile::tempdir().unwrap();
        Connection::open(hollow.path().join(DB_FILE)).unwrap().pragma_update(None, "user_version", 2u32).unwrap();
        assert!(matches!(inspect(hollow.path()), Err(CoreError::Invalid(_))));

        assert_eq!(accounts::list(&conn).unwrap().len(), 1, "current data untouched after every refusal");
        assert!(!data.path().join("backups").exists(), "no safety copy when validation fails");
    }
}
