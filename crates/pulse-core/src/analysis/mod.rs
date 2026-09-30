//! Analyse avant trading et idées à surveiller (lot 31). Que des règles déterministes, aucune IA, aucun
//! réseau : ce sont des textes que le trader écrit pour lui, relus le lendemain (voir CLAUDE.md,
//! « Analyse avant trading (lot 31) »).
//!
//! * [`questions`] : le modèle de questions (archivage, jamais de suppression) ;
//! * [`sessions`] : les analyses de séance (fiches datées, réponses guidées) ;
//! * [`news_block`] : le bloc « annonces du jour », lu dans le calendrier déjà stocké ;
//! * [`ideas`] : les idées à surveiller et leur fil de notes ;
//! * [`review`] : la revue du lendemain, le report, l'ancienneté, les réglages ;
//! * [`links`] : liens avec les trades ; [`report`] : le constat « est-ce que j'analyse bien ? ».
//!
//! Jour local : toujours calculé avec le décalage `tz_offset_min` fourni par l'appelant (le PC), jamais en UTC.

pub mod ideas;
pub mod links;
pub mod news_block;
pub mod questions;
pub mod report;
pub mod review;
pub mod sessions;

pub use ideas::{Idea, IdeaInput, IdeaNote, IdeaOutcome, IdeaStatus, IdeaView};
pub use links::{AnalysisLink, IdeaLink, TradeLinks};
pub use news_block::{NewsBlock, NewsBlockEvent, NewsBlockState};
pub use questions::{Question, QuestionKind};
pub use report::{IdeaOutcomes, LinkedComparison, LinkedSide, AnalysisReport};
pub use review::{AnalysisSettings, ReviewBanner, ReviewQueue};
pub use sessions::{Analysis, AnalysisInput, Answer, AnswerInput};

use crate::error::{CoreError, Result};
use crate::stats::time;

/// Unités de temps proposées (ordre d'affichage).
pub const TIMEFRAMES: [&str; 6] = ["monthly", "weekly", "daily", "h4", "h1", "m15"];
/// Échantillon minimal des comparaisons (même seuil que le reste de Pulse).
pub const MIN_SAMPLE: usize = 5;
/// Idées montrées d'abord dans la revue du matin ; les autres sont derrière « Voir les N autres ».
pub const REVIEW_VISIBLE: usize = 5;
pub const MIN_SNOOZE_DAYS: u32 = 1;
pub const MAX_SNOOZE_DAYS: u32 = 30;
pub const DEFAULT_STALE_DAYS: u32 = 7;
pub const MIN_STALE_DAYS: u32 = 1;
pub const MAX_STALE_DAYS: u32 = 60;

pub(crate) fn day_of(ms: i64, tz_offset_min: i32) -> String {
    time::day_key(ms, tz_offset_min)
}

pub(crate) fn day_number(ms: i64, tz_offset_min: i32) -> i64 {
    time::local_day_number(ms, tz_offset_min)
}

/// "AAAA-MM-JJ" du jour numéro `n` (jours depuis 1970-01-01).
pub(crate) fn day_key_of(n: i64) -> String {
    let (y, m, d) = time::civil_from_days(n);
    format!("{y:04}-{m:02}-{d:02}")
}

pub(crate) fn check_day(field: &str, day: &str) -> Result<i64> {
    time::parse_day(day).ok_or_else(|| CoreError::Invalid(format!("{field} must be a day YYYY-MM-DD")))
}

/// Texte libre : espaces de bord retirés, vide = `None`, longueur limitée (en caractères).
pub(crate) fn opt_text(field: &str, s: Option<&str>, max: usize) -> Result<Option<String>> {
    let Some(t) = s.map(str::trim).filter(|t| !t.is_empty()) else { return Ok(None) };
    if t.chars().count() > max {
        return Err(CoreError::Invalid(format!("{field} is limited to {max} characters")));
    }
    Ok(Some(t.to_string()))
}

#[cfg(test)]
mod tests;
