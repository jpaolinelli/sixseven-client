package sixsevendb

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"io"
	"strconv"
	"strings"
	"sync"
)

func init() {
	sql.Register("sixseven", &Driver{})
}

// Driver implements database/sql/driver.Driver and driver.DriverContext.
type Driver struct{}

// Open returns a new connection to the database.
// The name is a DSN string: sixseven://user:password@host:port/database
func (d *Driver) Open(name string) (driver.Conn, error) {
	connector, err := d.OpenConnector(name)
	if err != nil {
		return nil, err
	}
	return connector.Connect(context.Background())
}

// OpenConnector returns a new connector for the given DSN.
func (d *Driver) OpenConnector(name string) (driver.Connector, error) {
	cfg, err := ParseDSN(name)
	if err != nil {
		return nil, err
	}
	return &Connector{cfg: cfg, driver: d}, nil
}

// Connector implements driver.Connector.
type Connector struct {
	cfg    *dialConfig
	driver *Driver
}

// Connect establishes a new connection with context support.
func (c *Connector) Connect(ctx context.Context) (driver.Conn, error) {
	rc, err := dial(ctx, c.cfg)
	if err != nil {
		return nil, err
	}
	return &driverConn{raw: rc}, nil
}

// Driver returns the underlying driver.
func (c *Connector) Driver() driver.Driver {
	return c.driver
}

// driverConn implements driver.Conn and related context-aware interfaces.
type driverConn struct {
	raw *rawConn
}

// Prepare returns a prepared statement.
func (dc *driverConn) Prepare(query string) (driver.Stmt, error) {
	return dc.PrepareContext(context.Background(), query)
}

// PrepareContext returns a prepared statement with context.
func (dc *driverConn) PrepareContext(_ context.Context, query string) (driver.Stmt, error) {
	return &driverStmt{conn: dc, query: query}, nil
}

// Close closes the connection.
func (dc *driverConn) Close() error {
	return dc.raw.close()
}

// Begin starts a transaction (deprecated, use BeginTx).
func (dc *driverConn) Begin() (driver.Tx, error) {
	return dc.BeginTx(context.Background(), driver.TxOptions{})
}

// BeginTx starts a transaction with context and options.
func (dc *driverConn) BeginTx(ctx context.Context, opts driver.TxOptions) (driver.Tx, error) {
	isolationLevel := ""
	switch sql.IsolationLevel(opts.Isolation) {
	case sql.LevelDefault:
		// use server default
	case sql.LevelReadUncommitted:
		isolationLevel = "READ UNCOMMITTED"
	case sql.LevelReadCommitted:
		isolationLevel = "READ COMMITTED"
	case sql.LevelRepeatableRead:
		isolationLevel = "REPEATABLE READ"
	case sql.LevelSerializable:
		isolationLevel = "SERIALIZABLE"
	case sql.LevelSnapshot:
		isolationLevel = "SNAPSHOT"
	default:
		return nil, fmt.Errorf("sixsevendb: unsupported isolation level %d", opts.Isolation)
	}

	beginSQL := "BEGIN"
	if isolationLevel != "" {
		beginSQL = fmt.Sprintf("BEGIN ISOLATION LEVEL %s", isolationLevel)
	}
	if opts.ReadOnly {
		beginSQL += " READ ONLY"
	}

	_, _, _, err := dc.raw.simpleQuery(ctx, beginSQL)
	if err != nil {
		return nil, err
	}
	return &driverTx{conn: dc}, nil
}

// ExecContext executes a query that doesn't return rows.
func (dc *driverConn) ExecContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Result, error) {
	fields, rows, tag, err := dc.execQuery(ctx, query, args)
	_ = fields
	_ = rows
	if err != nil {
		return nil, err
	}
	return &driverResult{tag: tag}, nil
}

// QueryContext executes a query that returns rows.
func (dc *driverConn) QueryContext(ctx context.Context, query string, args []driver.NamedValue) (driver.Rows, error) {
	fields, rows, _, err := dc.execQuery(ctx, query, args)
	if err != nil {
		return nil, err
	}
	return &driverRows{fields: fields, rows: rows}, nil
}

// execQuery dispatches to simple or extended query protocol.
func (dc *driverConn) execQuery(ctx context.Context, query string, args []driver.NamedValue) ([]fieldDescription, [][][]byte, string, error) {
	if len(args) == 0 {
		return dc.raw.simpleQuery(ctx, query)
	}
	strArgs := make([]string, len(args))
	for i, arg := range args {
		strArgs[i] = formatArg(arg.Value)
	}
	return dc.raw.extendedQuery(ctx, query, strArgs)
}

// Ping checks the connection is alive.
func (dc *driverConn) Ping(ctx context.Context) error {
	_, _, _, err := dc.raw.simpleQuery(ctx, "SELECT 1")
	return err
}

// ResetSession resets the session state.
func (dc *driverConn) ResetSession(_ context.Context) error {
	return nil
}

// IsValid reports whether the connection is still valid.
func (dc *driverConn) IsValid() bool {
	return dc.raw != nil && !dc.raw.closed
}

// driverStmt implements driver.Stmt with context-aware execution.
type driverStmt struct {
	conn  *driverConn
	query string
}

func (s *driverStmt) Close() error { return nil }

func (s *driverStmt) NumInput() int { return -1 } // unknown

func (s *driverStmt) Exec(args []driver.Value) (driver.Result, error) {
	return s.ExecContext(context.Background(), namedValues(args))
}

func (s *driverStmt) Query(args []driver.Value) (driver.Rows, error) {
	return s.QueryContext(context.Background(), namedValues(args))
}

func (s *driverStmt) ExecContext(ctx context.Context, args []driver.NamedValue) (driver.Result, error) {
	return s.conn.ExecContext(ctx, s.query, args)
}

func (s *driverStmt) QueryContext(ctx context.Context, args []driver.NamedValue) (driver.Rows, error) {
	return s.conn.QueryContext(ctx, s.query, args)
}

// driverTx implements driver.Tx.
type driverTx struct {
	conn *driverConn
	done bool
	mu   sync.Mutex
}

func (tx *driverTx) Commit() error {
	tx.mu.Lock()
	defer tx.mu.Unlock()
	if tx.done {
		return fmt.Errorf("sixsevendb: transaction already finished")
	}
	tx.done = true
	_, _, _, err := tx.conn.raw.simpleQuery(context.Background(), "COMMIT")
	return err
}

func (tx *driverTx) Rollback() error {
	tx.mu.Lock()
	defer tx.mu.Unlock()
	if tx.done {
		return fmt.Errorf("sixsevendb: transaction already finished")
	}
	tx.done = true
	_, _, _, err := tx.conn.raw.simpleQuery(context.Background(), "ROLLBACK")
	return err
}

// driverResult implements driver.Result.
type driverResult struct {
	tag string
}

func (r *driverResult) LastInsertId() (int64, error) {
	return 0, fmt.Errorf("sixsevendb: LastInsertId not supported")
}

func (r *driverResult) RowsAffected() (int64, error) {
	return parseRowCount(r.tag), nil
}

// driverRows implements driver.Rows.
type driverRows struct {
	fields []fieldDescription
	rows   [][][]byte
	pos    int
	closed bool
}

func (r *driverRows) Columns() []string {
	cols := make([]string, len(r.fields))
	for i, f := range r.fields {
		cols[i] = f.Name
	}
	return cols
}

func (r *driverRows) Close() error {
	r.closed = true
	return nil
}

func (r *driverRows) Next(dest []driver.Value) error {
	if r.closed || r.pos >= len(r.rows) {
		return io.EOF
	}
	row := r.rows[r.pos]
	r.pos++

	for i, raw := range row {
		if raw == nil {
			dest[i] = nil
		} else if i < len(r.fields) {
			val, err := ParseValue(r.fields[i].TypeOID, string(raw))
			if err != nil {
				// Fall back to raw string on parse error
				dest[i] = string(raw)
			} else {
				dest[i] = val
			}
		} else {
			dest[i] = string(raw)
		}
	}
	return nil
}

// namedValues converts driver.Value slice to driver.NamedValue slice.
func namedValues(args []driver.Value) []driver.NamedValue {
	named := make([]driver.NamedValue, len(args))
	for i, v := range args {
		named[i] = driver.NamedValue{Ordinal: i + 1, Value: v}
	}
	return named
}

// formatArg converts a driver value to string for the wire protocol.
func formatArg(v interface{}) string {
	if v == nil {
		return nullValue
	}
	switch val := v.(type) {
	case string:
		return val
	case []byte:
		return string(val)
	case int64:
		return strconv.FormatInt(val, 10)
	case float64:
		return strconv.FormatFloat(val, 'f', -1, 64)
	case bool:
		if val {
			return "true"
		}
		return "false"
	case Embedding:
		return SerializeEmbedding(val)
	case []float32:
		return SerializeEmbedding(Embedding(val))
	case Interval:
		return val.String()
	default:
		return fmt.Sprintf("%v", val)
	}
}

// ParseDSN parses a connection string into a dialConfig.
// Supported formats:
//   - sixseven://user:password@host:port/database
//   - postgresql://user:password@host:port/database
//   - host=... port=... user=... password=... database=...
func ParseDSN(dsn string) (*dialConfig, error) {
	cfg := defaultDialConfig()

	if strings.Contains(dsn, "://") {
		return parseDSNURI(dsn, cfg)
	}
	return parseDSNKeyValue(dsn, cfg)
}

func parseDSNURI(dsn string, cfg *dialConfig) (*dialConfig, error) {
	// Extract scheme
	schemeEnd := strings.Index(dsn, "://")
	if schemeEnd < 0 {
		return nil, ErrInvalidDSN
	}
	scheme := dsn[:schemeEnd]
	rest := dsn[schemeEnd+3:]

	if scheme != "sixseven" && scheme != "postgresql" && scheme != "postgres" {
		return nil, fmt.Errorf("sixsevendb: unsupported URI scheme %q", scheme)
	}

	// Split userinfo from host
	var userinfo, hostpath string
	if atIdx := strings.Index(rest, "@"); atIdx >= 0 {
		userinfo = rest[:atIdx]
		hostpath = rest[atIdx+1:]
	} else {
		hostpath = rest
	}

	// Parse userinfo
	if userinfo != "" {
		if colonIdx := strings.Index(userinfo, ":"); colonIdx >= 0 {
			cfg.User = userinfo[:colonIdx]
			cfg.Password = userinfo[colonIdx+1:]
		} else {
			cfg.User = userinfo
		}
	}

	// Split host:port from /database
	var hostport, dbpath string
	if slashIdx := strings.Index(hostpath, "/"); slashIdx >= 0 {
		hostport = hostpath[:slashIdx]
		dbpath = hostpath[slashIdx+1:]
	} else {
		hostport = hostpath
	}

	// Parse host:port
	if hostport != "" {
		if colonIdx := strings.LastIndex(hostport, ":"); colonIdx >= 0 {
			cfg.Host = hostport[:colonIdx]
			port, err := strconv.Atoi(hostport[colonIdx+1:])
			if err != nil {
				return nil, fmt.Errorf("sixsevendb: invalid port in DSN: %w", err)
			}
			cfg.Port = port
		} else {
			cfg.Host = hostport
		}
	}

	// Parse database (strip query parameters)
	if dbpath != "" {
		if qIdx := strings.Index(dbpath, "?"); qIdx >= 0 {
			dbpath = dbpath[:qIdx]
		}
		if dbpath != "" {
			cfg.Database = dbpath
		}
	}

	return cfg, nil
}

func parseDSNKeyValue(dsn string, cfg *dialConfig) (*dialConfig, error) {
	pairs := strings.Fields(dsn)
	for _, pair := range pairs {
		eqIdx := strings.Index(pair, "=")
		if eqIdx < 0 {
			continue
		}
		key := pair[:eqIdx]
		value := pair[eqIdx+1:]
		switch key {
		case "host":
			cfg.Host = value
		case "port":
			port, err := strconv.Atoi(value)
			if err != nil {
				return nil, fmt.Errorf("sixsevendb: invalid port %q: %w", value, err)
			}
			cfg.Port = port
		case "user":
			cfg.User = value
		case "password":
			cfg.Password = value
		case "database", "dbname":
			cfg.Database = value
		}
	}
	return cfg, nil
}
