"""Raw TCP connection to SixSevenDB via the PostgreSQL v3 wire protocol."""

from __future__ import annotations

import socket
from typing import Any

from .auth import scram_client_final, scram_client_first, scram_verify_server
from .exceptions import (
    DatabaseError,
    InterfaceError,
    OperationalError,
    ProgrammingError,
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
from .type_parser import parse_value
from .types import DEFAULTS, ConnectionConfig, FieldInfo, QueryResult


class Connection:
    """Low-level synchronous connection to SixSevenDB."""

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
        self._socket: socket.socket | None = None
        self._reader = MessageReader()
        self._ended = False
        self._in_transaction = False
        self._backend_pid: int | None = None
        self._backend_key: int | None = None
        self._parameters: dict[str, str] = {}

    @property
    def closed(self) -> bool:
        return self._ended

    def connect(self) -> None:
        """Establish the TCP connection and perform the startup handshake."""
        if self._socket is not None:
            raise InterfaceError("Already connected")

        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(30.0)
        try:
            sock.connect((self._config.host, self._config.port))
        except OSError as e:
            sock.close()
            raise OperationalError(f"Could not connect to {self._config.host}:{self._config.port}: {e}") from e

        self._socket = sock
        self._reader = MessageReader()

        # Send startup message
        self._send(build_startup_message(self._config.user, self._config.database))

        # Handle startup/auth sequence
        self._handle_startup()

    def _send(self, data: bytes) -> None:
        """Send raw bytes to the server."""
        if self._socket is None:
            raise InterfaceError("Not connected")
        self._socket.sendall(data)

    def _recv(self) -> bytes:
        """Receive data from the server socket."""
        if self._socket is None:
            raise InterfaceError("Not connected")
        data = self._socket.recv(8192)
        if not data:
            raise OperationalError("Connection closed by server")
        return data

    def _read_message(self) -> Any:
        """Read one complete message from the server, blocking until available."""
        while True:
            msg = self._reader.read()
            if msg is not None:
                return msg
            data = self._recv()
            self._reader.append(data)

    def _handle_startup(self) -> None:
        """Process messages until ReadyForQuery (authentication + param status)."""
        while True:
            msg = self._read_message()

            if isinstance(msg, AuthenticationOk):
                continue
            elif isinstance(msg, AuthenticationCleartextPassword):
                if self._config.password is None:
                    raise OperationalError("Server requires password but none provided")
                self._send(build_password_message(self._config.password))
            elif isinstance(msg, AuthenticationMD5Password):
                if self._config.password is None:
                    raise OperationalError("Server requires password but none provided")
                self._send(
                    build_md5_password_message(
                        self._config.user, self._config.password, msg.salt
                    )
                )
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
                # Read SASLContinue
                cont_msg = self._read_message()
                if not isinstance(cont_msg, AuthenticationSASLContinue):
                    raise OperationalError("Expected SASLContinue from server")
                client_final = scram_client_final(scram_state, cont_msg.data)
                self._send(build_sasl_response(client_final))
                # Read SASLFinal
                final_msg = self._read_message()
                if not isinstance(final_msg, AuthenticationSASLFinal):
                    raise OperationalError("Expected SASLFinal from server")
                if not scram_verify_server(scram_state, final_msg.data):
                    raise OperationalError("Server signature verification failed")
            elif isinstance(msg, ParameterStatus):
                self._parameters[msg.name] = msg.value
            elif isinstance(msg, BackendKeyData):
                self._backend_pid = msg.process_id
                self._backend_key = msg.secret_key
            elif isinstance(msg, ReadyForQuery):
                break
            elif isinstance(msg, ErrorResponse):
                raise OperationalError(f"Startup error: {msg.message}")
            elif isinstance(msg, NoticeResponse):
                continue
            else:
                continue

    def query(self, text: str, values: list[Any] | None = None) -> QueryResult:
        """Execute a query and return the result.

        Uses simple query protocol when no values are provided,
        extended query protocol with parameterized queries otherwise.
        """
        if self._ended:
            raise InterfaceError("Connection is closed")
        if values is None or len(values) == 0:
            return self._simple_query(text)
        return self._extended_query(text, values)

    def _simple_query(self, text: str) -> QueryResult:
        """Execute via the simple query protocol (no parameters)."""
        self._send(build_query_message(text))

        fields: list[FieldInfo] = []
        rows: list[dict[str, Any]] = []
        command = ""
        row_count = 0
        field_descriptions: list[Any] = []

        while True:
            msg = self._read_message()

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
                # Wait for ReadyForQuery before raising
                self._wait_for_ready()
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

    def _extended_query(self, text: str, values: list[Any]) -> QueryResult:
        """Execute via the extended query protocol (with $1, $2, ... parameters)."""
        # Send all messages at once: Parse + Bind + Describe + Execute + Sync
        data = (
            build_parse_message(text)
            + build_bind_message(values)
            + build_describe_message("P", "")
            + build_execute_message("", 0)
            + build_sync_message()
        )
        self._send(data)

        fields: list[FieldInfo] = []
        rows: list[dict[str, Any]] = []
        command = ""
        row_count = 0
        field_descriptions: list[Any] = []

        while True:
            msg = self._read_message()

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
                self._wait_for_ready()
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
        self,
        field_descs: list[Any],
        values: list[bytes | None],
    ) -> dict[str, Any]:
        """Build a typed row dict from field descriptions and raw column values."""
        row: dict[str, Any] = {}
        for i, desc in enumerate(field_descs):
            raw = values[i] if i < len(values) else None
            if raw is None:
                row[desc.name] = None
            else:
                text = raw.decode("utf-8")
                row[desc.name] = parse_value(desc.type_oid, text)
        return row

    def _wait_for_ready(self) -> None:
        """Read messages until ReadyForQuery is received (error recovery)."""
        while True:
            msg = self._read_message()
            if isinstance(msg, ReadyForQuery):
                break

    @staticmethod
    def _parse_command(tag: str) -> str:
        """Extract the command name from a CommandComplete tag."""
        return tag.split()[0] if tag else ""

    @staticmethod
    def _parse_row_count(tag: str) -> int:
        """Extract the row count from a CommandComplete tag."""
        parts = tag.split()
        if len(parts) >= 2:
            try:
                return int(parts[-1])
            except ValueError:
                pass
        return 0

    def end(self) -> None:
        """Close the connection gracefully."""
        if self._ended:
            return
        self._ended = True
        if self._socket is not None:
            try:
                self._send(build_terminate_message())
            except Exception:
                pass
            try:
                self._socket.close()
            except Exception:
                pass
            self._socket = None
