//! MCP access (lot 37), end to end on real local sockets: the coach's tools through the bridge (exactly the
//! same text as `coach::tools::run`), exposed accounts, canary texts, locked app, log, settings, durations,
//! migration v20.

use super::*;
use crate::accounts::{self, NewAccount};
use crate::cash_flows::{self, CashFlowKind, NewCashFlow};
use crate::coach::tools::{self as coach_tools, ToolScope, TOOL_NAMES};
use crate::journal::{self, JournalEntry};
use crate::migrations::{current_version, migrate_to};
use crate::stats::time;
use crate::test_support::{dec, instrument};
use crate::trades::{self, Direction, TradeData};
use crate::{backup, db, export};
use pulse_mcp::client::{self, CallError, Timeouts};
use pulse_mcp::server::{self as mcp_server, ToolReply};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

const DAY: i64 = 86_400_000;
const CANARY: &str = "SECRET-CANARY";

fn now() -> i64 {
    time::days_from_civil(2026, 9, 29).unwrap() * DAY + 12 * 3_600_000
}

fn quick() -> Timeouts {
    Timeouts { connect: Duration::from_secs(1), handshake: Duration::from_secs(3), reply: Duration::from_secs(10) }
}

/// The app side, as the shell does it: the database behind a lock, `None` = locked.
struct DbHost {
    conn: Mutex<Option<Connection>>,
}

impl BridgeHost for DbHost {
    fn run_tool(&self, tool: &str, arguments: &Value) -> ToolReply {
        match self.conn.lock().unwrap().as_ref() {
            None => locked_reply(),
            Some(conn) => run_logged(conn, now(), 0, tool, arguments),
        }
    }
}

struct Fixture {
    dir: tempfile::TempDir,
    host: Arc<DbHost>,
    usd: i64,
    other_usd: i64,
    eur: i64,
}

fn account(conn: &Connection, name: &str, currency: &str, capital: &str) -> i64 {
    accounts::create(conn, &NewAccount { name: name.into(), kind: "prop".into(), broker: format!("{CANARY} broker"), currency: currency.into(), initial_capital: dec(capital) })
        .unwrap()
        .id
}

fn trade(conn: &Connection, account: i64, days_before: i64, entry: &str, exit: &str, sl: Option<&str>) {
    let eu = instrument(conn, "EURUSD", "1");
    let exit_time = now() - days_before * DAY;
    let mut d = TradeData::new(account, eu, Direction::Long, dec("1"), dec(entry), exit_time - 3_600_000);
    d.exit_price = Some(dec(exit));
    d.exit_time = Some(exit_time);
    d.planned_sl = sl.map(dec);
    d.thesis = format!("{CANARY} thèse");
    d.post_mortem = format!("{CANARY} notes");
    d.screenshot_path = Some(format!("screenshots/{CANARY}.png"));
    trades::create(conn, &d).unwrap();
}

fn fixture() -> Fixture {
    let conn = db::open_in_memory().unwrap();
    let usd = account(&conn, &format!("{CANARY} compte"), "USD", "12345.67");
    let other_usd = account(&conn, "Autre USD", "USD", "1000");
    let eur = account(&conn, "Compte EUR", "EUR", "1000");
    cash_flows::create(&conn, &NewCashFlow { account_id: usd, kind: CashFlowKind::Deposit, amount: dec("5000"), occurred_at: 0, tz_offset_min: 0, note: format!("{CANARY} dépôt") }).unwrap();
    trade(&conn, usd, 3, "100", "110", Some("95"));
    trade(&conn, usd, 2, "100", "96", Some("95"));
    trade(&conn, usd, 1, "100", "98", None);
    trade(&conn, other_usd, 1, "100", "150", Some("90"));
    trade(&conn, eur, 1, "100", "101", Some("99"));
    let day = time::day_key(now() - 2 * DAY, 0);
    journal::save(&conn, &JournalEntry { day, mood: Some(1), sleep_quality: Some(1), fatigue: Some(5), late_hours: true, went_well: CANARY.into(), to_improve: CANARY.into(), notes: CANARY.into() }).unwrap();
    settings::record_consent(&conn, 1).unwrap();
    settings::set(&conn, &McpSettingsUpdate { account_ids: vec![usd], duration: McpDuration::UntilClose, autostart: false }).unwrap();
    Fixture { dir: tempfile::tempdir().unwrap(), host: Arc::new(DbHost { conn: Mutex::new(Some(conn)) }), usd, other_usd, eur }
}

impl Fixture {
    fn start(&self) -> Bridge {
        Bridge::start(self.dir.path(), self.host.clone(), Limits::default(), Arc::new(now)).unwrap()
    }

    fn with_conn<T>(&self, f: impl FnOnce(&Connection) -> T) -> T {
        f(self.host.conn.lock().unwrap().as_ref().unwrap())
    }

    fn call(&self, tool: &str, args: Value) -> client::Reply {
        client::call(self.dir.path(), tool, &args, quick()).unwrap()
    }

    fn expose(&self, ids: Vec<i64>) {
        self.with_conn(|c| settings::set(c, &McpSettingsUpdate { account_ids: ids, duration: McpDuration::UntilClose, autostart: false }).unwrap());
    }
}

fn inputs() -> Vec<(&'static str, Value)> {
    TOOL_NAMES
        .iter()
        .flat_map(|&n| match n {
            "segments" => ["weekday", "hour", "setup", "mistake", "emotionAny", "instrument", "plan", "ruleBroken"].iter().map(|b| (n, json!({ "by": b, "period": "Tout" }))).collect::<Vec<_>>(),
            "insights" | "alerts_today" | "list_accounts" => vec![(n, json!({}))],
            "trade_list" => vec![(n, json!({ "period": "Tout", "order": "best", "limit": 20 })), (n, json!({ "period": "1S" }))],
            _ => vec![(n, json!({ "period": "Tout" })), (n, json!({ "period": "1S", "comparePrevious": n == "period_summary" }))],
        })
        .collect()
}

#[test]
fn the_thirteen_tools_answer_through_the_bridge_exactly_like_the_coach() {
    let f = fixture();
    let _bridge = f.start();
    let scope = ToolScope { account_ids: vec![f.usd], now_ms: now(), tz_offset_min: 0 };
    let mut seen = std::collections::BTreeSet::new();
    for (name, input) in inputs() {
        let expected = f.with_conn(|c| coach_tools::run(c, &scope, name, &input));
        let reply = f.call(name, input.clone());
        assert_eq!(reply.text, expected.content.to_string(), "{name} {input}");
        assert_eq!(reply.is_error, expected.is_error, "{name} {input}");
        seen.insert(name);
    }
    assert_eq!(seen.len(), 13);
    // The log holds one row per call with exactly the text sent.
    let rows = f.with_conn(|c| log::list(c, None).unwrap());
    assert_eq!(rows.len(), inputs().len());
    let last = &rows[0];
    let (name, input) = inputs().pop().unwrap();
    assert_eq!((last.tool.as_str(), last.params.clone()), (name, input.to_string()));
    let expected = f.with_conn(|c| coach_tools::run(c, &scope, name, &input));
    assert_eq!(last.result, expected.content.to_string());
    assert_eq!(last.size, last.result.len() as i64);
    assert_eq!(last.at, now());
}

/// The whole path: MCP server (stdio side) → proxy → bridge → coach tool → log.
#[test]
fn a_tools_call_through_the_mcp_server_reaches_the_journal_figures() {
    let f = fixture();
    let _bridge = f.start();
    let backend = pulse_mcp::BridgeBackend { data_dir: f.dir.path().to_path_buf(), timeouts: quick() };
    let input = "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-06-18\"}}\n\
        {\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"period_summary\",\"arguments\":{\"period\":\"1S\"}}}\n";
    let mut out = Vec::new();
    mcp_server::serve(std::io::Cursor::new(input.as_bytes().to_vec()), &mut out, &backend, Vec::new()).unwrap();
    let answers: Vec<Value> = String::from_utf8(out).unwrap().lines().map(|l| serde_json::from_str(l).unwrap()).collect();
    let result = &answers[1]["result"];
    assert_eq!(result["isError"], false);
    let data: Value = serde_json::from_str(result["content"][0]["text"].as_str().unwrap()).unwrap();
    // USD account only: +10, −4, −2 over the last 7 days.
    assert_eq!((data["summary"]["tradeCount"].as_u64(), data["summary"]["netPnl"].as_str(), data["currency"].as_str()), (Some(3), Some("4"), Some("USD")));
    assert_eq!(f.with_conn(|c| log::count(c).unwrap()), 1);
}

#[test]
fn only_the_ticked_accounts_are_readable() {
    let f = fixture();
    let _bridge = f.start();
    let listed = f.call("list_accounts", json!({}));
    let v: Value = serde_json::from_str(&listed.text).unwrap();
    assert_eq!(v["accounts"].as_array().unwrap().iter().map(|a| a["id"].as_i64().unwrap()).collect::<Vec<_>>(), [f.usd]);
    // An account outside the list is refused, even though it exists.
    let other = f.call("period_summary", json!({ "accountId": f.other_usd }));
    assert!(other.is_error && other.text.contains("portée"), "{}", other.text);
    // Without accountId, only the ticked ones are read: the other USD account's +50 is not in the total.
    let all = f.call("period_summary", json!({ "period": "Tout" }));
    assert!(all.text.contains("\"netPnl\":\"4\""), "{}", all.text);

    // No account ticked: no data at all.
    f.expose(vec![]);
    for (name, input) in [("list_accounts", json!({})), ("period_summary", json!({})), ("trade_list", json!({}))] {
        let r = f.call(name, input);
        assert!(r.is_error, "{name}");
        assert!(r.text.contains("mcp:noAccount") && !r.text.contains("netPnl"), "{}", r.text);
    }
    // An archived account stops being readable even if it was ticked.
    f.expose(vec![f.usd, f.other_usd]);
    f.with_conn(|c| accounts::set_archived(c, f.other_usd, true).unwrap());
    let v: Value = serde_json::from_str(&f.call("list_accounts", json!({})).text).unwrap();
    assert_eq!(v["accounts"].as_array().unwrap().len(), 1);
}

#[test]
fn two_currencies_are_never_added_up() {
    let f = fixture();
    let _bridge = f.start();
    f.expose(vec![f.usd, f.eur]);
    let mixed = f.call("period_summary", json!({}));
    assert!(mixed.is_error && mixed.text.contains("devises différentes"), "{}", mixed.text);
    assert!(!f.call("period_summary", json!({ "accountId": f.eur })).is_error);
    assert!(!f.call("alerts_today", json!({})).is_error, "evaluated account by account");
}

/// Account name, broker, capital, deposit note, thesis, post-mortem, screenshot path and journal texts
/// carry the canary: no tool result through the bridge contains it, nor the capital or the balance.
#[test]
fn no_result_ever_carries_free_text_names_or_capital() {
    let f = fixture();
    let _bridge = f.start();
    f.expose(vec![f.usd, f.other_usd]);
    for (name, input) in inputs() {
        let text = f.call(name, input).text;
        assert!(!text.contains(CANARY), "{name} leaks a free text: {text}");
        assert!(!text.contains("12345") && !text.contains("17345"), "{name} leaks the capital or a balance: {text}");
    }
    // The MCP settings and log themselves are never read by a tool.
    f.with_conn(|c| {
        c.execute("INSERT INTO mcp_calls (at, tz_offset_min, tool, params, result, is_error, size, duration_ms) VALUES (1, 0, 'x', ?1, ?1, 0, 1, 0)", [CANARY]).unwrap();
    });
    for (name, input) in inputs() {
        assert!(!f.call(name, input).text.contains(CANARY));
    }
}

#[test]
fn a_locked_app_answers_lock_locked_reads_and_logs_nothing() {
    let f = fixture();
    let _bridge = f.start();
    let before = f.with_conn(|c| log::count(c).unwrap());
    let conn = f.host.conn.lock().unwrap().take(); // locked: the database is closed
    let r = f.call("period_summary", json!({}));
    assert!(r.is_error);
    let v: Value = serde_json::from_str(&r.text).unwrap();
    assert_eq!(v["code"], "lock:locked");
    *f.host.conn.lock().unwrap() = conn;
    assert_eq!(f.with_conn(|c| log::count(c).unwrap()), before, "nothing logged as read");
}

#[test]
fn nothing_listens_while_the_access_is_off_and_the_runtime_needs_consent_and_an_account() {
    let f = fixture();
    assert_eq!(client::call(f.dir.path(), "risk", &json!({}), quick()), Err(CallError::NotRunning));
    let mut rt = McpRuntime::new();
    let clock: Clock = Arc::new(now);
    let no_consent = McpSettings { consent_at: None, account_ids: vec![f.usd], duration: McpDuration::UntilClose, autostart: false };
    let e = rt.start(&no_consent, &[f.usd], f.dir.path(), f.host.clone(), Limits::default(), clock.clone()).unwrap_err();
    assert_eq!(e.to_string(), "invalid input: mcp:consentRequired");
    let s = f.with_conn(|c| settings::get(c).unwrap());
    let e = rt.start(&s, &[], f.dir.path(), f.host.clone(), Limits::default(), clock.clone()).unwrap_err();
    assert_eq!(e.to_string(), "invalid input: mcp:noAccount");
    assert!(!rt.is_active() && !endpoint_path(f.dir.path()).exists());
    // On, then a new token at every activation.
    rt.start(&s, &[f.usd], f.dir.path(), f.host.clone(), Limits::default(), clock.clone()).unwrap();
    let first = std::fs::read_to_string(endpoint_path(f.dir.path())).unwrap();
    rt.start(&s, &[f.usd], f.dir.path(), f.host.clone(), Limits::default(), clock.clone()).unwrap();
    let second = std::fs::read_to_string(endpoint_path(f.dir.path())).unwrap();
    let token = |t: &str| serde_json::from_str::<Value>(t).unwrap()["token"].clone();
    assert_ne!(token(&first), token(&second));
    assert!(!f.call("risk", json!({})).is_error);
    assert_eq!(rt.status().calls, 1);
    assert!(rt.stop(StopReason::Manual, now()));
    assert!(!endpoint_path(f.dir.path()).exists());
    assert_eq!(rt.status().last_stop_reason, Some(StopReason::Manual));
    assert!(!rt.stop(StopReason::Manual, now()), "already off");
}

#[test]
fn durations_end_exactly_on_time_and_locking_turns_the_access_off() {
    assert!(!expired(None, i64::MAX));
    assert!(!expired(Some(1_000), 999));
    assert!(expired(Some(1_000), 1_000), "the end instant itself is off");
    assert_eq!(McpDuration::OneHour.expires_at(10), Some(3_600_010));
    assert_eq!(McpDuration::FourHours.expires_at(10), Some(14_400_010));
    assert_eq!(McpDuration::UntilClose.expires_at(10), None);

    let f = fixture();
    let clock_value = Arc::new(AtomicI64::new(now()));
    let c = Arc::clone(&clock_value);
    let clock: Clock = Arc::new(move || c.load(Ordering::SeqCst));
    let mut rt = McpRuntime::new();
    let mut s = f.with_conn(|c| settings::get(c).unwrap());
    s.duration = McpDuration::OneHour;
    rt.start(&s, &[f.usd], f.dir.path(), f.host.clone(), Limits::default(), clock.clone()).unwrap();
    assert_eq!(rt.status().expires_at, Some(now() + 3_600_000));
    assert!(!rt.tick(now() + 3_599_999));
    assert!(rt.is_active() && endpoint_path(f.dir.path()).exists());
    assert!(rt.tick(now() + 3_600_000));
    assert_eq!((rt.is_active(), rt.status().last_stop_reason), (false, Some(StopReason::Expired)));
    assert!(!endpoint_path(f.dir.path()).exists());

    // « Jusqu'à la fermeture » never expires; locking (by hand or after inactivity) and closing stop it.
    s.duration = McpDuration::UntilClose;
    rt.start(&s, &[f.usd], f.dir.path(), f.host.clone(), Limits::default(), clock.clone()).unwrap();
    assert!(!rt.tick(i64::MAX));
    assert!(rt.stop(StopReason::Locked, now()));
    assert!(!endpoint_path(f.dir.path()).exists());
    assert_eq!(client::call(f.dir.path(), "risk", &json!({}), quick()), Err(CallError::NotRunning));
    rt.start(&s, &[f.usd], f.dir.path(), f.host.clone(), Limits::default(), clock).unwrap();
    drop(rt); // the app closes
    assert!(!endpoint_path(f.dir.path()).exists());
}

#[test]
fn settings_default_to_nothing_and_refuse_unknown_or_archived_accounts() {
    let conn = db::open_in_memory().unwrap();
    let s = settings::get(&conn).unwrap();
    assert_eq!(s, McpSettings { consent_at: None, account_ids: vec![], duration: McpDuration::UntilClose, autostart: false });
    assert_eq!(settings::cannot_enable(&conn, &s).unwrap(), Some("consentRequired"));
    let a = account(&conn, "A", "USD", "1");
    let b = account(&conn, "B", "USD", "1");
    accounts::set_archived(&conn, b, true).unwrap();
    let up = |ids: Vec<i64>| McpSettingsUpdate { account_ids: ids, duration: McpDuration::FourHours, autostart: true };
    for bad in [vec![999], vec![b]] {
        assert_eq!(settings::set(&conn, &up(bad)).unwrap_err().to_string(), "invalid input: mcp:invalidAccount");
    }
    assert_eq!(settings::get(&conn).unwrap(), s, "nothing written");
    let saved = settings::set(&conn, &up(vec![a, a])).unwrap();
    assert_eq!((saved.account_ids, saved.duration, saved.autostart), (vec![a], McpDuration::FourHours, true));
    let consented = settings::record_consent(&conn, 42).unwrap();
    assert_eq!(settings::cannot_enable(&conn, &consented).unwrap(), None);
    let withdrawn = settings::withdraw_consent(&conn).unwrap();
    assert_eq!((withdrawn.consent_at, withdrawn.autostart), (None, false), "the next-launch option needs the consent");
    let mut rt = McpRuntime::new();
    assert!(rt.take_autostart());
    assert!(!rt.take_autostart(), "once per run of the app");
    let st = status(&conn, rt.status()).unwrap();
    assert_eq!((st.runtime.active, st.cannot_enable.as_deref(), st.log_count), (false, Some("consentRequired"), 0));
}

#[test]
fn the_log_keeps_the_500_latest_calls_and_can_be_cleared() {
    let conn = db::open_in_memory().unwrap();
    for i in 0..505 {
        let text = format!("{{\"n\":{i}}}");
        log::record(&conn, &log::NewCall { at: i, tz_offset_min: 120, tool: "risk", params: "{}", result: &text, is_error: i % 2 == 0, duration_ms: 3 }).unwrap();
    }
    let rows = log::list(&conn, None).unwrap();
    assert_eq!(rows.len(), 500);
    assert_eq!((rows[0].at, rows[499].at), (504, 5), "most recent first, the 5 oldest pruned");
    assert_eq!((rows[0].result.as_str(), rows[0].is_error, rows[0].tz_offset_min, rows[0].size), ("{\"n\":504}", true, 120, 9));
    assert_eq!(log::list(&conn, Some(3)).unwrap().len(), 3);
    assert_eq!(log::clear(&conn).unwrap(), 500);
    assert_eq!(log::count(&conn).unwrap(), 0);
    // A very long tool name is cut, never refused (the row is what was answered).
    log::record(&conn, &log::NewCall { at: 1, tz_offset_min: 0, tool: &"x".repeat(200), params: "{}", result: "{}", is_error: true, duration_ms: 0 }).unwrap();
    assert_eq!(log::list(&conn, None).unwrap()[0].tool.len(), 64);
}

#[test]
fn the_log_is_in_the_backup_and_never_in_the_csv_export() {
    let f = fixture();
    let _bridge = f.start();
    f.call("period_summary", json!({}));
    f.with_conn(|conn| {
        let dir = tempfile::tempdir().unwrap();
        let info = backup::create(conn, dir.path(), dir.path(), now()).unwrap();
        let copy = Connection::open(std::path::Path::new(&info.path).join(db::DB_FILE)).unwrap();
        let n: i64 = copy.query_row("SELECT COUNT(*) FROM mcp_calls", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
        let csv = String::from_utf8(export::trades_csv(conn, &Default::default()).unwrap()).unwrap();
        assert!(!csv.contains("period_summary"));
    });
}

#[test]
fn v20_adds_the_mcp_log_and_keeps_existing_data() {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    migrate_to(&mut conn, 14).unwrap();
    let a = crate::test_support::account(&conn, "10000");
    let eu = instrument(&conn, "EURUSD", "100000");
    let t = trades::create(&conn, &TradeData::new(a, eu, Direction::Long, 1.into(), 1.into(), 0)).unwrap().id;
    conn.execute("INSERT INTO settings (key, value) VALUES ('ai.enabled', 'on')", []).unwrap();
    conn.execute("INSERT INTO economic_events (source, uid, day, title, importance, updated_at) VALUES ('file', 'u', '2026-09-29', 'CPI', 'high', 1)", []).unwrap();

    migrate_to(&mut conn, 20).unwrap();
    assert_eq!(current_version(&conn).unwrap(), 20);
    assert_eq!(trades::get(&conn, t).unwrap().id, t);
    let events: i64 = conn.query_row("SELECT COUNT(*) FROM economic_events", [], |r| r.get(0)).unwrap();
    assert_eq!(events, 1);
    assert!(crate::ai::get_settings(&conn).unwrap().enabled);
    assert_eq!(log::count(&conn).unwrap(), 0);

    let insert = |tool: &str, is_error: i64, size: i64| {
        conn.execute("INSERT INTO mcp_calls (at, tz_offset_min, tool, params, result, is_error, size, duration_ms) VALUES (1, 0, ?1, '{}', '{}', ?2, ?3, 0)", rusqlite::params![tool, is_error, size])
    };
    assert!(insert("risk", 0, 2).is_ok());
    assert!(insert("", 0, 2).is_err(), "a tool name");
    assert!(insert("risk", 2, 2).is_err(), "a boolean");
    assert!(insert("risk", 1, -1).is_err(), "a size");
}
