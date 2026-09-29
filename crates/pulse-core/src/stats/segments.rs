//! Performance by segment (spec 3.3.9) and long vs short (3.3.10).

use super::summary::{Summary, analyze};
use super::{Closed, time};
use crate::error::Result;
use crate::tags::TagKind;
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
    // Sort key → (key, label, trades). "none" sorts last.
    let mut groups: BTreeMap<(bool, String), (String, String, Vec<&Closed>)> = BTreeMap::new();
    for &c in set {
        for (sort, key, label) in keys(c, by) {
            let is_none = key == NONE;
            groups.entry((is_none, sort)).or_insert_with(|| (key, label, Vec::new())).2.push(c);
        }
    }
    groups
        .into_values()
        .map(|(key, label, trades)| Ok(Segment { key, label, summary: analyze(&trades, risk_free_daily)?.summary }))
        .collect()
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
    }
}

fn capitalize(s: &str) -> String {
    let mut c = s.chars();
    c.next().map(|f| f.to_uppercase().chain(c).collect()).unwrap_or_default()
}
