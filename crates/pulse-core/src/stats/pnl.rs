//! Per-trade figures (spec 3.1.3, 3.3.1, 3.3.8; glossary section 7).
//!
//! - PnL brut  = (sortie − entrée) × sens × taille × multiplicateur
//! - PnL net   = PnL brut − frais (reference for every performance indicator)
//! - Risque initial = (entrée − SL prévu) × sens × taille × multiplicateur
//! - R-multiple = PnL net / risque initial. With zero fees this is exactly the
//!   glossary formula (sortie − entrée) × sens / |entrée − SL prévu|; the
//!   denominator is taken on the loss side, i.e. in absolute value, otherwise
//!   a short's R would have the wrong sign.
//! - Gagnant / perdant / breakeven: sign of the net PnL.

use crate::error::{CoreError, Result};
use crate::money::Decimal;
use crate::trades::{Direction, Trade};
use rust_decimal::prelude::ToPrimitive;
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Outcome {
    Win,
    Loss,
    Breakeven,
}

/// The price data a PnL is computed from.
#[derive(Debug, Clone, PartialEq)]
pub struct Position {
    pub direction: Direction,
    pub size: Decimal,
    pub multiplier: Decimal,
    pub entry_price: Decimal,
    pub exit_price: Option<Decimal>,
    pub planned_sl: Option<Decimal>,
    pub planned_tp: Option<Decimal>,
    pub fees: Decimal,
}

impl Position {
    pub fn of_trade(t: &Trade) -> Self {
        Position {
            direction: t.data.direction,
            size: t.data.size,
            multiplier: t.multiplier(),
            entry_price: t.data.entry_price,
            exit_price: t.data.exit_price,
            planned_sl: t.data.planned_sl,
            planned_tp: t.data.planned_tp,
            fees: t.data.fees,
        }
    }
}

/// Everything computed for one closed trade.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Figures {
    pub gross_pnl: Decimal,
    pub fees: Decimal,
    pub net_pnl: Decimal,
    /// Money lost if the planned stop had been hit; `None` without a valid planned SL.
    pub initial_risk: Option<Decimal>,
    pub r_multiple: Option<f64>,
    /// Theoretical R:R planned at entry: (TP − entry) / (entry − SL), on the trade's side.
    pub planned_reward_risk: Option<f64>,
    pub outcome: Outcome,
}

/// Figures of a closed trade; `None` while it is open (spec 3.1.1).
pub fn figures(p: &Position) -> Result<Option<Figures>> {
    let Some(exit) = p.exit_price else { return Ok(None) };
    let gross = gross_pnl(p.direction, p.entry_price, exit, p.size, p.multiplier)?;
    let net = checked(gross.checked_sub(p.fees))?;
    let risk = initial_risk(p.direction, p.entry_price, p.planned_sl, p.size, p.multiplier)?;
    Ok(Some(Figures {
        gross_pnl: gross,
        fees: p.fees,
        net_pnl: net,
        initial_risk: risk,
        r_multiple: r_multiple(net, risk),
        planned_reward_risk: planned_reward_risk(p.direction, p.entry_price, p.planned_sl, p.planned_tp),
        outcome: outcome(net),
    }))
}

pub fn gross_pnl(direction: Direction, entry: Decimal, exit: Decimal, size: Decimal, multiplier: Decimal) -> Result<Decimal> {
    let move_ = checked(exit.checked_sub(entry))?;
    checked(
        move_
            .checked_mul(direction.sign())
            .and_then(|v| v.checked_mul(size))
            .and_then(|v| v.checked_mul(multiplier)),
    )
}

/// `None` when there is no planned stop, or when it is not on the losing side of the entry.
pub fn initial_risk(
    direction: Direction,
    entry: Decimal,
    planned_sl: Option<Decimal>,
    size: Decimal,
    multiplier: Decimal,
) -> Result<Option<Decimal>> {
    let Some(sl) = planned_sl else { return Ok(None) };
    let per_unit = checked(entry.checked_sub(sl).and_then(|v| v.checked_mul(direction.sign())))?;
    if per_unit <= Decimal::ZERO {
        return Ok(None);
    }
    Ok(Some(checked(per_unit.checked_mul(size).and_then(|v| v.checked_mul(multiplier)))?))
}

pub fn r_multiple(net: Decimal, initial_risk: Option<Decimal>) -> Option<f64> {
    initial_risk.and_then(|risk| ratio(net, risk))
}

pub fn planned_reward_risk(
    direction: Direction,
    entry: Decimal,
    planned_sl: Option<Decimal>,
    planned_tp: Option<Decimal>,
) -> Option<f64> {
    let risk = entry.checked_sub(planned_sl?)?.checked_mul(direction.sign())?;
    let reward = planned_tp?.checked_sub(entry)?.checked_mul(direction.sign())?;
    if risk <= Decimal::ZERO || reward <= Decimal::ZERO {
        return None;
    }
    ratio(reward, risk)
}

pub fn outcome(net: Decimal) -> Outcome {
    if net > Decimal::ZERO {
        Outcome::Win
    } else if net < Decimal::ZERO {
        Outcome::Loss
    } else {
        Outcome::Breakeven
    }
}

/// a / b as a float; `None` when b is zero.
pub(crate) fn ratio(a: Decimal, b: Decimal) -> Option<f64> {
    if b.is_zero() {
        return None;
    }
    a.checked_div(b)?.to_f64()
}

/// Decimal arithmetic never panics in the core: an overflow (amounts beyond
/// ~7.9 × 10²⁸) becomes an error the UI can show.
pub(crate) fn checked(v: Option<Decimal>) -> Result<Decimal> {
    v.ok_or_else(|| CoreError::Invalid("amount too large to compute".into()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::dec;

    fn pos(direction: Direction, entry: &str, exit: &str, size: &str, mult: &str, sl: Option<&str>, fees: &str) -> Position {
        Position {
            direction,
            size: dec(size),
            multiplier: dec(mult),
            entry_price: dec(entry),
            exit_price: Some(dec(exit)),
            planned_sl: sl.map(dec),
            planned_tp: None,
            fees: dec(fees),
        }
    }

    /// The glossary formula, written independently: (exit − entry) × sens / |entry − SL|.
    fn glossary_r(direction: Direction, entry: &str, exit: &str, sl: &str) -> f64 {
        let (entry, exit, sl) = (dec(entry), dec(exit), dec(sl));
        ((exit - entry) * direction.sign() / (entry - sl).abs()).to_f64().unwrap()
    }

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-12
    }

    #[test]
    fn eurusd_long_from_the_mockup() {
        // 1.20 lots EURUSD, 1.0842 → 1.0871, SL 1.0824, TP 1.0888, fees 6.40, 100 000 per lot.
        let mut p = pos(Direction::Long, "1.0842", "1.0871", "1.20", "100000", Some("1.0824"), "6.40");
        p.planned_tp = Some(dec("1.0888"));
        let f = figures(&p).unwrap().unwrap();
        assert_eq!(f.gross_pnl, dec("348")); // 0.0029 × 1.20 × 100 000
        assert_eq!(f.net_pnl, dec("341.60"));
        assert_eq!(f.initial_risk, Some(dec("216"))); // 0.0018 × 120 000
        assert!(close(f.r_multiple.unwrap(), 341.60 / 216.0)); // 1.5814…
        assert!(close(f.planned_reward_risk.unwrap(), 46.0 / 18.0)); // 2.5555…
        assert_eq!(f.outcome, Outcome::Win);
    }

    #[test]
    fn short_trades_have_the_right_sign() {
        // Short 50 → 53, 20 units, SL 52, fees 4: gross −60, net −64, risk 40, R −1.6.
        let f = figures(&pos(Direction::Short, "50", "53", "20", "1", Some("52"), "4")).unwrap().unwrap();
        assert_eq!((f.gross_pnl, f.net_pnl, f.initial_risk), (dec("-60"), dec("-64"), Some(dec("40"))));
        assert!(close(f.r_multiple.unwrap(), -1.6));
        assert_eq!(f.outcome, Outcome::Loss);
        // A winning short: 80 → 70, SL 85 → R = +2.
        let w = figures(&pos(Direction::Short, "80", "70", "10", "1", Some("85"), "0")).unwrap().unwrap();
        assert_eq!(w.net_pnl, dec("100"));
        assert!(close(w.r_multiple.unwrap(), 2.0));
    }

    #[test]
    fn without_fees_r_equals_the_glossary_formula() {
        for (d, entry, exit, sl) in [
            (Direction::Long, "100", "110", "95"),
            (Direction::Long, "1.0842", "1.0801", "1.0824"),
            (Direction::Short, "80", "90", "85"),
            (Direction::Short, "2650.5", "2601.25", "2670"),
        ] {
            let f = figures(&pos(d, entry, exit, "3", "7", Some(sl), "0")).unwrap().unwrap();
            assert!(close(f.r_multiple.unwrap(), glossary_r(d, entry, exit, sl)), "{entry} → {exit}");
        }
    }

    #[test]
    fn fees_turn_a_flat_trade_into_a_loss() {
        let f = figures(&pos(Direction::Long, "100", "100", "1", "1", Some("90"), "2")).unwrap().unwrap();
        assert_eq!((f.gross_pnl, f.net_pnl, f.outcome), (dec("0"), dec("-2"), Outcome::Loss));
        assert!(close(f.r_multiple.unwrap(), -0.2));
        // A negative fee (swap credit) adds to the result.
        let c = figures(&pos(Direction::Long, "100", "100", "1", "1", None, "-1.5")).unwrap().unwrap();
        assert_eq!((c.net_pnl, c.outcome), (dec("1.5"), Outcome::Win));
    }

    #[test]
    fn breakeven_is_exactly_zero_net() {
        let f = figures(&pos(Direction::Short, "10", "10", "5", "1", Some("11"), "0")).unwrap().unwrap();
        assert_eq!(f.outcome, Outcome::Breakeven);
        assert_eq!(f.r_multiple, Some(0.0));
    }

    #[test]
    fn r_is_undefined_without_a_usable_stop() {
        let no_sl = figures(&pos(Direction::Long, "100", "110", "1", "1", None, "0")).unwrap().unwrap();
        assert_eq!((no_sl.initial_risk, no_sl.r_multiple, no_sl.planned_reward_risk), (None, None, None));
        let at_entry = figures(&pos(Direction::Long, "100", "110", "1", "1", Some("100"), "0")).unwrap().unwrap();
        assert_eq!(at_entry.r_multiple, None);
        let wrong_side = figures(&pos(Direction::Short, "100", "90", "1", "1", Some("95"), "0")).unwrap().unwrap();
        assert_eq!(wrong_side.r_multiple, None);
    }

    #[test]
    fn open_trades_have_no_figures() {
        let mut p = pos(Direction::Long, "100", "110", "1", "1", Some("90"), "0");
        p.exit_price = None;
        assert_eq!(figures(&p).unwrap(), None);
    }

    #[test]
    fn overflow_is_an_error_not_a_crash() {
        let mut p = pos(Direction::Long, "0", "2", "1", "1", None, "0");
        p.size = Decimal::MAX;
        assert!(matches!(figures(&p), Err(CoreError::Invalid(_))));
    }
}
