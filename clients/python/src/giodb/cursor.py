"""DB-API 2.0 (PEP 249) Cursor implementation for GioDB."""

from __future__ import annotations

from typing import Any, Sequence

from .exceptions import InterfaceError, ProgrammingError
from .types import FieldInfo


class Cursor:
    """DB-API 2.0 compliant cursor.

    Provides execute(), fetchone(), fetchmany(), fetchall() per PEP 249.
    """

    arraysize: int = 1

    def __init__(self, connection: Any) -> None:
        self._connection = connection
        self._closed = False
        self._description: tuple[tuple[str, int, None, None, None, None, None], ...] | None = None
        self._rows: list[dict[str, Any]] = []
        self._row_index = 0
        self._rowcount = -1
        self._fields: list[FieldInfo] = []

    @property
    def description(
        self,
    ) -> tuple[tuple[str, int, None, None, None, None, None], ...] | None:
        """DB-API 2.0 description attribute.

        Returns a tuple of 7-item tuples per column:
        (name, type_code, display_size, internal_size, precision, scale, null_ok)
        """
        return self._description

    @property
    def rowcount(self) -> int:
        return self._rowcount

    def _check_closed(self) -> None:
        if self._closed:
            raise InterfaceError("Cursor is closed")

    def execute(self, operation: str, parameters: Sequence[Any] | None = None) -> None:
        """Execute a database operation (query or command).

        Parameters should be provided as a sequence for $1, $2, ... placeholders.
        """
        self._check_closed()
        values = list(parameters) if parameters else None
        result = self._connection._raw_connection.query(operation, values)

        self._rows = result.rows
        self._row_index = 0
        self._rowcount = result.row_count

        if result.fields:
            self._description = tuple(
                (f.name, f.data_type_id, None, None, None, None, None)
                for f in result.fields
            )
            self._fields = result.fields
        else:
            self._description = None
            self._fields = []

    def executemany(
        self, operation: str, seq_of_parameters: Sequence[Sequence[Any]]
    ) -> None:
        """Execute a database operation against all parameter sequences."""
        self._check_closed()
        for params in seq_of_parameters:
            self.execute(operation, params)

    def fetchone(self) -> dict[str, Any] | None:
        """Fetch the next row, or None if no more rows."""
        self._check_closed()
        if self._row_index >= len(self._rows):
            return None
        row = self._rows[self._row_index]
        self._row_index += 1
        return row

    def fetchmany(self, size: int | None = None) -> list[dict[str, Any]]:
        """Fetch the next set of rows (default: cursor.arraysize)."""
        self._check_closed()
        if size is None:
            size = self.arraysize
        end = min(self._row_index + size, len(self._rows))
        rows = self._rows[self._row_index : end]
        self._row_index = end
        return rows

    def fetchall(self) -> list[dict[str, Any]]:
        """Fetch all remaining rows."""
        self._check_closed()
        rows = self._rows[self._row_index :]
        self._row_index = len(self._rows)
        return rows

    def close(self) -> None:
        """Close the cursor."""
        self._closed = True
        self._rows = []
        self._description = None

    def __iter__(self):
        return self

    def __next__(self) -> dict[str, Any]:
        row = self.fetchone()
        if row is None:
            raise StopIteration
        return row

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
