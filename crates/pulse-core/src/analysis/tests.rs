//! Tests du lot 31, journaux calculés à la main.
//!
//! Calendrier : lundi 2026-09-28 00:00 UTC = `MON`. Sauf mention contraire, décalage local 0.
//! Journal R (comparaison) : long, entrée 100, stop 90 (risque 10), taille 1, multiplicateur 1,
//! R = (sortie − 100) / 10. Score de discipline d'un trade avec stop, sans plan ni règle : composantes
//! `stopLoss` (10) et `behavior` (10) à 1 → 100 ; sans stop : 10 / 20 → 50.

use super::*;
use crate::alerts::no_analysis;
use crate::behavior::Verdict;
use crate::db;
use crate::money::Decimal;
use crate::stats::{AccountCapital, Journal, Ledger, Position, StatsQuery, TradeFacts};
use crate::test_support::{dec, instrument};
use crate::trades::Direction;
use ideas::{IdeaInput, IdeaOutcome, IdeaStatus, NoteKind};
use rusqlite::Connection;
use serde_json::{Value, json};
use sessions::{AnalysisInput, AnswerInput};
use std::collections::HashSet;

const DAY: i64 = 86_400_000;
const HOUR: i64 = 3_600_000;
const MIN: i64 = 60_000;
const MON: i64 = 20_724 * DAY;

fn conn() -> Connection {
    db::open_in_memory().unwrap()
}

fn question(conn: &Connection, key: &str) -> i64 {
    conn.query_row("SELECT id FROM analysis_questions WHERE key = ?1", [key], |r| r.get(0)).unwrap()
}

fn idea_input(conn: &Connection, note: &str) -> IdeaInput {
    IdeaInput {
        instrument_id: instrument(conn, "EURUSD", "100000"),
        timeframes: vec!["weekly".into()],
        note: note.into(),
        level_low: None,
        level_high: None,
        invalidation: None,
    }
}

fn new_idea(conn: &Connection, at: i64) -> i64 {
    ideas::create(conn, &idea_input(conn, "Résistance en W"), at).unwrap().id
}

fn text_answer(conn: &Connection, key: &str, v: &str) -> AnswerInput {
    AnswerInput { question_id: question(conn, key), value: json!(v) }
}

fn analysis_at(conn: &Connection, at: i64, tz: i32) -> sessions::Analysis {
    let input = AnalysisInput { created_at: Some(at), tz_offset_min: tz, note: None, answers: vec![text_answer(conn, "levels", "4 250 - 4 300")] };
    sessions::create(conn, &input, at).unwrap()
}

// ---------------------------------------------------------------- questions

#[test]
fn the_default_questions_are_seeded_in_order_and_never_deleted() {
    let c = conn();
    let keys: Vec<String> = questions::list(&c, false).unwrap().into_iter().map(|q| q.key).collect();
    assert_eq!(
        keys,
        ["trend", "levels", "news", "alts", "scenarioMain", "scenarioAlt", "invalidation", "assets", "setups", "conviction", "riskLimits", "state", "mistakeToAvoid"]
    );
    let trend = questions::get(&c, question(&c, "trend")).unwrap();
    assert_eq!(trend.options, json!({ "timeframes": ["monthly", "weekly", "daily", "h4", "h1"] }));
    assert!(trend.label.is_none(), "the original wording comes from the key");

    // An answered question cannot be deleted (no cascade), archived it stays readable.
    let a = analysis_at(&c, MON, 0);
    let levels = question(&c, "levels");
    assert!(c.execute("DELETE FROM analysis_questions WHERE id = ?1", [levels]).is_err());
    questions::set_archived(&c, levels, true).unwrap();
    assert!(!questions::list(&c, false).unwrap().iter().any(|q| q.id == levels));
    assert!(questions::list(&c, true).unwrap().iter().any(|q| q.id == levels && q.archived));
    assert_eq!(sessions::get(&c, a.id).unwrap().answers.len(), 1, "the past answer is intact");
    questions::set_archived(&c, levels, false).unwrap();
    assert!(questions::list(&c, false).unwrap().iter().any(|q| q.id == levels));
}

#[test]
fn questions_can_be_added_renamed_reordered_and_their_options_checked() {
    let c = conn();
    let q = questions::add(&c, "  Mon biais   de la semaine ", QuestionKind::ShortText, &json!({})).unwrap();
    assert_eq!((q.label.as_deref(), q.key.as_str(), q.position), (Some("Mon biais de la semaine"), format!("custom_{}", q.id).as_str(), 14));
    assert!(questions::add(&c, "  ", QuestionKind::ShortText, &json!({})).is_err());
    assert!(questions::add(&c, "Annonces bis", QuestionKind::News, &json!({})).is_err(), "one news block only");
    // Single choice: 2 to 12 distinct choices.
    assert!(questions::add(&c, "Humeur", QuestionKind::Choice, &json!({ "choices": ["Bonne"] })).is_err());
    assert!(questions::add(&c, "Humeur", QuestionKind::Choice, &json!({ "choices": ["Bonne", "bonne"] })).is_err());
    let choice = questions::add(&c, "Humeur", QuestionKind::Choice, &json!({ "choices": ["Bonne", "Moyenne"] })).unwrap();
    assert_eq!(choice.options, json!({ "choices": ["Bonne", "Moyenne"] }));

    // Renaming an original question, then going back to its wording.
    let levels = question(&c, "levels");
    assert_eq!(questions::update(&c, levels, Some("Mes zones"), None).unwrap().label.as_deref(), Some("Mes zones"));
    assert_eq!(questions::update(&c, levels, None, None).unwrap().label, None);
    assert!(questions::update(&c, q.id, None, None).is_err(), "a custom question keeps a label");

    // Trend units: canonical order, at least one, known ones only.
    let trend = question(&c, "trend");
    let t = questions::update(&c, trend, None, Some(&json!({ "timeframes": ["h4", "weekly", "m15"] }))).unwrap();
    assert_eq!(t.options, json!({ "timeframes": ["weekly", "h4", "m15"] }));
    assert!(questions::update(&c, trend, None, Some(&json!({ "timeframes": [] }))).is_err());
    assert!(questions::update(&c, trend, None, Some(&json!({ "timeframes": ["yearly"] }))).is_err());

    // Reordering: down then up; archived ones do not count; the edge does nothing.
    let order = |c: &Connection| questions::list(c, false).unwrap().into_iter().map(|q| q.key).take(3).collect::<Vec<_>>();
    assert_eq!(order(&c), ["trend", "levels", "news"]);
    questions::move_by(&c, levels, 1).unwrap();
    assert_eq!(order(&c), ["trend", "news", "levels"]);
    questions::move_by(&c, levels, -1).unwrap();
    assert_eq!(order(&c), ["trend", "levels", "news"]);
    questions::move_by(&c, trend, -1).unwrap();
    assert_eq!(order(&c), ["trend", "levels", "news"]);
    questions::set_archived(&c, levels, true).unwrap();
    assert!(questions::move_by(&c, levels, 1).is_err());
}

// ---------------------------------------------------------------- analyses de séance

#[test]
fn an_empty_analysis_is_refused_and_empty_answers_are_never_stored_as_zero() {
    let c = conn();
    let input = |answers: Vec<AnswerInput>| AnalysisInput { created_at: Some(MON), tz_offset_min: 0, note: None, answers };
    assert!(sessions::create(&c, &input(vec![]), MON).is_err());
    let blanks = vec![
        text_answer(&c, "levels", "   "),
        AnswerInput { question_id: question(&c, "conviction"), value: Value::Null },
        AnswerInput { question_id: question(&c, "setups"), value: json!([]) },
        AnswerInput { question_id: question(&c, "trend"), value: json!({ "weekly": { "trend": null, "note": "" } }) },
    ];
    assert!(sessions::create(&c, &input(blanks), MON).is_err());
    let n: i64 = c.query_row("SELECT COUNT(*) FROM analyses", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 0, "the refused analysis left nothing behind");

    let ok = sessions::create(&c, &input(vec![text_answer(&c, "levels", " 4 250 "), AnswerInput { question_id: question(&c, "conviction"), value: Value::Null }]), MON).unwrap();
    assert_eq!(ok.answers.len(), 1, "an unanswered question stays empty");
    assert_eq!(ok.answers[0].value, json!("4 250"));
}

#[test]
fn answers_are_checked_by_question_kind() {
    let c = conn();
    let setup = crate::tags::create(&c, crate::tags::TagKind::Setup, "Breakout").unwrap().id;
    let mistake = crate::tags::create(&c, crate::tags::TagKind::Mistake, "Trop tôt").unwrap().id;
    let calme = crate::tags::get_or_create(&c, crate::tags::TagKind::Emotion, "Calme").unwrap().id;
    let make = |key: &str, v: Value| {
        let input = AnalysisInput { created_at: Some(MON), tz_offset_min: 0, note: None, answers: vec![AnswerInput { question_id: question(&c, key), value: v }] };
        sessions::create(&c, &input, MON)
    };
    assert!(make("conviction", json!(0)).is_err());
    assert!(make("conviction", json!(11)).is_err());
    assert!(make("conviction", json!(7.5)).is_err());
    assert!(make("conviction", json!(10)).is_ok());
    assert!(make("trend", json!({ "weekly": { "trend": "sideways" } })).is_err());
    assert!(make("trend", json!({ "yearly": { "trend": "up" } })).is_err());
    let trend = make("trend", json!({ "daily": { "trend": "up", "note": " au-dessus de la 200 " }, "h4": { "trend": null, "note": "" } })).unwrap();
    assert_eq!(trend.answers[0].value, json!({ "daily": { "trend": "up", "note": "au-dessus de la 200" } }));
    assert!(make("setups", json!([mistake])).is_err(), "a mistake is not a setup");
    assert_eq!(make("setups", json!([setup, setup])).unwrap().answers[0].value, json!([setup]));
    assert!(make("state", json!({ "tagIds": [setup] })).is_err());
    assert_eq!(make("state", json!({ "text": "Fatigué", "tagIds": [calme] })).unwrap().answers[0].value, json!({ "text": "Fatigué", "tagIds": [calme] }));
    assert!(make("news", json!({ "note": "Plan inchangé" })).is_ok());
    assert!(make("levels", json!("x".repeat(4001))).is_err());
    assert!(make("levels", json!(12)).is_err());
}

#[test]
fn several_analyses_a_day_keep_their_own_time_and_day_follows_their_offset() {
    let c = conn();
    // 23:30 UTC on Monday with +120 min = Tuesday 01:30 local.
    let late = analysis_at(&c, MON + 23 * HOUR + 30 * MIN, 120);
    assert_eq!(late.day, "2026-09-29");
    let morning = analysis_at(&c, MON + DAY + 7 * HOUR, 120); // Tuesday 09:00 local
    let noon = analysis_at(&c, MON + DAY + 10 * HOUR, 120);
    let day: Vec<i64> = sessions::list_day(&c, "2026-09-29").unwrap().iter().map(|a| a.id).collect();
    assert_eq!(day, [late.id, morning.id, noon.id], "oldest first");
    assert_eq!(sessions::latest_of_day(&c, "2026-09-29").unwrap().unwrap().id, noon.id);
    assert!(sessions::latest_of_day(&c, "2026-09-28").unwrap().is_none());
    // Before a day: most recent first, never the day itself.
    let before: Vec<i64> = sessions::list_before(&c, "2026-09-29", 10).unwrap().iter().map(|a| a.id).collect();
    assert!(before.is_empty());
    assert_eq!(sessions::list_before(&c, "2026-09-30", 10).unwrap().len(), 3);
    // Moving the time moves the day.
    let moved = sessions::update(&c, late.id, &AnalysisInput { created_at: Some(MON + 10 * HOUR), tz_offset_min: 120, note: None, answers: vec![] }, MON + DAY).unwrap();
    assert_eq!(moved.day, "2026-09-28");
    assert_eq!(moved.answers.len(), 1, "answers not given are kept");
}

#[test]
fn editing_an_analysis_never_destroys_an_archived_answer() {
    let c = conn();
    let a = analysis_at(&c, MON, 0);
    let levels = question(&c, "levels");
    questions::set_archived(&c, levels, true).unwrap();
    let edit = |answers: Vec<AnswerInput>| sessions::update(&c, a.id, &AnalysisInput { created_at: None, tz_offset_min: 0, note: Some("Note".into()), answers }, MON + 1);
    let updated = edit(vec![text_answer(&c, "alts", "SOL")]).unwrap();
    assert_eq!(updated.answers.len(), 2);
    assert_eq!(updated.note.as_deref(), Some("Note"));
    // A new answer to an archived question is refused; clearing the only answers is refused too.
    assert!(edit(vec![text_answer(&c, "levels", "x"), text_answer(&c, "scenarioMain", "y")]).is_ok(), "existing answer of an archived question can be edited");
    assert!(sessions::update(&c, a.id, &AnalysisInput { created_at: None, tz_offset_min: 0, note: None, answers: vec![
        AnswerInput { question_id: levels, value: json!("") },
        AnswerInput { question_id: question(&c, "alts"), value: json!("") },
        AnswerInput { question_id: question(&c, "scenarioMain"), value: json!("") },
    ] }, MON + 2).is_err());
    assert_eq!(sessions::get(&c, a.id).unwrap().answers.len(), 3, "the refused edit changed nothing");
    let other = sessions::create(&c, &AnalysisInput { created_at: Some(MON + 1), tz_offset_min: 0, note: None, answers: vec![text_answer(&c, "alts", "ETH")] }, MON).unwrap();
    assert!(sessions::update(&c, other.id, &AnalysisInput { created_at: None, tz_offset_min: 0, note: None, answers: vec![text_answer(&c, "invalidation", "ok")] }, MON).is_ok());
    let fresh_archived = question(&c, "scenarioAlt");
    questions::set_archived(&c, fresh_archived, true).unwrap();
    assert!(sessions::update(&c, other.id, &AnalysisInput { created_at: None, tz_offset_min: 0, note: None, answers: vec![text_answer(&c, "scenarioAlt", "z")] }, MON).is_err());
}

// ---------------------------------------------------------------- annonces du jour

#[test]
fn the_news_block_reads_the_stored_calendar_only() {
    let c = conn();
    let today = crate::news::zones::paris_day(MON + 10 * HOUR);
    assert_eq!(today, "2026-09-28");
    let off = news_block::news_block(&c, None, MON + 10 * HOUR).unwrap();
    assert_eq!((off.state, off.events.len()), (NewsBlockState::Off, 0));
    let mut s = crate::news::settings::get(&c).unwrap();
    s.enabled = true;
    crate::news::settings::set(&c, &s).unwrap();
    assert_eq!(news_block::news_block(&c, None, MON + 10 * HOUR).unwrap().state, NewsBlockState::None);
    // Stored events: a high one at 14:30 Paris (12:30 UTC), a medium one, a high one the next day.
    let insert = |uid: &str, at: i64, day: &str, importance: &str, title: &str| {
        c.execute(
            "INSERT INTO economic_events (source, uid, starts_at, day, currency, title, importance, updated_at) VALUES ('file', ?1, ?2, ?3, 'USD', ?4, ?5, 0)",
            rusqlite::params![uid, at, day, title, importance],
        )
        .unwrap();
    };
    insert("a", MON + 12 * HOUR + 30 * MIN, "2026-09-28", "high", "CPI");
    insert("b", MON + 13 * HOUR, "2026-09-28", "medium", "Ventes au détail");
    insert("c", MON + DAY + 12 * HOUR, "2026-09-29", "high", "NFP");
    let block = news_block::news_block(&c, None, MON + 10 * HOUR).unwrap();
    assert_eq!(block.state, NewsBlockState::Events);
    assert_eq!(block.events.len(), 1);
    assert_eq!((block.events[0].title.as_str(), block.events[0].paris_time.as_deref()), ("CPI", Some("14:30")));
    assert_eq!(news_block::news_block(&c, Some("2026-09-29"), 0).unwrap().events[0].title, "NFP");
    assert_eq!(news_block::news_block(&c, Some("2026-10-05"), 0).unwrap().state, NewsBlockState::None);
    assert!(news_block::news_block(&c, Some("hier"), 0).is_err());
}

// ---------------------------------------------------------------- idées

#[test]
fn an_idea_keeps_a_dated_thread_and_exact_prices() {
    let c = conn();
    let mut input = idea_input(&c, "  ALGO arrive sur un niveau  ");
    input.level_low = Some("0.1850".into());
    input.level_high = Some("0.1900".into());
    input.timeframes = vec!["h4".into(), "weekly".into(), "weekly".into()];
    let idea = ideas::create(&c, &input, MON).unwrap();
    assert_eq!(idea.note, "ALGO arrive sur un niveau");
    assert_eq!((idea.level_low.unwrap().to_string(), idea.level_high.unwrap().to_string()), ("0.1850".into(), "0.1900".into()));
    assert_eq!(idea.timeframes, ["weekly", "h4"]);
    assert_eq!(idea.notes.len(), 1);
    assert_eq!(idea.notes[0].kind, NoteKind::Created);

    // Invalid input.
    let bad = |f: &dyn Fn(&mut IdeaInput)| {
        let mut i = idea_input(&c, "x");
        f(&mut i);
        ideas::create(&c, &i, MON).is_err()
    };
    assert!(bad(&|i| i.note = "  ".into()));
    assert!(bad(&|i| i.level_low = Some("1e5".into())));
    assert!(bad(&|i| i.level_low = Some("0".into())));
    assert!(bad(&|i| { i.level_low = Some("2".into()); i.level_high = Some("1".into()) }));
    assert!(bad(&|i| i.timeframes = vec!["yearly".into()]));
    assert!(bad(&|i| i.instrument_id = 99_999));

    // Editing the note adds an entry; the old text is still there. Nothing changed = nothing written.
    input.note = "ALGO : résistance en W, cassure = accélération".into();
    let edited = ideas::update(&c, idea.id, &input, MON + DAY).unwrap();
    assert_eq!(edited.notes.iter().map(|n| n.kind).collect::<Vec<_>>(), [NoteKind::Created, NoteKind::Edit]);
    assert_eq!(edited.notes[0].body, "ALGO arrive sur un niveau");
    assert_eq!(edited.updated_at, MON + DAY);
    let same = ideas::update(&c, idea.id, &input, MON + 2 * DAY).unwrap();
    assert_eq!((same.notes.len(), same.updated_at), (2, MON + DAY));
    // A price edit changes the content (date) without a thread entry for the text.
    input.level_high = Some("0.2000".into());
    let priced = ideas::update(&c, idea.id, &input, MON + 3 * DAY).unwrap();
    assert_eq!((priced.notes.len(), priced.updated_at), (2, MON + 3 * DAY));
}

#[test]
fn closing_records_the_outcome_and_the_idea_leaves_the_active_list() {
    let c = conn();
    let id = new_idea(&c, MON);
    let closed = ideas::close(&c, id, IdeaOutcome::Worked, Some(" cible atteinte "), MON + DAY).unwrap();
    assert_eq!((closed.status, closed.outcome, closed.closed_at), (IdeaStatus::Closed, Some(IdeaOutcome::Worked), Some(MON + DAY)));
    let last = closed.notes.last().unwrap();
    assert_eq!((last.kind, last.body.as_str(), last.data.as_deref()), (NoteKind::Closed, "cible atteinte", Some("worked")));
    assert!(ideas::list(&c, IdeaStatus::Active, None).unwrap().is_empty());
    assert_eq!(ideas::list(&c, IdeaStatus::Closed, None).unwrap().len(), 1);
    assert!(ideas::close(&c, id, IdeaOutcome::Invalidated, None, MON).is_err(), "already closed");
    assert!(ideas::complete(&c, id, "x", MON).is_err());
    assert!(review::snooze(&c, id, 1, MON, 0).is_err());
    // Deleting really deletes, with its notes.
    ideas::delete(&c, id).unwrap();
    assert!(ideas::get(&c, id).is_err());
    let n: i64 = c.query_row("SELECT COUNT(*) FROM idea_notes", [], |r| r.get(0)).unwrap();
    assert_eq!(n, 0, "the thread went with the idea");
}

#[test]
fn an_instrument_used_by_an_idea_cannot_be_deleted() {
    let c = conn();
    let id = new_idea(&c, MON);
    let instrument_id = ideas::get(&c, id).unwrap().instrument_id;
    assert!(c.execute("DELETE FROM instruments WHERE id = ?1", [instrument_id]).is_err());
}

// ---------------------------------------------------------------- revue du matin

/// Idée créée le jour `d` (0 = lundi 28) à 10:00 UTC.
fn idea_on(c: &Connection, d: i64) -> i64 {
    new_idea(c, MON + d * DAY + 10 * HOUR)
}
fn at(d: i64, h: i64) -> i64 {
    MON + d * DAY + h * HOUR
}
fn queue_ids(c: &Connection, now: i64, tz: i32) -> Vec<i64> {
    review::queue(c, now, tz).unwrap().items.iter().map(|v| v.idea.id).collect()
}

#[test]
fn the_banner_shows_only_when_the_day_changed_and_an_idea_is_waiting() {
    let c = conn();
    let id = idea_on(&c, 0);
    // Same day as its creation: nothing to review yet.
    assert_eq!(review::banner(&c, at(0, 20), 0).unwrap(), None);
    // Next morning: one idea.
    let b = review::banner(&c, at(1, 7), 0).unwrap().unwrap();
    assert_eq!((b.count, b.day.as_str()), (1, "2026-09-29"));
    // Reading writes nothing.
    let settings_rows = |c: &Connection| -> i64 { c.query_row("SELECT COUNT(*) FROM settings WHERE key LIKE 'analysis.%'", [], |r| r.get(0)).unwrap() };
    assert_eq!(settings_rows(&c), 0);
    // "Plus tard" silences today only.
    review::dismiss_banner(&c, at(1, 7), 0).unwrap();
    assert_eq!(review::banner(&c, at(1, 18), 0).unwrap(), None);
    assert_eq!(review::banner(&c, at(2, 7), 0).unwrap().unwrap().count, 1, "the next day it is back");
    assert_eq!(queue_ids(&c, at(1, 18), 0), [id], "still listed in the ideas tab");
}

#[test]
fn no_idea_no_banner_and_a_closed_or_updated_today_idea_does_not_count() {
    let c = conn();
    assert_eq!(review::banner(&c, at(3, 8), 0).unwrap(), None);
    let a = idea_on(&c, 0);
    let b = idea_on(&c, 0);
    ideas::close(&c, a, IdeaOutcome::NoFollowUp, None, at(1, 8)).unwrap();
    ideas::complete(&c, b, "Toujours là", at(1, 9)).unwrap(); // updated today
    assert_eq!(review::banner(&c, at(1, 10), 0).unwrap(), None);
    assert!(queue_ids(&c, at(1, 10), 0).is_empty());
    assert_eq!(queue_ids(&c, at(2, 8), 0), [b], "updated yesterday: back in the review");
}

#[test]
fn still_valid_marks_the_idea_reviewed_today_and_adds_nothing() {
    let c = conn();
    let id = idea_on(&c, 0);
    let v = review::keep(&c, id, at(1, 8), 0).unwrap();
    assert_eq!((v.idea.notes.len(), v.idea.updated_at, v.idea.last_reviewed_at), (1, at(0, 10), Some(at(1, 8))));
    assert!(v.reviewed_today && !v.in_review);
    assert!(queue_ids(&c, at(1, 20), 0).is_empty(), "a reviewed idea does not come back today");
    assert_eq!(queue_ids(&c, at(2, 0) , 0), [id], "it comes back the next local day");
    // The review of the day is over once nothing is left: the banner is silent.
    assert_eq!(review::banner(&c, at(1, 20), 0).unwrap(), None);
}

#[test]
fn an_idea_is_stale_from_exactly_the_configured_number_of_days() {
    let c = conn();
    let id = idea_on(&c, 0);
    let stale = |d: i64| review::queue(&c, at(d, 8), 0).unwrap().items.first().map(|v| (v.age_days, v.stale));
    assert_eq!(review::settings(&c).unwrap().stale_days, 7);
    assert_eq!(stale(6), Some((6, false)));
    assert_eq!(stale(7), Some((7, true)), "exactly N days = to review");
    assert_eq!(stale(9), Some((9, true)));
    let s = review::set_settings(&c, &AnalysisSettings { stale_days: 1, no_analysis_alert: false }).unwrap();
    assert_eq!(s.stale_days, 1);
    assert_eq!(stale(1), Some((1, true)));
    for bad in [0, 61] {
        assert!(review::set_settings(&c, &AnalysisSettings { stale_days: bad, no_analysis_alert: true }).is_err());
    }
    assert_eq!(review::settings(&c).unwrap(), AnalysisSettings { stale_days: 1, no_analysis_alert: false }, "nothing written by a refused save");
    // Keeping it does not refresh its age: only a content update does.
    review::keep(&c, id, at(2, 8), 0).unwrap();
    assert!(ideas::list_views(&c, IdeaStatus::Active, None, at(3, 8), 0).unwrap()[0].stale);
    ideas::complete(&c, id, "Mise à jour", at(3, 9)).unwrap();
    assert!(!ideas::list_views(&c, IdeaStatus::Active, None, at(3, 10), 0).unwrap()[0].stale);
}

#[test]
fn the_queue_is_ordered_and_shows_five_first() {
    let c = conn();
    let ids: Vec<i64> = (0..7).map(|_| idea_on(&c, 0)).collect();
    let fresh = idea_on(&c, 7); // created on day 7, updated later than the others
    let q = review::queue(&c, at(8, 8), 0).unwrap();
    assert_eq!((q.items.len(), q.visible, q.hidden), (8, 5, 3));
    // Stale (age ≥ 7) first, oldest update then id; the day-7 idea (age 1) last.
    assert_eq!(q.items.iter().map(|v| v.idea.id).collect::<Vec<_>>(), [ids.clone(), vec![fresh]].concat());
    assert!(q.items[..7].iter().all(|v| v.stale) && !q.items[7].stale);
    // Fewer than five: nothing hidden.
    let c2 = conn();
    idea_on(&c2, 0);
    let q2 = review::queue(&c2, at(1, 8), 0).unwrap();
    assert_eq!((q2.visible, q2.hidden), (1, 0));
}

#[test]
fn snooze_one_day_hides_today_and_returns_at_local_midnight() {
    let c = conn();
    let id = idea_on(&c, 0);
    let v = review::snooze(&c, id, 1, at(1, 9), 0).unwrap();
    assert_eq!((v.idea.snoozed_until_day.as_deref(), v.idea.snooze_count), (Some("2026-09-30"), 1));
    assert!(v.snoozed && !v.in_review);
    // Status, creation and content dates are untouched; the thread got an entry.
    assert_eq!((v.idea.status, v.idea.created_at, v.idea.updated_at), (IdeaStatus::Active, at(0, 10), at(0, 10)));
    assert_eq!(v.idea.notes.last().map(|n| (n.kind, n.data.clone())), Some((NoteKind::Snooze, Some("2026-09-30".into()))));
    assert_eq!(v.idea.notes.len(), 2, "the old text is still there");
    // Hidden, not counted, for the rest of today and all tomorrow; 00:00 local the day after it is back, first.
    assert!(queue_ids(&c, at(1, 23), 0).is_empty());
    assert_eq!(queue_ids(&c, at(2, 0), 0), [id], "00:00 local on the day named: back");
    assert!(queue_ids(&c, at(2, 0) - 1, 0).is_empty(), "one millisecond earlier: still hidden");
    assert_eq!(review::banner(&c, at(1, 23) + 59 * MIN, 0).unwrap(), None);
}

#[test]
fn snooze_returns_on_the_named_day_included() {
    let c = conn();
    let id = idea_on(&c, 0);
    let other = idea_on(&c, 0);
    // Snooze 3 days from Tuesday (day 1): until Friday 2026-10-02 (day 4).
    let v = review::snooze(&c, id, 3, at(1, 9), 0).unwrap();
    assert_eq!(v.idea.snoozed_until_day.as_deref(), Some("2026-10-02"));
    assert_eq!(queue_ids(&c, at(4, 0) - 1, 0), [other], "Thursday 23:59:59.999: still snoozed");
    assert_eq!(review::banner(&c, at(3, 23), 0).unwrap().unwrap().count, 1, "the snoozed idea is not counted");
    let back = review::queue(&c, at(4, 0), 0).unwrap();
    assert_eq!(back.items.iter().map(|v| v.idea.id).collect::<Vec<_>>(), [id, other], "the day itself: first in the review");
    assert!(back.items[0].returned);
    assert_eq!(review::banner(&c, at(4, 0), 0).unwrap().unwrap().count, 2);
}

#[test]
fn snooze_bounds_are_one_to_thirty_days() {
    let c = conn();
    let id = idea_on(&c, 0);
    for bad in [0, 31, 365] {
        assert!(review::snooze(&c, id, bad, at(1, 9), 0).is_err(), "{bad}");
    }
    assert_eq!(ideas::get(&c, id).unwrap().snooze_count, 0, "a refused snooze changes nothing");
    let v = review::snooze(&c, id, 30, at(1, 9), 0).unwrap(); // Tuesday 29 Sept + 30 d = 29 Oct
    assert_eq!(v.idea.snoozed_until_day.as_deref(), Some("2026-10-29"));
    let v = review::snooze(&c, id, 1, at(1, 10), 0).unwrap();
    assert_eq!(v.idea.snoozed_until_day.as_deref(), Some("2026-09-30"), "snoozing again is allowed and replaces the day");
}

#[test]
fn repeated_snoozes_are_counted_without_limit_and_shown_from_two() {
    let c = conn();
    let id = idea_on(&c, 0);
    let mut last = None;
    for d in 1..=3 {
        last = Some(review::snooze(&c, id, 1, at(d * 2, 9), 0).unwrap());
    }
    let v = last.unwrap();
    assert_eq!(v.idea.snooze_count, 3);
    assert_eq!(v.idea.notes.iter().filter(|n| n.kind == NoteKind::Snooze).count(), 3);
    // Still active, same creation day.
    assert_eq!((v.idea.status, v.idea.created_at), (IdeaStatus::Active, at(0, 10)));
}

#[test]
fn still_valid_complete_and_close_cancel_the_snooze() {
    let c = conn();
    for action in 0..3 {
        let id = idea_on(&c, 0);
        review::snooze(&c, id, 5, at(1, 9), 0).unwrap();
        assert!(ideas::get(&c, id).unwrap().snoozed_until_day.is_some());
        match action {
            0 => drop(review::keep(&c, id, at(2, 9), 0).unwrap()),
            1 => drop(review::complete(&c, id, "Mise à jour", at(2, 9), 0).unwrap()),
            _ => drop(review::close(&c, id, IdeaOutcome::Invalidated, None, at(2, 9), 0).unwrap()),
        }
        let idea = ideas::get(&c, id).unwrap();
        assert_eq!(idea.snoozed_until_day, None, "action {action}");
        assert_eq!(idea.snooze_count, 1, "the count of past snoozes stays");
    }
    // Editing the content also cancels it.
    let id = idea_on(&c, 0);
    review::snooze(&c, id, 5, at(1, 9), 0).unwrap();
    let mut input = idea_input(&c, "Nouveau texte");
    input.timeframes = vec![];
    ideas::update(&c, id, &input, at(2, 9)).unwrap();
    assert_eq!(ideas::get(&c, id).unwrap().snoozed_until_day, None);
}

#[test]
fn the_stale_mention_is_hidden_during_a_snooze_then_comes_back() {
    let c = conn();
    let id = idea_on(&c, 0);
    let flags = |d: i64| {
        let v = ideas::list_views(&c, IdeaStatus::Active, None, at(d, 8), 0).unwrap().remove(0);
        (v.stale, v.snoozed, v.returned)
    };
    assert_eq!(flags(8), (true, false, false));
    review::snooze(&c, id, 3, at(8, 9), 0).unwrap(); // until day 11
    assert_eq!(flags(9), (false, true, false), "no reproach while snoozed");
    assert_eq!(flags(10), (false, true, false));
    assert_eq!(flags(11), (true, false, true), "back on the day, still older than the threshold");
    // Snoozed right after a content update: not stale when it comes back.
    let fresh = idea_on(&c, 12);
    review::snooze(&c, fresh, 2, at(13, 9), 0).unwrap();
    let v = ideas::list_views(&c, IdeaStatus::Active, None, at(15, 8), 0).unwrap().into_iter().find(|v| v.idea.id == fresh).unwrap();
    assert_eq!((v.stale, v.returned, v.age_days), (false, true, 3));
}

#[test]
fn the_day_is_the_local_day_of_the_pc_not_utc() {
    let c = conn();
    // Created Monday 22:30 UTC = Tuesday 00:30 local (UTC+2).
    let id = new_idea(&c, at(0, 22) + 30 * MIN);
    // Tuesday 08:00 UTC+2 = 06:00 UTC: same local day as creation → nothing to review.
    assert_eq!(review::banner(&c, at(1, 6), 120).unwrap(), None);
    // Wednesday 00:30 local = Tuesday 22:30 UTC: a new local day, though UTC is still Tuesday.
    let now = at(1, 22) + 30 * MIN;
    assert_eq!(review::banner(&c, now, 120).unwrap().unwrap().day, "2026-09-30");
    assert_eq!(review::banner(&c, now, 0).unwrap().unwrap().day, "2026-09-29");
    // The same instant from a PC on UTC−5 is Tuesday 17:30: the idea created Monday 17:30 local is a day old.
    assert_eq!(queue_ids(&c, now, -300), [id]);
    // A snooze counts in the PC's day: 23:30 UTC+2 → today is Tuesday 29, +1 = Wednesday 30.
    let v = review::snooze(&c, id, 1, at(1, 21) + 30 * MIN, 120).unwrap();
    assert_eq!(v.idea.snoozed_until_day.as_deref(), Some("2026-09-30"));
    assert_eq!(queue_ids(&c, at(1, 22) + 30 * MIN, 120), [id], "00:30 Wednesday local: back, while UTC still says Tuesday");
    assert!(queue_ids(&c, at(1, 21), 120).is_empty());
}

#[test]
fn reading_the_review_writes_nothing_so_a_locked_app_records_nothing() {
    // Every command goes through the store that refuses when locked (`state.conn()`); on top of that,
    // everything the banner and the queue do is a read: the database is identical before and after.
    let c = conn();
    idea_on(&c, 0);
    let dump = |c: &Connection| -> Vec<String> {
        let mut out = Vec::new();
        for table in ["settings", "ideas", "idea_notes"] {
            let mut stmt = c.prepare(&format!("SELECT * FROM {table}")).unwrap();
            let n = stmt.column_count();
            let rows = stmt.query_map([], |r| Ok((0..n).map(|i| format!("{:?}", r.get::<_, rusqlite::types::Value>(i).unwrap())).collect::<Vec<_>>().join("|"))).unwrap();
            out.extend(rows.map(|r| r.unwrap()));
        }
        out
    };
    let before = dump(&c);
    review::banner(&c, at(1, 8), 0).unwrap();
    review::queue(&c, at(1, 8), 0).unwrap();
    ideas::list_views(&c, IdeaStatus::Active, None, at(1, 8), 0).unwrap();
    assert_eq!(dump(&c), before);
}

// ---------------------------------------------------------------- constat

fn trade(id: i64, exit: &str, with_stop: bool) -> TradeFacts {
    TradeFacts {
        id,
        account_id: 1,
        instrument_id: 1,
        symbol: "EURUSD".into(),
        asset_class: crate::instruments::AssetClass::Forex,
        position: Position {
            direction: Direction::Long,
            size: Decimal::ONE,
            multiplier: Decimal::ONE,
            entry_price: dec("100"),
            exit_price: Some(dec(exit)),
            planned_sl: with_stop.then(|| dec("90")),
            planned_tp: None,
            fees: Decimal::ZERO,
        },
        // One trade a day, 09:00 → 10:00 UTC, days 0.. (distinct days: no surtrading rank issue).
        entry_time: MON + id * DAY + 9 * HOUR,
        exit_time: Some(MON + id * DAY + 10 * HOUR),
        tz_offset_min: 0,
        execution_type: None,
        tags: Vec::new(),
        journal: Journal::default(),
    }
}

fn ledger(trades: Vec<TradeFacts>) -> Ledger {
    Ledger {
        currency: Some("USD".into()),
        initial_capital: dec("10000"),
        accounts: vec![AccountCapital { id: 1, initial_capital: dec("10000") }],
        capital_moves: Vec::new(),
        trades,
    }
}

fn compare(trades: Vec<TradeFacts>, linked: &[i64]) -> LinkedComparison {
    let set: HashSet<i64> = linked.iter().copied().collect();
    report::compare_linked(&ledger(trades), &StatsQuery::default(), &crate::settings::BehaviorSettings::default(), &set).unwrap()
}

/// Five linked trades, all with stop (score 100), exit 105 (R = +0.5); five others with `other_exit`.
fn r_journal(other_exit: &str) -> Vec<TradeFacts> {
    (1..=5).map(|i| trade(i, "105", true)).chain((6..=10).map(|i| trade(i, other_exit, true))).collect()
}

#[test]
fn expectancy_gap_of_exactly_a_quarter_r_is_higher_just_below_is_similar() {
    // Linked mean R = +0.5; others +0.25 → difference +0.25 = threshold → higher.
    let c = compare(r_journal("102.5"), &[1, 2, 3, 4, 5]);
    assert_eq!((c.linked.trade_count, c.unlinked.trade_count), (5, 5));
    assert_eq!((c.linked.expectancy_r, c.unlinked.expectancy_r), (Some(0.5), Some(0.25)));
    assert_eq!((c.expectancy_r.verdict, c.expectancy_r.difference), (Verdict::Higher, Some(0.25)));
    // Discipline: all 100 on both sides → similar, gap 0.
    assert_eq!((c.linked.discipline_score, c.unlinked.discipline_score), (Some(100.0), Some(100.0)));
    assert_eq!((c.discipline.verdict, c.discipline.difference), (Verdict::Similar, Some(0.0)));
    // Others at +0.26 R → difference 0.24 → similar.
    assert_eq!(compare(r_journal("102.6"), &[1, 2, 3, 4, 5]).expectancy_r.verdict, Verdict::Similar);
    // Others at +0.75 R → difference −0.25 → lower.
    let low = compare(r_journal("107.5"), &[1, 2, 3, 4, 5]);
    assert_eq!((low.expectancy_r.verdict, low.expectancy_r.difference), (Verdict::Lower, Some(-0.25)));
}

#[test]
fn discipline_gap_of_exactly_ten_points_is_higher() {
    // Linked: five trades with stop → 100 each. Others: four with stop (100) and one without (10/20 = 50) → mean 90.
    let trades: Vec<TradeFacts> = (1..=5).map(|i| trade(i, "105", true)).chain((6..=9).map(|i| trade(i, "105", true))).chain([trade(10, "105", false)]).collect();
    let c = compare(trades, &[1, 2, 3, 4, 5]);
    assert_eq!((c.linked.discipline_score, c.unlinked.discipline_score), (Some(100.0), Some(90.0)));
    assert_eq!((c.discipline.verdict, c.discipline.difference), (Verdict::Higher, Some(10.0)));
    // The unlinked side has only four trades with an R: that comparison waits.
    assert_eq!((c.unlinked.r_trade_count, c.expectancy_r.verdict), (4, Verdict::NotEnoughData));
}

#[test]
fn no_comparison_with_fewer_than_five_trades_on_a_side() {
    let c = compare(r_journal("102.5"), &[1, 2, 3, 4]);
    assert_eq!((c.linked.trade_count, c.unlinked.trade_count), (4, 6));
    assert_eq!((c.discipline.verdict, c.expectancy_r.verdict), (Verdict::NotEnoughData, Verdict::NotEnoughData));
    assert_eq!((c.discipline.difference, c.expectancy_r.difference), (None, None));
    assert_eq!(c.linked.discipline_score, None, "under five scored trades: no score");
    // Nothing linked at all.
    let none = compare(r_journal("102.5"), &[]);
    assert_eq!((none.linked.trade_count, none.expectancy_r.verdict), (0, Verdict::NotEnoughData));
    assert_eq!(none.linked.expectancy_r, None);
}

#[test]
fn idea_outcomes_count_and_the_rate_waits_for_five_closed_ideas() {
    let c = conn();
    let close = |outcome: IdeaOutcome, day: i64| {
        let id = idea_on(&c, 0);
        ideas::close(&c, id, outcome, None, at(day, 12)).unwrap();
    };
    assert_eq!(report::idea_outcomes(&c, None, None).unwrap().success_rate, None, "no idea: None, not 0");
    for o in [IdeaOutcome::Worked, IdeaOutcome::Worked, IdeaOutcome::Invalidated, IdeaOutcome::NoFollowUp] {
        close(o, 1);
    }
    let four = report::idea_outcomes(&c, None, None).unwrap();
    assert_eq!((four.worked, four.invalidated, four.no_follow_up, four.closed_count, four.success_rate), (2, 1, 1, 4, None));
    close(IdeaOutcome::Worked, 2);
    let five = report::idea_outcomes(&c, None, None).unwrap();
    // 3 worked / (3 worked + 1 invalidated) = 0.75; "sans suite" is counted but not in the rate.
    assert_eq!((five.closed_count, five.success_rate), (5, Some(0.75)));
    // The period is on the closing instant, [from, to).
    let day1 = report::idea_outcomes(&c, Some(at(1, 0)), Some(at(2, 0))).unwrap();
    assert_eq!((day1.closed_count, day1.success_rate), (4, None));
    assert_eq!(report::idea_outcomes(&c, Some(at(2, 13)), None).unwrap().closed_count, 0);
    assert_eq!(report::idea_outcomes(&c, Some(at(1, 0)), Some(at(2, 12))).unwrap().closed_count, 4, "`to` is excluded");
    // Only "sans suite": there is no rate to give even with five.
    let c2 = conn();
    for _ in 0..5 {
        let id = idea_on(&c2, 0);
        ideas::close(&c2, id, IdeaOutcome::NoFollowUp, None, at(1, 12)).unwrap();
    }
    assert_eq!(report::idea_outcomes(&c2, None, None).unwrap().success_rate, None);
    // An active idea is reported apart.
    assert_eq!(five.active_count, 0);
    idea_on(&c, 0);
    assert_eq!(report::idea_outcomes(&c, None, None).unwrap().active_count, 1);
}

// ---------------------------------------------------------------- alerte « sans analyse »

#[test]
fn the_no_analysis_alert_is_off_by_default_and_fires_for_a_trade_before_any_analysis() {
    let l = ledger(vec![trade(1, "105", true)]); // entered Tuesday 29 at 09:00
    let entry = MON + DAY + 9 * HOUR;
    let now = MON + DAY + 12 * HOUR;
    // Off: nothing, whatever the data.
    assert!(no_analysis::evaluate(&l, &[], now, 0, false).is_empty());
    // On, no analysis today: one warning, stable id, no blocking.
    let alerts = no_analysis::evaluate(&l, &[], now, 0, true);
    assert_eq!(alerts.len(), 1);
    let a = &alerts[0];
    assert_eq!((a.id.as_str(), a.message_key, a.trade_id, a.at, a.severity), ("noAnalysis:1:1", "noAnalysis", Some(1), entry, crate::alerts::Severity::Warning));
    // An analysis made before the trade: no alert. Made after: the trade was still taken without one.
    assert!(no_analysis::evaluate(&l, &[entry - MIN], now, 0, true).is_empty());
    assert!(no_analysis::evaluate(&l, &[entry], now, 0, true).is_empty(), "at the same instant counts as before");
    assert_eq!(no_analysis::evaluate(&l, &[entry + MIN], now, 0, true).len(), 1);
}

#[test]
fn the_no_analysis_alert_only_concerns_trades_entered_today() {
    let l = ledger(vec![trade(1, "105", true), trade(2, "105", true)]); // Tue 29 and Wed 30, 09:00
    // "Today" is Tuesday: only the first trade; a trade of tomorrow does not exist yet.
    let on_tuesday = no_analysis::evaluate(&l, &[], MON + DAY + 12 * HOUR, 0, true);
    assert_eq!(on_tuesday.iter().map(|a| a.trade_id).collect::<Vec<_>>(), [Some(1)]);
    // On Wednesday the Tuesday trade is history: no analysis required "outside the day".
    let on_wednesday = no_analysis::evaluate(&l, &[], MON + 2 * DAY + 12 * HOUR, 0, true);
    assert_eq!(on_wednesday.iter().map(|a| a.trade_id).collect::<Vec<_>>(), [Some(2)]);
    // Local day of the PC: at 23:30 UTC with UTC+2 it is already Wednesday.
    let late = no_analysis::evaluate(&l, &[], MON + DAY + 23 * HOUR + 30 * MIN, 120, true);
    assert!(late.is_empty(), "01:30 Wednesday local: Tuesday's trade is history and Wednesday's does not exist yet");
}

#[test]
fn the_no_analysis_alert_goes_through_active_alerts_and_the_setting_is_read_from_the_database() {
    let c = conn();
    let a = crate::test_support::account(&c, "10000");
    let eu = instrument(&c, "EURUSD", "100000");
    let now = MON + DAY + 12 * HOUR;
    crate::trades::create(&c, &crate::trades::TradeData::new(a, eu, Direction::Long, dec("1"), dec("1.1"), MON + DAY + 9 * HOUR)).unwrap();
    let kinds = |c: &Connection| crate::alerts::active_alerts(c, &[], now, 0).unwrap().into_iter().map(|x| x.message_key).collect::<Vec<_>>();
    assert!(!kinds(&c).contains(&"noAnalysis"), "off by default");
    review::set_settings(&c, &AnalysisSettings { stale_days: 7, no_analysis_alert: true }).unwrap();
    assert!(kinds(&c).contains(&"noAnalysis"));
    let id = format!("noAnalysis:{a}:1");
    crate::alerts::dismiss(&c, &id, now).unwrap();
    assert!(!kinds(&c).contains(&"noAnalysis"), "a dismissed alert does not come back");
    // With an analysis made before the trade, it would never have fired.
    let c2 = conn();
    let a2 = crate::test_support::account(&c2, "10000");
    let eu2 = instrument(&c2, "EURUSD", "100000");
    crate::trades::create(&c2, &crate::trades::TradeData::new(a2, eu2, Direction::Long, dec("1"), dec("1.1"), MON + DAY + 9 * HOUR)).unwrap();
    review::set_settings(&c2, &AnalysisSettings { stale_days: 7, no_analysis_alert: true }).unwrap();
    analysis_at(&c2, MON + DAY + 8 * HOUR, 0);
    assert!(!kinds(&c2).contains(&"noAnalysis"));
}

// ---------------------------------------------------------------- liens

#[test]
fn trade_links_are_replaced_as_a_whole_and_follow_the_trade_not_the_idea() {
    let c = conn();
    let a = crate::test_support::account(&c, "10000");
    let eu = instrument(&c, "EURUSD", "100000");
    let t = crate::trades::create(&c, &crate::trades::TradeData::new(a, eu, Direction::Long, dec("1"), dec("1.1"), MON)).unwrap().id;
    let idea = idea_on(&c, 0);
    let second = idea_on(&c, 0);
    let an = analysis_at(&c, MON, 0);
    let got = links::set(&c, t, &[idea, second, idea], &[an.id]).unwrap();
    assert_eq!((got.ideas.len(), got.analyses.len()), (2, 1));
    assert_eq!(got.ideas[0].symbol, "EURUSD");
    // Replacing removes what is absent; nothing is obligatory.
    assert_eq!(links::set(&c, t, &[second], &[]).unwrap().ideas.iter().map(|i| i.id).collect::<Vec<_>>(), [second]);
    assert!(links::set(&c, t, &[9999], &[]).is_err());
    assert!(links::set(&c, 9999, &[], &[]).is_err());
    assert_eq!(links::get(&c, t).unwrap().ideas.len(), 1, "a refused call changed nothing");
    links::set(&c, t, &[idea], &[an.id]).unwrap();
    // A closed idea stays linked and shows its outcome.
    ideas::close(&c, idea, IdeaOutcome::Worked, None, MON + DAY).unwrap();
    let l = links::get(&c, t).unwrap();
    assert_eq!((l.ideas[0].status, l.ideas[0].outcome), (IdeaStatus::Closed, Some(IdeaOutcome::Worked)));
    // Deleting the trade deletes the links, never the idea or the analysis.
    crate::trades::delete(&c, t).unwrap();
    let n = |sql: &str| -> i64 { c.query_row(sql, [], |r| r.get(0)).unwrap() };
    assert_eq!((n("SELECT COUNT(*) FROM trade_ideas"), n("SELECT COUNT(*) FROM trade_analyses")), (0, 0));
    assert_eq!((n("SELECT COUNT(*) FROM ideas"), n("SELECT COUNT(*) FROM analyses")), (2, 1));
}

#[test]
fn deleting_an_analysis_or_an_idea_removes_its_links_and_thread_only() {
    let c = conn();
    let a = crate::test_support::account(&c, "10000");
    let eu = instrument(&c, "EURUSD", "100000");
    let t = crate::trades::create(&c, &crate::trades::TradeData::new(a, eu, Direction::Long, dec("1"), dec("1.1"), MON)).unwrap().id;
    let idea = idea_on(&c, 0);
    review::complete(&c, idea, "Complément", at(1, 9), 0).unwrap();
    let an = analysis_at(&c, MON, 0);
    links::set(&c, t, &[idea], &[an.id]).unwrap();
    sessions::delete(&c, an.id).unwrap();
    ideas::delete(&c, idea).unwrap();
    let n = |sql: &str| -> i64 { c.query_row(sql, [], |r| r.get(0)).unwrap() };
    assert_eq!(n("SELECT COUNT(*) FROM analysis_answers") + n("SELECT COUNT(*) FROM idea_notes") + n("SELECT COUNT(*) FROM trade_ideas") + n("SELECT COUNT(*) FROM trade_analyses"), 0);
    assert_eq!(n("SELECT COUNT(*) FROM trades"), 1, "the trade is still there");
}

// ---------------------------------------------------------------- migration v15

#[test]
fn v15_keeps_existing_data_and_adds_the_seeded_questions() {
    let mut c = Connection::open_in_memory().unwrap();
    c.pragma_update(None, "foreign_keys", "ON").unwrap();
    crate::migrations::migrate_to(&mut c, 14).unwrap();
    let a = crate::test_support::account(&c, "10000");
    let eu = instrument(&c, "EURUSD", "100000");
    let trade = crate::trades::create(&c, &crate::trades::TradeData::new(a, eu, Direction::Long, dec("1"), dec("1.1"), MON)).unwrap();
    c.execute("INSERT INTO settings (key, value) VALUES ('news.enabled', 'on')", []).unwrap();
    c.execute("INSERT INTO economic_events (source, uid, starts_at, day, title, importance, updated_at) VALUES ('file','u',0,'2026-09-28','CPI','high',0)", []).unwrap();
    crate::migrations::migrate_to(&mut c, 15).unwrap();
    assert_eq!(crate::migrations::current_version(&c).unwrap(), 15);
    assert_eq!(crate::trades::get(&c, trade.id).unwrap().data.account_id, a);
    let n = |sql: &str| -> i64 { c.query_row(sql, [], |r| r.get(0)).unwrap() };
    assert_eq!(n("SELECT COUNT(*) FROM economic_events"), 1);
    assert_eq!(n("SELECT COUNT(*) FROM settings WHERE key = 'news.enabled'"), 1);
    assert_eq!(n("SELECT COUNT(*) FROM analysis_questions"), 13);
    assert_eq!((n("SELECT COUNT(*) FROM analyses"), n("SELECT COUNT(*) FROM ideas")), (0, 0));
    // The schema's guards, written straight to the tables.
    let bad = |sql: &str| c.execute(sql, []).is_err();
    assert!(bad("INSERT INTO analysis_questions (key, kind, position) VALUES ('x', 'nope', 99)"));
    assert!(bad("INSERT INTO analysis_questions (key, kind, position) VALUES ('trend', 'shortText', 99)"), "unique key");
    assert!(bad("INSERT INTO ideas (instrument_id, note, created_at, updated_at) VALUES (999, 'x', 0, 0)"), "unknown instrument");
    assert!(bad("INSERT INTO ideas (instrument_id, note, created_at, updated_at, level_low) VALUES (1, 'x', 0, 0, '1e5')"));
    assert!(bad("INSERT INTO ideas (instrument_id, note, created_at, updated_at, status) VALUES (1, 'x', 0, 0, 'closed')"), "closed needs an outcome");
    assert!(bad("INSERT INTO trade_ideas (trade_id, idea_id) VALUES (1, 1)"));
}
