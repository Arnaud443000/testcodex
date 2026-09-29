//! Best and weakest segment (spec 3.5.2): the setups and sessions of the
//! lot-3 segments whose expectancy in R stands out from the whole window.

use super::{Dimension, EPSILON, EvidenceFilter, Insight, InsightDetail, Priority, Scope, SegmentHighlight, Source};
use crate::behavior::EXPECTANCY_GAP_R;
use crate::error::Result;
use crate::stats::segments::{SegmentBy, groups};
use crate::stats::summary::{Summary, analyze};
use crate::stats::replay;
use crate::tags::TagKind;

/// Trades with an R a segment needs before it can be called best or weakest.
pub const SEGMENT_MIN_R_TRADES: usize = 10;
/// Gap in R with the whole window (the lot 8 bis expectancy gap).
pub const SEGMENT_GAP_R: f64 = EXPECTANCY_GAP_R;

pub(super) fn collect(scope: &Scope, out: &mut Vec<Insight>) -> Result<()> {
    let r = replay(scope.ledger)?;
    let set = r.selected(&scope.analysis);
    let baseline = analyze(&set, 0.0)?.summary;
    let Some(base) = baseline.expectancy_r else { return Ok(()) };
    for (dimension, kind) in [(Dimension::Setup, TagKind::Setup), (Dimension::Session, TagKind::Session)] {
        // (tag id, name, summary, trade ids), in the segments' order (by name).
        let mut eligible: Vec<(i64, String, Summary, Vec<i64>)> = Vec::new();
        for g in groups(&set, SegmentBy::Tag(kind)).into_iter().filter(|g| g.key != "none") {
            let summary = analyze(&g.trades, 0.0)?.summary;
            if summary.r_trade_count >= SEGMENT_MIN_R_TRADES && summary.expectancy_r.is_some() {
                eligible.push((g.key.parse().unwrap_or_default(), g.label, summary, g.trades.iter().map(|c| c.facts.id).collect()));
            }
        }
        if eligible.len() < 2 {
            continue;
        }
        let exp = |s: &Summary| s.expectancy_r.unwrap_or_default();
        // Strictly better only, so ties keep the first one: more trades with an R, then name order.
        let pick = |better: &dyn Fn(f64, f64) -> bool| {
            let mut best = &eligible[0];
            for e in &eligible[1..] {
                let (a, b) = (exp(&e.2), exp(&best.2));
                if better(a, b) || (a == b && e.2.r_trade_count > best.2.r_trade_count) {
                    best = e;
                }
            }
            best
        };
        let best = pick(&|a, b| a > b);
        let weak = pick(&|a, b| a < b);
        let highlight = |e: &(i64, String, Summary, Vec<i64>)| SegmentHighlight {
            dimension,
            tag_id: e.0,
            name: e.1.clone(),
            summary: e.2.clone(),
            baseline_expectancy_r: base,
            baseline_r_trade_count: baseline.r_trade_count,
            eligible_count: eligible.len(),
            gap: exp(&e.2) - base,
            min_r_trades: SEGMENT_MIN_R_TRADES,
        };
        let filter = |e: &(i64, String, Summary, Vec<i64>)| (dimension == Dimension::Setup).then_some(EvidenceFilter::Setup { tag_id: e.0 });
        let period = scope.analysis_period(set.len());
        let order = if dimension == Dimension::Setup { 0 } else { 1 };
        let subject = |e: &(i64, String, Summary, Vec<i64>)| format!("{}:{}", dimension.as_str(), e.0);
        if exp(&best.2) > 0.0 && exp(&best.2) >= base + SEGMENT_GAP_R - EPSILON {
            let key = if dimension == Dimension::Setup { "bestSegment.setup" } else { "bestSegment.session" };
            let detail = InsightDetail::BestSegment(Box::new(highlight(best)));
            out.push(scope.insight(Priority::Low, key, &subject(best), 0, period.clone(), Source::Segments, best.3.clone(), filter(best), detail, order));
        }
        if exp(&weak.2) < 0.0 && exp(&weak.2) <= base - SEGMENT_GAP_R + EPSILON {
            let key = if dimension == Dimension::Setup { "weakSegment.setup" } else { "weakSegment.session" };
            let detail = InsightDetail::WeakSegment(Box::new(highlight(weak)));
            out.push(scope.insight(Priority::Medium, key, &subject(weak), 0, period, Source::Segments, weak.3.clone(), filter(weak), detail, order));
        }
    }
    Ok(())
}
