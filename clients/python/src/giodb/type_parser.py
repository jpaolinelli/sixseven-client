"""Type OID constants and text-format parsers for GioDB wire protocol types.

Covers all 22 server types with appropriate Python type mappings.
"""

from __future__ import annotations

import datetime
import decimal
import json
import uuid
from typing import Any, Callable

import numpy as np


# ---------------------------------------------------------------------------
# Type OID constants (matching server's pg_type catalog)
# ---------------------------------------------------------------------------

class TypeOID:
    BOOL = 16
    TINYINT = 18
    INT2 = 21
    INT4 = 23
    INT8 = 20
    UINT8 = 100001
    UINT16 = 100002
    UINT32 = 100003
    UINT64 = 100004
    FLOAT4 = 700
    FLOAT8 = 701
    NUMERIC = 1700
    TEXT = 25
    VARCHAR = 1043
    CHAR = 1042
    BYTEA = 17
    BLOB = 100005
    DATE = 1082
    TIME = 1083
    TIMESTAMP = 1114
    INTERVAL = 1186
    POINT = 600
    JSON = 114
    UUID = 2950
    EMBEDDING = 100000


# ---------------------------------------------------------------------------
# Type parsers
# ---------------------------------------------------------------------------

def _parse_bool(value: str) -> bool:
    return value.lower() in ("t", "true", "1")


def _parse_int(value: str) -> int:
    return int(value)


def _parse_float(value: str) -> float:
    return float(value)


def _parse_numeric(value: str) -> decimal.Decimal:
    return decimal.Decimal(value)


def _parse_json(value: str) -> Any:
    return json.loads(value)


def _parse_uuid(value: str) -> uuid.UUID:
    return uuid.UUID(value)


def _parse_date(value: str) -> datetime.date:
    return datetime.date.fromisoformat(value)


def _parse_time(value: str) -> datetime.time:
    return datetime.time.fromisoformat(value)


def _parse_timestamp(value: str) -> datetime.datetime:
    return datetime.datetime.fromisoformat(value)


def _parse_interval(value: str) -> datetime.timedelta:
    """Parse a PostgreSQL interval string to timedelta.

    Handles common formats like '1 day', '2 hours', '1 day 02:30:00', 'HH:MM:SS'.
    """
    # Try HH:MM:SS format first
    if ":" in value and "day" not in value.lower():
        parts = value.split(":")
        if len(parts) == 3:
            hours = int(parts[0])
            minutes = int(parts[1])
            seconds = float(parts[2])
            return datetime.timedelta(hours=hours, minutes=minutes, seconds=seconds)

    total_days = 0
    total_seconds = 0.0

    # Parse "N day(s)" portion
    lower = value.lower()
    if "day" in lower:
        day_part, _, rest = lower.partition("day")
        total_days = int(day_part.strip())
        rest = rest.lstrip("s").strip()
        if rest and ":" in rest:
            parts = rest.split(":")
            if len(parts) == 3:
                total_seconds = int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
    else:
        # Might just be a number of seconds
        try:
            total_seconds = float(value)
        except ValueError:
            pass

    return datetime.timedelta(days=total_days, seconds=total_seconds)


def _parse_bytea(value: str) -> bytes:
    """Parse PostgreSQL bytea hex format '\\x...' to bytes."""
    if value.startswith("\\x"):
        return bytes.fromhex(value[2:])
    return value.encode("utf-8")


def parse_embedding(value: str) -> np.ndarray:
    """Parse a text-format embedding '[0.1,0.2,0.3]' into a numpy float32 array."""
    stripped = value.strip()
    if stripped.startswith("[") and stripped.endswith("]"):
        stripped = stripped[1:-1]
    if not stripped:
        return np.array([], dtype=np.float32)
    parts = stripped.split(",")
    return np.array([float(p.strip()) for p in parts], dtype=np.float32)


def serialize_embedding(arr: np.ndarray | list[float]) -> str:
    """Serialize an embedding array to text format '[0.1,0.2,0.3]'."""
    if isinstance(arr, np.ndarray):
        values = arr.tolist()
    else:
        values = list(arr)
    return "[" + ",".join(str(v) for v in values) + "]"


# ---------------------------------------------------------------------------
# Parser registry
# ---------------------------------------------------------------------------

_PARSERS: dict[int, Callable[[str], Any]] = {
    TypeOID.BOOL: _parse_bool,
    TypeOID.TINYINT: _parse_int,
    TypeOID.INT2: _parse_int,
    TypeOID.INT4: _parse_int,
    TypeOID.INT8: _parse_int,
    TypeOID.UINT8: _parse_int,
    TypeOID.UINT16: _parse_int,
    TypeOID.UINT32: _parse_int,
    TypeOID.UINT64: _parse_int,
    TypeOID.FLOAT4: _parse_float,
    TypeOID.FLOAT8: _parse_float,
    TypeOID.NUMERIC: _parse_numeric,
    TypeOID.JSON: _parse_json,
    TypeOID.UUID: _parse_uuid,
    TypeOID.DATE: _parse_date,
    TypeOID.TIME: _parse_time,
    TypeOID.TIMESTAMP: _parse_timestamp,
    TypeOID.INTERVAL: _parse_interval,
    TypeOID.BYTEA: _parse_bytea,
    TypeOID.BLOB: _parse_bytea,
    TypeOID.EMBEDDING: parse_embedding,
    # TEXT, VARCHAR, CHAR: fall through to raw string (no parser needed)
}


def parse_value(type_oid: int, value: str) -> Any:
    """Parse a text-format value based on its type OID.

    Returns the parsed Python object, or the raw string if no parser is registered.
    """
    parser = _PARSERS.get(type_oid)
    if parser is not None:
        return parser(value)
    return value
