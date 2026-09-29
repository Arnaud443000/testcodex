use thiserror::Error;

/// Errors of the lock, displayed as stable codes (`lock:<code>`) that the interface translates.
/// No variant carries a password, a key or decrypted data.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum LockError {
    /// The database is locked: nothing can read it before the password is given.
    #[error("lock:locked")]
    Locked,
    #[error("lock:wrongPassword")]
    WrongPassword,
    /// Too many wrong passwords: wait this many milliseconds before the next try.
    #[error("lock:retryLater:{0}")]
    RetryLater(u64),
    /// The file is not an encrypted Pulse database (for example a plain SQLite file).
    #[error("lock:notEncrypted")]
    NotEncrypted,
    #[error("lock:alreadyEncrypted")]
    AlreadyEncrypted,
    /// The encrypted file is damaged, truncated or was modified.
    #[error("lock:corrupt")]
    Corrupt,
    /// Written by a newer Pulse (unknown format version or algorithm).
    #[error("lock:unsupportedVersion")]
    UnsupportedVersion,
    #[error("lock:passwordTooShort")]
    PasswordTooShort,
    #[error("lock:passwordTooLong")]
    PasswordTooLong,
    /// The "lost password = lost data" warning was not acknowledged.
    #[error("lock:notConfirmed")]
    NotConfirmed,
    /// The encrypted file could not be written; the data is still in memory.
    #[error("lock:persistFailed")]
    PersistFailed,
    /// Both `pulse.db` and `pulse.db.enc` exist and no operation explains it.
    #[error("lock:inconsistentFiles")]
    InconsistentFiles,
    /// The backup is encrypted: its password is needed.
    #[error("lock:backupPasswordRequired")]
    BackupPasswordRequired,
    #[error("lock:invalidIdle")]
    InvalidIdle,
    /// The system random generator failed.
    #[error("lock:random")]
    Random,
    /// File access failed; carries only the kind of error (never data).
    #[error("lock:io:{0}")]
    Io(String),
}

impl From<std::io::Error> for LockError {
    fn from(e: std::io::Error) -> Self {
        LockError::Io(format!("{:?}", e.kind()))
    }
}

pub type Result<T> = std::result::Result<T, LockError>;
