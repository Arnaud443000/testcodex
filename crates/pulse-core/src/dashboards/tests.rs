use super::*;
use crate::accounts;
use crate::db;
use crate::error::CoreError;
use crate::test_support::account;

fn widget(uid: &str, kind: &str, x: i64, y: i64, wd: i64, h: i64) -> WidgetInstance {
    w(uid, kind, x, y, wd, h)
}

fn simple() -> Vec<WidgetInstance> {
    vec![widget("a", "capital", 0, 0, 10, 16), widget("b", "calendar", 10, 0, 13, 13)]
}

fn is_invalid<T: std::fmt::Debug>(r: Result<T>) -> bool {
    matches!(r, Err(CoreError::Invalid(_)))
}

#[test]
fn library_has_unique_kinds_and_sane_sizes() {
    let cat = catalog();
    let kinds: HashSet<_> = cat.iter().map(|d| d.kind.as_str()).collect();
    assert_eq!(kinds.len(), cat.len(), "kinds are unique");
    for d in &cat {
        assert!(d.min_w >= 1 && d.min_h >= 1, "{}", d.kind);
        assert!(d.default_w >= d.min_w && d.default_h >= d.min_h, "{} default below its minimum", d.kind);
        assert!(d.default_w <= GRID_COLUMNS, "{} wider than the grid", d.kind);
    }
}

#[test]
fn every_preset_is_a_valid_layout_using_known_widgets() {
    let conn = db::open_in_memory().unwrap();
    for key in PRESET_KEYS {
        let (name, widgets) = preset(key).unwrap();
        assert!(!widgets.is_empty(), "{name}");
        validate(&conn, &widgets).unwrap_or_else(|e| panic!("{name}: {e}"));
    }
    // "Essentiel" is the dashboard the application always had: hero, capital, five KPIs, daily bars, calendar.
    let essential = get(&conn, ESSENTIAL).unwrap();
    assert_eq!((essential.name.as_str(), essential.builtin), ("Essentiel", true));
    let kinds: Vec<_> = essential.widgets.iter().map(|x| x.kind.as_str()).collect();
    assert_eq!(kinds, ["net_pnl_equity", "capital", "kpi", "kpi", "kpi", "kpi", "kpi", "daily_results", "calendar"]);
    let modes: Vec<_> = essential.widgets.iter().filter_map(|x| x.mode.as_deref()).collect();
    assert_eq!(modes, ["win_rate", "profit_factor", "expectancy", "risk_reward", "max_drawdown"]);
}

#[test]
fn a_fresh_database_starts_on_the_essential_preset() {
    let conn = db::open_in_memory().unwrap();
    let start = startup(&conn).unwrap();
    assert_eq!(start.key, ESSENTIAL);
    assert!(start.is_default);
    let all = list(&conn).unwrap();
    assert_eq!(all.iter().map(|d| d.name.as_str()).collect::<Vec<_>>(), ["Essentiel", "Comportement", "Analyse"]);
    assert!(all.iter().all(|d| d.builtin));
    assert_eq!(all.iter().filter(|d| d.is_default).count(), 1);
}

#[test]
fn save_then_load_keeps_positions_sizes_and_settings() {
    let conn = db::open_in_memory().unwrap();
    let acc = account(&conn, "1000");
    let mut widgets = simple();
    widgets.push(WidgetInstance {
        period: Some("1M".into()),
        account_id: Some(acc),
        mode: Some("after".into()),
        ..widget("e", "emotions", 0, 16, 12, 18)
    });
    let saved = save(&conn, None, "  Mon   suivi ", &widgets).unwrap();
    assert_eq!((saved.name.as_str(), saved.builtin, saved.is_default), ("Mon suivi", false, false));
    assert!(saved.key.starts_with("custom:"));
    let loaded = get(&conn, &saved.key).unwrap();
    assert_eq!(loaded, saved);
    let emotions = loaded.widgets.iter().find(|x| x.uid == "e").unwrap();
    assert_eq!((emotions.period.as_deref(), emotions.account_id, emotions.mode.as_deref()), (Some("1M"), Some(acc), Some("after")));
    assert_eq!((emotions.x, emotions.y, emotions.w, emotions.h), (0, 16, 12, 18));
    assert_eq!(list(&conn).unwrap().last().unwrap().widget_count, 3);
}

#[test]
fn layouts_survive_closing_and_reopening_the_database_file() {
    let dir = tempfile::tempdir().unwrap();
    let key = {
        let conn = db::open(dir.path()).unwrap();
        let saved = save(&conn, None, "Persistant", &simple()).unwrap();
        set_default(&conn, &saved.key).unwrap();
        saved.key
    };
    let conn = db::open(dir.path()).unwrap();
    let start = startup(&conn).unwrap();
    assert_eq!((start.key.as_str(), start.name.as_str(), start.widgets.len()), (key.as_str(), "Persistant", 2));
    assert!(start.is_default);
}

#[test]
fn saving_from_a_preset_creates_a_copy_and_never_touches_the_preset() {
    let conn = db::open_in_memory().unwrap();
    let before = get(&conn, ESSENTIAL).unwrap().widgets;
    let copy = save(&conn, Some(ESSENTIAL), "Essentiel perso", &simple()).unwrap();
    assert!(!copy.builtin);
    assert_eq!(get(&conn, ESSENTIAL).unwrap().widgets, before);
    assert_eq!(list(&conn).unwrap().len(), 4);
}

#[test]
fn saving_a_custom_key_replaces_its_widgets_and_name() {
    let conn = db::open_in_memory().unwrap();
    let first = save(&conn, None, "Un", &simple()).unwrap();
    let other = save(&conn, None, "Deux", &simple()).unwrap();
    let updated = save(&conn, Some(&first.key), "Un bis", &[widget("z", "risk", 0, 0, 15, 16)]).unwrap();
    assert_eq!((updated.key.as_str(), updated.name.as_str(), updated.widgets.len()), (first.key.as_str(), "Un bis", 1));
    assert_eq!(get(&conn, &other.key).unwrap().widgets.len(), 2, "other dashboards are independent");
    assert!(matches!(save(&conn, Some("custom:999"), "Fantôme", &simple()), Err(CoreError::NotFound(_))));
}

#[test]
fn an_empty_dashboard_is_allowed() {
    let conn = db::open_in_memory().unwrap();
    let saved = save(&conn, None, "Vide", &[]).unwrap();
    assert!(saved.widgets.is_empty());
}

#[test]
fn refuses_invalid_layouts_and_writes_nothing() {
    let conn = db::open_in_memory().unwrap();
    let bad: Vec<Vec<WidgetInstance>> = vec![
        vec![widget("a", "nope", 0, 0, 10, 10)],
        vec![widget("a", "capital", 0, 0, 10, 16), widget("a", "calendar", 10, 0, 13, 13)],
        vec![widget("a", "capital", 0, 0, 10, 16), widget("b", "calendar", 9, 0, 13, 13)],
        vec![widget("a", "capital", 21, 0, 10, 16)],
        vec![widget("a", "capital", -1, 0, 10, 16)],
        vec![widget("a", "capital", 0, 0, 1, 16)],
        vec![widget("a", "capital", 0, MAX_ROWS, 10, 16)],
        vec![widget("", "capital", 0, 0, 10, 16)],
        vec![WidgetInstance { mode: Some("nope".into()), ..widget("a", "kpi", 0, 0, 6, 6) }],
        vec![WidgetInstance { mode: Some("win_rate".into()), ..widget("a", "capital", 0, 0, 10, 16) }],
        vec![WidgetInstance { period: Some("2W".into()), ..widget("a", "kpi", 0, 0, 6, 6) }],
        vec![WidgetInstance { period: Some("1M".into()), ..widget("a", "capital", 0, 0, 10, 16) }],
        vec![WidgetInstance { account_id: Some(1), ..widget("a", "calendar", 0, 0, 13, 13) }],
    ];
    for layout in &bad {
        assert!(save(&conn, None, "Mauvais", layout).is_err(), "{layout:?}");
    }
    let mut too_many = Vec::new();
    for i in 0..=MAX_WIDGETS as i64 {
        too_many.push(widget(&format!("w{i}"), "kpi", (i % 5) * 6, (i / 5) * 6, 6, 6));
    }
    assert!(is_invalid(save(&conn, None, "Trop", &too_many)));
    assert_eq!(list(&conn).unwrap().len(), 3, "nothing was stored");
}

#[test]
fn touching_widgets_do_not_overlap() {
    let conn = db::open_in_memory().unwrap();
    let side_by_side = [widget("a", "capital", 0, 0, 10, 16), widget("b", "calendar", 10, 0, 13, 13), widget("c", "goals", 0, 16, 10, 14)];
    assert!(save(&conn, None, "Voisins", &side_by_side).is_ok());
}

#[test]
fn names_are_trimmed_unique_and_not_a_preset_name() {
    let conn = db::open_in_memory().unwrap();
    save(&conn, None, "Trading du matin", &simple()).unwrap();
    assert!(is_invalid(save(&conn, None, "  trading DU matin ", &simple())), "case and spaces do not make a new name");
    assert!(is_invalid(save(&conn, None, "essentiel", &simple())), "presets' names are reserved");
    assert!(is_invalid(save(&conn, None, "   ", &simple())));
    assert!(is_invalid(save(&conn, None, &"x".repeat(MAX_NAME_CHARS + 1), &simple())));
    assert!(save(&conn, None, &"x".repeat(MAX_NAME_CHARS), &simple()).is_ok());
}

#[test]
fn rename_and_delete_only_apply_to_custom_dashboards() {
    let conn = db::open_in_memory().unwrap();
    let a = save(&conn, None, "A", &simple()).unwrap();
    let b = save(&conn, None, "B", &simple()).unwrap();
    assert_eq!(rename(&conn, &a.key, "A2").unwrap().name, "A2");
    assert!(is_invalid(rename(&conn, &a.key, "b")), "taken by another dashboard");
    assert_eq!(rename(&conn, &a.key, "a2").unwrap().name, "a2", "keeping its own name (other case) is fine");
    assert!(is_invalid(rename(&conn, ESSENTIAL, "X")));
    assert!(is_invalid(delete(&conn, ESSENTIAL)));
    delete(&conn, &b.key).unwrap();
    assert!(matches!(get(&conn, &b.key), Err(CoreError::NotFound(_))));
    assert!(matches!(delete(&conn, &b.key), Err(CoreError::NotFound(_))));
    let widgets: i64 = conn.query_row("SELECT COUNT(*) FROM dashboard_widgets WHERE dashboard_id = 2", [], |r| r.get(0)).unwrap();
    assert_eq!(widgets, 0, "widgets leave with their dashboard");
    assert!(matches!(get(&conn, "junk"), Err(CoreError::NotFound(_))));
}

#[test]
fn the_default_dashboard_can_be_chosen_and_falls_back_when_deleted() {
    let conn = db::open_in_memory().unwrap();
    let mine = save(&conn, None, "Mon défaut", &simple()).unwrap();
    assert_eq!(startup(&conn).unwrap().key, ESSENTIAL);
    assert!(set_default(&conn, &mine.key).unwrap().is_default);
    assert_eq!(startup(&conn).unwrap().key, mine.key);
    assert_eq!(list(&conn).unwrap().iter().filter(|d| d.is_default).map(|d| d.key.clone()).collect::<Vec<_>>(), [mine.key.clone()]);
    // A preset can be the default too.
    set_default(&conn, "preset:behavior").unwrap();
    assert_eq!(startup(&conn).unwrap().name, "Comportement");
    set_default(&conn, &mine.key).unwrap();
    delete(&conn, &mine.key).unwrap();
    assert_eq!(startup(&conn).unwrap().key, ESSENTIAL, "a deleted default falls back to Essentiel");
    assert!(matches!(set_default(&conn, "custom:404"), Err(CoreError::NotFound(_))));
    assert!(matches!(set_default(&conn, "preset:zzz"), Err(CoreError::NotFound(_))));
}

#[test]
fn a_dangling_default_setting_falls_back_to_essential() {
    let conn = db::open_in_memory().unwrap();
    conn.execute("INSERT INTO settings (key, value) VALUES ('dashboard.default', 'custom:77')", []).unwrap();
    assert_eq!(startup(&conn).unwrap().key, ESSENTIAL);
    conn.execute("UPDATE settings SET value = 'garbage' WHERE key = 'dashboard.default'", []).unwrap();
    assert_eq!(startup(&conn).unwrap().key, ESSENTIAL);
}

#[test]
fn deleting_an_account_returns_its_widgets_to_the_global_account() {
    let conn = db::open_in_memory().unwrap();
    let acc = account(&conn, "500");
    let widgets = [WidgetInstance { account_id: Some(acc), ..widget("a", "calendar", 0, 0, 13, 13) }];
    let saved = save(&conn, None, "Un compte", &widgets).unwrap();
    accounts::delete(&conn, acc).unwrap();
    assert_eq!(get(&conn, &saved.key).unwrap().widgets[0].account_id, None);
}

#[test]
fn unknown_account_is_refused() {
    let conn = db::open_in_memory().unwrap();
    let widgets = [WidgetInstance { account_id: Some(9999), ..widget("a", "calendar", 0, 0, 13, 13) }];
    assert!(matches!(save(&conn, None, "X", &widgets), Err(CoreError::NotFound(_))));
}

#[test]
fn a_widget_from_a_future_version_is_still_read_back() {
    // `kind` has no SQL CHECK: a downgraded application must not fail to read a newer dashboard.
    let conn = db::open_in_memory().unwrap();
    let saved = save(&conn, None, "Futur", &simple()).unwrap();
    conn.execute(
        "INSERT INTO dashboard_widgets (dashboard_id, uid, kind, x, y, w, h) VALUES (1, 'n', 'brand_new', 0, 40, 5, 5)",
        [],
    )
    .unwrap();
    let loaded = get(&conn, &saved.key).unwrap();
    assert!(loaded.widgets.iter().any(|x| x.kind == "brand_new"));
}
