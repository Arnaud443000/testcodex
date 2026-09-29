//! Suggestions (spec 3.5.3), from the recurring mistakes (3.4.7, 3.4.8), the
//! emotions declared before entry (3.4.2) and the external factors (3.4.9).
//! Each one is a template: a finding worded "at the same time", then a fixed
//! suggestion per key in `fr.ts`; never a cause, never an order.

use super::{EPSILON, EvidenceFilter, Insight, InsightDetail, Priority, Scope, Source, level};
use crate::behavior::{self, FactorKey, MIN_R_TRADES, MistakeSource, Verdict};
use crate::error::Result;
use crate::money::Decimal;
use crate::stats::pnl::{checked, ratio};
use crate::stats::segments::{SegmentBy, groups};
use crate::stats::summary::analyze;
use crate::stats::replay;
use crate::trades::EmotionMoment;

/// A mistake is recurring from this many trades.
pub const MISTAKE_MIN_TRADES: usize = 3;
/// Its cost must reach this share of the window's losses (compared exactly: cost × 10 ≥ losses).
pub const MISTAKE_MIN_SHARE_OF_LOSSES: f64 = 0.10;
pub const MAX_MISTAKES: usize = 2;
/// An emotion's expectancy must be this many R below the other trades'.
pub const EMOTION_GAP_R: f64 = behavior::EXPECTANCY_GAP_R;
pub const MAX_EMOTIONS: usize = 2;

pub(super) fn collect(scope: &Scope, out: &mut Vec<Insight>) -> Result<()> {
    mistakes(scope, out)?;
    emotions(scope, out)?;
    factors(scope, out)?;
    Ok(())
}

fn mistakes(scope: &Scope, out: &mut Vec<Insight>) -> Result<()> {
    let report = behavior::mistakes(scope.ledger, &scope.analysis)?;
    let r = replay(scope.ledger)?;
    let total_losses = analyze(&r.selected(&scope.analysis), 0.0)?.summary.total_losses;
    let ten = Decimal::from(10);
    let mut order = 0;
    for m in &report.by_cost {
        if order == MAX_MISTAKES {
            break;
        }
        if m.trade_count < MISTAKE_MIN_TRADES || m.cost <= Decimal::ZERO || checked(m.cost.checked_mul(ten))? < total_losses {
            continue;
        }
        let (key, prefix) = match m.source {
            MistakeSource::Tag => ("costlyMistake.tag", "tag"),
            MistakeSource::Rule => ("costlyMistake.rule", "rule"),
        };
        let detail = InsightDetail::CostlyMistake {
            source: m.source,
            id: m.id,
            label: m.label.clone(),
            trade_count: m.trade_count,
            share_of_trades: m.share,
            cost: m.cost,
            total_losses,
            share_of_losses: ratio(m.cost, total_losses),
            net_pnl: m.net_pnl,
            expectancy_r: m.expectancy_r,
            min_trades: MISTAKE_MIN_TRADES,
            min_share_of_losses: MISTAKE_MIN_SHARE_OF_LOSSES,
        };
        let filter = Some(EvidenceFilter::Mistake { source: m.source, id: m.id });
        let subject = format!("{prefix}:{}", m.id);
        let period = scope.analysis_period(report.trade_count);
        let lvl = m.trade_count as u32;
        out.push(scope.insight(Priority::Medium, key, &subject, lvl, period, Source::Mistakes, m.trade_ids.clone(), filter, detail, order));
        order += 1;
    }
    Ok(())
}

/// Emotions declared **before** entry: those declared after depend on the result itself.
fn emotions(scope: &Scope, out: &mut Vec<Insight>) -> Result<()> {
    let r = replay(scope.ledger)?;
    let set = r.selected(&scope.analysis);
    let mut found = Vec::new();
    for g in groups(&set, SegmentBy::Emotion(Some(EmotionMoment::Before))).into_iter().filter(|g| g.key != "none") {
        let others: Vec<_> = set.iter().copied().filter(|c| !g.trades.iter().any(|t| t.facts.id == c.facts.id)).collect();
        let (group, others) = (analyze(&g.trades, 0.0)?.summary, analyze(&others, 0.0)?.summary);
        if group.r_trade_count < MIN_R_TRADES || others.r_trade_count < MIN_R_TRADES {
            continue;
        }
        let (Some(a), Some(b)) = (group.expectancy_r, others.expectancy_r) else { continue };
        let difference = a - b;
        if difference <= -EMOTION_GAP_R + EPSILON {
            found.push((difference, g.key.parse::<i64>().unwrap_or_default(), g.label, group, others, g.trades.iter().map(|c| c.facts.id).collect::<Vec<_>>()));
        }
    }
    // Widest gap first; the sort is stable, so ties keep the segments' name order.
    found.sort_by(|a, b| a.0.total_cmp(&b.0));
    for (order, (difference, tag_id, name, group, others, trade_ids)) in found.into_iter().take(MAX_EMOTIONS).enumerate() {
        let (group, others) = (Box::new(group), Box::new(others));
        let detail = InsightDetail::EmotionLower { tag_id, name, group, others, difference, threshold: EMOTION_GAP_R };
        let lvl = level(difference, EMOTION_GAP_R);
        let period = scope.analysis_period(set.len());
        out.push(scope.insight(Priority::Medium, "emotionLower", &tag_id.to_string(), lvl, period, Source::Emotions, trade_ids, None, detail, order));
    }
    Ok(())
}

fn factor_key(f: FactorKey) -> &'static str {
    match f {
        FactorKey::PoorSleep => "poorSleep",
        FactorKey::HighFatigue => "highFatigue",
        FactorKey::LateHours => "lateHours",
        FactorKey::LowMood => "lowMood",
    }
}

/// External factors whose days went with a lower discipline or expectancy (the report's own verdicts).
fn factors(scope: &Scope, out: &mut Vec<Insight>) -> Result<()> {
    let report = behavior::external_factors(scope.ledger, &scope.analysis, scope.settings, scope.journal)?;
    for (order, f) in report.factors.iter().enumerate() {
        let lower = [f.discipline.verdict, f.expectancy_r.verdict].iter().filter(|v| **v == Verdict::Lower).count();
        if lower == 0 {
            continue;
        }
        let detail = InsightDetail::FactorLower {
            factor: f.key,
            present_days: f.present.day_count,
            absent_days: f.absent.day_count,
            present_trade_count: f.present.summary.trade_count,
            absent_trade_count: f.absent.summary.trade_count,
            discipline: f.discipline.clone(),
            expectancy_r: f.expectancy_r.clone(),
        };
        let period = scope.analysis_period(report.trade_count);
        let trade_ids = f.present.trade_ids.clone();
        out.push(scope.insight(Priority::Medium, "factorLower", factor_key(f.key), lower as u32, period, Source::ExternalFactors, trade_ids, None, detail, order));
    }
    Ok(())
}
