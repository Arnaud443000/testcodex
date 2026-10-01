//! Insights as the trader sees them: evaluated on the stored data, written to
//! the `insight_log` history (migration v11), hidden once dismissed until the
//! situation gets worse or a new episode starts (see CLAUDE.md, "Identité,
//! insights masqués, historique").

use super::{Category, EPISODE_GAP_MS, Insight, Priority, evaluate};
use crate::accounts::{self, Account};
use crate::error::{CoreError, Result};
use crate::stats::load;
use crate::util::ids_condition;
use crate::{journal, rules, settings};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;

/// One line of the insight history.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InsightRecord {
    pub insight_id: String,
    pub account_id: i64,
    pub situation: String,
    pub level: u32,
    pub episode: u32,
    pub kind: String,
    pub category: Category,
    pub priority: Priority,
    pub first_seen_at: i64,
    pub last_seen_at: i64,
    pub dismissed_at: Option<i64>,
    /// The insight as it was first shown (same shape as [`Insight`]).
    pub insight: serde_json::Value,
}

fn chosen_accounts(conn: &Connection, account_ids: &[i64]) -> Result<Vec<Account>> {
    if account_ids.is_empty() { accounts::list_active(conn) } else { account_ids.iter().map(|&id| accounts::get(conn, id)).collect() }
}

/// Every insight of the given accounts (active accounts when empty) at `now`,
/// each account evaluated on its own. New ones are written to the history;
/// dismissed ones are left out unless `include_dismissed`.
pub fn active_insights(conn: &Connection, account_ids: &[i64], now: i64, tz_offset_min: i32, include_dismissed: bool) -> Result<Vec<Insight>> {
    let behavior = settings::behavior(conn)?;
    let entries = journal::list(conn, None, None)?;
    let rule_list = rules::list(conn, true)?;
    let mut insights = Vec::new();
    for account in chosen_accounts(conn, account_ids)? {
        insights.extend(evaluate(&load(conn, &[account.id])?, now, tz_offset_min, &behavior, &entries, &rule_list)?);
    }
    super::sort(&mut insights);

    let tx = conn.unchecked_transaction()?;
    let mut shown = Vec::with_capacity(insights.len());
    for mut insight in insights {
        let (episode, last_seen): (Option<u32>, Option<i64>) = tx.query_row(
            "SELECT MAX(episode), MAX(last_seen_at) FROM insight_log WHERE situation = ?1",
            [&insight.situation],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        // Seen within the gap: same episode; otherwise (or never seen) a new one.
        insight.episode = match (episode, last_seen) {
            (Some(e), Some(seen)) if now - seen <= EPISODE_GAP_MS => e,
            (Some(e), _) => e + 1,
            _ => 1,
        };
        insight.id = format!("{}:{}#{}", insight.situation, insight.level, insight.episode);
        insight.first_seen_at = Some(now);
        let payload = serde_json::to_string(&insight).map_err(|e| CoreError::Invalid(format!("insight cannot be saved: {e}")))?;
        tx.execute(
            "INSERT OR IGNORE INTO insight_log
                (insight_id, account_id, situation, level, episode, kind, category, priority, payload, first_seen_at, last_seen_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)",
            params![
                insight.id,
                insight.account_id,
                insight.situation,
                insight.level,
                insight.episode,
                insight.detail.kind(),
                insight.category.as_str(),
                insight.priority.as_str(),
                payload,
                now
            ],
        )?;
        tx.execute("UPDATE insight_log SET last_seen_at = MAX(last_seen_at, ?2) WHERE insight_id = ?1", params![insight.id, now])?;
        insight.first_seen_at = Some(tx.query_row("SELECT first_seen_at FROM insight_log WHERE insight_id = ?1", [&insight.id], |r| r.get(0))?);
        // Hidden while a level at least as high was dismissed in this episode.
        insight.dismissed_at = tx
            .query_row(
                "SELECT MIN(dismissed_at) FROM insight_log WHERE situation = ?1 AND episode = ?2 AND level >= ?3 AND dismissed_at IS NOT NULL",
                params![insight.situation, insight.episode, insight.level],
                |r| r.get(0),
            )
            .optional()?
            .flatten();
        if include_dismissed || insight.dismissed_at.is_none() {
            shown.push(insight);
        }
    }
    tx.commit()?;
    Ok(shown)
}

/// Hides an insight: it stays hidden in its episode until its level goes above this one.
/// Dismissing twice keeps the first instant.
pub fn dismiss(conn: &Connection, insight_id: &str, now: i64) -> Result<()> {
    let n = conn.execute("UPDATE insight_log SET dismissed_at = COALESCE(dismissed_at, ?2) WHERE insight_id = ?1", params![insight_id, now])?;
    if n == 0 {
        return Err(CoreError::NotFound(format!("insight {insight_id}")));
    }
    Ok(())
}

/// Insights ever shown on the given accounts (all when empty), most recent first.
pub fn history(conn: &Connection, account_ids: &[i64], limit: u32) -> Result<Vec<InsightRecord>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT insight_id, account_id, situation, level, episode, kind, category, priority, first_seen_at, last_seen_at, dismissed_at, payload
         FROM insight_log WHERE {} ORDER BY first_seen_at DESC, rowid DESC LIMIT ?1",
        ids_condition("account_id", account_ids)
    ))?;
    let rows = stmt.query_map([limit], |r| {
        Ok((
            (r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?),
            (r.get::<_, String>(6)?, r.get::<_, String>(7)?, r.get(8)?, r.get(9)?, r.get(10)?, r.get::<_, String>(11)?),
        ))
    })?;
    let mut out = Vec::new();
    for row in rows {
        let ((insight_id, account_id, situation, level, episode, kind), (category, priority, first_seen_at, last_seen_at, dismissed_at, payload)) = row?;
        out.push(InsightRecord {
            insight_id,
            account_id,
            situation,
            level,
            episode,
            kind,
            category: match category.as_str() {
                "trend" => Category::Trend,
                "suggestion" => Category::Suggestion,
                _ => Category::Highlight,
            },
            priority: match priority.as_str() {
                "high" => Priority::High,
                "medium" => Priority::Medium,
                _ => Priority::Low,
            },
            first_seen_at,
            last_seen_at,
            dismissed_at,
            insight: serde_json::from_str(&payload).map_err(|e| CoreError::Invalid(format!("unreadable insight in history: {e}")))?,
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::test_support::{account, dec, instrument};
    use crate::trades::{self, Direction, TradeData};

    const DAY: i64 = 86_400_000;
    const MIN: i64 = 60_000;
    /// Tuesday 2026-09-29 00:00 UTC.
    const TUE: i64 = 20_725 * DAY;
    const NOW: i64 = TUE + 20 * 60 * MIN;

    fn closed(conn: &Connection, account_id: i64, day: i64, entry_min: i64, size: &str, exit: &str) -> i64 {
        let inst = instrument(conn, "TEST", "1");
        let mut t = TradeData::new(account_id, inst, Direction::Long, dec(size), dec("100"), TUE + day * DAY + entry_min * MIN);
        t.exit_price = Some(dec(exit));
        t.exit_time = Some(TUE + day * DAY + (entry_min + 10) * MIN);
        t.planned_sl = Some(dec("90"));
        trades::create(conn, &t).unwrap().id
    }

    /// A loss (risk 10) at 09:00, then 10 minutes after its exit a trade with twice the risk: a revenge trade.
    fn revenge_pair(conn: &Connection, account_id: i64, day: i64) -> [i64; 2] {
        [closed(conn, account_id, day, 9 * 60, "1", "95"), closed(conn, account_id, day, 9 * 60 + 20, "2", "105")]
    }

    fn ids(v: &[Insight]) -> Vec<&str> {
        v.iter().map(|i| i.id.as_str()).collect()
    }

    #[test]
    fn a_dismissed_insight_stays_hidden_until_it_gets_worse_or_a_new_episode_starts() {
        let conn = db::open_in_memory().unwrap();
        let a = account(&conn, "10000");
        revenge_pair(&conn, a, -3);
        revenge_pair(&conn, a, -2);
        let first = format!("revengePattern:{a}:revenge:2#1");

        let v = active_insights(&conn, &[], NOW, 0, false).unwrap();
        assert_eq!(ids(&v), [first.as_str()]);
        assert_eq!((v[0].episode, v[0].first_seen_at, v[0].dismissed_at), (1, Some(NOW), None));
        // Asked again (the page refreshes): same identity, logged once, first-seen instant kept.
        assert_eq!(active_insights(&conn, &[a], NOW + MIN, 0, false).unwrap(), v);
        let h = history(&conn, &[], 10).unwrap();
        assert_eq!((h.len(), h[0].first_seen_at, h[0].last_seen_at, h[0].kind.as_str()), (1, NOW, NOW + MIN, "revengePattern"));
        assert_eq!((h[0].category, h[0].priority, h[0].insight["count"].as_u64()), (Category::Trend, Priority::High, Some(2)));

        dismiss(&conn, &first, NOW + 2 * MIN).unwrap();
        dismiss(&conn, &first, NOW + 3 * MIN).unwrap();
        assert!(active_insights(&conn, &[], NOW + 4 * MIN, 0, false).unwrap().is_empty(), "dismissed: hidden");
        let all = active_insights(&conn, &[], NOW + 4 * MIN, 0, true).unwrap();
        assert_eq!((ids(&all), all[0].dismissed_at), (vec![first.as_str()], Some(NOW + 2 * MIN)), "first dismissal kept");

        // A third revenge trade: level 3, a worse situation → shown again.
        let third = revenge_pair(&conn, a, -1);
        let v = active_insights(&conn, &[], NOW + 5 * MIN, 0, false).unwrap();
        assert_eq!(ids(&v), [format!("revengePattern:{a}:revenge:3#1")]);
        dismiss(&conn, &v[0].id, NOW + 6 * MIN).unwrap();
        // Back to two: an improvement never shows a dismissed insight again.
        for id in third {
            trades::delete(&conn, id).unwrap();
        }
        assert!(active_insights(&conn, &[], NOW + 7 * MIN, 0, false).unwrap().is_empty());

        // Not seen for 20 days (the app was not opened): a new episode, shown again.
        let v = active_insights(&conn, &[], NOW + 20 * DAY, 0, false).unwrap();
        assert_eq!(ids(&v), [format!("revengePattern:{a}:revenge:2#2")]);
        assert_eq!(v[0].first_seen_at, Some(NOW + 20 * DAY));
        // Seen again the next day: same episode.
        assert_eq!(ids(&active_insights(&conn, &[], NOW + 21 * DAY, 0, false).unwrap()), ids(&v));
        // 100 days later the trades are out of the window: the situation is over, nothing shows.
        assert!(active_insights(&conn, &[], NOW + 100 * DAY, 0, true).unwrap().is_empty());
        let h = history(&conn, &[a], 10).unwrap();
        assert_eq!(
            h.iter().map(|r| (r.level, r.episode)).collect::<Vec<_>>(),
            [(2, 2), (3, 1), (2, 1)],
            "most recent first; the history outlives the deleted trades"
        );
        assert!(matches!(dismiss(&conn, "nope:1:x:0#1", NOW), Err(CoreError::NotFound(_))));
    }

    #[test]
    fn accounts_are_evaluated_separately_and_deleting_an_account_removes_its_history() {
        let conn = db::open_in_memory().unwrap();
        let a = account(&conn, "10000");
        let b = accounts::create(
            &conn,
            &accounts::NewAccount { name: "EUR".into(), kind: "personal".into(), broker: String::new(), currency: "EUR".into(), initial_capital: dec("5000") },
        )
        .unwrap()
        .id;
        // One revenge trade on each account: never two on the same one.
        revenge_pair(&conn, a, -3);
        let on_b = revenge_pair(&conn, b, -2);
        assert!(active_insights(&conn, &[], NOW, 0, true).unwrap().is_empty());
        // A second one on the EUR account only.
        let more = revenge_pair(&conn, b, -1);
        let v = active_insights(&conn, &[], NOW, 0, false).unwrap();
        assert_eq!(v.iter().map(|i| (i.account_id, i.currency.as_deref(), i.message_key)).collect::<Vec<_>>(), [(b, Some("EUR"), "revengePattern")]);
        assert!(active_insights(&conn, &[a], NOW, 0, false).unwrap().is_empty());
        // Archived accounts are left out by default, still readable when named.
        accounts::set_archived(&conn, b, true).unwrap();
        assert!(active_insights(&conn, &[], NOW, 0, false).unwrap().is_empty());
        assert_eq!(active_insights(&conn, &[b], NOW, 0, false).unwrap().len(), 1);
        assert_eq!((history(&conn, &[a], 10).unwrap().len(), history(&conn, &[b], 10).unwrap().len()), (0, 1));
        for id in on_b.into_iter().chain(more) {
            trades::delete(&conn, id).unwrap();
        }
        accounts::delete(&conn, b).unwrap();
        let left: i64 = conn.query_row("SELECT COUNT(*) FROM insight_log", [], |r| r.get(0)).unwrap();
        assert_eq!(left, 0);
    }
}
