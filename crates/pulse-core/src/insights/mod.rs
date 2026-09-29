//! Automatic insights (spec 3.5.1 – 3.5.3): trends, best / weakest segments
//! and suggestions, read from the reports the engine already computes. Every
//! definition is documented in CLAUDE.md, "Insights automatiques (lot 19)".
//!
//! Deterministic and local: an insight is a translation key plus figures
//! produced by `pulse-core`, never generated text. [`evaluate`] is pure: from
//! a [`Ledger`], an instant and the user's settings it returns the insights of
//! each account of the ledger, each account on its own.

mod highlights;
pub mod log;
mod trends;

pub use log::{InsightRecord, active_insights, dismiss, history};

use crate::behavior::{FactorKey, MistakeSource};
use crate::error::Result;
use crate::journal::JournalEntry;
use crate::money::Decimal;
use crate::rules::Rule;
use crate::settings::BehaviorSettings;
use crate::stats::summary::Summary;
use crate::stats::{AccountCapital, Ledger, StatsQuery, time};
use serde::Serialize;

const DAY_MS: i64 = 86_400_000;
const MIN_MS: i64 = 60_000;
/// Float comparisons against a threshold: "exactly 20 %" counts as reached.
pub(crate) const EPSILON: f64 = 1e-9;

/// Closed trades read by a trend: the last 20, split into an older and a recent half of 10.
pub const TREND_WINDOW: usize = 20;
/// Values a trend needs in each half.
pub const TREND_MIN_HALF: usize = 5;
/// Local days of the analysis window (the dashboard's "3M"), today included.
pub const ANALYSIS_DAYS: i64 = 90;
/// A situation not seen for longer than this starts a new episode (it shows again even if dismissed).
pub const EPISODE_GAP_MS: i64 = 14 * DAY_MS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Priority {
    High,
    Medium,
    Low,
}

impl Priority {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Priority::High => "high",
            Priority::Medium => "medium",
            Priority::Low => "low",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Category {
    /// Progressive drift (spec 3.5.1).
    Trend,
    /// Recommendation from mistakes and correlations (3.5.3).
    Suggestion,
    /// Best or weakest segment (3.5.2).
    Highlight,
}

impl Category {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Category::Trend => "trend",
            Category::Suggestion => "suggestion",
            Category::Highlight => "highlight",
        }
    }
}

/// Which way a drift goes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Drift {
    Up,
    Down,
}

impl Drift {
    fn as_str(self) -> &'static str {
        match self {
            Drift::Up => "up",
            Drift::Down => "down",
        }
    }
}

/// The report an insight was read from (the UI links it to its page).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Source {
    Risk,
    Discipline,
    Fees,
    RuleAdherence,
    SizeChange,
    Patterns,
    Segments,
    Mistakes,
    Emotions,
    ExternalFactors,
}

/// A filter of the trade list that shows the trades concerned.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum EvidenceFilter {
    /// `/trades?mistake=tag:ID|rule:ID`.
    Mistake { source: MistakeSource, id: i64 },
    /// `/trades?setup=ID`.
    Setup { tag_id: i64 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PeriodBasis {
    /// The last closed trades of the account (trend window).
    LastTrades,
    /// The analysis window of local days.
    Days,
}

/// What an insight is about in time.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InsightPeriod {
    pub basis: PeriodBasis,
    /// `lastTrades`: exit instant of the first and last trade of the window;
    /// `days`: the window `[from, to)` (local midnights).
    pub from: Option<i64>,
    pub to: Option<i64>,
    /// Closed trades in the window.
    pub trade_count: usize,
    /// `days` only: length of the window in local days.
    pub days: Option<i64>,
}

/// One half of the trend window.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Half {
    /// Closed trades in the half.
    pub trade_count: usize,
    /// Trades of the half that have the measured value (risk %, score…).
    pub value_count: usize,
    /// Exit instants of its first and last trade.
    pub from: i64,
    pub to: i64,
    pub trade_ids: Vec<i64>,
}

/// What each insight says; `kind` is the discriminant sent to the UI.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum InsightDetail {
    /// 3.5.1: mean risk in % of capital, recent half against older half.
    RiskDrift {
        direction: Drift,
        older: Half,
        recent: Half,
        /// Fractions (0.01 = 1 %).
        older_avg_risk_pct: f64,
        recent_avg_risk_pct: f64,
        /// recent / older − 1 (0.23 = +23 %).
        change: f64,
        /// Mean initial risk in money over the same trades.
        older_avg_risk: Decimal,
        recent_avg_risk: Decimal,
        risk_change: Option<f64>,
        threshold: f64,
    },
    /// 3.5.1: mean discipline score, recent half against older half.
    DisciplineTrend { direction: Drift, older: Half, recent: Half, older_score: f64, recent_score: f64, difference: f64, threshold: f64 },
    /// 3.5.1: mean plan component (yes 1, partial 0.5, no 0), recent against older.
    PlanDrop { older: Half, recent: Half, older_rate: f64, recent_rate: f64, difference: f64, threshold: f64 },
    /// 3.5.1: a personal rule respected less often (trend of the lot-8 rule adherence).
    RuleAdherenceDrop { rule_id: i64, text: String, checks: usize, respected: usize, rate: Option<f64>, trend: f64, threshold: f64, min_checks: usize },
    /// 3.5.1: mean fees per trade, recent against older.
    FeesUp { older: Half, recent: Half, older_avg_fees: Decimal, recent_avg_fees: Decimal, change: f64, threshold: f64 },
    /// 3.5.1 / 3.4.5: exposure grows after a loss, more than after a win.
    SizeUpAfterLoss {
        after_loss_mean: f64,
        after_loss_median: Option<f64>,
        after_win_mean: f64,
        loss_vs_win: f64,
        after_loss_cases: usize,
        after_win_cases: usize,
        increased_count: usize,
        threshold: f64,
    },
    /// 3.5.1 / 3.4.5: revenge trades repeated over the analysis window.
    RevengePattern { count: usize, net_pnl: Decimal, win_rate: Option<f64>, window_min: u32, size_factor: Decimal, min_count: usize },
    /// 3.5.1 / 3.4.5: days over the daily trade limit.
    OvertradingPattern { day_count: usize, limit: u32, days: Vec<String>, trade_count: usize, min_count: usize },
    /// 3.5.3: a recurring mistake that weighs on the losses.
    CostlyMistake {
        source: MistakeSource,
        id: i64,
        label: String,
        trade_count: usize,
        /// Share of the window's closed trades.
        share_of_trades: Option<f64>,
        cost: Decimal,
        /// Losses of every closed trade of the window, as a positive amount.
        total_losses: Decimal,
        share_of_losses: Option<f64>,
        net_pnl: Decimal,
        expectancy_r: Option<f64>,
        min_trades: usize,
        min_share_of_losses: f64,
    },
    /// 3.5.3 / 3.4.2: trades taken with an emotion declared before entry, against the others.
    EmotionLower { tag_id: i64, name: String, group: Box<Summary>, others: Box<Summary>, difference: f64, threshold: f64 },
    /// 3.5.3 / 3.4.9: an external factor that went with a lower discipline or expectancy.
    FactorLower {
        factor: FactorKey,
        present_days: usize,
        absent_days: usize,
        present_trade_count: usize,
        absent_trade_count: usize,
        discipline: crate::behavior::Comparison,
        expectancy_r: crate::behavior::Comparison,
    },
    /// 3.5.2: the segment whose expectancy stands out above the others.
    BestSegment(Box<SegmentHighlight>),
    /// 3.5.2: the segment whose expectancy stands out below the others.
    WeakSegment(Box<SegmentHighlight>),
}

/// Which segmentation of 3.3.9 a highlight comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Dimension {
    Setup,
    Session,
}

impl Dimension {
    fn as_str(self) -> &'static str {
        match self {
            Dimension::Setup => "setup",
            Dimension::Session => "session",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SegmentHighlight {
    pub dimension: Dimension,
    pub tag_id: i64,
    pub name: String,
    pub summary: Summary,
    /// Expectancy in R of every trade of the window that has an R.
    pub baseline_expectancy_r: f64,
    pub baseline_r_trade_count: usize,
    /// Segments with enough trades with an R to be compared.
    pub eligible_count: usize,
    /// Segment expectancy − baseline.
    pub gap: f64,
    pub min_r_trades: usize,
}

impl InsightDetail {
    pub fn kind(&self) -> &'static str {
        match self {
            InsightDetail::RiskDrift { .. } => "riskDrift",
            InsightDetail::DisciplineTrend { .. } => "disciplineTrend",
            InsightDetail::PlanDrop { .. } => "planDrop",
            InsightDetail::RuleAdherenceDrop { .. } => "ruleAdherenceDrop",
            InsightDetail::FeesUp { .. } => "feesUp",
            InsightDetail::SizeUpAfterLoss { .. } => "sizeUpAfterLoss",
            InsightDetail::RevengePattern { .. } => "revengePattern",
            InsightDetail::OvertradingPattern { .. } => "overtradingPattern",
            InsightDetail::CostlyMistake { .. } => "costlyMistake",
            InsightDetail::EmotionLower { .. } => "emotionLower",
            InsightDetail::FactorLower { .. } => "factorLower",
            InsightDetail::BestSegment(_) => "bestSegment",
            InsightDetail::WeakSegment(_) => "weakSegment",
        }
    }

    /// Display order inside a priority (the order of CLAUDE.md's tables).
    fn rank(&self) -> u8 {
        match self {
            InsightDetail::RiskDrift { .. } => 0,
            InsightDetail::DisciplineTrend { .. } => 1,
            InsightDetail::PlanDrop { .. } => 2,
            InsightDetail::RuleAdherenceDrop { .. } => 3,
            InsightDetail::FeesUp { .. } => 4,
            InsightDetail::SizeUpAfterLoss { .. } => 5,
            InsightDetail::RevengePattern { .. } => 6,
            InsightDetail::OvertradingPattern { .. } => 7,
            InsightDetail::CostlyMistake { .. } => 8,
            InsightDetail::EmotionLower { .. } => 9,
            InsightDetail::FactorLower { .. } => 10,
            InsightDetail::BestSegment(_) => 11,
            InsightDetail::WeakSegment(_) => 12,
        }
    }

    pub fn category(&self) -> Category {
        match self.rank() {
            0..=7 => Category::Trend,
            8..=10 => Category::Suggestion,
            _ => Category::Highlight,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Insight {
    /// `situation:level#episode`: a dismissed insight never shows again under it.
    pub id: String,
    /// `kind:account:subject`: what the insight is about, whatever its level or episode.
    pub situation: String,
    /// Coarse gravity of the evidence: only a higher level makes a dismissed insight show again.
    pub level: u32,
    /// Set by the log (0 from the pure evaluation).
    pub episode: u32,
    pub account_id: i64,
    pub currency: Option<String>,
    pub category: Category,
    pub priority: Priority,
    /// Translation key of the template, e.g. `riskDrift.up`; the values are in the detail.
    pub message_key: &'static str,
    pub period: InsightPeriod,
    /// Evidence: the report it was read from, the trades concerned, a trade-list filter.
    pub source: Source,
    pub trade_ids: Vec<i64>,
    pub filter: Option<EvidenceFilter>,
    /// Set by the log: when this identity was first shown, when it was dismissed.
    pub first_seen_at: Option<i64>,
    pub dismissed_at: Option<i64>,
    #[serde(flatten)]
    pub detail: InsightDetail,
    /// Rank inside its report (most important first), for the display order.
    #[serde(skip)]
    pub(crate) order: usize,
}

/// Everything a builder needs to know about the account being evaluated.
pub(crate) struct Scope<'a> {
    /// The account alone, as it stood at `now`.
    pub ledger: &'a Ledger,
    pub account_id: i64,
    pub settings: &'a BehaviorSettings,
    pub journal: &'a [JournalEntry],
    pub rules: &'a [Rule],
    /// The analysis window, on this account.
    pub analysis: StatsQuery,
}

impl Scope<'_> {
    pub fn analysis_period(&self, trade_count: usize) -> InsightPeriod {
        InsightPeriod { basis: PeriodBasis::Days, from: self.analysis.from, to: self.analysis.to, trade_count, days: Some(ANALYSIS_DAYS) }
    }

    /// Builds an insight of this account; `subject` completes the situation key.
    #[allow(clippy::too_many_arguments)] // one argument per field of the evidence
    pub fn insight(
        &self,
        priority: Priority,
        message_key: &'static str,
        subject: &str,
        level: u32,
        period: InsightPeriod,
        source: Source,
        trade_ids: Vec<i64>,
        filter: Option<EvidenceFilter>,
        detail: InsightDetail,
        order: usize,
    ) -> Insight {
        let situation = format!("{}:{}:{subject}", detail.kind(), self.account_id);
        Insight {
            id: format!("{situation}:{level}"),
            situation,
            level,
            episode: 0,
            account_id: self.account_id,
            currency: self.ledger.currency.clone(),
            category: detail.category(),
            priority,
            message_key,
            period,
            source,
            trade_ids,
            filter,
            first_seen_at: None,
            dismissed_at: None,
            detail,
            order,
        }
    }
}

/// `value / step`, rounded down, for the level of an insight (see CLAUDE.md, "Identité").
pub(crate) fn level(value: f64, step: f64) -> u32 {
    (value.abs() / step + EPSILON).floor() as u32
}

/// The account on its own: its capital, flows and trades.
fn account_ledger(ledger: &Ledger, account: &AccountCapital) -> Ledger {
    Ledger {
        currency: ledger.currency.clone(),
        initial_capital: account.initial_capital,
        accounts: vec![account.clone()],
        capital_moves: ledger.capital_moves.iter().filter(|m| m.account_id == account.id).cloned().collect(),
        trades: ledger.trades.iter().filter(|t| t.account_id == account.id).cloned().collect(),
    }
}

/// Local midnight starting `day`, for the caller's offset.
fn midnight(day: i64, tz_offset_min: i32) -> i64 {
    day * DAY_MS - i64::from(tz_offset_min) * MIN_MS
}

/// Insights of every account of the ledger at `now`, each account on its own.
/// `journal` is the whole daily journal (all accounts), `rules` the rule list with archived ones.
pub fn evaluate(
    ledger: &Ledger,
    now: i64,
    tz_offset_min: i32,
    settings: &BehaviorSettings,
    journal: &[JournalEntry],
    rules: &[Rule],
) -> Result<Vec<Insight>> {
    let ledger = crate::alerts::as_of(ledger, now);
    let today = time::local_day_number(now, tz_offset_min);
    let mut out = Vec::new();
    for account in &ledger.accounts {
        let own = account_ledger(&ledger, account);
        let scope = Scope {
            ledger: &own,
            account_id: account.id,
            settings,
            journal,
            rules,
            analysis: StatsQuery {
                account_ids: vec![account.id],
                from: Some(midnight(today + 1 - ANALYSIS_DAYS, tz_offset_min)),
                to: Some(midnight(today + 1, tz_offset_min)),
                ..StatsQuery::default()
            },
        };
        trends::collect(&scope, &mut out)?;
        highlights::collect(&scope, &mut out)?;
    }
    sort(&mut out);
    Ok(out)
}

/// Priority first, then the order of CLAUDE.md's tables, then the account, then the rank in its report.
pub(crate) fn sort(insights: &mut [Insight]) {
    insights.sort_by(|a, b| (a.priority, a.detail.rank(), a.account_id, a.order).cmp(&(b.priority, b.detail.rank(), b.account_id, b.order)));
}

#[cfg(test)]
mod tests;
