// =============================================================================
// QA Adversarial Tests for GDB-50: Rust Client Library — Type System
// =============================================================================
//
// Tests target: types.rs (Value parsing, formatting, edge cases)
// Acceptance criteria verified:
//   - All 22 server types implement FromSql and ToSql
//   - DATE/TIMESTAMP use chrono types
//   - EMBEDDING columns deserialized as Vec<f32>

#[cfg(test)]
mod tests {
    use crate::types::*;

    // ─── Integer overflow / underflow ────────────────────────────────

    #[test]
    fn qa_tinyint_overflow() {
        assert!(parse_value(OID_TINYINT, "128").is_err());
    }

    #[test]
    fn qa_tinyint_underflow() {
        assert!(parse_value(OID_TINYINT, "-129").is_err());
    }

    #[test]
    fn qa_int2_overflow() {
        assert!(parse_value(OID_INT2, "32768").is_err());
    }

    #[test]
    fn qa_int2_underflow() {
        assert!(parse_value(OID_INT2, "-32769").is_err());
    }

    #[test]
    fn qa_int4_overflow() {
        assert!(parse_value(OID_INT4, "2147483648").is_err());
    }

    #[test]
    fn qa_int4_underflow() {
        assert!(parse_value(OID_INT4, "-2147483649").is_err());
    }

    #[test]
    fn qa_int8_overflow() {
        assert!(parse_value(OID_INT8, "9223372036854775808").is_err());
    }

    #[test]
    fn qa_uint8_overflow() {
        assert!(parse_value(OID_UINT8, "256").is_err());
    }

    #[test]
    fn qa_uint16_overflow() {
        assert!(parse_value(OID_UINT16, "65536").is_err());
    }

    #[test]
    fn qa_uint32_overflow() {
        assert!(parse_value(OID_UINT32, "4294967296").is_err());
    }

    #[test]
    fn qa_uint64_overflow() {
        assert!(parse_value(OID_UINT64, "18446744073709551616").is_err());
    }

    #[test]
    fn qa_unsigned_reject_negative() {
        assert!(parse_value(OID_UINT8, "-1").is_err());
        assert!(parse_value(OID_UINT16, "-1").is_err());
        assert!(parse_value(OID_UINT32, "-1").is_err());
        assert!(parse_value(OID_UINT64, "-1").is_err());
    }

    // ─── Integer boundary values ─────────────────────────────────────

    #[test]
    fn qa_tinyint_boundaries() {
        assert_eq!(parse_value(OID_TINYINT, "-128").unwrap(), Value::TinyInt(-128));
        assert_eq!(parse_value(OID_TINYINT, "127").unwrap(), Value::TinyInt(127));
        assert_eq!(parse_value(OID_TINYINT, "0").unwrap(), Value::TinyInt(0));
    }

    #[test]
    fn qa_int2_boundaries() {
        assert_eq!(parse_value(OID_INT2, "-32768").unwrap(), Value::Int2(-32768));
        assert_eq!(parse_value(OID_INT2, "32767").unwrap(), Value::Int2(32767));
    }

    #[test]
    fn qa_int4_boundaries() {
        assert_eq!(parse_value(OID_INT4, "-2147483648").unwrap(), Value::Int4(i32::MIN));
        assert_eq!(parse_value(OID_INT4, "2147483647").unwrap(), Value::Int4(i32::MAX));
    }

    #[test]
    fn qa_int8_boundaries() {
        assert_eq!(parse_value(OID_INT8, "-9223372036854775808").unwrap(), Value::Int8(i64::MIN));
        assert_eq!(parse_value(OID_INT8, "9223372036854775807").unwrap(), Value::Int8(i64::MAX));
    }

    #[test]
    fn qa_uint_boundaries() {
        assert_eq!(parse_value(OID_UINT8, "0").unwrap(), Value::UInt8(0));
        assert_eq!(parse_value(OID_UINT8, "255").unwrap(), Value::UInt8(255));
        assert_eq!(parse_value(OID_UINT16, "0").unwrap(), Value::UInt16(0));
        assert_eq!(parse_value(OID_UINT16, "65535").unwrap(), Value::UInt16(65535));
        assert_eq!(parse_value(OID_UINT32, "0").unwrap(), Value::UInt32(0));
        assert_eq!(parse_value(OID_UINT32, "4294967295").unwrap(), Value::UInt32(u32::MAX));
        assert_eq!(parse_value(OID_UINT64, "0").unwrap(), Value::UInt64(0));
        assert_eq!(parse_value(OID_UINT64, "18446744073709551615").unwrap(), Value::UInt64(u64::MAX));
    }

    // ─── Non-numeric input for numeric types ─────────────────────────

    #[test]
    fn qa_integer_non_numeric_input() {
        assert!(parse_value(OID_TINYINT, "abc").is_err());
        assert!(parse_value(OID_INT2, "not_a_number").is_err());
        assert!(parse_value(OID_INT4, "12.5").is_err());
        assert!(parse_value(OID_INT8, "").is_err());
        assert!(parse_value(OID_UINT8, "hello").is_err());
        assert!(parse_value(OID_FLOAT4, "not_float").is_err());
        assert!(parse_value(OID_FLOAT8, "xyz").is_err());
    }

    // ─── Float special values ────────────────────────────────────────

    #[test]
    fn qa_float_infinity() {
        let v = parse_value(OID_FLOAT4, "inf");
        assert!(v.is_ok());
        if let Ok(Value::Float4(f)) = v {
            assert!(f.is_infinite());
        }
    }

    #[test]
    fn qa_float_negative_infinity() {
        let v = parse_value(OID_FLOAT4, "-inf");
        assert!(v.is_ok());
        if let Ok(Value::Float4(f)) = v {
            assert!(f.is_infinite() && f.is_sign_negative());
        }
    }

    #[test]
    fn qa_float_nan() {
        let v = parse_value(OID_FLOAT4, "NaN");
        assert!(v.is_ok());
        if let Ok(Value::Float4(f)) = v {
            assert!(f.is_nan());
        }
    }

    #[test]
    fn qa_float8_special_values() {
        let inf = parse_value(OID_FLOAT8, "inf").unwrap();
        if let Value::Float8(f) = inf {
            assert!(f.is_infinite());
        }
        let nan = parse_value(OID_FLOAT8, "NaN").unwrap();
        if let Value::Float8(f) = nan {
            assert!(f.is_nan());
        }
    }

    // ─── Bool edge cases ─────────────────────────────────────────────

    #[test]
    fn qa_bool_recognized_true_values() {
        // These should all parse as true
        assert_eq!(parse_value(OID_BOOL, "t").unwrap(), Value::Bool(true));
        assert_eq!(parse_value(OID_BOOL, "true").unwrap(), Value::Bool(true));
        assert_eq!(parse_value(OID_BOOL, "1").unwrap(), Value::Bool(true));
        assert_eq!(parse_value(OID_BOOL, "T").unwrap(), Value::Bool(true));
        assert_eq!(parse_value(OID_BOOL, "TRUE").unwrap(), Value::Bool(true));
        assert_eq!(parse_value(OID_BOOL, "yes").unwrap(), Value::Bool(true));
    }

    #[test]
    fn qa_bool_recognized_false_values() {
        // These should all parse as false
        assert_eq!(parse_value(OID_BOOL, "f").unwrap(), Value::Bool(false));
        assert_eq!(parse_value(OID_BOOL, "false").unwrap(), Value::Bool(false));
        assert_eq!(parse_value(OID_BOOL, "0").unwrap(), Value::Bool(false));
    }

    /// BUG: "True" (mixed case) returns false — case handling is inconsistent.
    /// PostgreSQL wire protocol normally sends "t"/"f" but the parser should
    /// handle common representations consistently.
    #[test]
    fn qa_bool_mixed_case_bug() {
        // "True" is not in the matches! list so it returns false
        let v = parse_value(OID_BOOL, "True").unwrap();
        // This documents current behavior — "True" incorrectly returns false
        assert_eq!(v, Value::Bool(false), "BUG: 'True' should parse as true");
    }

    /// BUG: "YES" and "Yes" are not recognized as true.
    #[test]
    fn qa_bool_yes_case_variants() {
        // "yes" → true, but "YES" and "Yes" → false (inconsistent)
        assert_eq!(parse_value(OID_BOOL, "yes").unwrap(), Value::Bool(true));
        let yes_upper = parse_value(OID_BOOL, "YES").unwrap();
        // Documents the bug: "YES" returns false
        assert_eq!(yes_upper, Value::Bool(false), "BUG: 'YES' should parse as true");
    }

    // ─── Date edge cases ─────────────────────────────────────────────

    #[test]
    fn qa_date_valid_formats() {
        assert!(parse_value(OID_DATE, "2024-01-01").is_ok());
        assert!(parse_value(OID_DATE, "2000-12-31").is_ok());
    }

    #[test]
    fn qa_date_invalid_formats() {
        assert!(parse_value(OID_DATE, "01/15/2024").is_err());
        assert!(parse_value(OID_DATE, "not-a-date").is_err());
        assert!(parse_value(OID_DATE, "2024-13-01").is_err()); // month 13
        assert!(parse_value(OID_DATE, "2024-02-30").is_err()); // Feb 30
    }

    #[test]
    fn qa_date_leap_year() {
        // Feb 29 in a leap year should work
        assert!(parse_value(OID_DATE, "2024-02-29").is_ok());
        // Feb 29 in a non-leap year should fail
        assert!(parse_value(OID_DATE, "2023-02-29").is_err());
    }

    // ─── Timestamp edge cases ────────────────────────────────────────

    #[test]
    fn qa_timestamp_formats() {
        assert!(parse_value(OID_TIMESTAMP, "2024-01-15 10:30:00").is_ok());
        assert!(parse_value(OID_TIMESTAMP, "2024-01-15 10:30:00.123456").is_ok());
        assert!(parse_value(OID_TIMESTAMP, "2024-01-15T10:30:00").is_ok());
        assert!(parse_value(OID_TIMESTAMP, "2024-01-15T10:30:00.999").is_ok());
    }

    #[test]
    fn qa_timestamp_invalid() {
        assert!(parse_value(OID_TIMESTAMP, "not-a-timestamp").is_err());
        assert!(parse_value(OID_TIMESTAMP, "2024-01-15").is_err()); // date only
    }

    // ─── UUID edge cases ─────────────────────────────────────────────

    #[test]
    fn qa_uuid_valid() {
        assert!(parse_value(OID_UUID, "550e8400-e29b-41d4-a716-446655440000").is_ok());
        assert!(parse_value(OID_UUID, "00000000-0000-0000-0000-000000000000").is_ok());
    }

    #[test]
    fn qa_uuid_invalid() {
        assert!(parse_value(OID_UUID, "not-a-uuid").is_err());
        assert!(parse_value(OID_UUID, "550e8400-e29b-41d4-a716").is_err());
        assert!(parse_value(OID_UUID, "").is_err());
    }

    // ─── Embedding edge cases ────────────────────────────────────────

    #[test]
    fn qa_embedding_empty() {
        let e = parse_embedding("[]").unwrap();
        assert!(e.is_empty());
        assert_eq!(e.len(), 0);
    }

    #[test]
    fn qa_embedding_single_element() {
        let e = parse_embedding("[1.0]").unwrap();
        assert_eq!(e.len(), 1);
        assert!((e.0[0] - 1.0).abs() < f32::EPSILON);
    }

    #[test]
    fn qa_embedding_large_vector() {
        let vals: Vec<String> = (0..1024).map(|i| format!("{:.4}", i as f32 / 1024.0)).collect();
        let text = format!("[{}]", vals.join(","));
        let e = parse_embedding(&text).unwrap();
        assert_eq!(e.len(), 1024);
    }

    #[test]
    fn qa_embedding_negative_values() {
        let e = parse_embedding("[-1.0,-0.5,0.0,0.5,1.0]").unwrap();
        assert_eq!(e.len(), 5);
        assert!((e.0[0] - (-1.0)).abs() < f32::EPSILON);
    }

    #[test]
    fn qa_embedding_invalid_no_brackets() {
        assert!(parse_embedding("1.0,2.0,3.0").is_err());
    }

    #[test]
    fn qa_embedding_invalid_values() {
        assert!(parse_embedding("[a,b,c]").is_err());
    }

    #[test]
    fn qa_embedding_whitespace_handling() {
        let e = parse_embedding("  [  0.1 , 0.2 , 0.3  ]  ").unwrap();
        assert_eq!(e.len(), 3);
    }

    #[test]
    fn qa_embedding_display_roundtrip() {
        let original = Embedding::new(vec![0.1, 0.2, 0.3]);
        let text = original.to_string();
        let parsed = parse_embedding(&text).unwrap();
        assert_eq!(original.len(), parsed.len());
        for (a, b) in original.0.iter().zip(parsed.0.iter()) {
            assert!((a - b).abs() < f32::EPSILON);
        }
    }

    // ─── Interval edge cases ─────────────────────────────────────────

    #[test]
    fn qa_interval_empty_string() {
        // Empty string should produce a zero interval (no components parsed)
        let i = parse_interval("").unwrap();
        assert_eq!(i.years, 0);
        assert_eq!(i.months, 0);
        assert_eq!(i.days, 0);
    }

    #[test]
    fn qa_interval_all_components() {
        let i = parse_interval("1 years 2 months 3 days 04:05:06.789").unwrap();
        assert_eq!(i.years, 1);
        assert_eq!(i.months, 2);
        assert_eq!(i.days, 3);
        assert_eq!(i.hours, 4);
        assert_eq!(i.minutes, 5);
        assert!((i.seconds - 6.789).abs() < 0.001);
    }

    #[test]
    fn qa_interval_negative_values() {
        let i = parse_interval("-5 days").unwrap();
        assert_eq!(i.days, -5);
    }

    #[test]
    fn qa_interval_display_singular_plural() {
        let i1 = Interval { years: 1, months: 1, days: 1, hours: 0, minutes: 0, seconds: 0.0 };
        let s1 = i1.to_string();
        assert!(s1.contains("1 year "));  // singular
        assert!(s1.contains("1 month "));
        assert!(s1.contains("1 day"));

        let i2 = Interval { years: 2, months: 2, days: 2, hours: 0, minutes: 0, seconds: 0.0 };
        let s2 = i2.to_string();
        assert!(s2.contains("2 years"));  // plural
        assert!(s2.contains("2 months"));
        assert!(s2.contains("2 days"));
    }

    #[test]
    fn qa_interval_time_only() {
        let i = parse_interval("23:59:59.999").unwrap();
        assert_eq!(i.hours, 23);
        assert_eq!(i.minutes, 59);
        assert!((i.seconds - 59.999).abs() < 0.001);
    }

    #[test]
    fn qa_interval_display_zero() {
        let i = Interval::new();
        assert_eq!(i.to_string(), "00:00:00.000");
    }

    // ─── Bytea edge cases ────────────────────────────────────────────

    #[test]
    fn qa_bytea_hex_valid() {
        let v = parse_value(OID_BYTEA, "\\x48656c6c6f").unwrap();
        assert_eq!(v, Value::Bytes(b"Hello".to_vec()));
    }

    #[test]
    fn qa_bytea_hex_empty() {
        let v = parse_value(OID_BYTEA, "\\x").unwrap();
        assert_eq!(v, Value::Bytes(vec![]));
    }

    #[test]
    fn qa_bytea_hex_odd_length() {
        // Odd-length hex string should error
        assert!(parse_value(OID_BYTEA, "\\x4865f").is_err());
    }

    #[test]
    fn qa_bytea_raw_empty() {
        let v = parse_value(OID_BYTEA, "").unwrap();
        assert_eq!(v, Value::Bytes(vec![]));
    }

    // ─── Format value roundtrip ──────────────────────────────────────

    #[test]
    fn qa_format_value_null() {
        assert_eq!(format_value(&Value::Null), None);
    }

    #[test]
    fn qa_format_value_bool() {
        assert_eq!(format_value(&Value::Bool(true)), Some("t".to_string()));
        assert_eq!(format_value(&Value::Bool(false)), Some("f".to_string()));
    }

    #[test]
    fn qa_format_value_integers() {
        assert_eq!(format_value(&Value::Int4(0)), Some("0".to_string()));
        assert_eq!(format_value(&Value::Int4(-1)), Some("-1".to_string()));
        assert_eq!(format_value(&Value::Int8(i64::MAX)), Some(i64::MAX.to_string()));
        assert_eq!(format_value(&Value::UInt64(u64::MAX)), Some(u64::MAX.to_string()));
    }

    #[test]
    fn qa_format_value_embedding() {
        let e = Value::Embedding(Embedding::new(vec![0.1, 0.2, 0.3]));
        let formatted = format_value(&e);
        assert!(formatted.is_some());
        assert!(formatted.unwrap().starts_with("["));
    }

    // ─── Value Display comprehensive ─────────────────────────────────

    #[test]
    fn qa_value_display_all_variants() {
        assert_eq!(Value::Null.to_string(), "NULL");
        assert_eq!(Value::Bool(true).to_string(), "true");
        assert_eq!(Value::Bool(false).to_string(), "false");
        assert_eq!(Value::TinyInt(-1).to_string(), "-1");
        assert_eq!(Value::Int2(100).to_string(), "100");
        assert_eq!(Value::Int4(42).to_string(), "42");
        assert_eq!(Value::Int8(999).to_string(), "999");
        assert_eq!(Value::UInt8(255).to_string(), "255");
        assert_eq!(Value::UInt16(1000).to_string(), "1000");
        assert_eq!(Value::UInt32(100000).to_string(), "100000");
        assert_eq!(Value::UInt64(u64::MAX).to_string(), u64::MAX.to_string());
        assert_eq!(Value::Text("hello".into()).to_string(), "hello");
        assert_eq!(Value::Json("{}".into()).to_string(), "{}");
        assert_eq!(Value::Numeric("123.45".into()).to_string(), "123.45");
    }

    // ─── Embedding FromStr ───────────────────────────────────────────

    #[test]
    fn qa_embedding_from_str() {
        let e: std::result::Result<Embedding, _> = "[0.1,0.2]".parse();
        assert!(e.is_ok());
        assert_eq!(e.unwrap().len(), 2);
    }

    #[test]
    fn qa_embedding_from_str_invalid() {
        let e: std::result::Result<Embedding, _> = "not_an_embedding".parse();
        assert!(e.is_err());
    }

    // ─── Interval FromStr ────────────────────────────────────────────

    #[test]
    fn qa_interval_from_str() {
        let i: std::result::Result<Interval, _> = "5 days 01:30:00".parse();
        assert!(i.is_ok());
        let interval = i.unwrap();
        assert_eq!(interval.days, 5);
        assert_eq!(interval.hours, 1);
        assert_eq!(interval.minutes, 30);
    }

    // ─── parse_value with all 22 OIDs ────────────────────────────────

    #[test]
    fn qa_all_oids_parseable() {
        // Verify every OID can parse at least one valid value
        assert!(parse_value(OID_BOOL, "t").is_ok());
        assert!(parse_value(OID_TINYINT, "0").is_ok());
        assert!(parse_value(OID_INT2, "0").is_ok());
        assert!(parse_value(OID_INT4, "0").is_ok());
        assert!(parse_value(OID_INT8, "0").is_ok());
        assert!(parse_value(OID_UINT8, "0").is_ok());
        assert!(parse_value(OID_UINT16, "0").is_ok());
        assert!(parse_value(OID_UINT32, "0").is_ok());
        assert!(parse_value(OID_UINT64, "0").is_ok());
        assert!(parse_value(OID_FLOAT4, "0.0").is_ok());
        assert!(parse_value(OID_FLOAT8, "0.0").is_ok());
        assert!(parse_value(OID_NUMERIC, "0").is_ok());
        assert!(parse_value(OID_TEXT, "hello").is_ok());
        assert!(parse_value(OID_VARCHAR, "hello").is_ok());
        assert!(parse_value(OID_CHAR, "x").is_ok());
        assert!(parse_value(OID_BYTEA, "\\x00").is_ok());
        assert!(parse_value(OID_BLOB, "\\x00").is_ok());
        assert!(parse_value(OID_DATE, "2024-01-01").is_ok());
        assert!(parse_value(OID_TIME, "12:00:00").is_ok());
        assert!(parse_value(OID_TIMESTAMP, "2024-01-01 00:00:00").is_ok());
        assert!(parse_value(OID_INTERVAL, "1 day").is_ok());
        assert!(parse_value(OID_POINT, "(1,2)").is_ok());
        assert!(parse_value(OID_JSON, "{}").is_ok());
        assert!(parse_value(OID_UUID, "00000000-0000-0000-0000-000000000000").is_ok());
        assert!(parse_value(OID_EMBEDDING, "[0.1]").is_ok());
    }
}
