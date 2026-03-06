"""Transaction API with context managers for GioDB.

Provides both sync and async transaction support with automatic
commit/rollback and savepoint nesting.
"""

from __future__ import annotations

from typing import Any


class Savepoint:
    """A savepoint within a transaction, usable as a context manager."""

    def __init__(self, connection: Any, name: str) -> None:
        self._connection = connection
        self.name = name

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if exc_type is not None:
            self._connection.query(f"ROLLBACK TO SAVEPOINT {self.name}")
        else:
            self._connection.query(f"RELEASE SAVEPOINT {self.name}")
        return False


class Transaction:
    """A database transaction, usable as a context manager.

    Auto-commits on clean exit, auto-rollbacks on exception.
    """

    def __init__(self, connection: Any) -> None:
        self._connection = connection
        self._finished = False

    def savepoint(self, name: str) -> Savepoint:
        """Create a savepoint within this transaction."""
        self._connection.query(f"SAVEPOINT {name}")
        return Savepoint(self._connection, name)

    def rollback_to(self, name: str) -> None:
        """Explicitly roll back to a named savepoint."""
        self._connection.query(f"ROLLBACK TO SAVEPOINT {name}")

    def commit(self) -> None:
        """Explicitly commit the transaction."""
        if not self._finished:
            self._connection.query("COMMIT")
            self._finished = True

    def rollback(self) -> None:
        """Explicitly roll back the transaction."""
        if not self._finished:
            self._connection.query("ROLLBACK")
            self._finished = True

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if not self._finished:
            if exc_type is not None:
                self.rollback()
            else:
                self.commit()
        return False


class AsyncSavepoint:
    """Async savepoint within a transaction."""

    def __init__(self, connection: Any, name: str) -> None:
        self._connection = connection
        self.name = name

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if exc_type is not None:
            await self._connection.query(f"ROLLBACK TO SAVEPOINT {self.name}")
        else:
            await self._connection.query(f"RELEASE SAVEPOINT {self.name}")
        return False


class AsyncTransaction:
    """Async database transaction, usable as an async context manager."""

    def __init__(self, connection: Any) -> None:
        self._connection = connection
        self._finished = False

    async def savepoint(self, name: str) -> AsyncSavepoint:
        """Create a savepoint within this transaction."""
        await self._connection.query(f"SAVEPOINT {name}")
        return AsyncSavepoint(self._connection, name)

    async def rollback_to(self, name: str) -> None:
        """Explicitly roll back to a named savepoint."""
        await self._connection.query(f"ROLLBACK TO SAVEPOINT {name}")

    async def commit(self) -> None:
        if not self._finished:
            await self._connection.query("COMMIT")
            self._finished = True

    async def rollback(self) -> None:
        if not self._finished:
            await self._connection.query("ROLLBACK")
            self._finished = True

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if not self._finished:
            if exc_type is not None:
                await self.rollback()
            else:
                await self.commit()
        return False
