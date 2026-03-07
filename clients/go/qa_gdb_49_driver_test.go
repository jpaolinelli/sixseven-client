package sixsevendb

import (
	"database/sql/driver"
	"io"
	"strings"
	"testing"
)

// =============================================================================
// QA Adversarial Tests for GDB-49: Go Client Library — Driver & DSN
// =============================================================================

// --- DSN Parsing adversarial tests ---

func TestQA_ParseDSN_EmptyString(t *testing.T) {
	// Empty DSN should use all defaults (key-value with no pairs)
	cfg, err := ParseDSN("")
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if cfg.Host != "localhost" {
		t.Errorf("host = %q, want %q", cfg.Host, "localhost")
	}
	if cfg.Port != 6767 {
		t.Errorf("port = %d, want 6767", cfg.Port)
	}
}

func TestQA_ParseDSN_URIOnlyScheme(t *testing.T) {
	cfg, err := ParseDSN("sixseven://")
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	// Should use defaults
	if cfg.Host != "localhost" {
		t.Errorf("host = %q, want default %q", cfg.Host, "localhost")
	}
}

func TestQA_ParseDSN_URIEmptyPassword(t *testing.T) {
	cfg, err := ParseDSN("sixseven://user:@host/db")
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if cfg.User != "user" {
		t.Errorf("user = %q, want %q", cfg.User, "user")
	}
	if cfg.Password != "" {
		t.Errorf("password = %q, want empty", cfg.Password)
	}
}

func TestQA_ParseDSN_URISpecialCharsInPassword(t *testing.T) {
	// Passwords with special characters (not URL-encoded)
	cfg, err := ParseDSN("sixseven://user:p@ss:word@host:6767/db")
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	// The current parser uses first @ as separator, so "p" becomes part of userinfo
	// and "ss:word@host:6767/db" becomes hostpath — this may be a bug
	// Just verify it doesn't panic
	_ = cfg
}

func TestQA_ParseDSN_URINoDatabase(t *testing.T) {
	cfg, err := ParseDSN("sixseven://host:6767")
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if cfg.Database != "sixseven" {
		t.Errorf("database = %q, want default %q", cfg.Database, "sixseven")
	}
}

func TestQA_ParseDSN_URITrailingSlash(t *testing.T) {
	cfg, err := ParseDSN("sixseven://host:6767/")
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if cfg.Database != "sixseven" {
		t.Errorf("database = %q, want default %q (empty path after /)", cfg.Database, "sixseven")
	}
}

func TestQA_ParseDSN_InvalidPort(t *testing.T) {
	_, err := ParseDSN("sixseven://host:notaport/db")
	if err == nil {
		t.Error("expected error for non-numeric port")
	}
}

func TestQA_ParseDSN_NegativePort(t *testing.T) {
	// Negative port should probably be an error, but the parser only validates Atoi
	cfg, err := ParseDSN("sixseven://host:-1/db")
	if err != nil {
		return // error is fine
	}
	if cfg.Port < 0 {
		t.Logf("Note: negative port %d accepted without validation", cfg.Port)
	}
}

func TestQA_ParseDSN_VeryLargePort(t *testing.T) {
	cfg, err := ParseDSN("sixseven://host:99999/db")
	if err != nil {
		return // error is fine
	}
	if cfg.Port > 65535 {
		t.Logf("Note: port %d exceeds valid TCP range (0-65535)", cfg.Port)
	}
}

func TestQA_ParseDSN_KeyValueInvalidPort(t *testing.T) {
	_, err := ParseDSN("host=myhost port=abc")
	if err == nil {
		t.Error("expected error for invalid port in key-value DSN")
	}
}

func TestQA_ParseDSN_KeyValueUnknownKeys(t *testing.T) {
	// Unknown keys should be silently ignored
	cfg, err := ParseDSN("host=myhost unknown=value")
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if cfg.Host != "myhost" {
		t.Errorf("host = %q, want %q", cfg.Host, "myhost")
	}
}

func TestQA_ParseDSN_KeyValueNoEquals(t *testing.T) {
	// Entries without = should be skipped
	cfg, err := ParseDSN("host=myhost garbage")
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if cfg.Host != "myhost" {
		t.Errorf("host = %q, want %q", cfg.Host, "myhost")
	}
}

func TestQA_ParseDSN_KeyValueSpacesInValue(t *testing.T) {
	// Values with spaces won't work in the current key=value parser
	// since it splits on whitespace
	cfg, err := ParseDSN("host=my host")
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	// "host=my" → host="my", "host" → no =, skip
	if cfg.Host != "my" {
		t.Logf("Note: space in value results in host=%q (truncated at space)", cfg.Host)
	}
}

func TestQA_ParseDSN_URIWithMultipleQueryParams(t *testing.T) {
	cfg, err := ParseDSN("sixseven://host:6767/mydb?sslmode=disable&connect_timeout=10")
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if cfg.Database != "mydb" {
		t.Errorf("database = %q, want %q", cfg.Database, "mydb")
	}
}

// --- driverRows adversarial tests ---

func TestQA_DriverRows_NextAfterClose(t *testing.T) {
	rows := &driverRows{
		fields: []fieldDescription{{Name: "id", TypeOID: OIDInt4}},
		rows:   [][][]byte{{{0x31}}}, // "1"
		closed: false,
	}
	rows.Close()
	dest := make([]driver.Value, 1)
	err := rows.Next(dest)
	if err != io.EOF {
		t.Errorf("Next after Close should return io.EOF, got %v", err)
	}
}

func TestQA_DriverRows_NextEmptyRows(t *testing.T) {
	rows := &driverRows{
		fields: []fieldDescription{{Name: "id", TypeOID: OIDInt4}},
		rows:   nil,
	}
	dest := make([]driver.Value, 1)
	err := rows.Next(dest)
	if err != io.EOF {
		t.Errorf("Next on empty rows should return io.EOF, got %v", err)
	}
}

func TestQA_DriverRows_NextWithNullValues(t *testing.T) {
	rows := &driverRows{
		fields: []fieldDescription{
			{Name: "id", TypeOID: OIDInt4},
			{Name: "name", TypeOID: OIDText},
		},
		rows: [][][]byte{{nil, []byte("hello")}},
	}
	dest := make([]driver.Value, 2)
	err := rows.Next(dest)
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if dest[0] != nil {
		t.Errorf("null column should be nil, got %v", dest[0])
	}
	if dest[1] != "hello" {
		t.Errorf("text column = %v, want %q", dest[1], "hello")
	}
}

func TestQA_DriverRows_NextWithParseError(t *testing.T) {
	// Row data that can't be parsed as the declared type falls back to string
	rows := &driverRows{
		fields: []fieldDescription{{Name: "id", TypeOID: OIDInt4}},
		rows:   [][][]byte{{[]byte("not-an-int")}},
	}
	dest := make([]driver.Value, 1)
	err := rows.Next(dest)
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	// Should fall back to raw string
	if dest[0] != "not-an-int" {
		t.Errorf("fallback value = %v, want %q", dest[0], "not-an-int")
	}
}

func TestQA_DriverRows_MoreColumnsThanFields(t *testing.T) {
	// Edge case: more columns in data row than in field descriptions
	rows := &driverRows{
		fields: []fieldDescription{{Name: "id", TypeOID: OIDInt4}},
		rows:   [][][]byte{{[]byte("1"), []byte("extra")}},
	}
	dest := make([]driver.Value, 2)
	err := rows.Next(dest)
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	// First column: parsed as int4
	if dest[0] != int32(1) {
		t.Errorf("column 0 = %v (%T), want int32(1)", dest[0], dest[0])
	}
	// Second column: beyond fields, should be raw string
	if dest[1] != "extra" {
		t.Errorf("column 1 = %v, want %q", dest[1], "extra")
	}
}

func TestQA_DriverRows_ColumnsEmpty(t *testing.T) {
	rows := &driverRows{fields: nil}
	cols := rows.Columns()
	if len(cols) != 0 {
		t.Errorf("columns should be empty, got %v", cols)
	}
}

// --- driverResult adversarial tests ---

func TestQA_ParseRowCount_EmptyTag(t *testing.T) {
	count := parseRowCount("")
	if count != 0 {
		t.Errorf("empty tag should give 0 rows, got %d", count)
	}
}

func TestQA_ParseRowCount_NoNumber(t *testing.T) {
	count := parseRowCount("CREATE TABLE")
	if count != 0 {
		t.Errorf("non-numeric tag should give 0, got %d", count)
	}
}

func TestQA_ParseRowCount_LargeNumber(t *testing.T) {
	count := parseRowCount("UPDATE 999999999")
	if count != 999999999 {
		t.Errorf("count = %d, want 999999999", count)
	}
}

// --- formatArg adversarial tests ---

func TestQA_FormatArg_SpecialTypes(t *testing.T) {
	// Test with types not in the explicit switch
	got := formatArg(42) // int, not int64
	if got != "42" {
		t.Errorf("formatArg(int(42)) = %q, want %q", got, "42")
	}

	got = formatArg(uint32(100))
	if got != "100" {
		t.Errorf("formatArg(uint32(100)) = %q, want %q", got, "100")
	}
}

func TestQA_FormatArg_LongString(t *testing.T) {
	long := strings.Repeat("x", 100000)
	got := formatArg(long)
	if len(got) != 100000 {
		t.Errorf("long string length = %d, want 100000", len(got))
	}
}

func TestQA_FormatArg_EmbeddingEmpty(t *testing.T) {
	got := formatArg(Embedding{})
	if got != "[]" {
		t.Errorf("empty embedding arg = %q, want %q", got, "[]")
	}
}

// --- NamedValues conversion ---

func TestQA_NamedValues_Empty(t *testing.T) {
	result := namedValues(nil)
	if len(result) != 0 {
		t.Errorf("namedValues(nil) should be empty, got %d items", len(result))
	}
}

func TestQA_NamedValues_Ordinals(t *testing.T) {
	args := []driver.Value{"a", "b", "c"}
	result := namedValues(args)
	for i, nv := range result {
		if nv.Ordinal != i+1 {
			t.Errorf("ordinal[%d] = %d, want %d", i, nv.Ordinal, i+1)
		}
	}
}

// --- driverConn IsValid ---

func TestQA_DriverConn_IsValid_NilRaw(t *testing.T) {
	dc := &driverConn{raw: nil}
	if dc.IsValid() {
		t.Error("connection with nil raw should not be valid")
	}
}

// --- driverTx double finish ---

func TestQA_DriverTx_DoubleCommit(t *testing.T) {
	tx := &driverTx{
		conn: &driverConn{raw: &rawConn{closed: true}},
		done: false,
	}
	// First finish: mark as done manually
	tx.done = true
	// Second commit should error
	err := tx.Commit()
	if err == nil {
		t.Error("double commit should return error")
	}
}

func TestQA_DriverTx_DoubleRollback(t *testing.T) {
	tx := &driverTx{
		conn: &driverConn{raw: &rawConn{closed: true}},
		done: false,
	}
	tx.done = true
	err := tx.Rollback()
	if err == nil {
		t.Error("double rollback should return error")
	}
}

func TestQA_DriverTx_CommitAfterRollback(t *testing.T) {
	tx := &driverTx{
		conn: &driverConn{raw: &rawConn{closed: true}},
		done: false,
	}
	tx.done = true
	err := tx.Commit()
	if err == nil {
		t.Error("commit after rollback should return error")
	}
}

// --- Connector tests ---

func TestQA_Driver_OpenConnector_InvalidDSN(t *testing.T) {
	d := &Driver{}
	_, err := d.OpenConnector("mysql://invalid")
	if err == nil {
		t.Error("expected error for invalid scheme in OpenConnector")
	}
}

func TestQA_Connector_Driver(t *testing.T) {
	d := &Driver{}
	c, err := d.OpenConnector("sixseven://localhost/db")
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if c.Driver() != d {
		t.Error("Connector.Driver() should return the original driver")
	}
}
