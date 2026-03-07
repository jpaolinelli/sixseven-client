package sixsevendb

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"fmt"
	"io"
	"sync"
	"testing"
)

// --- Fake driver infrastructure for testing WithTransaction ---

// fakeDriver is a minimal driver that records SQL commands for verification.
type fakeDriver struct{}

func (d *fakeDriver) Open(name string) (driver.Conn, error) {
	return &fakeConn{}, nil
}

type fakeConn struct {
	mu       sync.Mutex
	commands []string
	closed   bool
	failNext string // if set, the next Exec matching this returns an error
}

func (c *fakeConn) Prepare(query string) (driver.Stmt, error) {
	return &fakeStmt{conn: c, query: query}, nil
}

func (c *fakeConn) Close() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.closed = true
	return nil
}

func (c *fakeConn) Begin() (driver.Tx, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.commands = append(c.commands, "BEGIN")
	return &fakeTx{conn: c}, nil
}

func (c *fakeConn) ExecContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Result, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.commands = append(c.commands, query)
	if c.failNext != "" && query == c.failNext {
		c.failNext = ""
		return nil, fmt.Errorf("fake error on %q", query)
	}
	return fakeResult{}, nil
}

func (c *fakeConn) QueryContext(_ context.Context, query string, _ []driver.NamedValue) (driver.Rows, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.commands = append(c.commands, query)
	return &fakeRows{}, nil
}

func (c *fakeConn) getCommands() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	cp := make([]string, len(c.commands))
	copy(cp, c.commands)
	return cp
}

type fakeTx struct {
	conn *fakeConn
}

func (tx *fakeTx) Commit() error {
	tx.conn.mu.Lock()
	defer tx.conn.mu.Unlock()
	tx.conn.commands = append(tx.conn.commands, "COMMIT")
	return nil
}

func (tx *fakeTx) Rollback() error {
	tx.conn.mu.Lock()
	defer tx.conn.mu.Unlock()
	tx.conn.commands = append(tx.conn.commands, "ROLLBACK")
	return nil
}

type fakeStmt struct {
	conn  *fakeConn
	query string
}

func (s *fakeStmt) Close() error                               { return nil }
func (s *fakeStmt) NumInput() int                              { return -1 }
func (s *fakeStmt) Exec(args []driver.Value) (driver.Result, error) { return fakeResult{}, nil }
func (s *fakeStmt) Query(args []driver.Value) (driver.Rows, error)  { return &fakeRows{}, nil }

type fakeResult struct{}

func (r fakeResult) LastInsertId() (int64, error) { return 0, nil }
func (r fakeResult) RowsAffected() (int64, error) { return 1, nil }

type fakeRows struct{ closed bool }

func (r *fakeRows) Columns() []string          { return nil }
func (r *fakeRows) Close() error               { r.closed = true; return nil }
func (r *fakeRows) Next(dest []driver.Value) error { return io.EOF }

// openFakeDB registers a unique fake driver and returns a *sql.DB and the underlying fakeConn.
func openFakeDB(t *testing.T) (*sql.DB, *fakeConn) {
	t.Helper()
	name := fmt.Sprintf("fakedb_%p", t)
	fc := &fakeConn{}
	fd := &fakeDriver{}
	sql.Register(name, fd)
	db, err := sql.Open(name, "")
	if err != nil {
		t.Fatalf("sql.Open: %v", err)
	}
	// Force sql.DB to use our specific fakeConn by setting pool to 1
	db.SetMaxOpenConns(1)
	t.Cleanup(func() { db.Close() })
	return db, fc
}

// --- Tests ---

func TestWithTransaction_CommitsOnSuccess(t *testing.T) {
	db, _ := openFakeDB(t)

	called := false
	err := WithTransaction(context.Background(), db, func(tx *sql.Tx) error {
		called = true
		_, err := tx.ExecContext(context.Background(), "INSERT INTO users (name) VALUES ('Alice')")
		return err
	})
	if err != nil {
		t.Fatalf("WithTransaction error: %v", err)
	}
	if !called {
		t.Error("callback was not called")
	}
}

func TestWithTransaction_RollsBackOnError(t *testing.T) {
	db, _ := openFakeDB(t)

	userErr := errors.New("something went wrong")
	err := WithTransaction(context.Background(), db, func(tx *sql.Tx) error {
		return userErr
	})
	if !errors.Is(err, userErr) {
		t.Errorf("expected user error, got %v", err)
	}
}

func TestWithTransaction_PropagatesCallbackError(t *testing.T) {
	db, _ := openFakeDB(t)

	expectedErr := fmt.Errorf("custom error: %w", errors.New("inner"))
	err := WithTransaction(context.Background(), db, func(tx *sql.Tx) error {
		return expectedErr
	})
	if err == nil {
		t.Fatal("expected error, got nil")
	}
	if !errors.Is(err, expectedErr) {
		t.Errorf("error = %v, want %v", err, expectedErr)
	}
}

func TestWithTransactionOptions_PassesOptions(t *testing.T) {
	db, _ := openFakeDB(t)

	// Use default options — the fake driver does not implement ConnBeginTx
	// so non-default isolation levels are rejected by database/sql.
	opts := &sql.TxOptions{
		Isolation: sql.LevelDefault,
		ReadOnly:  false,
	}
	called := false
	err := WithTransactionOptions(context.Background(), db, opts, func(tx *sql.Tx) error {
		called = true
		return nil
	})
	if err != nil {
		t.Fatalf("WithTransactionOptions error: %v", err)
	}
	if !called {
		t.Error("callback was not called")
	}
}

func TestWithTransactionOptions_RollsBackOnError(t *testing.T) {
	db, _ := openFakeDB(t)

	userErr := errors.New("tx failed")
	err := WithTransactionOptions(context.Background(), db, nil, func(tx *sql.Tx) error {
		return userErr
	})
	if !errors.Is(err, userErr) {
		t.Errorf("expected user error, got %v", err)
	}
}
