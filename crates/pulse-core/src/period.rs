//! Shared query for the journal-side analyses (execution quality, confidence,
//! goals): which accounts and which exit-time window `[from, to)`.

use crate::error::Result;
use crate::trade_view::{self, TradeView};
use crate::trades::TradeFilter;
use rusqlite::Connection;
use serde::Deserialize;

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeriodQuery {
    /// Accounts to include (all when empty).
    #[serde(default)]
    pub account_ids: Vec<i64>,
    /// Unix ms, UTC, inclusive; a trade counts in the period where it is closed.
    #[serde(default)]
    pub from: Option<i64>,
    /// Unix ms, UTC, exclusive.
    #[serde(default)]
    pub to: Option<i64>,
}

impl PeriodQuery {
    pub fn contains(&self, instant: i64) -> bool {
        self.from.is_none_or(|f| instant >= f) && self.to.is_none_or(|t| instant < t)
    }
}

/// Closed trades (with their figures) whose exit falls in the period, most recent entry first.
pub(crate) fn closed_trades(conn: &Connection, q: &PeriodQuery) -> Result<Vec<TradeView>> {
    let filter = TradeFilter { account_ids: q.account_ids.clone(), from: None, to: None, mistake: None };
    Ok(trade_view::list(conn, &filter)?
        .into_iter()
        .filter(|v| v.figures.is_some() && v.trade.data.exit_time.is_some_and(|t| q.contains(t)))
        .collect())
}
