//! Known-result tests of the 3.6.8 alert. Journal N, computed by hand:
//!
//! Account 1, EURUSD (forex), long, entry 100, stop 90 (risk 10), size 1, multiplier 1:
//! R = (exit − 100) / 10. "Today" is Tuesday 2026-09-29 (UTC, offset 0).
//! - 10 "news" trades, days 1 to 10 before Monday 28 (the 18th to the 27th), entered at 12:30 UTC,
//!   exactly at a high USD event (12:30), exit 95 → R = −0.5 each: expectancy −0.5 R.
//! - 10 "other" trades on the same days, entered at 08:00 UTC (4 h 30 before the event: outside
//!   the ±15 min window), exit 105 → R = +0.5 each: expectancy +0.5 R.
//! - Difference −0.5 − 0.5 = −1.0 R ≤ −0.25 R, both sides 10 trades with R: the condition holds.
//!   The candidate trade (entered today around a news) is never counted in the comparison.

use super::*;
use crate::money::Decimal;
use crate::stats::{AccountCapital, Journal, Position, TagRef};
use crate::test_support::dec;
use crate::trades::Direction;

const DAY: i64 = 86_400_000;
const HOUR: i64 = 3_600_000;
const MIN: i64 = 60_000;
/// Monday 2026-09-28 00:00 UTC.
const MON: i64 = 20_724 * DAY;
/// Tuesday 29 at 14:30 UTC: today's event.
const EVENT: i64 = MON + DAY + 14 * HOUR + 30 * MIN;

fn trade(id: i64, symbol: &str, class: AssetClass, entry: i64, exit: Option<(i64, &str)>) -> TradeFacts {
    TradeFacts {
        id,
        account_id: 1,
        instrument_id: 1,
        symbol: symbol.into(),
        asset_class: class,
        position: Position {
            direction: Direction::Long,
            size: Decimal::ONE,
            multiplier: Decimal::ONE,
            entry_price: dec("100"),
            exit_price: exit.map(|(_, p)| dec(p)),
            planned_sl: Some(dec("90")),
            planned_tp: None,
            fees: Decimal::ZERO,
        },
        entry_time: entry,
        exit_time: exit.map(|(t, _)| t),
        tz_offset_min: 0,
        execution_type: None,
        tags: Vec::new(),
        journal: Journal::default(),
    }
}

fn eur(id: i64, entry: i64, exit: Option<(i64, &str)>) -> TradeFacts {
    trade(id, "EURUSD", AssetClass::Forex, entry, exit)
}

fn event(id: i64, at: i64, currency: &str, title: &str) -> NewsEvent {
    NewsEvent { id, starts_at: at, currency: currency.into(), title: title.into() }
}

/// Journal N: (trades, events). `news_exit` / `other_exit` set the two sides' results; `news_count`
/// trades are taken during news (days 1… before Monday).
fn journal(news_count: i64, news_exit: &str, other_exit: &str) -> (Vec<TradeFacts>, Vec<NewsEvent>) {
    let (mut trades, mut events) = (Vec::new(), Vec::new());
    for k in 1..=10 {
        let day = MON - k * DAY;
        events.push(event(100 + k, day + 12 * HOUR + 30 * MIN, "USD", "CPI"));
        trades.push(eur(k, day + 8 * HOUR, Some((day + 9 * HOUR, other_exit))));
        if k <= news_count {
            trades.push(eur(20 + k, day + 12 * HOUR + 30 * MIN, Some((day + 13 * HOUR, news_exit))));
        }
    }
    events.push(event(1, EVENT, "USD", "CPI m/m"));
    (trades, events)
}

fn ledger(trades: Vec<TradeFacts>) -> Ledger {
    Ledger {
        currency: Some("USD".into()),
        initial_capital: dec("10000"),
        accounts: vec![AccountCapital { id: 1, initial_capital: dec("10000") }],
        capital_moves: Vec::new(),
        trades,
    }
}

fn on() -> NewsSettings {
    NewsSettings { enabled: true, ..NewsSettings::default() }
}

fn run(trades: Vec<TradeFacts>, events: &[NewsEvent], now: i64, s: &NewsSettings) -> Vec<Alert> {
    evaluate(&ledger(trades), events, now, 0, s).unwrap()
}

fn close(a: f64, b: f64) -> bool {
    (a - b).abs() < 1e-9
}

#[test]
fn a_trade_around_a_news_alerts_when_news_trades_did_worse() {
    let (mut trades, events) = journal(10, "95", "105");
    // Entered today at 14:25, 5 minutes before the 14:30 CPI; still open.
    trades.push(eur(99, EVENT - 5 * MIN, None));
    let alerts = run(trades, &events, EVENT - MIN, &on());
    assert_eq!(alerts.len(), 1);
    let a = &alerts[0];
    assert_eq!((a.id.as_str(), a.severity, a.message_key, a.at, a.trade_id), ("newsTrade:1:99", Severity::Warning, "newsTrade", EVENT - 5 * MIN, Some(99)));
    let AlertDetail::NewsTrade { events, event_count, window_before_min, window_after_min, comparison: c } = &a.detail else { panic!() };
    assert_eq!((*event_count, *window_before_min, *window_after_min), (1, 15, 15));
    assert_eq!((events[0].title.as_str(), events[0].currency.as_str(), events[0].paris_time.as_str()), ("CPI m/m", "USD", "16:30"));
    assert_eq!((c.news_trade_count, c.news_r_trade_count, c.other_trade_count, c.other_r_trade_count), (10, 10, 10, 10));
    assert!(close(c.news_expectancy_r, -0.5) && close(c.other_expectancy_r, 0.5) && close(c.difference, -1.0));
    assert_eq!((c.by_calendar, c.by_tag, c.by_both), (10, 0, 0));
}

#[test]
fn no_alert_when_news_trades_did_not_do_worse() {
    let candidate = || eur(99, EVENT, None);
    // Same results on both sides: difference 0.
    let (mut t, e) = journal(10, "105", "105");
    t.push(candidate());
    assert!(run(t, &e, EVENT, &on()).is_empty());
    // Better during news.
    let (mut t, e) = journal(10, "105", "95");
    t.push(candidate());
    assert!(run(t, &e, EVENT, &on()).is_empty());
    // −0.20 R (news 97.5 → −0.25 R; others 99.5 → −0.05 R): −0.25 − (−0.05) = −0.20, below the 0.25 R gap.
    let (mut t, e) = journal(10, "97.5", "99.5");
    t.push(candidate());
    assert!(run(t, &e, EVENT, &on()).is_empty());
    // Exactly −0.25 R (news 97.5 → −0.25; others 100 → 0 R, breakevens): the gap is reached.
    let (mut t, e) = journal(10, "97.5", "100");
    t.push(candidate());
    assert_eq!(run(t, &e, EVENT, &on()).len(), 1);
}

#[test]
fn no_alert_below_the_minimum_sample() {
    // 9 news trades only (the 10th day's trade missing): never an alert "by default".
    let (mut t, e) = journal(9, "95", "105");
    t.push(eur(99, EVENT, None));
    assert!(run(t, &e, EVENT, &on()).is_empty());
    // Trades without a stop have no R: 10 news trades, but one without R → 9.
    let (mut t, e) = journal(10, "95", "105");
    t.iter_mut().find(|x| x.id == 21).unwrap().position.planned_sl = None;
    t.push(eur(99, EVENT, None));
    assert!(run(t, &e, EVENT, &on()).is_empty());
}

#[test]
fn the_window_bounds_are_included_and_adjustable() {
    let (base, e) = journal(10, "95", "105");
    let with = |entry: i64, s: &NewsSettings| {
        let mut t = base.clone();
        t.push(eur(99, entry, None));
        run(t, &e, EVENT + HOUR, s).len()
    };
    assert_eq!(with(EVENT - 15 * MIN, &on()), 1, "15 min before: in");
    assert_eq!(with(EVENT - 16 * MIN, &on()), 0);
    assert_eq!(with(EVENT + 15 * MIN, &on()), 1, "15 min after: in");
    assert_eq!(with(EVENT + 16 * MIN, &on()), 0);
    let tight = NewsSettings { window_before_min: 0, window_after_min: 30, ..on() };
    assert_eq!(with(EVENT - MIN, &tight), 0);
    assert_eq!(with(EVENT + 30 * MIN, &tight), 1);
    // A trade entered before the news, which is still to come at `now`: the alert shows already.
    let mut t = base.clone();
    t.push(eur(99, EVENT - 10 * MIN, None));
    assert_eq!(run(t, &e, EVENT - 9 * MIN, &on()).len(), 1);
    // A trade entered yesterday around a news is history, not an alert.
    let mut t = base.clone();
    t.push(eur(99, MON + 12 * HOUR + 30 * MIN, None));
    let mut ev = e.clone();
    ev.push(event(2, MON + 12 * HOUR + 30 * MIN, "USD", "Hier"));
    assert!(run(t, &ev, EVENT, &on()).is_empty());
}

#[test]
fn simultaneous_events_make_one_alert_listing_them() {
    let (mut t, mut e) = journal(10, "95", "105");
    e.push(event(3, EVENT, "USD", "Retail Sales"));
    e.push(event(4, EVENT + 10 * MIN, "EUR", "BCE"));
    t.push(eur(99, EVENT + 5 * MIN, None));
    let alerts = run(t, &e, EVENT + HOUR, &on());
    assert_eq!(alerts.len(), 1);
    let AlertDetail::NewsTrade { events, event_count, .. } = &alerts[0].detail else { panic!() };
    assert_eq!(*event_count, 3);
    assert_eq!(events.iter().map(|x| x.title.as_str()).collect::<Vec<_>>(), ["CPI m/m", "Retail Sales", "BCE"]);
}

#[test]
fn a_forex_pair_only_cares_about_its_two_currencies() {
    let (base, mut e) = journal(10, "95", "105");
    // Today's only news is a JPY one.
    e.retain(|x| x.id != 1);
    e.push(event(5, EVENT, "JPY", "BoJ"));
    let mut t = base.clone();
    t.push(eur(99, EVENT, None));
    assert!(run(t, &e, EVENT, &on()).is_empty(), "EURUSD: a JPY news does not concern it");
    // An index: its currency is unknown, every news counts.
    let mut t = base.clone();
    t.push(trade(99, "US500", AssetClass::Index, EVENT, None));
    assert_eq!(run(t, &e, EVENT, &on()).len(), 1);
    // A news without currency counts for every instrument.
    e.push(event(6, EVENT, "", "G7"));
    let mut t = base.clone();
    t.push(eur(99, EVENT, None));
    assert_eq!(run(t, &e, EVENT, &on()).len(), 1);
    // Both currencies of the pair count: EUR.
    let mut e2 = e.clone();
    e2.retain(|x| x.id != 6);
    e2.push(event(7, EVENT, "EUR", "BCE"));
    let mut t = base;
    t.push(eur(99, EVENT, None));
    assert_eq!(run(t, &e2, EVENT, &on()).len(), 1);
}

#[test]
fn the_manual_news_condition_counts_in_the_comparison_only() {
    // 5 news trades found by the calendar, 5 older ones by the manual tag only (no event stored).
    let (mut t, mut e) = journal(10, "95", "105");
    let news_tag = TagRef { id: 50, kind: TagKind::MarketCondition, name: " Actualité Économique ".into() };
    for x in t.iter_mut().filter(|x| (26..=30).contains(&x.id)) {
        x.tags.push(news_tag.clone());
    }
    e.retain(|x| !(106..=110).contains(&x.id));
    // One trade has both.
    t.iter_mut().find(|x| x.id == 21).unwrap().tags.push(news_tag.clone());
    t.push(eur(99, EVENT, None));
    let alerts = run(t.clone(), &e, EVENT, &on());
    let AlertDetail::NewsTrade { comparison: c, .. } = &alerts[0].detail else { panic!() };
    assert_eq!((c.by_calendar, c.by_tag, c.by_both, c.news_r_trade_count), (4, 5, 1, 10));
    // Tagged today but no calendar event around it: no alert (the calendar confirms the news).
    let mut t2 = t.clone();
    t2.retain(|x| x.id != 99);
    let mut tagged = eur(99, EVENT + 3 * HOUR, None);
    tagged.tags.push(news_tag);
    t2.push(tagged);
    assert!(run(t2, &e, EVENT + 3 * HOUR, &on()).is_empty());
}

#[test]
fn the_candidate_is_not_in_its_own_comparison_and_nothing_when_off() {
    // With only 9 news trades in history, a closed candidate during a news must not make it 10.
    let (mut t, e) = journal(9, "95", "105");
    t.push(eur(99, EVENT, Some((EVENT + 10 * MIN, "95"))));
    assert!(run(t, &e, EVENT + HOUR, &on()).is_empty());

    let (mut t, e) = journal(10, "95", "105");
    t.push(eur(99, EVENT, None));
    assert!(run(t.clone(), &e, EVENT, &NewsSettings::default()).is_empty(), "calendar off (default)");
    assert!(run(t.clone(), &e, EVENT, &NewsSettings { alert: false, ..on() }).is_empty(), "alert off");
    assert!(run(t, &[], EVENT, &on()).is_empty(), "no event stored");
}

/// Through SQLite: file import, trades, `active_alerts` (history, dismissal), lot-12 alerts unchanged.
#[test]
fn active_alerts_include_the_news_alert_from_stored_events() {
    use crate::news::settings::{self as ns, FileFormat, import_file};
    use crate::news::{Defaults, Importance};
    use crate::test_support::{account, instrument};
    use crate::trades::{self, TradeData};
    use crate::{alerts, db};

    let conn = db::open_in_memory().unwrap();
    ns::set(&conn, &on()).unwrap();
    let a = account(&conn, "10000");
    let eu = instrument(&conn, "EURUSD", "1");
    let add = |entry: i64, exit: Option<(i64, &str)>| {
        let mut d = TradeData::new(a, eu, Direction::Long, dec("1"), dec("100"), entry);
        d.planned_sl = Some(dec("90"));
        if let Some((t, p)) = exit {
            d.exit_time = Some(t);
            d.exit_price = Some(dec(p));
        }
        trades::create(&conn, &d).unwrap().id
    };
    // Journal N in Paris time (summer, UTC+2): the 12:30 UTC events are at 14:30 in Paris.
    let mut csv = String::from("date;heure;devise;titre;importance;prevu;precedent;reel\n");
    for k in 1..=10 {
        let day = MON - k * DAY;
        csv.push_str(&format!("{};14:30;USD;CPI;forte\n", crate::news::zones::paris_day(day + 12 * HOUR)));
        add(day + 8 * HOUR, Some((day + 9 * HOUR, "105")));
        add(day + 12 * HOUR + 30 * MIN, Some((day + 13 * HOUR, "95")));
    }
    csv.push_str("2026-09-29;16:30;USD;CPI m/m;forte\n2026-09-29;;USD;Sans heure;forte\n2026-09-29;17:00;USD;Moyenne;moyenne\n");
    let s = import_file(&conn, FileFormat::Csv, csv.as_bytes(), &Defaults { importance: Importance::Medium, currency: None }, EVENT - DAY).unwrap();
    assert_eq!((s.added, s.skipped_count), (13, 0));

    let candidate = add(EVENT - 5 * MIN, None);
    let all = alerts::active_alerts(&conn, &[], EVENT, 0).unwrap();
    // Lot-12 alerts still come first and unchanged (here: an unusual session, 20 trades of history
    // all in another session); the news alert follows.
    assert_eq!(all.iter().map(|x| x.id.as_str()).collect::<Vec<_>>(), [format!("unusualSession:{a}:{candidate}"), format!("newsTrade:{a}:{candidate}")]);
    let found: Vec<_> = all.into_iter().filter(|x| x.message_key == "newsTrade").collect();
    let h = alerts::history(&conn, &[], 10).unwrap();
    assert_eq!((h[0].kind.as_str(), h[0].alert["comparison"]["newsRTradeCount"].as_u64()), ("newsTrade", Some(10)));
    alerts::dismiss(&conn, &found[0].id, EVENT).unwrap();
    assert!(alerts::active_alerts(&conn, &[], EVENT + MIN, 0).unwrap().iter().all(|x| x.message_key != "newsTrade"));

    // An entry around the event without time or the medium one: no alert.
    let other = add(EVENT + 30 * MIN + 2 * MIN, None);
    assert!(alerts::active_alerts(&conn, &[], EVENT + HOUR, 0).unwrap().iter().all(|x| x.id != format!("newsTrade:{a}:{other}")));
    // Calendar off: nothing, events kept.
    ns::set(&conn, &NewsSettings::default()).unwrap();
    add(EVENT + MIN, None);
    assert!(alerts::active_alerts(&conn, &[], EVENT + HOUR, 0).unwrap().iter().all(|x| x.message_key != "newsTrade"));
    assert_eq!(crate::news::store::count(&conn).unwrap(), 13);
}
