// Package sixsevendb provides a Go client library for SixSevenDB,
// implementing the database/sql driver interface.
//
// # Quick Start
//
// Import the driver to register it with database/sql:
//
//	import (
//	    "database/sql"
//	    _ "github.com/sixsevendb/sixsevendb-go"
//	)
//
//	db, err := sql.Open("sixseven", "sixseven://user:password@localhost:6767/mydb")
//
// # DSN Format
//
// The driver accepts these DSN formats:
//
//	sixseven://user:password@host:port/database
//	postgresql://user:password@host:port/database
//	host=localhost port=6767 user=sixseven database=mydb
//
// # Query Builders
//
// SixSevenDB-specific query builders are provided for graph and vector operations:
//
//	q, err := sixsevendb.BuildTraverse("follows", "users", userID, sixsevendb.WithMaxDepth(3))
//	rows, err := db.QueryContext(ctx, q.Text, q.Values...)
//
//	q, err := sixsevendb.BuildNearest("products", "embedding", queryVec, sixsevendb.WithK(5))
//	rows, err := db.QueryContext(ctx, q.Text, q.Values...)
//
// # Transactions
//
// Use the standard sql.Tx interface or the WithTransaction helper:
//
//	err := sixsevendb.WithTransaction(ctx, db, func(tx *sql.Tx) error {
//	    _, err := tx.ExecContext(ctx, "INSERT INTO users (name) VALUES ($1)", "Alice")
//	    return err
//	})
//
// # Type Mapping
//
// SixSevenDB types are mapped to Go types:
//
//	BOOL        → bool
//	TINYINT     → int8
//	INT2        → int16
//	INT4        → int32
//	INT8        → int64
//	UINT8-64    → uint8-uint64
//	FLOAT4      → float32
//	FLOAT8      → float64
//	NUMERIC     → string
//	TEXT/VARCHAR → string
//	BYTEA/BLOB  → []byte
//	DATE        → time.Time
//	TIMESTAMP   → time.Time
//	INTERVAL    → sixsevendb.Interval
//	UUID        → [16]byte
//	EMBEDDING   → sixsevendb.Embedding ([]float32)
//	JSON        → interface{}
package sixsevendb
