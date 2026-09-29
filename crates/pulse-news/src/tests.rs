//! Tests against a fake local server (plain HTTP on 127.0.0.1): no real calendar is ever called.

use super::*;
use pulse_core::news::{Defaults, Importance, SourceKind};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::mpsc;
use std::thread;

struct Seen {
    request_line: String,
    headers: Vec<(String, String)>,
    body_len: usize,
}

fn read_request(stream: &TcpStream) -> Seen {
    let mut reader = BufReader::new(stream.try_clone().unwrap());
    let mut request_line = String::new();
    reader.read_line(&mut request_line).unwrap();
    let mut headers = Vec::new();
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        let line = line.trim_end();
        if line.is_empty() {
            break;
        }
        let (n, v) = line.split_once(':').unwrap();
        headers.push((n.trim().to_ascii_lowercase(), v.trim().to_owned()));
    }
    let len = headers.iter().find(|(n, _)| n == "content-length").map_or(0, |(_, v)| v.parse().unwrap());
    let mut buf = vec![0; len];
    reader.read_exact(&mut buf).unwrap();
    Seen { request_line: request_line.trim_end().to_owned(), headers, body_len: len }
}

enum Answer {
    /// Status, extra header lines, body.
    Full(u16, &'static str, Vec<u8>),
    /// Never answers.
    Silent,
    /// A body larger than announced limits, sent without content-length (read until close).
    Stream(usize),
}

fn fake_server(answer: Answer) -> (String, mpsc::Receiver<Seen>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        tx.send(read_request(&stream)).unwrap();
        match answer {
            Answer::Full(status, extra, body) => {
                let head = format!("HTTP/1.1 {status} X\r\ncontent-type: text/calendar\r\n{extra}content-length: {}\r\nconnection: close\r\n\r\n", body.len());
                let _ = stream.write_all(head.as_bytes());
                let _ = stream.write_all(&body);
            }
            Answer::Silent => thread::sleep(Duration::from_secs(3)),
            Answer::Stream(n) => {
                let _ = stream.write_all(b"HTTP/1.1 200 OK\r\ncontent-type: text/calendar\r\nconnection: close\r\n\r\n");
                let chunk = vec![b'X'; 64 * 1024];
                let mut sent = 0;
                while sent < n && stream.write_all(&chunk).is_ok() {
                    sent += chunk.len();
                }
            }
        }
    });
    (base, rx)
}

fn fast() -> Timeouts {
    Timeouts { connect: Duration::from_secs(2), total: Duration::from_millis(700) }
}

fn plan(url: String) -> FetchPlan {
    FetchPlan { source: SourceKind::IcsUrl, url, defaults: Defaults { importance: Importance::Medium, currency: Some("USD".into()) } }
}

const FEED: &str = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\n\
BEGIN:VEVENT\r\nUID:nfp\r\nDTSTART:20261002T123000Z\r\nSUMMARY:Non-Farm Payrolls\r\nPRIORITY:1\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nUID:ecb\r\nDTSTART;TZID=Europe/Paris:20261029T141500\r\nSUMMARY:BCE\r\nCATEGORIES:EUR\r\nEND:VEVENT\r\n\
END:VCALENDAR\r\n";

fn fetch(answer: Answer) -> (Result<Parsed, NewsError>, Option<Seen>) {
    let (base, seen) = fake_server(answer);
    let result = IcsUrl::for_tests(fast()).fetch(&plan(format!("{base}/eco.ics?week=this")));
    (result, seen.recv_timeout(Duration::from_secs(2)).ok())
}

#[test]
fn a_fetch_sends_only_the_documented_request_and_reads_the_feed() {
    let (result, seen) = fetch(Answer::Full(200, "", FEED.as_bytes().to_vec()));
    let parsed = result.unwrap();
    assert_eq!(parsed.events.len(), 2);
    assert_eq!((parsed.events[0].title.as_str(), parsed.events[0].importance, parsed.events[0].currency.as_str()), ("Non-Farm Payrolls", Importance::High, "USD"));
    assert_eq!((parsed.events[1].currency.as_str(), parsed.events[1].importance), ("EUR", Importance::Medium));

    let s = seen.unwrap();
    assert_eq!(s.request_line, "GET /eco.ics?week=this HTTP/1.1", "the address exactly as typed, nothing added");
    let mut names: Vec<&str> = s.headers.iter().map(|(n, _)| n.as_str()).collect();
    names.sort_unstable();
    assert_eq!(names, ["accept", "host", "user-agent"], "no cookie, no accept-encoding, nothing else");
    let get = |n: &str| s.headers.iter().find(|(k, _)| k == n).map(|(_, v)| v.as_str());
    assert_eq!((get("user-agent"), get("accept")), (Some("Pulse"), Some("text/calendar")));
    assert_eq!(s.body_len, 0);
}

#[test]
fn an_empty_or_corrupted_answer_is_an_error_never_a_panic() {
    assert_eq!(fetch(Answer::Full(200, "", Vec::new())).0.unwrap_err(), NewsError::Empty);
    assert_eq!(fetch(Answer::Full(200, "", b" \r\n ".to_vec())).0.unwrap_err(), NewsError::Empty);
    // The page Forex Factory is said to answer when its limit is exceeded, or any other HTML page.
    let html = b"<!DOCTYPE html><html><body>Request Denied</body></html>".to_vec();
    assert_eq!(fetch(Answer::Full(200, "", html)).0.unwrap_err(), NewsError::RequestDenied);
    let other = b"<!DOCTYPE html><html><body>Maintenance</body></html>".to_vec();
    assert_eq!(fetch(Answer::Full(200, "", other)).0.unwrap_err(), NewsError::UnexpectedResponse);
    assert_eq!(fetch(Answer::Full(200, "", vec![0xff, 0x00, 0xfe, 0x80])).0.unwrap_err(), NewsError::UnexpectedResponse);
    // A truncated feed: the complete events are kept, the cut one is counted.
    let cut = FEED.as_bytes()[..FEED.find("CATEGORIES").unwrap()].to_vec();
    let p = fetch(Answer::Full(200, "", cut)).0.unwrap();
    assert_eq!((p.events.len(), p.skipped_count), (1, 1));
    // Every prefix of a valid answer, read directly: an error or a result, never a panic.
    let pl = plan("https://x.example/a.ics".into());
    for n in 0..FEED.len() {
        let _ = read_body(&FEED.as_bytes()[..n], &pl);
    }
}

#[test]
fn a_too_large_answer_is_refused() {
    // Announced size beyond the limit.
    let big = vec![b'A'; MAX_RESPONSE_BYTES as usize + 1];
    assert_eq!(fetch(Answer::Full(200, "", big)).0.unwrap_err(), NewsError::TooLarge);
    // No announced size: reading stops at the limit.
    let (base, _seen) = fake_server(Answer::Stream(MAX_RESPONSE_BYTES as usize + 256 * 1024));
    let slow_enough = Timeouts { connect: Duration::from_secs(2), total: Duration::from_secs(10) };
    let err = IcsUrl::for_tests(slow_enough).fetch(&plan(format!("{base}/big.ics"))).unwrap_err();
    assert_eq!(err, NewsError::TooLarge);
}

#[test]
fn http_errors_become_translatable_codes() {
    for (status, expected) in [
        (400, NewsError::Rejected),
        (401, NewsError::Forbidden),
        (403, NewsError::Forbidden),
        (404, NewsError::NotFound),
        (429, NewsError::RateLimited),
        (500, NewsError::ServerError),
        (503, NewsError::ServerError),
    ] {
        let (result, seen) = fetch(Answer::Full(status, "", b"<html>error</html>".to_vec()));
        assert_eq!(result.unwrap_err(), expected, "status {status}");
        assert!(seen.is_some());
    }
    assert_eq!(NewsError::RateLimited.to_string(), "news:rateLimited");
}

#[test]
fn a_redirection_is_not_followed() {
    let (base, seen) = fake_server(Answer::Full(301, "location: http://127.0.0.1:9/elsewhere.ics\r\n", Vec::new()));
    let err = IcsUrl::for_tests(fast()).fetch(&plan(format!("{base}/a.ics"))).unwrap_err();
    assert_eq!(err, NewsError::Redirected);
    assert!(seen.recv().is_ok());
}

#[test]
fn a_silent_server_times_out_and_a_closed_port_is_offline() {
    let (result, _) = fetch(Answer::Silent);
    assert_eq!(result.unwrap_err(), NewsError::Timeout);
    let port = {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        l.local_addr().unwrap().port()
    };
    // Windows retries a refused local connection for about a second: a longer delay than `fast()`.
    let patient = Timeouts { connect: Duration::from_secs(5), total: Duration::from_secs(8) };
    let err = IcsUrl::for_tests(patient).fetch(&plan(format!("http://127.0.0.1:{port}/a.ics"))).unwrap_err();
    assert_eq!(err, NewsError::Offline);
}

#[test]
fn the_real_client_never_connects_in_plain_http() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let url = format!("http://{}/a.ics", listener.local_addr().unwrap());
    assert!(IcsUrl::new().fetch(&plan(url)).is_err());
    assert!(listener.accept().is_err(), "no connection was opened");
}

// --- Forex Factory (lot 28): same fake server, one answer per path, several connections ---

const THIS_WEEK: &str = include_str!("../../pulse-core/src/news/ff/ff_calendar_thisweek.sample.json");
const NEXT_WEEK: &str = include_str!("../../pulse-core/src/news/ff/ff_calendar_nextweek.sample.json");
const DENIED: &str = "<!DOCTYPE html>\n<html><head><title>Request Denied</title></head><body><h1>Request Denied</h1>\
<p>You've exceeded the limit for Calendar Export requests.</p></body></html>";

/// Answers each connection by its path (404 for an unknown path); returns what was asked, in order.
fn fake_site(routes: Vec<(&'static str, Answer)>) -> (String, mpsc::Receiver<Seen>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let mut routes = routes;
        for _ in 0..4 {
            let Ok((mut stream, _)) = listener.accept() else { return };
            let seen = read_request(&stream);
            let path = seen.request_line.split(' ').nth(1).unwrap_or("").to_owned();
            let _ = tx.send(seen);
            let answer = match routes.iter().position(|(p, _)| *p == path) {
                Some(i) => routes.remove(i).1,
                None => Answer::Full(404, "", b"<html>Not Found</html>".to_vec()),
            };
            match answer {
                Answer::Full(status, extra, body) => {
                    let head = format!("HTTP/1.1 {status} X\r\ncontent-type: application/json\r\n{extra}content-length: {}\r\nconnection: close\r\n\r\n", body.len());
                    let _ = stream.write_all(head.as_bytes());
                    let _ = stream.write_all(&body);
                }
                Answer::Silent => thread::sleep(Duration::from_secs(3)),
                Answer::Stream(n) => {
                    let _ = stream.write_all(b"HTTP/1.1 200 OK\r\ncontent-type: application/json\r\nconnection: close\r\n\r\n");
                    let chunk = vec![b' '; 64 * 1024];
                    let mut sent = 0;
                    while sent < n && stream.write_all(&chunk).is_ok() {
                        sent += chunk.len();
                    }
                }
            }
        }
    });
    (base, rx)
}

const THIS: &str = "/ff_calendar_thisweek.json";
const NEXT: &str = "/ff_calendar_nextweek.json";

fn ok(body: &str) -> Answer {
    Answer::Full(200, "", body.as_bytes().to_vec())
}

fn ff_fetch(routes: Vec<(&'static str, Answer)>, timeouts: Timeouts) -> (Result<Parsed, NewsError>, Vec<Seen>) {
    let (base, seen) = fake_site(routes);
    let plan = FetchPlan { source: SourceKind::ForexFactory, url: pulse_core::news::ff::THIS_WEEK_URL.into(), defaults: Defaults { importance: Importance::Medium, currency: None } };
    let result = ForexFactory::for_tests(&base, timeouts).fetch(&plan);
    thread::sleep(Duration::from_millis(50));
    (result, seen.try_iter().collect())
}

fn paths(seen: &[Seen]) -> Vec<String> {
    seen.iter().map(|s| s.request_line.clone()).collect()
}

#[test]
fn forex_factory_reads_both_weeks_with_only_the_documented_requests() {
    let (result, seen) = ff_fetch(vec![(THIS, ok(THIS_WEEK)), (NEXT, ok(NEXT_WEEK))], fast());
    let p = result.unwrap();
    assert_eq!((p.events.len(), p.partial.clone()), (16, None));
    let nfp = p.events.iter().find(|e| e.title == "Non-Farm Employment Change").unwrap();
    assert_eq!((pulse_core::news::zones::paris_hhmm(nfp.starts_at.unwrap()), nfp.day.as_str(), nfp.importance), ("14:30".to_string(), "2026-10-02", Importance::High));
    assert_eq!(paths(&seen), [format!("GET {THIS} HTTP/1.1"), format!("GET {NEXT} HTTP/1.1")], "current week first, two requests, nothing added");
    for s in &seen {
        let mut names: Vec<&str> = s.headers.iter().map(|(n, _)| n.as_str()).collect();
        names.sort_unstable();
        assert_eq!(names, ["accept", "host", "user-agent"], "no cookie, no accept-encoding, no identifier");
        let get = |n: &str| s.headers.iter().find(|(k, _)| k == n).map(|(_, v)| v.as_str());
        assert_eq!((get("user-agent"), get("accept")), (Some("Pulse"), Some("application/json")));
        assert_eq!(s.body_len, 0);
    }
}

#[test]
fn a_missing_or_refused_next_week_keeps_the_current_one() {
    let (result, seen) = ff_fetch(vec![(THIS, ok(THIS_WEEK))], fast());
    let p = result.unwrap();
    assert_eq!((p.events.len(), p.partial.as_deref()), (12, Some("news:notFound")));
    assert_eq!(seen.len(), 2);
    let (result, _) = ff_fetch(vec![(THIS, ok(THIS_WEEK)), (NEXT, ok(DENIED))], fast());
    assert_eq!(result.unwrap().partial.as_deref(), Some("news:requestDenied"));
    // An empty next week (not published yet) is fine.
    let (result, _) = ff_fetch(vec![(THIS, ok(THIS_WEEK)), (NEXT, ok("[]"))], fast());
    let p = result.unwrap();
    assert_eq!((p.events.len(), p.partial), (12, None));
}

#[test]
fn a_failed_current_week_is_a_precise_error_and_the_next_week_is_not_asked() {
    let big = format!("[{}]", " ".repeat(MAX_RESPONSE_BYTES as usize));
    let fields_missing = r#"[{"name":"NFP","currency":"USD","when":"2026-10-02T08:30:00-04:00"}]"#;
    let cases: Vec<(Answer, NewsError)> = vec![
        (ok(""), NewsError::Empty),
        (ok("[]"), NewsError::Empty),
        (ok(DENIED), NewsError::RequestDenied),
        (Answer::Full(403, "", DENIED.as_bytes().to_vec()), NewsError::RequestDenied),
        (Answer::Full(429, "", b"Too Many Requests".to_vec()), NewsError::RateLimited),
        (ok("<html><body>Oops</body></html>"), NewsError::UnexpectedResponse),
        (ok(&THIS_WEEK[..THIS_WEEK.len() / 2]), NewsError::InvalidJson),
        (ok(r#"{"error":"gone"}"#), NewsError::UnexpectedJson),
        (ok(fields_missing), NewsError::UnexpectedJson),
        (Answer::Full(200, "", big.into_bytes()), NewsError::TooLarge),
        (Answer::Full(400, "", Vec::new()), NewsError::Rejected),
        (Answer::Full(403, "", b"<html>Forbidden</html>".to_vec()), NewsError::Forbidden),
        (Answer::Full(404, "", Vec::new()), NewsError::NotFound),
        (Answer::Full(500, "", Vec::new()), NewsError::ServerError),
        (Answer::Full(503, "", Vec::new()), NewsError::ServerError),
    ];
    for (answer, expected) in cases {
        let (result, seen) = ff_fetch(vec![(THIS, answer), (NEXT, ok(NEXT_WEEK))], fast());
        assert_eq!(result.unwrap_err(), expected);
        assert_eq!(paths(&seen), [format!("GET {THIS} HTTP/1.1")], "{expected:?}: one request only");
    }
    assert_eq!(NewsError::RequestDenied.to_string(), "news:requestDenied");
}

#[test]
fn forex_factory_bounds_size_time_and_redirections() {
    // No announced size: reading stops at the limit.
    let slow_enough = Timeouts { connect: Duration::from_secs(2), total: Duration::from_secs(10) };
    let (result, _) = ff_fetch(vec![(THIS, Answer::Stream(MAX_RESPONSE_BYTES as usize + 256 * 1024))], slow_enough);
    assert_eq!(result.unwrap_err(), NewsError::TooLarge);
    let (result, _) = ff_fetch(vec![(THIS, Answer::Silent)], fast());
    assert_eq!(result.unwrap_err(), NewsError::Timeout);
    // A redirection to another domain is refused, never followed.
    let (result, seen) = ff_fetch(vec![(THIS, Answer::Full(302, "location: https://elsewhere.example/ff.json\r\n", Vec::new()))], fast());
    assert_eq!(result.unwrap_err(), NewsError::Redirected);
    assert_eq!(seen.len(), 1);
    // The real provider asks only the two documented HTTPS addresses.
    assert!(pulse_core::news::ff::THIS_WEEK_URL.starts_with("https://nfs.faireconomy.media/"));
    assert!(pulse_core::news::ff::NEXT_WEEK_URL.starts_with("https://nfs.faireconomy.media/"));
    assert!(provider(SourceKind::None).is_none());
    assert_eq!(provider(SourceKind::ForexFactory).unwrap().id(), "forexFactory");
}

#[test]
fn the_same_event_twice_is_kept_once_across_the_two_weeks() {
    let twice = THIS_WEEK.replacen("[\n", "[\n{\"title\":\"Non-Farm Employment Change\",\"country\":\"USD\",\"date\":\"2026-10-02T08:30:00-04:00\",\"impact\":\"High\"},\n", 1);
    let next = NEXT_WEEK.replacen("[\n", "[\n{\"title\":\"Non-Farm Employment Change\",\"country\":\"USD\",\"date\":\"2026-10-02T12:30:00Z\",\"impact\":\"High\"},\n", 1);
    let (result, _) = ff_fetch(vec![(THIS, ok(&twice)), (NEXT, ok(&next))], fast());
    let p = result.unwrap();
    assert_eq!(p.events.iter().filter(|e| e.title == "Non-Farm Employment Change").count(), 1);
    assert_eq!(p.events.len(), 16);
}
