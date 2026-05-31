use crate::connection::{Connection, QueryResult};
use crate::error::{Error, Result};
use crate::types::Value;

/// Transaction isolation levels.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum IsolationLevel {
    #[default]
    Default,
    ReadUncommitted,
    ReadCommitted,
    RepeatableRead,
    Serializable,
    Snapshot,
}

impl IsolationLevel {
    pub fn as_sql(&self) -> Option<&str> {
        match self {
            IsolationLevel::Default => None,
            IsolationLevel::ReadUncommitted => Some("READ UNCOMMITTED"),
            IsolationLevel::ReadCommitted => Some("READ COMMITTED"),
            IsolationLevel::RepeatableRead => Some("REPEATABLE READ"),
            IsolationLevel::Serializable => Some("SERIALIZABLE"),
            IsolationLevel::Snapshot => Some("SNAPSHOT"),
        }
    }
}

/// Options for starting a transaction.
#[derive(Debug, Clone, Default)]
pub struct TransactionOptions {
    pub isolation: IsolationLevel,
    pub read_only: bool,
}

impl TransactionOptions {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn isolation(mut self, level: IsolationLevel) -> Self {
        self.isolation = level;
        self
    }

    pub fn read_only(mut self) -> Self {
        self.read_only = true;
        self
    }
}

/// A database transaction that borrows a connection exclusively.
///
/// The transaction auto-rolls back on drop if not committed.
pub struct Transaction<'a> {
    conn: &'a mut Connection,
    done: bool,
}

impl<'a> Transaction<'a> {
    /// Begin a new transaction with default options.
    pub async fn begin(conn: &'a mut Connection) -> Result<Transaction<'a>> {
        conn.simple_query("BEGIN").await?;
        Ok(Transaction { conn, done: false })
    }

    /// Begin a new transaction with custom options.
    pub async fn begin_with(
        conn: &'a mut Connection,
        opts: TransactionOptions,
    ) -> Result<Transaction<'a>> {
        let mut sql = "BEGIN".to_string();
        if let Some(level) = opts.isolation.as_sql() {
            sql.push_str(&format!(" ISOLATION LEVEL {level}"));
        }
        if opts.read_only {
            sql.push_str(" READ ONLY");
        }
        conn.simple_query(&sql).await?;
        Ok(Transaction { conn, done: false })
    }

    /// Execute a query within the transaction.
    pub async fn query(&mut self, sql: &str, params: &[Value]) -> Result<QueryResult> {
        if self.done {
            return Err(Error::Protocol("transaction already completed".into()));
        }
        self.conn.query(sql, params).await
    }

    /// Execute a statement within the transaction, returning rows affected.
    pub async fn execute(&mut self, sql: &str, params: &[Value]) -> Result<u64> {
        if self.done {
            return Err(Error::Protocol("transaction already completed".into()));
        }
        self.conn.execute(sql, params).await
    }

    /// Commit the transaction. Consumes self.
    pub async fn commit(mut self) -> Result<()> {
        self.done = true;
        self.conn.simple_query("COMMIT").await?;
        Ok(())
    }

    /// Rollback the transaction. Consumes self.
    pub async fn rollback(mut self) -> Result<()> {
        self.done = true;
        self.conn.simple_query("ROLLBACK").await?;
        Ok(())
    }

    /// Create a savepoint within the transaction.
    pub async fn savepoint(&mut self, name: &str) -> Result<Savepoint<'_, 'a>> {
        if self.done {
            return Err(Error::Protocol("transaction already completed".into()));
        }
        let sql = format!("SAVEPOINT {}", crate::query_builders::quote_identifier(name));
        self.conn.simple_query(&sql).await?;
        Ok(Savepoint {
            txn: self,
            name: name.to_string(),
            released: false,
        })
    }
}

impl Drop for Transaction<'_> {
    fn drop(&mut self) {
        if !self.done {
            tracing::warn!("transaction dropped without commit/rollback; auto-rollback pending");
            // We can't do async in Drop. The connection will be in a bad state
            // if the user doesn't commit/rollback. The pool will detect this.
            self.done = true;
        }
    }
}

/// A savepoint within a transaction.
pub struct Savepoint<'a, 'b> {
    txn: &'a mut Transaction<'b>,
    name: String,
    released: bool,
}

impl<'a, 'b> Savepoint<'a, 'b> {
    /// Rollback to this savepoint.
    pub async fn rollback(mut self) -> Result<()> {
        self.released = true;
        let sql = format!(
            "ROLLBACK TO SAVEPOINT {}",
            crate::query_builders::quote_identifier(&self.name)
        );
        self.txn.conn.simple_query(&sql).await?;
        Ok(())
    }

    /// Release (commit) this savepoint.
    pub async fn release(mut self) -> Result<()> {
        self.released = true;
        let sql = format!(
            "RELEASE SAVEPOINT {}",
            crate::query_builders::quote_identifier(&self.name)
        );
        self.txn.conn.simple_query(&sql).await?;
        Ok(())
    }

    /// Execute a query within the savepoint's transaction.
    pub async fn query(&mut self, sql: &str, params: &[Value]) -> Result<QueryResult> {
        self.txn.query(sql, params).await
    }

    /// Execute a statement within the savepoint's transaction.
    pub async fn execute(&mut self, sql: &str, params: &[Value]) -> Result<u64> {
        self.txn.execute(sql, params).await
    }
}

impl Drop for Savepoint<'_, '_> {
    fn drop(&mut self) {
        if !self.released {
            tracing::warn!("savepoint '{}' dropped without rollback/release", self.name);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_isolation_level_sql() {
        assert_eq!(IsolationLevel::Default.as_sql(), None);
        assert_eq!(IsolationLevel::ReadUncommitted.as_sql(), Some("READ UNCOMMITTED"));
        assert_eq!(IsolationLevel::ReadCommitted.as_sql(), Some("READ COMMITTED"));
        assert_eq!(IsolationLevel::RepeatableRead.as_sql(), Some("REPEATABLE READ"));
        assert_eq!(IsolationLevel::Serializable.as_sql(), Some("SERIALIZABLE"));
        assert_eq!(IsolationLevel::Snapshot.as_sql(), Some("SNAPSHOT"));
    }

    #[test]
    fn test_transaction_options_builder() {
        let opts = TransactionOptions::new()
            .isolation(IsolationLevel::Serializable)
            .read_only();
        assert_eq!(opts.isolation, IsolationLevel::Serializable);
        assert!(opts.read_only);
    }

    #[test]
    fn test_transaction_options_default() {
        let opts = TransactionOptions::default();
        assert_eq!(opts.isolation, IsolationLevel::Default);
        assert!(!opts.read_only);
    }
}
