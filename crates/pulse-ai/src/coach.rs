//! The AI coach end to end (lot 21, see CLAUDE.md, « Coach IA (lot 21) »), in three steps so the database
//! lock is never held during a network call:
//! 1. [`prepare_question`] (database): option on, coach consent given and the question validated by the
//!    user, question within bounds, conversation open; loads the replay of the same conversation only.
//! 2. [`run_question`] (no database, except the tools): the manual tool loop. Each tool call goes through
//!    `run_tool`, which reads `pulse-core` (the caller locks the database for that call only).
//! 3. [`store_question`] (database): saves the turn, answered or failed, with the log of what was sent.
//!
//! Every check that can fail without the network comes first: when the option is off, without consent or
//! without a key, nothing is sent and nothing is stored.

use crate::service::ServiceError;
use crate::{AiError, ConverseRequest, Provider, StopReason};
use pulse_core::coach::{
    self, tools, AllowedNumbers, CoachTurn, NewTurn, NewTurnOutcome, ToolOutput, ToolScope, MAX_QUESTION_CHARS, MAX_REQUESTS, MAX_TOOL_CALLS,
};
use pulse_core::rusqlite::Connection;
use pulse_core::{ai, CoreError};
use pulse_vault::Vault;
use serde_json::{json, Value};
use std::fmt;

/// A question as the interface sends it after the user clicked « Envoyer ».
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AskRequest {
    /// `None`: a new conversation.
    pub conversation_id: Option<i64>,
    pub question: String,
    /// Accounts of the top bar when the question was sent (active accounts when empty).
    pub account_ids: Vec<i64>,
    pub tz_offset_min: i32,
    /// The user's click on « Envoyer »: nothing leaves without it.
    pub confirmed: bool,
}

/// Everything needed to ask, and nothing more.
pub struct PreparedQuestion {
    pub conversation_id: Option<i64>,
    pub model: String,
    question: String,
    context: String,
    scope: ToolScope,
    history: Vec<Value>,
    history_turns: usize,
    allowed: AllowedNumbers,
}

impl fmt::Debug for PreparedQuestion {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "PreparedQuestion({:?}, {}, {} history messages)", self.conversation_id, self.model, self.history.len())
    }
}

/// What happened once something was sent: always stored.
#[derive(Debug, Clone, PartialEq)]
pub struct QuestionResult {
    pub outcome: NewTurnOutcome,
    /// The « données envoyées » log of the turn.
    pub sent: Value,
    pub usage: Value,
    /// The model that answered last (or the one asked, if none answered).
    pub model: String,
}

/// Step 1.
pub fn prepare_question(conn: &Connection, req: &AskRequest, now_ms: i64) -> Result<PreparedQuestion, ServiceError> {
    let settings = ai::get_settings(conn)?;
    if !settings.enabled {
        return Err(ServiceError::Disabled);
    }
    if coach::coach_consent_at(conn)?.is_none() || !req.confirmed {
        return Err(ServiceError::ConsentRequired);
    }
    let question = req.question.trim();
    if question.is_empty() || question.chars().count() > MAX_QUESTION_CHARS {
        return Err(ServiceError::QuestionInvalid);
    }
    let history = match req.conversation_id {
        None => coach::ConversationHistory::default(),
        Some(id) => coach::history(conn, id).map_err(|e| match e {
            CoreError::Invalid(_) => ServiceError::ConversationClosed,
            other => other.into(),
        })?,
    };
    let scope = ToolScope::new(conn, &req.account_ids, now_ms, req.tz_offset_min)?;
    Ok(PreparedQuestion {
        conversation_id: req.conversation_id,
        model: settings.model,
        question: question.to_owned(),
        context: coach::context_line(now_ms, req.tz_offset_min, &scope.account_ids),
        scope,
        history_turns: history.turn_count,
        history: history.messages,
        allowed: history.allowed,
    })
}

fn tool_calls(content: &[Value]) -> impl Iterator<Item = &Value> {
    content.iter().filter(|b| b["type"] == "tool_use")
}

fn answer_text(content: &[Value]) -> String {
    let parts: Vec<&str> = content.iter().filter(|b| b["type"] == "text").filter_map(|b| b["text"].as_str()).collect();
    parts.join("\n").trim().to_owned()
}

/// Step 2. `Err` only when nothing was sent (no key, vault unavailable); once a request has been attempted,
/// the result is always a [`QuestionResult`], answered or failed, so the user sees what may have left.
pub fn run_question(
    p: &PreparedQuestion,
    vault: &dyn Vault,
    provider: &dyn Provider,
    run_tool: &mut dyn FnMut(&ToolScope, &str, &Value) -> ToolOutput,
) -> Result<QuestionResult, ServiceError> {
    let key = vault.load()?.ok_or(ServiceError::NoKey)?;
    let definitions = tools::definitions();
    let user = coach::user_message(&p.context, &p.question);
    let mut allowed = p.allowed.clone();
    coach::add_given(&mut allowed, &user);
    let mut transcript = vec![user];
    let mut calls_log: Vec<Value> = Vec::new();
    let (mut calls, mut requests, mut input_tokens, mut output_tokens) = (0usize, 0usize, 0u64, 0u64);
    let mut limit_reached = false;
    let mut model = p.model.clone();

    let finish = |outcome: NewTurnOutcome, calls_log: Vec<Value>, requests: usize, limit_reached: bool, model: String, tokens: (u64, u64)| QuestionResult {
        outcome,
        sent: json!({
            "provider": provider.id(),
            "model": p.model,
            "question": p.question,
            "context": p.context,
            "historyTurns": p.history_turns,
            "historyMessages": p.history.len(),
            "requests": requests,
            "toolCalls": calls_log,
            "limitReached": limit_reached,
        }),
        usage: json!({ "inputTokens": tokens.0, "outputTokens": tokens.1, "requests": requests }),
        model,
    };

    loop {
        requests += 1;
        // The last request allowed, or once the tool budget is spent: the AI answers with what it has.
        let allow_tools = requests < MAX_REQUESTS && calls < MAX_TOOL_CALLS;
        let messages: Vec<Value> = p.history.iter().chain(transcript.iter()).cloned().collect();
        let request = ConverseRequest { model: &p.model, system: coach::SYSTEM_PROMPT, tools: &definitions, messages: &messages, allow_tools };
        let reply = match provider.converse(&key, &request) {
            Ok(r) => r,
            Err(e) => {
                let failed = NewTurnOutcome::Failed { error_code: format!("ai:{}", e.code()) };
                return Ok(finish(failed, calls_log, requests, limit_reached, model, (input_tokens, output_tokens)));
            }
        };
        model = reply.model.clone();
        input_tokens += reply.input_tokens;
        output_tokens += reply.output_tokens;
        let asked: Vec<Value> = tool_calls(&reply.content).cloned().collect();
        let text = answer_text(&reply.content);
        transcript.push(json!({ "role": "assistant", "content": reply.content }));
        match reply.stop {
            StopReason::EndTurn if !text.is_empty() => {
                let unverified = coach::unverified(&text, &allowed);
                let answered = NewTurnOutcome::Answered { answer: text, transcript, unverified };
                return Ok(finish(answered, calls_log, requests, limit_reached, model, (input_tokens, output_tokens)));
            }
            StopReason::ToolUse if allow_tools => {
                let mut results = Vec::new();
                for call in asked {
                    let (id, name, input) = (call["id"].clone(), call["name"].as_str().unwrap_or_default().to_owned(), call["input"].clone());
                    let out = if calls >= MAX_TOOL_CALLS {
                        limit_reached = true;
                        ToolOutput {
                            content: json!({ "error": format!("Limite de {MAX_TOOL_CALLS} appels d'outils atteinte pour cette question : réponds avec les données déjà obtenues.") }),
                            is_error: true,
                        }
                    } else {
                        calls += 1;
                        run_tool(&p.scope, &name, &input)
                    };
                    allowed.add_json(&out.content);
                    results.push(json!({ "type": "tool_result", "tool_use_id": id, "content": out.content.to_string(), "is_error": out.is_error }));
                    calls_log.push(json!({ "name": name, "input": input, "output": out.content, "isError": out.is_error }));
                }
                transcript.push(json!({ "role": "user", "content": results }));
            }
            // An empty answer, or tools asked for when they were not allowed.
            _ => {
                let failed = NewTurnOutcome::Failed { error_code: format!("ai:{}", AiError::UnexpectedResponse.code()) };
                return Ok(finish(failed, calls_log, requests, limit_reached, model, (input_tokens, output_tokens)));
            }
        }
    }
}

/// Step 3.
pub fn store_question(conn: &Connection, p: &PreparedQuestion, provider_id: &str, result: &QuestionResult, now_ms: i64) -> Result<CoachTurn, ServiceError> {
    let turn = NewTurn {
        question: p.question.clone(),
        outcome: result.outcome.clone(),
        provider: provider_id.to_owned(),
        model: result.model.clone(),
        sent: result.sent.clone(),
        usage: Some(result.usage.clone()),
    };
    Ok(coach::add_turn(conn, p.conversation_id, &turn, now_ms)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ConverseReply, ApiKey};
    use pulse_core::accounts::{self, NewAccount};
    use pulse_core::ai::AiSettingsUpdate;
    use pulse_core::coach::TurnStatus;
    use pulse_core::trades::{self, Direction, TradeData};
    use pulse_core::{db, instruments, money};
    use pulse_vault::{MemoryVault, VaultError};
    use std::sync::Mutex;

    const NOW: i64 = 1_790_000_000_000;

    /// Answers from a script; records every request it received.
    struct Scripted {
        replies: Mutex<Vec<Result<ConverseReply, AiError>>>,
        seen: Mutex<Vec<(Value, Vec<Value>, bool)>>,
        /// When set, answers « tool_use » forever while tools are allowed.
        endless: bool,
    }

    impl Scripted {
        fn new(replies: Vec<Result<ConverseReply, AiError>>) -> Self {
            Scripted { replies: Mutex::new(replies.into_iter().rev().collect()), seen: Mutex::new(Vec::new()), endless: false }
        }
        fn seen(&self) -> Vec<(Value, Vec<Value>, bool)> {
            self.seen.lock().unwrap().clone()
        }
    }

    impl Provider for Scripted {
        fn id(&self) -> &'static str {
            "fake"
        }
        fn check(&self, _: &ApiKey, _: &str) -> Result<(), AiError> {
            Ok(())
        }
        fn analyze_image(&self, _: &ApiKey, _: &crate::ImageRequest) -> Result<crate::AnalysisReply, AiError> {
            Err(AiError::UnexpectedResponse)
        }
        fn converse(&self, key: &ApiKey, r: &ConverseRequest) -> Result<ConverseReply, AiError> {
            assert_eq!(key.expose(), "sk-test-key");
            assert_eq!(r.system, coach::SYSTEM_PROMPT);
            self.seen.lock().unwrap().push((r.tools.clone(), r.messages.to_vec(), r.allow_tools));
            if self.endless {
                return Ok(if r.allow_tools { tool_reply(&[("period_summary", json!({})), ("list_accounts", json!({})), ("risk", json!({}))]) } else { text_reply("Fin : 4 trades.") });
            }
            self.replies.lock().unwrap().pop().unwrap_or(Err(AiError::UnexpectedResponse))
        }
    }

    fn tool_reply(calls: &[(&str, Value)]) -> ConverseReply {
        let mut content = vec![json!({ "type": "thinking", "thinking": "", "signature": "sig-1" })];
        for (i, (name, input)) in calls.iter().enumerate() {
            content.push(json!({ "type": "tool_use", "id": format!("toolu_{i}"), "name": name, "input": input }));
        }
        ConverseReply { content, stop: StopReason::ToolUse, model: "claude-opus-5-5".into(), input_tokens: 100, output_tokens: 20 }
    }

    fn text_reply(text: &str) -> ConverseReply {
        ConverseReply { content: vec![json!({ "type": "text", "text": text })], stop: StopReason::EndTurn, model: "claude-opus-5-5".into(), input_tokens: 150, output_tokens: 40 }
    }

    fn setup() -> (Connection, i64) {
        let conn = db::open_in_memory().unwrap();
        let account = accounts::create(
            &conn,
            &NewAccount { name: "Compte".into(), kind: "personal".into(), broker: String::new(), currency: "USD".into(), initial_capital: money::parse("c", "10000").unwrap() },
        )
        .unwrap()
        .id;
        let eu = instruments::get_by_symbol(&conn, "EURUSD").unwrap().unwrap().id;
        for (entry, exit) in [("1.1000", "1.1010"), ("1.1000", "1.0990")] {
            let mut t = TradeData::new(account, eu, Direction::Long, money::parse("s", "1").unwrap(), money::parse("e", entry).unwrap(), NOW - 7_200_000);
            t.exit_price = Some(money::parse("x", exit).unwrap());
            t.exit_time = Some(NOW - 3_600_000);
            trades::create(&conn, &t).unwrap();
        }
        (conn, account)
    }

    fn turn_on(conn: &Connection) {
        ai::set_settings(conn, &AiSettingsUpdate { enabled: true, model: "claude-opus-5-5".into() }).unwrap();
        coach::record_coach_consent(conn, NOW).unwrap();
    }

    fn ask(q: &str, conversation_id: Option<i64>) -> AskRequest {
        AskRequest { conversation_id, question: q.into(), account_ids: vec![], tz_offset_min: 0, confirmed: true }
    }

    fn key_vault() -> MemoryVault {
        let v = MemoryVault::default();
        crate::service::save_key(&v, "sk-test-key").unwrap();
        v
    }

    fn run_local(conn: &Connection) -> impl FnMut(&ToolScope, &str, &Value) -> ToolOutput + '_ {
        move |scope, name, input| tools::run(conn, scope, name, input)
    }

    #[test]
    fn nothing_is_prepared_when_the_option_is_off_without_consent_or_without_validation() {
        let (conn, _) = setup();
        assert_eq!(prepare_question(&conn, &ask("Résume ma semaine", None), NOW).unwrap_err(), ServiceError::Disabled);
        ai::set_settings(&conn, &AiSettingsUpdate { enabled: true, model: "claude-opus-5-5".into() }).unwrap();
        ai::record_consent(&conn, NOW).unwrap();
        assert_eq!(prepare_question(&conn, &ask("Résume ma semaine", None), NOW).unwrap_err(), ServiceError::ConsentRequired, "the screenshot consent is not the coach's");
        coach::record_coach_consent(&conn, NOW).unwrap();
        let not_validated = AskRequest { confirmed: false, ..ask("Résume ma semaine", None) };
        assert_eq!(prepare_question(&conn, &not_validated, NOW).unwrap_err(), ServiceError::ConsentRequired);
        assert_eq!(prepare_question(&conn, &ask("   ", None), NOW).unwrap_err(), ServiceError::QuestionInvalid);
        assert_eq!(prepare_question(&conn, &ask(&"x".repeat(MAX_QUESTION_CHARS + 1), None), NOW).unwrap_err(), ServiceError::QuestionInvalid);
        assert_eq!(ServiceError::QuestionInvalid.to_string(), "ai:questionInvalid");
        let p = prepare_question(&conn, &ask("Résume ma semaine", None), NOW).unwrap();
        assert!(!format!("{p:?}").contains("semaine"), "Debug prints no content");
    }

    #[test]
    fn without_a_key_nothing_is_sent_nor_stored() {
        let (conn, _) = setup();
        turn_on(&conn);
        let p = prepare_question(&conn, &ask("Résume ma semaine", None), NOW).unwrap();
        let provider = Scripted::new(vec![Ok(text_reply("x"))]);
        let err = run_question(&p, &MemoryVault::default(), &provider, &mut run_local(&conn)).unwrap_err();
        assert_eq!(err, ServiceError::NoKey);
        assert_eq!(run_question(&p, &pulse_vault::Unavailable, &provider, &mut run_local(&conn)).unwrap_err(), ServiceError::from(VaultError::Unavailable));
        assert!(provider.seen().is_empty());
        assert!(coach::list_conversations(&conn).unwrap().is_empty());
    }

    #[test]
    fn a_question_runs_the_tools_then_stores_the_answer_the_log_and_the_numbers_to_check() {
        let (conn, account) = setup();
        turn_on(&conn);
        let vault = key_vault();
        let provider = Scripted::new(vec![
            Ok(tool_reply(&[("period_summary", json!({ "period": "1S" }))])),
            Ok(text_reply("Sur 2 trades, win rate de 50 % ; vous auriez gagné 42 % de plus.")),
        ]);
        let p = prepare_question(&conn, &ask("Résume ma semaine", None), NOW).unwrap();
        let result = run_question(&p, &vault, &provider, &mut run_local(&conn)).unwrap();
        let turn = store_question(&conn, &p, provider.id(), &result, NOW).unwrap();
        assert_eq!(turn.status, TurnStatus::Answered);
        assert_eq!(turn.answer.as_deref(), Some("Sur 2 trades, win rate de 50 % ; vous auriez gagné 42 % de plus."));
        assert_eq!(turn.unverified, ["42 %"], "50 % is the tool's 0.5; 42 % comes from nowhere");
        assert_eq!(turn.usage.as_ref().unwrap()["inputTokens"], 250);

        // The log shows the question, the context and the exact tool result sent.
        let sent = &turn.sent;
        assert_eq!(sent["question"], "Résume ma semaine");
        assert!(sent["context"].as_str().unwrap().contains(&format!("Comptes de la portée : {account}.")));
        assert_eq!(sent["toolCalls"][0]["name"], "period_summary");
        assert_eq!(sent["toolCalls"][0]["output"]["summary"]["tradeCount"], 2);
        assert_eq!((sent["requests"].as_u64(), sent["historyTurns"].as_u64()), (Some(2), Some(0)));

        // Second request: the AI's content comes back unchanged, then the tool result with its id.
        let seen = provider.seen();
        let messages = &seen[1].1;
        assert_eq!(messages.len(), 3);
        assert_eq!(messages[1]["content"][0], json!({ "type": "thinking", "thinking": "", "signature": "sig-1" }));
        assert_eq!(messages[2]["content"][0]["tool_use_id"], "toolu_0");
        assert_eq!(messages[2]["content"][0]["is_error"], false);
        assert!(messages[2]["content"][0]["content"].as_str().unwrap().contains("\"tradeCount\":2"));

        // A follow-up replays this conversation only, with the same system prompt and tools.
        let other = Scripted::new(vec![Ok(text_reply("Autre conversation."))]);
        let p_other = prepare_question(&conn, &ask("Question isolée", None), NOW).unwrap();
        store_question(&conn, &p_other, "fake", &run_question(&p_other, &vault, &other, &mut run_local(&conn)).unwrap(), NOW).unwrap();
        let next = Scripted::new(vec![Ok(text_reply("Toujours 2 trades."))]);
        let p2 = prepare_question(&conn, &ask("Et ensuite ?", Some(turn.conversation_id)), NOW).unwrap();
        let r2 = run_question(&p2, &vault, &next, &mut run_local(&conn)).unwrap();
        let (tools2, messages2, _) = next.seen()[0].clone();
        assert_eq!(tools2, seen[0].0, "the tool list never changes");
        assert_eq!(messages2.len(), 5, "4 messages of the first turn + the new question");
        assert_eq!(messages2[..4], seen[1].1.iter().chain(std::iter::once(&json!({ "role": "assistant", "content": [{ "type": "text", "text": "Sur 2 trades, win rate de 50 % ; vous auriez gagné 42 % de plus." }] }))).cloned().collect::<Vec<_>>()[..]);
        assert!(!messages2.iter().any(|m| m.to_string().contains("Question isolée")), "never another conversation");
        assert_eq!(r2.sent["historyTurns"], 1);
        assert!(matches!(r2.outcome, NewTurnOutcome::Answered { ref unverified, .. } if unverified.is_empty()), "2 is small; nothing to flag");
    }

    #[test]
    fn tool_calls_and_requests_are_capped() {
        let (conn, _) = setup();
        turn_on(&conn);
        let mut provider = Scripted::new(vec![]);
        provider.endless = true;
        let p = prepare_question(&conn, &ask("Tout analyser", None), NOW).unwrap();
        let result = run_question(&p, &key_vault(), &provider, &mut run_local(&conn)).unwrap();
        let seen = provider.seen();
        assert!(seen.len() <= MAX_REQUESTS);
        assert!(!seen.last().unwrap().2, "the last request forbids tools");
        let log = result.sent["toolCalls"].as_array().unwrap();
        assert_eq!(log.iter().filter(|c| c["isError"] == false).count(), MAX_TOOL_CALLS);
        assert_eq!(log.len(), 9, "3 calls per request: the 9th is answered « limit reached »");
        assert!(log[8]["output"]["error"].as_str().unwrap().contains("Limite de 8"));
        assert_eq!(result.sent["limitReached"], true);
        assert!(matches!(result.outcome, NewTurnOutcome::Answered { .. }));
    }

    #[test]
    fn a_failure_after_sending_is_stored_with_what_left_and_never_replayed() {
        let (conn, _) = setup();
        turn_on(&conn);
        let vault = key_vault();
        let provider = Scripted::new(vec![Ok(tool_reply(&[("discipline", json!({}))])), Err(AiError::Timeout)]);
        let p = prepare_question(&conn, &ask("Ma discipline ?", None), NOW).unwrap();
        let result = run_question(&p, &vault, &provider, &mut run_local(&conn)).unwrap();
        let turn = store_question(&conn, &p, "fake", &result, NOW).unwrap();
        assert_eq!((turn.status, turn.error_code.as_deref()), (TurnStatus::Failed, Some("ai:timeout")));
        assert_eq!(turn.sent["toolCalls"][0]["name"], "discipline", "the tool result did leave");

        let next = Scripted::new(vec![Ok(text_reply("OK"))]);
        let p2 = prepare_question(&conn, &ask("Encore ?", Some(turn.conversation_id)), NOW).unwrap();
        run_question(&p2, &vault, &next, &mut run_local(&conn)).unwrap();
        assert_eq!(next.seen()[0].1.len(), 1, "the failed turn is not replayed");

        // Refusal, empty answer, tool errors.
        for (reply, code) in [(Err(AiError::Refused), "ai:refused"), (Ok(text_reply("   ")), "ai:unexpectedResponse")] {
            let p = prepare_question(&conn, &ask("Q", None), NOW).unwrap();
            let r = run_question(&p, &vault, &Scripted::new(vec![reply]), &mut run_local(&conn)).unwrap();
            assert_eq!(r.outcome, NewTurnOutcome::Failed { error_code: code.into() });
        }
        let bad = Scripted::new(vec![Ok(tool_reply(&[("delete_everything", json!({}))])), Ok(text_reply("Impossible."))]);
        let r = run_question(&prepare_question(&conn, &ask("Q", None), NOW).unwrap(), &vault, &bad, &mut run_local(&conn)).unwrap();
        assert_eq!(r.sent["toolCalls"][0]["isError"], true);
        assert_eq!(bad.seen()[1].1[2]["content"][0]["is_error"], true);
    }

    #[test]
    fn a_full_conversation_takes_no_new_question() {
        let (conn, _) = setup();
        turn_on(&conn);
        let vault = key_vault();
        let p = prepare_question(&conn, &ask("Q", None), NOW).unwrap();
        let first = store_question(&conn, &p, "fake", &run_question(&p, &vault, &Scripted::new(vec![Ok(text_reply("R"))]), &mut run_local(&conn)).unwrap(), NOW).unwrap();
        conn.execute("UPDATE coach_conversations SET tools_version = 0 WHERE id = ?1", [first.conversation_id]).unwrap();
        assert_eq!(prepare_question(&conn, &ask("Q2", Some(first.conversation_id)), NOW).unwrap_err(), ServiceError::ConversationClosed);
        assert!(matches!(prepare_question(&conn, &ask("Q2", Some(999)), NOW).unwrap_err(), ServiceError::Core(_)));
    }
}
