//! Economic calendar without network: files, storage, purge, settings, migration v14.

use super::settings::{self, FileFormat, prepare_fetch, finish_fetch, fail_fetch, import_file};
use super::store::{self, EventQuery, SOURCE_FILE, SOURCE_ICS_URL};
use super::zones::{DAY_MS, paris_day};
use super::*;
use crate::db;
use crate::error::CoreError;
use crate::migrations::{current_version, migrate_to};
use crate::stats::time::days_from_civil;
use rusqlite::Connection;

const HOUR: i64 = 3_600_000;
const MIN: i64 = 60_000;

fn at(y: i64, m: u32, d: u32, h: i64, min: i64) -> i64 {
    days_from_civil(y, m, d).unwrap() * DAY_MS + h * HOUR + min * MIN
}

/// Tuesday 2026-09-29 10:00 UTC (12:00 in Paris).
fn now() -> i64 {
    at(2026, 9, 29, 10, 0)
}

fn defaults() -> Defaults {
    Defaults { importance: Importance::Medium, currency: None }
}

fn code(e: CoreError) -> String {
    match e {
        CoreError::Invalid(m) => m,
        other => panic!("expected an invalid-input error, got {other:?}"),
    }
}

fn enabled(conn: &Connection) {
    let s = NewsSettings { enabled: true, ..NewsSettings::default() };
    settings::set(conn, &s).unwrap();
}

const ICS: &str = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//FR\r\n\
BEGIN:VEVENT\r\nUID:cpi-2026-10\r\nDTSTART:20261014T123000Z\r\nSUMMARY:CPI m/m\r\nPRIORITY:1\r\nCATEGORIES:USD\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nUID:ecb\r\nDTSTART;TZID=Europe/Paris:20261029T141500\r\nSUMMARY:BCE \\, décision\r\n  de taux\r\nPRIORITY:5\r\n\
BEGIN:VALARM\r\nSUMMARY:rappel\r\nPRIORITY:9\r\nEND:VALARM\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nDTSTART;TZID=\"America/New_York\":20261106T083000\r\nSUMMARY:Non-Farm Payrolls\r\nCATEGORIES:Emploi,usd\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nUID:holiday\r\nDTSTART;VALUE=DATE:20261111\r\nSUMMARY:Jour férié\r\nPRIORITY:7\r\nEND:VEVENT\r\n\
END:VCALENDAR\r\n";

#[test]
fn an_ics_file_is_read_in_utc_paris_and_new_york_time() {
    let p = ics::parse(ICS.as_bytes(), &defaults()).unwrap();
    assert_eq!(p.skipped_count, 0, "{:?}", p.skipped);
    let e = &p.events;
    assert_eq!(e.len(), 4);
    // UTC, priority 1 = high, currency from CATEGORIES.
    assert_eq!((e[0].uid.as_str(), e[0].starts_at, e[0].day.as_str()), ("cpi-2026-10", Some(at(2026, 10, 14, 12, 30)), "2026-10-14"));
    assert_eq!((e[0].importance, e[0].currency.as_str(), e[0].title.as_str()), (Importance::High, "USD", "CPI m/m"));
    // Paris summer time (before the 25 October change): 14:15 Paris = 12:15 UTC… on 29 October, after it: 13:15 UTC.
    assert_eq!(e[1].starts_at, Some(at(2026, 10, 29, 13, 15)));
    assert_eq!(e[1].title, "BCE , décision de taux", "unfolded and unescaped");
    assert_eq!(e[1].importance, Importance::Medium, "priority 5; the alarm's priority is ignored");
    assert_eq!(e[1].currency, "", "no currency given, none by default");
    // New York 08:30 on 6 November (US back to winter time on 1 November) = 13:30 UTC.
    assert_eq!(e[2].starts_at, Some(at(2026, 11, 6, 13, 30)));
    assert_eq!((e[2].currency.as_str(), e[2].importance), ("USD", Importance::Medium), "no priority: the chosen default");
    assert!(e[2].uid.starts_with("2026-11-06|"), "no UID: a derived key");
    // A day without time.
    assert_eq!((e[3].starts_at, e[3].day.as_str(), e[3].importance), (None, "2026-11-11", Importance::Low));
}

#[test]
fn an_ics_file_never_guesses_a_time_zone() {
    let ics = "BEGIN:VCALENDAR\n\
BEGIN:VEVENT\nDTSTART:20261014T123000\nSUMMARY:Floating\nEND:VEVENT\n\
BEGIN:VEVENT\nDTSTART;TZID=Europe/London:20261014T123000\nSUMMARY:London\nEND:VEVENT\n\
BEGIN:VEVENT\nDTSTART;TZID=Europe/Paris:20260329T023000\nSUMMARY:Gap\nEND:VEVENT\n\
BEGIN:VEVENT\nDTSTART;TZID=Europe/Paris:20261025T023000\nSUMMARY:Twice\nEND:VEVENT\n\
BEGIN:VEVENT\nSUMMARY:No date\nEND:VEVENT\n\
BEGIN:VEVENT\nDTSTART:20261399T000000Z\nSUMMARY:Month 13\nEND:VEVENT\n\
BEGIN:VEVENT\nDTSTART:20261014T256000Z\nSUMMARY:Hour 25\nEND:VEVENT\n\
BEGIN:VEVENT\nDTSTART:20261014T120000Z\nSUMMARY: \nEND:VEVENT\n\
BEGIN:VEVENT\nDTSTART:20261014T120000Z\nSUMMARY:Cut\n";
    let p = ics::parse(ics.as_bytes(), &defaults()).unwrap();
    assert_eq!(p.events.iter().map(|e| e.title.as_str()).collect::<Vec<_>>(), ["Twice"]);
    assert_eq!(p.events[0].starts_at, Some(at(2026, 10, 25, 0, 30)), "a repeated hour takes the first (summer) one");
    use SkipReason::*;
    assert_eq!(
        p.skipped.iter().map(|s| (s.line, s.reason)).collect::<Vec<_>>(),
        [(2, FloatingTime), (6, UnsupportedTimeZone), (10, NonexistentTime), (18, MissingDate), (21, InvalidDate), (25, InvalidTime), (29, MissingTitle), (33, Incomplete)]
    );
    assert_eq!(p.skipped_count, 8);
}

#[test]
fn a_file_that_is_not_a_calendar_or_too_big_is_refused_whole() {
    assert_eq!(code(ics::parse(b"<!DOCTYPE html><html>Request Denied</html>", &defaults()).unwrap_err()), "news:notIcs");
    assert_eq!(code(ics::parse(b"", &defaults()).unwrap_err()), "news:notIcs");
    let big = vec![b'a'; MAX_BYTES + 1];
    assert_eq!(code(ics::parse(&big, &defaults()).unwrap_err()), "news:fileTooLarge");
    assert_eq!(code(csv::parse(&big, &defaults()).unwrap_err()), "news:fileTooLarge");
    assert_eq!(code(csv::parse(b"a;b;c\n", &defaults()).unwrap_err()), "news:csvHeader");
    // An empty calendar is fine: nothing to add.
    assert!(ics::parse(b"BEGIN:VCALENDAR\nEND:VCALENDAR\n", &defaults()).unwrap().events.is_empty());
}

#[test]
fn a_corrupted_file_never_panics() {
    // Every prefix, and every byte flipped, of a valid file: an error or a partial result, never a panic.
    let bytes = ICS.as_bytes();
    for cut in 0..bytes.len() {
        let _ = ics::parse(&bytes[..cut], &defaults());
    }
    let csv_text = "date;heure;devise;titre;importance;prevu;precedent;reel\n2026-10-14;14:30;USD;CPI;forte;0,3 %;0,2 %;\n";
    for i in 0..bytes.len().max(csv_text.len()) {
        for flip in [0x00u8, 0xff, b'\n', b':', b';', b'"', b'\\', 0x80] {
            let mut b = bytes.to_vec();
            if i < b.len() {
                b[i] = flip;
                let _ = ics::parse(&b, &defaults());
            }
            let mut c = csv_text.as_bytes().to_vec();
            if i < c.len() {
                c[i] = flip;
                let _ = csv::parse(&c, &defaults());
            }
        }
    }
    // Invalid UTF-8 and a lone backslash at the end of a value.
    let p = ics::parse(b"BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART:20261014T120000Z\nSUMMARY:Bad \xff\xfe \\\nEND:VEVENT\n", &defaults()).unwrap();
    assert_eq!(p.events.len(), 1);
    assert!(p.events[0].title.starts_with("Bad "));
}

#[test]
fn too_many_events_are_counted_not_kept() {
    let mut s = String::from("BEGIN:VCALENDAR\n");
    for i in 0..MAX_EVENTS + 3 {
        s.push_str(&format!("BEGIN:VEVENT\nUID:e{i}\nDTSTART;VALUE=DATE:20261014\nSUMMARY:E{i}\nEND:VEVENT\n"));
    }
    let p = ics::parse(s.as_bytes(), &defaults()).unwrap();
    assert_eq!((p.events.len(), p.skipped_count), (MAX_EVENTS, 3));
    assert!(p.skipped.iter().all(|s| s.reason == SkipReason::TooManyEvents));
}

#[test]
fn a_pulse_csv_file_is_read_in_paris_time() {
    let text = "\u{feff}Date;Heure;Devise;Titre;Importance;Prévu;Précédent;Réel\r\n\
2026-10-14;14:30;usd;\"CPI; m/m\";forte;0,3 %;0,2 %;\r\n\
2026-01-14;9:00;EUR;PIB;Moyenne;;;1,1 %\r\n\
2026-11-11;;;Jour férié;faible\r\n\
\r\n\
2026-03-29;02:30;EUR;Gap;forte\r\n\
2026-02-30;10:00;EUR;Bad day;forte\r\n\
2026-10-14;24:00;EUR;Bad hour;forte\r\n\
2026-10-14;10:00;EURO;Bad currency;forte\r\n\
2026-10-14;10:00;EUR;;forte\r\n\
2026-10-14;10:00;EUR;X;énorme\r\n\
2026-10-14;10:00\r\n\
;10:00;EUR;No date;forte\r\n";
    let p = csv::parse(text.as_bytes(), &Defaults { importance: Importance::High, currency: Some("GBP".into()) }).unwrap();
    let e = &p.events;
    assert_eq!(e.len(), 3);
    assert_eq!((e[0].starts_at, e[0].currency.as_str(), e[0].title.as_str()), (Some(at(2026, 10, 14, 12, 30)), "USD", "CPI; m/m"));
    assert_eq!((e[0].forecast.as_deref(), e[0].previous.as_deref(), e[0].actual.as_deref()), (Some("0,3 %"), Some("0,2 %"), None));
    assert_eq!(e[1].starts_at, Some(at(2026, 1, 14, 8, 0)), "winter: Paris = UTC+1");
    assert_eq!((e[1].importance, e[1].actual.as_deref()), (Importance::Medium, Some("1,1 %")));
    assert_eq!((e[2].starts_at, e[2].currency.as_str(), e[2].importance), (None, "GBP", Importance::Low), "empty currency: the default");
    use SkipReason::*;
    assert_eq!(
        p.skipped.iter().map(|s| (s.line, s.reason)).collect::<Vec<_>>(),
        [(6, NonexistentTime), (7, InvalidDate), (8, InvalidTime), (9, InvalidCurrency), (10, MissingTitle), (11, InvalidImportance), (12, MissingColumns), (13, MissingDate)]
    );
}

#[test]
fn importing_needs_the_calendar_on_and_keeps_a_released_value() {
    let conn = db::open_in_memory().unwrap();
    let csv1 = "date;heure;devise;titre;importance;prevu;precedent;reel\n2026-10-14;14:30;USD;CPI;forte;0,3 %;0,2 %;\n";
    assert_eq!(code(import_file(&conn, FileFormat::Csv, csv1.as_bytes(), &defaults(), now()).unwrap_err()), "news:disabled");
    enabled(&conn);
    let s = import_file(&conn, FileFormat::Csv, csv1.as_bytes(), &defaults(), now()).unwrap();
    assert_eq!((s.added, s.updated, s.skipped_count), (1, 0, 0));

    // The same event with its actual value: updated, not duplicated.
    let csv2 = "date;heure;devise;titre;importance;prevu;precedent;reel\n2026-10-14;14:30;USD;CPI;forte;0,3 %;0,2 %;0,4 %\n";
    let s = import_file(&conn, FileFormat::Csv, csv2.as_bytes(), &defaults(), now() + HOUR).unwrap();
    assert_eq!((s.added, s.updated), (0, 1));
    // Read again without the actual value (an older copy): the released value stays.
    import_file(&conn, FileFormat::Csv, csv1.as_bytes(), &defaults(), now() + 2 * HOUR).unwrap();
    let q = EventQuery { from_day: "2026-10-14".into(), to_day: "2026-10-14".into(), importances: vec![], currencies: vec![] };
    let list = store::list(&conn, &q).unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!((list[0].actual.as_deref(), list[0].forecast.as_deref(), list[0].updated_at), (Some("0,4 %"), Some("0,3 %"), now() + 2 * HOUR));
    assert_eq!((list[0].paris_time.as_deref(), list[0].weekday, list[0].source.as_str()), (Some("14:30"), 3, SOURCE_FILE));
    // A default currency must be a known one.
    let bad = Defaults { importance: Importance::High, currency: Some("XYZ".into()) };
    assert_eq!(code(import_file(&conn, FileFormat::Ics, ICS.as_bytes(), &bad, now()).unwrap_err()), "news:invalidCurrency");
}

#[test]
fn lists_are_ordered_and_filtered_and_upcoming_starts_now() {
    let conn = db::open_in_memory().unwrap();
    enabled(&conn);
    let csv = "date;heure;devise;titre;importance;prevu;precedent;reel\n\
2026-09-29;16:00;USD;Confiance;moyenne\n\
2026-09-29;11:00;EUR;Chômage;faible\n\
2026-09-29;;;Toute la journée;forte\n\
2026-09-30;14:15;EUR;BCE;forte\n\
2026-09-28;14:30;USD;Hier;forte\n";
    import_file(&conn, FileFormat::Csv, csv.as_bytes(), &defaults(), now()).unwrap();
    let (monday, sunday) = store::paris_week(now());
    assert_eq!((monday.as_str(), sunday.as_str()), ("2026-09-28", "2026-10-04"));
    let week = EventQuery { from_day: monday, to_day: sunday, importances: vec![], currencies: vec![] };
    let titles = |q: &EventQuery| store::list(&conn, q).unwrap().into_iter().map(|e| e.title).collect::<Vec<_>>();
    assert_eq!(titles(&week), ["Hier", "Toute la journée", "Chômage", "Confiance", "BCE"]);
    assert_eq!(titles(&EventQuery { importances: vec![Importance::High], ..week.clone() }), ["Hier", "Toute la journée", "BCE"]);
    assert_eq!(titles(&EventQuery { currencies: vec!["eur".into()], ..week.clone() }), ["Chômage", "BCE"]);
    assert_eq!(titles(&EventQuery { currencies: vec!["".into()], ..week.clone() }), ["Toute la journée"]);
    assert_eq!(store::currencies(&conn).unwrap(), ["EUR", "USD"]);

    // 12:00 in Paris: the 11:00 event is past, the all-day event of today is still listed.
    let next: Vec<String> = store::upcoming(&conn, now(), 10, &[]).unwrap().into_iter().map(|e| e.title).collect();
    assert_eq!(next, ["Toute la journée", "Confiance", "BCE"]);
    let high: Vec<String> = store::upcoming(&conn, now(), 1, &[Importance::High]).unwrap().into_iter().map(|e| e.title).collect();
    assert_eq!(high, ["Toute la journée"]);

    for (from, to) in [("2026-10-01", "2026-09-30"), ("x", "2026-09-30"), ("2026-01-01", "2027-12-31")] {
        let q = EventQuery { from_day: from.into(), to_day: to.into(), importances: vec![], currencies: vec![] };
        assert_eq!(code(store::list(&conn, &q).unwrap_err()), "news:invalidRange");
    }
    assert_eq!(store::clear(&conn).unwrap(), 5);
}

#[test]
fn events_older_than_two_years_are_purged() {
    let conn = db::open_in_memory().unwrap();
    enabled(&conn);
    // Today is 2026-09-29 in Paris: the limit day is 2024-09-29 (730 days before), kept.
    let csv = "date;heure;devise;titre;importance;prevu;precedent;reel\n\
2024-09-28;10:00;USD;Trop vieux;forte\n\
2024-09-29;10:00;USD;Limite;forte\n\
2026-09-01;10:00;USD;Récent;forte\n";
    let s = import_file(&conn, FileFormat::Csv, csv.as_bytes(), &defaults(), now()).unwrap();
    assert_eq!((s.added, s.purged), (3, 1));
    assert_eq!(store::count(&conn).unwrap(), 2);
    // A year later, the others go too.
    assert_eq!(store::purge(&conn, now() + 365 * DAY_MS).unwrap(), 1);
    assert_eq!(store::count(&conn).unwrap(), 1);
}

#[test]
fn settings_are_off_by_default_and_validated() {
    let conn = db::open_in_memory().unwrap();
    let s = settings::get(&conn).unwrap();
    assert_eq!(s, NewsSettings::default());
    assert!(!s.enabled && s.source == SourceKind::None && s.ics_url.is_none() && s.alert);
    assert_eq!((s.window_before_min, s.window_after_min, s.ics_importance), (15, 15, Importance::Medium));

    let with = |f: &dyn Fn(&mut NewsSettings)| {
        let mut s = NewsSettings { enabled: true, ..NewsSettings::default() };
        f(&mut s);
        settings::set(&conn, &s).map_err(code)
    };
    assert_eq!(with(&|s| s.source = SourceKind::IcsUrl).unwrap_err(), "news:noSource");
    assert_eq!(with(&|s| s.ics_url = Some("http://example.org/a.ics".into())).unwrap_err(), "news:urlNotHttps");
    assert_eq!(with(&|s| s.ics_url = Some("https://user:pw@example.org/a.ics".into())).unwrap_err(), "news:urlWithCredentials");
    assert_eq!(with(&|s| s.ics_url = Some("https://exa mple.org/a.ics".into())).unwrap_err(), "news:invalidUrl");
    assert_eq!(with(&|s| s.ics_url = Some("https:///a.ics".into())).unwrap_err(), "news:invalidUrl");
    assert_eq!(with(&|s| s.ics_url = Some(format!("https://example.org/{}", "a".repeat(2100)))).unwrap_err(), "news:invalidUrl");
    assert_eq!(with(&|s| s.window_before_min = 241).unwrap_err(), "news:invalidWindow");
    assert_eq!(with(&|s| s.ics_currency = Some("XYZ".into())).unwrap_err(), "news:invalidCurrency");
    assert_eq!(settings::get(&conn).unwrap(), NewsSettings::default(), "nothing written by a refused setting");

    let ok = with(&|s| {
        s.source = SourceKind::IcsUrl;
        s.ics_url = Some(" https://calendar.example.org:8443/eco.ics?week=this ".into());
        s.ics_currency = Some("usd".into());
        s.window_before_min = 0;
        s.alert = false;
    })
    .unwrap();
    assert_eq!(ok.ics_url.as_deref(), Some("https://calendar.example.org:8443/eco.ics?week=this"));
    assert_eq!((ok.ics_currency.as_deref(), ok.window_before_min, ok.alert), (Some("USD"), 0, false));
    let st = settings::status(&conn).unwrap();
    assert!(st.online_ready);
    assert_eq!(st.online_host.as_deref(), Some("calendar.example.org"));
}

fn parsed(uid: &str, day: &str) -> Parsed {
    let t = crate::stats::time::parse_day(day).unwrap() * DAY_MS + 12 * HOUR;
    Parsed {
        events: vec![NewEvent {
            uid: uid.into(),
            starts_at: Some(t),
            day: day.into(),
            currency: "USD".into(),
            title: uid.into(),
            importance: Importance::High,
            forecast: None,
            previous: None,
            actual: None,
        }],
        ..Parsed::default()
    }
}

#[test]
fn fetching_is_off_by_default_once_a_day_and_never_twice_in_five_minutes() {
    let conn = db::open_in_memory().unwrap();
    // Off: an automatic fetch does nothing, a manual one says why.
    assert_eq!(prepare_fetch(&conn, now(), false).unwrap(), None);
    assert_eq!(code(prepare_fetch(&conn, now(), true).unwrap_err()), "news:disabled");
    enabled(&conn);
    assert_eq!(prepare_fetch(&conn, now(), false).unwrap(), None, "no online source by default");
    assert_eq!(code(prepare_fetch(&conn, now(), true).unwrap_err()), "news:noSource");
    let feed = NewsSettings {
        enabled: true,
        source: SourceKind::IcsUrl,
        ics_url: Some("https://calendar.example.org/eco.ics".into()),
        ics_importance: Importance::High,
        ..NewsSettings::default()
    };
    settings::set(&conn, &feed).unwrap();

    let plan = prepare_fetch(&conn, now(), false).unwrap().unwrap();
    assert_eq!(plan.url, "https://calendar.example.org/eco.ics");
    assert_eq!(plan.defaults, Defaults { importance: Importance::High, currency: None });
    assert_eq!(settings::state(&conn).unwrap().last_attempt_at, Some(now()), "recorded before anything leaves");
    // The attempt fails: stored events stay, the error is kept, no automatic retry today.
    fail_fetch(&conn, "news:offline").unwrap();
    assert_eq!(settings::state(&conn).unwrap().last_error.as_deref(), Some("news:offline"));
    assert_eq!(prepare_fetch(&conn, now() + 6 * HOUR, false).unwrap(), None, "same Paris day");
    // Manual: not within 5 minutes, then allowed.
    assert_eq!(code(prepare_fetch(&conn, now() + 4 * MIN, true).unwrap_err()), "news:tooSoon");
    assert!(prepare_fetch(&conn, now() + 5 * MIN, true).unwrap().is_some());
    // Next Paris day (00:10 Paris = 22:10 UTC the day before): automatic again.
    assert!(prepare_fetch(&conn, at(2026, 9, 29, 22, 10), false).unwrap().is_some());
    assert_eq!(paris_day(at(2026, 9, 29, 22, 10)), "2026-09-30");

    // A success keeps today − 7 … today + 60 only and clears the error.
    let mut p = parsed("in", "2026-10-14");
    p.events.extend(parsed("too-old", "2026-09-20").events);
    p.events.extend(parsed("too-far", "2026-12-15").events);
    let s = finish_fetch(&conn, now(), p).unwrap();
    assert_eq!((s.added, s.outside_window), (1, 2));
    let st = settings::state(&conn).unwrap();
    assert_eq!((st.last_success_at, st.last_error, st.last_count), (Some(now()), None, Some(3)));

    // Changing the address deletes the previous feed's events (files stay).
    let csv = "date;heure;devise;titre;importance;prevu;precedent;reel\n2026-10-14;10:00;USD;Fichier;forte\n";
    import_file(&conn, FileFormat::Csv, csv.as_bytes(), &defaults(), now()).unwrap();
    assert_eq!(store::count(&conn).unwrap(), 2);
    settings::set(&conn, &NewsSettings { ics_url: Some("https://other.example.org/b.ics".into()), ..feed }).unwrap();
    assert_eq!(store::count(&conn).unwrap(), 1);
    let left: String = conn.query_row("SELECT source FROM economic_events", [], |r| r.get(0)).unwrap();
    assert_eq!(left, SOURCE_FILE);
    assert_eq!(settings::state(&conn).unwrap().last_success_at, None);
    let feed_left: i64 = conn.query_row("SELECT COUNT(*) FROM economic_events WHERE source = ?1", [SOURCE_ICS_URL], |r| r.get(0)).unwrap();
    assert_eq!(feed_left, 0);
}

#[test]
fn v14_adds_the_calendar_and_keeps_existing_data() {
    let mut conn = Connection::open_in_memory().unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    migrate_to(&mut conn, 13).unwrap();
    let a = crate::test_support::account(&conn, "10000");
    let eu = crate::test_support::instrument(&conn, "EURUSD", "100000");
    let trade = crate::trades::create(&conn, &crate::trades::TradeData::new(a, eu, crate::trades::Direction::Long, 1.into(), 1.into(), 0)).unwrap().id;
    conn.execute("INSERT INTO settings (key, value) VALUES ('alerts.revenge', 'off')", []).unwrap();
    conn.execute("INSERT INTO coach_conversations (title, created_at, updated_at, tools_version) VALUES ('T', 1, 1, 1)", []).unwrap();

    migrate_to(&mut conn, 14).unwrap();
    assert_eq!(current_version(&conn).unwrap(), 14);
    assert_eq!(crate::trades::get(&conn, trade).unwrap().id, trade);
    assert!(!crate::alerts::settings::get(&conn).unwrap().revenge);
    let convs: i64 = conn.query_row("SELECT COUNT(*) FROM coach_conversations", [], |r| r.get(0)).unwrap();
    assert_eq!(convs, 1);
    assert_eq!(store::count(&conn).unwrap(), 0);
    assert!(!settings::get(&conn).unwrap().enabled, "the calendar stays off after the update");

    // Guards written straight to the schema.
    let insert = |uid: &str, currency: &str, importance: &str| {
        conn.execute(
            "INSERT INTO economic_events (source, uid, starts_at, day, currency, title, importance, updated_at)
             VALUES ('file', ?1, NULL, '2026-10-14', ?2, 'T', ?3, 1)",
            rusqlite::params![uid, currency, importance],
        )
    };
    assert!(insert("a", "USD", "high").is_ok());
    assert!(insert("a", "USD", "high").is_err(), "unique per source and uid");
    assert!(insert("b", "US", "high").is_err());
    assert!(insert("c", "", "urgent").is_err());
    assert!(insert("d", "", "low").is_ok());
}

#[test]
fn the_calendar_page_covers_today_or_the_paris_week_and_files_are_size_checked() {
    let conn = db::open_in_memory().unwrap();
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("eco.csv");
    std::fs::write(&path, "date;heure;devise;titre;importance;prevu;precedent;reel\n2026-09-29;14:30;USD;A;forte\n2026-10-04;10:00;EUR;B;faible\n2026-10-05;10:00;EUR;C;faible\n").unwrap();
    assert_eq!(code(settings::import_path(&conn, FileFormat::Csv, &path, &defaults(), now()).unwrap_err()), "news:disabled");
    enabled(&conn);
    assert_eq!(code(settings::import_path(&conn, FileFormat::Csv, &dir.path().join("missing.csv"), &defaults(), now()).unwrap_err()), "news:fileUnreadable");
    assert_eq!(settings::import_path(&conn, FileFormat::Csv, &path, &defaults(), now()).unwrap().added, 3);
    let big = dir.path().join("big.ics");
    std::fs::write(&big, vec![b'x'; MAX_BYTES + 1]).unwrap();
    assert_eq!(code(settings::import_path(&conn, FileFormat::Ics, &big, &defaults(), now()).unwrap_err()), "news:fileTooLarge");

    let today = store::calendar(&conn, now(), CalendarView::Today, &[], &[]).unwrap();
    assert_eq!((today.today.as_str(), today.from_day.as_str(), today.to_day.as_str()), ("2026-09-29", "2026-09-29", "2026-09-29"));
    assert_eq!(today.events.iter().map(|e| e.title.as_str()).collect::<Vec<_>>(), ["A"]);
    assert_eq!(today.currencies, ["EUR", "USD"]);
    let week = store::calendar(&conn, now(), CalendarView::Week, &[Importance::Low], &[]).unwrap();
    assert_eq!((week.from_day.as_str(), week.to_day.as_str()), ("2026-09-28", "2026-10-04"));
    assert_eq!(week.events.iter().map(|e| e.title.as_str()).collect::<Vec<_>>(), ["B"], "Sunday in, next Monday out");
    // Sunday 23:30 UTC in summer is already Monday in Paris: the next week.
    let late = at(2026, 10, 4, 22, 30);
    assert_eq!(store::calendar(&conn, late, CalendarView::Week, &[], &[]).unwrap().from_day, "2026-10-05");
}
