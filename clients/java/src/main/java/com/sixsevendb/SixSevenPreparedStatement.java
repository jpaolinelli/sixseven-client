package com.sixsevendb;

import java.io.InputStream;
import java.io.Reader;
import java.math.BigDecimal;
import java.net.URL;
import java.sql.*;
import java.util.Calendar;
import java.util.HashMap;
import java.util.Map;

/**
 * JDBC PreparedStatement implementation for SixSevenDB.
 */
public class SixSevenPreparedStatement extends SixSevenStatement implements PreparedStatement {

    private final String sql;
    private final Map<Integer, Object> params = new HashMap<>();

    SixSevenPreparedStatement(SixSevenConnection conn, String sql) {
        super(conn);
        this.sql = sql;
    }

    @Override
    public ResultSet executeQuery() throws SQLException {
        checkClosed();
        String[] args = buildArgs();
        SixSevenConnection.QueryResult result;
        if (args.length == 0) {
            result = conn.simpleQuery(sql);
        } else {
            result = conn.extendedQuery(sql, args);
        }
        return new SixSevenResultSet(result.fields, result.rows);
    }

    @Override
    public int executeUpdate() throws SQLException {
        checkClosed();
        String[] args = buildArgs();
        SixSevenConnection.QueryResult result;
        if (args.length == 0) {
            result = conn.simpleQuery(sql);
        } else {
            result = conn.extendedQuery(sql, args);
        }
        return (int) Protocol.parseRowCount(result.command);
    }

    @Override
    public boolean execute() throws SQLException {
        checkClosed();
        String[] args = buildArgs();
        SixSevenConnection.QueryResult result;
        if (args.length == 0) {
            result = conn.simpleQuery(sql);
        } else {
            result = conn.extendedQuery(sql, args);
        }
        return result.fields != null && !result.fields.isEmpty();
    }

    private String[] buildArgs() {
        if (params.isEmpty()) return new String[0];
        int maxIdx = 0;
        for (int idx : params.keySet()) {
            if (idx > maxIdx) maxIdx = idx;
        }
        String[] args = new String[maxIdx];
        for (int i = 1; i <= maxIdx; i++) {
            Object val = params.get(i);
            args[i - 1] = formatArg(val);
        }
        return args;
    }

    private String formatArg(Object val) {
        if (val == null) return Protocol.NULL_VALUE;
        if (val instanceof String) return (String) val;
        if (val instanceof byte[]) return new String((byte[]) val, java.nio.charset.StandardCharsets.UTF_8);
        if (val instanceof Embedding) return ((Embedding) val).serialize();
        if (val instanceof Interval) return val.toString();
        if (val instanceof Boolean) return ((Boolean) val) ? "true" : "false";
        return val.toString();
    }

    @Override
    public void clearParameters() { params.clear(); }

    @Override public void setNull(int parameterIndex, int sqlType) { params.put(parameterIndex, null); }
    @Override public void setBoolean(int parameterIndex, boolean x) { params.put(parameterIndex, x); }
    @Override public void setByte(int parameterIndex, byte x) { params.put(parameterIndex, x); }
    @Override public void setShort(int parameterIndex, short x) { params.put(parameterIndex, x); }
    @Override public void setInt(int parameterIndex, int x) { params.put(parameterIndex, x); }
    @Override public void setLong(int parameterIndex, long x) { params.put(parameterIndex, x); }
    @Override public void setFloat(int parameterIndex, float x) { params.put(parameterIndex, x); }
    @Override public void setDouble(int parameterIndex, double x) { params.put(parameterIndex, x); }
    @Override public void setBigDecimal(int parameterIndex, BigDecimal x) { params.put(parameterIndex, x); }
    @Override public void setString(int parameterIndex, String x) { params.put(parameterIndex, x); }
    @Override public void setBytes(int parameterIndex, byte[] x) { params.put(parameterIndex, x); }
    @Override public void setDate(int parameterIndex, Date x) { params.put(parameterIndex, x); }
    @Override public void setTime(int parameterIndex, Time x) { params.put(parameterIndex, x); }
    @Override public void setTimestamp(int parameterIndex, Timestamp x) { params.put(parameterIndex, x); }
    @Override public void setObject(int parameterIndex, Object x) { params.put(parameterIndex, x); }
    @Override public void setObject(int parameterIndex, Object x, int targetSqlType) { params.put(parameterIndex, x); }
    @Override public void setObject(int parameterIndex, Object x, int targetSqlType, int scaleOrLength) { params.put(parameterIndex, x); }

    // --- Unimplemented stubs ---
    @Override public void setAsciiStream(int parameterIndex, InputStream x, int length) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void setUnicodeStream(int parameterIndex, InputStream x, int length) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void setBinaryStream(int parameterIndex, InputStream x, int length) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void addBatch() throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void setCharacterStream(int parameterIndex, Reader reader, int length) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void setRef(int parameterIndex, Ref x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void setBlob(int parameterIndex, Blob x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void setClob(int parameterIndex, Clob x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void setArray(int parameterIndex, Array x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public ResultSetMetaData getMetaData() throws SQLException { return null; }
    @Override public void setDate(int parameterIndex, Date x, Calendar cal) { params.put(parameterIndex, x); }
    @Override public void setTime(int parameterIndex, Time x, Calendar cal) { params.put(parameterIndex, x); }
    @Override public void setTimestamp(int parameterIndex, Timestamp x, Calendar cal) { params.put(parameterIndex, x); }
    @Override public void setNull(int parameterIndex, int sqlType, String typeName) { params.put(parameterIndex, null); }
    @Override public void setURL(int parameterIndex, URL x) { params.put(parameterIndex, x != null ? x.toString() : null); }
    @Override public ParameterMetaData getParameterMetaData() throws SQLException { return null; }
    @Override public void setRowId(int parameterIndex, RowId x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void setNString(int parameterIndex, String value) { params.put(parameterIndex, value); }
    @Override public void setNCharacterStream(int parameterIndex, Reader value, long length) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void setNClob(int parameterIndex, NClob value) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void setClob(int parameterIndex, Reader reader, long length) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void setBlob(int parameterIndex, InputStream inputStream, long length) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void setNClob(int parameterIndex, Reader reader, long length) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void setSQLXML(int parameterIndex, SQLXML xmlObject) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void setAsciiStream(int parameterIndex, InputStream x, long length) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void setBinaryStream(int parameterIndex, InputStream x, long length) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void setCharacterStream(int parameterIndex, Reader reader, long length) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void setAsciiStream(int parameterIndex, InputStream x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void setBinaryStream(int parameterIndex, InputStream x) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void setCharacterStream(int parameterIndex, Reader reader) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void setNCharacterStream(int parameterIndex, Reader value) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void setClob(int parameterIndex, Reader reader) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void setBlob(int parameterIndex, InputStream inputStream) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void setNClob(int parameterIndex, Reader reader) throws SQLException { throw new SQLFeatureNotSupportedException(); }
}
