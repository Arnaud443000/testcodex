//! Constat « est-ce que j'analyse bien ? » : un constat, jamais un ordre ni une cause.
//!
//! * Idées clôturées de la période : nombre par résultat et taux « a fonctionné » ;
//! * trades liés à une idée ou à une analyse, comparés aux autres : score de discipline moyen et expectancy R,
//!   **réutilisés tels quels** (`behavior`, `stats`) — aucune formule nouvelle — et seulement si chaque groupe
//!   a au moins [`MIN_SAMPLE`] trades. Les verdicts utilisent les seuils existants (10 points, 0,25 R).

use super::{MIN_SAMPLE};
use crate::behavior::{Comparison, Context, DISCIPLINE_GAP, EXPECTANCY_GAP_R, MIN_R_TRADES, mean_score, of_closed};
use crate::error::Result;
use crate::settings;
use crate::stats::summary::analyze;
use crate::stats::{Closed, Ledger, StatsQuery, load};
use rusqlite::Connection;
use serde::Serialize;
use std::collections::HashSet;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeaOutcomes {
    pub worked: usize,
    pub invalidated: usize,
    pub no_follow_up: usize,
    /// Idées clôturées dans la période (les trois résultats).
    pub closed_count: usize,
    /// `worked / (worked + invalidated)` ; `None` sous [`MIN_SAMPLE`] idées clôturées, ou sans aucune idée
    /// à la fois « a fonctionné » ou « invalidée ». Jamais 0 ni l'infini par défaut.
    pub success_rate: Option<f64>,
    /// Idées encore actives (information, hors taux).
    pub active_count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedSide {
    pub trade_count: usize,
    /// Score de discipline moyen (`None` sous 5 trades notés).
    pub discipline_score: Option<f64>,
    pub expectancy_r: Option<f64>,
    pub r_trade_count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedComparison {
    /// Trades liés à au moins une idée ou une analyse.
    pub linked: LinkedSide,
    pub unlinked: LinkedSide,
    pub discipline: Comparison,
    pub expectancy_r: Comparison,
    pub min_trade_count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisReport {
    pub ideas: IdeaOutcomes,
    pub comparison: LinkedComparison,
    /// Analyses de séance enregistrées dans la période (information).
    pub analysis_count: usize,
}

/// Résultats des idées clôturées entre `from` (inclus) et `to` (exclu), en ms ; `None` = sans borne.
pub fn idea_outcomes(conn: &Connection, from: Option<i64>, to: Option<i64>) -> Result<IdeaOutcomes> {
    let count = |outcome: &str| -> Result<usize> {
        Ok(conn.query_row(
            "SELECT COUNT(*) FROM ideas WHERE status = 'closed' AND outcome = ?1 AND (?2 IS NULL OR closed_at >= ?2) AND (?3 IS NULL OR closed_at < ?3)",
            rusqlite::params![outcome, from, to],
            |r| r.get::<_, i64>(0),
        )? as usize)
    };
    let (worked, invalidated, no_follow_up) = (count("worked")?, count("invalidated")?, count("noFollowUp")?);
    let closed_count = worked + invalidated + no_follow_up;
    let success_rate = (closed_count >= MIN_SAMPLE && worked + invalidated > 0).then(|| worked as f64 / (worked + invalidated) as f64);
    let active_count = conn.query_row("SELECT COUNT(*) FROM ideas WHERE status = 'active'", [], |r| r.get::<_, i64>(0))? as usize;
    Ok(IdeaOutcomes { worked, invalidated, no_follow_up, closed_count, success_rate, active_count })
}

fn side(ctx: &Context, set: &[&Closed], risk_free: f64) -> Result<LinkedSide> {
    let scores = of_closed(ctx, set)?;
    let (discipline_score, _) = mean_score(scores.iter());
    let summary = analyze(set, risk_free)?.summary;
    Ok(LinkedSide {
        trade_count: set.len(),
        discipline_score,
        expectancy_r: summary.expectancy_r.filter(|_| summary.r_trade_count >= MIN_R_TRADES),
        r_trade_count: summary.r_trade_count,
    })
}

/// Trades liés et non liés, en pur : `linked` = identifiants des trades liés à une idée ou une analyse.
pub fn compare_linked(ledger: &Ledger, query: &StatsQuery, behavior: &settings::BehaviorSettings, linked: &HashSet<i64>) -> Result<LinkedComparison> {
    let ctx = Context::new(ledger, behavior.clone())?;
    let selected = ctx.replay.selected(query);
    let (with, without): (Vec<&Closed>, Vec<&Closed>) = selected.into_iter().partition(|c| linked.contains(&c.facts.id));
    let (a, b) = (side(&ctx, &with, query.risk_free_daily)?, side(&ctx, &without, query.risk_free_daily)?);
    let enough = a.trade_count >= MIN_SAMPLE && b.trade_count >= MIN_SAMPLE;
    Ok(LinkedComparison {
        discipline: crate::behavior::compare_values(a.discipline_score, b.discipline_score, enough, DISCIPLINE_GAP),
        expectancy_r: crate::behavior::compare_values(a.expectancy_r, b.expectancy_r, enough, EXPECTANCY_GAP_R),
        linked: a,
        unlinked: b,
        min_trade_count: MIN_SAMPLE,
    })
}

pub fn report(conn: &Connection, query: &StatsQuery) -> Result<AnalysisReport> {
    let linked: HashSet<i64> = {
        let mut stmt = conn.prepare("SELECT trade_id FROM trade_ideas UNION SELECT trade_id FROM trade_analyses")?;
        stmt.query_map([], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?
    };
    let ledger = load(conn, &query.account_ids)?;
    let comparison = compare_linked(&ledger, query, &settings::behavior(conn)?, &linked)?;
    let analysis_count = conn.query_row(
        "SELECT COUNT(*) FROM analyses WHERE (?1 IS NULL OR created_at >= ?1) AND (?2 IS NULL OR created_at < ?2)",
        rusqlite::params![query.from, query.to],
        |r| r.get::<_, i64>(0),
    )? as usize;
    Ok(AnalysisReport { ideas: idea_outcomes(conn, query.from, query.to)?, comparison, analysis_count })
}
