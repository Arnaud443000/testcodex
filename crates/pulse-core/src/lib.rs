//! Pulse core: local SQLite storage and business logic, independent of the UI
//! shell so it can be unit-tested on any platform.

mod util;

pub mod accounts;
pub mod backup;
pub mod behavior;
pub mod cash_flows;
pub mod checklist;
pub mod db;
pub mod error;
pub mod export;
pub mod instruments;
pub mod migrations;
pub mod missed_trades;
pub mod money;
pub mod rules;
pub mod screenshots;
pub mod settings;
pub mod stats;
pub mod tags;
pub mod trade_view;
pub mod trades;
// Lot 10 (journal side, step 2).
pub mod confidence;
pub mod execution_quality;
pub mod journal;
pub mod period;
pub mod reminder;
// Lot 11.
pub mod goals;
pub mod replay;
// Lot 12.
pub mod alerts;

// Lot 13.
pub mod dashboards;
// Lot 20 (IA optionnelle, sans réseau ici).
pub mod ai;
pub use rusqlite;

pub use error::{CoreError, Result};
pub use money::Decimal;

#[cfg(test)]
mod test_support;

#[cfg(test)]
mod tests {
    use super::*;
    use accounts::NewAccount;

    fn new_account(name: &str, kind: &str) -> NewAccount {
        NewAccount {
            name: name.into(),
            kind: kind.into(),
            broker: "".into(),
            currency: "USD".into(),
            initial_capital: Decimal::from(10_000),
        }
    }

    #[test]
    fn migrations_reach_latest_version() {
        let conn = db::open_in_memory().unwrap();
        assert_eq!(migrations::current_version(&conn).unwrap(), migrations::latest_version());
    }

    #[test]
    fn migrating_twice_is_a_no_op() {
        let mut conn = db::open_in_memory().unwrap();
        migrations::migrate(&mut conn).unwrap();
        assert!(!migrations::needs_migration(&conn).unwrap());
    }

    #[test]
    fn creates_and_lists_accounts() {
        let conn = db::open_in_memory().unwrap();
        let a = accounts::create(&conn, &new_account("Main account", "personal")).unwrap();
        let b = accounts::create(&conn, &new_account("FTMO", "prop")).unwrap();
        assert_ne!(a.id, b.id);
        let all = accounts::list(&conn).unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].name, "Main account");
        assert_eq!(all[0].initial_capital.to_string(), "10000");
    }

    #[test]
    fn rejects_invalid_accounts() {
        let conn = db::open_in_memory().unwrap();
        assert!(accounts::create(&conn, &new_account("   ", "personal")).is_err());
        assert!(accounts::create(&conn, &new_account("X", "weird")).is_err());
        let mut neg = new_account("X", "demo");
        neg.initial_capital = Decimal::NEGATIVE_ONE;
        assert!(accounts::create(&conn, &neg).is_err());
        assert!(accounts::list(&conn).unwrap().is_empty());
    }

    #[test]
    fn data_persists_on_disk_across_reopen() {
        let dir = tempfile::tempdir().unwrap();
        {
            let conn = db::open(dir.path()).unwrap();
            accounts::create(&conn, &new_account("Main", "personal")).unwrap();
        }
        let conn = db::open(dir.path()).unwrap();
        assert_eq!(accounts::list(&conn).unwrap().len(), 1);
    }

    #[test]
    fn refuses_a_database_from_a_newer_version() {
        let dir = tempfile::tempdir().unwrap();
        {
            let conn = db::open(dir.path()).unwrap();
            conn.pragma_update(None, "user_version", 999u32).unwrap();
        }
        match db::open(dir.path()) {
            Err(CoreError::SchemaTooNew { found: 999, .. }) => {}
            other => panic!("expected SchemaTooNew, got {other:?}"),
        }
    }

    #[test]
    fn upgrading_a_v1_file_backs_it_up_then_keeps_the_accounts() {
        let dir = tempfile::tempdir().unwrap();
        {
            let mut conn = rusqlite::Connection::open(dir.path().join(db::DB_FILE)).unwrap();
            migrations::migrate_to(&mut conn, 1).unwrap();
            conn.execute(
                "INSERT INTO accounts (name, kind, initial_capital) VALUES ('Main', 'personal', 12345.67)",
                [],
            )
            .unwrap();
        }
        let conn = db::open(dir.path()).unwrap();
        assert_eq!(accounts::list(&conn).unwrap()[0].initial_capital.to_string(), "12345.67");
        let backup = rusqlite::Connection::open(dir.path().join("backups").join("pulse-pre-migration-v1.db")).unwrap();
        let v: u32 = backup.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(v, 1, "the backup is the untouched v1 database");
    }

    #[test]
    fn backs_up_the_database_before_a_pending_migration() {
        let dir = tempfile::tempdir().unwrap();
        {
            // Simulate an older install: schema at v0 with a file already on disk.
            let conn = rusqlite::Connection::open(dir.path().join(db::DB_FILE)).unwrap();
            conn.execute_batch("CREATE TABLE legacy (x INTEGER); INSERT INTO legacy VALUES (42);").unwrap();
        }
        let conn = db::open(dir.path()).unwrap();
        assert_eq!(migrations::current_version(&conn).unwrap(), migrations::latest_version());
        let backup = dir.path().join("backups").join("pulse-pre-migration-v0.db");
        assert!(backup.exists(), "expected a pre-migration backup");
        let b = rusqlite::Connection::open(backup).unwrap();
        let x: i64 = b.query_row("SELECT x FROM legacy", [], |r| r.get(0)).unwrap();
        assert_eq!(x, 42);
    }
}
