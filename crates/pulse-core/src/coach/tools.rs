//! The closed list of tools the AI coach may call (lot 21, see CLAUDE.md, « Principe des chiffres »).
//! Every tool is **read-only** and **re-reads** an existing report of this crate: no formula is written
//! here. Each output is a **projection** (a whitelist of fields) of that report, then two safety nets run on
//! it: [`finish`] drops any key that could reveal an account's name, capital or balance or a free text, and
//! rounds for display only (money to the cent, ratios to 4 decimals). Parameters are bounded: an unknown or
//! out-of-range one is an error returned to the AI, never a guess.

use crate::behavior::{self, ComponentSummary};
use crate::error::CoreError;
use crate::stats::analyses::{self, FeeGranularity};
use crate::stats::dashboard::compare;
use crate::stats::{self, SegmentBy, StatsQuery, pnl, risk, time};
use crate::tags::TagKind;
use crate::trades::{Direction, EmotionMoment};
use crate::{accounts, alerts, insights, instruments, journal, rules, settings};
use rusqlite::Connection;
use serde::Serialize;
use serde_json::{json, Map, Value};
use std::collections::HashMap;

/// Changes whenever a tool, its parameters or its description change: a conversation written with another
/// version is read-only (its replayed prefix would differ).
pub const TOOLS_VERSION: u32 = 1;

pub const TOOL_NAMES: [&str; 13] = [
    "list_accounts",
    "period_summary",
    "segments",
    "recurring_mistakes",
    "discipline",
    "streaks_and_sequences",
    "plan_and_rules",
    "risk",
    "external_factors",
    "fees_and_holding_time",
    "insights",
    "alerts_today",
    "trade_list",
];

/// Largest serialized tool result sent to the AI.
pub const MAX_TOOL_RESULT_BYTES: usize = 20_000;
/// Longest custom window.
const MAX_WINDOW_DAYS: i64 = 3_660;
const DAY_MS: i64 = 86_400_000;
const MAX_SEGMENTS: usize = 30;
const MAX_MISTAKES: usize = 10;
const MAX_RULES: usize = 20;
const MAX_LISTED_DAYS: usize = 10;
const MAX_INSIGHTS: usize = 15;
const MAX_TRADE_IDS: usize = 20;
const MAX_TRADES: u64 = 20;
const DEFAULT_TRADES: u64 = 10;

/// Keys never sent, wherever they appear (a projection that forgot one is caught here).
const DENIED_KEYS: [&str; 17] = [
    "accountName",
    "broker",
    "initialCapital",
    "currentCapital",
    "capital",
    "referenceBalance",
    "balance",
    "balanceAtEntry",
    "avgBalance",
    "limitAmount",
    "totalDeposits",
    "totalWithdrawals",
    "thesis",
    "notes",
    "postMortem",
    "screenshotPath",
    "journal",
];

const SUMMARY_FULL: [&str; 23] = [
    "tradeCount",
    "winCount",
    "lossCount",
    "breakevenCount",
    "grossPnl",
    "fees",
    "netPnl",
    "totalGains",
    "totalLosses",
    "returnPct",
    "winRate",
    "avgWin",
    "avgLoss",
    "avgWinLossRatio",
    "profitFactor",
    "expectancyR",
    "rTradeCount",
    "avgNetPnl",
    "sharpe",
    "maxDrawdown",
    "maxDrawdownPct",
    "currentDrawdown",
    "currentDrawdownPct",
];
const SUMMARY_SHORT: [&str; 9] = ["tradeCount", "winCount", "lossCount", "winRate", "netPnl", "avgNetPnl", "expectancyR", "rTradeCount", "profitFactor"];

/// Who and when a question is about: the accounts of the top bar when it was sent (active accounts when
/// none is chosen), the instant and the local offset. A tool can narrow to one of these accounts, never widen.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolScope {
    pub account_ids: Vec<i64>,
    pub now_ms: i64,
    pub tz_offset_min: i32,
}

impl ToolScope {
    pub fn new(conn: &Connection, requested: &[i64], now_ms: i64, tz_offset_min: i32) -> crate::Result<ToolScope> {
        let mut account_ids: Vec<i64> = if requested.is_empty() {
            accounts::list_active(conn)?.iter().map(|a| a.id).collect()
        } else {
            requested.iter().map(|&id| accounts::get(conn, id).map(|a| a.id)).collect::<crate::Result<_>>()?
        };
        account_ids.sort_unstable();
        account_ids.dedup();
        Ok(ToolScope { account_ids, now_ms, tz_offset_min })
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolOutput {
    /// Exactly what is sent to the AI (and shown in the « données envoyées » log).
    pub content: Value,
    pub is_error: bool,
}

struct ToolError(String);

impl From<CoreError> for ToolError {
    fn from(e: CoreError) -> Self {
        match e {
            CoreError::Invalid(msg) if msg.contains("different currencies") => {
                ToolError("Les comptes de la portée ont des devises différentes : précisez accountId (un compte).".into())
            }
            _ => ToolError("Données indisponibles pour cette demande.".into()),
        }
    }
}

type Out = Result<Value, ToolError>;

/// Runs one tool. Never panics, never writes: an error is an output with `is_error`.
pub fn run(conn: &Connection, scope: &ToolScope, name: &str, input: &Value) -> ToolOutput {
    let result = match name {
        "list_accounts" => list_accounts(conn, scope, input),
        "period_summary" => period_summary(conn, scope, input),
        "segments" => segments(conn, scope, input),
        "recurring_mistakes" => recurring_mistakes(conn, scope, input),
        "discipline" => discipline(conn, scope, input),
        "streaks_and_sequences" => streaks_and_sequences(conn, scope, input),
        "plan_and_rules" => plan_and_rules(conn, scope, input),
        "risk" => risk_tool(conn, scope, input),
        "external_factors" => external_factors(conn, scope, input),
        "fees_and_holding_time" => fees_and_holding_time(conn, scope, input),
        "insights" => insights_tool(conn, scope, input),
        "alerts_today" => alerts_today(conn, scope, input),
        "trade_list" => trade_list(conn, scope, input),
        _ => Err(ToolError(format!("Outil inconnu : {}. Outils disponibles : {}.", truncate(name, 40), TOOL_NAMES.join(", ")))),
    };
    match result.map(finish) {
        Ok(content) if content.to_string().len() <= MAX_TOOL_RESULT_BYTES => ToolOutput { content, is_error: false },
        Ok(_) => error("Résultat trop volumineux : réduisez la période ou précisez un compte."),
        Err(ToolError(msg)) => error(&msg),
    }
}

fn error(msg: &str) -> ToolOutput {
    ToolOutput { content: json!({ "error": msg }), is_error: true }
}

fn truncate(s: &str, n: usize) -> String {
    s.chars().take(n).collect()
}

// --- Definitions sent to the AI (identical for everybody: no data) ---

fn window_properties() -> Map<String, Value> {
    let mut p = Map::new();
    p.insert(
        "period".into(),
        json!({ "type": "string", "enum": ["1J", "1S", "1M", "3M", "1A", "Tout"],
            "description": "Fenêtre se terminant aujourd'hui : 1J = aujourd'hui, 1S = 7 jours, 1M = 30 jours, 3M = 90 jours, 1A = 365 jours, Tout = tout l'historique. Par défaut 1M. Ne pas combiner avec from/to." }),
    );
    p.insert("from".into(), json!({ "type": "string", "description": "Premier jour local inclus, AAAA-MM-JJ (fenêtre sur mesure, 10 ans au plus)." }));
    p.insert("to".into(), json!({ "type": "string", "description": "Dernier jour local inclus, AAAA-MM-JJ (par défaut aujourd'hui)." }));
    p.insert("accountId".into(), json!({ "type": "integer", "description": "Un compte de la portée (voir list_accounts). Par défaut : tous les comptes de la portée." }));
    p.insert("direction".into(), json!({ "type": "string", "enum": ["long", "short"], "description": "Seulement les achats ou les ventes." }));
    p.insert("symbol".into(), json!({ "type": "string", "description": "Seulement cet actif (symbole, ex. EURUSD)." }));
    p
}

fn tool(name: &str, description: &str, extra: Value, with_window: bool) -> Value {
    let mut properties = if with_window { window_properties() } else { Map::new() };
    if let Value::Object(e) = extra {
        properties.extend(e);
    }
    json!({ "name": name, "description": description,
        "input_schema": { "type": "object", "properties": properties, "additionalProperties": false } })
}

/// The tool list sent with every request, in [`TOOL_NAMES`] order.
pub fn definitions() -> Value {
    let account_only = json!({ "accountId": { "type": "integer", "description": "Un compte de la portée. Par défaut : chaque compte de la portée, évalué seul." } });
    Value::Array(vec![
        tool("list_accounts", "Comptes de la portée de la question (identifiant, devise, type, archivé, nombre de trades clôturés) et date locale du jour. À appeler en premier si la question dépend du compte ou de la date. Ne renvoie ni nom ni capital.", json!({}), false),
        tool("period_summary", "Indicateurs de performance d'une fenêtre (trades clôturés) : PnL brut / frais / net, win rate, gain et perte moyens, R:R réel, profit factor, expectancy en R, drawdown, etc. Avec comparePrevious, ajoute la fenêtre précédente de même durée et les écarts déjà calculés. À appeler pour « résume ma semaine », « comment va mon mois ».", json!({ "comparePrevious": { "type": "boolean", "description": "Ajoute la fenêtre précédente de même durée et les écarts (période − précédente)." } }), true),
        tool("segments", "Indicateurs découpés par segment (win rate, PnL net, expectancy R…). À appeler pour « quel jour / quelle heure / quel setup / quelle émotion me réussit ou me coûte ».", json!({ "by": { "type": "string", "enum": ["weekday", "hour", "session", "setup", "timeframe", "marketCondition", "mistake", "emotionBefore", "emotionAny", "instrument", "assetClass", "direction", "executionType", "plan", "dayRank", "ruleBroken"], "description": "Découpage : weekday (1 = lundi … 7 = dimanche, jour d'entrée), hour (heure locale d'entrée), tags (session, setup, timeframe, marketCondition, mistake), émotion déclarée avant l'entrée ou à tout moment, actif, classe d'actif, sens, système / discrétionnaire, plan suivi, rang dans la journée, règle non respectée." } }), true),
        tool("recurring_mistakes", "Erreurs récurrentes (tags d'erreur et règles non respectées) : nombre de trades, part, PnL net, coût (somme des pertes), expectancy R ; classées par coût et par fréquence (10 au plus).", json!({}), true),
        tool("discipline", "Score de discipline (0 à 100) de la fenêtre, ses composantes (plan, règles, checklist, stop loss, risque, comportement) et les quatre cases gagnant / perdant × bien / mal exécuté.", json!({}), true),
        tool("streaks_and_sequences", "Séries de gains / pertes, trades de revanche, jours de surtrading, résultats après 2 pertes d'affilée, variation de taille après une perte ou un gain.", json!({}), true),
        tool("plan_and_rules", "Résultats dans le plan / hors plan, simulation « si les trades hors plan n'avaient pas été pris » (simulation, pas un conseil), respect de chaque règle personnelle.", json!({}), true),
        tool("risk", "Risque par trade en % du solde à l'entrée : moyenne, médiane, maximum, trades sans stop loss, dépassements de la limite réglée.", json!({}), true),
        tool("external_factors", "Résultats selon les facteurs notés dans le journal quotidien (mauvais sommeil, fatigue, heures tardives, humeur basse) : présent / absent, expectancy, discipline, verdicts prudents. Jamais le texte du journal.", json!({}), true),
        tool("fees_and_holding_time", "Frais et commissions (total, part dans le PnL brut, frais par trade) et temps en position des gagnants / perdants (minutes et heures).", json!({}), true),
        tool("insights", "Insights automatiques de Pulse en ce moment (tendances sur les derniers trades, meilleur / plus faible setup, suggestions), déjà calculés avec leurs valeurs. Fenêtres fixes : 20 derniers trades, 90 derniers jours.", account_only.clone(), false),
        tool("alerts_today", "Alertes garde-fous d'aujourd'hui (pertes consécutives, limite de trades, perte du jour / de la semaine, revanche, hors horaires, sans stop loss).", account_only, false),
        tool("trade_list", "Liste courte de trades clôturés (20 au plus) avec leurs chiffres : identifiant, actif, sens, jour et heure locaux, PnL net, R, score de discipline, plan, erreurs. Préférer les agrégats ; utile pour « mes pires trades de la semaine ».", json!({ "order": { "type": "string", "enum": ["worst", "best", "recent"], "description": "worst = PnL net le plus bas d'abord (défaut), best = le plus haut, recent = le plus récent." }, "limit": { "type": "integer", "minimum": 1, "maximum": 20, "description": "Nombre de trades (défaut 10)." } }), true),
    ])
}

// --- Parameters ---

fn args<'a>(input: &'a Value, allowed: &[&str]) -> Result<&'a Map<String, Value>, ToolError> {
    static EMPTY: std::sync::OnceLock<Map<String, Value>> = std::sync::OnceLock::new();
    let map = match input {
        Value::Object(m) => m,
        Value::Null => EMPTY.get_or_init(Map::new),
        _ => return Err(ToolError("Les paramètres doivent être un objet JSON.".into())),
    };
    if let Some(k) = map.keys().find(|k| !allowed.contains(&k.as_str())) {
        return Err(ToolError(format!("Paramètre inconnu : {}. Paramètres acceptés : {}.", truncate(k, 40), allowed.join(", "))));
    }
    Ok(map)
}

const WINDOW_ARGS: [&str; 6] = ["period", "from", "to", "accountId", "direction", "symbol"];

fn with_window(extra: &[&'static str]) -> Vec<&'static str> {
    WINDOW_ARGS.iter().chain(extra).copied().collect()
}

fn text_arg<'a>(map: &'a Map<String, Value>, key: &str) -> Result<Option<&'a str>, ToolError> {
    match map.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => Ok(Some(s.as_str())),
        Some(_) => Err(ToolError(format!("{key} doit être une chaîne."))),
    }
}

/// A window `[from, to)` of local days, as the dashboard computes it.
struct Window {
    from: Option<i64>,
    to: Option<i64>,
    first_day: Option<i64>,
    last_day: i64,
    label: String,
}

impl Window {
    fn json(&self) -> Value {
        json!({ "label": self.label, "from": self.first_day.map(day_string), "to": day_string(self.last_day) })
    }

    /// The window of the same length just before; `None` for all time.
    fn previous(&self, tz: i32) -> Option<Window> {
        let first = self.first_day?;
        let len = self.last_day - first + 1;
        let (p_first, p_last) = (first - len, first - 1);
        Some(Window { from: Some(midnight(p_first, tz)), to: Some(midnight(p_last + 1, tz)), first_day: Some(p_first), last_day: p_last, label: "précédente".into() })
    }
}

fn midnight(day: i64, tz: i32) -> i64 {
    day * DAY_MS - i64::from(tz) * 60_000
}

fn day_string(day: i64) -> String {
    let (y, m, d) = time::civil_from_days(day);
    format!("{y:04}-{m:02}-{d:02}")
}

fn window(scope: &ToolScope, map: &Map<String, Value>) -> Result<Window, ToolError> {
    let tz = scope.tz_offset_min;
    let today = time::local_day_number(scope.now_ms, tz);
    let (from, to) = (text_arg(map, "from")?, text_arg(map, "to")?);
    let period = text_arg(map, "period")?;
    if period.is_some() && (from.is_some() || to.is_some()) {
        return Err(ToolError("Utilisez period OU from/to, pas les deux.".into()));
    }
    if from.is_some() || to.is_some() {
        let parse = |s: &str| time::parse_day(s).ok_or_else(|| ToolError(format!("Date invalide : {} (attendu AAAA-MM-JJ).", truncate(s, 20))));
        let first = parse(from.ok_or_else(|| ToolError("from est requis avec to.".into()))?)?;
        let last = to.map(parse).transpose()?.unwrap_or(today);
        if last < first || last - first + 1 > MAX_WINDOW_DAYS {
            return Err(ToolError("Fenêtre invalide : to doit suivre from, 10 ans au plus.".into()));
        }
        return Ok(Window { from: Some(midnight(first, tz)), to: Some(midnight(last + 1, tz)), first_day: Some(first), last_day: last, label: "sur mesure".into() });
    }
    let label = period.unwrap_or("1M");
    let days = match label {
        "1J" => Some(1),
        "1S" => Some(7),
        "1M" => Some(30),
        "3M" => Some(90),
        "1A" => Some(365),
        "Tout" => None,
        other => return Err(ToolError(format!("Période inconnue : {} (1J, 1S, 1M, 3M, 1A ou Tout).", truncate(other, 10)))),
    };
    Ok(match days {
        Some(n) => Window {
            from: Some(midnight(today + 1 - n, tz)),
            to: Some(midnight(today + 1, tz)),
            first_day: Some(today + 1 - n),
            last_day: today,
            label: label.to_owned(),
        },
        None => Window { from: None, to: None, first_day: None, last_day: today, label: label.to_owned() },
    })
}

fn accounts_arg(scope: &ToolScope, map: &Map<String, Value>) -> Result<Vec<i64>, ToolError> {
    match map.get("accountId") {
        None | Some(Value::Null) => Ok(scope.account_ids.clone()),
        Some(v) => match v.as_i64() {
            Some(id) if scope.account_ids.contains(&id) => Ok(vec![id]),
            _ => Err(ToolError("accountId doit être un compte de la portée (voir list_accounts).".into())),
        },
    }
}

fn query(conn: &Connection, scope: &ToolScope, map: &Map<String, Value>, w: &Window) -> Result<StatsQuery, ToolError> {
    let direction = match text_arg(map, "direction")? {
        None => None,
        Some(d) => Some(Direction::parse(d).ok_or_else(|| ToolError("direction : long ou short.".into()))?),
    };
    let instrument_ids = match text_arg(map, "symbol")? {
        None => Vec::new(),
        Some(s) if s.chars().count() <= 30 => match instruments::get_by_symbol(conn, s)? {
            Some(i) => vec![i.id],
            None => return Err(ToolError(format!("Actif inconnu : {}.", truncate(s, 30)))),
        },
        Some(_) => return Err(ToolError("symbol : 30 caractères au plus.".into())),
    };
    Ok(StatsQuery { account_ids: accounts_arg(scope, map)?, from: w.from, to: w.to, direction, instrument_ids, ..StatsQuery::default() })
}

// --- Output helpers ---

fn value<T: Serialize>(v: &T) -> Value {
    serde_json::to_value(v).unwrap_or(Value::Null)
}

/// Only these keys of an object, in this order.
fn pick(v: &Value, keys: &[&str]) -> Value {
    let mut out = Map::new();
    for &k in keys {
        if let Some(x) = v.get(k) {
            out.insert(k.to_owned(), x.clone());
        }
    }
    Value::Object(out)
}

fn with(mut base: Value, key: &str, v: Value) -> Value {
    if let Value::Object(m) = &mut base {
        m.insert(key.to_owned(), v);
    }
    base
}

fn currency(conn: &Connection, ids: &[i64]) -> Result<Option<String>, ToolError> {
    Ok(stats::load(conn, ids)?.currency)
}

/// Drops the denied keys everywhere and rounds for display: decimal strings (money) to the cent, fractional
/// numbers to 4 decimals. Integers, dates and labels are left as they are.
fn finish(v: Value) -> Value {
    match v {
        Value::Object(m) => Value::Object(m.into_iter().filter(|(k, _)| !DENIED_KEYS.contains(&k.as_str())).map(|(k, x)| (k, finish(x))).collect()),
        Value::Array(items) => Value::Array(items.into_iter().map(finish).collect()),
        Value::Number(n) if n.is_f64() => {
            let f = n.as_f64().unwrap_or(0.0);
            let r = (f * 10_000.0).round() / 10_000.0;
            serde_json::Number::from_f64(if r == 0.0 { 0.0 } else { r }).map(Value::Number).unwrap_or(Value::Null)
        }
        Value::String(s) if is_decimal(&s) => match s.parse::<rust_decimal::Decimal>() {
            Ok(d) => {
                let r = d.round_dp_with_strategy(2, rust_decimal::RoundingStrategy::MidpointAwayFromZero).normalize();
                Value::String(if r.is_zero() { "0".into() } else { r.to_string() })
            }
            Err(_) => Value::String(s),
        },
        other => other,
    }
}

fn is_decimal(s: &str) -> bool {
    let body = s.strip_prefix('-').unwrap_or(s);
    match body.split_once('.') {
        Some((i, f)) => !i.is_empty() && !f.is_empty() && i.bytes().all(|b| b.is_ascii_digit()) && f.bytes().all(|b| b.is_ascii_digit()),
        None => false,
    }
}

fn local_time(ms: i64, tz: i32) -> String {
    let minutes = (ms + i64::from(tz) * 60_000).rem_euclid(DAY_MS) / 60_000;
    format!("{} {:02}:{:02}", time::day_key(ms, tz), minutes / 60, minutes % 60)
}

// --- The tools ---

fn list_accounts(conn: &Connection, scope: &ToolScope, input: &Value) -> Out {
    args(input, &[])?;
    let mut list = Vec::new();
    for &id in &scope.account_ids {
        let a = accounts::get(conn, id)?;
        let closed: i64 = conn
            .query_row("SELECT COUNT(*) FROM trades WHERE account_id = ?1 AND exit_time IS NOT NULL", [id], |r| r.get(0))
            .map_err(CoreError::from)?;
        list.push(json!({ "id": a.id, "currency": a.currency, "type": a.kind, "archived": a.archived, "closedTradeCount": closed }));
    }
    Ok(json!({
        "today": time::day_key(scope.now_ms, scope.tz_offset_min),
        "weekday": time::weekday(scope.now_ms, scope.tz_offset_min),
        "tzOffsetMin": scope.tz_offset_min,
        "accounts": list,
    }))
}

fn period_summary(conn: &Connection, scope: &ToolScope, input: &Value) -> Out {
    let map = args(input, &with_window(&["comparePrevious"]))?;
    let w = window(scope, map)?;
    let q = query(conn, scope, map, &w)?;
    let report = stats::report(conn, &q)?;
    let mut out = json!({
        "window": w.json(),
        "currency": report.currency,
        "openTradeCount": report.open_trade_count,
        "summary": pick(&value(&report.summary), &SUMMARY_FULL),
    });
    let compare_previous = match map.get("comparePrevious") {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(_) => return Err(ToolError("comparePrevious doit être true ou false.".into())),
    };
    if compare_previous {
        match w.previous(scope.tz_offset_min) {
            Some(p) => {
                let previous = stats::report(conn, &StatsQuery { from: p.from, to: p.to, ..q.clone() })?;
                let comparison = compare(&report.summary, &previous.summary)?;
                out = with(out, "previous", json!({ "window": p.json(), "summary": pick(&value(&previous.summary), &SUMMARY_FULL) }));
                out = with(out, "comparison", with(value(&comparison), "meaning", json!("période − période précédente ; winRate en points de fraction, netPnlPct relatif")));
            }
            None => out = with(out, "previous", json!("aucune : la fenêtre « Tout » n'a pas de période précédente")),
        }
    }
    Ok(out)
}

fn segment_by(by: &str) -> Option<SegmentBy> {
    Some(match by {
        "weekday" => SegmentBy::Weekday,
        "hour" => SegmentBy::Hour,
        "session" => SegmentBy::Tag(TagKind::Session),
        "setup" => SegmentBy::Tag(TagKind::Setup),
        "timeframe" => SegmentBy::Tag(TagKind::Timeframe),
        "marketCondition" => SegmentBy::Tag(TagKind::MarketCondition),
        "mistake" => SegmentBy::Tag(TagKind::Mistake),
        "emotionBefore" => SegmentBy::Emotion(Some(EmotionMoment::Before)),
        "emotionAny" => SegmentBy::Emotion(None),
        "instrument" => SegmentBy::Instrument,
        "assetClass" => SegmentBy::AssetClass,
        "direction" => SegmentBy::Direction,
        "executionType" => SegmentBy::ExecutionType,
        "plan" => SegmentBy::PlanFollowed,
        "dayRank" => SegmentBy::DayRank,
        "ruleBroken" => SegmentBy::RuleBroken,
        _ => return None,
    })
}

fn segments(conn: &Connection, scope: &ToolScope, input: &Value) -> Out {
    let map = args(input, &with_window(&["by"]))?;
    let by_text = text_arg(map, "by")?.ok_or_else(|| ToolError("by est requis.".into()))?;
    let by = segment_by(by_text).ok_or_else(|| ToolError(format!("Découpage inconnu : {}.", truncate(by_text, 20))))?;
    let w = window(scope, map)?;
    let q = query(conn, scope, map, &w)?;
    let list = stats::segment_report(conn, &q, by)?;
    let total = list.len();
    let rows: Vec<Value> = list
        .iter()
        .take(MAX_SEGMENTS)
        .map(|s| {
            let mut row = json!({ "key": s.key, "label": s.label });
            if let (Value::Object(r), Value::Object(sum)) = (&mut row, pick(&value(&s.summary), &SUMMARY_SHORT)) {
                r.extend(sum);
            }
            row
        })
        .collect();
    Ok(json!({ "window": w.json(), "currency": currency(conn, &q.account_ids)?, "by": by_text, "segmentCount": total, "segments": rows,
        "note": if total > MAX_SEGMENTS { json!(format!("{MAX_SEGMENTS} premiers segments sur {total}")) } else { Value::Null } }))
}

fn recurring_mistakes(conn: &Connection, scope: &ToolScope, input: &Value) -> Out {
    let map = args(input, &with_window(&[]))?;
    let w = window(scope, map)?;
    let q = query(conn, scope, map, &w)?;
    let r = behavior::mistake_report(conn, &q)?;
    let keys = ["source", "label", "tradeCount", "share", "netPnl", "cost", "expectancyR"];
    let top = |list: &[behavior::Mistake]| list.iter().take(MAX_MISTAKES).map(|m| pick(&value(m), &keys)).collect::<Vec<_>>();
    Ok(json!({ "window": w.json(), "currency": currency(conn, &q.account_ids)?, "tradeCount": r.trade_count,
        "tradesWithMistake": r.trades_with_mistake, "byCost": top(&r.by_cost), "byCount": top(&r.by_count) }))
}

fn discipline(conn: &Connection, scope: &ToolScope, input: &Value) -> Out {
    let map = args(input, &with_window(&[]))?;
    let w = window(scope, map)?;
    let q = query(conn, scope, map, &w)?;
    let r = behavior::discipline_report(conn, &q)?;
    let components: Vec<Value> = r.components.iter().map(|c: &ComponentSummary| pick(&value(c), &["key", "weight", "tradeCount", "average"])).collect();
    Ok(json!({ "window": w.json(), "currency": currency(conn, &q.account_ids)?, "score": r.score, "scoredTradeCount": r.scored_trade_count,
        "minTradeCount": r.min_trade_count, "sampleTooSmall": r.sample_too_small, "components": components, "quadrants": value(&r.quadrants),
        "scale": "score de 0 à 100 ; average des composantes de 0 à 1 ; bien exécuté = score ≥ threshold" }))
}

fn streaks_and_sequences(conn: &Connection, scope: &ToolScope, input: &Value) -> Out {
    let map = args(input, &with_window(&[]))?;
    let w = window(scope, map)?;
    let q = query(conn, scope, map, &w)?;
    let s = behavior::streak_report(conn, &q)?;
    let p = behavior::pattern_report(conn, &q)?;
    let a = behavior::after_losses_report(conn, &q)?;
    let z = behavior::size_change_report(conn, &q)?;
    let streak = |x: &Option<behavior::Streak>| x.as_ref().map(|x| pick(&value(x), &["outcome", "length", "netPnl"]));
    let group = |g: &behavior::SequenceGroup| json!({ "summary": pick(&value(&g.summary), &SUMMARY_SHORT), "disciplineScore": g.discipline_score, "scoredTradeCount": g.scored_trade_count });
    let size = |g: &behavior::SizeChangeGroup| pick(&value(g), &["caseCount", "notComparableCount", "increasedCount", "meanChange", "medianChange"]);
    Ok(json!({
        "window": w.json(),
        "currency": currency(conn, &q.account_ids)?,
        "streaks": { "tradeCount": s.trade_count, "current": streak(&s.current), "longestWin": streak(&s.longest_win), "longestLoss": streak(&s.longest_loss) },
        "revenge": { "count": p.revenge_trades.len(), "summary": pick(&value(&p.revenge_summary), &SUMMARY_SHORT) },
        "overtrading": { "maxTradesPerDay": p.max_trades_per_day, "dayCount": p.overtrading_days.len(),
            "days": p.overtrading_days.iter().take(MAX_LISTED_DAYS).map(|d| pick(&value(d), &["accountId", "day", "tradeCount", "limit"])).collect::<Vec<_>>() },
        "afterTwoLosses": { "afterTwoLosses": group(&a.after_two_losses), "others": group(&a.others), "minTradeCount": a.min_trade_count,
            "sampleTooSmall": a.sample_too_small, "winRateDifference": a.win_rate_difference, "avgNetPnlDifference": a.avg_net_pnl_difference,
            "expectancyRDifference": a.expectancy_r_difference, "disciplineDifference": a.discipline_difference },
        "sizeChange": { "afterLoss": size(&z.after_loss), "afterWin": size(&z.after_win), "afterBreakeven": size(&z.after_breakeven),
            "noPreviousCount": z.no_previous_count, "minCaseCount": z.min_case_count, "lossVsWin": z.loss_vs_win,
            "meaning": "meanChange 0.23 = exposition +23 % par rapport au trade précédent" },
    }))
}

fn plan_and_rules(conn: &Connection, scope: &ToolScope, input: &Value) -> Out {
    let map = args(input, &with_window(&[]))?;
    let w = window(scope, map)?;
    let q = query(conn, scope, map, &w)?;
    let plan = behavior::plan_report(conn, &q)?;
    let sim = behavior::plan_simulation_report(conn, &q)?;
    let rules = behavior::rule_adherence_report(conn, &q)?;
    let result = ["tradeCount", "netPnl", "winRate", "expectancyR", "profitFactor", "maxDrawdown"];
    let scenario = |s: &behavior::Scenario| {
        json!({ "excludedTradeCount": s.excluded_trade_count, "excludedNetPnl": s.excluded_net_pnl, "difference": s.difference, "result": pick(&value(&s.result), &result) })
    };
    Ok(json!({
        "window": w.json(),
        "currency": currency(conn, &q.account_ids)?,
        "plan": plan.groups.iter().map(|g| with(pick(&value(&g.summary), &SUMMARY_SHORT), "key", json!(g.key))).collect::<Vec<_>>(),
        "simulation": { "declaredTradeCount": sim.declared_trade_count, "actual": pick(&value(&sim.actual), &result),
            "withoutOffPlan": scenario(&sim.without_off_plan), "withoutOffPlanOrPartial": scenario(&sim.without_off_plan_or_partial),
            "meaning": "simulation : trades retirés, sorties non rejouées ; difference = PnL simulé − PnL réel" },
        "rules": { "checks": rules.checks, "respected": rules.respected, "rate": rules.rate, "tradesWithChecks": rules.trades_with_checks,
            "rules": rules.rules.iter().take(MAX_RULES).map(|r| pick(&value(r), &["ruleId", "text", "archived", "checks", "respected", "rate", "trend"])).collect::<Vec<_>>() },
    }))
}

fn risk_tool(conn: &Connection, scope: &ToolScope, input: &Value) -> Out {
    let map = args(input, &with_window(&[]))?;
    let w = window(scope, map)?;
    let q = query(conn, scope, map, &w)?;
    let r = risk::risk_report(conn, &q)?;
    let mut out = pick(&value(&r), &["tradeCount", "withoutStopCount", "avgRiskPct", "medianRiskPct", "maxRiskPct", "maxRiskPercent", "overLimitCount"]);
    out = with(out, "window", w.json());
    Ok(with(out, "meaning", json!("avgRiskPct 0.012 = 1,2 % du solde à l'entrée ; maxRiskPercent = limite réglée, déjà en % (1.5 = 1,5 %)")))
}

fn external_factors(conn: &Connection, scope: &ToolScope, input: &Value) -> Out {
    let map = args(input, &with_window(&[]))?;
    let w = window(scope, map)?;
    let q = query(conn, scope, map, &w)?;
    let r = behavior::external_factor_report(conn, &q)?;
    let side = |s: &behavior::FactorSide| json!({ "dayCount": s.day_count, "summary": pick(&value(&s.summary), &SUMMARY_SHORT), "disciplineScore": s.discipline_score });
    let factors: Vec<Value> = r
        .factors
        .iter()
        .map(|f| {
            json!({ "key": value(&f.key), "present": side(&f.present), "absent": side(&f.absent), "undeclaredDayCount": f.undeclared_day_count,
                "undeclaredTradeCount": f.undeclared_trade_count, "discipline": value(&f.discipline), "expectancyR": value(&f.expectancy_r),
                "avgNetPnlDifference": f.avg_net_pnl_difference })
        })
        .collect();
    Ok(json!({ "window": w.json(), "currency": currency(conn, &q.account_ids)?, "tradeCount": r.trade_count, "tradingDayCount": r.trading_day_count,
        "journalDayCount": r.journal_day_count, "minDayCount": r.min_day_count, "minRTradeCount": r.min_r_trade_count, "factors": factors,
        "meaning": "constats « en même temps », jamais une cause" }))
}

fn fees_and_holding_time(conn: &Connection, scope: &ToolScope, input: &Value) -> Out {
    let map = args(input, &with_window(&[]))?;
    let w = window(scope, map)?;
    let q = query(conn, scope, map, &w)?;
    let f = analyses::fee_report(conn, &q, FeeGranularity::Month)?;
    let d = analyses::duration_report(conn, &q)?;
    let minutes = |ms: Option<f64>| ms.map(|m| m / 60_000.0);
    let hours = |ms: Option<f64>| ms.map(|m| m / 3_600_000.0);
    let group = |g: &analyses::DurationGroup| {
        json!({ "tradeCount": g.trade_count, "avgMinutes": minutes(g.avg_ms), "medianMinutes": minutes(g.median_ms), "avgHours": hours(g.avg_ms), "medianHours": hours(g.median_ms), "lowSample": g.low_sample })
    };
    Ok(json!({
        "window": w.json(),
        "currency": currency(conn, &q.account_ids)?,
        "fees": pick(&value(&f), &["tradeCount", "tradesWithFees", "grossPnl", "fees", "netPnl", "feesShareOfGross", "feesPerTrade"]),
        "holdingTime": { "measuredCount": d.measured_count, "openTradeCount": d.open_trade_count, "minSample": d.min_sample,
            "winners": group(&d.winners), "losers": group(&d.losers), "breakevens": group(&d.breakevens), "comparable": d.comparable,
            "avgRatio": d.avg_ratio, "medianRatio": d.median_ratio },
    }))
}

fn per_account(scope: &ToolScope, map: &Map<String, Value>) -> Result<Vec<i64>, ToolError> {
    accounts_arg(scope, map)
}

fn insights_tool(conn: &Connection, scope: &ToolScope, input: &Value) -> Out {
    let map = args(input, &["accountId"])?;
    let behavior = settings::behavior(conn)?;
    let entries = journal::list(conn, None, None)?;
    let rule_list = rules::list(conn, true)?;
    let mut list = Vec::new();
    for id in per_account(scope, map)? {
        list.extend(insights::evaluate(&stats::load(conn, &[id])?, scope.now_ms, scope.tz_offset_min, &behavior, &entries, &rule_list)?);
    }
    let total = list.len();
    let rows: Vec<Value> = list
        .iter()
        .take(MAX_INSIGHTS)
        .map(|i| {
            let mut v = value(i);
            if let Value::Object(m) = &mut v {
                for k in ["id", "situation", "level", "episode", "firstSeenAt", "dismissedAt", "filter"] {
                    m.remove(k);
                }
                if let Some(Value::Array(ids)) = m.get_mut("tradeIds") {
                    ids.truncate(MAX_TRADE_IDS);
                }
            }
            v
        })
        .collect();
    Ok(json!({ "insightCount": total, "insights": rows, "meaning": "fractions : 0.23 = 23 % ; constats, jamais des ordres" }))
}

fn alerts_today(conn: &Connection, scope: &ToolScope, input: &Value) -> Out {
    let map = args(input, &["accountId"])?;
    let behavior = settings::behavior(conn)?;
    let thresholds = alerts::settings::get(conn)?;
    let mut rows = Vec::new();
    for id in per_account(scope, map)? {
        for a in alerts::evaluate(&stats::load(conn, &[id])?, scope.now_ms, scope.tz_offset_min, &behavior, &thresholds)? {
            let mut v = value(&a);
            if let Value::Object(m) = &mut v {
                m.remove("id");
                m.remove("at");
                m.insert("atLocal".into(), json!(local_time(a.at, scope.tz_offset_min)));
            }
            rows.push(v);
        }
    }
    Ok(json!({ "today": time::day_key(scope.now_ms, scope.tz_offset_min), "alertCount": rows.len(), "alerts": rows }))
}

fn trade_list(conn: &Connection, scope: &ToolScope, input: &Value) -> Out {
    let map = args(input, &with_window(&["order", "limit"]))?;
    let order = text_arg(map, "order")?.unwrap_or("worst");
    if !["worst", "best", "recent"].contains(&order) {
        return Err(ToolError("order : worst, best ou recent.".into()));
    }
    let limit = match map.get("limit") {
        None | Some(Value::Null) => DEFAULT_TRADES,
        Some(v) => v.as_u64().filter(|n| (1..=MAX_TRADES).contains(n)).ok_or_else(|| ToolError("limit : entier de 1 à 20.".into()))?,
    };
    let w = window(scope, map)?;
    let q = query(conn, scope, map, &w)?;
    let report = behavior::discipline_report(conn, &q)?;
    let ledger = stats::load(conn, &q.account_ids)?;
    let facts: HashMap<i64, &stats::TradeFacts> = ledger.trades.iter().map(|t| (t.id, t)).collect();
    let mut trades: Vec<&behavior::TradeDiscipline> = report.trades.iter().filter(|t| t.net_pnl.is_some()).collect();
    match order {
        "worst" => trades.sort_by(|a, b| a.net_pnl.cmp(&b.net_pnl).then(a.trade_id.cmp(&b.trade_id))),
        "best" => trades.sort_by(|a, b| b.net_pnl.cmp(&a.net_pnl).then(a.trade_id.cmp(&b.trade_id))),
        _ => trades.sort_by(|a, b| b.exit_time.cmp(&a.exit_time).then(b.trade_id.cmp(&a.trade_id))),
    }
    let mut rows = Vec::new();
    for t in trades.into_iter().take(limit as usize) {
        let Some(f) = facts.get(&t.trade_id) else { continue };
        let r = pnl::figures(&f.position)?.and_then(|x| x.r_multiple);
        let mistakes: Vec<&str> = f.tags.iter().filter(|g| g.kind == TagKind::Mistake).map(|g| g.name.as_str()).collect();
        rows.push(json!({
            "id": t.trade_id, "accountId": t.account_id, "symbol": f.symbol, "direction": f.position.direction.as_str(),
            "entryLocal": local_time(f.entry_time, f.tz_offset_min), "exitLocal": t.exit_time.map(|e| local_time(e, f.tz_offset_min)),
            "netPnl": t.net_pnl, "r": r, "outcome": value(&t.outcome), "disciplineScore": t.score,
            "plan": t.plan_followed.map(|p| p.as_str()), "revenge": t.revenge.is_some(), "overtrading": t.overtrading, "dayRank": t.day_rank,
            "mistakes": mistakes,
        }));
    }
    Ok(json!({ "window": w.json(), "currency": ledger.currency, "order": order, "closedTradeCount": report.trades.iter().filter(|t| t.net_pnl.is_some()).count(), "trades": rows }))
}
