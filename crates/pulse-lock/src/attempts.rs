//! Growing delay after wrong passwords. It only slows down someone at Pulse's screen (a copied
//! file is attacked offline, where only Argon2id and the password length count) and it never
//! deletes anything.

/// Wrong passwords allowed before the first delay.
pub const FREE_ATTEMPTS: u32 = 3;
/// First delay, doubled at each further failure.
pub const FIRST_DELAY_MS: u64 = 5_000;
/// Longest delay.
pub const MAX_DELAY_MS: u64 = 300_000;

/// Delay imposed after `failures` consecutive wrong passwords: 0, 0, 0, 5 s, 10 s, 20 s, 40 s,
/// 80 s, 160 s, then 5 min.
pub fn delay_after(failures: u32) -> u64 {
    if failures < FREE_ATTEMPTS {
        return 0;
    }
    let doublings = (failures - FREE_ATTEMPTS).min(16);
    (FIRST_DELAY_MS << doublings).min(MAX_DELAY_MS)
}

/// Consecutive wrong passwords and the instant of the last one (Unix milliseconds).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Attempts {
    pub failures: u32,
    pub last_failure_ms: i64,
}

impl Attempts {
    /// Milliseconds to wait before the next try (0 = allowed now). If the clock went backwards,
    /// the wait never exceeds the delay itself.
    pub fn retry_after_ms(&self, now_ms: i64) -> u64 {
        let delay = delay_after(self.failures);
        if delay == 0 {
            return 0;
        }
        let end = self.last_failure_ms.saturating_add(delay as i64);
        if now_ms >= end { 0 } else { ((end - now_ms) as u64).min(delay) }
    }

    pub fn record_failure(&mut self, now_ms: i64) {
        self.failures = self.failures.saturating_add(1);
        self.last_failure_ms = now_ms;
    }

    pub fn reset(&mut self) {
        *self = Attempts::default();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schedule() {
        let got: Vec<u64> = (0..12).map(delay_after).collect();
        assert_eq!(got, vec![0, 0, 0, 5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000, 300_000]);
        assert_eq!(delay_after(u32::MAX), MAX_DELAY_MS, "no overflow");
    }

    #[test]
    fn waiting_and_reset() {
        let mut a = Attempts::default();
        for i in 0..3 {
            assert_eq!(a.retry_after_ms(1_000), 0, "try {i} is free");
            a.record_failure(1_000);
        }
        assert_eq!(a.retry_after_ms(1_000), 5_000);
        assert_eq!(a.retry_after_ms(4_000), 2_000);
        assert_eq!(a.retry_after_ms(6_000), 0, "delay elapsed (exactly at the end counts)");
        // Clock moved backwards: never more than the delay.
        assert_eq!(a.retry_after_ms(-1_000_000), 5_000);
        a.record_failure(6_000);
        assert_eq!(a.retry_after_ms(6_000), 10_000);
        a.reset();
        assert_eq!((a.failures, a.retry_after_ms(6_000)), (0, 0));
    }
}
