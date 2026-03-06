"""High-level DB-API 2.0 compliant Connection and convenience client for GioDB."""

from __future__ import annotations

from typing import Any

import numpy as np

from .connection import Connection
from .cursor import Cursor
from .exceptions import InterfaceError
from .transaction import Transaction
from .query_builders import build_link, build_nearest, build_traverse, build_unlink
from .types import (
    ConnectionConfig,
    LinkOptions,
    NearestOptions,
    QueryResult,
    TraverseOptions,
)


class Client:
    """DB-API 2.0 compliant connection with GioDB-specific helpers.

    Provides both the PEP 249 interface (cursor, commit, rollback, close)
    and convenience methods for graph/vector operations.
    """

    def __init__(self, config: ConnectionConfig | None = None, **kwargs: Any) -> None:
        self._raw_connection = Connection(config=config, **kwargs)
        self._closed = False

    def connect(self) -> None:
        """Establish the connection to the server."""
        self._raw_connection.connect()

    # ----- DB-API 2.0 interface -----

    def cursor(self) -> Cursor:
        """Create a new cursor for this connection."""
        if self._closed:
            raise InterfaceError("Connection is closed")
        return Cursor(self)

    def commit(self) -> None:
        """Commit the current transaction (sends COMMIT)."""
        if self._closed:
            raise InterfaceError("Connection is closed")
        self._raw_connection.query("COMMIT")

    def rollback(self) -> None:
        """Roll back the current transaction (sends ROLLBACK)."""
        if self._closed:
            raise InterfaceError("Connection is closed")
        self._raw_connection.query("ROLLBACK")

    def close(self) -> None:
        """Close the connection."""
        if self._closed:
            return
        self._closed = True
        self._raw_connection.end()

    # ----- Context manager -----

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()

    # ----- Transaction support -----

    def begin(self) -> Transaction:
        """Begin a transaction, returning a Transaction context manager."""
        if self._closed:
            raise InterfaceError("Connection is closed")
        self._raw_connection.query("BEGIN")
        return Transaction(self._raw_connection)

    # ----- Convenience query methods -----

    def query(self, text: str, values: list[Any] | None = None) -> QueryResult:
        """Execute a raw SQL query and return the result."""
        if self._closed:
            raise InterfaceError("Connection is closed")
        return self._raw_connection.query(text, values)

    def traverse(
        self,
        edge_type: str,
        from_table: str,
        start_id: Any,
        options: TraverseOptions | None = None,
    ) -> QueryResult:
        """Execute a TRAVERSE query."""
        q = build_traverse(edge_type, from_table, start_id, options)
        return self._raw_connection.query(q["text"], q["values"])

    def nearest(
        self,
        table: str,
        column: str,
        query_input: str | np.ndarray | list[float],
        options: NearestOptions | None = None,
    ) -> QueryResult:
        """Execute a NEAREST query."""
        q = build_nearest(table, column, query_input, options)
        return self._raw_connection.query(q["text"], q["values"])

    def link(
        self,
        edge_type: str,
        from_table: str,
        from_id: Any,
        to_table: str,
        to_id: Any,
        options: LinkOptions | None = None,
    ) -> QueryResult:
        """Execute a LINK query."""
        q = build_link(edge_type, from_table, from_id, to_table, to_id, options)
        return self._raw_connection.query(q["text"], q["values"])

    def unlink(
        self,
        edge_type: str,
        from_table: str,
        from_id: Any,
        to_table: str,
        to_id: Any,
    ) -> QueryResult:
        """Execute an UNLINK query."""
        q = build_unlink(edge_type, from_table, from_id, to_table, to_id)
        return self._raw_connection.query(q["text"], q["values"])
