//! Minimal password policy: a length, nothing else. No composition rule and no "strength"
//! gauge: they would promise a security that a length check cannot measure.

use crate::{LockError, Password, Result};

/// Minimum length of a new password, in characters (an accented letter counts as one).
pub const MIN_CHARS: usize = 8;
/// Maximum length in bytes (UTF-8), for any password handed to the key derivation.
pub const MAX_BYTES: usize = 1024;

/// Checks a password chosen by the user (activation, change).
pub fn check_new(password: &Password) -> Result<()> {
    check_length(password)?;
    if password.as_str().chars().count() < MIN_CHARS {
        return Err(LockError::PasswordTooShort);
    }
    Ok(())
}

/// Checks a password typed to unlock: only the upper bound (an empty or short one is simply wrong).
pub fn check_length(password: &Password) -> Result<()> {
    if password.as_bytes().len() > MAX_BYTES { Err(LockError::PasswordTooLong) } else { Ok(()) }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pw(s: &str) -> Password {
        Password::new(s.into())
    }

    #[test]
    fn length_is_the_only_rule() {
        assert_eq!(check_new(&pw("1234567")), Err(LockError::PasswordTooShort));
        assert_eq!(check_new(&pw("")), Err(LockError::PasswordTooShort));
        assert_eq!(check_new(&pw("12345678")), Ok(()));
        assert_eq!(check_new(&pw("aaaaaaaa")), Ok(()), "no composition rule");
        // Counted in characters, not bytes: 7 accented letters are still too short.
        assert_eq!(check_new(&pw("ééééééé")), Err(LockError::PasswordTooShort));
        assert_eq!(check_new(&pw("éééééééé")), Ok(()));
        assert_eq!(check_new(&pw(&"a".repeat(MAX_BYTES))), Ok(()));
        assert_eq!(check_new(&pw(&"a".repeat(MAX_BYTES + 1))), Err(LockError::PasswordTooLong));
        assert_eq!(check_length(&pw("")), Ok(()));
    }
}
