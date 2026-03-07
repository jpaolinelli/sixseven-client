//! # SixSevenDB Rust Client
//!
//! Async Rust client library for SixSevenDB with Tokio support,
//! connection pooling (bb8), and type-safe query builders.
//!
//! ## Quick Start
//!
//! ```rust,no_run
//! use sixsevendb::{Config, Connection};
//!
//! #[tokio::main]
//! async fn main() -> sixsevendb::Result<()> {
//!     // Connect with config builder
//!     let cfg = Config::new().host("localhost").port(6767).database("mydb");
//!     let mut conn = Connection::connect(&cfg).await?;
//!
//!     // Simple query
//!     let result = conn.simple_query("SELECT * FROM users").await?;
//!     for row in result.typed_rows() {
//!         println!("{:?}", row);
//!     }
//!
//!     conn.close().await?;
//!     Ok(())
//! }
//! ```
//!
//! ## Connection Pooling
//!
//! ```rust,no_run
//! use sixsevendb::{Config, pool};
//!
//! #[tokio::main]
//! async fn main() -> sixsevendb::Result<()> {
//!     let cfg = Config::new().host("localhost").port(6767);
//!     let pool = pool::create_pool(cfg, 10).await?;
//!
//!     let mut conn = pool.get().await.unwrap();
//!     conn.simple_query("SELECT 1").await?;
//!     Ok(())
//! }
//! ```

pub mod auth;
pub mod config;
pub mod connection;
pub mod error;
pub mod helpers;
pub mod match_builders;
pub mod pool;
pub mod protocol;
pub mod query_builders;
pub mod transaction;
pub mod types;

// QA adversarial test modules
#[cfg(test)]
mod qa_gdb_50_types;
#[cfg(test)]
mod qa_gdb_50_query_builders;
#[cfg(test)]
mod qa_gdb_50_protocol_auth;

// Re-export primary types at crate root
pub use config::Config;
pub use connection::{Connection, QueryResult};
pub use error::{Error, Result};
pub use match_builders::{
    Direction, MatchEdge, MatchNode, MatchOptions, PathOptions,
    build_match, build_shortest_path,
};
pub use query_builders::{
    Query, build_link, build_nearest, build_traverse, build_unlink,
    quote_identifier, LinkProperties, NearestOptions, TraverseOptions,
};
pub use transaction::{IsolationLevel, Transaction, TransactionOptions};
pub use types::{Embedding, Interval, Value};
