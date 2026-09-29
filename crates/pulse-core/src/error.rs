use thiserror::Error;

#[derive(Debug, Error)]
pub enum CoreError {
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("invalid input: {0}")]
    Invalid(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("database is from a newer version of Pulse (schema {found}, supported {supported})")]
    SchemaTooNew { found: u32, supported: u32 },
    /// Password lock (lot 22): displayed as its translatable code `lock:<code>`.
    #[error("{0}")]
    Lock(#[from] pulse_lock::LockError),
}

pub type Result<T> = std::result::Result<T, CoreError>;
