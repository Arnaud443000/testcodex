//! Alerte facultative (lot 31) : un trade entré aujourd'hui **avant toute analyse de séance du jour**.
//! Éteinte par défaut (réglage `alerts.no_analysis` = `on`). Jamais bloquante, gravité `warning`. Pure :
//! les analyses du jour arrivent déjà lues. Même modèle que `news.rs` ; `alerts::evaluate` n'est pas touché.

use super::{Alert, AlertDetail, Severity, as_of, local_day};
use crate::stats::Ledger;
use crate::stats::time::day_key;
use rusqlite::Connection;

/// Une analyse de séance : son instant de création.
pub type AnalysisStamp = i64;

/// Instants de création des analyses dont le jour local est `day`, dans l'ordre.
pub fn stamps_of_day(conn: &Connection, day: &str) -> crate::error::Result<Vec<AnalysisStamp>> {
    let mut stmt = conn.prepare("SELECT created_at FROM analyses WHERE day = ?1 ORDER BY created_at")?;
    Ok(stmt.query_map([day], |r| r.get(0))?.collect::<rusqlite::Result<_>>()?)
}

/// Alertes « sans analyse » actives à `now`, compte par compte. `analyses` : analyses du jour local de
/// `now`. Un trade est sans analyse s'il n'en existe aucune créée au plus tard à son entrée ; une analyse
/// saisie après coup n'efface donc pas l'alerte d'un trade déjà pris. Rien quand l'alerte est éteinte.
pub fn evaluate(ledger: &Ledger, analyses: &[AnalysisStamp], now: i64, tz_offset_min: i32, enabled: bool) -> Vec<Alert> {
    if !enabled {
        return Vec::new();
    }
    let ledger = as_of(ledger, now);
    let today = local_day(now, tz_offset_min);
    let day = day_key(now, tz_offset_min);
    let mut out = Vec::new();
    for account in &ledger.accounts {
        let mut entered: Vec<_> =
            ledger.trades.iter().filter(|t| t.account_id == account.id && local_day(t.entry_time, t.tz_offset_min) == today).collect();
        entered.sort_by_key(|t| (t.entry_time, t.id));
        for t in entered {
            if analyses.iter().any(|&a| a <= t.entry_time) {
                continue;
            }
            out.push(Alert {
                id: format!("noAnalysis:{}:{}", account.id, t.id),
                account_id: account.id,
                severity: Severity::Warning,
                message_key: "noAnalysis",
                at: t.entry_time,
                trade_id: Some(t.id),
                detail: AlertDetail::NoAnalysis { day: day.clone() },
            });
        }
    }
    out
}
