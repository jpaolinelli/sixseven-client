# sixsevendb-go

Go client library for [SixSevenDB](https://sixsevendb.com), implementing the standard `database/sql` driver interface.

## Installation

```bash
go get github.com/sixsevendb/sixsevendb-go
```

## Quick Start

```go
package main

import (
    "context"
    "database/sql"
    "fmt"
    "log"

    _ "github.com/sixsevendb/sixsevendb-go"
)

func main() {
    db, err := sql.Open("sixseven", "sixseven://localhost:6767/mydb")
    if err != nil {
        log.Fatal(err)
    }
    defer db.Close()

    // Standard SQL
    rows, err := db.QueryContext(context.Background(), "SELECT id, name FROM users")
    if err != nil {
        log.Fatal(err)
    }
    defer rows.Close()

    for rows.Next() {
        var id int
        var name string
        rows.Scan(&id, &name)
        fmt.Printf("%d: %s\n", id, name)
    }
}
```

## DSN Formats

```
sixseven://user:password@host:port/database
postgresql://user:password@host:port/database
host=localhost port=6767 user=sixseven database=mydb
```

Defaults: host=`localhost`, port=`6767`, user=`sixseven`, database=`sixseven`.

## Graph Queries

```go
import sixsevendb "github.com/sixsevendb/sixsevendb-go"

// TRAVERSE
q, _ := sixsevendb.BuildTraverse("follows", "users", userID,
    sixsevendb.WithMaxDepth(3),
    sixsevendb.WithDirection("OUT"),
)
rows, _ := db.QueryContext(ctx, q.Text, q.Values...)

// LINK
q, _ := sixsevendb.BuildLink("follows", "users", 1, "users", 2, nil)
db.ExecContext(ctx, q.Text, q.Values...)

// UNLINK
q := sixsevendb.BuildUnlink("follows", "users", 1, "users", 2)
db.ExecContext(ctx, q.Text, q.Values...)

// MATCH (Cypher-style)
q, _ := sixsevendb.BuildMatch(
    []sixsevendb.PatternElement{
        sixsevendb.MatchNode{Alias: "a", Table: "users"},
        sixsevendb.MatchEdge{Alias: "r", EdgeType: "follows", Direction: "OUT"},
        sixsevendb.MatchNode{Alias: "b", Table: "users"},
    },
    []string{"a", "b"},
)
rows, _ := db.QueryContext(ctx, q.Text, q.Values...)

// SHORTEST PATH
q, _ := sixsevendb.BuildShortestPath("follows", "users", 1, "users", 2,
    sixsevendb.WithPathMaxDepth(10),
)
rows, _ := db.QueryContext(ctx, q.Text, q.Values...)
```

## Vector Queries

```go
// NEAREST
vec := sixsevendb.Embedding{0.1, 0.2, 0.3}
q, _ := sixsevendb.BuildNearest("products", "embedding", vec,
    sixsevendb.WithK(5),
    sixsevendb.WithMetric("COSINE"),
)
rows, _ := db.QueryContext(ctx, q.Text, q.Values...)
```

## Transactions

```go
// Using WithTransaction helper (auto-commit/rollback)
err := sixsevendb.WithTransaction(ctx, db, func(tx *sql.Tx) error {
    _, err := tx.ExecContext(ctx, "INSERT INTO users (name) VALUES ($1)", "Alice")
    return err
})

// Using standard sql.Tx
tx, _ := db.BeginTx(ctx, nil)
tx.ExecContext(ctx, "INSERT INTO users (name) VALUES ($1)", "Bob")
tx.Commit()

// Savepoints via raw queries
tx, _ := db.BeginTx(ctx, nil)
tx.ExecContext(ctx, "SAVEPOINT sp1")
// ... work ...
tx.ExecContext(ctx, "ROLLBACK TO SAVEPOINT sp1")
tx.Commit()
```

## Type Mapping

| SixSevenDB Type | Go Type |
|----------------|---------|
| BOOL | `bool` |
| TINYINT | `int8` |
| INT2 | `int16` |
| INT4 | `int32` |
| INT8 | `int64` |
| UINT8-64 | `uint8`-`uint64` |
| FLOAT4 | `float32` |
| FLOAT8 | `float64` |
| NUMERIC | `string` |
| TEXT/VARCHAR/CHAR | `string` |
| BYTEA/BLOB | `[]byte` |
| DATE | `time.Time` |
| TIMESTAMP | `time.Time` |
| TIME | `string` |
| INTERVAL | `sixsevendb.Interval` |
| UUID | `[16]byte` |
| EMBEDDING | `sixsevendb.Embedding` (`[]float32`) |
| JSON | `interface{}` |

## Schema Helpers

```go
// SHOW commands
db.QueryContext(ctx, sixsevendb.ShowDatabasesSQL())
db.QueryContext(ctx, sixsevendb.ShowTablesSQL())
db.QueryContext(ctx, sixsevendb.ShowColumnsSQL("users"))
db.QueryContext(ctx, sixsevendb.ShowEdgeTypesSQL())

// EXPLAIN
db.QueryContext(ctx, sixsevendb.ExplainSQL("SELECT * FROM users"))
db.QueryContext(ctx, sixsevendb.ExplainAnalyzeSQL("SELECT * FROM users"))

// Edge type management
db.ExecContext(ctx, sixsevendb.CreateEdgeTypeSQL("follows", "users", "users", nil))
db.ExecContext(ctx, sixsevendb.DropEdgeTypeSQL("follows", true))
```

## Authentication

The driver supports trust, MD5, and SCRAM-SHA-256 authentication, auto-detected from the server's response during connection.

## License

See the project root LICENSE file.
