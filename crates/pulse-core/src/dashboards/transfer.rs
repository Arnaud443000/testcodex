//! Duplicating, exporting and importing a dashboard (spec 3.8.7).
//!
//! The configuration file is versioned JSON (`format` = [`FORMAT`], `version` = [`FORMAT_VERSION`]) holding
//! the name, the scope and the widgets of ONE dashboard, without any id of this database: an account is
//! written as `{name, currency}` so the file still means something on another PC. Importing is strict and
//! all-or-nothing: the whole file is checked, then written in one transaction, and a dashboard is only ever
//! **created** (a name already taken is never overwritten: the copy is renamed).
//!
//! What is tolerated, always reported as an [`ImportWarning`]: a widget of a kind this version does not know
//! (ignored), an account that does not exist here (the widget goes back to "the dashboard's account", the
//! scope to "follow the top bar"), a name already taken (renamed). Everything else wrong is an error whose
//! message is `dashboard_import:<code>` (the interface translates the code) and nothing is written.

use super::*;
use rusqlite::Connection;
use serde_json::Value;
use std::io::Read;
use std::path::Path;

pub const FORMAT: &str = "pulse-dashboard";
/// Newest file version this build reads and writes.
pub const FORMAT_VERSION: u32 = 1;
/// Largest file read (a dashboard is a few KB: anything bigger is not one).
pub const MAX_FILE_BYTES: u64 = 1_000_000;

// --- File format ---------------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct AccountRef {
    name: String,
    currency: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct FileScope {
    kind: ScopeKind,
    #[serde(default)]
    account: Option<AccountRef>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct FileWidget {
    uid: String,
    kind: String,
    x: i64,
    y: i64,
    w: i64,
    h: i64,
    #[serde(default)]
    period: Option<String>,
    #[serde(default)]
    mode: Option<String>,
    #[serde(default)]
    account: Option<AccountRef>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct ConfigFile {
    format: String,
    version: u32,
    name: String,
    scope: FileScope,
    widgets: Vec<Value>,
}

/// Something the import changed or dropped without failing.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "code", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ImportWarning {
    /// A widget kind this version does not know: the widget is ignored.
    UnknownWidget { kind: String },
    /// A widget's account does not exist here: the widget reads the dashboard's account again.
    UnknownAccount { name: String, widget_kind: String },
    /// The dashboard's account does not exist here: it follows the top bar.
    UnknownScopeAccount { name: String },
    /// The name was taken: the dashboard was imported under another one.
    Renamed { from: String, to: String },
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub layout: DashboardLayout,
    pub warnings: Vec<ImportWarning>,
}

fn fail<T>(code: &str) -> Result<T> {
    Err(CoreError::Invalid(format!("dashboard_import:{code}")))
}

fn fail_with<T>(code: &str, detail: impl std::fmt::Display) -> Result<T> {
    Err(CoreError::Invalid(format!("dashboard_import:{code}:{detail}")))
}

// --- Duplicating ---------------------------------------------------------------------------------

/// First free name among `base`, `base (suffix)`, `base (suffix 2)`… (case and spaces ignored, presets included).
fn free_name(conn: &Connection, base: &str, suffix: &str) -> Result<String> {
    let base = base.split_whitespace().collect::<Vec<_>>().join(" ");
    let fits = |candidate: String| -> String {
        // Keep the whole name within the limit by shortening the base, never the suffix.
        let tail = candidate.chars().count() - base.chars().count();
        let room = MAX_NAME_CHARS.saturating_sub(tail);
        let head: String = base.chars().take(room).collect();
        format!("{}{}", head.trim_end(), &candidate[base.len()..])
    };
    for n in 1.. {
        let candidate = if n == 1 { format!("{base} ({suffix})") } else { format!("{base} ({suffix} {n})") };
        let candidate = fits(candidate);
        if clean_name(&candidate).is_ok() && !name_taken(conn, &candidate, None)? {
            return Ok(candidate);
        }
    }
    unreachable!()
}

/// A scope that can be saved: an orphan `Account` scope (its account was deleted) is the top bar.
fn savable(scope: DashboardScope) -> DashboardScope {
    if scope.kind == ScopeKind::Account && scope.account_id.is_none() { DashboardScope::FOLLOW } else { scope }
}

/// Copies a dashboard (a preset or one of the user's) as a new one of the user's, to start from. The copy has
/// the same widgets, settings and scope, is never the default, and is named `name` (an error if taken) or, when
/// none is given, "<name> (copie)", "<name> (copie 2)"…
pub fn duplicate(conn: &Connection, key: &str, name: Option<&str>) -> Result<DashboardLayout> {
    let source = get(conn, key)?;
    let name = match name {
        Some(n) => n.to_string(),
        None => free_name(conn, &source.name, "copie")?,
    };
    save_scoped(conn, None, &name, Some(&savable(source.scope)), &source.widgets)
}

// --- Exporting -----------------------------------------------------------------------------------

fn account_ref(conn: &Connection, id: Option<i64>) -> Result<Option<AccountRef>> {
    let Some(id) = id else { return Ok(None) };
    Ok(conn
        .query_row("SELECT name, currency FROM accounts WHERE id = ?1", [id], |r| Ok(AccountRef { name: r.get(0)?, currency: r.get(1)? }))
        .optional()?)
}

/// The configuration file of a dashboard, as text.
pub fn export_config(conn: &Connection, key: &str) -> Result<String> {
    let layout = get(conn, key)?;
    let scope = savable(layout.scope);
    let file = ConfigFile {
        format: FORMAT.into(),
        version: FORMAT_VERSION,
        name: layout.name,
        scope: FileScope { kind: scope.kind, account: account_ref(conn, scope.account_id)? },
        widgets: layout
            .widgets
            .iter()
            .map(|w| {
                let widget = FileWidget {
                    uid: w.uid.clone(),
                    kind: w.kind.clone(),
                    x: w.x,
                    y: w.y,
                    w: w.w,
                    h: w.h,
                    period: w.period.clone(),
                    mode: w.mode.clone(),
                    account: account_ref(conn, w.account_id)?,
                };
                Ok(serde_json::to_value(widget).expect("a widget serialises"))
            })
            .collect::<Result<_>>()?,
    };
    let mut text = serde_json::to_string_pretty(&file).expect("a configuration serialises");
    text.push('\n');
    Ok(text)
}

/// Writes the configuration file of a dashboard.
pub fn export_config_file(conn: &Connection, key: &str, path: &Path) -> Result<()> {
    let text = export_config(conn, key)?;
    std::fs::write(path, text)?;
    Ok(())
}

// --- Importing -----------------------------------------------------------------------------------

/// The account of this database with that name and currency (case and spaces ignored); `None` if there is
/// none or if two accounts match (guessing which one would be wrong half the time).
fn find_account(conn: &Connection, r: &AccountRef) -> Result<Option<i64>> {
    let mut stmt = conn.prepare("SELECT id FROM accounts WHERE lower(trim(name)) = lower(trim(?1)) AND upper(trim(currency)) = upper(trim(?2))")?;
    let ids: Vec<i64> = stmt.query_map(params![r.name, r.currency], |row| row.get(0))?.collect::<std::result::Result<_, _>>()?;
    Ok(if ids.len() == 1 { Some(ids[0]) } else { None })
}

/// Imports a configuration given as text. Nothing is written unless the whole file is valid.
pub fn import_config(conn: &Connection, text: &str) -> Result<ImportResult> {
    if text.len() as u64 > MAX_FILE_BYTES {
        return fail("too_large");
    }
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    if text.trim().is_empty() {
        return fail("empty");
    }
    let value: Value = match serde_json::from_str(text) {
        Ok(v) => v,
        Err(e) => return fail_with("corrupt", e),
    };
    // The format and the version are read first: a newer file must say "too new", not "corrupt".
    if value.get("format").and_then(Value::as_str) != Some(FORMAT) {
        return fail("not_a_dashboard");
    }
    match value.get("version").and_then(Value::as_u64) {
        Some(v) if v > u64::from(FORMAT_VERSION) => return fail_with("too_new", v),
        Some(v) if v >= 1 => {}
        _ => return fail_with("corrupt", "version"),
    }
    let file: ConfigFile = match serde_json::from_value(value) {
        Ok(f) => f,
        Err(e) => return fail_with("corrupt", e),
    };

    let mut warnings = Vec::new();

    let base = file.name.split_whitespace().collect::<Vec<_>>().join(" ");
    if base.is_empty() || base.chars().count() > MAX_NAME_CHARS {
        return fail_with("invalid", "name");
    }
    let name = if clean_name(&base).is_ok() && !name_taken(conn, &base, None)? {
        base
    } else {
        let renamed = free_name(conn, &base, "importé")?;
        warnings.push(ImportWarning::Renamed { from: base, to: renamed.clone() });
        renamed
    };

    let scope = match (file.scope.kind, &file.scope.account) {
        (ScopeKind::Account, None) => return fail_with("corrupt", "scope"),
        (ScopeKind::Account, Some(r)) => match find_account(conn, r)? {
            Some(id) => DashboardScope { kind: ScopeKind::Account, account_id: Some(id) },
            None => {
                warnings.push(ImportWarning::UnknownScopeAccount { name: r.name.clone() });
                DashboardScope::FOLLOW
            }
        },
        (_, Some(_)) => return fail_with("corrupt", "scope"),
        (kind, None) => DashboardScope { kind, account_id: None },
    };

    let mut widgets = Vec::new();
    for raw in &file.widgets {
        let Some(kind) = raw.get("kind").and_then(Value::as_str) else {
            return fail_with("corrupt", "widget");
        };
        if find(kind).is_none() {
            warnings.push(ImportWarning::UnknownWidget { kind: kind.to_string() });
            continue;
        }
        let widget: FileWidget = match serde_json::from_value(raw.clone()) {
            Ok(w) => w,
            Err(e) => return fail_with("corrupt", e),
        };
        let account_id = match &widget.account {
            None => None,
            Some(r) => match find_account(conn, r)? {
                Some(id) => Some(id),
                None => {
                    warnings.push(ImportWarning::UnknownAccount { name: r.name.clone(), widget_kind: widget.kind.clone() });
                    None
                }
            },
        };
        widgets.push(WidgetInstance {
            uid: widget.uid,
            kind: widget.kind,
            x: widget.x,
            y: widget.y,
            w: widget.w,
            h: widget.h,
            period: widget.period,
            account_id,
            mode: widget.mode,
        });
    }
    if let Err(e) = validate(conn, &widgets) {
        return fail_with("invalid", e);
    }
    let layout = save_scoped(conn, None, &name, Some(&scope), &widgets)?;
    Ok(ImportResult { layout, warnings })
}

/// Reads and imports a configuration file.
pub fn import_config_file(conn: &Connection, path: &Path) -> Result<ImportResult> {
    let file = std::fs::File::open(path)?;
    let mut bytes = Vec::new();
    file.take(MAX_FILE_BYTES + 1).read_to_end(&mut bytes)?;
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return fail("too_large");
    }
    match String::from_utf8(bytes) {
        Ok(text) => import_config(conn, &text),
        Err(_) => fail_with("corrupt", "encoding"),
    }
}
