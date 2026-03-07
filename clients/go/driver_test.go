package sixsevendb

import (
	"testing"
)

func TestParseDSN_URI(t *testing.T) {
	tests := []struct {
		dsn      string
		host     string
		port     int
		user     string
		password string
		database string
	}{
		{
			"sixseven://admin:secret@db.example.com:6767/mydb",
			"db.example.com", 6767, "admin", "secret", "mydb",
		},
		{
			"sixseven://localhost:6767/testdb",
			"localhost", 6767, "sixseven", "", "testdb",
		},
		{
			"postgresql://user:pass@host:5432/db",
			"host", 5432, "user", "pass", "db",
		},
		{
			"postgres://user@host/db",
			"host", 6767, "user", "", "db",
		},
		{
			"sixseven://localhost/mydb",
			"localhost", 6767, "sixseven", "", "mydb",
		},
	}
	for _, tt := range tests {
		cfg, err := ParseDSN(tt.dsn)
		if err != nil {
			t.Errorf("ParseDSN(%q) error: %v", tt.dsn, err)
			continue
		}
		if cfg.Host != tt.host {
			t.Errorf("ParseDSN(%q).Host = %q, want %q", tt.dsn, cfg.Host, tt.host)
		}
		if cfg.Port != tt.port {
			t.Errorf("ParseDSN(%q).Port = %d, want %d", tt.dsn, cfg.Port, tt.port)
		}
		if cfg.User != tt.user {
			t.Errorf("ParseDSN(%q).User = %q, want %q", tt.dsn, cfg.User, tt.user)
		}
		if cfg.Password != tt.password {
			t.Errorf("ParseDSN(%q).Password = %q, want %q", tt.dsn, cfg.Password, tt.password)
		}
		if cfg.Database != tt.database {
			t.Errorf("ParseDSN(%q).Database = %q, want %q", tt.dsn, cfg.Database, tt.database)
		}
	}
}

func TestParseDSN_KeyValue(t *testing.T) {
	cfg, err := ParseDSN("host=myhost port=1234 user=myuser password=mypass database=mydb")
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if cfg.Host != "myhost" {
		t.Errorf("host = %q, want %q", cfg.Host, "myhost")
	}
	if cfg.Port != 1234 {
		t.Errorf("port = %d, want 1234", cfg.Port)
	}
	if cfg.User != "myuser" {
		t.Errorf("user = %q, want %q", cfg.User, "myuser")
	}
	if cfg.Password != "mypass" {
		t.Errorf("password = %q, want %q", cfg.Password, "mypass")
	}
	if cfg.Database != "mydb" {
		t.Errorf("database = %q, want %q", cfg.Database, "mydb")
	}
}

func TestParseDSN_Defaults(t *testing.T) {
	cfg, err := ParseDSN("host=myhost")
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if cfg.Port != 6767 {
		t.Errorf("default port = %d, want 6767", cfg.Port)
	}
	if cfg.User != "sixseven" {
		t.Errorf("default user = %q, want %q", cfg.User, "sixseven")
	}
	if cfg.Database != "sixseven" {
		t.Errorf("default database = %q, want %q", cfg.Database, "sixseven")
	}
}

func TestParseDSN_InvalidScheme(t *testing.T) {
	_, err := ParseDSN("mysql://localhost/db")
	if err == nil {
		t.Error("expected error for unsupported scheme")
	}
}

func TestParseDSN_URIWithQueryParams(t *testing.T) {
	cfg, err := ParseDSN("sixseven://localhost:6767/mydb?sslmode=disable")
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if cfg.Database != "mydb" {
		t.Errorf("database = %q, want %q (query params should be stripped)", cfg.Database, "mydb")
	}
}

func TestParseDSN_Dbname(t *testing.T) {
	cfg, err := ParseDSN("dbname=testdb")
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if cfg.Database != "testdb" {
		t.Errorf("database = %q, want %q", cfg.Database, "testdb")
	}
}

func TestFormatArg(t *testing.T) {
	tests := []struct {
		input interface{}
		want  string
	}{
		{nil, nullValue},
		{"hello", "hello"},
		{"", ""},
		{int64(42), "42"},
		{float64(3.14), "3.14"},
		{true, "true"},
		{false, "false"},
		{Embedding{0.1, 0.2}, "[0.1,0.2]"},
		{[]float32{1.0, 2.0}, "[1,2]"},
		{Interval{Days: 5}, "5 days"},
	}
	for _, tt := range tests {
		got := formatArg(tt.input)
		if got != tt.want {
			t.Errorf("formatArg(%v) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestDriverResult_RowsAffected(t *testing.T) {
	tests := []struct {
		tag  string
		want int64
	}{
		{"INSERT 0 1", 1},
		{"UPDATE 5", 5},
		{"DELETE 10", 10},
		{"SELECT 0", 0},
		{"CREATE TABLE", 0},
	}
	for _, tt := range tests {
		r := &driverResult{tag: tt.tag}
		got, err := r.RowsAffected()
		if err != nil {
			t.Errorf("RowsAffected for %q error: %v", tt.tag, err)
			continue
		}
		if got != tt.want {
			t.Errorf("RowsAffected for %q = %d, want %d", tt.tag, got, tt.want)
		}
	}
}

func TestDriverResult_LastInsertId(t *testing.T) {
	r := &driverResult{tag: "INSERT 0 1"}
	_, err := r.LastInsertId()
	if err == nil {
		t.Error("LastInsertId should return error (not supported)")
	}
}

func TestDriverRows_Columns(t *testing.T) {
	rows := &driverRows{
		fields: []fieldDescription{
			{Name: "id", TypeOID: OIDInt4},
			{Name: "name", TypeOID: OIDText},
		},
	}
	cols := rows.Columns()
	if len(cols) != 2 {
		t.Fatalf("columns length = %d, want 2", len(cols))
	}
	if cols[0] != "id" || cols[1] != "name" {
		t.Errorf("columns = %v, want [id, name]", cols)
	}
}

func TestDriverConn_IsValid(t *testing.T) {
	dc := &driverConn{raw: &rawConn{closed: false}}
	if !dc.IsValid() {
		t.Error("connection should be valid")
	}

	dc.raw.closed = true
	if dc.IsValid() {
		t.Error("closed connection should not be valid")
	}
}

func TestDriverOpen(t *testing.T) {
	d := &Driver{}
	connector, err := d.OpenConnector("sixseven://localhost:6767/testdb")
	if err != nil {
		t.Fatalf("OpenConnector error: %v", err)
	}
	if connector.Driver() != d {
		t.Error("connector should reference the same driver")
	}
}
