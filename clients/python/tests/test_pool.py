"""Tests for the connection pool."""

from unittest.mock import MagicMock, patch

import pytest

from giodb.exceptions import InterfaceError, OperationalError
from giodb.pool import Pool, PoolClient
from giodb.types import FieldInfo, PoolConfig, QueryResult


def _mock_query_result() -> QueryResult:
    return QueryResult(
        rows=[{"id": 1}],
        fields=[FieldInfo(name="id", data_type_id=23)],
        row_count=1,
        command="SELECT",
    )


class TestPoolClient:
    def test_query(self):
        mock_conn = MagicMock()
        mock_conn.query.return_value = _mock_query_result()
        release_fn = MagicMock()

        client = PoolClient(mock_conn, release_fn)
        result = client.query("SELECT 1")

        assert result.rows == [{"id": 1}]
        mock_conn.query.assert_called_once_with("SELECT 1", None)

    def test_release(self):
        mock_conn = MagicMock()
        release_fn = MagicMock()

        client = PoolClient(mock_conn, release_fn)
        client.release()

        release_fn.assert_called_once_with(mock_conn, None)

    def test_double_release(self):
        mock_conn = MagicMock()
        release_fn = MagicMock()

        client = PoolClient(mock_conn, release_fn)
        client.release()
        client.release()  # Should be ignored

        release_fn.assert_called_once()

    def test_query_after_release(self):
        mock_conn = MagicMock()
        release_fn = MagicMock()

        client = PoolClient(mock_conn, release_fn)
        client.release()

        with pytest.raises(InterfaceError, match="released"):
            client.query("SELECT 1")

    def test_context_manager(self):
        mock_conn = MagicMock()
        release_fn = MagicMock()

        with PoolClient(mock_conn, release_fn) as client:
            pass

        release_fn.assert_called_once()

    def test_context_manager_with_error(self):
        mock_conn = MagicMock()
        release_fn = MagicMock()

        with pytest.raises(ValueError):
            with PoolClient(mock_conn, release_fn) as client:
                raise ValueError("test error")

        # Should be called with the error
        release_fn.assert_called_once()
        assert isinstance(release_fn.call_args[0][1], ValueError)


class TestPool:
    @patch("giodb.pool.Connection")
    def test_connect_and_query(self, MockConn):
        mock_conn = MockConn.return_value
        mock_conn.query.return_value = _mock_query_result()

        pool = Pool(max_size=5)
        result = pool.query("SELECT 1")

        assert result.rows == [{"id": 1}]
        mock_conn.connect.assert_called_once()

    @patch("giodb.pool.Connection")
    def test_connection_reuse(self, MockConn):
        mock_conn = MockConn.return_value
        mock_conn.query.return_value = _mock_query_result()

        pool = Pool(max_size=5)
        pool.query("SELECT 1")
        pool.query("SELECT 2")

        # Should reuse the same connection
        assert MockConn.return_value.connect.call_count == 1

    @patch("giodb.pool.Connection")
    def test_pool_counts(self, MockConn):
        mock_conn = MockConn.return_value
        mock_conn.query.return_value = _mock_query_result()

        pool = Pool(max_size=5)
        assert pool.total_count == 0
        assert pool.idle_count == 0

        pool.query("SELECT 1")
        assert pool.total_count == 1
        assert pool.idle_count == 1

    @patch("giodb.pool.Connection")
    def test_pool_end(self, MockConn):
        mock_conn = MockConn.return_value
        mock_conn.query.return_value = _mock_query_result()

        pool = Pool(max_size=5)
        pool.query("SELECT 1")
        pool.end()

        mock_conn.end.assert_called()

        with pytest.raises(InterfaceError, match="closed"):
            pool.query("SELECT 1")

    @patch("giodb.pool.Connection")
    def test_end_idempotent(self, MockConn):
        pool = Pool(max_size=5)
        pool.end()
        pool.end()  # Should not raise

    @patch("giodb.pool.Connection")
    def test_checkout_and_release(self, MockConn):
        mock_conn = MockConn.return_value
        mock_conn.query.return_value = _mock_query_result()

        pool = Pool(max_size=5)
        client = pool.connect()

        result = client.query("SELECT 1")
        assert result.rows == [{"id": 1}]

        client.release()
        assert pool.idle_count == 1

    @patch("giodb.pool.Connection")
    def test_release_with_error_destroys(self, MockConn):
        mock_conn = MockConn.return_value
        mock_conn.query.return_value = _mock_query_result()

        pool = Pool(max_size=5)
        client = pool.connect()
        client.release(err=True)

        # Connection destroyed, not returned to pool
        assert pool.idle_count == 0
        mock_conn.end.assert_called()


class TestPoolHelpers:
    @patch("giodb.pool.Connection")
    def test_traverse(self, MockConn):
        mock_conn = MockConn.return_value
        mock_conn.query.return_value = _mock_query_result()

        pool = Pool(max_size=5)
        result = pool.traverse("follows", "users", 1)

        call_args = mock_conn.query.call_args
        assert "TRAVERSE" in call_args[0][0]

    @patch("giodb.pool.Connection")
    def test_nearest(self, MockConn):
        mock_conn = MockConn.return_value
        mock_conn.query.return_value = _mock_query_result()

        pool = Pool(max_size=5)
        result = pool.nearest("posts", "embedding", "[0.1,0.2]")

        call_args = mock_conn.query.call_args
        assert "NEAREST" in call_args[0][0]

    @patch("giodb.pool.Connection")
    def test_link(self, MockConn):
        mock_conn = MockConn.return_value
        mock_conn.query.return_value = _mock_query_result()

        pool = Pool(max_size=5)
        result = pool.link("follows", "users", 1, "users", 2)

        call_args = mock_conn.query.call_args
        assert "LINK" in call_args[0][0]

    @patch("giodb.pool.Connection")
    def test_unlink(self, MockConn):
        mock_conn = MockConn.return_value
        mock_conn.query.return_value = _mock_query_result()

        pool = Pool(max_size=5)
        result = pool.unlink("follows", "users", 1, "users", 2)

        call_args = mock_conn.query.call_args
        assert "UNLINK" in call_args[0][0]
