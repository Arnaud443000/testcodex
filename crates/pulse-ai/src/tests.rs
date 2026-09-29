//! Network tests against a fake local server (plain HTTP on 127.0.0.1): the real service is never called.

use super::*;
use crate::claude::{parse_reply, request_body, status_error};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpListener;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

const KEY: &str = "sk-test-NOT-A-REAL-KEY";

struct Seen {
    request_line: String,
    headers: Vec<(String, String)>,
    body: String,
}

impl Seen {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|(n, _)| n.eq_ignore_ascii_case(name)).map(|(_, v)| v.as_str())
    }
}

/// Serves one connection: records the request, answers `status` with `body` (or never answers).
fn fake_server(status: u16, body: &str, answer: bool) -> (String, mpsc::Receiver<Seen>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let (tx, rx) = mpsc::channel();
    let body = body.to_owned();
    thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        let mut request_line = String::new();
        reader.read_line(&mut request_line).unwrap();
        let mut headers = Vec::new();
        loop {
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            let line = line.trim_end();
            if line.is_empty() {
                break;
            }
            let (n, v) = line.split_once(':').unwrap();
            headers.push((n.trim().to_owned(), v.trim().to_owned()));
        }
        let len = headers.iter().find(|(n, _)| n.eq_ignore_ascii_case("content-length")).map_or(0, |(_, v)| v.parse().unwrap());
        let mut buf = vec![0; len];
        reader.read_exact(&mut buf).unwrap();
        tx.send(Seen { request_line: request_line.trim_end().to_owned(), headers, body: String::from_utf8(buf).unwrap() }).unwrap();
        if !answer {
            thread::sleep(Duration::from_secs(3));
            return;
        }
        let mut stream = stream;
        write!(stream, "HTTP/1.1 {status} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}", body.len()).unwrap();
    });
    (base, rx)
}

fn fast() -> Timeouts {
    Timeouts { connect: Duration::from_secs(2), check: Duration::from_secs(2), analysis: Duration::from_millis(500) }
}

fn key() -> ApiKey {
    ApiKey::parse(KEY).unwrap()
}

fn request(model: &str) -> ImageRequest<'_> {
    ImageRequest { model, system: "système", image_media_type: "image/png", image_base64: "iVBORw0KGgo=", text: "Thèse : cassure" }
}

fn ok_reply(model: &str) -> String {
    json!({
        "id": "msg_1", "type": "message", "role": "assistant", "model": model, "stop_reason": "end_turn",
        "content": [
            { "type": "thinking", "thinking": "", "signature": "x" },
            { "type": "text", "text": "## Contexte visible\n- Tendance haussière." },
            { "type": "text", "text": "## Incohérences relevées\nAucune incohérence nette." }
        ]
    })
    .to_string()
}

#[test]
fn an_analysis_sends_the_documented_request_and_reads_the_text_blocks() {
    let (base, seen) = fake_server(200, &ok_reply("claude-opus-5-5"), true);
    let reply = Claude::with_base_url(&base, fast()).analyze_image(&key(), &request("claude-opus-5-5")).unwrap();
    assert_eq!(reply.model, "claude-opus-5-5");
    assert_eq!(reply.text, "## Contexte visible\n- Tendance haussière.\n## Incohérences relevées\nAucune incohérence nette.");

    let s = seen.recv().unwrap();
    assert_eq!(s.request_line, "POST /v1/messages HTTP/1.1");
    assert_eq!(s.header("x-api-key"), Some(KEY));
    assert_eq!(s.header("anthropic-version"), Some("2023-06-01"));
    assert_eq!(s.header("anthropic-beta"), Some("server-side-fallback-2026-07-01"));
    assert_eq!(s.header("content-type"), Some("application/json"));
    let body: Value = serde_json::from_str(&s.body).unwrap();
    assert_eq!(body, request_body(&request("claude-opus-5-5")));
    assert_eq!(body["fallbacks"], "default");
    assert_eq!(body["max_tokens"], 16000);
    let content = &body["messages"][0]["content"];
    assert_eq!(content[0]["type"], "image", "the image comes first");
    assert_eq!(content[0]["source"], json!({ "type": "base64", "media_type": "image/png", "data": "iVBORw0KGgo=" }));
    assert_eq!(content[1], json!({ "type": "text", "text": "Thèse : cassure" }));
    for absent in ["thinking", "temperature", "top_p", "stream"] {
        assert!(body.get(absent).is_none(), "{absent} is not sent");
    }
}

#[test]
fn the_fallback_is_only_sent_to_the_models_that_take_it() {
    for (model, fallback) in [("claude-opus-5-5", true), ("claude-sonnet-5-5", true), ("claude-haiku-4-5", false), ("claude-fable-5-1", false)] {
        assert_eq!(request_body(&request(model)).get("fallbacks").is_some(), fallback, "{model}");
    }
    let (base, seen) = fake_server(200, &ok_reply("claude-haiku-4-5"), true);
    Claude::with_base_url(&base, fast()).analyze_image(&key(), &request("claude-haiku-4-5")).unwrap();
    assert_eq!(seen.recv().unwrap().header("anthropic-beta"), None);
}

#[test]
fn the_served_model_is_the_one_reported_after_a_fallback() {
    let body = json!({
        "model": "claude-opus-5", "stop_reason": "end_turn",
        "content": [
            { "type": "fallback", "from": { "model": "claude-opus-5-5" }, "to": { "model": "claude-opus-5" } },
            { "type": "text", "text": "Réponse." }
        ]
    });
    assert_eq!(parse_reply(&body.to_string()).unwrap(), AnalysisReply { text: "Réponse.".into(), model: "claude-opus-5".into() });
}

#[test]
fn http_errors_become_translatable_codes() {
    let err = |t: &str| json!({ "type": "error", "error": { "type": t, "message": "secret detail sk-test" } }).to_string();
    for (status, body, expected) in [
        (401, err("authentication_error"), AiError::InvalidKey),
        (402, err("billing_error"), AiError::Billing),
        (403, err("permission_error"), AiError::Forbidden),
        (404, err("not_found_error"), AiError::ModelNotFound),
        (413, err("request_too_large"), AiError::ImageTooLarge),
        (429, err("rate_limit_error"), AiError::RateLimited),
        (500, err("api_error"), AiError::ServerError),
        (529, err("overloaded_error"), AiError::Overloaded),
        (400, err("invalid_request_error"), AiError::Rejected),
        (503, "<html>proxy</html>".to_owned(), AiError::ServerError),
        (418, String::new(), AiError::Rejected),
    ] {
        assert_eq!(status_error(status, &body), expected, "{status}");
    }
    // Through the real client, and nothing of the answer or the key survives in the error.
    let (base, _seen) = fake_server(401, &err("authentication_error"), true);
    let e = Claude::with_base_url(&base, fast()).analyze_image(&key(), &request("claude-opus-5-5")).unwrap_err();
    assert_eq!(e, AiError::InvalidKey);
    assert_eq!(e.to_string(), "ai:invalidKey");
    assert!(!format!("{e:?}{e}").contains("sk-"));
}

#[test]
fn refusals_truncations_and_odd_answers_are_reported() {
    let with = |stop: &str| json!({ "model": "m", "stop_reason": stop, "content": [{ "type": "text", "text": "partiel" }] }).to_string();
    assert_eq!(parse_reply(&with("refusal")), Err(AiError::Refused));
    assert_eq!(parse_reply(&with("max_tokens")), Err(AiError::Truncated));
    assert_eq!(parse_reply("not json"), Err(AiError::UnexpectedResponse));
    assert_eq!(parse_reply(&json!({ "model": "m", "stop_reason": "end_turn", "content": [] }).to_string()), Err(AiError::UnexpectedResponse));
    assert_eq!(parse_reply(&json!({ "stop_reason": "end_turn", "content": [{ "type": "text", "text": "x" }] }).to_string()), Err(AiError::UnexpectedResponse));
    let (base, _seen) = fake_server(200, &with("refusal"), true);
    assert_eq!(Claude::with_base_url(&base, fast()).analyze_image(&key(), &request("claude-opus-5-5")), Err(AiError::Refused));
}

#[test]
fn no_server_means_offline_and_a_silent_one_means_timeout() {
    let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port(); // closed right away
    let offline = Claude::with_base_url(&format!("http://127.0.0.1:{port}"), fast());
    assert_eq!(offline.analyze_image(&key(), &request("claude-opus-5-5")), Err(AiError::Offline));
    assert_eq!(offline.check(&key(), "claude-opus-5-5"), Err(AiError::Offline));

    let (base, _seen) = fake_server(200, "", false);
    assert_eq!(Claude::with_base_url(&base, fast()).analyze_image(&key(), &request("claude-opus-5-5")), Err(AiError::Timeout));
}

#[test]
fn the_connection_test_reads_the_model_and_sends_no_trading_data() {
    let (base, seen) = fake_server(200, r#"{"id":"claude-sonnet-5-5","type":"model"}"#, true);
    Claude::with_base_url(&base, fast()).check(&key(), "claude-sonnet-5-5").unwrap();
    let s = seen.recv().unwrap();
    assert_eq!(s.request_line, "GET /v1/models/claude-sonnet-5-5 HTTP/1.1");
    assert_eq!(s.header("x-api-key"), Some(KEY));
    assert!(s.body.is_empty());

    let (base, _seen) = fake_server(404, r#"{"type":"error","error":{"type":"not_found_error","message":"model: x"}}"#, true);
    assert_eq!(Claude::with_base_url(&base, fast()).check(&key(), "claude-nope"), Err(AiError::ModelNotFound));
    // A malformed model never reaches the network (it would change the URL path).
    assert_eq!(Claude::with_base_url("http://127.0.0.1:9", fast()).check(&key(), "../v1/x"), Err(AiError::Rejected));
}

#[test]
fn the_official_client_is_https_only_and_sends_nothing_over_plain_http() {
    assert_eq!(API_BASE, "https://api.anthropic.com");
    assert_eq!(Claude::official().id(), "anthropic");
    let (base, seen) = fake_server(200, &ok_reply("claude-opus-5-5"), true);
    let https_only = Claude::build(&base, fast(), true);
    assert!(https_only.analyze_image(&key(), &request("claude-opus-5-5")).is_err());
    assert!(seen.recv_timeout(Duration::from_millis(300)).is_err(), "no byte reached the plain-HTTP server");
    let debug = format!("{:?}", request("claude-opus-5-5"));
    assert!(!debug.contains("iVBOR"), "the image is not printed: {debug}");
}
