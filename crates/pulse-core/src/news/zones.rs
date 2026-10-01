//! The two time-zone rules the economic calendar needs, without a time-zone database
//! (see CLAUDE.md, "Calendrier économique (lot 25)"):
//! - Europe/Paris: European Union rule (since 1996), summer time from the last Sunday of March
//!   01:00 UTC to the last Sunday of October 01:00 UTC (UTC+2), otherwise UTC+1;
//! - America/New_York: United States rule (since 2007), summer time from the second Sunday of
//!   March 02:00 local to the first Sunday of November 02:00 local (UTC−4), otherwise UTC−5.
//!
//! Instants stay stored in UTC; these rules only say what a Paris clock showed (display) and read
//! a local time written in a file (import).

use crate::stats::time::{civil_from_days, days_from_civil, days_in_month};

pub(crate) const DAY_MS: i64 = 86_400_000;
const HOUR_MS: i64 = 3_600_000;
const MIN_MS: i64 = 60_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Zone {
    Utc,
    Paris,
    NewYork,
}

impl Zone {
    /// A `TZID` of an ICS file; `None` for any zone this module does not know (refused, never guessed).
    pub fn from_tzid(tzid: &str) -> Option<Zone> {
        match tzid.trim().trim_matches('"') {
            "Europe/Paris" => Some(Zone::Paris),
            "America/New_York" | "US/Eastern" => Some(Zone::NewYork),
            "UTC" | "Etc/UTC" | "GMT" | "Etc/GMT" | "Z" => Some(Zone::Utc),
            _ => None,
        }
    }
}

/// ISO weekday of a day number: 1 = Monday … 7 = Sunday.
fn iso_weekday(day: i64) -> i64 {
    (day + 3).rem_euclid(7) + 1
}

fn last_sunday(year: i64, month: u32) -> i64 {
    let last = days_from_civil(year, month, u32::from(days_in_month(year, month))).expect("valid month");
    last - iso_weekday(last) % 7
}

fn nth_sunday(year: i64, month: u32, n: i64) -> i64 {
    let first = days_from_civil(year, month, 1).expect("valid month");
    first + (7 - iso_weekday(first)) % 7 + 7 * (n - 1)
}

/// UTC offset in minutes of `zone` at a UTC instant.
pub fn offset_min(zone: Zone, utc_ms: i64) -> i32 {
    let (year, _, _) = civil_from_days(utc_ms.div_euclid(DAY_MS));
    match zone {
        Zone::Utc => 0,
        Zone::Paris => {
            let start = last_sunday(year, 3) * DAY_MS + HOUR_MS;
            let end = last_sunday(year, 10) * DAY_MS + HOUR_MS;
            if (start..end).contains(&utc_ms) { 120 } else { 60 }
        }
        Zone::NewYork => {
            // 02:00 EST = 07:00 UTC; 02:00 EDT = 06:00 UTC.
            let start = nth_sunday(year, 3, 2) * DAY_MS + 7 * HOUR_MS;
            let end = nth_sunday(year, 11, 1) * DAY_MS + 6 * HOUR_MS;
            if (start..end).contains(&utc_ms) { -240 } else { -300 }
        }
    }
}

/// Paris offset (minutes) at a UTC instant.
pub fn paris_offset_min(utc_ms: i64) -> i32 {
    offset_min(Zone::Paris, utc_ms)
}

/// Days since 1970-01-01 of the Paris calendar day of an instant.
pub fn paris_day_number(utc_ms: i64) -> i64 {
    (utc_ms + i64::from(paris_offset_min(utc_ms)) * MIN_MS).div_euclid(DAY_MS)
}

pub fn day_key_of(day: i64) -> String {
    let (y, m, d) = civil_from_days(day);
    format!("{y:04}-{m:02}-{d:02}")
}

/// Paris calendar day "YYYY-MM-DD" of an instant.
pub fn paris_day(utc_ms: i64) -> String {
    day_key_of(paris_day_number(utc_ms))
}

/// Paris clock time "HH:MM" of an instant.
pub fn paris_hhmm(utc_ms: i64) -> String {
    let minutes = (utc_ms + i64::from(paris_offset_min(utc_ms)) * MIN_MS).rem_euclid(DAY_MS) / MIN_MS;
    format!("{:02}:{:02}", minutes / 60, minutes % 60)
}

/// A local wall-clock time read in a zone.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Local {
    /// The only instant showing that time.
    Single(i64),
    /// The clock went back: that time happened twice (earlier instant first).
    Ambiguous(i64, i64),
    /// The clock jumped forward: that time never existed.
    Missing,
}

/// The UTC instant(s) at which `zone` showed `day` (days since 1970-01-01) at `minute_of_day`.
pub fn to_utc(zone: Zone, day: i64, minute_of_day: u32) -> Local {
    let local = day * DAY_MS + i64::from(minute_of_day) * MIN_MS;
    let candidates: &[i32] = match zone {
        Zone::Utc => &[0],
        Zone::Paris => &[120, 60],
        Zone::NewYork => &[-240, -300],
    };
    let mut found: Vec<i64> = candidates
        .iter()
        .filter_map(|&off| {
            let utc = local - i64::from(off) * MIN_MS;
            (offset_min(zone, utc) == off).then_some(utc)
        })
        .collect();
    found.sort_unstable();
    found.dedup();
    match found.as_slice() {
        [one] => Local::Single(*one),
        [a, b] => Local::Ambiguous(*a, *b),
        _ => Local::Missing,
    }
}

/// The first instant showing that time (the summer one when the clock went back); `None` when it never existed.
pub fn to_utc_first(zone: Zone, day: i64, minute_of_day: u32) -> Option<i64> {
    match to_utc(zone, day, minute_of_day) {
        Local::Single(t) | Local::Ambiguous(t, _) => Some(t),
        Local::Missing => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(y: i64, m: u32, d: u32, h: i64, min: i64) -> i64 {
        days_from_civil(y, m, d).unwrap() * DAY_MS + h * HOUR_MS + min * MIN_MS
    }

    #[test]
    fn paris_switches_to_summer_time_on_the_last_sunday_of_march_at_one_utc() {
        // 2026-03-29 is the last Sunday of March 2026.
        assert_eq!(paris_offset_min(at(2026, 3, 29, 0, 59)), 60);
        assert_eq!(paris_hhmm(at(2026, 3, 29, 0, 59)), "01:59");
        assert_eq!(paris_offset_min(at(2026, 3, 29, 1, 0)), 120);
        assert_eq!(paris_hhmm(at(2026, 3, 29, 1, 0)), "03:00", "02:00 Paris is skipped");
        // The day before and a Sunday that is not the last one keep winter time.
        assert_eq!(paris_offset_min(at(2026, 3, 22, 12, 0)), 60);
    }

    #[test]
    fn paris_switches_back_on_the_last_sunday_of_october_at_one_utc() {
        // 2026-10-25 is the last Sunday of October 2026.
        assert_eq!(paris_offset_min(at(2026, 10, 25, 0, 59)), 120);
        assert_eq!(paris_hhmm(at(2026, 10, 25, 0, 59)), "02:59");
        assert_eq!(paris_offset_min(at(2026, 10, 25, 1, 0)), 60);
        assert_eq!(paris_hhmm(at(2026, 10, 25, 1, 0)), "02:00", "02:00–02:59 happens twice");
        // Another year: 2025-10-26 and 2025-03-30.
        assert_eq!(paris_offset_min(at(2025, 10, 26, 0, 30)), 120);
        assert_eq!(paris_offset_min(at(2025, 10, 26, 1, 30)), 60);
        assert_eq!(paris_offset_min(at(2025, 3, 30, 0, 30)), 60);
        assert_eq!(paris_offset_min(at(2025, 3, 30, 1, 30)), 120);
    }

    #[test]
    fn paris_day_changes_at_paris_midnight() {
        // 22:30 UTC in summer = 00:30 the next day in Paris.
        assert_eq!(paris_day(at(2026, 7, 14, 22, 30)), "2026-07-15");
        assert_eq!(paris_hhmm(at(2026, 7, 14, 22, 30)), "00:30");
        // 22:30 UTC in winter = 23:30 the same day.
        assert_eq!(paris_day(at(2026, 1, 14, 22, 30)), "2026-01-14");
    }

    #[test]
    fn reading_a_paris_time_handles_the_gap_and_the_repeated_hour() {
        let spring = days_from_civil(2026, 3, 29).unwrap();
        assert_eq!(to_utc(Zone::Paris, spring, 2 * 60 + 30), Local::Missing);
        assert_eq!(to_utc(Zone::Paris, spring, 60 + 59), Local::Single(at(2026, 3, 29, 0, 59)));
        assert_eq!(to_utc(Zone::Paris, spring, 3 * 60), Local::Single(at(2026, 3, 29, 1, 0)));
        let autumn = days_from_civil(2026, 10, 25).unwrap();
        assert_eq!(to_utc(Zone::Paris, autumn, 2 * 60 + 30), Local::Ambiguous(at(2026, 10, 25, 0, 30), at(2026, 10, 25, 1, 30)));
        assert_eq!(to_utc_first(Zone::Paris, autumn, 2 * 60 + 30), Some(at(2026, 10, 25, 0, 30)), "the summer one");
        assert_eq!(to_utc(Zone::Paris, autumn, 3 * 60), Local::Single(at(2026, 10, 25, 2, 0)));
        // An ordinary summer and winter day.
        assert_eq!(to_utc_first(Zone::Paris, days_from_civil(2026, 7, 1).unwrap(), 14 * 60 + 30), Some(at(2026, 7, 1, 12, 30)));
        assert_eq!(to_utc_first(Zone::Paris, days_from_civil(2026, 1, 1).unwrap(), 14 * 60 + 30), Some(at(2026, 1, 1, 13, 30)));
    }

    #[test]
    fn new_york_follows_the_us_rule() {
        // 2026: second Sunday of March = 8 March, first Sunday of November = 1 November.
        assert_eq!(offset_min(Zone::NewYork, at(2026, 3, 8, 6, 59)), -300);
        assert_eq!(offset_min(Zone::NewYork, at(2026, 3, 8, 7, 0)), -240);
        assert_eq!(offset_min(Zone::NewYork, at(2026, 11, 1, 5, 59)), -240);
        assert_eq!(offset_min(Zone::NewYork, at(2026, 11, 1, 6, 0)), -300);
        // 08:30 in New York (a CPI release) during the three weeks when only the US has changed.
        let cpi = to_utc_first(Zone::NewYork, days_from_civil(2026, 3, 11).unwrap(), 8 * 60 + 30).unwrap();
        assert_eq!(cpi, at(2026, 3, 11, 12, 30));
        assert_eq!(paris_hhmm(cpi), "13:30", "Paris is still in winter time: 4 hours apart, not 6");
        assert_eq!(to_utc(Zone::NewYork, days_from_civil(2026, 3, 8).unwrap(), 2 * 60 + 30), Local::Missing);
        assert!(matches!(to_utc(Zone::NewYork, days_from_civil(2026, 11, 1).unwrap(), 60 + 30), Local::Ambiguous(_, _)));
    }

    #[test]
    fn unknown_zones_are_refused() {
        assert_eq!(Zone::from_tzid("\"Europe/Paris\""), Some(Zone::Paris));
        assert_eq!(Zone::from_tzid("Europe/London"), None);
        assert_eq!(Zone::from_tzid(""), None);
    }
}
