package sixsevendb

import (
	"encoding/base64"
	"encoding/binary"
	"testing"
)

// =============================================================================
// QA Adversarial Tests for GDB-49: Go Client Library — Protocol & Auth
// =============================================================================

// --- Protocol message parsing adversarial tests ---

func TestQA_ParseRowDescription_Empty(t *testing.T) {
	_, err := parseRowDescription([]byte{})
	if err == nil {
		t.Error("expected error for empty payload")
	}
}

func TestQA_ParseRowDescription_OneByte(t *testing.T) {
	_, err := parseRowDescription([]byte{0x00})
	if err == nil {
		t.Error("expected error for 1-byte payload")
	}
}

func TestQA_ParseRowDescription_ZeroFields(t *testing.T) {
	payload := make([]byte, 2)
	binary.BigEndian.PutUint16(payload, 0)
	fields, err := parseRowDescription(payload)
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if len(fields) != 0 {
		t.Errorf("expected 0 fields, got %d", len(fields))
	}
}

func TestQA_ParseRowDescription_TruncatedField(t *testing.T) {
	var payload []byte
	payload = binary.BigEndian.AppendUint16(payload, 1)
	payload = append(payload, []byte("id")...)
	payload = append(payload, 0) // null terminator
	// Only partial field data (need 18 bytes after name)
	payload = append(payload, 0, 0, 0, 0) // only 4 bytes instead of 18
	_, err := parseRowDescription(payload)
	if err == nil {
		t.Error("expected error for truncated field data")
	}
}

func TestQA_ParseRowDescription_MissingNullTerminator(t *testing.T) {
	var payload []byte
	payload = binary.BigEndian.AppendUint16(payload, 1)
	payload = append(payload, []byte("id")...) // no null terminator, reaches end
	_, err := parseRowDescription(payload)
	if err == nil {
		t.Error("expected error for missing null terminator in field name")
	}
}

func TestQA_ParseDataRow_Empty(t *testing.T) {
	_, err := parseDataRow([]byte{})
	if err == nil {
		t.Error("expected error for empty data row")
	}
}

func TestQA_ParseDataRow_ZeroColumns(t *testing.T) {
	payload := make([]byte, 2)
	binary.BigEndian.PutUint16(payload, 0)
	values, err := parseDataRow(payload)
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if len(values) != 0 {
		t.Errorf("expected 0 values, got %d", len(values))
	}
}

func TestQA_ParseDataRow_TruncatedLength(t *testing.T) {
	var payload []byte
	payload = binary.BigEndian.AppendUint16(payload, 1)
	// Need 4 bytes for column length, only provide 2
	payload = append(payload, 0, 0)
	_, err := parseDataRow(payload)
	if err == nil {
		t.Error("expected error for truncated column length")
	}
}

func TestQA_ParseDataRow_TruncatedData(t *testing.T) {
	var payload []byte
	payload = binary.BigEndian.AppendUint16(payload, 1)
	payload = binary.BigEndian.AppendUint32(payload, 100) // claims 100 bytes
	payload = append(payload, []byte("short")...)         // only 5 bytes
	_, err := parseDataRow(payload)
	if err == nil {
		t.Error("expected error for truncated column data")
	}
}

func TestQA_ParseDataRow_AllNulls(t *testing.T) {
	var payload []byte
	payload = binary.BigEndian.AppendUint16(payload, 3)
	for i := 0; i < 3; i++ {
		payload = binary.BigEndian.AppendUint32(payload, 0xFFFFFFFF) // NULL
	}
	values, err := parseDataRow(payload)
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	for i, v := range values {
		if v != nil {
			t.Errorf("column %d should be nil, got %v", i, v)
		}
	}
}

func TestQA_ParseDataRow_EmptyStringColumn(t *testing.T) {
	var payload []byte
	payload = binary.BigEndian.AppendUint16(payload, 1)
	payload = binary.BigEndian.AppendUint32(payload, 0) // length 0 (empty string, not NULL)
	values, err := parseDataRow(payload)
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if len(values) != 1 {
		t.Fatalf("expected 1 value, got %d", len(values))
	}
	if values[0] == nil {
		t.Error("empty string column should not be nil (nil = NULL)")
	}
	if len(values[0]) != 0 {
		t.Errorf("empty string column should have length 0, got %d", len(values[0]))
	}
}

func TestQA_ParseErrorFields_Empty(t *testing.T) {
	fields := parseErrorFields([]byte{})
	if len(fields) != 0 {
		t.Errorf("expected 0 fields, got %d", len(fields))
	}
}

func TestQA_ParseErrorFields_OnlyTerminator(t *testing.T) {
	fields := parseErrorFields([]byte{0})
	if len(fields) != 0 {
		t.Errorf("expected 0 fields, got %d", len(fields))
	}
}

func TestQA_ParseCString_EmptyPayload(t *testing.T) {
	s, nextPos := parseCString([]byte{}, 0)
	if s != "" {
		t.Errorf("expected empty string, got %q", s)
	}
	if nextPos != 1 {
		t.Errorf("nextPos = %d, want 1", nextPos)
	}
}

func TestQA_ParseCString_NoNullTerminator(t *testing.T) {
	s, _ := parseCString([]byte("hello"), 0)
	if s != "hello" {
		t.Errorf("expected %q, got %q", "hello", s)
	}
}

func TestQA_ParseCStringSimple_Empty(t *testing.T) {
	got := parseCStringSimple([]byte{})
	if got != "" {
		t.Errorf("expected empty, got %q", got)
	}
}

func TestQA_ParseCStringSimple_NullTerminated(t *testing.T) {
	got := parseCStringSimple([]byte("INSERT 0 1\x00"))
	if got != "INSERT 0 1" {
		t.Errorf("got %q, want %q", got, "INSERT 0 1")
	}
}

func TestQA_ParseCommandTag_Empty(t *testing.T) {
	got := parseCommandTag("")
	if got != "" {
		t.Errorf("expected empty, got %q", got)
	}
}

func TestQA_ParseCommandTag_NoSpace(t *testing.T) {
	got := parseCommandTag("BEGIN")
	if got != "BEGIN" {
		t.Errorf("got %q, want %q", got, "BEGIN")
	}
}

// --- Protocol message building adversarial tests ---

func TestQA_BuildStartupMessage_EmptyUser(t *testing.T) {
	msg := buildStartupMessage("", "testdb")
	if len(msg) == 0 {
		t.Error("startup message should not be empty for empty user")
	}
	version := binary.BigEndian.Uint32(msg[4:8])
	if version != protocolVersion {
		t.Errorf("protocol version = %d, want %d", version, protocolVersion)
	}
}

func TestQA_BuildStartupMessage_EmptyDatabase(t *testing.T) {
	msg := buildStartupMessage("user", "")
	if len(msg) == 0 {
		t.Error("startup message should not be empty for empty database")
	}
}

func TestQA_BuildQueryMessage_EmptySQL(t *testing.T) {
	msg := buildQueryMessage("")
	if msg[0] != 'Q' {
		t.Errorf("message type = %c, want Q", msg[0])
	}
	// Should contain null terminator only
	if msg[len(msg)-1] != 0 {
		t.Error("missing null terminator")
	}
}

func TestQA_BuildBindMessage_NullValue(t *testing.T) {
	msg := buildBindMessage([]string{nullValue}, "", "")
	if msg[0] != 'B' {
		t.Errorf("message type = %c, want B", msg[0])
	}
	// NULL parameter should have length -1 (0xFFFFFFFF)
	// Verify the message doesn't panic
	if len(msg) == 0 {
		t.Error("message should not be empty")
	}
}

func TestQA_BuildBindMessage_Empty(t *testing.T) {
	msg := buildBindMessage([]string{}, "", "")
	if msg[0] != 'B' {
		t.Errorf("message type = %c, want B", msg[0])
	}
}

func TestQA_BuildBindMessage_LargeValue(t *testing.T) {
	// Large parameter value
	large := make([]byte, 100000)
	for i := range large {
		large[i] = 'x'
	}
	msg := buildBindMessage([]string{string(large)}, "", "")
	if msg[0] != 'B' {
		t.Errorf("message type = %c, want B", msg[0])
	}
	if len(msg) < 100000 {
		t.Errorf("message too small for large parameter: %d", len(msg))
	}
}

// --- Auth adversarial tests ---

func TestQA_BuildMD5Password_EmptyUser(t *testing.T) {
	result := buildMD5Password("", "pass", []byte{1, 2, 3, 4})
	if len(result) != 35 {
		t.Errorf("MD5 password length = %d, want 35", len(result))
	}
}

func TestQA_BuildMD5Password_EmptyPassword(t *testing.T) {
	result := buildMD5Password("user", "", []byte{1, 2, 3, 4})
	if len(result) != 35 {
		t.Errorf("MD5 password length = %d, want 35", len(result))
	}
}

func TestQA_ScramClientFirst_EmptyUsername(t *testing.T) {
	state, msg := scramClientFirst("", "pass")
	if state == nil {
		t.Fatal("state should not be nil")
	}
	if len(msg) == 0 {
		t.Error("client-first message should not be empty")
	}
}

func TestQA_ScramClientFinal_MissingNonce(t *testing.T) {
	state := &scramState{
		username:              "user",
		password:              "pass",
		clientNonce:           "nonce",
		clientFirstMessageBare: "n=user,r=nonce",
	}
	// Server message missing 'r=' nonce
	serverFirst := []byte("s=" + base64.StdEncoding.EncodeToString([]byte("salt")) + ",i=4096")
	_, err := scramClientFinal(state, serverFirst)
	if err == nil {
		t.Error("expected error for missing server nonce")
	}
}

func TestQA_ScramClientFinal_MissingSalt(t *testing.T) {
	state := &scramState{
		username:              "user",
		password:              "pass",
		clientNonce:           "nonce",
		clientFirstMessageBare: "n=user,r=nonce",
	}
	serverFirst := []byte("r=nonce_server,i=4096")
	_, err := scramClientFinal(state, serverFirst)
	if err == nil {
		t.Error("expected error for missing salt")
	}
}

func TestQA_ScramClientFinal_MissingIterations(t *testing.T) {
	state := &scramState{
		username:              "user",
		password:              "pass",
		clientNonce:           "nonce",
		clientFirstMessageBare: "n=user,r=nonce",
	}
	serverFirst := []byte("r=nonce_server,s=" + base64.StdEncoding.EncodeToString([]byte("salt")))
	_, err := scramClientFinal(state, serverFirst)
	if err == nil {
		t.Error("expected error for missing iterations")
	}
}

func TestQA_ScramClientFinal_InvalidSalt(t *testing.T) {
	state := &scramState{
		username:              "user",
		password:              "pass",
		clientNonce:           "nonce",
		clientFirstMessageBare: "n=user,r=nonce",
	}
	serverFirst := []byte("r=nonce_server,s=!!!invalid-base64!!!,i=4096")
	_, err := scramClientFinal(state, serverFirst)
	if err == nil {
		t.Error("expected error for invalid base64 salt")
	}
}

func TestQA_ScramClientFinal_InvalidIterations(t *testing.T) {
	state := &scramState{
		username:              "user",
		password:              "pass",
		clientNonce:           "nonce",
		clientFirstMessageBare: "n=user,r=nonce",
	}
	serverFirst := []byte("r=nonce_server,s=" + base64.StdEncoding.EncodeToString([]byte("salt")) + ",i=notanumber")
	_, err := scramClientFinal(state, serverFirst)
	if err == nil {
		t.Error("expected error for non-numeric iterations")
	}
}

func TestQA_ScramVerifyServer_EmptyState(t *testing.T) {
	state := &scramState{}
	if scramVerifyServer(state, []byte("v=some_sig")) {
		t.Error("empty state should not verify")
	}
}

func TestQA_ScramVerifyServer_NilServerKey(t *testing.T) {
	state := &scramState{
		serverKey:   nil,
		authMessage: "msg",
	}
	if scramVerifyServer(state, []byte("v=some_sig")) {
		t.Error("nil serverKey should not verify")
	}
}

func TestQA_ScramVerifyServer_EmptyAuthMessage(t *testing.T) {
	state := &scramState{
		serverKey:   []byte("key"),
		authMessage: "",
	}
	if scramVerifyServer(state, []byte("v=some_sig")) {
		t.Error("empty authMessage should not verify")
	}
}

func TestQA_ScramVerifyServer_EmptyPayload(t *testing.T) {
	state := &scramState{
		serverKey:   []byte("key"),
		authMessage: "msg",
	}
	if scramVerifyServer(state, []byte("")) {
		t.Error("empty payload should not verify")
	}
}

func TestQA_ScramVerifyServer_NoPrefix(t *testing.T) {
	state := &scramState{
		serverKey:   []byte("key"),
		authMessage: "msg",
	}
	if scramVerifyServer(state, []byte("invalid_format")) {
		t.Error("payload without v= prefix should not verify")
	}
}

// --- XorBytes edge case ---

func TestQA_XorBytes_SameInput(t *testing.T) {
	data := []byte{0xFF, 0xAA, 0x55}
	result := xorBytes(data, data)
	for i, b := range result {
		if b != 0 {
			t.Errorf("xor of same data should be 0 at index %d, got %d", i, b)
		}
	}
}

func TestQA_XorBytes_Empty(t *testing.T) {
	result := xorBytes([]byte{}, []byte{})
	if len(result) != 0 {
		t.Errorf("xor of empty slices should be empty, got %v", result)
	}
}
