package sixsevendb

import (
	"encoding/binary"
	"testing"
)

func TestBuildStartupMessage(t *testing.T) {
	msg := buildStartupMessage("testuser", "testdb")

	// First 4 bytes: length
	length := binary.BigEndian.Uint32(msg[0:4])
	if int(length) != len(msg) {
		t.Errorf("startup message length mismatch: header says %d, actual %d", length, len(msg))
	}

	// Next 4 bytes: protocol version
	version := binary.BigEndian.Uint32(msg[4:8])
	if version != protocolVersion {
		t.Errorf("protocol version = %d, want %d", version, protocolVersion)
	}

	// Params should contain user and database
	params := string(msg[8:])
	if !contains(params, "user\x00testuser\x00") {
		t.Error("startup message missing user parameter")
	}
	if !contains(params, "database\x00testdb\x00") {
		t.Error("startup message missing database parameter")
	}
}

func TestBuildQueryMessage(t *testing.T) {
	msg := buildQueryMessage("SELECT 1")

	if msg[0] != 'Q' {
		t.Errorf("query message type = %c, want Q", msg[0])
	}

	length := binary.BigEndian.Uint32(msg[1:5])
	expectedLen := uint32(4 + len("SELECT 1") + 1) // length field + sql + null terminator
	if length != expectedLen {
		t.Errorf("query message length = %d, want %d", length, expectedLen)
	}

	// SQL text + null terminator
	sqlText := string(msg[5 : len(msg)-1])
	if sqlText != "SELECT 1" {
		t.Errorf("query text = %q, want %q", sqlText, "SELECT 1")
	}
	if msg[len(msg)-1] != 0 {
		t.Error("query message missing null terminator")
	}
}

func TestBuildPasswordMessage(t *testing.T) {
	msg := buildPasswordMessage("secret")

	if msg[0] != 'p' {
		t.Errorf("password message type = %c, want p", msg[0])
	}
}

func TestBuildParseMessage(t *testing.T) {
	msg := buildParseMessage("SELECT $1", "")

	if msg[0] != 'P' {
		t.Errorf("parse message type = %c, want P", msg[0])
	}
}

func TestBuildBindMessage(t *testing.T) {
	msg := buildBindMessage([]string{"hello", "42"}, "", "")

	if msg[0] != 'B' {
		t.Errorf("bind message type = %c, want B", msg[0])
	}
}

func TestBuildDescribeMessage(t *testing.T) {
	msg := buildDescribeMessage('P', "")

	if msg[0] != 'D' {
		t.Errorf("describe message type = %c, want D", msg[0])
	}
}

func TestBuildExecuteMessage(t *testing.T) {
	msg := buildExecuteMessage("", 0)

	if msg[0] != 'E' {
		t.Errorf("execute message type = %c, want E", msg[0])
	}
}

func TestBuildSyncMessage(t *testing.T) {
	msg := buildSyncMessage()

	if msg[0] != 'S' {
		t.Errorf("sync message type = %c, want S", msg[0])
	}
	if len(msg) != 5 {
		t.Errorf("sync message length = %d, want 5", len(msg))
	}
}

func TestBuildTerminateMessage(t *testing.T) {
	msg := buildTerminateMessage()

	if msg[0] != 'X' {
		t.Errorf("terminate message type = %c, want X", msg[0])
	}
	if len(msg) != 5 {
		t.Errorf("terminate message length = %d, want 5", len(msg))
	}
}

func TestBuildSASLInitialResponse(t *testing.T) {
	msg := buildSASLInitialResponse("SCRAM-SHA-256", []byte("n,,n=user,r=nonce"))

	if msg[0] != 'p' {
		t.Errorf("SASL initial response type = %c, want p", msg[0])
	}
}

func TestBuildSASLResponse(t *testing.T) {
	msg := buildSASLResponse([]byte("c=biws,r=nonce,p=proof"))

	if msg[0] != 'p' {
		t.Errorf("SASL response type = %c, want p", msg[0])
	}
}

func TestParseRowDescription(t *testing.T) {
	// Build a synthetic RowDescription payload
	var payload []byte
	// Field count = 2
	payload = binary.BigEndian.AppendUint16(payload, 2)

	// Field 1: "id"
	payload = append(payload, []byte("id")...)
	payload = append(payload, 0) // null terminator
	payload = binary.BigEndian.AppendUint32(payload, 0)     // table OID
	payload = binary.BigEndian.AppendUint16(payload, 1)     // column index
	payload = binary.BigEndian.AppendUint32(payload, OIDInt4) // type OID
	payload = append(payload, 0, 4)                          // type size (int16 = 4)
	payload = binary.BigEndian.AppendUint32(payload, 0xFFFFFFFF) // type modifier -1
	payload = binary.BigEndian.AppendUint16(payload, 0)     // format code

	// Field 2: "name"
	payload = append(payload, []byte("name")...)
	payload = append(payload, 0)
	payload = binary.BigEndian.AppendUint32(payload, 0)
	payload = binary.BigEndian.AppendUint16(payload, 2)
	payload = binary.BigEndian.AppendUint32(payload, OIDText)
	payload = append(payload, 0xFF, 0xFF) // type size -1
	payload = binary.BigEndian.AppendUint32(payload, 0xFFFFFFFF)
	payload = binary.BigEndian.AppendUint16(payload, 0)

	fields, err := parseRowDescription(payload)
	if err != nil {
		t.Fatalf("parseRowDescription error: %v", err)
	}
	if len(fields) != 2 {
		t.Fatalf("expected 2 fields, got %d", len(fields))
	}
	if fields[0].Name != "id" {
		t.Errorf("field 0 name = %q, want %q", fields[0].Name, "id")
	}
	if fields[0].TypeOID != OIDInt4 {
		t.Errorf("field 0 type OID = %d, want %d", fields[0].TypeOID, OIDInt4)
	}
	if fields[1].Name != "name" {
		t.Errorf("field 1 name = %q, want %q", fields[1].Name, "name")
	}
	if fields[1].TypeOID != OIDText {
		t.Errorf("field 1 type OID = %d, want %d", fields[1].TypeOID, OIDText)
	}
}

func TestParseDataRow(t *testing.T) {
	var payload []byte
	// 2 columns
	payload = binary.BigEndian.AppendUint16(payload, 2)
	// Column 1: "42"
	payload = binary.BigEndian.AppendUint32(payload, 2)
	payload = append(payload, []byte("42")...)
	// Column 2: NULL
	payload = binary.BigEndian.AppendUint32(payload, 0xFFFFFFFF)

	values, err := parseDataRow(payload)
	if err != nil {
		t.Fatalf("parseDataRow error: %v", err)
	}
	if len(values) != 2 {
		t.Fatalf("expected 2 values, got %d", len(values))
	}
	if string(values[0]) != "42" {
		t.Errorf("column 0 = %q, want %q", string(values[0]), "42")
	}
	if values[1] != nil {
		t.Errorf("column 1 = %v, want nil", values[1])
	}
}

func TestParseErrorFields(t *testing.T) {
	payload := []byte("SERROR\x00C42000\x00Msyntax error\x00\x00")
	fields := parseErrorFields(payload)

	if fields['S'] != "ERROR" {
		t.Errorf("severity = %q, want %q", fields['S'], "ERROR")
	}
	if fields['C'] != "42000" {
		t.Errorf("code = %q, want %q", fields['C'], "42000")
	}
	if fields['M'] != "syntax error" {
		t.Errorf("message = %q, want %q", fields['M'], "syntax error")
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && (s == substr || len(s) > 0 && containsHelper(s, substr))
}

func containsHelper(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
