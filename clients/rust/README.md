# SixSevenDB Rust Client (`sixsevendb`)

Async Rust client library for SixSevenDB with Tokio, bb8 connection pooling,
and type-safe query builders for graph traversal and vector search.

## Features

- **Async/Await** — All I/O operations are async, powered by Tokio
- **Connection Pooling** — bb8-based pool with health checks
- **PG Wire Protocol** — Pure Rust implementation (text format)
- **Authentication** — Trust, MD5, and SCRAM-SHA-256 (RFC 5802)
- **Type System** — All 22 SixSevenDB types mapped to Rust types
- **Query Builders** — TRAVERSE, NEAREST, LINK, UNLINK, MATCH, SHORTEST PATH
- **Transactions** — Borrow-checker enforced exclusivity, savepoints, auto-rollback on drop
- **SHOW/EXPLAIN Helpers** — Typed SQL generators for introspection commands

## Quick Start

```rust
use sixsevendb::{Config, Connection};

#[tokio::main]
async fn main() -> sixsevendb::Result<()> {
    let cfg = Config::new()
        .host("localhost")
        .port(6767)
        .user("sixseven")
        .database("mydb");

    let mut conn = Connection::connect(&cfg).await?;

    // Or with a URI
    // let mut conn = Connection::connect_dsn("sixseven://localhost:6767/mydb").await?;

    let result = conn.simple_query("SELECT * FROM users LIMIT 10").await?;
    for row in result.typed_rows() {
        println!("{:?}", row);
    }

    conn.close().await?;
    Ok(())
}
```

## Connection Pooling

```rust
use sixsevendb::{Config, pool};

#[tokio::main]
async fn main() -> sixsevendb::Result<()> {
    let cfg = Config::new().host("localhost").port(6767);
    let pool = pool::create_pool(cfg, 10).await?;

    let mut conn = pool.get().await.unwrap();
    let result = conn.simple_query("SELECT 1").await?;
    println!("rows: {}", result.rows.len());
    Ok(())
}
```

## Query Builders

### TRAVERSE (Graph Traversal)

```rust
use sixsevendb::*;

let query = build_traverse(
    "follows",
    "users",
    Value::Int4(1),
    TraverseOptions::new()
        .direction("OUT")
        .max_depth(3)
        .fetch(),
)?;
// TRAVERSE "follows" FROM "users"($1) DIRECTION OUT MAX_DEPTH 3 FETCH
```

### NEAREST (Vector Search)

```rust
use sixsevendb::*;

let query = build_nearest(
    "products",
    "embedding",
    Embedding::new(vec![0.1, 0.2, 0.3]),
    NearestOptions::new()
        .k(5)
        .metric("COSINE"),
)?;
// NEAREST 5 FROM "products"."embedding" TO $1 USING COSINE
```

### MATCH (Pattern Matching)

```rust
use sixsevendb::*;

let a = MatchNode::new("a", "users");
let r = MatchEdge::new("r", "follows", Direction::Out);
let b = MatchNode::new("b", "users");

let query = build_match(
    &[&a, &r, &b],
    &["a", "b"],
    MatchOptions::new().where_clause("a.age > 21"),
)?;
// MATCH (a:"users")-[r:"follows"]->(b:"users") RETURN a, b WHERE a.age > 21
```

### SHORTEST PATH

```rust
use sixsevendb::*;

let query = build_shortest_path(
    "follows",
    "users", Value::Int4(1),
    "users", Value::Int4(42),
    PathOptions::new().direction(Direction::Out).max_depth(5),
)?;
// SHORTEST PATH FROM "users"($1) TO "users"($2) VIA "follows" DIRECTION OUT MAX_DEPTH 5
```

## Transactions

```rust
use sixsevendb::*;

let mut conn = Connection::connect(&config).await?;
let mut txn = Transaction::begin(&mut conn).await?;

txn.execute("INSERT INTO users (name) VALUES ($1)", &[Value::Text("Alice".into())]).await?;

// Savepoints
let mut sp = txn.savepoint("before_update").await?;
sp.execute("UPDATE users SET active = true", &[]).await?;
sp.release().await?;

txn.commit().await?;
// Transaction auto-rolls back on drop if not committed
```

## Type Mapping

| SixSevenDB Type | Rust Type | OID |
|---|---|---|
| BOOL | `bool` | 16 |
| TINYINT | `i8` | 18 |
| INT2 | `i16` | 21 |
| INT4 | `i32` | 23 |
| INT8 | `i64` | 20 |
| UINT8/16/32/64 | `u8`/`u16`/`u32`/`u64` | 100001-100004 |
| FLOAT4 | `f32` | 700 |
| FLOAT8 | `f64` | 701 |
| NUMERIC | `String` | 1700 |
| TEXT/VARCHAR/CHAR | `String` | 25/1043/1042 |
| BYTEA/BLOB | `Vec<u8>` | 17/100005 |
| DATE | `chrono::NaiveDate` | 1082 |
| TIME | `String` | 1083 |
| TIMESTAMP | `chrono::NaiveDateTime` | 1114 |
| INTERVAL | `Interval` | 1186 |
| JSON | `String` | 114 |
| UUID | `uuid::Uuid` | 2950 |
| EMBEDDING | `Embedding` (`Vec<f32>`) | 100000 |

## Connection URI Formats

```
sixseven://user:pass@host:port/database
postgresql://user:pass@host:port/database
host=localhost port=6767 user=sixseven database=mydb
```
