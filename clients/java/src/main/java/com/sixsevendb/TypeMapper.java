package com.sixsevendb;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.sql.Date;
import java.sql.Time;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.UUID;

/**
 * Maps SixSevenDB type OIDs to Java objects when parsing text-format values.
 */
final class TypeMapper {

    private static final DateTimeFormatter[] TIMESTAMP_FORMATS = {
        DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"),
        DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss"),
        DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss.SSSSSS"),
        DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSSSSS"),
        DateTimeFormatter.ISO_LOCAL_DATE_TIME,
    };

    private TypeMapper() {}

    /**
     * Parses a text-format value based on its type OID.
     * Returns a Java object suitable for ResultSet.getObject().
     */
    static Object parseValue(int typeOID, String value) {
        if (value == null) return null;
        switch (typeOID) {
            case TypeOID.BOOL:
                return parseBool(value);
            case TypeOID.TINYINT:
                return Byte.parseByte(value);
            case TypeOID.INT2:
                return Short.parseShort(value);
            case TypeOID.INT4:
                return Integer.parseInt(value);
            case TypeOID.INT8:
                return Long.parseLong(value);
            case TypeOID.UINT8:
                return (short) (Integer.parseInt(value) & 0xFF);
            case TypeOID.UINT16:
                return Integer.parseInt(value);
            case TypeOID.UINT32:
                return Long.parseLong(value);
            case TypeOID.UINT64:
                return Long.parseUnsignedLong(value);
            case TypeOID.FLOAT4:
                return Float.parseFloat(value);
            case TypeOID.FLOAT8:
                return Double.parseDouble(value);
            case TypeOID.NUMERIC:
                return new BigDecimal(value);
            case TypeOID.TEXT:
            case TypeOID.VARCHAR:
            case TypeOID.CHAR:
                return value;
            case TypeOID.BYTEA:
            case TypeOID.BLOB:
                return parseBytea(value);
            case TypeOID.DATE:
                return Date.valueOf(LocalDate.parse(value));
            case TypeOID.TIME:
                return Time.valueOf(LocalTime.parse(value));
            case TypeOID.TIMESTAMP:
                return parseTimestamp(value);
            case TypeOID.INTERVAL:
                return Interval.parse(value);
            case TypeOID.JSON:
                return value; // Return JSON as String
            case TypeOID.UUID:
                return UUID.fromString(value);
            case TypeOID.EMBEDDING:
                return Embedding.parse(value);
            default:
                return value;
        }
    }

    /**
     * Returns the Java class for a given type OID.
     */
    static Class<?> javaClass(int typeOID) {
        switch (typeOID) {
            case TypeOID.BOOL: return Boolean.class;
            case TypeOID.TINYINT: return Byte.class;
            case TypeOID.INT2: return Short.class;
            case TypeOID.INT4: return Integer.class;
            case TypeOID.INT8: return Long.class;
            case TypeOID.UINT8: return Short.class;
            case TypeOID.UINT16: return Integer.class;
            case TypeOID.UINT32: return Long.class;
            case TypeOID.UINT64: return Long.class;
            case TypeOID.FLOAT4: return Float.class;
            case TypeOID.FLOAT8: return Double.class;
            case TypeOID.NUMERIC: return BigDecimal.class;
            case TypeOID.TEXT:
            case TypeOID.VARCHAR:
            case TypeOID.CHAR: return String.class;
            case TypeOID.BYTEA:
            case TypeOID.BLOB: return byte[].class;
            case TypeOID.DATE: return Date.class;
            case TypeOID.TIME: return Time.class;
            case TypeOID.TIMESTAMP: return Timestamp.class;
            case TypeOID.INTERVAL: return Interval.class;
            case TypeOID.JSON: return String.class;
            case TypeOID.UUID: return UUID.class;
            case TypeOID.EMBEDDING: return Embedding.class;
            default: return String.class;
        }
    }

    private static boolean parseBool(String s) {
        switch (s.toLowerCase()) {
            case "t":
            case "true":
            case "1":
                return true;
            default:
                return false;
        }
    }

    private static byte[] parseBytea(String s) {
        if (s.startsWith("\\x")) {
            int len = (s.length() - 2) / 2;
            byte[] result = new byte[len];
            for (int i = 0; i < len; i++) {
                result[i] = (byte) Integer.parseInt(s.substring(2 + i * 2, 4 + i * 2), 16);
            }
            return result;
        }
        return s.getBytes(StandardCharsets.UTF_8);
    }

    private static Timestamp parseTimestamp(String s) {
        for (DateTimeFormatter fmt : TIMESTAMP_FORMATS) {
            try {
                LocalDateTime ldt = LocalDateTime.parse(s, fmt);
                return Timestamp.valueOf(ldt);
            } catch (DateTimeParseException ignored) {}
        }
        // Fallback: try Timestamp.valueOf directly
        return Timestamp.valueOf(s);
    }
}
