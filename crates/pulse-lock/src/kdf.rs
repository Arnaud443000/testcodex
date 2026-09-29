//! Password key derivation: Argon2id (RFC 9106), random 16-byte salt, 32-byte output.

use crate::{LockError, Password, Result};
use argon2::{Algorithm, Argon2, Params, Version};
use zeroize::Zeroizing;

pub const SALT_LEN: usize = 16;

/// Argon2id cost parameters. They are written in the header of every encrypted file, so they can
/// be raised later without breaking existing files.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct KdfParams {
    /// Memory, in KiB.
    pub m_kib: u32,
    /// Passes over the memory.
    pub t: u32,
    /// Lanes (computed one after the other: the crate is used without threads).
    pub p: u32,
}

impl KdfParams {
    /// Used for every real file: 64 MiB, 3 passes, 1 lane (second recommendation of RFC 9106,
    /// with a single lane since the computation is not parallelised).
    pub const RECOMMENDED: KdfParams = KdfParams { m_kib: 64 * 1024, t: 3, p: 1 };

    /// Minimal cost, **for tests only** (it keeps the test suite fast). Never used by the app.
    pub const INSECURE_FAST_FOR_TESTS: KdfParams = KdfParams { m_kib: 8, t: 1, p: 1 };

    /// Bounds accepted when reading a header: a crafted file must not make Pulse allocate
    /// gigabytes or spin for minutes before answering "wrong password".
    pub(crate) fn check(self) -> Result<Self> {
        let ok = (1..=16).contains(&self.p) && self.m_kib >= 8 * self.p && self.m_kib <= 1024 * 1024 && (1..=16).contains(&self.t);
        if ok { Ok(self) } else { Err(LockError::Corrupt) }
    }
}

/// Derives the 32-byte password key. Slow on purpose (that is what slows down guessing).
pub fn derive_key(password: &Password, salt: &[u8; SALT_LEN], params: KdfParams) -> Result<Zeroizing<[u8; 32]>> {
    let params = params.check()?;
    let argon = Argon2::new(
        Algorithm::Argon2id,
        Version::V0x13,
        Params::new(params.m_kib, params.t, params.p, Some(32)).map_err(|_| LockError::Corrupt)?,
    );
    let mut out = Zeroizing::new([0u8; 32]);
    argon.hash_password_into(password.as_bytes(), salt, out.as_mut()).map_err(|_| LockError::Corrupt)?;
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FAST: KdfParams = KdfParams::INSECURE_FAST_FOR_TESTS;

    #[test]
    fn same_inputs_same_key_and_every_input_matters() {
        let pw = Password::new("mot de passe jetable".into());
        let salt = [7u8; SALT_LEN];
        let a = derive_key(&pw, &salt, FAST).unwrap();
        assert_eq!(*a, *derive_key(&pw, &salt, FAST).unwrap(), "deterministic");
        assert_ne!(*a, *derive_key(&pw, &[8u8; SALT_LEN], FAST).unwrap(), "salt changes the key");
        assert_ne!(*a, *derive_key(&Password::new("mot de passe jetablE".into()), &salt, FAST).unwrap(), "case counts");
        assert_ne!(*a, *derive_key(&pw, &salt, KdfParams { t: 2, ..FAST }).unwrap(), "parameters count");
    }

    #[test]
    fn unreasonable_parameters_from_a_header_are_refused_before_any_work() {
        let pw = Password::new("x".into());
        let salt = [0u8; SALT_LEN];
        for bad in [
            KdfParams { m_kib: 4 * 1024 * 1024, t: 3, p: 1 },
            KdfParams { m_kib: 64, t: 0, p: 1 },
            KdfParams { m_kib: 64, t: 100, p: 1 },
            KdfParams { m_kib: 64, t: 1, p: 0 },
            KdfParams { m_kib: 8, t: 1, p: 2 },
        ] {
            assert_eq!(derive_key(&pw, &salt, bad).unwrap_err(), LockError::Corrupt, "{bad:?}");
        }
        assert!(KdfParams::RECOMMENDED.check().is_ok());
    }
}

#[cfg(test)]
mod timing {
    use super::*;

    /// Cost of the real parameters on this machine: `cargo test -p pulse-lock --release -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn recommended_parameters_cost() {
        let start = std::time::Instant::now();
        derive_key(&Password::new("mot de passe jetable".into()), &[1u8; SALT_LEN], KdfParams::RECOMMENDED).unwrap();
        println!("Argon2id m=64 MiB t=3 p=1: {:?}", start.elapsed());
    }
}
