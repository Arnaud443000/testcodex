//! What the screens show about a trade: the stored data plus every figure
//! computed from it by `stats::pnl` (spec 3.1.1, 3.1.2, 3.3.18). Nothing here
//! is stored; the UI never recomputes any of it.

use crate::accounts;
use crate::error::Result;
use crate::instruments::{self, AssetClass};
use crate::money::Decimal;
use crate::stats::pnl::{self, Figures, Position};
use crate::stats::{self, StatsQuery};
use crate::trades::{self, Direction, Trade, TradeData, TradeFilter};
use rusqlite::Connection;
use serde::Serialize;
use std::collections::HashMap;

/// Standard session names, as seeded in the `session` tags (migrations 2 and 3).
pub const ASIA: &str = "Asie";
pub const LONDON: &str = "Londres";
pub const NEW_YORK: &str = "New York";

/// Session deduced from the entry instant (spec 3.1.1), by UTC hour so it does
/// not depend on the trader's time zone: Asia 22:00–07:00, London 07:00–13:00,
/// New York 13:00–22:00. The trader can always correct it by hand.
pub fn session_for(entry_time_ms: i64) -> &'static str {
    match (entry_time_ms.div_euclid(3_600_000)).rem_euclid(24) {
        7..=12 => LONDON,
        13..=21 => NEW_YORK,
        _ => ASIA,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum StopLoss {
    /// No planned stop: the "no stop loss" guard-rail applies (spec 3.6.6).
    Missing,
    /// A planned stop on the wrong side of the entry: risk and R are undefined.
    Invalid,
    Valid,
}

/// Live figures for the entry form.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Preview {
    /// `None` while the trade is open.
    pub figures: Option<Figures>,
    /// Money at risk if the planned stop is hit; known even for an open trade.
    pub initial_risk: Option<Decimal>,
    /// Initial risk as a percentage of the account's current capital.
    pub risk_pct_of_capital: Option<f64>,
    pub planned_reward_risk: Option<f64>,
    pub duration_ms: Option<i64>,
    pub session: &'static str,
    pub stop_loss: StopLoss,
    pub opportunity_cost: Option<Decimal>,
}

pub fn preview(conn: &Connection, d: &TradeData) -> Result<Preview> {
    let multiplier = match d.multiplier {
        Some(m) => m,
        None => instruments::get(conn, d.instrument_id)?.default_multiplier,
    };
    let position = Position {
        direction: d.direction,
        size: d.size,
        multiplier,
        entry_price: d.entry_price,
        exit_price: d.exit_price,
        planned_sl: d.planned_sl,
        planned_tp: d.planned_tp,
        fees: d.fees,
    };
    let initial_risk = pnl::initial_risk(d.direction, d.entry_price, d.planned_sl, d.size, multiplier)?;
    let risk_pct_of_capital = match initial_risk {
        Some(risk) => {
            let capital = stats::report(conn, &StatsQuery { account_ids: vec![d.account_id], ..Default::default() })?
                .current_capital;
            if capital > Decimal::ZERO { pnl::ratio(risk, capital).map(|r| r * 100.0) } else { None }
        }
        None => None,
    };
    Ok(Preview {
        figures: pnl::figures(&position)?,
        initial_risk,
        risk_pct_of_capital,
        planned_reward_risk: pnl::planned_reward_risk(d.direction, d.entry_price, d.planned_sl, d.planned_tp),
        duration_ms: duration(d.entry_time, d.exit_time),
        session: session_for(d.entry_time),
        stop_loss: match (d.planned_sl, initial_risk) {
            (None, _) => StopLoss::Missing,
            (Some(_), None) => StopLoss::Invalid,
            (Some(_), Some(_)) => StopLoss::Valid,
        },
        opportunity_cost: opportunity_cost(d.direction, d.exit_price, d.price_after_exit, d.size, multiplier)?,
    })
}

/// Money left on the table by exiting (spec 3.3.18): how far the price went in
/// the trade's favour after the exit, × size × multiplier. Negative when the
/// price went against the trade, i.e. the exit was well timed.
pub fn opportunity_cost(
    direction: Direction,
    exit: Option<Decimal>,
    after_exit: Option<Decimal>,
    size: Decimal,
    multiplier: Decimal,
) -> Result<Option<Decimal>> {
    let (Some(exit), Some(after)) = (exit, after_exit) else { return Ok(None) };
    pnl::gross_pnl(direction, exit, after, size, multiplier).map(Some)
}

fn duration(entry: i64, exit: Option<i64>) -> Option<i64> {
    exit.map(|e| e - entry)
}

/// A stored trade with its computed figures, for lists and the detail screen.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TradeView {
    #[serde(flatten)]
    pub trade: Trade,
    pub symbol: String,
    pub asset_class: AssetClass,
    pub account_name: String,
    pub currency: String,
    /// `None` while the trade is open.
    pub figures: Option<Figures>,
    pub initial_risk: Option<Decimal>,
    pub duration_ms: Option<i64>,
    pub opportunity_cost: Option<Decimal>,
}

pub fn list(conn: &Connection, filter: &TradeFilter) -> Result<Vec<TradeView>> {
    let instruments: HashMap<i64, _> = instruments::list(conn)?.into_iter().map(|i| (i.id, i)).collect();
    let accounts: HashMap<i64, _> = accounts::list(conn)?.into_iter().map(|a| (a.id, a)).collect();
    trades::list(conn, filter)?
        .into_iter()
        .map(|t| {
            let instrument = &instruments[&t.data.instrument_id];
            let account = &accounts[&t.data.account_id];
            let position = Position::of_trade(&t);
            let figures = pnl::figures(&position)?;
            Ok(TradeView {
                initial_risk: pnl::initial_risk(
                    position.direction,
                    position.entry_price,
                    position.planned_sl,
                    position.size,
                    position.multiplier,
                )?,
                duration_ms: duration(t.data.entry_time, t.data.exit_time),
                opportunity_cost: opportunity_cost(
                    position.direction,
                    position.exit_price,
                    t.data.price_after_exit,
                    position.size,
                    position.multiplier,
                )?,
                symbol: instrument.symbol.clone(),
                asset_class: instrument.asset_class,
                account_name: account.name.clone(),
                currency: account.currency.clone(),
                figures,
                trade: t,
            })
        })
        .collect()
}

pub fn get(conn: &Connection, id: i64) -> Result<TradeView> {
    let trade = trades::get(conn, id)?;
    let filter = TradeFilter { account_ids: vec![trade.data.account_id], ..Default::default() };
    list(conn, &filter)?
        .into_iter()
        .find(|v| v.trade.id == id)
        .ok_or_else(|| crate::CoreError::NotFound(format!("trade {id}")))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stats::pnl::Outcome;
    use crate::test_support::{account, dec, instrument};
    use crate::db;

    const H: i64 = 3_600_000;

    /// The EURUSD long of the mockup: 1.20 lots, 1.0842 → 1.0871, SL 1.0824, TP 1.0888, fees 6.40.
    fn mockup(conn: &Connection) -> TradeData {
        let mut d = TradeData::new(account(conn, "10000"), instrument(conn, "EURUSD", "100000"), Direction::Long, dec("1.20"), dec("1.0842"), 9 * H);
        d.exit_price = Some(dec("1.0871"));
        d.exit_time = Some(9 * H + 72 * 60_000);
        d.planned_sl = Some(dec("1.0824"));
        d.planned_tp = Some(dec("1.0888"));
        d.fees = dec("6.40");
        d
    }

    #[test]
    fn sessions_follow_the_utc_hour() {
        assert_eq!(session_for(0), ASIA);
        assert_eq!(session_for(6 * H + 59 * 60_000), ASIA);
        assert_eq!(session_for(7 * H), LONDON);
        assert_eq!(session_for(12 * H + 59 * 60_000), LONDON);
        assert_eq!(session_for(13 * H), NEW_YORK);
        assert_eq!(session_for(21 * H + 59 * 60_000), NEW_YORK);
        assert_eq!(session_for(22 * H), ASIA);
        assert_eq!(session_for(-H), ASIA); // 23:00 the day before 1970-01-01
        assert_eq!(session_for(24 * H + 8 * H), LONDON); // next day
    }

    #[test]
    fn preview_of_the_mockup_trade_matches_the_hand_calculation() {
        let conn = db::open_in_memory().unwrap();
        let d = mockup(&conn);
        let p = preview(&conn, &d).unwrap();
        let f = p.figures.unwrap();
        assert_eq!(f.gross_pnl, dec("348")); // 0.0029 × 1.20 × 100 000
        assert_eq!(f.net_pnl, dec("341.60"));
        assert_eq!(f.outcome, Outcome::Win);
        assert_eq!(p.initial_risk, Some(dec("216"))); // 0.0018 × 120 000
        assert!((f.r_multiple.unwrap() - 341.6 / 216.0).abs() < 1e-12);
        assert!((p.planned_reward_risk.unwrap() - 46.0 / 18.0).abs() < 1e-12);
        // Risk 216 on a 10 000 account = 2.16 %
        assert!((p.risk_pct_of_capital.unwrap() - 2.16).abs() < 1e-12);
        assert_eq!(p.duration_ms, Some(72 * 60_000));
        assert_eq!(p.session, LONDON); // 09:00 UTC
        assert_eq!(p.stop_loss, StopLoss::Valid);
        assert_eq!(p.opportunity_cost, None);
    }

    #[test]
    fn preview_of_an_open_trade_has_risk_but_no_result() {
        let conn = db::open_in_memory().unwrap();
        let mut d = mockup(&conn);
        d.exit_price = None;
        d.exit_time = None;
        let p = preview(&conn, &d).unwrap();
        assert!(p.figures.is_none());
        assert_eq!(p.initial_risk, Some(dec("216")));
        assert_eq!(p.duration_ms, None);
    }

    #[test]
    fn missing_or_wrong_side_stop_is_reported() {
        let conn = db::open_in_memory().unwrap();
        let mut d = mockup(&conn);
        d.planned_sl = None;
        let p = preview(&conn, &d).unwrap();
        assert_eq!((p.stop_loss, p.initial_risk, p.risk_pct_of_capital), (StopLoss::Missing, None, None));
        assert!(p.figures.unwrap().r_multiple.is_none());
        d.planned_sl = Some(dec("1.0900")); // above the entry of a long
        let p = preview(&conn, &d).unwrap();
        assert_eq!((p.stop_loss, p.initial_risk), (StopLoss::Invalid, None));
    }

    #[test]
    fn opportunity_cost_is_signed_by_the_trade_direction() {
        // Long exited 1.0871, price reached 1.0889 afterwards: 0.0018 × 1.20 × 100 000 = 216 left on the table.
        let long = opportunity_cost(Direction::Long, Some(dec("1.0871")), Some(dec("1.0889")), dec("1.20"), dec("100000")).unwrap();
        assert_eq!(long, Some(dec("216")));
        // Short exited at 50, price went down to 47 afterwards: 3 × 10 × 1 = 30 left.
        let short = opportunity_cost(Direction::Short, Some(dec("50")), Some(dec("47")), dec("10"), dec("1")).unwrap();
        assert_eq!(short, Some(dec("30")));
        // Price went against the trade after the exit: negative (good exit).
        let good = opportunity_cost(Direction::Long, Some(dec("100")), Some(dec("98")), dec("1"), dec("1")).unwrap();
        assert_eq!(good, Some(dec("-2")));
        assert_eq!(opportunity_cost(Direction::Long, Some(dec("1")), None, dec("1"), dec("1")).unwrap(), None);
        assert_eq!(opportunity_cost(Direction::Long, None, Some(dec("1")), dec("1"), dec("1")).unwrap(), None);
    }

    #[test]
    fn the_view_of_a_stored_trade_carries_the_same_figures_as_the_preview() {
        let conn = db::open_in_memory().unwrap();
        let mut d = mockup(&conn);
        d.price_after_exit = Some(dec("1.0889"));
        let saved = trades::create(&conn, &d).unwrap();
        let v = get(&conn, saved.id).unwrap();
        assert_eq!(v.symbol, "EURUSD");
        assert_eq!(v.currency, "USD");
        assert_eq!(v.figures, preview(&conn, &d).unwrap().figures);
        assert_eq!(v.initial_risk, Some(dec("216")));
        assert_eq!(v.opportunity_cost, Some(dec("216")));
        assert_eq!(v.duration_ms, Some(72 * 60_000));
        assert_eq!(list(&conn, &TradeFilter::default()).unwrap().len(), 1);
    }

    #[test]
    fn view_json_flattens_the_trade_and_keeps_decimals_as_strings() {
        let conn = db::open_in_memory().unwrap();
        let saved = trades::create(&conn, &mockup(&conn)).unwrap();
        let json = serde_json::to_value(get(&conn, saved.id).unwrap()).unwrap();
        assert_eq!(json["entryPrice"], "1.0842");
        // A string, equal to 341.60 (the scale may carry trailing zeros: the UI trims them).
        assert_eq!(dec(json["figures"]["netPnl"].as_str().unwrap()), dec("341.60"));
        assert_eq!(json["figures"]["outcome"], "win");
        assert_eq!(json["symbol"], "EURUSD");
    }

    #[test]
    fn unknown_trade_is_not_found() {
        let conn = db::open_in_memory().unwrap();
        assert!(matches!(get(&conn, 42), Err(crate::CoreError::NotFound(_))));
    }
}
