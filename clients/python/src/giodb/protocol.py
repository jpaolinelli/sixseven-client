"""PostgreSQL v3 wire protocol implementation for GioDB.

Implements frontend (client -> server) message builders and backend
(server -> client) message parsing compatible with the PG wire protocol.
"""

from __future__ import annotations

import hashlib
import struct
from enum import IntEnum
from typing import Any


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

PROTOCOL_VERSION = 196608  # 3 << 16 (PG v3)


class BackendMessageType(IntEnum):
    AUTHENTICATION = ord("R")
    PARAMETER_STATUS = ord("S")
    BACKEND_KEY_DATA = ord("K")
    READY_FOR_QUERY = ord("Z")
    ROW_DESCRIPTION = ord("T")
    DATA_ROW = ord("D")
    COMMAND_COMPLETE = ord("C")
    ERROR_RESPONSE = ord("E")
    NOTICE_RESPONSE = ord("N")
    EMPTY_QUERY_RESPONSE = ord("I")
    PARSE_COMPLETE = ord("1")
    BIND_COMPLETE = ord("2")
    NO_DATA = ord("n")


# ---------------------------------------------------------------------------
# Backend message structures
# ---------------------------------------------------------------------------


class BackendMessage:
    """Base class for parsed backend messages."""

    msg_type: int


class AuthenticationOk(BackendMessage):
    msg_type = BackendMessageType.AUTHENTICATION
    auth_type = 0


class AuthenticationCleartextPassword(BackendMessage):
    msg_type = BackendMessageType.AUTHENTICATION
    auth_type = 3


class AuthenticationMD5Password(BackendMessage):
    msg_type = BackendMessageType.AUTHENTICATION
    auth_type = 5

    def __init__(self, salt: bytes) -> None:
        self.salt = salt


class AuthenticationSASL(BackendMessage):
    msg_type = BackendMessageType.AUTHENTICATION
    auth_type = 10

    def __init__(self, mechanisms: list[str]) -> None:
        self.mechanisms = mechanisms


class AuthenticationSASLContinue(BackendMessage):
    msg_type = BackendMessageType.AUTHENTICATION
    auth_type = 11

    def __init__(self, data: bytes) -> None:
        self.data = data


class AuthenticationSASLFinal(BackendMessage):
    msg_type = BackendMessageType.AUTHENTICATION
    auth_type = 12

    def __init__(self, data: bytes) -> None:
        self.data = data


class ParameterStatus(BackendMessage):
    msg_type = BackendMessageType.PARAMETER_STATUS

    def __init__(self, name: str, value: str) -> None:
        self.name = name
        self.value = value


class BackendKeyData(BackendMessage):
    msg_type = BackendMessageType.BACKEND_KEY_DATA

    def __init__(self, process_id: int, secret_key: int) -> None:
        self.process_id = process_id
        self.secret_key = secret_key


class ReadyForQuery(BackendMessage):
    msg_type = BackendMessageType.READY_FOR_QUERY

    def __init__(self, status: str) -> None:
        self.status = status  # 'I' idle, 'T' transaction, 'E' error


class FieldDescription:
    def __init__(
        self,
        name: str,
        table_oid: int,
        column_index: int,
        type_oid: int,
        type_size: int,
        type_modifier: int,
        format_code: int,
    ) -> None:
        self.name = name
        self.table_oid = table_oid
        self.column_index = column_index
        self.type_oid = type_oid
        self.type_size = type_size
        self.type_modifier = type_modifier
        self.format_code = format_code


class RowDescription(BackendMessage):
    msg_type = BackendMessageType.ROW_DESCRIPTION

    def __init__(self, fields: list[FieldDescription]) -> None:
        self.fields = fields


class DataRow(BackendMessage):
    msg_type = BackendMessageType.DATA_ROW

    def __init__(self, values: list[bytes | None]) -> None:
        self.values = values


class CommandComplete(BackendMessage):
    msg_type = BackendMessageType.COMMAND_COMPLETE

    def __init__(self, tag: str) -> None:
        self.tag = tag


class ErrorResponse(BackendMessage):
    msg_type = BackendMessageType.ERROR_RESPONSE

    def __init__(self, fields: dict[str, str]) -> None:
        self.fields = fields
        self.severity = fields.get("S", "ERROR")
        self.code = fields.get("C", "")
        self.message = fields.get("M", "Unknown error")


class NoticeResponse(BackendMessage):
    msg_type = BackendMessageType.NOTICE_RESPONSE

    def __init__(self, fields: dict[str, str]) -> None:
        self.fields = fields


class EmptyQueryResponse(BackendMessage):
    msg_type = BackendMessageType.EMPTY_QUERY_RESPONSE


class ParseComplete(BackendMessage):
    msg_type = BackendMessageType.PARSE_COMPLETE


class BindComplete(BackendMessage):
    msg_type = BackendMessageType.BIND_COMPLETE


class NoData(BackendMessage):
    msg_type = BackendMessageType.NO_DATA


# ---------------------------------------------------------------------------
# Frontend message builders (client -> server)
# ---------------------------------------------------------------------------


def build_startup_message(user: str, database: str) -> bytes:
    """Build the initial startup message with protocol version and params."""
    params = f"user\x00{user}\x00database\x00{database}\x00\x00"
    params_bytes = params.encode("utf-8")
    length = 4 + 4 + len(params_bytes)  # length + version + params
    return struct.pack("!II", length, PROTOCOL_VERSION) + params_bytes


def build_password_message(password: str) -> bytes:
    """Build a cleartext password authentication message."""
    pw_bytes = password.encode("utf-8") + b"\x00"
    length = 4 + len(pw_bytes)
    return b"p" + struct.pack("!I", length) + pw_bytes


def build_md5_password_message(user: str, password: str, salt: bytes) -> bytes:
    """Build an MD5 password authentication message."""
    inner = hashlib.md5((password + user).encode("utf-8")).hexdigest()
    outer = "md5" + hashlib.md5(inner.encode("utf-8") + salt).hexdigest()
    pw_bytes = outer.encode("utf-8") + b"\x00"
    length = 4 + len(pw_bytes)
    return b"p" + struct.pack("!I", length) + pw_bytes


def build_query_message(sql: str) -> bytes:
    """Build a simple query message."""
    sql_bytes = sql.encode("utf-8") + b"\x00"
    length = 4 + len(sql_bytes)
    return b"Q" + struct.pack("!I", length) + sql_bytes


def build_parse_message(sql: str, statement_name: str = "") -> bytes:
    """Build a Parse message for extended query protocol."""
    name_bytes = statement_name.encode("utf-8") + b"\x00"
    sql_bytes = sql.encode("utf-8") + b"\x00"
    param_types = struct.pack("!H", 0)  # 0 parameter type OIDs
    length = 4 + len(name_bytes) + len(sql_bytes) + len(param_types)
    return b"P" + struct.pack("!I", length) + name_bytes + sql_bytes + param_types


def build_bind_message(
    values: list[Any],
    portal_name: str = "",
    statement_name: str = "",
) -> bytes:
    """Build a Bind message for extended query protocol."""
    portal_bytes = portal_name.encode("utf-8") + b"\x00"
    stmt_bytes = statement_name.encode("utf-8") + b"\x00"

    # Format codes: 0 = all text
    format_codes = struct.pack("!H", 0)

    # Parameters
    param_count = struct.pack("!H", len(values))
    param_data = b""
    for val in values:
        if val is None:
            param_data += struct.pack("!i", -1)  # NULL
        else:
            val_bytes = str(val).encode("utf-8")
            param_data += struct.pack("!I", len(val_bytes)) + val_bytes

    # Result format codes: 0 = all text
    result_format = struct.pack("!H", 0)

    payload = (
        portal_bytes
        + stmt_bytes
        + format_codes
        + param_count
        + param_data
        + result_format
    )
    length = 4 + len(payload)
    return b"B" + struct.pack("!I", length) + payload


def build_describe_message(
    target_type: str = "P", name: str = ""
) -> bytes:
    """Build a Describe message. target_type: 'S' for statement, 'P' for portal."""
    name_bytes = name.encode("utf-8") + b"\x00"
    length = 4 + 1 + len(name_bytes)
    return b"D" + struct.pack("!I", length) + target_type.encode("utf-8") + name_bytes


def build_execute_message(portal_name: str = "", max_rows: int = 0) -> bytes:
    """Build an Execute message."""
    portal_bytes = portal_name.encode("utf-8") + b"\x00"
    length = 4 + len(portal_bytes) + 4
    return b"E" + struct.pack("!I", length) + portal_bytes + struct.pack("!I", max_rows)


def build_sync_message() -> bytes:
    """Build a Sync message."""
    return b"S" + struct.pack("!I", 4)


def build_terminate_message() -> bytes:
    """Build a Terminate message."""
    return b"X" + struct.pack("!I", 4)


def build_sasl_initial_response(mechanism: str, client_first_message: bytes) -> bytes:
    """Build a SASLInitialResponse message."""
    mech_bytes = mechanism.encode("utf-8") + b"\x00"
    length = 4 + len(mech_bytes) + 4 + len(client_first_message)
    return (
        b"p"
        + struct.pack("!I", length)
        + mech_bytes
        + struct.pack("!I", len(client_first_message))
        + client_first_message
    )


def build_sasl_response(client_final_message: bytes) -> bytes:
    """Build a SASLResponse message."""
    length = 4 + len(client_final_message)
    return b"p" + struct.pack("!I", length) + client_final_message


# ---------------------------------------------------------------------------
# Backend message parser
# ---------------------------------------------------------------------------


def _parse_error_notice_fields(payload: bytes) -> dict[str, str]:
    """Parse error/notice response field bytes into a dict."""
    fields: dict[str, str] = {}
    pos = 0
    while pos < len(payload):
        field_type = chr(payload[pos])
        pos += 1
        if field_type == "\x00":
            break
        end = payload.index(b"\x00", pos)
        fields[field_type] = payload[pos:end].decode("utf-8")
        pos = end + 1
    return fields


def parse_backend_message(
    msg_type: int, payload: bytes
) -> BackendMessage:
    """Parse a backend message from its type byte and payload."""
    if msg_type == BackendMessageType.AUTHENTICATION:
        auth_type = struct.unpack("!I", payload[:4])[0]
        if auth_type == 0:
            return AuthenticationOk()
        elif auth_type == 3:
            return AuthenticationCleartextPassword()
        elif auth_type == 5:
            salt = payload[4:8]
            return AuthenticationMD5Password(salt)
        elif auth_type == 10:
            # SASL - parse mechanism names
            mechanisms: list[str] = []
            pos = 4
            while pos < len(payload):
                end = payload.index(b"\x00", pos)
                name = payload[pos:end].decode("utf-8")
                pos = end + 1
                if not name:
                    break
                mechanisms.append(name)
            return AuthenticationSASL(mechanisms)
        elif auth_type == 11:
            return AuthenticationSASLContinue(payload[4:])
        elif auth_type == 12:
            return AuthenticationSASLFinal(payload[4:])
        else:
            raise ValueError(f"Unknown auth type: {auth_type}")

    elif msg_type == BackendMessageType.PARAMETER_STATUS:
        sep = payload.index(b"\x00")
        name = payload[:sep].decode("utf-8")
        value = payload[sep + 1 : -1].decode("utf-8")  # strip trailing null
        return ParameterStatus(name, value)

    elif msg_type == BackendMessageType.BACKEND_KEY_DATA:
        pid, key = struct.unpack("!II", payload[:8])
        return BackendKeyData(pid, key)

    elif msg_type == BackendMessageType.READY_FOR_QUERY:
        status = chr(payload[0])
        return ReadyForQuery(status)

    elif msg_type == BackendMessageType.ROW_DESCRIPTION:
        field_count = struct.unpack("!H", payload[:2])[0]
        fields: list[FieldDescription] = []
        pos = 2
        for _ in range(field_count):
            end = payload.index(b"\x00", pos)
            name = payload[pos:end].decode("utf-8")
            pos = end + 1
            (table_oid, col_idx, type_oid, type_size, type_mod, fmt) = struct.unpack(
                "!IhIhih", payload[pos : pos + 18]
            )
            pos += 18
            fields.append(
                FieldDescription(name, table_oid, col_idx, type_oid, type_size, type_mod, fmt)
            )
        return RowDescription(fields)

    elif msg_type == BackendMessageType.DATA_ROW:
        col_count = struct.unpack("!H", payload[:2])[0]
        values: list[bytes | None] = []
        pos = 2
        for _ in range(col_count):
            length = struct.unpack("!i", payload[pos : pos + 4])[0]
            pos += 4
            if length == -1:
                values.append(None)
            else:
                values.append(payload[pos : pos + length])
                pos += length
        return DataRow(values)

    elif msg_type == BackendMessageType.COMMAND_COMPLETE:
        tag = payload[:-1].decode("utf-8")  # strip trailing null
        return CommandComplete(tag)

    elif msg_type == BackendMessageType.ERROR_RESPONSE:
        fields_dict = _parse_error_notice_fields(payload)
        return ErrorResponse(fields_dict)

    elif msg_type == BackendMessageType.NOTICE_RESPONSE:
        fields_dict = _parse_error_notice_fields(payload)
        return NoticeResponse(fields_dict)

    elif msg_type == BackendMessageType.EMPTY_QUERY_RESPONSE:
        return EmptyQueryResponse()

    elif msg_type == BackendMessageType.PARSE_COMPLETE:
        return ParseComplete()

    elif msg_type == BackendMessageType.BIND_COMPLETE:
        return BindComplete()

    elif msg_type == BackendMessageType.NO_DATA:
        return NoData()

    else:
        raise ValueError(f"Unknown backend message type: {msg_type} ({chr(msg_type)})")


# ---------------------------------------------------------------------------
# Message stream reader
# ---------------------------------------------------------------------------


class MessageReader:
    """Stateful reader that accumulates TCP data and yields complete messages."""

    def __init__(self) -> None:
        self._buffer = bytearray()

    def append(self, data: bytes) -> None:
        """Add incoming socket data to the internal buffer."""
        self._buffer.extend(data)

    def read(self) -> BackendMessage | None:
        """Read one complete backend message, or None if insufficient data."""
        if len(self._buffer) < 5:
            return None

        msg_type = self._buffer[0]
        (length,) = struct.unpack("!I", self._buffer[1:5])

        total_size = 1 + length  # type byte + length (includes itself)
        if len(self._buffer) < total_size:
            return None

        payload = bytes(self._buffer[5:total_size])
        del self._buffer[:total_size]

        return parse_backend_message(msg_type, payload)
