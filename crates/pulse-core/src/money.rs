//! Exact decimal values (money, prices, sizes, multipliers).
//!
//! Stored in SQLite as TEXT in plain notation and exchanged with the UI as JSON
//! strings, so no amount ever goes through a binary float. Ratios (win rate,
//! R-multiple, Sharpe…) are plain `f64` and are computed from these values.

use crate::error::{CoreError, Result};
use rusqlite::Row;
use rusqlite::types::Type;
use std::str::FromStr;

pub use rust_decimal::Decimal;

/// Parses a decimal typed by the user or read from a file ("1.0842", "-12.5").
/// Surrounding spaces are ignored; exponents and thousands separators are not accepted.
pub fn parse(field: &str, input: &str) -> Result<Decimal> {
    let s = input.trim();
    let digits = s.strip_prefix('-').unwrap_or(s);
    let plain = digits.chars().any(|c| c.is_ascii_digit())
        && digits.chars().all(|c| c.is_ascii_digit() || c == '.')
        && digits.matches('.').count() <= 1;
    plain
        .then(|| Decimal::from_str(s).ok())
        .flatten()
        .ok_or_else(|| CoreError::Invalid(format!("{field} is not a valid number: {input:?}")))
}

/// Canonical TEXT form written to the database (plain notation, never "-0").
pub(crate) fn to_db(d: Decimal) -> String {
    if d.is_zero() { "0".into() } else { d.to_string() }
}

pub(crate) fn opt_to_db(d: Option<Decimal>) -> Option<String> {
    d.map(to_db)
}

pub(crate) fn col(r: &Row, i: usize) -> rusqlite::Result<Decimal> {
    let s: String = r.get(i)?;
    from_db(i, &s)
}

pub(crate) fn opt_col(r: &Row, i: usize) -> rusqlite::Result<Option<Decimal>> {
    let s: Option<String> = r.get(i)?;
    s.map(|s| from_db(i, &s)).transpose()
}

fn from_db(i: usize, s: &str) -> rusqlite::Result<Decimal> {
    Decimal::from_str(s).map_err(|e| rusqlite::Error::FromSqlConversionFailure(i, Type::Text, Box::new(e)))
}

pub(crate) fn require_positive(field: &str, d: Decimal) -> Result<()> {
    if d <= Decimal::ZERO {
        return Err(CoreError::Invalid(format!("{field} must be greater than zero")));
    }
    Ok(())
}

pub(crate) fn require_non_negative(field: &str, d: Decimal) -> Result<()> {
    if d < Decimal::ZERO {
        return Err(CoreError::Invalid(format!("{field} cannot be negative")));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_plain_decimals_exactly() {
        assert_eq!(parse("x", " 1.0842 ").unwrap().to_string(), "1.0842");
        assert_eq!(parse("x", "-12.50").unwrap().to_string(), "-12.50");
        // The classic float trap: 0.1 + 0.2 is exactly 0.3 here.
        assert_eq!(parse("x", "0.1").unwrap() + parse("x", "0.2").unwrap(), parse("x", "0.3").unwrap());
    }

    #[test]
    fn rejects_non_plain_numbers() {
        for bad in ["", "abc", "1e5", "1,5", "1 000", "NaN"] {
            assert!(parse("x", bad).is_err(), "{bad:?} should be rejected");
        }
    }

    #[test]
    fn db_form_is_plain_and_never_negative_zero() {
        assert_eq!(to_db(parse("x", "-0.00").unwrap()), "0");
        assert_eq!(to_db(parse("x", "100000").unwrap()), "100000");
        assert_eq!(to_db(parse("x", "0.00000001").unwrap()), "0.00000001");
    }

    #[test]
    fn crosses_json_as_a_string() {
        let d = parse("x", "1234.5600").unwrap();
        assert_eq!(serde_json::to_string(&d).unwrap(), "\"1234.5600\"");
        let back: Decimal = serde_json::from_str("\"1234.5600\"").unwrap();
        assert_eq!(back, d);
    }
}
