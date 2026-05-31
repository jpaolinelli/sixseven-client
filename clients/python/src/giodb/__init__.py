"""GioDB — Python client library for SixSevenDB.

DB-API 2.0 (PEP 249) compliant with async support, connection pooling,
and SixSevenDB-specific query helpers.
"""

from __future__ import annotations

# DB-API 2.0 module-level attributes
apilevel = "2.0"
threadsafety = 2  # Threads may share the module and connections
paramstyle = "numeric"  # $1, $2, ... placeholders

# Public API
from .async_connection import AsyncConnection
from .auth import scram_client_final, scram_client_first, scram_verify_server
from .client import Client
from .connection import Connection
from .cursor import Cursor
from .exceptions import (
    DatabaseError,
    DataError,
    Error,
    IntegrityError,
    InterfaceError,
    InternalError,
    NotSupportedError,
    OperationalError,
    ProgrammingError,
    Warning,
)
from .helpers import (
    create_edge_type_sql,
    drop_edge_type_sql,
    explain_analyze_sql,
    explain_sql,
    parse_connection_uri,
    show_columns_sql,
    show_databases_sql,
    show_edge_types_sql,
    show_embeddings_sql,
    show_indexes_sql,
    show_providers_sql,
    show_tables_sql,
)
from .pool import Pool, PoolClient
from .query_builders import (
    build_betweenness_centrality,
    build_closeness_centrality,
    build_clustering_coefficient,
    build_connected_components,
    build_degree_centrality,
    build_eigenvector_centrality,
    build_harmonic_centrality,
    build_link,
    build_louvain,
    build_match,
    build_nearest,
    build_pagerank,
    build_shortest_match,
    build_shortest_path,
    build_strongly_connected_components,
    build_traverse,
    build_triangle_count,
    build_unlink,
    escape_identifier,
)
from .transaction import AsyncSavepoint, AsyncTransaction, Savepoint, Transaction
from .type_parser import (
    TypeOID,
    parse_embedding,
    parse_value,
    serialize_embedding,
)
from .types import (
    DEFAULTS,
    ConnectionConfig,
    FieldInfo,
    LinkOptions,
    MatchEdge,
    MatchNode,
    NearestOptions,
    Path,
    PathEdge,
    PathNode,
    PoolConfig,
    QueryResult,
    TraverseOptions,
)


def connect(
    host: str = DEFAULTS["host"],
    port: int = DEFAULTS["port"],
    user: str = DEFAULTS["user"],
    password: str | None = None,
    database: str = DEFAULTS["database"],
    uri: str | None = None,
) -> Client:
    """DB-API 2.0 module-level connect() function.

    Accepts either keyword arguments or a connection URI string.
    Returns a connected Client instance.
    """
    if uri is not None:
        config = parse_connection_uri(uri)
    else:
        config = ConnectionConfig(
            host=host,
            port=port,
            user=user,
            password=password,
            database=database,
        )
    client = Client(config=config)
    client.connect()
    return client


__all__ = [
    # DB-API 2.0
    "apilevel",
    "threadsafety",
    "paramstyle",
    "connect",
    # Classes
    "Client",
    "Connection",
    "AsyncConnection",
    "Cursor",
    "Pool",
    "PoolClient",
    # Transaction
    "Transaction",
    "Savepoint",
    "AsyncTransaction",
    "AsyncSavepoint",
    # Configuration
    "ConnectionConfig",
    "PoolConfig",
    "DEFAULTS",
    # Results
    "QueryResult",
    "FieldInfo",
    # Options & patterns
    "TraverseOptions",
    "NearestOptions",
    "LinkOptions",
    "MatchNode",
    "MatchEdge",
    "Path",
    "PathNode",
    "PathEdge",
    # Query builders
    "build_traverse",
    "build_nearest",
    "build_link",
    "build_unlink",
    "build_match",
    "build_shortest_match",
    "build_shortest_path",
    # Graph algorithm query builders
    "build_pagerank",
    "build_betweenness_centrality",
    "build_connected_components",
    "build_louvain",
    "build_degree_centrality",
    "build_closeness_centrality",
    "build_eigenvector_centrality",
    "build_harmonic_centrality",
    "build_clustering_coefficient",
    "build_triangle_count",
    "build_strongly_connected_components",
    "escape_identifier",
    # Helpers
    "show_databases_sql",
    "show_tables_sql",
    "show_columns_sql",
    "show_edge_types_sql",
    "show_indexes_sql",
    "show_embeddings_sql",
    "show_providers_sql",
    "explain_sql",
    "explain_analyze_sql",
    "create_edge_type_sql",
    "drop_edge_type_sql",
    "parse_connection_uri",
    # Type system
    "TypeOID",
    "parse_value",
    "parse_embedding",
    "serialize_embedding",
    # Auth
    "scram_client_first",
    "scram_client_final",
    "scram_verify_server",
    # Exceptions
    "Warning",
    "Error",
    "InterfaceError",
    "DatabaseError",
    "DataError",
    "OperationalError",
    "IntegrityError",
    "InternalError",
    "ProgrammingError",
    "NotSupportedError",
]
