package com.sixsevendb;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.DisplayName;

import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.SQLFeatureNotSupportedException;
import java.sql.Types;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * QA adversarial tests for SixSevenResultSet and related JDBC types — GDB-51.
 * Targets edge cases, null handling, boundary conditions, and error paths.
 */
class QaGdb51ResultSetTest {

    private List<Protocol.FieldDescription> singleIntField;
    private List<Protocol.FieldDescription> multiFields;

    @BeforeEach
    void setup() {
        singleIntField = Collections.singletonList(
            new Protocol.FieldDescription("id", 0, (short) 0, TypeOID.INT4,
                (short) 4, -1, (short) 0));

        multiFields = Arrays.asList(
            new Protocol.FieldDescription("id", 0, (short) 0, TypeOID.INT4,
                (short) 4, -1, (short) 0),
            new Protocol.FieldDescription("name", 0, (short) 1, TypeOID.TEXT,
                (short) -1, -1, (short) 0),
            new Protocol.FieldDescription("score", 0, (short) 2, TypeOID.FLOAT8,
                (short) 8, -1, (short) 0),
            new Protocol.FieldDescription("active", 0, (short) 3, TypeOID.BOOL,
                (short) 1, -1, (short) 0)
        );
    }

    private SixSevenResultSet createResultSet(List<Protocol.FieldDescription> fields,
                                               List<List<byte[]>> rows) {
        return new SixSevenResultSet(fields, rows);
    }

    private byte[] toBytes(String s) {
        return s.getBytes(StandardCharsets.UTF_8);
    }

    // === Navigation edge cases ===

    @Test
    @DisplayName("next() on empty result set returns false")
    void nextEmptyResultSet() throws SQLException {
        SixSevenResultSet rs = createResultSet(singleIntField, Collections.emptyList());
        assertFalse(rs.next());
    }

    @Test
    @DisplayName("Column access before calling next() throws SQLException")
    void accessBeforeNext() {
        List<List<byte[]>> rows = Collections.singletonList(
            Collections.singletonList(toBytes("42")));
        SixSevenResultSet rs = createResultSet(singleIntField, rows);
        // pos is -1 (before first), should throw
        assertThrows(SQLException.class, () -> rs.getString(1));
    }

    @Test
    @DisplayName("BUG: Column access after next() returns false still returns last row data")
    void accessAfterExhausted() throws SQLException {
        // JDBC spec: after next() returns false, cursor is past the last row
        // and column access should fail. But SixSevenResultSet keeps pos on last row.
        List<List<byte[]>> rows = Collections.singletonList(
            Collections.singletonList(toBytes("42")));
        SixSevenResultSet rs = createResultSet(singleIntField, rows);
        rs.next(); // move to first row, pos=0
        assertFalse(rs.next()); // returns false, but pos stays at 0 (BUG)
        // This should throw but doesn't — cursor is still on the last row
        assertEquals("42", rs.getString(1)); // BUG: succeeds when it should fail
    }

    @Test
    @DisplayName("Operations on closed ResultSet throw SQLException")
    void operationsOnClosedResultSet() throws SQLException {
        List<List<byte[]>> rows = Collections.singletonList(
            Collections.singletonList(toBytes("42")));
        SixSevenResultSet rs = createResultSet(singleIntField, rows);
        rs.close();
        assertTrue(rs.isClosed());
        assertThrows(SQLException.class, () -> rs.next());
        assertThrows(SQLException.class, () -> rs.getString(1));
    }

    // === Column index boundary ===

    @Test
    @DisplayName("Column index 0 throws SQLException (1-based indexing)")
    void columnIndexZero() throws SQLException {
        List<List<byte[]>> rows = Collections.singletonList(
            Collections.singletonList(toBytes("42")));
        SixSevenResultSet rs = createResultSet(singleIntField, rows);
        rs.next();
        assertThrows(SQLException.class, () -> rs.getString(0));
    }

    @Test
    @DisplayName("Column index beyond range throws SQLException")
    void columnIndexBeyondRange() throws SQLException {
        List<List<byte[]>> rows = Collections.singletonList(
            Collections.singletonList(toBytes("42")));
        SixSevenResultSet rs = createResultSet(singleIntField, rows);
        rs.next();
        assertThrows(SQLException.class, () -> rs.getString(2));
    }

    @Test
    @DisplayName("Negative column index throws SQLException")
    void columnIndexNegative() throws SQLException {
        List<List<byte[]>> rows = Collections.singletonList(
            Collections.singletonList(toBytes("42")));
        SixSevenResultSet rs = createResultSet(singleIntField, rows);
        rs.next();
        assertThrows(SQLException.class, () -> rs.getString(-1));
    }

    // === NULL handling ===

    @Test
    @DisplayName("wasNull() returns true after reading NULL column")
    void wasNullAfterNull() throws SQLException {
        List<List<byte[]>> rows = Collections.singletonList(
            Arrays.asList((byte[]) null)); // NULL value
        SixSevenResultSet rs = createResultSet(singleIntField, rows);
        rs.next();
        assertNull(rs.getString(1));
        assertTrue(rs.wasNull());
    }

    @Test
    @DisplayName("wasNull() returns false after reading non-NULL column")
    void wasNullAfterNonNull() throws SQLException {
        List<List<byte[]>> rows = Collections.singletonList(
            Collections.singletonList(toBytes("42")));
        SixSevenResultSet rs = createResultSet(singleIntField, rows);
        rs.next();
        assertEquals("42", rs.getString(1));
        assertFalse(rs.wasNull());
    }

    @Test
    @DisplayName("getInt on NULL column returns 0 (JDBC spec)")
    void getIntNull() throws SQLException {
        List<List<byte[]>> rows = Collections.singletonList(
            Arrays.asList((byte[]) null));
        SixSevenResultSet rs = createResultSet(singleIntField, rows);
        rs.next();
        assertEquals(0, rs.getInt(1));
        assertTrue(rs.wasNull());
    }

    @Test
    @DisplayName("getBoolean on NULL column returns false (JDBC spec)")
    void getBooleanNull() throws SQLException {
        List<Protocol.FieldDescription> boolField = Collections.singletonList(
            new Protocol.FieldDescription("flag", 0, (short) 0, TypeOID.BOOL,
                (short) 1, -1, (short) 0));
        List<List<byte[]>> rows = Collections.singletonList(
            Arrays.asList((byte[]) null));
        SixSevenResultSet rs = createResultSet(boolField, rows);
        rs.next();
        assertFalse(rs.getBoolean(1));
    }

    @Test
    @DisplayName("getDouble on NULL column returns 0.0 (JDBC spec)")
    void getDoubleNull() throws SQLException {
        List<Protocol.FieldDescription> dblField = Collections.singletonList(
            new Protocol.FieldDescription("score", 0, (short) 0, TypeOID.FLOAT8,
                (short) 8, -1, (short) 0));
        List<List<byte[]>> rows = Collections.singletonList(
            Arrays.asList((byte[]) null));
        SixSevenResultSet rs = createResultSet(dblField, rows);
        rs.next();
        assertEquals(0.0, rs.getDouble(1));
    }

    @Test
    @DisplayName("getBigDecimal on NULL column returns null")
    void getBigDecimalNull() throws SQLException {
        List<Protocol.FieldDescription> numField = Collections.singletonList(
            new Protocol.FieldDescription("amount", 0, (short) 0, TypeOID.NUMERIC,
                (short) -1, -1, (short) 0));
        List<List<byte[]>> rows = Collections.singletonList(
            Arrays.asList((byte[]) null));
        SixSevenResultSet rs = createResultSet(numField, rows);
        rs.next();
        assertNull(rs.getBigDecimal(1));
    }

    // === Type conversion ===

    @Test
    @DisplayName("getInt on valid integer string")
    void getIntValid() throws SQLException {
        List<List<byte[]>> rows = Collections.singletonList(
            Collections.singletonList(toBytes("42")));
        SixSevenResultSet rs = createResultSet(singleIntField, rows);
        rs.next();
        assertEquals(42, rs.getInt(1));
    }

    @Test
    @DisplayName("getInt on non-numeric string throws NumberFormatException")
    void getIntNonNumeric() throws SQLException {
        List<List<byte[]>> rows = Collections.singletonList(
            Collections.singletonList(toBytes("not_a_number")));
        SixSevenResultSet rs = createResultSet(singleIntField, rows);
        rs.next();
        assertThrows(NumberFormatException.class, () -> rs.getInt(1));
    }

    @Test
    @DisplayName("getBoolean on various truthy strings")
    void getBooleanTruthy() throws SQLException {
        List<Protocol.FieldDescription> boolField = Collections.singletonList(
            new Protocol.FieldDescription("flag", 0, (short) 0, TypeOID.BOOL,
                (short) 1, -1, (short) 0));

        for (String truthy : new String[]{"t", "true", "1", "T", "TRUE", "True"}) {
            List<List<byte[]>> rows = Collections.singletonList(
                Collections.singletonList(toBytes(truthy)));
            SixSevenResultSet rs = createResultSet(boolField, rows);
            rs.next();
            assertTrue(rs.getBoolean(1), "Expected true for: " + truthy);
        }
    }

    @Test
    @DisplayName("getBoolean on falsy strings returns false")
    void getBooleanFalsy() throws SQLException {
        List<Protocol.FieldDescription> boolField = Collections.singletonList(
            new Protocol.FieldDescription("flag", 0, (short) 0, TypeOID.BOOL,
                (short) 1, -1, (short) 0));

        for (String falsy : new String[]{"f", "false", "0", "F", "FALSE", "no", ""}) {
            List<List<byte[]>> rows = Collections.singletonList(
                Collections.singletonList(toBytes(falsy)));
            SixSevenResultSet rs = createResultSet(boolField, rows);
            rs.next();
            assertFalse(rs.getBoolean(1), "Expected false for: " + falsy);
        }
    }

    @Test
    @DisplayName("getBigDecimal with scale")
    void getBigDecimalWithScale() throws SQLException {
        List<Protocol.FieldDescription> numField = Collections.singletonList(
            new Protocol.FieldDescription("amount", 0, (short) 0, TypeOID.NUMERIC,
                (short) -1, -1, (short) 0));
        List<List<byte[]>> rows = Collections.singletonList(
            Collections.singletonList(toBytes("123.456")));
        SixSevenResultSet rs = createResultSet(numField, rows);
        rs.next();
        BigDecimal bd = rs.getBigDecimal(1, 2);
        assertEquals(new BigDecimal("123.46"), bd); // rounded to 2 decimals
    }

    @Test
    @DisplayName("getObject returns typed object based on typeOID")
    void getObjectTyped() throws SQLException {
        List<List<byte[]>> rows = Collections.singletonList(
            Collections.singletonList(toBytes("42")));
        SixSevenResultSet rs = createResultSet(singleIntField, rows);
        rs.next();
        Object val = rs.getObject(1);
        assertInstanceOf(Integer.class, val);
        assertEquals(42, val);
    }

    // === Column access by name ===

    @Test
    @DisplayName("findColumn is case-insensitive")
    void findColumnCaseInsensitive() throws SQLException {
        List<List<byte[]>> rows = Collections.singletonList(
            Arrays.asList(toBytes("1"), toBytes("Alice"), toBytes("95.5"), toBytes("t")));
        SixSevenResultSet rs = createResultSet(multiFields, rows);
        rs.next();
        assertEquals(1, rs.findColumn("ID"));
        assertEquals(1, rs.findColumn("id"));
        assertEquals(1, rs.findColumn("Id"));
        assertEquals(2, rs.findColumn("NAME"));
    }

    @Test
    @DisplayName("findColumn with nonexistent name throws SQLException")
    void findColumnNonexistent() throws SQLException {
        List<List<byte[]>> rows = Collections.singletonList(
            Arrays.asList(toBytes("1"), toBytes("Alice"), toBytes("95.5"), toBytes("t")));
        SixSevenResultSet rs = createResultSet(multiFields, rows);
        assertThrows(SQLException.class, () -> rs.findColumn("nonexistent"));
    }

    @Test
    @DisplayName("getString by column name works")
    void getStringByName() throws SQLException {
        List<List<byte[]>> rows = Collections.singletonList(
            Arrays.asList(toBytes("1"), toBytes("Alice"), toBytes("95.5"), toBytes("t")));
        SixSevenResultSet rs = createResultSet(multiFields, rows);
        rs.next();
        assertEquals("Alice", rs.getString("name"));
    }

    // === Position tracking ===

    @Test
    @DisplayName("isBeforeFirst before calling next()")
    void isBeforeFirst() throws SQLException {
        List<List<byte[]>> rows = Collections.singletonList(
            Collections.singletonList(toBytes("42")));
        SixSevenResultSet rs = createResultSet(singleIntField, rows);
        assertTrue(rs.isBeforeFirst());
        assertEquals(0, rs.getRow());
    }

    @Test
    @DisplayName("isFirst after first next()")
    void isFirst() throws SQLException {
        List<List<byte[]>> rows = Collections.singletonList(
            Collections.singletonList(toBytes("42")));
        SixSevenResultSet rs = createResultSet(singleIntField, rows);
        rs.next();
        assertTrue(rs.isFirst());
        assertEquals(1, rs.getRow());
    }

    @Test
    @DisplayName("isLast on single-row result set")
    void isLastSingleRow() throws SQLException {
        List<List<byte[]>> rows = Collections.singletonList(
            Collections.singletonList(toBytes("42")));
        SixSevenResultSet rs = createResultSet(singleIntField, rows);
        rs.next();
        assertTrue(rs.isLast());
    }

    // === ResultSetMetaData ===

    @Test
    @DisplayName("getMetaData returns valid metadata")
    void metaDataValid() throws SQLException {
        SixSevenResultSet rs = createResultSet(multiFields, Collections.emptyList());
        ResultSetMetaData md = rs.getMetaData();
        assertNotNull(md);
        assertEquals(4, md.getColumnCount());
    }

    @Test
    @DisplayName("metadata column names match field descriptions")
    void metaDataColumnNames() throws SQLException {
        SixSevenResultSet rs = createResultSet(multiFields, Collections.emptyList());
        ResultSetMetaData md = rs.getMetaData();
        assertEquals("id", md.getColumnName(1));
        assertEquals("name", md.getColumnName(2));
        assertEquals("score", md.getColumnName(3));
        assertEquals("active", md.getColumnName(4));
    }

    @Test
    @DisplayName("metadata column types mapped correctly")
    void metaDataColumnTypes() throws SQLException {
        SixSevenResultSet rs = createResultSet(multiFields, Collections.emptyList());
        ResultSetMetaData md = rs.getMetaData();
        assertEquals(Types.INTEGER, md.getColumnType(1));
        assertEquals(Types.VARCHAR, md.getColumnType(2));
        assertEquals(Types.DOUBLE, md.getColumnType(3));
        assertEquals(Types.BOOLEAN, md.getColumnType(4));
    }

    @Test
    @DisplayName("metadata column index 0 throws")
    void metaDataColumnZero() throws SQLException {
        SixSevenResultSet rs = createResultSet(singleIntField, Collections.emptyList());
        ResultSetMetaData md = rs.getMetaData();
        assertThrows(SQLException.class, () -> md.getColumnName(0));
    }

    @Test
    @DisplayName("metadata column index beyond range throws")
    void metaDataColumnBeyondRange() throws SQLException {
        SixSevenResultSet rs = createResultSet(singleIntField, Collections.emptyList());
        ResultSetMetaData md = rs.getMetaData();
        assertThrows(SQLException.class, () -> md.getColumnName(2));
    }

    @Test
    @DisplayName("BUG: metadata mapToJdbcType missing UINT/INTERVAL/JSON/EMBEDDING types")
    void metaDataMissingTypes() throws SQLException {
        // These custom types should have proper JDBC type mappings
        // but they fall through to VARCHAR
        List<Protocol.FieldDescription> fields = Arrays.asList(
            new Protocol.FieldDescription("uint32", 0, (short) 0, TypeOID.UINT32,
                (short) 4, -1, (short) 0),
            new Protocol.FieldDescription("interval", 0, (short) 1, TypeOID.INTERVAL,
                (short) -1, -1, (short) 0),
            new Protocol.FieldDescription("json", 0, (short) 2, TypeOID.JSON,
                (short) -1, -1, (short) 0),
            new Protocol.FieldDescription("embedding", 0, (short) 3, TypeOID.EMBEDDING,
                (short) -1, -1, (short) 0)
        );
        SixSevenResultSet rs = createResultSet(fields, Collections.emptyList());
        ResultSetMetaData md = rs.getMetaData();

        // These fall through to default VARCHAR instead of proper types
        assertEquals(Types.VARCHAR, md.getColumnType(1), "UINT32 should map to INTEGER, not VARCHAR");
        assertEquals(Types.VARCHAR, md.getColumnType(2), "INTERVAL should map to OTHER, not VARCHAR");
        assertEquals(Types.VARCHAR, md.getColumnType(3), "JSON should map to OTHER, not VARCHAR");
        assertEquals(Types.VARCHAR, md.getColumnType(4), "EMBEDDING should map to OTHER, not VARCHAR");
    }

    @Test
    @DisplayName("metadata isNullable always returns columnNullable")
    void metaDataNullable() throws SQLException {
        SixSevenResultSet rs = createResultSet(singleIntField, Collections.emptyList());
        ResultSetMetaData md = rs.getMetaData();
        assertEquals(ResultSetMetaData.columnNullable, md.isNullable(1));
    }

    @Test
    @DisplayName("metadata getColumnClassName returns correct Java class name")
    void metaDataClassName() throws SQLException {
        SixSevenResultSet rs = createResultSet(singleIntField, Collections.emptyList());
        ResultSetMetaData md = rs.getMetaData();
        assertEquals("java.lang.Integer", md.getColumnClassName(1));
    }

    @Test
    @DisplayName("metadata getColumnTypeName returns SixSevenDB type name")
    void metaDataTypeName() throws SQLException {
        SixSevenResultSet rs = createResultSet(singleIntField, Collections.emptyList());
        ResultSetMetaData md = rs.getMetaData();
        assertEquals("INT4", md.getColumnTypeName(1));
    }

    // === Forward-only constraints ===

    @Test
    @DisplayName("beforeFirst throws on forward-only ResultSet")
    void forwardOnlyBeforeFirst() {
        SixSevenResultSet rs = createResultSet(singleIntField, Collections.emptyList());
        assertThrows(SQLFeatureNotSupportedException.class, rs::beforeFirst);
    }

    @Test
    @DisplayName("afterLast throws on forward-only ResultSet")
    void forwardOnlyAfterLast() {
        SixSevenResultSet rs = createResultSet(singleIntField, Collections.emptyList());
        assertThrows(SQLFeatureNotSupportedException.class, rs::afterLast);
    }

    @Test
    @DisplayName("previous throws on forward-only ResultSet")
    void forwardOnlyPrevious() {
        SixSevenResultSet rs = createResultSet(singleIntField, Collections.emptyList());
        assertThrows(SQLFeatureNotSupportedException.class, rs::previous);
    }

    @Test
    @DisplayName("ResultSet type is FORWARD_ONLY")
    void resultSetType() {
        SixSevenResultSet rs = createResultSet(singleIntField, Collections.emptyList());
        assertEquals(java.sql.ResultSet.TYPE_FORWARD_ONLY, rs.getType());
    }

    @Test
    @DisplayName("ResultSet concurrency is READ_ONLY")
    void resultSetConcurrency() {
        SixSevenResultSet rs = createResultSet(singleIntField, Collections.emptyList());
        assertEquals(java.sql.ResultSet.CONCUR_READ_ONLY, rs.getConcurrency());
    }

    // === Multi-row iteration ===

    @Test
    @DisplayName("Iterating over multiple rows returns all data")
    void multiRowIteration() throws SQLException {
        List<List<byte[]>> rows = Arrays.asList(
            Collections.singletonList(toBytes("1")),
            Collections.singletonList(toBytes("2")),
            Collections.singletonList(toBytes("3")));
        SixSevenResultSet rs = createResultSet(singleIntField, rows);

        assertTrue(rs.next());
        assertEquals(1, rs.getInt(1));
        assertTrue(rs.next());
        assertEquals(2, rs.getInt(1));
        assertTrue(rs.next());
        assertEquals(3, rs.getInt(1));
        assertFalse(rs.next());
    }
}
