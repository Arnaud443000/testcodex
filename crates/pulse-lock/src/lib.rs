//! Pulse lock (lot 22, spec 3.7.13): everything cryptographic about the optional password lock,
//! in pure Rust, with no database, file system or network code.
//!
//! - [`kdf`]: key derivation from the password (Argon2id, salt, documented parameters).
//! - [`envelope`]: the encrypted database file (`PULSEENC`) and encrypted screenshots (`PULSEIMG`),
//!   XChaCha20-Poly1305 with the whole header authenticated.
//! - [`policy`]: the minimal password policy (length only: no false promise of strength).
//! - [`attempts`]: the growing delay after wrong passwords (never deletes anything).
//! - [`LockError`]: translatable codes (`lock:<code>`), never a secret in a message.
//!
//! Secrets ([`Password`], [`DataKey`], derived keys, decrypted bytes) are wiped from memory when
//! dropped (`zeroize`) and their `Debug` never prints them.

pub mod attempts;
pub mod envelope;
mod error;
pub mod kdf;
pub mod policy;
mod secret;

pub use envelope::{FileKind, Unlocked};
pub use error::{LockError, Result};
pub use kdf::KdfParams;
pub use secret::{DataKey, Password};
pub use zeroize::Zeroizing;

/// Fills `buf` with bytes from the operating system's random generator.
pub(crate) fn random(buf: &mut [u8]) -> Result<()> {
    getrandom::fill(buf).map_err(|_| LockError::Random)
}
