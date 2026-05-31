"""Tests for the Transaction API with context managers."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, call

import pytest

from giodb.transaction import (
    AsyncSavepoint,
    AsyncTransaction,
    Savepoint,
    Transaction,
)
from giodb.types import FieldInfo, QueryResult


def _mock_query_result() -> QueryResult:
    return QueryResult(rows=[], fields=[], row_count=0, command="BEGIN")


def _make_mock_conn() -> MagicMock:
    conn = MagicMock()
    conn.query.return_value = _mock_query_result()
    return conn


class TestTransaction:
    def test_commit_on_clean_exit(self):
        conn = _make_mock_conn()
        txn = Transaction(conn)

        with txn:
            conn.query("INSERT INTO t VALUES (1)")

        # Should have committed
        conn.query.assert_any_call("COMMIT")

    def test_rollback_on_exception(self):
        conn = _make_mock_conn()
        txn = Transaction(conn)

        with pytest.raises(ValueError):
            with txn:
                raise ValueError("test error")

        conn.query.assert_any_call("ROLLBACK")

    def test_explicit_commit(self):
        conn = _make_mock_conn()
        txn = Transaction(conn)
        txn.commit()
        conn.query.assert_called_with("COMMIT")

    def test_explicit_rollback(self):
        conn = _make_mock_conn()
        txn = Transaction(conn)
        txn.rollback()
        conn.query.assert_called_with("ROLLBACK")

    def test_no_double_commit(self):
        conn = _make_mock_conn()
        txn = Transaction(conn)
        txn.commit()
        txn.commit()  # Should be no-op
        assert conn.query.call_count == 1

    def test_no_commit_after_explicit_rollback(self):
        conn = _make_mock_conn()
        txn = Transaction(conn)

        with txn:
            txn.rollback()

        # Should not call COMMIT since already rolled back
        calls = [c[0][0] for c in conn.query.call_args_list]
        assert "COMMIT" not in calls


class TestSavepoint:
    def test_release_on_clean_exit(self):
        conn = _make_mock_conn()
        sp = Savepoint(conn, "sp1")

        with sp:
            conn.query("INSERT INTO t VALUES (1)")

        conn.query.assert_any_call('RELEASE SAVEPOINT "sp1"')

    def test_rollback_on_exception(self):
        conn = _make_mock_conn()
        sp = Savepoint(conn, "sp1")

        with pytest.raises(ValueError):
            with sp:
                raise ValueError("test")

        conn.query.assert_any_call('ROLLBACK TO SAVEPOINT "sp1"')

    def test_nested_savepoints(self):
        conn = _make_mock_conn()
        txn = Transaction(conn)

        with txn:
            sp1 = txn.savepoint("sp1")
            with sp1:
                pass  # Clean exit releases sp1

        calls = [c[0][0] for c in conn.query.call_args_list]
        assert 'SAVEPOINT "sp1"' in calls
        assert 'RELEASE SAVEPOINT "sp1"' in calls
        assert "COMMIT" in calls

    def test_rollback_to(self):
        conn = _make_mock_conn()
        txn = Transaction(conn)
        txn.rollback_to("sp1")
        conn.query.assert_called_with('ROLLBACK TO SAVEPOINT "sp1"')


class TestAsyncTransaction:
    @pytest.mark.asyncio
    async def test_commit_on_clean_exit(self):
        conn = AsyncMock()
        conn.query.return_value = _mock_query_result()
        txn = AsyncTransaction(conn)

        async with txn:
            await conn.query("INSERT INTO t VALUES (1)")

        conn.query.assert_any_call("COMMIT")

    @pytest.mark.asyncio
    async def test_rollback_on_exception(self):
        conn = AsyncMock()
        conn.query.return_value = _mock_query_result()
        txn = AsyncTransaction(conn)

        with pytest.raises(ValueError):
            async with txn:
                raise ValueError("test error")

        conn.query.assert_any_call("ROLLBACK")

    @pytest.mark.asyncio
    async def test_explicit_commit(self):
        conn = AsyncMock()
        conn.query.return_value = _mock_query_result()
        txn = AsyncTransaction(conn)
        await txn.commit()
        conn.query.assert_called_with("COMMIT")

    @pytest.mark.asyncio
    async def test_savepoint(self):
        conn = AsyncMock()
        conn.query.return_value = _mock_query_result()
        txn = AsyncTransaction(conn)

        sp = await txn.savepoint("sp1")
        async with sp:
            pass

        conn.query.assert_any_call('SAVEPOINT "sp1"')
        conn.query.assert_any_call('RELEASE SAVEPOINT "sp1"')


class TestAsyncSavepoint:
    @pytest.mark.asyncio
    async def test_rollback_on_exception(self):
        conn = AsyncMock()
        conn.query.return_value = _mock_query_result()
        sp = AsyncSavepoint(conn, "sp1")

        with pytest.raises(ValueError):
            async with sp:
                raise ValueError("test")

        conn.query.assert_any_call('ROLLBACK TO SAVEPOINT "sp1"')
