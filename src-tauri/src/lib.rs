use pulse_core::accounts::{self, Account, AccountUpdate, NewAccount};
use pulse_core::alerts::{self, Alert, AlertRecord, AlertSettings};
use pulse_core::behavior::{
    self, DisciplineReport, EmotionReport, FirstTradeReport, MistakeReport, PatternReport, PlanReport, RuleAdherenceReport,
    StreakReport, TradeDiscipline,
};
use pulse_core::cash_flows::{self, CashFlow, NewCashFlow};
use pulse_core::dashboards::{self, DashboardLayout, DashboardScope, DashboardSummary, ImportResult, ResolvedDashboard, WidgetDefinition, WidgetInstance};
use pulse_core::confidence::{self, ConfidenceReport};
use pulse_core::execution_quality::{self, ExecutionScore, QualityReport};
use pulse_core::journal::{self, DayOverview, JournalEntry};
use pulse_core::missed_trades::{self, MissedTrade, MissedTradeData};
use pulse_core::period::PeriodQuery;
use pulse_core::reminder::{self, ReminderSettings};
use pulse_core::backup::{self, BackupInfo, RestoreResult};
use pulse_core::checklist::{self, ChecklistItem};
use pulse_core::export;
use pulse_core::goals::{self, Goal, GoalProgress, NewGoal, ProgressQuery};
use pulse_core::replay::{self, ReplayCard, ReplayFilter, ReplayItem};
use pulse_core::instruments::{self, Instrument, NewInstrument};
use pulse_core::rules::{self, Rule};
use pulse_core::settings::{self, BehaviorSettings};
use pulse_core::stats::StatsQuery;
use pulse_core::stats::dashboard::{self, Calendar, CalendarQuery, Dashboard, DashboardQuery, DayTrade};
use pulse_core::stats::distribution::{self, Heatmap, LongShort, RDistribution};
use pulse_core::stats::risk::{self, RiskReport};
use pulse_core::tags::{self, Tag, TagKind};
use pulse_core::trade_view::{self, Preview, TradeView};
use pulse_core::trades::{self, TradeData, TradeFilter};
use pulse_core::{db, migrations, rusqlite::Connection, screenshots};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Manager, State};

struct AppState {
    db: Mutex<Connection>,
    data_dir: PathBuf,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AppInfo {
    version: String,
    data_dir: String,
    schema_version: u32,
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

#[tauri::command]
fn app_info(state: State<AppState>, app: tauri::AppHandle) -> Result<AppInfo, String> {
    let conn = state.db.lock().map_err(err)?;
    Ok(AppInfo {
        version: app.package_info().version.to_string(),
        data_dir: state.data_dir.to_string_lossy().into_owned(),
        schema_version: migrations::current_version(&conn).map_err(err)?,
    })
}

#[tauri::command]
fn list_accounts(state: State<AppState>) -> Result<Vec<Account>, String> {
    let conn = state.db.lock().map_err(err)?;
    accounts::list(&conn).map_err(err)
}

#[tauri::command]
fn create_account(state: State<AppState>, account: NewAccount) -> Result<Account, String> {
    let conn = state.db.lock().map_err(err)?;
    accounts::create(&conn, &account).map_err(err)
}

#[tauri::command]
fn delete_account(state: State<AppState>, id: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(err)?;
    accounts::delete(&conn, id).map_err(err)
}

// Thin commands: every rule and every figure lives in pulse-core.

#[tauri::command]
fn list_instruments(state: State<AppState>) -> Result<Vec<Instrument>, String> {
    let conn = state.db.lock().map_err(err)?;
    instruments::list(&conn).map_err(err)
}

#[tauri::command]
fn create_instrument(state: State<AppState>, instrument: NewInstrument) -> Result<Instrument, String> {
    let conn = state.db.lock().map_err(err)?;
    instruments::create(&conn, &instrument).map_err(err)
}

#[tauri::command]
fn list_tags(state: State<AppState>, kind: Option<TagKind>, include_archived: Option<bool>) -> Result<Vec<Tag>, String> {
    let conn = state.db.lock().map_err(err)?;
    tags::list(&conn, kind, include_archived.unwrap_or(false)).map_err(err)
}

#[tauri::command]
fn create_tag(state: State<AppState>, kind: TagKind, name: String) -> Result<Tag, String> {
    let conn = state.db.lock().map_err(err)?;
    tags::create(&conn, kind, &name).map_err(err)
}

#[tauri::command]
fn list_rules(state: State<AppState>, include_archived: Option<bool>) -> Result<Vec<Rule>, String> {
    let conn = state.db.lock().map_err(err)?;
    rules::list(&conn, include_archived.unwrap_or(false)).map_err(err)
}

#[tauri::command]
fn create_rule(state: State<AppState>, text: String) -> Result<Rule, String> {
    let conn = state.db.lock().map_err(err)?;
    rules::create(&conn, &text).map_err(err)
}

#[tauri::command]
fn rename_rule(state: State<AppState>, id: i64, text: String) -> Result<Rule, String> {
    let conn = state.db.lock().map_err(err)?;
    rules::update_text(&conn, id, &text).map_err(err)
}

#[tauri::command]
fn set_rule_archived(state: State<AppState>, id: i64, archived: bool) -> Result<Rule, String> {
    let conn = state.db.lock().map_err(err)?;
    rules::set_archived(&conn, id, archived).map_err(err)
}

#[tauri::command]
fn list_checklist(state: State<AppState>, include_archived: Option<bool>) -> Result<Vec<ChecklistItem>, String> {
    let conn = state.db.lock().map_err(err)?;
    checklist::list(&conn, include_archived.unwrap_or(false)).map_err(err)
}

#[tauri::command]
fn create_checklist_item(state: State<AppState>, label: String) -> Result<ChecklistItem, String> {
    let conn = state.db.lock().map_err(err)?;
    checklist::create(&conn, &label).map_err(err)
}

#[tauri::command]
fn rename_checklist_item(state: State<AppState>, id: i64, label: String) -> Result<ChecklistItem, String> {
    let conn = state.db.lock().map_err(err)?;
    checklist::rename(&conn, id, &label).map_err(err)
}

#[tauri::command]
fn set_checklist_item_archived(state: State<AppState>, id: i64, archived: bool) -> Result<ChecklistItem, String> {
    let conn = state.db.lock().map_err(err)?;
    checklist::set_archived(&conn, id, archived).map_err(err)
}

/// Deposits and withdrawals of one account, oldest first. They never count as performance.
#[tauri::command]
fn list_cash_flows(state: State<AppState>, account_id: i64) -> Result<Vec<CashFlow>, String> {
    let conn = state.db.lock().map_err(err)?;
    cash_flows::list(&conn, &[account_id]).map_err(err)
}

#[tauri::command]
fn create_cash_flow(state: State<AppState>, cash_flow: NewCashFlow) -> Result<CashFlow, String> {
    let conn = state.db.lock().map_err(err)?;
    cash_flows::create(&conn, &cash_flow).map_err(err)
}

#[tauri::command]
fn delete_cash_flow(state: State<AppState>, id: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(err)?;
    cash_flows::delete(&conn, id).map_err(err)
}

#[tauri::command]
fn list_trades(state: State<AppState>, filter: Option<TradeFilter>) -> Result<Vec<TradeView>, String> {
    let conn = state.db.lock().map_err(err)?;
    trade_view::list(&conn, &filter.unwrap_or_default()).map_err(err)
}

#[tauri::command]
fn get_trade(state: State<AppState>, id: i64) -> Result<TradeView, String> {
    let conn = state.db.lock().map_err(err)?;
    trade_view::get(&conn, id).map_err(err)
}

#[tauri::command]
fn create_trade(state: State<AppState>, trade: TradeData) -> Result<TradeView, String> {
    let conn = state.db.lock().map_err(err)?;
    let saved = trades::create(&conn, &trade).map_err(err)?;
    record_alerts_after_save(&conn, saved.data.account_id);
    trade_view::get(&conn, saved.id).map_err(err)
}

#[tauri::command]
fn update_trade(state: State<AppState>, id: i64, trade: TradeData) -> Result<TradeView, String> {
    let conn = state.db.lock().map_err(err)?;
    trades::update(&conn, id, &trade).map_err(err)?;
    record_alerts_after_save(&conn, trade.account_id);
    trade_view::get(&conn, id).map_err(err)
}

#[tauri::command]
fn delete_trade(state: State<AppState>, id: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(err)?;
    trades::delete(&conn, id).map_err(err)
}

/// Live figures for the entry form, computed by pulse-core.
#[tauri::command]
fn preview_trade(state: State<AppState>, trade: TradeData) -> Result<Preview, String> {
    let conn = state.db.lock().map_err(err)?;
    trade_view::preview(&conn, &trade).map_err(err)
}

/// Dashboard of one period against the previous one, computed by pulse-core.
#[tauri::command]
fn get_dashboard(state: State<AppState>, query: DashboardQuery) -> Result<Dashboard, String> {
    let conn = state.db.lock().map_err(err)?;
    dashboard::dashboard(&conn, &query).map_err(err)
}

#[tauri::command]
fn get_calendar(state: State<AppState>, query: CalendarQuery) -> Result<Calendar, String> {
    let conn = state.db.lock().map_err(err)?;
    dashboard::calendar(&conn, &query).map_err(err)
}

#[tauri::command]
fn get_day_trades(state: State<AppState>, account_ids: Vec<i64>, day: String) -> Result<Vec<DayTrade>, String> {
    let conn = state.db.lock().map_err(err)?;
    dashboard::day_trades(&conn, &account_ids, &day).map_err(err)
}

// Behavioural analysis (lot 8): one command per report, all computed by pulse-core.

#[tauri::command]
fn get_behavior_settings(state: State<AppState>) -> Result<BehaviorSettings, String> {
    let conn = state.db.lock().map_err(err)?;
    settings::behavior(&conn).map_err(err)
}

#[tauri::command]
fn set_behavior_settings(state: State<AppState>, settings: BehaviorSettings) -> Result<BehaviorSettings, String> {
    let conn = state.db.lock().map_err(err)?;
    settings::set_behavior(&conn, &settings).map_err(err)
}

#[tauri::command]
fn get_discipline(state: State<AppState>, query: StatsQuery) -> Result<DisciplineReport, String> {
    let conn = state.db.lock().map_err(err)?;
    behavior::discipline_report(&conn, &query).map_err(err)
}

#[tauri::command]
fn get_trade_discipline(state: State<AppState>, id: i64) -> Result<TradeDiscipline, String> {
    let conn = state.db.lock().map_err(err)?;
    behavior::trade_discipline(&conn, id).map_err(err)
}

#[tauri::command]
fn get_emotions(state: State<AppState>, query: StatsQuery) -> Result<EmotionReport, String> {
    let conn = state.db.lock().map_err(err)?;
    behavior::emotion_report(&conn, &query).map_err(err)
}

#[tauri::command]
fn get_streaks(state: State<AppState>, query: StatsQuery) -> Result<StreakReport, String> {
    let conn = state.db.lock().map_err(err)?;
    behavior::streak_report(&conn, &query).map_err(err)
}

#[tauri::command]
fn get_plan_comparison(state: State<AppState>, query: StatsQuery) -> Result<PlanReport, String> {
    let conn = state.db.lock().map_err(err)?;
    behavior::plan_report(&conn, &query).map_err(err)
}

#[tauri::command]
fn get_first_trade(state: State<AppState>, query: StatsQuery) -> Result<FirstTradeReport, String> {
    let conn = state.db.lock().map_err(err)?;
    behavior::first_trade_report(&conn, &query).map_err(err)
}

#[tauri::command]
fn get_mistakes(state: State<AppState>, query: StatsQuery) -> Result<MistakeReport, String> {
    let conn = state.db.lock().map_err(err)?;
    behavior::mistake_report(&conn, &query).map_err(err)
}

#[tauri::command]
fn get_rule_adherence(state: State<AppState>, query: StatsQuery) -> Result<RuleAdherenceReport, String> {
    let conn = state.db.lock().map_err(err)?;
    behavior::rule_adherence_report(&conn, &query).map_err(err)
}

#[tauri::command]
fn get_patterns(state: State<AppState>, query: StatsQuery) -> Result<PatternReport, String> {
    let conn = state.db.lock().map_err(err)?;
    behavior::pattern_report(&conn, &query).map_err(err)
}

#[tauri::command]
fn get_r_distribution(state: State<AppState>, query: StatsQuery) -> Result<RDistribution, String> {
    let conn = state.db.lock().map_err(err)?;
    distribution::r_distribution_report(&conn, &query).map_err(err)
}

#[tauri::command]
fn get_heatmap(state: State<AppState>, query: StatsQuery) -> Result<Heatmap, String> {
    let conn = state.db.lock().map_err(err)?;
    distribution::heatmap_report(&conn, &query).map_err(err)
}

#[tauri::command]
fn get_long_short(state: State<AppState>, query: StatsQuery) -> Result<LongShort, String> {
    let conn = state.db.lock().map_err(err)?;
    distribution::long_short_report(&conn, &query).map_err(err)
}

#[tauri::command]
fn get_risk(state: State<AppState>, query: StatsQuery) -> Result<RiskReport, String> {
    let conn = state.db.lock().map_err(err)?;
    risk::risk_report(&conn, &query).map_err(err)
}

/// `image` is the file as base64 (a `data:` URL is accepted); returns the relative path to store on the trade.
#[tauri::command]
fn save_screenshot(state: State<AppState>, image: String) -> Result<String, String> {
    screenshots::save_base64(&state.data_dir, &image).map_err(err)
}

#[tauri::command]
fn read_screenshot(state: State<AppState>, path: String) -> Result<String, String> {
    screenshots::read_data_url(&state.data_dir, &path).map_err(err)
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Writes every trade of the given accounts (all when empty) to a CSV file; returns the trade count.
#[tauri::command]
fn export_trades_csv(state: State<AppState>, account_ids: Vec<i64>, path: String) -> Result<usize, String> {
    let conn = state.db.lock().map_err(err)?;
    let filter = TradeFilter { account_ids, ..Default::default() };
    export::write_trades_csv(&conn, &filter, std::path::Path::new(&path)).map_err(err)
}

#[tauri::command]
fn create_backup(state: State<AppState>, dest_dir: String) -> Result<BackupInfo, String> {
    let conn = state.db.lock().map_err(err)?;
    backup::create(&conn, &state.data_dir, std::path::Path::new(&dest_dir), now_ms()).map_err(err)
}

#[tauri::command]
fn inspect_backup(folder: String) -> Result<BackupInfo, String> {
    backup::inspect(std::path::Path::new(&folder)).map_err(err)
}

#[tauri::command]
fn restore_backup(state: State<AppState>, folder: String, confirmed: bool) -> Result<RestoreResult, String> {
    let mut conn = state.db.lock().map_err(err)?;
    backup::restore(&mut conn, &state.data_dir, std::path::Path::new(&folder), confirmed, now_ms()).map_err(err)
}

// --- Lot 10: journal side (missed trades, daily journal, execution quality, confidence, reminder) ---

#[tauri::command]
fn list_missed_trades(state: State<AppState>, account_ids: Vec<i64>) -> Result<Vec<MissedTrade>, String> {
    let conn = state.db.lock().map_err(err)?;
    missed_trades::list(&conn, &account_ids).map_err(err)
}

#[tauri::command]
fn create_missed_trade(state: State<AppState>, missed: MissedTradeData) -> Result<MissedTrade, String> {
    let conn = state.db.lock().map_err(err)?;
    missed_trades::create(&conn, &missed).map_err(err)
}

#[tauri::command]
fn update_missed_trade(state: State<AppState>, id: i64, missed: MissedTradeData) -> Result<MissedTrade, String> {
    let conn = state.db.lock().map_err(err)?;
    missed_trades::update(&conn, id, &missed).map_err(err)
}

#[tauri::command]
fn delete_missed_trade(state: State<AppState>, id: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(err)?;
    missed_trades::delete(&conn, id).map_err(err)
}

/// A blank entry deletes the day's entry and returns `null`.
#[tauri::command]
fn save_journal_entry(state: State<AppState>, entry: JournalEntry) -> Result<Option<JournalEntry>, String> {
    let conn = state.db.lock().map_err(err)?;
    journal::save(&conn, &entry).map_err(err)
}

#[tauri::command]
fn get_journal_day(state: State<AppState>, account_ids: Vec<i64>, day: String) -> Result<DayOverview, String> {
    let conn = state.db.lock().map_err(err)?;
    journal::day_overview(&conn, &account_ids, &day).map_err(err)
}

#[tauri::command]
fn list_journal_entries(state: State<AppState>, from: Option<String>, to: Option<String>) -> Result<Vec<JournalEntry>, String> {
    let conn = state.db.lock().map_err(err)?;
    journal::list(&conn, from.as_deref(), to.as_deref()).map_err(err)
}

#[tauri::command]
fn delete_journal_entry(state: State<AppState>, day: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(err)?;
    journal::delete(&conn, &day).map_err(err)
}

/// Execution-quality score of a stored trade (spec 3.2.9).
#[tauri::command]
fn get_execution_score(state: State<AppState>, trade_id: i64) -> Result<ExecutionScore, String> {
    let conn = state.db.lock().map_err(err)?;
    let trade = trades::get(&conn, trade_id).map_err(err)?;
    Ok(execution_quality::score(&trade.data))
}

#[tauri::command]
fn get_quality_report(state: State<AppState>, query: PeriodQuery) -> Result<QualityReport, String> {
    let conn = state.db.lock().map_err(err)?;
    execution_quality::report(&conn, &query).map_err(err)
}

#[tauri::command]
fn get_confidence_report(state: State<AppState>, query: PeriodQuery) -> Result<ConfidenceReport, String> {
    let conn = state.db.lock().map_err(err)?;
    confidence::report(&conn, &query).map_err(err)
}

#[tauri::command]
fn get_reminder_settings(state: State<AppState>) -> Result<ReminderSettings, String> {
    let conn = state.db.lock().map_err(err)?;
    reminder::get_settings(&conn).map_err(err)
}

#[tauri::command]
fn set_reminder_settings(state: State<AppState>, settings: ReminderSettings) -> Result<ReminderSettings, String> {
    let conn = state.db.lock().map_err(err)?;
    reminder::set_settings(&conn, &settings).map_err(err)
}

/// For the in-app banner: the reminder was sent today and there is still work (click on the toast is not relied upon).
#[tauri::command]
fn get_reminder_pending(state: State<AppState>, tz_offset_min: i32) -> Result<Option<reminder::Due>, String> {
    let conn = state.db.lock().map_err(err)?;
    reminder::pending(&conn, now_ms(), tz_offset_min).map_err(err)
}

/// Every minute, asks pulse-core whether the daily reminder is due and shows the native notification.
fn spawn_reminder_loop(app: tauri::AppHandle) {
    use chrono::{Local, Offset};
    use tauri_plugin_notification::NotificationExt;
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(60));
        let tz = Local::now().offset().fix().local_minus_utc() / 60;
        let state = app.state::<AppState>();
        let due = match state.db.lock() {
            Ok(conn) => reminder::check(&conn, now_ms(), tz),
            Err(_) => continue,
        };
        let Ok(Some(due)) = due else { continue };
        let (title, body) = reminder::message(&due);
        // Marked as sent even when the system refuses the notification: the in-app banner takes over.
        let shown = app.notification().builder().title(title).body(body).show();
        if let Err(e) = &shown {
            eprintln!("Pulse: could not show the reminder notification: {e}");
        }
        if let Ok(conn) = state.db.lock() {
            let _ = reminder::mark_sent(&conn, &due.day);
        };
    });
}

// --- Lot 11: monthly goals and trade replay ---

#[tauri::command]
fn list_goals(state: State<AppState>, month: String) -> Result<Vec<Goal>, String> {
    let conn = state.db.lock().map_err(err)?;
    goals::list(&conn, &month).map_err(err)
}

/// Creates the goal of a month and metric, or changes its target.
#[tauri::command]
fn set_goal(state: State<AppState>, goal: NewGoal) -> Result<Goal, String> {
    let conn = state.db.lock().map_err(err)?;
    goals::set(&conn, &goal).map_err(err)
}

#[tauri::command]
fn delete_goal(state: State<AppState>, id: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(err)?;
    goals::delete(&conn, id).map_err(err)
}

#[tauri::command]
fn copy_goals(state: State<AppState>, from: String, to: String) -> Result<Vec<Goal>, String> {
    let conn = state.db.lock().map_err(err)?;
    goals::copy_month(&conn, &from, &to).map_err(err)
}

#[tauri::command]
fn get_goal_progress(state: State<AppState>, query: ProgressQuery) -> Result<Vec<GoalProgress>, String> {
    let conn = state.db.lock().map_err(err)?;
    goals::progress(&conn, &query).map_err(err)
}

#[tauri::command]
fn list_replay(state: State<AppState>, filter: Option<ReplayFilter>) -> Result<Vec<ReplayItem>, String> {
    let conn = state.db.lock().map_err(err)?;
    replay::list(&conn, &filter.unwrap_or_default()).map_err(err)
}

#[tauri::command]
fn get_replay_card(state: State<AppState>, id: i64) -> Result<ReplayCard, String> {
    let conn = state.db.lock().map_err(err)?;
    replay::card(&conn, id).map_err(err)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let conn = db::open(&data_dir).map_err(err)?;
            app.manage(AppState { db: Mutex::new(conn), data_dir });
            app.manage(AiState::new());
            spawn_reminder_loop(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_info,
            list_accounts,
            create_account,
            delete_account,
            list_instruments,
            create_instrument,
            list_tags,
            create_tag,
            list_rules,
            create_rule,
            rename_rule,
            set_rule_archived,
            list_checklist,
            create_checklist_item,
            rename_checklist_item,
            set_checklist_item_archived,
            list_cash_flows,
            create_cash_flow,
            delete_cash_flow,
            list_trades,
            get_trade,
            create_trade,
            update_trade,
            delete_trade,
            preview_trade,
            get_dashboard,
            get_calendar,
            get_day_trades,
            get_behavior_settings,
            set_behavior_settings,
            get_discipline,
            get_trade_discipline,
            get_emotions,
            get_streaks,
            get_plan_comparison,
            get_first_trade,
            get_mistakes,
            get_rule_adherence,
            get_patterns,
            get_r_distribution,
            get_heatmap,
            get_long_short,
            get_risk,
            export_trades_csv,
            create_backup,
            inspect_backup,
            restore_backup,
            save_screenshot,
            read_screenshot,
            update_account,
            set_account_archived,
            list_missed_trades,
            create_missed_trade,
            update_missed_trade,
            delete_missed_trade,
            save_journal_entry,
            get_journal_day,
            list_journal_entries,
            delete_journal_entry,
            get_execution_score,
            get_quality_report,
            get_confidence_report,
            get_reminder_settings,
            set_reminder_settings,
            get_reminder_pending,
            list_goals,
            set_goal,
            delete_goal,
            copy_goals,
            get_goal_progress,
            list_replay,
            get_replay_card,
            get_external_factors,
            get_after_losses,
            get_size_change,
            get_plan_simulation,
            get_active_alerts,
            dismiss_alert,
            get_alert_history,
            get_alert_settings,
            set_alert_settings,
            get_asset_report,
            get_fee_report,
            get_strategy_report,
            get_execution_report,
            get_opportunity_report,
            get_year_comparison,
            get_duration_report,
            get_scaling_report,
            list_widget_catalog,
            list_dashboard_layouts,
            get_dashboard_layout,
            get_startup_dashboard,
            save_dashboard_layout,
            rename_dashboard_layout,
            delete_dashboard_layout,
            set_default_dashboard_layout,
            get_account_comparison,
            get_risk_benchmark,
            get_exposure_report,
            set_dashboard_scope,
            resolve_dashboard_scope,
            duplicate_dashboard_layout,
            export_dashboard_config,
            import_dashboard_config,
            get_ai_status,
            set_ai_settings,
            record_ai_consent,
            save_ai_key,
            delete_ai_key,
            test_ai_connection,
            preview_screenshot_analysis,
            analyze_screenshot,
            list_screenshot_notes,
            delete_screenshot_note
        ])
        .run(tauri::generate_context!())
        .expect("error while running Pulse");
}

/// Edits an account (currency locked once it has history).
#[tauri::command]
fn update_account(state: State<AppState>, id: i64, account: AccountUpdate) -> Result<Account, String> {
    let conn = state.db.lock().map_err(err)?;
    accounts::update(&conn, id, &account).map_err(err)
}

/// Archives or restores an account; its history is kept.
#[tauri::command]
fn set_account_archived(state: State<AppState>, id: i64, archived: bool) -> Result<Account, String> {
    let conn = state.db.lock().map_err(err)?;
    accounts::set_archived(&conn, id, archived).map_err(err)
}

// --- Lot 8 bis : compléments de l'analyse comportementale ---

#[tauri::command]
fn get_external_factors(state: State<AppState>, query: StatsQuery) -> Result<behavior::ExternalFactorReport, String> {
    let conn = state.db.lock().map_err(err)?;
    behavior::external_factor_report(&conn, &query).map_err(err)
}

#[tauri::command]
fn get_after_losses(state: State<AppState>, query: StatsQuery) -> Result<behavior::AfterLossesReport, String> {
    let conn = state.db.lock().map_err(err)?;
    behavior::after_losses_report(&conn, &query).map_err(err)
}

#[tauri::command]
fn get_size_change(state: State<AppState>, query: StatsQuery) -> Result<behavior::SizeChangeReport, String> {
    let conn = state.db.lock().map_err(err)?;
    behavior::size_change_report(&conn, &query).map_err(err)
}

/// A simulation (off-plan trades removed), never advice: the UI labels it as such.
#[tauri::command]
fn get_plan_simulation(state: State<AppState>, query: StatsQuery) -> Result<behavior::PlanSimulation, String> {
    let conn = state.db.lock().map_err(err)?;
    behavior::plan_simulation_report(&conn, &query).map_err(err)
}

// --- Lot 12 : alertes à seuils (garde-fous, 3.6) ---

fn local_tz_offset_min() -> i32 {
    use chrono::{Local, Offset};
    Local::now().offset().fix().local_minus_utc() / 60
}

/// Right after a trade is saved: evaluates its account so the alert history records the alert at the
/// time of entry. An evaluation error never fails the save.
fn record_alerts_after_save(conn: &Connection, account_id: i64) {
    if let Err(e) = alerts::active_alerts(conn, &[account_id], now_ms(), local_tz_offset_min()) {
        eprintln!("Pulse: could not evaluate the alerts after saving a trade: {e}");
    }
}

/// Alerts active now on the given accounts (active accounts when empty), dismissed ones left out.
#[tauri::command]
fn get_active_alerts(state: State<AppState>, account_ids: Vec<i64>, tz_offset_min: i32) -> Result<Vec<Alert>, String> {
    let conn = state.db.lock().map_err(err)?;
    alerts::active_alerts(&conn, &account_ids, now_ms(), tz_offset_min).map_err(err)
}

#[tauri::command]
fn dismiss_alert(state: State<AppState>, alert_id: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(err)?;
    alerts::dismiss(&conn, &alert_id, now_ms()).map_err(err)
}

#[tauri::command]
fn get_alert_history(state: State<AppState>, account_ids: Vec<i64>, limit: Option<u32>) -> Result<Vec<AlertRecord>, String> {
    let conn = state.db.lock().map_err(err)?;
    alerts::history(&conn, &account_ids, limit.unwrap_or(100)).map_err(err)
}

#[tauri::command]
fn get_alert_settings(state: State<AppState>) -> Result<AlertSettings, String> {
    let conn = state.db.lock().map_err(err)?;
    alerts::settings::get(&conn).map_err(err)
}

#[tauri::command]
fn set_alert_settings(state: State<AppState>, settings: AlertSettings) -> Result<AlertSettings, String> {
    let conn = state.db.lock().map_err(err)?;
    alerts::settings::set(&conn, &settings).map_err(err)
}

// --- Analyses d'étape 3 (lot 14) : par actif, frais, stratégies, système / discrétionnaire ---

#[tauri::command]
fn get_asset_report(state: State<AppState>, query: StatsQuery) -> Result<Vec<pulse_core::stats::analyses::AssetRow>, String> {
    let conn = state.db.lock().map_err(err)?;
    pulse_core::stats::analyses::asset_report(&conn, &query).map_err(err)
}

#[tauri::command]
fn get_fee_report(
    state: State<AppState>,
    query: StatsQuery,
    granularity: Option<pulse_core::stats::analyses::FeeGranularity>,
) -> Result<pulse_core::stats::analyses::FeeReport, String> {
    let conn = state.db.lock().map_err(err)?;
    pulse_core::stats::analyses::fee_report(&conn, &query, granularity.unwrap_or_default()).map_err(err)
}

#[tauri::command]
fn get_strategy_report(state: State<AppState>, query: StatsQuery) -> Result<Vec<pulse_core::stats::analyses::StrategyRow>, String> {
    let conn = state.db.lock().map_err(err)?;
    pulse_core::stats::analyses::strategy_report(&conn, &query).map_err(err)
}

#[tauri::command]
fn get_execution_report(state: State<AppState>, query: StatsQuery) -> Result<pulse_core::stats::analyses::ExecutionReport, String> {
    let conn = state.db.lock().map_err(err)?;
    pulse_core::stats::analyses::execution_report(&conn, &query).map_err(err)
}

// --- Lot 13 : dashboard personnalisable (les widgets réutilisent les commandes de statistiques existantes) ---

#[tauri::command]
fn list_widget_catalog() -> Vec<WidgetDefinition> {
    dashboards::catalog()
}

#[tauri::command]
fn list_dashboard_layouts(state: State<AppState>) -> Result<Vec<DashboardSummary>, String> {
    let conn = state.db.lock().map_err(err)?;
    dashboards::list(&conn).map_err(err)
}

#[tauri::command]
fn get_dashboard_layout(state: State<AppState>, key: String) -> Result<DashboardLayout, String> {
    let conn = state.db.lock().map_err(err)?;
    dashboards::get(&conn, &key).map_err(err)
}

/// Le dashboard affiché au démarrage (« Essentiel » tant que l'utilisateur n'en a pas choisi un autre).
#[tauri::command]
fn get_startup_dashboard(state: State<AppState>) -> Result<DashboardLayout, String> {
    let conn = state.db.lock().map_err(err)?;
    dashboards::startup(&conn).map_err(err)
}

/// `key` absent ou d'un preset : crée un dashboard de l'utilisateur ; sinon remplace le sien.
#[tauri::command]
fn save_dashboard_layout(
    state: State<AppState>,
    key: Option<String>,
    name: String,
    widgets: Vec<WidgetInstance>,
    scope: Option<DashboardScope>,
) -> Result<DashboardLayout, String> {
    let conn = state.db.lock().map_err(err)?;
    dashboards::save_scoped(&conn, key.as_deref(), &name, scope.as_ref(), &widgets).map_err(err)
}

#[tauri::command]
fn rename_dashboard_layout(state: State<AppState>, key: String, name: String) -> Result<DashboardLayout, String> {
    let conn = state.db.lock().map_err(err)?;
    dashboards::rename(&conn, &key, &name).map_err(err)
}

#[tauri::command]
fn delete_dashboard_layout(state: State<AppState>, key: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(err)?;
    dashboards::delete(&conn, &key).map_err(err)
}

#[tauri::command]
fn set_default_dashboard_layout(state: State<AppState>, key: String) -> Result<DashboardLayout, String> {
    let conn = state.db.lock().map_err(err)?;
    dashboards::set_default(&conn, &key).map_err(err)
}

// --- Analyses complémentaires (lot 16) ---

#[tauri::command]
fn get_opportunity_report(state: State<AppState>, query: StatsQuery) -> Result<pulse_core::stats::analyses::OpportunityReport, String> {
    let conn = state.db.lock().map_err(err)?;
    pulse_core::stats::analyses::opportunity_report(&conn, &query).map_err(err)
}

#[tauri::command]
fn get_year_comparison(state: State<AppState>, query: pulse_core::stats::analyses::YearComparisonQuery) -> Result<pulse_core::stats::analyses::YearComparison, String> {
    let conn = state.db.lock().map_err(err)?;
    pulse_core::stats::analyses::year_comparison_report(&conn, &query).map_err(err)
}

#[tauri::command]
fn get_duration_report(state: State<AppState>, query: StatsQuery) -> Result<pulse_core::stats::analyses::DurationReport, String> {
    let conn = state.db.lock().map_err(err)?;
    pulse_core::stats::analyses::duration_report(&conn, &query).map_err(err)
}

#[tauri::command]
fn get_scaling_report(state: State<AppState>, query: StatsQuery) -> Result<pulse_core::stats::analyses::ScalingReport, String> {
    let conn = state.db.lock().map_err(err)?;
    pulse_core::stats::analyses::scaling_report(&conn, &query).map_err(err)
}
// --- Lot 17 : comparaison de comptes, benchmark du risque max, exposition par catégorie d'actif ---

#[tauri::command]
fn get_account_comparison(state: State<AppState>, query: StatsQuery) -> Result<pulse_core::stats::comparisons::AccountComparison, String> {
    let conn = state.db.lock().map_err(err)?;
    pulse_core::stats::comparisons::account_comparison(&conn, &query).map_err(err)
}

#[tauri::command]
fn get_risk_benchmark(state: State<AppState>, query: StatsQuery) -> Result<pulse_core::stats::comparisons::RiskBenchmark, String> {
    let conn = state.db.lock().map_err(err)?;
    pulse_core::stats::comparisons::risk_benchmark_report(&conn, &query).map_err(err)
}

#[tauri::command]
fn get_exposure_report(state: State<AppState>, query: StatsQuery) -> Result<pulse_core::stats::comparisons::ExposureReport, String> {
    let conn = state.db.lock().map_err(err)?;
    pulse_core::stats::comparisons::exposure_report(&conn, &query).map_err(err)
}
// --- Lot 18 : portée d'un dashboard (3.8.9) ---

/// Change ce que lit un dashboard de l'utilisateur : barre du haut, un compte, ou tous les comptes.
#[tauri::command]
fn set_dashboard_scope(state: State<AppState>, key: String, scope: DashboardScope) -> Result<DashboardLayout, String> {
    let conn = state.db.lock().map_err(err)?;
    dashboards::set_scope(&conn, &key, &scope).map_err(err)
}

/// Comptes réellement lus par le dashboard et par chaque widget (le compte du widget, puis la portée du
/// dashboard, puis la barre du haut). `widgets` peut être un brouillon non enregistré.
#[tauri::command]
fn resolve_dashboard_scope(
    state: State<AppState>,
    scope: DashboardScope,
    widgets: Vec<WidgetInstance>,
    selected_account_id: Option<i64>,
) -> Result<ResolvedDashboard, String> {
    let conn = state.db.lock().map_err(err)?;
    dashboards::resolve(&conn, &scope, &widgets, selected_account_id).map_err(err)
}

// --- Lot 18 : duplication, export et import de configuration (3.8.7) ---

/// Copie un dashboard (livré ou à soi) comme point de départ ; sans nom, « <nom> (copie) ».
#[tauri::command]
fn duplicate_dashboard_layout(state: State<AppState>, key: String, name: Option<String>) -> Result<DashboardLayout, String> {
    let conn = state.db.lock().map_err(err)?;
    dashboards::duplicate(&conn, &key, name.as_deref()).map_err(err)
}

/// Écrit la configuration d'un dashboard (JSON versionné) à l'endroit choisi dans la boîte de dialogue.
#[tauri::command]
fn export_dashboard_config(state: State<AppState>, key: String, path: String) -> Result<(), String> {
    let conn = state.db.lock().map_err(err)?;
    dashboards::export_config_file(&conn, &key, std::path::Path::new(&path)).map_err(err)
}

/// Importe une configuration : tout ou rien, jamais d'écrasement ; renvoie le dashboard créé et les avertissements.
#[tauri::command]
fn import_dashboard_config(state: State<AppState>, path: String) -> Result<ImportResult, String> {
    let conn = state.db.lock().map_err(err)?;
    dashboards::import_config_file(&conn, std::path::Path::new(&path)).map_err(err)
}

// --- Lot 20 : IA optionnelle (réseau seulement via pulse-ai, à la demande ; clé seulement dans le coffre Windows) ---

/// The vault and the provider. Building them opens no connection: only `test_ai_connection` and
/// `analyze_screenshot` can reach the network, and both refuse while the option is off.
struct AiState {
    vault: std::sync::Arc<dyn pulse_vault::Vault>,
    provider: std::sync::Arc<dyn pulse_ai::Provider>,
}

impl AiState {
    fn new() -> Self {
        AiState { vault: std::sync::Arc::from(pulse_vault::system_vault()), provider: std::sync::Arc::new(pulse_ai::Claude::official()) }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AiStatus {
    settings: pulse_core::ai::AiSettings,
    vault_available: bool,
    /// Whether a key is stored; the key itself never leaves the vault towards the interface.
    key_stored: bool,
    provider: &'static str,
    provider_host: &'static str,
    default_model: &'static str,
    suggested_models: [&'static str; 3],
}

const AI_PROVIDER_HOST: &str = "api.anthropic.com";

fn ai_status(conn: &Connection, ai: &AiState) -> Result<AiStatus, String> {
    let key = pulse_ai::service::key_status(ai.vault.as_ref());
    Ok(AiStatus {
        settings: pulse_core::ai::get_settings(conn).map_err(err)?,
        vault_available: key.vault_available,
        key_stored: key.stored,
        provider: ai.provider.id(),
        provider_host: AI_PROVIDER_HOST,
        default_model: pulse_core::ai::DEFAULT_MODEL,
        suggested_models: pulse_core::ai::SUGGESTED_MODELS,
    })
}

#[tauri::command]
fn get_ai_status(state: State<AppState>, ai: State<AiState>) -> Result<AiStatus, String> {
    let conn = state.db.lock().map_err(err)?;
    ai_status(&conn, &ai)
}

/// Turning the option off forgets the first-use consent (see pulse_core::ai::set_settings).
#[tauri::command]
fn set_ai_settings(state: State<AppState>, ai: State<AiState>, settings: pulse_core::ai::AiSettingsUpdate) -> Result<AiStatus, String> {
    let conn = state.db.lock().map_err(err)?;
    pulse_core::ai::set_settings(&conn, &settings).map_err(err)?;
    ai_status(&conn, &ai)
}

/// The user ticked the first-use explanation of the send dialog.
#[tauri::command]
fn record_ai_consent(state: State<AppState>, ai: State<AiState>) -> Result<AiStatus, String> {
    let conn = state.db.lock().map_err(err)?;
    pulse_core::ai::record_consent(&conn, now_ms()).map_err(err)?;
    ai_status(&conn, &ai)
}

/// Saves or replaces the key in the vault. No network; the error never repeats the key.
#[tauri::command]
fn save_ai_key(state: State<AppState>, ai: State<AiState>, key: String) -> Result<AiStatus, String> {
    let key = zeroize::Zeroizing::new(key);
    pulse_ai::service::save_key(ai.vault.as_ref(), &key).map_err(|e| e.to_string())?;
    let conn = state.db.lock().map_err(err)?;
    ai_status(&conn, &ai)
}

#[tauri::command]
fn delete_ai_key(state: State<AppState>, ai: State<AiState>) -> Result<AiStatus, String> {
    pulse_ai::service::delete_key(ai.vault.as_ref()).map_err(|e| e.to_string())?;
    let conn = state.db.lock().map_err(err)?;
    ai_status(&conn, &ai)
}

/// Checks the key and the model (`GET /v1/models/{model}`); sends no trading data. Async: the
/// call runs off the main thread and the database is not locked meanwhile.
#[tauri::command]
async fn test_ai_connection(state: State<'_, AppState>, ai: State<'_, AiState>) -> Result<(), String> {
    let model = {
        let conn = state.db.lock().map_err(err)?;
        pulse_ai::service::connection_model(&conn).map_err(|e| e.to_string())?
    };
    let (vault, provider) = (ai.vault.clone(), ai.provider.clone());
    tauri::async_runtime::spawn_blocking(move || pulse_ai::service::run_check(&model, vault.as_ref(), provider.as_ref()))
        .await
        .map_err(err)?
        .map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AiSendPreview {
    /// Exactly what would leave the computer (computed by pulse-core, shown as is in the dialog).
    context: pulse_core::ai::ScreenshotContext,
    enabled: bool,
    first_use: bool,
    provider: &'static str,
    provider_host: &'static str,
    model: String,
}

#[tauri::command]
fn preview_screenshot_analysis(state: State<AppState>, ai: State<AiState>, trade_id: i64) -> Result<AiSendPreview, String> {
    let conn = state.db.lock().map_err(err)?;
    let settings = pulse_core::ai::get_settings(&conn).map_err(err)?;
    Ok(AiSendPreview {
        context: pulse_core::ai::screenshot_context(&conn, &state.data_dir, trade_id).map_err(err)?,
        enabled: settings.enabled,
        first_use: settings.consent_at.is_none(),
        provider: ai.provider.id(),
        provider_host: AI_PROVIDER_HOST,
        model: settings.model,
    })
}

/// On demand only, after the confirmation dialog (`confirmed`). The comment is stored locally.
#[tauri::command]
async fn analyze_screenshot(
    state: State<'_, AppState>,
    ai: State<'_, AiState>,
    trade_id: i64,
    confirmed: bool,
) -> Result<pulse_core::ai::ScreenshotNote, String> {
    let prepared = {
        let conn = state.db.lock().map_err(err)?;
        pulse_ai::service::prepare_analysis(&conn, &state.data_dir, trade_id, confirmed).map_err(|e| e.to_string())?
    };
    let (vault, provider) = (ai.vault.clone(), ai.provider.clone());
    let (prepared, reply) = tauri::async_runtime::spawn_blocking(move || {
        let reply = pulse_ai::service::run_analysis(&prepared, vault.as_ref(), provider.as_ref());
        (prepared, reply)
    })
    .await
    .map_err(err)?;
    let reply = reply.map_err(|e| e.to_string())?;
    let conn = state.db.lock().map_err(err)?;
    pulse_ai::service::store_analysis(&conn, &prepared, ai.provider.id(), &reply, now_ms()).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_screenshot_notes(state: State<AppState>, trade_id: i64) -> Result<Vec<pulse_core::ai::ScreenshotNote>, String> {
    let conn = state.db.lock().map_err(err)?;
    pulse_core::ai::list_notes(&conn, trade_id).map_err(err)
}

#[tauri::command]
fn delete_screenshot_note(state: State<AppState>, id: i64) -> Result<(), String> {
    let conn = state.db.lock().map_err(err)?;
    pulse_core::ai::delete_note(&conn, id).map_err(err)
}
