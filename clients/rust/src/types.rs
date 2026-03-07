use crate::error::{Error, Result};
use std::fmt;
use std::str::FromStr;

// SixSevenDB type OIDs (matches Go client)
pub const OID_BOOL: u32 = 16;
pub const OID_TINYINT: u32 = 18;
pub const OID_INT2: u32 = 21;
pub const OID_INT4: u32 = 23;
pub const OID_INT8: u32 = 20;
pub const OID_UINT8: u32 = 100_001;
pub const OID_UINT16: u32 = 100_002;
pub const OID_UINT32: u32 = 100_003;
pub const OID_UINT64: u32 = 100_004;
pub const OID_FLOAT4: u32 = 700;
pub const OID_FLOAT8: u32 = 701;
pub const OID_NUMERIC: u32 = 1700;
pub const OID_TEXT: u32 = 25;
pub const OID_VARCHAR: u32 = 1043;
pub const OID_CHAR: u32 = 1042;
pub const OID_BYTEA: u32 = 17;
pub const OID_BLOB: u32 = 100_005;
pub const OID_DATE: u32 = 1082;
pub const OID_TIME: u32 = 1083;
pub const OID_TIMESTAMP: u32 = 1114;
pub const OID_INTERVAL: u32 = 1186;
pub const OID_POINT: u32 = 600;
pub const OID_JSON: u32 = 114;
pub const OID_UUID: u32 = 2950;
pub const OID_EMBEDDING: u32 = 100_000;

/// A dynamically-typed database value.
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Null,
    Bool(bool),
    TinyInt(i8),
    Int2(i16),
    Int4(i32),
    Int8(i64),
    UInt8(u8),
    UInt16(u16),
    UInt32(u32),
    UInt64(u64),
    Float4(f32),
    Float8(f64),
    Numeric(String),
    Text(String),
    Bytes(Vec<u8>),
    Date(chrono::NaiveDate),
    Time(String),
    Timestamp(chrono::NaiveDateTime),
    Interval(Interval),
    Json(String),
    Uuid(uuid::Uuid),
    Embedding(Embedding),
}

impl fmt::Display for Value {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Value::Null => write!(f, "NULL"),
            Value::Bool(v) => write!(f, "{v}"),
            Value::TinyInt(v) => write!(f, "{v}"),
            Value::Int2(v) => write!(f, "{v}"),
            Value::Int4(v) => write!(f, "{v}"),
            Value::Int8(v) => write!(f, "{v}"),
            Value::UInt8(v) => write!(f, "{v}"),
            Value::UInt16(v) => write!(f, "{v}"),
            Value::UInt32(v) => write!(f, "{v}"),
            Value::UInt64(v) => write!(f, "{v}"),
            Value::Float4(v) => write!(f, "{v}"),
            Value::Float8(v) => write!(f, "{v}"),
            Value::Numeric(v) | Value::Text(v) | Value::Time(v) | Value::Json(v) => write!(f, "{v}"),
            Value::Bytes(v) => write!(f, "\\x{}", hex_encode(v)),
            Value::Date(v) => write!(f, "{v}"),
            Value::Timestamp(v) => write!(f, "{v}"),
            Value::Interval(v) => write!(f, "{v}"),
            Value::Uuid(v) => write!(f, "{v}"),
            Value::Embedding(v) => write!(f, "{v}"),
        }
    }
}

/// An embedding vector (list of f32 values).
#[derive(Debug, Clone, PartialEq)]
pub struct Embedding(pub Vec<f32>);

impl Embedding {
    pub fn new(values: Vec<f32>) -> Self {
        Self(values)
    }

    pub fn as_slice(&self) -> &[f32] {
        &self.0
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

impl fmt::Display for Embedding {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[")?;
        for (i, v) in self.0.iter().enumerate() {
            if i > 0 {
                write!(f, ",")?;
            }
            write!(f, "{v}")?;
        }
        write!(f, "]")
    }
}

impl FromStr for Embedding {
    type Err = Error;

    fn from_str(s: &str) -> Result<Self> {
        parse_embedding(s)
    }
}

/// An interval value with year/month/day/time components.
#[derive(Debug, Clone, PartialEq)]
pub struct Interval {
    pub years: i32,
    pub months: i32,
    pub days: i32,
    pub hours: i32,
    pub minutes: i32,
    pub seconds: f64,
}

impl Interval {
    pub fn new() -> Self {
        Self { years: 0, months: 0, days: 0, hours: 0, minutes: 0, seconds: 0.0 }
    }
}

impl Default for Interval {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Display for Interval {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut parts = Vec::new();
        if self.years != 0 {
            parts.push(format!("{} year{}", self.years, if self.years.abs() != 1 { "s" } else { "" }));
        }
        if self.months != 0 {
            parts.push(format!("{} month{}", self.months, if self.months.abs() != 1 { "s" } else { "" }));
        }
        if self.days != 0 {
            parts.push(format!("{} day{}", self.days, if self.days.abs() != 1 { "s" } else { "" }));
        }
        if self.hours != 0 || self.minutes != 0 || self.seconds != 0.0 {
            parts.push(format!("{:02}:{:02}:{:06.3}", self.hours, self.minutes, self.seconds));
        }
        if parts.is_empty() {
            write!(f, "00:00:00.000")
        } else {
            write!(f, "{}", parts.join(" "))
        }
    }
}

impl FromStr for Interval {
    type Err = Error;

    fn from_str(s: &str) -> Result<Self> {
        parse_interval(s)
    }
}

/// Parse a text-format value based on its OID into a typed Value.
pub fn parse_value(type_oid: u32, text: &str) -> Result<Value> {
    match type_oid {
        OID_BOOL => {
            let v = matches!(text, "t" | "true" | "1" | "T" | "TRUE" | "yes");
            Ok(Value::Bool(v))
        }
        OID_TINYINT => text.parse::<i8>()
            .map(Value::TinyInt)
            .map_err(|e| Error::Type(format!("tinyint: {e}"))),
        OID_INT2 => text.parse::<i16>()
            .map(Value::Int2)
            .map_err(|e| Error::Type(format!("int2: {e}"))),
        OID_INT4 => text.parse::<i32>()
            .map(Value::Int4)
            .map_err(|e| Error::Type(format!("int4: {e}"))),
        OID_INT8 => text.parse::<i64>()
            .map(Value::Int8)
            .map_err(|e| Error::Type(format!("int8: {e}"))),
        OID_UINT8 => text.parse::<u8>()
            .map(Value::UInt8)
            .map_err(|e| Error::Type(format!("uint8: {e}"))),
        OID_UINT16 => text.parse::<u16>()
            .map(Value::UInt16)
            .map_err(|e| Error::Type(format!("uint16: {e}"))),
        OID_UINT32 => text.parse::<u32>()
            .map(Value::UInt32)
            .map_err(|e| Error::Type(format!("uint32: {e}"))),
        OID_UINT64 => text.parse::<u64>()
            .map(Value::UInt64)
            .map_err(|e| Error::Type(format!("uint64: {e}"))),
        OID_FLOAT4 => text.parse::<f32>()
            .map(Value::Float4)
            .map_err(|e| Error::Type(format!("float4: {e}"))),
        OID_FLOAT8 => text.parse::<f64>()
            .map(Value::Float8)
            .map_err(|e| Error::Type(format!("float8: {e}"))),
        OID_NUMERIC => Ok(Value::Numeric(text.to_string())),
        OID_TEXT | OID_VARCHAR | OID_CHAR => Ok(Value::Text(text.to_string())),
        OID_BYTEA | OID_BLOB => {
            let bytes = parse_bytea(text)?;
            Ok(Value::Bytes(bytes))
        }
        OID_DATE => {
            chrono::NaiveDate::parse_from_str(text, "%Y-%m-%d")
                .map(Value::Date)
                .map_err(|e| Error::Type(format!("date: {e}")))
        }
        OID_TIME => Ok(Value::Time(text.to_string())),
        OID_TIMESTAMP => parse_timestamp(text).map(Value::Timestamp),
        OID_INTERVAL => parse_interval(text).map(Value::Interval),
        OID_POINT => Ok(Value::Text(text.to_string())),
        OID_JSON => Ok(Value::Json(text.to_string())),
        OID_UUID => uuid::Uuid::parse_str(text)
            .map(Value::Uuid)
            .map_err(|e| Error::Type(format!("uuid: {e}"))),
        OID_EMBEDDING => parse_embedding(text).map(Value::Embedding),
        _ => Ok(Value::Text(text.to_string())),
    }
}

/// Format a Value for use as a query parameter (text format).
pub fn format_value(value: &Value) -> Option<String> {
    match value {
        Value::Null => None,
        Value::Bool(v) => Some(if *v { "t".to_string() } else { "f".to_string() }),
        other => Some(other.to_string()),
    }
}

/// Parse an embedding from text format: "[0.1,0.2,0.3]".
pub fn parse_embedding(s: &str) -> Result<Embedding> {
    let trimmed = s.trim();
    let inner = trimmed
        .strip_prefix('[')
        .and_then(|s| s.strip_suffix(']'))
        .ok_or_else(|| Error::Type("embedding must be enclosed in brackets".into()))?;

    if inner.trim().is_empty() {
        return Ok(Embedding(Vec::new()));
    }

    let values: std::result::Result<Vec<f32>, _> = inner
        .split(',')
        .map(|s| s.trim().parse::<f32>())
        .collect();

    values
        .map(Embedding)
        .map_err(|e| Error::Type(format!("embedding: {e}")))
}

/// Serialize an embedding to text format: "[0.1,0.2,0.3]".
pub fn serialize_embedding(e: &Embedding) -> String {
    e.to_string()
}

/// Parse bytea hex format: "\x48656c6c6f" -> bytes.
fn parse_bytea(s: &str) -> Result<Vec<u8>> {
    if let Some(hex) = s.strip_prefix("\\x") {
        hex_decode(hex).map_err(|e| Error::Type(format!("bytea hex: {e}")))
    } else {
        Ok(s.as_bytes().to_vec())
    }
}

/// Parse a timestamp with multiple format attempts.
fn parse_timestamp(s: &str) -> Result<chrono::NaiveDateTime> {
    let formats = [
        "%Y-%m-%d %H:%M:%S%.f",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%dT%H:%M:%S%.f",
        "%Y-%m-%dT%H:%M:%S",
    ];

    for fmt in &formats {
        if let Ok(ts) = chrono::NaiveDateTime::parse_from_str(s, fmt) {
            return Ok(ts);
        }
    }

    Err(Error::Type(format!("timestamp: unrecognized format: {s}")))
}

/// Parse an interval string. Supports formats like:
/// "2 years 3 months 5 days 01:30:00.000"
/// "01:30:00"
/// "5 days"
pub fn parse_interval(s: &str) -> Result<Interval> {
    let mut interval = Interval::new();
    let parts: Vec<&str> = s.split_whitespace().collect();
    let mut i = 0;

    while i < parts.len() {
        // Check if this is a time part (HH:MM:SS)
        if parts[i].contains(':') {
            let time_parts: Vec<&str> = parts[i].split(':').collect();
            if time_parts.len() >= 2 {
                interval.hours = time_parts[0].parse().unwrap_or(0);
                interval.minutes = time_parts[1].parse().unwrap_or(0);
                if time_parts.len() >= 3 {
                    interval.seconds = time_parts[2].parse().unwrap_or(0.0);
                }
            }
            i += 1;
            continue;
        }

        // Try to parse as number + unit
        if let Ok(num) = parts[i].parse::<i32>() {
            if i + 1 < parts.len() {
                let unit = parts[i + 1].to_lowercase();
                match unit.as_str() {
                    "year" | "years" => interval.years = num,
                    "month" | "months" | "mon" | "mons" => interval.months = num,
                    "day" | "days" => interval.days = num,
                    "hour" | "hours" => interval.hours = num,
                    "minute" | "minutes" | "min" | "mins" => interval.minutes = num,
                    "second" | "seconds" | "sec" | "secs" => interval.seconds = num as f64,
                    _ => {}
                }
                i += 2;
            } else {
                i += 1;
            }
        } else {
            i += 1;
        }
    }

    Ok(interval)
}

/// Hex-encode bytes.
fn hex_encode(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Hex-decode a string.
fn hex_decode(s: &str) -> std::result::Result<Vec<u8>, String> {
    if s.len() % 2 != 0 {
        return Err("odd length hex string".into());
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).map_err(|e| e.to_string()))
        .collect()
}

/// Format a UUID as standard string representation.
pub fn format_uuid(uuid: &uuid::Uuid) -> String {
    uuid.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_bool() {
        assert_eq!(parse_value(OID_BOOL, "t").unwrap(), Value::Bool(true));
        assert_eq!(parse_value(OID_BOOL, "true").unwrap(), Value::Bool(true));
        assert_eq!(parse_value(OID_BOOL, "1").unwrap(), Value::Bool(true));
        assert_eq!(parse_value(OID_BOOL, "f").unwrap(), Value::Bool(false));
        assert_eq!(parse_value(OID_BOOL, "false").unwrap(), Value::Bool(false));
        assert_eq!(parse_value(OID_BOOL, "0").unwrap(), Value::Bool(false));
    }

    #[test]
    fn test_parse_integers() {
        assert_eq!(parse_value(OID_TINYINT, "42").unwrap(), Value::TinyInt(42));
        assert_eq!(parse_value(OID_TINYINT, "-128").unwrap(), Value::TinyInt(-128));
        assert_eq!(parse_value(OID_INT2, "1000").unwrap(), Value::Int2(1000));
        assert_eq!(parse_value(OID_INT4, "100000").unwrap(), Value::Int4(100000));
        assert_eq!(parse_value(OID_INT8, "9999999999").unwrap(), Value::Int8(9999999999));
    }

    #[test]
    fn test_parse_unsigned_integers() {
        assert_eq!(parse_value(OID_UINT8, "255").unwrap(), Value::UInt8(255));
        assert_eq!(parse_value(OID_UINT16, "65535").unwrap(), Value::UInt16(65535));
        assert_eq!(parse_value(OID_UINT32, "4294967295").unwrap(), Value::UInt32(4294967295));
        assert_eq!(parse_value(OID_UINT64, "18446744073709551615").unwrap(), Value::UInt64(u64::MAX));
    }

    #[test]
    fn test_parse_floats() {
        assert_eq!(parse_value(OID_FLOAT4, "3.14").unwrap(), Value::Float4(3.14));
        assert_eq!(parse_value(OID_FLOAT8, "2.718281828").unwrap(), Value::Float8(2.718281828));
    }

    #[test]
    fn test_parse_text() {
        assert_eq!(parse_value(OID_TEXT, "hello").unwrap(), Value::Text("hello".into()));
        assert_eq!(parse_value(OID_VARCHAR, "world").unwrap(), Value::Text("world".into()));
        assert_eq!(parse_value(OID_CHAR, "x").unwrap(), Value::Text("x".into()));
    }

    #[test]
    fn test_parse_date() {
        let v = parse_value(OID_DATE, "2024-01-15").unwrap();
        assert_eq!(v, Value::Date(chrono::NaiveDate::from_ymd_opt(2024, 1, 15).unwrap()));
    }

    #[test]
    fn test_parse_timestamp() {
        let v = parse_value(OID_TIMESTAMP, "2024-01-15 10:30:00").unwrap();
        if let Value::Timestamp(ts) = v {
            assert_eq!(ts.date(), chrono::NaiveDate::from_ymd_opt(2024, 1, 15).unwrap());
        } else {
            panic!("expected Timestamp");
        }
    }

    #[test]
    fn test_parse_timestamp_with_fractional() {
        let v = parse_value(OID_TIMESTAMP, "2024-01-15 10:30:00.123456").unwrap();
        assert!(matches!(v, Value::Timestamp(_)));
    }

    #[test]
    fn test_parse_uuid() {
        let v = parse_value(OID_UUID, "550e8400-e29b-41d4-a716-446655440000").unwrap();
        if let Value::Uuid(u) = v {
            assert_eq!(u.to_string(), "550e8400-e29b-41d4-a716-446655440000");
        } else {
            panic!("expected UUID");
        }
    }

    #[test]
    fn test_parse_embedding() {
        let e = parse_embedding("[0.1,0.2,0.3]").unwrap();
        assert_eq!(e.0.len(), 3);
        assert!((e.0[0] - 0.1).abs() < f32::EPSILON);
        assert!((e.0[1] - 0.2).abs() < f32::EPSILON);
        assert!((e.0[2] - 0.3).abs() < f32::EPSILON);
    }

    #[test]
    fn test_parse_embedding_empty() {
        let e = parse_embedding("[]").unwrap();
        assert!(e.is_empty());
    }

    #[test]
    fn test_parse_embedding_with_spaces() {
        let e = parse_embedding("[ 0.1 , 0.2 , 0.3 ]").unwrap();
        assert_eq!(e.len(), 3);
    }

    #[test]
    fn test_parse_embedding_invalid() {
        assert!(parse_embedding("not an embedding").is_err());
        assert!(parse_embedding("[a,b,c]").is_err());
    }

    #[test]
    fn test_serialize_embedding() {
        let e = Embedding(vec![0.1, 0.2, 0.3]);
        let s = serialize_embedding(&e);
        assert_eq!(s, "[0.1,0.2,0.3]");
    }

    #[test]
    fn test_parse_interval() {
        let i = parse_interval("2 years 3 months 5 days 01:30:00.500").unwrap();
        assert_eq!(i.years, 2);
        assert_eq!(i.months, 3);
        assert_eq!(i.days, 5);
        assert_eq!(i.hours, 1);
        assert_eq!(i.minutes, 30);
        assert!((i.seconds - 0.5).abs() < f64::EPSILON);
    }

    #[test]
    fn test_parse_interval_time_only() {
        let i = parse_interval("10:30:00").unwrap();
        assert_eq!(i.hours, 10);
        assert_eq!(i.minutes, 30);
    }

    #[test]
    fn test_parse_interval_days_only() {
        let i = parse_interval("5 days").unwrap();
        assert_eq!(i.days, 5);
    }

    #[test]
    fn test_interval_display() {
        let i = Interval { years: 1, months: 2, days: 3, hours: 4, minutes: 5, seconds: 6.0 };
        let s = i.to_string();
        assert!(s.contains("1 year"));
        assert!(s.contains("2 months"));
        assert!(s.contains("3 days"));
        assert!(s.contains("04:05:06.000"));
    }

    #[test]
    fn test_interval_display_empty() {
        let i = Interval::new();
        assert_eq!(i.to_string(), "00:00:00.000");
    }

    #[test]
    fn test_parse_bytea_hex() {
        let v = parse_value(OID_BYTEA, "\\x48656c6c6f").unwrap();
        assert_eq!(v, Value::Bytes(b"Hello".to_vec()));
    }

    #[test]
    fn test_parse_bytea_raw() {
        let v = parse_value(OID_BYTEA, "Hello").unwrap();
        assert_eq!(v, Value::Bytes(b"Hello".to_vec()));
    }

    #[test]
    fn test_parse_numeric() {
        let v = parse_value(OID_NUMERIC, "123.456").unwrap();
        assert_eq!(v, Value::Numeric("123.456".into()));
    }

    #[test]
    fn test_parse_json() {
        let v = parse_value(OID_JSON, r#"{"key": "value"}"#).unwrap();
        assert_eq!(v, Value::Json(r#"{"key": "value"}"#.into()));
    }

    #[test]
    fn test_parse_unknown_oid() {
        let v = parse_value(99999, "something").unwrap();
        assert_eq!(v, Value::Text("something".into()));
    }

    #[test]
    fn test_format_value() {
        assert_eq!(format_value(&Value::Null), None);
        assert_eq!(format_value(&Value::Bool(true)), Some("t".into()));
        assert_eq!(format_value(&Value::Bool(false)), Some("f".into()));
        assert_eq!(format_value(&Value::Int4(42)), Some("42".into()));
        assert_eq!(format_value(&Value::Text("hello".into())), Some("hello".into()));
    }

    #[test]
    fn test_value_display() {
        assert_eq!(Value::Null.to_string(), "NULL");
        assert_eq!(Value::Bool(true).to_string(), "true");
        assert_eq!(Value::Int4(42).to_string(), "42");
        assert_eq!(Value::Float8(3.14).to_string(), "3.14");
    }

    #[test]
    fn test_hex_encode_decode() {
        let bytes = b"Hello";
        let encoded = hex_encode(bytes);
        assert_eq!(encoded, "48656c6c6f");
        let decoded = hex_decode(&encoded).unwrap();
        assert_eq!(decoded, bytes);
    }

    #[test]
    fn test_format_uuid() {
        let u = uuid::Uuid::parse_str("550e8400-e29b-41d4-a716-446655440000").unwrap();
        assert_eq!(format_uuid(&u), "550e8400-e29b-41d4-a716-446655440000");
    }

    #[test]
    fn test_parse_integer_overflow() {
        assert!(parse_value(OID_TINYINT, "200").is_err());
        assert!(parse_value(OID_UINT8, "256").is_err());
        assert!(parse_value(OID_INT2, "99999").is_err());
    }
}
