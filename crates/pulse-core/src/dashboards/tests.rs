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
fn the_insights_widget_is_in_the_library_without_a_period_of_its_own() {
    // The insights engine (lot 19) works on fixed windows, so the widget follows the account but never a period.
    let d = catalog().into_iter().find(|d| d.kind == "insights").expect("insights widget");
    assert_eq!((d.category.as_str(), d.period, d.account, d.modes.len()), ("behavior", false, true, 0));
    let conn = db::open_in_memory().unwrap();
    validate(&conn, &[widget("insights", "insights", 0, 0, d.default_w, d.default_h)]).unwrap();
    // Smaller than its minimum is refused, like every other widget.
    assert!(is_invalid(validate(&conn, &[widget("insights", "insights", 0, 0, d.min_w - 1, d.min_h)])));
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

// --- Scope of a dashboard (3.8.9) ---------------------------------------------------------------

fn acct(conn: &Connection, name: &str, currency: &str) -> i64 {
    accounts::create(
        conn,
        &accounts::NewAccount { name: name.into(), kind: "prop".into(), broker: String::new(), currency: currency.into(), initial_capital: Default::default() },
    )
    .unwrap()
    .id
}

fn linked(id: i64) -> DashboardScope {
    DashboardScope { kind: ScopeKind::Account, account_id: Some(id) }
}

const ALL: DashboardScope = DashboardScope { kind: ScopeKind::All, account_id: None };

#[test]
fn a_new_dashboard_and_the_presets_follow_the_top_bar() {
    let conn = db::open_in_memory().unwrap();
    assert!(list(&conn).unwrap().iter().all(|d| d.scope == DashboardScope::FOLLOW));
    assert_eq!(get(&conn, ESSENTIAL).unwrap().scope, DashboardScope::FOLLOW);
    assert_eq!(save(&conn, None, "Mien", &simple()).unwrap().scope, DashboardScope::FOLLOW);
}

#[test]
fn the_scope_is_saved_read_back_and_kept_when_the_layout_is_saved_again() {
    let conn = db::open_in_memory().unwrap();
    let prop = acct(&conn, "Prop", "USD");
    let mine = save_scoped(&conn, None, "Prop suivi", Some(&linked(prop)), &simple()).unwrap();
    assert_eq!(mine.scope, linked(prop));
    assert_eq!(list(&conn).unwrap().last().unwrap().scope, linked(prop));
    // Saving the layout without a scope (the ordinary "Enregistrer") never changes the scope.
    let again = save(&conn, Some(&mine.key), "Prop suivi", &[]).unwrap();
    assert_eq!(again.scope, linked(prop));
    // Changing it is explicit.
    assert_eq!(set_scope(&conn, &mine.key, &ALL).unwrap().scope, ALL);
    assert_eq!(get(&conn, &mine.key).unwrap().scope, ALL);
    assert_eq!(set_scope(&conn, &mine.key, &DashboardScope::FOLLOW).unwrap().scope, DashboardScope::FOLLOW);
    // A copy of a preset saved with a scope carries it; the preset itself stays untouched.
    let copy = save_scoped(&conn, Some("preset:behavior"), "Comportement prop", Some(&linked(prop)), &simple()).unwrap();
    assert_eq!(copy.scope, linked(prop));
    assert_eq!(get(&conn, "preset:behavior").unwrap().scope, DashboardScope::FOLLOW);
}

#[test]
fn invalid_scopes_are_refused_and_write_nothing() {
    let conn = db::open_in_memory().unwrap();
    let prop = acct(&conn, "Prop", "USD");
    let mine = save(&conn, None, "Mien", &simple()).unwrap();
    for bad in [
        DashboardScope { kind: ScopeKind::Account, account_id: None },
        DashboardScope { kind: ScopeKind::All, account_id: Some(prop) },
        DashboardScope { kind: ScopeKind::Follow, account_id: Some(prop) },
    ] {
        assert!(is_invalid(set_scope(&conn, &mine.key, &bad)), "{bad:?}");
        assert!(is_invalid(save_scoped(&conn, None, "Autre", Some(&bad), &simple())), "{bad:?}");
    }
    assert!(matches!(set_scope(&conn, &mine.key, &linked(999)), Err(CoreError::NotFound(_))));
    assert!(is_invalid(set_scope(&conn, "preset:analysis", &ALL)), "a preset has no scope of its own");
    assert!(matches!(set_scope(&conn, "custom:404", &ALL), Err(CoreError::NotFound(_))));
    assert_eq!(list(&conn).unwrap().len(), 4, "nothing was created");
    assert_eq!(get(&conn, &mine.key).unwrap().scope, DashboardScope::FOLLOW);
}

#[test]
fn follow_reads_the_top_bar_all_reads_every_active_account_account_reads_its_own() {
    let conn = db::open_in_memory().unwrap();
    let a = acct(&conn, "Perso", "USD");
    let b = acct(&conn, "Prop", "USD");
    let follow = resolve_scope(&conn, &DashboardScope::FOLLOW, None).unwrap();
    assert_eq!((follow.effective, follow.account_ids.clone(), follow.accounts.len()), (ScopeKind::Follow, vec![], 2));
    let follow_b = resolve_scope(&conn, &DashboardScope::FOLLOW, Some(b)).unwrap();
    assert_eq!((follow_b.account_ids, follow_b.accounts.iter().map(|x| x.id).collect::<Vec<_>>()), (vec![b], vec![b]));
    // "All" ignores the top bar; a linked dashboard too.
    let all = resolve_scope(&conn, &ALL, Some(a)).unwrap();
    assert_eq!((all.effective, all.account_ids, all.accounts.len()), (ScopeKind::All, vec![], 2));
    let own = resolve_scope(&conn, &linked(b), Some(a)).unwrap();
    assert_eq!((own.effective, own.account_ids, own.currency.as_deref()), (ScopeKind::Account, vec![b], Some("USD")));
    assert!(own.notices.is_empty());
    // All ignores archived accounts.
    accounts::set_archived(&conn, a, true).unwrap();
    let all = resolve_scope(&conn, &ALL, None).unwrap();
    assert_eq!(all.accounts.iter().map(|x| x.id).collect::<Vec<_>>(), [b]);
}

#[test]
fn accounts_of_different_currencies_are_flagged_and_never_merged() {
    let conn = db::open_in_memory().unwrap();
    let usd = acct(&conn, "Dollars", "USD");
    let eur = acct(&conn, "Euros", "EUR");
    let all = resolve_scope(&conn, &ALL, None).unwrap();
    assert!(all.mixed_currency, "USD + EUR: no sum");
    let follow = resolve_scope(&conn, &DashboardScope::FOLLOW, None).unwrap();
    assert!(follow.mixed_currency);
    // One account, or two of the same currency, is fine.
    let one = resolve_scope(&conn, &linked(eur), None).unwrap();
    assert_eq!((one.mixed_currency, one.currency.as_deref()), (false, Some("EUR")));
    acct(&conn, "Euros 2", "EUR");
    accounts::set_archived(&conn, usd, true).unwrap();
    let all = resolve_scope(&conn, &ALL, None).unwrap();
    assert_eq!((all.mixed_currency, all.currency.as_deref(), all.accounts.len()), (false, Some("EUR"), 2));
    // No account at all: no currency, nothing mixed.
    let empty = db::open_in_memory().unwrap();
    let none = resolve_scope(&empty, &ALL, None).unwrap();
    assert_eq!((none.currency, none.mixed_currency, none.accounts.len()), (None, false, 0));
}

#[test]
fn a_widget_reads_its_own_account_then_the_dashboard_then_the_top_bar() {
    let conn = db::open_in_memory().unwrap();
    let prop = acct(&conn, "Prop", "USD");
    let perso = acct(&conn, "Perso", "USD");
    let eur = acct(&conn, "Euros", "EUR");
    let widgets = vec![
        widget("free", "capital", 0, 0, 10, 16),
        WidgetInstance { account_id: Some(perso), ..widget("pinned", "calendar", 10, 0, 13, 13) },
    ];
    // Follow: the free widget reads the top bar, the pinned one its account.
    let r = resolve(&conn, &DashboardScope::FOLLOW, &widgets, Some(prop)).unwrap();
    assert_eq!((r.widgets[0].source, r.widgets[0].account_ids.clone()), (ScopeSource::TopBar, vec![prop]));
    assert_eq!((r.widgets[1].source, r.widgets[1].account_ids.clone()), (ScopeSource::Widget, vec![perso]));
    // Linked dashboard: the top bar no longer matters; the widget's own account still wins.
    let r = resolve(&conn, &linked(prop), &widgets, Some(perso)).unwrap();
    assert_eq!((r.widgets[0].source, r.widgets[0].account_ids.clone()), (ScopeSource::Dashboard, vec![prop]));
    assert_eq!((r.widgets[1].source, r.widgets[1].account_ids.clone()), (ScopeSource::Widget, vec![perso]));
    // Consolidated dashboard with mixed currencies: the free widget is flagged, the pinned one is not.
    let r = resolve(&conn, &ALL, &widgets, None).unwrap();
    assert!(r.scope.mixed_currency && r.widgets[0].mixed_currency && !r.widgets[1].mixed_currency);
    assert_eq!(r.widgets[0].accounts.len(), 3);
    assert_eq!(r.widgets[1].currency.as_deref(), Some("USD"));
    let _ = eur;
}

#[test]
fn a_widget_pointing_at_a_missing_account_is_flagged_in_a_draft() {
    let conn = db::open_in_memory().unwrap();
    let draft = [WidgetInstance { account_id: Some(4242), ..widget("x", "calendar", 0, 0, 13, 13) }];
    let r = resolve(&conn, &DashboardScope::FOLLOW, &draft, None).unwrap();
    assert!(r.widgets[0].account_missing && r.widgets[0].accounts.is_empty());
}

#[test]
fn deleting_the_linked_account_keeps_the_dashboard_and_reads_the_top_bar_again() {
    let conn = db::open_in_memory().unwrap();
    let prop = acct(&conn, "Prop", "USD");
    let other = acct(&conn, "Autre", "USD");
    let mine = save_scoped(&conn, None, "Prop", Some(&linked(prop)), &simple()).unwrap();
    accounts::delete(&conn, prop).unwrap();
    let loaded = get(&conn, &mine.key).unwrap();
    assert_eq!(loaded.widgets.len(), 2, "the layout survives");
    assert_eq!(loaded.scope, DashboardScope { kind: ScopeKind::Account, account_id: None });
    let r = resolve_scope(&conn, &loaded.scope, Some(other)).unwrap();
    assert_eq!((r.declared, r.effective, r.account_ids), (ScopeKind::Account, ScopeKind::Follow, vec![other]));
    assert_eq!(r.notices, [ScopeNotice::AccountDeleted]);
    // Saving the layout again does not need to (and must not) touch the orphan scope; choosing a new one works.
    assert!(save(&conn, Some(&mine.key), "Prop", &simple()).is_ok());
    assert_eq!(set_scope(&conn, &mine.key, &linked(other)).unwrap().scope, linked(other));
}

#[test]
fn an_archived_linked_account_is_still_read_with_a_notice() {
    let conn = db::open_in_memory().unwrap();
    let old = acct(&conn, "Ancien", "USD");
    let mine = save_scoped(&conn, None, "Ancien", Some(&linked(old)), &simple()).unwrap();
    accounts::set_archived(&conn, old, true).unwrap();
    let r = resolve_scope(&conn, &mine.scope, None).unwrap();
    assert_eq!((r.effective, r.account_ids, r.accounts[0].archived), (ScopeKind::Account, vec![old], true));
    assert_eq!(r.notices, [ScopeNotice::AccountArchived]);
    // A new dashboard may be linked to an archived account, named explicitly.
    assert!(save_scoped(&conn, None, "Encore", Some(&linked(old)), &simple()).is_ok());
}

// --- Duplicating, exporting, importing (3.8.7) --------------------------------------------------

fn count(conn: &Connection) -> usize {
    list(conn).unwrap().len()
}

/// A dashboard using every kind of setting: a scope on an account, a pinned widget, a period, a mode.
fn rich(conn: &Connection, prop: i64) -> DashboardLayout {
    let widgets = vec![
        widget("a", "capital", 0, 0, 10, 16),
        WidgetInstance { account_id: Some(prop), ..widget("b", "calendar", 10, 0, 13, 13) },
        WidgetInstance { period: Some("1M".into()), mode: Some("expectancy".into()), ..widget("k", "kpi", 0, 16, 6, 6) },
        WidgetInstance { mode: Some("after".into()), ..widget("e", "emotions", 6, 16, 12, 18) },
    ];
    save_scoped(conn, None, "Prop firm", Some(&linked(prop)), &widgets).unwrap()
}

fn import_err(conn: &Connection, text: &str) -> String {
    let before = count(conn);
    let err = import_config(conn, text).expect_err("must be refused").to_string();
    assert_eq!(count(conn), before, "a refused import writes nothing: {text:.60}");
    err
}

#[test]
fn duplicate_copies_layout_settings_and_scope_without_touching_the_source() {
    let conn = db::open_in_memory().unwrap();
    let prop = acct(&conn, "Prop", "USD");
    let src = rich(&conn, prop);
    set_default(&conn, &src.key).unwrap();
    let copy = duplicate(&conn, &src.key, None).unwrap();
    assert_eq!(copy.name, "Prop firm (copie)");
    assert_eq!((copy.widgets.clone(), copy.scope.clone(), copy.builtin, copy.is_default), (src.widgets.clone(), linked(prop), false, false));
    assert_ne!(copy.key, src.key);
    assert_eq!(duplicate(&conn, &src.key, None).unwrap().name, "Prop firm (copie 2)");
    assert_eq!(get(&conn, &src.key).unwrap().widgets, src.widgets, "the source is untouched");
    assert_eq!(startup(&conn).unwrap().key, src.key, "the default is still the source");
    // The copy is independent: editing it does not change the source.
    save(&conn, Some(&copy.key), "Prop firm (copie)", &[]).unwrap();
    assert_eq!(get(&conn, &src.key).unwrap().widgets.len(), 4);
    // A name given by the user is used as is, and refused when taken.
    assert_eq!(duplicate(&conn, &src.key, Some(" Mon  départ ")).unwrap().name, "Mon départ");
    assert!(is_invalid(duplicate(&conn, &src.key, Some("mon départ"))));
    assert!(is_invalid(duplicate(&conn, &src.key, Some("Essentiel"))));
    assert!(matches!(duplicate(&conn, "custom:404", None), Err(CoreError::NotFound(_))));
}

#[test]
fn a_preset_can_be_duplicated_and_the_copy_edited() {
    let conn = db::open_in_memory().unwrap();
    let copy = duplicate(&conn, "preset:analysis", None).unwrap();
    assert_eq!((copy.name.as_str(), copy.builtin, copy.scope.clone()), ("Analyse (copie)", false, DashboardScope::FOLLOW));
    assert_eq!(copy.widgets, get(&conn, "preset:analysis").unwrap().widgets);
    assert!(save(&conn, Some(&copy.key), "Analyse (copie)", &simple()).is_ok());
    assert_eq!(get(&conn, "preset:analysis").unwrap().widgets.len(), 11, "the preset is untouched");
}

#[test]
fn a_copy_name_never_exceeds_the_limit_and_an_orphan_scope_becomes_follow() {
    let conn = db::open_in_memory().unwrap();
    let long = "x".repeat(MAX_NAME_CHARS);
    let src = save(&conn, None, &long, &simple()).unwrap();
    let copy = duplicate(&conn, &src.key, None).unwrap();
    assert!(copy.name.chars().count() <= MAX_NAME_CHARS && copy.name.ends_with(" (copie)"), "{}", copy.name);
    let prop = acct(&conn, "Prop", "USD");
    let linked_one = save_scoped(&conn, None, "Lié", Some(&linked(prop)), &simple()).unwrap();
    accounts::delete(&conn, prop).unwrap();
    assert_eq!(duplicate(&conn, &linked_one.key, None).unwrap().scope, DashboardScope::FOLLOW);
}

#[test]
fn the_exported_file_is_versioned_and_holds_no_id_of_this_database() {
    let conn = db::open_in_memory().unwrap();
    let prop = acct(&conn, "Prop", "USD");
    let src = rich(&conn, prop);
    let text = export_config(&conn, &src.key).unwrap();
    let v: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert_eq!((v["format"].as_str(), v["version"].as_u64(), v["name"].as_str()), (Some("pulse-dashboard"), Some(1), Some("Prop firm")));
    assert_eq!(v["scope"]["kind"], "account");
    assert_eq!(v["scope"]["account"], serde_json::json!({"name": "Prop", "currency": "USD"}));
    assert_eq!(v["widgets"].as_array().unwrap().len(), 4);
    assert!(!text.contains("accountId") && !text.contains("account_id") && !text.contains("custom:"));
    assert_eq!(export_config(&conn, &src.key).unwrap(), text, "exporting twice gives the same file");
    // A preset exports like any dashboard; an orphan scope is exported as "follow".
    assert!(export_config(&conn, ESSENTIAL).unwrap().contains("\"name\": \"Essentiel\""));
    accounts::delete(&conn, prop).unwrap();
    let orphan: serde_json::Value = serde_json::from_str(&export_config(&conn, &src.key).unwrap()).unwrap();
    assert_eq!((orphan["scope"]["kind"].as_str(), orphan["scope"]["account"].is_null()), (Some("follow"), true));
    assert!(orphan["widgets"].as_array().unwrap().iter().all(|w| w["account"].is_null()));
}

#[test]
fn export_then_import_gives_back_the_same_dashboard() {
    let conn = db::open_in_memory().unwrap();
    let prop = acct(&conn, "Prop", "USD");
    let src = rich(&conn, prop);
    let text = export_config(&conn, &src.key).unwrap();

    // Same database, the original still there: the copy is renamed, never overwriting it.
    let again = import_config(&conn, &text).unwrap();
    assert_eq!(again.warnings, [ImportWarning::Renamed { from: "Prop firm".into(), to: "Prop firm (importé)".into() }]);
    assert_eq!(again.layout.name, "Prop firm (importé)");
    assert_eq!((again.layout.widgets.clone(), again.layout.scope.clone()), (src.widgets.clone(), linked(prop)));
    assert!(!again.layout.builtin && !again.layout.is_default);
    assert_eq!(get(&conn, &src.key).unwrap(), DashboardLayout { is_default: false, ..src.clone() }, "the original is untouched");
    assert_eq!(import_config(&conn, &text).unwrap().layout.name, "Prop firm (importé 2)");
    // Exporting the import gives the same file, apart from the name.
    let re = export_config(&conn, &again.layout.key).unwrap().replace("Prop firm (importé)", "Prop firm");
    assert_eq!(re, text);

    // Original deleted: the very same name comes back, no warning at all.
    delete(&conn, &src.key).unwrap();
    let back = import_config(&conn, &text).unwrap();
    assert!(back.warnings.is_empty());
    assert_eq!((back.layout.name.as_str(), back.layout.widgets.clone(), back.layout.scope.clone()), ("Prop firm", src.widgets, linked(prop)));
}

#[test]
fn a_preset_survives_the_round_trip_under_another_name() {
    let conn = db::open_in_memory().unwrap();
    let text = export_config(&conn, "preset:behavior").unwrap();
    let r = import_config(&conn, &text).unwrap();
    assert_eq!(r.layout.name, "Comportement (importé)");
    assert_eq!(r.layout.widgets, get(&conn, "preset:behavior").unwrap().widgets);
    assert_eq!(r.warnings.len(), 1);
}

#[test]
fn accounts_are_found_by_name_and_currency_on_another_database() {
    let a = db::open_in_memory().unwrap();
    let prop_a = acct(&a, "Prop", "USD");
    let text = export_config(&a, &rich(&a, prop_a).key).unwrap();
    // Another PC: same account, other id, name written differently.
    let b = db::open_in_memory().unwrap();
    acct(&b, "Perso", "EUR");
    acct(&b, "Autre", "USD");
    let prop_b = acct(&b, "  prop ", "usd");
    let r = import_config(&b, &text).unwrap();
    assert!(r.warnings.is_empty(), "{:?}", r.warnings);
    assert_eq!(r.layout.scope, linked(prop_b));
    assert_eq!(r.layout.widgets.iter().find(|x| x.uid == "b").unwrap().account_id, Some(prop_b));
}

#[test]
fn unknown_accounts_go_back_to_the_global_account_with_a_warning() {
    let a = db::open_in_memory().unwrap();
    let prop_a = acct(&a, "Prop", "USD");
    let text = export_config(&a, &rich(&a, prop_a).key).unwrap();
    // No such account here; and a same-named account in another currency is not the same account.
    let b = db::open_in_memory().unwrap();
    acct(&b, "Prop", "EUR");
    let r = import_config(&b, &text).unwrap();
    assert_eq!(r.layout.scope, DashboardScope::FOLLOW);
    assert!(r.layout.widgets.iter().all(|w| w.account_id.is_none()));
    assert!(r.warnings.contains(&ImportWarning::UnknownScopeAccount { name: "Prop".into() }));
    assert!(r.warnings.contains(&ImportWarning::UnknownAccount { name: "Prop".into(), widget_kind: "calendar".into() }));
    assert_eq!(r.warnings.len(), 2);
    // The rest of the layout is intact.
    assert_eq!(r.layout.widgets.len(), 4);
    assert_eq!(r.layout.widgets.iter().find(|x| x.uid == "k").unwrap().period.as_deref(), Some("1M"));
    // Two accounts matching the same name and currency: no guessing.
    let c = db::open_in_memory().unwrap();
    acct(&c, "Prop", "USD");
    acct(&c, "prop", "USD");
    let r = import_config(&c, &text).unwrap();
    assert_eq!(r.layout.scope, DashboardScope::FOLLOW);
    assert_eq!(r.warnings.len(), 2);
}

fn file(widgets: &str) -> String {
    format!(r#"{{"format":"pulse-dashboard","version":1,"name":"Reçu","scope":{{"kind":"follow"}},"widgets":{widgets}}}"#)
}

#[test]
fn widgets_of_an_unknown_kind_are_ignored_and_reported() {
    let conn = db::open_in_memory().unwrap();
    let text = file(
        r#"[{"uid":"a","kind":"capital","x":0,"y":0,"w":10,"h":16},
            {"uid":"z","kind":"hologram","x":10,"y":0,"w":6,"h":6,"someFutureField":1},
            {"uid":"k","kind":"kpi","x":10,"y":0,"w":6,"h":6,"mode":"win_rate"}]"#,
    );
    let r = import_config(&conn, &text).unwrap();
    assert_eq!(r.layout.widgets.iter().map(|w| w.uid.as_str()).collect::<Vec<_>>(), ["a", "k"]);
    assert_eq!(r.warnings, [ImportWarning::UnknownWidget { kind: "hologram".into() }]);
    // Even a file made only of unknown widgets imports, as an empty dashboard.
    let only = import_config(&conn, &file(r#"[{"uid":"z","kind":"hologram","x":0,"y":0,"w":1,"h":1}]"#).replace("Reçu", "Vide")).unwrap();
    assert_eq!((only.layout.widgets.len(), only.warnings.len()), (0, 1));
}

#[test]
fn warnings_serialise_with_a_code_the_interface_can_translate() {
    let w = serde_json::to_value(ImportWarning::UnknownAccount { name: "Prop".into(), widget_kind: "kpi".into() }).unwrap();
    assert_eq!(w, serde_json::json!({"code": "unknownAccount", "name": "Prop", "widgetKind": "kpi"}));
    let w = serde_json::to_value(ImportWarning::Renamed { from: "A".into(), to: "B".into() }).unwrap();
    assert_eq!(w, serde_json::json!({"code": "renamed", "from": "A", "to": "B"}));
    assert_eq!(serde_json::to_value(ImportWarning::UnknownWidget { kind: "x".into() }).unwrap()["code"], "unknownWidget");
    assert_eq!(serde_json::to_value(ImportWarning::UnknownScopeAccount { name: "P".into() }).unwrap()["code"], "unknownScopeAccount");
}

#[test]
fn empty_corrupt_foreign_and_too_recent_files_are_refused_with_an_explicit_code() {
    let conn = db::open_in_memory().unwrap();
    save(&conn, None, "Déjà là", &simple()).unwrap();
    assert_eq!(import_err(&conn, ""), "invalid input: dashboard_import:empty");
    assert_eq!(import_err(&conn, " \n\t "), "invalid input: dashboard_import:empty");
    assert!(import_err(&conn, "{not json").starts_with("invalid input: dashboard_import:corrupt"));
    assert!(import_err(&conn, &file("[]")[..40]).starts_with("invalid input: dashboard_import:corrupt"), "a truncated file");
    for foreign in ["[]", "42", "null", r#"{"name":"x"}"#, r#"{"format":"other","version":1}"#] {
        assert_eq!(import_err(&conn, foreign), "invalid input: dashboard_import:not_a_dashboard", "{foreign}");
    }
    // A newer file says so, even though it carries fields this version has never heard of.
    let newer = r#"{"format":"pulse-dashboard","version":2,"name":"X","layout":{"tabs":[]},"scope":{"kind":"quantum"}}"#;
    assert_eq!(import_err(&conn, newer), "invalid input: dashboard_import:too_new:2");
    assert_eq!(import_err(&conn, r#"{"format":"pulse-dashboard","version":99999999999}"#), "invalid input: dashboard_import:too_new:99999999999");
    for bad_version in [r#""version":0"#, r#""version":"1""#, r#""version":1.5"#, r#""version":-1"#, r#""version":null"#] {
        let text = format!(r#"{{"format":"pulse-dashboard",{bad_version},"name":"X","scope":{{"kind":"follow"}},"widgets":[]}}"#);
        assert!(import_err(&conn, &text).contains("dashboard_import:corrupt"), "{bad_version}");
    }
    let no_version = r#"{"format":"pulse-dashboard","name":"X","scope":{"kind":"follow"},"widgets":[]}"#;
    assert!(import_err(&conn, no_version).contains("dashboard_import:corrupt"));
}

#[test]
fn a_file_with_missing_extra_or_wrongly_typed_fields_is_refused() {
    let conn = db::open_in_memory().unwrap();
    let wrap = |name: &str, scope: &str, widgets: &str| format!(r#"{{"format":"pulse-dashboard","version":1{name}{scope}{widgets}}}"#);
    let n = r#","name":"X""#;
    let s = r#","scope":{"kind":"follow"}"#;
    let w = r#","widgets":[]"#;
    for (label, text) in [
        ("no name", wrap("", s, w)),
        ("no scope", wrap(n, "", w)),
        ("no widgets", wrap(n, s, "")),
        ("name is a number", wrap(r#","name":7"#, s, w)),
        ("widgets is an object", wrap(n, s, r#","widgets":{}"#)),
        ("unknown top-level field", wrap(n, s, w) .replace("\"version\":1", "\"version\":1,\"extra\":true")),
        ("unknown scope kind", wrap(n, r#","scope":{"kind":"everywhere"}"#, w)),
        ("account scope without account", wrap(n, r#","scope":{"kind":"account"}"#, w)),
        ("follow scope with an account", wrap(n, r#","scope":{"kind":"follow","account":{"name":"P","currency":"USD"}}"#, w)),
        ("account without currency", wrap(n, r#","scope":{"kind":"account","account":{"name":"P"}}"#, w)),
        ("widget without kind", wrap(n, s, r#","widgets":[{"uid":"a","x":0,"y":0,"w":10,"h":16}]"#)),
        ("widget kind is a number", wrap(n, s, r#","widgets":[{"uid":"a","kind":3,"x":0,"y":0,"w":10,"h":16}]"#)),
        ("known widget without size", wrap(n, s, r#","widgets":[{"uid":"a","kind":"capital","x":0,"y":0}]"#)),
        ("known widget with a text coordinate", wrap(n, s, r#","widgets":[{"uid":"a","kind":"capital","x":"0","y":0,"w":10,"h":16}]"#)),
        ("known widget with an extra field", wrap(n, s, r#","widgets":[{"uid":"a","kind":"capital","x":0,"y":0,"w":10,"h":16,"accountId":1}]"#)),
        ("widget entry is not an object", wrap(n, s, r#","widgets":[7]"#)),
    ] {
        let err = import_err(&conn, &text);
        assert!(err.contains("dashboard_import:corrupt"), "{label}: {err}");
    }
}

#[test]
fn an_invalid_layout_is_refused_whole() {
    let conn = db::open_in_memory().unwrap();
    let cap = |uid: &str, x: i64, y: i64, w: i64, h: i64| format!(r#"{{"uid":"{uid}","kind":"capital","x":{x},"y":{y},"w":{w},"h":{h}}}"#);
    let too_many = format!("[{}]", (0..=MAX_WIDGETS).map(|i| cap(&format!("u{i}"), 0, i as i64 * 2, 7, 10)).collect::<Vec<_>>().join(","));
    for (label, widgets) in [
        ("overlap", format!("[{},{}]", cap("a", 0, 0, 10, 16), cap("b", 9, 0, 10, 16))),
        ("outside the grid", format!("[{}]", cap("a", 25, 0, 10, 16))),
        ("below the grid", format!("[{}]", cap("a", 0, 295, 10, 16))),
        ("negative", format!("[{}]", cap("a", -1, 0, 10, 16))),
        ("smaller than the minimum", format!("[{}]", cap("a", 0, 0, 2, 2))),
        ("same uid twice", format!("[{},{}]", cap("a", 0, 0, 10, 16), cap("a", 10, 0, 10, 16))),
        ("empty uid", format!("[{}]", cap("", 0, 0, 10, 16))),
        ("unknown mode", r#"[{"uid":"k","kind":"kpi","x":0,"y":0,"w":6,"h":6,"mode":"sharpe"}]"#.to_string()),
        ("mode on a widget without any", r#"[{"uid":"a","kind":"capital","x":0,"y":0,"w":10,"h":16,"mode":"x"}]"#.to_string()),
        ("unknown period", r#"[{"uid":"k","kind":"kpi","x":0,"y":0,"w":6,"h":6,"period":"2W"}]"#.to_string()),
        ("period on a widget without one", r#"[{"uid":"a","kind":"capital","x":0,"y":0,"w":10,"h":16,"period":"1M"}]"#.to_string()),
        ("too many widgets", too_many),
    ] {
        let err = import_err(&conn, &file(&widgets));
        assert!(err.contains("dashboard_import:invalid"), "{label}: {err}");
    }
    // One bad widget among good ones: nothing at all is written (import_err checks the count).
    let mixed = format!("[{},{}]", cap("a", 0, 0, 10, 16), cap("b", 5, 5, 10, 16));
    assert!(import_err(&conn, &file(&mixed)).contains("dashboard_import:invalid"));
}

#[test]
fn a_bad_name_is_refused_and_a_taken_one_is_renamed() {
    let conn = db::open_in_memory().unwrap();
    let named = |name: &str| file("[]").replace("Reçu", name);
    assert!(import_err(&conn, &named("   ")).contains("dashboard_import:invalid"));
    assert!(import_err(&conn, &named(&"x".repeat(MAX_NAME_CHARS + 1))).contains("dashboard_import:invalid"));
    // Case, spaces and presets all count as taken; the existing dashboards are never overwritten.
    let mine = save(&conn, None, "Mon suivi", &simple()).unwrap();
    for (given, expected) in [(" mon   SUIVI ", "mon SUIVI (importé)"), ("essentiel", "essentiel (importé)")] {
        let r = import_config(&conn, &named(given)).unwrap();
        assert_eq!(r.layout.name, expected);
        assert!(r.warnings.iter().any(|w| matches!(w, ImportWarning::Renamed { .. })));
    }
    assert_eq!(get(&conn, &mine.key).unwrap().widgets, mine.widgets);
    assert_eq!(get(&conn, ESSENTIAL).unwrap().name, "Essentiel");
    // A name at the limit still gets a suffix that fits.
    let long = "y".repeat(MAX_NAME_CHARS);
    import_config(&conn, &named(&long)).unwrap();
    let r = import_config(&conn, &named(&long)).unwrap();
    assert!(r.layout.name.chars().count() <= MAX_NAME_CHARS && r.layout.name.ends_with("(importé)"), "{}", r.layout.name);
}

#[test]
fn a_byte_order_mark_is_accepted() {
    let conn = db::open_in_memory().unwrap();
    let text = format!("\u{feff}{}", file("[]"));
    assert_eq!(import_config(&conn, &text).unwrap().layout.name, "Reçu");
}

#[test]
fn files_are_written_and_read_back_and_bad_files_are_refused() {
    let conn = db::open_in_memory().unwrap();
    let prop = acct(&conn, "Prop", "USD");
    let src = rich(&conn, prop);
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("dashboard.json");
    export_config_file(&conn, &src.key, &path).unwrap();
    let r = import_config_file(&conn, &path).unwrap();
    assert_eq!((r.layout.widgets, r.layout.scope), (src.widgets, linked(prop)));

    let before = count(&conn);
    let refuse = |bytes: &[u8]| {
        let p = dir.path().join("bad.json");
        std::fs::write(&p, bytes).unwrap();
        let e = import_config_file(&conn, &p).expect_err("refused").to_string();
        assert_eq!(count(&conn), before);
        e
    };
    assert_eq!(refuse(b""), "invalid input: dashboard_import:empty");
    assert!(refuse(&[0xff, 0xfe, 0x00, 0x9f]).contains("dashboard_import:corrupt"), "not UTF-8");
    assert!(refuse(br#"{"format":"pulse-dashboard","ver"#).contains("dashboard_import:corrupt"), "truncated");
    let huge = vec![b' '; MAX_FILE_BYTES as usize + 10];
    assert_eq!(refuse(&huge), "invalid input: dashboard_import:too_large");
    // A missing file is an error, not a panic, and writes nothing.
    assert!(matches!(import_config_file(&conn, &dir.path().join("absent.json")), Err(CoreError::Io(_))));
    assert_eq!(count(&conn), before);
    // Exporting into a folder that does not exist is an error too.
    assert!(matches!(export_config_file(&conn, &src.key, &dir.path().join("no/such/dir/x.json")), Err(CoreError::Io(_))));
    assert!(matches!(export_config_file(&conn, "custom:404", &path), Err(CoreError::NotFound(_))));
}

#[test]
fn the_default_dashboard_is_never_changed_by_an_import_or_a_copy() {
    let conn = db::open_in_memory().unwrap();
    let mine = save(&conn, None, "Mon suivi", &simple()).unwrap();
    set_default(&conn, &mine.key).unwrap();
    duplicate(&conn, &mine.key, None).unwrap();
    import_config(&conn, &export_config(&conn, &mine.key).unwrap()).unwrap();
    assert_eq!(startup(&conn).unwrap().key, mine.key);
}
