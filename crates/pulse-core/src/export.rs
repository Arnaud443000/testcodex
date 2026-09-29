//! CSV export of the trades (settings > data), meant to be opened in Excel
//! with a French locale: `;` separator, decimal comma, UTF-8 with a byte-order
//! mark (otherwise Excel reads the accents as Windows-1252), CRLF line ends.
//!
//! Amounts and prices are written from the exact stored decimals, only the
//! decimal point becomes a comma. R-multiples are ratios (`f64`) and are
//! rounded to 2 decimals. Dates are the trader's local time, taken from the
//! offset stored with each trade.

use crate::error::Result;
use crate::money::Decimal;
use crate::stats::pnl::Outcome;
use crate::stats::time::day_key;
use crate::tags::{self, TagKind};
use crate::trade_view::{self, TradeView};
use crate::trades::{Direction, EmotionMoment, ExecutionType, PlanFollowed, TradeFilter};
use rusqlite::Connection;
use std::collections::HashMap;
use std::path::Path;

pub const BOM: &[u8] = b"\xEF\xBB\xBF";
const SEP: char = ';';

pub const HEADERS: [&str; 34] = [
    "N°", "Compte", "Devise", "Instrument", "Sens", "Taille", "Multiplicateur", "Entrée", "Sortie",
    "Prix d'entrée", "Prix de sortie", "SL prévu", "TP prévu", "SL réel", "TP réel", "Frais",
    "P&L brut", "P&L net", "Risque initial", "R-multiple", "Résultat", "Setup", "Unité de temps",
    "Session", "Condition de marché", "Erreurs", "Émotions", "Exécution", "Note", "Conviction",
    "Qualité d'exécution", "Plan respecté", "Thèse", "Post-mortem",
];

/// Exports the trades matching `filter`; returns the file content (BOM included).
pub fn trades_csv(conn: &Connection, filter: &TradeFilter) -> Result<Vec<u8>> {
    Ok(build(conn, filter)?.0)
}

/// Writes the export to `path` and returns the number of trades exported.
pub fn write_trades_csv(conn: &Connection, filter: &TradeFilter, path: &Path) -> Result<usize> {
    let (bytes, count) = build(conn, filter)?;
    std::fs::write(path, bytes)?;
    Ok(count)
}

fn build(conn: &Connection, filter: &TradeFilter) -> Result<(Vec<u8>, usize)> {
    let views = trade_view::list(conn, filter)?;
    let tag_names: HashMap<i64, String> = tags::list(conn, None, true)?.into_iter().map(|t| (t.id, t.name)).collect();
    let mut out = String::new();
    push_row(&mut out, HEADERS.iter().map(|h| h.to_string()));
    for v in &views {
        push_row(&mut out, row(v, conn, &tag_names)?);
    }
    let mut bytes = BOM.to_vec();
    bytes.extend_from_slice(out.as_bytes());
    Ok((bytes, views.len()))
}

fn row(v: &TradeView, conn: &Connection, tag_names: &HashMap<i64, String>) -> Result<Vec<String>> {
    let d = &v.trade.data;
    let kind_of = |id: i64| tags::get(conn, id).map(|t| t.kind);
    let mut by_kind: HashMap<TagKind, Vec<String>> = HashMap::new();
    for id in &d.tag_ids {
        by_kind.entry(kind_of(*id)?).or_default().push(tag_names.get(id).cloned().unwrap_or_default());
    }
    let joined = |k: TagKind| text(&by_kind.get(&k).map(|n| n.join(" | ")).unwrap_or_default());
    let emotions = d
        .emotions
        .iter()
        .map(|e| {
            let moment = match e.moment {
                EmotionMoment::Before => "avant",
                EmotionMoment::During => "pendant",
                EmotionMoment::After => "après",
            };
            format!("{moment} : {}", tag_names.get(&e.tag_id).cloned().unwrap_or_default())
        })
        .collect::<Vec<_>>()
        .join(" | ");
    let f = v.figures.as_ref();
    Ok(vec![
        v.trade.id.to_string(),
        text(&v.account_name),
        text(&v.currency),
        text(&v.symbol),
        match d.direction {
            Direction::Long => "Long",
            Direction::Short => "Short",
        }
        .into(),
        dec(d.size),
        dec(v.trade.multiplier()),
        datetime(d.entry_time, d.tz_offset_min),
        d.exit_time.map(|t| datetime(t, d.tz_offset_min)).unwrap_or_default(),
        dec(d.entry_price),
        opt_dec(d.exit_price),
        opt_dec(d.planned_sl),
        opt_dec(d.planned_tp),
        opt_dec(d.actual_sl),
        opt_dec(d.actual_tp),
        dec(d.fees),
        f.map(|f| computed(f.gross_pnl)).unwrap_or_default(),
        f.map(|f| computed(f.net_pnl)).unwrap_or_default(),
        v.initial_risk.map(computed).unwrap_or_default(),
        f.and_then(|f| f.r_multiple).map(|r| format!("{r:.2}").replace('.', ",")).unwrap_or_default(),
        match f.map(|f| f.outcome) {
            None => "Ouvert",
            Some(Outcome::Win) => "Gagnant",
            Some(Outcome::Loss) => "Perdant",
            Some(Outcome::Breakeven) => "Breakeven",
        }
        .into(),
        joined(TagKind::Setup),
        joined(TagKind::Timeframe),
        joined(TagKind::Session),
        joined(TagKind::MarketCondition),
        joined(TagKind::Mistake),
        text(&emotions),
        match d.execution_type {
            None => "",
            Some(ExecutionType::Discretionary) => "Discrétionnaire",
            Some(ExecutionType::System) => "Système",
        }
        .into(),
        d.rating.map(|n| n.to_string()).unwrap_or_default(),
        d.conviction.map(|n| n.to_string()).unwrap_or_default(),
        d.execution_quality.map(|n| n.to_string()).unwrap_or_default(),
        match d.plan_followed {
            None => "",
            Some(PlanFollowed::Yes) => "Oui",
            Some(PlanFollowed::Partial) => "Partiellement",
            Some(PlanFollowed::No) => "Non",
        }
        .into(),
        text(&d.thesis),
        text(&d.post_mortem),
    ])
}

/// Exact decimal with a decimal comma ("1.20" → "1,20").
fn dec(d: Decimal) -> String {
    d.to_string().replace('.', ",")
}

/// Product of several decimals: drop the trailing zeros the multiplication adds
/// ("348.000000" → "348"); the value is unchanged.
fn computed(d: Decimal) -> String {
    dec(d.normalize())
}

fn opt_dec(d: Option<Decimal>) -> String {
    d.map(dec).unwrap_or_default()
}

/// "2023-11-14 22:13:20" in the trade's local time.
fn datetime(utc_ms: i64, tz_offset_min: i32) -> String {
    let secs = (utc_ms + tz_offset_min as i64 * 60_000).div_euclid(1000).rem_euclid(86_400);
    format!("{} {:02}:{:02}:{:02}", day_key(utc_ms, tz_offset_min), secs / 3600, secs % 3600 / 60, secs % 60)
}

/// Free text: neutralises spreadsheet formulas (a cell starting with = + - @ is
/// executed by Excel) by prefixing an apostrophe. Never applied to numbers.
fn text(s: &str) -> String {
    if s.starts_with(['=', '+', '-', '@', '\t', '\r']) { format!("'{s}") } else { s.to_string() }
}

fn push_row(out: &mut String, cells: impl IntoIterator<Item = String>) {
    let line = cells.into_iter().map(|c| quote(&c)).collect::<Vec<_>>().join(&SEP.to_string());
    out.push_str(&line);
    out.push_str("\r\n");
}

fn quote(cell: &str) -> String {
    if cell.contains([SEP, '"', '\n', '\r']) { format!("\"{}\"", cell.replace('"', "\"\"")) } else { cell.to_string() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{account, dec as d, instrument};
    use crate::trades::{self, EmotionEntry, TradeData};
    use crate::db;

    fn parse(bytes: &[u8]) -> Vec<Vec<String>> {
        let s = std::str::from_utf8(bytes.strip_prefix(BOM).expect("BOM")).unwrap();
        let mut rows = vec![vec![]];
        let (mut cell, mut quoted, mut chars) = (String::new(), false, s.chars().peekable());
        while let Some(c) = chars.next() {
            match (c, quoted) {
                ('"', true) if chars.peek() == Some(&'"') => {
                    cell.push('"');
                    chars.next();
                }
                ('"', _) => quoted = !quoted,
                (';', false) => rows.last_mut().unwrap().push(std::mem::take(&mut cell)),
                ('\r', false) => {}
                ('\n', false) => {
                    rows.last_mut().unwrap().push(std::mem::take(&mut cell));
                    rows.push(vec![]);
                }
                (c, _) => cell.push(c),
            }
        }
        rows.pop();
        rows
    }

    fn col(rows: &[Vec<String>], row: usize, name: &str) -> String {
        rows[row][HEADERS.iter().position(|h| *h == name).unwrap()].clone()
    }

    /// The mockup EURUSD long: 1.20 lots, 1.0842 → 1.0871, fees 6.40, net 341.60, risk 216.
    fn mockup(conn: &Connection) -> TradeData {
        let mut t = TradeData::new(account(conn, "10000"), instrument(conn, "EURUSD", "100000"), Direction::Long, d("1.20"), d("1.0842"), 1_700_000_000_000);
        t.exit_price = Some(d("1.0871"));
        t.exit_time = Some(1_700_004_320_000);
        t.planned_sl = Some(d("1.0824"));
        t.fees = d("6.40");
        t.tz_offset_min = 60;
        t
    }

    #[test]
    fn exports_bom_headers_and_exact_decimals_with_commas() {
        let conn = db::open_in_memory().unwrap();
        trades::create(&conn, &mockup(&conn)).unwrap();
        let bytes = trades_csv(&conn, &TradeFilter::default()).unwrap();
        assert!(bytes.starts_with(b"\xEF\xBB\xBF"));
        assert!(String::from_utf8_lossy(&bytes).contains("\r\n"));
        let rows = parse(&bytes);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0], HEADERS);
        assert!(rows.iter().all(|r| r.len() == HEADERS.len()));
        assert_eq!(col(&rows, 1, "Taille"), "1,20"); // trailing zero kept, no float
        assert_eq!(col(&rows, 1, "Prix d'entrée"), "1,0842");
        assert_eq!(col(&rows, 1, "Prix de sortie"), "1,0871");
        assert_eq!(col(&rows, 1, "P&L brut"), "348"); // 0.0029 × 1.20 × 100 000
        assert_eq!(col(&rows, 1, "Frais"), "6,40");
        assert_eq!(col(&rows, 1, "P&L net"), "341,6");
        assert_eq!(col(&rows, 1, "Risque initial"), "216");
        assert_eq!(col(&rows, 1, "R-multiple"), "1,58"); // 341.6 / 216
        assert_eq!(col(&rows, 1, "Résultat"), "Gagnant");
        assert_eq!(col(&rows, 1, "Sens"), "Long");
        assert_eq!(col(&rows, 1, "Devise"), "USD");
    }

    #[test]
    fn dates_use_the_local_time_of_the_trade() {
        // 1 700 000 000 s = 2023-11-14 22:13:20 UTC; offset +60 min → 23:13:20 local.
        assert_eq!(datetime(1_700_000_000_000, 60), "2023-11-14 23:13:20");
        assert_eq!(datetime(1_700_000_000_000, 0), "2023-11-14 22:13:20");
        assert_eq!(datetime(1_700_000_000_000, 120), "2023-11-15 00:13:20"); // crosses midnight
        assert_eq!(datetime(0, -60), "1969-12-31 23:00:00");
    }

    #[test]
    fn open_trade_has_empty_result_columns() {
        let conn = db::open_in_memory().unwrap();
        let mut t = mockup(&conn);
        t.exit_price = None;
        t.exit_time = None;
        trades::create(&conn, &t).unwrap();
        let rows = parse(&trades_csv(&conn, &TradeFilter::default()).unwrap());
        assert_eq!(col(&rows, 1, "Résultat"), "Ouvert");
        for c in ["Sortie", "Prix de sortie", "P&L brut", "P&L net", "R-multiple"] {
            assert_eq!(col(&rows, 1, c), "", "{c}");
        }
        assert_eq!(col(&rows, 1, "Risque initial"), "216", "the planned risk is known before the exit");
    }

    #[test]
    fn empty_journal_exports_only_the_header() {
        let conn = db::open_in_memory().unwrap();
        let rows = parse(&trades_csv(&conn, &TradeFilter::default()).unwrap());
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0], HEADERS);
    }

    #[test]
    fn negative_amounts_keep_an_ascii_minus_and_no_float_noise() {
        let conn = db::open_in_memory().unwrap();
        let mut t = mockup(&conn);
        t.exit_price = Some(d("1.0800")); // −0.0042 × 120 000 = −504, net −510.40
        trades::create(&conn, &t).unwrap();
        let rows = parse(&trades_csv(&conn, &TradeFilter::default()).unwrap());
        assert_eq!(col(&rows, 1, "P&L net"), "-510,4");
        assert_eq!(col(&rows, 1, "Résultat"), "Perdant");
        assert_eq!(col(&rows, 1, "R-multiple"), "-2,36"); // −510.4 / 216
    }

    #[test]
    fn text_with_separators_quotes_newlines_and_formulas_is_protected() {
        let conn = db::open_in_memory().unwrap();
        let mut t = mockup(&conn);
        t.thesis = "Range; \"cassure\"\nretest".into();
        t.post_mortem = "=SUM(A1:A9)".into();
        let setup = tags::create(&conn, TagKind::Setup, "Break-out").unwrap();
        let calm = tags::find(&conn, TagKind::Emotion, "calme").unwrap().unwrap();
        t.tag_ids = vec![setup.id];
        t.emotions = vec![EmotionEntry { moment: EmotionMoment::Before, tag_id: calm.id }];
        trades::create(&conn, &t).unwrap();
        let rows = parse(&trades_csv(&conn, &TradeFilter::default()).unwrap());
        assert_eq!(rows.len(), 2, "the newline stays inside its cell");
        assert_eq!(col(&rows, 1, "Thèse"), "Range; \"cassure\"\nretest");
        assert_eq!(col(&rows, 1, "Post-mortem"), "'=SUM(A1:A9)");
        assert_eq!(col(&rows, 1, "Setup"), "Break-out");
        assert_eq!(col(&rows, 1, "Émotions"), "avant : Calme");
    }

    #[test]
    fn filter_limits_the_exported_accounts_and_the_file_is_written() {
        let conn = db::open_in_memory().unwrap();
        let a = mockup(&conn);
        trades::create(&conn, &a).unwrap();
        let other = crate::accounts::create(
            &conn,
            &crate::accounts::NewAccount {
                name: "Other".into(),
                kind: "demo".into(),
                broker: String::new(),
                currency: "EUR".into(),
                initial_capital: d("500"),
            },
        )
        .unwrap();
        trades::create(&conn, &TradeData { account_id: other.id, ..a.clone() }).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("trades.csv");
        let n = write_trades_csv(&conn, &TradeFilter { account_ids: vec![other.id], ..Default::default() }, &path).unwrap();
        assert_eq!(n, 1);
        let rows = parse(&std::fs::read(&path).unwrap());
        assert_eq!((rows.len(), col(&rows, 1, "Compte").as_str(), col(&rows, 1, "Devise").as_str()), (2, "Other", "EUR"));
    }
}
