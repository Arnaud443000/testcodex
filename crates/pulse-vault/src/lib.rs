//! The AI API key lives in the Windows Credential Manager, and nowhere else (lot 20, see CLAUDE.md,
//! "IA optionnelle"). On any other system, or when Windows refuses access, the vault says it is
//! unavailable: there is deliberately no fallback to a file, the database or an environment variable.
//!
//! No function of this crate ever returns the key inside an error, a `Debug` or a `Display`.

use std::fmt;
use zeroize::Zeroizing;

/// Windows generic credential: target name `anthropic-api-key.Pulse` (user `.` service).
pub const SERVICE: &str = "Pulse";
pub const ACCOUNT: &str = "anthropic-api-key";
pub const MAX_KEY_LEN: usize = 256;

/// An API key in memory: wiped when dropped, never printed.
pub struct ApiKey(Zeroizing<String>);

impl ApiKey {
    /// Minimal shape check (non-empty, no whitespace or control character, at most 256 characters).
    /// The error never repeats the input.
    pub fn parse(raw: &str) -> Result<ApiKey, KeyFormatError> {
        let key = raw.trim();
        if key.is_empty() {
            return Err(KeyFormatError::Empty);
        }
        if key.len() > MAX_KEY_LEN {
            return Err(KeyFormatError::TooLong);
        }
        if key.chars().any(|c| c.is_whitespace() || c.is_control() || !c.is_ascii()) {
            return Err(KeyFormatError::InvalidCharacter);
        }
        Ok(ApiKey(Zeroizing::new(key.to_owned())))
    }

    /// The secret itself, for the HTTP header only.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for ApiKey {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("ApiKey(***)")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyFormatError {
    Empty,
    TooLong,
    InvalidCharacter,
}

impl fmt::Display for KeyFormatError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            KeyFormatError::Empty => "the API key is empty",
            KeyFormatError::TooLong => "the API key is too long",
            KeyFormatError::InvalidCharacter => "the API key contains a space or an unexpected character",
        })
    }
}

impl std::error::Error for KeyFormatError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VaultError {
    /// No credential store on this system, or access refused by the system.
    Unavailable,
    /// The store answered with an error (details are not kept: they could describe the entry).
    Failure,
}

impl fmt::Display for VaultError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            VaultError::Unavailable => "the Windows credential store is unavailable",
            VaultError::Failure => "the Windows credential store reported an error",
        })
    }
}

impl std::error::Error for VaultError {}

/// Where the key is kept. The application uses [`system_vault`]; tests use [`MemoryVault`].
pub trait Vault: Send + Sync {
    fn is_available(&self) -> bool;
    fn load(&self) -> Result<Option<ApiKey>, VaultError>;
    fn save(&self, key: &ApiKey) -> Result<(), VaultError>;
    /// Deleting a key that is not there is not an error.
    fn delete(&self) -> Result<(), VaultError>;
}

/// The Windows Credential Manager on Windows; an always-unavailable vault elsewhere.
pub fn system_vault() -> Box<dyn Vault> {
    #[cfg(windows)]
    {
        Box::new(windows::CredentialManager)
    }
    #[cfg(not(windows))]
    {
        Box::new(Unavailable)
    }
}

/// The vault of systems without a supported credential store: every operation says so.
pub struct Unavailable;

impl Vault for Unavailable {
    fn is_available(&self) -> bool {
        false
    }
    fn load(&self) -> Result<Option<ApiKey>, VaultError> {
        Err(VaultError::Unavailable)
    }
    fn save(&self, _: &ApiKey) -> Result<(), VaultError> {
        Err(VaultError::Unavailable)
    }
    fn delete(&self) -> Result<(), VaultError> {
        Err(VaultError::Unavailable)
    }
}

/// In-memory vault for tests (never used by the application).
#[derive(Default)]
pub struct MemoryVault(std::sync::Mutex<Option<Zeroizing<String>>>);

impl Vault for MemoryVault {
    fn is_available(&self) -> bool {
        true
    }
    fn load(&self) -> Result<Option<ApiKey>, VaultError> {
        let guard = self.0.lock().map_err(|_| VaultError::Failure)?;
        Ok(guard.as_ref().map(|k| ApiKey(k.clone())))
    }
    fn save(&self, key: &ApiKey) -> Result<(), VaultError> {
        *self.0.lock().map_err(|_| VaultError::Failure)? = Some(Zeroizing::new(key.expose().to_owned()));
        Ok(())
    }
    fn delete(&self) -> Result<(), VaultError> {
        *self.0.lock().map_err(|_| VaultError::Failure)? = None;
        Ok(())
    }
}

#[cfg(windows)]
mod windows {
    use super::{ACCOUNT, ApiKey, SERVICE, Vault, VaultError};
    use keyring_core::api::CredentialStoreApi;
    use keyring_core::{Entry, Error};
    use std::collections::HashMap;
    use zeroize::Zeroizing;

    pub struct CredentialManager;

    fn entry() -> Result<Entry, VaultError> {
        let store = windows_native_keyring_store::Store::new().map_err(map)?;
        // "Local": the key stays on this computer (never roams with a domain profile).
        let modifiers = HashMap::from([("persistence", "Local")]);
        store.build(SERVICE, ACCOUNT, Some(&modifiers)).map_err(map)
    }

    fn map(e: Error) -> VaultError {
        match e {
            Error::NoStorageAccess(_) | Error::NoDefaultStore | Error::NotSupportedByStore(_) => VaultError::Unavailable,
            _ => VaultError::Failure,
        }
    }

    impl Vault for CredentialManager {
        fn is_available(&self) -> bool {
            entry().is_ok()
        }

        fn load(&self) -> Result<Option<ApiKey>, VaultError> {
            match entry()?.get_password() {
                Ok(secret) => {
                    let secret = Zeroizing::new(secret);
                    ApiKey::parse(&secret).map(Some).map_err(|_| VaultError::Failure)
                }
                Err(Error::NoEntry) => Ok(None),
                Err(e) => Err(map(e)),
            }
        }

        fn save(&self, key: &ApiKey) -> Result<(), VaultError> {
            entry()?.set_password(key.expose()).map_err(map)
        }

        fn delete(&self) -> Result<(), VaultError> {
            match entry()?.delete_credential() {
                Ok(()) | Err(Error::NoEntry) => Ok(()),
                Err(e) => Err(map(e)),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_key_is_never_printed_and_errors_never_repeat_it() {
        let key = ApiKey::parse("  sk-test-NOT-A-REAL-KEY  ").unwrap();
        assert_eq!(key.expose(), "sk-test-NOT-A-REAL-KEY");
        assert_eq!(format!("{key:?}"), "ApiKey(***)");
        for (raw, err) in [
            ("   ", KeyFormatError::Empty),
            ("sk-with space", KeyFormatError::InvalidCharacter),
            ("sk-é", KeyFormatError::InvalidCharacter),
            (&"k".repeat(257), KeyFormatError::TooLong),
        ] {
            let e = ApiKey::parse(raw).unwrap_err();
            assert_eq!(e, err);
            assert!(!e.to_string().contains("sk-"), "{e}");
        }
    }

    #[test]
    fn the_unavailable_vault_refuses_everything_instead_of_writing_elsewhere() {
        let v = Unavailable;
        assert!(!v.is_available());
        assert_eq!(v.load().unwrap_err(), VaultError::Unavailable);
        assert_eq!(v.save(&ApiKey::parse("sk-x").unwrap()).unwrap_err(), VaultError::Unavailable);
        assert_eq!(v.delete().unwrap_err(), VaultError::Unavailable);
    }

    #[cfg(not(windows))]
    #[test]
    fn outside_windows_the_system_vault_is_unavailable() {
        assert!(!system_vault().is_available());
        assert_eq!(system_vault().load().unwrap_err(), VaultError::Unavailable);
    }

    #[test]
    fn the_memory_vault_saves_replaces_and_deletes() {
        let v = MemoryVault::default();
        assert!(v.load().unwrap().is_none());
        v.save(&ApiKey::parse("sk-one").unwrap()).unwrap();
        v.save(&ApiKey::parse("sk-two").unwrap()).unwrap();
        assert_eq!(v.load().unwrap().unwrap().expose(), "sk-two");
        v.delete().unwrap();
        v.delete().unwrap();
        assert!(v.load().unwrap().is_none());
    }
}
