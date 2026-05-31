package com.sixsevendb;

import java.io.DataInputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * PostgreSQL v3 wire protocol implementation for SixSevenDB.
 */
final class Protocol {

    static final int PROTOCOL_VERSION = 196608; // 3 << 16

    // Backend message type bytes.
    static final byte MSG_AUTHENTICATION    = 'R';
    static final byte MSG_PARAMETER_STATUS  = 'S';
    static final byte MSG_BACKEND_KEY_DATA  = 'K';
    static final byte MSG_READY_FOR_QUERY   = 'Z';
    static final byte MSG_ROW_DESCRIPTION   = 'T';
    static final byte MSG_DATA_ROW          = 'D';
    static final byte MSG_COMMAND_COMPLETE  = 'C';
    static final byte MSG_ERROR_RESPONSE    = 'E';
    static final byte MSG_NOTICE_RESPONSE   = 'N';
    static final byte MSG_EMPTY_QUERY_RESP  = 'I';
    static final byte MSG_PARSE_COMPLETE    = '1';
    static final byte MSG_BIND_COMPLETE     = '2';
    static final byte MSG_CLOSE_COMPLETE    = '3';
    static final byte MSG_NO_DATA           = 'n';
    static final byte MSG_PORTAL_SUSPENDED  = 's';

    // Auth subtypes within 'R' messages.
    static final int AUTH_OK                = 0;
    static final int AUTH_CLEARTEXT         = 3;
    static final int AUTH_MD5               = 5;
    static final int AUTH_SASL              = 10;
    static final int AUTH_SASL_CONTINUE     = 11;
    static final int AUTH_SASL_FINAL        = 12;

    /** Sentinel for SQL NULL in bind protocol. */
    static final String NULL_VALUE = "\0NULL\0";

    private Protocol() {}

    /** Describes a single column in a result set. */
    static final class FieldDescription {
        final String name;
        final int tableOID;
        final short columnIndex;
        final int typeOID;
        final short typeSize;
        final int typeModifier;
        final short formatCode;

        FieldDescription(String name, int tableOID, short columnIndex, int typeOID,
                         short typeSize, int typeModifier, short formatCode) {
            this.name = name;
            this.tableOID = tableOID;
            this.columnIndex = columnIndex;
            this.typeOID = typeOID;
            this.typeSize = typeSize;
            this.typeModifier = typeModifier;
            this.formatCode = formatCode;
        }
    }

    /** A single backend message: type byte + payload. */
    static final class Message {
        final byte type;
        final byte[] payload;

        Message(byte type, byte[] payload) {
            this.type = type;
            this.payload = payload;
        }
    }

    // --- Message builders ---

    static byte[] buildStartupMessage(String user, String database) {
        byte[] params = (
            "user\0" + user + "\0" +
            "database\0" + database + "\0\0"
        ).getBytes(StandardCharsets.UTF_8);
        int length = 4 + 4 + params.length;
        ByteBuffer buf = ByteBuffer.allocate(length);
        buf.putInt(length);
        buf.putInt(PROTOCOL_VERSION);
        buf.put(params);
        return buf.array();
    }

    static byte[] buildPasswordMessage(String password) {
        byte[] pw = (password + "\0").getBytes(StandardCharsets.UTF_8);
        int length = 4 + pw.length;
        ByteBuffer buf = ByteBuffer.allocate(1 + 4 + pw.length);
        buf.put((byte) 'p');
        buf.putInt(length);
        buf.put(pw);
        return buf.array();
    }

    static byte[] buildQueryMessage(String sql) {
        byte[] sqlBytes = (sql + "\0").getBytes(StandardCharsets.UTF_8);
        int length = 4 + sqlBytes.length;
        ByteBuffer buf = ByteBuffer.allocate(1 + 4 + sqlBytes.length);
        buf.put((byte) 'Q');
        buf.putInt(length);
        buf.put(sqlBytes);
        return buf.array();
    }

    static byte[] buildParseMessage(String sql, String statementName) {
        byte[] nameBytes = (statementName + "\0").getBytes(StandardCharsets.UTF_8);
        byte[] sqlBytes = (sql + "\0").getBytes(StandardCharsets.UTF_8);
        byte[] paramTypes = new byte[2]; // uint16: 0 parameter type OIDs
        int length = 4 + nameBytes.length + sqlBytes.length + paramTypes.length;
        ByteBuffer buf = ByteBuffer.allocate(1 + length);
        buf.put((byte) 'P');
        buf.putInt(length);
        buf.put(nameBytes);
        buf.put(sqlBytes);
        buf.put(paramTypes);
        return buf.array();
    }

    static byte[] buildBindMessage(String[] values, String portalName, String statementName) {
        byte[] portalBytes = (portalName + "\0").getBytes(StandardCharsets.UTF_8);
        byte[] stmtBytes = (statementName + "\0").getBytes(StandardCharsets.UTF_8);

        // Build parameter data
        ByteBuffer paramBuf = ByteBuffer.allocate(65536);
        for (String val : values) {
            if (NULL_VALUE.equals(val)) {
                paramBuf.putInt(-1); // SQL NULL
            } else {
                byte[] valBytes = val.getBytes(StandardCharsets.UTF_8);
                paramBuf.putInt(valBytes.length);
                paramBuf.put(valBytes);
            }
        }
        paramBuf.flip();
        byte[] paramData = new byte[paramBuf.remaining()];
        paramBuf.get(paramData);

        int payloadLen = portalBytes.length + stmtBytes.length
            + 2  // format codes count (0 = all text)
            + 2  // param count
            + paramData.length
            + 2; // result format codes count

        int length = 4 + payloadLen;
        ByteBuffer buf = ByteBuffer.allocate(1 + length);
        buf.put((byte) 'B');
        buf.putInt(length);
        buf.put(portalBytes);
        buf.put(stmtBytes);
        buf.putShort((short) 0); // format codes: 0 = all text
        buf.putShort((short) values.length);
        buf.put(paramData);
        buf.putShort((short) 0); // result format: 0 = all text
        return buf.array();
    }

    static byte[] buildDescribeMessage(byte targetType, String name) {
        byte[] nameBytes = (name + "\0").getBytes(StandardCharsets.UTF_8);
        int length = 4 + 1 + nameBytes.length;
        ByteBuffer buf = ByteBuffer.allocate(1 + length);
        buf.put((byte) 'D');
        buf.putInt(length);
        buf.put(targetType);
        buf.put(nameBytes);
        return buf.array();
    }

    static byte[] buildExecuteMessage(String portalName, int maxRows) {
        byte[] portalBytes = (portalName + "\0").getBytes(StandardCharsets.UTF_8);
        int length = 4 + portalBytes.length + 4;
        ByteBuffer buf = ByteBuffer.allocate(1 + length);
        buf.put((byte) 'E');
        buf.putInt(length);
        buf.put(portalBytes);
        buf.putInt(maxRows);
        return buf.array();
    }

    static byte[] buildSyncMessage() {
        return new byte[]{'S', 0, 0, 0, 4};
    }

    static byte[] buildTerminateMessage() {
        return new byte[]{'X', 0, 0, 0, 4};
    }

    static byte[] buildSASLInitialResponse(String mechanism, byte[] clientFirstMessage) {
        byte[] mechBytes = (mechanism + "\0").getBytes(StandardCharsets.UTF_8);
        int length = 4 + mechBytes.length + 4 + clientFirstMessage.length;
        ByteBuffer buf = ByteBuffer.allocate(1 + length);
        buf.put((byte) 'p');
        buf.putInt(length);
        buf.put(mechBytes);
        buf.putInt(clientFirstMessage.length);
        buf.put(clientFirstMessage);
        return buf.array();
    }

    static byte[] buildSASLResponse(byte[] clientFinalMessage) {
        int length = 4 + clientFinalMessage.length;
        ByteBuffer buf = ByteBuffer.allocate(1 + length);
        buf.put((byte) 'p');
        buf.putInt(length);
        buf.put(clientFinalMessage);
        return buf.array();
    }

    // --- Message reading ---

    static Message readMessage(DataInputStream in) throws IOException {
        byte type = in.readByte();
        int length = in.readInt();
        if (length < 4) {
            throw new IOException("sixsevendb: invalid message length " + length);
        }
        int payloadLen = length - 4;
        byte[] payload = new byte[payloadLen];
        if (payloadLen > 0) {
            in.readFully(payload);
        }
        return new Message(type, payload);
    }

    static void writeMessage(OutputStream out, byte[] data) throws IOException {
        out.write(data);
        out.flush();
    }

    // --- Payload parsers ---

    static Map<Byte, String> parseErrorFields(byte[] payload) {
        Map<Byte, String> fields = new HashMap<>();
        int pos = 0;
        while (pos < payload.length) {
            byte fieldType = payload[pos];
            pos++;
            if (fieldType == 0) break;
            int end = pos;
            while (end < payload.length && payload[end] != 0) end++;
            fields.put(fieldType, new String(payload, pos, end - pos, StandardCharsets.UTF_8));
            pos = end + 1;
        }
        return fields;
    }

    static List<FieldDescription> parseRowDescription(byte[] payload) throws IOException {
        if (payload.length < 2) {
            throw new IOException("row description too short");
        }
        int fieldCount = ((payload[0] & 0xFF) << 8) | (payload[1] & 0xFF);
        List<FieldDescription> fields = new ArrayList<>(fieldCount);
        int pos = 2;
        for (int i = 0; i < fieldCount; i++) {
            int end = pos;
            while (end < payload.length && payload[end] != 0) end++;
            if (end >= payload.length) {
                throw new IOException("malformed row description");
            }
            String name = new String(payload, pos, end - pos, StandardCharsets.UTF_8);
            pos = end + 1;
            if (pos + 18 > payload.length) {
                throw new IOException("row description field data too short");
            }
            int tableOID = readInt32(payload, pos);
            short colIdx = readInt16(payload, pos + 4);
            int typeOID = readInt32(payload, pos + 6);
            short typeSize = readInt16(payload, pos + 10);
            int typeMod = readInt32(payload, pos + 12);
            short fmtCode = readInt16(payload, pos + 16);
            pos += 18;
            fields.add(new FieldDescription(name, tableOID, colIdx, typeOID, typeSize, typeMod, fmtCode));
        }
        return fields;
    }

    static List<byte[]> parseDataRow(byte[] payload) throws IOException {
        if (payload.length < 2) {
            throw new IOException("data row too short");
        }
        int colCount = ((payload[0] & 0xFF) << 8) | (payload[1] & 0xFF);
        List<byte[]> values = new ArrayList<>(colCount);
        int pos = 2;
        for (int i = 0; i < colCount; i++) {
            if (pos + 4 > payload.length) {
                throw new IOException("data row column length too short");
            }
            int length = readInt32(payload, pos);
            pos += 4;
            if (length == -1) {
                values.add(null); // SQL NULL
            } else {
                if (pos + length > payload.length) {
                    throw new IOException("data row column data too short");
                }
                byte[] val = new byte[length];
                System.arraycopy(payload, pos, val, 0, length);
                values.add(val);
                pos += length;
            }
        }
        return values;
    }

    static String parseCString(byte[] payload) {
        int end = 0;
        while (end < payload.length && payload[end] != 0) end++;
        return new String(payload, 0, end, StandardCharsets.UTF_8);
    }

    static long parseRowCount(String tag) {
        String[] parts = tag.split(" ");
        if (parts.length >= 2) {
            try {
                return Long.parseLong(parts[parts.length - 1]);
            } catch (NumberFormatException e) {
                return 0;
            }
        }
        return 0;
    }

    // --- Utility ---

    private static int readInt32(byte[] data, int offset) {
        return ((data[offset] & 0xFF) << 24)
             | ((data[offset + 1] & 0xFF) << 16)
             | ((data[offset + 2] & 0xFF) << 8)
             | (data[offset + 3] & 0xFF);
    }

    private static short readInt16(byte[] data, int offset) {
        return (short) (((data[offset] & 0xFF) << 8) | (data[offset + 1] & 0xFF));
    }
}
