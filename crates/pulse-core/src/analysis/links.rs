//! Liens entre un trade et les idées / analyses qu'il suit (tables `trade_ideas`, `trade_analyses` ; la
//! table `trades` n'est pas touchée). Supprimer un trade supprime ses liens, jamais l'idée ni l'analyse.

use super::ideas::{IdeaOutcome, IdeaStatus};
use crate::error::{CoreError, Result};
use rusqlite::{Connection, params};
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdeaLink {
    pub id: i64,
    pub symbol: String,
    pub note: String,
    pub status: IdeaStatus,
    pub outcome: Option<IdeaOutcome>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisLink {
    pub id: i64,
    pub created_at: i64,
    pub tz_offset_min: i32,
    pub day: String,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TradeLinks {
    pub ideas: Vec<IdeaLink>,
    pub analyses: Vec<AnalysisLink>,
}

pub fn get(conn: &Connection, trade_id: i64) -> Result<TradeLinks> {
    let mut ideas = conn.prepare(
        "SELECT i.id, n.symbol, i.note, i.status, i.outcome FROM trade_ideas t
         JOIN ideas i ON i.id = t.idea_id JOIN instruments n ON n.id = i.instrument_id
         WHERE t.trade_id = ?1 ORDER BY i.id",
    )?;
    let ideas = ideas
        .query_map([trade_id], |r| Ok(IdeaLink { id: r.get(0)?, symbol: r.get(1)?, note: r.get(2)?, status: r.get(3)?, outcome: r.get(4)? }))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut analyses = conn.prepare(
        "SELECT a.id, a.created_at, a.tz_offset_min, a.day FROM trade_analyses t JOIN analyses a ON a.id = t.analysis_id
         WHERE t.trade_id = ?1 ORDER BY a.created_at, a.id",
    )?;
    let analyses = analyses
        .query_map([trade_id], |r| Ok(AnalysisLink { id: r.get(0)?, created_at: r.get(1)?, tz_offset_min: r.get(2)?, day: r.get(3)? }))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    Ok(TradeLinks { ideas, analyses })
}

/// Remplace les liens du trade par ceux donnés (la liste complète : un lien absent est retiré). Rien
/// n'est obligatoire : deux listes vides enlèvent tout. Un identifiant inconnu refuse l'ensemble.
pub fn set(conn: &Connection, trade_id: i64, idea_ids: &[i64], analysis_ids: &[i64]) -> Result<TradeLinks> {
    let exists = |table: &str, id: i64| -> Result<bool> {
        Ok(conn.query_row(&format!("SELECT COUNT(*) FROM {table} WHERE id = ?1"), [id], |r| r.get::<_, i64>(0))? > 0)
    };
    if !exists("trades", trade_id)? {
        return Err(CoreError::NotFound(format!("trade {trade_id}")));
    }
    if let Some(id) = idea_ids.iter().find(|&&id| !exists("ideas", id).unwrap_or(false)) {
        return Err(CoreError::NotFound(format!("idea {id}")));
    }
    if let Some(id) = analysis_ids.iter().find(|&&id| !exists("analyses", id).unwrap_or(false)) {
        return Err(CoreError::NotFound(format!("analysis {id}")));
    }
    let tx = conn.unchecked_transaction()?;
    tx.execute("DELETE FROM trade_ideas WHERE trade_id = ?1", [trade_id])?;
    tx.execute("DELETE FROM trade_analyses WHERE trade_id = ?1", [trade_id])?;
    for id in idea_ids {
        tx.execute("INSERT OR IGNORE INTO trade_ideas (trade_id, idea_id) VALUES (?1, ?2)", params![trade_id, id])?;
    }
    for id in analysis_ids {
        tx.execute("INSERT OR IGNORE INTO trade_analyses (trade_id, analysis_id) VALUES (?1, ?2)", params![trade_id, id])?;
    }
    tx.commit()?;
    get(conn, trade_id)
}
