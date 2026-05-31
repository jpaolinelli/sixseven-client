package com.sixsevendb;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.DisplayName;

import java.sql.SQLException;
import java.util.Base64;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * QA adversarial tests for Auth — GDB-51.
 * Targets SCRAM-SHA-256 edge cases, MD5 boundary conditions, and error paths.
 */
class QaGdb51AuthTest {

    // === MD5 authentication edge cases ===

    @Test
    @DisplayName("MD5 password always starts with 'md5' prefix")
    void md5PasswordPrefix() {
        String result = Auth.buildMD5Password("user", "pass", new byte[]{1, 2, 3, 4});
        assertTrue(result.startsWith("md5"));
    }

    @Test
    @DisplayName("MD5 password is deterministic")
    void md5PasswordDeterministic() {
        byte[] salt = {0x01, 0x02, 0x03, 0x04};
        String r1 = Auth.buildMD5Password("user", "pass", salt);
        String r2 = Auth.buildMD5Password("user", "pass", salt);
        assertEquals(r1, r2);
    }

    @Test
    @DisplayName("MD5 password changes with different salt")
    void md5PasswordSaltSensitive() {
        String r1 = Auth.buildMD5Password("user", "pass", new byte[]{1, 2, 3, 4});
        String r2 = Auth.buildMD5Password("user", "pass", new byte[]{5, 6, 7, 8});
        assertNotEquals(r1, r2);
    }

    @Test
    @DisplayName("MD5 password changes with different user")
    void md5PasswordUserSensitive() {
        byte[] salt = {1, 2, 3, 4};
        String r1 = Auth.buildMD5Password("user1", "pass", salt);
        String r2 = Auth.buildMD5Password("user2", "pass", salt);
        assertNotEquals(r1, r2);
    }

    @Test
    @DisplayName("MD5 password with empty user")
    void md5PasswordEmptyUser() {
        String result = Auth.buildMD5Password("", "pass", new byte[]{1, 2, 3, 4});
        assertTrue(result.startsWith("md5"));
        assertEquals(35, result.length()); // "md5" + 32 hex chars
    }

    @Test
    @DisplayName("MD5 password with empty password")
    void md5PasswordEmptyPassword() {
        String result = Auth.buildMD5Password("user", "", new byte[]{1, 2, 3, 4});
        assertTrue(result.startsWith("md5"));
        assertEquals(35, result.length());
    }

    @Test
    @DisplayName("MD5 password result is exactly 35 characters (md5 + 32 hex)")
    void md5PasswordLength() {
        String result = Auth.buildMD5Password("user", "password", new byte[]{1, 2, 3, 4});
        assertEquals(35, result.length());
    }

    // === SCRAM-SHA-256 handshake edge cases ===

    @Test
    @DisplayName("scramClientFirst returns non-null state and message")
    void scramClientFirstBasic() {
        Object[] result = Auth.scramClientFirst("user", "pass");
        assertNotNull(result);
        assertEquals(2, result.length);
        assertInstanceOf(Auth.ScramState.class, result[0]);
        assertInstanceOf(byte[].class, result[1]);
    }

    @Test
    @DisplayName("scramClientFirst message starts with n,,")
    void scramClientFirstFormat() {
        Object[] result = Auth.scramClientFirst("user", "pass");
        String msg = new String((byte[]) result[1]);
        assertTrue(msg.startsWith("n,,"));
        assertTrue(msg.contains("n=user"));
        assertTrue(msg.contains(",r="));
    }

    @Test
    @DisplayName("scramClientFirst generates unique nonces")
    void scramClientFirstUniqueNonces() {
        Object[] r1 = Auth.scramClientFirst("user", "pass");
        Object[] r2 = Auth.scramClientFirst("user", "pass");
        Auth.ScramState s1 = (Auth.ScramState) r1[0];
        Auth.ScramState s2 = (Auth.ScramState) r2[0];
        assertNotEquals(s1.clientNonce, s2.clientNonce);
    }

    @Test
    @DisplayName("scramClientFinal rejects server nonce not starting with client nonce")
    void scramClientFinalBadNonce() {
        Object[] first = Auth.scramClientFirst("user", "pass");
        Auth.ScramState state = (Auth.ScramState) first[0];

        String salt = Base64.getEncoder().encodeToString("testsalt".getBytes());
        String serverFirst = "r=COMPLETELY_DIFFERENT_NONCE,s=" + salt + ",i=4096";

        assertThrows(SQLException.class, () ->
            Auth.scramClientFinal(state, serverFirst.getBytes()));
    }

    @Test
    @DisplayName("scramClientFinal rejects missing nonce")
    void scramClientFinalMissingNonce() {
        Object[] first = Auth.scramClientFirst("user", "pass");
        Auth.ScramState state = (Auth.ScramState) first[0];

        String salt = Base64.getEncoder().encodeToString("testsalt".getBytes());
        String serverFirst = "s=" + salt + ",i=4096"; // missing r=

        assertThrows(SQLException.class, () ->
            Auth.scramClientFinal(state, serverFirst.getBytes()));
    }

    @Test
    @DisplayName("scramClientFinal rejects missing salt")
    void scramClientFinalMissingSalt() {
        Object[] first = Auth.scramClientFirst("user", "pass");
        Auth.ScramState state = (Auth.ScramState) first[0];

        String serverFirst = "r=" + state.clientNonce + "server_extra,i=4096"; // missing s=

        assertThrows(SQLException.class, () ->
            Auth.scramClientFinal(state, serverFirst.getBytes()));
    }

    @Test
    @DisplayName("scramClientFinal rejects missing iterations")
    void scramClientFinalMissingIterations() {
        Object[] first = Auth.scramClientFirst("user", "pass");
        Auth.ScramState state = (Auth.ScramState) first[0];

        String salt = Base64.getEncoder().encodeToString("testsalt".getBytes());
        String serverFirst = "r=" + state.clientNonce + "server_extra,s=" + salt; // missing i=

        assertThrows(SQLException.class, () ->
            Auth.scramClientFinal(state, serverFirst.getBytes()));
    }

    @Test
    @DisplayName("scramClientFinal rejects invalid base64 salt")
    void scramClientFinalInvalidSalt() {
        Object[] first = Auth.scramClientFirst("user", "pass");
        Auth.ScramState state = (Auth.ScramState) first[0];

        String serverFirst = "r=" + state.clientNonce + "server_extra,s=!!!INVALID!!!,i=4096";

        assertThrows(SQLException.class, () ->
            Auth.scramClientFinal(state, serverFirst.getBytes()));
    }

    @Test
    @DisplayName("scramClientFinal rejects non-numeric iterations")
    void scramClientFinalNonNumericIterations() {
        Object[] first = Auth.scramClientFirst("user", "pass");
        Auth.ScramState state = (Auth.ScramState) first[0];

        String salt = Base64.getEncoder().encodeToString("testsalt".getBytes());
        String serverFirst = "r=" + state.clientNonce + "server_extra,s=" + salt + ",i=abc";

        assertThrows(SQLException.class, () ->
            Auth.scramClientFinal(state, serverFirst.getBytes()));
    }

    @Test
    @DisplayName("Full SCRAM handshake simulation produces valid client-final")
    void scramFullHandshake() throws Exception {
        Object[] first = Auth.scramClientFirst("user", "password");
        Auth.ScramState state = (Auth.ScramState) first[0];

        String salt = Base64.getEncoder().encodeToString("test_salt_bytes!".getBytes());
        String serverFirst = "r=" + state.clientNonce + "SERVER_EXTRA_NONCE,s=" + salt + ",i=4096";

        byte[] clientFinal = Auth.scramClientFinal(state, serverFirst.getBytes());
        assertNotNull(clientFinal);
        String clientFinalStr = new String(clientFinal);
        assertTrue(clientFinalStr.startsWith("c="));
        assertTrue(clientFinalStr.contains(",r="));
        assertTrue(clientFinalStr.contains(",p="));
    }

    // === scramVerifyServer edge cases ===

    @Test
    @DisplayName("scramVerifyServer rejects message not starting with v=")
    void verifyServerBadFormat() {
        Auth.ScramState state = new Auth.ScramState("user", "pass", "nonce", "bare");
        assertFalse(Auth.scramVerifyServer(state, "invalid".getBytes()));
    }

    @Test
    @DisplayName("scramVerifyServer rejects invalid base64 signature")
    void verifyServerInvalidBase64() {
        Auth.ScramState state = new Auth.ScramState("user", "pass", "nonce", "bare");
        assertFalse(Auth.scramVerifyServer(state, "v=!!!INVALID!!!".getBytes()));
    }

    @Test
    @DisplayName("scramVerifyServer returns false when state has no serverKey")
    void verifyServerNoServerKey() {
        Auth.ScramState state = new Auth.ScramState("user", "pass", "nonce", "bare");
        state.serverKey = null;
        state.authMessage = "some_message";
        assertFalse(Auth.scramVerifyServer(state, "v=dGVzdA==".getBytes()));
    }

    @Test
    @DisplayName("scramVerifyServer returns false when state has no authMessage")
    void verifyServerNoAuthMessage() {
        Auth.ScramState state = new Auth.ScramState("user", "pass", "nonce", "bare");
        state.serverKey = new byte[]{1, 2, 3};
        state.authMessage = null;
        assertFalse(Auth.scramVerifyServer(state, "v=dGVzdA==".getBytes()));
    }

    // === parseScramAttributes edge cases ===

    @Test
    @DisplayName("parseScramAttributes parses standard format")
    void parseScramAttributesStandard() {
        Map<Character, String> result = Auth.parseScramAttributes("r=nonce,s=salt,i=4096");
        assertEquals("nonce", result.get('r'));
        assertEquals("salt", result.get('s'));
        assertEquals("4096", result.get('i'));
    }

    @Test
    @DisplayName("parseScramAttributes handles empty string")
    void parseScramAttributesEmpty() {
        Map<Character, String> result = Auth.parseScramAttributes("");
        assertTrue(result.isEmpty());
    }

    @Test
    @DisplayName("parseScramAttributes skips malformed parts")
    void parseScramAttributesMalformed() {
        Map<Character, String> result = Auth.parseScramAttributes("r=nonce,badpart,s=salt");
        assertEquals("nonce", result.get('r'));
        assertEquals("salt", result.get('s'));
        assertNull(result.get('b')); // "badpart" should be skipped
    }

    @Test
    @DisplayName("parseScramAttributes handles value with '=' sign")
    void parseScramAttributesValueWithEquals() {
        Map<Character, String> result = Auth.parseScramAttributes("v=abc=def==");
        assertEquals("abc=def==", result.get('v'));
    }

    // === xorBytes edge cases ===

    @Test
    @DisplayName("xorBytes XOR identity: a XOR a = 0")
    void xorBytesIdentity() {
        byte[] a = {1, 2, 3, 4};
        byte[] result = Auth.xorBytes(a, a);
        assertArrayEquals(new byte[]{0, 0, 0, 0}, result);
    }

    @Test
    @DisplayName("xorBytes XOR with zero: a XOR 0 = a")
    void xorBytesWithZero() {
        byte[] a = {1, 2, 3, 4};
        byte[] zero = {0, 0, 0, 0};
        byte[] result = Auth.xorBytes(a, zero);
        assertArrayEquals(a, result);
    }

    @Test
    @DisplayName("BUG: xorBytes with different length arrays throws ArrayIndexOutOfBoundsException")
    void xorBytesDifferentLengths() {
        byte[] a = {1, 2, 3, 4, 5};
        byte[] b = {1, 2, 3};
        // Uses a.length for loop bound but accesses b[i] — will fail at i=3
        assertThrows(ArrayIndexOutOfBoundsException.class, () -> Auth.xorBytes(a, b));
    }

    @Test
    @DisplayName("xorBytes with empty arrays")
    void xorBytesEmpty() {
        byte[] result = Auth.xorBytes(new byte[0], new byte[0]);
        assertEquals(0, result.length);
    }

    // === hmacSHA256 edge cases ===

    @Test
    @DisplayName("hmacSHA256 produces 32-byte output")
    void hmacSha256OutputLength() throws Exception {
        byte[] result = Auth.hmacSHA256(
            "key".getBytes(), "message".getBytes());
        assertEquals(32, result.length);
    }

    @Test
    @DisplayName("hmacSHA256 is deterministic")
    void hmacSha256Deterministic() throws Exception {
        byte[] key = "key".getBytes();
        byte[] msg = "message".getBytes();
        byte[] r1 = Auth.hmacSHA256(key, msg);
        byte[] r2 = Auth.hmacSHA256(key, msg);
        assertArrayEquals(r1, r2);
    }

    // === sha256 edge cases ===

    @Test
    @DisplayName("sha256 produces 32-byte output")
    void sha256OutputLength() throws Exception {
        byte[] result = Auth.sha256("hello".getBytes());
        assertEquals(32, result.length);
    }

    // === pbkdf2 edge cases ===

    @Test
    @DisplayName("pbkdf2 produces 32-byte output")
    void pbkdf2OutputLength() throws Exception {
        byte[] result = Auth.pbkdf2("password", "salt".getBytes(), 4096);
        assertEquals(32, result.length);
    }

    @Test
    @DisplayName("pbkdf2 is deterministic")
    void pbkdf2Deterministic() throws Exception {
        byte[] r1 = Auth.pbkdf2("pass", "salt".getBytes(), 4096);
        byte[] r2 = Auth.pbkdf2("pass", "salt".getBytes(), 4096);
        assertArrayEquals(r1, r2);
    }
}
