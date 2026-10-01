//! Lot 22: commands of the optional password lock. Thin: every rule lives in `pulse_core::lock`.
//! The password arrives as a `String` from the interface and is moved at once into a `Password`,
//! whose buffer is wiped when dropped (the IPC copies made by Tauri and the JavaScript string
//! cannot be wiped: documented limit). No command returns a password or a key.

use crate::{AppState, err, now_ms};
use pulse_core::lock::{self, KdfParams, LockError, LockStatus, Password, Store};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

/// Event sent to the interface when the database has just been locked (manually or after
/// inactivity): it shows the unlock screen.
pub(crate) const LOCKED_EVENT: &str = "pulse://locked";
/// Event sent when the encrypted file could not be written: the data is only in memory.
pub(crate) const PERSIST_FAILED_EVENT: &str = "pulse://persist-failed";

/// In-memory state of the lock in the shell (nothing secret).
pub(crate) struct LockRuntime {
    /// `lock:inconsistentFiles` when both database files were found at startup.
    pub warning: Option<String>,
    /// Last user activity reported by the interface (keyboard, mouse, scroll).
    pub last_activity_ms: i64,
}

fn touch(state: &AppState) {
    if let Ok(mut r) = state.lock.lock() {
        r.last_activity_ms = now_ms();
    }
}

fn status_of(state: &AppState) -> Result<LockStatus, String> {
    let warning = state.lock.lock().map_err(err)?.warning.clone();
    let guard = state.db.lock().map_err(err)?;
    lock::status(&state.data_dir, guard.as_ref(), warning, now_ms()).map_err(err)
}

/// Available while locked: the unlock screen needs it.
#[tauri::command]
pub fn get_lock_status(state: State<AppState>) -> Result<LockStatus, String> {
    status_of(&state)
}

/// Opens the encrypted database. Argon2id takes a fraction of a second: off the main thread.
#[tauri::command]
pub async fn unlock_database(app: AppHandle, password: String) -> Result<LockStatus, String> {
    let password = Password::new(password);
    let state = app.state::<AppState>();
    if state.db.lock().map_err(err)?.is_none() {
        let dir = state.data_dir.clone();
        let store = tauri::async_runtime::spawn_blocking(move || Store::unlock(&dir, &password, now_ms())).await.map_err(err)?.map_err(err)?;
        let mut slot = state.db.lock().map_err(err)?;
        if slot.is_none() {
            *slot = Some(store);
        }
    }
    touch(&state);
    // Lot 32: an automatic backup skipped while locked can run now.
    crate::kick_auto_backup(&app);
    // Lot 37: « next launch » of an encrypted database is applied at its first unlock.
    crate::mcp_cmds::maybe_autostart(&app);
    status_of(&state)
}

/// Runs `f` on the open database in a blocking thread (key derivation, whole-file writes).
pub(crate) async fn on_store<T: Send + 'static>(
    app: &AppHandle,
    f: impl FnOnce(&mut Store) -> pulse_core::Result<T> + Send + 'static,
) -> Result<T, String> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let mut slot = state.db.lock().map_err(err)?;
        let store = slot.as_mut().ok_or_else(|| LockError::Locked.to_string())?;
        f(store).map_err(err)
    })
    .await
    .map_err(err)?
}

/// Activation: `confirmed` = the user ticked "a lost password means lost data".
#[tauri::command]
pub async fn enable_lock(app: AppHandle, password: String, confirmed: bool, encrypt_copies: bool) -> Result<LockStatus, String> {
    let password = Password::new(password);
    // Lot 32: the screenshots are rewritten: never while a backup copies them (`backup:busy`).
    on_store(&app, move |s| {
        let _busy = pulse_core::backup_auto::exclusive(s.data_dir())?;
        s.enable(&password, confirmed, encrypt_copies, KdfParams::RECOMMENDED)
    })
    .await?;
    let state = app.state::<AppState>();
    touch(&state);
    status_of(&state)
}

#[tauri::command]
pub async fn disable_lock(app: AppHandle, password: String) -> Result<LockStatus, String> {
    let password = Password::new(password);
    on_store(&app, move |s| {
        let _busy = pulse_core::backup_auto::exclusive(s.data_dir())?;
        s.disable(&password, now_ms())
    })
    .await?;
    status_of(&app.state::<AppState>())
}

#[tauri::command]
pub async fn change_lock_password(app: AppHandle, old_password: String, new_password: String) -> Result<LockStatus, String> {
    let (old, new) = (Password::new(old_password), Password::new(new_password));
    on_store(&app, move |s| s.change_password(&old, &new, KdfParams::RECOMMENDED, now_ms())).await?;
    status_of(&app.state::<AppState>())
}

/// Writes what is pending, closes the database and forgets the keys. Refused (data kept) if the
/// encrypted file cannot be written.
pub(crate) fn lock_store(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    // A plain database cannot be locked: refused before anything changes (the MCP access included).
    match state.db.lock().map_err(err)?.as_ref() {
        None => return Ok(()),
        Some(store) if !store.is_encrypted() => return Err(LockError::NotEncrypted.to_string()),
        Some(_) => {}
    }
    // Lot 37: the MCP access goes off first (port closed, endpoint file removed), with the database lock
    // released (the MCP runtime is never locked while the database lock is awaited).
    crate::mcp_cmds::stop(app, pulse_core::mcp::StopReason::Locked);
    let mut slot = state.db.lock().map_err(err)?;
    let Some(store) = slot.take() else { return Ok(()) };
    if !store.is_encrypted() {
        *slot = Some(store);
        return Err(LockError::NotEncrypted.to_string());
    }
    if let Err(failed) = store.close() {
        let (store, e) = *failed;
        *slot = Some(store);
        drop(slot);
        let _ = app.emit(PERSIST_FAILED_EVENT, ());
        return Err(err(e));
    }
    drop(slot);
    let _ = app.emit(LOCKED_EVENT, ());
    Ok(())
}

#[tauri::command]
pub fn lock_now(app: AppHandle) -> Result<LockStatus, String> {
    lock_store(&app)?;
    status_of(&app.state::<AppState>())
}

/// `None` = never lock on inactivity (the default).
#[tauri::command]
pub fn set_lock_idle(state: State<AppState>, minutes: Option<u32>) -> Result<LockStatus, String> {
    {
        let conn = state.conn()?;
        lock::set_idle_minutes(&conn, minutes).map_err(err)?;
    }
    touch(&state);
    status_of(&state)
}

/// The interface reports user activity (at most every 30 s); automatic calls do not count.
#[tauri::command]
pub fn lock_touch(state: State<AppState>) {
    touch(&state);
}

/// Tries again to write the encrypted file after a failure.
#[tauri::command]
pub fn retry_persist(state: State<AppState>) -> Result<LockStatus, String> {
    {
        let mut slot = state.db.lock().map_err(err)?;
        if let Some(store) = slot.as_mut() {
            store.flush().map_err(err)?;
        }
    }
    status_of(&state)
}

/// After a write failure the user may choose to close anyway (losing what is only in memory).
#[tauri::command]
pub fn quit_discarding_changes(app: AppHandle) {
    app.exit(0);
}

/// Every 15 s: locks the encrypted database after the chosen time without activity.
pub(crate) fn spawn_idle_loop(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(15));
        let state = app.state::<AppState>();
        let due = {
            let Ok(slot) = state.db.lock() else { continue };
            let Some(store) = slot.as_ref().filter(|s| s.is_encrypted()) else { continue };
            let Ok(Some(minutes)) = lock::idle_minutes(store.conn()) else { continue };
            let last = state.lock.lock().map(|r| r.last_activity_ms).unwrap_or(i64::MAX);
            now_ms().saturating_sub(last) >= i64::from(minutes) * 60_000
        };
        if due {
            let _ = lock_store(&app);
        }
    });
}
