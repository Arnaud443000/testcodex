//! Position-size calculator (lot 27). See CLAUDE.md, "Calculateur de position".
//!
//! Pure exact-decimal arithmetic: the size is the wanted risk divided by the
//! money lost per unit of size at the stop, rounded DOWN to the size step, so the
//! real risk never exceeds the wanted risk. It is a calculation, never advice.

use crate::accounts;
use crate::error::Result;
use crate::instruments::{self, AssetClass};
use crate::money::Decimal;
use crate::settings;
use crate::stats::pnl;
use crate::stats::risk::within_limit;
use crate::stats::{load, replay};
use crate::trades::Direction;
use rusqlite::Connection;
use rust_decimal::RoundingStrategy;
use serde::{Deserialize, Serialize};

/// Wanted risk: a percentage of the balance (`1.5` = 1.5 %) or an amount in the account currency.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum RiskWanted {
    Percent(Decimal),
    Amount(Decimal),
}

#[derive(Debug, Clone, PartialEq)]
pub struct SizingInput {
    pub direction: Direction,
    pub entry: Decimal,
    pub stop: Decimal,
    pub take_profit: Option<Decimal>,
    pub risk: RiskWanted,
    /// Real balance of the account now.
    pub balance: Decimal,
    pub multiplier: Decimal,
    pub size_step: Decimal,
    pub size_step_is_default: bool,
    /// `behavior.max_risk_percent`.
    pub max_risk_percent: Option<Decimal>,
}

/// Why a calculation is refused; each has a translatable code.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Refusal {
    PriceNotPositive,
    StopEqualsEntry,
    StopWrongSide,
    RiskNotPositive,
    RiskPercentTooHigh,
    BalanceNotPositive,
    MultiplierNotPositive,
    StepNotPositive,
    /// The wanted risk is too small for the minimum step; carries the risk the minimum size would take.
    SizeZero { risk_at_minimum: Decimal },
    Overflow,
}

impl Refusal {
    pub fn code(&self) -> &'static str {
        match self {
            Refusal::PriceNotPositive => "priceNotPositive",
            Refusal::StopEqualsEntry => "stopEqualsEntry",
            Refusal::StopWrongSide => "stopWrongSide",
            Refusal::RiskNotPositive => "riskNotPositive",
            Refusal::RiskPercentTooHigh => "riskPercentTooHigh",
            Refusal::BalanceNotPositive => "balanceNotPositive",
            Refusal::MultiplierNotPositive => "multiplierNotPositive",
            Refusal::StepNotPositive => "stepNotPositive",
            Refusal::SizeZero { .. } => "sizeZero",
            Refusal::Overflow => "overflow",
        }
    }

    pub fn detail(&self) -> Option<String> {
        match self {
            Refusal::SizeZero { risk_at_minimum } => Some(risk_at_minimum.normalize().to_string()),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sizing {
    /// Size kept: the raw size rounded down to the step.
    pub size: Decimal,
    /// Exact size before rounding, cut (not rounded) to 8 decimals for display.
    pub raw_size: Decimal,
    pub size_step: Decimal,
    pub size_step_is_default: bool,
    pub multiplier: Decimal,
    pub balance: Decimal,
    /// Wanted risk in money, and in % of the balance (`None` without a positive balance), 4 decimals.
    pub risk_wanted: Decimal,
    pub risk_wanted_percent: Option<Decimal>,
    /// Real risk of the kept size, exact; `risk_actual_percent` is rounded to 4 decimals.
    pub risk_actual: Decimal,
    pub risk_actual_percent: Option<Decimal>,
    /// Wanted − real risk (≥ 0): only the rounding down.
    pub risk_gap: Decimal,
    /// |entry − stop|.
    pub stop_distance: Decimal,
    /// Gain if the take profit is hit, for the kept size.
    pub reward_amount: Option<Decimal>,
    pub reward_risk: Option<f64>,
    /// A take profit was given but is not on the winning side of the entry.
    pub take_profit_wrong_side: bool,
    pub max_risk_percent: Option<Decimal>,
    pub max_risk_amount: Option<Decimal>,
    /// Real risk over the limit (equality respects it); `false` without a limit or a positive balance.
    pub exceeds_max_risk: bool,
}

fn ck(v: Option<Decimal>) -> std::result::Result<Decimal, Refusal> {
    v.ok_or(Refusal::Overflow)
}

fn pct(part: Decimal, whole: Decimal) -> std::result::Result<Decimal, Refusal> {
    let v = ck(part.checked_mul(Decimal::ONE_HUNDRED).and_then(|v| v.checked_div(whole)))?;
    Ok(v.round_dp_with_strategy(4, RoundingStrategy::MidpointAwayFromZero))
}

pub fn size(i: &SizingInput) -> std::result::Result<Sizing, Refusal> {
    let zero = Decimal::ZERO;
    if i.entry <= zero || i.stop <= zero || i.take_profit.is_some_and(|t| t <= zero) {
        return Err(Refusal::PriceNotPositive);
    }
    let sign = i.direction.sign();
    let per_unit_price = ck(i.entry.checked_sub(i.stop))?;
    if per_unit_price.is_zero() {
        return Err(Refusal::StopEqualsEntry);
    }
    if ck(per_unit_price.checked_mul(sign))? < zero {
        return Err(Refusal::StopWrongSide);
    }
    let distance = per_unit_price.abs();
    let risk_wanted = match i.risk {
        RiskWanted::Amount(a) if a <= zero => return Err(Refusal::RiskNotPositive),
        RiskWanted::Percent(p) if p <= zero => return Err(Refusal::RiskNotPositive),
        RiskWanted::Percent(p) if p > Decimal::ONE_HUNDRED => return Err(Refusal::RiskPercentTooHigh),
        RiskWanted::Percent(_) if i.balance <= zero => return Err(Refusal::BalanceNotPositive),
        RiskWanted::Amount(a) => a,
        RiskWanted::Percent(p) => ck(p.checked_mul(i.balance).and_then(|v| v.checked_div(Decimal::ONE_HUNDRED)))?,
    };
    if i.multiplier <= zero {
        return Err(Refusal::MultiplierNotPositive);
    }
    if i.size_step <= zero {
        return Err(Refusal::StepNotPositive);
    }
    let per_unit_risk = ck(distance.checked_mul(i.multiplier))?;
    let raw = ck(risk_wanted.checked_div(per_unit_risk))?;
    let steps = ck(raw.checked_div(i.size_step))?.floor();
    let mut size = ck(steps.checked_mul(i.size_step))?;
    let mut risk_actual = ck(size.checked_mul(per_unit_risk))?;
    if risk_actual > risk_wanted {
        // The 28-digit division rounded up: never let the real risk exceed the wanted one.
        size = ck(size.checked_sub(i.size_step))?;
        risk_actual = ck(size.checked_mul(per_unit_risk))?;
    }
    if size <= zero {
        return Err(Refusal::SizeZero { risk_at_minimum: ck(i.size_step.checked_mul(per_unit_risk))? });
    }

    let positive_balance = i.balance > zero;
    let (reward_amount, reward_risk, tp_wrong) = match i.take_profit {
        None => (None, None, false),
        Some(tp) => {
            let reward_per_unit = ck(tp.checked_sub(i.entry).and_then(|v| v.checked_mul(sign)))?;
            if reward_per_unit <= zero {
                (None, None, true)
            } else {
                let amount = ck(size.checked_mul(reward_per_unit).and_then(|v| v.checked_mul(i.multiplier)))?;
                (Some(amount), pnl::planned_reward_risk(i.direction, i.entry, Some(i.stop), Some(tp)), false)
            }
        }
    };
    let max_risk_amount = match (i.max_risk_percent, positive_balance) {
        (Some(m), true) => Some(ck(m.checked_mul(i.balance).and_then(|v| v.checked_div(Decimal::ONE_HUNDRED)))?),
        _ => None,
    };
    let exceeds = within_limit(Some(risk_actual), i.balance, i.max_risk_percent).map_err(|_| Refusal::Overflow)? == Some(false);
    Ok(Sizing {
        size,
        raw_size: raw.round_dp_with_strategy(8, RoundingStrategy::ToZero),
        size_step: i.size_step,
        size_step_is_default: i.size_step_is_default,
        multiplier: i.multiplier,
        balance: i.balance,
        risk_wanted,
        risk_wanted_percent: if positive_balance { Some(pct(risk_wanted, i.balance)?) } else { None },
        risk_actual,
        risk_actual_percent: if positive_balance { Some(pct(risk_actual, i.balance)?) } else { None },
        risk_gap: ck(risk_wanted.checked_sub(risk_actual))?,
        stop_distance: distance,
        reward_amount,
        reward_risk,
        take_profit_wrong_side: tp_wrong,
        max_risk_percent: i.max_risk_percent,
        max_risk_amount,
        exceeds_max_risk: exceeds,
    })
}

/// Default size step per asset class (no column on `instruments`: see CLAUDE.md).
pub fn default_size_step(class: AssetClass) -> Decimal {
    match class {
        AssetClass::Forex | AssetClass::Index | AssetClass::Commodity | AssetClass::Other => Decimal::new(1, 2),
        AssetClass::Crypto => Decimal::new(1, 4),
        AssetClass::Stock | AssetClass::Future => Decimal::ONE,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RiskMode {
    Percent,
    Amount,
}

/// What the interface sends: the raw form values, as exact decimals.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SizingRequest {
    pub account_id: i64,
    pub instrument_id: i64,
    pub direction: Direction,
    pub entry_price: Decimal,
    pub stop_loss: Decimal,
    #[serde(default)]
    pub take_profit: Option<Decimal>,
    pub risk_mode: RiskMode,
    pub risk_value: Decimal,
    /// Overrides the instrument's multiplier.
    #[serde(default)]
    pub multiplier: Option<Decimal>,
    /// Overrides the default step of the asset class.
    #[serde(default)]
    pub size_step: Option<Decimal>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum SizingOutcome {
    Ok { result: Box<Sizing>, currency: String },
    Refused { code: String, detail: Option<String> },
}

/// Loads the account balance now, the instrument and the risk limit, then calculates.
pub fn calculate(conn: &Connection, req: &SizingRequest) -> Result<SizingOutcome> {
    let account = accounts::get(conn, req.account_id)?;
    let instrument = instruments::get(conn, req.instrument_id)?;
    let ledger = load(conn, &[req.account_id])?;
    let balance = replay(&ledger)?.final_balance;
    let input = SizingInput {
        direction: req.direction,
        entry: req.entry_price,
        stop: req.stop_loss,
        take_profit: req.take_profit,
        risk: match req.risk_mode {
            RiskMode::Percent => RiskWanted::Percent(req.risk_value),
            RiskMode::Amount => RiskWanted::Amount(req.risk_value),
        },
        balance,
        multiplier: req.multiplier.unwrap_or(instrument.default_multiplier),
        size_step: req.size_step.unwrap_or_else(|| default_size_step(instrument.asset_class)),
        size_step_is_default: req.size_step.is_none(),
        max_risk_percent: settings::behavior(conn)?.max_risk_percent,
    };
    Ok(match size(&input) {
        Ok(result) => SizingOutcome::Ok { result: Box::new(result), currency: account.currency },
        Err(r) => SizingOutcome::Refused { code: r.code().into(), detail: r.detail() },
    })
}

#[cfg(test)]
mod tests;
