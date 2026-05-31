"""Connection pool for GioDB.

Manages a pool of connections with configurable min/max size,
connection reuse, and a FIFO waiter queue for when the pool is exhausted.
"""

from __future__ import annotations

import threading
import time
from typing import Any

import numpy as np

from .connection import Connection
from .exceptions import InterfaceError, OperationalError
from .transaction import Transaction
from .query_builders import build_link, build_nearest, build_traverse, build_unlink, escape_identifier
from .types import (
    ConnectionConfig,
    LinkOptions,
    NearestOptions,
    PoolConfig,
    QueryResult,
    TraverseOptions,
)


class PoolClient:
    """A connection checked out from the pool.

    Must be released back to the pool when done via release().
    """

    def __init__(
        self,
        connection: Connection,
        release_callback: Any,
    ) -> None:
        self._connection = connection
        self._release_callback = release_callback
        self._released = False

    def query(self, text: str, values: list[Any] | None = None) -> QueryResult:
        """Execute a query on the checked-out connection."""
        if self._released:
            raise InterfaceError("PoolClient has been released")
        return self._connection.query(text, values)

    def release(self, err: Exception | bool | None = None) -> None:
        """Return the connection to the pool.

        Args:
            err: If truthy, the connection is destroyed instead of returned.
        """
        if self._released:
            return
        self._released = True
        self._release_callback(self._connection, err)

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.release(exc_val)


class Pool:
    """Thread-safe connection pool for GioDB.

    Manages idle and active connections with a configurable maximum size.
    When the pool is exhausted, callers wait in a FIFO queue.
    """

    def __init__(self, config: PoolConfig | None = None, **kwargs: Any) -> None:
        if config is not None:
            self._config = config
        else:
            self._config = PoolConfig(**kwargs)

        self._idle: list[Connection] = []
        self._active: set[int] = set()  # id(conn) -> tracked
        self._active_conns: dict[int, Connection] = {}
        self._lock = threading.Lock()
        self._available = threading.Condition(self._lock)
        self._closed = False

    @property
    def total_count(self) -> int:
        with self._lock:
            return len(self._active) + len(self._idle)

    @property
    def idle_count(self) -> int:
        with self._lock:
            return len(self._idle)

    @property
    def waiting_count(self) -> int:
        # Approximation: number of threads waiting on the condition
        return 0

    def connect(self) -> PoolClient:
        """Acquire a connection from the pool.

        Returns a PoolClient that must be released when done.
        """
        if self._closed:
            raise InterfaceError("Pool is closed")

        conn = self._acquire()
        return PoolClient(conn, self._release)

    def _acquire(self) -> Connection:
        """Internal: acquire a connection, creating one if needed."""
        deadline = time.monotonic() + self._config.connection_timeout

        with self._lock:
            while True:
                if self._closed:
                    raise InterfaceError("Pool is closed")

                # Try to reuse an idle connection
                if self._idle:
                    conn = self._idle.pop()
                    self._active.add(id(conn))
                    self._active_conns[id(conn)] = conn
                    return conn

                # Try to create a new connection if under max
                if len(self._active) + len(self._idle) < self._config.max_size:
                    # Release lock while connecting
                    break

                # Wait for a connection to become available
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise OperationalError("Connection pool timeout")
                self._available.wait(timeout=remaining)

        # Create new connection outside the lock
        conn = Connection(
            config=ConnectionConfig(
                host=self._config.host,
                port=self._config.port,
                user=self._config.user,
                password=self._config.password,
                database=self._config.database,
            )
        )
        conn.connect()

        with self._lock:
            self._active.add(id(conn))
            self._active_conns[id(conn)] = conn
        return conn

    def _release(self, conn: Connection, err: Exception | bool | None = None) -> None:
        """Internal: return or destroy a connection."""
        with self._lock:
            self._active.discard(id(conn))
            self._active_conns.pop(id(conn), None)

            if err or self._closed:
                # Destroy the connection
                try:
                    conn.end()
                except Exception:
                    pass
            else:
                # Return to idle pool
                self._idle.append(conn)

            self._available.notify()

    def transaction(self) -> _PoolTransaction:
        """Acquire a connection, begin a transaction, and return a context manager.

        Usage: with pool.transaction() as txn: ...
        Auto-commits on clean exit, auto-rollbacks on exception, releases connection.
        """
        client = self.connect()
        try:
            client.query("BEGIN")
        except Exception:
            client.release()
            raise
        return _PoolTransaction(client)

    def query(self, text: str, values: list[Any] | None = None) -> QueryResult:
        """Execute a query, auto-acquiring and releasing a connection."""
        client = self.connect()
        try:
            return client.query(text, values)
        finally:
            client.release()

    def traverse(
        self,
        edge_type: str,
        from_table: str,
        start_id: Any,
        options: TraverseOptions | None = None,
    ) -> QueryResult:
        """Execute a TRAVERSE query using a pooled connection."""
        q = build_traverse(edge_type, from_table, start_id, options)
        return self.query(q["text"], q["values"])

    def nearest(
        self,
        table: str,
        column: str,
        query_input: str | np.ndarray | list[float],
        options: NearestOptions | None = None,
    ) -> QueryResult:
        """Execute a NEAREST query using a pooled connection."""
        q = build_nearest(table, column, query_input, options)
        return self.query(q["text"], q["values"])

    def link(
        self,
        edge_type: str,
        from_table: str,
        from_id: Any,
        to_table: str,
        to_id: Any,
        options: LinkOptions | None = None,
    ) -> QueryResult:
        """Execute a LINK query using a pooled connection."""
        q = build_link(edge_type, from_table, from_id, to_table, to_id, options)
        return self.query(q["text"], q["values"])

    def unlink(
        self,
        edge_type: str,
        from_table: str,
        from_id: Any,
        to_table: str,
        to_id: Any,
    ) -> QueryResult:
        """Execute an UNLINK query using a pooled connection."""
        q = build_unlink(edge_type, from_table, from_id, to_table, to_id)
        return self.query(q["text"], q["values"])

    def end(self) -> None:
        """Close all connections and shut down the pool."""
        with self._lock:
            if self._closed:
                return
            self._closed = True

            # Close all idle connections
            for conn in self._idle:
                try:
                    conn.end()
                except Exception:
                    pass
            self._idle.clear()

            # Close all active connections
            for conn in self._active_conns.values():
                try:
                    conn.end()
                except Exception:
                    pass
            self._active.clear()
            self._active_conns.clear()

            self._available.notify_all()


class _PoolTransaction:
    """Transaction context manager that also releases the connection back to the pool."""

    def __init__(self, pool_client: PoolClient) -> None:
        self._client = pool_client
        self._finished = False

    def query(self, text: str, values: list[Any] | None = None) -> QueryResult:
        return self._client.query(text, values)

    def savepoint(self, name: str) -> _PoolSavepoint:
        self._client.query(f"SAVEPOINT {escape_identifier(name)}")
        return _PoolSavepoint(self._client, name)

    def rollback_to(self, name: str) -> None:
        self._client.query(f"ROLLBACK TO SAVEPOINT {escape_identifier(name)}")

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        try:
            if not self._finished:
                if exc_type is not None:
                    self._client.query("ROLLBACK")
                else:
                    self._client.query("COMMIT")
                self._finished = True
        finally:
            self._client.release()
        return False


class _PoolSavepoint:
    """Savepoint context manager for pool transactions."""

    def __init__(self, pool_client: PoolClient, name: str) -> None:
        self._client = pool_client
        self.name = name

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type is not None:
            self._client.query(f"ROLLBACK TO SAVEPOINT {escape_identifier(self.name)}")
        else:
            self._client.query(f"RELEASE SAVEPOINT {escape_identifier(self.name)}")
        return False
