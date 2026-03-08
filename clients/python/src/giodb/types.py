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
class PathNode:
    """A node in a parsed graph path result."""

    table: str
    id: Any
    properties: dict[str, Any] = field(default_factory=dict)


@dataclass
class PathEdge:
    """An edge in a parsed graph path result."""

    edge_type: str
    from_id: Any
    to_id: Any
    properties: dict[str, Any] = field(default_factory=dict)


@dataclass
class Path:
    """A graph path returned from MATCH / SHORTEST PATH queries.

    The wire format is a JSON array alternating ``[node, edge, node, edge, ..., node]``.
    """

    _nodes: list[PathNode] = field(default_factory=list)
    _edges: list[PathEdge] = field(default_factory=list)

    def path_length(self) -> int:
        """Return the number of edges (hops) in this path."""
        return len(self._edges)

    def nodes(self) -> list[PathNode]:
        """Return the ordered list of nodes in this path."""
        return list(self._nodes)

    def edges(self) -> list[PathEdge]:
        """Return the ordered list of edges in this path."""
        return list(self._edges)

    def __len__(self) -> int:
        return self.path_length()

    def __repr__(self) -> str:
        parts: list[str] = []
        for i, node in enumerate(self._nodes):
            parts.append(f"({node.table}:{node.id})")
            if i < len(self._edges):
                parts.append(f"-[{self._edges[i].edge_type}]->")
        return "Path(" + "".join(parts) + ")"


@dataclass
class MatchNode:
    """A node in a MATCH pattern."""

    alias: str
    table: str


@dataclass
class MatchEdge:
    """An edge in a MATCH pattern.

    Supports hop quantifiers ('{min,max}', '+', '*') and cross-edge-type
    patterns via the ``edge_types`` list.  When ``edge_types`` is non-empty
    it takes precedence over the single ``edge_type`` string.
    """

    alias: str
    edge_type: str
    direction: str = "OUT"  # 'OUT' | 'IN' | 'BOTH'
    quantifier: str | None = None  # '{2,5}', '+', '*'
    edge_types: list[str] | None = None  # cross-edge-type: ["follows", "likes"]
