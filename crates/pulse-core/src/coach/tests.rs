//! Coach (lot 21): tools on a journal computed by hand, what never leaves (canary strings), bounded
//! parameters, read-only tools, stored conversations, consent, migration v13.
//!
//! Journal C (tz UTC, EURUSD multiplier 1, size 1), `NOW` = 2026-09-29 12:00 UTC (a Tuesday):
//!
//! | Trade | Exit (days before today) | Side  | Entry → exit | SL  | Net PnL | R    | Tags / plan              |
//! |-------|--------------------------|-------|--------------|-----|---------|------|--------------------------|
//! | T0    | 40                       | long  | 100 → 105    | 95  | +5      | 1    | —                        |
//! | T1    | 3                        | long  | 100 → 110    | 95  | +10     | 2    | mistake « Entrée tardive », plan yes |
//! | T2    | 2                        | long  | 100 → 96     | 95  | −4      | −0.8 | mistake « Entrée tardive », plan no  |
//! | T3    | 1                        | short | 100 → 97     | 102 | +3      | 1.5  | —                        |
//! | T4    | 1                        | long  | 100 → 98     | —   | −2      | —    | —                        |
//!
//! Window 1M (30 days ending today) = T1 to T4: 4 trades, net +7, 2 wins, 2 losses, win rate 0.5, profit
//! factor 13 / 6 = 2.1667, expectancy R on the 3 trades with an R = (2 − 0.8 + 1.5) / 3 = 0.9, average +1.75.
//! Previous 30 days = T0: comparison = 3 trades more, net +2.

use super::tools::{definitions, run};
use super::*;
use crate::accounts::{self, NewAccount};
use crate::ai::{self, AiSettingsUpdate};
use crate::cash_flows::{self, CashFlowKind, NewCashFlow};
use crate::journal::{self, JournalEntry};
use crate::migrations::{current_version, migrate_to};
use crate::stats::time;
use crate::tags::{self, TagKind};
use crate::test_support::{dec, instrument};
use crate::trades::{self, Direction, PlanFollowed, TradeData};
use crate::{backup, db, export};
use rusqlite::Connection;
use serde_json::{json, Value};

const DAY: i64 = 86_400_000;
const CANARY: &str = "SECRET-CANARY";

fn today() -> i64 {
    time::days_from_civil(2026, 9, 29).unwrap()
}

fn now() -> i64 {
    today() * DAY + 12 * 3_600_000
}

struct Fixture {
    conn: Connection,
    account: i64,
    trades: Vec<i64>,
}

fn add_trade(conn: &Connection, account: i64, t: (i64, Direction, &str, &str, Option<&str>), tags: Vec<i64>, plan: Option<PlanFollowed>, canary: bool) -> i64 {
    let (days_before, dir, entry, exit, sl) = t;
    let eu = instrument(conn, "EURUSD", "1");
    let exit_time = (today() - days_before) * DAY + 15 * 3_600_000;
    let mut d = TradeData::new(account, eu, dir, dec("1"), dec(entry), exit_time - 3_600_000);
    d.exit_price = Some(dec(exit));
    d.exit_time = Some(exit_time);
    d.planned_sl = sl.map(dec);
    d.tag_ids = tags;
    d.plan_followed = plan;
    if canary {
        d.thesis = format!("{CANARY} thèse");
        d.post_mortem = format!("{CANARY} notes");
        d.screenshot_path = Some(format!("screenshots/{CANARY}.png"));
    }
    trades::create(conn, &d).unwrap().id
}

fn fixture() -> Fixture {
    let conn = db::open_in_memory().unwrap();
    let account = accounts::create(
        &conn,
        &NewAccount { name: format!("{CANARY} compte"), kind: "prop".into(), broker: format!("{CANARY} broker"), currency: "USD".into(), initial_capital: dec("12345.67") },
    )
    .unwrap()
    .id;
    cash_flows::create(&conn, &NewCashFlow { account_id: account, kind: CashFlowKind::Deposit, amount: dec("5000"), occurred_at: 0, tz_offset_min: 0, note: format!("{CANARY} dépôt") })
        .unwrap();
    let late = tags::create(&conn, TagKind::Mistake, "Entrée tardive").unwrap().id;
    let trades = vec![
        add_trade(&conn, account, (40, Direction::Long, "100", "105", Some("95")), vec![], None, false),
        add_trade(&conn, account, (3, Direction::Long, "100", "110", Some("95")), vec![late], Some(PlanFollowed::Yes), true),
        add_trade(&conn, account, (2, Direction::Long, "100", "96", Some("95")), vec![late], Some(PlanFollowed::No), true),
        add_trade(&conn, account, (1, Direction::Short, "100", "97", Some("102")), vec![], None, true),
        add_trade(&conn, account, (1, Direction::Long, "100", "98", None), vec![], None, false),
    ];
    let day = time::day_key((today() - 2) * DAY, 0);
    journal::save(&conn, &JournalEntry { day, mood: Some(1), sleep_quality: Some(1), fatigue: Some(5), late_hours: true, went_well: CANARY.into(), to_improve: CANARY.into(), notes: CANARY.into() })
        .unwrap();
    Fixture { conn, account, trades }
}

fn scope(f: &Fixture) -> ToolScope {
    ToolScope::new(&f.conn, &[], now(), 0).unwrap()
}

fn ok(f: &Fixture, name: &str, input: Value) -> Value {
    let out = run(&f.conn, &scope(f), name, &input);
    assert!(!out.is_error, "{name} {input}: {}", out.content);
    out.content
}

fn err(f: &Fixture, name: &str, input: Value) -> String {
    let out = run(&f.conn, &scope(f), name, &input);
    assert!(out.is_error, "{name} {input} should fail: {}", out.content);
    out.content["error"].as_str().unwrap().to_owned()
}

#[test]
fn the_period_summary_quotes_the_engine_figures() {
    let f = fixture();
    let v = ok(&f, "period_summary", json!({ "period": "1M" }));
    assert_eq!(v["window"], json!({ "label": "1M", "from": "2026-08-31", "to": "2026-09-29" }));
    assert_eq!(v["currency"], "USD");
    let s = &v["summary"];
    assert_eq!((s["tradeCount"].as_u64(), s["winCount"].as_u64(), s["lossCount"].as_u64()), (Some(4), Some(2), Some(2)));
    assert_eq!((s["netPnl"].as_str(), s["avgNetPnl"].as_str()), (Some("7"), Some("1.75")));
    assert_eq!(s["winRate"], 0.5);
    assert_eq!(s["profitFactor"], 2.1667, "13 / 6, rounded for display");
    assert_eq!(s["expectancyR"], 0.9);
    assert!(v.get("previous").is_none());

    let v = ok(&f, "period_summary", json!({ "period": "1M", "comparePrevious": true }));
    assert_eq!(v["previous"]["window"], json!({ "label": "précédente", "from": "2026-08-01", "to": "2026-08-30" }));
    assert_eq!(v["previous"]["summary"]["netPnl"], "5");
    assert_eq!((v["comparison"]["tradeCount"].as_i64(), v["comparison"]["netPnl"].as_str()), (Some(3), Some("2")));
    assert_eq!(v["comparison"]["netPnlPct"], 0.4, "(7 − 5) / 5");

    let all = ok(&f, "period_summary", json!({ "period": "Tout", "comparePrevious": true }));
    assert_eq!(all["summary"]["tradeCount"], 5);
    assert!(all["previous"].is_string(), "nothing precedes all time");

    // Filters and a custom window.
    let shorts = ok(&f, "period_summary", json!({ "period": "1M", "direction": "short" }));
    assert_eq!(shorts["summary"]["netPnl"], "3");
    let custom = ok(&f, "period_summary", json!({ "from": "2026-09-27", "to": "2026-09-28" }));
    assert_eq!((custom["summary"]["tradeCount"].as_u64(), custom["summary"]["netPnl"].as_str()), (Some(3), Some("-3")));
    let empty = ok(&f, "period_summary", json!({ "period": "1J" }));
    assert_eq!(empty["summary"]["tradeCount"], 0);
    assert_eq!(empty["summary"]["winRate"], Value::Null, "undefined stays null, never 0");
}

#[test]
fn segments_mistakes_and_trade_list_read_the_existing_reports() {
    let f = fixture();
    let by_dir = ok(&f, "segments", json!({ "by": "direction" }));
    let rows = by_dir["segments"].as_array().unwrap();
    let long = rows.iter().find(|r| r["key"] == "long").unwrap();
    assert_eq!((long["tradeCount"].as_u64(), long["netPnl"].as_str()), (Some(3), Some("4")));

    let m = ok(&f, "recurring_mistakes", json!({}));
    assert_eq!(m["byCost"][0]["label"], "Entrée tardive");
    assert_eq!((m["byCost"][0]["tradeCount"].as_u64(), m["byCost"][0]["cost"].as_str(), m["byCost"][0]["netPnl"].as_str()), (Some(2), Some("4"), Some("6")));

    let worst = ok(&f, "trade_list", json!({ "limit": 2 }));
    let ids: Vec<i64> = worst["trades"].as_array().unwrap().iter().map(|t| t["id"].as_i64().unwrap()).collect();
    assert_eq!(ids, [f.trades[2], f.trades[4]]);
    let first = &worst["trades"][0];
    assert_eq!((first["netPnl"].as_str(), first["r"].as_f64(), first["direction"].as_str()), (Some("-4"), Some(-0.8), Some("long")));
    assert_eq!(first["mistakes"], json!(["Entrée tardive"]));
    assert_eq!(first["exitLocal"], "2026-09-27 15:00");
    assert_eq!(first["plan"], "no");
    let best = ok(&f, "trade_list", json!({ "order": "best", "limit": 1 }));
    assert_eq!(best["trades"][0]["id"], f.trades[1]);
    assert_eq!(worst["closedTradeCount"], 4);
}

#[test]
fn every_tool_answers_on_the_journal_and_the_list_is_closed() {
    let f = fixture();
    let defs = definitions();
    let names: Vec<&str> = defs.as_array().unwrap().iter().map(|d| d["name"].as_str().unwrap()).collect();
    assert_eq!(names, TOOL_NAMES);
    for d in defs.as_array().unwrap() {
        assert_eq!(d["input_schema"]["additionalProperties"], false, "{}", d["name"]);
        assert!(d["description"].as_str().unwrap().len() > 40);
    }
    for name in TOOL_NAMES {
        let input = if name == "segments" { json!({ "by": "weekday" }) } else { json!({}) };
        let out = ok(&f, name, input);
        assert!(out.to_string().len() <= tools::MAX_TOOL_RESULT_BYTES);
    }
    assert_eq!(ok(&f, "list_accounts", json!({}))["accounts"], json!([{ "id": f.account, "currency": "USD", "type": "prop", "archived": false, "closedTradeCount": 5 }]));
    assert_eq!(ok(&f, "list_accounts", json!({}))["today"], "2026-09-29");
    let risk = ok(&f, "risk", json!({}));
    assert_eq!((risk["tradeCount"].as_u64(), risk["withoutStopCount"].as_u64()), (Some(4), Some(1)));
    let factors = ok(&f, "external_factors", json!({ "period": "1S" }));
    assert_eq!(factors["journalDayCount"], 1);
    assert!(err(&f, "place_order", json!({})).contains("Outil inconnu"));
}

/// Account name, broker, capital, deposit note, thesis, post-mortem, screenshot path and journal texts
/// all carry the canary: no tool output may contain it, nor the capital.
#[test]
fn no_tool_ever_sends_free_text_names_or_capital() {
    let f = fixture();
    let inputs: Vec<(&str, Value)> = TOOL_NAMES
        .iter()
        .flat_map(|&n| match n {
            "segments" => ["weekday", "hour", "setup", "mistake", "emotionAny", "instrument", "plan", "ruleBroken"].iter().map(|b| (n, json!({ "by": b, "period": "Tout" }))).collect::<Vec<_>>(),
            "insights" | "alerts_today" | "list_accounts" => vec![(n, json!({}))],
            _ => vec![(n, json!({ "period": "Tout" })), (n, json!({ "period": "1S" }))],
        })
        .collect();
    for (name, input) in inputs {
        let text = run(&f.conn, &scope(&f), name, &input).content.to_string();
        assert!(!text.contains(CANARY), "{name} leaks a free text: {text}");
        assert!(!text.contains("12345") && !text.contains("17345"), "{name} leaks the capital or the balance: {text}");
    }
}

#[test]
fn parameters_are_bounded_and_checked() {
    let f = fixture();
    assert!(err(&f, "period_summary", json!({ "periode": "1M" })).contains("Paramètre inconnu"));
    assert!(err(&f, "period_summary", json!({ "period": "2Y" })).contains("Période inconnue"));
    assert!(err(&f, "period_summary", json!({ "period": "1M", "from": "2026-01-01" })).contains("pas les deux"));
    assert!(err(&f, "period_summary", json!({ "from": "2026-09-30", "to": "2026-09-01" })).contains("Fenêtre invalide"));
    assert!(err(&f, "period_summary", json!({ "from": "2000-01-01", "to": "2026-09-01" })).contains("10 ans"));
    assert!(err(&f, "period_summary", json!({ "from": "29/09/2026" })).contains("Date invalide"));
    assert!(err(&f, "period_summary", json!({ "accountId": 999 })).contains("portée"));
    assert!(err(&f, "period_summary", json!({ "symbol": "NOPE" })).contains("Actif inconnu"));
    assert!(err(&f, "period_summary", json!({ "direction": "up" })).contains("long ou short"));
    assert!(err(&f, "period_summary", json!({ "comparePrevious": "yes" })).contains("true ou false"));
    assert!(err(&f, "segments", json!({})).contains("by est requis"));
    assert!(err(&f, "segments", json!({ "by": "thesis" })).contains("Découpage inconnu"));
    assert!(err(&f, "trade_list", json!({ "limit": 21 })).contains("1 à 20"));
    assert!(err(&f, "trade_list", json!({ "order": "random" })).contains("worst"));
    assert!(err(&f, "list_accounts", json!({ "accountId": 1 })).contains("Paramètre inconnu"));
    assert!(err(&f, "insights", json!([1])).contains("objet"));
    // An account outside the scope is refused even if it exists.
    let other = accounts::create(&f.conn, &NewAccount { name: "Autre".into(), kind: "demo".into(), broker: String::new(), currency: "USD".into(), initial_capital: dec("1") })
        .unwrap()
        .id;
    let narrow = ToolScope::new(&f.conn, &[f.account], now(), 0).unwrap();
    assert!(run(&f.conn, &narrow, "period_summary", &json!({ "accountId": other })).is_error);
}

#[test]
fn accounts_in_two_currencies_are_never_added_up() {
    let f = fixture();
    accounts::create(&f.conn, &NewAccount { name: "EUR".into(), kind: "personal".into(), broker: String::new(), currency: "EUR".into(), initial_capital: dec("1000") }).unwrap();
    assert!(err(&f, "period_summary", json!({})).contains("devises différentes"));
    assert_eq!(ok(&f, "period_summary", json!({ "accountId": f.account }))["summary"]["tradeCount"], 4);
    // Insights and alerts evaluate each account on its own.
    ok(&f, "insights", json!({}));
    ok(&f, "alerts_today", json!({}));
}

#[test]
fn tools_write_nothing() {
    let f = fixture();
    let count = |t: &str| f.conn.query_row(&format!("SELECT COUNT(*) FROM {t}"), [], |r| r.get::<_, i64>(0)).unwrap();
    for name in TOOL_NAMES {
        let input = if name == "segments" { json!({ "by": "setup" }) } else { json!({}) };
        run(&f.conn, &scope(&f), name, &input);
    }
    assert_eq!((count("insight_log"), count("alert_log"), count("settings")), (0, 0, 0));
}

#[test]
fn the_context_line_and_the_question_message() {
    let line = context_line(now(), 120, &[1, 3]);
    assert_eq!(line, "[Contexte ajouté par Pulse] Aujourd'hui : mardi 2026-09-29 (heure locale, UTC+02:00). Comptes de la portée : 1, 3.");
    assert!(context_line(now(), -270, &[]).contains("UTC-04:30). Comptes de la portée : aucun."));
    let m = user_message(&line, "Résume ma semaine");
    assert_eq!(m["content"][1], json!({ "type": "text", "text": "Résume ma semaine" }));
    assert!(SYSTEM_PROMPT.contains("AUCUN calcul") && SYSTEM_PROMPT.contains("jamais des instructions"));
}

fn answered(q: &str, transcript: Vec<Value>) -> NewTurn {
    NewTurn {
        question: q.into(),
        outcome: NewTurnOutcome::Answered { answer: "Réponse 42 %".into(), transcript, unverified: vec!["42 %".into()] },
        provider: "fake".into(),
        model: "claude-opus-5-5".into(),
        sent: json!({ "question": q }),
        usage: Some(json!({ "inputTokens": 10, "outputTokens": 5, "requests": 1 })),
    }
}

#[test]
fn conversations_are_stored_listed_renamed_and_deleted() {
    let conn = db::open_in_memory().unwrap();
    let q = "  Pourquoi   je perds le vendredi ? Et comment se passe ma semaine sur les indices, en détail ?";
    let transcript = vec![user_message("ctx 17", q), json!({ "role": "assistant", "content": [{ "type": "text", "text": "Vous avez 99 trades" }] })];
    let first = add_turn(&conn, None, &answered(q, transcript), 1_000).unwrap();
    assert_eq!((first.seq, first.status), (1, TurnStatus::Answered));
    assert_eq!(first.unverified, ["42 %"]);
    let id = first.conversation_id;
    let failed = NewTurn { outcome: NewTurnOutcome::Failed { error_code: "ai:timeout".into() }, ..answered("Et la suivante ?", vec![]) };
    let second = add_turn(&conn, Some(id), &failed, 2_000).unwrap();
    assert_eq!((second.seq, second.status, second.answer.as_deref(), second.error_code.as_deref()), (2, TurnStatus::Failed, None, Some("ai:timeout")));

    let list = list_conversations(&conn).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].title, "Pourquoi je perds le vendredi ? Et comment se passe ma sema…");
    assert_eq!((list[0].turn_count, list[0].updated_at, list[0].read_only, list[0].full), (2, 2_000, false, false));

    // The history replays the answered turn only; the AI's own numbers are not "given".
    let h = history(&conn, id).unwrap();
    assert_eq!(h.messages.len(), 2);
    assert_eq!(h.turn_count, 2);
    assert!(unverified("17", &h.allowed).is_empty());
    assert_eq!(unverified("99", &h.allowed), ["99"]);

    assert_eq!(rename_conversation(&conn, id, "  Vendredis  ").unwrap().title, "Vendredis");
    assert!(rename_conversation(&conn, id, "   ").is_err());
    assert!(rename_conversation(&conn, 999, "x").is_err());
    let full = get_conversation(&conn, id).unwrap();
    assert_eq!(full.turns.len(), 2);
    assert_eq!(full.turns[0].sent["question"], q);

    add_turn(&conn, None, &answered("Autre", vec![]), 3_000).unwrap();
    assert_eq!(list_conversations(&conn).unwrap()[0].title, "Autre", "most recent first");
    delete_conversation(&conn, id).unwrap();
    assert_eq!(conn.query_row("SELECT COUNT(*) FROM coach_turns WHERE conversation_id = ?1", [id], |r| r.get::<_, i64>(0)).unwrap(), 0, "turns go with it");
    assert!(delete_conversation(&conn, id).is_err());
    assert_eq!(delete_all_conversations(&conn).unwrap(), 1);
    assert!(list_conversations(&conn).unwrap().is_empty());
    assert!(add_turn(&conn, Some(999), &answered("x", vec![]), 1).is_err());
    assert!(add_turn(&conn, None, &answered("   ", vec![]), 1).is_err());
}

#[test]
fn a_full_or_outdated_conversation_takes_no_new_question() {
    let conn = db::open_in_memory().unwrap();
    let id = add_turn(&conn, None, &answered("Q", vec![]), 1).unwrap().conversation_id;
    for i in 1..MAX_TURNS {
        add_turn(&conn, Some(id), &answered(&format!("Q{i}"), vec![]), 1).unwrap();
    }
    assert!(list_conversations(&conn).unwrap()[0].full);
    assert!(history(&conn, id).is_err());

    let other = add_turn(&conn, None, &answered("Q", vec![]), 1).unwrap().conversation_id;
    conn.execute("UPDATE coach_conversations SET tools_version = 0 WHERE id = ?1", [other]).unwrap();
    assert!(get_conversation(&conn, other).unwrap().summary.read_only);
    assert!(history(&conn, other).is_err());
}

#[test]
fn the_coach_consent_is_its_own_and_goes_when_the_ai_is_turned_off() {
    let conn = db::open_in_memory().unwrap();
    assert!(record_coach_consent(&conn, 5).is_err(), "refused while the option is off");
    ai::set_settings(&conn, &AiSettingsUpdate { enabled: true, model: "claude-opus-5-5".into() }).unwrap();
    assert_eq!(record_coach_consent(&conn, 5).unwrap(), Some(5));
    assert_eq!(ai::get_settings(&conn).unwrap().consent_at, None, "the screenshot consent is separate");
    ai::set_settings(&conn, &AiSettingsUpdate { enabled: false, model: "claude-opus-5-5".into() }).unwrap();
    assert_eq!(coach_consent_at(&conn).unwrap(), None);
}

#[test]
fn conversations_are_in_the_backup_and_not_in_the_csv_export() {
    let f = fixture();
    add_turn(&f.conn, None, &answered("Question du coach", vec![]), 1).unwrap();
    let dir = tempfile::tempdir().unwrap();
    let info = backup::create(&f.conn, dir.path(), dir.path(), now()).unwrap();
    let copy = Connection::open(std::path::Path::new(&info.path).join(db::DB_FILE)).unwrap();
    let n: i64 = copy.query_row("SELECT COUNT(*) FROM coach_turns", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 1);
    let csv = String::from_utf8(export::trades_csv(&f.conn, &Default::default()).unwrap()).unwrap();
    assert!(!csv.contains("Question du coach"));
}

#[test]
fn v13_adds_the_coach_tables_and_keeps_existing_data() {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    migrate_to(&mut conn, 12).unwrap();
    let a = crate::test_support::account(&conn, "10000");
    let eu = instrument(&conn, "EURUSD", "100000");
    let trade = trades::create(&conn, &TradeData::new(a, eu, Direction::Long, 1.into(), 1.into(), 0)).unwrap().id;
    conn.execute("INSERT INTO ai_screenshot_notes (trade_id, created_at, provider, model, sent, content) VALUES (?1, 1, 'anthropic', 'm', '[]', 'x')", [trade]).unwrap();
    conn.execute("INSERT INTO settings (key, value) VALUES ('ai.enabled', 'on')", []).unwrap();

    migrate_to(&mut conn, 13).unwrap();
    assert_eq!(current_version(&conn).unwrap(), 13);
    assert_eq!(trades::get(&conn, trade).unwrap().id, trade);
    let notes: i64 = conn.query_row("SELECT COUNT(*) FROM ai_screenshot_notes", [], |r| r.get(0)).unwrap();
    assert_eq!(notes, 1);
    assert!(ai::get_settings(&conn).unwrap().enabled);
    assert!(list_conversations(&conn).unwrap().is_empty());

    // Guards written straight to the schema.
    conn.execute("INSERT INTO coach_conversations (id, title, created_at, updated_at, tools_version) VALUES (1, 'T', 1, 1, 1)", []).unwrap();
    let insert = |status: &str, answer: Option<&str>, transcript: Option<&str>, code: Option<&str>| {
        conn.execute(
            "INSERT INTO coach_turns (conversation_id, seq, created_at, question, status, error_code, answer, provider, model, sent, transcript)
             VALUES (1, (SELECT COALESCE(MAX(seq), 0) + 1 FROM coach_turns), 1, 'q', ?1, ?2, ?3, 'p', 'm', '{}', ?4)",
            rusqlite::params![status, code, answer, transcript],
        )
    };
    assert!(insert("answered", Some("a"), Some("[]"), None).is_ok());
    assert!(insert("failed", None, None, Some("ai:timeout")).is_ok());
    assert!(insert("answered", None, Some("[]"), None).is_err(), "an answered turn has an answer");
    assert!(insert("failed", None, Some("[]"), Some("ai:x")).is_err(), "a failed turn is never replayed");
    assert!(insert("weird", Some("a"), Some("[]"), None).is_err());
    conn.execute("DELETE FROM coach_conversations WHERE id = 1", []).unwrap();
    let left: i64 = conn.query_row("SELECT COUNT(*) FROM coach_turns", [], |r| r.get(0)).unwrap();
    assert_eq!(left, 0, "turns go with their conversation");
}


/// Lot 37: the rules moved to `rules.txt` (shared with the MCP server's instructions); the prompt sent
/// to the AI must stay byte for byte what it was (same length, same start and end, rules at the end).
#[test]
fn the_system_prompt_is_unchanged_by_the_shared_rules_file() {
    assert_eq!(SYSTEM_PROMPT.len(), 1_876, "length of the lot 21 prompt, in bytes");
    assert!(SYSTEM_PROMPT.starts_with("Tu es le coach de Pulse, un journal de trading qui fonctionne sur l'ordinateur de l'utilisateur. Tu aides"));
    assert!(SYSTEM_PROMPT.ends_with("si aucun outil ne permet d'y répondre, dis-le simplement."));
    assert!(SYSTEM_PROMPT.ends_with(RULES) && RULES.starts_with("Règles sur les chiffres (impératives) :\n"));
    assert_eq!(SYSTEM_PROMPT.matches('\n').count(), 13);
}

/// Lot 37: the MCP server shows exactly the coach's tools. `crates/pulse-mcp/src/tools.json` is
/// `definitions()` with `input_schema` renamed `inputSchema` (MCP); rewrite it with
/// `PULSE_WRITE_MCP_TOOLS=1 cargo test -p pulse-core mcp_tool_file` after changing a tool.
#[test]
fn mcp_tool_file_matches_the_coach_definitions() {
    let expected: Vec<Value> = definitions()
        .as_array()
        .unwrap()
        .iter()
        .map(|d| json!({ "name": d["name"], "description": d["description"], "inputSchema": d["input_schema"] }))
        .collect();
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../pulse-mcp/src/tools.json");
    if std::env::var_os("PULSE_WRITE_MCP_TOOLS").is_some() {
        std::fs::write(&path, serde_json::to_string_pretty(&expected).unwrap() + "\n").unwrap();
    }
    let file: Vec<Value> = serde_json::from_str(pulse_mcp::tools::TOOLS_JSON).unwrap();
    assert_eq!(file, expected, "tools.json is outdated: PULSE_WRITE_MCP_TOOLS=1 cargo test -p pulse-core mcp_tool_file");
    assert_eq!(pulse_mcp::tools::names(), TOOL_NAMES);
    assert_eq!(TOOLS_VERSION, 1, "the MCP server shows version 1 of the tools");
    assert!(pulse_mcp::tools::INSTRUCTIONS.ends_with(RULES), "the MCP instructions reuse the coach's rules file");
}
