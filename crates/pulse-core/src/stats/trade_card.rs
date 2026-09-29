//! Figures of the shareable trade card (spec 3.7.7, lot 24).
//!
//! The card shows a result in R and in percent, never a balance. The percent is
//! the trade's return as the statistics engine already defines it
//! (`Closed::ret`): net PnL / real balance of the account just before the trade
//! closed, deposits and withdrawals included in that balance and never counted
//! as performance. The balance itself is not returned: only the ratio leaves
//! this module. `net_pnl` is returned because the user may tick « show the PnL
//! in money »; the interface never displays it otherwise.

use super::{load, replay};
use crate::error::{CoreError, Result};
use crate::money::Decimal;
use crate::stats::pnl::Outcome;
use crate::trades;
use rusqlite::Connection;
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TradeCardFigures {
    pub trade_id: i64,
    /// `false` while the trade is open: every figure below is then `None`.
    pub closed: bool,
    pub outcome: Option<Outcome>,
    /// `None` without a valid planned stop.
    pub r_multiple: Option<f64>,
    /// Net PnL / balance just before the exit (0.012 = +1.2 %); `None` when that balance is not positive.
    pub return_fraction: Option<f64>,
    pub net_pnl: Option<Decimal>,
}

pub fn trade_card_figures(conn: &Connection, trade_id: i64) -> Result<TradeCardFigures> {
    let trade = trades::get(conn, trade_id)?;
    let ledger = load(conn, &[trade.data.account_id])?;
    let r = replay(&ledger)?;
    match r.closed.iter().find(|c| c.facts.id == trade_id) {
        Some(c) => Ok(TradeCardFigures {
            trade_id,
            closed: true,
            outcome: Some(c.figures.outcome),
            r_multiple: c.figures.r_multiple,
            return_fraction: c.ret,
            net_pnl: Some(c.figures.net_pnl),
        }),
        None if ledger.trades.iter().any(|t| t.id == trade_id) => {
            Ok(TradeCardFigures { trade_id, closed: false, outcome: None, r_multiple: None, return_fraction: None, net_pnl: None })
        }
        None => Err(CoreError::NotFound(format!("trade {trade_id}"))),
    }
}

/// The card is a 1080 px PNG: a few MB at most. Larger is refused (a wrong file, not a card).
pub const MAX_IMAGE_BYTES: usize = 20 * 1024 * 1024;

/// Writes the PNG drawn by the interface (`image`: base64 or a `data:` URL) to the path the user
/// chose in the native « save as » dialog, which already asks before replacing a file. The file
/// is written next to its destination and renamed, so a failure never leaves a half-written card
/// nor destroys an existing file. Returns the size written, in bytes.
pub fn write_png(path: &std::path::Path, image: &str) -> Result<usize> {
    let invalid = |m: &str| CoreError::Invalid(m.into());
    let bytes = crate::screenshots::decode(image)?;
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err(invalid("the card image is not a PNG file"));
    }
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(invalid("the card image is larger than 20 MB"));
    }
    if !path.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("png")) {
        return Err(invalid("the card file must end with .png"));
    }
    if path.is_dir() {
        return Err(invalid("the destination is a folder"));
    }
    let tmp = path.with_extension("png.pulse-tmp");
    std::fs::write(&tmp, &bytes)?;
    if let Err(e) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e.into());
    }
    Ok(bytes.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use crate::test_support::{account, dec, instrument};
    use crate::trades::{Direction, TradeData};

    const H: i64 = 3_600_000;

    fn add(conn: &Connection, acc: i64, ins: i64, dir: Direction, size: &str, entry: &str, exit: Option<&str>, sl: Option<&str>, fees: &str, day: i64) -> i64 {
        let mut d = TradeData::new(acc, ins, dir, dec(size), dec(entry), day * 24 * H + 9 * H);
        d.exit_price = exit.map(dec);
        d.exit_time = exit.map(|_| day * 24 * H + 10 * H);
        d.planned_sl = sl.map(dec);
        d.fees = dec(fees);
        trades::create(conn, &d).unwrap().id
    }

    /// Capital 10 000, multiplier 1 (`account`/`instrument` helpers).
    /// 1) long 100 → 110, size 10, SL 95, no fees: net +100, risk 50, R +2, balance before 10 000 → +1 %.
    /// 2) short 50 → 53, size 20, SL 52, fees 4: gross −60, net −64, risk 40, R −1.6, balance before 10 100 → −64 / 10 100.
    /// 3) long 20 → 26, size 50, no SL, fees 6: net +294, R None, balance before 10 036 → 294 / 10 036.
    /// 4) long 30, open: nothing.
    #[test]
    fn known_result_journal() {
        let conn = db::open_in_memory().unwrap();
        let (acc, ins) = (account(&conn, "10000"), instrument(&conn, "TEST", "1"));
        let t1 = add(&conn, acc, ins, Direction::Long, "10", "100", Some("110"), Some("95"), "0", 1);
        let t2 = add(&conn, acc, ins, Direction::Short, "20", "50", Some("53"), Some("52"), "4", 2);
        let t3 = add(&conn, acc, ins, Direction::Long, "50", "20", Some("26"), None, "6", 3);
        let t4 = add(&conn, acc, ins, Direction::Long, "1", "30", None, None, "0", 4);

        let a = trade_card_figures(&conn, t1).unwrap();
        assert!(a.closed && a.outcome == Some(Outcome::Win));
        assert_eq!(a.r_multiple, Some(2.0));
        assert!((a.return_fraction.unwrap() - 0.01).abs() < 1e-12);
        assert_eq!(a.net_pnl, Some(dec("100")));

        let b = trade_card_figures(&conn, t2).unwrap();
        assert_eq!(b.outcome, Some(Outcome::Loss));
        assert!((b.r_multiple.unwrap() + 1.6).abs() < 1e-12);
        assert!((b.return_fraction.unwrap() - (-64.0 / 10_100.0)).abs() < 1e-12);

        let c = trade_card_figures(&conn, t3).unwrap();
        assert_eq!(c.r_multiple, None, "no stop, no R");
        assert!((c.return_fraction.unwrap() - 294.0 / 10_036.0).abs() < 1e-12);

        let d = trade_card_figures(&conn, t4).unwrap();
        assert_eq!((d.closed, d.outcome, d.r_multiple, d.return_fraction, d.net_pnl), (false, None, None, None, None));
    }

    #[test]
    fn unknown_trade_is_an_error() {
        let conn = db::open_in_memory().unwrap();
        assert!(trade_card_figures(&conn, 999).is_err());
    }

    /// A deposit changes the balance, never the result: 10 000 + 5 000 deposit before the exit → 100 / 15 000.
    #[test]
    fn deposit_lowers_the_percent_not_the_pnl() {
        let conn = db::open_in_memory().unwrap();
        let (acc, ins) = (account(&conn, "10000"), instrument(&conn, "TEST", "1"));
        crate::cash_flows::create(&conn, &crate::cash_flows::NewCashFlow { account_id: acc, kind: crate::cash_flows::CashFlowKind::Deposit, amount: dec("5000"), occurred_at: 12 * H, tz_offset_min: 0, note: String::new() }).unwrap();
        let t = add(&conn, acc, ins, Direction::Long, "10", "100", Some("110"), Some("95"), "0", 1);
        let f = trade_card_figures(&conn, t).unwrap();
        assert!((f.return_fraction.unwrap() - 100.0 / 15_000.0).abs() < 1e-12);
        assert_eq!(f.net_pnl, Some(dec("100")));
    }

    fn tiny_png_b64() -> String {
        let mut b = b"\x89PNG\r\n\x1a\n".to_vec();
        b.extend_from_slice(&[0, 1, 2, 3, 4]);
        crate::screenshots::encode(&b)
    }

    fn temp(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("pulse-card-{}-{name}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn write_png_writes_and_replaces_atomically() {
        let dir = temp("ok");
        let path = dir.join("carte.png");
        assert_eq!(write_png(&path, &tiny_png_b64()).unwrap(), 13);
        assert_eq!(std::fs::read(&path).unwrap().len(), 13);
        // Again (the native dialog has confirmed the replacement): no temporary file left behind.
        write_png(&path, &format!("data:image/png;base64,{}", tiny_png_b64())).unwrap();
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn write_png_refuses_anything_but_a_png() {
        let dir = temp("bad");
        let not_png = crate::screenshots::encode(b"GIF89a...");
        assert!(write_png(&dir.join("x.png"), &not_png).is_err());
        assert!(write_png(&dir.join("x.jpg"), &tiny_png_b64()).is_err(), "wrong extension");
        assert!(write_png(&dir, &tiny_png_b64()).is_err(), "a folder");
        assert!(write_png(&dir.join("x.png"), "").is_err(), "empty");
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0, "nothing written");
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
