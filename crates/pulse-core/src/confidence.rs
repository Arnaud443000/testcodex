//! Confidence mode (spec 3.1.9): does the conviction declared *before* the
//! result predict the result? And do missed setups (spec 3.2.5) reveal a
//! recurring lack of confidence?
//!
//! Conventions:
//! - trades are grouped by conviction: low 1–3, medium 4–7, high 8–10;
//! - the correlation is Pearson's coefficient between the conviction and the
//!   R-multiple, over the closed trades that have both (a planned stop is needed
//!   for an R); undefined with fewer than 3 pairs or no variance;
//! - verdict: below `MIN_TRADES_FOR_VERDICT` such trades → not enough data;
//!   r ≥ `PREDICTIVE_R` → the conviction is predictive; r ≤ −`PREDICTIVE_R` →
//!   inverse (the trader is most confident when wrong); otherwise not predictive.

use crate::error::Result;
use crate::missed_trades;
use crate::money::Decimal;
use crate::period::{PeriodQuery, closed_trades};
use crate::stats::pnl::{Outcome, checked};
use rusqlite::Connection;
use serde::Serialize;

pub const MIN_TRADES_FOR_VERDICT: usize = 10;
pub const PREDICTIVE_R: f64 = 0.3;
/// A missed setup at this conviction or above was a setup the trader believed in.
pub const HIGH_CONVICTION: u8 = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Bucket {
    Low,
    Medium,
    High,
}

impl Bucket {
    pub const ALL: [Bucket; 3] = [Bucket::Low, Bucket::Medium, Bucket::High];

    pub fn of(conviction: u8) -> Bucket {
        match conviction {
            0..=3 => Bucket::Low,
            4..=7 => Bucket::Medium,
            _ => Bucket::High,
        }
    }

    fn range(self) -> (u8, u8) {
        match self {
            Bucket::Low => (1, 3),
            Bucket::Medium => (4, 7),
            Bucket::High => (8, 10),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Verdict {
    NotEnoughData,
    Predictive,
    NotPredictive,
    Inverse,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BucketStats {
    pub bucket: Bucket,
    pub min: u8,
    pub max: u8,
    pub trade_count: usize,
    pub win_count: usize,
    pub win_rate: Option<f64>,
    pub avg_net_pnl: Option<Decimal>,
    /// Mean R of the trades of the group that have one.
    pub avg_r: Option<f64>,
    pub r_trade_count: usize,
}

/// Missed setups set against the trades actually taken, over the same period.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MissedComparison {
    pub missed_count: usize,
    /// Missed setups with a declared conviction.
    pub missed_with_conviction: usize,
    pub missed_avg_conviction: Option<f64>,
    /// Mean conviction of the closed trades that have one.
    pub taken_avg_conviction: Option<f64>,
    /// Missed setups at conviction ≥ 8: setups believed in and still not taken.
    pub missed_high_conviction: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfidenceReport {
    pub currency: Option<String>,
    /// Closed trades with a conviction.
    pub rated_trade_count: usize,
    /// Always three groups: low, medium, high.
    pub buckets: Vec<BucketStats>,
    /// Pearson coefficient conviction × R, in [−1, 1].
    pub correlation: Option<f64>,
    /// Number of (conviction, R) pairs behind `correlation`.
    pub correlation_pairs: usize,
    pub verdict: Verdict,
    pub missed: MissedComparison,
}

pub fn report(conn: &Connection, q: &PeriodQuery) -> Result<ConfidenceReport> {
    let trades = closed_trades(conn, q)?;
    let rated: Vec<_> = trades
        .iter()
        .filter_map(|v| Some((v.trade.data.conviction?, v.figures.as_ref()?)))
        .collect();

    let buckets = Bucket::ALL
        .into_iter()
        .map(|bucket| {
            let group: Vec<_> = rated.iter().filter(|(c, _)| Bucket::of(*c) == bucket).collect();
            let wins = group.iter().filter(|(_, f)| f.outcome == Outcome::Win).count();
            let rs: Vec<f64> = group.iter().filter_map(|(_, f)| f.r_multiple).collect();
            let mut sum = Decimal::ZERO;
            for (_, f) in &group {
                sum = checked(sum.checked_add(f.net_pnl))?;
            }
            let (min, max) = bucket.range();
            Ok(BucketStats {
                bucket,
                min,
                max,
                trade_count: group.len(),
                win_count: wins,
                win_rate: (!group.is_empty()).then(|| wins as f64 / group.len() as f64),
                avg_net_pnl: if group.is_empty() { None } else { sum.checked_div(Decimal::from(group.len())) },
                avg_r: (!rs.is_empty()).then(|| rs.iter().sum::<f64>() / rs.len() as f64),
                r_trade_count: rs.len(),
            })
        })
        .collect::<Result<Vec<_>>>()?;

    let pairs: Vec<(f64, f64)> = rated.iter().filter_map(|(c, f)| Some((f64::from(*c), f.r_multiple?))).collect();
    let correlation = pearson(&pairs);
    let verdict = match correlation {
        Some(_) if pairs.len() < MIN_TRADES_FOR_VERDICT => Verdict::NotEnoughData,
        Some(r) if r >= PREDICTIVE_R => Verdict::Predictive,
        Some(r) if r <= -PREDICTIVE_R => Verdict::Inverse,
        Some(_) => Verdict::NotPredictive,
        None => Verdict::NotEnoughData,
    };

    let missed: Vec<_> = missed_trades::list(conn, &q.account_ids)?
        .into_iter()
        .filter(|m| q.contains(m.data.occurred_at))
        .collect();
    let convictions: Vec<f64> = missed.iter().filter_map(|m| m.data.conviction.map(f64::from)).collect();
    let taken: Vec<f64> = rated.iter().map(|(c, _)| f64::from(*c)).collect();
    let mean = |v: &[f64]| (!v.is_empty()).then(|| v.iter().sum::<f64>() / v.len() as f64);

    Ok(ConfidenceReport {
        currency: trades.first().map(|v| v.currency.clone()),
        rated_trade_count: rated.len(),
        buckets,
        correlation,
        correlation_pairs: pairs.len(),
        verdict,
        missed: MissedComparison {
            missed_count: missed.len(),
            missed_with_conviction: convictions.len(),
            missed_avg_conviction: mean(&convictions),
            taken_avg_conviction: mean(&taken),
            missed_high_conviction: missed.iter().filter(|m| m.data.conviction.is_some_and(|c| c >= HIGH_CONVICTION)).count(),
        },
    })
}

/// Pearson correlation coefficient; `None` under 3 pairs or when either series is constant.
pub fn pearson(pairs: &[(f64, f64)]) -> Option<f64> {
    if pairs.len() < 3 {
        return None;
    }
    let n = pairs.len() as f64;
    let (mx, my) = (pairs.iter().map(|p| p.0).sum::<f64>() / n, pairs.iter().map(|p| p.1).sum::<f64>() / n);
    let (mut sxy, mut sxx, mut syy) = (0.0, 0.0, 0.0);
    for (x, y) in pairs {
        sxy += (x - mx) * (y - my);
        sxx += (x - mx).powi(2);
        syy += (y - my).powi(2);
    }
    if sxx < 1e-12 || syy < 1e-12 {
        return None;
    }
    Some((sxy / (sxx.sqrt() * syy.sqrt())).clamp(-1.0, 1.0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::missed_trades::MissedTradeData;
    use crate::test_support::{account, dec, instrument};
    use crate::trades::{self, Direction, TradeData};

    #[test]
    fn pearson_known_values() {
        assert!((pearson(&[(1.0, 2.0), (2.0, 4.0), (3.0, 6.0)]).unwrap() - 1.0).abs() < 1e-12);
        assert!((pearson(&[(1.0, 6.0), (2.0, 4.0), (3.0, 2.0)]).unwrap() + 1.0).abs() < 1e-12);
        // x = 1,2,3,4,5 ; y = 2,1,4,3,5 → r = 0.8 (by hand: sxy = 8, sxx = 10, syy = 10).
        let r = pearson(&[(1.0, 2.0), (2.0, 1.0), (3.0, 4.0), (4.0, 3.0), (5.0, 5.0)]).unwrap();
        assert!((r - 0.8).abs() < 1e-12);
        assert_eq!(pearson(&[(1.0, 1.0), (1.0, 2.0), (1.0, 3.0)]), None, "constant conviction");
        assert_eq!(pearson(&[(1.0, 1.0), (2.0, 2.0)]), None, "two pairs are not enough");
        assert_eq!(pearson(&[]), None);
    }

    #[test]
    fn buckets_follow_the_documented_ranges() {
        let of: Vec<Bucket> = [1, 3, 4, 7, 8, 10].into_iter().map(Bucket::of).collect();
        assert_eq!(of, [Bucket::Low, Bucket::Low, Bucket::Medium, Bucket::Medium, Bucket::High, Bucket::High]);
    }

    /// Long, entry 100, planned stop 99, size 1, multiplier 1: risk 1, so R = net PnL.
    fn trade(conn: &rusqlite::Connection, a: i64, i: i64, conviction: Option<u8>, exit: &str, stop: bool) {
        let mut d = TradeData::new(a, i, Direction::Long, dec("1"), dec("100"), 1_000);
        d.multiplier = Some(dec("1"));
        d.planned_sl = stop.then(|| dec("99"));
        d.exit_price = Some(dec(exit));
        d.exit_time = Some(2_000);
        d.conviction = conviction;
        trades::create(conn, &d).unwrap();
    }

    fn missed(conn: &rusqlite::Connection, a: i64, i: i64, at: i64, conviction: Option<u8>) {
        missed_trades::create(
            conn,
            &MissedTradeData {
                account_id: a,
                instrument_id: i,
                direction: None,
                occurred_at: at,
                tz_offset_min: 0,
                reason: "peur".into(),
                notes: String::new(),
                conviction,
                tag_ids: vec![],
            },
        )
        .unwrap();
    }

    #[test]
    fn groups_results_by_conviction_and_measures_the_correlation() {
        let conn = db::open_in_memory().unwrap();
        let a = account(&conn, "10000");
        let i = instrument(&conn, "EURUSD", "1");
        // Conviction 2 → −1 R ; 3 → +1 ; 5 → +2 ; 6 → −1 ; 9 → +3 ; 10 → +5.  A trade without conviction is ignored.
        for (c, exit) in [(2, "99"), (3, "101"), (5, "102"), (6, "99"), (9, "103"), (10, "105")] {
            trade(&conn, a, i, Some(c), exit, true);
        }
        trade(&conn, a, i, None, "150", true);
        // Conviction but no stop: counts in its group, not in the correlation.
        trade(&conn, a, i, Some(9), "100.5", false);

        let r = report(&conn, &PeriodQuery::default()).unwrap();
        assert_eq!(r.rated_trade_count, 7);
        let [low, mid, high] = &r.buckets[..] else { panic!("three buckets") };
        assert_eq!((low.trade_count, low.win_count, low.win_rate), (2, 1, Some(0.5)));
        assert_eq!(low.avg_net_pnl, Some(dec("0")));
        assert_eq!(low.avg_r, Some(0.0));
        assert_eq!((mid.trade_count, mid.win_count, mid.avg_r), (2, 1, Some(0.5)));
        assert_eq!(mid.avg_net_pnl, Some(dec("0.5")));
        assert_eq!((high.trade_count, high.win_count, high.r_trade_count), (3, 3, 2));
        assert_eq!(high.avg_r, Some(4.0));
        assert_eq!(high.avg_net_pnl, Some(dec("8.5") / dec("3")));

        // Pairs (2,−1) (3,1) (5,2) (6,−1) (9,3) (10,5): mean x = 35/6, mean y = 9/6.
        assert_eq!(r.correlation_pairs, 6);
        let pairs = [(2.0, -1.0), (3.0, 1.0), (5.0, 2.0), (6.0, -1.0), (9.0, 3.0), (10.0, 5.0)];
        assert!((r.correlation.unwrap() - pearson(&pairs).unwrap()).abs() < 1e-12);
        // By hand: sxy = 29.5, sxx = 305/6, syy = 27.5  →  r = 29.5 / √(305/6 × 27.5) ≈ 0.789.
        assert!((r.correlation.unwrap() - 29.5 / (305.0_f64 / 6.0 * 27.5).sqrt()).abs() < 1e-9);
        // Only 6 pairs: below the 10 needed for a verdict.
        assert_eq!(r.verdict, Verdict::NotEnoughData);
    }

    #[test]
    fn the_verdict_needs_enough_trades_and_a_clear_coefficient() {
        let conn = db::open_in_memory().unwrap();
        let a = account(&conn, "10000");
        let i = instrument(&conn, "EURUSD", "1");
        // 10 trades where high conviction means losing: R = 11 − conviction … reversed.
        for c in 1..=10u8 {
            let exit = 99.0 + f64::from(11 - c); // conviction 10 → 100 (0 R), conviction 1 → 109
            trade(&conn, a, i, Some(c), &format!("{exit}"), true);
        }
        let r = report(&conn, &PeriodQuery::default()).unwrap();
        assert_eq!(r.correlation_pairs, 10);
        assert!((r.correlation.unwrap() + 1.0).abs() < 1e-9);
        assert_eq!(r.verdict, Verdict::Inverse);

        let conn = db::open_in_memory().unwrap();
        let a = account(&conn, "10000");
        let i = instrument(&conn, "EURUSD", "1");
        for c in 1..=10u8 {
            trade(&conn, a, i, Some(c), &format!("{}", 99 + u32::from(c)), true);
        }
        assert_eq!(report(&conn, &PeriodQuery::default()).unwrap().verdict, Verdict::Predictive);

        // Flat results whatever the conviction: no variance → no coefficient, not enough data.
        let conn = db::open_in_memory().unwrap();
        let a = account(&conn, "10000");
        let i = instrument(&conn, "EURUSD", "1");
        for c in 1..=10u8 {
            trade(&conn, a, i, Some(c), "101", true);
        }
        let r = report(&conn, &PeriodQuery::default()).unwrap();
        assert_eq!((r.correlation, r.verdict), (None, Verdict::NotEnoughData));
    }

    #[test]
    fn compares_missed_setups_with_the_trades_taken() {
        let conn = db::open_in_memory().unwrap();
        let a = account(&conn, "10000");
        let i = instrument(&conn, "EURUSD", "1");
        trade(&conn, a, i, Some(4), "101", true);
        trade(&conn, a, i, Some(8), "101", true);
        missed(&conn, a, i, 500, Some(9));
        missed(&conn, a, i, 600, Some(3));
        missed(&conn, a, i, 700, None);
        missed(&conn, a, i, 900_000, Some(10)); // outside the window below

        let all = report(&conn, &PeriodQuery::default()).unwrap().missed;
        assert_eq!((all.missed_count, all.missed_with_conviction, all.missed_high_conviction), (4, 3, 2));
        let window = report(&conn, &PeriodQuery { from: Some(0), to: Some(1_000), ..Default::default() }).unwrap().missed;
        assert_eq!((window.missed_count, window.missed_with_conviction, window.missed_high_conviction), (3, 2, 1));
        assert_eq!(window.missed_avg_conviction, Some(6.0));
        assert_eq!(window.taken_avg_conviction, None, "the trades closed at 2 000: outside the window");
        assert_eq!(all.taken_avg_conviction, Some(6.0));
    }

    #[test]
    fn an_empty_journal_gives_an_empty_report() {
        let conn = db::open_in_memory().unwrap();
        let r = report(&conn, &PeriodQuery::default()).unwrap();
        assert_eq!((r.rated_trade_count, r.correlation, r.verdict), (0, None, Verdict::NotEnoughData));
        assert!(r.buckets.iter().all(|b| b.trade_count == 0 && b.win_rate.is_none() && b.avg_net_pnl.is_none()));
        assert_eq!(r.missed.missed_count, 0);
    }
}
