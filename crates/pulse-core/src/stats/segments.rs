//! Performance by segment (spec 3.3.9) and long vs short (3.3.10).

use super::summary::{Summary, analyze};
use super::{Closed, time};
use crate::error::Result;
use crate::tags::TagKind;
use crate::trades::EmotionMoment;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

/// How to split trades. Weekday and hour use the local **entry** time (when
/// the decision was taken); a trade with several tags of one kind (mistakes)
/// counts in each of them; trades without a tag of the kind go to "none".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", tag = "by", content = "kind")]
pub enum SegmentBy {
    Instrument,
    AssetClass,
    Direction,
    Weekday,
    Hour,
    ExecutionType,
    Tag(TagKind),
    /// Declared plan compliance (spec 3.4.4): "yes", "partial", "no", or "none".
    PlanFollowed,
    /// Declared emotion (spec 3.4.2) at one moment, or at any moment when `None`
    /// (a trade then counts once per emotion, even if declared twice).
    Emotion(Option<EmotionMoment>),
    /// First trade of the local entry day on its account vs the next ones (spec 3.4.10): "first", "subsequent".
    FirstOfDay,
    /// Rank in the local entry day: "1", "2", "3", "4+".
    DayRank,
    /// Each personal rule the trade broke (spec 3.4.7); "none" when it broke none.
    RuleBroken,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    /// Stable key: instrument/tag id, "long", "1" (Monday), "09" (hour), or "none".
    pub key: String,
    pub label: String,
    pub summary: Summary,
}

const NONE: &str = "none";

pub(crate) fn split(set: &[&Closed], by: SegmentBy, risk_free_daily: f64) -> Result<Vec<Segment>> {
    groups(set, by)
        .into_iter()
        .map(|g| Ok(Segment { key: g.key, label: g.label, summary: analyze(&g.trades, risk_free_daily)?.summary }))
        .collect()
}

/// Trades of one segment, still in exit order.
pub(crate) struct Group<'s, 'a> {
    pub key: String,
    pub label: String,
    pub trades: Vec<&'s Closed<'a>>,
}

/// The trades of each segment, in display order ("none" last).
pub(crate) fn groups<'s, 'a>(set: &[&'s Closed<'a>], by: SegmentBy) -> Vec<Group<'s, 'a>> {
    // Sort key → group. "none" sorts last.
    let mut groups: BTreeMap<(bool, String), Group<'s, 'a>> = BTreeMap::new();
    for &c in set {
        for (sort, key, label) in keys(c, by) {
            let is_none = key == NONE;
            groups.entry((is_none, sort)).or_insert_with(|| Group { key, label, trades: Vec::new() }).trades.push(c);
        }
    }
    groups.into_values().collect()
}

/// (sort key, key, label) of every segment the trade belongs to.
fn keys(c: &Closed, by: SegmentBy) -> Vec<(String, String, String)> {
    let t = c.facts;
    let one = |sort: String, key: String, label: String| vec![(sort, key, label)];
    let none = || vec![(String::new(), NONE.to_string(), "None".to_string())];
    match by {
        SegmentBy::Instrument => one(t.symbol.to_uppercase(), t.instrument_id.to_string(), t.symbol.clone()),
        SegmentBy::AssetClass => {
            let s = t.asset_class.as_str().to_string();
            one(s.clone(), s.clone(), capitalize(&s))
        }
        SegmentBy::Direction => {
            let s = t.position.direction.as_str().to_string();
            one(s.clone(), s.clone(), capitalize(&s))
        }
        SegmentBy::Weekday => {
            let d = time::weekday(t.entry_time, t.tz_offset_min);
            one(d.to_string(), d.to_string(), time::weekday_name(d).to_string())
        }
        SegmentBy::Hour => {
            let h = format!("{:02}", time::hour(t.entry_time, t.tz_offset_min));
            one(h.clone(), h.clone(), format!("{h}:00"))
        }
        SegmentBy::ExecutionType => match t.execution_type {
            Some(e) => one(e.as_str().into(), e.as_str().into(), capitalize(e.as_str())),
            None => none(),
        },
        SegmentBy::Tag(kind) => {
            let tags: Vec<_> = t
                .tags
                .iter()
                .filter(|g| g.kind == kind)
                .map(|g| (g.name.to_lowercase(), g.id.to_string(), g.name.clone()))
                .collect();
            if tags.is_empty() { none() } else { tags }
        }
        SegmentBy::PlanFollowed => match t.journal.plan_followed {
            Some(p) => one(p.as_str().into(), p.as_str().into(), capitalize(p.as_str())),
            None => none(),
        },
        SegmentBy::Emotion(moment) => {
            let mut seen = Vec::new();
            let mut emotions = Vec::new();
            for (m, g) in &t.journal.emotions {
                if moment.is_none_or(|wanted| wanted == *m) && !seen.contains(&g.id) {
                    seen.push(g.id);
                    emotions.push((g.name.to_lowercase(), g.id.to_string(), g.name.clone()));
                }
            }
            if emotions.is_empty() { none() } else { emotions }
        }
        SegmentBy::FirstOfDay => match c.day_rank {
            1 => one("0".into(), "first".into(), "First trade of the day".into()),
            _ => one("1".into(), "subsequent".into(), "Subsequent trades".into()),
        },
        SegmentBy::DayRank => {
            let k = if c.day_rank >= 4 { "4+".to_string() } else { c.day_rank.to_string() };
            one(k.clone(), k.clone(), k)
        }
        SegmentBy::RuleBroken => {
            let broken: Vec<_> = t
                .journal
                .rule_checks
                .iter()
                .filter(|r| !r.respected)
                .map(|r| (r.text.to_lowercase(), r.rule_id.to_string(), r.text.clone()))
                .collect();
            if broken.is_empty() { none() } else { broken }
        }
    }
}

fn capitalize(s: &str) -> String {
    let mut c = s.chars();
    c.next().map(|f| f.to_uppercase().chain(c).collect()).unwrap_or_default()
}
