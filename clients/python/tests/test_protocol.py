"""Tests for the PG wire protocol implementation."""

import struct

import pytest

from giodb.protocol import (
    AuthenticationCleartextPassword,
    AuthenticationMD5Password,
    AuthenticationOk,
    AuthenticationSASL,
    AuthenticationSASLContinue,
    AuthenticationSASLFinal,
    BackendKeyData,
    BackendMessageType,
    BindComplete,
    CommandComplete,
    DataRow,
    EmptyQueryResponse,
    ErrorResponse,
    FieldDescription,
    MessageReader,
    NoData,
    NoticeResponse,
    ParameterStatus,
    ParseComplete,
    ReadyForQuery,
    RowDescription,
    build_bind_message,
    build_describe_message,
    build_execute_message,
    build_md5_password_message,
    build_parse_message,
    build_password_message,
    build_query_message,
    build_sasl_initial_response,
    build_sasl_response,
    build_startup_message,
    build_sync_message,
    build_terminate_message,
    parse_backend_message,
)


# ---------------------------------------------------------------------------
# Frontend message builder tests
# ---------------------------------------------------------------------------


class TestBuildStartupMessage:
    def test_basic_startup(self):
        msg = build_startup_message("testuser", "testdb")
        # Should start with 4-byte length, then protocol version 196608
        length = struct.unpack("!I", msg[:4])[0]
        assert length == len(msg)
        version = struct.unpack("!I", msg[4:8])[0]
        assert version == 196608
        # Should contain user and database params
        payload = msg[8:]
        assert b"user\x00testuser\x00" in payload
        assert b"database\x00testdb\x00" in payload
        # Should end with double null
        assert payload.endswith(b"\x00")

    def test_unicode_user(self):
        msg = build_startup_message("user_\u00e9", "db")
        assert "user_\u00e9".encode("utf-8") in msg


class TestBuildPasswordMessage:
    def test_cleartext(self):
        msg = build_password_message("secret")
        assert msg[0:1] == b"p"
        length = struct.unpack("!I", msg[1:5])[0]
        assert length == len(msg) - 1
        assert msg[5:] == b"secret\x00"


class TestBuildMD5PasswordMessage:
    def test_md5_known_vector(self):
        msg = build_md5_password_message("user", "pass", b"\x01\x02\x03\x04")
        assert msg[0:1] == b"p"
        payload = msg[5:]
        # Should start with 'md5' prefix
        assert payload.startswith(b"md5")
        # Should end with null terminator
        assert payload.endswith(b"\x00")


class TestBuildQueryMessage:
    def test_simple_select(self):
        msg = build_query_message("SELECT 1")
        assert msg[0:1] == b"Q"
        length = struct.unpack("!I", msg[1:5])[0]
        assert length == len(msg) - 1
        assert msg[5:] == b"SELECT 1\x00"

    def test_unicode_query(self):
        msg = build_query_message("SELECT '\u00e9'")
        assert "SELECT '\u00e9'".encode("utf-8") in msg


class TestBuildParseMessage:
    def test_unnamed_statement(self):
        msg = build_parse_message("SELECT $1")
        assert msg[0:1] == b"P"
        # Contains empty name (unnamed), SQL, and 0 param types
        assert b"\x00SELECT $1\x00" in msg

    def test_named_statement(self):
        msg = build_parse_message("SELECT 1", "stmt1")
        assert b"stmt1\x00" in msg


class TestBuildBindMessage:
    def test_no_params(self):
        msg = build_bind_message([])
        assert msg[0:1] == b"B"

    def test_with_params(self):
        msg = build_bind_message(["hello", 42])
        assert msg[0:1] == b"B"
        # Should contain param count = 2
        # and the string representations

    def test_null_param(self):
        msg = build_bind_message([None])
        assert msg[0:1] == b"B"
        # NULL is encoded as -1 length
        assert struct.pack("!i", -1) in msg


class TestBuildDescribeMessage:
    def test_portal(self):
        msg = build_describe_message("P", "")
        assert msg[0:1] == b"D"
        assert b"P" in msg

    def test_statement(self):
        msg = build_describe_message("S", "mystmt")
        assert msg[0:1] == b"D"
        assert b"S" in msg
        assert b"mystmt\x00" in msg


class TestBuildExecuteMessage:
    def test_unlimited(self):
        msg = build_execute_message("", 0)
        assert msg[0:1] == b"E"

    def test_limited(self):
        msg = build_execute_message("", 100)
        assert msg[0:1] == b"E"
        assert struct.pack("!I", 100) in msg


class TestBuildSyncMessage:
    def test_sync(self):
        msg = build_sync_message()
        assert msg == b"S" + struct.pack("!I", 4)


class TestBuildTerminateMessage:
    def test_terminate(self):
        msg = build_terminate_message()
        assert msg == b"X" + struct.pack("!I", 4)


class TestBuildSASLMessages:
    def test_sasl_initial_response(self):
        msg = build_sasl_initial_response("SCRAM-SHA-256", b"n,,n=user,r=nonce")
        assert msg[0:1] == b"p"
        assert b"SCRAM-SHA-256\x00" in msg

    def test_sasl_response(self):
        msg = build_sasl_response(b"c=biws,r=nonce,p=proof")
        assert msg[0:1] == b"p"


# ---------------------------------------------------------------------------
# Backend message parser tests
# ---------------------------------------------------------------------------


class TestParseAuthentication:
    def test_auth_ok(self):
        payload = struct.pack("!I", 0)
        msg = parse_backend_message(BackendMessageType.AUTHENTICATION, payload)
        assert isinstance(msg, AuthenticationOk)

    def test_auth_cleartext(self):
        payload = struct.pack("!I", 3)
        msg = parse_backend_message(BackendMessageType.AUTHENTICATION, payload)
        assert isinstance(msg, AuthenticationCleartextPassword)

    def test_auth_md5(self):
        salt = b"\xde\xad\xbe\xef"
        payload = struct.pack("!I", 5) + salt
        msg = parse_backend_message(BackendMessageType.AUTHENTICATION, payload)
        assert isinstance(msg, AuthenticationMD5Password)
        assert msg.salt == salt

    def test_auth_sasl(self):
        mechanisms = b"SCRAM-SHA-256\x00\x00"
        payload = struct.pack("!I", 10) + mechanisms
        msg = parse_backend_message(BackendMessageType.AUTHENTICATION, payload)
        assert isinstance(msg, AuthenticationSASL)
        assert "SCRAM-SHA-256" in msg.mechanisms

    def test_auth_sasl_continue(self):
        data = b"r=nonce,s=salt,i=4096"
        payload = struct.pack("!I", 11) + data
        msg = parse_backend_message(BackendMessageType.AUTHENTICATION, payload)
        assert isinstance(msg, AuthenticationSASLContinue)
        assert msg.data == data

    def test_auth_sasl_final(self):
        data = b"v=signature"
        payload = struct.pack("!I", 12) + data
        msg = parse_backend_message(BackendMessageType.AUTHENTICATION, payload)
        assert isinstance(msg, AuthenticationSASLFinal)
        assert msg.data == data


class TestParseParameterStatus:
    def test_basic(self):
        payload = b"server_version\x0015.0\x00"
        msg = parse_backend_message(BackendMessageType.PARAMETER_STATUS, payload)
        assert isinstance(msg, ParameterStatus)
        assert msg.name == "server_version"
        assert msg.value == "15.0"


class TestParseBackendKeyData:
    def test_basic(self):
        payload = struct.pack("!II", 1234, 5678)
        msg = parse_backend_message(BackendMessageType.BACKEND_KEY_DATA, payload)
        assert isinstance(msg, BackendKeyData)
        assert msg.process_id == 1234
        assert msg.secret_key == 5678


class TestParseReadyForQuery:
    def test_idle(self):
        payload = b"I"
        msg = parse_backend_message(BackendMessageType.READY_FOR_QUERY, payload)
        assert isinstance(msg, ReadyForQuery)
        assert msg.status == "I"

    def test_transaction(self):
        payload = b"T"
        msg = parse_backend_message(BackendMessageType.READY_FOR_QUERY, payload)
        assert msg.status == "T"

    def test_error(self):
        payload = b"E"
        msg = parse_backend_message(BackendMessageType.READY_FOR_QUERY, payload)
        assert msg.status == "E"


class TestParseRowDescription:
    def test_single_field(self):
        # Build a RowDescription with one field
        name = b"id\x00"
        field_data = struct.pack("!IhIhih", 0, 0, 23, 4, -1, 0)  # type_oid=23 (INT4)
        payload = struct.pack("!H", 1) + name + field_data
        msg = parse_backend_message(BackendMessageType.ROW_DESCRIPTION, payload)
        assert isinstance(msg, RowDescription)
        assert len(msg.fields) == 1
        assert msg.fields[0].name == "id"
        assert msg.fields[0].type_oid == 23

    def test_multiple_fields(self):
        name1 = b"id\x00"
        field1 = struct.pack("!IhIhih", 0, 0, 23, 4, -1, 0)
        name2 = b"name\x00"
        field2 = struct.pack("!IhIhih", 0, 1, 25, -1, -1, 0)
        payload = struct.pack("!H", 2) + name1 + field1 + name2 + field2
        msg = parse_backend_message(BackendMessageType.ROW_DESCRIPTION, payload)
        assert isinstance(msg, RowDescription)
        assert len(msg.fields) == 2
        assert msg.fields[0].name == "id"
        assert msg.fields[1].name == "name"
        assert msg.fields[1].type_oid == 25


class TestParseDataRow:
    def test_single_value(self):
        val = b"42"
        payload = struct.pack("!H", 1) + struct.pack("!I", len(val)) + val
        msg = parse_backend_message(BackendMessageType.DATA_ROW, payload)
        assert isinstance(msg, DataRow)
        assert len(msg.values) == 1
        assert msg.values[0] == b"42"

    def test_null_value(self):
        payload = struct.pack("!H", 1) + struct.pack("!i", -1)
        msg = parse_backend_message(BackendMessageType.DATA_ROW, payload)
        assert isinstance(msg, DataRow)
        assert msg.values[0] is None

    def test_multiple_values(self):
        val1 = b"hello"
        val2 = b"world"
        payload = (
            struct.pack("!H", 2)
            + struct.pack("!I", len(val1)) + val1
            + struct.pack("!I", len(val2)) + val2
        )
        msg = parse_backend_message(BackendMessageType.DATA_ROW, payload)
        assert len(msg.values) == 2
        assert msg.values[0] == b"hello"
        assert msg.values[1] == b"world"


class TestParseCommandComplete:
    def test_select(self):
        payload = b"SELECT 5\x00"
        msg = parse_backend_message(BackendMessageType.COMMAND_COMPLETE, payload)
        assert isinstance(msg, CommandComplete)
        assert msg.tag == "SELECT 5"

    def test_insert(self):
        payload = b"INSERT 0 1\x00"
        msg = parse_backend_message(BackendMessageType.COMMAND_COMPLETE, payload)
        assert msg.tag == "INSERT 0 1"


class TestParseErrorResponse:
    def test_basic_error(self):
        payload = b"SERROR\x00C42601\x00Msyntax error\x00\x00"
        msg = parse_backend_message(BackendMessageType.ERROR_RESPONSE, payload)
        assert isinstance(msg, ErrorResponse)
        assert msg.severity == "ERROR"
        assert msg.code == "42601"
        assert msg.message == "syntax error"


class TestParseSimpleMessages:
    def test_empty_query(self):
        msg = parse_backend_message(BackendMessageType.EMPTY_QUERY_RESPONSE, b"")
        assert isinstance(msg, EmptyQueryResponse)

    def test_parse_complete(self):
        msg = parse_backend_message(BackendMessageType.PARSE_COMPLETE, b"")
        assert isinstance(msg, ParseComplete)

    def test_bind_complete(self):
        msg = parse_backend_message(BackendMessageType.BIND_COMPLETE, b"")
        assert isinstance(msg, BindComplete)

    def test_no_data(self):
        msg = parse_backend_message(BackendMessageType.NO_DATA, b"")
        assert isinstance(msg, NoData)


class TestParseNoticeResponse:
    def test_notice(self):
        payload = b"SNOTICE\x00Msome notice\x00\x00"
        msg = parse_backend_message(BackendMessageType.NOTICE_RESPONSE, payload)
        assert isinstance(msg, NoticeResponse)


# ---------------------------------------------------------------------------
# MessageReader tests
# ---------------------------------------------------------------------------


class TestMessageReader:
    def test_empty_read(self):
        reader = MessageReader()
        assert reader.read() is None

    def test_insufficient_data(self):
        reader = MessageReader()
        reader.append(b"\x5a\x00\x00")
        assert reader.read() is None

    def test_exactly_header_no_payload(self):
        reader = MessageReader()
        # ReadyForQuery: type='Z', length=5, payload='I'
        reader.append(b"Z\x00\x00\x00\x05I")
        msg = reader.read()
        assert isinstance(msg, ReadyForQuery)
        assert msg.status == "I"

    def test_split_across_chunks(self):
        reader = MessageReader()
        full = b"Z\x00\x00\x00\x05I"
        reader.append(full[:3])
        assert reader.read() is None
        reader.append(full[3:])
        msg = reader.read()
        assert isinstance(msg, ReadyForQuery)

    def test_multiple_messages(self):
        reader = MessageReader()
        msg1 = b"Z\x00\x00\x00\x05I"
        msg2 = b"Z\x00\x00\x00\x05T"
        reader.append(msg1 + msg2)
        r1 = reader.read()
        r2 = reader.read()
        assert isinstance(r1, ReadyForQuery)
        assert r1.status == "I"
        assert isinstance(r2, ReadyForQuery)
        assert r2.status == "T"
        assert reader.read() is None

    def test_partial_then_complete(self):
        reader = MessageReader()
        # First 4 bytes only (need 5 for header)
        reader.append(b"Z\x00\x00\x00")
        assert reader.read() is None
        reader.append(b"\x05I")
        msg = reader.read()
        assert isinstance(msg, ReadyForQuery)
