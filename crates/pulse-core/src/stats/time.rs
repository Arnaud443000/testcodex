//! Local calendar values from a UTC instant and the offset stored with it.
//! No time-zone database: the offset recorded on the trade is the truth.

const MS_PER_DAY: i64 = 86_400_000;

/// Days since 1970-01-01 in the trader's local time.
pub fn local_day_number(utc_ms: i64, tz_offset_min: i32) -> i64 {
    (utc_ms + tz_offset_min as i64 * 60_000).div_euclid(MS_PER_DAY)
}

/// Local calendar day as "YYYY-MM-DD".
pub fn day_key(utc_ms: i64, tz_offset_min: i32) -> String {
    let (y, m, d) = civil_from_days(local_day_number(utc_ms, tz_offset_min));
    format!("{y:04}-{m:02}-{d:02}")
}

/// ISO weekday in local time: 1 = Monday … 7 = Sunday.
pub fn weekday(utc_ms: i64, tz_offset_min: i32) -> u8 {
    // 1970-01-01 was a Thursday (ISO 4).
    ((local_day_number(utc_ms, tz_offset_min) + 3).rem_euclid(7) + 1) as u8
}

/// Local hour of the day, 0–23.
pub fn hour(utc_ms: i64, tz_offset_min: i32) -> u8 {
    ((utc_ms + tz_offset_min as i64 * 60_000).rem_euclid(MS_PER_DAY) / 3_600_000) as u8
}

pub fn weekday_name(iso: u8) -> &'static str {
    ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][(iso as usize - 1) % 7]
}

/// Days since 1970-01-01 of a Gregorian date; `None` for an impossible one (month 13, 31 Feb…).
pub fn days_from_civil(year: i64, month: u32, day: u32) -> Option<i64> {
    if !(1..=12).contains(&month) || day < 1 || day > days_in_month(year, month) as u32 {
        return None;
    }
    let y = year - i64::from(month <= 2);
    let era = y.div_euclid(400);
    let yoe = y.rem_euclid(400);
    let mp = (i64::from(month) + 9) % 12;
    let doy = (153 * mp + 2) / 5 + i64::from(day) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    Some(era * 146_097 + doe - 719_468)
}

pub fn days_in_month(year: i64, month: u32) -> u8 {
    match month {
        2 if (year % 4 == 0 && year % 100 != 0) || year % 400 == 0 => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

/// Parses "YYYY-MM-DD" into days since 1970-01-01.
pub fn parse_day(day: &str) -> Option<i64> {
    let mut parts = day.split('-');
    let (y, m, d) = (parts.next()?, parts.next()?, parts.next()?);
    if parts.next().is_some() || y.len() != 4 || m.len() != 2 || d.len() != 2 {
        return None;
    }
    days_from_civil(y.parse().ok()?, m.parse().ok()?, d.parse().ok()?)
}

/// Gregorian (year, month, day) from days since 1970-01-01 (H. Hinnant's algorithm).
pub(crate) fn civil_from_days(days: i64) -> (i64, u32, u32) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: i64 = MS_PER_DAY;
    const HOUR: i64 = 3_600_000;

    #[test]
    fn epoch_and_leap_day() {
        assert_eq!(day_key(0, 0), "1970-01-01");
        assert_eq!(weekday(0, 0), 4, "1970-01-01 was a Thursday");
        // 2000-02-29 = day 11016; it was a Tuesday.
        assert_eq!(day_key(11_016 * DAY, 0), "2000-02-29");
        assert_eq!(weekday(11_016 * DAY, 0), 2);
        assert_eq!(day_key(11_017 * DAY, 0), "2000-03-01");
        assert_eq!(day_key(-1, 0), "1969-12-31");
    }

    #[test]
    fn offsets_move_the_local_day_and_hour() {
        // 2026-09-28 (day 20724, a Monday) at 23:30 UTC.
        let t = 20_724 * DAY + 23 * HOUR + 30 * 60_000;
        assert_eq!((day_key(t, 0), weekday(t, 0), hour(t, 0)), ("2026-09-28".into(), 1, 23));
        // UTC+2: already Tuesday 01:30.
        assert_eq!((day_key(t, 120), weekday(t, 120), hour(t, 120)), ("2026-09-29".into(), 2, 1));
        // 03:00 UTC seen from UTC−5: Sunday 22:00 the day before.
        let early = 20_724 * DAY + 3 * HOUR;
        assert_eq!((day_key(early, -300), weekday(early, -300), hour(early, -300)), ("2026-09-27".into(), 7, 22));
    }

    #[test]
    fn civil_dates_round_trip_and_reject_impossible_ones() {
        assert_eq!(days_from_civil(1970, 1, 1), Some(0));
        assert_eq!(days_from_civil(2000, 2, 29), Some(11_016));
        assert_eq!(days_from_civil(2026, 9, 1), Some(20_697));
        assert_eq!(days_from_civil(1969, 12, 31), Some(-1));
        for d in [-800_000, -1, 0, 11_016, 20_724, 900_000] {
            let (y, m, dd) = civil_from_days(d);
            assert_eq!(days_from_civil(y, m, dd), Some(d));
        }
        assert_eq!(days_from_civil(2026, 2, 29), None);
        assert_eq!(days_from_civil(2026, 13, 1), None);
        assert_eq!(days_from_civil(2026, 4, 31), None);
        assert_eq!((days_in_month(2024, 2), days_in_month(1900, 2), days_in_month(2000, 2), days_in_month(2026, 9)), (29, 28, 29, 30));
        assert_eq!(parse_day("2026-09-28"), Some(20_724));
        assert_eq!(parse_day("2026-9-28"), None);
        assert_eq!(parse_day("nope"), None);
    }

    #[test]
    fn weekday_names() {
        assert_eq!(weekday_name(1), "Monday");
        assert_eq!(weekday_name(7), "Sunday");
    }
}
