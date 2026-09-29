//! Settings `news.*` of the key/value `settings` table (no migration) and the fetch
//! bookkeeping: off by default, no online source by default, at most one automatic fetch per
//! Paris day, at most one fetch every 5 minutes. See CLAUDE.md, lot 25.

use super::store::{self, ImportSummary, SOURCE_FILE, SOURCE_ICS_URL};
use super::zones;
use super::{Defaults, Importance, Parsed, error, ics, csv, known_currency};
use crate::error::Result;
use crate::settings::{read, write};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

const ENABLED: &str = "news.enabled";
const SOURCE: &str = "news.source";
const ICS_URL: &str = "news.ics_url";
const ICS_IMPORTANCE: &str = "news.ics_importance";
const ICS_CURRENCY: &str = "news.ics_currency";
const WINDOW_BEFORE: &str = "news.window_before_min";
const WINDOW_AFTER: &str = "news.window_after_min";
const ALERT: &str = "news.alert";
const LAST_ATTEMPT_AT: &str = "news.last_attempt_at";
const LAST_ATTEMPT_DAY: &str = "news.last_attempt_day";
const LAST_SUCCESS_AT: &str = "news.last_success_at";
const LAST_ERROR: &str = "news.last_error";
const LAST_COUNT: &str = "news.last_count";
const LAST_IMPORT_AT: &str = "news.last_import_at";

pub const DEFAULT_WINDOW_MIN: u32 = 15;
pub const MAX_WINDOW_MIN: u32 = 240;
pub const MAX_URL_LEN: usize = 2048;
/// Shortest time between two fetches, automatic or not (ms).
pub const MIN_FETCH_GAP_MS: i64 = 5 * 60_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SourceKind {
    /// No online source: nothing ever leaves the computer (files can still be imported).
    None,
    /// An ICS feed at the address the trader typed.
    IcsUrl,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewsSettings {
    pub enabled: bool,
    pub source: SourceKind,
    #[serde(default)]
    pub ics_url: Option<String>,
    /// Importance of a feed event without `PRIORITY`.
    pub ics_importance: Importance,
    /// Currency of a feed event without one; `None` = not given.
    #[serde(default)]
    pub ics_currency: Option<String>,
    pub window_before_min: u32,
    pub window_after_min: u32,
    /// Alert 3.6.8 (only while `enabled`).
    pub alert: bool,
}

impl Default for NewsSettings {
    fn default() -> Self {
        NewsSettings {
            enabled: false,
            source: SourceKind::None,
            ics_url: None,
            ics_importance: Importance::Medium,
            ics_currency: None,
            window_before_min: DEFAULT_WINDOW_MIN,
            window_after_min: DEFAULT_WINDOW_MIN,
            alert: true,
        }
    }
}

impl NewsSettings {
    /// Enabled, with an online source and its address.
    pub fn online_ready(&self) -> bool {
        self.enabled && self.source == SourceKind::IcsUrl && self.ics_url.is_some()
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchState {
    pub last_attempt_at: Option<i64>,
    pub last_success_at: Option<i64>,
    /// Code of the last failed attempt (`news:offline`…), cleared by a success.
    pub last_error: Option<String>,
    /// Events received by the last successful fetch.
    pub last_count: Option<u32>,
    pub last_import_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewsStatus {
    pub settings: NewsSettings,
    pub state: FetchState,
    pub event_count: usize,
    pub online_ready: bool,
    /// Host the feed is fetched from (what leaves the computer goes there only).
    pub online_host: Option<String>,
}

/// What the network side needs for one fetch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FetchPlan {
    pub url: String,
    pub defaults: Defaults,
}

fn uint(key: &str, s: &str) -> Result<u32> {
    s.trim().parse().map_err(|_| crate::error::CoreError::Invalid(format!("{key} is not a valid whole number: {s:?}")))
}

fn int64(s: Option<String>) -> Option<i64> {
    s.and_then(|v| v.trim().parse().ok())
}

pub fn get(conn: &Connection) -> Result<NewsSettings> {
    let d = NewsSettings::default();
    Ok(NewsSettings {
        enabled: read(conn, ENABLED)?.as_deref() == Some("on"),
        source: if read(conn, SOURCE)?.as_deref() == Some("icsUrl") { SourceKind::IcsUrl } else { SourceKind::None },
        ics_url: read(conn, ICS_URL)?,
        ics_importance: read(conn, ICS_IMPORTANCE)?.as_deref().and_then(Importance::parse).unwrap_or(d.ics_importance),
        ics_currency: read(conn, ICS_CURRENCY)?,
        window_before_min: read(conn, WINDOW_BEFORE)?.map(|s| uint(WINDOW_BEFORE, &s)).transpose()?.unwrap_or(d.window_before_min),
        window_after_min: read(conn, WINDOW_AFTER)?.map(|s| uint(WINDOW_AFTER, &s)).transpose()?.unwrap_or(d.window_after_min),
        alert: read(conn, ALERT)?.as_deref() != Some("off"),
    })
}

/// `https://host/…`, no user name or password, no space, at most 2 048 characters; returns the host.
pub fn check_url(url: &str) -> Result<String> {
    let url = url.trim();
    let rest = url.strip_prefix("https://").ok_or_else(|| error("urlNotHttps"))?;
    if url.len() > MAX_URL_LEN || url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(error("invalidUrl"));
    }
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.contains('@') {
        return Err(error("urlWithCredentials"));
    }
    let host = authority.rsplit_once(':').map_or(authority, |(h, port)| if port.bytes().all(|b| b.is_ascii_digit()) { h } else { authority });
    if host.is_empty() || host.starts_with('.') || host.ends_with('.') {
        return Err(error("invalidUrl"));
    }
    Ok(host.to_ascii_lowercase())
}

fn check_currency(c: &Option<String>) -> Result<Option<String>> {
    match c.as_deref().map(str::trim) {
        None | Some("") => Ok(None),
        Some(code) => known_currency(code).map(|k| Some(k.to_string())).ok_or_else(|| error("invalidCurrency")),
    }
}

/// Validates and saves every setting at once (nothing is written if one is wrong). Changing or
/// removing the feed address deletes the events of the previous feed.
pub fn set(conn: &Connection, s: &NewsSettings) -> Result<NewsSettings> {
    let url = match s.ics_url.as_deref().map(str::trim).filter(|u| !u.is_empty()) {
        Some(u) => {
            check_url(u)?;
            Some(u.to_string())
        }
        None => None,
    };
    if s.source == SourceKind::IcsUrl && url.is_none() {
        return Err(error("noSource"));
    }
    if s.window_before_min > MAX_WINDOW_MIN || s.window_after_min > MAX_WINDOW_MIN {
        return Err(error("invalidWindow"));
    }
    let currency = check_currency(&s.ics_currency)?;
    let before = get(conn)?;
    let feed_changed = before.ics_url != url || (s.source != SourceKind::IcsUrl && before.source == SourceKind::IcsUrl);
    let tx = conn.unchecked_transaction()?;
    write(&tx, ENABLED, s.enabled.then(|| "on".to_string()))?;
    write(&tx, SOURCE, (s.source == SourceKind::IcsUrl).then(|| "icsUrl".to_string()))?;
    write(&tx, ICS_URL, url)?;
    write(&tx, ICS_IMPORTANCE, Some(s.ics_importance.as_str().to_string()))?;
    write(&tx, ICS_CURRENCY, currency)?;
    write(&tx, WINDOW_BEFORE, Some(s.window_before_min.to_string()))?;
    write(&tx, WINDOW_AFTER, Some(s.window_after_min.to_string()))?;
    write(&tx, ALERT, Some(if s.alert { "on" } else { "off" }.to_string()))?;
    if feed_changed {
        store::clear_source(&tx, SOURCE_ICS_URL)?;
        // A new feed is fetched at the next opening; the 5-minute gap still holds.
        write(&tx, LAST_ATTEMPT_DAY, None)?;
        write(&tx, LAST_SUCCESS_AT, None)?;
        write(&tx, LAST_ERROR, None)?;
        write(&tx, LAST_COUNT, None)?;
    }
    tx.commit()?;
    get(conn)
}

pub fn state(conn: &Connection) -> Result<FetchState> {
    Ok(FetchState {
        last_attempt_at: int64(read(conn, LAST_ATTEMPT_AT)?),
        last_success_at: int64(read(conn, LAST_SUCCESS_AT)?),
        last_error: read(conn, LAST_ERROR)?,
        last_count: int64(read(conn, LAST_COUNT)?).and_then(|n| u32::try_from(n).ok()),
        last_import_at: int64(read(conn, LAST_IMPORT_AT)?),
    })
}

pub fn status(conn: &Connection) -> Result<NewsStatus> {
    let settings = get(conn)?;
    let online_host = settings.ics_url.as_deref().and_then(|u| check_url(u).ok());
    Ok(NewsStatus {
        online_ready: settings.online_ready(),
        settings,
        state: state(conn)?,
        event_count: store::count(conn)?,
        online_host,
    })
}

/// Decides whether a fetch may start now and records the attempt (before anything leaves).
/// Automatic (`manual = false`): `None` unless enabled, configured, not tried yet this Paris day
/// and not tried in the last 5 minutes. Manual: an error says why not (`news:disabled`,
/// `news:noSource`, `news:tooSoon`).
pub fn prepare_fetch(conn: &Connection, now: i64, manual: bool) -> Result<Option<FetchPlan>> {
    let s = get(conn)?;
    let refuse = |code: &str| if manual { Err(error(code)) } else { Ok(None) };
    if !s.enabled {
        return refuse("disabled");
    }
    let Some(url) = s.ics_url.clone().filter(|_| s.source == SourceKind::IcsUrl) else { return refuse("noSource") };
    let today = zones::paris_day(now);
    if !manual && read(conn, LAST_ATTEMPT_DAY)?.as_deref() == Some(today.as_str()) {
        return Ok(None);
    }
    if int64(read(conn, LAST_ATTEMPT_AT)?).is_some_and(|last| now - last < MIN_FETCH_GAP_MS && now >= last) {
        return refuse("tooSoon");
    }
    let tx = conn.unchecked_transaction()?;
    write(&tx, LAST_ATTEMPT_AT, Some(now.to_string()))?;
    write(&tx, LAST_ATTEMPT_DAY, Some(today))?;
    tx.commit()?;
    Ok(Some(FetchPlan { url, defaults: Defaults { importance: s.ics_importance, currency: s.ics_currency } }))
}

/// Stores what a fetch received (events of today − 7 to today + 60 only) and records the success.
pub fn finish_fetch(conn: &Connection, now: i64, parsed: Parsed) -> Result<ImportSummary> {
    let received = parsed.events.len();
    let summary = store::store(conn, SOURCE_ICS_URL, parsed, now, Some(store::fetch_window(now)))?;
    write(conn, LAST_SUCCESS_AT, Some(now.to_string()))?;
    write(conn, LAST_ERROR, None)?;
    write(conn, LAST_COUNT, Some(received.to_string()))?;
    Ok(summary)
}

/// Records a failed fetch (the stored events stay).
pub fn fail_fetch(conn: &Connection, code: &str) -> Result<()> {
    write(conn, LAST_ERROR, Some(code.to_string()))
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FileFormat {
    Ics,
    Csv,
}

/// Imports a local file (no network). Refused while the calendar is off.
pub fn import_file(conn: &Connection, format: FileFormat, bytes: &[u8], defaults: &Defaults, now: i64) -> Result<ImportSummary> {
    if !get(conn)?.enabled {
        return Err(error("disabled"));
    }
    let defaults = Defaults { importance: defaults.importance, currency: check_currency(&defaults.currency)? };
    let parsed = match format {
        FileFormat::Ics => ics::parse(bytes, &defaults)?,
        FileFormat::Csv => csv::parse(bytes, &defaults)?,
    };
    let summary = store::store(conn, SOURCE_FILE, parsed, now, None)?;
    write(conn, LAST_IMPORT_AT, Some(now.to_string()))?;
    Ok(summary)
}

/// Imports a file chosen in the file dialog: its size is checked before it is read.
pub fn import_path(conn: &Connection, format: FileFormat, path: &std::path::Path, defaults: &Defaults, now: i64) -> Result<ImportSummary> {
    if !get(conn)?.enabled {
        return Err(error("disabled"));
    }
    let size = std::fs::metadata(path).map_err(|_| error("fileUnreadable"))?.len();
    if size > super::MAX_BYTES as u64 {
        return Err(error("fileTooLarge"));
    }
    let bytes = std::fs::read(path).map_err(|_| error("fileUnreadable"))?;
    import_file(conn, format, &bytes, defaults, now)
}
