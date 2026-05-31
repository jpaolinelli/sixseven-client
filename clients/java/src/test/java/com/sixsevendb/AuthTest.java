package com.sixsevendb;

import org.junit.jupiter.api.Test;

import java.sql.SQLException;
import java.util.Base64;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class AuthTest {

    @Test
    void testBuildMD5Password() {
        String result = Auth.buildMD5Password("testuser", "testpass", new byte[]{0x01, 0x02, 0x03, 0x04});
        assertTrue(result.startsWith("md5"));
        assertEquals(35, result.length()); // "md5" + 32 hex chars
    }

    @Test
    void testBuildMD5PasswordDeterministic() {
        byte[] salt = new byte[]{(byte) 0xAB, (byte) 0xCD, (byte) 0xEF, 0x01};
        String result1 = Auth.buildMD5Password("user", "pass", salt);
        String result2 = Auth.buildMD5Password("user", "pass", salt);
        assertEquals(result1, result2);
    }

    @Test
    void testBuildMD5PasswordDifferentSalts() {
        byte[] salt1 = new byte[]{0x01, 0x02, 0x03, 0x04};
        byte[] salt2 = new byte[]{0x05, 0x06, 0x07, 0x08};
        String result1 = Auth.buildMD5Password("user", "pass", salt1);
        String result2 = Auth.buildMD5Password("user", "pass", salt2);
        assertNotEquals(result1, result2);
    }

    @Test
    void testScramClientFirst() {
        Object[] result = Auth.scramClientFirst("testuser", "testpass");
        Auth.ScramState state = (Auth.ScramState) result[0];
        byte[] clientFirst = (byte[]) result[1];

        String msg = new String(clientFirst);
        assertTrue(msg.startsWith("n,,"));
        assertTrue(msg.contains("n=testuser"));
        assertTrue(msg.contains("r="));
        assertEquals("testuser", state.username);
        assertEquals("testpass", state.password);
        assertNotNull(state.clientNonce);
        assertFalse(state.clientNonce.isEmpty());
    }

    @Test
    void testScramClientFinal() throws Exception {
        Auth.ScramState state = new Auth.ScramState(
            "user", "pencil", "rOprNGfwEbeRWgbNEkqO", "n=user,r=rOprNGfwEbeRWgbNEkqO"
        );

        String salt = Base64.getEncoder().encodeToString("salt-value-here!".getBytes());
        byte[] serverFirst = ("r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=" + salt + ",i=4096").getBytes();

        byte[] clientFinal = Auth.scramClientFinal(state, serverFirst);
        String msg = new String(clientFinal);
        assertTrue(msg.contains("c="));
        assertTrue(msg.contains("r="));
        assertTrue(msg.contains("p="));
    }

    @Test
    void testScramClientFinalRejectsInvalidNonce() {
        Auth.ScramState state = new Auth.ScramState(
            "user", "pass", "myclientnonce", "n=user,r=myclientnonce"
        );

        String salt = Base64.getEncoder().encodeToString("salt".getBytes());
        byte[] serverFirst = ("r=differentnonce,s=" + salt + ",i=4096").getBytes();

        assertThrows(SQLException.class, () -> Auth.scramClientFinal(state, serverFirst));
    }

    @Test
    void testScramVerifyServer() throws Exception {
        Auth.ScramState state = new Auth.ScramState("u", "p", "n", "b");
        state.serverKey = "some-server-key-32-bytes-long!!!".getBytes();
        state.authMessage = "test-auth-message";

        byte[] expected = Auth.hmacSHA256(state.serverKey, state.authMessage.getBytes());
        String serverFinal = "v=" + Base64.getEncoder().encodeToString(expected);

        assertTrue(Auth.scramVerifyServer(state, serverFinal.getBytes()));
    }

    @Test
    void testScramVerifyServerRejectsInvalid() {
        Auth.ScramState state = new Auth.ScramState("u", "p", "n", "b");
        state.serverKey = "some-server-key-32-bytes-long!!!".getBytes();
        state.authMessage = "test-auth-message";

        String serverFinal = "v=" + Base64.getEncoder().encodeToString("invalid-signature-value-here!!!!".getBytes());
        assertFalse(Auth.scramVerifyServer(state, serverFinal.getBytes()));
    }

    @Test
    void testScramVerifyServerRejectsMalformed() {
        Auth.ScramState state = new Auth.ScramState("u", "p", "n", "b");
        state.serverKey = "key".getBytes();
        state.authMessage = "msg";

        assertFalse(Auth.scramVerifyServer(state, "not-a-valid-message".getBytes()));
    }

    @Test
    void testScramFullHandshake() throws Exception {
        Object[] result = Auth.scramClientFirst("testuser", "testpass");
        Auth.ScramState state = (Auth.ScramState) result[0];
        byte[] clientFirst = (byte[]) result[1];
        assertTrue(clientFirst.length > 0);

        // Simulate server response
        String salt = Base64.getEncoder().encodeToString("randomsaltbytes!".getBytes());
        String serverNonce = state.clientNonce + "servernonce";
        byte[] serverFirst = ("r=" + serverNonce + ",s=" + salt + ",i=4096").getBytes();

        byte[] clientFinal = Auth.scramClientFinal(state, serverFirst);
        assertTrue(clientFinal.length > 0);

        assertEquals(serverNonce, state.serverNonce);
        assertEquals(4096, state.iterations);
        assertNotNull(state.serverKey);
        assertNotNull(state.authMessage);

        // Verify server signature
        byte[] expectedSig = Auth.hmacSHA256(state.serverKey, state.authMessage.getBytes());
        String serverFinal = "v=" + Base64.getEncoder().encodeToString(expectedSig);
        assertTrue(Auth.scramVerifyServer(state, serverFinal.getBytes()));
    }

    @Test
    void testParseScramAttributes() {
        Map<Character, String> attrs = Auth.parseScramAttributes("r=nonce123,s=c2FsdA==,i=4096");
        assertEquals("nonce123", attrs.get('r'));
        assertEquals("c2FsdA==", attrs.get('s'));
        assertEquals("4096", attrs.get('i'));
    }

    @Test
    void testXorBytes() {
        byte[] a = new byte[]{0x0F, (byte) 0xFF, 0x00};
        byte[] b = new byte[]{(byte) 0xF0, (byte) 0xFF, (byte) 0xAA};
        byte[] result = Auth.xorBytes(a, b);
        assertEquals((byte) 0xFF, result[0]);
        assertEquals((byte) 0x00, result[1]);
        assertEquals((byte) 0xAA, result[2]);
    }
}
