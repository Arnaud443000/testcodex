//! Lock tests: real files in temporary folders, obvious throwaway passwords, cheap Argon2id
//! parameters (`INSECURE_FAST_FOR_TESTS`; the application always uses `RECOMMENDED`).

use super::files::{FAIL_AT, LockState, Transition};
use super::*;
use crate::cash_flows::{self, CashFlowKind, NewCashFlow};
use crate::db::{self, DB_FILE};
use crate::screenshots;
use crate::tags::{self, TagKind};
use crate::test_support::{account, dec, instrument};
use crate::trades::{self, Direction, TradeData};
use crate::{accounts, backup, migrations};
use rusqlite::types::ValueRef;
use std::fs;
use std::path::{Path, PathBuf};

const FAST: KdfParams = KdfParams::INSECURE_FAST_FOR_TESTS;
const NOW: i64 = 1_700_000_000_000;
const PNG: &[u8] = b"\x89PNG\r\n\x1a\nCAPTURE-CANARI-PIXELS";

fn pw(s: &str) -> Password {
    Password::new(s.into())
}

/// Every row of every table, as text, sorted: two databases with the same dump hold the same data.
fn dump(conn: &Connection) -> Vec<(String, Vec<String>)> {
    let tables: Vec<String> = conn
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
        .unwrap()
        .query_map([], |r| r.get(0))
        .unwrap()
        .map(|r| r.unwrap())
        .collect();
    tables
        .into_iter()
        .map(|t| {
            let mut stmt = conn.prepare(&format!("SELECT * FROM \"{t}\"")).unwrap();
            let n = stmt.column_count();
            let mut rows: Vec<String> = stmt
                .query_map([], |r| {
                    Ok((0..n)
                        .map(|i| match r.get_ref(i).unwrap() {
                            ValueRef::Null => "∅".to_string(),
                            ValueRef::Integer(v) => v.to_string(),
                            ValueRef::Real(v) => v.to_string(),
                            ValueRef::Text(v) => String::from_utf8_lossy(v).into_owned(),
                            ValueRef::Blob(v) => format!("{v:?}"),
                        })
                        .collect::<Vec<_>>()
                        .join("|"))
                })
                .unwrap()
                .map(|r| r.unwrap())
                .collect();
            rows.sort();
            (t, rows)
        })
        .collect()
}

/// A plain database with accounts, an instrument, trades (thesis, tags), a custom tag, a
/// deposit and a screenshot; "CANARI" marks text that must never appear in an encrypted file.
fn seeded(dir: &Path) -> (Store, String) {
    let store = Store::open_plain(dir).unwrap();
    let conn = store.conn();
    let acc = account(conn, "10000");
    accounts::create(
        conn,
        &accounts::NewAccount { name: "Compte-CANARI".into(), kind: "prop".into(), broker: "Courtier-CANARI".into(), currency: "EUR".into(), initial_capital: dec("25000") },
    )
    .unwrap();
    let ins = instrument(conn, "EURUSD", "100000");
    let tag = tags::create(conn, TagKind::Setup, "Setup-CANARI").unwrap();
    let shot = screenshots::save_base64(dir, &screenshots::encode(PNG)).unwrap();
    for (i, exit) in ["1.0900", "1.0800", "1.0875"].iter().enumerate() {
        let mut t = TradeData::new(acc, ins, Direction::Long, dec("1.20"), dec("1.0842"), NOW + i as i64 * 3_600_000);
        t.exit_price = Some(dec(exit));
        t.exit_time = Some(NOW + i as i64 * 3_600_000 + 60_000);
        t.planned_sl = Some(dec("1.0800"));
        t.thesis = "These-CANARI cassure du range".into();
        t.tag_ids = vec![tag.id];
        if i == 0 {
            t.screenshot_path = Some(shot.clone());
        }
        trades::create(conn, &t).unwrap();
    }
    cash_flows::create(conn, &NewCashFlow { account_id: acc, kind: CashFlowKind::Deposit, amount: dec("500"), occurred_at: NOW, tz_offset_min: 60, note: "Depot-CANARI".into() }).unwrap();
    (store, shot)
}

fn all_files(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for e in fs::read_dir(dir).unwrap() {
        let p = e.unwrap().path();
        if p.is_dir() { out.extend(all_files(&p)) } else { out.push(p) }
    }
    out.sort();
    out
}

fn contains(hay: &[u8], needle: &[u8]) -> bool {
    hay.windows(needle.len()).any(|w| w == needle)
}

/// Opens the data folder as the application would at startup.
fn reopen(dir: &Path, password: &str) -> Store {
    let info = startup(dir).unwrap();
    if info.encrypted { Store::unlock(dir, &pw(password), NOW).unwrap() } else { Store::open_plain(dir).unwrap() }
}

fn fail_at(step: &'static str) {
    FAIL_AT.with(|f| *f.borrow_mut() = Some(step));
}

#[test]
fn without_the_lock_nothing_changes() {
    let dir = tempfile::tempdir().unwrap();
    let (store, _) = seeded(dir.path());
    let before = dump(store.conn());
    drop(store);
    let files_before = all_files(dir.path());
    let info = startup(dir.path()).unwrap();
    assert_eq!(info, StartupInfo { encrypted: false, warning: None });
    assert_eq!(all_files(dir.path()), files_before, "startup reads names only and writes nothing");
    assert!(!dir.path().join(STATE_FILE).exists());
    let store = Store::open_plain(dir.path()).unwrap();
    assert!(!store.is_encrypted());
    assert_eq!(dump(store.conn()), before);
    assert!(current_keys(dir.path()).is_none(), "no key registered for a plain folder");
    let st = status(dir.path(), Some(&store), None, NOW).unwrap();
    assert!(!st.enabled && !st.locked && st.idle_minutes.is_none());
}

#[test]
fn enable_then_disable_round_trip_keeps_every_row_and_screenshot() {
    let dir = tempfile::tempdir().unwrap();
    let (mut store, shot) = seeded(dir.path());
    let before = dump(store.conn());
    store.enable(&pw("phrase de test jetable"), true, false, FAST).unwrap();
    assert!(store.is_encrypted());
    assert!(!dir.path().join(DB_FILE).exists(), "the plaintext database is gone");
    assert!(dir.path().join(ENC_FILE).exists());
    assert!(!dir.path().join(STATE_FILE).exists() || LockState::load(dir.path()).transition.is_none());
    assert_eq!(dump(store.conn()), before, "same data in memory");
    assert_eq!(screenshots::read_image(dir.path(), &shot).unwrap().0, PNG, "screenshot readable while unlocked");

    // Lock (close), then unlock like at the next launch.
    store.close().map_err(|b| b.1).unwrap();
    assert!(current_keys(dir.path()).is_none(), "keys forgotten once locked");
    assert!(matches!(screenshots::read_image(dir.path(), &shot), Err(crate::CoreError::Lock(LockError::Locked))));
    let info = startup(dir.path()).unwrap();
    assert!(info.encrypted);
    let mut store = Store::unlock(dir.path(), &pw("phrase de test jetable"), NOW).unwrap();
    assert_eq!(dump(store.conn()), before, "every table identical after unlock");

    // New data while encrypted is written to the file.
    account(store.conn(), "777");
    let with_new = dump(store.conn());
    store.flush().unwrap();
    drop(store);
    let mut store = Store::unlock(dir.path(), &pw("phrase de test jetable"), NOW).unwrap();
    assert_eq!(dump(store.conn()), with_new);

    store.disable(&pw("phrase de test jetable"), NOW).unwrap();
    assert!(!store.is_encrypted());
    assert!(dir.path().join(DB_FILE).exists() && !dir.path().join(ENC_FILE).exists());
    assert_eq!(dump(store.conn()), with_new);
    drop(store);
    let (store, _) = (Store::open_plain(dir.path()).unwrap(), ());
    assert_eq!(dump(store.conn()), with_new, "back to a plain pulse.db with the same rows");
    assert_eq!(fs::read(dir.path().join(&shot)).unwrap(), PNG, "screenshot decrypted on disk");
    let plain = rusqlite::Connection::open(dir.path().join(DB_FILE)).unwrap();
    let n: i64 = plain.query_row("SELECT COUNT(*) FROM trades", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 3, "an ordinary SQLite file again");
}

#[test]
fn encrypted_files_are_unreadable_without_the_key() {
    let dir = tempfile::tempdir().unwrap();
    let (mut store, shot) = seeded(dir.path());
    store.enable(&pw("phrase de test jetable"), true, false, FAST).unwrap();
    drop(store);
    let enc = fs::read(dir.path().join(ENC_FILE)).unwrap();
    assert!(enc.starts_with(b"PULSEENC"));
    assert!(!enc.starts_with(b"SQLite format 3"), "the header is not a plain SQLite one");
    for canary in [&b"CANARI"[..], b"These-", b"CREATE TABLE", b"EURUSD"] {
        assert!(!contains(&enc, canary), "{:?} must not be readable in the file", String::from_utf8_lossy(canary));
    }
    assert!(rusqlite::Connection::open(dir.path().join(ENC_FILE)).unwrap().query_row("SELECT COUNT(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0)).is_err(), "SQLite cannot read it");
    let shot_bytes = fs::read(dir.path().join(&shot)).unwrap();
    assert!(shot_bytes.starts_with(b"PULSEIMG") && !contains(&shot_bytes, b"CANARI") && !contains(&shot_bytes, b"PNG"));
    // No file of the folder is a plaintext database or holds the canary.
    for f in all_files(dir.path()) {
        let bytes = fs::read(&f).unwrap();
        assert!(!bytes.starts_with(b"SQLite format 3"), "{f:?} is a plaintext database");
        assert!(!contains(&bytes, b"CANARI"), "{f:?} leaks data");
    }
}

#[test]
fn a_pause_is_not_readable_in_the_encrypted_folder_and_comes_back_after_unlocking() {
    let dir = tempfile::tempdir().unwrap();
    let (mut store, _) = seeded(dir.path());
    crate::pause::start(
        store.conn(),
        &crate::pause::NewPause { length: crate::pause::PauseLength::Minutes { minutes: 60 }, reason: Some("emotion".into()), note: Some("Pause-CANARI".into()), tz_offset_min: 0 },
        NOW,
    )
    .unwrap();
    store.enable(&pw("phrase de test jetable"), true, false, FAST).unwrap();
    drop(store);
    for f in all_files(dir.path()) {
        let bytes = fs::read(&f).unwrap();
        assert!(!contains(&bytes, b"Pause-CANARI") && !contains(&bytes, b"CREATE TABLE pauses"), "{f:?} leaks a pause");
    }
    // Locked: no store, so nothing can be read or written (the shell answers `lock:locked`).
    let again = Store::unlock(dir.path(), &pw("phrase de test jetable"), NOW).unwrap();
    let c = crate::pause::current(again.conn(), NOW + 20 * 60_000).unwrap().unwrap();
    assert_eq!((c.remaining_min, c.pause.note.as_deref()), (40, Some("Pause-CANARI")), "the reminder returns after unlocking while the pause runs");
    assert_eq!(crate::pause::current(again.conn(), NOW + 61 * 60_000).unwrap(), None);
}

#[test]
fn wrong_passwords_are_refused_slowed_down_and_never_delete_anything() {
    let dir = tempfile::tempdir().unwrap();
    let (mut store, _) = seeded(dir.path());
    let before = dump(store.conn());
    store.enable(&pw("phrase de test jetable"), true, false, FAST).unwrap();
    drop(store);
    let enc_before = fs::read(dir.path().join(ENC_FILE)).unwrap();
    for i in 0..3 {
        let e = Store::unlock(dir.path(), &pw("mauvais mot de passe"), NOW + i).err().unwrap();
        assert!(matches!(e, crate::CoreError::Lock(LockError::WrongPassword)), "{e}");
    }
    // Fourth try right away: delay, even with the right password; survives a restart (file).
    let e = Store::unlock(dir.path(), &pw("phrase de test jetable"), NOW + 3).err().unwrap();
    assert!(matches!(e, crate::CoreError::Lock(LockError::RetryLater(ms)) if ms > 4_000 && ms <= 5_000), "{e}");
    assert_eq!(status(dir.path(), None, None, NOW + 3).unwrap().failures, 3);
    assert_eq!(fs::read(dir.path().join(ENC_FILE)).unwrap(), enc_before, "nothing touched");
    // After the delay, another wrong one doubles it.
    Store::unlock(dir.path(), &pw("mauvais mot de passe"), NOW + 6_000).err().unwrap();
    assert_eq!(status(dir.path(), None, None, NOW + 6_000).unwrap().retry_after_ms, 10_000);
    // The right one after the delay: data intact, counter reset.
    let store = Store::unlock(dir.path(), &pw("phrase de test jetable"), NOW + 20_000).unwrap();
    assert_eq!(dump(store.conn()), before);
    assert_eq!(status(dir.path(), Some(&store), None, NOW + 20_000).unwrap().failures, 0);
    // Error messages are codes, never the password.
    assert_eq!(LockError::WrongPassword.to_string(), "lock:wrongPassword");
}

#[test]
fn activation_is_refused_without_confirmation_or_with_a_short_password() {
    let dir = tempfile::tempdir().unwrap();
    let (mut store, _) = seeded(dir.path());
    let e = store.enable(&pw("phrase de test jetable"), false, false, FAST).unwrap_err();
    assert!(matches!(e, crate::CoreError::Lock(LockError::NotConfirmed)));
    let e = store.enable(&pw("court"), true, false, FAST).unwrap_err();
    assert!(matches!(e, crate::CoreError::Lock(LockError::PasswordTooShort)));
    assert!(!store.is_encrypted() && !dir.path().join(ENC_FILE).exists() && dir.path().join(DB_FILE).exists());
    assert!(matches!(store.disable(&pw("phrase de test jetable"), NOW).unwrap_err(), crate::CoreError::Lock(LockError::NotEncrypted)));
    store.enable(&pw("phrase de test jetable"), true, false, FAST).unwrap();
    assert!(matches!(store.enable(&pw("phrase de test jetable"), true, false, FAST).unwrap_err(), crate::CoreError::Lock(LockError::AlreadyEncrypted)));
    assert!(matches!(store.disable(&pw("mauvais mot de passe"), NOW).unwrap_err(), crate::CoreError::Lock(LockError::WrongPassword)));
    assert!(store.is_encrypted(), "a wrong password disables nothing");
}

#[test]
fn a_failure_at_any_step_of_the_activation_leaves_the_original_database() {
    for step in ["enable:start", "enable:written", "enable:verified", "enable:renamed", "enable:closed"] {
        let dir = tempfile::tempdir().unwrap();
        let (mut store, shot) = seeded(dir.path());
        let before = dump(store.conn());
        fail_at(step);
        assert!(store.enable(&pw("phrase de test jetable"), true, false, FAST).is_err(), "{step}");
        assert!(!store.is_encrypted(), "{step}: still plain");
        assert_eq!(dump(store.conn()), before, "{step}: the open database still works");
        account(store.conn(), "1"); // and still writes to pulse.db
        let after = dump(store.conn());
        drop(store);
        assert!(!dir.path().join(ENC_FILE).exists(), "{step}: no encrypted leftover");
        let store = reopen(dir.path(), "");
        assert!(!store.is_encrypted());
        assert_eq!(dump(store.conn()), after, "{step}");
        assert_eq!(fs::read(dir.path().join(&shot)).unwrap(), PNG, "{step}: screenshot untouched");
    }
}

#[test]
fn a_failure_after_the_switch_is_finished_at_the_next_unlock() {
    for step in ["enable:switched", "enable:screenshots"] {
        let dir = tempfile::tempdir().unwrap();
        let (mut store, shot) = seeded(dir.path());
        let before = dump(store.conn());
        fail_at(step);
        assert!(store.enable(&pw("phrase de test jetable"), true, false, FAST).is_err());
        assert!(store.is_encrypted(), "{step}: the switch happened");
        drop(store);
        assert_eq!(LockState::load(dir.path()).transition, Some(Transition::Enable));
        let store = reopen(dir.path(), "phrase de test jetable");
        assert_eq!(dump(store.conn()), before, "{step}");
        assert!(fs::read(dir.path().join(&shot)).unwrap().starts_with(b"PULSEIMG"), "{step}: screenshots encrypted after unlock");
        assert_eq!(LockState::load(dir.path()).transition, None);
    }
}

#[test]
fn a_crash_during_the_activation_is_resolved_at_startup() {
    // Crash after the encrypted file was renamed but before pulse.db was deleted: pulse.db wins.
    let dir = tempfile::tempdir().unwrap();
    let (store, _) = seeded(dir.path());
    let before = dump(store.conn());
    drop(store);
    let keys = pulse_lock::Unlocked::create(&pw("phrase de test jetable"), FAST).unwrap();
    fs::write(dir.path().join(ENC_FILE), keys.seal(b"SQLite format 3\0partial").unwrap()).unwrap();
    fs::write(dir.path().join(format!("{ENC_FILE}.tmp")), b"half written").unwrap();
    LockState::set_transition(dir.path(), Some(Transition::Enable)).unwrap();
    let info = startup(dir.path()).unwrap();
    assert_eq!(info, StartupInfo { encrypted: false, warning: None });
    assert!(!dir.path().join(ENC_FILE).exists() && !dir.path().join(format!("{ENC_FILE}.tmp")).exists());
    assert_eq!(dump(Store::open_plain(dir.path()).unwrap().conn()), before);
    assert_eq!(LockState::load(dir.path()).transition, None);
}

#[test]
fn unexplained_double_files_are_left_alone() {
    let dir = tempfile::tempdir().unwrap();
    let (store, _) = seeded(dir.path());
    drop(store);
    fs::write(dir.path().join(ENC_FILE), b"PULSEENC something").unwrap();
    let info = startup(dir.path()).unwrap();
    assert_eq!(info, StartupInfo { encrypted: false, warning: Some("lock:inconsistentFiles".into()) });
    assert!(dir.path().join(ENC_FILE).exists() && dir.path().join(DB_FILE).exists(), "nothing deleted");
}

#[test]
fn a_failure_at_any_step_of_the_deactivation_keeps_the_encrypted_database() {
    for step in ["disable:start", "disable:screenshots", "disable:written", "disable:verified"] {
        let dir = tempfile::tempdir().unwrap();
        let (mut store, shot) = seeded(dir.path());
        let before = dump(store.conn());
        store.enable(&pw("phrase de test jetable"), true, false, FAST).unwrap();
        fail_at(step);
        assert!(store.disable(&pw("phrase de test jetable"), NOW).is_err(), "{step}");
        assert!(store.is_encrypted(), "{step}: still encrypted");
        assert!(fs::read(dir.path().join(&shot)).unwrap().starts_with(b"PULSEIMG"), "{step}: screenshots encrypted again");
        assert!(!dir.path().join(DB_FILE).exists() && !dir.path().join(format!("{DB_FILE}.tmp")).exists(), "{step}: no plaintext file left");
        drop(store);
        let store = reopen(dir.path(), "phrase de test jetable");
        assert!(store.is_encrypted());
        assert_eq!(dump(store.conn()), before, "{step}");
    }
}

#[test]
fn a_crash_right_after_the_deactivation_switch_keeps_the_plain_database() {
    for step in ["disable:renamed", "disable:switched"] {
        let dir = tempfile::tempdir().unwrap();
        let (mut store, shot) = seeded(dir.path());
        let before = dump(store.conn());
        store.enable(&pw("phrase de test jetable"), true, false, FAST).unwrap();
        fail_at(step);
        assert!(store.disable(&pw("phrase de test jetable"), NOW).is_err());
        drop(store);
        let store = reopen(dir.path(), "");
        assert!(!store.is_encrypted(), "{step}");
        assert!(!dir.path().join(ENC_FILE).exists(), "{step}: encrypted leftover removed");
        assert_eq!(dump(store.conn()), before, "{step}");
        assert_eq!(fs::read(dir.path().join(&shot)).unwrap(), PNG);
    }
}

#[test]
fn password_change_and_old_backups() {
    let dir = tempfile::tempdir().unwrap();
    let dest = tempfile::tempdir().unwrap();
    let (mut store, shot) = seeded(dir.path());
    let before = dump(store.conn());
    store.enable(&pw("ancien mot de passe"), true, false, FAST).unwrap();
    let old_backup = store.create_backup(dest.path(), NOW).unwrap();
    assert!(matches!(
        store.change_password(&pw("pas le bon du tout"), &pw("nouveau mot de passe"), FAST, NOW).unwrap_err(),
        crate::CoreError::Lock(LockError::WrongPassword)
    ));
    assert!(matches!(store.change_password(&pw("ancien mot de passe"), &pw("court"), FAST, NOW + 1).unwrap_err(), crate::CoreError::Lock(LockError::PasswordTooShort)));
    fail_at("password:written");
    assert!(store.change_password(&pw("ancien mot de passe"), &pw("nouveau mot de passe"), FAST, NOW + 2).is_err());
    drop(store);
    // The failed change left the old password in force.
    let mut store = Store::unlock(dir.path(), &pw("ancien mot de passe"), NOW + 3).unwrap();
    store.change_password(&pw("ancien mot de passe"), &pw("nouveau mot de passe"), FAST, NOW + 4).unwrap();
    drop(store);
    assert!(Store::unlock(dir.path(), &pw("ancien mot de passe"), NOW + 5).is_err());
    let store = Store::unlock(dir.path(), &pw("nouveau mot de passe"), NOW + 6).unwrap();
    assert_eq!(dump(store.conn()), before);
    assert_eq!(screenshots::read_image(dir.path(), &shot).unwrap().0, PNG, "same data key: screenshots unchanged");
    // The backup made before the change still opens with the password of its time.
    let folder = Path::new(&old_backup.path);
    assert!(inspect_backup(dir.path(), folder, Some(&pw("nouveau mot de passe")), NOW + 7).is_err());
    assert_eq!(inspect_backup(dir.path(), folder, Some(&pw("ancien mot de passe")), NOW + 8).unwrap().trades, 3);
}

#[test]
fn backup_and_restore_of_an_encrypted_database() {
    let dir = tempfile::tempdir().unwrap();
    let dest = tempfile::tempdir().unwrap();
    let (mut store, shot) = seeded(dir.path());
    let before = dump(store.conn());
    store.enable(&pw("phrase de test jetable"), true, false, FAST).unwrap();
    let info = store.create_backup(dest.path(), NOW).unwrap();
    assert!(info.encrypted);
    assert_eq!((info.accounts, info.trades, info.screenshots), (2, 3, 1));
    let folder = PathBuf::from(&info.path);
    assert!(folder.join(ENC_FILE).exists() && !folder.join(DB_FILE).exists(), "no plaintext copy in a backup");
    for f in all_files(&folder) {
        let b = fs::read(&f).unwrap();
        assert!(!b.starts_with(b"SQLite format 3") && !contains(&b, b"CANARI"), "{f:?}");
    }
    assert!(matches!(backup::inspect(&folder).unwrap_err(), crate::CoreError::Lock(LockError::BackupPasswordRequired)));
    assert!(matches!(inspect_backup(dir.path(), &folder, Some(&pw("mauvais mot de passe")), NOW).unwrap_err(), crate::CoreError::Lock(LockError::WrongPassword)));

    // Changes after the backup, then restore it.
    account(store.conn(), "5");
    store.flush().unwrap();
    assert!(matches!(store.restore_backup(&folder, true, None, NOW + 1).unwrap_err(), crate::CoreError::Lock(LockError::BackupPasswordRequired)));
    let res = store.restore_backup(&folder, true, Some(&pw("phrase de test jetable")), NOW + 2).unwrap();
    assert_eq!(dump(store.conn()), before, "back to the backup");
    assert!(res.safety_copy.ends_with(".db.enc"), "the safety copy is encrypted too");
    assert!(fs::read(&res.safety_copy).unwrap().starts_with(b"PULSEENC"));
    drop(store);
    let store = Store::unlock(dir.path(), &pw("phrase de test jetable"), NOW + 3).unwrap();
    assert_eq!(dump(store.conn()), before, "the restore was written to the encrypted file");
    assert_eq!(screenshots::read_image(dir.path(), &shot).unwrap().0, PNG);
    drop(store);

    // The same encrypted backup restored into a plain database (another install): needs its
    // password, ends up in plaintext with readable screenshots.
    let other = tempfile::tempdir().unwrap();
    let mut plain = Store::open_plain(other.path()).unwrap();
    plain.restore_backup(&folder, true, Some(&pw("phrase de test jetable")), NOW + 4).unwrap();
    assert!(!plain.is_encrypted());
    assert_eq!(dump(plain.conn()), before);
    assert_eq!(fs::read(other.path().join(&shot)).unwrap(), PNG);
    assert!(!other.path().join(ENC_FILE).exists());
    let leftovers: Vec<_> = fs::read_dir(other.path()).unwrap().filter_map(|e| e.ok()).filter(|e| e.file_name().to_string_lossy().starts_with("restore-tmp")).collect();
    assert!(leftovers.is_empty(), "no staging folder: staged in memory");
}

#[test]
fn a_plain_backup_restores_into_an_encrypted_database() {
    let dir = tempfile::tempdir().unwrap();
    let dest = tempfile::tempdir().unwrap();
    let (mut store, shot) = seeded(dir.path());
    let before = dump(store.conn());
    let plain_backup = store.create_backup(dest.path(), NOW).unwrap();
    assert!(!plain_backup.encrypted);
    store.enable(&pw("phrase de test jetable"), true, false, FAST).unwrap();
    account(store.conn(), "5");
    store.restore_backup(Path::new(&plain_backup.path), true, None, NOW + 1).unwrap();
    assert_eq!(dump(store.conn()), before);
    assert!(fs::read(dir.path().join(&shot)).unwrap().starts_with(b"PULSEIMG"), "screenshots stay encrypted");
    for f in all_files(dir.path()) {
        assert!(!fs::read(&f).unwrap().starts_with(b"SQLite format 3"), "{f:?}: no plaintext file after the restore");
    }
}

#[test]
fn every_existing_migration_runs_on_an_encrypted_database() {
    let latest = migrations::latest_version();
    for from in 1..latest {
        let dir = tempfile::tempdir().unwrap();
        let mut conn = rusqlite::Connection::open_in_memory().unwrap();
        migrations::migrate_to(&mut conn, from).unwrap();
        conn.execute("INSERT INTO accounts (name, kind, initial_capital) VALUES ('Ancien', 'personal', '12345.67')", []).unwrap();
        let image = conn.serialize(rusqlite::MAIN_DB).unwrap().to_vec();
        let keys = pulse_lock::Unlocked::create(&pw("phrase de test jetable"), FAST).unwrap();
        fs::write(dir.path().join(ENC_FILE), keys.seal(&image).unwrap()).unwrap();

        let store = Store::unlock(dir.path(), &pw("phrase de test jetable"), NOW).unwrap();
        assert_eq!(migrations::current_version(store.conn()).unwrap(), latest, "from v{from}");
        let all = accounts::list(store.conn()).unwrap();
        assert_eq!((all[0].name.as_str(), all[0].initial_capital.to_string().as_str()), ("Ancien", "12345.67"), "from v{from}");
        let ok: String = store.conn().query_row("PRAGMA integrity_check", [], |r| r.get(0)).unwrap();
        assert_eq!(ok, "ok");
        // The automatic copy before migration is the encrypted file, still at its old version.
        let copy = dir.path().join("backups").join(format!("pulse-pre-migration-v{from}.db.enc"));
        let (mut img, _) = pulse_lock::envelope::open(&fs::read(&copy).unwrap(), &pw("phrase de test jetable")).unwrap();
        assert_eq!(migrations::current_version(&store::memory_conn(&mut img).unwrap()).unwrap(), from);
        drop(store);
        // The migrated database was written back (encrypted) and reopens without migrating.
        let again = Store::unlock(dir.path(), &pw("phrase de test jetable"), NOW).unwrap();
        assert_eq!(migrations::current_version(again.conn()).unwrap(), latest);
        assert!(!fs::read(dir.path().join(ENC_FILE)).unwrap().starts_with(b"SQLite"));
    }
}

#[test]
fn a_database_from_a_newer_pulse_is_refused_when_encrypted_too() {
    let dir = tempfile::tempdir().unwrap();
    let conn = db::open_in_memory().unwrap();
    conn.pragma_update(None, "user_version", 999u32).unwrap();
    let keys = pulse_lock::Unlocked::create(&pw("phrase de test jetable"), FAST).unwrap();
    fs::write(dir.path().join(ENC_FILE), keys.seal(&conn.serialize(rusqlite::MAIN_DB).unwrap()).unwrap()).unwrap();
    assert!(matches!(Store::unlock(dir.path(), &pw("phrase de test jetable"), NOW).err().unwrap(), crate::CoreError::SchemaTooNew { found: 999, .. }));
}

#[test]
fn a_failed_write_keeps_the_data_in_memory_and_is_retried() {
    let dir = tempfile::tempdir().unwrap();
    let (mut store, _) = seeded(dir.path());
    store.enable(&pw("phrase de test jetable"), true, false, FAST).unwrap();
    account(store.conn(), "42");
    let expected = dump(store.conn());
    fail_at("flush");
    assert!(matches!(store.flush().unwrap_err(), crate::CoreError::Lock(LockError::PersistFailed)));
    assert!(store.persist_failed());
    assert!(status(dir.path(), Some(&store), None, NOW).unwrap().persist_failed);
    // Locking refuses to lose it.
    fail_at("flush");
    let (mut store, _) = *store.close().err().unwrap();
    store.flush().unwrap();
    assert!(!store.persist_failed());
    drop(store);
    assert_eq!(dump(Store::unlock(dir.path(), &pw("phrase de test jetable"), NOW).unwrap().conn()), expected);
}

#[test]
fn plaintext_copies_of_the_backups_folder_can_be_encrypted_at_activation() {
    let dir = tempfile::tempdir().unwrap();
    let (mut store, _) = seeded(dir.path());
    fs::create_dir_all(dir.path().join("backups")).unwrap();
    store.conn().execute("VACUUM INTO ?1", [dir.path().join("backups/pulse-pre-migration-v12.db").to_string_lossy().as_ref()]).unwrap();
    fs::write(dir.path().join("backups/notes.txt"), b"not a database").unwrap();
    assert_eq!(status(dir.path(), Some(&store), None, NOW).unwrap().plain_copies, vec!["pulse-pre-migration-v12.db".to_string()]);
    store.enable(&pw("phrase de test jetable"), true, true, FAST).unwrap();
    assert!(!dir.path().join("backups/pulse-pre-migration-v12.db").exists());
    let sealed = fs::read(dir.path().join("backups/pulse-pre-migration-v12.db.enc")).unwrap();
    let (mut img, _) = pulse_lock::envelope::open(&sealed, &pw("phrase de test jetable")).unwrap();
    assert_eq!(accounts::list(&store::memory_conn(&mut img).unwrap()).unwrap().len(), 2);
    assert_eq!(fs::read(dir.path().join("backups/notes.txt")).unwrap(), b"not a database", "other files untouched");
    assert!(plain_copies(dir.path()).is_empty());

    // Without the option, the copies stay (and are listed for the user).
    let dir2 = tempfile::tempdir().unwrap();
    let (mut store2, _) = seeded(dir2.path());
    fs::create_dir_all(dir2.path().join("backups")).unwrap();
    store2.conn().execute("VACUUM INTO ?1", [dir2.path().join("backups/copie.db").to_string_lossy().as_ref()]).unwrap();
    store2.enable(&pw("phrase de test jetable"), true, false, FAST).unwrap();
    assert_eq!(plain_copies(dir2.path()), vec!["copie.db".to_string()]);
}

#[test]
fn new_screenshots_are_encrypted_while_the_lock_is_active() {
    let dir = tempfile::tempdir().unwrap();
    let (mut store, _) = seeded(dir.path());
    store.enable(&pw("phrase de test jetable"), true, false, FAST).unwrap();
    let rel = screenshots::save_base64(dir.path(), &screenshots::encode(PNG)).unwrap();
    assert!(fs::read(dir.path().join(&rel)).unwrap().starts_with(b"PULSEIMG"));
    let url = screenshots::read_data_url(dir.path(), &rel).unwrap();
    assert!(url.starts_with("data:image/png;base64,"));
}

#[test]
fn idle_setting_is_validated() {
    let conn = db::open_in_memory().unwrap();
    assert_eq!(idle_minutes(&conn).unwrap(), None, "off by default");
    assert_eq!(set_idle_minutes(&conn, Some(15)).unwrap(), Some(15));
    assert!(matches!(set_idle_minutes(&conn, Some(0)).unwrap_err(), crate::CoreError::Lock(LockError::InvalidIdle)));
    assert!(matches!(set_idle_minutes(&conn, Some(MAX_IDLE_MINUTES + 1)).unwrap_err(), crate::CoreError::Lock(LockError::InvalidIdle)));
    assert_eq!(idle_minutes(&conn).unwrap(), Some(15), "a refused value changes nothing");
    assert_eq!(set_idle_minutes(&conn, None).unwrap(), None);
}

#[test]
fn the_process_goals_migration_runs_on_an_encrypted_database_and_keeps_the_result_goals() {
    // Lot 34: the database is encrypted one version before `process_goals`, with a result goal in it.
    let before = migrations::process_goals_version() - 1;
    let dir = tempfile::tempdir().unwrap();
    let mut conn = rusqlite::Connection::open_in_memory().unwrap();
    migrations::migrate_to(&mut conn, before).unwrap();
    conn.execute("INSERT INTO goals (month, metric, target) VALUES ('2026-09', 'discipline_score', '80')", []).unwrap();
    let image = conn.serialize(rusqlite::MAIN_DB).unwrap().to_vec();
    let keys = pulse_lock::Unlocked::create(&pw("phrase de test jetable"), FAST).unwrap();
    fs::write(dir.path().join(ENC_FILE), keys.seal(&image).unwrap()).unwrap();

    let mut store = Store::unlock(dir.path(), &pw("phrase de test jetable"), NOW).unwrap();
    assert_eq!(migrations::current_version(store.conn()).unwrap(), migrations::latest_version());
    let goals = crate::goals::list(store.conn(), "2026-09").unwrap();
    assert_eq!((goals.len(), goals[0].target.to_string().as_str()), (1, "80"));
    let new = crate::process_goals::NewProcessGoal {
        period_kind: crate::process_goals::PeriodKind::Week,
        period_key: "2026-W38".into(),
        metric: crate::process_goals::ProcessMetric::NoStopTrades,
        target: dec("0"),
    };
    crate::process_goals::set(store.conn(), &new).unwrap();
    store.flush().unwrap();
    drop(store);
    let again = Store::unlock(dir.path(), &pw("phrase de test jetable"), NOW).unwrap();
    let kept = crate::process_goals::list(again.conn(), crate::process_goals::PeriodKind::Week, "2026-W38").unwrap();
    assert_eq!(kept.len(), 1, "written back encrypted");
}

#[test]
fn the_weekly_review_migration_runs_on_an_encrypted_database_and_the_review_is_written_back_encrypted() {
    // Lot 36: encrypted one version before `weekly_reviews`, with data in it; the free text is never
    // readable in the file.
    use crate::weekly_review::{self, Answers, ReviewInput};
    let before = migrations::weekly_review_version() - 1;
    let dir = tempfile::tempdir().unwrap();
    let mut conn = rusqlite::Connection::open_in_memory().unwrap();
    migrations::migrate_to(&mut conn, before).unwrap();
    conn.execute("INSERT INTO accounts (name, kind, initial_capital) VALUES ('Ancien', 'personal', '12345.67')", []).unwrap();
    conn.execute("INSERT INTO mcp_calls (at, tz_offset_min, tool, params, result, is_error, size, duration_ms) VALUES (1, 0, 'x', '{}', '{}', 0, 2, 1)", []).unwrap();
    let image = conn.serialize(rusqlite::MAIN_DB).unwrap().to_vec();
    let keys = pulse_lock::Unlocked::create(&pw("phrase de test jetable"), FAST).unwrap();
    fs::write(dir.path().join(ENC_FILE), keys.seal(&image).unwrap()).unwrap();

    let mut store = Store::unlock(dir.path(), &pw("phrase de test jetable"), NOW).unwrap();
    assert_eq!(migrations::current_version(store.conn()).unwrap(), migrations::latest_version());
    assert_eq!(accounts::list(store.conn()).unwrap()[0].name, "Ancien");
    let input = ReviewInput {
        period_key: "2026-W38".into(),
        answers: Answers { went_well: "Bilan-CANARI mes stops".into(), ..Answers::default() },
        intentions: vec!["Intention-CANARI".into()],
    };
    weekly_review::save(store.conn(), &input, 1_790_000_000_000, 0).unwrap();
    store.flush().unwrap();
    drop(store);
    let again = Store::unlock(dir.path(), &pw("phrase de test jetable"), NOW).unwrap();
    let kept = weekly_review::review_of(again.conn(), "2026-W38").unwrap().unwrap();
    assert_eq!((kept.answers.went_well.as_str(), kept.intentions.len()), ("Bilan-CANARI mes stops", 1), "written back encrypted");
    for f in all_files(dir.path()) {
        assert!(!contains(&fs::read(&f).unwrap(), b"CANARI"), "{f:?}: the free text of the review is not readable");
    }
}
