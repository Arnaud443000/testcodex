//! Bloc « annonces du jour » de l'analyse : les événements de forte importance du calendrier économique
//! **déjà stocké** (lot 25), pour le jour de Paris, à l'heure de Paris. Lecture seule, aucune requête réseau.

use super::check_day;
use crate::error::Result;
use crate::news::store::{self, EventQuery};
use crate::news::zones::paris_day;
use crate::news::{Importance, settings};
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NewsBlockState {
    /// Le calendrier économique est éteint dans les réglages.
    Off,
    /// Calendrier allumé, aucune annonce forte ce jour-là.
    None,
    Events,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewsBlockEvent {
    pub id: i64,
    pub title: String,
    /// "" = non précisée.
    pub currency: String,
    /// Heure de Paris "HH:MM" ; `None` = sans heure.
    pub paris_time: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NewsBlock {
    pub state: NewsBlockState,
    /// Jour de Paris "AAAA-MM-JJ".
    pub day: String,
    pub events: Vec<NewsBlockEvent>,
}

/// Annonces fortes du jour de Paris `day` (`None` = jour de Paris de `now`).
pub fn news_block(conn: &rusqlite::Connection, day: Option<&str>, now: i64) -> Result<NewsBlock> {
    let day = match day {
        Some(d) => {
            check_day("day", d)?;
            d.to_string()
        }
        None => paris_day(now),
    };
    if !settings::get(conn)?.enabled {
        return Ok(NewsBlock { state: NewsBlockState::Off, day, events: Vec::new() });
    }
    let q = EventQuery { from_day: day.clone(), to_day: day.clone(), importances: vec![Importance::High], currencies: Vec::new() };
    let events: Vec<NewsBlockEvent> = store::list(conn, &q)?
        .into_iter()
        .map(|e| NewsBlockEvent { id: e.id, title: e.title, currency: e.currency, paris_time: e.paris_time })
        .collect();
    let state = if events.is_empty() { NewsBlockState::None } else { NewsBlockState::Events };
    Ok(NewsBlock { state, day, events })
}
