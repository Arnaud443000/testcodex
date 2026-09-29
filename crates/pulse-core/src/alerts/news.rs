//! Alert 3.6.8: a trade taken during a major economic news, raised **only** when the trader's
//! own history shows that trades taken during news did worse (see CLAUDE.md, "Calendrier
//! économique (lot 25)"). Pure: the events come already read from the calendar.

use super::{Alert, AlertDetail, Severity, as_of, local_day};
use crate::behavior::EXPECTANCY_GAP_R;
use crate::error::Result;
use crate::instruments::AssetClass;
use crate::news::zones::paris_hhmm;
use crate::news::{NewsSettings, pair_currencies};
use crate::stats::summary::analyze;
use crate::stats::{Closed, Ledger, TradeFacts, replay};
use crate::tags::TagKind;
use serde::Serialize;

/// Trades with an R needed on each side before comparing (same sample as the lot-19 highlights).
pub const NEWS_MIN_R_TRADES: usize = 10;
/// The news side must be at least this much lower, in R (lots 8 bis and 19).
pub const NEWS_GAP_R: f64 = EXPECTANCY_GAP_R;
/// Events listed in one alert.
pub const MAX_LISTED_EVENTS: usize = 5;
const MIN_MS: i64 = 60_000;
const EPSILON: f64 = 1e-9;

/// Names (compared lower case, trimmed) of the manual market condition "economic news" (3.1.6):
/// the starter tag after v3, and its v2 name if it was never renamed.
pub const NEWS_TAG_NAMES: [&str; 2] = ["actualité économique", "economic news"];

/// A high-importance calendar event with a time.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewsEvent {
    pub id: i64,
    pub starts_at: i64,
    /// "" = not given (concerns every instrument).
    pub currency: String,
    pub title: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewsEventRef {
    pub event_id: i64,
    pub title: String,
    pub currency: String,
    pub starts_at: i64,
    /// Paris clock time "HH:MM".
    pub paris_time: String,
}

/// The comparison that allowed the alert: trades taken during news against the others.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewsComparison {
    pub news_trade_count: usize,
    pub news_r_trade_count: usize,
    pub news_expectancy_r: f64,
    pub other_trade_count: usize,
    pub other_r_trade_count: usize,
    pub other_expectancy_r: f64,
    /// news − others, in R (≤ −0.25 when the alert shows).
    pub difference: f64,
    /// News-side trades found by the calendar window, by the manual tag, by both.
    pub by_calendar: usize,
    pub by_tag: usize,
    pub by_both: usize,
}

/// Whether an event concerns the instrument: a forex pair only cares about its two currencies;
/// for any other class the instrument's currency is unknown, so every event counts. An event
/// without currency counts for every instrument.
fn concerns(t: &TradeFacts, e: &NewsEvent) -> bool {
    if e.currency.is_empty() {
        return true;
    }
    match (t.asset_class, pair_currencies(&t.symbol)) {
        (AssetClass::Forex, Some(pair)) => pair.iter().any(|c| c.eq_ignore_ascii_case(&e.currency)),
        _ => true,
    }
}

/// The events whose window contains the trade's entry, in time order.
fn in_window<'e>(t: &TradeFacts, events: &'e [NewsEvent], s: &NewsSettings) -> Vec<&'e NewsEvent> {
    let before = i64::from(s.window_before_min) * MIN_MS;
    let after = i64::from(s.window_after_min) * MIN_MS;
    events.iter().filter(|e| e.starts_at - before <= t.entry_time && t.entry_time <= e.starts_at + after && concerns(t, e)).collect()
}

fn tagged(t: &TradeFacts) -> bool {
    t.tags.iter().any(|g| g.kind == TagKind::MarketCondition && NEWS_TAG_NAMES.contains(&g.name.trim().to_lowercase().as_str()))
}

/// Compares the closed trades of the account, except `skip`: `None` unless both sides have
/// enough trades with an R and the news side is lower by at least [`NEWS_GAP_R`].
fn compare(closed: &[&Closed], skip: i64, events: &[NewsEvent], s: &NewsSettings) -> Result<Option<NewsComparison>> {
    let (mut news, mut others) = (Vec::new(), Vec::new());
    let (mut by_calendar, mut by_tag, mut by_both) = (0, 0, 0);
    for c in closed.iter().copied().filter(|c| c.facts.id != skip) {
        let cal = !in_window(c.facts, events, s).is_empty();
        let tag = tagged(c.facts);
        match (cal, tag) {
            (true, true) => by_both += 1,
            (true, false) => by_calendar += 1,
            (false, true) => by_tag += 1,
            (false, false) => {}
        }
        if cal || tag { news.push(c) } else { others.push(c) }
    }
    let (n, o) = (analyze(&news, 0.0)?.summary, analyze(&others, 0.0)?.summary);
    if n.r_trade_count < NEWS_MIN_R_TRADES || o.r_trade_count < NEWS_MIN_R_TRADES {
        return Ok(None);
    }
    let (Some(ne), Some(oe)) = (n.expectancy_r, o.expectancy_r) else { return Ok(None) };
    let difference = ne - oe;
    if difference > -NEWS_GAP_R + EPSILON {
        return Ok(None);
    }
    Ok(Some(NewsComparison {
        news_trade_count: n.trade_count,
        news_r_trade_count: n.r_trade_count,
        news_expectancy_r: ne,
        other_trade_count: o.trade_count,
        other_r_trade_count: o.r_trade_count,
        other_expectancy_r: oe,
        difference,
        by_calendar,
        by_tag,
        by_both,
    }))
}

/// Alerts 3.6.8 active at `now` for every account of the ledger, each on its own. Nothing when
/// the calendar or the alert is off. `events`: high-importance events with a time, any date.
pub fn evaluate(ledger: &Ledger, events: &[NewsEvent], now: i64, tz_offset_min: i32, s: &NewsSettings) -> Result<Vec<Alert>> {
    if !s.enabled || !s.alert || events.is_empty() {
        return Ok(Vec::new());
    }
    let ledger = as_of(ledger, now);
    let replay = replay(&ledger)?;
    let today = local_day(now, tz_offset_min);
    let mut out = Vec::new();
    for account in &ledger.accounts {
        let acc = account.id;
        let closed: Vec<&Closed> = replay.closed.iter().filter(|c| c.facts.account_id == acc).collect();
        let mut entered: Vec<&TradeFacts> =
            ledger.trades.iter().filter(|t| t.account_id == acc && local_day(t.entry_time, t.tz_offset_min) == today).collect();
        entered.sort_by_key(|t| (t.entry_time, t.id));
        for t in entered {
            let found = in_window(t, events, s);
            if found.is_empty() {
                continue;
            }
            let Some(comparison) = compare(&closed, t.id, events, s)? else { continue };
            let refs = found
                .iter()
                .take(MAX_LISTED_EVENTS)
                .map(|e| NewsEventRef {
                    event_id: e.id,
                    title: e.title.clone(),
                    currency: e.currency.clone(),
                    starts_at: e.starts_at,
                    paris_time: paris_hhmm(e.starts_at),
                })
                .collect();
            let detail = AlertDetail::NewsTrade {
                events: refs,
                event_count: found.len(),
                window_before_min: s.window_before_min,
                window_after_min: s.window_after_min,
                comparison,
            };
            out.push(Alert {
                id: format!("newsTrade:{acc}:{}", t.id),
                account_id: acc,
                severity: Severity::Warning,
                message_key: "newsTrade",
                at: t.entry_time,
                trade_id: Some(t.id),
                detail,
            });
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests;
