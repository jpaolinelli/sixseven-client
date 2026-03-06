"""SHOW/EXPLAIN command helpers and edge type management for GioDB.

Provides convenience methods that return typed results for
SixSevenDB's schema introspection and DDL commands.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qs, urlparse

from .query_builders import escape_identifier
from .types import ConnectionConfig, DEFAULTS


# ---------------------------------------------------------------------------
# SHOW command result types
# ---------------------------------------------------------------------------

@dataclass
class DatabaseInfo:
    name: str


@dataclass
class TableInfo:
    name: str


@dataclass
class ColumnInfo:
    name: str
    type: str
    nullable: bool = True


@dataclass
class EdgeTypeInfo:
    name: str


@dataclass
class IndexInfo:
    name: str
    table: str
    column: str


@dataclass
class EmbeddingInfo:
    table: str
    column: str
    dimensions: int


@dataclass
class ProviderInfo:
    name: str
    type: str


@dataclass
class ExplainNode:
    """A node in an EXPLAIN query plan."""

    operation: str
    details: dict[str, Any]


# ---------------------------------------------------------------------------
# SHOW helpers
# ---------------------------------------------------------------------------

def show_databases_sql() -> str:
    return "SHOW DATABASES"


def show_tables_sql() -> str:
    return "SHOW TABLES"


def show_columns_sql(table: str) -> str:
    return f"SHOW COLUMNS FROM {escape_identifier(table)}"


def show_edge_types_sql() -> str:
    return "SHOW EDGE TYPES"


def show_indexes_sql() -> str:
    return "SHOW INDEXES"


def show_embeddings_sql() -> str:
    return "SHOW EMBEDDINGS"


def show_providers_sql() -> str:
    return "SHOW PROVIDERS"


# ---------------------------------------------------------------------------
# EXPLAIN helpers
# ---------------------------------------------------------------------------

def explain_sql(sql: str) -> str:
    return f"EXPLAIN {sql}"


def explain_analyze_sql(sql: str) -> str:
    return f"EXPLAIN ANALYZE {sql}"


# ---------------------------------------------------------------------------
# Edge type DDL helpers
# ---------------------------------------------------------------------------

def create_edge_type_sql(
    name: str,
    from_table: str,
    to_table: str,
    properties: dict[str, str] | None = None,
) -> str:
    """Generate a CREATE EDGE TYPE statement.

    Args:
        name: Edge type name.
        from_table: Source table.
        to_table: Target table.
        properties: Optional dict of property_name -> type_string.
    """
    sql = f"CREATE EDGE TYPE {escape_identifier(name)} FROM {escape_identifier(from_table)} TO {escape_identifier(to_table)}"
    if properties:
        prop_parts = [
            f"{escape_identifier(k)} {v}" for k, v in properties.items()
        ]
        sql += f" ({', '.join(prop_parts)})"
    return sql


def drop_edge_type_sql(name: str, if_exists: bool = False) -> str:
    """Generate a DROP EDGE TYPE statement."""
    ie = " IF EXISTS" if if_exists else ""
    return f"DROP EDGE TYPE{ie} {escape_identifier(name)}"


# ---------------------------------------------------------------------------
# Connection URI parser
# ---------------------------------------------------------------------------

def parse_connection_uri(uri: str) -> ConnectionConfig:
    """Parse a sixseven:// connection URI into a ConnectionConfig.

    Format: sixseven://user:password@host:port/database

    All components are optional except the scheme.
    """
    parsed = urlparse(uri)

    # Accept both sixseven:// and postgresql:// for compatibility
    if parsed.scheme not in ("sixseven", "postgresql", "postgres"):
        raise ValueError(f"Unsupported URI scheme: {parsed.scheme}")

    host = parsed.hostname or DEFAULTS["host"]
    port = parsed.port or DEFAULTS["port"]
    user = parsed.username or DEFAULTS["user"]
    password = parsed.password or None
    database = parsed.path.lstrip("/") if parsed.path and parsed.path != "/" else DEFAULTS["database"]

    return ConnectionConfig(
        host=host,
        port=port,
        user=user,
        password=password,
        database=database,
    )
