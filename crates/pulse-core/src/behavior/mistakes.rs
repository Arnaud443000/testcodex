//! Recurring mistakes (spec 3.4.7, 3.4.8) and rule adherence (3.4.6).

use crate::error::Result;
use crate::money::Decimal;
use crate::rules::{self, Rule};
use crate::stats::segments::{SegmentBy, groups};
use crate::stats::summary::analyze;
use crate::stats::{Closed, Ledger, StatsQuery, load, replay, time};
use crate::tags::TagKind;
use rusqlite::Connection;
use serde::Serialize;
use std::cmp::Reverse;
use std::collections::BTreeMap;

// --- Recurring mistakes (3.4.7, 3.4.8) -------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MistakeSource {
    /// A mistake tag set on the trade.
    Tag,
    /// A personal rule ticked as not respected.
    Rule,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Mistake {
    pub source: MistakeSource,
    /// Tag id or rule id.
    pub id: i64,
    /// Tag name or rule text.
    pub label: String,
    pub trade_count: usize,
    /// Share of the period's closed trades.
    pub share: Option<f64>,
    pub net_pnl: Decimal,
    /// Sum of the losses of these trades, as a positive amount.
    pub cost: Decimal,
    pub expectancy_r: Option<f64>,
    /// The trades concerned, in exit order (clickable counter).
    pub trade_ids: Vec<i64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MistakeReport {
    pub trade_count: usize,
    /// Closed trades with at least one mistake tag or broken rule.
    pub trades_with_mistake: usize,
    /// Most frequent first (ties: highest cost, then label).
    pub by_count: Vec<Mistake>,
    /// Most expensive first (ties: most frequent, then label).
    pub by_cost: Vec<Mistake>,
}

pub fn mistakes(ledger: &Ledger, query: &StatsQuery) -> Result<MistakeReport> {
    let r = replay(ledger)?;
    let set = r.selected(query);
    let mut list = Vec::new();
    for (by, source) in [(SegmentBy::Tag(TagKind::Mistake), MistakeSource::Tag), (SegmentBy::RuleBroken, MistakeSource::Rule)] {
        for g in groups(&set, by).into_iter().filter(|g| g.key != "none") {
            let s = analyze(&g.trades, query.risk_free_daily)?.summary;
            list.push(Mistake {
                source,
                id: g.key.parse().unwrap_or_default(),
                label: g.label,
                trade_count: s.trade_count,
                share: (!set.is_empty()).then(|| s.trade_count as f64 / set.len() as f64),
                net_pnl: s.net_pnl,
                cost: s.total_losses,
                expectancy_r: s.expectancy_r,
                trade_ids: g.trades.iter().map(|c| c.facts.id).collect(),
            });
        }
    }
    let with_mistake = |c: &&&Closed| {
        c.facts.tags.iter().any(|t| t.kind == TagKind::Mistake) || c.facts.journal.rule_checks.iter().any(|r| !r.respected)
    };
    let trades_with_mistake = set.iter().filter(with_mistake).count();
    let mut by_count = list.clone();
    by_count.sort_by(|a, b| (Reverse(a.trade_count), Reverse(a.cost), &a.label).cmp(&(Reverse(b.trade_count), Reverse(b.cost), &b.label)));
    let mut by_cost = list;
    by_cost.sort_by(|a, b| (Reverse(a.cost), Reverse(a.trade_count), &a.label).cmp(&(Reverse(b.cost), Reverse(b.trade_count), &b.label)));
    Ok(MistakeReport { trade_count: set.len(), trades_with_mistake, by_count, by_cost })
}

pub fn mistake_report(conn: &Connection, query: &StatsQuery) -> Result<MistakeReport> {
    mistakes(&load(conn, &query.account_ids)?, query)
}

// --- Rule adherence (3.4.6) --------------------------------------------------------

/// Below this many checks, a rule has no trend.
pub const MIN_CHECKS_FOR_TREND: usize = 4;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonthAdherence {
    /// Local exit month "YYYY-MM".
    pub month: String,
    pub checks: usize,
    pub respected: usize,
    pub rate: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleAdherence {
    pub rule_id: i64,
    pub text: String,
    pub archived: bool,
    /// Times the rule was ticked (respected or not) on the period's trades.
    pub checks: usize,
    pub respected: usize,
    pub rate: Option<f64>,
    /// Rate of the newer half of the checks − rate of the older half
    /// (+0.25 = 25 points better); `None` below [`MIN_CHECKS_FOR_TREND`] checks.
    pub trend: Option<f64>,
    pub monthly: Vec<MonthAdherence>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleAdherenceReport {
    /// All rules together.
    pub checks: usize,
    pub respected: usize,
    pub rate: Option<f64>,
    pub trades_with_checks: usize,
    /// Active rules (even never ticked), then archived rules ticked in the period; in list order.
    pub rules: Vec<RuleAdherence>,
}

fn rate(respected: usize, checks: usize) -> Option<f64> {
    (checks > 0).then(|| respected as f64 / checks as f64)
}

/// `rules` is the rule list, archived ones included, in display order.
pub fn rule_adherence(ledger: &Ledger, query: &StatsQuery, rules: &[Rule]) -> Result<RuleAdherenceReport> {
    let r = replay(ledger)?;
    let set = r.selected(query);
    let mut out = Vec::new();
    for rule in rules {
        // (local exit month, respected) of each check, in exit order.
        let checks: Vec<(String, bool)> = set
            .iter()
            .flat_map(|c| {
                c.facts
                    .journal
                    .rule_checks
                    .iter()
                    .filter(|k| k.rule_id == rule.id)
                    .map(|k| (time::day_key(c.exit_time, c.facts.tz_offset_min)[..7].to_string(), k.respected))
            })
            .collect();
        if rule.archived && checks.is_empty() {
            continue;
        }
        let respected = checks.iter().filter(|(_, ok)| *ok).count();
        let half = checks.len() / 2;
        let count = |part: &[(String, bool)]| part.iter().filter(|(_, ok)| *ok).count();
        let trend = (checks.len() >= MIN_CHECKS_FOR_TREND)
            .then(|| count(&checks[checks.len() - half..]) as f64 / half as f64 - count(&checks[..half]) as f64 / half as f64);
        let mut months: BTreeMap<&str, (usize, usize)> = BTreeMap::new();
        for (month, ok) in &checks {
            let m = months.entry(month).or_default();
            m.0 += 1;
            m.1 += usize::from(*ok);
        }
        out.push(RuleAdherence {
            rule_id: rule.id,
            text: rule.text.clone(),
            archived: rule.archived,
            checks: checks.len(),
            respected,
            rate: rate(respected, checks.len()),
            trend,
            monthly: months
                .into_iter()
                .map(|(month, (checks, respected))| MonthAdherence { month: month.into(), checks, respected, rate: rate(respected, checks) })
                .collect(),
        });
    }
    let all = set.iter().flat_map(|c| c.facts.journal.rule_checks.iter());
    let (checks, respected) = all.fold((0, 0), |(n, ok), k| (n + 1, ok + usize::from(k.respected)));
    Ok(RuleAdherenceReport {
        checks,
        respected,
        rate: rate(respected, checks),
        trades_with_checks: set.iter().filter(|c| !c.facts.journal.rule_checks.is_empty()).count(),
        rules: out,
    })
}

pub fn rule_adherence_report(conn: &Connection, query: &StatsQuery) -> Result<RuleAdherenceReport> {
    rule_adherence(&load(conn, &query.account_ids)?, query, &rules::list(conn, true)?)
}
