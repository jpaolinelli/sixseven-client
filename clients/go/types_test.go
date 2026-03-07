package sixsevendb

import (
	"database/sql/driver"
	"math"
	"testing"
	"time"
)

func TestParseBool(t *testing.T) {
	tests := []struct {
		input string
		want  bool
	}{
		{"t", true},
		{"true", true},
		{"1", true},
		{"f", false},
		{"false", false},
		{"0", false},
	}
	for _, tt := range tests {
		got := parseBool(tt.input)
		if got != tt.want {
			t.Errorf("parseBool(%q) = %v, want %v", tt.input, got, tt.want)
		}
	}
}

func TestParseValue_Integers(t *testing.T) {
	tests := []struct {
		oid   uint32
		input string
		want  interface{}
	}{
		{OIDTinyint, "127", int8(127)},
		{OIDTinyint, "-128", int8(-128)},
		{OIDInt2, "32767", int16(32767)},
		{OIDInt4, "2147483647", int32(2147483647)},
		{OIDInt8, "9223372036854775807", int64(9223372036854775807)},
		{OIDUINT8, "255", uint8(255)},
		{OIDUINT16, "65535", uint16(65535)},
		{OIDUINT32, "4294967295", uint32(4294967295)},
		{OIDUINT64, "18446744073709551615", uint64(18446744073709551615)},
	}
	for _, tt := range tests {
		got, err := ParseValue(tt.oid, tt.input)
		if err != nil {
			t.Errorf("ParseValue(%d, %q) error: %v", tt.oid, tt.input, err)
			continue
		}
		if got != tt.want {
			t.Errorf("ParseValue(%d, %q) = %v (%T), want %v (%T)", tt.oid, tt.input, got, got, tt.want, tt.want)
		}
	}
}

func TestParseValue_Floats(t *testing.T) {
	got32, err := ParseValue(OIDFloat4, "3.14")
	if err != nil {
		t.Fatalf("ParseValue(Float4, \"3.14\") error: %v", err)
	}
	if f, ok := got32.(float32); !ok || math.Abs(float64(f)-3.14) > 0.01 {
		t.Errorf("ParseValue(Float4, \"3.14\") = %v, want ~3.14", got32)
	}

	got64, err := ParseValue(OIDFloat8, "3.141592653589793")
	if err != nil {
		t.Fatalf("ParseValue(Float8, ...) error: %v", err)
	}
	if f, ok := got64.(float64); !ok || math.Abs(f-3.141592653589793) > 1e-10 {
		t.Errorf("ParseValue(Float8, ...) = %v, want 3.141592653589793", got64)
	}
}

func TestParseValue_Strings(t *testing.T) {
	for _, oid := range []uint32{OIDText, OIDVarchar, OIDChar} {
		got, err := ParseValue(oid, "hello world")
		if err != nil {
			t.Errorf("ParseValue(%d, \"hello world\") error: %v", oid, err)
			continue
		}
		if got != "hello world" {
			t.Errorf("ParseValue(%d, \"hello world\") = %v, want \"hello world\"", oid, got)
		}
	}
}

func TestParseValue_Bool(t *testing.T) {
	got, err := ParseValue(OIDBool, "t")
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if got != true {
		t.Errorf("ParseValue(Bool, \"t\") = %v, want true", got)
	}

	got, err = ParseValue(OIDBool, "f")
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if got != false {
		t.Errorf("ParseValue(Bool, \"f\") = %v, want false", got)
	}
}

func TestParseValue_Numeric(t *testing.T) {
	got, err := ParseValue(OIDNumeric, "123456.789")
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if got != "123456.789" {
		t.Errorf("ParseValue(Numeric, \"123456.789\") = %v, want \"123456.789\"", got)
	}
}

func TestParseValue_Date(t *testing.T) {
	got, err := ParseValue(OIDDate, "2024-03-15")
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	tm, ok := got.(time.Time)
	if !ok {
		t.Fatalf("expected time.Time, got %T", got)
	}
	if tm.Year() != 2024 || tm.Month() != 3 || tm.Day() != 15 {
		t.Errorf("date = %v, want 2024-03-15", tm)
	}
}

func TestParseValue_Timestamp(t *testing.T) {
	got, err := ParseValue(OIDTimestamp, "2024-03-15 10:30:45")
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	tm, ok := got.(time.Time)
	if !ok {
		t.Fatalf("expected time.Time, got %T", got)
	}
	if tm.Hour() != 10 || tm.Minute() != 30 || tm.Second() != 45 {
		t.Errorf("timestamp = %v, want 10:30:45", tm)
	}
}

func TestParseValue_Interval(t *testing.T) {
	tests := []struct {
		input string
		want  Interval
	}{
		{"01:30:00", Interval{Hours: 1, Minutes: 30}},
		{"2 days 03:00:00", Interval{Days: 2, Hours: 3}},
	}
	for _, tt := range tests {
		got, err := ParseValue(OIDInterval, tt.input)
		if err != nil {
			t.Errorf("ParseValue(Interval, %q) error: %v", tt.input, err)
			continue
		}
		iv, ok := got.(Interval)
		if !ok {
			t.Errorf("expected Interval, got %T", got)
			continue
		}
		if iv.Days != tt.want.Days || iv.Hours != tt.want.Hours || iv.Minutes != tt.want.Minutes {
			t.Errorf("ParseValue(Interval, %q) = %+v, want %+v", tt.input, iv, tt.want)
		}
	}
}

func TestParseValue_UUID(t *testing.T) {
	got, err := ParseValue(OIDUUID, "550e8400-e29b-41d4-a716-446655440000")
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	uuid, ok := got.([16]byte)
	if !ok {
		t.Fatalf("expected [16]byte, got %T", got)
	}
	formatted := FormatUUID(uuid)
	if formatted != "550e8400-e29b-41d4-a716-446655440000" {
		t.Errorf("UUID round-trip = %q, want %q", formatted, "550e8400-e29b-41d4-a716-446655440000")
	}
}

func TestParseValue_JSON(t *testing.T) {
	got, err := ParseValue(OIDJSON, `{"key": "value"}`)
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	m, ok := got.(map[string]interface{})
	if !ok {
		t.Fatalf("expected map[string]interface{}, got %T", got)
	}
	if m["key"] != "value" {
		t.Errorf("JSON key = %v, want \"value\"", m["key"])
	}
}

func TestParseValue_Bytea(t *testing.T) {
	got, err := ParseValue(OIDBytea, "\\x48656c6c6f")
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	b, ok := got.([]byte)
	if !ok {
		t.Fatalf("expected []byte, got %T", got)
	}
	if string(b) != "Hello" {
		t.Errorf("bytea = %q, want %q", string(b), "Hello")
	}
}

func TestParseEmbedding(t *testing.T) {
	tests := []struct {
		input string
		want  []float32
	}{
		{"[0.1,0.2,0.3]", []float32{0.1, 0.2, 0.3}},
		{"[1.0, 2.0, 3.0]", []float32{1.0, 2.0, 3.0}},
		{"[]", nil}, // empty embedding
	}
	for _, tt := range tests {
		got, err := ParseEmbedding(tt.input)
		if err != nil {
			t.Errorf("ParseEmbedding(%q) error: %v", tt.input, err)
			continue
		}
		if tt.want == nil {
			if len(got) != 0 {
				t.Errorf("ParseEmbedding(%q) = %v, want empty", tt.input, got)
			}
			continue
		}
		if len(got) != len(tt.want) {
			t.Errorf("ParseEmbedding(%q) len = %d, want %d", tt.input, len(got), len(tt.want))
			continue
		}
		for i := range tt.want {
			if math.Abs(float64(got[i]-tt.want[i])) > 0.001 {
				t.Errorf("ParseEmbedding(%q)[%d] = %f, want %f", tt.input, i, got[i], tt.want[i])
			}
		}
	}
}

func TestSerializeEmbedding(t *testing.T) {
	got := SerializeEmbedding(Embedding{0.1, 0.2, 0.3})
	if got != "[0.1,0.2,0.3]" {
		t.Errorf("SerializeEmbedding = %q, want %q", got, "[0.1,0.2,0.3]")
	}
}

func TestParseEmbeddingRoundTrip(t *testing.T) {
	original := Embedding{1.5, 2.5, 3.5, 4.5}
	serialized := SerializeEmbedding(original)
	parsed, err := ParseEmbedding(serialized)
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if len(parsed) != len(original) {
		t.Fatalf("round-trip length mismatch: %d vs %d", len(parsed), len(original))
	}
	for i := range original {
		if math.Abs(float64(parsed[i]-original[i])) > 0.001 {
			t.Errorf("round-trip[%d]: %f vs %f", i, parsed[i], original[i])
		}
	}
}

func TestParseValue_Embedding(t *testing.T) {
	got, err := ParseValue(OIDEmbedding, "[0.5,1.5,2.5]")
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	emb, ok := got.(Embedding)
	if !ok {
		t.Fatalf("expected Embedding, got %T", got)
	}
	if len(emb) != 3 {
		t.Fatalf("embedding length = %d, want 3", len(emb))
	}
}

func TestParseValue_Time(t *testing.T) {
	got, err := ParseValue(OIDTime, "14:30:00")
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	// TIME is returned as string
	if got != "14:30:00" {
		t.Errorf("time = %v, want \"14:30:00\"", got)
	}
}

func TestParseValue_UnknownOID(t *testing.T) {
	got, err := ParseValue(99999, "unknown_value")
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if got != "unknown_value" {
		t.Errorf("unknown OID value = %v, want \"unknown_value\"", got)
	}
}

func TestFormatUUID(t *testing.T) {
	uuid := [16]byte{0x55, 0x0e, 0x84, 0x00, 0xe2, 0x9b, 0x41, 0xd4, 0xa7, 0x16, 0x44, 0x66, 0x55, 0x44, 0x00, 0x00}
	got := FormatUUID(uuid)
	if got != "550e8400-e29b-41d4-a716-446655440000" {
		t.Errorf("FormatUUID = %q, want %q", got, "550e8400-e29b-41d4-a716-446655440000")
	}
}

func TestIntervalString(t *testing.T) {
	tests := []struct {
		iv   Interval
		want string
	}{
		{Interval{}, "0"},
		{Interval{Days: 5}, "5 days"},
		{Interval{Hours: 2, Minutes: 30}, "02:30:00.000"},
		{Interval{Years: 1, Months: 6}, "1 years 6 months"},
	}
	for _, tt := range tests {
		got := tt.iv.String()
		if got != tt.want {
			t.Errorf("Interval%+v.String() = %q, want %q", tt.iv, got, tt.want)
		}
	}
}

// --- Embedding sql.Scanner / driver.Valuer tests ---

func TestEmbeddingScanString(t *testing.T) {
	var e Embedding
	err := e.Scan("[1.0,2.0,3.0]")
	if err != nil {
		t.Fatalf("Scan error: %v", err)
	}
	if len(e) != 3 {
		t.Fatalf("len = %d, want 3", len(e))
	}
	if math.Abs(float64(e[0]-1.0)) > 0.001 {
		t.Errorf("e[0] = %f, want 1.0", e[0])
	}
}

func TestEmbeddingScanBytes(t *testing.T) {
	var e Embedding
	err := e.Scan([]byte("[4.0,5.0]"))
	if err != nil {
		t.Fatalf("Scan error: %v", err)
	}
	if len(e) != 2 {
		t.Fatalf("len = %d, want 2", len(e))
	}
}

func TestEmbeddingScanNil(t *testing.T) {
	e := Embedding{1.0}
	err := e.Scan(nil)
	if err != nil {
		t.Fatalf("Scan error: %v", err)
	}
	if e != nil {
		t.Errorf("expected nil, got %v", e)
	}
}

func TestEmbeddingScanEmbedding(t *testing.T) {
	var e Embedding
	src := Embedding{7.0, 8.0}
	err := e.Scan(src)
	if err != nil {
		t.Fatalf("Scan error: %v", err)
	}
	if len(e) != 2 || e[0] != 7.0 {
		t.Errorf("expected [7.0,8.0], got %v", e)
	}
}

func TestEmbeddingScanFloat32Slice(t *testing.T) {
	var e Embedding
	err := e.Scan([]float32{9.0, 10.0})
	if err != nil {
		t.Fatalf("Scan error: %v", err)
	}
	if len(e) != 2 || e[0] != 9.0 {
		t.Errorf("expected [9.0,10.0], got %v", e)
	}
}

func TestEmbeddingScanUnsupported(t *testing.T) {
	var e Embedding
	err := e.Scan(42)
	if err == nil {
		t.Error("expected error for unsupported type")
	}
}

func TestEmbeddingValue(t *testing.T) {
	e := Embedding{0.1, 0.2, 0.3}
	val, err := e.Value()
	if err != nil {
		t.Fatalf("Value error: %v", err)
	}
	s, ok := val.(string)
	if !ok {
		t.Fatalf("expected string, got %T", val)
	}
	if s != "[0.1,0.2,0.3]" {
		t.Errorf("Value = %q, want %q", s, "[0.1,0.2,0.3]")
	}
}

func TestEmbeddingValueNil(t *testing.T) {
	var e Embedding
	val, err := e.Value()
	if err != nil {
		t.Fatalf("Value error: %v", err)
	}
	if val != nil {
		t.Errorf("expected nil, got %v", val)
	}
}

// Verify Embedding implements the interfaces at compile time.
var _ driver.Valuer = Embedding{}

// --- Interval sql.Scanner / driver.Valuer tests ---

func TestIntervalScanString(t *testing.T) {
	var iv Interval
	err := iv.Scan("2 days 03:00:00")
	if err != nil {
		t.Fatalf("Scan error: %v", err)
	}
	if iv.Days != 2 || iv.Hours != 3 {
		t.Errorf("got %+v, want Days=2 Hours=3", iv)
	}
}

func TestIntervalScanBytes(t *testing.T) {
	var iv Interval
	err := iv.Scan([]byte("01:30:00"))
	if err != nil {
		t.Fatalf("Scan error: %v", err)
	}
	if iv.Hours != 1 || iv.Minutes != 30 {
		t.Errorf("got %+v, want Hours=1 Minutes=30", iv)
	}
}

func TestIntervalScanNil(t *testing.T) {
	iv := Interval{Days: 5}
	err := iv.Scan(nil)
	if err != nil {
		t.Fatalf("Scan error: %v", err)
	}
	if iv.Days != 0 {
		t.Errorf("expected zero Interval, got %+v", iv)
	}
}

func TestIntervalScanInterval(t *testing.T) {
	var iv Interval
	src := Interval{Years: 2, Months: 6}
	err := iv.Scan(src)
	if err != nil {
		t.Fatalf("Scan error: %v", err)
	}
	if iv.Years != 2 || iv.Months != 6 {
		t.Errorf("got %+v, want Years=2 Months=6", iv)
	}
}

func TestIntervalScanUnsupported(t *testing.T) {
	var iv Interval
	err := iv.Scan(42)
	if err == nil {
		t.Error("expected error for unsupported type")
	}
}

func TestIntervalValue(t *testing.T) {
	iv := Interval{Days: 3, Hours: 12}
	val, err := iv.Value()
	if err != nil {
		t.Fatalf("Value error: %v", err)
	}
	s, ok := val.(string)
	if !ok {
		t.Fatalf("expected string, got %T", val)
	}
	if s != "3 days 12:00:00.000" {
		t.Errorf("Value = %q, want %q", s, "3 days 12:00:00.000")
	}
}

// Verify Interval implements the interfaces at compile time.
var _ driver.Valuer = Interval{}
