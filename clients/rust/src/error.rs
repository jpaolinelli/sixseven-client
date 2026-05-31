use std::fmt;

/// Error returned by the SixSevenDB client.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// A server-side error from the database.
    #[error("{severity}: {message} (SQLSTATE {code})")]
    Server {
        severity: String,
        code: String,
        message: String,
        detail: Option<String>,
        hint: Option<String>,
    },

    /// The connection is closed.
    #[error("sixsevendb: connection is closed")]
    Closed,

    /// Invalid DSN / connection string.
    #[error("sixsevendb: invalid DSN: {0}")]
    InvalidDsn(String),

    /// An I/O error on the TCP connection.
    #[error("sixsevendb: io error: {0}")]
    Io(#[from] std::io::Error),

    /// Protocol-level error (unexpected message, malformed data).
    #[error("sixsevendb: protocol error: {0}")]
    Protocol(String),

    /// Authentication failure.
    #[error("sixsevendb: auth error: {0}")]
    Auth(String),

    /// Type conversion error.
    #[error("sixsevendb: type error: {0}")]
    Type(String),

    /// Query builder validation error.
    #[error("sixsevendb: builder error: {0}")]
    Builder(String),

    /// Connection pool error.
    #[error("sixsevendb: pool error: {0}")]
    Pool(String),
}

/// Structured server error parsed from ErrorResponse message fields.
#[derive(Debug, Clone)]
pub struct ServerError {
    pub severity: String,
    pub code: String,
    pub message: String,
    pub detail: Option<String>,
    pub hint: Option<String>,
}

impl fmt::Display for ServerError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {} (SQLSTATE {})", self.severity, self.message, self.code)
    }
}

impl From<ServerError> for Error {
    fn from(e: ServerError) -> Self {
        Error::Server {
            severity: e.severity,
            code: e.code,
            message: e.message,
            detail: e.detail,
            hint: e.hint,
        }
    }
}

pub type Result<T> = std::result::Result<T, Error>;
