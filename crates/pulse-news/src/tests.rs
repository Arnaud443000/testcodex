//! Tests against a fake local server (plain HTTP on 127.0.0.1): no real calendar is ever called.

use super::*;
use pulse_core::news::{Defaults, Importance};
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
    FetchPlan { url, defaults: Defaults { importance: Importance::Medium, currency: Some("USD".into()) } }
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
    assert_eq!(fetch(Answer::Full(200, "", html)).0.unwrap_err(), NewsError::UnexpectedResponse);
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
