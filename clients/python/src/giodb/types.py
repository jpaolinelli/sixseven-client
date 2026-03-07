"""Type definitions for the GioDB Python client."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


DEFAULTS = {
    "host": "localhost",
    "port": 6767,
    "user": "sixseven",
    "database": "sixseven",
}


@dataclass
class ConnectionConfig:
    host: str = DEFAULTS["host"]
    port: int = DEFAULTS["port"]
    user: str = DEFAULTS["user"]
    password: str | None = None
    database: str = DEFAULTS["database"]


@dataclass
class PoolConfig(ConnectionConfig):
    min_size: int = 0
    max_size: int = 10
    connection_timeout: float = 30.0


@dataclass
class FieldInfo:
    name: str
    data_type_id: int


@dataclass
class QueryResult:
    rows: list[dict[str, Any]]
    fields: list[FieldInfo]
    row_count: int
    command: str


@dataclass
class TraverseOptions:
    direction: str | None = None  # 'OUT' | 'IN' | 'BOTH'
    max_depth: int | None = None
    mode: str | None = None  # 'NODES' | 'EDGES'
    fetch: bool = False
    where: str | None = None


@dataclass
class NearestOptions:
    k: int = 10
    metric: str | None = None  # 'COSINE' | 'L2' | 'DOT'
    where: str | None = None
    within_traverse: str | None = None  # edge type for graph-scoped vector search


@dataclass
class LinkOptions:
    properties: dict[str, Any] = field(default_factory=dict)


@dataclass
class MatchNode:
    """A node in a MATCH pattern."""

    alias: str
    table: str


@dataclass
class MatchEdge:
    """An edge in a MATCH pattern."""

    alias: str
    edge_type: str
    direction: str = "OUT"  # 'OUT' | 'IN' | 'BOTH'
