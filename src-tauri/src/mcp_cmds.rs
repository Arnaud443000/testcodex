//! Lot 37: local MCP access. Thin: the bridge, the rules and the log live in `pulse_core::mcp`.
//!
//! Lock order: the MCP runtime and the database are **never** held at the same time (a tool call holds
//! the database only; commands read the database, release it, then touch the runtime).

use crate::{err, local_tz_offset_min, now_ms, AppState};
use pulse_core::mcp::{self, BridgeHost, InstallCommand, Limits, McpCall, McpRuntime, McpSettingsUpdate, McpStatus, StopReason};
use pulse_mcp::server::ToolReply;
use serde_json::Value;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

/// Sent when the access went off by itself (duration over, lock) so the top bar updates.
pub(crate) const MCP_CHANGED_EVENT: &str = "pulse://mcp-changed";

#[derive(Default)]
pub(crate) struct McpState {
    runtime: Mutex<McpRuntime>,
}

/// The bridge's host: each tool call takes the open database for the time of the tool only.
struct AppHost {
    app: AppHandle,
}

impl BridgeHost for AppHost {
    fn run_tool(&self, tool: &str, arguments: &Value) -> ToolReply {
        let state = self.app.state::<AppState>();
        // Bound to a local so the database guard is released before `state` goes.
        #[allow(clippy::let_and_return)]
        let reply = match state.conn() {
            // Locked (or closed): nothing is read, nothing is logged.
            Err(_) => mcp::locked_reply(),
            Ok(conn) => mcp::run_logged(&conn, now_ms(), local_tz_offset_min(), tool, arguments),
        };
        reply
    }
}

fn runtime_status(app: &AppHandle) -> Result<mcp::RuntimeStatus, String> {
    Ok(app.state::<McpState>().runtime.lock().map_err(err)?.status())
}

fn status_of(app: &AppHandle) -> Result<McpStatus, String> {
    let runtime = runtime_status(app)?;
    let state = app.state::<AppState>();
    let conn = state.conn()?;
    mcp::status(&conn, runtime).map_err(err)
}

/// Starts (or restarts, with a new token) the bridge from the saved settings.
fn start(app: &AppHandle) -> Result<(), String> {
    let (settings, exposed) = {
        let state = app.state::<AppState>();
        let conn = state.conn()?;
        let s = mcp::settings::get(&conn).map_err(err)?;
        let exposed = mcp::settings::exposed_accounts(&conn, &s).map_err(err)?;
        (s, exposed)
    };
    let data_dir = app.state::<AppState>().data_dir.clone();
    let host: Arc<dyn BridgeHost> = Arc::new(AppHost { app: app.clone() });
    let mcp_state = app.state::<McpState>();
    let mut rt = mcp_state.runtime.lock().map_err(err)?;
    rt.start(&settings, &exposed, &data_dir, host, Limits::default(), mcp::system_clock()).map_err(err)
}

/// Turns the access off (if on). Never touches the database.
pub(crate) fn stop(app: &AppHandle, reason: StopReason) -> bool {
    let stopped = app.state::<McpState>().runtime.lock().map(|mut rt| rt.stop(reason, now_ms())).unwrap_or(false);
    if stopped {
        let _ = app.emit(MCP_CHANGED_EVENT, ());
    }
    stopped
}

/// At the first opening of the database in this run (launch, or first unlock): « Rester activé au
/// prochain démarrage ». A failure is only logged (the user turns it on by hand).
pub(crate) fn maybe_autostart(app: &AppHandle) {
    let due = app.state::<McpState>().runtime.lock().map(|mut rt| rt.take_autostart()).unwrap_or(false);
    if !due {
        return;
    }
    let wanted = {
        let state = app.state::<AppState>();
        let Ok(conn) = state.conn() else { return };
        mcp::settings::get(&conn).is_ok_and(|s| s.autostart && s.consent_at.is_some())
    };
    if wanted {
        match start(app) {
            Ok(()) => {
                let _ = app.emit(MCP_CHANGED_EVENT, ());
            }
            Err(e) => eprintln!("Pulse: the MCP access could not start at launch ({e})"),
        }
    }
}

/// Every 5 s: ends the access when its duration has run out.
pub(crate) fn spawn_expiry_loop(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(5));
        let stopped = app.state::<McpState>().runtime.lock().map(|mut rt| rt.tick(now_ms())).unwrap_or(false);
        if stopped {
            let _ = app.emit(MCP_CHANGED_EVENT, ());
        }
    });
}

#[tauri::command]
pub fn get_mcp_status(app: AppHandle) -> Result<McpStatus, String> {
    status_of(&app)
}

/// Saves the exposed accounts, the duration and « next launch ». If no exposed account is left while
/// the access is on, it goes off.
#[tauri::command]
pub fn set_mcp_settings(app: AppHandle, settings: McpSettingsUpdate) -> Result<McpStatus, String> {
    let empty = {
        let state = app.state::<AppState>();
        let conn = state.conn()?;
        let s = mcp::settings::set(&conn, &settings).map_err(err)?;
        mcp::settings::exposed_accounts(&conn, &s).map_err(err)?.is_empty()
    };
    if empty {
        stop(&app, StopReason::Settings);
    }
    status_of(&app)
}

/// `confirmed` = the consent box is ticked (recorded the first time; refused without it).
#[tauri::command]
pub fn enable_mcp(app: AppHandle, confirmed: bool) -> Result<McpStatus, String> {
    {
        let state = app.state::<AppState>();
        let conn = state.conn()?;
        let s = mcp::settings::get(&conn).map_err(err)?;
        if s.consent_at.is_none() {
            if !confirmed {
                return Err("invalid input: mcp:consentRequired".into());
            }
            mcp::settings::record_consent(&conn, now_ms()).map_err(err)?;
        }
    }
    start(&app)?;
    status_of(&app)
}

/// « Couper l'accès maintenant »: port closed, file removed, token useless at once. With
/// `withdraw_consent`, the consent (and « next launch ») goes too.
#[tauri::command]
pub fn disable_mcp(app: AppHandle, withdraw_consent: bool) -> Result<McpStatus, String> {
    stop(&app, if withdraw_consent { StopReason::Settings } else { StopReason::Manual });
    if withdraw_consent {
        let state = app.state::<AppState>();
        let conn = state.conn()?;
        mcp::settings::withdraw_consent(&conn).map_err(err)?;
    }
    status_of(&app)
}

#[tauri::command]
pub fn list_mcp_calls(state: State<AppState>, limit: Option<i64>) -> Result<Vec<McpCall>, String> {
    let conn = state.conn()?;
    mcp::log::list(&conn, limit).map_err(err)
}

#[tauri::command]
pub fn clear_mcp_calls(state: State<AppState>) -> Result<usize, String> {
    let conn = state.conn()?;
    mcp::log::clear(&conn).map_err(err)
}

/// The exact command to copy, with the real path of pulse-mcp next to Pulse.
#[tauri::command]
pub fn get_mcp_install_command(state: State<AppState>) -> Result<InstallCommand, String> {
    let exe = std::env::current_exe().map_err(err)?;
    let dir = exe.parent().ok_or_else(|| "mcp:noExeDir".to_owned())?;
    let mcp_exe = dir.join(if cfg!(windows) { "pulse-mcp.exe" } else { "pulse-mcp" });
    let data_dir = state.data_dir.to_string_lossy().into_owned();
    let default = pulse_mcp::default_data_dir().map(|d| d.to_string_lossy().into_owned());
    Ok(mcp::install_command(&mcp_exe.to_string_lossy(), mcp_exe.is_file(), &data_dir, default.as_deref()))
}
