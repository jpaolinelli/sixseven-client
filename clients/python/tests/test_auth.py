"""Tests for SCRAM-SHA-256 authentication (RFC 5802)."""

from __future__ import annotations

import base64
import hashlib
import hmac

import pytest

from giodb.auth import (
    ScramClientState,
    scram_client_final,
    scram_client_first,
    scram_verify_server,
    _hi,
    _hmac_sha256,
    _h,
    _xor,
)


class TestHelperFunctions:
    def test_hi_known_vector(self):
        # PBKDF2 with known inputs
        result = _hi(b"password", b"salt", 4096)
        assert len(result) == 32  # SHA-256 produces 32 bytes
        # Known PBKDF2-SHA-256 test vector
        expected = hashlib.pbkdf2_hmac("sha256", b"password", b"salt", 4096)
        assert result == expected

    def test_hmac_sha256(self):
        key = b"key"
        msg = b"message"
        expected = hmac.new(key, msg, hashlib.sha256).digest()
        assert _hmac_sha256(key, msg) == expected

    def test_h(self):
        data = b"test"
        expected = hashlib.sha256(data).digest()
        assert _h(data) == expected

    def test_xor(self):
        a = b"\x01\x02\x03"
        b_val = b"\x04\x05\x06"
        result = _xor(a, b_val)
        assert result == bytes([5, 7, 5])

    def test_xor_same(self):
        a = b"\xff\xff"
        result = _xor(a, a)
        assert result == b"\x00\x00"


class TestScramClientFirst:
    def test_generates_message(self):
        state = scram_client_first("user", "password")
        assert state.username == "user"
        assert state.password == "password"
        assert state.client_nonce  # non-empty
        assert state.client_first_message.startswith(b"n,,n=user,r=")

    def test_custom_nonce(self):
        state = scram_client_first("user", "pass", nonce="testnonce")
        assert state.client_nonce == "testnonce"
        assert state.client_first_message == b"n,,n=user,r=testnonce"
        assert state.client_first_message_bare == "n=user,r=testnonce"

    def test_unique_nonces(self):
        state1 = scram_client_first("user", "pass")
        state2 = scram_client_first("user", "pass")
        assert state1.client_nonce != state2.client_nonce


class TestScramFullHandshake:
    """Test the full SCRAM-SHA-256 handshake with known test vectors."""

    def _simulate_server_first(
        self, client_nonce: str, password: str, salt: bytes, iterations: int
    ) -> tuple[bytes, bytes]:
        """Simulate a server generating the server-first-message."""
        server_nonce = client_nonce + "servernonce"
        salt_b64 = base64.b64encode(salt).decode("ascii")
        server_first = f"r={server_nonce},s={salt_b64},i={iterations}"

        # Also compute server key for verification
        salted_password = _hi(password.encode("utf-8"), salt, iterations)
        server_key = _hmac_sha256(salted_password, b"Server Key")

        return server_first.encode("utf-8"), server_key

    def _simulate_server_final(
        self, server_key: bytes, auth_message: str
    ) -> bytes:
        """Simulate a server generating the server-final-message."""
        server_signature = _hmac_sha256(server_key, auth_message.encode("utf-8"))
        sig_b64 = base64.b64encode(server_signature).decode("ascii")
        return f"v={sig_b64}".encode("utf-8")

    def test_full_handshake(self):
        username = "testuser"
        password = "testpassword"
        salt = b"randomsaltvalue!"
        iterations = 4096

        # Step 1: Client first
        state = scram_client_first(username, password, nonce="clientnonce123")

        # Step 2: Simulate server first
        server_first, server_key = self._simulate_server_first(
            state.client_nonce, password, salt, iterations
        )

        # Step 3: Client final
        client_final = scram_client_final(state, server_first)
        assert isinstance(client_final, bytes)
        client_final_str = client_final.decode("utf-8")

        # Should contain channel binding and nonce
        assert "c=" in client_final_str
        assert "r=" in client_final_str
        assert "p=" in client_final_str

        # Step 4: Simulate server final and verify
        server_final = self._simulate_server_final(server_key, state.auth_message)
        assert scram_verify_server(state, server_final) is True

    def test_nonce_validation(self):
        state = scram_client_first("user", "pass", nonce="clientnonce")

        # Server nonce that doesn't start with client nonce
        bad_server_first = b"r=wrongnonce,s=c2FsdA==,i=4096"
        with pytest.raises(ValueError, match="nonce"):
            scram_client_final(state, bad_server_first)

    def test_server_signature_verification_failure(self):
        state = scram_client_first("user", "pass", nonce="clientnonce")

        server_first = (
            f"r=clientnonceservernonce,s={base64.b64encode(b'salt').decode()},i=4096"
        ).encode("utf-8")

        scram_client_final(state, server_first)

        # Tampered server final
        tampered = b"v=" + base64.b64encode(b"wrongsignature" + b"\x00" * 18)
        assert scram_verify_server(state, tampered) is False

    def test_invalid_server_final_format(self):
        state = scram_client_first("user", "pass", nonce="cn")
        server_first = f"r=cnserver,s={base64.b64encode(b'salt').decode()},i=4096".encode()
        scram_client_final(state, server_first)

        # Missing v= prefix
        assert scram_verify_server(state, b"bad_format") is False

    def test_different_iterations(self):
        """Ensure different iteration counts produce different results."""
        state1 = scram_client_first("user", "pass", nonce="nonce1")
        state2 = scram_client_first("user", "pass", nonce="nonce1")

        salt_b64 = base64.b64encode(b"salt").decode()

        sf1 = f"r=nonce1server,s={salt_b64},i=4096".encode()
        sf2 = f"r=nonce1server,s={salt_b64},i=8192".encode()

        cf1 = scram_client_final(state1, sf1)
        cf2 = scram_client_final(state2, sf2)

        # Different iteration counts should produce different proofs
        assert cf1 != cf2
