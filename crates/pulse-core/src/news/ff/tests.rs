//! Forex Factory's weekly export (lot 28): reader, storage and settings, without network.
//! Samples written from documentation excerpts, **not checked on a real answer** (see README.md).

use super::*;
use crate::db;
use crate::error::CoreError;
use crate::news::settings::{self, FetchPlan, NewsSettings, SourceKind, fail_fetch, finish_fetch, keep_tested, prepare_fetch, prepare_test, preview};
use crate::news::store::{self, EventQuery, SOURCE_FILE};
use rusqlite::Connection;

pub(crate) const THIS_WEEK: &str = include_str!("ff_calendar_thisweek.sample.json");
pub(crate) const NEXT_WEEK: &str = include_str!("ff_calendar_nextweek.sample.json");

const HOUR: i64 = 3_600_000;
const MIN: i64 = 60_000;

fn at(y: i64, m: u32, d: u32, h: i64, min: i64) -> i64 {
    days_from_civil(y, m, d).unwrap() * DAY_MS + h * HOUR + min * MIN
}

/// Tuesday 2026-09-29 10:00 UTC (12:00 in Paris).
fn now() -> i64 {
    at(2026, 9, 29, 10, 0)
}

fn code(e: CoreError) -> String {
    match e {
        CoreError::Invalid(m) => m,
        other => panic!("expected an invalid-input error, got {other:?}"),
    }
}

fn find<'a>(p: &'a Parsed, title: &str) -> &'a NewEvent {
    p.events.iter().find(|e| e.title == title).unwrap_or_else(|| panic!("{title} not read"))
}

fn paris(e: &NewEvent) -> (String, Option<String>) {
    (e.day.clone(), e.starts_at.map(zones::paris_hhmm))
}

#[test]
fn the_weekly_file_is_read_in_paris_time_with_its_importance() {
    let p = parse(THIS_WEEK.as_bytes()).unwrap();
    assert_eq!((p.events.len(), p.skipped_count, p.partial.clone()), (12, 0, None));
    // 03:15 in New York (UTC−4) = 07:15 UTC = 09:15 in Paris (UTC+2).
    let pmi = find(&p, "French Flash Manufacturing PMI");
    assert_eq!(pmi.starts_at, Some(at(2026, 9, 28, 7, 15)));
    assert_eq!(paris(pmi), ("2026-09-28".into(), Some("09:15".into())));
    assert_eq!((pmi.importance, pmi.currency.as_str(), pmi.forecast.as_deref(), pmi.previous.as_deref()), (Importance::Low, "EUR", Some("48.3"), Some("48.2")));
    let cb = find(&p, "CB Consumer Confidence");
    assert_eq!((paris(cb), cb.importance), (("2026-09-29".into(), Some("16:00".into())), Importance::High));
    assert_eq!(find(&p, "JOLTS Job Openings").importance, Importance::Medium);
    // An empty value is no value.
    let oil = find(&p, "Crude Oil Inventories");
    assert_eq!((oil.forecast.as_deref(), oil.previous.as_deref(), oil.actual.as_deref()), (None, Some("-0.6M"), None));
    // 19:50 in New York is already the next day in Paris (01:50).
    assert_eq!(paris(find(&p, "Tankan Manufacturing Index")), ("2026-10-01".into(), Some("01:50".into())));
    assert_eq!(paris(find(&p, "Non-Farm Employment Change")), ("2026-10-02".into(), Some("14:30".into())));
}

#[test]
fn holidays_and_events_without_time_stay_on_their_day_without_time() {
    let p = parse(THIS_WEEK.as_bytes()).unwrap();
    let holiday = find(&p, "Bank Holiday");
    assert_eq!((holiday.starts_at, holiday.day.as_str(), holiday.importance, holiday.currency.as_str()), (None, "2026-10-01", Importance::Low, "CNY"));
    // Midnight in its own offset: assumed without time (never 06:00 in Paris).
    let cpi = find(&p, "German Prelim CPI m/m");
    assert_eq!((cpi.starts_at, cpi.day.as_str(), cpi.importance), (None, "2026-09-29", Importance::High));
    // `All` = every currency.
    let g20 = find(&p, "G20 Meetings");
    assert_eq!((g20.starts_at, g20.day.as_str(), g20.currency.as_str()), (None, "2026-09-27", ""));
    // A `time` key saying there is none, and "Non-Economic".
    let json = r#"[{"title":"GDT Price Index","country":"NZD","date":"2026-09-29T08:00:00-04:00","time":"Tentative","impact":"Non-Economic"},
                   {"title":"Timed","country":"NZD","date":"2026-09-29T08:00:00-04:00","time":"8:00am","impact":"Medium"},
                   {"title":"Date only","country":"USD","date":"2026-09-30","impact":"High"}]"#;
    let p = parse(json.as_bytes()).unwrap();
    assert_eq!((p.events[0].starts_at, p.events[0].importance), (None, Importance::Low));
    assert_eq!(p.events[1].starts_at, Some(at(2026, 9, 29, 12, 0)));
    assert_eq!((p.events[2].starts_at, p.events[2].day.as_str()), (None, "2026-09-30"));
}

#[test]
fn the_offset_of_each_date_is_applied_across_the_clock_changes() {
    // Late October: Paris is back to winter time (25 Oct) before New York (1 Nov).
    // Spring: New York is in summer time (8 Mar) before Paris (29 Mar).
    let json = r#"[
      {"title":"A","country":"USD","date":"2026-10-23T08:30:00-04:00","impact":"High"},
      {"title":"B","country":"USD","date":"2026-10-26T08:30:00-04:00","impact":"High"},
      {"title":"C","country":"USD","date":"2026-11-02T08:30:00-05:00","impact":"High"},
      {"title":"D","country":"USD","date":"2026-03-10T08:30:00-04:00","impact":"High"},
      {"title":"E","country":"USD","date":"2026-03-30T08:30:00-04:00","impact":"High"},
      {"title":"F","country":"EUR","date":"2026-10-25T00:30:00Z","impact":"Medium"},
      {"title":"G","country":"EUR","date":"2026-10-25T01:30:00Z","impact":"Medium"}]"#;
    let p = parse(json.as_bytes()).unwrap();
    let t = |i: usize| paris(&p.events[i]).1.unwrap();
    assert_eq!([t(0), t(1), t(2), t(3), t(4)], ["14:30", "13:30", "14:30", "13:30", "14:30"]);
    // The repeated hour of 25 October: two different instants, both shown 02:30.
    assert_eq!((t(5), t(6)), ("02:30".into(), "02:30".into()));
    assert_ne!(p.events[5].uid, p.events[6].uid);
}

#[test]
fn every_date_form_is_read_and_nothing_is_guessed() {
    let ok = |s: &str| stamp(s).unwrap().instant();
    let t = Some(at(2026, 9, 29, 12, 30));
    assert_eq!(ok("2026-09-29T08:30:00-04:00"), t);
    assert_eq!(ok("2026-09-29T12:30:00Z"), t);
    assert_eq!(ok("2026-09-29T14:30:00+0200"), t);
    assert_eq!(ok("2026-09-29T14:30+02"), t);
    assert_eq!(ok("2026-09-29 08:30:00.000-04:00"), t);
    assert_eq!(stamp("2026-09-29").unwrap().instant(), None);
    use SkipReason::*;
    for (s, reason) in [
        ("", MissingDate),
        ("Tue Sep 29", InvalidDate),
        ("2026-02-30T10:00:00Z", InvalidDate),
        ("2026/09/29T10:00:00Z", InvalidDate),
        ("2026-09-29T25:00:00Z", InvalidTime),
        ("2026-09-29T10:00:00.x-04:00", InvalidTime),
        ("2026-09-29T10h00-04:00", InvalidTime),
        ("2026-09-29T10:00:00", FloatingTime),
        ("2026-09-29T10:00:00+25:00", InvalidDate),
        ("2026-09-29T10:00:00-4", InvalidDate),
        ("2026-09-29T10:00:00é", InvalidDate),
    ] {
        assert_eq!(stamp(s).err(), Some(reason), "{s:?}");
    }
}

#[test]
fn a_bad_event_is_skipped_with_its_position_and_reason() {
    let json = r#"[
      {"title":"Good","country":"USD","date":"2026-09-30T08:30:00-04:00","impact":"High","forecast":1.5,"previous":null},
      {"country":"USD","date":"2026-09-30T08:30:00-04:00","impact":"High"},
      {"title":"No currency","date":"2026-09-30T08:30:00-04:00","impact":"High"},
      {"title":"No impact","country":"USD","date":"2026-09-30T08:30:00-04:00"},
      {"title":"No date","country":"USD","impact":"High"},
      {"title":"Bad date","country":"USD","date":"Wed Sep 30","impact":"High"},
      {"title":"Floating","country":"USD","date":"2026-09-30T08:30:00","impact":"High"},
      {"title":"Bad currency","country":"XYZ","date":"2026-09-30T08:30:00-04:00","impact":"High"},
      {"title":"Bad impact","country":"USD","date":"2026-09-30T08:30:00-04:00","impact":"Red"},
      "not an event",
      {"title":"Good","country":"usd","date":"2026-09-30T12:30:00Z","impact":"high"},
      {"title":"   ","country":"USD","date":"2026-09-30T08:30:00-04:00","impact":"High"},
      {"title":"Number date","country":"USD","date":20260930,"impact":"High"}]"#;
    let p = parse(json.as_bytes()).unwrap();
    assert_eq!(p.events.len(), 1);
    assert_eq!((p.events[0].forecast.as_deref(), p.events[0].previous.as_deref()), (Some("1.5"), None), "a number is kept as written");
    use SkipReason::*;
    assert_eq!(
        p.skipped.iter().map(|s| (s.line, s.reason)).collect::<Vec<_>>(),
        [
            (2, MissingTitle),
            (3, MissingCurrency),
            (4, MissingImportance),
            (5, MissingDate),
            (6, InvalidDate),
            (7, FloatingTime),
            (8, InvalidCurrency),
            (9, InvalidImportance),
            (10, InvalidEntry),
            (11, Duplicate),
            (12, MissingTitle),
            (13, InvalidDate),
        ]
    );
}

#[test]
fn a_wrong_answer_is_refused_whole_with_a_precise_code() {
    let c = |b: &[u8]| code(parse(b).unwrap_err());
    assert_eq!(c(b""), "news:empty");
    assert_eq!(c(b" \r\n\t"), "news:empty");
    assert_eq!(c("\u{feff}".as_bytes()), "news:empty");
    // The page said to answer beyond the download limit.
    let denied = b"<!DOCTYPE html>\n<html><head><title>Request Denied</title></head><body><h1>Request Denied</h1>\
<p>You've exceeded the limit for Calendar Export requests.</p></body></html>";
    assert_eq!(c(denied), "news:requestDenied");
    assert_eq!(c(b"<html><body>Maintenance</body></html>"), "news:unexpectedResponse");
    assert_eq!(c(b"title,country,date\nNFP,USD,2026-10-02"), "news:unexpectedResponse");
    assert_eq!(c(b"[{\"title\":\"A\",\"country\":\"USD\""), "news:invalidJson");
    assert_eq!(c(b"[1, 2,]"), "news:invalidJson");
    assert_eq!(c(br#"{"events":[]}"#), "news:unexpectedJson");
    // Keys renamed by the site: nothing readable in a non-empty list.
    assert_eq!(c(br#"[{"name":"NFP","currency":"USD","time":"2026-10-02T08:30:00-04:00"}]"#), "news:unexpectedJson");
    assert_eq!(c(b"[1, 2, 3]"), "news:unexpectedJson");
    let big = vec![b' '; crate::news::MAX_BYTES + 1];
    assert_eq!(c(&big), "news:fileTooLarge");
    // An empty week is not an error.
    assert!(parse(b"[]").unwrap().events.is_empty());
    // Every prefix of a valid answer, and corrupted bytes: an error or a result, never a panic.
    let bytes = THIS_WEEK.as_bytes();
    for n in 0..bytes.len() {
        let _ = parse(&bytes[..n]);
    }
    for i in (0..bytes.len()).step_by(7) {
        for flip in [0x00u8, 0xff, b'"', b'[', b'}', b'\\', 0x80] {
            let mut b = bytes.to_vec();
            b[i] = flip;
            let _ = parse(&b);
        }
    }
    // Deeply nested JSON: refused, not a stack overflow.
    let deep = format!("{}{}", "[".repeat(100_000), "]".repeat(100_000));
    assert!(parse(deep.as_bytes()).is_err());
}

#[test]
fn an_ics_answer_is_read_with_the_ics_reader() {
    let ics = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nDTSTART:20261002T123000Z\r\nSUMMARY:Non-Farm Employment Change\r\nCATEGORIES:USD\r\nPRIORITY:1\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";
    let p = parse(ics.as_bytes()).unwrap();
    assert_eq!(p.events.len(), 1);
    assert_eq!((paris(&p.events[0]).1.as_deref(), p.events[0].importance, p.events[0].currency.as_str()), (Some("14:30"), Importance::High, "USD"));
}

#[test]
fn two_weeks_are_merged_without_duplicates() {
    let this = parse(THIS_WEEK.as_bytes()).unwrap();
    let next = parse(NEXT_WEEK.as_bytes()).unwrap();
    assert_eq!(paris(find(&next, "RBA Rate Statement")), ("2026-10-06".into(), Some("06:30".into())));
    assert_eq!(paris(find(&next, "FOMC Meeting Minutes")), ("2026-10-07".into(), Some("20:00".into())));
    let overlap = parse(br#"[{"title":"Non-Farm Employment Change","country":"USD","date":"2026-10-02T08:30:00-04:00","impact":"High"}]"#).unwrap();
    let both = merge(merge(this, next), overlap);
    assert_eq!(both.events.len(), 16);
}

// --- Storage and settings ---

fn with_ff(conn: &Connection) -> NewsSettings {
    let s = NewsSettings { enabled: true, source: SourceKind::ForexFactory, ff_consent: true, ..NewsSettings::default() };
    settings::set(conn, &s).unwrap()
}

fn titles(conn: &Connection, day: &str) -> Vec<(String, Option<String>)> {
    let q = EventQuery { from_day: day.into(), to_day: day.into(), importances: vec![], currencies: vec![] };
    store::list(conn, &q).unwrap().into_iter().map(|e| (e.title, e.paris_time)).collect()
}

#[test]
fn forex_factory_needs_the_consent_and_only_contacts_its_host() {
    let conn = db::open_in_memory().unwrap();
    let mut s = NewsSettings { enabled: true, source: SourceKind::ForexFactory, ..NewsSettings::default() };
    assert_eq!(code(settings::set(&conn, &s).unwrap_err()), "news:consentRequired");
    assert_eq!(settings::get(&conn).unwrap(), NewsSettings::default(), "nothing written");
    s.ff_consent = true;
    let saved = settings::set(&conn, &s).unwrap();
    assert_eq!((saved.source, saved.ff_consent), (SourceKind::ForexFactory, true));
    let st = settings::status_at(&conn, now()).unwrap();
    assert!(st.online_ready);
    assert_eq!(st.online_host.as_deref(), Some(HOST));
    // Off: nothing leaves.
    settings::set(&conn, &NewsSettings { enabled: false, ..saved.clone() }).unwrap();
    assert_eq!(prepare_fetch(&conn, now(), false).unwrap(), None);
    settings::set(&conn, &saved).unwrap();
    let plan = prepare_fetch(&conn, now(), false).unwrap().unwrap();
    assert_eq!((plan.source, plan.url.as_str()), (SourceKind::ForexFactory, THIS_WEEK_URL));
}

#[test]
fn a_reloaded_event_is_updated_never_duplicated_and_an_error_deletes_nothing() {
    let conn = db::open_in_memory().unwrap();
    with_ff(&conn);
    let plan = prepare_fetch(&conn, now(), false).unwrap().unwrap();
    let both = merge(parse(THIS_WEEK.as_bytes()).unwrap(), parse(NEXT_WEEK.as_bytes()).unwrap());
    let s = finish_fetch(&conn, now(), &plan, both.clone()).unwrap();
    assert_eq!((s.added, s.updated, s.removed, s.outside_window), (16, 0, 0, 0));
    assert_eq!(titles(&conn, "2026-09-29"), [("German Prelim CPI m/m".into(), None), ("CB Consumer Confidence".into(), Some("16:00".into())), ("JOLTS Job Openings".into(), Some("16:00".into()))]);

    // An actual value added by hand (a file) on an event: never erased by a reload.
    conn.execute("UPDATE economic_events SET actual = '98.1' WHERE title = 'CB Consumer Confidence'", []).unwrap();
    let s = finish_fetch(&conn, now() + 10 * MIN, &plan, both.clone()).unwrap();
    assert_eq!((s.added, s.updated, s.removed), (0, 16, 0));
    assert_eq!(store::count(&conn).unwrap(), 16);
    let actual: Option<String> = conn.query_row("SELECT actual FROM economic_events WHERE title = 'CB Consumer Confidence'", [], |r| r.get(0)).unwrap();
    assert_eq!(actual.as_deref(), Some("98.1"));

    // A failed attempt keeps everything.
    fail_fetch(&conn, "news:requestDenied").unwrap();
    assert_eq!(store::count(&conn).unwrap(), 16);
    assert_eq!(settings::state(&conn).unwrap().last_error.as_deref(), Some("news:requestDenied"));

    // Rescheduled: JOLTS moved to 10:30 New York and the CB event withdrawn. The old JOLTS goes
    // (no duplicate), the CB event stays because it carries an actual value; the next week, not in
    // this answer, is untouched.
    let moved = THIS_WEEK
        .replace(r#""date":"2026-09-29T10:00:00-04:00","impact":"Medium""#, r#""date":"2026-09-29T10:30:00-04:00","impact":"Medium""#)
        .replace(r#"{"title":"CB Consumer Confidence","country":"USD","date":"2026-09-29T10:00:00-04:00","impact":"High","forecast":"96.0","previous":"97.4"},"#, "");
    let s = finish_fetch(&conn, now() + 20 * MIN, &plan, parse(moved.as_bytes()).unwrap()).unwrap();
    assert_eq!((s.added, s.updated, s.removed), (1, 10, 1));
    assert_eq!(titles(&conn, "2026-09-29"), [("German Prelim CPI m/m".into(), None), ("CB Consumer Confidence".into(), Some("16:00".into())), ("JOLTS Job Openings".into(), Some("16:30".into()))]);
    assert_eq!(titles(&conn, "2026-10-07"), [("FOMC Meeting Minutes".into(), Some("20:00".into()))]);
    assert_eq!(settings::state(&conn).unwrap().last_error, None, "cleared by the success");
}

#[test]
fn leaving_forex_factory_deletes_its_events_but_not_the_files() {
    let conn = db::open_in_memory().unwrap();
    let ff_on = with_ff(&conn);
    let plan = prepare_fetch(&conn, now(), false).unwrap().unwrap();
    finish_fetch(&conn, now(), &plan, parse(THIS_WEEK.as_bytes()).unwrap()).unwrap();
    let csv = "date;heure;devise;titre;importance;prevu;precedent;reel\n2026-10-14;10:00;USD;Fichier;forte\n";
    settings::import_file(&conn, settings::FileFormat::Csv, csv.as_bytes(), &Defaults { importance: Importance::High, currency: None }, now()).unwrap();
    assert_eq!(store::count(&conn).unwrap(), 13);
    // The alert window and consent may change without touching the events.
    settings::set(&conn, &NewsSettings { window_after_min: 30, ..ff_on.clone() }).unwrap();
    assert_eq!(store::count(&conn).unwrap(), 13);
    settings::set(&conn, &NewsSettings { source: SourceKind::None, ..ff_on }).unwrap();
    let left: Vec<String> = conn.prepare("SELECT source FROM economic_events").unwrap().query_map([], |r| r.get(0)).unwrap().map(|r| r.unwrap()).collect();
    assert_eq!(left, [SOURCE_FILE]);
    let st = settings::state(&conn).unwrap();
    assert_eq!((st.last_success_at, st.last_count), (None, None));
}

#[test]
fn settings_changed_during_a_fetch_store_nothing() {
    let conn = db::open_in_memory().unwrap();
    let ff_on = with_ff(&conn);
    let plan = prepare_fetch(&conn, now(), true).unwrap().unwrap();
    settings::set(&conn, &NewsSettings { source: SourceKind::None, ..ff_on }).unwrap();
    let s = finish_fetch(&conn, now(), &plan, parse(THIS_WEEK.as_bytes()).unwrap()).unwrap();
    assert_eq!((s.added, store::count(&conn).unwrap()), (0, 0));
}

#[test]
fn testing_the_source_stores_nothing_until_confirmed_and_respects_the_gap() {
    let conn = db::open_in_memory().unwrap();
    let off = NewsSettings { source: SourceKind::ForexFactory, ff_consent: true, ..NewsSettings::default() };
    assert_eq!(code(prepare_test(&conn, now(), &off).unwrap_err()), "news:disabled");
    settings::set(&conn, &NewsSettings { enabled: true, ..NewsSettings::default() }).unwrap();
    let form = NewsSettings { enabled: true, ..off };
    assert_eq!(code(prepare_test(&conn, now(), &NewsSettings { ff_consent: false, ..form.clone() }).unwrap_err()), "news:consentRequired");
    assert_eq!(code(prepare_test(&conn, now(), &NewsSettings { source: SourceKind::None, ..form.clone() }).unwrap_err()), "news:noSource");
    assert_eq!(settings::state(&conn).unwrap().last_attempt_at, None, "a refused test sends nothing and records nothing");

    let plan = prepare_test(&conn, now(), &form).unwrap();
    assert_eq!(plan.source, SourceKind::ForexFactory);
    assert_eq!(settings::state(&conn).unwrap().last_attempt_at, Some(now()));
    assert_eq!(settings::get(&conn).unwrap().source, SourceKind::None, "the test saves no setting");
    // Within 5 minutes: no second request, test or refresh.
    assert_eq!(code(prepare_test(&conn, now() + 4 * MIN, &form).unwrap_err()), "news:tooSoon");
    assert_eq!(settings::status_at(&conn, now() + 4 * MIN).unwrap().next_request_at, Some(now() + 5 * MIN));

    let parsed = merge(parse(THIS_WEEK.as_bytes()).unwrap(), parse(NEXT_WEEK.as_bytes()).unwrap());
    let shown = preview(&parsed, now());
    assert_eq!(shown.count, 16);
    assert_eq!(
        shown.events.iter().map(|e| (e.day.as_str(), e.paris_time.as_deref(), e.title.as_str(), e.importance)).collect::<Vec<_>>(),
        [
            ("2026-09-29", None, "German Prelim CPI m/m", Importance::High),
            ("2026-09-29", Some("16:00"), "CB Consumer Confidence", Importance::High),
            ("2026-09-29", Some("16:00"), "JOLTS Job Openings", Importance::Medium),
        ]
    );
    assert_eq!(shown.events[0].weekday, 2);
    assert_eq!(store::count(&conn).unwrap(), 0, "nothing stored by the test");

    // Confirmed before the settings are saved: refused; once saved: stored, counts as today's fetch.
    assert_eq!(code(keep_tested(&conn, now() + MIN, &plan, parsed.clone()).unwrap_err()), "news:previewOutdated");
    settings::set(&conn, &form).unwrap();
    let s = keep_tested(&conn, now() + MIN, &plan, parsed).unwrap();
    assert_eq!(s.added, 16);
    assert_eq!(prepare_fetch(&conn, now() + 3 * HOUR, false).unwrap(), None, "no request at the next opening today");
    // All past: the first ones are shown.
    let late = preview(&parse(THIS_WEEK.as_bytes()).unwrap(), at(2026, 10, 10, 0, 0));
    assert_eq!(late.events[0].title, "G20 Meetings");
    // An ICS plan is compared with its address.
    let other = FetchPlan { source: SourceKind::IcsUrl, url: "https://x.example/a.ics".into(), defaults: plan.defaults.clone() };
    assert_eq!(code(keep_tested(&conn, now(), &other, Parsed::default()).unwrap_err()), "news:previewOutdated");
}
