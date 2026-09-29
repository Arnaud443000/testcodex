use pulse_core::accounts::{self, Account, NewAccount};
use pulse_core::checklist::{self, ChecklistItem};
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

pub fn run() {
    tauri::Builder::default()
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
            list_checklist,
            create_checklist_item,
            list_trades,
            get_trade,
            create_trade,
            update_trade,
            delete_trade,
            preview_trade,
            get_dashboard,
            get_calendar,
            get_day_trades,
            save_screenshot,
            read_screenshot
        ])
        .run(tauri::generate_context!())
        .expect("error while running Pulse");
}
