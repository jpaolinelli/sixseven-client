use crate::config::Config;
use crate::connection::Connection;
use crate::error::{Error, Result};

/// A bb8-compatible connection manager for SixSevenDB.
#[derive(Debug, Clone)]
pub struct ConnectionManager {
    config: Config,
}

impl ConnectionManager {
    pub fn new(config: Config) -> Self {
        Self { config }
    }
}

impl bb8::ManageConnection for ConnectionManager {
    type Connection = Connection;
    type Error = Error;

    async fn connect(&self) -> std::result::Result<Self::Connection, Self::Error> {
        Connection::connect(&self.config).await
    }

    async fn is_valid(&self, conn: &mut Self::Connection) -> std::result::Result<(), Self::Error> {
        conn.ping().await
    }

    fn has_broken(&self, conn: &mut Self::Connection) -> bool {
        conn.is_closed()
    }
}

/// A connection pool for SixSevenDB backed by bb8.
pub type Pool = bb8::Pool<ConnectionManager>;

/// Build a new connection pool.
pub async fn create_pool(config: Config, max_size: u32) -> Result<Pool> {
    let manager = ConnectionManager::new(config);
    bb8::Pool::builder()
        .max_size(max_size)
        .build(manager)
        .await
        .map_err(|e| Error::Pool(e.to_string()))
}

/// Run a closure with a pooled connection inside a transaction.
///
/// Acquires a connection, begins a transaction, executes the closure,
/// and commits on success or rolls back on error.
pub async fn with_transaction<F, Fut, T>(pool: &Pool, f: F) -> Result<T>
where
    F: FnOnce(&mut crate::transaction::Transaction<'_>) -> Fut,
    Fut: std::future::Future<Output = Result<T>>,
{
    let mut conn = pool.get().await.map_err(|e| Error::Pool(e.to_string()))?;
    let mut txn = crate::transaction::Transaction::begin(&mut conn).await?;
    match f(&mut txn).await {
        Ok(val) => {
            txn.commit().await?;
            Ok(val)
        }
        Err(e) => {
            txn.rollback().await?;
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_connection_manager_new() {
        let cfg = Config::default();
        let mgr = ConnectionManager::new(cfg.clone());
        assert_eq!(mgr.config.host, cfg.host);
        assert_eq!(mgr.config.port, cfg.port);
    }
}
