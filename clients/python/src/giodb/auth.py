"""SCRAM-SHA-256 authentication implementation (RFC 5802).

Provides the full SASL/SCRAM-SHA-256 handshake for authenticating
with SixSevenDB servers that require it.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
from dataclasses import dataclass


def _hi(password: bytes, salt: bytes, iterations: int) -> bytes:
    """PBKDF2-SHA-256 key derivation (Hi function from RFC 5802)."""
    return hashlib.pbkdf2_hmac("sha256", password, salt, iterations)


def _hmac_sha256(key: bytes, msg: bytes) -> bytes:
    """HMAC-SHA-256."""
    return hmac.new(key, msg, hashlib.sha256).digest()


def _h(data: bytes) -> bytes:
    """SHA-256 hash."""
    return hashlib.sha256(data).digest()


def _xor(a: bytes, b: bytes) -> bytes:
    """XOR two byte strings of equal length."""
    return bytes(x ^ y for x, y in zip(a, b))


@dataclass
class ScramClientState:
    """Internal state tracked across the SCRAM handshake."""

    username: str
    password: str
    client_nonce: str
    client_first_message_bare: str
    client_first_message: bytes
    server_nonce: str | None = None
    salt: bytes | None = None
    iterations: int | None = None
    auth_message: str | None = None
    server_key: bytes | None = None


def scram_client_first(username: str, password: str, nonce: str | None = None) -> ScramClientState:
    """Build the client-first-message for SCRAM-SHA-256.

    Returns a ScramClientState with the message ready to send.
    """
    if nonce is None:
        nonce = base64.b64encode(os.urandom(18)).decode("ascii")

    # n=username,r=client-nonce
    client_first_message_bare = f"n={username},r={nonce}"
    # gs2-header is "n,," for no channel binding
    client_first_message = f"n,,{client_first_message_bare}"

    return ScramClientState(
        username=username,
        password=password,
        client_nonce=nonce,
        client_first_message_bare=client_first_message_bare,
        client_first_message=client_first_message.encode("utf-8"),
    )


def scram_client_final(state: ScramClientState, server_first_message: bytes) -> bytes:
    """Process the server-first-message and build the client-final-message.

    Args:
        state: The state from scram_client_first().
        server_first_message: Raw bytes of the server's first response.

    Returns:
        The client-final-message bytes to send back.

    Raises:
        ValueError: If the server nonce doesn't start with the client nonce,
                    or the server message is malformed.
    """
    server_msg = server_first_message.decode("utf-8")
    parts: dict[str, str] = {}
    for part in server_msg.split(","):
        if "=" in part:
            key = part[0]
            value = part[2:]
            parts[key] = value

    server_nonce = parts.get("r", "")
    salt_b64 = parts.get("s", "")
    iterations_str = parts.get("i", "")

    if not server_nonce.startswith(state.client_nonce):
        raise ValueError("Server nonce does not start with client nonce")

    salt = base64.b64decode(salt_b64)
    iterations = int(iterations_str)

    state.server_nonce = server_nonce
    state.salt = salt
    state.iterations = iterations

    # SaltedPassword = Hi(password, salt, iterations)
    salted_password = _hi(state.password.encode("utf-8"), salt, iterations)

    # ClientKey = HMAC(SaltedPassword, "Client Key")
    client_key = _hmac_sha256(salted_password, b"Client Key")

    # StoredKey = H(ClientKey)
    stored_key = _h(client_key)

    # ServerKey = HMAC(SaltedPassword, "Server Key")
    server_key = _hmac_sha256(salted_password, b"Server Key")
    state.server_key = server_key

    # channel-binding = base64("n,,")
    channel_binding = base64.b64encode(b"n,,").decode("ascii")

    # client-final-message-without-proof
    client_final_no_proof = f"c={channel_binding},r={server_nonce}"

    # AuthMessage = client-first-message-bare + "," + server-first-message + "," + client-final-no-proof
    auth_message = f"{state.client_first_message_bare},{server_msg},{client_final_no_proof}"
    state.auth_message = auth_message

    # ClientSignature = HMAC(StoredKey, AuthMessage)
    client_signature = _hmac_sha256(stored_key, auth_message.encode("utf-8"))

    # ClientProof = ClientKey XOR ClientSignature
    client_proof = _xor(client_key, client_signature)
    proof_b64 = base64.b64encode(client_proof).decode("ascii")

    client_final_message = f"{client_final_no_proof},p={proof_b64}"
    return client_final_message.encode("utf-8")


def scram_verify_server(state: ScramClientState, server_final_message: bytes) -> bool:
    """Verify the server's final signature.

    Args:
        state: The state after scram_client_final().
        server_final_message: Raw bytes of the server's final response.

    Returns:
        True if the server signature is valid, False otherwise.
    """
    server_msg = server_final_message.decode("utf-8")

    # Parse "v=<base64 signature>"
    if not server_msg.startswith("v="):
        return False

    server_signature_b64 = server_msg[2:]
    server_signature = base64.b64decode(server_signature_b64)

    if state.server_key is None or state.auth_message is None:
        return False

    # ServerSignature = HMAC(ServerKey, AuthMessage)
    expected_signature = _hmac_sha256(
        state.server_key, state.auth_message.encode("utf-8")
    )

    return hmac.compare_digest(server_signature, expected_signature)
