//! The PDF is read back with an independent parser (`lopdf`, text extracted through
//! the fonts' `/ToUnicode` maps) and its figures compared with a journal computed by hand.

use super::*;
use crate::accounts::{self, NewAccount};
use crate::cash_flows::NewCashFlow;
use crate::db;
use crate::test_support::{account, dec as d, instrument};
use crate::trades::{self, TradeData};

/// Unix ms of a UTC date and hour (days-from-civil, proleptic Gregorian).
fn ms(y: i64, m: i64, day: i64, h: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    ((era * 146_097 + doe - 719_468) * 24 + h) * 3_600_000
}

/// Text of each page, whitespace-normalised (no-break spaces kept).
fn pages(bytes: &[u8]) -> Vec<String> {
    let doc = lopdf::Document::load_mem(bytes).expect("valid PDF");
    let numbers: Vec<u32> = doc.get_pages().keys().copied().collect();
    numbers.iter().map(|n| doc.extract_text(&[*n]).expect("text")).collect()
}

fn all_text(bytes: &[u8]) -> String {
    pages(bytes).join("\n")
}

fn opts(account_id: i64) -> PdfOptions {
    PdfOptions {
        account_ids: vec![account_id],
        generated_at: ms(2026, 9, 29, 12),
        tz_offset_min: 120,
        ..Default::default()
    }
}

#[allow(clippy::too_many_arguments)]
fn closed(
    conn: &Connection,
    acct: i64,
    inst: i64,
    dir: Direction,
    size: &str,
    entry: &str,
    exit: &str,
    fees: &str,
    exit_at: i64,
) -> TradeData {
    let mut t = TradeData::new(acct, inst, dir, d(size), d(entry), exit_at - 3_600_000);
    t.exit_price = Some(d(exit));
    t.exit_time = Some(exit_at);
    t.fees = d(fees);
    t.tz_offset_min = 60;
    trades::create(conn, &t).unwrap();
    t
}

/// The hand-computed journal of the lot (account USD, EURUSD × 100 000, XAUUSD × 100):
///   Jan  T1 long 1.00 EURUSD 1.1000→1.1050 fees 5.00     gross +500,   net +495
///   Jan  T2 short 0.50 EURUSD 1.1000→1.1040 fees 2.50    gross −200,   net −202.50
///   Feb  T3 long 2 XAUUSD 2000.00→2010.50 fees 3.25      gross +2100,  net +2096.75
///   Feb  T4 long 1.00 EURUSD 1.1000→1.0990 fees 5.00     gross −100,   net −105
///   Mar  T5 long 1.00 EURUSD 1.1000→1.1000 fees 0        gross 0,      net 0 (break-even)
/// Totals: 5 trades, gross +2 300, fees 15.75, net +2 284.25, win rate 2/5 = 40,0 %.
/// Months: Jan gross 300 fees 7.50 net 292.50 · Feb gross 2 000 fees 8.25 net 1 991.75 · Mar 0.
/// Also: an open trade (ignored), a deposit of 1 000 in January, a withdrawal of 250 in February.
fn journal(conn: &Connection) -> i64 {
    let a = account(conn, "10000");
    let eur = instrument(conn, "EURUSD", "100000");
    let xau = instrument(conn, "XAUUSD", "100");
    closed(conn, a, eur, Direction::Long, "1.00", "1.1000", "1.1050", "5.00", ms(2026, 1, 15, 10));
    closed(conn, a, eur, Direction::Short, "0.50", "1.1000", "1.1040", "2.50", ms(2026, 1, 20, 10));
    closed(conn, a, xau, Direction::Long, "2", "2000.00", "2010.50", "3.25", ms(2026, 2, 10, 10));
    closed(conn, a, eur, Direction::Long, "1.00", "1.1000", "1.0990", "5.00", ms(2026, 2, 12, 10));
    closed(conn, a, eur, Direction::Long, "1.00", "1.1000", "1.1000", "0", ms(2026, 3, 5, 10));
    trades::create(conn, &TradeData::new(a, eur, Direction::Long, d("1"), d("1.1"), ms(2026, 3, 6, 9))).unwrap();
    let flow = |kind, amount: &str, at, note: &str| {
        cash_flows::create(
            conn,
            &NewCashFlow { account_id: a, kind, amount: d(amount), occurred_at: at, tz_offset_min: 60, note: note.into() },
        )
        .unwrap();
    };
    flow(CashFlowKind::Deposit, "1000", ms(2026, 1, 5, 9), "NOTE-SECRETE-DEPOT");
    flow(CashFlowKind::Withdrawal, "250", ms(2026, 2, 25, 9), "");
    a
}

/// Substring test that ignores the kind of space (the exact spaces are checked by the format test).
fn has(text: &str, wanted: &str) -> bool {
    text.replace('\u{00A0}', " ").contains(&wanted.replace('\u{00A0}', " "))
}

#[test]
fn a_hand_computed_journal_gives_the_right_document() {
    let conn = db::open_in_memory().unwrap();
    let a = journal(&conn);
    let (bytes, info) = period_pdf(&conn, &opts(a)).unwrap();
    assert!(bytes.starts_with(b"%PDF-"));
    assert_eq!((info.trade_count, info.page_count), (5, 1));
    let text = all_text(&bytes);

    assert!(text.contains("Bilan de période") && text.contains("toutes les dates"));
    // Summary cards: trades, gross, fees, net, win rate.
    for wanted in ["+2 300,00", "15,75", "+2 284,25", "40,0 %"] {
        assert!(has(&text, wanted), "summary lacks {wanted}: {text}");
    }
    assert!(text.contains("Gagnants : 2") && text.contains("Perdants : 2") && text.contains("À plat : 1"));
    assert!(text.contains("1 trade ouvert n’est pas compté"), "the open trade is mentioned, not counted");
    // Months.
    for wanted in ["janvier 2026", "février 2026", "mars 2026", "+300,00", "7,50", "+292,50", "+2 000,00", "8,25", "+1 991,75"] {
        assert!(has(&text, wanted), "months lack {wanted}");
    }
    // Trades: local exit date, asset, side, size, prices as typed, fees, signed net.
    for wanted in [
        "15/01/2026", "20/01/2026", "10/02/2026", "12/02/2026", "05/03/2026", "EURUSD", "XAUUSD", "Long", "Short", "0,50", "1,1050", "2 010,50",
        "2 000,00", "+495,00", "−202,50", "+2 096,75", "−105,00", "3,25",
    ] {
        assert!(has(&text, wanted), "trade table lacks {wanted}");
    }
    // Deposits and withdrawals: listed apart, signed, never in the results.
    assert!(text.contains("Dépôts et retraits (hors performance)"));
    for wanted in ["05/01/2026", "25/02/2026", "Dépôt", "Retrait", "+1 000,00", "−250,00"] {
        assert!(has(&text, wanted), "flows lack {wanted}");
    }
    assert!(!has(&text, "+3 034,25") && !has(&text, "+2 034,25"), "flows must not be added to the net");
    assert!(text.contains("Document informatif, pas un document fiscal officiel, à vérifier avec votre comptable."));
    assert!(text.contains("Page 1 / 1") && text.contains("Généré le") && text.contains("29/09/2026 à 14:00"), "{text}");
}

#[test]
fn the_document_uses_the_figures_of_the_statistics_engine() {
    let conn = db::open_in_memory().unwrap();
    let a = journal(&conn);
    let query = StatsQuery { account_ids: vec![a], ..Default::default() };
    let report = stats::report(&conn, &query).unwrap();
    let months = analyses::fee_report(&conn, &query, FeeGranularity::Month).unwrap();
    // Months add up to the summary (exact decimals).
    let sum = |f: fn(&analyses::FeePeriod) -> Decimal| months.periods.iter().map(f).sum::<Decimal>();
    assert_eq!(sum(|p| p.net_pnl), report.summary.net_pnl);
    assert_eq!(sum(|p| p.gross_pnl), report.summary.gross_pnl);
    assert_eq!(sum(|p| p.fees), report.summary.fees);
    assert_eq!(report.summary.net_pnl, d("2284.25")); // the hand-computed value
    let text = all_text(&period_pdf(&conn, &opts(a)).unwrap().0);
    assert!(has(&text, &money(report.summary.net_pnl, true)));
    assert!(has(&text, &percent(report.summary.win_rate.unwrap())));
}

#[test]
fn period_bounds_pick_the_trades_by_exit_date() {
    let conn = db::open_in_memory().unwrap();
    let a = journal(&conn);
    // February only, in the local time of the person exporting (UTC+2): local midnights.
    let o = PdfOptions { from: Some(ms(2026, 2, 1, 0) - 2 * 3_600_000), to: Some(ms(2026, 3, 1, 0) - 2 * 3_600_000), ..opts(a) };
    let (bytes, info) = period_pdf(&conn, &o).unwrap();
    assert_eq!(info.trade_count, 2);
    let text = all_text(&bytes);
    assert!(text.contains("du 01/02/2026 au 28/02/2026"), "{text}");
    for wanted in ["+1 991,75", "8,25", "+2 000,00", "10/02/2026", "12/02/2026", "−250,00"] {
        assert!(has(&text, wanted), "{wanted}");
    }
    assert!(!text.contains("15/01/2026") && !text.contains("janvier 2026") && !text.contains("mars 2026"));
    assert!(!has(&text, "+1 000,00"), "the January deposit is outside the period");
    let bad = PdfOptions { from: Some(5), to: Some(5), ..opts(a) };
    assert!(period_pdf(&conn, &bad).unwrap_err().to_string().contains("pdf:invalidPeriod"));
}

#[test]
fn zero_trades_gives_a_document_that_says_so() {
    let conn = db::open_in_memory().unwrap();
    let a = account(&conn, "1000");
    let (bytes, info) = period_pdf(&conn, &opts(a)).unwrap();
    assert_eq!((info.trade_count, info.page_count), (0, 1));
    let text = all_text(&bytes);
    assert!(text.contains("Aucun trade clôturé sur cette période : ce bilan est vide."), "{text}");
    assert!(text.contains("Aucun trade clôturé sur cette période."));
    assert!(text.contains("Aucun dépôt ni retrait sur cette période."));
    assert!(text.contains("0,00") && text.contains("—"), "zero amounts and the unknown win rate ('—'): {text}");
    assert!(!text.contains("+0,00"), "zero has no sign");
}

#[test]
fn many_trades_make_several_pages_with_a_repeating_header_and_no_lost_row() {
    let conn = db::open_in_memory().unwrap();
    let a = account(&conn, "100000");
    let eur = instrument(&conn, "EURUSD", "100000");
    let start = std::time::Instant::now();
    let n = 1500;
    for i in 0..n {
        // Net = +(i + 1) cents-free dollars: 0.00001 × 100 000 × 1 = 1 gross per unit of i.
        let exit = format!("{:.5}", 1.1 + (i as f64 + 1.0) * 0.00001);
        closed(&conn, a, eur, Direction::Long, "1", "1.10000", &exit, "0", ms(2026, 1, 1, 0) + i * 3_600_000 * 5);
    }
    let (bytes, info) = period_pdf(&conn, &opts(a)).unwrap();
    let elapsed = start.elapsed();
    assert_eq!(info.trade_count, n as usize);
    assert!(info.page_count >= 20, "{} pages", info.page_count);
    assert!(elapsed.as_secs() < 30, "{elapsed:?} for {n} trades");
    let pages = pages(&bytes);
    assert_eq!(pages.len(), info.page_count);
    let body: Vec<&String> = pages.iter().filter(|p| p.contains("Sortie le") && p.contains("Actif")).collect();
    assert!(body.len() >= info.page_count - 2, "the table header repeats on the pages that hold rows");
    for (i, p) in pages.iter().enumerate() {
        assert!(p.contains(&format!("Page {} / {}", i + 1, pages.len())), "footer of page {}", i + 1);
        assert!(p.contains("Pulse — Bilan de période"), "running header of page {}", i + 1);
    }
    // No row lost: the last trade (net +1 500,00) and the total are there.
    let text = pages.join("\n");
    assert!(has(&text, "+1 500,00"));
    assert_eq!(text.matches("EURUSD").count(), n as usize);
    // Sum 1..=1500 = 1 125 750 gross and net.
    assert!(has(&text, "+1 125 750,00"), "total");
    eprintln!("1500 trades: {} pages, {} bytes, {:?}", info.page_count, bytes.len(), elapsed);
}

#[test]
fn accents_apostrophes_and_the_minus_sign_survive() {
    let conn = db::open_in_memory().unwrap();
    let acct = accounts::create(
        &conn,
        &NewAccount {
            name: "Compte d’Éloïse — prop firm".into(),
            kind: "prop".into(),
            broker: "Courtier SECRET".into(),
            currency: "EUR".into(),
            initial_capital: d("5000"),
        },
    )
    .unwrap()
    .id;
    let inst = crate::instruments::create(
        &conn,
        &crate::instruments::NewInstrument {
            symbol: "L’Œuvre d’Été".into(),
            name: String::new(),
            asset_class: crate::instruments::AssetClass::Stock,
            default_multiplier: d("1"),
        },
    )
    .unwrap()
    .id;
    closed(&conn, acct, inst, Direction::Long, "10", "50.00", "48.50", "1.20", ms(2026, 5, 4, 10)); // −15 − 1.20
    // Hidden by default …
    let text = all_text(&period_pdf(&conn, &opts(acct)).unwrap().0);
    assert!(text.contains("Nom non inclus"));
    assert!(!text.contains("Éloïse") && !text.contains("SECRET"), "account name and broker must stay out: {text}");
    assert!(text.contains("L’Œuvre d’Été"), "accents, ligature and apostrophe: {text}");
    assert!(has(&text, "−16,20") && text.contains("EUR"), "true minus sign and currency: {text}");
    assert!(!text.contains("-16"), "no ASCII hyphen as a sign");
    // … printed only on request (still never the broker).
    let named = PdfOptions { include_account_name: true, ..opts(acct) };
    let text = all_text(&period_pdf(&conn, &named).unwrap().0);
    assert!(text.contains("Compte d’Éloïse — prop firm"), "{text}");
    assert!(!text.contains("SECRET"));
    assert!(!text.contains("Nom non inclus"));
}

#[test]
fn characters_outside_the_font_become_a_question_mark_never_a_crash() {
    let conn = db::open_in_memory().unwrap();
    let a = account(&conn, "1000");
    let inst = crate::instruments::create(
        &conn,
        &crate::instruments::NewInstrument {
            symbol: "日本225".into(),
            name: String::new(),
            asset_class: crate::instruments::AssetClass::Index,
            default_multiplier: d("1"),
        },
    )
    .unwrap()
    .id;
    closed(&conn, a, inst, Direction::Long, "1", "10", "11", "0", ms(2026, 5, 4, 10));
    let text = all_text(&period_pdf(&conn, &opts(a)).unwrap().0);
    assert!(text.contains("??225"), "{text}");
}

#[test]
fn free_text_never_enters_the_document() {
    let conn = db::open_in_memory().unwrap();
    let a = account(&conn, "10000");
    let eur = instrument(&conn, "EURUSD", "100000");
    let mut t = closed(&conn, a, eur, Direction::Long, "1", "1.1000", "1.1010", "0", ms(2026, 4, 1, 10));
    t.thesis = "THESE-CONFIDENTIELLE".into();
    t.post_mortem = "POSTMORTEM-CONFIDENTIEL".into();
    let stored = trades::list(&conn, &Default::default()).unwrap();
    let mut upd = t.clone();
    upd.thesis = t.thesis.clone();
    trades::update(&conn, stored[0].id, &upd).unwrap();
    cash_flows::create(
        &conn,
        &NewCashFlow { account_id: a, kind: CashFlowKind::Deposit, amount: d("10"), occurred_at: ms(2026, 4, 2, 9), tz_offset_min: 0, note: "NOTE-DE-DEPOT".into() },
    )
    .unwrap();
    let text = all_text(&period_pdf(&conn, &opts(a)).unwrap().0);
    for secret in ["CONFIDENTIEL", "NOTE-DE-DEPOT", "Test account"] {
        assert!(!text.contains(secret), "{secret} leaked");
    }
}

#[test]
fn mixed_currencies_several_accounts_and_no_account_are_refused() {
    let conn = db::open_in_memory().unwrap();
    let usd = account(&conn, "1000");
    let mk = |name: &str, cur: &str| {
        accounts::create(
            &conn,
            &NewAccount { name: name.into(), kind: "demo".into(), broker: String::new(), currency: cur.into(), initial_capital: d("100") },
        )
        .unwrap()
        .id
    };
    let (eur, usd2) = (mk("E", "EUR"), mk("U2", "USD"));
    let err = |ids: Vec<i64>| period_pdf(&conn, &PdfOptions { account_ids: ids, ..opts(usd) }).unwrap_err().to_string();
    assert!(err(vec![usd, eur]).contains("pdf:mixedCurrencies"));
    assert!(err(vec![usd, usd2]).contains("pdf:multipleAccounts"));
    assert!(err(vec![]).contains("pdf:noAccount"));
    assert!(period_pdf(&conn, &PdfOptions { account_ids: vec![usd, usd], ..opts(usd) }).is_ok(), "the same account twice is one account");
}

#[test]
fn an_existing_file_is_never_replaced_silently() {
    let conn = db::open_in_memory().unwrap();
    let a = journal(&conn);
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("bilan.pdf");
    std::fs::write(&path, b"mon fichier").unwrap();
    let e = write_period_pdf(&conn, &opts(a), &path, false).unwrap_err().to_string();
    assert!(e.contains("pdf:fileExists"), "{e}");
    assert_eq!(std::fs::read(&path).unwrap(), b"mon fichier", "untouched");
    let info = write_period_pdf(&conn, &opts(a), &path, true).unwrap();
    assert_eq!(info.trade_count, 5);
    assert!(std::fs::read(&path).unwrap().starts_with(b"%PDF-"));
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1, "no temporary file left");
    let fresh = dir.path().join("neuf.pdf");
    write_period_pdf(&conn, &opts(a), &fresh, false).unwrap();
    assert!(lopdf::Document::load(&fresh).is_ok());
}

#[test]
fn formats_are_exact_french_and_never_lie_about_zero() {
    assert_eq!(money(d("2284.25"), true), "+2\u{a0}284,25");
    assert_eq!(money(d("-202.5"), true), "\u{2212}202,50");
    assert_eq!(money(d("15.75"), false), "15,75");
    assert_eq!(money(d("-1.2"), false), "\u{2212}1,20", "a credit keeps its minus");
    assert_eq!(money(d("1234567.891"), true), "+1\u{a0}234\u{a0}567,89");
    assert_eq!(money(d("0.005"), true), "+0,01", "half a cent rounds away from zero");
    assert_eq!(money(d("-0.005"), true), "\u{2212}0,01");
    assert_eq!(money(d("0.004"), true), "0,00");
    assert_eq!(money(d("-0.004"), true), "0,00", "no −0,00");
    assert_eq!(money(d("0"), true), "0,00");
    assert_eq!(plain(d("1.20")), "1,20", "scale as typed");
    assert_eq!(plain(d("65432.10")), "65\u{a0}432,10");
    assert_eq!(plain(d("-0.0001")), "\u{2212}0,0001");
    assert_eq!(plain(d("100")), "100");
    assert_eq!(group_thousands("1234567"), "1\u{a0}234\u{a0}567");
    assert_eq!(group_thousands("123"), "123");
    assert_eq!(percent(0.4), "40,0\u{a0}%");
    assert_eq!(percent(0.625), "62,5\u{a0}%");
    assert_eq!(month_label("2026-08"), "août 2026");
    assert_eq!(month_label("2026-12"), "décembre 2026");
    assert_eq!(day_label("2026-03-05"), "05/03/2026");
    assert_eq!(generated_label(ms(2026, 9, 29, 23), 120), "30/09/2026 à 01:00", "crosses midnight in local time");
    assert_eq!(local_parts(ms(2026, 1, 1, 0) - 1, 0), (2025, 12, 31, 23, 59, 59));
}

#[test]
fn a_very_long_cell_is_wrapped_never_cut() {
    let canvas = Canvas::new();
    let text = "SYMBOLE-TRES-LONG-QUI-NE-TIENT-PAS-DANS-UNE-COLONNE-ETROITE 1234567890123456789012345678901234567890";
    let (size, lines) = fit(&canvas, text, 60.0, Weight::Regular, 8.0, 5.76);
    assert!(size >= 5.76 && lines.len() > 1);
    assert!(lines.iter().all(|l| canvas.width(l, Weight::Regular, size) <= 60.0 + 0.01), "{lines:?}");
    // Nothing lost (spaces at the wrapping points may go).
    assert_eq!(lines.concat().replace(' ', ""), text.replace(' ', ""));
    // A short text keeps its size.
    assert_eq!(fit(&canvas, "1,20", 60.0, Weight::Regular, 8.0, 5.76), (8.0, vec!["1,20".to_string()]));
}

/// Visual check helper: `PULSE_PDF_SAMPLES=/some/dir cargo test -p pulse-core write_samples` writes
/// sample documents to look at (converted to images by hand). Does nothing otherwise.
#[test]
fn write_samples_when_asked() {
    let Ok(dir) = std::env::var("PULSE_PDF_SAMPLES") else { return };
    let dir = std::path::Path::new(&dir);
    let conn = db::open_in_memory().unwrap();
    let a = journal(&conn);
    std::fs::write(dir.join("journal.pdf"), period_pdf(&conn, &opts(a)).unwrap().0).unwrap();

    let conn = db::open_in_memory().unwrap();
    let a = account(&conn, "100000");
    let eur = instrument(&conn, "EURUSD", "100000");
    let long = crate::instruments::create(
        &conn,
        &crate::instruments::NewInstrument {
            symbol: "SYMBOLE-PERSONNALISE-TRES-LONG-1234567890".into(),
            name: String::new(),
            asset_class: crate::instruments::AssetClass::Stock,
            default_multiplier: d("1"),
        },
    )
    .unwrap()
    .id;
    for i in 0..120 {
        let (inst, exit) = if i % 7 == 3 { (long, "9.87654321") } else { (eur, if i % 3 == 0 { "1.0950" } else { "1.1043" }) };
        let entry = if inst == long { "10.00000001" } else { "1.1000" };
        closed(&conn, a, inst, if i % 2 == 0 { Direction::Long } else { Direction::Short }, "1.25", entry, exit, "3.10", ms(2026, 1, 1, 0) + i * 86_400_000 * 2);
    }
    let named = PdfOptions { include_account_name: true, ..opts(a) };
    std::fs::write(dir.join("many.pdf"), period_pdf(&conn, &named).unwrap().0).unwrap();

    let conn = db::open_in_memory().unwrap();
    let a = account(&conn, "1000");
    std::fs::write(dir.join("empty.pdf"), period_pdf(&conn, &opts(a)).unwrap().0).unwrap();
}
