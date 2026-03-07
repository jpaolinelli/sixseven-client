"""Async connection to SixSevenDB via asyncio."""

from __future__ import annotations

import asyncio
from typing import Any

import numpy as np

from .auth import scram_client_final, scram_client_first, scram_verify_server
from .exceptions import (
    DatabaseError,
    InterfaceError,
    OperationalError,
)
from .protocol import (
    AuthenticationCleartextPassword,
    AuthenticationMD5Password,
    AuthenticationOk,
    AuthenticationSASL,
    AuthenticationSASLContinue,
    AuthenticationSASLFinal,
    BackendKeyData,
    BindComplete,
    CommandComplete,
    DataRow,
    EmptyQueryResponse,
    ErrorResponse,
    MessageReader,
    NoData,
    NoticeResponse,
    ParameterStatus,
    ParseComplete,
    ReadyForQuery,
    RowDescription,
    build_bind_message,
    build_describe_message,
    build_execute_message,
    build_md5_password_message,
    build_parse_message,
    build_password_message,
    build_query_message,
    build_sasl_initial_response,
    build_sasl_response,
    build_startup_message,
    build_sync_message,
    build_terminate_message,
)
from .query_builders import build_link, build_nearest, build_traverse, build_unlink
from .transaction import AsyncTransaction
from .type_parser import parse_value
from .types import (
    DEFAULTS,
    ConnectionConfig,
    FieldInfo,
    LinkOptions,
    NearestOptions,
    QueryResult,
    TraverseOptions,
)


class AsyncConnection:
    """Async connection to SixSevenDB using asyncio streams."""

    def __init__(self, config: ConnectionConfig | None = None, **kwargs: Any) -> None:
        if config is not None:
            self._config = config
        else:
            self._config = ConnectionConfig(
                host=kwargs.get("host", DEFAULTS["host"]),
                port=kwargs.get("port", DEFAULTS["port"]),
                user=kwargs.get("user", DEFAULTS["user"]),
                password=kwargs.get("password"),
                database=kwargs.get("database", DEFAULTS["database"]),
            )
        self._reader_stream: asyncio.StreamReader | None = None
        self._writer: asyncio.StreamWriter | None = None
        self._msg_reader = MessageReader()
        self._ended = False
        self._parameters: dict[str, str] = {}

    @property
    def closed(self) -> bool:
        return self._ended

    async def connect(self) -> None:
        """Establish the async TCP connection and perform startup handshake."""
        if self._writer is not None:
            raise InterfaceError("Already connected")

        try:
            self._reader_stream, self._writer = await asyncio.wait_for(
                asyncio.open_connection(self._config.host, self._config.port),
                timeout=30.0,
            )
        except (OSError, asyncio.TimeoutError) as e:
            raise OperationalError(
                f"Could not connect to {self._config.host}:{self._config.port}: {e}"
            ) from e

        self._msg_reader = MessageReader()

        # Send startup
        self._send(build_startup_message(self._config.user, self._config.database))
        await self._writer.drain()

        # Handle auth
        await self._handle_startup()

    def _send(self, data: bytes) -> None:
        if self._writer is None:
            raise InterfaceError("Not connected")
        self._writer.write(data)

    async def _read_message(self) -> Any:
        while True:
            msg = self._msg_reader.read()
            if msg is not None:
                return msg
            if self._reader_stream is None:
                raise InterfaceError("Not connected")
            data = await self._reader_stream.read(8192)
            if not data:
                raise OperationalError("Connection closed by server")
            self._msg_reader.append(data)

    async def _handle_startup(self) -> None:
        while True:
            msg = await self._read_message()

            if isinstance(msg, AuthenticationOk):
                continue
            elif isinstance(msg, AuthenticationCleartextPassword):
                if self._config.password is None:
                    raise OperationalError("Server requires password but none provided")
                self._send(build_password_message(self._config.password))
                await self._writer.drain()
            elif isinstance(msg, AuthenticationMD5Password):
                if self._config.password is None:
                    raise OperationalError("Server requires password but none provided")
                self._send(
                    build_md5_password_message(
                        self._config.user, self._config.password, msg.salt
                    )
                )
                await self._writer.drain()
            elif isinstance(msg, AuthenticationSASL):
                if "SCRAM-SHA-256" not in msg.mechanisms:
                    raise OperationalError(
                        f"Server requires unsupported SASL mechanism: {msg.mechanisms}"
                    )
                if self._config.password is None:
                    raise OperationalError("Server requires password but none provided")
                scram_state = scram_client_first(self._config.user, self._config.password)
                self._send(
                    build_sasl_initial_response("SCRAM-SHA-256", scram_state.client_first_message)
                )
                await self._writer.drain()
                cont_msg = await self._read_message()
                if not isinstance(cont_msg, AuthenticationSASLContinue):
                    raise OperationalError("Expected SASLContinue from server")
                client_final = scram_client_final(scram_state, cont_msg.data)
                self._send(build_sasl_response(client_final))
                await self._writer.drain()
                final_msg = await self._read_message()
                if not isinstance(final_msg, AuthenticationSASLFinal):
                    raise OperationalError("Expected SASLFinal from server")
                if not scram_verify_server(scram_state, final_msg.data):
                    raise OperationalError("Server signature verification failed")
            elif isinstance(msg, ParameterStatus):
                self._parameters[msg.name] = msg.value
            elif isinstance(msg, BackendKeyData):
                pass
            elif isinstance(msg, ReadyForQuery):
                break
            elif isinstance(msg, ErrorResponse):
                raise OperationalError(f"Startup error: {msg.message}")
            elif isinstance(msg, NoticeResponse):
                continue

    async def query(self, text: str, values: list[Any] | None = None) -> QueryResult:
        """Execute a query asynchronously."""
        if self._ended:
            raise InterfaceError("Connection is closed")
        if values is None or len(values) == 0:
            return await self._simple_query(text)
        return await self._extended_query(text, values)

    async def _simple_query(self, text: str) -> QueryResult:
        self._send(build_query_message(text))
        await self._writer.drain()

        fields: list[FieldInfo] = []
        rows: list[dict[str, Any]] = []
        command = ""
        row_count = 0
        field_descriptions: list[Any] = []

        while True:
            msg = await self._read_message()

            if isinstance(msg, RowDescription):
                field_descriptions = msg.fields
                fields = [FieldInfo(name=f.name, data_type_id=f.type_oid) for f in msg.fields]
            elif isinstance(msg, DataRow):
                row = self._build_row(field_descriptions, msg.values)
                rows.append(row)
            elif isinstance(msg, CommandComplete):
                command = self._parse_command(msg.tag)
                row_count = self._parse_row_count(msg.tag)
            elif isinstance(msg, EmptyQueryResponse):
                command = ""
            elif isinstance(msg, ErrorResponse):
                await self._wait_for_ready()
                raise DatabaseError(f"{msg.severity}: {msg.message} (code: {msg.code})")
            elif isinstance(msg, ReadyForQuery):
                break
            elif isinstance(msg, NoticeResponse):
                continue

        return QueryResult(
            rows=rows,
            fields=fields,
            row_count=row_count if row_count > 0 else len(rows),
            command=command,
        )

    async def _extended_query(self, text: str, values: list[Any]) -> QueryResult:
        data = (
            build_parse_message(text)
            + build_bind_message(values)
            + build_describe_message("P", "")
            + build_execute_message("", 0)
            + build_sync_message()
        )
        self._send(data)
        await self._writer.drain()

        fields: list[FieldInfo] = []
        rows: list[dict[str, Any]] = []
        command = ""
        row_count = 0
        field_descriptions: list[Any] = []

        while True:
            msg = await self._read_message()

            if isinstance(msg, ParseComplete):
                continue
            elif isinstance(msg, BindComplete):
                continue
            elif isinstance(msg, NoData):
                continue
            elif isinstance(msg, RowDescription):
                field_descriptions = msg.fields
                fields = [FieldInfo(name=f.name, data_type_id=f.type_oid) for f in msg.fields]
            elif isinstance(msg, DataRow):
                row = self._build_row(field_descriptions, msg.values)
                rows.append(row)
            elif isinstance(msg, CommandComplete):
                command = self._parse_command(msg.tag)
                row_count = self._parse_row_count(msg.tag)
            elif isinstance(msg, EmptyQueryResponse):
                command = ""
            elif isinstance(msg, ErrorResponse):
                await self._wait_for_ready()
                raise DatabaseError(f"{msg.severity}: {msg.message} (code: {msg.code})")
            elif isinstance(msg, ReadyForQuery):
                break
            elif isinstance(msg, NoticeResponse):
                continue

        return QueryResult(
            rows=rows,
            fields=fields,
            row_count=row_count if row_count > 0 else len(rows),
            command=command,
        )

    def _build_row(
        self, field_descs: list[Any], values: list[bytes | None]
    ) -> dict[str, Any]:
        row: dict[str, Any] = {}
        for i, desc in enumerate(field_descs):
            raw = values[i] if i < len(values) else None
            if raw is None:
                row[desc.name] = None
            else:
                text = raw.decode("utf-8")
                row[desc.name] = parse_value(desc.type_oid, text)
        return row

    async def _wait_for_ready(self) -> None:
        while True:
            msg = await self._read_message()
            if isinstance(msg, ReadyForQuery):
                break

    @staticmethod
    def _parse_command(tag: str) -> str:
        return tag.split()[0] if tag else ""

    @staticmethod
    def _parse_row_count(tag: str) -> int:
        parts = tag.split()
        if len(parts) >= 2:
            try:
                return int(parts[-1])
            except ValueError:
                pass
        return 0

    # ----- Transaction support -----

    async def begin(self) -> AsyncTransaction:
        """Begin a transaction, returning an AsyncTransaction context manager."""
        if self._ended:
            raise InterfaceError("Connection is closed")
        await self.query("BEGIN")
        return AsyncTransaction(self)

    # ----- Convenience methods -----

    async def traverse(
        self,
        edge_type: str,
        from_table: str,
        start_id: Any,
        options: TraverseOptions | None = None,
    ) -> QueryResult:
        q = build_traverse(edge_type, from_table, start_id, options)
        return await self.query(q["text"], q["values"])

    async def nearest(
        self,
        table: str,
        column: str,
        query_input: str | np.ndarray | list[float],
        options: NearestOptions | None = None,
    ) -> QueryResult:
        q = build_nearest(table, column, query_input, options)
        return await self.query(q["text"], q["values"])

    async def link(
        self,
        edge_type: str,
        from_table: str,
        from_id: Any,
        to_table: str,
        to_id: Any,
        options: LinkOptions | None = None,
    ) -> QueryResult:
        q = build_link(edge_type, from_table, from_id, to_table, to_id, options)
        return await self.query(q["text"], q["values"])

    async def unlink(
        self,
        edge_type: str,
        from_table: str,
        from_id: Any,
        to_table: str,
        to_id: Any,
    ) -> QueryResult:
        q = build_unlink(edge_type, from_table, from_id, to_table, to_id)
        return await self.query(q["text"], q["values"])

    async def end(self) -> None:
        """Close the connection gracefully."""
        if self._ended:
            return
        self._ended = True
        if self._writer is not None:
            try:
                self._send(build_terminate_message())
                await self._writer.drain()
            except Exception:
                pass
            try:
                self._writer.close()
                await self._writer.wait_closed()
            except Exception:
                pass
            self._writer = None
            self._reader_stream = None

    async def __aenter__(self):
        await self.connect()
        return self

    async def __aexit__(self, *args):
        await self.end()
