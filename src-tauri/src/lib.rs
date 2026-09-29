use pulse_core::accounts::{self, Account, AccountUpdate, NewAccount};
use pulse_core::cash_flows::{self, CashFlow, NewCashFlow};
use pulse_core::backup::{self, BackupInfo, RestoreResult};
use pulse_core::checklist::{self, ChecklistItem};
use pulse_core::export;
use pulse_core::instruments::{self, Instrument, NewInstrument};
use pulse_core::rules::{self, Rule};
use pulse_core::stats::dashboard::{self, Calendar, CalendarQuery, Dashboard, DashboardQuery, DayTrade};
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
    trade_view::get(&conn, saved.id).map_err(err)
}

#[tauri::command]
fn update_trade(state: State<AppState>, id: i64, trade: TradeData) -> Result<TradeView, String> {
    let conn = state.db.lock().map_err(err)?;
    trades::update(&conn, id, &trade).map_err(err)?;
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

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let conn = db::open(&data_dir).map_err(err)?;
            app.manage(AppState { db: Mutex::new(conn), data_dir });
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
            export_trades_csv,
            create_backup,
            inspect_backup,
            restore_backup,
            save_screenshot,
            read_screenshot,
            update_account,
            set_account_archived
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
