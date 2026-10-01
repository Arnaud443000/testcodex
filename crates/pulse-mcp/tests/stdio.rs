//! Scripted MCP sessions (lot 37): in memory against `server::serve`, then the real binary on stdio.

use pulse_mcp::server::{self, Backend, ToolReply};
use serde_json::{json, Value};
use std::cell::RefCell;
use std::io::{Cursor, Read, Write};
use std::process::{Command, Stdio};

/// Records the calls it gets and answers a fixed JSON text.
#[derive(Default)]
struct Fake {
    calls: RefCell<Vec<(String, Value)>>,
}

impl Backend for Fake {
    fn call(&self, tool: &str, arguments: &Value) -> ToolReply {
        self.calls.borrow_mut().push((tool.to_owned(), arguments.clone()));
        if arguments.get("period") == Some(&json!("2Y")) {
            return ToolReply { text: r#"{"error":"Période inconnue : 2Y (1J, 1S, 1M, 3M, 1A ou Tout)."}"#.into(), is_error: true };
        }
        ToolReply { text: r#"{"summary":{"netPnl":"7","winRate":0.5}}"#.into(), is_error: false }
    }
}

/// Runs the lines through the server; returns every output line parsed, and the log.
fn session(lines: &[&str], backend: &Fake) -> (Vec<Value>, String) {
    let input = lines.iter().map(|l| format!("{l}\n")).collect::<String>();
    let mut out = Vec::new();
    let mut log = Vec::new();
    server::serve(Cursor::new(input.into_bytes()), &mut out, backend, &mut log).unwrap();
    let text = String::from_utf8(out).unwrap();
    let answers = text.lines().map(|l| serde_json::from_str::<Value>(l).expect("stdout holds JSON-RPC only")).collect();
    (answers, String::from_utf8(log).unwrap())
}

fn init(version: &str) -> String {
    json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize", "params": { "protocolVersion": version, "capabilities": {}, "clientInfo": { "name": "test", "version": "1" } } }).to_string()
}

#[test]
fn initialize_answers_the_known_versions_and_falls_back_to_the_latest() {
    for (asked, answered) in [("2024-11-05", "2024-11-05"), ("2025-03-26", "2025-03-26"), ("2025-06-18", "2025-06-18"), ("2025-11-25", "2025-11-25"), ("2099-01-01", "2025-11-25"), ("n'importe", "2025-11-25")] {
        let (a, _) = session(&[&init(asked)], &Fake::default());
        let r = &a[0]["result"];
        assert_eq!(a[0]["id"], 1);
        assert_eq!(r["protocolVersion"], answered, "asked {asked}");
        assert_eq!(r["capabilities"], json!({ "tools": { "listChanged": false } }), "tools only: no resources, no prompts");
        assert_eq!(r["serverInfo"]["name"], "pulse");
        assert!(r["instructions"].as_str().unwrap().contains("AUCUN calcul"));
    }
    let (a, _) = session(&[r#"{"jsonrpc":"2.0","id":2,"method":"initialize","params":{}}"#], &Fake::default());
    assert_eq!(a[0]["error"]["code"], -32602);
}

#[test]
fn a_full_session_lists_and_calls_tools() {
    let fake = Fake::default();
    let (a, log) = session(
        &[
            &init("2025-06-18"),
            r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#,
            r#"{"jsonrpc":"2.0","id":"p","method":"ping"}"#,
            r#"{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}"#,
            r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"period_summary","arguments":{"period":"1S"}}}"#,
            r#"{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"list_accounts"}}"#,
        ],
        &fake,
    );
    assert_eq!(a.len(), 5, "the notification gets no answer");
    assert_eq!(a[1], json!({ "jsonrpc": "2.0", "id": "p", "result": {} }));
    let tools = a[2]["result"]["tools"].as_array().unwrap();
    assert_eq!(tools.len(), 13);
    assert_eq!(tools[1]["name"], "period_summary");
    assert!(tools[1]["inputSchema"]["properties"]["period"].is_object());
    assert_eq!(tools[1]["annotations"]["readOnlyHint"], true);
    assert_eq!(tools[1]["annotations"]["destructiveHint"], false);
    // The text is exactly what the backend (Pulse) gave.
    assert_eq!(a[3]["result"], json!({ "content": [{ "type": "text", "text": r#"{"summary":{"netPnl":"7","winRate":0.5}}"# }], "isError": false }));
    assert_eq!(a[4]["result"]["isError"], false);
    assert_eq!(*fake.calls.borrow(), vec![("period_summary".to_owned(), json!({ "period": "1S" })), ("list_accounts".to_owned(), json!({}))]);
    assert!(log.contains("tools/call"), "the log gets the methods: {log}");
    assert!(!log.contains("netPnl"), "no data in the log");
}

#[test]
fn the_2024_11_05_list_has_no_annotations() {
    let (a, _) = session(&[&init("2024-11-05"), r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#], &Fake::default());
    assert!(a[1]["result"]["tools"].as_array().unwrap().iter().all(|t| t.get("annotations").is_none()));
}

#[test]
fn tool_errors_are_results_and_protocol_errors_are_errors() {
    let fake = Fake::default();
    let (a, _) = session(
        &[
            &init("2025-06-18"),
            r#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"place_order","arguments":{}}}"#,
            r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"period_summary","arguments":{"period":"2Y"}}}"#,
            r#"{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"period_summary","arguments":[1]}}"#,
            r#"{"jsonrpc":"2.0","id":5,"method":"tools/call"}"#,
            r#"{"jsonrpc":"2.0","id":6,"method":"resources/list"}"#,
            r#"{"jsonrpc":"2.0","id":7,"method":"server/discover"}"#,
            r#"{"jsonrpc":"2.0","method":"tools/call","params":{"name":"trade_list"}}"#,
            r#"{"jsonrpc":"2.0","method":"unknown/notification"}"#,
        ],
        &fake,
    );
    assert_eq!(a.len(), 7, "notifications (even a tools/call without id) get no answer");
    assert_eq!(a[1]["error"]["code"], -32602, "unknown tool = protocol error");
    assert!(a[1]["error"]["message"].as_str().unwrap().contains("Outil inconnu"));
    assert_eq!(a[2]["result"]["isError"], true, "out-of-range parameter = tool error the model can read");
    assert!(a[2]["result"]["content"][0]["text"].as_str().unwrap().contains("Période inconnue"));
    assert_eq!(a[3]["error"]["code"], -32602);
    assert_eq!(a[4]["error"]["code"], -32602);
    assert_eq!(a[5]["error"]["code"], -32601);
    assert_eq!((a[6]["id"].as_i64(), a[6]["error"]["code"].as_i64()), (Some(7), Some(-32601)), "a 2026-07-28 client falls back to initialize");
    assert_eq!(fake.calls.borrow().len(), 1, "only the valid call reached the backend");
}

#[test]
fn broken_input_gets_errors_and_never_stops_the_server() {
    let long = format!(r#"{{"jsonrpc":"2.0","id":9,"method":"ping","params":{{"x":"{}"}}}}"#, "a".repeat(server::MAX_LINE_BYTES + 10));
    let (a, _) = session(
        &[
            r#"{"jsonrpc":"2.0","id":1,"method":"pi"#,
            "",
            "not json",
            "[{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}]",
            "42",
            r#"{"jsonrpc":"1.0","id":2,"method":"ping"}"#,
            r#"{"jsonrpc":"2.0","id":{"a":1},"method":"ping"}"#,
            r#"{"jsonrpc":"2.0","id":3}"#,
            r#"{"jsonrpc":"2.0","id":4,"result":{}}"#,
            &long,
            &"[".repeat(10_000),
            r#"{"jsonrpc":"2.0","id":5,"method":"ping"}"#,
        ],
        &Fake::default(),
    );
    let codes: Vec<i64> = a.iter().map(|m| m["error"]["code"].as_i64().unwrap_or(0)).collect();
    assert_eq!(codes, [-32700, -32700, -32600, -32600, -32600, -32600, -32600, -32600, -32700, 0], "{a:?}");
    assert_eq!(a[2]["id"], Value::Null);
    assert_eq!(a[3]["id"], Value::Null);
    assert_eq!(a[4]["id"], 2, "the id is kept when it is valid");
    assert!(a[7]["error"]["message"].as_str().unwrap().contains("1 Mio"));
    assert_eq!(a[9], json!({ "jsonrpc": "2.0", "id": 5, "result": {} }), "the server is still alive");

    // Invalid UTF-8 and a last line without a newline.
    let mut out = Vec::new();
    server::serve(Cursor::new(b"\xff\xfe\n{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}".to_vec()), &mut out, &Fake::default(), Vec::new()).unwrap();
    let lines: Vec<Value> = String::from_utf8(out).unwrap().lines().map(|l| serde_json::from_str(l).unwrap()).collect();
    assert_eq!((lines[0]["error"]["code"].as_i64(), lines[1]["result"].clone()), (Some(-32700), json!({})));
}

/// The real binary, started like an MCP client does: stdout holds only JSON-RPC, stderr the logs, and it
/// stops cleanly when stdin closes. Pulse is not running (empty data folder): the call is a tool error.
#[test]
fn the_binary_speaks_only_json_rpc_on_stdout_and_stops_with_stdin() {
    let dir = tempfile::tempdir().unwrap();
    let mut child = Command::new(env!("CARGO_BIN_EXE_pulse-mcp"))
        .arg("--data-dir")
        .arg(dir.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut stdin = child.stdin.take().unwrap();
    let script = [
        init("2025-06-18"),
        r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#.into(),
        r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#.into(),
        r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"period_summary","arguments":{}}}"#.into(),
        "{broken".into(),
    ];
    for l in &script {
        writeln!(stdin, "{l}").unwrap();
    }
    drop(stdin); // the client goes away
    let status = child.wait().unwrap();
    assert!(status.success());
    let mut out = String::new();
    child.stdout.take().unwrap().read_to_string(&mut out).unwrap();
    let mut err = String::new();
    child.stderr.take().unwrap().read_to_string(&mut err).unwrap();
    let answers: Vec<Value> = out.lines().map(|l| serde_json::from_str(l).expect("only JSON-RPC on stdout")).collect();
    assert_eq!(answers.len(), 4);
    assert!(answers.iter().all(|a| a["jsonrpc"] == "2.0"));
    assert_eq!(answers[1]["result"]["tools"].as_array().unwrap().len(), 13, "tools listed even without Pulse");
    let call = &answers[2]["result"];
    assert_eq!(call["isError"], true);
    let text: Value = serde_json::from_str(call["content"][0]["text"].as_str().unwrap()).unwrap();
    assert_eq!(text["code"], "mcp:notRunning");
    assert!(text["error"].as_str().unwrap().contains("Pulse n'est pas ouvert"));
    assert_eq!(answers[3]["error"]["code"], -32700);
    assert!(err.contains("pulse-mcp: tools/call"), "logs on stderr: {err}");
}

#[test]
fn the_binary_refuses_unknown_arguments_and_prints_help() {
    let bad = Command::new(env!("CARGO_BIN_EXE_pulse-mcp")).arg("--oops").output().unwrap();
    assert_eq!(bad.status.code(), Some(2));
    assert!(bad.stdout.is_empty());
    let help = Command::new(env!("CARGO_BIN_EXE_pulse-mcp")).arg("--help").output().unwrap();
    assert!(String::from_utf8(help.stdout).unwrap().contains("claude mcp add"));
}
