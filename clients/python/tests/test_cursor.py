"""Tests for the DB-API 2.0 Cursor implementation."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from giodb.cursor import Cursor
from giodb.exceptions import InterfaceError
from giodb.types import FieldInfo, QueryResult


def _make_mock_connection(result: QueryResult | None = None) -> MagicMock:
    """Create a mock connection object for testing cursor."""
    conn = MagicMock()
    if result is None:
        result = QueryResult(
            rows=[{"id": 1, "name": "Alice"}, {"id": 2, "name": "Bob"}],
            fields=[
                FieldInfo(name="id", data_type_id=23),
                FieldInfo(name="name", data_type_id=25),
            ],
            row_count=2,
            command="SELECT",
        )
    conn._raw_connection.query.return_value = result
    return conn


class TestCursorExecute:
    def test_basic_execute(self):
        conn = _make_mock_connection()
        cursor = Cursor(conn)
        cursor.execute("SELECT * FROM users")

        conn._raw_connection.query.assert_called_once_with("SELECT * FROM users", None)
        assert cursor.rowcount == 2
        assert cursor.description is not None
        assert len(cursor.description) == 2
        assert cursor.description[0][0] == "id"  # name
        assert cursor.description[0][1] == 23  # type_code

    def test_execute_with_params(self):
        conn = _make_mock_connection()
        cursor = Cursor(conn)
        cursor.execute("SELECT * FROM users WHERE id = $1", [42])

        conn._raw_connection.query.assert_called_once_with(
            "SELECT * FROM users WHERE id = $1", [42]
        )

    def test_execute_clears_previous_results(self):
        conn = _make_mock_connection()
        cursor = Cursor(conn)
        cursor.execute("SELECT 1")
        cursor.fetchone()

        # Execute again resets
        cursor.execute("SELECT 2")
        assert cursor._row_index == 0

    def test_executemany(self):
        conn = _make_mock_connection()
        cursor = Cursor(conn)
        cursor.executemany("INSERT INTO t VALUES ($1)", [[1], [2], [3]])
        assert conn._raw_connection.query.call_count == 3


class TestCursorFetch:
    def test_fetchone(self):
        conn = _make_mock_connection()
        cursor = Cursor(conn)
        cursor.execute("SELECT * FROM users")

        row1 = cursor.fetchone()
        assert row1 == {"id": 1, "name": "Alice"}
        row2 = cursor.fetchone()
        assert row2 == {"id": 2, "name": "Bob"}
        row3 = cursor.fetchone()
        assert row3 is None

    def test_fetchall(self):
        conn = _make_mock_connection()
        cursor = Cursor(conn)
        cursor.execute("SELECT * FROM users")

        rows = cursor.fetchall()
        assert len(rows) == 2
        assert rows[0]["id"] == 1
        assert rows[1]["id"] == 2

        # Second call returns empty
        assert cursor.fetchall() == []

    def test_fetchmany_default(self):
        conn = _make_mock_connection()
        cursor = Cursor(conn)
        cursor.execute("SELECT * FROM users")

        rows = cursor.fetchmany()
        assert len(rows) == 1  # default arraysize=1
        assert rows[0]["id"] == 1

    def test_fetchmany_custom_size(self):
        conn = _make_mock_connection()
        cursor = Cursor(conn)
        cursor.execute("SELECT * FROM users")

        rows = cursor.fetchmany(size=5)
        assert len(rows) == 2  # only 2 available

    def test_fetchmany_respects_arraysize(self):
        conn = _make_mock_connection()
        cursor = Cursor(conn)
        cursor.arraysize = 2
        cursor.execute("SELECT * FROM users")

        rows = cursor.fetchmany()
        assert len(rows) == 2

    def test_mixed_fetch(self):
        conn = _make_mock_connection()
        cursor = Cursor(conn)
        cursor.execute("SELECT * FROM users")

        row1 = cursor.fetchone()
        assert row1["id"] == 1
        remaining = cursor.fetchall()
        assert len(remaining) == 1
        assert remaining[0]["id"] == 2


class TestCursorLifecycle:
    def test_close(self):
        conn = _make_mock_connection()
        cursor = Cursor(conn)
        cursor.close()
        assert cursor._closed

    def test_execute_after_close(self):
        conn = _make_mock_connection()
        cursor = Cursor(conn)
        cursor.close()
        with pytest.raises(InterfaceError, match="closed"):
            cursor.execute("SELECT 1")

    def test_fetchone_after_close(self):
        conn = _make_mock_connection()
        cursor = Cursor(conn)
        cursor.execute("SELECT 1")
        cursor.close()
        with pytest.raises(InterfaceError, match="closed"):
            cursor.fetchone()

    def test_context_manager(self):
        conn = _make_mock_connection()
        with Cursor(conn) as cursor:
            cursor.execute("SELECT * FROM users")
            row = cursor.fetchone()
            assert row is not None
        assert cursor._closed


class TestCursorIteration:
    def test_iterator(self):
        conn = _make_mock_connection()
        cursor = Cursor(conn)
        cursor.execute("SELECT * FROM users")

        results = list(cursor)
        assert len(results) == 2
        assert results[0]["id"] == 1
        assert results[1]["id"] == 2


class TestCursorDescription:
    def test_no_execute(self):
        conn = _make_mock_connection()
        cursor = Cursor(conn)
        assert cursor.description is None

    def test_no_fields(self):
        result = QueryResult(rows=[], fields=[], row_count=0, command="INSERT")
        conn = _make_mock_connection(result)
        cursor = Cursor(conn)
        cursor.execute("INSERT INTO t VALUES (1)")
        assert cursor.description is None

    def test_description_format(self):
        conn = _make_mock_connection()
        cursor = Cursor(conn)
        cursor.execute("SELECT * FROM users")

        desc = cursor.description
        assert len(desc) == 2
        # Each entry is (name, type_code, display_size, internal_size, precision, scale, null_ok)
        assert len(desc[0]) == 7
        assert desc[0][0] == "id"
        assert desc[0][1] == 23
        assert desc[0][2] is None  # display_size
