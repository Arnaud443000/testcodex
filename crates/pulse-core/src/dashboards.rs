//! Customisable dashboards (spec 3.8, 2.9, 2.10).
//!
//! A dashboard is a named list of widget instances placed on a grid of [`GRID_COLUMNS`] columns
//! (row height is a UI detail: `y` and `h` are in rows). This module knows *what may be stored*
//! (the widget library, the grid rules, the per-widget settings of 3.8.8) and *what is shown at start-up*;
//! it computes no statistic: a widget only points at a report that another module already produces.
//!
//! - The built-in presets (3.8.4) are code, not rows: they cannot be altered, and a new preset reaches every
//!   user without a migration. Editing one and saving creates the user's own dashboard.
//! - A dashboard is addressed by a `key`: `preset:<name>` or `custom:<id>`.
//! - The default dashboard (3.8.6) is the `dashboard.default` setting; missing, unknown or deleted → the
//!   "Essentiel" preset, which is the dashboard the application always had, so an existing user loses nothing.
//! - A widget's own period / account / display mode (3.8.8): `None` = follow the global choice / the default mode.
//! - Scope of a dashboard (3.8.9): `follow` (the account chosen in the top bar, what every dashboard did
//!   before the scope existed), `account` (linked to ONE account) or `all` (consolidated over every active
//!   account). **Priority for the account a widget reads: the widget's own account, then the dashboard's
//!   scope, then the top bar.** The period is not part of the scope: it stays the widget's own, else the top bar's.

use crate::error::{CoreError, Result};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// Width of the layout grid, in columns.
pub const GRID_COLUMNS: i64 = 30;
/// Deepest row a widget may reach (a guard against absurd values, not a UI limit).
pub const MAX_ROWS: i64 = 300;
pub const MAX_WIDGETS: usize = 60;
pub const MAX_NAME_CHARS: usize = 60;

const DEFAULT_SETTING: &str = "dashboard.default";
const CUSTOM_PREFIX: &str = "custom:";
/// Values of a widget's own period (same keys as the top bar).
pub const PERIODS: [&str; 6] = ["1D", "1W", "1M", "3M", "1Y", "ALL"];

/// What a dashboard reads by default (3.8.9).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ScopeKind {
    /// The account chosen in the top bar (all active accounts when none is chosen).
    Follow,
    /// One account, whatever the top bar says.
    Account,
    /// Every active account, consolidated (never summed across currencies: see [`ResolvedScope::mixed_currency`]).
    All,
}

impl ScopeKind {
    fn as_db(self) -> &'static str {
        match self {
            ScopeKind::Follow => "follow",
            ScopeKind::Account => "account",
            ScopeKind::All => "all",
        }
    }

    fn from_db(s: &str) -> ScopeKind {
        match s {
            "account" => ScopeKind::Account,
            "all" => ScopeKind::All,
            _ => ScopeKind::Follow,
        }
    }
}

/// The scope as stored. `account_id` is set for `Account` only; an `Account` scope whose id is `None` is a
/// dashboard whose account was deleted (the column is emptied by the database): it reads as `Follow`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardScope {
    pub kind: ScopeKind,
    #[serde(default)]
    pub account_id: Option<i64>,
}

impl DashboardScope {
    pub const FOLLOW: DashboardScope = DashboardScope { kind: ScopeKind::Follow, account_id: None };
}

/// A kind of widget in the library (3.8.3). `modes` lists the display modes a widget of this kind offers
/// (the first one is the default); `period` / `account` say whether it honours its own period / account.
struct Def {
    kind: &'static str,
    category: &'static str,
    default_size: (i64, i64),
    min_size: (i64, i64),
    modes: &'static [&'static str],
    period: bool,
    account: bool,
}

const fn def(
    kind: &'static str,
    category: &'static str,
    default_size: (i64, i64),
    min_size: (i64, i64),
    modes: &'static [&'static str],
    period: bool,
    account: bool,
) -> Def {
    Def { kind, category, default_size, min_size, modes, period, account }
}

const KPI_MODES: &[&str] = &["win_rate", "profit_factor", "expectancy", "risk_reward", "max_drawdown"];
const EMOTION_MODES: &[&str] = &["before", "during", "after", "any"];
const RECENT_MODES: &[&str] = &["5", "10", "15"];
const NEWS_MODES: &[&str] = &["medium", "high", "all"];
const PROCESS_GOAL_MODES: &[&str] = &["week", "month"];

const LIBRARY: &[Def] = &[
    // Performance
    def("net_pnl_equity", "performance", (20, 16), (12, 11), &[], true, true),
    def("capital", "performance", (10, 16), (7, 10), &[], false, true),
    def("kpi", "performance", (6, 6), (5, 5), KPI_MODES, true, true),
    def("daily_results", "performance", (17, 13), (10, 9), &[], true, true),
    // Temporal
    def("calendar", "temporal", (13, 13), (10, 11), &[], false, true),
    def("heatmap", "temporal", (20, 18), (14, 12), &[], true, true),
    // Breakdown
    def("r_distribution", "breakdown", (15, 14), (10, 11), &[], true, true),
    def("risk", "breakdown", (15, 14), (10, 11), &[], true, true),
    def("long_short", "breakdown", (10, 14), (8, 10), &[], true, true),
    // Tracking
    def("recent_trades", "tracking", (15, 14), (10, 8), RECENT_MODES, false, true),
    def("goals", "tracking", (10, 14), (8, 8), &[], false, true),
    // Behaviour
    def("discipline", "behavior", (10, 26), (8, 14), &[], true, true),
    def("emotions", "behavior", (12, 18), (9, 12), EMOTION_MODES, true, true),
    def("streaks", "behavior", (8, 26), (7, 12), &[], true, true),
    def("plan", "behavior", (10, 28), (8, 12), &[], true, true),
    def("first_trade", "behavior", (10, 18), (8, 10), &[], true, true),
    def("mistakes", "behavior", (10, 18), (8, 10), &[], true, true),
    def("rules", "behavior", (10, 18), (8, 10), &[], true, true),
    def("hesitation", "behavior", (10, 18), (8, 10), &[], true, true),
    def("factors", "behavior", (20, 18), (12, 12), &[], true, true),
    // Insights (lot 19 bis): fixed windows (last 20 trades, 90 days), so no period of its own.
    def("insights", "behavior", (12, 20), (8, 10), &[], false, true),
    // Upcoming economic news (lot 25): the calendar is neither per account nor per period; the mode
    // chooses the importance shown (medium and high by default).
    def("upcoming_news", "temporal", (10, 16), (8, 10), NEWS_MODES, false, false),
    // Behaviour goals (lot 34): the mode is the goal period (this week or this month), so no period of its own.
    def("process_goals", "tracking", (10, 14), (8, 10), PROCESS_GOAL_MODES, false, true),
];

fn find(kind: &str) -> Option<&'static Def> {
    LIBRARY.iter().find(|d| d.kind == kind)
}

/// A widget of the library, as the interface needs it to offer it and size it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetDefinition {
    pub kind: String,
    pub category: String,
    pub default_w: i64,
    pub default_h: i64,
    pub min_w: i64,
    pub min_h: i64,
    /// Display modes, the first being the default; empty = the widget has none.
    pub modes: Vec<String>,
    /// Whether the widget can have its own period.
    pub period: bool,
    /// Whether the widget can be pinned to one account.
    pub account: bool,
}

pub fn catalog() -> Vec<WidgetDefinition> {
    LIBRARY
        .iter()
        .map(|d| WidgetDefinition {
            kind: d.kind.into(),
            category: d.category.into(),
            default_w: d.default_size.0,
            default_h: d.default_size.1,
            min_w: d.min_size.0,
            min_h: d.min_size.1,
            modes: d.modes.iter().map(|m| m.to_string()).collect(),
            period: d.period,
            account: d.account,
        })
        .collect()
}

/// One widget placed on a dashboard (`WidgetInstance`, 2.9). `uid` identifies it inside its dashboard.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetInstance {
    pub uid: String,
    pub kind: String,
    pub x: i64,
    pub y: i64,
    pub w: i64,
    pub h: i64,
    /// Own period (`1D` … `ALL`); `None` follows the period chosen in the top bar.
    #[serde(default)]
    pub period: Option<String>,
    /// Own account; `None` follows the account chosen in the top bar.
    #[serde(default)]
    pub account_id: Option<i64>,
    /// Display mode; `None` = the widget's default mode.
    #[serde(default)]
    pub mode: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardLayout {
    pub key: String,
    pub name: String,
    /// A built-in preset: read-only.
    pub builtin: bool,
    pub is_default: bool,
    pub scope: DashboardScope,
    pub widgets: Vec<WidgetInstance>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardSummary {
    pub key: String,
    pub name: String,
    pub builtin: bool,
    pub is_default: bool,
    pub scope: DashboardScope,
    pub widget_count: usize,
}

// --- Built-in presets (3.8.4) -------------------------------------------------------------------

pub const ESSENTIAL: &str = "preset:essential";
const PRESET_KEYS: [&str; 3] = [ESSENTIAL, "preset:behavior", "preset:analysis"];

fn w(uid: &str, kind: &str, x: i64, y: i64, wd: i64, h: i64) -> WidgetInstance {
    WidgetInstance { uid: uid.into(), kind: kind.into(), x, y, w: wd, h, period: None, account_id: None, mode: None }
}

fn with_mode(mut widget: WidgetInstance, mode: &str) -> WidgetInstance {
    widget.mode = Some(mode.into());
    widget
}

fn preset(key: &str) -> Option<(&'static str, Vec<WidgetInstance>)> {
    Some(match key {
        // The dashboard the application always had: it stays the look of a fresh install.
        ESSENTIAL => (
            "Essentiel",
            vec![
                w("hero", "net_pnl_equity", 0, 0, 20, 16),
                w("capital", "capital", 20, 0, 10, 16),
                with_mode(w("kpi-win", "kpi", 0, 16, 6, 6), "win_rate"),
                with_mode(w("kpi-pf", "kpi", 6, 16, 6, 6), "profit_factor"),
                with_mode(w("kpi-exp", "kpi", 12, 16, 6, 6), "expectancy"),
                with_mode(w("kpi-rr", "kpi", 18, 16, 6, 6), "risk_reward"),
                with_mode(w("kpi-dd", "kpi", 24, 16, 6, 6), "max_drawdown"),
                w("daily", "daily_results", 0, 22, 17, 13),
                w("calendar", "calendar", 17, 22, 13, 13),
            ],
        ),
        "preset:behavior" => (
            "Comportement",
            vec![
                w("discipline", "discipline", 0, 0, 10, 26),
                with_mode(w("emotions", "emotions", 10, 0, 12, 26), "before"),
                w("streaks", "streaks", 22, 0, 8, 26),
                w("plan", "plan", 0, 26, 10, 28),
                w("mistakes", "mistakes", 10, 26, 10, 28),
                w("rules", "rules", 20, 26, 10, 28),
                w("first-trade", "first_trade", 0, 54, 10, 18),
                w("hesitation", "hesitation", 10, 54, 10, 18),
                w("goals", "goals", 20, 54, 10, 18),
            ],
        ),
        "preset:analysis" => (
            "Analyse",
            vec![
                w("hero", "net_pnl_equity", 0, 0, 30, 16),
                with_mode(w("kpi-pf", "kpi", 0, 16, 6, 6), "profit_factor"),
                with_mode(w("kpi-exp", "kpi", 6, 16, 6, 6), "expectancy"),
                with_mode(w("kpi-rr", "kpi", 12, 16, 6, 6), "risk_reward"),
                with_mode(w("kpi-win", "kpi", 18, 16, 6, 6), "win_rate"),
                with_mode(w("kpi-dd", "kpi", 24, 16, 6, 6), "max_drawdown"),
                w("heatmap", "heatmap", 0, 22, 20, 18),
                w("long-short", "long_short", 20, 22, 10, 18),
                w("r-distribution", "r_distribution", 0, 40, 15, 14),
                w("risk", "risk", 15, 40, 15, 14),
                w("recent", "recent_trades", 0, 54, 30, 14),
            ],
        ),
        _ => return None,
    })
}

// --- Validation ---------------------------------------------------------------------------------

fn invalid<T>(msg: impl Into<String>) -> Result<T> {
    Err(CoreError::Invalid(msg.into()))
}

fn clean_name(name: &str) -> Result<String> {
    let cleaned = name.split_whitespace().collect::<Vec<_>>().join(" ");
    if cleaned.is_empty() {
        return invalid("a dashboard needs a name");
    }
    if cleaned.chars().count() > MAX_NAME_CHARS {
        return invalid(format!("a dashboard name is at most {MAX_NAME_CHARS} characters"));
    }
    let key = cleaned.to_lowercase();
    if PRESET_KEYS.iter().filter_map(|k| preset(k)).any(|(n, _)| n.to_lowercase() == key) {
        return invalid(format!("\"{cleaned}\" is the name of a built-in dashboard"));
    }
    Ok(cleaned)
}

/// Checks a whole layout: known kinds, sizes, grid bounds, no overlap, coherent settings.
pub fn validate(conn: &Connection, widgets: &[WidgetInstance]) -> Result<()> {
    if widgets.len() > MAX_WIDGETS {
        return invalid(format!("a dashboard holds at most {MAX_WIDGETS} widgets"));
    }
    let mut uids = HashSet::new();
    for widget in widgets {
        if widget.uid.is_empty() || widget.uid.chars().count() > 40 {
            return invalid("a widget needs an identifier of 1 to 40 characters");
        }
        if !uids.insert(widget.uid.as_str()) {
            return invalid(format!("two widgets share the identifier {:?}", widget.uid));
        }
        let Some(d) = find(&widget.kind) else {
            return invalid(format!("unknown widget kind {:?}", widget.kind));
        };
        if widget.w < d.min_size.0 || widget.h < d.min_size.1 {
            return invalid(format!("widget {:?} is smaller than {}x{}", widget.kind, d.min_size.0, d.min_size.1));
        }
        if widget.x < 0 || widget.y < 0 || widget.x + widget.w > GRID_COLUMNS || widget.y + widget.h > MAX_ROWS {
            return invalid(format!("widget {:?} is outside the grid ({GRID_COLUMNS} columns)", widget.uid));
        }
        if let Some(p) = &widget.period {
            if !d.period {
                return invalid(format!("widget {:?} has no period setting", widget.kind));
            }
            if !PERIODS.contains(&p.as_str()) {
                return invalid(format!("unknown period {p:?}"));
            }
        }
        if let Some(id) = widget.account_id {
            if !d.account {
                return invalid(format!("widget {:?} has no account setting", widget.kind));
            }
            let exists: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM accounts WHERE id = ?1)", [id], |r| r.get(0))?;
            if !exists {
                return Err(CoreError::NotFound(format!("account {id}")));
            }
        }
        if let Some(m) = &widget.mode
            && !d.modes.contains(&m.as_str())
        {
            return invalid(format!("widget {:?} has no display mode {m:?}", widget.kind));
        }
    }
    for (i, a) in widgets.iter().enumerate() {
        for b in &widgets[i + 1..] {
            if a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h {
                return invalid(format!("widgets {:?} and {:?} overlap", a.uid, b.uid));
            }
        }
    }
    Ok(())
}

// --- Keys ---------------------------------------------------------------------------------------

enum KeyRef {
    Preset(&'static str),
    Custom(i64),
}

fn parse_key(key: &str) -> Result<KeyRef> {
    if let Some(k) = PRESET_KEYS.iter().find(|k| **k == key) {
        return Ok(KeyRef::Preset(k));
    }
    if let Some(id) = key.strip_prefix(CUSTOM_PREFIX).and_then(|s| s.parse::<i64>().ok()) {
        return Ok(KeyRef::Custom(id));
    }
    Err(CoreError::NotFound(format!("dashboard {key:?}")))
}

fn custom_key(id: i64) -> String {
    format!("{CUSTOM_PREFIX}{id}")
}

// --- Reading ------------------------------------------------------------------------------------

fn stored_default(conn: &Connection) -> Result<Option<String>> {
    Ok(conn.query_row("SELECT value FROM settings WHERE key = ?1", [DEFAULT_SETTING], |r| r.get(0)).optional()?)
}

/// Key of the dashboard shown at start-up (3.8.6); "Essentiel" when nothing valid is chosen.
pub fn default_key(conn: &Connection) -> Result<String> {
    if let Some(key) = stored_default(conn)?
        && exists(conn, &key)?
    {
        return Ok(key);
    }
    Ok(ESSENTIAL.to_string())
}

fn exists(conn: &Connection, key: &str) -> Result<bool> {
    Ok(match parse_key(key) {
        Ok(KeyRef::Preset(_)) => true,
        Ok(KeyRef::Custom(id)) => conn.query_row("SELECT EXISTS(SELECT 1 FROM dashboards WHERE id = ?1)", [id], |r| r.get(0))?,
        Err(_) => false,
    })
}

fn widgets_of(conn: &Connection, dashboard_id: i64) -> Result<Vec<WidgetInstance>> {
    let mut stmt = conn.prepare(
        "SELECT uid, kind, x, y, w, h, period, account_id, mode FROM dashboard_widgets
         WHERE dashboard_id = ?1 ORDER BY y, x, id",
    )?;
    let rows = stmt.query_map([dashboard_id], |r| {
        Ok(WidgetInstance {
            uid: r.get(0)?,
            kind: r.get(1)?,
            x: r.get(2)?,
            y: r.get(3)?,
            w: r.get(4)?,
            h: r.get(5)?,
            period: r.get(6)?,
            account_id: r.get(7)?,
            mode: r.get(8)?,
        })
    })?;
    Ok(rows.collect::<std::result::Result<_, _>>()?)
}

fn scope_of(kind: &str, account_id: Option<i64>) -> DashboardScope {
    DashboardScope { kind: ScopeKind::from_db(kind), account_id }
}

pub fn get(conn: &Connection, key: &str) -> Result<DashboardLayout> {
    let is_default = default_key(conn)? == key;
    match parse_key(key)? {
        KeyRef::Preset(k) => {
            let (name, widgets) = preset(k).expect("known preset");
            Ok(DashboardLayout { key: k.into(), name: name.into(), builtin: true, is_default, scope: DashboardScope::FOLLOW, widgets })
        }
        KeyRef::Custom(id) => {
            let (name, scope) = conn
                .query_row("SELECT name, scope, scope_account_id FROM dashboards WHERE id = ?1", [id], |r| {
                    Ok((r.get::<_, String>(0)?, scope_of(&r.get::<_, String>(1)?, r.get(2)?)))
                })
                .optional()?
                .ok_or_else(|| CoreError::NotFound(format!("dashboard {key:?}")))?;
            Ok(DashboardLayout { key: custom_key(id), name, builtin: false, is_default, scope, widgets: widgets_of(conn, id)? })
        }
    }
}

/// The dashboard shown at start-up.
pub fn startup(conn: &Connection) -> Result<DashboardLayout> {
    get(conn, &default_key(conn)?)
}

/// Presets first, then the user's dashboards in creation order.
pub fn list(conn: &Connection) -> Result<Vec<DashboardSummary>> {
    let default = default_key(conn)?;
    let mut out: Vec<DashboardSummary> = PRESET_KEYS
        .iter()
        .map(|k| {
            let (name, widgets) = preset(k).expect("known preset");
            DashboardSummary {
                key: (*k).into(),
                name: name.into(),
                builtin: true,
                is_default: default == *k,
                scope: DashboardScope::FOLLOW,
                widget_count: widgets.len(),
            }
        })
        .collect();
    let mut stmt = conn.prepare(
        "SELECT d.id, d.name, (SELECT COUNT(*) FROM dashboard_widgets w WHERE w.dashboard_id = d.id), d.scope, d.scope_account_id
         FROM dashboards d ORDER BY d.position, d.id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?, r.get::<_, String>(3)?, r.get::<_, Option<i64>>(4)?))
    })?;
    for row in rows {
        let (id, name, count, kind, account) = row?;
        let widget_count = count as usize;
        let key = custom_key(id);
        out.push(DashboardSummary { is_default: default == key, key, name, builtin: false, scope: scope_of(&kind, account), widget_count });
    }
    Ok(out)
}

// --- Scope resolution (3.8.9) -------------------------------------------------------------------

/// An account a dashboard or widget reads, as the interface shows it.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopeAccount {
    pub id: i64,
    pub name: String,
    pub currency: String,
    pub archived: bool,
}

/// Something the trader should be told about the scope.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ScopeNotice {
    /// The linked account no longer exists: the dashboard reads the top bar again.
    AccountDeleted,
    /// The linked account is archived: still read, since it is named explicitly.
    AccountArchived,
}

/// Where the account a widget reads comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ScopeSource {
    Widget,
    Dashboard,
    TopBar,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedScope {
    /// The scope as stored.
    pub declared: ScopeKind,
    /// What is really read: `Follow` when the linked account is gone.
    pub effective: ScopeKind,
    /// Accounts to send to the statistics commands; empty = every active account (engine convention).
    pub account_ids: Vec<i64>,
    /// The accounts read (all active accounts when `account_ids` is empty).
    pub accounts: Vec<ScopeAccount>,
    /// Common currency of the accounts read; `None` without account.
    pub currency: Option<String>,
    /// The accounts read do not share a currency: nothing may be added up.
    pub mixed_currency: bool,
    pub notices: Vec<ScopeNotice>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetScope {
    pub uid: String,
    pub source: ScopeSource,
    pub account_ids: Vec<i64>,
    pub accounts: Vec<ScopeAccount>,
    pub currency: Option<String>,
    pub mixed_currency: bool,
    /// The account set on the widget does not exist (an unsaved draft; a saved widget is emptied on deletion).
    pub account_missing: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedDashboard {
    pub scope: ResolvedScope,
    pub widgets: Vec<WidgetScope>,
}

/// Accounts by id, or every active account when `ids` is empty. Unknown ids are simply absent.
fn load_accounts(conn: &Connection, ids: &[i64]) -> Result<Vec<ScopeAccount>> {
    let mut out = Vec::new();
    let map = |r: &rusqlite::Row| -> rusqlite::Result<ScopeAccount> {
        Ok(ScopeAccount { id: r.get(0)?, name: r.get(1)?, currency: r.get(2)?, archived: r.get(3)? })
    };
    if ids.is_empty() {
        let mut stmt = conn.prepare("SELECT id, name, currency, archived FROM accounts WHERE archived = 0 ORDER BY id")?;
        for row in stmt.query_map([], map)? {
            out.push(row?);
        }
    } else {
        let mut stmt = conn.prepare("SELECT id, name, currency, archived FROM accounts WHERE id = ?1")?;
        for id in ids {
            if let Some(a) = stmt.query_row([id], map).optional()? {
                out.push(a);
            }
        }
    }
    Ok(out)
}

fn currency_of(accounts: &[ScopeAccount]) -> (Option<String>, bool) {
    let first = accounts.first().map(|a| a.currency.clone());
    let mixed = accounts.iter().any(|a| Some(&a.currency) != first.as_ref());
    (first, mixed)
}

/// What the dashboard reads. `selected` = the account chosen in the top bar (`None` = all active accounts).
pub fn resolve_scope(conn: &Connection, scope: &DashboardScope, selected: Option<i64>) -> Result<ResolvedScope> {
    let mut notices = Vec::new();
    let (effective, account_ids) = match (scope.kind, scope.account_id) {
        (ScopeKind::Account, Some(id)) if !load_accounts(conn, &[id])?.is_empty() => (ScopeKind::Account, vec![id]),
        (ScopeKind::Account, _) => {
            notices.push(ScopeNotice::AccountDeleted);
            (ScopeKind::Follow, selected.into_iter().collect())
        }
        (ScopeKind::All, _) => (ScopeKind::All, Vec::new()),
        (ScopeKind::Follow, _) => (ScopeKind::Follow, selected.into_iter().collect()),
    };
    let accounts = load_accounts(conn, &account_ids)?;
    if effective == ScopeKind::Account && accounts.iter().any(|a| a.archived) {
        notices.push(ScopeNotice::AccountArchived);
    }
    let (currency, mixed_currency) = currency_of(&accounts);
    Ok(ResolvedScope { declared: scope.kind, effective, account_ids, accounts, currency, mixed_currency, notices })
}

/// The dashboard's scope and, for each widget, the accounts it reads: its own account first, then the
/// dashboard's scope, then the top bar (`ResolvedScope` already falls back to the top bar for `Follow`).
pub fn resolve(conn: &Connection, scope: &DashboardScope, widgets: &[WidgetInstance], selected: Option<i64>) -> Result<ResolvedDashboard> {
    let dashboard = resolve_scope(conn, scope, selected)?;
    let mut out = Vec::with_capacity(widgets.len());
    for widget in widgets {
        let scoped = match widget.account_id {
            Some(id) => {
                let accounts = load_accounts(conn, &[id])?;
                let (currency, mixed_currency) = currency_of(&accounts);
                WidgetScope {
                    uid: widget.uid.clone(),
                    source: ScopeSource::Widget,
                    account_ids: vec![id],
                    account_missing: accounts.is_empty(),
                    accounts,
                    currency,
                    mixed_currency,
                }
            }
            None => WidgetScope {
                uid: widget.uid.clone(),
                source: if dashboard.effective == ScopeKind::Follow { ScopeSource::TopBar } else { ScopeSource::Dashboard },
                account_ids: dashboard.account_ids.clone(),
                accounts: dashboard.accounts.clone(),
                currency: dashboard.currency.clone(),
                mixed_currency: dashboard.mixed_currency,
                account_missing: false,
            },
        };
        out.push(scoped);
    }
    Ok(ResolvedDashboard { scope: dashboard, widgets: out })
}

// --- Writing ------------------------------------------------------------------------------------

fn name_taken(conn: &Connection, name: &str, except: Option<i64>) -> Result<bool> {
    Ok(conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM dashboards WHERE lower(trim(name)) = lower(trim(?1)) AND id IS NOT ?2)",
        params![name, except],
        |r| r.get(0),
    )?)
}

fn write_widgets(conn: &Connection, dashboard_id: i64, widgets: &[WidgetInstance]) -> Result<()> {
    conn.execute("DELETE FROM dashboard_widgets WHERE dashboard_id = ?1", [dashboard_id])?;
    let mut stmt = conn.prepare(
        "INSERT INTO dashboard_widgets (dashboard_id, uid, kind, x, y, w, h, period, account_id, mode)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
    )?;
    for widget in widgets {
        stmt.execute(params![
            dashboard_id,
            widget.uid,
            widget.kind,
            widget.x,
            widget.y,
            widget.w,
            widget.h,
            widget.period,
            widget.account_id,
            widget.mode
        ])?;
    }
    Ok(())
}

/// Saves a dashboard. `key` = `None` or a preset key creates the user's own dashboard (a preset itself is
/// never altered); a `custom:` key replaces that dashboard's name and widgets. Returns what is now stored.
pub fn save(conn: &Connection, key: Option<&str>, name: &str, widgets: &[WidgetInstance]) -> Result<DashboardLayout> {
    save_scoped(conn, key, name, None, widgets)
}

/// Checks a scope: `Account` needs an existing account (an archived one is fine: it is named explicitly),
/// the other kinds carry no account.
pub fn validate_scope(conn: &Connection, scope: &DashboardScope) -> Result<()> {
    match (scope.kind, scope.account_id) {
        (ScopeKind::Account, Some(id)) => {
            let exists: bool = conn.query_row("SELECT EXISTS(SELECT 1 FROM accounts WHERE id = ?1)", [id], |r| r.get(0))?;
            if exists { Ok(()) } else { Err(CoreError::NotFound(format!("account {id}"))) }
        }
        (ScopeKind::Account, None) => invalid("a dashboard linked to an account needs that account"),
        (_, Some(_)) => invalid("only a dashboard linked to an account carries an account"),
        (_, None) => Ok(()),
    }
}

/// [`save`] with a scope (3.8.9). `scope` = `None` keeps the scope of an existing dashboard (a new one, or
/// a copy of a preset, starts on `Follow`).
pub fn save_scoped(
    conn: &Connection,
    key: Option<&str>,
    name: &str,
    scope: Option<&DashboardScope>,
    widgets: &[WidgetInstance],
) -> Result<DashboardLayout> {
    let name = clean_name(name)?;
    validate(conn, widgets)?;
    if let Some(scope) = scope {
        validate_scope(conn, scope)?;
    }
    let existing = match key {
        Some(k) => match parse_key(k)? {
            KeyRef::Custom(id) => {
                if !exists(conn, k)? {
                    return Err(CoreError::NotFound(format!("dashboard {k:?}")));
                }
                Some(id)
            }
            KeyRef::Preset(_) => None,
        },
        None => None,
    };
    if name_taken(conn, &name, existing)? {
        return invalid(format!("a dashboard named \"{name}\" already exists"));
    }
    let tx = conn.unchecked_transaction()?;
    let id = match existing {
        Some(id) => {
            tx.execute(
                "UPDATE dashboards SET name = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?2",
                params![name, id],
            )?;
            id
        }
        None => {
            let position: i64 = tx.query_row("SELECT COALESCE(MAX(position), 0) + 1 FROM dashboards", [], |r| r.get(0))?;
            let new = scope.unwrap_or(&DashboardScope::FOLLOW);
            tx.execute(
                "INSERT INTO dashboards (name, position, scope, scope_account_id) VALUES (?1, ?2, ?3, ?4)",
                params![name, position, new.kind.as_db(), new.account_id],
            )?;
            tx.last_insert_rowid()
        }
    };
    if existing.is_some()
        && let Some(scope) = scope
    {
        write_scope(&tx, id, scope)?;
    }
    write_widgets(&tx, id, widgets)?;
    tx.commit()?;
    get(conn, &custom_key(id))
}

fn write_scope(conn: &Connection, id: i64, scope: &DashboardScope) -> Result<()> {
    conn.execute(
        "UPDATE dashboards SET scope = ?1, scope_account_id = ?2, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?3",
        params![scope.kind.as_db(), scope.account_id, id],
    )?;
    Ok(())
}

/// Changes what one of the user's dashboards reads (3.8.9). A built-in preset always follows the top bar.
pub fn set_scope(conn: &Connection, key: &str, scope: &DashboardScope) -> Result<DashboardLayout> {
    let KeyRef::Custom(id) = parse_key(key)? else {
        return invalid("a built-in dashboard cannot be linked to an account: save a copy first");
    };
    if !exists(conn, key)? {
        return Err(CoreError::NotFound(format!("dashboard {key:?}")));
    }
    validate_scope(conn, scope)?;
    write_scope(conn, id, scope)?;
    get(conn, key)
}

pub fn rename(conn: &Connection, key: &str, name: &str) -> Result<DashboardLayout> {
    let KeyRef::Custom(id) = parse_key(key)? else {
        return invalid("a built-in dashboard cannot be renamed");
    };
    let name = clean_name(name)?;
    if !exists(conn, key)? {
        return Err(CoreError::NotFound(format!("dashboard {key:?}")));
    }
    if name_taken(conn, &name, Some(id))? {
        return invalid(format!("a dashboard named \"{name}\" already exists"));
    }
    conn.execute(
        "UPDATE dashboards SET name = ?1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?2",
        params![name, id],
    )?;
    get(conn, key)
}

/// Deletes one of the user's dashboards (a preset cannot be deleted). If it was the default, the default
/// goes back to "Essentiel".
pub fn delete(conn: &Connection, key: &str) -> Result<()> {
    let KeyRef::Custom(id) = parse_key(key)? else {
        return invalid("a built-in dashboard cannot be deleted");
    };
    let tx = conn.unchecked_transaction()?;
    if tx.execute("DELETE FROM dashboards WHERE id = ?1", [id])? == 0 {
        return Err(CoreError::NotFound(format!("dashboard {key:?}")));
    }
    if stored_default(&tx)?.as_deref() == Some(key) {
        tx.execute("DELETE FROM settings WHERE key = ?1", [DEFAULT_SETTING])?;
    }
    tx.commit()?;
    Ok(())
}

/// Chooses the dashboard shown at start-up (3.8.6).
pub fn set_default(conn: &Connection, key: &str) -> Result<DashboardLayout> {
    if !exists(conn, key)? {
        return Err(CoreError::NotFound(format!("dashboard {key:?}")));
    }
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![DEFAULT_SETTING, key],
    )?;
    get(conn, key)
}

mod transfer;
pub use transfer::*;

#[cfg(test)]
mod tests;
