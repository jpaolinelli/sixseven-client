"""Tests for the Client (high-level DB-API 2.0 Connection wrapper)."""

from unittest.mock import MagicMock, patch

import pytest

from giodb.client import Client
from giodb.exceptions import InterfaceError
from giodb.types import (
    ConnectionConfig,
    FieldInfo,
    LinkOptions,
    NearestOptions,
    QueryResult,
    TraverseOptions,
)


def _mock_query_result() -> QueryResult:
    return QueryResult(
        rows=[{"id": 1}],
        fields=[FieldInfo(name="id", data_type_id=23)],
        row_count=1,
        command="SELECT",
    )


class TestClientLifecycle:
    @patch("giodb.client.Connection")
    def test_connect(self, MockConn):
        client = Client(host="localhost")
        client.connect()
        MockConn.return_value.connect.assert_called_once()

    @patch("giodb.client.Connection")
    def test_close(self, MockConn):
        client = Client()
        client.close()
        MockConn.return_value.end.assert_called_once()
        assert client._closed

    @patch("giodb.client.Connection")
    def test_close_idempotent(self, MockConn):
        client = Client()
        client.close()
        client.close()  # Should not raise
        MockConn.return_value.end.assert_called_once()

    @patch("giodb.client.Connection")
    def test_context_manager(self, MockConn):
        with Client() as client:
            pass
        assert client._closed


class TestClientCursor:
    @patch("giodb.client.Connection")
    def test_cursor(self, MockConn):
        client = Client()
        cursor = client.cursor()
        assert cursor is not None

    @patch("giodb.client.Connection")
    def test_cursor_after_close(self, MockConn):
        client = Client()
        client.close()
        with pytest.raises(InterfaceError, match="closed"):
            client.cursor()


class TestClientDBAPI:
    @patch("giodb.client.Connection")
    def test_commit(self, MockConn):
        client = Client()
        mock_conn = MockConn.return_value
        mock_conn.query.return_value = _mock_query_result()
        client.commit()
        mock_conn.query.assert_called_with("COMMIT")

    @patch("giodb.client.Connection")
    def test_rollback(self, MockConn):
        client = Client()
        mock_conn = MockConn.return_value
        mock_conn.query.return_value = _mock_query_result()
        client.rollback()
        mock_conn.query.assert_called_with("ROLLBACK")

    @patch("giodb.client.Connection")
    def test_commit_when_closed(self, MockConn):
        client = Client()
        client.close()
        with pytest.raises(InterfaceError, match="closed"):
            client.commit()


class TestClientQuery:
    @patch("giodb.client.Connection")
    def test_query(self, MockConn):
        client = Client()
        mock_conn = MockConn.return_value
        mock_conn.query.return_value = _mock_query_result()

        result = client.query("SELECT 1")
        assert result.rows == [{"id": 1}]

    @patch("giodb.client.Connection")
    def test_query_with_params(self, MockConn):
        client = Client()
        mock_conn = MockConn.return_value
        mock_conn.query.return_value = _mock_query_result()

        client.query("SELECT $1", [42])
        mock_conn.query.assert_called_with("SELECT $1", [42])

    @patch("giodb.client.Connection")
    def test_query_when_closed(self, MockConn):
        client = Client()
        client.close()
        with pytest.raises(InterfaceError, match="closed"):
            client.query("SELECT 1")


class TestClientHelpers:
    @patch("giodb.client.Connection")
    def test_traverse(self, MockConn):
        client = Client()
        mock_conn = MockConn.return_value
        mock_conn.query.return_value = _mock_query_result()

        opts = TraverseOptions(direction="OUT", max_depth=3)
        result = client.traverse("follows", "users", 1, opts)

        call_args = mock_conn.query.call_args
        assert "TRAVERSE" in call_args[0][0]
        assert "DIRECTION OUT" in call_args[0][0]
        assert "MAX_DEPTH 3" in call_args[0][0]

    @patch("giodb.client.Connection")
    def test_nearest(self, MockConn):
        client = Client()
        mock_conn = MockConn.return_value
        mock_conn.query.return_value = _mock_query_result()

        opts = NearestOptions(k=5, metric="COSINE")
        result = client.nearest("posts", "embedding", "[0.1,0.2]", opts)

        call_args = mock_conn.query.call_args
        assert "NEAREST 5" in call_args[0][0]
        assert "USING COSINE" in call_args[0][0]

    @patch("giodb.client.Connection")
    def test_link(self, MockConn):
        client = Client()
        mock_conn = MockConn.return_value
        mock_conn.query.return_value = _mock_query_result()

        opts = LinkOptions(properties={"weight": 0.5})
        result = client.link("follows", "users", 1, "users", 2, opts)

        call_args = mock_conn.query.call_args
        assert "LINK" in call_args[0][0]
        assert "VIA" in call_args[0][0]
        assert 0.5 in call_args[0][1]

    @patch("giodb.client.Connection")
    def test_unlink(self, MockConn):
        client = Client()
        mock_conn = MockConn.return_value
        mock_conn.query.return_value = _mock_query_result()

        result = client.unlink("follows", "users", 1, "users", 2)

        call_args = mock_conn.query.call_args
        assert "UNLINK" in call_args[0][0]
