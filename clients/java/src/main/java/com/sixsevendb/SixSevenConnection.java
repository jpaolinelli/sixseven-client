package com.sixsevendb;

import java.io.DataInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.sql.*;
import java.util.*;
import java.util.concurrent.Executor;

/**
 * JDBC Connection implementation for SixSevenDB.
 * Manages a TCP connection using the PostgreSQL v3 wire protocol.
 */
public class SixSevenConnection implements Connection {

    private Socket socket;
    private DataInputStream in;
    private OutputStream out;
    private boolean closed;
    private boolean autoCommit = true;
    private final Map<String, String> parameters = new HashMap<>();
    private int pid;
    private int secretKey;
    private final String user;
    private final String database;

    SixSevenConnection(String host, int port, String user, String password, String database) throws SQLException {
        this.user = user;
        this.database = database;
        try {
            socket = new Socket(host, port);
            in = new DataInputStream(socket.getInputStream());
            out = socket.getOutputStream();
            startup(user, password, database);
        } catch (IOException e) {
            throw new SQLException("sixsevendb: connect to " + host + ":" + port + ": " + e.getMessage(), e);
        }
    }

    private void startup(String user, String password, String database) throws SQLException {
        try {
            Protocol.writeMessage(out, Protocol.buildStartupMessage(user, database));
            handleStartup(user, password);
        } catch (IOException e) {
            throw new SQLException("sixsevendb: startup failed: " + e.getMessage(), e);
        }
    }

    private void handleStartup(String user, String password) throws SQLException, IOException {
        while (true) {
            Protocol.Message msg = Protocol.readMessage(in);
            switch (msg.type) {
                case Protocol.MSG_AUTHENTICATION:
                    handleAuth(msg.payload, user, password);
                    break;
                case Protocol.MSG_PARAMETER_STATUS:
                    parseParameterStatus(msg.payload);
                    break;
                case Protocol.MSG_BACKEND_KEY_DATA:
                    pid = readInt32(msg.payload, 0);
                    secretKey = readInt32(msg.payload, 4);
                    break;
                case Protocol.MSG_READY_FOR_QUERY:
                    return;
                case Protocol.MSG_ERROR_RESPONSE:
                    throw parseServerError(msg.payload);
                case Protocol.MSG_NOTICE_RESPONSE:
                    break; // ignore notices
                default:
                    break;
            }
        }
    }

    private void handleAuth(byte[] payload, String user, String password) throws SQLException, IOException {
        if (payload.length < 4) {
            throw new SQLException("sixsevendb: authentication payload too short");
        }
        int authType = readInt32(payload, 0);
        switch (authType) {
            case Protocol.AUTH_OK:
                return;
            case Protocol.AUTH_CLEARTEXT:
                if (password == null || password.isEmpty()) {
                    throw new SQLException("sixsevendb: server requires password but none provided");
                }
                Protocol.writeMessage(out, Protocol.buildPasswordMessage(password));
                return;
            case Protocol.AUTH_MD5:
                if (password == null || password.isEmpty()) {
                    throw new SQLException("sixsevendb: server requires password but none provided");
                }
                byte[] salt = new byte[4];
                System.arraycopy(payload, 4, salt, 0, 4);
                String md5pw = Auth.buildMD5Password(user, password, salt);
                Protocol.writeMessage(out, Protocol.buildPasswordMessage(md5pw));
                return;
            case Protocol.AUTH_SASL:
                handleSASL(payload, user, password);
                return;
            default:
                throw new SQLException("sixsevendb: unsupported auth type " + authType);
        }
    }

    private void handleSASL(byte[] payload, String user, String password) throws SQLException, IOException {
        // Parse mechanisms from payload (after 4-byte auth type)
        List<String> mechanisms = new ArrayList<>();
        int pos = 4;
        while (pos < payload.length) {
            int end = pos;
            while (end < payload.length && payload[end] != 0) end++;
            String name = new String(payload, pos, end - pos, StandardCharsets.UTF_8);
            pos = end + 1;
            if (name.isEmpty()) break;
            mechanisms.add(name);
        }

        if (!mechanisms.contains("SCRAM-SHA-256")) {
            throw new SQLException("sixsevendb: server requires unsupported SASL mechanisms: " + mechanisms);
        }
        if (password == null || password.isEmpty()) {
            throw new SQLException("sixsevendb: server requires password but none provided");
        }

        Object[] result = Auth.scramClientFirst(user, password);
        Auth.ScramState state = (Auth.ScramState) result[0];
        byte[] clientFirst = (byte[]) result[1];
        Protocol.writeMessage(out, Protocol.buildSASLInitialResponse("SCRAM-SHA-256", clientFirst));

        // Read SASLContinue
        Protocol.Message contMsg = Protocol.readMessage(in);
        if (contMsg.type != Protocol.MSG_AUTHENTICATION) {
            throw new SQLException("sixsevendb: expected SASLContinue, got " + (char) contMsg.type);
        }
        if (contMsg.payload.length < 4 || readInt32(contMsg.payload, 0) != Protocol.AUTH_SASL_CONTINUE) {
            throw new SQLException("sixsevendb: expected SASLContinue auth type");
        }
        byte[] serverFirst = new byte[contMsg.payload.length - 4];
        System.arraycopy(contMsg.payload, 4, serverFirst, 0, serverFirst.length);

        byte[] clientFinal = Auth.scramClientFinal(state, serverFirst);
        Protocol.writeMessage(out, Protocol.buildSASLResponse(clientFinal));

        // Read SASLFinal
        Protocol.Message finalMsg = Protocol.readMessage(in);
        if (finalMsg.type != Protocol.MSG_AUTHENTICATION) {
            throw new SQLException("sixsevendb: expected SASLFinal, got " + (char) finalMsg.type);
        }
        if (finalMsg.payload.length < 4 || readInt32(finalMsg.payload, 0) != Protocol.AUTH_SASL_FINAL) {
            throw new SQLException("sixsevendb: expected SASLFinal auth type");
        }
        byte[] serverFinal = new byte[finalMsg.payload.length - 4];
        System.arraycopy(finalMsg.payload, 4, serverFinal, 0, serverFinal.length);

        if (!Auth.scramVerifyServer(state, serverFinal)) {
            throw new SQLException("sixsevendb: server signature verification failed");
        }
    }

    // --- Query execution ---

    /**
     * Executes a simple query (no parameters) and returns fields, rows, and command tag.
     */
    synchronized QueryResult simpleQuery(String sql) throws SQLException {
        checkClosed();
        try {
            Protocol.writeMessage(out, Protocol.buildQueryMessage(sql));
            return readQueryResult();
        } catch (IOException e) {
            throw new SQLException("sixsevendb: query failed: " + e.getMessage(), e);
        }
    }

    /**
     * Executes a parameterized query via extended query protocol.
     */
    synchronized QueryResult extendedQuery(String sql, String[] args) throws SQLException {
        checkClosed();
        try {
            byte[] parseMsg = Protocol.buildParseMessage(sql, "");
            byte[] bindMsg = Protocol.buildBindMessage(args, "", "");
            byte[] descMsg = Protocol.buildDescribeMessage((byte) 'P', "");
            byte[] execMsg = Protocol.buildExecuteMessage("", 0);
            byte[] syncMsg = Protocol.buildSyncMessage();

            // Write all messages in one batch
            int totalLen = parseMsg.length + bindMsg.length + descMsg.length + execMsg.length + syncMsg.length;
            byte[] batch = new byte[totalLen];
            int offset = 0;
            System.arraycopy(parseMsg, 0, batch, offset, parseMsg.length); offset += parseMsg.length;
            System.arraycopy(bindMsg, 0, batch, offset, bindMsg.length); offset += bindMsg.length;
            System.arraycopy(descMsg, 0, batch, offset, descMsg.length); offset += descMsg.length;
            System.arraycopy(execMsg, 0, batch, offset, execMsg.length); offset += execMsg.length;
            System.arraycopy(syncMsg, 0, batch, offset, syncMsg.length);

            Protocol.writeMessage(out, batch);
            return readExtendedQueryResult();
        } catch (IOException e) {
            throw new SQLException("sixsevendb: query failed: " + e.getMessage(), e);
        }
    }

    private QueryResult readQueryResult() throws SQLException, IOException {
        List<Protocol.FieldDescription> fields = null;
        List<List<byte[]>> rows = new ArrayList<>();
        String command = "";

        while (true) {
            Protocol.Message msg = Protocol.readMessage(in);
            switch (msg.type) {
                case Protocol.MSG_ROW_DESCRIPTION:
                    fields = Protocol.parseRowDescription(msg.payload);
                    break;
                case Protocol.MSG_DATA_ROW:
                    rows.add(Protocol.parseDataRow(msg.payload));
                    break;
                case Protocol.MSG_COMMAND_COMPLETE:
                    command = Protocol.parseCString(msg.payload);
                    break;
                case Protocol.MSG_EMPTY_QUERY_RESP:
                    break;
                case Protocol.MSG_ERROR_RESPONSE:
                    SixSevenException err = parseServerError(msg.payload);
                    waitForReady();
                    throw err;
                case Protocol.MSG_NOTICE_RESPONSE:
                    break;
                case Protocol.MSG_READY_FOR_QUERY:
                    return new QueryResult(fields, rows, command);
                default:
                    break;
            }
        }
    }

    private QueryResult readExtendedQueryResult() throws SQLException, IOException {
        List<Protocol.FieldDescription> fields = null;
        List<List<byte[]>> rows = new ArrayList<>();
        String command = "";

        while (true) {
            Protocol.Message msg = Protocol.readMessage(in);
            switch (msg.type) {
                case Protocol.MSG_PARSE_COMPLETE:
                case Protocol.MSG_BIND_COMPLETE:
                case Protocol.MSG_NO_DATA:
                    break;
                case Protocol.MSG_ROW_DESCRIPTION:
                    fields = Protocol.parseRowDescription(msg.payload);
                    break;
                case Protocol.MSG_DATA_ROW:
                    rows.add(Protocol.parseDataRow(msg.payload));
                    break;
                case Protocol.MSG_COMMAND_COMPLETE:
                    command = Protocol.parseCString(msg.payload);
                    break;
                case Protocol.MSG_EMPTY_QUERY_RESP:
                    break;
                case Protocol.MSG_ERROR_RESPONSE:
                    SixSevenException err = parseServerError(msg.payload);
                    waitForReady();
                    throw err;
                case Protocol.MSG_NOTICE_RESPONSE:
                    break;
                case Protocol.MSG_READY_FOR_QUERY:
                    return new QueryResult(fields, rows, command);
                default:
                    break;
            }
        }
    }

    private void waitForReady() {
        try {
            while (true) {
                Protocol.Message msg = Protocol.readMessage(in);
                if (msg.type == Protocol.MSG_READY_FOR_QUERY) return;
            }
        } catch (IOException ignored) {}
    }

    // --- Query result holder ---

    static final class QueryResult {
        final List<Protocol.FieldDescription> fields;
        final List<List<byte[]>> rows;
        final String command;

        QueryResult(List<Protocol.FieldDescription> fields, List<List<byte[]>> rows, String command) {
            this.fields = fields;
            this.rows = rows;
            this.command = command;
        }
    }

    // --- JDBC Connection interface ---

    @Override
    public Statement createStatement() throws SQLException {
        checkClosed();
        return new SixSevenStatement(this);
    }

    @Override
    public PreparedStatement prepareStatement(String sql) throws SQLException {
        checkClosed();
        return new SixSevenPreparedStatement(this, sql);
    }

    @Override
    public void setAutoCommit(boolean autoCommit) throws SQLException {
        checkClosed();
        if (this.autoCommit == autoCommit) return;
        this.autoCommit = autoCommit;
        if (!autoCommit) {
            simpleQuery("BEGIN");
        }
    }

    @Override
    public boolean getAutoCommit() throws SQLException {
        checkClosed();
        return autoCommit;
    }

    @Override
    public void commit() throws SQLException {
        checkClosed();
        if (autoCommit) throw new SQLException("sixsevendb: cannot commit in auto-commit mode");
        simpleQuery("COMMIT");
        simpleQuery("BEGIN");
    }

    @Override
    public void rollback() throws SQLException {
        checkClosed();
        if (autoCommit) throw new SQLException("sixsevendb: cannot rollback in auto-commit mode");
        simpleQuery("ROLLBACK");
        simpleQuery("BEGIN");
    }

    @Override
    public Savepoint setSavepoint() throws SQLException {
        return setSavepoint("sp_" + System.nanoTime());
    }

    @Override
    public Savepoint setSavepoint(String name) throws SQLException {
        checkClosed();
        if (autoCommit) throw new SQLException("sixsevendb: cannot set savepoint in auto-commit mode");
        simpleQuery("SAVEPOINT \"" + name.replace("\"", "\"\"") + "\"");
        return new SixSevenSavepoint(name);
    }

    @Override
    public void rollback(Savepoint savepoint) throws SQLException {
        checkClosed();
        String name = savepoint.getSavepointName();
        simpleQuery("ROLLBACK TO SAVEPOINT \"" + name.replace("\"", "\"\"") + "\"");
    }

    @Override
    public void releaseSavepoint(Savepoint savepoint) throws SQLException {
        checkClosed();
        String name = savepoint.getSavepointName();
        simpleQuery("RELEASE SAVEPOINT \"" + name.replace("\"", "\"\"") + "\"");
    }

    @Override
    public void close() throws SQLException {
        if (closed) return;
        closed = true;
        try {
            Protocol.writeMessage(out, Protocol.buildTerminateMessage());
            socket.close();
        } catch (IOException ignored) {}
    }

    @Override
    public boolean isClosed() {
        return closed;
    }

    @Override
    public DatabaseMetaData getMetaData() throws SQLException {
        checkClosed();
        return null; // Not implemented
    }

    @Override
    public boolean isValid(int timeout) {
        if (closed) return false;
        try {
            simpleQuery("SELECT 1");
            return true;
        } catch (SQLException e) {
            return false;
        }
    }

    @Override
    public String getCatalog() { return database; }

    @Override
    public String getSchema() { return null; }

    private void checkClosed() throws SQLException {
        if (closed) throw new SQLException("sixsevendb: connection is closed");
    }

    private SixSevenException parseServerError(byte[] payload) {
        Map<Byte, String> fields = Protocol.parseErrorFields(payload);
        return new SixSevenException(
            fields.getOrDefault((byte) 'S', "ERROR"),
            fields.get((byte) 'C'),
            fields.getOrDefault((byte) 'M', "unknown error"),
            fields.get((byte) 'D'),
            fields.get((byte) 'H')
        );
    }

    private void parseParameterStatus(byte[] payload) {
        int pos = 0;
        int end = pos;
        while (end < payload.length && payload[end] != 0) end++;
        String name = new String(payload, pos, end - pos, StandardCharsets.UTF_8);
        pos = end + 1;
        end = pos;
        while (end < payload.length && payload[end] != 0) end++;
        String value = new String(payload, pos, end - pos, StandardCharsets.UTF_8);
        parameters.put(name, value);
    }

    private static int readInt32(byte[] data, int offset) {
        return ((data[offset] & 0xFF) << 24)
             | ((data[offset + 1] & 0xFF) << 16)
             | ((data[offset + 2] & 0xFF) << 8)
             | (data[offset + 3] & 0xFF);
    }

    private static final java.nio.charset.Charset StandardCharsets_UTF_8 = java.nio.charset.StandardCharsets.UTF_8;

    // --- Unimplemented JDBC methods (stubs) ---

    @Override public CallableStatement prepareCall(String sql) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public String nativeSQL(String sql) { return sql; }
    @Override public void setReadOnly(boolean readOnly) {}
    @Override public boolean isReadOnly() { return false; }
    @Override public void setCatalog(String catalog) {}
    @Override public void setTransactionIsolation(int level) {}
    @Override public int getTransactionIsolation() { return Connection.TRANSACTION_READ_COMMITTED; }
    @Override public SQLWarning getWarnings() { return null; }
    @Override public void clearWarnings() {}
    @Override public Statement createStatement(int resultSetType, int resultSetConcurrency) throws SQLException { return createStatement(); }
    @Override public PreparedStatement prepareStatement(String sql, int resultSetType, int resultSetConcurrency) throws SQLException { return prepareStatement(sql); }
    @Override public CallableStatement prepareCall(String sql, int resultSetType, int resultSetConcurrency) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public Map<String, Class<?>> getTypeMap() { return Collections.emptyMap(); }
    @Override public void setTypeMap(Map<String, Class<?>> map) {}
    @Override public void setHoldability(int holdability) {}
    @Override public int getHoldability() { return ResultSet.HOLD_CURSORS_OVER_COMMIT; }
    @Override public Statement createStatement(int resultSetType, int resultSetConcurrency, int resultSetHoldability) throws SQLException { return createStatement(); }
    @Override public PreparedStatement prepareStatement(String sql, int resultSetType, int resultSetConcurrency, int resultSetHoldability) throws SQLException { return prepareStatement(sql); }
    @Override public CallableStatement prepareCall(String sql, int resultSetType, int resultSetConcurrency, int resultSetHoldability) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public PreparedStatement prepareStatement(String sql, int autoGeneratedKeys) throws SQLException { return prepareStatement(sql); }
    @Override public PreparedStatement prepareStatement(String sql, int[] columnIndexes) throws SQLException { return prepareStatement(sql); }
    @Override public PreparedStatement prepareStatement(String sql, String[] columnNames) throws SQLException { return prepareStatement(sql); }
    @Override public Clob createClob() throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public Blob createBlob() throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public NClob createNClob() throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public SQLXML createSQLXML() throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void setClientInfo(String name, String value) {}
    @Override public void setClientInfo(Properties properties) {}
    @Override public String getClientInfo(String name) { return null; }
    @Override public Properties getClientInfo() { return new Properties(); }
    @Override public Array createArrayOf(String typeName, Object[] elements) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public Struct createStruct(String typeName, Object[] attributes) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public void setSchema(String schema) {}
    @Override public void abort(Executor executor) throws SQLException { close(); }
    @Override public void setNetworkTimeout(Executor executor, int milliseconds) {}
    @Override public int getNetworkTimeout() { return 0; }
    @Override public <T> T unwrap(Class<T> iface) throws SQLException { throw new SQLFeatureNotSupportedException(); }
    @Override public boolean isWrapperFor(Class<?> iface) { return false; }
}
