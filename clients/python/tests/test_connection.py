"""Tests for the Connection class (unit tests with mocked sockets)."""

from __future__ import annotations

import struct
from unittest.mock import MagicMock, patch

import pytest

from giodb.connection import Connection
from giodb.exceptions import DatabaseError, InterfaceError, OperationalError
from giodb.protocol import BackendMessageType
from giodb.types import ConnectionConfig


def _make_auth_ok() -> bytes:
    """Build an AuthenticationOk backend message."""
    payload = struct.pack("!I", 0)
    return bytes([BackendMessageType.AUTHENTICATION]) + struct.pack("!I", len(payload) + 4) + payload


def _make_ready_for_query(status: str = "I") -> bytes:
    """Build a ReadyForQuery backend message."""
    payload = status.encode("utf-8")
    return bytes([BackendMessageType.READY_FOR_QUERY]) + struct.pack("!I", len(payload) + 4) + payload


def _make_parameter_status(name: str, value: str) -> bytes:
    """Build a ParameterStatus backend message."""
    payload = name.encode("utf-8") + b"\x00" + value.encode("utf-8") + b"\x00"
    return bytes([BackendMessageType.PARAMETER_STATUS]) + struct.pack("!I", len(payload) + 4) + payload


def _make_row_description(fields: list[tuple[str, int]]) -> bytes:
    """Build a RowDescription message. fields = [(name, type_oid), ...]"""
    payload = struct.pack("!H", len(fields))
    for name, type_oid in fields:
        payload += name.encode("utf-8") + b"\x00"
        payload += struct.pack("!IhIhih", 0, 0, type_oid, 4, -1, 0)
    return bytes([BackendMessageType.ROW_DESCRIPTION]) + struct.pack("!I", len(payload) + 4) + payload


def _make_data_row(values: list[str | None]) -> bytes:
    """Build a DataRow message."""
    payload = struct.pack("!H", len(values))
    for val in values:
        if val is None:
            payload += struct.pack("!i", -1)
        else:
            val_bytes = val.encode("utf-8")
            payload += struct.pack("!I", len(val_bytes)) + val_bytes
    return bytes([BackendMessageType.DATA_ROW]) + struct.pack("!I", len(payload) + 4) + payload


def _make_command_complete(tag: str) -> bytes:
    """Build a CommandComplete message."""
    payload = tag.encode("utf-8") + b"\x00"
    return bytes([BackendMessageType.COMMAND_COMPLETE]) + struct.pack("!I", len(payload) + 4) + payload


def _make_error_response(severity: str, code: str, message: str) -> bytes:
    """Build an ErrorResponse message."""
    payload = (
        b"S" + severity.encode("utf-8") + b"\x00"
        + b"C" + code.encode("utf-8") + b"\x00"
        + b"M" + message.encode("utf-8") + b"\x00"
        + b"\x00"
    )
    return bytes([BackendMessageType.ERROR_RESPONSE]) + struct.pack("!I", len(payload) + 4) + payload


class TestConnectionDefaults:
    def test_default_config(self):
        conn = Connection()
        assert conn._config.host == "localhost"
        assert conn._config.port == 6767
        assert conn._config.user == "sixseven"
        assert conn._config.database == "sixseven"
        assert conn._config.password is None

    def test_custom_config(self):
        config = ConnectionConfig(host="db.example.com", port=5432, user="admin", password="secret", database="mydb")
        conn = Connection(config=config)
        assert conn._config.host == "db.example.com"
        assert conn._config.port == 5432

    def test_kwargs_config(self):
        conn = Connection(host="custom", port=9999)
        assert conn._config.host == "custom"
        assert conn._config.port == 9999


class TestConnectionLifecycle:
    @patch("giodb.connection.socket.socket")
    def test_connect_success(self, mock_socket_cls):
        mock_sock = MagicMock()
        mock_socket_cls.return_value = mock_sock

        # Server sends: AuthOk + ParameterStatus + ReadyForQuery
        server_data = _make_auth_ok() + _make_parameter_status("server_version", "1.0") + _make_ready_for_query()
        mock_sock.recv.return_value = server_data

        conn = Connection()
        conn.connect()

        assert conn._socket is not None
        mock_sock.connect.assert_called_once_with(("localhost", 6767))

    @patch("giodb.connection.socket.socket")
    def test_connect_already_connected(self, mock_socket_cls):
        mock_sock = MagicMock()
        mock_socket_cls.return_value = mock_sock
        mock_sock.recv.return_value = _make_auth_ok() + _make_ready_for_query()

        conn = Connection()
        conn.connect()

        with pytest.raises(InterfaceError, match="Already connected"):
            conn.connect()

    @patch("giodb.connection.socket.socket")
    def test_end_closes_socket(self, mock_socket_cls):
        mock_sock = MagicMock()
        mock_socket_cls.return_value = mock_sock
        mock_sock.recv.return_value = _make_auth_ok() + _make_ready_for_query()

        conn = Connection()
        conn.connect()
        conn.end()

        assert conn.closed
        mock_sock.close.assert_called_once()

    def test_end_idempotent(self):
        conn = Connection()
        conn.end()
        conn.end()  # Should not raise
        assert conn.closed


class TestConnectionQuery:
    @patch("giodb.connection.socket.socket")
    def _make_connected(self, mock_socket_cls):
        mock_sock = MagicMock()
        mock_socket_cls.return_value = mock_sock
        mock_sock.recv.return_value = _make_auth_ok() + _make_ready_for_query()

        conn = Connection()
        conn.connect()
        return conn, mock_sock

    def test_simple_query(self):
        conn, mock_sock = self._make_connected()

        # Set up response for SELECT query
        response = (
            _make_row_description([("id", 23), ("name", 25)])
            + _make_data_row(["1", "Alice"])
            + _make_data_row(["2", "Bob"])
            + _make_command_complete("SELECT 2")
            + _make_ready_for_query()
        )
        mock_sock.recv.return_value = response

        result = conn.query("SELECT id, name FROM users")
        assert result.command == "SELECT"
        assert result.row_count == 2
        assert len(result.rows) == 2
        assert result.rows[0]["id"] == 1
        assert result.rows[0]["name"] == "Alice"
        assert result.rows[1]["id"] == 2
        assert result.rows[1]["name"] == "Bob"

    def test_query_when_closed(self):
        conn = Connection()
        conn._ended = True
        with pytest.raises(InterfaceError, match="closed"):
            conn.query("SELECT 1")

    def test_query_error(self):
        conn, mock_sock = self._make_connected()

        response = (
            _make_error_response("ERROR", "42601", "syntax error")
            + _make_ready_for_query()
        )
        mock_sock.recv.return_value = response

        with pytest.raises(DatabaseError, match="syntax error"):
            conn.query("INVALID SQL")

    def test_query_null_values(self):
        conn, mock_sock = self._make_connected()

        response = (
            _make_row_description([("val", 25)])
            + _make_data_row([None])
            + _make_command_complete("SELECT 1")
            + _make_ready_for_query()
        )
        mock_sock.recv.return_value = response

        result = conn.query("SELECT val FROM test")
        assert result.rows[0]["val"] is None

    def test_parse_command(self):
        assert Connection._parse_command("SELECT 5") == "SELECT"
        assert Connection._parse_command("INSERT 0 1") == "INSERT"
        assert Connection._parse_command("TRAVERSE") == "TRAVERSE"
        assert Connection._parse_command("") == ""

    def test_parse_row_count(self):
        assert Connection._parse_row_count("SELECT 5") == 5
        assert Connection._parse_row_count("INSERT 0 1") == 1
        assert Connection._parse_row_count("DELETE 3") == 3
        assert Connection._parse_row_count("") == 0
