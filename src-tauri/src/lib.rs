use pulse_core::accounts::{self, Account, AccountUpdate, NewAccount};
use pulse_core::alerts::{self, Alert, AlertRecord, AlertSettings};
use pulse_core::analysis::{
    self, Analysis, AnalysisInput, AnalysisReport, AnalysisSettings, IdeaInput, IdeaOutcome, IdeaStatus, IdeaView, NewsBlock, Question,
    QuestionKind, ReviewBanner, ReviewQueue, TradeLinks,
};
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
use pulse_core::backup::{BackupInfo, RestoreResult};
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
use pulse_core::emotions::{self, CatalogGroup, EmotionUsage};
use pulse_core::tags::{self, Tag, TagKind};
use pulse_core::trade_view::{self, Preview, TradeView};
use pulse_core::trades::{self, TradeData, TradeFilter};
use pulse_core::lock::{LockError, Password, Store};
use pulse_core::{migrations, rusqlite::Connection, screenshots};
use serde::Serialize;
use std::ops::{Deref, DerefMut};
use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager, State};

mod lock_cmds;

struct AppState {
    /// The open database, or `None` while the optional password lock (lot 22) is locked.
    db: Mutex<Option<Store>>,
    data_dir: PathBuf,
    app: tauri::AppHandle,
    lock: Mutex<lock_cmds::LockRuntime>,
}

impl AppState {
    /// The open database; `lock:locked` before the password is given, so that no command (nor the
    /// background reminder) can read anything while locked.
    fn conn(&self) -> Result<DbGuard<'_>, String> {
        let guard = self.db.lock().map_err(err)?;
        if guard.is_none() {
            return Err(LockError::Locked.to_string());
        }
        Ok(DbGuard { guard, app: &self.app })
    }
}

/// Access to the open database. When it goes out of scope, an encrypted database that changed is
/// written back (encrypted, atomically); a plain database is written by SQLite itself, as before.
struct DbGuard<'a> {
    guard: MutexGuard<'a, Option<Store>>,
    app: &'a tauri::AppHandle,
}

impl DbGuard<'_> {
    fn store(&self) -> &Store {
        self.guard.as_ref().expect("checked by AppState::conn")
    }

    fn store_mut(&mut self) -> &mut Store {
        self.guard.as_mut().expect("checked by AppState::conn")
    }
}

impl Deref for DbGuard<'_> {
    type Target = Connection;
    fn deref(&self) -> &Connection {
        self.store().conn()
    }
}

impl DerefMut for DbGuard<'_> {
    fn deref_mut(&mut self) -> &mut Connection {
        self.store_mut().conn_mut()
    }
}

impl Drop for DbGuard<'_> {
    fn drop(&mut self) {
        if let Some(store) = self.guard.as_mut() {
            if store.flush().is_err() {
                // The data stays in memory; the interface shows a banner with « Réessayer ».
                eprintln!("Pulse: lock:persistFailed (the encrypted database could not be written)");
                let _ = self.app.emit(lock_cmds::PERSIST_FAILED_EVENT, ());
            }
        }
    }
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
    let conn = state.conn()?;
    Ok(AppInfo {
        version: app.package_info().version.to_string(),
        data_dir: state.data_dir.to_string_lossy().into_owned(),
        schema_version: migrations::current_version(&conn).map_err(err)?,
    })
}

#[tauri::command]
fn list_accounts(state: State<AppState>) -> Result<Vec<Account>, String> {
    let conn = state.conn()?;
    accounts::list(&conn).map_err(err)
}

#[tauri::command]
fn create_account(state: State<AppState>, account: NewAccount) -> Result<Account, String> {
    let conn = state.conn()?;
    accounts::create(&conn, &account).map_err(err)
}

#[tauri::command]
fn delete_account(state: State<AppState>, id: i64) -> Result<(), String> {
    let conn = state.conn()?;
    accounts::delete(&conn, id).map_err(err)
}

// Thin commands: every rule and every figure lives in pulse-core.

#[tauri::command]
fn list_instruments(state: State<AppState>) -> Result<Vec<Instrument>, String> {
    let conn = state.conn()?;
    instruments::list(&conn).map_err(err)
}

#[tauri::command]
fn create_instrument(state: State<AppState>, instrument: NewInstrument) -> Result<Instrument, String> {
    let conn = state.conn()?;
    instruments::create(&conn, &instrument).map_err(err)
}

#[tauri::command]
fn list_tags(state: State<AppState>, kind: Option<TagKind>, include_archived: Option<bool>) -> Result<Vec<Tag>, String> {
    let conn = state.conn()?;
    tags::list(&conn, kind, include_archived.unwrap_or(false)).map_err(err)
}

#[tauri::command]
fn create_tag(state: State<AppState>, kind: TagKind, name: String) -> Result<Tag, String> {
    let conn = state.conn()?;
    tags::create(&conn, kind, &name).map_err(err)
}

// --- Lot 30 : « Ma liste » d'émotions (retirer = archiver) ---

#[tauri::command]
fn get_emotion_catalog() -> Vec<CatalogGroup> {
    emotions::catalog()
}

#[tauri::command]
fn get_emotion_usage(state: State<AppState>) -> Result<Vec<EmotionUsage>, String> {
    let conn = state.conn()?;
    emotions::usage(&conn).map_err(err)
}

#[tauri::command]
fn add_emotion_to_list(state: State<AppState>, name: String) -> Result<Tag, String> {
    let conn = state.conn()?;
    emotions::add_to_list(&conn, &name).map_err(err)
}

#[tauri::command]
fn remove_emotion_from_list(state: State<AppState>, tag_id: i64) -> Result<Tag, String> {
    let conn = state.conn()?;
    emotions::remove_from_list(&conn, tag_id).map_err(err)
}

#[tauri::command]
fn delete_unused_emotion(state: State<AppState>, tag_id: i64) -> Result<(), String> {
    let conn = state.conn()?;
    emotions::delete_unused(&conn, tag_id).map_err(err)
}
#[tauri::command]
fn list_rules(state: State<AppState>, include_archived: Option<bool>) -> Result<Vec<Rule>, String> {
    let conn = state.conn()?;
    rules::list(&conn, include_archived.unwrap_or(false)).map_err(err)
}

#[tauri::command]
fn create_rule(state: State<AppState>, text: String) -> Result<Rule, String> {
    let conn = state.conn()?;
    rules::create(&conn, &text).map_err(err)
}

#[tauri::command]
fn rename_rule(state: State<AppState>, id: i64, text: String) -> Result<Rule, String> {
    let conn = state.conn()?;
    rules::update_text(&conn, id, &text).map_err(err)
}

#[tauri::command]
fn set_rule_archived(state: State<AppState>, id: i64, archived: bool) -> Result<Rule, String> {
    let conn = state.conn()?;
    rules::set_archived(&conn, id, archived).map_err(err)
}

#[tauri::command]
fn list_checklist(state: State<AppState>, include_archived: Option<bool>) -> Result<Vec<ChecklistItem>, String> {
    let conn = state.conn()?;
    checklist::list(&conn, include_archived.unwrap_or(false)).map_err(err)
}

#[tauri::command]
fn create_checklist_item(state: State<AppState>, label: String) -> Result<ChecklistItem, String> {
    let conn = state.conn()?;
    checklist::create(&conn, &label).map_err(err)
}

#[tauri::command]
fn rename_checklist_item(state: State<AppState>, id: i64, label: String) -> Result<ChecklistItem, String> {
    let conn = state.conn()?;
    checklist::rename(&conn, id, &label).map_err(err)
}

#[tauri::command]
fn set_checklist_item_archived(state: State<AppState>, id: i64, archived: bool) -> Result<ChecklistItem, String> {
    let conn = state.conn()?;
    checklist::set_archived(&conn, id, archived).map_err(err)
}

/// Deposits and withdrawals of one account, oldest first. They never count as performance.
#[tauri::command]
fn list_cash_flows(state: State<AppState>, account_id: i64) -> Result<Vec<CashFlow>, String> {
    let conn = state.conn()?;
    cash_flows::list(&conn, &[account_id]).map_err(err)
}

#[tauri::command]
fn create_cash_flow(state: State<AppState>, cash_flow: NewCashFlow) -> Result<CashFlow, String> {
    let conn = state.conn()?;
    cash_flows::create(&conn, &cash_flow).map_err(err)
}

#[tauri::command]
fn delete_cash_flow(state: State<AppState>, id: i64) -> Result<(), String> {
    let conn = state.conn()?;
    cash_flows::delete(&conn, id).map_err(err)
}

#[tauri::command]
fn list_trades(state: State<AppState>, filter: Option<TradeFilter>) -> Result<Vec<TradeView>, String> {
    let conn = state.conn()?;
    trade_view::list(&conn, &filter.unwrap_or_default()).map_err(err)
}

#[tauri::command]
fn get_trade(state: State<AppState>, id: i64) -> Result<TradeView, String> {
    let conn = state.conn()?;
    trade_view::get(&conn, id).map_err(err)
}

#[tauri::command]
fn create_trade(state: State<AppState>, trade: TradeData) -> Result<TradeView, String> {
    let conn = state.conn()?;
    let saved = trades::create(&conn, &trade).map_err(err)?;
    record_alerts_after_save(&conn, saved.data.account_id);
    trade_view::get(&conn, saved.id).map_err(err)
}

#[tauri::command]
fn update_trade(state: State<AppState>, id: i64, trade: TradeData) -> Result<TradeView, String> {
    let conn = state.conn()?;
    trades::update(&conn, id, &trade).map_err(err)?;
    record_alerts_after_save(&conn, trade.account_id);
    trade_view::get(&conn, id).map_err(err)
}

#[tauri::command]
fn delete_trade(state: State<AppState>, id: i64) -> Result<(), String> {
    let conn = state.conn()?;
    trades::delete(&conn, id).map_err(err)
}

/// Live figures for the entry form, computed by pulse-core.
#[tauri::command]
fn preview_trade(state: State<AppState>, trade: TradeData) -> Result<Preview, String> {
    let conn = state.conn()?;
    trade_view::preview(&conn, &trade).map_err(err)
}

/// Dashboard of one period against the previous one, computed by pulse-core.
#[tauri::command]
fn get_dashboard(state: State<AppState>, query: DashboardQuery) -> Result<Dashboard, String> {
    let conn = state.conn()?;
    dashboard::dashboard(&conn, &query).map_err(err)
}

#[tauri::command]
fn get_calendar(state: State<AppState>, query: CalendarQuery) -> Result<Calendar, String> {
    let conn = state.conn()?;
    dashboard::calendar(&conn, &query).map_err(err)
}

#[tauri::command]
fn get_day_trades(state: State<AppState>, account_ids: Vec<i64>, day: String) -> Result<Vec<DayTrade>, String> {
    let conn = state.conn()?;
    dashboard::day_trades(&conn, &account_ids, &day).map_err(err)
}

// Behavioural analysis (lot 8): one command per report, all computed by pulse-core.

#[tauri::command]
fn get_behavior_settings(state: State<AppState>) -> Result<BehaviorSettings, String> {
    let conn = state.conn()?;
    settings::behavior(&conn).map_err(err)
}

#[tauri::command]
fn set_behavior_settings(state: State<AppState>, settings: BehaviorSettings) -> Result<BehaviorSettings, String> {
    let conn = state.conn()?;
    settings::set_behavior(&conn, &settings).map_err(err)
}

#[tauri::command]
fn get_discipline(state: State<AppState>, query: StatsQuery) -> Result<DisciplineReport, String> {
    let conn = state.conn()?;
    behavior::discipline_report(&conn, &query).map_err(err)
}

#[tauri::command]
fn get_trade_discipline(state: State<AppState>, id: i64) -> Result<TradeDiscipline, String> {
    let conn = state.conn()?;
    behavior::trade_discipline(&conn, id).map_err(err)
}

#[tauri::command]
fn get_emotions(state: State<AppState>, query: StatsQuery) -> Result<EmotionReport, String> {
    let conn = state.conn()?;
    behavior::emotion_report(&conn, &query).map_err(err)
}

#[tauri::command]
fn get_streaks(state: State<AppState>, query: StatsQuery) -> Result<StreakReport, String> {
    let conn = state.conn()?;
    behavior::streak_report(&conn, &query).map_err(err)
}

#[tauri::command]
fn get_plan_comparison(state: State<AppState>, query: StatsQuery) -> Result<PlanReport, String> {
    let conn = state.conn()?;
    behavior::plan_report(&conn, &query).map_err(err)
}

#[tauri::command]
fn get_first_trade(state: State<AppState>, query: StatsQuery) -> Result<FirstTradeReport, String> {
    let conn = state.conn()?;
    behavior::first_trade_report(&conn, &query).map_err(err)
}

#[tauri::command]
fn get_mistakes(state: State<AppState>, query: StatsQuery) -> Result<MistakeReport, String> {
    let conn = state.conn()?;
    behavior::mistake_report(&conn, &query).map_err(err)
}

#[tauri::command]
fn get_rule_adherence(state: State<AppState>, query: StatsQuery) -> Result<RuleAdherenceReport, String> {
    let conn = state.conn()?;
    behavior::rule_adherence_report(&conn, &query).map_err(err)
}

#[tauri::command]
fn get_patterns(state: State<AppState>, query: StatsQuery) -> Result<PatternReport, String> {
    let conn = state.conn()?;
    behavior::pattern_report(&conn, &query).map_err(err)
}

#[tauri::command]
fn get_r_distribution(state: State<AppState>, query: StatsQuery) -> Result<RDistribution, String> {
    let conn = state.conn()?;
    distribution::r_distribution_report(&conn, &query).map_err(err)
}

#[tauri::command]
fn get_heatmap(state: State<AppState>, query: StatsQuery) -> Result<Heatmap, String> {
    let conn = state.conn()?;
    distribution::heatmap_report(&conn, &query).map_err(err)
}

#[tauri::command]
fn get_long_short(state: State<AppState>, query: StatsQuery) -> Result<LongShort, String> {
    let conn = state.conn()?;
    distribution::long_short_report(&conn, &query).map_err(err)
}

#[tauri::command]
fn get_risk(state: State<AppState>, query: StatsQuery) -> Result<RiskReport, String> {
    let conn = state.conn()?;
    risk::risk_report(&conn, &query).map_err(err)
}

/// `image` is the file as base64 (a `data:` URL is accepted); returns the relative path to store on the trade.
#[tauri::command]
fn save_screenshot(state: State<AppState>, image: String) -> Result<String, String> {
    // Unlocked only: an encrypted folder must never receive a plaintext screenshot.
    let _open = state.conn()?;
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
    let conn = state.conn()?;
    let filter = TradeFilter { account_ids, ..Default::default() };
    export::write_trades_csv(&conn, &filter, std::path::Path::new(&path)).map_err(err)
}

#[tauri::command]
fn create_backup(state: State<AppState>, dest_dir: String) -> Result<BackupInfo, String> {
    // Encrypted database → encrypted backup (lot 22); otherwise the lot 6 backup.
    let conn = state.conn()?;
    conn.store().create_backup(std::path::Path::new(&dest_dir), now_ms()).map_err(err)
}

/// `password`: only for an encrypted backup (its own password, from when it was made).
#[tauri::command]
async fn inspect_backup(app: tauri::AppHandle, folder: String, password: Option<String>) -> Result<BackupInfo, String> {
    let password = password.map(Password::new);
    let data_dir = app.state::<AppState>().data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || {
        pulse_core::lock::inspect_backup(&data_dir, std::path::Path::new(&folder), password.as_ref(), now_ms()).map_err(err)
    })
    .await
    .map_err(err)?
}

/// Off the main thread: an encrypted backup needs its password (Argon2id).
#[tauri::command]
async fn restore_backup(app: tauri::AppHandle, folder: String, confirmed: bool, password: Option<String>) -> Result<RestoreResult, String> {
    let password = password.map(Password::new);
    lock_cmds::on_store(&app, move |s| s.restore_backup(std::path::Path::new(&folder), confirmed, password.as_ref(), now_ms())).await
}

// --- Lot 10: journal side (missed trades, daily journal, execution quality, confidence, reminder) ---

#[tauri::command]
fn list_missed_trades(state: State<AppState>, account_ids: Vec<i64>) -> Result<Vec<MissedTrade>, String> {
    let conn = state.conn()?;
    missed_trades::list(&conn, &account_ids).map_err(err)
}

#[tauri::command]
fn create_missed_trade(state: State<AppState>, missed: MissedTradeData) -> Result<MissedTrade, String> {
    let conn = state.conn()?;
    missed_trades::create(&conn, &missed).map_err(err)
}

#[tauri::command]
fn update_missed_trade(state: State<AppState>, id: i64, missed: MissedTradeData) -> Result<MissedTrade, String> {
    let conn = state.conn()?;
    missed_trades::update(&conn, id, &missed).map_err(err)
}

#[tauri::command]
fn delete_missed_trade(state: State<AppState>, id: i64) -> Result<(), String> {
    let conn = state.conn()?;
    missed_trades::delete(&conn, id).map_err(err)
}

/// A blank entry deletes the day's entry and returns `null`.
#[tauri::command]
fn save_journal_entry(state: State<AppState>, entry: JournalEntry) -> Result<Option<JournalEntry>, String> {
    let conn = state.conn()?;
    journal::save(&conn, &entry).map_err(err)
}

#[tauri::command]
fn get_journal_day(state: State<AppState>, account_ids: Vec<i64>, day: String) -> Result<DayOverview, String> {
    let conn = state.conn()?;
    journal::day_overview(&conn, &account_ids, &day).map_err(err)
}

#[tauri::command]
fn list_journal_entries(state: State<AppState>, from: Option<String>, to: Option<String>) -> Result<Vec<JournalEntry>, String> {
    let conn = state.conn()?;
    journal::list(&conn, from.as_deref(), to.as_deref()).map_err(err)
}

#[tauri::command]
fn delete_journal_entry(state: State<AppState>, day: String) -> Result<(), String> {
    let conn = state.conn()?;
    journal::delete(&conn, &day).map_err(err)
}

/// Execution-quality score of a stored trade (spec 3.2.9).
#[tauri::command]
fn get_execution_score(state: State<AppState>, trade_id: i64) -> Result<ExecutionScore, String> {
    let conn = state.conn()?;
    let trade = trades::get(&conn, trade_id).map_err(err)?;
    Ok(execution_quality::score(&trade.data))
}

#[tauri::command]
fn get_quality_report(state: State<AppState>, query: PeriodQuery) -> Result<QualityReport, String> {
    let conn = state.conn()?;
    execution_quality::report(&conn, &query).map_err(err)
}

#[tauri::command]
fn get_confidence_report(state: State<AppState>, query: PeriodQuery) -> Result<ConfidenceReport, String> {
    let conn = state.conn()?;
    confidence::report(&conn, &query).map_err(err)
}

#[tauri::command]
fn get_reminder_settings(state: State<AppState>) -> Result<ReminderSettings, String> {
    let conn = state.conn()?;
    reminder::get_settings(&conn).map_err(err)
}

#[tauri::command]
fn set_reminder_settings(state: State<AppState>, settings: ReminderSettings) -> Result<ReminderSettings, String> {
    let conn = state.conn()?;
    reminder::set_settings(&conn, &settings).map_err(err)
}

/// For the in-app banner: the reminder was sent today and there is still work (click on the toast is not relied upon).
#[tauri::command]
fn get_reminder_pending(state: State<AppState>, tz_offset_min: i32) -> Result<Option<reminder::Due>, String> {
    let conn = state.conn()?;
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
        // Locked: nothing is read, the reminder waits for the password.
        let due = match state.conn() {
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
        if let Ok(conn) = state.conn() {
            let _ = reminder::mark_sent(&conn, &due.day);
        };
    });
}

// --- Lot 11: monthly goals and trade replay ---

#[tauri::command]
fn list_goals(state: State<AppState>, month: String) -> Result<Vec<Goal>, String> {
    let conn = state.conn()?;
    goals::list(&conn, &month).map_err(err)
}

/// Creates the goal of a month and metric, or changes its target.
#[tauri::command]
fn set_goal(state: State<AppState>, goal: NewGoal) -> Result<Goal, String> {
    let conn = state.conn()?;
    goals::set(&conn, &goal).map_err(err)
}

#[tauri::command]
fn delete_goal(state: State<AppState>, id: i64) -> Result<(), String> {
    let conn = state.conn()?;
    goals::delete(&conn, id).map_err(err)
}

#[tauri::command]
fn copy_goals(state: State<AppState>, from: String, to: String) -> Result<Vec<Goal>, String> {
    let conn = state.conn()?;
    goals::copy_month(&conn, &from, &to).map_err(err)
}

#[tauri::command]
fn get_goal_progress(state: State<AppState>, query: ProgressQuery) -> Result<Vec<GoalProgress>, String> {
    let conn = state.conn()?;
    goals::progress(&conn, &query).map_err(err)
}

#[tauri::command]
fn list_replay(state: State<AppState>, filter: Option<ReplayFilter>) -> Result<Vec<ReplayItem>, String> {
    let conn = state.conn()?;
    replay::list(&conn, &filter.unwrap_or_default()).map_err(err)
}

#[tauri::command]
fn get_replay_card(state: State<AppState>, id: i64) -> Result<ReplayCard, String> {
    let conn = state.conn()?;
    replay::card(&conn, id).map_err(err)
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            // Lot 22: before opening anything, which file is the database (and recovery of an
            // interrupted activation / deactivation). Without the lock: `db::open`, as before.
            let startup = pulse_core::lock::startup(&data_dir).map_err(err)?;
            let store = if startup.encrypted { None } else { Some(Store::open_plain(&data_dir).map_err(err)?) };
            app.manage(AppState {
                db: Mutex::new(store),
                data_dir,
                app: app.handle().clone(),
                lock: Mutex::new(lock_cmds::LockRuntime { warning: startup.warning, last_activity_ms: now_ms() }),
            });
            app.manage(AiState::new());
            app.manage(NewsPreviewState::default());
            spawn_reminder_loop(app.handle().clone());
            lock_cmds::spawn_idle_loop(app.handle().clone());
            // Lot 32: scheduled automatic backup (checks at startup, then every 30 minutes).
            app.manage(AutoBackupState::default());
            spawn_auto_backup_loop(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            // An encrypted database is written after every change; if the last write failed,
            // closing would lose data that is only in memory: ask the interface first.
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<AppState>();
                let failed = state.db.lock().map(|mut slot| slot.as_mut().is_some_and(|s| s.flush().is_err())).unwrap_or(false);
                if failed {
                    api.prevent_close();
                    let _ = window.emit(lock_cmds::PERSIST_FAILED_EVENT, ());
                }
            }
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
            get_emotion_catalog,
            get_emotion_usage,
            add_emotion_to_list,
            remove_emotion_from_list,
            delete_unused_emotion,
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
            get_analysis_questions,
            add_analysis_question,
            update_analysis_question,
            move_analysis_question,
            set_analysis_question_archived,
            create_analysis,
            update_analysis,
            delete_analysis,
            list_analyses_of_day,
            list_analyses_before,
            get_news_block,
            create_idea,
            update_idea,
            list_ideas,
            get_review_queue,
            get_review_banner,
            dismiss_review_banner,
            idea_keep,
            idea_complete,
            idea_snooze,
            idea_close,
            idea_delete,
            get_analysis_settings,
            set_analysis_settings,
            get_trade_links,
            set_trade_links,
            get_analysis_report,
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
            get_insights,
            dismiss_insight,
            get_insight_history,
            get_ai_status,
            set_ai_settings,
            record_ai_consent,
            save_ai_key,
            delete_ai_key,
            test_ai_connection,
            preview_screenshot_analysis,
            analyze_screenshot,
            list_screenshot_notes,
            delete_screenshot_note,
            get_coach_status,
            record_coach_consent,
            ask_coach,
            list_coach_conversations,
            get_coach_conversation,
            rename_coach_conversation,
            delete_coach_conversation,
            delete_all_coach_conversations,
            calculate_position_size,
            lock_cmds::get_lock_status,
            lock_cmds::unlock_database,
            lock_cmds::enable_lock,
            lock_cmds::disable_lock,
            lock_cmds::change_lock_password,
            lock_cmds::lock_now,
            lock_cmds::set_lock_idle,
            lock_cmds::lock_touch,
            lock_cmds::retry_persist,
            lock_cmds::quit_discarding_changes,
            export_period_pdf,
            get_trade_card_figures,
            save_trade_card_image,
            get_news_status,
            set_news_settings,
            import_news_file,
            refresh_news,
            get_news_calendar,
            get_upcoming_news,
            clear_news_events,
            test_news_source,
            keep_tested_news,
            get_auto_backup_status,
            set_auto_backup_settings,
            check_auto_backup_folder,
            run_auto_backup_now,
            list_auto_backups,
            answer_auto_backup_invite,
            open_auto_backup_folder,
            get_prop_rules,
            set_prop_rules,
            delete_prop_rules,
            get_prop_status,
            set_prop_alerts,
            start_pause,
            end_pause,
            get_current_pause,
            list_pauses,
            get_pause_report,
            get_pause_suggestion,
            get_pause_settings,
            set_pause_settings
        ])
        .run(tauri::generate_context!())
        .expect("error while running Pulse");
}

/// Edits an account (currency locked once it has history).
#[tauri::command]
fn update_account(state: State<AppState>, id: i64, account: AccountUpdate) -> Result<Account, String> {
    let conn = state.conn()?;
    accounts::update(&conn, id, &account).map_err(err)
}

/// Archives or restores an account; its history is kept.
#[tauri::command]
fn set_account_archived(state: State<AppState>, id: i64, archived: bool) -> Result<Account, String> {
    let conn = state.conn()?;
    accounts::set_archived(&conn, id, archived).map_err(err)
}

// --- Lot 8 bis : compléments de l'analyse comportementale ---

#[tauri::command]
fn get_external_factors(state: State<AppState>, query: StatsQuery) -> Result<behavior::ExternalFactorReport, String> {
    let conn = state.conn()?;
    behavior::external_factor_report(&conn, &query).map_err(err)
}

#[tauri::command]
fn get_after_losses(state: State<AppState>, query: StatsQuery) -> Result<behavior::AfterLossesReport, String> {
    let conn = state.conn()?;
    behavior::after_losses_report(&conn, &query).map_err(err)
}

#[tauri::command]
fn get_size_change(state: State<AppState>, query: StatsQuery) -> Result<behavior::SizeChangeReport, String> {
    let conn = state.conn()?;
    behavior::size_change_report(&conn, &query).map_err(err)
}

/// A simulation (off-plan trades removed), never advice: the UI labels it as such.
#[tauri::command]
fn get_plan_simulation(state: State<AppState>, query: StatsQuery) -> Result<behavior::PlanSimulation, String> {
    let conn = state.conn()?;
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
    let conn = state.conn()?;
    alerts::active_alerts(&conn, &account_ids, now_ms(), tz_offset_min).map_err(err)
}

#[tauri::command]
fn dismiss_alert(state: State<AppState>, alert_id: String) -> Result<(), String> {
    let conn = state.conn()?;
    alerts::dismiss(&conn, &alert_id, now_ms()).map_err(err)
}

#[tauri::command]
fn get_alert_history(state: State<AppState>, account_ids: Vec<i64>, limit: Option<u32>) -> Result<Vec<AlertRecord>, String> {
    let conn = state.conn()?;
    alerts::history(&conn, &account_ids, limit.unwrap_or(100)).map_err(err)
}

#[tauri::command]
fn get_alert_settings(state: State<AppState>) -> Result<AlertSettings, String> {
    let conn = state.conn()?;
    alerts::settings::get(&conn).map_err(err)
}

#[tauri::command]
fn set_alert_settings(state: State<AppState>, settings: AlertSettings) -> Result<AlertSettings, String> {
    let conn = state.conn()?;
    alerts::settings::set(&conn, &settings).map_err(err)
}

// --- Analyses d'étape 3 (lot 14) : par actif, frais, stratégies, système / discrétionnaire ---

#[tauri::command]
fn get_asset_report(state: State<AppState>, query: StatsQuery) -> Result<Vec<pulse_core::stats::analyses::AssetRow>, String> {
    let conn = state.conn()?;
    pulse_core::stats::analyses::asset_report(&conn, &query).map_err(err)
}

#[tauri::command]
fn get_fee_report(
    state: State<AppState>,
    query: StatsQuery,
    granularity: Option<pulse_core::stats::analyses::FeeGranularity>,
) -> Result<pulse_core::stats::analyses::FeeReport, String> {
    let conn = state.conn()?;
    pulse_core::stats::analyses::fee_report(&conn, &query, granularity.unwrap_or_default()).map_err(err)
}

#[tauri::command]
fn get_strategy_report(state: State<AppState>, query: StatsQuery) -> Result<Vec<pulse_core::stats::analyses::StrategyRow>, String> {
    let conn = state.conn()?;
    pulse_core::stats::analyses::strategy_report(&conn, &query).map_err(err)
}

#[tauri::command]
fn get_execution_report(state: State<AppState>, query: StatsQuery) -> Result<pulse_core::stats::analyses::ExecutionReport, String> {
    let conn = state.conn()?;
    pulse_core::stats::analyses::execution_report(&conn, &query).map_err(err)
}

// --- Lot 13 : dashboard personnalisable (les widgets réutilisent les commandes de statistiques existantes) ---

#[tauri::command]
fn list_widget_catalog() -> Vec<WidgetDefinition> {
    dashboards::catalog()
}

#[tauri::command]
fn list_dashboard_layouts(state: State<AppState>) -> Result<Vec<DashboardSummary>, String> {
    let conn = state.conn()?;
    dashboards::list(&conn).map_err(err)
}

#[tauri::command]
fn get_dashboard_layout(state: State<AppState>, key: String) -> Result<DashboardLayout, String> {
    let conn = state.conn()?;
    dashboards::get(&conn, &key).map_err(err)
}

/// Le dashboard affiché au démarrage (« Essentiel » tant que l'utilisateur n'en a pas choisi un autre).
#[tauri::command]
fn get_startup_dashboard(state: State<AppState>) -> Result<DashboardLayout, String> {
    let conn = state.conn()?;
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
    let conn = state.conn()?;
    dashboards::save_scoped(&conn, key.as_deref(), &name, scope.as_ref(), &widgets).map_err(err)
}

#[tauri::command]
fn rename_dashboard_layout(state: State<AppState>, key: String, name: String) -> Result<DashboardLayout, String> {
    let conn = state.conn()?;
    dashboards::rename(&conn, &key, &name).map_err(err)
}

#[tauri::command]
fn delete_dashboard_layout(state: State<AppState>, key: String) -> Result<(), String> {
    let conn = state.conn()?;
    dashboards::delete(&conn, &key).map_err(err)
}

#[tauri::command]
fn set_default_dashboard_layout(state: State<AppState>, key: String) -> Result<DashboardLayout, String> {
    let conn = state.conn()?;
    dashboards::set_default(&conn, &key).map_err(err)
}

// --- Analyses complémentaires (lot 16) ---

#[tauri::command]
fn get_opportunity_report(state: State<AppState>, query: StatsQuery) -> Result<pulse_core::stats::analyses::OpportunityReport, String> {
    let conn = state.conn()?;
    pulse_core::stats::analyses::opportunity_report(&conn, &query).map_err(err)
}

#[tauri::command]
fn get_year_comparison(state: State<AppState>, query: pulse_core::stats::analyses::YearComparisonQuery) -> Result<pulse_core::stats::analyses::YearComparison, String> {
    let conn = state.conn()?;
    pulse_core::stats::analyses::year_comparison_report(&conn, &query).map_err(err)
}

#[tauri::command]
fn get_duration_report(state: State<AppState>, query: StatsQuery) -> Result<pulse_core::stats::analyses::DurationReport, String> {
    let conn = state.conn()?;
    pulse_core::stats::analyses::duration_report(&conn, &query).map_err(err)
}

#[tauri::command]
fn get_scaling_report(state: State<AppState>, query: StatsQuery) -> Result<pulse_core::stats::analyses::ScalingReport, String> {
    let conn = state.conn()?;
    pulse_core::stats::analyses::scaling_report(&conn, &query).map_err(err)
}
// --- Lot 17 : comparaison de comptes, benchmark du risque max, exposition par catégorie d'actif ---

#[tauri::command]
fn get_account_comparison(state: State<AppState>, query: StatsQuery) -> Result<pulse_core::stats::comparisons::AccountComparison, String> {
    let conn = state.conn()?;
    pulse_core::stats::comparisons::account_comparison(&conn, &query).map_err(err)
}

#[tauri::command]
fn get_risk_benchmark(state: State<AppState>, query: StatsQuery) -> Result<pulse_core::stats::comparisons::RiskBenchmark, String> {
    let conn = state.conn()?;
    pulse_core::stats::comparisons::risk_benchmark_report(&conn, &query).map_err(err)
}

#[tauri::command]
fn get_exposure_report(state: State<AppState>, query: StatsQuery) -> Result<pulse_core::stats::comparisons::ExposureReport, String> {
    let conn = state.conn()?;
    pulse_core::stats::comparisons::exposure_report(&conn, &query).map_err(err)
}
// --- Lot 18 : portée d'un dashboard (3.8.9) ---

/// Change ce que lit un dashboard de l'utilisateur : barre du haut, un compte, ou tous les comptes.
#[tauri::command]
fn set_dashboard_scope(state: State<AppState>, key: String, scope: DashboardScope) -> Result<DashboardLayout, String> {
    let conn = state.conn()?;
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
    let conn = state.conn()?;
    dashboards::resolve(&conn, &scope, &widgets, selected_account_id).map_err(err)
}

// --- Lot 18 : duplication, export et import de configuration (3.8.7) ---

/// Copie un dashboard (livré ou à soi) comme point de départ ; sans nom, « <nom> (copie) ».
#[tauri::command]
fn duplicate_dashboard_layout(state: State<AppState>, key: String, name: Option<String>) -> Result<DashboardLayout, String> {
    let conn = state.conn()?;
    dashboards::duplicate(&conn, &key, name.as_deref()).map_err(err)
}

/// Écrit la configuration d'un dashboard (JSON versionné) à l'endroit choisi dans la boîte de dialogue.
#[tauri::command]
fn export_dashboard_config(state: State<AppState>, key: String, path: String) -> Result<(), String> {
    let conn = state.conn()?;
    dashboards::export_config_file(&conn, &key, std::path::Path::new(&path)).map_err(err)
}

/// Importe une configuration : tout ou rien, jamais d'écrasement ; renvoie le dashboard créé et les avertissements.
#[tauri::command]
fn import_dashboard_config(state: State<AppState>, path: String) -> Result<ImportResult, String> {
    let conn = state.conn()?;
    dashboards::import_config_file(&conn, std::path::Path::new(&path)).map_err(err)
}

// --- Lot 19 : insights automatiques (3.5.1 à 3.5.3), déterministes, sans IA ni réseau ---

/// Insights de maintenant sur les comptes donnés (comptes actifs si la liste est vide), chaque compte seul ;
/// les insights masqués sont omis sauf si `include_dismissed`.
#[tauri::command]
fn get_insights(
    state: State<AppState>,
    account_ids: Vec<i64>,
    tz_offset_min: i32,
    include_dismissed: Option<bool>,
) -> Result<Vec<pulse_core::insights::Insight>, String> {
    let conn = state.conn()?;
    pulse_core::insights::active_insights(&conn, &account_ids, now_ms(), tz_offset_min, include_dismissed.unwrap_or(false)).map_err(err)
}

/// Masque un insight : il ne revient que si la situation s'aggrave ou dans un nouvel épisode.
#[tauri::command]
fn dismiss_insight(state: State<AppState>, insight_id: String) -> Result<(), String> {
    let conn = state.conn()?;
    pulse_core::insights::dismiss(&conn, &insight_id, now_ms()).map_err(err)
}

#[tauri::command]
fn get_insight_history(state: State<AppState>, account_ids: Vec<i64>, limit: Option<u32>) -> Result<Vec<pulse_core::insights::InsightRecord>, String> {
    let conn = state.conn()?;
    pulse_core::insights::history(&conn, &account_ids, limit.unwrap_or(100)).map_err(err)
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
    let conn = state.conn()?;
    ai_status(&conn, &ai)
}

/// Turning the option off forgets the first-use consent (see pulse_core::ai::set_settings).
#[tauri::command]
fn set_ai_settings(state: State<AppState>, ai: State<AiState>, settings: pulse_core::ai::AiSettingsUpdate) -> Result<AiStatus, String> {
    let conn = state.conn()?;
    pulse_core::ai::set_settings(&conn, &settings).map_err(err)?;
    ai_status(&conn, &ai)
}

/// The user ticked the first-use explanation of the send dialog.
#[tauri::command]
fn record_ai_consent(state: State<AppState>, ai: State<AiState>) -> Result<AiStatus, String> {
    let conn = state.conn()?;
    pulse_core::ai::record_consent(&conn, now_ms()).map_err(err)?;
    ai_status(&conn, &ai)
}

/// Saves or replaces the key in the vault. No network; the error never repeats the key.
#[tauri::command]
fn save_ai_key(state: State<AppState>, ai: State<AiState>, key: String) -> Result<AiStatus, String> {
    let key = zeroize::Zeroizing::new(key);
    pulse_ai::service::save_key(ai.vault.as_ref(), &key).map_err(|e| e.to_string())?;
    let conn = state.conn()?;
    ai_status(&conn, &ai)
}

#[tauri::command]
fn delete_ai_key(state: State<AppState>, ai: State<AiState>) -> Result<AiStatus, String> {
    pulse_ai::service::delete_key(ai.vault.as_ref()).map_err(|e| e.to_string())?;
    let conn = state.conn()?;
    ai_status(&conn, &ai)
}

/// Checks the key and the model (`GET /v1/models/{model}`); sends no trading data. Async: the
/// call runs off the main thread and the database is not locked meanwhile.
#[tauri::command]
async fn test_ai_connection(state: State<'_, AppState>, ai: State<'_, AiState>) -> Result<(), String> {
    let model = {
        let conn = state.conn()?;
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
    let conn = state.conn()?;
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
        let conn = state.conn()?;
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
    let conn = state.conn()?;
    pulse_ai::service::store_analysis(&conn, &prepared, ai.provider.id(), &reply, now_ms()).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_screenshot_notes(state: State<AppState>, trade_id: i64) -> Result<Vec<pulse_core::ai::ScreenshotNote>, String> {
    let conn = state.conn()?;
    pulse_core::ai::list_notes(&conn, trade_id).map_err(err)
}

#[tauri::command]
fn delete_screenshot_note(state: State<AppState>, id: i64) -> Result<(), String> {
    let conn = state.conn()?;
    pulse_core::ai::delete_note(&conn, id).map_err(err)
}

// --- Lot 21 : coach IA (outils locaux en lecture seule dans pulse-core, boucle d'outils dans pulse-ai) ---

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CoachLimits {
    max_question_chars: usize,
    max_tool_calls: usize,
    max_requests: usize,
    max_turns: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CoachToolInfo {
    name: String,
    description: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CoachStatus {
    enabled: bool,
    vault_available: bool,
    key_stored: bool,
    /// When the user accepted the coach's own first-use explanation; `None` = never, or since turned off.
    consent_at: Option<i64>,
    model: String,
    provider: &'static str,
    provider_host: &'static str,
    limits: CoachLimits,
    /// The closed list of tools the AI may call, as sent to it.
    tools: Vec<CoachToolInfo>,
}

fn coach_status(conn: &Connection, ai: &AiState) -> Result<CoachStatus, String> {
    let settings = pulse_core::ai::get_settings(conn).map_err(err)?;
    let key = pulse_ai::service::key_status(ai.vault.as_ref());
    let tools = pulse_core::coach::tools::definitions()
        .as_array()
        .map(|list| {
            list.iter()
                .map(|t| CoachToolInfo { name: t["name"].as_str().unwrap_or_default().to_owned(), description: t["description"].as_str().unwrap_or_default().to_owned() })
                .collect()
        })
        .unwrap_or_default();
    Ok(CoachStatus {
        enabled: settings.enabled,
        vault_available: key.vault_available,
        key_stored: key.stored,
        consent_at: pulse_core::coach::coach_consent_at(conn).map_err(err)?,
        model: settings.model,
        provider: ai.provider.id(),
        provider_host: AI_PROVIDER_HOST,
        limits: CoachLimits {
            max_question_chars: pulse_core::coach::MAX_QUESTION_CHARS,
            max_tool_calls: pulse_core::coach::MAX_TOOL_CALLS,
            max_requests: pulse_core::coach::MAX_REQUESTS,
            max_turns: pulse_core::coach::MAX_TURNS,
        },
        tools,
    })
}

#[tauri::command]
fn get_coach_status(state: State<AppState>, ai: State<AiState>) -> Result<CoachStatus, String> {
    let conn = state.conn()?;
    coach_status(&conn, &ai)
}

/// The user ticked the coach's first-use explanation.
#[tauri::command]
fn record_coach_consent(state: State<AppState>, ai: State<AiState>) -> Result<CoachStatus, String> {
    let conn = state.conn()?;
    pulse_core::coach::record_coach_consent(&conn, now_ms()).map_err(err)?;
    coach_status(&conn, &ai)
}

/// On demand only, after the user clicked « Envoyer » (`confirmed`). Async: the network calls run off the
/// main thread; the database is locked only to prepare, for each tool call, and to store the turn.
#[tauri::command]
async fn ask_coach(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    ai: State<'_, AiState>,
    conversation_id: Option<i64>,
    question: String,
    account_ids: Vec<i64>,
    tz_offset_min: i32,
    confirmed: bool,
) -> Result<pulse_core::coach::CoachTurn, String> {
    let request = pulse_ai::coach::AskRequest { conversation_id, question, account_ids, tz_offset_min, confirmed };
    let prepared = {
        let conn = state.conn()?;
        pulse_ai::coach::prepare_question(&conn, &request, now_ms()).map_err(|e| e.to_string())?
    };
    let (vault, provider) = (ai.vault.clone(), ai.provider.clone());
    let (prepared, result) = tauri::async_runtime::spawn_blocking(move || {
        let mut run_tool = |scope: &pulse_core::coach::ToolScope, name: &str, input: &serde_json::Value| {
            let state = app.state::<AppState>();
            let guard = state.conn();
            match guard {
                Ok(conn) => pulse_core::coach::tools::run(&conn, scope, name, input),
                Err(_) => pulse_core::coach::ToolOutput { content: serde_json::json!({ "error": "Base de données indisponible." }), is_error: true },
            }
        };
        let result = pulse_ai::coach::run_question(&prepared, vault.as_ref(), provider.as_ref(), &mut run_tool);
        (prepared, result)
    })
    .await
    .map_err(err)?;
    let result = result.map_err(|e| e.to_string())?;
    let conn = state.conn()?;
    pulse_ai::coach::store_question(&conn, &prepared, ai.provider.id(), &result, now_ms()).map_err(|e| e.to_string())
}

#[tauri::command]
fn list_coach_conversations(state: State<AppState>) -> Result<Vec<pulse_core::coach::ConversationSummary>, String> {
    let conn = state.conn()?;
    pulse_core::coach::list_conversations(&conn).map_err(err)
}

#[tauri::command]
fn get_coach_conversation(state: State<AppState>, id: i64) -> Result<pulse_core::coach::Conversation, String> {
    let conn = state.conn()?;
    pulse_core::coach::get_conversation(&conn, id).map_err(err)
}

#[tauri::command]
fn rename_coach_conversation(state: State<AppState>, id: i64, title: String) -> Result<pulse_core::coach::ConversationSummary, String> {
    let conn = state.conn()?;
    pulse_core::coach::rename_conversation(&conn, id, &title).map_err(err)
}

#[tauri::command]
fn delete_coach_conversation(state: State<AppState>, id: i64) -> Result<(), String> {
    let conn = state.conn()?;
    pulse_core::coach::delete_conversation(&conn, id).map_err(err)
}

/// Deletes every conversation (the interface asks for confirmation first); returns how many there were.
#[tauri::command]
fn delete_all_coach_conversations(state: State<AppState>) -> Result<usize, String> {
    let conn = state.conn()?;
    pulse_core::coach::delete_all_conversations(&conn).map_err(err)
}

// --- Lot 23 : export PDF d'un bilan de période (3.7.3) ---

/// Writes the period review of one account as a PDF to `path`. `overwrite` = false refuses an existing file
/// (`pdf:fileExists`: the interface asks the user, then calls again with `overwrite = true`).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn export_period_pdf(
    state: State<AppState>,
    account_ids: Vec<i64>,
    from: Option<i64>,
    to: Option<i64>,
    include_account_name: bool,
    tz_offset_min: i32,
    path: String,
    overwrite: bool,
) -> Result<pulse_core::export_pdf::PdfExport, String> {
    let conn = state.conn()?;
    let opts = pulse_core::export_pdf::PdfOptions {
        account_ids,
        from,
        to,
        include_account_name,
        generated_at: now_ms(),
        tz_offset_min,
    };
    pulse_core::export_pdf::write_period_pdf(&conn, &opts, std::path::Path::new(&path), overwrite).map_err(err)
}

// --- Lot 24 : carte de trade partageable (3.7.7) ---

/// R, return in percent and (for the optional « show the PnL » box) net PnL of one trade; never a balance.
#[tauri::command]
fn get_trade_card_figures(state: State<AppState>, trade_id: i64) -> Result<pulse_core::stats::trade_card::TradeCardFigures, String> {
    let conn = state.conn()?;
    pulse_core::stats::trade_card::trade_card_figures(&conn, trade_id).map_err(err)
}

/// Writes the card (PNG drawn by the interface, base64) to the path chosen in the native « save as » dialog.
/// Local only, no network. Unlocked only, like the CSV export.
#[tauri::command]
fn save_trade_card_image(state: State<AppState>, path: String, image: String) -> Result<usize, String> {
    let _open = state.conn()?;
    pulse_core::stats::trade_card::write_png(std::path::Path::new(&path), &image).map_err(err)
}
// Lot 27: position-size calculator. A refusal (stop on the wrong side…) is data, not an error.
#[tauri::command]
fn calculate_position_size(state: State<AppState>, request: pulse_core::sizing::SizingRequest) -> Result<pulse_core::sizing::SizingOutcome, String> {
    let conn = state.conn()?;
    pulse_core::sizing::calculate(&conn, &request).map_err(err)
}
// --- Lot 25 : calendrier économique (3.6.8) ; réseau isolé dans pulse-news, désactivé par défaut ---

#[tauri::command]
fn get_news_status(state: State<AppState>) -> Result<pulse_core::news::NewsStatus, String> {
    let conn = state.conn()?;
    pulse_core::news::settings::status(&conn).map_err(err)
}

#[tauri::command]
fn set_news_settings(state: State<AppState>, settings: pulse_core::news::NewsSettings) -> Result<pulse_core::news::NewsStatus, String> {
    let conn = state.conn()?;
    pulse_core::news::settings::set(&conn, &settings).map_err(err)?;
    pulse_core::news::settings::status(&conn).map_err(err)
}

/// Imports a local ICS or CSV file chosen in the file dialog (no network).
#[tauri::command]
fn import_news_file(
    state: State<AppState>,
    format: pulse_core::news::settings::FileFormat,
    path: String,
    defaults: pulse_core::news::Defaults,
) -> Result<pulse_core::news::ImportSummary, String> {
    let conn = state.conn()?;
    pulse_core::news::settings::import_path(&conn, format, std::path::Path::new(&path), &defaults, now_ms()).map_err(err)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NewsRefresh {
    /// `false` when nothing was fetched (automatic call: off, no source, already tried today).
    fetched: bool,
    summary: Option<pulse_core::news::ImportSummary>,
    status: pulse_core::news::NewsStatus,
}

/// Fetches the online feed. `manual`: the "Actualiser" button (at most once every 5 minutes);
/// otherwise the call made at opening (at most once per Paris day). `pulse-core` decides and
/// records the attempt before anything leaves; the network call runs without holding the database.
#[tauri::command]
async fn refresh_news(state: State<'_, AppState>, manual: bool) -> Result<NewsRefresh, String> {
    let plan = {
        let conn = state.conn()?;
        pulse_core::news::settings::prepare_fetch(&conn, now_ms(), manual).map_err(err)?
    };
    let Some(plan) = plan else {
        let conn = state.conn()?;
        return Ok(NewsRefresh { fetched: false, summary: None, status: pulse_core::news::settings::status(&conn).map_err(err)? });
    };
    let result = fetch_news(plan.clone()).await?;
    let conn = state.conn()?;
    match result {
        Ok(parsed) => {
            let summary = pulse_core::news::settings::finish_fetch(&conn, now_ms(), &plan, parsed).map_err(err)?;
            Ok(NewsRefresh { fetched: true, summary: Some(summary), status: pulse_core::news::settings::status(&conn).map_err(err)? })
        }
        Err(e) => {
            pulse_core::news::settings::fail_fetch(&conn, &e.to_string()).map_err(err)?;
            Err(e.to_string())
        }
    }
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct NewsFilter {
    #[serde(default)]
    importances: Vec<pulse_core::news::Importance>,
    #[serde(default)]
    currencies: Vec<String>,
}

#[tauri::command]
fn get_news_calendar(
    state: State<AppState>,
    view: pulse_core::news::CalendarView,
    filter: NewsFilter,
) -> Result<pulse_core::news::Calendar, String> {
    let conn = state.conn()?;
    pulse_core::news::store::calendar(&conn, now_ms(), view, &filter.importances, &filter.currencies).map_err(err)
}

#[tauri::command]
fn get_upcoming_news(
    state: State<AppState>,
    limit: u32,
    importances: Vec<pulse_core::news::Importance>,
) -> Result<Vec<pulse_core::news::EventView>, String> {
    let conn = state.conn()?;
    pulse_core::news::store::upcoming(&conn, now_ms(), limit, &importances).map_err(err)
}

/// Deletes every stored event (the settings stay).
#[tauri::command]
fn clear_news_events(state: State<AppState>) -> Result<usize, String> {
    let conn = state.conn()?;
    pulse_core::news::store::clear(&conn).map_err(err)
}

// --- Lot 28 : source Forex Factory, « Tester la source » sans rien enregistrer avant confirmation ---

/// Runs the provider of the plan's source off the async runtime, without holding the database.
async fn fetch_news(plan: pulse_core::news::FetchPlan) -> Result<Result<pulse_core::news::Parsed, pulse_news::NewsError>, String> {
    tauri::async_runtime::spawn_blocking(move || match pulse_news::provider(plan.source) {
        Some(provider) => provider.fetch(&plan),
        None => Err(pulse_news::NewsError::UnexpectedResponse),
    })
    .await
    .map_err(err)
}

/// The last successful test, kept in memory only until the trader confirms it (30 minutes at most).
#[derive(Default)]
struct NewsPreviewState(Mutex<Option<(pulse_core::news::FetchPlan, pulse_core::news::Parsed, i64)>>);

const NEWS_PREVIEW_TTL_MS: i64 = 30 * 60_000;

/// Fetches the source typed in the form (not saved) and shows what it answered; nothing is
/// stored. Same 5-minute gap as a refresh (the request counts); an error is returned, not stored.
#[tauri::command]
async fn test_news_source(
    state: State<'_, AppState>,
    preview: State<'_, NewsPreviewState>,
    settings: pulse_core::news::NewsSettings,
) -> Result<pulse_core::news::NewsPreview, String> {
    let plan = {
        let conn = state.conn()?;
        pulse_core::news::settings::prepare_test(&conn, now_ms(), &settings).map_err(err)?
    };
    let parsed = fetch_news(plan.clone()).await?.map_err(|e| e.to_string())?;
    let now = now_ms();
    let shown = pulse_core::news::settings::preview(&parsed, now);
    *preview.0.lock().map_err(err)? = Some((plan, parsed, now));
    Ok(shown)
}

/// Stores the events of the last test once its settings are saved (`news:previewOutdated` otherwise).
#[tauri::command]
fn keep_tested_news(state: State<AppState>, preview: State<NewsPreviewState>) -> Result<NewsRefresh, String> {
    let held = preview.0.lock().map_err(err)?.take();
    let Some((plan, parsed, _)) = held.filter(|(_, _, at)| now_ms() - at <= NEWS_PREVIEW_TTL_MS) else {
        return Err("news:previewOutdated".into());
    };
    let conn = state.conn()?;
    let summary = pulse_core::news::settings::keep_tested(&conn, now_ms(), &plan, parsed).map_err(err)?;
    Ok(NewsRefresh { fetched: true, summary: Some(summary), status: pulse_core::news::settings::status(&conn).map_err(err)? })
}

// --- Lot 31: pre-trade analysis, ideas to watch, morning review (every command reads the database, so a
// locked application answers `lock:locked` and nothing is written) ---

#[tauri::command]
fn get_analysis_questions(state: State<AppState>, include_archived: bool) -> Result<Vec<Question>, String> {
    let conn = state.conn()?;
    analysis::questions::list(&conn, include_archived).map_err(err)
}

#[tauri::command]
fn add_analysis_question(state: State<AppState>, label: String, kind: QuestionKind, options: serde_json::Value) -> Result<Question, String> {
    let conn = state.conn()?;
    analysis::questions::add(&conn, &label, kind, &options).map_err(err)
}

#[tauri::command]
fn update_analysis_question(state: State<AppState>, id: i64, label: Option<String>, options: Option<serde_json::Value>) -> Result<Question, String> {
    let conn = state.conn()?;
    analysis::questions::update(&conn, id, label.as_deref(), options.as_ref()).map_err(err)
}

#[tauri::command]
fn move_analysis_question(state: State<AppState>, id: i64, delta: i32) -> Result<Vec<Question>, String> {
    let conn = state.conn()?;
    analysis::questions::move_by(&conn, id, delta).map_err(err)
}

#[tauri::command]
fn set_analysis_question_archived(state: State<AppState>, id: i64, archived: bool) -> Result<Question, String> {
    let conn = state.conn()?;
    analysis::questions::set_archived(&conn, id, archived).map_err(err)
}

#[tauri::command]
fn create_analysis(state: State<AppState>, input: AnalysisInput) -> Result<Analysis, String> {
    let conn = state.conn()?;
    analysis::sessions::create(&conn, &input, now_ms()).map_err(err)
}

#[tauri::command]
fn update_analysis(state: State<AppState>, id: i64, input: AnalysisInput) -> Result<Analysis, String> {
    let conn = state.conn()?;
    analysis::sessions::update(&conn, id, &input, now_ms()).map_err(err)
}

#[tauri::command]
fn delete_analysis(state: State<AppState>, id: i64) -> Result<(), String> {
    let conn = state.conn()?;
    analysis::sessions::delete(&conn, id).map_err(err)
}

#[tauri::command]
fn list_analyses_of_day(state: State<AppState>, day: String) -> Result<Vec<Analysis>, String> {
    let conn = state.conn()?;
    analysis::sessions::list_day(&conn, &day).map_err(err)
}

#[tauri::command]
fn list_analyses_before(state: State<AppState>, day: String, limit: u32) -> Result<Vec<Analysis>, String> {
    let conn = state.conn()?;
    analysis::sessions::list_before(&conn, &day, limit).map_err(err)
}

#[tauri::command]
fn get_news_block(state: State<AppState>, day: Option<String>) -> Result<NewsBlock, String> {
    let conn = state.conn()?;
    analysis::news_block::news_block(&conn, day.as_deref(), now_ms()).map_err(err)
}

#[tauri::command]
fn create_idea(state: State<AppState>, input: IdeaInput) -> Result<analysis::Idea, String> {
    let conn = state.conn()?;
    analysis::ideas::create(&conn, &input, now_ms()).map_err(err)
}

#[tauri::command]
fn update_idea(state: State<AppState>, id: i64, input: IdeaInput) -> Result<analysis::Idea, String> {
    let conn = state.conn()?;
    analysis::ideas::update(&conn, id, &input, now_ms()).map_err(err)
}

#[tauri::command]
fn list_ideas(state: State<AppState>, status: IdeaStatus, instrument_id: Option<i64>, tz_offset_min: i32) -> Result<Vec<IdeaView>, String> {
    let conn = state.conn()?;
    analysis::ideas::list_views(&conn, status, instrument_id, now_ms(), tz_offset_min).map_err(err)
}

#[tauri::command]
fn get_review_queue(state: State<AppState>, tz_offset_min: i32) -> Result<ReviewQueue, String> {
    let conn = state.conn()?;
    analysis::review::queue(&conn, now_ms(), tz_offset_min).map_err(err)
}

#[tauri::command]
fn get_review_banner(state: State<AppState>, tz_offset_min: i32) -> Result<Option<ReviewBanner>, String> {
    let conn = state.conn()?;
    analysis::review::banner(&conn, now_ms(), tz_offset_min).map_err(err)
}

#[tauri::command]
fn dismiss_review_banner(state: State<AppState>, tz_offset_min: i32) -> Result<(), String> {
    let conn = state.conn()?;
    analysis::review::dismiss_banner(&conn, now_ms(), tz_offset_min).map_err(err)
}

#[tauri::command]
fn idea_keep(state: State<AppState>, id: i64, tz_offset_min: i32) -> Result<IdeaView, String> {
    let conn = state.conn()?;
    analysis::review::keep(&conn, id, now_ms(), tz_offset_min).map_err(err)
}

#[tauri::command]
fn idea_complete(state: State<AppState>, id: i64, body: String, tz_offset_min: i32) -> Result<IdeaView, String> {
    let conn = state.conn()?;
    analysis::review::complete(&conn, id, &body, now_ms(), tz_offset_min).map_err(err)
}

#[tauri::command]
fn idea_snooze(state: State<AppState>, id: i64, days: u32, tz_offset_min: i32) -> Result<IdeaView, String> {
    let conn = state.conn()?;
    analysis::review::snooze(&conn, id, days, now_ms(), tz_offset_min).map_err(err)
}

#[tauri::command]
fn idea_close(state: State<AppState>, id: i64, outcome: IdeaOutcome, reason: Option<String>, tz_offset_min: i32) -> Result<IdeaView, String> {
    let conn = state.conn()?;
    analysis::review::close(&conn, id, outcome, reason.as_deref(), now_ms(), tz_offset_min).map_err(err)
}

#[tauri::command]
fn idea_delete(state: State<AppState>, id: i64, tz_offset_min: i32) -> Result<(), String> {
    let conn = state.conn()?;
    analysis::review::delete(&conn, id, now_ms(), tz_offset_min).map_err(err)
}

#[tauri::command]
fn get_analysis_settings(state: State<AppState>) -> Result<AnalysisSettings, String> {
    let conn = state.conn()?;
    analysis::review::settings(&conn).map_err(err)
}

#[tauri::command]
fn set_analysis_settings(state: State<AppState>, settings: AnalysisSettings) -> Result<AnalysisSettings, String> {
    let conn = state.conn()?;
    analysis::review::set_settings(&conn, &settings).map_err(err)
}

#[tauri::command]
fn get_trade_links(state: State<AppState>, trade_id: i64) -> Result<TradeLinks, String> {
    let conn = state.conn()?;
    analysis::links::get(&conn, trade_id).map_err(err)
}

#[tauri::command]
fn set_trade_links(state: State<AppState>, trade_id: i64, idea_ids: Vec<i64>, analysis_ids: Vec<i64>) -> Result<TradeLinks, String> {
    let conn = state.conn()?;
    analysis::links::set(&conn, trade_id, &idea_ids, &analysis_ids).map_err(err)
}

#[tauri::command]
fn get_analysis_report(state: State<AppState>, query: StatsQuery) -> Result<AnalysisReport, String> {
    let conn = state.conn()?;
    analysis::report::report(&conn, &query).map_err(err)
}
// --- Lot 32 : sauvegarde automatique planifiée ---
//
// Every rule lives in `pulse_core::backup_auto`; the shell reads the clock, holds the database for
// the database copy only (the screenshots are copied, read back and renamed without it), and tells
// the interface that something changed.

use pulse_core::backup_auto::{self, AutoBackupEntry, AutoBackupSettings, AutoBackupStatus, BackupError, Copied, Decision, Done, FolderCheck};

/// Event sent to the interface after every automatic backup attempt (success or failure).
const AUTO_BACKUP_EVENT: &str = "pulse://auto-backup";

/// Wakes the background loop at once (settings saved, database unlocked).
#[derive(Default)]
struct AutoBackupState {
    kick: Mutex<Option<std::sync::mpsc::Sender<()>>>,
}

pub(crate) fn kick_auto_backup(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<AutoBackupState>() {
        if let Ok(Some(tx)) = state.kick.lock().as_deref() {
            let _ = tx.send(());
        }
    }
}

/// One backup, in the five phases of `pulse_core::backup_auto`. `Ok(None)`: nothing to do
/// (locked, disabled, not due, another backup or a restore running).
fn run_auto_backup(app: &tauri::AppHandle, manual: bool) -> Result<Option<Result<Done, BackupError>>, String> {
    let state = app.state::<AppState>();
    let tz = local_tz_offset_min();
    let plan = {
        // Locked: the turn is skipped, nothing is read or written.
        let conn = match state.conn() {
            Ok(conn) => conn,
            Err(e) if manual => return Err(e),
            Err(_) => return Ok(None),
        };
        match backup_auto::plan(Some(&conn), &state.data_dir, now_ms(), tz, manual).map_err(err)? {
            Decision::Run(plan) => plan,
            _ => return Ok(None),
        }
    };
    let started = plan.started_at();
    let result = plan
        .stage(&state.data_dir)
        .and_then(|staged| {
            // The database is held for its copy only.
            let conn = state.conn().map_err(|_| BackupError::Locked)?;
            staged.copy_database(&conn, &state.data_dir)
        })
        .and_then(Copied::finish);
    if let Ok(conn) = state.conn() {
        if let Err(e) = backup_auto::record(&conn, started, &result) {
            eprintln!("Pulse: could not record the automatic backup result: {e}");
        }
    }
    if let Err(e) = &result {
        eprintln!("Pulse: automatic backup failed: {e}");
    }
    let _ = app.emit(AUTO_BACKUP_EVENT, ());
    Ok(Some(result))
}

/// Checks shortly after startup, then every 30 minutes while the application is open. Locked: the
/// turn is skipped and the loop looks again every minute, so the check happens soon after unlock.
fn spawn_auto_backup_loop(app: tauri::AppHandle) {
    let (tx, rx) = std::sync::mpsc::channel::<()>();
    if let Ok(mut slot) = app.state::<AutoBackupState>().kick.lock() {
        *slot = Some(tx);
    }
    std::thread::spawn(move || {
        let interval = std::time::Duration::from_millis(backup_auto::CHECK_INTERVAL_MS as u64);
        // First check a few seconds after startup (the window opens first).
        let mut next = std::time::Instant::now() + std::time::Duration::from_secs(10);
        loop {
            let wait = next.saturating_duration_since(std::time::Instant::now()).min(std::time::Duration::from_secs(60));
            let kicked = matches!(rx.recv_timeout(wait), Ok(()));
            if !kicked && std::time::Instant::now() < next {
                continue;
            }
            if app.state::<AppState>().conn().is_err() {
                // Locked (or the database is unavailable): try again in a minute, without a record.
                next = std::time::Instant::now() + std::time::Duration::from_secs(60);
                continue;
            }
            let _ = run_auto_backup(&app, false);
            next = std::time::Instant::now() + interval;
        }
    });
}

#[tauri::command]
fn get_auto_backup_status(state: State<AppState>, tz_offset_min: i32) -> Result<AutoBackupStatus, String> {
    let conn = state.conn()?;
    backup_auto::status(&conn, &state.data_dir, now_ms(), tz_offset_min).map_err(err)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AutoBackupSaved {
    status: AutoBackupStatus,
    folder_check: Option<FolderCheck>,
}

/// Off the main thread: the folder is checked (a disconnected drive can be slow to answer).
#[tauri::command]
async fn set_auto_backup_settings(app: tauri::AppHandle, settings: AutoBackupSettings, tz_offset_min: i32) -> Result<AutoBackupSaved, String> {
    let handle = app.clone();
    let saved = tauri::async_runtime::spawn_blocking(move || -> Result<AutoBackupSaved, String> {
        let state = handle.state::<AppState>();
        let conn = state.conn()?;
        let (_, folder_check) = backup_auto::set_settings(&conn, &state.data_dir, &settings).map_err(err)?;
        let status = backup_auto::status(&conn, &state.data_dir, now_ms(), tz_offset_min).map_err(err)?;
        Ok(AutoBackupSaved { status, folder_check })
    })
    .await
    .map_err(err)??;
    kick_auto_backup(&app);
    Ok(saved)
}

/// Checks a folder chosen in the dialog before saving it (inside the data folder, writable, same drive).
#[tauri::command]
async fn check_auto_backup_folder(app: tauri::AppHandle, folder: String) -> Result<FolderCheck, String> {
    let data_dir = app.state::<AppState>().data_dir.clone();
    tauri::async_runtime::spawn_blocking(move || backup_auto::check_folder(&data_dir, &folder).map_err(err)).await.map_err(err)?
}

/// « Sauvegarder maintenant »: same atomic path, no schedule and no delay.
#[tauri::command]
async fn run_auto_backup_now(app: tauri::AppHandle) -> Result<Done, String> {
    let handle = app.clone();
    match tauri::async_runtime::spawn_blocking(move || run_auto_backup(&handle, true)).await.map_err(err)?? {
        Some(result) => result.map_err(err),
        None => Err(BackupError::Busy.to_string()),
    }
}

/// The automatic backups present in the chosen folder (off the main thread: sizes are computed).
#[tauri::command]
async fn list_auto_backups(app: tauri::AppHandle) -> Result<Vec<AutoBackupEntry>, String> {
    let folder = {
        let state = app.state::<AppState>();
        let conn = state.conn()?;
        backup_auto::get_settings(&conn).map_err(err)?.folder
    };
    let Some(folder) = folder else { return Ok(Vec::new()) };
    tauri::async_runtime::spawn_blocking(move || backup_auto::list(std::path::Path::new(&folder))).await.map_err(err)
}

/// « Activer » (the interface then opens the settings; nothing is enabled here) or « Plus tard ».
#[tauri::command]
fn answer_auto_backup_invite(state: State<AppState>, accept: bool) -> Result<(), String> {
    let conn = state.conn()?;
    backup_auto::answer_invite(&conn, now_ms(), accept).map_err(err)
}

/// Opens the chosen folder in the file explorer (only this folder, never a path sent by the interface).
#[tauri::command]
fn open_auto_backup_folder(state: State<AppState>) -> Result<(), String> {
    let folder = {
        let conn = state.conn()?;
        backup_auto::get_settings(&conn).map_err(err)?.folder.ok_or_else(|| BackupError::NoFolder.to_string())?
    };
    if !std::path::Path::new(&folder).is_dir() {
        return Err(BackupError::FolderNotFound.to_string());
    }
    #[cfg(target_os = "windows")]
    let program = "explorer";
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let program = "xdg-open";
    std::process::Command::new(program).arg(&folder).spawn().map(|_| ()).map_err(|_| BackupError::Io.to_string())
}
// --- Lot 33 : suivi d'un compte prop firm (trades clôturés seulement ; aucune perte latente devinée) ---

#[tauri::command]
fn get_prop_rules(state: State<AppState>, account_id: i64) -> Result<Option<pulse_core::prop::PropRules>, String> {
    let conn = state.conn()?;
    pulse_core::prop::rules::require_prop_account(&conn, account_id).map_err(err)?;
    pulse_core::prop::rules::get(&conn, account_id).map_err(err)
}

/// Validates (codes `prop:<code>`) and saves the rules of a prop account.
#[tauri::command]
fn set_prop_rules(state: State<AppState>, account_id: i64, rules: pulse_core::prop::PropRulesInput) -> Result<pulse_core::prop::PropRules, String> {
    let conn = state.conn()?;
    pulse_core::prop::rules::set(&conn, account_id, &rules, now_ms()).map_err(err)
}

#[tauri::command]
fn delete_prop_rules(state: State<AppState>, account_id: i64) -> Result<(), String> {
    let conn = state.conn()?;
    pulse_core::prop::rules::delete(&conn, account_id).map_err(err)
}

/// Status of a prop account at the instant read here (`None` = no rules). The trading day comes from
/// the firm's reset time and zone, never from the PC: `tz_offset_min` is accepted like the alert
/// commands but no figure depends on it.
#[tauri::command]
fn get_prop_status(state: State<AppState>, account_id: i64, tz_offset_min: i32) -> Result<Option<pulse_core::prop::PropStatus>, String> {
    let _ = tz_offset_min;
    let conn = state.conn()?;
    pulse_core::prop::status(&conn, account_id, now_ms()).map_err(err)
}

/// Setting `alerts.prop` (on by default).
#[tauri::command]
fn set_prop_alerts(state: State<AppState>, enabled: bool) -> Result<bool, String> {
    let conn = state.conn()?;
    alerts::prop::set_enabled(&conn, enabled).map_err(err)
}
// --- Lot 35 : pause volontaire (un rappel, jamais un blocage : aucune autre commande n'en tient compte) ---
// Toutes passent par `state.conn()` : verrouillé, elles répondent `lock:locked`.

#[tauri::command]
fn start_pause(state: State<AppState>, pause: pulse_core::pause::NewPause) -> Result<pulse_core::pause::Pause, String> {
    let conn = state.conn()?;
    pulse_core::pause::start(&conn, &pause, now_ms()).map_err(err)
}

/// Ends the running pause now; `null` when none runs (it may have just ended by itself).
#[tauri::command]
fn end_pause(state: State<AppState>) -> Result<Option<pulse_core::pause::Pause>, String> {
    let conn = state.conn()?;
    pulse_core::pause::end(&conn, now_ms()).map_err(err)
}

#[tauri::command]
fn get_current_pause(state: State<AppState>) -> Result<Option<pulse_core::pause::CurrentPause>, String> {
    let conn = state.conn()?;
    pulse_core::pause::current(&conn, now_ms()).map_err(err)
}

#[tauri::command]
fn list_pauses(state: State<AppState>, account_ids: Vec<i64>, limit: Option<u32>) -> Result<Vec<pulse_core::pause::PauseRow>, String> {
    let conn = state.conn()?;
    pulse_core::pause::list(&conn, &account_ids, limit.unwrap_or(20), now_ms()).map_err(err)
}

#[tauri::command]
fn get_pause_report(state: State<AppState>, query: StatsQuery) -> Result<pulse_core::pause::PauseReport, String> {
    let conn = state.conn()?;
    pulse_core::pause::report(&conn, &query).map_err(err)
}

/// A proposal only (`null` when off, not reached, or a pause is running): it never starts a pause.
#[tauri::command]
fn get_pause_suggestion(state: State<AppState>, account_ids: Vec<i64>, tz_offset_min: i32) -> Result<Option<pulse_core::pause::Suggestion>, String> {
    let conn = state.conn()?;
    pulse_core::pause::suggestion_report(&conn, &account_ids, now_ms(), tz_offset_min).map_err(err)
}

#[tauri::command]
fn get_pause_settings(state: State<AppState>) -> Result<pulse_core::pause::Settings, String> {
    let conn = state.conn()?;
    pulse_core::pause::settings(&conn).map_err(err)
}

#[tauri::command]
fn set_pause_settings(state: State<AppState>, settings: pulse_core::pause::Settings) -> Result<pulse_core::pause::Settings, String> {
    let conn = state.conn()?;
    pulse_core::pause::set_settings(&conn, &settings).map_err(err)
}
