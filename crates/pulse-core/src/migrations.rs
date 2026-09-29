//! Versioned schema migrations, tracked with `PRAGMA user_version`.
//!
//! Rules: never edit a migration that has shipped; add a new one at the end of
//! `MIGRATIONS`. Each migration runs in its own transaction.

use crate::error::{CoreError, Result};
use rusqlite::Connection;

pub const MIGRATIONS: &[&str] = &[
    // v1 — foundations: accounts and key/value settings.
    // The full trade schema is designed in the next work package.
    "CREATE TABLE accounts (
        id              INTEGER PRIMARY KEY,
        name            TEXT    NOT NULL CHECK (length(trim(name)) > 0),
        kind            TEXT    NOT NULL CHECK (kind IN ('personal','prop','demo')),
        broker          TEXT    NOT NULL DEFAULT '',
        currency        TEXT    NOT NULL DEFAULT 'USD',
        initial_capital REAL    NOT NULL DEFAULT 0,
        created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );",
    // v2 — step-1 schema: instruments, trades, normalized tags, personal rules,
    // pre-trade checklist, deposits/withdrawals, missed trades.
    //
    // Conventions (see CLAUDE.md, "Argent et prix"):
    // - money, prices, sizes and multipliers are exact decimals stored as TEXT
    //   in plain notation ('1.0842', '-12.5'); the CHECKs below are a coarse
    //   safety net, pulse-core validates with rust_decimal;
    // - instants are INTEGER Unix milliseconds (UTC) plus the trader's UTC
    //   offset in minutes at that instant, used for local day/hour grouping;
    // - derived values (PnL, R, win/loss) are never stored.
    "CREATE TABLE accounts_v2 (
        id              INTEGER PRIMARY KEY,
        name            TEXT    NOT NULL CHECK (length(trim(name)) > 0),
        kind            TEXT    NOT NULL CHECK (kind IN ('personal','prop','demo')),
        broker          TEXT    NOT NULL DEFAULT '',
        currency        TEXT    NOT NULL DEFAULT 'USD',
        initial_capital TEXT    NOT NULL DEFAULT '0'
                        CHECK (initial_capital GLOB '[0-9]*' AND initial_capital NOT GLOB '*[^0-9.]*'),
        created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    INSERT INTO accounts_v2 (id, name, kind, broker, currency, initial_capital, created_at)
        SELECT id, name, kind, broker, currency,
               CASE WHEN CAST(initial_capital AS TEXT) GLOB '*[eE]*'
                    THEN printf('%.2f', initial_capital)
                    ELSE CAST(initial_capital AS TEXT) END,
               created_at
        FROM accounts;
    DROP TABLE accounts;
    ALTER TABLE accounts_v2 RENAME TO accounts;

    CREATE TABLE instruments (
        id                 INTEGER PRIMARY KEY,
        symbol             TEXT NOT NULL CHECK (length(trim(symbol)) > 0),
        symbol_key         TEXT NOT NULL UNIQUE,
        asset_class        TEXT NOT NULL DEFAULT 'other'
                           CHECK (asset_class IN ('forex','index','crypto','stock','commodity','future','other')),
        default_multiplier TEXT NOT NULL DEFAULT '1'
                           CHECK (default_multiplier GLOB '[0-9]*' AND default_multiplier NOT GLOB '*[^0-9.]*'
                                  AND default_multiplier GLOB '*[1-9]*'),
        created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );

    CREATE TABLE tags (
        id         INTEGER PRIMARY KEY,
        kind       TEXT NOT NULL
                   CHECK (kind IN ('setup','timeframe','session','market_condition','emotion','mistake')),
        name       TEXT NOT NULL CHECK (length(trim(name)) > 0),
        name_key   TEXT NOT NULL,
        archived   INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        UNIQUE (kind, name_key)
    );
    CREATE TRIGGER tags_kind_is_immutable BEFORE UPDATE OF kind ON tags
    WHEN NEW.kind <> OLD.kind
    BEGIN SELECT RAISE(ABORT, 'the kind of a tag cannot change'); END;

    CREATE TABLE trades (
        id                INTEGER PRIMARY KEY,
        account_id        INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
        instrument_id     INTEGER NOT NULL REFERENCES instruments(id) ON DELETE RESTRICT,
        direction         TEXT    NOT NULL CHECK (direction IN ('long','short')),
        size              TEXT    NOT NULL CHECK (size GLOB '[0-9]*' AND size NOT GLOB '*[^0-9.]*' AND size GLOB '*[1-9]*'),
        multiplier        TEXT    NOT NULL
                          CHECK (multiplier GLOB '[0-9]*' AND multiplier NOT GLOB '*[^0-9.]*' AND multiplier GLOB '*[1-9]*'),
        entry_price       TEXT    NOT NULL CHECK (entry_price NOT GLOB '?*-*' AND ltrim(entry_price,'-') GLOB '[0-9]*' AND ltrim(entry_price,'-') NOT GLOB '*[^0-9.]*'),
        exit_price        TEXT             CHECK (exit_price NOT GLOB '?*-*' AND ltrim(exit_price,'-') GLOB '[0-9]*' AND ltrim(exit_price,'-') NOT GLOB '*[^0-9.]*'),
        entry_time        INTEGER NOT NULL,
        exit_time         INTEGER,
        tz_offset_min     INTEGER NOT NULL DEFAULT 0 CHECK (tz_offset_min BETWEEN -840 AND 840),
        planned_sl        TEXT             CHECK (planned_sl NOT GLOB '?*-*' AND ltrim(planned_sl,'-') GLOB '[0-9]*' AND ltrim(planned_sl,'-') NOT GLOB '*[^0-9.]*'),
        planned_tp        TEXT             CHECK (planned_tp NOT GLOB '?*-*' AND ltrim(planned_tp,'-') GLOB '[0-9]*' AND ltrim(planned_tp,'-') NOT GLOB '*[^0-9.]*'),
        actual_sl         TEXT             CHECK (actual_sl NOT GLOB '?*-*' AND ltrim(actual_sl,'-') GLOB '[0-9]*' AND ltrim(actual_sl,'-') NOT GLOB '*[^0-9.]*'),
        actual_tp         TEXT             CHECK (actual_tp NOT GLOB '?*-*' AND ltrim(actual_tp,'-') GLOB '[0-9]*' AND ltrim(actual_tp,'-') NOT GLOB '*[^0-9.]*'),
        fees              TEXT    NOT NULL DEFAULT '0'
                          CHECK (fees NOT GLOB '?*-*' AND ltrim(fees,'-') GLOB '[0-9]*' AND ltrim(fees,'-') NOT GLOB '*[^0-9.]*'),
        price_after_exit  TEXT             CHECK (price_after_exit NOT GLOB '?*-*' AND ltrim(price_after_exit,'-') GLOB '[0-9]*' AND ltrim(price_after_exit,'-') NOT GLOB '*[^0-9.]*'),
        execution_type    TEXT             CHECK (execution_type IN ('discretionary','system')),
        rating            INTEGER          CHECK (rating BETWEEN 1 AND 5),
        conviction        INTEGER          CHECK (conviction BETWEEN 1 AND 10),
        execution_quality INTEGER          CHECK (execution_quality BETWEEN 1 AND 5),
        plan_followed     TEXT             CHECK (plan_followed IN ('yes','partial','no')),
        thesis            TEXT    NOT NULL DEFAULT '',
        post_mortem       TEXT    NOT NULL DEFAULT '',
        screenshot_path   TEXT,
        created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        CHECK ((exit_price IS NULL) = (exit_time IS NULL)),
        CHECK (exit_time IS NULL OR exit_time >= entry_time)
    );
    CREATE INDEX trades_account_exit ON trades(account_id, exit_time);
    CREATE INDEX trades_account_entry ON trades(account_id, entry_time);
    CREATE INDEX trades_instrument ON trades(instrument_id);

    -- Setup, timeframe, session, market condition and mistake tags of a trade.
    CREATE TABLE trade_tags (
        trade_id INTEGER NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
        tag_id   INTEGER NOT NULL REFERENCES tags(id) ON DELETE RESTRICT,
        PRIMARY KEY (trade_id, tag_id)
    ) WITHOUT ROWID;
    CREATE INDEX trade_tags_tag ON trade_tags(tag_id);
    CREATE TRIGGER trade_tags_no_emotion BEFORE INSERT ON trade_tags
    WHEN (SELECT kind FROM tags WHERE id = NEW.tag_id) = 'emotion'
    BEGIN SELECT RAISE(ABORT, 'emotion tags belong in trade_emotions'); END;

    -- Emotions before / during / after a trade (tags of kind 'emotion').
    CREATE TABLE trade_emotions (
        trade_id INTEGER NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
        moment   TEXT    NOT NULL CHECK (moment IN ('before','during','after')),
        tag_id   INTEGER NOT NULL REFERENCES tags(id) ON DELETE RESTRICT,
        PRIMARY KEY (trade_id, moment, tag_id)
    ) WITHOUT ROWID;
    CREATE INDEX trade_emotions_tag ON trade_emotions(tag_id);
    CREATE TRIGGER trade_emotions_only_emotions BEFORE INSERT ON trade_emotions
    WHEN (SELECT kind FROM tags WHERE id = NEW.tag_id) IS NOT 'emotion'
    BEGIN SELECT RAISE(ABORT, 'only emotion tags belong in trade_emotions'); END;

    CREATE TABLE rules (
        id         INTEGER PRIMARY KEY,
        text       TEXT    NOT NULL CHECK (length(trim(text)) > 0),
        archived   INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
        position   INTEGER NOT NULL DEFAULT 0,
        created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE trade_rule_checks (
        trade_id  INTEGER NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
        rule_id   INTEGER NOT NULL REFERENCES rules(id) ON DELETE RESTRICT,
        respected INTEGER NOT NULL CHECK (respected IN (0,1)),
        PRIMARY KEY (trade_id, rule_id)
    ) WITHOUT ROWID;
    CREATE INDEX trade_rule_checks_rule ON trade_rule_checks(rule_id);

    CREATE TABLE checklist_items (
        id         INTEGER PRIMARY KEY,
        label      TEXT    NOT NULL CHECK (length(trim(label)) > 0),
        archived   INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1)),
        position   INTEGER NOT NULL DEFAULT 0,
        created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    -- The filled copy of the checklist for one trade: labels are snapshotted so
    -- editing the template later never rewrites history.
    CREATE TABLE trade_checklist (
        trade_id INTEGER NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        item_id  INTEGER REFERENCES checklist_items(id) ON DELETE SET NULL,
        label    TEXT    NOT NULL CHECK (length(trim(label)) > 0),
        checked  INTEGER NOT NULL CHECK (checked IN (0,1)),
        PRIMARY KEY (trade_id, position)
    ) WITHOUT ROWID;

    -- Deposits and withdrawals: always excluded from performance (spec 3.7.10).
    CREATE TABLE cash_flows (
        id            INTEGER PRIMARY KEY,
        account_id    INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
        kind          TEXT    NOT NULL CHECK (kind IN ('deposit','withdrawal')),
        amount        TEXT    NOT NULL
                      CHECK (amount GLOB '[0-9]*' AND amount NOT GLOB '*[^0-9.]*' AND amount GLOB '*[1-9]*'),
        occurred_at   INTEGER NOT NULL,
        tz_offset_min INTEGER NOT NULL DEFAULT 0 CHECK (tz_offset_min BETWEEN -840 AND 840),
        note          TEXT    NOT NULL DEFAULT '',
        created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX cash_flows_account_time ON cash_flows(account_id, occurred_at);

    CREATE TABLE missed_trades (
        id            INTEGER PRIMARY KEY,
        account_id    INTEGER NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
        instrument_id INTEGER NOT NULL REFERENCES instruments(id) ON DELETE RESTRICT,
        direction     TEXT    CHECK (direction IN ('long','short')),
        occurred_at   INTEGER NOT NULL,
        tz_offset_min INTEGER NOT NULL DEFAULT 0 CHECK (tz_offset_min BETWEEN -840 AND 840),
        reason        TEXT    NOT NULL DEFAULT '',
        notes         TEXT    NOT NULL DEFAULT '',
        conviction    INTEGER CHECK (conviction BETWEEN 1 AND 10),
        created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX missed_trades_account_time ON missed_trades(account_id, occurred_at);
    CREATE TABLE missed_trade_tags (
        missed_trade_id INTEGER NOT NULL REFERENCES missed_trades(id) ON DELETE CASCADE,
        tag_id          INTEGER NOT NULL REFERENCES tags(id) ON DELETE RESTRICT,
        PRIMARY KEY (missed_trade_id, tag_id)
    ) WITHOUT ROWID;
    CREATE TRIGGER missed_trade_tags_no_emotion BEFORE INSERT ON missed_trade_tags
    WHEN (SELECT kind FROM tags WHERE id = NEW.tag_id) = 'emotion'
    BEGIN SELECT RAISE(ABORT, 'emotion tags cannot qualify a missed trade'); END;

    -- Starter tags: editable and archivable, never required.
    INSERT INTO tags (kind, name, name_key) VALUES
        ('session','Asia','asia'), ('session','London','london'), ('session','New York','new york'),
        ('timeframe','M1','m1'), ('timeframe','M5','m5'), ('timeframe','M15','m15'),
        ('timeframe','H1','h1'), ('timeframe','H4','h4'), ('timeframe','D1','d1'),
        ('market_condition','Range','range'), ('market_condition','Trend','trend'),
        ('market_condition','High volatility','high volatility'),
        ('market_condition','Economic news','economic news'),
        ('emotion','Calm','calm'), ('emotion','Discipline','discipline'), ('emotion','Confidence','confidence'),
        ('emotion','FOMO','fomo'), ('emotion','Doubt','doubt'), ('emotion','Stress','stress'),
        ('emotion','Impatience','impatience'), ('emotion','Revenge','revenge'), ('emotion','Relief','relief'),
        ('mistake','Early exit','early exit'), ('mistake','Late exit','late exit'),
        ('mistake','Overtrading','overtrading'), ('mistake','Revenge trade','revenge trade'),
        ('mistake','No plan','no plan'), ('mistake','Poor risk management','poor risk management'),
        ('mistake','Moved stop loss','moved stop loss');",
];

pub fn latest_version() -> u32 {
    MIGRATIONS.len() as u32
}

pub fn current_version(conn: &Connection) -> Result<u32> {
    Ok(conn.query_row("PRAGMA user_version", [], |r| r.get::<_, u32>(0))?)
}

/// Returns true when at least one migration is pending.
pub fn needs_migration(conn: &Connection) -> Result<bool> {
    Ok(current_version(conn)? < latest_version())
}

pub fn migrate(conn: &mut Connection) -> Result<()> {
    migrate_to(conn, latest_version())
}

/// Applies pending migrations up to `target` (tests use it to build older schemas).
pub(crate) fn migrate_to(conn: &mut Connection, target: u32) -> Result<()> {
    let current = current_version(conn)?;
    let latest = latest_version();
    if current > latest {
        return Err(CoreError::SchemaTooNew { found: current, supported: latest });
    }
    for (i, sql) in MIGRATIONS.iter().enumerate().take(target as usize).skip(current as usize) {
        let tx = conn.transaction()?;
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", (i + 1) as u32)?;
        tx.commit()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{account, instrument};
    use crate::{accounts, db, trades};

    fn v1_database() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrate_to(&mut conn, 1).unwrap();
        conn
    }

    #[test]
    fn v2_keeps_existing_accounts_and_converts_capital_to_exact_decimals() {
        let mut conn = v1_database();
        conn.execute_batch(
            "INSERT INTO accounts (id, name, kind, broker, currency, initial_capital, created_at) VALUES
                (1, 'Main', 'personal', 'IC Markets', 'USD', 10000.0, '2026-09-01T10:00:00.000Z'),
                (2, 'FTMO',  'prop',     '',           'EUR', 2500.5,  '2026-09-02T10:00:00.000Z'),
                (3, 'Demo',  'demo',     '',           'USD', 0.1,     '2026-09-03T10:00:00.000Z'),
                (7, 'Huge',  'demo',     '',           'USD', 1e20,    '2026-09-04T10:00:00.000Z');",
        )
        .unwrap();
        migrate(&mut conn).unwrap();
        assert_eq!(current_version(&conn).unwrap(), latest_version());

        let all = accounts::list(&conn).unwrap();
        let got: Vec<(i64, &str, String)> =
            all.iter().map(|a| (a.id, a.name.as_str(), a.initial_capital.to_string())).collect();
        assert_eq!(
            got,
            [
                (1, "Main", "10000.0".to_string()),
                (2, "FTMO", "2500.5".to_string()),
                (3, "Demo", "0.1".to_string()),
                (7, "Huge", "100000000000000000000.00".to_string()),
            ]
        );
        assert_eq!(all[0].broker, "IC Markets");
        assert_eq!(all[1].currency, "EUR");
        let created: String = conn.query_row("SELECT created_at FROM accounts WHERE id = 2", [], |r| r.get(0)).unwrap();
        assert_eq!(created, "2026-09-02T10:00:00.000Z");

        // The rebuilt table is a valid foreign-key target and ids keep counting up.
        let eu = instrument(&conn, "EURUSD", "100000");
        let t = trades::TradeData::new(7, eu, trades::Direction::Long, 1.into(), 1.into(), 0);
        trades::create(&conn, &t).unwrap();
        assert!(account(&conn, "5") > 7);
        let fk_errors: i64 = conn.query_row("SELECT COUNT(*) FROM pragma_foreign_key_check", [], |r| r.get(0)).unwrap();
        assert_eq!(fk_errors, 0);
    }

    #[test]
    fn v2_on_an_empty_v1_database() {
        let mut conn = v1_database();
        migrate(&mut conn).unwrap();
        assert!(accounts::list(&conn).unwrap().is_empty());
    }

    #[test]
    fn schema_guards_reject_malformed_rows_written_directly() {
        let conn = db::open_in_memory().unwrap();
        let a = account(&conn, "100");
        let eu = instrument(&conn, "EURUSD", "100000");
        let insert = |size: &str, entry: &str, fees: &str| {
            conn.execute(
                "INSERT INTO trades (account_id, instrument_id, direction, size, multiplier, entry_price, entry_time, fees)
                 VALUES (?1, ?2, 'long', ?3, '1', ?4, 0, ?5)",
                rusqlite::params![a, eu, size, entry, fees],
            )
        };
        assert!(insert("1", "1.1", "-2.5").is_ok());
        for (size, entry, fees) in [
            ("0", "1.1", "0"),
            ("0.00", "1.1", "0"),
            ("-1", "1.1", "0"),
            ("1e5", "1.1", "0"),
            ("1", "abc", "0"),
            ("1", "--1", "0"),
            ("1", "1-1", "0"),
            ("1", "1.1", "1,5"),
        ] {
            assert!(insert(size, entry, fees).is_err(), "{size} / {entry} / {fees} should be rejected");
        }
        // Exit price and exit time go together; exit cannot precede entry.
        assert!(conn.execute("UPDATE trades SET exit_price = '1.2'", []).is_err());
        assert!(conn.execute("UPDATE trades SET exit_price = '1.2', exit_time = -1", []).is_err());
        assert!(conn.execute("UPDATE trades SET exit_price = '1.2', exit_time = 5", []).is_ok());
        // An account with trades cannot be deleted; an emotion cannot be a plain tag.
        assert!(conn.execute("DELETE FROM accounts WHERE id = ?1", [a]).is_err());
        let calm: i64 = conn.query_row("SELECT id FROM tags WHERE kind = 'emotion' LIMIT 1", [], |r| r.get(0)).unwrap();
        assert!(conn.execute("INSERT INTO trade_tags (trade_id, tag_id) SELECT id, ?1 FROM trades", [calm]).is_err());
        let setup: i64 = conn
            .query_row("INSERT INTO tags (kind, name, name_key) VALUES ('setup','X','x') RETURNING id", [], |r| r.get(0))
            .unwrap();
        assert!(
            conn.execute("INSERT INTO trade_emotions (trade_id, moment, tag_id) SELECT id, 'before', ?1 FROM trades", [setup])
                .is_err()
        );
        assert!(conn.execute("INSERT INTO cash_flows (account_id, kind, amount, occurred_at) VALUES (?1, 'deposit', '-5', 0)", [a]).is_err());
    }
}
