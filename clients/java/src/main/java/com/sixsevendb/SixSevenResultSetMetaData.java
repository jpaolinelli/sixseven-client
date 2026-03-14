package com.sixsevendb;

import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.sql.SQLFeatureNotSupportedException;
import java.util.List;

/**
 * JDBC ResultSetMetaData implementation for SixSevenDB.
 */
public class SixSevenResultSetMetaData implements ResultSetMetaData {

    private final List<Protocol.FieldDescription> fields;

    SixSevenResultSetMetaData(List<Protocol.FieldDescription> fields) {
        this.fields = fields;
    }

    @Override
    public int getColumnCount() {
        return fields != null ? fields.size() : 0;
    }

    @Override
    public String getColumnName(int column) throws SQLException {
        return getField(column).name;
    }

    @Override
    public String getColumnLabel(int column) throws SQLException {
        return getField(column).name;
    }

    @Override
    public int getColumnType(int column) throws SQLException {
        int typeOID = getField(column).typeOID;
        return mapToJdbcType(typeOID);
    }

    @Override
    public String getColumnTypeName(int column) throws SQLException {
        int typeOID = getField(column).typeOID;
        return mapToTypeName(typeOID);
    }

    @Override
    public String getColumnClassName(int column) throws SQLException {
        int typeOID = getField(column).typeOID;
        return TypeMapper.javaClass(typeOID).getName();
    }

    @Override
    public int isNullable(int column) { return columnNullable; }

    @Override
    public int getColumnDisplaySize(int column) { return 0; }

    @Override
    public int getPrecision(int column) { return 0; }

    @Override
    public int getScale(int column) { return 0; }

    @Override public boolean isAutoIncrement(int column) { return false; }
    @Override public boolean isCaseSensitive(int column) { return true; }
    @Override public boolean isSearchable(int column) { return true; }
    @Override public boolean isCurrency(int column) { return false; }
    @Override public boolean isSigned(int column) { return true; }
    @Override public String getSchemaName(int column) { return ""; }
    @Override public String getTableName(int column) { return ""; }
    @Override public String getCatalogName(int column) { return ""; }
    @Override public boolean isReadOnly(int column) { return true; }
    @Override public boolean isWritable(int column) { return false; }
    @Override public boolean isDefinitelyWritable(int column) { return false; }
    @Override public <T> T unwrap(Class<T> iface) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public boolean isWrapperFor(Class<?> iface) { return false; }

    private Protocol.FieldDescription getField(int column) throws SQLException {
        int idx = column - 1;
        if (fields == null || idx < 0 || idx >= fields.size()) {
            throw new SQLException("sixsevendb: column index " + column + " out of range");
        }
        return fields.get(idx);
    }

    private static int mapToJdbcType(int typeOID) {
        switch (typeOID) {
            case TypeOID.BOOL: return java.sql.Types.BOOLEAN;
            case TypeOID.TINYINT: return java.sql.Types.TINYINT;
            case TypeOID.INT2:
            case TypeOID.UINT8: return java.sql.Types.SMALLINT;
            case TypeOID.INT4:
            case TypeOID.UINT16: return java.sql.Types.INTEGER;
            case TypeOID.INT8:
            case TypeOID.UINT32:
            case TypeOID.UINT64: return java.sql.Types.BIGINT;
            case TypeOID.FLOAT4: return java.sql.Types.REAL;
            case TypeOID.FLOAT8: return java.sql.Types.DOUBLE;
            case TypeOID.NUMERIC: return java.sql.Types.NUMERIC;
            case TypeOID.TEXT:
            case TypeOID.VARCHAR: return java.sql.Types.VARCHAR;
            case TypeOID.CHAR: return java.sql.Types.CHAR;
            case TypeOID.BYTEA:
            case TypeOID.BLOB: return java.sql.Types.BINARY;
            case TypeOID.DATE: return java.sql.Types.DATE;
            case TypeOID.TIME: return java.sql.Types.TIME;
            case TypeOID.TIMESTAMP: return java.sql.Types.TIMESTAMP;
            case TypeOID.UUID:
            case TypeOID.INTERVAL:
            case TypeOID.JSON:
            case TypeOID.EMBEDDING: return java.sql.Types.OTHER;
            default: return java.sql.Types.VARCHAR;
        }
    }

    private static String mapToTypeName(int typeOID) {
        switch (typeOID) {
            case TypeOID.BOOL: return "BOOL";
            case TypeOID.TINYINT: return "TINYINT";
            case TypeOID.INT2: return "INT2";
            case TypeOID.INT4: return "INT4";
            case TypeOID.INT8: return "INT8";
            case TypeOID.UINT8: return "UINT8";
            case TypeOID.UINT16: return "UINT16";
            case TypeOID.UINT32: return "UINT32";
            case TypeOID.UINT64: return "UINT64";
            case TypeOID.FLOAT4: return "FLOAT4";
            case TypeOID.FLOAT8: return "FLOAT8";
            case TypeOID.NUMERIC: return "NUMERIC";
            case TypeOID.TEXT: return "TEXT";
            case TypeOID.VARCHAR: return "VARCHAR";
            case TypeOID.CHAR: return "CHAR";
            case TypeOID.BYTEA: return "BYTEA";
            case TypeOID.BLOB: return "BLOB";
            case TypeOID.DATE: return "DATE";
            case TypeOID.TIME: return "TIME";
            case TypeOID.TIMESTAMP: return "TIMESTAMP";
            case TypeOID.INTERVAL: return "INTERVAL";
            case TypeOID.JSON: return "JSON";
            case TypeOID.UUID: return "UUID";
            case TypeOID.EMBEDDING: return "EMBEDDING";
            default: return "UNKNOWN";
        }
    }
}
