package com.sixsevendb;

import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class ProtocolTest {

    @Test
    void testBuildStartupMessage() {
        byte[] msg = Protocol.buildStartupMessage("testuser", "testdb");
        assertNotNull(msg);
        assertTrue(msg.length > 8);
        // First 4 bytes: length, next 4 bytes: protocol version
        ByteBuffer buf = ByteBuffer.wrap(msg);
        int length = buf.getInt();
        assertEquals(msg.length, length);
        int version = buf.getInt();
        assertEquals(Protocol.PROTOCOL_VERSION, version);
        // Rest should contain "user\0testuser\0database\0testdb\0\0"
        String params = new String(msg, 8, msg.length - 8, StandardCharsets.UTF_8);
        assertTrue(params.contains("user"));
        assertTrue(params.contains("testuser"));
        assertTrue(params.contains("database"));
        assertTrue(params.contains("testdb"));
    }

    @Test
    void testBuildPasswordMessage() {
        byte[] msg = Protocol.buildPasswordMessage("secret");
        assertEquals('p', msg[0]);
        ByteBuffer buf = ByteBuffer.wrap(msg, 1, 4);
        int length = buf.getInt();
        assertEquals(msg.length - 1, length);
    }

    @Test
    void testBuildQueryMessage() {
        byte[] msg = Protocol.buildQueryMessage("SELECT 1");
        assertEquals('Q', msg[0]);
        ByteBuffer buf = ByteBuffer.wrap(msg, 1, 4);
        int length = buf.getInt();
        assertEquals(msg.length - 1, length);
        // Check SQL is in the payload
        String payload = new String(msg, 5, msg.length - 5, StandardCharsets.UTF_8);
        assertTrue(payload.startsWith("SELECT 1"));
    }

    @Test
    void testBuildParseMessage() {
        byte[] msg = Protocol.buildParseMessage("SELECT $1", "");
        assertEquals('P', msg[0]);
        assertTrue(msg.length > 5);
    }

    @Test
    void testBuildBindMessage() {
        byte[] msg = Protocol.buildBindMessage(new String[]{"hello", "42"}, "", "");
        assertEquals('B', msg[0]);
        assertTrue(msg.length > 5);
    }

    @Test
    void testBuildBindMessageWithNull() {
        byte[] msg = Protocol.buildBindMessage(new String[]{Protocol.NULL_VALUE}, "", "");
        assertEquals('B', msg[0]);
        assertTrue(msg.length > 5);
    }

    @Test
    void testBuildDescribeMessage() {
        byte[] msg = Protocol.buildDescribeMessage((byte) 'P', "");
        assertEquals('D', msg[0]);
    }

    @Test
    void testBuildExecuteMessage() {
        byte[] msg = Protocol.buildExecuteMessage("", 0);
        assertEquals('E', msg[0]);
    }

    @Test
    void testBuildSyncMessage() {
        byte[] msg = Protocol.buildSyncMessage();
        assertEquals(5, msg.length);
        assertEquals('S', msg[0]);
    }

    @Test
    void testBuildTerminateMessage() {
        byte[] msg = Protocol.buildTerminateMessage();
        assertEquals(5, msg.length);
        assertEquals('X', msg[0]);
    }

    @Test
    void testBuildSASLInitialResponse() {
        byte[] clientFirst = "n,,n=user,r=nonce".getBytes(StandardCharsets.UTF_8);
        byte[] msg = Protocol.buildSASLInitialResponse("SCRAM-SHA-256", clientFirst);
        assertEquals('p', msg[0]);
        assertTrue(msg.length > 5);
    }

    @Test
    void testBuildSASLResponse() {
        byte[] clientFinal = "c=biws,r=nonce,p=proof".getBytes(StandardCharsets.UTF_8);
        byte[] msg = Protocol.buildSASLResponse(clientFinal);
        assertEquals('p', msg[0]);
    }

    @Test
    void testParseErrorFields() {
        // Build an error response: S\0ERROR\0C\023000\0M\0test error\0\0
        byte[] payload = "SERROR\0C23000\0Mtest error\0\0".getBytes(StandardCharsets.UTF_8);
        Map<Byte, String> fields = Protocol.parseErrorFields(payload);
        assertEquals("ERROR", fields.get((byte) 'S'));
        assertEquals("23000", fields.get((byte) 'C'));
        assertEquals("test error", fields.get((byte) 'M'));
    }

    @Test
    void testParseRowDescription() throws IOException {
        // Build a row description: 1 field, name="id", tableOID=0, colIdx=0, typeOID=23 (INT4), typeSize=4, typeMod=-1, fmtCode=0
        ByteBuffer buf = ByteBuffer.allocate(256);
        buf.putShort((short) 1); // field count
        buf.put("id\0".getBytes(StandardCharsets.UTF_8));
        buf.putInt(0); // tableOID
        buf.putShort((short) 0); // colIdx
        buf.putInt(23); // typeOID (INT4)
        buf.putShort((short) 4); // typeSize
        buf.putInt(-1); // typeMod
        buf.putShort((short) 0); // fmtCode
        buf.flip();
        byte[] payload = new byte[buf.remaining()];
        buf.get(payload);

        List<Protocol.FieldDescription> fields = Protocol.parseRowDescription(payload);
        assertEquals(1, fields.size());
        assertEquals("id", fields.get(0).name);
        assertEquals(23, fields.get(0).typeOID);
    }

    @Test
    void testParseDataRow() throws IOException {
        // 2 columns: "hello" and NULL
        ByteBuffer buf = ByteBuffer.allocate(256);
        buf.putShort((short) 2);
        byte[] val1 = "hello".getBytes(StandardCharsets.UTF_8);
        buf.putInt(val1.length);
        buf.put(val1);
        buf.putInt(-1); // NULL
        buf.flip();
        byte[] payload = new byte[buf.remaining()];
        buf.get(payload);

        List<byte[]> values = Protocol.parseDataRow(payload);
        assertEquals(2, values.size());
        assertEquals("hello", new String(values.get(0), StandardCharsets.UTF_8));
        assertNull(values.get(1));
    }

    @Test
    void testParseCString() {
        byte[] payload = "hello world\0extra".getBytes(StandardCharsets.UTF_8);
        assertEquals("hello world", Protocol.parseCString(payload));
    }

    @Test
    void testParseRowCount() {
        assertEquals(5, Protocol.parseRowCount("SELECT 5"));
        assertEquals(3, Protocol.parseRowCount("INSERT 0 3"));
        assertEquals(0, Protocol.parseRowCount("CREATE TABLE"));
    }

    @Test
    void testParseRowDescriptionMultipleFields() throws IOException {
        ByteBuffer buf = ByteBuffer.allocate(512);
        buf.putShort((short) 3); // 3 fields
        for (String name : new String[]{"id", "name", "age"}) {
            buf.put((name + "\0").getBytes(StandardCharsets.UTF_8));
            buf.putInt(0); // tableOID
            buf.putShort((short) 0); // colIdx
            buf.putInt(name.equals("id") ? 23 : (name.equals("name") ? 25 : 23)); // typeOID
            buf.putShort((short) 4); // typeSize
            buf.putInt(-1); // typeMod
            buf.putShort((short) 0); // fmtCode
        }
        buf.flip();
        byte[] payload = new byte[buf.remaining()];
        buf.get(payload);

        List<Protocol.FieldDescription> fields = Protocol.parseRowDescription(payload);
        assertEquals(3, fields.size());
        assertEquals("id", fields.get(0).name);
        assertEquals("name", fields.get(1).name);
        assertEquals("age", fields.get(2).name);
    }
}
