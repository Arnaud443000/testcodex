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
    // v3 — French names for the starter tags seeded by v2. Only a tag that still
    // carries its exact English starter name is renamed: tags the user created or
    // renamed are left alone, and a rename that would collide with an existing tag
    // of the same kind is skipped. The `session` starters are matched by name (see
    // `trade_view::session_for`), which is why "Asia"/"London" follow the rename.
    "CREATE TEMP TABLE tag_renames (kind TEXT, old_name TEXT, old_key TEXT, new_name TEXT, new_key TEXT);
    INSERT INTO tag_renames VALUES
        ('session','Asia','asia','Asie','asie'),
        ('session','London','london','Londres','londres'),
        ('market_condition','Trend','trend','Tendance','tendance'),
        ('market_condition','High volatility','high volatility','Forte volatilité','forte volatilité'),
        ('market_condition','Economic news','economic news','Actualité économique','actualité économique'),
        ('emotion','Calm','calm','Calme','calme'),
        ('emotion','Confidence','confidence','Confiance','confiance'),
        ('emotion','FOMO','fomo','Peur de rater (FOMO)','peur de rater (fomo)'),
        ('emotion','Doubt','doubt','Doute','doute'),
        ('emotion','Revenge','revenge','Revanche','revanche'),
        ('emotion','Relief','relief','Soulagement','soulagement'),
        ('mistake','Early exit','early exit','Sortie trop tôt','sortie trop tôt'),
        ('mistake','Late exit','late exit','Sortie trop tard','sortie trop tard'),
        ('mistake','Overtrading','overtrading','Surtrading','surtrading'),
        ('mistake','Revenge trade','revenge trade','Trade de revanche','trade de revanche'),
        ('mistake','No plan','no plan','Pas de plan','pas de plan'),
        ('mistake','Poor risk management','poor risk management','Mauvaise gestion du risque','mauvaise gestion du risque'),
        ('mistake','Moved stop loss','moved stop loss','Stop déplacé','stop déplacé');
    UPDATE tags SET
        name     = (SELECT new_name FROM tag_renames r WHERE r.kind = tags.kind AND r.old_name = tags.name),
        name_key = (SELECT new_key  FROM tag_renames r WHERE r.kind = tags.kind AND r.old_name = tags.name)
    WHERE EXISTS (
            SELECT 1 FROM tag_renames r
            WHERE r.kind = tags.kind AND r.old_name = tags.name AND tags.name_key = r.old_key)
      AND NOT EXISTS (
            SELECT 1 FROM tag_renames r JOIN tags o ON o.kind = r.kind AND o.name_key = r.new_key
            WHERE r.kind = tags.kind AND r.old_name = tags.name);
    DROP TABLE tag_renames;",
    // v4 — instrument full names + built-in asset catalog (generated, see catalog/).
    include_str!("../catalog/v4_asset_catalog.sql"),
    // v5 — archiving an account: it keeps its history but leaves selectors and default totals.
    "ALTER TABLE accounts ADD COLUMN archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0,1));",
    // v6 — daily journal (spec 3.2.6) and monthly goals (spec 3.7.2). Reminder
    // settings (3.2.8) live in the existing key/value `settings` table.
    // The journal is keyed by local day ("YYYY-MM-DD"): one entry per day, whatever the account.
    // A goal target is an exact decimal in plain notation (percent for a win rate).
    "CREATE TABLE journal_entries (
        day           TEXT PRIMARY KEY
                      CHECK (day GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
        mood          INTEGER CHECK (mood BETWEEN 1 AND 5),
        sleep_quality INTEGER CHECK (sleep_quality BETWEEN 1 AND 5),
        fatigue       INTEGER CHECK (fatigue BETWEEN 1 AND 5),
        late_hours    INTEGER NOT NULL DEFAULT 0 CHECK (late_hours IN (0,1)),
        went_well     TEXT NOT NULL DEFAULT '',
        to_improve    TEXT NOT NULL DEFAULT '',
        notes         TEXT NOT NULL DEFAULT '',
        created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE goals (
        id         INTEGER PRIMARY KEY,
        month      TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
        metric     TEXT NOT NULL
                   CHECK (metric IN ('net_pnl','win_rate','profit_factor','expectancy_r','execution_quality','max_drawdown')),
        target     TEXT NOT NULL
                   CHECK (target GLOB '[0-9]*' AND target NOT GLOB '*[^0-9.]*' AND target GLOB '*[1-9]*'),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        UNIQUE (month, metric)
    );",
    // v7 — the discipline score becomes a goal metric (spec 3.7.2, 3.4.1). SQLite cannot change a CHECK
    // in place, so `goals` is rebuilt with the wider list; ids, targets and dates are copied as they are.
    "CREATE TABLE goals_new (
        id         INTEGER PRIMARY KEY,
        month      TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
        metric     TEXT NOT NULL
                   CHECK (metric IN ('net_pnl','win_rate','profit_factor','expectancy_r','execution_quality','max_drawdown','discipline_score')),
        target     TEXT NOT NULL
                   CHECK (target GLOB '[0-9]*' AND target NOT GLOB '*[^0-9.]*' AND target GLOB '*[1-9]*'),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        UNIQUE (month, metric)
    );
    INSERT INTO goals_new (id, month, metric, target, created_at) SELECT id, month, metric, target, created_at FROM goals;
    DROP TABLE goals;
    ALTER TABLE goals_new RENAME TO goals;",
    // v8 — guard-rail alerts (spec 3.6): log of every alert shown, and of the ones the trader dismissed,
    // so a seen alert never loops. It is an event log, not a cache: active alerts are always recomputed.
    // `payload` is the alert as first shown (JSON); `trade_id` has no foreign key so the history
    // outlives a deleted trade; deleting an account removes its history.
    "CREATE TABLE alert_log (
        alert_id      TEXT PRIMARY KEY CHECK (length(alert_id) > 0),
        account_id    INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        kind          TEXT NOT NULL CHECK (length(kind) > 0),
        severity      TEXT NOT NULL CHECK (severity IN ('warning','critical')),
        trade_id      INTEGER,
        payload       TEXT NOT NULL,
        first_seen_at INTEGER NOT NULL,
        dismissed_at  INTEGER
    );
    CREATE INDEX alert_log_by_account ON alert_log (account_id, first_seen_at);",
    // v9 — customisable dashboard (spec 3.8, 2.9, 2.10). Only the user's own dashboards live here; the
    // built-in presets are code (`dashboards::presets`) so they cannot be altered or lost. `kind` has no
    // CHECK on purpose: the widget library grows without a migration, `dashboards::save` validates it.
    // Deleting an account puts its widgets back on "the global account" instead of blocking the deletion.
    "CREATE TABLE dashboards (
        id         INTEGER PRIMARY KEY,
        name       TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 60),
        position   INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE UNIQUE INDEX dashboards_name_key ON dashboards (lower(trim(name)));
    CREATE TABLE dashboard_widgets (
        id           INTEGER PRIMARY KEY,
        dashboard_id INTEGER NOT NULL REFERENCES dashboards(id) ON DELETE CASCADE,
        uid          TEXT NOT NULL CHECK (length(uid) BETWEEN 1 AND 40),
        kind         TEXT NOT NULL CHECK (length(kind) BETWEEN 1 AND 40),
        x            INTEGER NOT NULL CHECK (x >= 0),
        y            INTEGER NOT NULL CHECK (y >= 0),
        w            INTEGER NOT NULL CHECK (w >= 1),
        h            INTEGER NOT NULL CHECK (h >= 1),
        period       TEXT CHECK (period IS NULL OR period IN ('1D','1W','1M','3M','1Y','ALL')),
        account_id   INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
        mode         TEXT CHECK (mode IS NULL OR length(mode) BETWEEN 1 AND 40),
        UNIQUE (dashboard_id, uid)
    );
    CREATE INDEX dashboard_widgets_dashboard ON dashboard_widgets (dashboard_id);",
    // v10 — scope of a dashboard (spec 3.8.9): `follow` = the account chosen in the top bar (what every
    // dashboard did until now, so existing dashboards and the default one are unchanged), `account` = linked
    // to one account, `all` = consolidated over every active account. Deleting the linked account empties
    // `scope_account_id` (the dashboard is kept and reads the top bar again); `dashboards::resolve_scope` tells so.
    "ALTER TABLE dashboards ADD COLUMN scope TEXT NOT NULL DEFAULT 'follow' CHECK (scope IN ('follow','account','all'));
    ALTER TABLE dashboards ADD COLUMN scope_account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL;",
    // v11 — automatic insights (spec 3.5): log of every insight shown, and of the ones the trader dismissed.
    // An event log, not a cache: insights are always recomputed. `situation` = what it is about, `level` =
    // coarse gravity, `episode` = a new one when the situation was not seen for 14 days (see `insights::log`).
    // `payload` is the insight as first shown (JSON); deleting an account removes its history.
    "CREATE TABLE insight_log (
        insight_id    TEXT PRIMARY KEY CHECK (length(insight_id) > 0),
        account_id    INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        situation     TEXT NOT NULL CHECK (length(situation) > 0),
        level         INTEGER NOT NULL CHECK (level >= 0),
        episode       INTEGER NOT NULL CHECK (episode >= 1),
        kind          TEXT NOT NULL CHECK (length(kind) > 0),
        category      TEXT NOT NULL CHECK (category IN ('trend','suggestion','highlight')),
        priority      TEXT NOT NULL CHECK (priority IN ('high','medium','low')),
        payload       TEXT NOT NULL,
        first_seen_at INTEGER NOT NULL,
        last_seen_at  INTEGER NOT NULL,
        dismissed_at  INTEGER
    );
    CREATE INDEX insight_log_by_situation ON insight_log (situation, episode);
    CREATE INDEX insight_log_by_account ON insight_log (account_id, first_seen_at);",
    // v12 — AI comments on a trade's screenshot (lot 20, spec 3.5.4; to renumber if another branch also adds
    // a v12). Text to read only: nothing computes from it. It goes with its trade; `sent` is the JSON list of
    // the trade fields that were sent with the image. The API key is never stored in the database.
    "CREATE TABLE ai_screenshot_notes (
        id         INTEGER PRIMARY KEY,
        trade_id   INTEGER NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        provider   TEXT NOT NULL CHECK (length(provider) BETWEEN 1 AND 40),
        model      TEXT NOT NULL CHECK (length(model) BETWEEN 1 AND 80),
        sent       TEXT NOT NULL,
        content    TEXT NOT NULL CHECK (length(content) >= 1)
    );
    CREATE INDEX ai_screenshot_notes_by_trade ON ai_screenshot_notes (trade_id, created_at);",
    // v13 — AI coach conversations (lot 21, spec 3.5.5; to renumber if another branch also adds a v13).
    // Text to read only: nothing computes from it, it is never sent back to the AI in another conversation.
    // `sent` is the JSON log of what left the computer during the turn; `transcript` the technical messages
    // replayed to the AI in the next turns of the same conversation (NULL for a failed turn, never replayed).
    "CREATE TABLE coach_conversations (
        id            INTEGER PRIMARY KEY,
        title         TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL,
        tools_version INTEGER NOT NULL
    );
    CREATE TABLE coach_turns (
        id              INTEGER PRIMARY KEY,
        conversation_id INTEGER NOT NULL REFERENCES coach_conversations(id) ON DELETE CASCADE,
        seq             INTEGER NOT NULL CHECK (seq >= 1),
        created_at      INTEGER NOT NULL,
        question        TEXT NOT NULL CHECK (length(question) >= 1),
        status          TEXT NOT NULL CHECK (status IN ('answered', 'failed')),
        error_code      TEXT,
        answer          TEXT,
        provider        TEXT NOT NULL CHECK (length(provider) BETWEEN 1 AND 40),
        model           TEXT NOT NULL CHECK (length(model) BETWEEN 1 AND 80),
        sent            TEXT NOT NULL,
        unverified      TEXT NOT NULL DEFAULT '[]',
        transcript      TEXT,
        usage           TEXT,
        UNIQUE (conversation_id, seq),
        CHECK ((status = 'answered' AND answer IS NOT NULL AND transcript IS NOT NULL AND error_code IS NULL)
            OR (status = 'failed' AND answer IS NULL AND transcript IS NULL AND error_code IS NOT NULL))
    );
    CREATE INDEX coach_conversations_by_update ON coach_conversations (updated_at);",
    // v14 — economic calendar (lot 25, spec 3.6.8; to renumber if another branch also adds a v14).
    // Events read from a file or a feed; nothing links them to a trade (the alert compares instants).
    // `starts_at` is a UTC instant (NULL = no time given), `day` the Paris day; forecast / previous /
    // actual are the source's text (unit included), never money, never added up.
    "CREATE TABLE economic_events (
        id         INTEGER PRIMARY KEY,
        source     TEXT NOT NULL CHECK (length(source) BETWEEN 1 AND 20),
        uid        TEXT NOT NULL CHECK (length(uid) BETWEEN 1 AND 400),
        starts_at  INTEGER,
        day        TEXT NOT NULL CHECK (length(day) = 10),
        currency   TEXT NOT NULL DEFAULT '' CHECK (length(currency) IN (0, 3)),
        title      TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
        importance TEXT NOT NULL CHECK (importance IN ('low','medium','high')),
        forecast   TEXT,
        previous   TEXT,
        actual     TEXT,
        updated_at INTEGER NOT NULL,
        UNIQUE (source, uid)
    );
    CREATE INDEX economic_events_by_day ON economic_events (day);
    CREATE INDEX economic_events_by_start ON economic_events (importance, starts_at);",
    // v15 — pre-trade analysis and ideas to watch (lot 31). Text to read only, nothing computes money from it.
    // Questions are never deleted (answers keep pointing to them): `archived` hides them, like tags. A NULL
    // `label` = the original wording, which the interface translates from `key`. `value` of an answer is JSON
    // whose shape depends on the question `kind` (validated by `analysis::sessions`). Prices of an idea are exact
    // decimals in TEXT. Deleting a trade removes its links, never the idea or the analysis; an instrument used
    // by an idea cannot be deleted (no cascade).
    "CREATE TABLE analysis_questions (
        id       INTEGER PRIMARY KEY,
        key      TEXT NOT NULL UNIQUE CHECK (length(key) BETWEEN 1 AND 60),
        label    TEXT CHECK (label IS NULL OR length(label) BETWEEN 1 AND 200),
        kind     TEXT NOT NULL CHECK (kind IN ('shortText','longText','choice','trend','conviction','setups','emotions','news')),
        position INTEGER NOT NULL,
        archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
        options  TEXT NOT NULL DEFAULT '{}'
    );
    INSERT INTO analysis_questions (key, kind, position, options) VALUES
        ('trend',           'trend',      1, '{\"timeframes\":[\"monthly\",\"weekly\",\"daily\",\"h4\",\"h1\"]}'),
        ('levels',          'longText',   2, '{}'),
        ('news',            'news',       3, '{}'),
        ('alts',            'longText',   4, '{}'),
        ('scenarioMain',    'longText',   5, '{}'),
        ('scenarioAlt',     'longText',   6, '{}'),
        ('invalidation',    'longText',   7, '{}'),
        ('assets',          'shortText',  8, '{}'),
        ('setups',          'setups',     9, '{}'),
        ('conviction',      'conviction', 10, '{}'),
        ('riskLimits',      'shortText',  11, '{}'),
        ('state',           'emotions',   12, '{}'),
        ('mistakeToAvoid',  'shortText',  13, '{}');
    CREATE TABLE analyses (
        id            INTEGER PRIMARY KEY,
        created_at    INTEGER NOT NULL,
        tz_offset_min INTEGER NOT NULL,
        day           TEXT NOT NULL CHECK (length(day) = 10),
        updated_at    INTEGER NOT NULL,
        note          TEXT CHECK (note IS NULL OR length(note) <= 2000)
    );
    CREATE INDEX analyses_by_day ON analyses (day, created_at);
    CREATE TABLE analysis_answers (
        analysis_id INTEGER NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
        question_id INTEGER NOT NULL REFERENCES analysis_questions(id),
        value       TEXT NOT NULL CHECK (length(value) >= 1),
        PRIMARY KEY (analysis_id, question_id)
    );
    CREATE TABLE ideas (
        id                INTEGER PRIMARY KEY,
        instrument_id     INTEGER NOT NULL REFERENCES instruments(id),
        timeframes        TEXT NOT NULL DEFAULT '[]',
        note              TEXT NOT NULL CHECK (length(trim(note)) BETWEEN 1 AND 4000),
        level_low         TEXT CHECK (level_low IS NULL OR (level_low GLOB '[0-9]*' AND level_low NOT GLOB '*[^0-9.]*')),
        level_high        TEXT CHECK (level_high IS NULL OR (level_high GLOB '[0-9]*' AND level_high NOT GLOB '*[^0-9.]*')),
        invalidation      TEXT CHECK (invalidation IS NULL OR length(invalidation) <= 2000),
        created_at        INTEGER NOT NULL,
        updated_at        INTEGER NOT NULL,
        last_reviewed_at  INTEGER,
        status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
        outcome           TEXT CHECK (outcome IS NULL OR outcome IN ('worked', 'invalidated', 'noFollowUp')),
        closed_at         INTEGER,
        snoozed_until_day TEXT CHECK (snoozed_until_day IS NULL OR length(snoozed_until_day) = 10),
        snooze_count      INTEGER NOT NULL DEFAULT 0 CHECK (snooze_count >= 0),
        CHECK ((status = 'closed') = (outcome IS NOT NULL AND closed_at IS NOT NULL))
    );
    CREATE INDEX ideas_by_status ON ideas (status, instrument_id);
    CREATE TABLE idea_notes (
        id         INTEGER PRIMARY KEY,
        idea_id    INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
        created_at INTEGER NOT NULL,
        kind       TEXT NOT NULL CHECK (kind IN ('created', 'edit', 'complement', 'snooze', 'closed')),
        body       TEXT NOT NULL DEFAULT '' CHECK (length(body) <= 4000),
        data       TEXT
    );
    CREATE INDEX idea_notes_by_idea ON idea_notes (idea_id, created_at, id);
    CREATE TABLE trade_ideas (
        trade_id INTEGER NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
        idea_id  INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
        PRIMARY KEY (trade_id, idea_id)
    );
    CREATE INDEX trade_ideas_by_idea ON trade_ideas (idea_id);
    CREATE TABLE trade_analyses (
        trade_id    INTEGER NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
        analysis_id INTEGER NOT NULL REFERENCES analyses(id) ON DELETE CASCADE,
        PRIMARY KEY (trade_id, analysis_id)
    );
    CREATE INDEX trade_analyses_by_analysis ON trade_analyses (analysis_id);",
    // v16 — prop firm rules (lot 33): one row per `prop` account, deleted with it. Money and percents are
    // exact decimals in TEXT (validated by `prop::rules`, the CHECKs are a coarse net); a limit is either
    // both columns or none. `started_on` is a day "YYYY-MM-DD", `reset_time` "HH:MM" in `reset_zone`.
    "CREATE TABLE prop_rules (
        account_id                INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        phase_label               TEXT CHECK (phase_label IS NULL OR length(trim(phase_label)) BETWEEN 1 AND 60),
        started_on                TEXT NOT NULL CHECK (length(started_on) = 10),
        daily_loss_mode           TEXT CHECK (daily_loss_mode IS NULL OR daily_loss_mode IN ('percent','amount')),
        daily_loss_value          TEXT,
        daily_reference           TEXT NOT NULL CHECK (daily_reference IN ('initial_balance','day_start_balance')),
        max_loss_mode             TEXT CHECK (max_loss_mode IS NULL OR max_loss_mode IN ('percent','amount')),
        max_loss_value            TEXT,
        max_loss_kind             TEXT NOT NULL CHECK (max_loss_kind IN ('static','trailing')),
        trailing_locks_at_initial INTEGER NOT NULL DEFAULT 0 CHECK (trailing_locks_at_initial IN (0,1)),
        reset_time                TEXT NOT NULL CHECK (length(reset_time) = 5),
        reset_zone                TEXT NOT NULL CHECK (reset_zone IN ('paris','new_york')),
        profit_target_mode        TEXT CHECK (profit_target_mode IS NULL OR profit_target_mode IN ('percent','amount')),
        profit_target_value       TEXT,
        min_trading_days          INTEGER CHECK (min_trading_days IS NULL OR min_trading_days >= 1),
        consistency_max_best_day_percent TEXT,
        updated_at                INTEGER NOT NULL,
        CHECK ((daily_loss_mode IS NULL) = (daily_loss_value IS NULL)),
        CHECK ((max_loss_mode IS NULL) = (max_loss_value IS NULL)),
        CHECK ((profit_target_mode IS NULL) = (profit_target_value IS NULL))
    );
    CREATE TRIGGER prop_rules_prop_account_only BEFORE INSERT ON prop_rules
    WHEN (SELECT kind FROM accounts WHERE id = NEW.account_id) IS NOT 'prop'
    BEGIN SELECT RAISE(ABORT, 'prop rules need a prop account'); END;",
    // Lot 35 — voluntary pause (asked as v18: the v15 to v17 of the parallel lots are not in this branch,
    // so this is the next free number here; to renumber at the merge). A reminder, never a lock: nothing
    // reads this table to refuse a trade. Instants are UTC ms; `ended_at` stays NULL while the pause runs
    // or when it ended by itself at `planned_end_at`. No foreign key: a pause belongs to the trader, not
    // to an account. Not exported (CSV, PDF), not read by the coach, never sent anywhere.
    "CREATE TABLE pauses (
        id             INTEGER PRIMARY KEY,
        started_at     INTEGER NOT NULL,
        planned_end_at INTEGER NOT NULL,
        ended_at       INTEGER,
        tz_offset_min  INTEGER NOT NULL CHECK (tz_offset_min BETWEEN -840 AND 840),
        reason         TEXT CHECK (reason IS NULL OR length(reason) BETWEEN 1 AND 20),
        note           TEXT CHECK (note IS NULL OR length(note) BETWEEN 1 AND 140),
        CHECK (planned_end_at > started_at),
        CHECK (ended_at IS NULL OR ended_at >= started_at)
    );
    CREATE INDEX pauses_by_start ON pauses (started_at);",
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
    fn v3_renames_untouched_starter_tags_only() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrate_to(&mut conn, 2).unwrap();
        // The user renamed "Doubt", archived "Stress", made their own "Trend" setup,
        // and already created "Calme" by hand before the upgrade.
        conn.execute_batch(
            "UPDATE tags SET name = 'My doubt', name_key = 'my doubt' WHERE name = 'Doubt';
             UPDATE tags SET archived = 1 WHERE name = 'Stress';
             INSERT INTO tags (kind, name, name_key) VALUES ('setup','Trend','trend'), ('emotion','Calme','calme');",
        )
        .unwrap();
        let account = account_v2(&conn);
        let doubt_id: i64 = conn.query_row("SELECT id FROM tags WHERE name = 'My doubt'", [], |r| r.get(0)).unwrap();
        conn.execute("INSERT INTO instruments (symbol, symbol_key, asset_class, default_multiplier) VALUES ('EURUSD','EURUSD','forex','100000')", []).unwrap();
        let eu = conn.last_insert_rowid();
        conn.execute(
            "INSERT INTO trades (account_id, instrument_id, direction, size, multiplier, entry_price, entry_time, fees)
             VALUES (?1, ?2, 'long', '1', '1', '1', 0, '0')",
            rusqlite::params![account, eu],
        )
        .unwrap();
        let trade_id = conn.last_insert_rowid();
        conn.execute("INSERT INTO trade_emotions (trade_id, moment, tag_id) VALUES (?1,'before',?2)", rusqlite::params![trade_id, doubt_id]).unwrap();

        migrate_to(&mut conn, 3).unwrap();
        assert_eq!(current_version(&conn).unwrap(), 3);

        let names = |kind: &str| -> Vec<String> {
            let mut s = conn.prepare("SELECT name FROM tags WHERE kind = ?1 ORDER BY name_key").unwrap();
            s.query_map([kind], |r| r.get(0)).unwrap().collect::<std::result::Result<_, _>>().unwrap()
        };
        assert_eq!(names("session"), ["Asie", "Londres", "New York"]);
        assert_eq!(names("market_condition"), ["Actualité économique", "Forte volatilité", "Range", "Tendance"]);
        // "Calm" collides with the user's own "Calme": left as is. "My doubt" untouched.
        let emotions = names("emotion");
        assert!(emotions.contains(&"Calm".to_string()) && emotions.contains(&"Calme".to_string()));
        assert!(emotions.contains(&"My doubt".to_string()) && !emotions.contains(&"Doute".to_string()));
        assert!(emotions.contains(&"Peur de rater (FOMO)".to_string()));
        assert!(names("mistake").contains(&"Sortie trop tôt".to_string()));
        // The user's own setup keeps its name; archived state and links survive; keys stay in sync.
        assert_eq!(names("setup"), ["Trend"]);
        let archived: i64 = conn.query_row("SELECT archived FROM tags WHERE name = 'Stress'", [], |r| r.get(0)).unwrap();
        assert_eq!(archived, 1);
        let linked: i64 = conn.query_row("SELECT COUNT(*) FROM trade_emotions WHERE tag_id = ?1", [doubt_id], |r| r.get(0)).unwrap();
        assert_eq!(linked, 1);
        let bad_keys: i64 = conn.query_row("SELECT COUNT(*) FROM tags WHERE name_key <> lower(name)", [], |r| r.get(0)).unwrap();
        assert_eq!(bad_keys, 0);
        // Renamed tags are found by their new name, not duplicated.
        assert!(crate::tags::find(&conn, crate::tags::TagKind::Session, "londres").unwrap().is_some());
        assert!(crate::tags::create(&conn, crate::tags::TagKind::Session, "Asie").is_err());
        let leftovers: i64 = conn.query_row("SELECT COUNT(*) FROM sqlite_temp_master WHERE name = 'tag_renames'", [], |r| r.get(0)).unwrap();
        assert_eq!(leftovers, 0);
    }

    fn account_v2(conn: &Connection) -> i64 {
        conn.execute("INSERT INTO accounts (name, kind) VALUES ('A','personal')", []).unwrap();
        conn.last_insert_rowid()
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

    #[test]
    fn v4_seeds_catalog_without_touching_existing_instruments() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrate_to(&mut conn, 3).unwrap();
        // The user already created SOLUSD by hand (as an "other" asset, multiplier 10) and
        // has a trade on EURUSD.
        conn.execute_batch(
            "INSERT INTO instruments (symbol, symbol_key, asset_class, default_multiplier)
             VALUES ('sol/usd', 'SOLUSD', 'other', '10'), ('EURUSD', 'EURUSD', 'forex', '50000');",
        )
        .unwrap();
        let account = account_v2(&conn);
        let eu: i64 = conn.query_row("SELECT id FROM instruments WHERE symbol_key = 'EURUSD'", [], |r| r.get(0)).unwrap();
        conn.execute(
            "INSERT INTO trades (account_id, instrument_id, direction, size, multiplier, entry_price, entry_time, fees)
             VALUES (?1, ?2, 'long', '1', '1', '1', 0, '0')",
            rusqlite::params![account, eu],
        )
        .unwrap();

        migrate_to(&mut conn, 4).unwrap();
        assert_eq!(current_version(&conn).unwrap(), 4);

        let row = |key: &str| -> (i64, String, String, String, String) {
            conn.query_row(
                "SELECT id, symbol, name, asset_class, default_multiplier FROM instruments WHERE symbol_key = ?1",
                [key],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .unwrap()
        };
        // User values win; only the empty name is completed.
        let sol = row("SOLUSD");
        assert_eq!((sol.1.as_str(), sol.2.as_str(), sol.3.as_str(), sol.4.as_str()), ("sol/usd", "Solana", "other", "10"));
        let eur = row("EURUSD");
        assert_eq!(eur.0, eu, "existing instrument keeps its id, so its trades stay linked");
        assert_eq!((eur.3.as_str(), eur.4.as_str()), ("forex", "50000"));
        // No duplicate symbol, catalog fully present, trade intact.
        let (total, distinct): (i64, i64) = conn
            .query_row("SELECT COUNT(*), COUNT(DISTINCT symbol_key) FROM instruments", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!(total, distinct);
        let catalog_rows = include_str!("../catalog/assets.csv").lines().filter(|l| !l.is_empty() && !l.starts_with('#')).count();
        assert_eq!(total as usize, catalog_rows);
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM trades WHERE instrument_id = ?1", [eu], |r| r.get::<_, i64>(0)).unwrap(), 1);
        // Fresh database: same catalog, and a second migrate run changes nothing.
        let mut fresh = Connection::open_in_memory().unwrap();
        migrate(&mut fresh).unwrap();
        migrate(&mut fresh).unwrap();
        assert_eq!(fresh.query_row("SELECT COUNT(*) FROM instruments", [], |r| r.get::<_, i64>(0)).unwrap() as usize, catalog_rows);
    }

    #[test]
    fn v5_adds_archived_flag_and_keeps_existing_accounts_active() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrate_to(&mut conn, 4).unwrap();
        conn.execute_batch(
            "INSERT INTO accounts (id, name, kind, initial_capital) VALUES (1, 'Main', 'personal', '1234.50');
             INSERT INTO cash_flows (account_id, kind, amount, occurred_at, tz_offset_min, note)
                VALUES (1, 'deposit', '100', 0, 0, '');",
        )
        .unwrap();
        let id = 1;
        migrate(&mut conn).unwrap();
        assert_eq!(current_version(&conn).unwrap(), latest_version());
        let a = accounts::get(&conn, id).unwrap();
        assert!(!a.archived && a.has_history);
        assert_eq!(a.initial_capital.to_string(), "1234.50");
        assert_eq!(crate::cash_flows::list(&conn, &[id]).unwrap().len(), 1);
        assert!(conn.execute("UPDATE accounts SET archived = 2", []).is_err(), "CHECK refuses other values");
    }

    #[test]
    fn v6_adds_journal_and_goals_and_keeps_existing_data() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrate_to(&mut conn, 5).unwrap();
        let account = account_v2(&conn);
        conn.execute("INSERT INTO settings (key, value) VALUES ('keep', 'me')", []).unwrap();

        migrate_to(&mut conn, 6).unwrap();
        assert_eq!(current_version(&conn).unwrap(), 6);
        let account_still_there: i64 =
            conn.query_row("SELECT COUNT(*) FROM accounts WHERE id = ?1", [account], |r| r.get(0)).unwrap();
        assert_eq!(account_still_there, 1);
        let kept: String = conn.query_row("SELECT value FROM settings WHERE key = 'keep'", [], |r| r.get(0)).unwrap();
        assert_eq!(kept, "me");
        for table in ["journal_entries", "goals"] {
            let n: i64 = conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0)).unwrap();
            assert_eq!(n, 0, "{table} starts empty");
        }
        // Guards written straight to the schema.
        assert!(conn.execute("INSERT INTO journal_entries (day) VALUES ('2026-09-29')", []).is_ok());
        assert!(conn.execute("INSERT INTO journal_entries (day) VALUES ('2026-09-29')", []).is_err(), "one entry per day");
        assert!(conn.execute("INSERT INTO journal_entries (day) VALUES ('29/09/2026')", []).is_err());
        assert!(conn.execute("INSERT INTO journal_entries (day, mood) VALUES ('2026-09-30', 6)", []).is_err());
        assert!(conn.execute("INSERT INTO goals (month, metric, target) VALUES ('2026-09', 'net_pnl', '500')", []).is_ok());
        assert!(conn.execute("INSERT INTO goals (month, metric, target) VALUES ('2026-09', 'net_pnl', '600')", []).is_err(), "one goal per month and metric");
        assert!(conn.execute("INSERT INTO goals (month, metric, target) VALUES ('2026-09', 'win_rate', '0')", []).is_err());
        assert!(conn.execute("INSERT INTO goals (month, metric, target) VALUES ('2026-09', 'sharpe', '1')", []).is_err());
        assert!(conn.execute("INSERT INTO goals (month, metric, target) VALUES ('2026-09', 'win_rate', '1e2')", []).is_err());
    }

    #[test]
    fn v7_adds_discipline_score_goals_and_keeps_existing_goals() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrate_to(&mut conn, 6).unwrap();
        conn.execute("INSERT INTO goals (month, metric, target) VALUES ('2026-09', 'net_pnl', '500.50')", []).unwrap();
        conn.execute("INSERT INTO goals (month, metric, target) VALUES ('2026-09', 'win_rate', '55')", []).unwrap();
        conn.execute("INSERT INTO goals (month, metric, target) VALUES ('2026-08', 'max_drawdown', '120')", []).unwrap();
        assert!(conn.execute("INSERT INTO goals (month, metric, target) VALUES ('2026-09', 'discipline_score', '80')", []).is_err(), "not allowed before v7");
        let before: Vec<(i64, String, String, String, String)> = conn
            .prepare("SELECT id, month, metric, target, created_at FROM goals ORDER BY id")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))
            .unwrap()
            .collect::<std::result::Result<_, _>>()
            .unwrap();

        migrate_to(&mut conn, 7).unwrap();
        assert_eq!(current_version(&conn).unwrap(), 7);
        let after: Vec<(i64, String, String, String, String)> = conn
            .prepare("SELECT id, month, metric, target, created_at FROM goals ORDER BY id")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))
            .unwrap()
            .collect::<std::result::Result<_, _>>()
            .unwrap();
        assert_eq!(before, after, "existing goals are kept exactly, ids and dates included");
        // The new metric is accepted; the old guards still hold.
        assert!(conn.execute("INSERT INTO goals (month, metric, target) VALUES ('2026-09', 'discipline_score', '80')", []).is_ok());
        assert!(conn.execute("INSERT INTO goals (month, metric, target) VALUES ('2026-09', 'discipline_score', '85')", []).is_err(), "one goal per month and metric");
        assert!(conn.execute("INSERT INTO goals (month, metric, target) VALUES ('2026-10', 'net_pnl', '0')", []).is_err());
        assert!(conn.execute("INSERT INTO goals (month, metric, target) VALUES ('2026-10', 'sharpe', '1')", []).is_err());
        assert!(conn.execute("INSERT INTO goals (month, metric, target) VALUES ('2026-10', 'net_pnl', '1e2')", []).is_err());
    }

    #[test]
    fn v8_adds_the_alert_log_and_keeps_existing_data() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrate_to(&mut conn, 7).unwrap();
        let a = account(&conn, "10000");
        let eu = instrument(&conn, "EURUSD", "100000");
        let trade = trades::create(&conn, &trades::TradeData::new(a, eu, trades::Direction::Long, 1.into(), 1.into(), 0)).unwrap();
        conn.execute("INSERT INTO settings (key, value) VALUES ('behavior.max_trades_per_day', '3')", []).unwrap();
        conn.execute("INSERT INTO goals (month, metric, target) VALUES ('2026-09', 'discipline_score', '80')", []).unwrap();

        migrate(&mut conn).unwrap();
        assert_eq!(current_version(&conn).unwrap(), latest_version());
        // Existing data untouched.
        assert_eq!(accounts::list(&conn).unwrap().len(), 1);
        assert_eq!(trades::get(&conn, trade.id).unwrap().data.account_id, a);
        let kept: String = conn.query_row("SELECT value FROM settings WHERE key = 'behavior.max_trades_per_day'", [], |r| r.get(0)).unwrap();
        assert_eq!(kept, "3");
        let goals: i64 = conn.query_row("SELECT COUNT(*) FROM goals", [], |r| r.get(0)).unwrap();
        assert_eq!(goals, 1);
        let log: i64 = conn.query_row("SELECT COUNT(*) FROM alert_log", [], |r| r.get(0)).unwrap();
        assert_eq!(log, 0, "the history starts empty");
        // Guards written straight to the schema.
        let insert = |id: &str, account: i64, severity: &str| {
            conn.execute(
                "INSERT INTO alert_log (alert_id, account_id, kind, severity, payload, first_seen_at) VALUES (?1, ?2, 'x', ?3, '{}', 0)",
                rusqlite::params![id, account, severity],
            )
        };
        assert!(insert("x:1:1", a, "warning").is_ok());
        assert!(insert("x:1:1", a, "critical").is_err(), "one line per alert identity");
        assert!(insert("x:1:2", a, "info").is_err());
        assert!(insert("", a, "warning").is_err());
        assert!(insert("x:9:1", 999, "warning").is_err(), "unknown account");
    }

    #[test]
    fn v9_adds_dashboards_and_keeps_existing_data() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrate_to(&mut conn, 8).unwrap();
        let account = account_v2(&conn);
        conn.execute("INSERT INTO settings (key, value) VALUES ('keep', 'me')", []).unwrap();
        conn.execute("INSERT INTO goals (month, metric, target) VALUES ('2026-09', 'net_pnl', '500')", []).unwrap();
        conn.execute("INSERT INTO settings (key, value) VALUES ('behavior.max_trades_per_day', '3')", []).unwrap();

        migrate_to(&mut conn, 9).unwrap();
        assert_eq!(current_version(&conn).unwrap(), 9);
        let kept: String = conn.query_row("SELECT value FROM settings WHERE key = 'keep'", [], |r| r.get(0)).unwrap();
        assert_eq!(kept, "me");
        let goals: i64 = conn.query_row("SELECT COUNT(*) FROM goals", [], |r| r.get(0)).unwrap();
        assert_eq!(goals, 1);
        for table in ["dashboards", "dashboard_widgets"] {
            let n: i64 = conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0)).unwrap();
            assert_eq!(n, 0, "{table} starts empty: the default dashboard is a built-in preset");
        }
        // The existing user lands on the dashboard they always had.
        assert_eq!(crate::dashboards::startup(&conn).unwrap().key, "preset:essential");

        // Guards written straight to the schema.
        assert!(conn.execute("INSERT INTO dashboards (name) VALUES ('Mon dashboard')", []).is_ok());
        assert!(conn.execute("INSERT INTO dashboards (name) VALUES (' mon DASHBOARD ')", []).is_err(), "names are unique, case and spaces aside");
        assert!(conn.execute("INSERT INTO dashboards (name) VALUES ('   ')", []).is_err());
        let widget = |extra: &str| format!("INSERT INTO dashboard_widgets (dashboard_id, uid, kind, x, y, w, h{extra}) ");
        assert!(conn.execute(&(widget("") + "VALUES (1, 'a', 'kpi', 0, 0, 6, 6)"), []).is_ok());
        assert!(conn.execute(&(widget("") + "VALUES (1, 'a', 'kpi', 6, 0, 6, 6)"), []).is_err(), "uid unique in a dashboard");
        assert!(conn.execute(&(widget("") + "VALUES (1, 'b', 'kpi', -1, 0, 6, 6)"), []).is_err());
        assert!(conn.execute(&(widget("") + "VALUES (1, 'b', 'kpi', 0, 0, 0, 6)"), []).is_err());
        assert!(conn.execute(&(widget("") + "VALUES (2, 'b', 'kpi', 0, 0, 6, 6)"), []).is_err(), "dashboard must exist");
        assert!(conn.execute(&(widget(", period") + "VALUES (1, 'b', 'kpi', 6, 0, 6, 6, '2W')"), []).is_err());
        assert!(conn.execute(&(widget(", period, account_id") + &format!("VALUES (1, 'b', 'kpi', 6, 0, 6, 6, '1M', {account})")), []).is_ok());
        // Deleting an account keeps the widget; deleting the dashboard removes its widgets.
        conn.execute("DELETE FROM accounts WHERE id = ?1", [account]).unwrap();
        let acc: Option<i64> = conn.query_row("SELECT account_id FROM dashboard_widgets WHERE uid = 'b'", [], |r| r.get(0)).unwrap();
        assert_eq!(acc, None);
        conn.execute("DELETE FROM dashboards WHERE id = 1", []).unwrap();
        let n: i64 = conn.query_row("SELECT COUNT(*) FROM dashboard_widgets", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
    }

    #[test]
    fn v10_adds_dashboard_scope_and_keeps_existing_dashboards_and_default() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrate_to(&mut conn, 9).unwrap();
        let account = account_v2(&conn);
        // A user of v9 with two dashboards, widgets pinned to an account, and one of them as default.
        conn.execute("INSERT INTO dashboards (name, position) VALUES ('Mon suivi', 1), ('Autre', 2)", []).unwrap();
        conn.execute(
            "INSERT INTO dashboard_widgets (dashboard_id, uid, kind, x, y, w, h, account_id) VALUES (1, 'a', 'calendar', 0, 0, 13, 13, ?1)",
            [account],
        )
        .unwrap();
        conn.execute("INSERT INTO settings (key, value) VALUES ('dashboard.default', 'custom:2')", []).unwrap();

        migrate_to(&mut conn, 10).unwrap();
        assert_eq!(current_version(&conn).unwrap(), 10);
        let all = crate::dashboards::list(&conn).unwrap();
        let mine: Vec<_> = all.iter().filter(|d| !d.builtin).collect();
        assert_eq!(mine.iter().map(|d| d.name.as_str()).collect::<Vec<_>>(), ["Mon suivi", "Autre"]);
        assert!(all.iter().all(|d| d.scope == crate::dashboards::DashboardScope::FOLLOW), "existing dashboards keep following the top bar");
        assert_eq!(mine[0].widget_count, 1);
        assert_eq!(crate::dashboards::startup(&conn).unwrap().key, "custom:2", "the default dashboard is unchanged");
        let pinned = crate::dashboards::get(&conn, "custom:1").unwrap().widgets[0].account_id;
        assert_eq!(pinned, Some(account), "widget settings are unchanged");

        // Guards written straight to the schema.
        assert!(conn.execute("UPDATE dashboards SET scope = 'weird' WHERE id = 1", []).is_err());
        assert!(conn.execute("UPDATE dashboards SET scope = 'account', scope_account_id = ?1 WHERE id = 1", [account]).is_ok());
        assert!(conn.execute("UPDATE dashboards SET scope_account_id = 999 WHERE id = 1", []).is_err(), "unknown account");
        conn.execute("DELETE FROM accounts WHERE id = ?1", [account]).unwrap();
        let (scope, acc): (String, Option<i64>) =
            conn.query_row("SELECT scope, scope_account_id FROM dashboards WHERE id = 1", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!((scope.as_str(), acc), ("account", None), "the dashboard survives its account");
    }

    #[test]
    fn v11_adds_the_insight_log_and_keeps_existing_data() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        migrate_to(&mut conn, 10).unwrap();
        let a = account(&conn, "10000");
        let eu = instrument(&conn, "EURUSD", "100000");
        let trade = trades::create(&conn, &trades::TradeData::new(a, eu, trades::Direction::Long, 1.into(), 1.into(), 0)).unwrap();
        conn.execute("INSERT INTO alert_log (alert_id, account_id, kind, severity, payload, first_seen_at) VALUES ('x:1:1', ?1, 'x', 'warning', '{}', 0)", [a])
            .unwrap();
        conn.execute("INSERT INTO dashboards (name, scope, scope_account_id) VALUES ('Prop', 'account', ?1)", [a]).unwrap();
        conn.execute("INSERT INTO settings (key, value) VALUES ('behavior.max_trades_per_day', '3')", []).unwrap();

        migrate_to(&mut conn, 11).unwrap();
        assert_eq!(current_version(&conn).unwrap(), 11);
        // Existing data untouched.
        assert_eq!(trades::get(&conn, trade.id).unwrap().data.account_id, a);
        let count = |sql: &str| -> i64 { conn.query_row(sql, [], |r| r.get(0)).unwrap() };
        assert_eq!(count("SELECT COUNT(*) FROM alert_log"), 1);
        assert_eq!(count("SELECT COUNT(*) FROM dashboards WHERE scope = 'account'"), 1);
        assert_eq!(count("SELECT COUNT(*) FROM settings WHERE key = 'behavior.max_trades_per_day'"), 1);
        assert_eq!(count("SELECT COUNT(*) FROM insight_log"), 0, "the history starts empty");

        // Guards written straight to the schema.
        let insert = |id: &str, account: i64, level: i64, episode: i64, category: &str, priority: &str| {
            conn.execute(
                "INSERT INTO insight_log (insight_id, account_id, situation, level, episode, kind, category, priority, payload, first_seen_at, last_seen_at)
                 VALUES (?1, ?2, 'k:1:s', ?3, ?4, 'k', ?5, ?6, '{}', 0, 0)",
                rusqlite::params![id, account, level, episode, category, priority],
            )
        };
        assert!(insert("k:1:s:0#1", a, 0, 1, "trend", "high").is_ok());
        assert!(insert("k:1:s:0#1", a, 0, 1, "trend", "high").is_err(), "one line per identity");
        assert!(insert("k:1:s:1#1", a, -1, 1, "trend", "high").is_err());
        assert!(insert("k:1:s:1#0", a, 1, 0, "trend", "high").is_err());
        assert!(insert("k:1:s:2#1", a, 2, 1, "news", "high").is_err());
        assert!(insert("k:1:s:3#1", a, 3, 1, "trend", "urgent").is_err());
        assert!(insert("", a, 4, 1, "trend", "high").is_err());
        assert!(insert("k:9:s:0#1", 999, 0, 1, "trend", "high").is_err(), "unknown account");
        // Deleting the account removes its insight history.
        conn.execute("DELETE FROM trades", []).unwrap();
        conn.execute("DELETE FROM accounts WHERE id = ?1", [a]).unwrap();
        assert_eq!(count("SELECT COUNT(*) FROM insight_log"), 0);
    }
    #[test]
    fn the_pause_table_is_added_and_existing_data_is_kept() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "foreign_keys", "ON").unwrap();
        let before = latest_version() - 1; // the pause migration is the last one
        migrate_to(&mut conn, before).unwrap();
        let a = account(&conn, "10000");
        let eu = instrument(&conn, "EURUSD", "100000");
        let mut t = trades::TradeData::new(a, eu, trades::Direction::Long, "1".parse().unwrap(), "1.1".parse().unwrap(), 1_000);
        t.exit_price = Some("1.2".parse().unwrap());
        t.exit_time = Some(2_000);
        trades::create(&conn, &t).unwrap();
        conn.execute("INSERT INTO settings (key, value) VALUES ('dashboard.default', 'custom:2')", []).unwrap();
        assert!(conn.prepare("SELECT * FROM pauses").is_err(), "no pauses before");

        migrate_to(&mut conn, latest_version()).unwrap();
        assert_eq!(current_version(&conn).unwrap(), latest_version());
        let count = |sql: &str| conn.query_row(sql, [], |r| r.get::<_, i64>(0)).unwrap();
        assert_eq!((count("SELECT COUNT(*) FROM trades"), count("SELECT COUNT(*) FROM accounts"), count("SELECT COUNT(*) FROM settings WHERE key = 'dashboard.default'")), (1, 1, 1));
        assert_eq!(count("SELECT COUNT(*) FROM pauses"), 0);
        // No foreign key: deleting an account (and its trades) never touches a pause.
        conn.execute("INSERT INTO pauses (started_at, planned_end_at, tz_offset_min) VALUES (1000, 2000, 60)", []).unwrap();
        conn.execute("DELETE FROM trades", []).unwrap();
        conn.execute("DELETE FROM accounts WHERE id = ?1", [a]).unwrap();
        assert_eq!(count("SELECT COUNT(*) FROM pauses"), 1);
    }
}
