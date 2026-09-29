//! Replay of a trade (spec 3.7.4): quick browsing of the history, filterable by
//! the manual rating (3.1.8), with the screenshot (3.1.4), the thesis (3.2.1)
//! and the post-mortem (3.2.4). Only what Pulse already stores: no market data.
//! The "replay" of one trade is its price ladder — every level the trader
//! entered, from the planned stop to the price reached after the exit, each
//! expressed in R (multiples of the planned risk per unit of price).

use crate::error::Result;
use crate::money::Decimal;
use crate::stats::pnl::{Outcome, ratio};
use crate::trade_view::{self, TradeView};
use crate::trades::{Direction, TradeFilter};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};

/// Which trades to browse. All conditions must hold; the default lets everything through.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayFilter {
    /// Accounts (all when empty).
    #[serde(default)]
    pub account_ids: Vec<i64>,
    /// Manual rating at least / at most (1–5); trades without a rating do not pass a rating bound.
    #[serde(default)]
    pub min_rating: Option<u8>,
    #[serde(default)]
    pub max_rating: Option<u8>,
    /// Only the trades never rated.
    #[serde(default)]
    pub unrated_only: bool,
    #[serde(default)]
    pub outcome: Option<ReplayOutcome>,
    #[serde(default)]
    pub instrument_id: Option<i64>,
    /// Only trades that have a screenshot.
    #[serde(default)]
    pub with_screenshot: bool,
    /// Only trades with a written thesis or post-mortem.
    #[serde(default)]
    pub with_notes: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReplayOutcome {
    Win,
    Loss,
    Breakeven,
    Open,
}

/// One line of the browsing list.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayItem {
    pub trade_id: i64,
    pub symbol: String,
    pub direction: Direction,
    pub currency: String,
    pub entry_time: i64,
    pub exit_time: Option<i64>,
    /// `None` while the trade is open.
    pub net_pnl: Option<Decimal>,
    pub r_multiple: Option<f64>,
    pub outcome: Option<Outcome>,
    pub rating: Option<u8>,
    pub has_screenshot: bool,
    pub has_thesis: bool,
    pub has_post_mortem: bool,
}

fn item(v: &TradeView) -> ReplayItem {
    let d = &v.trade.data;
    ReplayItem {
        trade_id: v.trade.id,
        symbol: v.symbol.clone(),
        direction: d.direction,
        currency: v.currency.clone(),
        entry_time: d.entry_time,
        exit_time: d.exit_time,
        net_pnl: v.figures.as_ref().map(|f| f.net_pnl),
        r_multiple: v.figures.as_ref().and_then(|f| f.r_multiple),
        outcome: v.figures.as_ref().map(|f| f.outcome),
        rating: d.rating,
        has_screenshot: d.screenshot_path.is_some(),
        has_thesis: !d.thesis.trim().is_empty(),
        has_post_mortem: !d.post_mortem.trim().is_empty(),
    }
}

fn passes(v: &TradeView, f: &ReplayFilter) -> bool {
    let d = &v.trade.data;
    let outcome_ok = match f.outcome {
        None => true,
        Some(ReplayOutcome::Open) => v.figures.is_none(),
        Some(o) => v.figures.as_ref().is_some_and(|fig| {
            fig.outcome == match o {
                ReplayOutcome::Win => Outcome::Win,
                ReplayOutcome::Loss => Outcome::Loss,
                _ => Outcome::Breakeven,
            }
        }),
    };
    outcome_ok
        && f.min_rating.is_none_or(|m| d.rating.is_some_and(|r| r >= m))
        && f.max_rating.is_none_or(|m| d.rating.is_some_and(|r| r <= m))
        && (!f.unrated_only || d.rating.is_none())
        && f.instrument_id.is_none_or(|i| d.instrument_id == i)
        && (!f.with_screenshot || d.screenshot_path.is_some())
        && (!f.with_notes || !d.thesis.trim().is_empty() || !d.post_mortem.trim().is_empty())
}

/// The trades to browse, most recent entry first.
pub fn list(conn: &Connection, f: &ReplayFilter) -> Result<Vec<ReplayItem>> {
    let filter = TradeFilter { account_ids: f.account_ids.clone(), from: None, to: None, mistake: None };
    Ok(trade_view::list(conn, &filter)?.iter().filter(|v| passes(v, f)).map(item).collect())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum LevelKind {
    PlannedTp,
    ActualTp,
    PriceAfterExit,
    Exit,
    Entry,
    ActualSl,
    PlannedSl,
}

/// One rung of the price ladder.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Level {
    pub kind: LevelKind,
    pub price: Decimal,
    /// Distance from the entry, on the trade's side, in multiples of the planned risk
    /// per unit of price ((entry − planned stop) × direction). Negative against the trade.
    /// `None` without a valid planned stop. Price only: fees are not included.
    pub r: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplayCard {
    pub trade: TradeView,
    /// Highest price first, so a long reads from target down to stop.
    pub levels: Vec<Level>,
}

pub fn card(conn: &Connection, id: i64) -> Result<ReplayCard> {
    let trade = trade_view::get(conn, id)?;
    let levels = ladder(&trade);
    Ok(ReplayCard { trade, levels })
}

/// The levels the trader entered, each with its distance in R. Sorted by price, highest first.
pub fn ladder(v: &TradeView) -> Vec<Level> {
    let d = &v.trade.data;
    let sign = d.direction.sign();
    let risk_per_unit = d.planned_sl.and_then(|sl| d.entry_price.checked_sub(sl)).and_then(|x| x.checked_mul(sign)).filter(|r| *r > Decimal::ZERO);
    let level = |kind, price: Decimal| Level {
        kind,
        price,
        r: risk_per_unit.and_then(|risk| price.checked_sub(d.entry_price).and_then(|m| m.checked_mul(sign)).and_then(|m| ratio(m, risk))),
    };
    let mut levels = vec![level(LevelKind::Entry, d.entry_price)];
    let optional = [
        (LevelKind::PlannedSl, d.planned_sl),
        (LevelKind::PlannedTp, d.planned_tp),
        (LevelKind::ActualSl, d.actual_sl),
        (LevelKind::ActualTp, d.actual_tp),
        (LevelKind::Exit, d.exit_price),
        (LevelKind::PriceAfterExit, d.price_after_exit),
    ];
    levels.extend(optional.into_iter().filter_map(|(kind, price)| price.map(|p| level(kind, p))));
    // Highest price first; on a tie the entry stays on top of the others, then declaration order.
    levels.sort_by(|a, b| b.price.cmp(&a.price));
    levels
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::test_support::{account, dec, instrument};
    use crate::trades::{self, TradeData};

    fn base(a: i64, i: i64, dir: Direction, entry: &str, at: i64) -> TradeData {
        let mut t = TradeData::new(a, i, dir, dec("1"), dec(entry), at);
        t.multiplier = Some(dec("1"));
        t
    }

    fn levels_of(conn: &Connection, t: &TradeData) -> Vec<(LevelKind, Decimal, Option<f64>)> {
        let saved = trades::create(conn, t).unwrap();
        card(conn, saved.id).unwrap().levels.into_iter().map(|l| (l.kind, l.price, l.r)).collect()
    }

    #[test]
    fn the_ladder_of_a_long_reads_in_r() {
        let conn = db::open_in_memory().unwrap();
        let a = account(&conn, "10000");
        let i = instrument(&conn, "EURUSD", "1");
        // Entry 100, stop 98 (risk 2 per unit), target 106, exit 104, price after exit 110, stop hit later at 97.
        let mut t = base(a, i, Direction::Long, "100", 1_000);
        t.planned_sl = Some(dec("98"));
        t.planned_tp = Some(dec("106"));
        t.actual_sl = Some(dec("97"));
        t.exit_price = Some(dec("104"));
        t.exit_time = Some(2_000);
        t.price_after_exit = Some(dec("110"));
        let l = levels_of(&conn, &t);
        let kinds: Vec<LevelKind> = l.iter().map(|x| x.0).collect();
        assert_eq!(
            kinds,
            [LevelKind::PriceAfterExit, LevelKind::PlannedTp, LevelKind::Exit, LevelKind::Entry, LevelKind::PlannedSl, LevelKind::ActualSl]
        );
        let r = |k| l.iter().find(|x| x.0 == k).unwrap().2.unwrap();
        assert_eq!(r(LevelKind::Entry), 0.0);
        assert_eq!(r(LevelKind::PlannedSl), -1.0);
        assert_eq!(r(LevelKind::PlannedTp), 3.0);
        assert_eq!(r(LevelKind::Exit), 2.0);
        assert_eq!(r(LevelKind::PriceAfterExit), 5.0);
        assert_eq!(r(LevelKind::ActualSl), -1.5);
    }

    #[test]
    fn the_ladder_of_a_short_is_signed_on_the_trade_side() {
        let conn = db::open_in_memory().unwrap();
        let a = account(&conn, "10000");
        let i = instrument(&conn, "EURUSD", "1");
        // Short at 100, stop 104 (risk 4), target 92, exit 102 (a loss of 2 = −0.5 R).
        let mut t = base(a, i, Direction::Short, "100", 1_000);
        t.planned_sl = Some(dec("104"));
        t.planned_tp = Some(dec("92"));
        t.exit_price = Some(dec("102"));
        t.exit_time = Some(2_000);
        let l = levels_of(&conn, &t);
        let r = |k| l.iter().find(|x| x.0 == k).unwrap().2.unwrap();
        assert_eq!(r(LevelKind::PlannedSl), -1.0);
        assert_eq!(r(LevelKind::PlannedTp), 2.0);
        assert_eq!(r(LevelKind::Exit), -0.5);
        assert_eq!(l.first().unwrap().0, LevelKind::PlannedSl, "highest price first");
    }

    #[test]
    fn without_a_stop_the_levels_have_no_r_and_an_open_trade_has_only_what_is_set() {
        let conn = db::open_in_memory().unwrap();
        let a = account(&conn, "10000");
        let i = instrument(&conn, "EURUSD", "1");
        let mut t = base(a, i, Direction::Long, "100", 1_000);
        t.planned_tp = Some(dec("105"));
        let l = levels_of(&conn, &t);
        assert_eq!(l.iter().map(|x| (x.0, x.2)).collect::<Vec<_>>(), [(LevelKind::PlannedTp, None), (LevelKind::Entry, None)]);
        assert_eq!(levels_of(&conn, &base(a, i, Direction::Short, "50", 2_000)).len(), 1, "an entry alone");
    }

    fn rated(conn: &Connection, a: i64, i: i64, at: i64, rating: Option<u8>, exit: Option<&str>) -> i64 {
        let mut t = base(a, i, Direction::Long, "100", at);
        t.rating = rating;
        if let Some(e) = exit {
            t.exit_price = Some(dec(e));
            t.exit_time = Some(at + 1);
        }
        trades::create(conn, &t).unwrap().id
    }

    #[test]
    fn filters_the_history_by_rating_and_the_rest() {
        let conn = db::open_in_memory().unwrap();
        let a = account(&conn, "10000");
        let eu = instrument(&conn, "EURUSD", "1");
        let gu = instrument(&conn, "GBPUSD", "1");
        let t1 = rated(&conn, a, eu, 1_000, Some(1), Some("90")); // loss
        let t2 = rated(&conn, a, eu, 2_000, Some(3), Some("110")); // win
        let t3 = rated(&conn, a, gu, 3_000, Some(5), Some("110")); // win
        let t4 = rated(&conn, a, eu, 4_000, None, Some("100")); // breakeven, unrated
        let t5 = rated(&conn, a, gu, 5_000, None, None); // open, unrated
        let ids = |f: &ReplayFilter| list(&conn, f).unwrap().into_iter().map(|x| x.trade_id).collect::<Vec<_>>();

        assert_eq!(ids(&ReplayFilter::default()), [t5, t4, t3, t2, t1], "most recent entry first");
        assert_eq!(ids(&ReplayFilter { max_rating: Some(2), ..Default::default() }), [t1], "to review: at most 2 stars");
        assert_eq!(ids(&ReplayFilter { min_rating: Some(3), ..Default::default() }), [t3, t2]);
        assert_eq!(ids(&ReplayFilter { min_rating: Some(2), max_rating: Some(4), ..Default::default() }), [t2]);
        assert_eq!(ids(&ReplayFilter { unrated_only: true, ..Default::default() }), [t5, t4]);
        assert_eq!(ids(&ReplayFilter { outcome: Some(ReplayOutcome::Win), ..Default::default() }), [t3, t2]);
        assert_eq!(ids(&ReplayFilter { outcome: Some(ReplayOutcome::Loss), ..Default::default() }), [t1]);
        assert_eq!(ids(&ReplayFilter { outcome: Some(ReplayOutcome::Breakeven), ..Default::default() }), [t4]);
        assert_eq!(ids(&ReplayFilter { outcome: Some(ReplayOutcome::Open), ..Default::default() }), [t5]);
        assert_eq!(ids(&ReplayFilter { instrument_id: Some(gu), min_rating: Some(4), ..Default::default() }), [t3]);
        assert_eq!(ids(&ReplayFilter { account_ids: vec![999], ..Default::default() }), Vec::<i64>::new());
    }

    #[test]
    fn filters_on_screenshot_and_notes_and_reports_the_flags() {
        let conn = db::open_in_memory().unwrap();
        let a = account(&conn, "10000");
        let i = instrument(&conn, "EURUSD", "1");
        let mut plain = base(a, i, Direction::Long, "100", 1_000);
        plain.thesis = "  ".into();
        let plain = trades::create(&conn, &plain).unwrap().id;
        let mut rich = base(a, i, Direction::Long, "100", 2_000);
        rich.thesis = "Rejet".into();
        rich.screenshot_path = Some("screenshots/x.png".into());
        let rich = trades::create(&conn, &rich).unwrap().id;
        let mut noted = base(a, i, Direction::Long, "100", 3_000);
        noted.post_mortem = "Trop tôt".into();
        let noted = trades::create(&conn, &noted).unwrap().id;

        let ids = |f: ReplayFilter| list(&conn, &f).unwrap().into_iter().map(|x| x.trade_id).collect::<Vec<_>>();
        assert_eq!(ids(ReplayFilter { with_screenshot: true, ..Default::default() }), [rich]);
        assert_eq!(ids(ReplayFilter { with_notes: true, ..Default::default() }), [noted, rich]);
        let all = list(&conn, &ReplayFilter::default()).unwrap();
        let row = |id| all.iter().find(|x| x.trade_id == id).unwrap();
        assert_eq!((row(plain).has_screenshot, row(plain).has_thesis, row(plain).has_post_mortem), (false, false, false));
        assert_eq!((row(rich).has_screenshot, row(rich).has_thesis), (true, true));
        assert!(row(noted).has_post_mortem);
    }

    #[test]
    fn an_unknown_trade_has_no_card() {
        let conn = db::open_in_memory().unwrap();
        assert!(card(&conn, 42).is_err());
    }
}
