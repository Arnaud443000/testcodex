//! Distribution of R-multiples (spec 3.3.8), weekday × hour heatmap, and
//! long vs short (3.3.10). See CLAUDE.md, "Statistiques complémentaires".

use super::pnl::{Outcome, checked};
use super::segments::{SegmentBy, split};
use super::summary::{Summary, analyze};
use super::{Closed, Ledger, StatsQuery, load, replay, time};
use crate::error::Result;
use crate::money::Decimal;
use rusqlite::Connection;
use serde::Serialize;
use std::collections::BTreeMap;

/// Width of an R class.
pub const R_BIN_WIDTH: f64 = 0.5;
/// Classes run from −3 R to +5 R, with an open class on each side.
pub const R_LOW: f64 = -3.0;
pub const R_HIGH: f64 = 5.0;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RBin {
    /// Lower bound, included; `None` for the open class below [`R_LOW`].
    pub from: Option<f64>,
    /// Upper bound, excluded; `None` for the open class from [`R_HIGH`].
    pub to: Option<f64>,
    pub count: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RDistribution {
    pub bin_width: f64,
    /// Every class, empty ones included, from the lowest to the highest.
    pub bins: Vec<RBin>,
    pub r_trade_count: usize,
    /// Closed trades without an R (no valid planned stop).
    pub no_r_count: usize,
    /// Equal to the expectancy in R.
    pub mean_r: Option<f64>,
    pub median_r: Option<f64>,
}

/// Median; the mean of the two middle values for an even count.
pub(crate) fn median(mut v: Vec<f64>) -> Option<f64> {
    if v.is_empty() {
        return None;
    }
    v.sort_by(f64::total_cmp);
    let n = v.len();
    Some(if n % 2 == 1 { v[n / 2] } else { (v[n / 2 - 1] + v[n / 2]) / 2.0 })
}

pub(crate) fn distribution_of(set: &[&Closed]) -> RDistribution {
    let inner = ((R_HIGH - R_LOW) / R_BIN_WIDTH) as usize;
    let mut bins: Vec<RBin> = Vec::with_capacity(inner + 2);
    bins.push(RBin { from: None, to: Some(R_LOW), count: 0 });
    for k in 0..inner {
        let from = R_LOW + k as f64 * R_BIN_WIDTH;
        bins.push(RBin { from: Some(from), to: Some(from + R_BIN_WIDTH), count: 0 });
    }
    bins.push(RBin { from: Some(R_HIGH), to: None, count: 0 });

    let rs: Vec<f64> = set.iter().filter_map(|c| c.figures.r_multiple).collect();
    for &r in &rs {
        let i = if r < R_LOW {
            0
        } else if r >= R_HIGH {
            inner + 1
        } else {
            // r / 0.5 = r × 2 is exact in binary floating point: no class-edge rounding.
            1 + ((r / R_BIN_WIDTH).floor() - R_LOW / R_BIN_WIDTH) as usize
        };
        bins[i].count += 1;
    }
    RDistribution {
        bin_width: R_BIN_WIDTH,
        bins,
        r_trade_count: rs.len(),
        no_r_count: set.len() - rs.len(),
        mean_r: (!rs.is_empty()).then(|| rs.iter().sum::<f64>() / rs.len() as f64),
        median_r: median(rs),
    }
}

pub fn r_distribution(ledger: &Ledger, query: &StatsQuery) -> Result<RDistribution> {
    Ok(distribution_of(&replay(ledger)?.selected(query)))
}

pub fn r_distribution_report(conn: &Connection, query: &StatsQuery) -> Result<RDistribution> {
    r_distribution(&load(conn, &query.account_ids)?, query)
}

// --- Weekday × hour heatmap --------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HeatCell {
    /// Local entry weekday: 1 = Monday … 7 = Sunday.
    pub weekday: u8,
    /// Local entry hour, 0–23.
    pub hour: u8,
    pub trade_count: usize,
    pub win_count: usize,
    pub net_pnl: Decimal,
    pub win_rate: Option<f64>,
    /// Net PnL / the largest absolute net PnL of a cell, in [−1, 1].
    pub intensity: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Heatmap {
    /// Only the cells with trades, by weekday then hour.
    pub cells: Vec<HeatCell>,
    pub max_abs_net_pnl: Decimal,
}

pub fn heatmap(ledger: &Ledger, query: &StatsQuery) -> Result<Heatmap> {
    let r = replay(ledger)?;
    let mut cells: BTreeMap<(u8, u8), HeatCell> = BTreeMap::new();
    for c in r.selected(query) {
        let t = c.facts;
        let (weekday, hour) = (time::weekday(t.entry_time, t.tz_offset_min), time::hour(t.entry_time, t.tz_offset_min));
        let cell = cells.entry((weekday, hour)).or_insert(HeatCell {
            weekday,
            hour,
            trade_count: 0,
            win_count: 0,
            net_pnl: Decimal::ZERO,
            win_rate: None,
            intensity: 0.0,
        });
        cell.trade_count += 1;
        cell.win_count += usize::from(c.figures.outcome == Outcome::Win);
        cell.net_pnl = checked(cell.net_pnl.checked_add(c.figures.net_pnl))?;
    }
    let max_abs = cells.values().map(|c| c.net_pnl.abs()).max().unwrap_or_default();
    let cells = cells
        .into_values()
        .map(|mut c| {
            c.win_rate = Some(c.win_count as f64 / c.trade_count as f64);
            c.intensity = super::pnl::ratio(c.net_pnl, max_abs).unwrap_or(0.0).clamp(-1.0, 1.0);
            c
        })
        .collect();
    Ok(Heatmap { cells, max_abs_net_pnl: max_abs })
}

pub fn heatmap_report(conn: &Connection, query: &StatsQuery) -> Result<Heatmap> {
    heatmap(&load(conn, &query.account_ids)?, query)
}

// --- Long vs short (3.3.10) -----------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LongShort {
    pub long: Summary,
    pub short: Summary,
    /// Longs / closed trades.
    pub long_share: Option<f64>,
}

pub fn long_short(ledger: &Ledger, query: &StatsQuery) -> Result<LongShort> {
    let r = replay(ledger)?;
    let set = r.selected(query);
    let segments = split(&set, SegmentBy::Direction, query.risk_free_daily)?;
    let side = |key: &str| -> Result<Summary> {
        match segments.iter().find(|s| s.key == key) {
            Some(s) => Ok(s.summary.clone()),
            None => Ok(analyze(&[], query.risk_free_daily)?.summary),
        }
    };
    let long = side("long")?;
    let long_share = (!set.is_empty()).then(|| long.trade_count as f64 / set.len() as f64);
    Ok(LongShort { long, short: side("short")?, long_share })
}

pub fn long_short_report(conn: &Connection, query: &StatsQuery) -> Result<LongShort> {
    long_short(&load(conn, &query.account_ids)?, query)
}
