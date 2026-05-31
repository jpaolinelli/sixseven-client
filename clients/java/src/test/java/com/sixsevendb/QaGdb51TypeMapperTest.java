package com.sixsevendb;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.DisplayName;

import java.math.BigDecimal;
import java.sql.Date;
import java.sql.Time;
import java.sql.Timestamp;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

/**
 * QA adversarial tests for TypeMapper — GDB-51.
 * Targets edge cases, boundary values, null handling, and error paths.
 */
class QaGdb51TypeMapperTest {

    // === Null and empty handling ===

    @Test
    @DisplayName("parseValue returns null for null input regardless of typeOID")
    void parseValueNullInput() {
        assertNull(TypeMapper.parseValue(TypeOID.INT4, null));
        assertNull(TypeMapper.parseValue(TypeOID.TEXT, null));
        assertNull(TypeMapper.parseValue(TypeOID.BOOL, null));
        assertNull(TypeMapper.parseValue(TypeOID.EMBEDDING, null));
        assertNull(TypeMapper.parseValue(TypeOID.UUID, null));
        assertNull(TypeMapper.parseValue(TypeOID.DATE, null));
    }

    @Test
    @DisplayName("parseValue for empty string throws for numeric types")
    void parseValueEmptyStringNumeric() {
        // Numeric types should fail on empty string, not silently return 0
        assertThrows(NumberFormatException.class, () -> TypeMapper.parseValue(TypeOID.INT4, ""));
        assertThrows(NumberFormatException.class, () -> TypeMapper.parseValue(TypeOID.INT8, ""));
        assertThrows(NumberFormatException.class, () -> TypeMapper.parseValue(TypeOID.FLOAT4, ""));
        assertThrows(NumberFormatException.class, () -> TypeMapper.parseValue(TypeOID.FLOAT8, ""));
        assertThrows(NumberFormatException.class, () -> TypeMapper.parseValue(TypeOID.INT2, ""));
        assertThrows(NumberFormatException.class, () -> TypeMapper.parseValue(TypeOID.TINYINT, ""));
    }

    @Test
    @DisplayName("parseValue for empty string on TEXT/VARCHAR/CHAR returns empty string")
    void parseValueEmptyStringText() {
        assertEquals("", TypeMapper.parseValue(TypeOID.TEXT, ""));
        assertEquals("", TypeMapper.parseValue(TypeOID.VARCHAR, ""));
        assertEquals("", TypeMapper.parseValue(TypeOID.CHAR, ""));
    }

    // === Integer boundary values ===

    @Test
    @DisplayName("INT4 handles Integer.MAX_VALUE and Integer.MIN_VALUE")
    void int4BoundaryValues() {
        assertEquals(Integer.MAX_VALUE, TypeMapper.parseValue(TypeOID.INT4, "2147483647"));
        assertEquals(Integer.MIN_VALUE, TypeMapper.parseValue(TypeOID.INT4, "-2147483648"));
    }

    @Test
    @DisplayName("INT4 overflow throws NumberFormatException")
    void int4Overflow() {
        assertThrows(NumberFormatException.class,
            () -> TypeMapper.parseValue(TypeOID.INT4, "2147483648")); // MAX_VALUE + 1
        assertThrows(NumberFormatException.class,
            () -> TypeMapper.parseValue(TypeOID.INT4, "-2147483649")); // MIN_VALUE - 1
    }

    @Test
    @DisplayName("INT8 handles Long.MAX_VALUE and Long.MIN_VALUE")
    void int8BoundaryValues() {
        assertEquals(Long.MAX_VALUE, TypeMapper.parseValue(TypeOID.INT8, "9223372036854775807"));
        assertEquals(Long.MIN_VALUE, TypeMapper.parseValue(TypeOID.INT8, "-9223372036854775808"));
    }

    @Test
    @DisplayName("TINYINT handles Byte.MAX_VALUE and Byte.MIN_VALUE")
    void tinyintBoundaryValues() {
        assertEquals((byte) 127, TypeMapper.parseValue(TypeOID.TINYINT, "127"));
        assertEquals((byte) -128, TypeMapper.parseValue(TypeOID.TINYINT, "-128"));
    }

    @Test
    @DisplayName("TINYINT overflow throws NumberFormatException")
    void tinyintOverflow() {
        assertThrows(NumberFormatException.class,
            () -> TypeMapper.parseValue(TypeOID.TINYINT, "128"));
        assertThrows(NumberFormatException.class,
            () -> TypeMapper.parseValue(TypeOID.TINYINT, "-129"));
    }

    @Test
    @DisplayName("INT2 handles Short.MAX_VALUE and Short.MIN_VALUE")
    void int2BoundaryValues() {
        assertEquals((short) 32767, TypeMapper.parseValue(TypeOID.INT2, "32767"));
        assertEquals((short) -32768, TypeMapper.parseValue(TypeOID.INT2, "-32768"));
    }

    // === Unsigned integer edge cases ===

    @Test
    @DisplayName("UINT8 maps 0 and 255 correctly")
    void uint8BoundaryValues() {
        assertEquals((short) 0, TypeMapper.parseValue(TypeOID.UINT8, "0"));
        assertEquals((short) 255, TypeMapper.parseValue(TypeOID.UINT8, "255"));
    }

    @Test
    @DisplayName("UINT64 handles max unsigned long value")
    void uint64MaxValue() {
        // 18446744073709551615 = 2^64 - 1
        Object result = TypeMapper.parseValue(TypeOID.UINT64, "18446744073709551615");
        assertNotNull(result);
        // Long.parseUnsignedLong should handle this — result is -1 as a signed long
        assertEquals(-1L, result);
    }

    @Test
    @DisplayName("UINT32 handles max unsigned 32-bit value")
    void uint32MaxValue() {
        assertEquals(4294967295L, TypeMapper.parseValue(TypeOID.UINT32, "4294967295"));
    }

    // === Float edge cases ===

    @Test
    @DisplayName("FLOAT4 handles special values: NaN, Infinity, -Infinity")
    void float4SpecialValues() {
        assertEquals(Float.NaN, TypeMapper.parseValue(TypeOID.FLOAT4, "NaN"));
        assertEquals(Float.POSITIVE_INFINITY, TypeMapper.parseValue(TypeOID.FLOAT4, "Infinity"));
        assertEquals(Float.NEGATIVE_INFINITY, TypeMapper.parseValue(TypeOID.FLOAT4, "-Infinity"));
    }

    @Test
    @DisplayName("FLOAT8 handles special values: NaN, Infinity, -Infinity")
    void float8SpecialValues() {
        assertEquals(Double.NaN, TypeMapper.parseValue(TypeOID.FLOAT8, "NaN"));
        assertEquals(Double.POSITIVE_INFINITY, TypeMapper.parseValue(TypeOID.FLOAT8, "Infinity"));
        assertEquals(Double.NEGATIVE_INFINITY, TypeMapper.parseValue(TypeOID.FLOAT8, "-Infinity"));
    }

    @Test
    @DisplayName("NUMERIC handles very large BigDecimal values")
    void numericLargeValues() {
        Object result = TypeMapper.parseValue(TypeOID.NUMERIC,
            "99999999999999999999999999999999999999.99999999999999999999");
        assertInstanceOf(BigDecimal.class, result);
    }

    @Test
    @DisplayName("NUMERIC handles negative values and zero")
    void numericEdgeValues() {
        assertEquals(BigDecimal.ZERO, TypeMapper.parseValue(TypeOID.NUMERIC, "0"));
        assertEquals(new BigDecimal("-1.5"), TypeMapper.parseValue(TypeOID.NUMERIC, "-1.5"));
    }

    // === Boolean edge cases ===

    @Test
    @DisplayName("BOOL parses all truthy values correctly")
    void boolTruthyValues() {
        assertEquals(true, TypeMapper.parseValue(TypeOID.BOOL, "t"));
        assertEquals(true, TypeMapper.parseValue(TypeOID.BOOL, "true"));
        assertEquals(true, TypeMapper.parseValue(TypeOID.BOOL, "1"));
    }

    @Test
    @DisplayName("BOOL treats unexpected strings as false")
    void boolFalsyValues() {
        assertEquals(false, TypeMapper.parseValue(TypeOID.BOOL, "f"));
        assertEquals(false, TypeMapper.parseValue(TypeOID.BOOL, "false"));
        assertEquals(false, TypeMapper.parseValue(TypeOID.BOOL, "0"));
        assertEquals(false, TypeMapper.parseValue(TypeOID.BOOL, ""));
        assertEquals(false, TypeMapper.parseValue(TypeOID.BOOL, "yes"));
        assertEquals(false, TypeMapper.parseValue(TypeOID.BOOL, "no"));
        assertEquals(false, TypeMapper.parseValue(TypeOID.BOOL, "random"));
    }

    // === Date/Time edge cases ===

    @Test
    @DisplayName("DATE parses standard date format")
    void dateStandardFormat() {
        Object result = TypeMapper.parseValue(TypeOID.DATE, "2024-01-01");
        assertInstanceOf(Date.class, result);
    }

    @Test
    @DisplayName("DATE throws on invalid format")
    void dateInvalidFormat() {
        assertThrows(Exception.class, () -> TypeMapper.parseValue(TypeOID.DATE, "not-a-date"));
    }

    @Test
    @DisplayName("TIME parses standard time format")
    void timeStandardFormat() {
        Object result = TypeMapper.parseValue(TypeOID.TIME, "12:30:45");
        assertInstanceOf(Time.class, result);
    }

    @Test
    @DisplayName("TIMESTAMP handles multiple formats")
    void timestampFormats() {
        Object r1 = TypeMapper.parseValue(TypeOID.TIMESTAMP, "2024-01-15 10:30:00");
        assertInstanceOf(Timestamp.class, r1);

        Object r2 = TypeMapper.parseValue(TypeOID.TIMESTAMP, "2024-01-15T10:30:00");
        assertInstanceOf(Timestamp.class, r2);

        Object r3 = TypeMapper.parseValue(TypeOID.TIMESTAMP, "2024-01-15 10:30:00.123456");
        assertInstanceOf(Timestamp.class, r3);
    }

    @Test
    @DisplayName("TIMESTAMP throws on completely invalid format")
    void timestampInvalidFormat() {
        assertThrows(Exception.class,
            () -> TypeMapper.parseValue(TypeOID.TIMESTAMP, "not-a-timestamp"));
    }

    // === UUID edge cases ===

    @Test
    @DisplayName("UUID parses valid UUID")
    void uuidValidParse() {
        UUID expected = UUID.fromString("550e8400-e29b-41d4-a716-446655440000");
        assertEquals(expected, TypeMapper.parseValue(TypeOID.UUID, "550e8400-e29b-41d4-a716-446655440000"));
    }

    @Test
    @DisplayName("UUID throws on invalid format")
    void uuidInvalidFormat() {
        assertThrows(IllegalArgumentException.class,
            () -> TypeMapper.parseValue(TypeOID.UUID, "not-a-uuid"));
    }

    // === Bytea edge cases ===

    @Test
    @DisplayName("BYTEA parses hex format correctly")
    void byteaHexFormat() {
        byte[] result = (byte[]) TypeMapper.parseValue(TypeOID.BYTEA, "\\x48656c6c6f");
        assertArrayEquals(new byte[]{'H', 'e', 'l', 'l', 'o'}, result);
    }

    @Test
    @DisplayName("BYTEA parses non-hex as raw bytes")
    void byteaNonHexFallback() {
        byte[] result = (byte[]) TypeMapper.parseValue(TypeOID.BYTEA, "hello");
        assertEquals("hello", new String(result, java.nio.charset.StandardCharsets.UTF_8));
    }

    @Test
    @DisplayName("BYTEA handles empty hex format")
    void byteaEmptyHex() {
        byte[] result = (byte[]) TypeMapper.parseValue(TypeOID.BYTEA, "\\x");
        assertEquals(0, result.length);
    }

    @Test
    @DisplayName("BUG: BYTEA hex with odd number of chars silently truncates last nibble")
    void byteaOddHexChars() {
        // "\\xABC" has 3 hex chars. Integer division: (5-2)/2 = 1
        // Only parses "AB" and silently drops "C" — silent data loss
        byte[] result = (byte[]) TypeMapper.parseValue(TypeOID.BYTEA, "\\xABC");
        // Only 1 byte parsed (0xAB), the trailing 'C' nibble is lost
        assertEquals(1, result.length);
        assertEquals((byte) 0xAB, result[0]);
    }

    // === Embedding edge cases ===

    @Test
    @DisplayName("EMBEDDING parses valid vector")
    void embeddingValid() {
        Embedding result = (Embedding) TypeMapper.parseValue(TypeOID.EMBEDDING, "[0.1,0.2,0.3]");
        assertEquals(3, result.dimensions());
    }

    @Test
    @DisplayName("EMBEDDING returns empty for null")
    void embeddingNull() {
        assertNull(TypeMapper.parseValue(TypeOID.EMBEDDING, null));
    }

    // === Unknown type OID ===

    @Test
    @DisplayName("Unknown type OID returns raw string")
    void unknownTypeReturnsRawString() {
        assertEquals("some_value", TypeMapper.parseValue(999999, "some_value"));
    }

    // === javaClass mapping ===

    @Test
    @DisplayName("javaClass returns correct types for all known OIDs")
    void javaClassMappings() {
        assertEquals(Boolean.class, TypeMapper.javaClass(TypeOID.BOOL));
        assertEquals(Byte.class, TypeMapper.javaClass(TypeOID.TINYINT));
        assertEquals(Short.class, TypeMapper.javaClass(TypeOID.INT2));
        assertEquals(Integer.class, TypeMapper.javaClass(TypeOID.INT4));
        assertEquals(Long.class, TypeMapper.javaClass(TypeOID.INT8));
        assertEquals(Short.class, TypeMapper.javaClass(TypeOID.UINT8));
        assertEquals(Integer.class, TypeMapper.javaClass(TypeOID.UINT16));
        assertEquals(Long.class, TypeMapper.javaClass(TypeOID.UINT32));
        assertEquals(Long.class, TypeMapper.javaClass(TypeOID.UINT64));
        assertEquals(Float.class, TypeMapper.javaClass(TypeOID.FLOAT4));
        assertEquals(Double.class, TypeMapper.javaClass(TypeOID.FLOAT8));
        assertEquals(BigDecimal.class, TypeMapper.javaClass(TypeOID.NUMERIC));
        assertEquals(String.class, TypeMapper.javaClass(TypeOID.TEXT));
        assertEquals(byte[].class, TypeMapper.javaClass(TypeOID.BYTEA));
        assertEquals(Date.class, TypeMapper.javaClass(TypeOID.DATE));
        assertEquals(Time.class, TypeMapper.javaClass(TypeOID.TIME));
        assertEquals(Timestamp.class, TypeMapper.javaClass(TypeOID.TIMESTAMP));
        assertEquals(Interval.class, TypeMapper.javaClass(TypeOID.INTERVAL));
        assertEquals(UUID.class, TypeMapper.javaClass(TypeOID.UUID));
        assertEquals(Embedding.class, TypeMapper.javaClass(TypeOID.EMBEDDING));
    }

    @Test
    @DisplayName("javaClass returns String.class for unknown OID")
    void javaClassUnknownOID() {
        assertEquals(String.class, TypeMapper.javaClass(999999));
    }
}
