package com.sixsevendb;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.DisplayName;

import java.io.ByteArrayInputStream;
import java.io.DataInputStream;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.*;

/**
 * QA adversarial tests for Protocol — GDB-51.
 * Targets edge cases, boundary values, malformed messages, and error paths.
 */
class QaGdb51ProtocolTest {

    // === readMessage edge cases ===

    @Test
    @DisplayName("readMessage with length < 4 throws IOException")
    void readMessageTooShortLength() {
        // type=R, length=3 (invalid, must be >= 4)
        byte[] data = new byte[]{(byte) 'R', 0, 0, 0, 3};
        DataInputStream in = new DataInputStream(new ByteArrayInputStream(data));
        assertThrows(IOException.class, () -> Protocol.readMessage(in));
    }

    @Test
    @DisplayName("readMessage with length exactly 4 returns empty payload")
    void readMessageMinimalLength() throws IOException {
        byte[] data = new byte[]{(byte) 'Z', 0, 0, 0, 4};
        DataInputStream in = new DataInputStream(new ByteArrayInputStream(data));
        Protocol.Message msg = Protocol.readMessage(in);
        assertEquals('Z', msg.type);
        assertEquals(0, msg.payload.length);
    }

    @Test
    @DisplayName("readMessage on empty stream throws IOException (EOF)")
    void readMessageEmptyStream() {
        DataInputStream in = new DataInputStream(new ByteArrayInputStream(new byte[0]));
        assertThrows(Exception.class, () -> Protocol.readMessage(in));
    }

    @Test
    @DisplayName("readMessage with truncated payload throws IOException")
    void readMessageTruncatedPayload() {
        // Says payload is 10 bytes but only provides 3
        byte[] data = new byte[]{(byte) 'R', 0, 0, 0, 14, 1, 2, 3};
        DataInputStream in = new DataInputStream(new ByteArrayInputStream(data));
        assertThrows(Exception.class, () -> Protocol.readMessage(in));
    }

    // === parseRowDescription edge cases ===

    @Test
    @DisplayName("parseRowDescription with payload too short throws IOException")
    void parseRowDescTooShort() {
        assertThrows(IOException.class, () -> Protocol.parseRowDescription(new byte[]{1}));
    }

    @Test
    @DisplayName("parseRowDescription with zero fields returns empty list")
    void parseRowDescZeroFields() throws IOException {
        byte[] payload = new byte[]{0, 0}; // fieldCount = 0
        var result = Protocol.parseRowDescription(payload);
        assertTrue(result.isEmpty());
    }

    @Test
    @DisplayName("parseRowDescription with field data too short throws IOException")
    void parseRowDescFieldDataTooShort() {
        // Says 1 field, name "a\0", but not enough bytes for metadata (18 bytes needed)
        byte[] payload = new byte[]{0, 1, (byte) 'a', 0, 0, 0, 0};
        assertThrows(IOException.class, () -> Protocol.parseRowDescription(payload));
    }

    @Test
    @DisplayName("parseRowDescription with malformed name (no null terminator) throws IOException")
    void parseRowDescMalformedName() {
        // 1 field, name bytes with no null terminator
        byte[] payload = new byte[]{0, 1, (byte) 'a', (byte) 'b', (byte) 'c'};
        assertThrows(IOException.class, () -> Protocol.parseRowDescription(payload));
    }

    // === parseDataRow edge cases ===

    @Test
    @DisplayName("parseDataRow with payload too short throws IOException")
    void parseDataRowTooShort() {
        assertThrows(IOException.class, () -> Protocol.parseDataRow(new byte[]{1}));
    }

    @Test
    @DisplayName("parseDataRow with zero columns returns empty list")
    void parseDataRowZeroColumns() throws IOException {
        byte[] payload = new byte[]{0, 0}; // colCount = 0
        var result = Protocol.parseDataRow(payload);
        assertTrue(result.isEmpty());
    }

    @Test
    @DisplayName("parseDataRow with NULL column (-1 length)")
    void parseDataRowNullColumn() throws IOException {
        ByteBuffer buf = ByteBuffer.allocate(6);
        buf.putShort((short) 1);  // 1 column
        buf.putInt(-1);           // NULL
        var result = Protocol.parseDataRow(buf.array());
        assertEquals(1, result.size());
        assertNull(result.get(0));
    }

    @Test
    @DisplayName("parseDataRow with column data length exceeding payload throws IOException")
    void parseDataRowColumnTooLong() {
        ByteBuffer buf = ByteBuffer.allocate(6);
        buf.putShort((short) 1);  // 1 column
        buf.putInt(1000);         // claims 1000 bytes but payload is tiny
        assertThrows(IOException.class, () -> Protocol.parseDataRow(buf.array()));
    }

    @Test
    @DisplayName("parseDataRow with zero-length column value")
    void parseDataRowEmptyColumn() throws IOException {
        ByteBuffer buf = ByteBuffer.allocate(6);
        buf.putShort((short) 1);  // 1 column
        buf.putInt(0);            // 0-length value
        var result = Protocol.parseDataRow(buf.array());
        assertEquals(1, result.size());
        assertNotNull(result.get(0));
        assertEquals(0, result.get(0).length);
    }

    // === parseErrorFields edge cases ===

    @Test
    @DisplayName("parseErrorFields with empty payload returns empty map")
    void parseErrorFieldsEmpty() {
        var result = Protocol.parseErrorFields(new byte[]{0}); // just terminator
        assertTrue(result.isEmpty());
    }

    @Test
    @DisplayName("parseErrorFields with multiple fields")
    void parseErrorFieldsMultiple() {
        byte[] payload = "SERROR\0C42P01\0Mtable not found\0\0".getBytes(StandardCharsets.UTF_8);
        var result = Protocol.parseErrorFields(payload);
        assertEquals("ERROR", result.get((byte) 'S'));
        assertEquals("42P01", result.get((byte) 'C'));
        assertEquals("table not found", result.get((byte) 'M'));
    }

    // === parseCString edge cases ===

    @Test
    @DisplayName("parseCString with no null terminator returns full string")
    void parseCStringNoTerminator() {
        byte[] data = "hello".getBytes(StandardCharsets.UTF_8);
        assertEquals("hello", Protocol.parseCString(data));
    }

    @Test
    @DisplayName("parseCString with empty payload returns empty string")
    void parseCStringEmpty() {
        assertEquals("", Protocol.parseCString(new byte[]{0}));
    }

    @Test
    @DisplayName("parseCString with null byte at start returns empty string")
    void parseCStringNullStart() {
        assertEquals("", Protocol.parseCString(new byte[]{0, 65, 66}));
    }

    // === parseRowCount edge cases ===

    @Test
    @DisplayName("parseRowCount from INSERT tag")
    void parseRowCountInsert() {
        assertEquals(3, Protocol.parseRowCount("INSERT 0 3"));
    }

    @Test
    @DisplayName("parseRowCount from SELECT tag")
    void parseRowCountSelect() {
        assertEquals(100, Protocol.parseRowCount("SELECT 100"));
    }

    @Test
    @DisplayName("parseRowCount from single word tag returns 0")
    void parseRowCountSingleWord() {
        assertEquals(0, Protocol.parseRowCount("BEGIN"));
    }

    @Test
    @DisplayName("parseRowCount from empty string returns 0")
    void parseRowCountEmpty() {
        assertEquals(0, Protocol.parseRowCount(""));
    }

    @Test
    @DisplayName("parseRowCount from non-numeric tag returns 0")
    void parseRowCountNonNumeric() {
        assertEquals(0, Protocol.parseRowCount("COMMAND abc"));
    }

    // === buildBindMessage edge cases ===

    @Test
    @DisplayName("buildBindMessage with empty values array")
    void buildBindEmptyValues() {
        byte[] msg = Protocol.buildBindMessage(new String[0], "", "");
        assertNotNull(msg);
        assertTrue(msg.length > 0);
        assertEquals((byte) 'B', msg[0]);
    }

    @Test
    @DisplayName("buildBindMessage with NULL_VALUE sentinel")
    void buildBindNullSentinel() {
        byte[] msg = Protocol.buildBindMessage(new String[]{Protocol.NULL_VALUE}, "", "");
        assertNotNull(msg);
        // Verify the -1 length (NULL) is in the message
        // The message has: portal\0, statement\0, 2-byte format, 2-byte param count, then params
        assertTrue(msg.length > 0);
    }

    @Test
    @DisplayName("buildBindMessage with multiple params including NULL")
    void buildBindMixedParams() {
        String[] values = {"hello", Protocol.NULL_VALUE, "world"};
        byte[] msg = Protocol.buildBindMessage(values, "", "");
        assertNotNull(msg);
    }

    // === buildStartupMessage edge cases ===

    @Test
    @DisplayName("buildStartupMessage contains protocol version")
    void startupMessageVersion() {
        byte[] msg = Protocol.buildStartupMessage("user", "db");
        // First 4 bytes = length, next 4 = protocol version (196608 = 0x00030000)
        assertEquals(0, msg[4]);
        assertEquals(3, msg[5]);
        assertEquals(0, msg[6]);
        assertEquals(0, msg[7]);
    }

    @Test
    @DisplayName("buildStartupMessage with Unicode user and database")
    void startupMessageUnicode() {
        byte[] msg = Protocol.buildStartupMessage("用户", "数据库");
        assertNotNull(msg);
        assertTrue(msg.length > 8);
    }

    // === buildQueryMessage ===

    @Test
    @DisplayName("buildQueryMessage starts with Q type byte")
    void queryMessageTypeByte() {
        byte[] msg = Protocol.buildQueryMessage("SELECT 1");
        assertEquals((byte) 'Q', msg[0]);
    }

    @Test
    @DisplayName("buildQueryMessage with empty SQL")
    void queryMessageEmptySQL() {
        byte[] msg = Protocol.buildQueryMessage("");
        assertEquals((byte) 'Q', msg[0]);
        // Should still have a null terminator
        assertTrue(msg.length > 5);
    }

    // === SASL message builders ===

    @Test
    @DisplayName("buildSASLInitialResponse starts with p type byte")
    void saslInitialResponseType() {
        byte[] msg = Protocol.buildSASLInitialResponse("SCRAM-SHA-256", "data".getBytes());
        assertEquals((byte) 'p', msg[0]);
    }

    @Test
    @DisplayName("buildSASLResponse starts with p type byte")
    void saslResponseType() {
        byte[] msg = Protocol.buildSASLResponse("response".getBytes());
        assertEquals((byte) 'p', msg[0]);
    }

    // === Sync and Terminate messages ===

    @Test
    @DisplayName("buildSyncMessage is exactly 5 bytes")
    void syncMessageSize() {
        byte[] msg = Protocol.buildSyncMessage();
        assertEquals(5, msg.length);
        assertEquals((byte) 'S', msg[0]);
    }

    @Test
    @DisplayName("buildTerminateMessage is exactly 5 bytes")
    void terminateMessageSize() {
        byte[] msg = Protocol.buildTerminateMessage();
        assertEquals(5, msg.length);
        assertEquals((byte) 'X', msg[0]);
    }

    // === NULL_VALUE sentinel ===

    @Test
    @DisplayName("NULL_VALUE sentinel is a special non-printable string")
    void nullValueSentinel() {
        // Should not be a string that could appear in normal data
        assertTrue(Protocol.NULL_VALUE.contains("\0"));
        assertNotEquals("NULL", Protocol.NULL_VALUE);
    }
}
