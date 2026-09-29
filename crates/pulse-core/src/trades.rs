//! Trades (spec 2.2, 3.1, 3.2). Only source data is stored: PnL, R-multiple and
//! outcome are always recomputed by `stats` (spec 3.1.1, section 6).

use crate::error::{CoreError, Result};
use crate::money::{self, Decimal};
use crate::tags::{self, TagKind};
use crate::util::{check_range, check_tz_offset, clean_text, ids_condition, text_enum};
use crate::{accounts, checklist, instruments, rules};
use rusqlite::{Connection, params, params_from_iter};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};

text_enum!(Direction {
    Long => "long",
    Short => "short",
});

impl Direction {
    /// +1 for a long, −1 for a short: the "sens" of the glossary formulas.
    pub fn sign(self) -> Decimal {
        match self {
            Direction::Long => Decimal::ONE,
            Direction::Short => Decimal::NEGATIVE_ONE,
        }
    }
}

text_enum!(
    /// Declared compliance with the trading plan (spec 3.2.3).
    PlanFollowed {
        Yes => "yes",
        Partial => "partial",
        No => "no",
    }
);

text_enum!(
    /// System (mechanical rules) vs discretionary trade (spec 3.3.17).
    ExecutionType {
        Discretionary => "discretionary",
        System => "system",
    }
);

text_enum!(EmotionMoment {
    Before => "before",
    During => "during",
    After => "after",
});

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmotionEntry {
    pub moment: EmotionMoment,
    pub tag_id: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleCheck {
    pub rule_id: i64,
    pub respected: bool,
}

/// One line of the trade's own copy of the checklist.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChecklistAnswer {
    /// Template item it came from; `None` once that item is deleted.
    #[serde(default)]
    pub item_id: Option<i64>,
    pub label: String,
    pub checked: bool,
}

/// Everything the trader enters about a trade. Used to create and to update.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TradeData {
    pub account_id: i64,
    pub instrument_id: i64,
    pub direction: Direction,
    /// Position size (lots, contracts, shares, coins…), > 0.
    pub size: Decimal,
    /// Account-currency value of a 1.0 price move for a size of 1. Defaults to
    /// the instrument's multiplier on save; always set on a stored trade.
    #[serde(default)]
    pub multiplier: Option<Decimal>,
    pub entry_price: Decimal,
    /// `None` while the trade is open (then `exit_time` is `None` too).
    #[serde(default)]
    pub exit_price: Option<Decimal>,
    /// Unix milliseconds, UTC.
    pub entry_time: i64,
    #[serde(default)]
    pub exit_time: Option<i64>,
    /// Trader's UTC offset in minutes (e.g. 120 for UTC+2), for local day/hour grouping.
    #[serde(default)]
    pub tz_offset_min: i32,
    #[serde(default)]
    pub planned_sl: Option<Decimal>,
    #[serde(default)]
    pub planned_tp: Option<Decimal>,
    #[serde(default)]
    pub actual_sl: Option<Decimal>,
    #[serde(default)]
    pub actual_tp: Option<Decimal>,
    /// Commissions, spread and swap in account currency; positive is a cost,
    /// negative a credit (e.g. positive swap).
    #[serde(default)]
    pub fees: Decimal,
    /// Price reached after the exit, entered by hand (spec 3.3.18).
    #[serde(default)]
    pub price_after_exit: Option<Decimal>,
    #[serde(default)]
    pub execution_type: Option<ExecutionType>,
    /// Manual star rating, 1–5 (spec 3.1.8).
    #[serde(default)]
    pub rating: Option<u8>,
    /// Pre-trade conviction, 1–10 (spec 3.1.9).
    #[serde(default)]
    pub conviction: Option<u8>,
    /// Manual execution-quality score, 1–5 (spec 3.2.9).
    #[serde(default)]
    pub execution_quality: Option<u8>,
    #[serde(default)]
    pub plan_followed: Option<PlanFollowed>,
    #[serde(default)]
    pub thesis: String,
    #[serde(default)]
    pub post_mortem: String,
    /// Screenshot file, relative to the application data folder.
    #[serde(default)]
    pub screenshot_path: Option<String>,
    /// Setup, timeframe, session, market condition and mistake tags.
    #[serde(default)]
    pub tag_ids: Vec<i64>,
    #[serde(default)]
    pub emotions: Vec<EmotionEntry>,
    #[serde(default)]
    pub rule_checks: Vec<RuleCheck>,
    #[serde(default)]
    pub checklist: Vec<ChecklistAnswer>,
}

impl TradeData {
    /// The strict minimum of a trade ("Quick add", spec 3.1.7); everything else empty.
    pub fn new(
        account_id: i64,
        instrument_id: i64,
        direction: Direction,
        size: Decimal,
        entry_price: Decimal,
        entry_time: i64,
    ) -> Self {
        TradeData {
            account_id,
            instrument_id,
            direction,
            size,
            multiplier: None,
            entry_price,
            exit_price: None,
            entry_time,
            exit_time: None,
            tz_offset_min: 0,
            planned_sl: None,
            planned_tp: None,
            actual_sl: None,
            actual_tp: None,
            fees: Decimal::ZERO,
            price_after_exit: None,
            execution_type: None,
            rating: None,
            conviction: None,
            execution_quality: None,
            plan_followed: None,
            thesis: String::new(),
            post_mortem: String::new(),
            screenshot_path: None,
            tag_ids: Vec::new(),
            emotions: Vec::new(),
            rule_checks: Vec::new(),
            checklist: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Trade {
    pub id: i64,
    #[serde(flatten)]
    pub data: TradeData,
    pub created_at: String,
    pub updated_at: String,
}

impl Trade {
    pub fn is_open(&self) -> bool {
        self.data.exit_price.is_none()
    }

    pub fn multiplier(&self) -> Decimal {
        self.data.multiplier.unwrap_or(Decimal::ONE)
    }
}

/// Restricts `list`: accounts (all when empty) and an entry-time window `[from, to)`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TradeFilter {
    #[serde(default)]
    pub account_ids: Vec<i64>,
    #[serde(default)]
    pub from: Option<i64>,
    #[serde(default)]
    pub to: Option<i64>,
    /// Only the trades carrying this mistake (a mistake tag, or a rule ticked "not respected").
    #[serde(default)]
    pub mistake: Option<MistakeFilter>,
}

/// Where a recurring mistake comes from (same two sources as `behavior::MistakeReport`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MistakeFilterSource {
    /// A tag (normally of kind `mistake`) put on the trade.
    Tag,
    /// A personal rule ticked "not respected" on the trade.
    Rule,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MistakeFilter {
    pub source: MistakeFilterSource,
    pub id: i64,
}

pub fn create(conn: &Connection, data: &TradeData) -> Result<Trade> {
    let v = validate(conn, data)?;
    if accounts::get(conn, data.account_id)?.archived {
        return invalid(accounts::ACCOUNT_ARCHIVED);
    }
    let tx = conn.unchecked_transaction()?;
    tx.execute(
        &format!("INSERT INTO trades ({COLUMNS}) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24)"),
        params_from_iter(params_for(data, &v)),
    )?;
    let id = tx.last_insert_rowid();
    write_children(&tx, id, &v)?;
    tx.commit()?;
    get(conn, id)
}

/// Replaces every field of an existing trade, including its tags, emotions,
/// rule checks and checklist.
pub fn update(conn: &Connection, id: i64, data: &TradeData) -> Result<Trade> {
    get(conn, id)?;
    let v = validate(conn, data)?;
    let tx = conn.unchecked_transaction()?;
    let sets: Vec<String> =
        COLUMNS.split(',').enumerate().map(|(i, c)| format!("{} = ?{}", c.trim(), i + 1)).collect();
    let mut p = params_for(data, &v);
    p.push(Box::new(id));
    tx.execute(
        &format!(
            "UPDATE trades SET {}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?25",
            sets.join(", ")
        ),
        params_from_iter(p),
    )?;
    for table in ["trade_tags", "trade_emotions", "trade_rule_checks", "trade_checklist"] {
        tx.execute(&format!("DELETE FROM {table} WHERE trade_id = ?1"), [id])?;
    }
    write_children(&tx, id, &v)?;
    tx.commit()?;
    get(conn, id)
}

pub fn delete(conn: &Connection, id: i64) -> Result<()> {
    get(conn, id)?;
    // Tags, emotions, rule checks and checklist rows go with it (ON DELETE CASCADE).
    conn.execute("DELETE FROM trades WHERE id = ?1", [id])?;
    Ok(())
}

pub fn get(conn: &Connection, id: i64) -> Result<Trade> {
    load(conn, &format!("id = {id}"))?
        .pop()
        .ok_or_else(|| CoreError::NotFound(format!("trade {id}")))
}

/// Most recent entries first.
pub fn list(conn: &Connection, filter: &TradeFilter) -> Result<Vec<Trade>> {
    let mut cond = vec![ids_condition("account_id", &filter.account_ids)];
    if let Some(from) = filter.from {
        cond.push(format!("entry_time >= {from}"));
    }
    if let Some(to) = filter.to {
        cond.push(format!("entry_time < {to}"));
    }
    if let Some(m) = filter.mistake {
        cond.push(match m.source {
            MistakeFilterSource::Tag => format!("id IN (SELECT trade_id FROM trade_tags WHERE tag_id = {})", m.id),
            MistakeFilterSource::Rule => {
                format!("id IN (SELECT trade_id FROM trade_rule_checks WHERE rule_id = {} AND respected = 0)", m.id)
            }
        });
    }
    load(conn, &cond.join(" AND "))
}

// ---------------------------------------------------------------------------

const COLUMNS: &str = "account_id, instrument_id, direction, size, multiplier, entry_price, exit_price, \
     entry_time, exit_time, tz_offset_min, planned_sl, planned_tp, actual_sl, actual_tp, fees, \
     price_after_exit, execution_type, rating, conviction, execution_quality, plan_followed, \
     thesis, post_mortem, screenshot_path";

/// Input after validation and normalization.
struct Valid {
    multiplier: Decimal,
    thesis: String,
    post_mortem: String,
    screenshot_path: Option<String>,
    tag_ids: BTreeSet<i64>,
    emotions: BTreeSet<(EmotionMoment, i64)>,
    rule_checks: Vec<RuleCheck>,
    checklist: Vec<ChecklistAnswer>,
}

fn invalid<T>(msg: impl Into<String>) -> Result<T> {
    Err(CoreError::Invalid(msg.into()))
}

fn exists_or_invalid<T>(r: Result<T>, what: &str) -> Result<T> {
    match r {
        Err(CoreError::NotFound(_)) => invalid(format!("unknown {what}")),
        other => other,
    }
}

fn validate(conn: &Connection, d: &TradeData) -> Result<Valid> {
    exists_or_invalid(accounts::get(conn, d.account_id), "account")?;
    let instrument = exists_or_invalid(instruments::get(conn, d.instrument_id), "instrument")?;
    let multiplier = d.multiplier.unwrap_or(instrument.default_multiplier);
    money::require_positive("size", d.size)?;
    money::require_positive("multiplier", multiplier)?;
    check_tz_offset(d.tz_offset_min)?;

    match (d.exit_price, d.exit_time) {
        (Some(_), Some(exit)) if exit < d.entry_time => return invalid("exit time is before entry time"),
        (Some(_), None) | (None, Some(_)) => return invalid("exit price and exit time go together"),
        _ => {}
    }
    if let Some(sl) = d.planned_sl {
        let on_loss_side = match d.direction {
            Direction::Long => sl < d.entry_price,
            Direction::Short => sl > d.entry_price,
        };
        if !on_loss_side {
            return invalid(match d.direction {
                Direction::Long => "the planned stop loss of a long must be below the entry price",
                Direction::Short => "the planned stop loss of a short must be above the entry price",
            });
        }
    }
    check_range("rating", d.rating, 1, 5)?;
    check_range("conviction", d.conviction, 1, 10)?;
    check_range("execution quality", d.execution_quality, 1, 5)?;

    let tag_ids: BTreeSet<i64> = d.tag_ids.iter().copied().collect();
    let mut single_kinds = BTreeSet::new();
    for &id in &tag_ids {
        let tag = exists_or_invalid(tags::get(conn, id), "tag")?;
        if tag.kind == TagKind::Emotion {
            return invalid(format!("{} is an emotion: set it in emotions", tag.name));
        }
        if tag.kind.single_per_trade() && !single_kinds.insert(tag.kind) {
            return invalid(format!("a trade has only one {} tag", tag.kind.as_str().replace('_', " ")));
        }
    }

    let emotions: BTreeSet<(EmotionMoment, i64)> = d.emotions.iter().map(|e| (e.moment, e.tag_id)).collect();
    for &(_, id) in &emotions {
        if exists_or_invalid(tags::get(conn, id), "emotion")?.kind != TagKind::Emotion {
            return invalid("only emotion tags can be set as emotions");
        }
    }

    let mut seen_rules = BTreeSet::new();
    for c in &d.rule_checks {
        exists_or_invalid(rules::get(conn, c.rule_id), "rule")?;
        if !seen_rules.insert(c.rule_id) {
            return invalid("a rule is checked twice on the same trade");
        }
    }

    let mut answers = Vec::with_capacity(d.checklist.len());
    for a in &d.checklist {
        if let Some(item) = a.item_id {
            exists_or_invalid(checklist::get(conn, item), "checklist item")?;
        }
        answers.push(ChecklistAnswer {
            item_id: a.item_id,
            label: clean_text("checklist item", &a.label)?,
            checked: a.checked,
        });
    }

    Ok(Valid {
        multiplier,
        thesis: d.thesis.trim().to_owned(),
        post_mortem: d.post_mortem.trim().to_owned(),
        screenshot_path: d.screenshot_path.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(str::to_owned),
        tag_ids,
        emotions,
        rule_checks: d.rule_checks.clone(),
        checklist: answers,
    })
}

fn params_for(d: &TradeData, v: &Valid) -> Vec<Box<dyn rusqlite::ToSql>> {
    vec![
        Box::new(d.account_id),
        Box::new(d.instrument_id),
        Box::new(d.direction),
        Box::new(money::to_db(d.size)),
        Box::new(money::to_db(v.multiplier)),
        Box::new(money::to_db(d.entry_price)),
        Box::new(money::opt_to_db(d.exit_price)),
        Box::new(d.entry_time),
        Box::new(d.exit_time),
        Box::new(d.tz_offset_min),
        Box::new(money::opt_to_db(d.planned_sl)),
        Box::new(money::opt_to_db(d.planned_tp)),
        Box::new(money::opt_to_db(d.actual_sl)),
        Box::new(money::opt_to_db(d.actual_tp)),
        Box::new(money::to_db(d.fees)),
        Box::new(money::opt_to_db(d.price_after_exit)),
        Box::new(d.execution_type),
        Box::new(d.rating),
        Box::new(d.conviction),
        Box::new(d.execution_quality),
        Box::new(d.plan_followed),
        Box::new(v.thesis.clone()),
        Box::new(v.post_mortem.clone()),
        Box::new(v.screenshot_path.clone()),
    ]
}

fn write_children(conn: &Connection, id: i64, v: &Valid) -> Result<()> {
    for tag in &v.tag_ids {
        conn.execute("INSERT INTO trade_tags (trade_id, tag_id) VALUES (?1,?2)", params![id, tag])?;
    }
    for (moment, tag) in &v.emotions {
        conn.execute(
            "INSERT INTO trade_emotions (trade_id, moment, tag_id) VALUES (?1,?2,?3)",
            params![id, moment, tag],
        )?;
    }
    for c in &v.rule_checks {
        conn.execute(
            "INSERT INTO trade_rule_checks (trade_id, rule_id, respected) VALUES (?1,?2,?3)",
            params![id, c.rule_id, c.respected],
        )?;
    }
    for (pos, a) in v.checklist.iter().enumerate() {
        conn.execute(
            "INSERT INTO trade_checklist (trade_id, position, item_id, label, checked) VALUES (?1,?2,?3,?4,?5)",
            params![id, pos as i64, a.item_id, a.label, a.checked],
        )?;
    }
    Ok(())
}

/// Loads the trades matching `cond` (an SQL condition on `trades`, built only
/// from integers) with their children, in a handful of queries.
fn load(conn: &Connection, cond: &str) -> Result<Vec<Trade>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT id, {COLUMNS}, created_at, updated_at FROM trades WHERE {cond} ORDER BY entry_time DESC, id DESC"
    ))?;
    let mut trades = stmt.query_map([], trade_row)?.collect::<std::result::Result<Vec<_>, _>>()?;
    let index: HashMap<i64, usize> = trades.iter().enumerate().map(|(i, t)| (t.id, i)).collect();
    let sub = format!("trade_id IN (SELECT id FROM trades WHERE {cond})");

    let mut stmt = conn.prepare(&format!("SELECT trade_id, tag_id FROM trade_tags WHERE {sub} ORDER BY tag_id"))?;
    for r in stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?)))? {
        let (t, tag) = r?;
        trades[index[&t]].data.tag_ids.push(tag);
    }
    let mut stmt = conn.prepare(&format!(
        "SELECT trade_id, moment, tag_id FROM trade_emotions WHERE {sub}
         ORDER BY CASE moment WHEN 'before' THEN 0 WHEN 'during' THEN 1 ELSE 2 END, tag_id"
    ))?;
    for r in stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, EmotionEntry { moment: r.get(1)?, tag_id: r.get(2)? })))? {
        let (t, e) = r?;
        trades[index[&t]].data.emotions.push(e);
    }
    let mut stmt = conn.prepare(&format!(
        "SELECT c.trade_id, c.rule_id, c.respected FROM trade_rule_checks c JOIN rules r ON r.id = c.rule_id
         WHERE {sub} ORDER BY r.position, r.id"
    ))?;
    for r in stmt.query_map([], |r| Ok((r.get::<_, i64>(0)?, RuleCheck { rule_id: r.get(1)?, respected: r.get(2)? })))? {
        let (t, c) = r?;
        trades[index[&t]].data.rule_checks.push(c);
    }
    let mut stmt = conn.prepare(&format!(
        "SELECT trade_id, item_id, label, checked FROM trade_checklist WHERE {sub} ORDER BY position"
    ))?;
    for r in stmt.query_map([], |r| {
        Ok((r.get::<_, i64>(0)?, ChecklistAnswer { item_id: r.get(1)?, label: r.get(2)?, checked: r.get(3)? }))
    })? {
        let (t, a) = r?;
        trades[index[&t]].data.checklist.push(a);
    }
    Ok(trades)
}

fn trade_row(r: &rusqlite::Row) -> rusqlite::Result<Trade> {
    Ok(Trade {
        id: r.get(0)?,
        data: TradeData {
            account_id: r.get(1)?,
            instrument_id: r.get(2)?,
            direction: r.get(3)?,
            size: money::col(r, 4)?,
            multiplier: Some(money::col(r, 5)?),
            entry_price: money::col(r, 6)?,
            exit_price: money::opt_col(r, 7)?,
            entry_time: r.get(8)?,
            exit_time: r.get(9)?,
            tz_offset_min: r.get(10)?,
            planned_sl: money::opt_col(r, 11)?,
            planned_tp: money::opt_col(r, 12)?,
            actual_sl: money::opt_col(r, 13)?,
            actual_tp: money::opt_col(r, 14)?,
            fees: money::col(r, 15)?,
            price_after_exit: money::opt_col(r, 16)?,
            execution_type: r.get(17)?,
            rating: r.get(18)?,
            conviction: r.get(19)?,
            execution_quality: r.get(20)?,
            plan_followed: r.get(21)?,
            thesis: r.get(22)?,
            post_mortem: r.get(23)?,
            screenshot_path: r.get(24)?,
            tag_ids: Vec::new(),
            emotions: Vec::new(),
            rule_checks: Vec::new(),
            checklist: Vec::new(),
        },
        created_at: r.get(25)?,
        updated_at: r.get(26)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::test_support::{account, dec, instrument};

    struct Fixture {
        conn: Connection,
        account: i64,
        eurusd: i64,
    }

    fn fixture() -> Fixture {
        let conn = db::open_in_memory().unwrap();
        let account = account(&conn, "10000");
        let eurusd = instrument(&conn, "EURUSD", "100000");
        Fixture { conn, account, eurusd }
    }

    fn closed_long(f: &Fixture) -> TradeData {
        TradeData {
            exit_price: Some(dec("1.0871")),
            exit_time: Some(1_700_004_320_000),
            planned_sl: Some(dec("1.0824")),
            planned_tp: Some(dec("1.0888")),
            fees: dec("6.40"),
            ..TradeData::new(f.account, f.eurusd, Direction::Long, dec("1.20"), dec("1.0842"), 1_700_000_000_000)
        }
    }

    fn count(conn: &Connection, table: &str) -> i64 {
        conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0)).unwrap()
    }

    #[test]
    fn round_trips_every_field_exactly() {
        let f = fixture();
        let setup = tags::create(&f.conn, TagKind::Setup, "Breakout NY").unwrap();
        let early = tags::find(&f.conn, TagKind::Mistake, "sortie trop tôt").unwrap().unwrap();
        let calm = tags::find(&f.conn, TagKind::Emotion, "calme").unwrap().unwrap();
        let relief = tags::find(&f.conn, TagKind::Emotion, "soulagement").unwrap().unwrap();
        let rule = rules::create(&f.conn, "Max 3 trades per day").unwrap();
        let item = checklist::create(&f.conn, "Stop defined").unwrap();
        let data = TradeData {
            tz_offset_min: 120,
            actual_sl: Some(dec("1.0824")),
            actual_tp: Some(dec("1.0871")),
            price_after_exit: Some(dec("1.0889")),
            execution_type: Some(ExecutionType::Discretionary),
            rating: Some(4),
            conviction: Some(7),
            execution_quality: Some(5),
            plan_followed: Some(PlanFollowed::Partial),
            thesis: "  NY open breakout ".into(),
            post_mortem: "Took profit at target.".into(),
            screenshot_path: Some("screenshots/1.png".into()),
            tag_ids: vec![setup.id, early.id],
            emotions: vec![
                EmotionEntry { moment: EmotionMoment::After, tag_id: relief.id },
                EmotionEntry { moment: EmotionMoment::Before, tag_id: calm.id },
            ],
            rule_checks: vec![RuleCheck { rule_id: rule.id, respected: false }],
            checklist: vec![
                ChecklistAnswer { item_id: Some(item.id), label: "Stop defined".into(), checked: true },
                ChecklistAnswer { item_id: None, label: "Ad-hoc check".into(), checked: false },
            ],
            ..closed_long(&f)
        };
        let t = create(&f.conn, &data).unwrap();
        assert_eq!(t.multiplier().to_string(), "100000", "defaults to the instrument multiplier");
        assert_eq!(t.data.size.to_string(), "1.20");
        assert_eq!(t.data.entry_price.to_string(), "1.0842");
        assert_eq!(t.data.fees.to_string(), "6.40");
        assert_eq!(t.data.thesis, "NY open breakout");
        let mut tag_ids = vec![setup.id, early.id];
        tag_ids.sort();
        assert_eq!(t.data.tag_ids, tag_ids);
        assert_eq!(t.data.emotions[0].moment, EmotionMoment::Before, "emotions come back in trade order");
        assert_eq!(t.data.checklist, data.checklist);
        assert_eq!(get(&f.conn, t.id).unwrap(), t);
        assert!(!t.is_open());

        // The IPC form: decimals travel as strings, keys in camelCase, flattened.
        let json = serde_json::to_value(&t).unwrap();
        assert_eq!(json["entryPrice"], "1.0842");
        assert_eq!(json["planFollowed"], "partial");
        assert_eq!(json["id"], t.id);
        let back: Trade = serde_json::from_value(json).unwrap();
        assert_eq!(back, t);
    }

    #[test]
    fn explicit_multiplier_is_kept_even_if_the_instrument_changes_later() {
        let f = fixture();
        let t = create(&f.conn, &TradeData { multiplier: Some(dec("10")), ..closed_long(&f) }).unwrap();
        assert_eq!(t.multiplier().to_string(), "10");
    }

    #[test]
    fn update_replaces_fields_and_children() {
        let f = fixture();
        let setup = tags::create(&f.conn, TagKind::Setup, "Breakout").unwrap();
        let t = create(&f.conn, &TradeData { tag_ids: vec![setup.id], ..closed_long(&f) }).unwrap();
        let open = TradeData { exit_price: None, exit_time: None, ..closed_long(&f) };
        let u = update(&f.conn, t.id, &open).unwrap();
        assert!(u.is_open());
        assert!(u.data.tag_ids.is_empty());
        assert_eq!(u.created_at, t.created_at);
        assert!(update(&f.conn, 999, &open).is_err());
    }

    #[test]
    fn delete_cascades_to_children_but_keeps_shared_objects() {
        let f = fixture();
        let setup = tags::create(&f.conn, TagKind::Setup, "Breakout").unwrap();
        let calm = tags::find(&f.conn, TagKind::Emotion, "calme").unwrap().unwrap();
        let rule = rules::create(&f.conn, "Rule").unwrap();
        let t = create(
            &f.conn,
            &TradeData {
                tag_ids: vec![setup.id],
                emotions: vec![EmotionEntry { moment: EmotionMoment::During, tag_id: calm.id }],
                rule_checks: vec![RuleCheck { rule_id: rule.id, respected: true }],
                checklist: vec![ChecklistAnswer { item_id: None, label: "x".into(), checked: true }],
                ..closed_long(&f)
            },
        )
        .unwrap();
        assert!(rules::delete(&f.conn, rule.id).is_err(), "a rule with history must be archived instead");
        delete(&f.conn, t.id).unwrap();
        for table in ["trades", "trade_tags", "trade_emotions", "trade_rule_checks", "trade_checklist"] {
            assert_eq!(count(&f.conn, table), 0, "{table}");
        }
        assert!(tags::get(&f.conn, setup.id).is_ok());
        rules::delete(&f.conn, rule.id).unwrap();
    }

    #[test]
    fn lists_by_account_and_entry_window_most_recent_first() {
        let f = fixture();
        let other = account(&f.conn, "0");
        let at = |t: i64, acc: i64| {
            create(&f.conn, &TradeData::new(acc, f.eurusd, Direction::Long, dec("1"), dec("1.1"), t)).unwrap().id
        };
        let (a1, a2, _b) = (at(100, f.account), at(200, f.account), at(150, other));
        let ids = |filter: TradeFilter| list(&f.conn, &filter).unwrap().into_iter().map(|t| t.id).collect::<Vec<_>>();
        assert_eq!(ids(TradeFilter { account_ids: vec![f.account], ..Default::default() }), [a2, a1]);
        assert_eq!(ids(TradeFilter::default()).len(), 3);
        assert_eq!(ids(TradeFilter { from: Some(100), to: Some(200), ..Default::default() }).len(), 2);
    }

    #[test]
    fn filters_by_mistake_tag_or_broken_rule() {
        let f = fixture();
        let early = tags::create(&f.conn, TagKind::Mistake, "Early exit").unwrap();
        let fomo = tags::create(&f.conn, TagKind::Mistake, "FOMO").unwrap();
        let stop = rules::create(&f.conn, "Always set a stop").unwrap();
        let mk = |t: i64, tag_ids: Vec<i64>, respected: Option<bool>| {
            let data = TradeData {
                entry_time: t,
                exit_time: Some(t + 1000),
                tag_ids,
                rule_checks: respected.map(|r| vec![RuleCheck { rule_id: stop.id, respected: r }]).unwrap_or_default(),
                ..closed_long(&f)
            };
            create(&f.conn, &data).unwrap().id
        };
        let a = mk(100, vec![early.id], Some(true)); // tag mistake, rule respected
        let b = mk(200, vec![early.id, fomo.id], Some(false)); // two tags, rule broken
        let c = mk(300, vec![], Some(false)); // rule broken only
        let d = mk(400, vec![], None); // nothing
        let ids = |m: Option<MistakeFilter>| {
            list(&f.conn, &TradeFilter { mistake: m, ..Default::default() }).unwrap().into_iter().map(|t| t.id).collect::<Vec<_>>()
        };
        let tag = |id| Some(MistakeFilter { source: MistakeFilterSource::Tag, id });
        let rule = |id| Some(MistakeFilter { source: MistakeFilterSource::Rule, id });
        assert_eq!(ids(None), [d, c, b, a]);
        assert_eq!(ids(tag(early.id)), [b, a]);
        assert_eq!(ids(tag(fomo.id)), [b]);
        assert_eq!(ids(rule(stop.id)), [c, b], "a ticked-and-respected rule is not a mistake");
        assert!(ids(tag(9999)).is_empty());
        // Combines with the other filters.
        let both = TradeFilter { from: Some(150), mistake: tag(early.id), ..Default::default() };
        assert_eq!(list(&f.conn, &both).unwrap().into_iter().map(|t| t.id).collect::<Vec<_>>(), [b]);
    }

    #[test]
    fn rejects_inconsistent_trades() {
        let f = fixture();
        let base = closed_long(&f);
        let setup_a = tags::create(&f.conn, TagKind::Setup, "A").unwrap();
        let setup_b = tags::create(&f.conn, TagKind::Setup, "B").unwrap();
        let calm = tags::find(&f.conn, TagKind::Emotion, "calme").unwrap().unwrap();
        let rule = rules::create(&f.conn, "Rule").unwrap();
        let cases: Vec<(&str, TradeData)> = vec![
            ("zero size", TradeData { size: dec("0"), ..base.clone() }),
            ("negative multiplier", TradeData { multiplier: Some(dec("-1")), ..base.clone() }),
            ("exit without time", TradeData { exit_time: None, ..base.clone() }),
            ("exit time without price", TradeData { exit_price: None, ..base.clone() }),
            ("exit before entry", TradeData { exit_time: Some(base.entry_time - 1), ..base.clone() }),
            ("long SL above entry", TradeData { planned_sl: Some(dec("1.09")), ..base.clone() }),
            ("SL at entry", TradeData { planned_sl: Some(dec("1.0842")), ..base.clone() }),
            (
                "short SL below entry",
                TradeData { direction: Direction::Short, planned_sl: Some(dec("1.08")), ..base.clone() },
            ),
            ("rating 6", TradeData { rating: Some(6), ..base.clone() }),
            ("conviction 0", TradeData { conviction: Some(0), ..base.clone() }),
            ("quality 0", TradeData { execution_quality: Some(0), ..base.clone() }),
            ("tz offset", TradeData { tz_offset_min: 841, ..base.clone() }),
            ("unknown account", TradeData { account_id: 999, ..base.clone() }),
            ("unknown instrument", TradeData { instrument_id: 999, ..base.clone() }),
            ("unknown tag", TradeData { tag_ids: vec![999], ..base.clone() }),
            ("two setups", TradeData { tag_ids: vec![setup_a.id, setup_b.id], ..base.clone() }),
            ("emotion as tag", TradeData { tag_ids: vec![calm.id], ..base.clone() }),
            (
                "tag as emotion",
                TradeData {
                    emotions: vec![EmotionEntry { moment: EmotionMoment::Before, tag_id: setup_a.id }],
                    ..base.clone()
                },
            ),
            (
                "rule twice",
                TradeData {
                    rule_checks: vec![
                        RuleCheck { rule_id: rule.id, respected: true },
                        RuleCheck { rule_id: rule.id, respected: false },
                    ],
                    ..base.clone()
                },
            ),
            (
                "blank checklist label",
                TradeData {
                    checklist: vec![ChecklistAnswer { item_id: None, label: " ".into(), checked: true }],
                    ..base.clone()
                },
            ),
        ];
        for (name, data) in cases {
            assert!(matches!(create(&f.conn, &data), Err(CoreError::Invalid(_))), "{name} should be rejected");
        }
        assert_eq!(count(&f.conn, "trades"), 0);
        // A short with its stop above entry, and duplicated tag ids, are fine.
        let short = TradeData {
            direction: Direction::Short,
            planned_sl: Some(dec("1.09")),
            tag_ids: vec![setup_a.id, setup_a.id],
            ..base
        };
        assert_eq!(create(&f.conn, &short).unwrap().data.tag_ids, [setup_a.id]);
    }
}
