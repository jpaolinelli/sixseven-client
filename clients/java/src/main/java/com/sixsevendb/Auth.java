package com.sixsevendb;

import javax.crypto.Mac;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.sql.SQLException;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;

/**
 * Authentication implementations: Trust, MD5, SCRAM-SHA-256.
 */
final class Auth {

    private Auth() {}

    /**
     * Builds an MD5 authentication response.
     * Format: "md5" + md5(md5(password + user) + salt)
     */
    static String buildMD5Password(String user, String password, byte[] salt) {
        try {
            MessageDigest md5 = MessageDigest.getInstance("MD5");
            md5.update((password + user).getBytes(StandardCharsets.UTF_8));
            String innerHex = hexString(md5.digest());

            md5.reset();
            md5.update(innerHex.getBytes(StandardCharsets.UTF_8));
            md5.update(salt);
            return "md5" + hexString(md5.digest());
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException("MD5 not available", e);
        }
    }

    /** Tracks state across the SCRAM-SHA-256 handshake. */
    static final class ScramState {
        final String username;
        final String password;
        final String clientNonce;
        final String clientFirstMessageBare;
        String serverNonce;
        byte[] salt;
        int iterations;
        String authMessage;
        byte[] serverKey;

        ScramState(String username, String password, String clientNonce, String clientFirstMessageBare) {
            this.username = username;
            this.password = password;
            this.clientNonce = clientNonce;
            this.clientFirstMessageBare = clientFirstMessageBare;
        }
    }

    /** Builds the client-first-message for SCRAM-SHA-256. Returns [state, clientFirstMessage]. */
    static Object[] scramClientFirst(String username, String password) {
        byte[] nonceBytes = new byte[18];
        new SecureRandom().nextBytes(nonceBytes);
        String clientNonce = Base64.getEncoder().encodeToString(nonceBytes);

        String clientFirstBare = "n=" + username + ",r=" + clientNonce;
        String clientFirstMessage = "n,," + clientFirstBare;

        ScramState state = new ScramState(username, password, clientNonce, clientFirstBare);
        return new Object[]{state, clientFirstMessage.getBytes(StandardCharsets.UTF_8)};
    }

    /** Processes the server-first-message and returns the client-final-message. */
    static byte[] scramClientFinal(ScramState state, byte[] serverFirstMessage) throws SQLException {
        String serverMsg = new String(serverFirstMessage, StandardCharsets.UTF_8);
        Map<Character, String> parts = parseScramAttributes(serverMsg);

        String serverNonce = parts.get('r');
        if (serverNonce == null) {
            throw new SQLException("sixsevendb: SCRAM server-first-message missing nonce");
        }
        String saltB64 = parts.get('s');
        if (saltB64 == null) {
            throw new SQLException("sixsevendb: SCRAM server-first-message missing salt");
        }
        String iterStr = parts.get('i');
        if (iterStr == null) {
            throw new SQLException("sixsevendb: SCRAM server-first-message missing iterations");
        }

        if (!serverNonce.startsWith(state.clientNonce)) {
            throw new SQLException("sixsevendb: server nonce does not start with client nonce");
        }

        byte[] salt;
        try {
            salt = Base64.getDecoder().decode(saltB64);
        } catch (IllegalArgumentException e) {
            throw new SQLException("sixsevendb: invalid SCRAM salt: " + e.getMessage());
        }
        int iterations;
        try {
            iterations = Integer.parseInt(iterStr);
        } catch (NumberFormatException e) {
            throw new SQLException("sixsevendb: invalid SCRAM iterations: " + e.getMessage());
        }

        state.serverNonce = serverNonce;
        state.salt = salt;
        state.iterations = iterations;

        try {
            // SaltedPassword = PBKDF2(password, salt, iterations, 32)
            byte[] saltedPassword = pbkdf2(state.password, salt, iterations);

            // ClientKey = HMAC(SaltedPassword, "Client Key")
            byte[] clientKey = hmacSHA256(saltedPassword, "Client Key".getBytes(StandardCharsets.UTF_8));

            // StoredKey = SHA-256(ClientKey)
            byte[] storedKey = sha256(clientKey);

            // ServerKey = HMAC(SaltedPassword, "Server Key")
            byte[] serverKey = hmacSHA256(saltedPassword, "Server Key".getBytes(StandardCharsets.UTF_8));
            state.serverKey = serverKey;

            // channel-binding = base64("n,,")
            String channelBinding = Base64.getEncoder().encodeToString("n,,".getBytes(StandardCharsets.UTF_8));

            // client-final-message-without-proof
            String clientFinalNoProof = "c=" + channelBinding + ",r=" + serverNonce;

            // AuthMessage
            String authMessage = state.clientFirstMessageBare + "," + serverMsg + "," + clientFinalNoProof;
            state.authMessage = authMessage;

            // ClientSignature = HMAC(StoredKey, AuthMessage)
            byte[] clientSignature = hmacSHA256(storedKey, authMessage.getBytes(StandardCharsets.UTF_8));

            // ClientProof = ClientKey XOR ClientSignature
            byte[] clientProof = xorBytes(clientKey, clientSignature);
            String proofB64 = Base64.getEncoder().encodeToString(clientProof);

            String clientFinalMessage = clientFinalNoProof + ",p=" + proofB64;
            return clientFinalMessage.getBytes(StandardCharsets.UTF_8);
        } catch (Exception e) {
            throw new SQLException("sixsevendb: SCRAM computation failed: " + e.getMessage());
        }
    }

    /** Verifies the server's final signature. */
    static boolean scramVerifyServer(ScramState state, byte[] serverFinalMessage) {
        String serverMsg = new String(serverFinalMessage, StandardCharsets.UTF_8);
        if (!serverMsg.startsWith("v=")) {
            return false;
        }
        String serverSignatureB64 = serverMsg.substring(2);
        byte[] serverSignature;
        try {
            serverSignature = Base64.getDecoder().decode(serverSignatureB64);
        } catch (IllegalArgumentException e) {
            return false;
        }
        if (state.serverKey == null || state.authMessage == null) {
            return false;
        }
        try {
            byte[] expected = hmacSHA256(state.serverKey, state.authMessage.getBytes(StandardCharsets.UTF_8));
            return MessageDigest.isEqual(serverSignature, expected);
        } catch (Exception e) {
            return false;
        }
    }

    // --- Internal helpers ---

    static Map<Character, String> parseScramAttributes(String msg) {
        Map<Character, String> parts = new HashMap<>();
        for (String part : msg.split(",")) {
            if (part.length() >= 2 && part.charAt(1) == '=') {
                parts.put(part.charAt(0), part.substring(2));
            }
        }
        return parts;
    }

    static byte[] hmacSHA256(byte[] key, byte[] message) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(key, "HmacSHA256"));
        return mac.doFinal(message);
    }

    static byte[] sha256(byte[] data) throws NoSuchAlgorithmException {
        return MessageDigest.getInstance("SHA-256").digest(data);
    }

    static byte[] pbkdf2(String password, byte[] salt, int iterations) throws Exception {
        PBEKeySpec spec = new PBEKeySpec(password.toCharArray(), salt, iterations, 256);
        SecretKeyFactory factory = SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256");
        return factory.generateSecret(spec).getEncoded();
    }

    static byte[] xorBytes(byte[] a, byte[] b) {
        byte[] result = new byte[a.length];
        for (int i = 0; i < a.length; i++) {
            result[i] = (byte) (a[i] ^ b[i]);
        }
        return result;
    }

    private static String hexString(byte[] bytes) {
        StringBuilder sb = new StringBuilder(bytes.length * 2);
        for (byte b : bytes) {
            sb.append(String.format("%02x", b & 0xFF));
        }
        return sb.toString();
    }
}
