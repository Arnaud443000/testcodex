use pulse_core::accounts::{self, Account, NewAccount};
use pulse_core::{db, migrations, rusqlite::Connection};
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

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            let conn = db::open(&data_dir).map_err(err)?;
            app.manage(AppState { db: Mutex::new(conn), data_dir });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![app_info, list_accounts, create_account, delete_account])
        .run(tauri::generate_context!())
        .expect("error while running Pulse");
}
