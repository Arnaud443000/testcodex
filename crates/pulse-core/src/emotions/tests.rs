use super::*;
use crate::behavior::emotion_report;
use crate::db;
use crate::stats::StatsQuery;
use crate::test_support::{account, dec, instrument};
use crate::trades::{self, Direction, EmotionEntry, EmotionMoment, TradeData};
use std::collections::HashSet;

const T0: i64 = 1_790_000_000_000;

/// Un trade clôturé (perdant de 10) qui porte l'émotion `tag_id` avant l'entrée.
fn closed_trade_with(conn: &Connection, tag_id: i64) -> i64 {
    let a = account(conn, "1000");
    let i = instrument(conn, "TEST", "1");
    let mut t = TradeData::new(a, i, Direction::Long, dec("1"), dec("100"), T0);
    t.exit_price = Some(dec("90"));
    t.exit_time = Some(T0 + 3_600_000);
    t.emotions = vec![EmotionEntry { moment: EmotionMoment::Before, tag_id }];
    trades::create(conn, &t).unwrap().id
}

fn names(conn: &Connection) -> Vec<String> {
    tags::list(conn, Some(TagKind::Emotion), false).unwrap().into_iter().map(|t| t.name).collect()
}

#[test]
fn the_catalog_is_grouped_without_internal_duplicates() {
    let groups = catalog();
    assert!(groups.len() >= 6);
    let all: Vec<String> = groups.iter().flat_map(|g| g.emotions.clone()).collect();
    assert!(all.len() >= 40);
    let keys: HashSet<String> = all.iter().map(|n| crate::util::name_key(n)).collect();
    assert_eq!(keys.len(), all.len(), "a catalog emotion appears twice");
    assert!(groups.iter().all(|g| !g.key.is_empty() && !g.label.is_empty() && !g.emotions.is_empty()));
    assert!(all.iter().all(|n| n.chars().count() <= MAX_NAME_CHARS));
    // Les émotions semées par défaut sont toutes dans le catalogue (mêmes noms).
    let conn = db::open_in_memory().unwrap();
    for n in names(&conn) {
        assert!(keys.contains(&crate::util::name_key(&n)), "{n} missing from the catalog");
    }
}

#[test]
fn adding_from_the_catalog_creates_the_tag_once() {
    let conn = db::open_in_memory().unwrap();
    assert!(!names(&conn).contains(&"Avidité".to_string()));
    let tag = add_to_list(&conn, "Avidité").unwrap();
    assert!(!tag.archived && tag.kind == TagKind::Emotion);
    assert!(names(&conn).contains(&"Avidité".to_string()));
    // Already in the list (other case and spacing): same tag, no duplicate.
    assert_eq!(add_to_list(&conn, "  avidité ").unwrap().id, tag.id);
    let count = |conn: &Connection| tags::list(conn, Some(TagKind::Emotion), true).unwrap().len();
    let before = count(&conn);
    add_to_list(&conn, "AVIDITÉ").unwrap();
    assert_eq!(count(&conn), before);
}

#[test]
fn adding_an_archived_emotion_reactivates_it_without_duplicate() {
    let conn = db::open_in_memory().unwrap();
    let calm = tags::find(&conn, TagKind::Emotion, "calme").unwrap().unwrap();
    remove_from_list(&conn, calm.id).unwrap();
    assert!(!names(&conn).contains(&"Calme".to_string()));
    let back = add_to_list(&conn, "calme").unwrap();
    assert_eq!(back.id, calm.id);
    assert!(!back.archived);
    assert_eq!(tags::list(&conn, Some(TagKind::Emotion), true).unwrap().iter().filter(|t| t.name == "Calme").count(), 1);
}

#[test]
fn free_entries_are_validated() {
    let conn = db::open_in_memory().unwrap();
    assert!(add_to_list(&conn, "   ").is_err());
    assert!(add_to_list(&conn, &"x".repeat(MAX_NAME_CHARS + 1)).is_err());
    assert_eq!(add_to_list(&conn, &"é".repeat(MAX_NAME_CHARS)).unwrap().name.chars().count(), MAX_NAME_CHARS);
    assert_eq!(add_to_list(&conn, "  Mon   humeur ").unwrap().name, "Mon humeur");
}

#[test]
fn removing_archives_and_leaves_trades_and_statistics_untouched() {
    let conn = db::open_in_memory().unwrap();
    let doubt = tags::find(&conn, TagKind::Emotion, "doute").unwrap().unwrap();
    let trade_id = closed_trade_with(&conn, doubt.id);
    let query = StatsQuery::default();
    let before = emotion_report(&conn, &query).unwrap();
    assert!(before.any.iter().any(|s| s.label == "Doute" && s.summary.trade_count == 1));

    let removed = remove_from_list(&conn, doubt.id).unwrap();
    assert!(removed.archived);
    assert!(!names(&conn).contains(&"Doute".to_string()));
    // The tag row is still there, the trade keeps its emotion, statistics identical.
    assert!(tags::get(&conn, doubt.id).is_ok());
    assert_eq!(trades::get(&conn, trade_id).unwrap().data.emotions, vec![EmotionEntry { moment: EmotionMoment::Before, tag_id: doubt.id }]);
    assert_eq!(emotion_report(&conn, &query).unwrap(), before);
}

#[test]
fn only_emotions_can_be_removed_or_deleted_here() {
    let conn = db::open_in_memory().unwrap();
    let setup = tags::create(&conn, TagKind::Setup, "Breakout").unwrap();
    assert!(remove_from_list(&conn, setup.id).is_err());
    assert!(delete_unused(&conn, setup.id).is_err());
    assert!(!tags::get(&conn, setup.id).unwrap().archived);
    assert!(remove_from_list(&conn, 99_999).is_err());
}

#[test]
fn deleting_is_refused_when_used_and_allowed_otherwise() {
    let conn = db::open_in_memory().unwrap();
    let used = tags::find(&conn, TagKind::Emotion, "stress").unwrap().unwrap();
    closed_trade_with(&conn, used.id);
    let unused = add_to_list(&conn, "Sérénité").unwrap();

    let usage = usage(&conn).unwrap();
    let count = |id| usage.iter().find(|u| u.tag_id == id).unwrap().trade_count;
    assert_eq!(count(used.id), 1);
    assert_eq!(count(unused.id), 0);

    let err = delete_unused(&conn, used.id).unwrap_err().to_string();
    assert!(err.contains("Stress") && err.contains("remove it from the list"), "{err}");
    assert!(tags::get(&conn, used.id).is_ok());

    delete_unused(&conn, unused.id).unwrap();
    assert!(tags::get(&conn, unused.id).is_err());
    // Once deleted, the name is free again in the catalog.
    assert!(add_to_list(&conn, "Sérénité").is_ok());
}

#[test]
fn an_archived_unused_emotion_can_be_deleted_and_the_default_ones_survive_removal() {
    let conn = db::open_in_memory().unwrap();
    let before = names(&conn);
    let t = add_to_list(&conn, "Temporaire").unwrap();
    remove_from_list(&conn, t.id).unwrap();
    delete_unused(&conn, t.id).unwrap();
    assert_eq!(names(&conn), before);
}
