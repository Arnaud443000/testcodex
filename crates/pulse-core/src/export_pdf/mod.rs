//! PDF export of a period review (spec 3.7.3, lot 23): summary, totals per month,
//! closed trades and — kept apart — deposits and withdrawals. Fully local.
//!
//! Same rules as the CSV export: amounts come from the exact stored decimals (no
//! float), every figure is read from the statistics engine (`stats::compute`,
//! `stats::analyses::fees`), deposits / withdrawals never count as performance,
//! unknown values show "—". Free text (thesis, notes, journal, screenshots) never
//! enters the document; the account name only does when the caller asks for it.

mod canvas;
#[cfg(test)]
mod tests;

use crate::accounts;
use crate::cash_flows::{self, CashFlowKind};
use crate::error::{CoreError, Result};
use crate::money::Decimal;
use crate::stats::analyses::{self, FeeGranularity};
use crate::stats::pnl::Outcome;
use crate::stats::time::day_key;
use crate::stats::{self, StatsQuery};
use crate::trades::Direction;
use canvas::{Canvas, PAGE_H, PAGE_W, Rgb, Weight};
use rusqlite::Connection;
use rust_decimal::RoundingStrategy;
use std::io::Write;
use std::path::Path;

/// What to export. `from` is inclusive, `to` exclusive (Unix ms, like `StatsQuery`).
#[derive(Debug, Clone, Default)]
pub struct PdfOptions {
    /// Exactly one account (one currency): the review is never consolidated.
    pub account_ids: Vec<i64>,
    pub from: Option<i64>,
    pub to: Option<i64>,
    /// The account name is printed only when this is true.
    pub include_account_name: bool,
    /// Generation instant, Unix ms UTC, and the local offset of the person exporting.
    pub generated_at: i64,
    pub tz_offset_min: i32,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfExport {
    /// Closed trades listed in the document.
    pub trade_count: usize,
    pub page_count: usize,
}

/// Error code understood by the interface: `pdf:<code>`.
fn fail(code: &str) -> CoreError {
    CoreError::Invalid(format!("pdf:{code}"))
}

/// Builds the PDF. Nothing is written anywhere.
pub fn period_pdf(conn: &Connection, opts: &PdfOptions) -> Result<(Vec<u8>, PdfExport)> {
    if opts.account_ids.is_empty() {
        return Err(fail("noAccount"));
    }
    if let (Some(f), Some(t)) = (opts.from, opts.to)
        && f >= t
    {
        return Err(fail("invalidPeriod"));
    }
    let mut ids = opts.account_ids.clone();
    ids.sort_unstable();
    ids.dedup();
    let accts: Vec<_> = ids.iter().map(|&id| accounts::get(conn, id)).collect::<Result<_>>()?;
    if accts.iter().any(|a| a.currency != accts[0].currency) {
        return Err(fail("mixedCurrencies"));
    }
    if accts.len() > 1 {
        return Err(fail("multipleAccounts"));
    }
    let account = &accts[0];

    let query = StatsQuery { account_ids: ids.clone(), from: opts.from, to: opts.to, ..Default::default() };
    let ledger = stats::load(conn, &ids)?;
    let report = stats::compute(&ledger, &query)?;
    let months = analyses::fees(&ledger, &query, FeeGranularity::Month)?;
    let replay = stats::replay(&ledger)?;
    let closed = replay.selected(&query);
    debug_assert_eq!(closed.len(), report.summary.trade_count);
    let flows: Vec<_> = cash_flows::list(conn, &ids)?
        .into_iter()
        .filter(|f| opts.from.is_none_or(|x| f.occurred_at >= x) && opts.to.is_none_or(|x| f.occurred_at < x))
        .collect();

    let mut doc = Doc::new();
    let s = &report.summary;
    let currency = account.currency.as_str();

    // --- title and context -------------------------------------------------
    doc.text(T.title, 22.0, Weight::Bold, INK, 0.0);
    doc.gap(4.0);
    doc.text(T.subtitle, 10.0, Weight::Regular, MUTED, 0.0);
    doc.gap(12.0);
    let account_line = if opts.include_account_name { account.name.clone() } else { T.name_hidden.to_string() };
    let meta = [
        (T.period, period_label(opts)),
        (T.generated, generated_label(opts.generated_at, opts.tz_offset_min)),
        (T.account, account_line),
        (T.currency, currency.to_string()),
    ];
    for (k, v) in meta {
        doc.key_value(k, &v);
    }
    doc.gap(12.0);

    // --- summary (figures of stats::compute, nothing recomputed) ---------------
    doc.section(T.summary);
    if s.trade_count == 0 {
        doc.notice(T.no_trade, false);
        doc.gap(8.0);
    }
    let win_rate = s.win_rate.map_or(DASH.to_string(), percent);
    doc.cards(&[
        (T.card_trades, s.trade_count.to_string(), INK),
        (T.card_gross, money(s.gross_pnl, true), sign_color(s.gross_pnl)),
        (T.card_fees, money(s.fees, false), INK),
        (T.card_net, money(s.net_pnl, true), sign_color(s.net_pnl)),
        (T.card_win_rate, win_rate, INK),
    ]);
    doc.gap(6.0);
    doc.text(
        &format!("{} : {} · {} : {} · {} : {}", T.wins, s.win_count, T.losses, s.loss_count, T.breakevens, s.breakeven_count),
        8.5,
        Weight::Regular,
        MUTED,
        0.0,
    );
    if report.open_trade_count > 0 {
        doc.text(&T.open_trades(report.open_trade_count), 8.5, Weight::Regular, MUTED, 0.0);
    }
    doc.gap(10.0);
    doc.notice(T.disclaimer, true);
    doc.gap(4.0);
    for line in T.notes {
        doc.text(line, 8.0, Weight::Regular, MUTED, 0.0);
    }
    doc.gap(14.0);

    // --- totals per month --------------------------------------------------------
    doc.section(T.months);
    if months.periods.is_empty() {
        doc.text(T.no_month, 9.0, Weight::Regular, MUTED, 0.0);
    } else {
        let cols = [
            Col::left(T.col_month, 150.0),
            Col::right(T.col_trades, 60.0),
            Col::right(&format!("{} ({currency})", T.col_gross), 100.0),
            Col::right(&format!("{} ({currency})", T.col_fees), 90.0),
            Col::right(&format!("{} ({currency})", T.col_net), 110.0),
        ];
        doc.table_start(&cols);
        for p in &months.periods {
            doc.row(&cols, vec![
                Cell::plain(month_label(&p.key)),
                Cell::plain(p.trade_count.to_string()),
                Cell::signed(money(p.gross_pnl, true), p.gross_pnl),
                Cell::plain(money(p.fees, false)),
                Cell::signed(money(p.net_pnl, true), p.net_pnl).bold(),
            ]);
        }
        doc.row_total(&cols, vec![
            Cell::plain(T.total.to_string()).bold(),
            Cell::plain(s.trade_count.to_string()).bold(),
            Cell::signed(money(s.gross_pnl, true), s.gross_pnl).bold(),
            Cell::plain(money(s.fees, false)).bold(),
            Cell::signed(money(s.net_pnl, true), s.net_pnl).bold(),
        ]);
    }
    doc.gap(14.0);

    // --- closed trades ---------------------------------------------------------------
    doc.section(T.trades);
    if closed.is_empty() {
        doc.text(T.no_trade_table, 9.0, Weight::Regular, MUTED, 0.0);
    } else {
        let cols = [
            Col::left(T.col_exit_date, 58.0),
            Col::left(T.col_asset, 90.0),
            Col::left(T.col_side, 36.0),
            Col::right(T.col_size, 54.0),
            Col::right(T.col_entry, 72.0),
            Col::right(T.col_exit, 72.0),
            Col::right(T.col_fees, 54.0),
            Col::right(&format!("{} ({currency})", T.col_net), 74.0),
        ];
        doc.table_start(&cols);
        for c in &closed {
            let f = c.facts;
            let exit = f.position.exit_price.map_or(DASH.to_string(), plain);
            doc.row(&cols, vec![
                Cell::plain(day_label(&day_key(c.exit_time, f.tz_offset_min))),
                Cell::plain(f.symbol.clone()),
                Cell::plain(match f.position.direction {
                    Direction::Long => T.long,
                    Direction::Short => T.short,
                }),
                Cell::plain(plain(f.position.size)),
                Cell::plain(plain(f.position.entry_price)),
                Cell::plain(exit),
                Cell::plain(money(f.position.fees, false)),
                Cell::signed(money(c.figures.net_pnl, true), c.figures.net_pnl)
                    .with_outcome(c.figures.outcome)
                    .bold(),
            ]);
        }
    }
    doc.gap(14.0);

    // --- deposits and withdrawals, apart from performance ---------------------------
    doc.section(T.flows);
    doc.text(T.flows_note, 8.5, Weight::Regular, MUTED, 0.0);
    doc.gap(6.0);
    if flows.is_empty() {
        doc.text(T.no_flow, 9.0, Weight::Regular, MUTED, 0.0);
    } else {
        let cols = [
            Col::left(T.col_date, 90.0),
            Col::left(T.col_type, 120.0),
            Col::right(&format!("{} ({currency})", T.col_amount), 140.0),
        ];
        doc.table_start(&cols);
        for f in &flows {
            let kind = match f.kind {
                CashFlowKind::Deposit => T.deposit,
                CashFlowKind::Withdrawal => T.withdrawal,
            };
            doc.row(&cols, vec![
                Cell::plain(day_label(&day_key(f.occurred_at, f.tz_offset_min))),
                Cell::plain(kind),
                // Neutral colour: a flow is neither a gain nor a loss.
                Cell::plain(money(f.signed_amount(), true)),
            ]);
        }
    }

    let export = PdfExport { trade_count: closed.len(), page_count: doc.canvas.page_count() };
    let bytes = doc.finish(opts);
    Ok((bytes, export))
}

/// Writes the PDF to `path`. An existing file is never replaced unless `overwrite`
/// is true (`pdf:fileExists` otherwise); an overwrite goes through a temporary
/// file so a failure cannot leave a half-written document.
pub fn write_period_pdf(conn: &Connection, opts: &PdfOptions, path: &Path, overwrite: bool) -> Result<PdfExport> {
    if !overwrite && path.exists() {
        return Err(fail("fileExists"));
    }
    let (bytes, export) = period_pdf(conn, opts)?;
    if overwrite {
        let mut tmp = path.as_os_str().to_owned();
        tmp.push(".pulse-tmp");
        let tmp = std::path::PathBuf::from(tmp);
        let written = std::fs::write(&tmp, &bytes).and_then(|()| std::fs::rename(&tmp, path));
        if let Err(e) = written {
            let _ = std::fs::remove_file(&tmp);
            return Err(e.into());
        }
    } else {
        // `create_new`: refuses if the file appeared since the check above.
        let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(path).map_err(|e| {
            if e.kind() == std::io::ErrorKind::AlreadyExists { fail("fileExists") } else { e.into() }
        })?;
        file.write_all(&bytes)?;
        file.flush()?;
    }
    Ok(export)
}

// --- texts of the document (French, fixed: the PDF is a French document) ---------

struct Texts {
    title: &'static str,
    subtitle: &'static str,
    period: &'static str,
    generated: &'static str,
    account: &'static str,
    currency: &'static str,
    name_hidden: &'static str,
    summary: &'static str,
    no_trade: &'static str,
    card_trades: &'static str,
    card_gross: &'static str,
    card_fees: &'static str,
    card_net: &'static str,
    card_win_rate: &'static str,
    wins: &'static str,
    losses: &'static str,
    breakevens: &'static str,
    disclaimer: &'static str,
    notes: [&'static str; 4],
    months: &'static str,
    no_month: &'static str,
    total: &'static str,
    trades: &'static str,
    no_trade_table: &'static str,
    flows: &'static str,
    flows_note: &'static str,
    no_flow: &'static str,
    deposit: &'static str,
    withdrawal: &'static str,
    long: &'static str,
    short: &'static str,
    col_month: &'static str,
    col_trades: &'static str,
    col_gross: &'static str,
    col_fees: &'static str,
    col_net: &'static str,
    col_date: &'static str,
    col_exit_date: &'static str,
    col_asset: &'static str,
    col_side: &'static str,
    col_size: &'static str,
    col_entry: &'static str,
    col_exit: &'static str,
    col_type: &'static str,
    col_amount: &'static str,
    header: &'static str,
    footer_short: &'static str,
}

impl Texts {
    fn open_trades(&self, n: usize) -> String {
        let (one, many) = ("trade ouvert n’est pas compté", "trades ouverts ne sont pas comptés");
        format!("{n} {} (pas encore clôturé{}).", if n > 1 { many } else { one }, if n > 1 { "s" } else { "" })
    }
}

const DASH: &str = "—";
const T: Texts = Texts {
    title: "Bilan de période",
    subtitle: "Journal de trading Pulse",
    period: "Période",
    generated: "Généré le",
    account: "Compte",
    currency: "Devise",
    name_hidden: "Nom non inclus",
    summary: "Résumé",
    no_trade: "Aucun trade clôturé sur cette période : ce bilan est vide.",
    card_trades: "TRADES",
    card_gross: "P&L BRUT",
    card_fees: "FRAIS",
    card_net: "P&L NET",
    card_win_rate: "WIN RATE",
    wins: "Gagnants",
    losses: "Perdants",
    breakevens: "À plat",
    disclaimer: "Document informatif, pas un document fiscal officiel, à vérifier avec votre comptable.",
    notes: [
        "Les trades sont comptés à leur clôture, à la date locale de sortie. Les dépôts et retraits ne sont jamais inclus dans les résultats.",
        "Frais : un montant positif est un coût, un montant négatif un crédit (par exemple un swap positif). P&L net = P&L brut − frais.",
        "Montants arrondis au centime à l’affichage seulement ; les totaux sont calculés sur les valeurs exactes.",
        "Tailles et prix sont affichés tels qu’ils ont été saisis.",
    ],
    months: "Totaux par mois",
    no_month: "Aucun mois à afficher : aucun trade clôturé sur la période.",
    total: "Total",
    trades: "Trades clôturés",
    no_trade_table: "Aucun trade clôturé sur cette période.",
    flows: "Dépôts et retraits (hors performance)",
    flows_note: "Ces mouvements modifient le solde du compte mais ne sont ni des gains ni des pertes : ils ne figurent dans aucun des chiffres ci-dessus.",
    no_flow: "Aucun dépôt ni retrait sur cette période.",
    deposit: "Dépôt",
    withdrawal: "Retrait",
    long: "Long",
    short: "Short",
    col_month: "Mois",
    col_trades: "Trades",
    col_gross: "P&L brut",
    col_fees: "Frais",
    col_net: "P&L net",
    col_date: "Date",
    col_exit_date: "Sortie le",
    col_asset: "Actif",
    col_side: "Sens",
    col_size: "Taille",
    col_entry: "Prix d’entrée",
    col_exit: "Prix de sortie",
    col_type: "Type",
    col_amount: "Montant",
    header: "Pulse — Bilan de période",
    footer_short: "Document informatif, pas un document fiscal officiel.",
};

// --- number and date formats (pure) ------------------------------------------------

const MINUS: char = '\u{2212}';
const NBSP: char = '\u{00A0}';

/// "1234567" → "1 234 567" (no-break spaces).
fn group_thousands(int: &str) -> String {
    let mut out = String::with_capacity(int.len() + int.len() / 3);
    for (i, ch) in int.chars().enumerate() {
        if i > 0 && (int.len() - i).is_multiple_of(3) {
            out.push(NBSP);
        }
        out.push(ch);
    }
    out
}

/// Splits an unsigned plain decimal ("1234.50") and re-joins it in French style ("1 234,50").
fn french(unsigned: &str) -> String {
    match unsigned.split_once('.') {
        Some((i, f)) => format!("{},{f}", group_thousands(i)),
        None => group_thousands(unsigned),
    }
}

/// Exact value, scale as stored (a size "1.20" stays "1,20"), true minus sign.
fn plain(d: Decimal) -> String {
    if d.is_zero() {
        return french(&d.abs().to_string());
    }
    let body = french(&d.abs().to_string());
    if d.is_sign_negative() { format!("{MINUS}{body}") } else { body }
}

/// Money rounded to the cent for display only (the decimal string is rounded, never a float).
/// `signed`: "+" on positive amounts (P&L); a negative amount always shows "−"; zero has no sign.
fn money(d: Decimal, signed: bool) -> String {
    let r = d.round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero);
    let body = french(&format!("{:.2}", r.abs()));
    if r.is_zero() {
        body
    } else if r.is_sign_negative() {
        format!("{MINUS}{body}")
    } else if signed {
        format!("+{body}")
    } else {
        body
    }
}

/// A ratio from the statistics engine, one decimal ("0.625" → "62,5 %").
fn percent(ratio: f64) -> String {
    format!("{:.1}{NBSP}%", ratio * 100.0).replace('.', ",")
}

fn sign_color(d: Decimal) -> Rgb {
    let r = d.round_dp_with_strategy(2, RoundingStrategy::MidpointAwayFromZero);
    if r.is_zero() {
        INK
    } else if r.is_sign_negative() {
        LOSS
    } else {
        GAIN
    }
}

/// "2026-03-14" → "14/03/2026".
fn day_label(key: &str) -> String {
    let mut p = key.split('-');
    match (p.next(), p.next(), p.next()) {
        (Some(y), Some(m), Some(d)) => format!("{d}/{m}/{y}"),
        _ => key.to_string(),
    }
}

/// "2026-03" → "mars 2026".
fn month_label(key: &str) -> String {
    const NAMES: [&str; 12] = [
        "janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre",
    ];
    let (y, m) = key.split_once('-').unwrap_or((key, ""));
    match m.parse::<usize>() {
        Ok(m) if (1..=12).contains(&m) => format!("{} {y}", NAMES[m - 1]),
        _ => key.to_string(),
    }
}

fn period_label(o: &PdfOptions) -> String {
    match (o.from, o.to) {
        (Some(f), Some(t)) => format!("du {} au {}", day_label(&day_key(f, o.tz_offset_min)), day_label(&day_key(t - 1, o.tz_offset_min))),
        (Some(f), None) => format!("à partir du {}", day_label(&day_key(f, o.tz_offset_min))),
        (None, Some(t)) => format!("jusqu’au {}", day_label(&day_key(t - 1, o.tz_offset_min))),
        (None, None) => "toutes les dates".to_string(),
    }
}

/// Local (year, month, day, hour, minute, second) of an instant.
fn local_parts(utc_ms: i64, tz_offset_min: i32) -> (u16, u8, u8, u8, u8, u8) {
    let key = day_key(utc_ms, tz_offset_min);
    let mut p = key.split('-').map(|n| n.parse::<u32>().unwrap_or(0));
    let (y, m, d) = (p.next().unwrap_or(1970), p.next().unwrap_or(1), p.next().unwrap_or(1));
    let secs = (utc_ms + i64::from(tz_offset_min) * 60_000).div_euclid(1000).rem_euclid(86_400);
    (y as u16, m as u8, d as u8, (secs / 3600) as u8, (secs % 3600 / 60) as u8, (secs % 60) as u8)
}

fn generated_label(utc_ms: i64, tz_offset_min: i32) -> String {
    let (y, m, d, h, mi, _) = local_parts(utc_ms, tz_offset_min);
    format!("{d:02}/{m:02}/{y:04} à {h:02}:{mi:02}")
}

// --- layout -------------------------------------------------------------------------

const INK: Rgb = Rgb(0x1B, 0x1F, 0x33);
const MUTED: Rgb = Rgb(0x5B, 0x62, 0x7E);
const ACCENT: Rgb = Rgb(0x3A, 0x4C, 0xB8);
const RULE: Rgb = Rgb(0xD5, 0xD8, 0xE4);
const ZEBRA: Rgb = Rgb(0xF4, 0xF5, 0xFA);
const HEAD_BG: Rgb = Rgb(0xE8, 0xEA, 0xF6);
// Print variants of the gain / loss tokens (darker, for white paper). The sign always carries the meaning too.
const GAIN: Rgb = Rgb(0x1E, 0x7F, 0x5C);
const LOSS: Rgb = Rgb(0xB8, 0x39, 0x2E);
const WARN_BG: Rgb = Rgb(0xFB, 0xF4, 0xE6);
const WARN_LINE: Rgb = Rgb(0xC9, 0x93, 0x3F);

const MARGIN_X: f32 = 42.5;
const CONTENT_W: f32 = PAGE_W - 2.0 * MARGIN_X;
/// Distance from the page top where the body starts / from the page bottom where it must stop.
const BODY_TOP: f32 = 64.0;
const BODY_BOTTOM: f32 = 56.0;
const CELL_PAD_X: f32 = 4.0;
const CELL_PAD_Y: f32 = 3.5;
const BODY_SIZE: f32 = 8.0;

struct Col {
    title: String,
    width: f32,
    right: bool,
}

impl Col {
    fn left(title: &str, width: f32) -> Self {
        Col { title: title.to_string(), width, right: false }
    }
    fn right(title: &str, width: f32) -> Self {
        Col { title: title.to_string(), width, right: true }
    }
}

struct Cell {
    text: String,
    color: Rgb,
    bold: bool,
}

impl Cell {
    fn plain(text: impl Into<String>) -> Self {
        Cell { text: text.into(), color: INK, bold: false }
    }
    fn signed(text: String, value: Decimal) -> Self {
        Cell { text, color: sign_color(value), bold: false }
    }
    fn bold(mut self) -> Self {
        self.bold = true;
        self
    }
    /// A break-even trade keeps the neutral ink even if fees made the net a cent off zero.
    fn with_outcome(mut self, o: Outcome) -> Self {
        if o == Outcome::Breakeven {
            self.color = INK;
        }
        self
    }
}

struct Doc {
    canvas: Canvas,
    /// Distance from the top of the current page.
    y: f32,
    /// Row number in the current table (alternating background).
    rows: usize,
}

impl Doc {
    fn new() -> Self {
        Doc { canvas: Canvas::new(), y: BODY_TOP, rows: 0 }
    }

    fn limit() -> f32 {
        PAGE_H - BODY_BOTTOM
    }

    fn gap(&mut self, h: f32) {
        self.y += h;
    }

    /// Starts a new page when `need` points do not fit any more; true when it did.
    fn ensure(&mut self, need: f32) -> bool {
        if self.y + need > Self::limit() {
            self.canvas.new_page();
            self.y = BODY_TOP;
            true
        } else {
            false
        }
    }

    /// One left-aligned line, wrapped when it would leave the text area.
    fn text(&mut self, text: &str, size: f32, weight: Weight, color: Rgb, indent: f32) {
        let lines = wrap(&self.canvas, text, CONTENT_W - indent, weight, size);
        for line in lines {
            self.ensure(size * 1.3);
            self.y += size * 1.05;
            self.canvas.text(MARGIN_X + indent, PAGE_H - self.y, &line, weight, size, color);
            self.y += size * 0.25;
        }
    }

    fn key_value(&mut self, key: &str, value: &str) {
        let size = 9.5;
        let lines = wrap(&self.canvas, value, CONTENT_W - 90.0, Weight::Regular, size);
        for (i, line) in lines.iter().enumerate() {
            self.ensure(size * 1.6);
            self.y += size * 1.05;
            if i == 0 {
                self.canvas.text(MARGIN_X, PAGE_H - self.y, key, Weight::Regular, size, MUTED);
            }
            self.canvas.text(MARGIN_X + 90.0, PAGE_H - self.y, line, Weight::Bold, size, INK);
            self.y += size * 0.55;
        }
    }

    fn section(&mut self, title: &str) {
        // Never a title alone at the bottom of a page.
        self.ensure(70.0);
        self.y += 13.0;
        self.canvas.text(MARGIN_X, PAGE_H - self.y, title, Weight::Bold, 12.0, ACCENT);
        self.y += 5.0;
        self.canvas.hline(MARGIN_X, MARGIN_X + CONTENT_W, PAGE_H - self.y, 0.8, ACCENT);
        self.y += 8.0;
    }

    /// A framed message; `warn` uses the amber style of the interface.
    fn notice(&mut self, text: &str, warn: bool) {
        let size = 9.0;
        let lines = wrap(&self.canvas, text, CONTENT_W - 20.0, Weight::Bold, size);
        let h = lines.len() as f32 * size * 1.35 + 14.0;
        self.ensure(h + 2.0);
        let top = self.y;
        let (bg, line) = if warn { (WARN_BG, WARN_LINE) } else { (ZEBRA, RULE) };
        self.canvas.fill_rect(MARGIN_X, PAGE_H - top - h, CONTENT_W, h, bg);
        self.canvas.stroke_rect(MARGIN_X, PAGE_H - top - h, CONTENT_W, h, 0.8, line);
        let mut y = top + 7.0;
        for l in lines {
            y += size * 1.05;
            self.canvas.text(MARGIN_X + 10.0, PAGE_H - y, &l, Weight::Bold, size, INK);
            y += size * 0.3;
        }
        self.y = top + h;
    }

    /// A row of figure cards: (label, value, value colour).
    fn cards(&mut self, items: &[(&str, String, Rgb)]) {
        let gap = 8.0;
        let w = (CONTENT_W - gap * (items.len() as f32 - 1.0)) / items.len() as f32;
        let h = 52.0;
        self.ensure(h + 2.0);
        let top = self.y;
        for (i, (label, value, color)) in items.iter().enumerate() {
            let x = MARGIN_X + i as f32 * (w + gap);
            self.canvas.fill_rect(x, PAGE_H - top - h, w, h, ZEBRA);
            self.canvas.stroke_rect(x, PAGE_H - top - h, w, h, 0.6, RULE);
            self.canvas.text(x + 8.0, PAGE_H - top - 16.0, label, Weight::Bold, 7.0, MUTED);
            let (size, lines) = fit(&self.canvas, value, w - 16.0, Weight::Bold, 14.0, 8.0);
            self.canvas.text(x + 8.0, PAGE_H - top - 38.0, lines.first().map_or("", String::as_str), Weight::Bold, size, *color);
        }
        self.y = top + h;
    }

    fn table_start(&mut self, cols: &[Col]) {
        // The header and at least one row stay together.
        self.ensure(BODY_SIZE * 1.3 + CELL_PAD_Y * 2.0 + 30.0);
        self.rows = 0;
        self.header(cols);
    }

    fn header(&mut self, cols: &[Col]) {
        let h = 7.5 * 1.3 + CELL_PAD_Y * 2.0;
        let (wrapped, lines) = self.layout_cells(cols, &cols.iter().map(|c| c.title.clone()).collect::<Vec<_>>(), Weight::Bold, 7.5);
        let h = h + (lines as f32 - 1.0) * 7.5 * 1.25;
        self.canvas.fill_rect(MARGIN_X, PAGE_H - self.y - h, cols.iter().map(|c| c.width).sum(), h, HEAD_BG);
        self.draw_cells(cols, &wrapped, self.y, |_| INK, |_| Weight::Bold);
        self.y += h;
    }

    /// Wraps every cell to its column: (size, lines) per cell, and the tallest line count.
    fn layout_cells(&self, cols: &[Col], texts: &[String], weight: Weight, size: f32) -> (Vec<(f32, Vec<String>)>, usize) {
        let wrapped: Vec<_> =
            cols.iter().zip(texts).map(|(c, t)| fit(&self.canvas, t, c.width - 2.0 * CELL_PAD_X, weight, size, size * 0.72)).collect();
        let lines = wrapped.iter().map(|w| w.1.len()).max().unwrap_or(1).max(1);
        (wrapped, lines)
    }

    fn draw_cells(
        &mut self,
        cols: &[Col],
        wrapped: &[(f32, Vec<String>)],
        top: f32,
        color: impl Fn(usize) -> Rgb,
        weight: impl Fn(usize) -> Weight,
    ) {
        let mut x = MARGIN_X;
        for (i, (col, (size, lines))) in cols.iter().zip(wrapped).enumerate() {
            let mut y = top + CELL_PAD_Y;
            for line in lines {
                y += size * 1.05;
                if col.right {
                    self.canvas.text_right(x + col.width - CELL_PAD_X, PAGE_H - y, line, weight(i), *size, color(i));
                } else {
                    self.canvas.text(x + CELL_PAD_X, PAGE_H - y, line, weight(i), *size, color(i));
                }
                y += size * 0.2;
            }
            x += col.width;
        }
    }

    fn row(&mut self, cols: &[Col], cells: Vec<Cell>) {
        self.row_styled(cols, cells, false);
    }

    fn row_total(&mut self, cols: &[Col], cells: Vec<Cell>) {
        self.row_styled(cols, cells, true);
    }

    fn row_styled(&mut self, cols: &[Col], cells: Vec<Cell>, total: bool) {
        let texts: Vec<String> = cells.iter().map(|c| c.text.clone()).collect();
        let bold_any = |i: usize| cells[i].bold;
        let (wrapped, lines) = self.layout_cells(cols, &texts, if total { Weight::Bold } else { Weight::Regular }, BODY_SIZE);
        let h = CELL_PAD_Y * 2.0 + BODY_SIZE * 1.25 * lines as f32;
        if self.ensure(h) {
            self.header(cols);
        }
        let width: f32 = cols.iter().map(|c| c.width).sum();
        if total {
            self.canvas.hline(MARGIN_X, MARGIN_X + width, PAGE_H - self.y, 0.8, INK);
        } else if self.rows % 2 == 1 {
            self.canvas.fill_rect(MARGIN_X, PAGE_H - self.y - h, width, h, ZEBRA);
        }
        self.draw_cells(cols, &wrapped, self.y, |i| cells[i].color, |i| if bold_any(i) || total { Weight::Bold } else { Weight::Regular });
        self.y += h;
        self.rows += 1;
    }

    /// Headers and footers (the page count is known now) and serialisation.
    fn finish(mut self, opts: &PdfOptions) -> Vec<u8> {
        let total = self.canvas.page_count();
        let period = period_label(opts);
        let generated = generated_label(opts.generated_at, opts.tz_offset_min);
        for page in 0..total {
            self.canvas.select_page(page);
            let top = 36.0;
            self.canvas.text(MARGIN_X, PAGE_H - top, T.header, Weight::Bold, 8.5, ACCENT);
            self.canvas.text_right(MARGIN_X + CONTENT_W, PAGE_H - top, &period, Weight::Regular, 8.5, MUTED);
            self.canvas.hline(MARGIN_X, MARGIN_X + CONTENT_W, PAGE_H - top - 6.0, 0.6, RULE);
            let bottom = 30.0;
            self.canvas.hline(MARGIN_X, MARGIN_X + CONTENT_W, bottom + 12.0, 0.6, RULE);
            self.canvas.text(MARGIN_X, bottom, &format!("{} {generated}.", T.footer_short), Weight::Regular, 7.5, MUTED);
            self.canvas.text_right(MARGIN_X + CONTENT_W, bottom, &format!("Page {} / {total}", page + 1), Weight::Regular, 8.0, MUTED);
        }
        let title = format!("{} — {period}", T.title);
        self.canvas.finish(&title, local_parts(opts.generated_at, opts.tz_offset_min))
    }
}

/// Fits `text` into `width`: first by shrinking the font (down to `min_size`), then by wrapping.
/// Nothing is ever cut.
fn fit(canvas: &Canvas, text: &str, width: f32, weight: Weight, size: f32, min_size: f32) -> (f32, Vec<String>) {
    let mut s = size;
    loop {
        if canvas.width(text, weight, s) <= width {
            return (s, vec![text.to_string()]);
        }
        if s <= min_size + 0.01 {
            break;
        }
        s = (s - 0.5).max(min_size);
    }
    (s, wrap(canvas, text, width, weight, s))
}

/// Greedy word wrap; a word wider than the line is broken between characters.
fn wrap(canvas: &Canvas, text: &str, width: f32, weight: Weight, size: f32) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    let mut line = String::new();
    let push_char = |line: &mut String, lines: &mut Vec<String>, ch: char| {
        line.push(ch);
        if canvas.width(line, weight, size) > width && line.chars().count() > 1 {
            line.pop();
            lines.push(std::mem::take(line));
            line.push(ch);
        }
    };
    for word in text.split(' ') {
        let candidate = if line.is_empty() { word.to_string() } else { format!("{line} {word}") };
        if canvas.width(&candidate, weight, size) <= width {
            line = candidate;
            continue;
        }
        if !line.is_empty() {
            lines.push(std::mem::take(&mut line));
        }
        if canvas.width(word, weight, size) <= width {
            line = word.to_string();
        } else {
            for ch in word.chars() {
                push_char(&mut line, &mut lines, ch);
            }
        }
    }
    if !line.is_empty() || lines.is_empty() {
        lines.push(line);
    }
    lines
}
