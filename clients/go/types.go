package sixsevendb

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
)

// Type OID constants matching the server's pg_type catalog.
const (
	OIDBool      uint32 = 16
	OIDTinyint   uint32 = 18
	OIDInt2      uint32 = 21
	OIDInt4      uint32 = 23
	OIDInt8      uint32 = 20
	OIDUINT8     uint32 = 100001
	OIDUINT16    uint32 = 100002
	OIDUINT32    uint32 = 100003
	OIDUINT64    uint32 = 100004
	OIDFloat4    uint32 = 700
	OIDFloat8    uint32 = 701
	OIDNumeric   uint32 = 1700
	OIDText      uint32 = 25
	OIDVarchar   uint32 = 1043
	OIDChar      uint32 = 1042
	OIDBytea     uint32 = 17
	OIDBlob      uint32 = 100005
	OIDDate      uint32 = 1082
	OIDTime      uint32 = 1083
	OIDTimestamp uint32 = 1114
	OIDInterval  uint32 = 1186
	OIDPoint     uint32 = 600
	OIDJSON      uint32 = 114
	OIDUUID      uint32 = 2950
	OIDEmbedding uint32 = 100000
)

// Embedding represents a vector embedding as a slice of float32 values.
// It implements sql.Scanner and driver.Valuer for direct use with database/sql.
type Embedding []float32

// Scan implements the sql.Scanner interface for Embedding.
func (e *Embedding) Scan(src interface{}) error {
	if src == nil {
		*e = nil
		return nil
	}
	switch v := src.(type) {
	case string:
		parsed, err := ParseEmbedding(v)
		if err != nil {
			return err
		}
		*e = parsed
		return nil
	case []byte:
		parsed, err := ParseEmbedding(string(v))
		if err != nil {
			return err
		}
		*e = parsed
		return nil
	case Embedding:
		*e = v
		return nil
	case []float32:
		*e = Embedding(v)
		return nil
	default:
		return fmt.Errorf("sixsevendb: cannot scan %T into Embedding", src)
	}
}

// Value implements the driver.Valuer interface for Embedding.
func (e Embedding) Value() (driver.Value, error) {
	if e == nil {
		return nil, nil
	}
	return SerializeEmbedding(e), nil
}

// Interval represents a time interval with separate year/month/day/time components.
// It implements sql.Scanner and driver.Valuer for direct use with database/sql.
type Interval struct {
	Years   int
	Months  int
	Days    int
	Hours   int
	Minutes int
	Seconds float64
}

// Scan implements the sql.Scanner interface for Interval.
func (i *Interval) Scan(src interface{}) error {
	if src == nil {
		*i = Interval{}
		return nil
	}
	switch v := src.(type) {
	case string:
		parsed, err := parseInterval(v)
		if err != nil {
			return err
		}
		*i = parsed
		return nil
	case []byte:
		parsed, err := parseInterval(string(v))
		if err != nil {
			return err
		}
		*i = parsed
		return nil
	case Interval:
		*i = v
		return nil
	default:
		return fmt.Errorf("sixsevendb: cannot scan %T into Interval", src)
	}
}

// Value implements the driver.Valuer interface for Interval.
func (i Interval) Value() (driver.Value, error) {
	return i.String(), nil
}

// String returns the interval in a human-readable format.
func (i Interval) String() string {
	var parts []string
	if i.Years != 0 {
		parts = append(parts, fmt.Sprintf("%d years", i.Years))
	}
	if i.Months != 0 {
		parts = append(parts, fmt.Sprintf("%d months", i.Months))
	}
	if i.Days != 0 {
		parts = append(parts, fmt.Sprintf("%d days", i.Days))
	}
	if i.Hours != 0 || i.Minutes != 0 || i.Seconds != 0 {
		parts = append(parts, fmt.Sprintf("%02d:%02d:%06.3f", i.Hours, i.Minutes, i.Seconds))
	}
	if len(parts) == 0 {
		return "0"
	}
	return strings.Join(parts, " ")
}

// ParseEmbedding parses a text-format embedding "[0.1,0.2,0.3]" into []float32.
func ParseEmbedding(s string) (Embedding, error) {
	s = strings.TrimSpace(s)
	if strings.HasPrefix(s, "[") && strings.HasSuffix(s, "]") {
		s = s[1 : len(s)-1]
	}
	if s == "" {
		return Embedding{}, nil
	}
	parts := strings.Split(s, ",")
	result := make(Embedding, len(parts))
	for i, p := range parts {
		v, err := strconv.ParseFloat(strings.TrimSpace(p), 32)
		if err != nil {
			return nil, fmt.Errorf("invalid embedding value %q: %w", p, err)
		}
		result[i] = float32(v)
	}
	return result, nil
}

// SerializeEmbedding converts an embedding to text format "[0.1,0.2,0.3]".
func SerializeEmbedding(e Embedding) string {
	parts := make([]string, len(e))
	for i, v := range e {
		parts[i] = strconv.FormatFloat(float64(v), 'f', -1, 32)
	}
	return "[" + strings.Join(parts, ",") + "]"
}

// ParseValue parses a text-format value based on its type OID.
func ParseValue(typeOID uint32, value string) (interface{}, error) {
	switch typeOID {
	case OIDBool:
		return parseBool(value), nil
	case OIDTinyint:
		v, err := strconv.ParseInt(value, 10, 8)
		return int8(v), err
	case OIDInt2:
		v, err := strconv.ParseInt(value, 10, 16)
		return int16(v), err
	case OIDInt4:
		v, err := strconv.ParseInt(value, 10, 32)
		return int32(v), err
	case OIDInt8:
		v, err := strconv.ParseInt(value, 10, 64)
		return v, err
	case OIDUINT8:
		v, err := strconv.ParseUint(value, 10, 8)
		return uint8(v), err
	case OIDUINT16:
		v, err := strconv.ParseUint(value, 10, 16)
		return uint16(v), err
	case OIDUINT32:
		v, err := strconv.ParseUint(value, 10, 32)
		return uint32(v), err
	case OIDUINT64:
		v, err := strconv.ParseUint(value, 10, 64)
		return v, err
	case OIDFloat4:
		v, err := strconv.ParseFloat(value, 32)
		return float32(v), err
	case OIDFloat8:
		v, err := strconv.ParseFloat(value, 64)
		return v, err
	case OIDNumeric:
		// Return as string — Go has no built-in decimal type
		return value, nil
	case OIDText, OIDVarchar, OIDChar:
		return value, nil
	case OIDBytea, OIDBlob:
		return parseBytea(value), nil
	case OIDDate:
		return parseDate(value)
	case OIDTime:
		return value, nil // Return time as string
	case OIDTimestamp:
		return parseTimestamp(value)
	case OIDInterval:
		return parseInterval(value)
	case OIDJSON:
		var v interface{}
		err := json.Unmarshal([]byte(value), &v)
		return v, err
	case OIDUUID:
		return parseUUID(value)
	case OIDEmbedding:
		return ParseEmbedding(value)
	default:
		return value, nil
	}
}

func parseBool(s string) bool {
	switch strings.ToLower(s) {
	case "t", "true", "1":
		return true
	default:
		return false
	}
}

func parseBytea(s string) []byte {
	if strings.HasPrefix(s, "\\x") {
		b := make([]byte, 0, len(s)/2-1)
		for i := 2; i < len(s)-1; i += 2 {
			h, _ := strconv.ParseUint(s[i:i+2], 16, 8)
			b = append(b, byte(h))
		}
		return b
	}
	return []byte(s)
}

func parseDate(s string) (time.Time, error) {
	return time.Parse("2006-01-02", s)
}

func parseTimestamp(s string) (time.Time, error) {
	// Try common formats
	for _, layout := range []string{
		"2006-01-02 15:04:05",
		"2006-01-02T15:04:05",
		"2006-01-02 15:04:05.999999",
		"2006-01-02T15:04:05.999999",
		time.RFC3339,
	} {
		if t, err := time.Parse(layout, s); err == nil {
			return t, nil
		}
	}
	return time.Time{}, fmt.Errorf("cannot parse timestamp %q", s)
}

func parseInterval(s string) (Interval, error) {
	var iv Interval
	s = strings.TrimSpace(s)

	lower := strings.ToLower(s)

	// Check if the string contains named components (years, months, days)
	hasNamedComponents := strings.Contains(lower, "year") ||
		strings.Contains(lower, "month") ||
		strings.Contains(lower, "day")

	if hasNamedComponents {
		rest := lower

		// Extract years
		if idx := strings.Index(rest, "year"); idx >= 0 {
			numStr := strings.TrimSpace(rest[:idx])
			if v, err := strconv.Atoi(numStr); err == nil {
				iv.Years = v
			}
			rest = strings.TrimLeft(rest[idx+4:], "s ")
		}

		// Extract months
		if idx := strings.Index(rest, "month"); idx >= 0 {
			numStr := strings.TrimSpace(rest[:idx])
			if v, err := strconv.Atoi(numStr); err == nil {
				iv.Months = v
			}
			rest = strings.TrimLeft(rest[idx+5:], "s ")
		}

		// Extract days
		if idx := strings.Index(rest, "day"); idx >= 0 {
			numStr := strings.TrimSpace(rest[:idx])
			if v, err := strconv.Atoi(numStr); err == nil {
				iv.Days = v
			}
			rest = strings.TrimLeft(rest[idx+3:], "s ")
		}

		// Parse remaining time component (HH:MM:SS)
		rest = strings.TrimSpace(rest)
		if rest != "" && strings.Contains(rest, ":") {
			timeIv, err := parseIntervalTime(rest)
			if err == nil {
				iv.Hours = timeIv.Hours
				iv.Minutes = timeIv.Minutes
				iv.Seconds = timeIv.Seconds
			}
		}

		return iv, nil
	}

	// Handle pure "HH:MM:SS" format
	if strings.Contains(s, ":") {
		return parseIntervalTime(s)
	}

	// Try as raw seconds
	sec, err := strconv.ParseFloat(s, 64)
	if err == nil {
		iv.Seconds = sec
		return iv, nil
	}

	return iv, fmt.Errorf("cannot parse interval %q", s)
}

func parseIntervalTime(s string) (Interval, error) {
	parts := strings.Split(strings.TrimSpace(s), ":")
	if len(parts) != 3 {
		return Interval{}, fmt.Errorf("invalid time format %q", s)
	}
	h, _ := strconv.Atoi(parts[0])
	m, _ := strconv.Atoi(parts[1])
	sec, _ := strconv.ParseFloat(parts[2], 64)
	return Interval{Hours: h, Minutes: m, Seconds: sec}, nil
}

// parseUUID parses a UUID string into a [16]byte.
func parseUUID(s string) ([16]byte, error) {
	var uuid [16]byte
	s = strings.ReplaceAll(s, "-", "")
	if len(s) != 32 {
		return uuid, fmt.Errorf("invalid UUID %q", s)
	}
	for i := 0; i < 16; i++ {
		b, err := strconv.ParseUint(s[i*2:i*2+2], 16, 8)
		if err != nil {
			return uuid, fmt.Errorf("invalid UUID %q: %w", s, err)
		}
		uuid[i] = byte(b)
	}
	return uuid, nil
}

// FormatUUID formats a [16]byte as a standard UUID string.
func FormatUUID(uuid [16]byte) string {
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		uuid[0:4], uuid[4:6], uuid[6:8], uuid[8:10], uuid[10:16])
}

// NaN32 returns a float32 NaN value for use in comparisons.
func NaN32() float32 {
	return float32(math.NaN())
}
