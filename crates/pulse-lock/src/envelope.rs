//! Encrypted file formats (version 1).
//!
//! **Database** (`PULSEENC`): the whole SQLite image, encrypted by the random data key; the data
//! key itself is stored wrapped by the password key in the header, next to the salt and the
//! Argon2id parameters (not secret). Each file is self-contained: it reopens with the password in
//! force when it was written.
//!
//! ```text
//! offset size
//!   0     8   magic "PULSEENC"
//!   8     1   format version (1)
//!   9     1   kind (1 = database)
//!  10     1   key derivation (1 = Argon2id)
//!  11    12   m (KiB), t, p: three u32 little-endian
//!  23    16   salt
//!  39    24   nonce of the wrapped key
//!  63    48   data key encrypted by the password key (32 + 16-byte tag), AAD = bytes 0..39
//! 111    24   nonce of the body (new random nonce at every write)
//! 135     …   body: SQLite image encrypted by the data key (+ 16-byte tag), AAD = bytes 0..135
//! ```
//!
//! **Screenshot** (`PULSEIMG`): magic (8), version (1), nonce (24), then the image encrypted by the
//! data key (+ tag), AAD = the 33 header bytes.
//!
//! Cipher: XChaCha20-Poly1305 (24-byte random nonces, so reusing a nonce by chance is not a
//! practical concern). Any change to a header or body byte makes opening fail.

use crate::kdf::{self, KdfParams, SALT_LEN};
use crate::{DataKey, LockError, Password, Result};
use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{XChaCha20Poly1305, XNonce};
use zeroize::Zeroizing;

pub const DB_MAGIC: &[u8; 8] = b"PULSEENC";
pub const BLOB_MAGIC: &[u8; 8] = b"PULSEIMG";
pub const SQLITE_MAGIC: &[u8; 16] = b"SQLite format 3\0";
pub const VERSION: u8 = 1;
const KIND_DATABASE: u8 = 1;
const KDF_ARGON2ID: u8 = 1;
const NONCE_LEN: usize = 24;
const TAG_LEN: usize = 16;
const WRAPPED_LEN: usize = 32 + TAG_LEN;
const SALT_END: usize = 23 + SALT_LEN; // 39
const SLOT_LEN: usize = SALT_END + NONCE_LEN + WRAPPED_LEN; // 111
pub const DB_HEADER_LEN: usize = SLOT_LEN + NONCE_LEN; // 135
pub const BLOB_HEADER_LEN: usize = 8 + 1 + NONCE_LEN; // 33

/// What a file is, from its first bytes (no key needed).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FileKind {
    /// An ordinary, unencrypted SQLite database.
    PlainSqlite,
    EncryptedDatabase,
    EncryptedBlob,
    Other,
}

impl FileKind {
    pub fn of(bytes: &[u8]) -> FileKind {
        if bytes.starts_with(SQLITE_MAGIC) {
            FileKind::PlainSqlite
        } else if bytes.starts_with(DB_MAGIC) {
            FileKind::EncryptedDatabase
        } else if bytes.starts_with(BLOB_MAGIC) {
            FileKind::EncryptedBlob
        } else {
            FileKind::Other
        }
    }
}

/// The data key, and the header part that wraps it: enough to write the file again without
/// asking for the password (and without running Argon2id at every save).
#[derive(Clone)]
pub struct Unlocked {
    dek: DataKey,
    params: KdfParams,
    salt: [u8; SALT_LEN],
    wrap_nonce: [u8; NONCE_LEN],
    wrapped: [u8; WRAPPED_LEN],
}

impl std::fmt::Debug for Unlocked {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Unlocked").field("params", &self.params).finish_non_exhaustive()
    }
}

fn cipher(key: &[u8; 32]) -> XChaCha20Poly1305 {
    XChaCha20Poly1305::new_from_slice(key).expect("32-byte key")
}

fn nonce() -> Result<[u8; NONCE_LEN]> {
    let mut n = [0u8; NONCE_LEN];
    crate::random(&mut n)?;
    Ok(n)
}

fn slot_prefix(params: KdfParams, salt: &[u8; SALT_LEN]) -> [u8; SALT_END] {
    let mut h = [0u8; SALT_END];
    h[0..8].copy_from_slice(DB_MAGIC);
    h[8] = VERSION;
    h[9] = KIND_DATABASE;
    h[10] = KDF_ARGON2ID;
    h[11..15].copy_from_slice(&params.m_kib.to_le_bytes());
    h[15..19].copy_from_slice(&params.t.to_le_bytes());
    h[19..23].copy_from_slice(&params.p.to_le_bytes());
    h[23..SALT_END].copy_from_slice(salt);
    h
}

impl Unlocked {
    /// A new data key protected by `password` (activation).
    pub fn create(password: &Password, params: KdfParams) -> Result<Unlocked> {
        crate::policy::check_new(password)?;
        Self::wrap(DataKey::generate()?, password, params)
    }

    /// Same data key, protected by a new password (new salt): the password change.
    pub fn rewrap(&self, new_password: &Password, params: KdfParams) -> Result<Unlocked> {
        crate::policy::check_new(new_password)?;
        Self::wrap(self.dek.clone(), new_password, params)
    }

    fn wrap(dek: DataKey, password: &Password, params: KdfParams) -> Result<Unlocked> {
        let mut salt = [0u8; SALT_LEN];
        crate::random(&mut salt)?;
        let kek = kdf::derive_key(password, &salt, params)?;
        let wrap_nonce = nonce()?;
        let aad = slot_prefix(params, &salt);
        let wrapped = cipher(&kek)
            .encrypt(&XNonce::from(wrap_nonce), Payload { msg: dek.bytes(), aad: &aad })
            .map_err(|_| LockError::Corrupt)?;
        Ok(Unlocked { dek, params, salt, wrap_nonce, wrapped: wrapped.try_into().map_err(|_| LockError::Corrupt)? })
    }

    /// True when `password` is the one that protects this key (same salt and parameters).
    pub fn verify(&self, password: &Password) -> Result<()> {
        crate::policy::check_length(password)?;
        let dek = unwrap(password, self.params, &self.salt, &self.wrap_nonce, &self.wrapped)?;
        if dek == self.dek { Ok(()) } else { Err(LockError::WrongPassword) }
    }

    pub fn data_key(&self) -> &DataKey {
        &self.dek
    }

    pub fn params(&self) -> KdfParams {
        self.params
    }

    /// Encrypts a database image with a fresh body nonce.
    pub fn seal(&self, plain: &[u8]) -> Result<Vec<u8>> {
        let mut header = Vec::with_capacity(DB_HEADER_LEN + plain.len() + TAG_LEN);
        header.extend_from_slice(&slot_prefix(self.params, &self.salt));
        header.extend_from_slice(&self.wrap_nonce);
        header.extend_from_slice(&self.wrapped);
        let body_nonce = nonce()?;
        header.extend_from_slice(&body_nonce);
        let body = cipher(self.dek.bytes())
            .encrypt(&XNonce::from(body_nonce), Payload { msg: plain, aad: &header })
            .map_err(|_| LockError::Corrupt)?;
        header.extend_from_slice(&body);
        Ok(header)
    }
}

fn unwrap(password: &Password, params: KdfParams, salt: &[u8; SALT_LEN], wrap_nonce: &[u8; NONCE_LEN], wrapped: &[u8; WRAPPED_LEN]) -> Result<DataKey> {
    let kek = kdf::derive_key(password, salt, params)?;
    let aad = slot_prefix(params, salt);
    let plain = Zeroizing::new(
        cipher(&kek)
            .decrypt(&XNonce::from(*wrap_nonce), Payload { msg: wrapped, aad: &aad })
            .map_err(|_| LockError::WrongPassword)?,
    );
    let mut key = Zeroizing::new([0u8; 32]);
    key.copy_from_slice(&plain);
    Ok(DataKey(key))
}

fn u32_at(bytes: &[u8], at: usize) -> u32 {
    u32::from_le_bytes(bytes[at..at + 4].try_into().expect("4 bytes"))
}

/// The key slot read from a header.
struct Slot {
    params: KdfParams,
    salt: [u8; SALT_LEN],
    wrap_nonce: [u8; NONCE_LEN],
    wrapped: [u8; WRAPPED_LEN],
}

/// Reads the header of an encrypted database: format checks only, no key work.
fn parse_header(file: &[u8]) -> Result<Slot> {
    match FileKind::of(file) {
        FileKind::EncryptedDatabase => {}
        FileKind::EncryptedBlob => return Err(LockError::Corrupt),
        _ => return Err(LockError::NotEncrypted),
    }
    if file.len() < 11 {
        return Err(LockError::Corrupt);
    }
    if file[8] != VERSION || file[9] != KIND_DATABASE || file[10] != KDF_ARGON2ID {
        return Err(LockError::UnsupportedVersion);
    }
    if file.len() < DB_HEADER_LEN + TAG_LEN {
        return Err(LockError::Corrupt);
    }
    let params = KdfParams { m_kib: u32_at(file, 11), t: u32_at(file, 15), p: u32_at(file, 19) }.check()?;
    let salt = file[23..SALT_END].try_into().expect("16 bytes");
    let wrap_nonce = file[SALT_END..SALT_END + NONCE_LEN].try_into().expect("24 bytes");
    let wrapped = file[SALT_END + NONCE_LEN..SLOT_LEN].try_into().expect("48 bytes");
    Ok(Slot { params, salt, wrap_nonce, wrapped })
}

/// Decrypts an encrypted database file with the password. Wrong password → `WrongPassword`;
/// right password but damaged body → `Corrupt`.
pub fn open(file: &[u8], password: &Password) -> Result<(Zeroizing<Vec<u8>>, Unlocked)> {
    crate::policy::check_length(password)?;
    let Slot { params, salt, wrap_nonce, wrapped } = parse_header(file)?;
    let dek = unwrap(password, params, &salt, &wrap_nonce, &wrapped)?;
    let plain = open_body(file, &dek)?;
    Ok((plain, Unlocked { dek, params, salt, wrap_nonce, wrapped }))
}

/// Decrypts an encrypted database file with an already unwrapped data key (a file written by
/// this same key, whatever the password in its header).
pub fn open_with_key(file: &[u8], dek: &DataKey) -> Result<Zeroizing<Vec<u8>>> {
    parse_header(file)?;
    open_body(file, dek)
}

fn open_body(file: &[u8], dek: &DataKey) -> Result<Zeroizing<Vec<u8>>> {
    let body_nonce: [u8; NONCE_LEN] = file[SLOT_LEN..DB_HEADER_LEN].try_into().expect("24 bytes");
    cipher(dek.bytes())
        .decrypt(&XNonce::from(body_nonce), Payload { msg: &file[DB_HEADER_LEN..], aad: &file[..DB_HEADER_LEN] })
        .map(Zeroizing::new)
        .map_err(|_| LockError::Corrupt)
}

/// Encrypts a screenshot (or any file of the data folder) with the data key.
pub fn seal_blob(dek: &DataKey, plain: &[u8]) -> Result<Vec<u8>> {
    let n = nonce()?;
    let mut out = Vec::with_capacity(BLOB_HEADER_LEN + plain.len() + TAG_LEN);
    out.extend_from_slice(BLOB_MAGIC);
    out.push(VERSION);
    out.extend_from_slice(&n);
    let body = cipher(dek.bytes())
        .encrypt(&XNonce::from(n), Payload { msg: plain, aad: &out })
        .map_err(|_| LockError::Corrupt)?;
    out.extend_from_slice(&body);
    Ok(out)
}

/// Decrypts a file written by [`seal_blob`].
pub fn open_blob(dek: &DataKey, data: &[u8]) -> Result<Zeroizing<Vec<u8>>> {
    if FileKind::of(data) != FileKind::EncryptedBlob {
        return Err(LockError::NotEncrypted);
    }
    if data.len() < 9 || data[8] != VERSION {
        return Err(LockError::UnsupportedVersion);
    }
    if data.len() < BLOB_HEADER_LEN + TAG_LEN {
        return Err(LockError::Corrupt);
    }
    let n: [u8; NONCE_LEN] = data[9..BLOB_HEADER_LEN].try_into().expect("24 bytes");
    cipher(dek.bytes())
        .decrypt(&XNonce::from(n), Payload { msg: &data[BLOB_HEADER_LEN..], aad: &data[..BLOB_HEADER_LEN] })
        .map(Zeroizing::new)
        .map_err(|_| LockError::Corrupt)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FAST: KdfParams = KdfParams::INSECURE_FAST_FOR_TESTS;
    // Obvious, throwaway test passwords.
    fn pw(s: &str) -> Password {
        Password::new(s.into())
    }
    const IMAGE: &[u8] = b"SQLite format 3\0 pretend this is a database page with trades";

    #[test]
    fn database_round_trip_and_file_is_not_readable() {
        let keys = Unlocked::create(&pw("motdepasse-de-test"), FAST).unwrap();
        let file = keys.seal(IMAGE).unwrap();
        assert_eq!(FileKind::of(&file), FileKind::EncryptedDatabase);
        assert!(!file.starts_with(b"SQLite format 3"), "the header is not a plain SQLite one");
        assert!(!file.windows(12).any(|w| w == b"pretend this"), "no plaintext left in the file");
        let (plain, again) = open(&file, &pw("motdepasse-de-test")).unwrap();
        assert_eq!(&plain[..], IMAGE);
        assert_eq!(again.data_key(), keys.data_key());
        // Two writes of the same image differ (fresh body nonce) but open to the same thing.
        let second = keys.seal(IMAGE).unwrap();
        assert_ne!(file, second);
        assert_eq!(&open_with_key(&second, keys.data_key()).unwrap()[..], IMAGE);
    }

    #[test]
    fn wrong_password_is_refused() {
        let file = Unlocked::create(&pw("motdepasse-de-test"), FAST).unwrap().seal(IMAGE).unwrap();
        assert_eq!(open(&file, &pw("motdepasse-de-tesT")).unwrap_err(), LockError::WrongPassword);
        assert_eq!(open(&file, &pw("")).unwrap_err(), LockError::WrongPassword);
        assert_eq!(open(&file, &pw(&"x".repeat(2000))).unwrap_err(), LockError::PasswordTooLong);
    }

    #[test]
    fn any_modified_byte_is_detected() {
        let file = Unlocked::create(&pw("motdepasse-de-test"), FAST).unwrap().seal(IMAGE).unwrap();
        // Header before the wrapped key (salt, parameters) → the key does not unwrap.
        let mut salt = file.clone();
        salt[30] ^= 1;
        assert_eq!(open(&salt, &pw("motdepasse-de-test")).unwrap_err(), LockError::WrongPassword);
        // Body nonce and body → damaged file (the password was right).
        for at in [120, DB_HEADER_LEN + 3, file.len() - 1] {
            let mut bad = file.clone();
            bad[at] ^= 1;
            assert_eq!(open(&bad, &pw("motdepasse-de-test")).unwrap_err(), LockError::Corrupt, "byte {at}");
        }
        assert_eq!(open(&file[..file.len() - 5], &pw("motdepasse-de-test")).unwrap_err(), LockError::Corrupt, "truncated");
        assert_eq!(open(&file[..50], &pw("motdepasse-de-test")).unwrap_err(), LockError::Corrupt, "header only");
        let mut newer = file.clone();
        newer[8] = 2;
        assert_eq!(open(&newer, &pw("motdepasse-de-test")).unwrap_err(), LockError::UnsupportedVersion);
        let mut huge = file.clone();
        huge[11..15].copy_from_slice(&u32::MAX.to_le_bytes());
        assert_eq!(open(&huge, &pw("motdepasse-de-test")).unwrap_err(), LockError::Corrupt, "absurd memory cost refused");
    }

    #[test]
    fn plain_files_are_recognised() {
        assert_eq!(open(IMAGE, &pw("motdepasse-de-test")).unwrap_err(), LockError::NotEncrypted);
        assert_eq!(FileKind::of(IMAGE), FileKind::PlainSqlite);
        assert_eq!(FileKind::of(b"\x89PNG\r\n"), FileKind::Other);
        assert_eq!(FileKind::of(b""), FileKind::Other);
    }

    #[test]
    fn password_change_keeps_the_data_key() {
        let old = Unlocked::create(&pw("ancien-mot-de-passe"), FAST).unwrap();
        let shot = seal_blob(old.data_key(), b"\x89PNG image").unwrap();
        let new = old.rewrap(&pw("nouveau-mot-de-passe"), FAST).unwrap();
        let file = new.seal(IMAGE).unwrap();
        assert_eq!(open(&file, &pw("ancien-mot-de-passe")).unwrap_err(), LockError::WrongPassword);
        let (plain, reopened) = open(&file, &pw("nouveau-mot-de-passe")).unwrap();
        assert_eq!(&plain[..], IMAGE);
        assert_eq!(&open_blob(reopened.data_key(), &shot).unwrap()[..], b"\x89PNG image", "screenshots need no rewrite");
        assert!(new.verify(&pw("nouveau-mot-de-passe")).is_ok());
        assert_eq!(new.verify(&pw("ancien-mot-de-passe")).unwrap_err(), LockError::WrongPassword);
        assert_eq!(old.rewrap(&pw("court"), FAST).unwrap_err(), LockError::PasswordTooShort);
        assert_eq!(Unlocked::create(&pw("court"), FAST).unwrap_err(), LockError::PasswordTooShort);
    }

    #[test]
    fn blobs_round_trip_and_detect_tampering() {
        let dek = DataKey::generate().unwrap();
        let sealed = seal_blob(&dek, b"\x89PNG image bytes").unwrap();
        assert_eq!(FileKind::of(&sealed), FileKind::EncryptedBlob);
        assert_eq!(&open_blob(&dek, &sealed).unwrap()[..], b"\x89PNG image bytes");
        assert_eq!(open_blob(&DataKey::generate().unwrap(), &sealed).unwrap_err(), LockError::Corrupt, "other key");
        let mut bad = sealed.clone();
        bad[20] ^= 1;
        assert_eq!(open_blob(&dek, &bad).unwrap_err(), LockError::Corrupt);
        assert_eq!(open_blob(&dek, b"\x89PNG").unwrap_err(), LockError::NotEncrypted);
        // A screenshot is not a database and vice versa.
        assert_eq!(open(&sealed, &pw("motdepasse-de-test")).unwrap_err(), LockError::Corrupt);
    }
}
