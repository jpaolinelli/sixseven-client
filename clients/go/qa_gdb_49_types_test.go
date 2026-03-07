package sixsevendb

import (
	"math"
	"strings"
	"testing"
)

// =============================================================================
// QA Adversarial Tests for GDB-49: Go Client Library — Type System
// =============================================================================

// --- ParseValue boundary values ---

func TestQA_ParseValue_TinyintOverflow(t *testing.T) {
	// Tinyint is int8: range -128 to 127
	_, err := ParseValue(OIDTinyint, "128")
	if err == nil {
		t.Error("expected error for tinyint overflow (128)")
	}
	_, err = ParseValue(OIDTinyint, "-129")
	if err == nil {
		t.Error("expected error for tinyint underflow (-129)")
	}
}

func TestQA_ParseValue_Int2Overflow(t *testing.T) {
	_, err := ParseValue(OIDInt2, "32768")
	if err == nil {
		t.Error("expected error for int2 overflow (32768)")
	}
	_, err = ParseValue(OIDInt2, "-32769")
	if err == nil {
		t.Error("expected error for int2 underflow (-32769)")
	}
}

func TestQA_ParseValue_Int4Overflow(t *testing.T) {
	_, err := ParseValue(OIDInt4, "2147483648")
	if err == nil {
		t.Error("expected error for int4 overflow")
	}
}

func TestQA_ParseValue_Int8Overflow(t *testing.T) {
	_, err := ParseValue(OIDInt8, "9223372036854775808")
	if err == nil {
		t.Error("expected error for int8 overflow")
	}
}

func TestQA_ParseValue_Uint8Overflow(t *testing.T) {
	_, err := ParseValue(OIDUINT8, "256")
	if err == nil {
		t.Error("expected error for uint8 overflow (256)")
	}
}

func TestQA_ParseValue_Uint16Overflow(t *testing.T) {
	_, err := ParseValue(OIDUINT16, "65536")
	if err == nil {
		t.Error("expected error for uint16 overflow (65536)")
	}
}

func TestQA_ParseValue_Uint32Overflow(t *testing.T) {
	_, err := ParseValue(OIDUINT32, "4294967296")
	if err == nil {
		t.Error("expected error for uint32 overflow")
	}
}

func TestQA_ParseValue_Uint64Overflow(t *testing.T) {
	_, err := ParseValue(OIDUINT64, "18446744073709551616")
	if err == nil {
		t.Error("expected error for uint64 overflow")
	}
}

func TestQA_ParseValue_NegativeUnsigned(t *testing.T) {
	_, err := ParseValue(OIDUINT8, "-1")
	if err == nil {
		t.Error("expected error for negative uint8")
	}
	_, err = ParseValue(OIDUINT64, "-1")
	if err == nil {
		t.Error("expected error for negative uint64")
	}
}

func TestQA_ParseValue_EmptyString(t *testing.T) {
	// Empty string for integer types should fail
	_, err := ParseValue(OIDInt4, "")
	if err == nil {
		t.Error("expected error parsing empty string as int4")
	}
	_, err = ParseValue(OIDFloat8, "")
	if err == nil {
		t.Error("expected error parsing empty string as float8")
	}
	_, err = ParseValue(OIDBool, "")
	// Bool parses empty string as false (no error) — that's the current behavior
	if err != nil {
		t.Errorf("unexpected error parsing empty bool: %v", err)
	}
}

func TestQA_ParseValue_NonNumericInput(t *testing.T) {
	_, err := ParseValue(OIDInt4, "not-a-number")
	if err == nil {
		t.Error("expected error parsing non-numeric string as int4")
	}
	_, err = ParseValue(OIDFloat8, "xyz")
	if err == nil {
		t.Error("expected error parsing non-numeric string as float8")
	}
}

func TestQA_ParseValue_FloatSpecialValues(t *testing.T) {
	// NaN
	gotNaN, err := ParseValue(OIDFloat8, "NaN")
	if err != nil {
		t.Fatalf("error parsing NaN: %v", err)
	}
	if f, ok := gotNaN.(float64); !ok || !math.IsNaN(f) {
		t.Errorf("expected NaN, got %v", gotNaN)
	}

	// Infinity
	gotInf, err := ParseValue(OIDFloat8, "Inf")
	if err != nil {
		t.Fatalf("error parsing Inf: %v", err)
	}
	if f, ok := gotInf.(float64); !ok || !math.IsInf(f, 1) {
		t.Errorf("expected +Inf, got %v", gotInf)
	}

	// Negative Infinity
	gotNegInf, err := ParseValue(OIDFloat8, "-Inf")
	if err != nil {
		t.Fatalf("error parsing -Inf: %v", err)
	}
	if f, ok := gotNegInf.(float64); !ok || !math.IsInf(f, -1) {
		t.Errorf("expected -Inf, got %v", gotNegInf)
	}
}

func TestQA_ParseValue_Float32SpecialValues(t *testing.T) {
	gotNaN, err := ParseValue(OIDFloat4, "NaN")
	if err != nil {
		t.Fatalf("error parsing Float4 NaN: %v", err)
	}
	if f, ok := gotNaN.(float32); !ok || !math.IsNaN(float64(f)) {
		t.Errorf("expected float32 NaN, got %v (%T)", gotNaN, gotNaN)
	}
}

// --- Embedding edge cases ---

func TestQA_ParseEmbedding_InvalidValues(t *testing.T) {
	_, err := ParseEmbedding("[abc,def]")
	if err == nil {
		t.Error("expected error parsing non-numeric embedding values")
	}
}

func TestQA_ParseEmbedding_MixedValid(t *testing.T) {
	_, err := ParseEmbedding("[1.0,abc,3.0]")
	if err == nil {
		t.Error("expected error for partially invalid embedding")
	}
}

func TestQA_ParseEmbedding_SingleValue(t *testing.T) {
	e, err := ParseEmbedding("[42.0]")
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if len(e) != 1 || math.Abs(float64(e[0]-42.0)) > 0.001 {
		t.Errorf("expected [42.0], got %v", e)
	}
}

func TestQA_ParseEmbedding_NoBrackets(t *testing.T) {
	// Should parse without brackets
	e, err := ParseEmbedding("1.0,2.0,3.0")
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if len(e) != 3 {
		t.Errorf("expected 3 elements, got %d", len(e))
	}
}

func TestQA_ParseEmbedding_WhitespaceOnly(t *testing.T) {
	e, err := ParseEmbedding("   ")
	// Trimmed to empty, but then splits on comma giving [""] which fails float parse
	if err == nil && len(e) > 0 {
		t.Errorf("expected empty or error for whitespace input, got %v", e)
	}
}

func TestQA_ParseEmbedding_VeryLarge(t *testing.T) {
	// Large embedding (1000 dimensions)
	parts := make([]string, 1000)
	for i := range parts {
		parts[i] = "0.1"
	}
	input := "[" + strings.Join(parts, ",") + "]"
	e, err := ParseEmbedding(input)
	if err != nil {
		t.Fatalf("error parsing large embedding: %v", err)
	}
	if len(e) != 1000 {
		t.Errorf("expected 1000 dimensions, got %d", len(e))
	}
}

func TestQA_SerializeEmbedding_Empty(t *testing.T) {
	got := SerializeEmbedding(Embedding{})
	if got != "[]" {
		t.Errorf("empty embedding should serialize to [], got %q", got)
	}
}

func TestQA_EmbeddingRoundTrip_SpecialFloats(t *testing.T) {
	// Test with very small and very large float32 values
	e := Embedding{math.SmallestNonzeroFloat32, math.MaxFloat32, -math.MaxFloat32}
	serialized := SerializeEmbedding(e)
	parsed, err := ParseEmbedding(serialized)
	if err != nil {
		t.Fatalf("error parsing round-trip: %v", err)
	}
	if len(parsed) != 3 {
		t.Fatalf("expected 3 values, got %d", len(parsed))
	}
}

// --- UUID edge cases ---

func TestQA_ParseUUID_InvalidLength(t *testing.T) {
	_, err := parseUUID("550e8400")
	if err == nil {
		t.Error("expected error for short UUID")
	}
}

func TestQA_ParseUUID_InvalidHex(t *testing.T) {
	_, err := parseUUID("550e8400-e29b-41d4-a716-44665544zzzz")
	if err == nil {
		t.Error("expected error for non-hex UUID characters")
	}
}

func TestQA_ParseUUID_EmptyString(t *testing.T) {
	_, err := parseUUID("")
	if err == nil {
		t.Error("expected error for empty UUID")
	}
}

func TestQA_ParseUUID_NoDashes(t *testing.T) {
	uuid, err := parseUUID("550e8400e29b41d4a716446655440000")
	if err != nil {
		t.Fatalf("error parsing UUID without dashes: %v", err)
	}
	formatted := FormatUUID(uuid)
	if formatted != "550e8400-e29b-41d4-a716-446655440000" {
		t.Errorf("round-trip with no-dash input failed: got %q", formatted)
	}
}

func TestQA_FormatUUID_AllZeros(t *testing.T) {
	var uuid [16]byte
	got := FormatUUID(uuid)
	if got != "00000000-0000-0000-0000-000000000000" {
		t.Errorf("all-zero UUID = %q, want %q", got, "00000000-0000-0000-0000-000000000000")
	}
}

func TestQA_FormatUUID_AllOnes(t *testing.T) {
	uuid := [16]byte{0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
		0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF}
	got := FormatUUID(uuid)
	if got != "ffffffff-ffff-ffff-ffff-ffffffffffff" {
		t.Errorf("all-ones UUID = %q, want %q", got, "ffffffff-ffff-ffff-ffff-ffffffffffff")
	}
}

// --- Bytea edge cases ---

func TestQA_ParseBytea_EmptyHex(t *testing.T) {
	got := parseBytea("\\x")
	if len(got) != 0 {
		t.Errorf("empty hex bytea should give empty []byte, got %v", got)
	}
}

func TestQA_ParseBytea_OddHex(t *testing.T) {
	// Odd-length hex after \x prefix - incomplete byte gets dropped
	got := parseBytea("\\x4")
	// This is a known edge case — incomplete hex byte is silently dropped
	// Current behavior: returns empty []byte
	if len(got) != 0 {
		t.Logf("Note: odd hex \\x4 returned %v (expected empty due to incomplete byte)", got)
	}
}

func TestQA_ParseBytea_NonHexAfterPrefix(t *testing.T) {
	// \x followed by non-hex chars
	got := parseBytea("\\xZZZZ")
	// ParseUint with base 16 returns 0 for invalid hex, so we get zero bytes
	if len(got) != 2 {
		t.Logf("Note: non-hex chars returned %v instead of error", got)
	}
}

func TestQA_ParseBytea_PlainText(t *testing.T) {
	got := parseBytea("hello world")
	if string(got) != "hello world" {
		t.Errorf("plain text bytea = %q, want %q", string(got), "hello world")
	}
}

func TestQA_ParseBytea_EmptyString(t *testing.T) {
	got := parseBytea("")
	if len(got) != 0 {
		t.Errorf("empty string bytea should give empty []byte, got %v", got)
	}
}

// --- Timestamp parsing edge cases ---

func TestQA_ParseTimestamp_InvalidFormat(t *testing.T) {
	_, err := parseTimestamp("not-a-timestamp")
	if err == nil {
		t.Error("expected error for invalid timestamp")
	}
}

func TestQA_ParseTimestamp_ISO8601WithMillis(t *testing.T) {
	ts, err := parseTimestamp("2024-03-15 10:30:45.123456")
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if ts.Hour() != 10 || ts.Minute() != 30 || ts.Second() != 45 {
		t.Errorf("timestamp = %v, expected 10:30:45", ts)
	}
}

func TestQA_ParseTimestamp_RFC3339(t *testing.T) {
	ts, err := parseTimestamp("2024-03-15T10:30:45Z")
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if ts.Year() != 2024 || ts.Month() != 3 || ts.Day() != 15 {
		t.Errorf("timestamp = %v, expected 2024-03-15", ts)
	}
}

func TestQA_ParseTimestamp_EmptyString(t *testing.T) {
	_, err := parseTimestamp("")
	if err == nil {
		t.Error("expected error for empty timestamp")
	}
}

// --- Date parsing edge cases ---

func TestQA_ParseDate_InvalidFormat(t *testing.T) {
	_, err := parseDate("03/15/2024")
	if err == nil {
		t.Error("expected error for non-ISO date format")
	}
}

func TestQA_ParseDate_EmptyString(t *testing.T) {
	_, err := parseDate("")
	if err == nil {
		t.Error("expected error for empty date")
	}
}

// --- Interval parsing edge cases ---

func TestQA_ParseInterval_YearsMonths(t *testing.T) {
	// BUG: Interval.String() produces "1 years 6 months" but parseInterval can't parse it back
	iv := Interval{Years: 1, Months: 6}
	s := iv.String()
	// Attempt round-trip
	parsed, err := parseInterval(s)
	if err != nil {
		t.Errorf("ROUND-TRIP FAILURE: Interval{Years:1, Months:6}.String() = %q, but parseInterval returns error: %v", s, err)
		return
	}
	if parsed.Years != 1 || parsed.Months != 6 {
		t.Errorf("ROUND-TRIP MISMATCH: parsed = %+v, want Years=1 Months=6", parsed)
	}
}

func TestQA_ParseInterval_YearsMonthsDays(t *testing.T) {
	// Complex interval with years, months, days, and time
	iv := Interval{Years: 2, Months: 3, Days: 15, Hours: 8, Minutes: 30, Seconds: 45.5}
	s := iv.String()
	parsed, err := parseInterval(s)
	if err != nil {
		t.Errorf("ROUND-TRIP FAILURE: complex interval String() = %q, parseInterval error: %v", s, err)
		return
	}
	if parsed.Years != 2 || parsed.Months != 3 || parsed.Days != 15 {
		t.Errorf("ROUND-TRIP MISMATCH: parsed = %+v", parsed)
	}
}

func TestQA_ParseIntervalTime_InvalidInput(t *testing.T) {
	// parseIntervalTime silently returns zeros for invalid input
	iv, err := parseIntervalTime("abc:def:ghi")
	if err != nil {
		// If error is returned, that's correct behavior
		return
	}
	// If no error: all values should be valid or an error should have been returned
	if iv.Hours == 0 && iv.Minutes == 0 && iv.Seconds == 0 {
		t.Errorf("parseIntervalTime(\"abc:def:ghi\") silently returned zero Interval instead of error")
	}
}

func TestQA_ParseIntervalTime_TwoColonParts(t *testing.T) {
	// Only 2 parts instead of 3
	_, err := parseIntervalTime("01:30")
	if err == nil {
		t.Error("expected error for 2-part time format (missing seconds)")
	}
}

func TestQA_ParseIntervalTime_FourColonParts(t *testing.T) {
	_, err := parseIntervalTime("01:30:00:00")
	if err == nil {
		t.Error("expected error for 4-part time format")
	}
}

func TestQA_ParseInterval_NegativeDays(t *testing.T) {
	iv, err := parseInterval("-3 days 02:00:00")
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if iv.Days != -3 {
		t.Errorf("days = %d, want -3", iv.Days)
	}
}

func TestQA_ParseInterval_EmptyString(t *testing.T) {
	_, err := parseInterval("")
	// Empty string should either return error or zero interval
	if err != nil {
		return // error is acceptable
	}
	// Zero interval is also acceptable
}

func TestQA_ParseInterval_ZeroSeconds(t *testing.T) {
	iv, err := parseInterval("0")
	if err != nil {
		t.Fatalf("error parsing '0': %v", err)
	}
	if iv.Seconds != 0 {
		t.Errorf("seconds = %f, want 0", iv.Seconds)
	}
}

func TestQA_ParseInterval_NegativeTime(t *testing.T) {
	iv, err := parseIntervalTime("-01:30:00")
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	// Negative hours should be preserved
	if iv.Hours != -1 {
		t.Errorf("hours = %d, want -1", iv.Hours)
	}
}

// --- Interval String edge cases ---

func TestQA_IntervalString_NegativeYears(t *testing.T) {
	iv := Interval{Years: -2, Months: -3}
	s := iv.String()
	if !strings.Contains(s, "-2") {
		t.Errorf("negative years interval = %q, expected to contain -2", s)
	}
}

func TestQA_IntervalString_OnlySeconds(t *testing.T) {
	iv := Interval{Seconds: 45.5}
	s := iv.String()
	if s == "0" {
		t.Error("interval with only seconds should not be '0'")
	}
}

// --- JSON parsing edge cases ---

func TestQA_ParseValue_JSONArray(t *testing.T) {
	got, err := ParseValue(OIDJSON, `[1,2,3]`)
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	arr, ok := got.([]interface{})
	if !ok {
		t.Fatalf("expected []interface{}, got %T", got)
	}
	if len(arr) != 3 {
		t.Errorf("array length = %d, want 3", len(arr))
	}
}

func TestQA_ParseValue_JSONNull(t *testing.T) {
	got, err := ParseValue(OIDJSON, `null`)
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if got != nil {
		t.Errorf("JSON null should be nil, got %v", got)
	}
}

func TestQA_ParseValue_JSONInvalid(t *testing.T) {
	_, err := ParseValue(OIDJSON, `{invalid json}`)
	if err == nil {
		t.Error("expected error for invalid JSON")
	}
}

func TestQA_ParseValue_JSONEmptyString(t *testing.T) {
	_, err := ParseValue(OIDJSON, ``)
	if err == nil {
		t.Error("expected error for empty JSON string")
	}
}

// --- Bool parsing edge cases ---

func TestQA_ParseBool_UnexpectedValues(t *testing.T) {
	// These should all parse as false since they don't match true patterns
	for _, val := range []string{"yes", "on", "TRUE", "True", "2", "y"} {
		got := parseBool(val)
		// "TRUE" and "True" should actually be true since parseBool uses ToLower
		if strings.ToLower(val) == "true" && !got {
			t.Errorf("parseBool(%q) = false, expected true", val)
		}
	}
}
