package com.sixsevendb;

import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.sql.Date;
import java.sql.Time;
import java.sql.Timestamp;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

class TypeMapperTest {

    @Test
    void testParseBool() {
        assertEquals(true, TypeMapper.parseValue(TypeOID.BOOL, "t"));
        assertEquals(true, TypeMapper.parseValue(TypeOID.BOOL, "true"));
        assertEquals(true, TypeMapper.parseValue(TypeOID.BOOL, "1"));
        assertEquals(false, TypeMapper.parseValue(TypeOID.BOOL, "f"));
        assertEquals(false, TypeMapper.parseValue(TypeOID.BOOL, "false"));
    }

    @Test
    void testParseIntegers() {
        assertEquals((byte) 42, TypeMapper.parseValue(TypeOID.TINYINT, "42"));
        assertEquals((short) 100, TypeMapper.parseValue(TypeOID.INT2, "100"));
        assertEquals(12345, TypeMapper.parseValue(TypeOID.INT4, "12345"));
        assertEquals(9999999999L, TypeMapper.parseValue(TypeOID.INT8, "9999999999"));
    }

    @Test
    void testParseUnsignedIntegers() {
        assertEquals((short) 255, TypeMapper.parseValue(TypeOID.UINT8, "255"));
        assertEquals(65535, TypeMapper.parseValue(TypeOID.UINT16, "65535"));
        assertEquals(4294967295L, TypeMapper.parseValue(TypeOID.UINT32, "4294967295"));
    }

    @Test
    void testParseFloats() {
        assertEquals(3.14f, TypeMapper.parseValue(TypeOID.FLOAT4, "3.14"));
        assertEquals(2.718281828, TypeMapper.parseValue(TypeOID.FLOAT8, "2.718281828"));
    }

    @Test
    void testParseNumeric() {
        Object result = TypeMapper.parseValue(TypeOID.NUMERIC, "123456.789");
        assertInstanceOf(BigDecimal.class, result);
        assertEquals(new BigDecimal("123456.789"), result);
    }

    @Test
    void testParseText() {
        assertEquals("hello", TypeMapper.parseValue(TypeOID.TEXT, "hello"));
        assertEquals("world", TypeMapper.parseValue(TypeOID.VARCHAR, "world"));
        assertEquals("c", TypeMapper.parseValue(TypeOID.CHAR, "c"));
    }

    @Test
    void testParseBytea() {
        byte[] result = (byte[]) TypeMapper.parseValue(TypeOID.BYTEA, "\\x48656C6C6F");
        assertNotNull(result);
        assertEquals("Hello", new String(result));
    }

    @Test
    void testParseDate() {
        Object result = TypeMapper.parseValue(TypeOID.DATE, "2024-01-15");
        assertInstanceOf(Date.class, result);
    }

    @Test
    void testParseTime() {
        Object result = TypeMapper.parseValue(TypeOID.TIME, "14:30:00");
        assertInstanceOf(Time.class, result);
    }

    @Test
    void testParseTimestamp() {
        Object result = TypeMapper.parseValue(TypeOID.TIMESTAMP, "2024-01-15 14:30:00");
        assertInstanceOf(Timestamp.class, result);
    }

    @Test
    void testParseUUID() {
        Object result = TypeMapper.parseValue(TypeOID.UUID, "550e8400-e29b-41d4-a716-446655440000");
        assertInstanceOf(UUID.class, result);
        assertEquals(UUID.fromString("550e8400-e29b-41d4-a716-446655440000"), result);
    }

    @Test
    void testParseEmbedding() {
        Object result = TypeMapper.parseValue(TypeOID.EMBEDDING, "[0.1,0.2,0.3]");
        assertInstanceOf(Embedding.class, result);
        Embedding e = (Embedding) result;
        assertEquals(3, e.dimensions());
        assertArrayEquals(new float[]{0.1f, 0.2f, 0.3f}, e.getValues(), 0.001f);
    }

    @Test
    void testParseJSON() {
        Object result = TypeMapper.parseValue(TypeOID.JSON, "{\"key\":\"value\"}");
        assertEquals("{\"key\":\"value\"}", result);
    }

    @Test
    void testParseInterval() {
        Object result = TypeMapper.parseValue(TypeOID.INTERVAL, "01:30:00.000");
        assertInstanceOf(Interval.class, result);
        Interval iv = (Interval) result;
        assertEquals(1, iv.getHours());
        assertEquals(30, iv.getMinutes());
    }

    @Test
    void testParseNull() {
        assertNull(TypeMapper.parseValue(TypeOID.TEXT, null));
    }

    @Test
    void testJavaClass() {
        assertEquals(Boolean.class, TypeMapper.javaClass(TypeOID.BOOL));
        assertEquals(Integer.class, TypeMapper.javaClass(TypeOID.INT4));
        assertEquals(Long.class, TypeMapper.javaClass(TypeOID.INT8));
        assertEquals(Float.class, TypeMapper.javaClass(TypeOID.FLOAT4));
        assertEquals(Double.class, TypeMapper.javaClass(TypeOID.FLOAT8));
        assertEquals(BigDecimal.class, TypeMapper.javaClass(TypeOID.NUMERIC));
        assertEquals(String.class, TypeMapper.javaClass(TypeOID.TEXT));
        assertEquals(Date.class, TypeMapper.javaClass(TypeOID.DATE));
        assertEquals(UUID.class, TypeMapper.javaClass(TypeOID.UUID));
        assertEquals(Embedding.class, TypeMapper.javaClass(TypeOID.EMBEDDING));
    }
}
