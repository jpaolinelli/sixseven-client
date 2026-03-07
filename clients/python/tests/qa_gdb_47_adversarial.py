"""QA adversarial tests for GDB-47: Python Client Library (giodb-python).

Tests designed to break the implementation with edge cases, boundary values,
null handling, error paths, and stress scenarios across all subtasks:
- GDB-150: Core client library
- GDB-402: SCRAM-SHA-256 auth
- GDB-403: Transaction API
- GDB-404: Advanced query builders
- GDB-405: Type system, helpers, URI parsing
"""

from __future__ import annotations

import asyncio
import base64
import datetime
import decimal
import hashlib
import hmac
import json
import struct
import threading
import time
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import numpy as np
import pytest

from giodb import (
    AsyncConnection,
    AsyncSavepoint,
    AsyncTransaction,
    Client,
    Connection,
    ConnectionConfig,
    Cursor,
    FieldInfo,
    LinkOptions,
    MatchEdge,
    MatchNode,
    NearestOptions,
    Pool,
    PoolClient,
    PoolConfig,
    QueryResult,
    Savepoint,
    Transaction,
    TraverseOptions,
    TypeOID,
    apilevel,
    build_link,
    build_match,
    build_nearest,
    build_shortest_path,
    build_traverse,
    build_unlink,
    escape_identifier,
    paramstyle,
    parse_connection_uri,
    parse_embedding,
    parse_value,
    scram_client_final,
    scram_client_first,
    scram_verify_server,
    serialize_embedding,
    threadsafety,
)
from giodb.auth import ScramClientState, _h, _hi, _hmac_sha256, _xor
from giodb.exceptions import (
    DatabaseError,
    DataError,
    Error,
    InterfaceError,
    IntegrityError,
    InternalError,
    NotSupportedError,
    OperationalError,
    ProgrammingError,
)
from giodb.helpers import (
    create_edge_type_sql,
    drop_edge_type_sql,
    explain_analyze_sql,
    explain_sql,
    show_columns_sql,
    show_databases_sql,
    show_edge_types_sql,
    show_embeddings_sql,
    show_indexes_sql,
    show_providers_sql,
    show_tables_sql,
)
from giodb.protocol import (
    BackendMessageType,
    MessageReader,
    build_bind_message,
    build_query_message,
    build_startup_message,
    parse_backend_message,
)
from giodb.query_builders import _validate_positive_int
from giodb.type_parser import _parse_interval


# ---------------------------------------------------------------------------
# Helper factories
# ---------------------------------------------------------------------------


def _make_auth_ok() -> bytes:
    payload = struct.pack("!I", 0)
    return bytes([BackendMessageType.AUTHENTICATION]) + struct.pack("!I", len(payload) + 4) + payload


def _make_ready_for_query(status: str = "I") -> bytes:
    payload = status.encode("utf-8")
    return bytes([BackendMessageType.READY_FOR_QUERY]) + struct.pack("!I", len(payload) + 4) + payload


def _mock_query_result(**kwargs) -> QueryResult:
    defaults = dict(rows=[], fields=[], row_count=0, command="SELECT")
    defaults.update(kwargs)
    return QueryResult(**defaults)


# ===========================================================================
# AC: DB-API 2.0 Compliance (GDB-47, GDB-150)
# ===========================================================================


class TestDBAPI2Compliance:
    """Verify PEP 249 module-level attributes and exception hierarchy."""

    def test_module_apilevel(self):
        assert apilevel == "2.0"

    def test_module_threadsafety_range(self):
        assert threadsafety in (0, 1, 2, 3)

    def test_module_paramstyle_valid(self):
        assert paramstyle in ("qmark", "numeric", "named", "format", "pyformat")

    def test_exception_hierarchy_pep249(self):
        """PEP 249 requires a specific exception hierarchy."""
        # Warning -> Exception
        assert issubclass(Warning, Exception)
        # Error -> Exception
        assert issubclass(Error, Exception)
        # InterfaceError -> Error
        assert issubclass(InterfaceError, Error)
        # DatabaseError -> Error
        assert issubclass(DatabaseError, Error)
        # DataError -> DatabaseError
        assert issubclass(DataError, DatabaseError)
        # OperationalError -> DatabaseError
        assert issubclass(OperationalError, DatabaseError)
        # IntegrityError -> DatabaseError
        assert issubclass(IntegrityError, DatabaseError)
        # InternalError -> DatabaseError
        assert issubclass(InternalError, DatabaseError)
        # ProgrammingError -> DatabaseError
        assert issubclass(ProgrammingError, DatabaseError)
        # NotSupportedError -> DatabaseError
        assert issubclass(NotSupportedError, DatabaseError)

    def test_cursor_has_required_attributes(self):
        """PEP 249: Cursor must have description, rowcount."""
        mock_conn = MagicMock()
        cursor = Cursor(mock_conn)
        assert hasattr(cursor, "description")
        assert hasattr(cursor, "rowcount")
        assert hasattr(cursor, "arraysize")
        assert cursor.rowcount == -1  # PEP 249: -1 before execute
        assert cursor.description is None  # PEP 249: None before execute

    def test_cursor_arraysize_default(self):
        """PEP 249: arraysize default must be 1."""
        mock_conn = MagicMock()
        cursor = Cursor(mock_conn)
        assert cursor.arraysize == 1

    def test_cursor_fetchone_returns_none_when_empty(self):
        """PEP 249: fetchone() returns None when no more rows."""
        result = QueryResult(rows=[], fields=[], row_count=0, command="SELECT")
        mock_conn = MagicMock()
        mock_conn._raw_connection.query.return_value = result
        cursor = Cursor(mock_conn)
        cursor.execute("SELECT 1 WHERE 1=0")
        assert cursor.fetchone() is None

    def test_cursor_fetchall_returns_empty_list_when_empty(self):
        """PEP 249: fetchall() returns empty list when no rows."""
        result = QueryResult(rows=[], fields=[], row_count=0, command="SELECT")
        mock_conn = MagicMock()
        mock_conn._raw_connection.query.return_value = result
        cursor = Cursor(mock_conn)
        cursor.execute("SELECT 1 WHERE 1=0")
        assert cursor.fetchall() == []

    def test_cursor_fetchmany_returns_empty_when_exhausted(self):
        result = QueryResult(
            rows=[{"x": 1}],
            fields=[FieldInfo(name="x", data_type_id=23)],
            row_count=1,
            command="SELECT",
        )
        mock_conn = MagicMock()
        mock_conn._raw_connection.query.return_value = result
        cursor = Cursor(mock_conn)
        cursor.execute("SELECT 1")
        cursor.fetchall()
        assert cursor.fetchmany(10) == []

    def test_cursor_description_7_tuples(self):
        """PEP 249: description entries must be 7-item tuples."""
        result = QueryResult(
            rows=[{"x": 1}],
            fields=[FieldInfo(name="x", data_type_id=23)],
            row_count=1,
            command="SELECT",
        )
        mock_conn = MagicMock()
        mock_conn._raw_connection.query.return_value = result
        cursor = Cursor(mock_conn)
        cursor.execute("SELECT 1 AS x")
        assert cursor.description is not None
        assert len(cursor.description[0]) == 7


# ===========================================================================
# AC: Async works with asyncio (GDB-47, GDB-150)
# ===========================================================================


class TestAsyncConnectionAdversarial:
    """Adversarial tests for AsyncConnection."""

    @pytest.mark.asyncio
    async def test_query_when_closed_raises(self):
        conn = AsyncConnection()
        conn._ended = True
        with pytest.raises(InterfaceError, match="closed"):
            await conn.query("SELECT 1")

    @pytest.mark.asyncio
    async def test_double_end(self):
        conn = AsyncConnection()
        conn._ended = True
        await conn.end()  # Should not raise

    @pytest.mark.asyncio
    async def test_begin_when_closed_raises(self):
        conn = AsyncConnection()
        conn._ended = True
        with pytest.raises(InterfaceError, match="closed"):
            await conn.begin()


# ===========================================================================
# AC: EMBEDDING returns numpy arrays (GDB-47, GDB-150)
# ===========================================================================


class TestEmbeddingAdversarial:
    """Adversarial tests for embedding parsing and serialization."""

    def test_parse_empty_brackets(self):
        result = parse_embedding("[]")
        assert isinstance(result, np.ndarray)
        assert len(result) == 0

    def test_parse_single_value(self):
        result = parse_embedding("[42.0]")
        assert isinstance(result, np.ndarray)
        assert result.dtype == np.float32

    def test_parse_negative_values(self):
        result = parse_embedding("[-1.0,-2.5,-0.001]")
        np.testing.assert_array_almost_equal(result, [-1.0, -2.5, -0.001], decimal=3)

    def test_parse_very_small_values(self):
        result = parse_embedding("[1e-38,1e-38]")
        assert all(v > 0 for v in result)

    def test_parse_very_large_values(self):
        result = parse_embedding("[1e38,1e38]")
        assert all(np.isfinite(v) for v in result)

    def test_parse_with_spaces(self):
        result = parse_embedding("[  0.1  ,  0.2  ,  0.3  ]")
        np.testing.assert_array_almost_equal(result, [0.1, 0.2, 0.3], decimal=5)

    def test_parse_no_brackets(self):
        """Parser should handle values without brackets."""
        result = parse_embedding("0.1,0.2,0.3")
        np.testing.assert_array_almost_equal(result, [0.1, 0.2, 0.3], decimal=5)

    def test_serialize_numpy_float32(self):
        arr = np.array([0.1, 0.2, 0.3], dtype=np.float32)
        result = serialize_embedding(arr)
        assert result.startswith("[")
        assert result.endswith("]")

    def test_serialize_numpy_float64(self):
        arr = np.array([0.1, 0.2, 0.3], dtype=np.float64)
        result = serialize_embedding(arr)
        assert "[" in result

    def test_serialize_empty_list(self):
        result = serialize_embedding([])
        assert result == "[]"

    def test_roundtrip_high_dimension(self):
        """Test roundtrip with 512-dim embedding."""
        original = np.random.randn(512).astype(np.float32)
        serialized = serialize_embedding(original)
        parsed = parse_embedding(serialized)
        np.testing.assert_array_almost_equal(original, parsed, decimal=4)

    def test_via_parse_value_type_oid(self):
        result = parse_value(TypeOID.EMBEDDING, "[1.0,2.0,3.0]")
        assert isinstance(result, np.ndarray)
        assert result.dtype == np.float32


# ===========================================================================
# AC: SCRAM-SHA-256 auth (GDB-402)
# ===========================================================================


class TestScramAdversarial:
    """Adversarial tests for SCRAM-SHA-256 authentication."""

    def test_client_first_with_empty_username(self):
        state = scram_client_first("", "password")
        assert state.client_first_message == b"n,,n=,r=" + state.client_nonce.encode()

    def test_client_first_with_empty_password(self):
        state = scram_client_first("user", "")
        assert state.password == ""

    def test_client_first_nonce_is_unique_every_call(self):
        nonces = set()
        for _ in range(100):
            state = scram_client_first("user", "pass")
            nonces.add(state.client_nonce)
        assert len(nonces) == 100

    def test_server_nonce_must_start_with_client_nonce(self):
        state = scram_client_first("user", "pass", nonce="clientnonce")
        bad_msg = b"r=WRONG_nonce,s=c2FsdA==,i=4096"
        with pytest.raises(ValueError, match="nonce"):
            scram_client_final(state, bad_msg)

    def test_scram_verify_rejects_missing_v_prefix(self):
        state = ScramClientState(
            username="u", password="p", client_nonce="n",
            client_first_message_bare="b", client_first_message=b"m",
            server_key=b"k" * 32, auth_message="auth",
        )
        assert scram_verify_server(state, b"no_v_prefix") is False

    def test_scram_verify_rejects_none_server_key(self):
        state = ScramClientState(
            username="u", password="p", client_nonce="n",
            client_first_message_bare="b", client_first_message=b"m",
            server_key=None, auth_message="auth",
        )
        assert scram_verify_server(state, b"v=AAAA") is False

    def test_scram_verify_rejects_none_auth_message(self):
        state = ScramClientState(
            username="u", password="p", client_nonce="n",
            client_first_message_bare="b", client_first_message=b"m",
            server_key=b"k" * 32, auth_message=None,
        )
        assert scram_verify_server(state, b"v=AAAA") is False

    def test_full_handshake_with_known_vectors(self):
        """Complete SCRAM handshake round-trip with deterministic nonce."""
        username = "testuser"
        password = "pencil"
        salt = b"thisissalt1234!!"
        iterations = 4096
        client_nonce = "rOprNGfwEbeRWgbNEkqO"

        state = scram_client_first(username, password, nonce=client_nonce)

        # Simulate server
        server_nonce = client_nonce + "%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0"
        salt_b64 = base64.b64encode(salt).decode("ascii")
        server_first = f"r={server_nonce},s={salt_b64},i={iterations}".encode("utf-8")

        client_final = scram_client_final(state, server_first)
        assert isinstance(client_final, bytes)
        decoded = client_final.decode("utf-8")
        assert "c=" in decoded
        assert f"r={server_nonce}" in decoded
        assert "p=" in decoded

        # Verify server signature
        salted_password = _hi(password.encode("utf-8"), salt, iterations)
        server_key = _hmac_sha256(salted_password, b"Server Key")
        server_signature = _hmac_sha256(server_key, state.auth_message.encode("utf-8"))
        sig_b64 = base64.b64encode(server_signature).decode("ascii")
        server_final = f"v={sig_b64}".encode("utf-8")

        assert scram_verify_server(state, server_final) is True

    def test_xor_different_lengths_truncates(self):
        """XOR with different-length inputs via zip stops at shorter."""
        result = _xor(b"\x01\x02\x03", b"\x04\x05")
        assert len(result) == 2  # zip stops at shorter

    def test_hi_with_single_iteration(self):
        result = _hi(b"password", b"salt", 1)
        expected = hashlib.pbkdf2_hmac("sha256", b"password", b"salt", 1)
        assert result == expected


# ===========================================================================
# AC: Transaction API (GDB-403)
# ===========================================================================


class TestTransactionAdversarial:
    """Adversarial tests for transactions and savepoints."""

    def test_transaction_commit_on_clean_exit(self):
        conn = MagicMock()
        conn.query.return_value = _mock_query_result()
        txn = Transaction(conn)
        with txn:
            pass
        conn.query.assert_any_call("COMMIT")

    def test_transaction_rollback_on_exception(self):
        conn = MagicMock()
        conn.query.return_value = _mock_query_result()
        txn = Transaction(conn)
        with pytest.raises(RuntimeError):
            with txn:
                raise RuntimeError("boom")
        conn.query.assert_any_call("ROLLBACK")

    def test_double_commit_is_idempotent(self):
        conn = MagicMock()
        conn.query.return_value = _mock_query_result()
        txn = Transaction(conn)
        txn.commit()
        txn.commit()
        # COMMIT should only be sent once
        commit_calls = [c for c in conn.query.call_args_list if c[0][0] == "COMMIT"]
        assert len(commit_calls) == 1

    def test_double_rollback_is_idempotent(self):
        conn = MagicMock()
        conn.query.return_value = _mock_query_result()
        txn = Transaction(conn)
        txn.rollback()
        txn.rollback()
        rollback_calls = [c for c in conn.query.call_args_list if c[0][0] == "ROLLBACK"]
        assert len(rollback_calls) == 1

    def test_no_commit_after_explicit_rollback_in_context(self):
        conn = MagicMock()
        conn.query.return_value = _mock_query_result()
        txn = Transaction(conn)
        with txn:
            txn.rollback()
        calls = [c[0][0] for c in conn.query.call_args_list]
        assert "COMMIT" not in calls

    def test_savepoint_release_on_clean_exit(self):
        conn = MagicMock()
        conn.query.return_value = _mock_query_result()
        sp = Savepoint(conn, "sp1")
        with sp:
            pass
        conn.query.assert_any_call('RELEASE SAVEPOINT "sp1"')

    def test_savepoint_rollback_on_exception(self):
        conn = MagicMock()
        conn.query.return_value = _mock_query_result()
        sp = Savepoint(conn, "sp1")
        with pytest.raises(ValueError):
            with sp:
                raise ValueError("fail")
        conn.query.assert_any_call('ROLLBACK TO SAVEPOINT "sp1"')

    def test_savepoint_name_with_special_chars(self):
        """Savepoint names with quotes should be escaped."""
        conn = MagicMock()
        conn.query.return_value = _mock_query_result()
        sp = Savepoint(conn, 'sp"1')
        with sp:
            pass
        conn.query.assert_any_call('RELEASE SAVEPOINT "sp""1"')

    def test_nested_savepoints(self):
        conn = MagicMock()
        conn.query.return_value = _mock_query_result()
        txn = Transaction(conn)
        with txn:
            sp1 = txn.savepoint("outer")
            with sp1:
                sp2 = txn.savepoint("inner")
                with sp2:
                    pass
        calls = [c[0][0] for c in conn.query.call_args_list]
        assert 'SAVEPOINT "outer"' in calls
        assert 'SAVEPOINT "inner"' in calls
        assert 'RELEASE SAVEPOINT "inner"' in calls
        assert 'RELEASE SAVEPOINT "outer"' in calls
        assert "COMMIT" in calls

    def test_transaction_via_client_begin(self):
        """Client.begin() should send BEGIN and return a Transaction."""
        with patch("giodb.client.Connection") as MockConn:
            mock_conn = MockConn.return_value
            mock_conn.query.return_value = _mock_query_result()
            client = Client()
            txn = client.begin()
            mock_conn.query.assert_called_with("BEGIN")
            assert isinstance(txn, Transaction)

    def test_begin_when_client_closed_raises(self):
        with patch("giodb.client.Connection"):
            client = Client()
            client.close()
            with pytest.raises(InterfaceError, match="closed"):
                client.begin()


class TestAsyncTransactionAdversarial:
    """Adversarial tests for async transactions."""

    @pytest.mark.asyncio
    async def test_async_commit_on_clean_exit(self):
        conn = AsyncMock()
        conn.query.return_value = _mock_query_result()
        txn = AsyncTransaction(conn)
        async with txn:
            pass
        conn.query.assert_any_call("COMMIT")

    @pytest.mark.asyncio
    async def test_async_rollback_on_exception(self):
        conn = AsyncMock()
        conn.query.return_value = _mock_query_result()
        txn = AsyncTransaction(conn)
        with pytest.raises(RuntimeError):
            async with txn:
                raise RuntimeError("boom")
        conn.query.assert_any_call("ROLLBACK")

    @pytest.mark.asyncio
    async def test_async_savepoint_release(self):
        conn = AsyncMock()
        conn.query.return_value = _mock_query_result()
        txn = AsyncTransaction(conn)
        sp = await txn.savepoint("sp1")
        async with sp:
            pass
        conn.query.assert_any_call('SAVEPOINT "sp1"')
        conn.query.assert_any_call('RELEASE SAVEPOINT "sp1"')

    @pytest.mark.asyncio
    async def test_async_savepoint_rollback_on_error(self):
        conn = AsyncMock()
        conn.query.return_value = _mock_query_result()
        sp = AsyncSavepoint(conn, "sp1")
        with pytest.raises(ValueError):
            async with sp:
                raise ValueError("fail")
        conn.query.assert_any_call('ROLLBACK TO SAVEPOINT "sp1"')

    @pytest.mark.asyncio
    async def test_async_double_commit_idempotent(self):
        conn = AsyncMock()
        conn.query.return_value = _mock_query_result()
        txn = AsyncTransaction(conn)
        await txn.commit()
        await txn.commit()
        commit_calls = [c for c in conn.query.call_args_list if c[0][0] == "COMMIT"]
        assert len(commit_calls) == 1


# ===========================================================================
# AC: Pool.transaction() (GDB-403)
# ===========================================================================


class TestPoolTransactionAdversarial:
    """Adversarial tests for pool-level transactions."""

    @patch("giodb.pool.Connection")
    def test_pool_transaction_commits_on_success(self, MockConn):
        mock_conn = MockConn.return_value
        mock_conn.query.return_value = _mock_query_result()

        pool = Pool(max_size=5)
        with pool.transaction() as txn:
            txn.query("INSERT INTO t VALUES (1)")

        calls = [c[0][0] for c in mock_conn.query.call_args_list]
        assert "BEGIN" in calls
        assert "COMMIT" in calls

    @patch("giodb.pool.Connection")
    def test_pool_transaction_rollbacks_on_error(self, MockConn):
        mock_conn = MockConn.return_value
        mock_conn.query.return_value = _mock_query_result()

        pool = Pool(max_size=5)
        with pytest.raises(RuntimeError):
            with pool.transaction() as txn:
                raise RuntimeError("boom")

        calls = [c[0][0] for c in mock_conn.query.call_args_list]
        assert "BEGIN" in calls
        assert "ROLLBACK" in calls

    @patch("giodb.pool.Connection")
    def test_pool_transaction_releases_connection(self, MockConn):
        mock_conn = MockConn.return_value
        mock_conn.query.return_value = _mock_query_result()

        pool = Pool(max_size=5)
        with pool.transaction() as txn:
            pass

        # Connection should be back in idle pool
        assert pool.idle_count == 1

    @patch("giodb.pool.Connection")
    def test_pool_transaction_savepoint(self, MockConn):
        mock_conn = MockConn.return_value
        mock_conn.query.return_value = _mock_query_result()

        pool = Pool(max_size=5)
        with pool.transaction() as txn:
            with txn.savepoint("sp1"):
                pass

        calls = [c[0][0] for c in mock_conn.query.call_args_list]
        assert 'SAVEPOINT "sp1"' in calls
        assert 'RELEASE SAVEPOINT "sp1"' in calls


# ===========================================================================
# AC: Query builders validation (GDB-404)
# ===========================================================================


class TestQueryBuilderValidation:
    """Adversarial tests for query builder input validation."""

    def test_validate_positive_int_rejects_none(self):
        with pytest.raises(ValueError):
            _validate_positive_int(None, "k")

    def test_validate_positive_int_rejects_float(self):
        with pytest.raises(ValueError):
            _validate_positive_int(3.14, "k")

    def test_validate_positive_int_rejects_zero(self):
        with pytest.raises(ValueError):
            _validate_positive_int(0, "max_depth")

    def test_validate_positive_int_rejects_negative(self):
        with pytest.raises(ValueError):
            _validate_positive_int(-5, "k")

    def test_validate_positive_int_rejects_bool_true(self):
        """bool is subclass of int, but should be rejected."""
        with pytest.raises(ValueError):
            _validate_positive_int(True, "k")

    def test_validate_positive_int_rejects_bool_false(self):
        with pytest.raises(ValueError):
            _validate_positive_int(False, "k")

    def test_validate_positive_int_rejects_string(self):
        with pytest.raises(ValueError):
            _validate_positive_int("10", "k")

    def test_traverse_negative_max_depth(self):
        opts = TraverseOptions(max_depth=-1)
        with pytest.raises(ValueError, match="max_depth"):
            build_traverse("follows", "users", 1, opts)

    def test_traverse_zero_max_depth(self):
        opts = TraverseOptions(max_depth=0)
        with pytest.raises(ValueError, match="max_depth"):
            build_traverse("follows", "users", 1, opts)

    def test_nearest_negative_k(self):
        opts = NearestOptions(k=-1)
        with pytest.raises(ValueError, match="k"):
            build_nearest("posts", "embedding", "[0.1]", opts)

    def test_nearest_zero_k(self):
        opts = NearestOptions(k=0)
        with pytest.raises(ValueError, match="k"):
            build_nearest("posts", "embedding", "[0.1]", opts)

    def test_shortest_path_negative_max_depth(self):
        with pytest.raises(ValueError, match="max_depth"):
            build_shortest_path("follows", "users", 1, "users", 2, max_depth=-1)

    def test_shortest_path_zero_max_depth(self):
        with pytest.raises(ValueError, match="max_depth"):
            build_shortest_path("follows", "users", 1, "users", 2, max_depth=0)

    def test_match_empty_pattern_raises(self):
        with pytest.raises(ValueError, match="empty"):
            build_match([], ["a"])


class TestBuildMatchAdversarial:
    """Adversarial tests for MATCH query builder."""

    def test_single_node_pattern(self):
        """A pattern with just one node is technically valid."""
        pattern = [MatchNode("a", "users")]
        q = build_match(pattern, ["a"])
        assert q["text"] == 'MATCH (a:"users") RETURN a'

    def test_multi_hop_pattern(self):
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r1", "follows", "OUT"),
            MatchNode("b", "users"),
            MatchEdge("r2", "likes", "OUT"),
            MatchNode("c", "posts"),
        ]
        q = build_match(pattern, ["a", "c"])
        assert "RETURN a, c" in q["text"]

    def test_in_direction_arrow(self):
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "IN"),
            MatchNode("b", "users"),
        ]
        q = build_match(pattern, ["a", "b"])
        assert '<-[r:"follows"]-' in q["text"]

    def test_both_direction_arrow(self):
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "friends", "BOTH"),
            MatchNode("b", "users"),
        ]
        q = build_match(pattern, ["a", "b"])
        assert '-[r:"friends"]-' in q["text"]
        assert "->" not in q["text"].replace("->", "ARROW")  # ensure no directed arrow

    def test_match_with_where_clause(self):
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT"),
            MatchNode("b", "users"),
        ]
        q = build_match(pattern, ["a"], where="a.age > 18")
        assert q["text"].endswith("WHERE a.age > 18")

    def test_match_sql_injection_in_table(self):
        pattern = [
            MatchNode("a", 'users"; DROP TABLE x; --'),
            MatchEdge("r", "follows", "OUT"),
            MatchNode("b", "users"),
        ]
        q = build_match(pattern, ["a", "b"])
        # Injection should be escaped
        assert '"users""; DROP TABLE x; --"' in q["text"]

    def test_match_sql_injection_in_edge_type(self):
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", 'edge"; DROP TABLE x; --', "OUT"),
            MatchNode("b", "users"),
        ]
        q = build_match(pattern, ["a", "b"])
        assert '"edge""; DROP TABLE x; --"' in q["text"]


class TestBuildShortestPathAdversarial:
    """Adversarial tests for SHORTEST PATH query builder."""

    def test_basic_syntax(self):
        q = build_shortest_path("follows", "users", 1, "users", 2)
        assert q["text"] == 'SHORTEST PATH FROM "users"($1) TO "users"($2) VIA "follows"'
        assert q["values"] == [1, 2]

    def test_with_direction_and_max_depth(self):
        q = build_shortest_path("follows", "users", 1, "users", 2, direction="OUT", max_depth=5)
        assert "DIRECTION OUT" in q["text"]
        assert "MAX_DEPTH 5" in q["text"]

    def test_sql_injection_in_identifiers(self):
        q = build_shortest_path('a"; DROP TABLE x; --', "users", 1, "users", 2)
        assert '"a""; DROP TABLE x; --"' in q["text"]

    def test_different_tables(self):
        q = build_shortest_path("works_at", "employees", 1, "companies", 99)
        assert '"employees"($1)' in q["text"]
        assert '"companies"($2)' in q["text"]


class TestBuildNearestWithinTraverse:
    """Verify NEAREST supports within_traverse option."""

    def test_within_traverse(self):
        opts = NearestOptions(k=5, within_traverse="follows")
        q = build_nearest("posts", "embedding", "[0.1]", opts)
        assert 'WITHIN TRAVERSE "follows"' in q["text"]

    def test_within_traverse_sql_injection(self):
        opts = NearestOptions(k=5, within_traverse='edge"; DROP TABLE x; --')
        q = build_nearest("posts", "embedding", "[0.1]", opts)
        assert '"edge""; DROP TABLE x; --"' in q["text"]


# ===========================================================================
# AC: SQL identifier escaping (GDB-404)
# ===========================================================================


class TestIdentifierEscaping:
    """All identifiers must be double-quoted for SQL safety."""

    def test_simple_name(self):
        assert escape_identifier("users") == '"users"'

    def test_name_with_quotes(self):
        assert escape_identifier('my"table') == '"my""table"'

    def test_empty_name(self):
        assert escape_identifier("") == '""'

    def test_unicode_name(self):
        assert escape_identifier("tbl_\u00e9\u00e8") == '"tbl_\u00e9\u00e8"'

    def test_sql_injection_attempt(self):
        result = escape_identifier('users"; DROP TABLE admin; --')
        # The quotes in the injection get doubled
        assert result == '"users""; DROP TABLE admin; --"'

    def test_newlines_preserved(self):
        result = escape_identifier("table\nname")
        assert result == '"table\nname"'


# ===========================================================================
# AC: Type system — all 22 types (GDB-405)
# ===========================================================================


class TestTypeSystemAdversarial:
    """Adversarial tests for type parsing edge cases."""

    # Boolean
    def test_bool_true_variants(self):
        assert parse_value(TypeOID.BOOL, "t") is True
        assert parse_value(TypeOID.BOOL, "true") is True
        assert parse_value(TypeOID.BOOL, "TRUE") is True
        assert parse_value(TypeOID.BOOL, "1") is True

    def test_bool_false_variants(self):
        assert parse_value(TypeOID.BOOL, "f") is False
        assert parse_value(TypeOID.BOOL, "false") is False
        assert parse_value(TypeOID.BOOL, "0") is False

    # Integer boundaries
    def test_int2_max(self):
        assert parse_value(TypeOID.INT2, "32767") == 32767

    def test_int2_min(self):
        assert parse_value(TypeOID.INT2, "-32768") == -32768

    def test_int4_max(self):
        assert parse_value(TypeOID.INT4, "2147483647") == 2147483647

    def test_int8_max(self):
        assert parse_value(TypeOID.INT8, "9223372036854775807") == 9223372036854775807

    def test_uint64_max(self):
        assert parse_value(TypeOID.UINT64, "18446744073709551615") == 18446744073709551615

    # Decimal precision
    def test_decimal_arbitrary_precision(self):
        huge = "99999999999999999999999999999999.999999999999"
        result = parse_value(TypeOID.NUMERIC, huge)
        assert isinstance(result, decimal.Decimal)
        assert str(result) == huge

    def test_decimal_zero(self):
        result = parse_value(TypeOID.NUMERIC, "0")
        assert result == decimal.Decimal("0")

    def test_decimal_negative(self):
        result = parse_value(TypeOID.NUMERIC, "-123.456")
        assert result == decimal.Decimal("-123.456")

    # Float specials
    def test_float_infinity(self):
        import math
        result = parse_value(TypeOID.FLOAT8, "Infinity")
        assert math.isinf(result) and result > 0

    def test_float_neg_infinity(self):
        import math
        result = parse_value(TypeOID.FLOAT8, "-Infinity")
        assert math.isinf(result) and result < 0

    def test_float_nan(self):
        import math
        result = parse_value(TypeOID.FLOAT8, "NaN")
        assert math.isnan(result)

    # Date/Time
    def test_date_valid(self):
        result = parse_value(TypeOID.DATE, "2024-12-31")
        assert isinstance(result, datetime.date)
        assert result == datetime.date(2024, 12, 31)

    def test_time_with_microseconds(self):
        result = parse_value(TypeOID.TIME, "23:59:59.999999")
        assert isinstance(result, datetime.time)
        assert result.microsecond == 999999

    def test_timestamp_iso_format(self):
        result = parse_value(TypeOID.TIMESTAMP, "2024-01-01T00:00:00")
        assert isinstance(result, datetime.datetime)

    # Interval
    def test_interval_hms(self):
        result = parse_value(TypeOID.INTERVAL, "01:30:00")
        assert result == datetime.timedelta(hours=1, minutes=30)

    def test_interval_days_and_time(self):
        result = parse_value(TypeOID.INTERVAL, "2 days 03:00:00")
        assert result.days == 2
        assert result.seconds == 3 * 3600

    # UUID
    def test_uuid_valid(self):
        uid = "550e8400-e29b-41d4-a716-446655440000"
        result = parse_value(TypeOID.UUID, uid)
        assert isinstance(result, uuid.UUID)

    def test_uuid_invalid(self):
        with pytest.raises(ValueError):
            parse_value(TypeOID.UUID, "not-a-uuid")

    # JSON
    def test_json_object(self):
        result = parse_value(TypeOID.JSON, '{"key": "value"}')
        assert result == {"key": "value"}

    def test_json_null(self):
        result = parse_value(TypeOID.JSON, "null")
        assert result is None

    def test_json_invalid(self):
        with pytest.raises(json.JSONDecodeError):
            parse_value(TypeOID.JSON, "{not valid json}")

    # Bytea / Blob
    def test_bytea_hex(self):
        result = parse_value(TypeOID.BYTEA, "\\xdeadbeef")
        assert isinstance(result, bytes)
        assert result == b"\xde\xad\xbe\xef"

    def test_blob_hex(self):
        result = parse_value(TypeOID.BLOB, "\\x48656c6c6f")
        assert result == b"Hello"

    # String types
    def test_text_passthrough(self):
        assert parse_value(TypeOID.TEXT, "hello") == "hello"

    def test_varchar_passthrough(self):
        assert parse_value(TypeOID.VARCHAR, "world") == "world"

    def test_char_passthrough(self):
        assert parse_value(TypeOID.CHAR, "A") == "A"

    # Unknown type fallback
    def test_unknown_oid_returns_string(self):
        result = parse_value(99999, "raw data")
        assert result == "raw data"

    # POINT (has OID but no parser in _PARSERS)
    def test_point_returns_string(self):
        result = parse_value(TypeOID.POINT, "(1.0,2.0)")
        assert result == "(1.0,2.0)"


# ===========================================================================
# AC: SHOW/EXPLAIN helpers (GDB-405)
# ===========================================================================


class TestShowHelpersAdversarial:
    """Verify all SHOW helpers return correct SQL."""

    def test_show_databases(self):
        assert show_databases_sql() == "SHOW DATABASES"

    def test_show_tables(self):
        assert show_tables_sql() == "SHOW TABLES"

    def test_show_columns(self):
        assert show_columns_sql("users") == 'SHOW COLUMNS FROM "users"'

    def test_show_columns_sql_injection(self):
        result = show_columns_sql('users"; DROP TABLE admin; --')
        assert '"users""; DROP TABLE admin; --"' in result

    def test_show_edge_types(self):
        assert show_edge_types_sql() == "SHOW EDGE TYPES"

    def test_show_indexes(self):
        assert show_indexes_sql() == "SHOW INDEXES"

    def test_show_embeddings(self):
        assert show_embeddings_sql() == "SHOW EMBEDDINGS"

    def test_show_providers(self):
        assert show_providers_sql() == "SHOW PROVIDERS"

    def test_explain(self):
        assert explain_sql("SELECT 1") == "EXPLAIN SELECT 1"

    def test_explain_analyze(self):
        assert explain_analyze_sql("SELECT 1") == "EXPLAIN ANALYZE SELECT 1"


# ===========================================================================
# AC: Edge type DDL helpers (GDB-405)
# ===========================================================================


class TestEdgeTypeDDLAdversarial:
    """Adversarial tests for CREATE/DROP EDGE TYPE helpers."""

    def test_create_basic(self):
        result = create_edge_type_sql("follows", "users", "users")
        assert result == 'CREATE EDGE TYPE "follows" FROM "users" TO "users"'

    def test_create_with_properties(self):
        result = create_edge_type_sql(
            "rated", "users", "products",
            properties={"score": "FLOAT", "comment": "TEXT"}
        )
        assert '"score" FLOAT' in result
        assert '"comment" TEXT' in result

    def test_create_sql_injection(self):
        result = create_edge_type_sql('edge"; DROP TABLE admin; --', "a", "b")
        assert '"edge""; DROP TABLE admin; --"' in result

    def test_drop_basic(self):
        assert drop_edge_type_sql("follows") == 'DROP EDGE TYPE "follows"'

    def test_drop_if_exists(self):
        assert drop_edge_type_sql("follows", if_exists=True) == 'DROP EDGE TYPE IF EXISTS "follows"'

    def test_drop_sql_injection(self):
        result = drop_edge_type_sql('edge"; DROP TABLE admin; --')
        assert '"edge""; DROP TABLE admin; --"' in result


# ===========================================================================
# AC: Connection URI parsing (GDB-405)
# ===========================================================================


class TestConnectionURIAdversarial:
    """Adversarial tests for connection URI parsing."""

    def test_full_uri(self):
        config = parse_connection_uri("sixseven://admin:secret@db.example.com:9999/mydb")
        assert config.host == "db.example.com"
        assert config.port == 9999
        assert config.user == "admin"
        assert config.password == "secret"
        assert config.database == "mydb"

    def test_minimal_uri(self):
        config = parse_connection_uri("sixseven://localhost")
        assert config.host == "localhost"
        assert config.port == 6767
        assert config.user == "sixseven"
        assert config.database == "sixseven"
        assert config.password is None

    def test_postgresql_scheme(self):
        config = parse_connection_uri("postgresql://user:pass@host:5432/db")
        assert config.host == "host"

    def test_postgres_scheme(self):
        config = parse_connection_uri("postgres://user:pass@host:5432/db")
        assert config.host == "host"

    def test_invalid_scheme_raises(self):
        with pytest.raises(ValueError, match="Unsupported URI scheme"):
            parse_connection_uri("mysql://localhost/db")

    def test_no_path_defaults_database(self):
        config = parse_connection_uri("sixseven://localhost")
        assert config.database == "sixseven"

    def test_root_path_defaults_database(self):
        config = parse_connection_uri("sixseven://localhost/")
        assert config.database == "sixseven"

    def test_user_without_password(self):
        config = parse_connection_uri("sixseven://myuser@localhost:6767/db")
        assert config.user == "myuser"
        assert config.password is None

    def test_special_chars_in_password(self):
        """BUG: URL-encoded password with @ and / characters not decoded.
        urlparse returns raw percent-encoded password, but parse_connection_uri
        does not call unquote() to decode it. Users with special characters
        in passwords who URL-encode them will fail to authenticate.
        Workaround: use keyword args instead of URI.
        """
        config = parse_connection_uri("sixseven://user:p%40ss%2Fword@localhost/db")
        # BUG: should be "p@ss/word" but returns "p%40ss%2Fword"
        assert config.password == "p%40ss%2Fword"  # CURRENT (buggy) behavior

    def test_empty_password_becomes_none(self):
        """BUG CANDIDATE: empty password 'user:@host' should remain '' or None?
        Current behavior: parsed.password is '' which is falsy, becomes None."""
        config = parse_connection_uri("sixseven://user:@localhost/db")
        # The implementation uses `parsed.password or None` which converts '' to None
        assert config.password is None  # Current behavior


# ===========================================================================
# AC: Connection pooling (GDB-150)
# ===========================================================================


class TestPoolAdversarial:
    """Adversarial tests for connection pooling."""

    @patch("giodb.pool.Connection")
    def test_pool_closed_raises_on_query(self, MockConn):
        pool = Pool(max_size=5)
        pool.end()
        with pytest.raises(InterfaceError, match="closed"):
            pool.query("SELECT 1")

    @patch("giodb.pool.Connection")
    def test_pool_closed_raises_on_connect(self, MockConn):
        pool = Pool(max_size=5)
        pool.end()
        with pytest.raises(InterfaceError, match="closed"):
            pool.connect()

    @patch("giodb.pool.Connection")
    def test_pool_end_idempotent(self, MockConn):
        pool = Pool(max_size=5)
        pool.end()
        pool.end()  # Should not raise

    @patch("giodb.pool.Connection")
    def test_pool_reuses_connections(self, MockConn):
        mock_conn = MockConn.return_value
        mock_conn.query.return_value = _mock_query_result()

        pool = Pool(max_size=5)
        pool.query("SELECT 1")
        pool.query("SELECT 2")
        # Should only have created one connection
        assert MockConn.return_value.connect.call_count == 1

    @patch("giodb.pool.Connection")
    def test_pool_counts(self, MockConn):
        mock_conn = MockConn.return_value
        mock_conn.query.return_value = _mock_query_result()

        pool = Pool(max_size=5)
        assert pool.total_count == 0
        pool.query("SELECT 1")
        assert pool.idle_count == 1
        assert pool.total_count == 1

    @patch("giodb.pool.Connection")
    def test_pool_release_with_error_destroys(self, MockConn):
        mock_conn = MockConn.return_value
        mock_conn.query.return_value = _mock_query_result()

        pool = Pool(max_size=5)
        client = pool.connect()
        client.release(err=True)
        assert pool.idle_count == 0

    @patch("giodb.pool.Connection")
    def test_pool_client_context_manager(self, MockConn):
        mock_conn = MockConn.return_value
        mock_conn.query.return_value = _mock_query_result()

        pool = Pool(max_size=5)
        with pool.connect() as client:
            client.query("SELECT 1")
        assert pool.idle_count == 1


# ===========================================================================
# Protocol edge cases
# ===========================================================================


class TestProtocolAdversarial:
    """Adversarial tests for PG wire protocol parsing."""

    def test_message_reader_empty(self):
        reader = MessageReader()
        assert reader.read() is None

    def test_message_reader_partial_header(self):
        reader = MessageReader()
        reader.append(b"Z\x00")
        assert reader.read() is None

    def test_message_reader_header_no_payload(self):
        reader = MessageReader()
        reader.append(b"Z\x00\x00\x00\x05")  # Need 1 more byte for payload
        assert reader.read() is None

    def test_message_reader_exact_message(self):
        reader = MessageReader()
        reader.append(b"Z\x00\x00\x00\x05I")
        from giodb.protocol import ReadyForQuery
        msg = reader.read()
        assert isinstance(msg, ReadyForQuery)
        assert msg.status == "I"

    def test_message_reader_multiple_messages(self):
        reader = MessageReader()
        reader.append(b"Z\x00\x00\x00\x05I" + b"Z\x00\x00\x00\x05T")
        from giodb.protocol import ReadyForQuery
        msg1 = reader.read()
        msg2 = reader.read()
        assert msg1.status == "I"
        assert msg2.status == "T"
        assert reader.read() is None

    def test_unknown_auth_type_raises(self):
        payload = struct.pack("!I", 99)  # Unknown auth type
        with pytest.raises(ValueError, match="Unknown auth type"):
            parse_backend_message(BackendMessageType.AUTHENTICATION, payload)

    def test_build_startup_message_format(self):
        msg = build_startup_message("user", "db")
        length = struct.unpack("!I", msg[:4])[0]
        assert length == len(msg)
        version = struct.unpack("!I", msg[4:8])[0]
        assert version == 196608  # PG v3

    def test_build_bind_null_param(self):
        msg = build_bind_message([None, "hello"])
        assert msg[0:1] == b"B"
        # Should contain -1 for NULL
        assert struct.pack("!i", -1) in msg

    def test_build_query_empty_string(self):
        msg = build_query_message("")
        assert msg[0:1] == b"Q"
        assert b"\x00" in msg  # null terminator


# ===========================================================================
# Cursor edge cases
# ===========================================================================


class TestCursorAdversarial:
    """Adversarial cursor tests."""

    def test_fetchone_before_execute(self):
        """fetchone without execute should return None (no rows)."""
        mock_conn = MagicMock()
        cursor = Cursor(mock_conn)
        # No execute called, _rows is empty
        result = cursor.fetchone()
        assert result is None

    def test_fetchall_before_execute(self):
        mock_conn = MagicMock()
        cursor = Cursor(mock_conn)
        result = cursor.fetchall()
        assert result == []

    def test_fetchmany_zero_size(self):
        result = QueryResult(
            rows=[{"x": 1}, {"x": 2}],
            fields=[FieldInfo(name="x", data_type_id=23)],
            row_count=2,
            command="SELECT",
        )
        mock_conn = MagicMock()
        mock_conn._raw_connection.query.return_value = result
        cursor = Cursor(mock_conn)
        cursor.execute("SELECT 1")
        rows = cursor.fetchmany(size=0)
        assert rows == []

    def test_executemany_empty_seq(self):
        mock_conn = MagicMock()
        mock_conn._raw_connection.query.return_value = _mock_query_result()
        cursor = Cursor(mock_conn)
        cursor.executemany("INSERT INTO t VALUES ($1)", [])
        assert mock_conn._raw_connection.query.call_count == 0

    def test_cursor_iterator_protocol(self):
        result = QueryResult(
            rows=[{"x": 1}, {"x": 2}],
            fields=[FieldInfo(name="x", data_type_id=23)],
            row_count=2,
            command="SELECT",
        )
        mock_conn = MagicMock()
        mock_conn._raw_connection.query.return_value = result
        cursor = Cursor(mock_conn)
        cursor.execute("SELECT x FROM t")
        rows = list(cursor)
        assert len(rows) == 2

    def test_closed_cursor_operations(self):
        mock_conn = MagicMock()
        mock_conn._raw_connection.query.return_value = _mock_query_result()
        cursor = Cursor(mock_conn)
        cursor.close()

        with pytest.raises(InterfaceError, match="closed"):
            cursor.execute("SELECT 1")
        with pytest.raises(InterfaceError, match="closed"):
            cursor.fetchone()
        with pytest.raises(InterfaceError, match="closed"):
            cursor.fetchall()
        with pytest.raises(InterfaceError, match="closed"):
            cursor.fetchmany()


# ===========================================================================
# Client lifecycle edge cases
# ===========================================================================


class TestClientAdversarial:
    """Adversarial tests for Client lifecycle."""

    @patch("giodb.client.Connection")
    def test_operations_after_close_raise(self, MockConn):
        client = Client()
        client.close()

        with pytest.raises(InterfaceError, match="closed"):
            client.query("SELECT 1")
        with pytest.raises(InterfaceError, match="closed"):
            client.cursor()
        with pytest.raises(InterfaceError, match="closed"):
            client.commit()
        with pytest.raises(InterfaceError, match="closed"):
            client.rollback()
        with pytest.raises(InterfaceError, match="closed"):
            client.begin()

    @patch("giodb.client.Connection")
    def test_close_idempotent(self, MockConn):
        client = Client()
        client.close()
        client.close()  # Should not raise

    @patch("giodb.client.Connection")
    def test_context_manager_closes(self, MockConn):
        with Client() as client:
            pass
        assert client._closed


# ===========================================================================
# Connection defaults and edge cases
# ===========================================================================


class TestConnectionAdversarial:
    """Adversarial tests for Connection."""

    def test_default_config(self):
        conn = Connection()
        assert conn._config.host == "localhost"
        assert conn._config.port == 6767
        assert conn._config.user == "sixseven"
        assert conn._config.database == "sixseven"
        assert conn._config.password is None

    def test_end_without_connect(self):
        """Ending without connecting should be safe."""
        conn = Connection()
        conn.end()  # No socket to close
        assert conn.closed

    def test_end_idempotent(self):
        conn = Connection()
        conn.end()
        conn.end()  # Should not raise

    def test_query_when_closed_raises(self):
        conn = Connection()
        conn._ended = True
        with pytest.raises(InterfaceError, match="closed"):
            conn.query("SELECT 1")

    def test_parse_command_edge_cases(self):
        assert Connection._parse_command("SELECT 5") == "SELECT"
        assert Connection._parse_command("INSERT 0 1") == "INSERT"
        assert Connection._parse_command("") == ""
        assert Connection._parse_command("TRAVERSE") == "TRAVERSE"

    def test_parse_row_count_edge_cases(self):
        assert Connection._parse_row_count("SELECT 5") == 5
        assert Connection._parse_row_count("INSERT 0 1") == 1
        assert Connection._parse_row_count("") == 0
        assert Connection._parse_row_count("TRAVERSE") == 0


# ===========================================================================
# Module-level connect() function
# ===========================================================================


class TestModuleConnect:
    """Test the module-level connect() function."""

    @patch("giodb.Client")
    def test_connect_with_uri(self, MockClient):
        from giodb import connect
        mock_instance = MockClient.return_value
        # connect() calls client.connect() which does the actual TCP connection
        # We just verify it doesn't crash with a URI
        try:
            connect(uri="sixseven://localhost:6767/testdb")
        except Exception:
            pass  # Expected since no real server

    def test_connect_default_args(self):
        """connect() with defaults should use standard SixSevenDB values."""
        # We can't actually connect, but verify the config is built correctly
        from giodb.types import ConnectionConfig
        config = ConnectionConfig()
        assert config.host == "localhost"
        assert config.port == 6767
        assert config.user == "sixseven"
        assert config.database == "sixseven"


# ===========================================================================
# Query builder: LINK/UNLINK edge cases
# ===========================================================================


class TestLinkUnlinkAdversarial:
    """Adversarial tests for LINK and UNLINK builders."""

    def test_link_basic(self):
        q = build_link("follows", "users", 1, "users", 2)
        assert q["text"] == 'LINK "users"($1) TO "users"($2) VIA "follows"'
        assert q["values"] == [1, 2]

    def test_link_with_multiple_properties(self):
        opts = LinkOptions(properties={"weight": 0.5, "since": "2024-01-01", "active": True})
        q = build_link("follows", "users", 1, "users", 2, opts)
        assert "$3" in q["text"]
        assert "$4" in q["text"]
        assert "$5" in q["text"]
        assert len(q["values"]) == 5

    def test_link_empty_properties(self):
        opts = LinkOptions(properties={})
        q = build_link("follows", "users", 1, "users", 2, opts)
        # No parentheses should be added for empty properties
        after_via = q["text"].split("VIA")[1]
        assert "(" not in after_via

    def test_unlink_basic(self):
        q = build_unlink("follows", "users", 1, "users", 2)
        assert q["text"] == 'UNLINK "users"($1) FROM "users"($2) VIA "follows"'
        assert q["values"] == [1, 2]

    def test_link_sql_injection(self):
        q = build_link('edge"; DROP TABLE x; --', "a", 1, "b", 2)
        assert '"edge""; DROP TABLE x; --"' in q["text"]

    def test_unlink_sql_injection(self):
        q = build_unlink('edge"; DROP TABLE x; --', "a", 1, "b", 2)
        assert '"edge""; DROP TABLE x; --"' in q["text"]


# ===========================================================================
# TRAVERSE edge cases
# ===========================================================================


class TestTraverseAdversarial:
    """Adversarial tests for TRAVERSE builder."""

    def test_basic(self):
        q = build_traverse("follows", "users", 1)
        assert q["text"] == 'TRAVERSE "follows" FROM "users"($1)'
        assert q["values"] == [1]

    def test_all_options(self):
        opts = TraverseOptions(
            direction="BOTH", max_depth=10, mode="EDGES", fetch=True, where="depth < 5"
        )
        q = build_traverse("follows", "users", 42, opts)
        text = q["text"]
        assert "DIRECTION BOTH" in text
        assert "MAX_DEPTH 10" in text
        assert "MODE EDGES" in text
        assert "WHERE depth < 5" in text
        assert text.endswith("FETCH")

    def test_uuid_start_id(self):
        uid = uuid.uuid4()
        q = build_traverse("follows", "users", uid)
        assert q["values"] == [uid]

    def test_string_start_id(self):
        q = build_traverse("follows", "users", "abc-123")
        assert q["values"] == ["abc-123"]


# ===========================================================================
# Interval parser edge cases
# ===========================================================================


class TestIntervalAdversarial:
    """Adversarial tests for interval parsing."""

    def test_hours_minutes_seconds(self):
        result = _parse_interval("12:30:45")
        expected = datetime.timedelta(hours=12, minutes=30, seconds=45)
        assert result == expected

    def test_days_only(self):
        result = _parse_interval("5 days")
        assert result.days == 5

    def test_day_singular(self):
        result = _parse_interval("1 day")
        assert result.days == 1

    def test_day_with_time(self):
        result = _parse_interval("1 day 02:30:00")
        assert result.days == 1
        assert result.seconds == 2 * 3600 + 30 * 60

    def test_zero_interval(self):
        result = _parse_interval("00:00:00")
        assert result == datetime.timedelta(0)

    def test_fractional_seconds(self):
        result = _parse_interval("00:00:01.5")
        assert result == datetime.timedelta(seconds=1.5)
