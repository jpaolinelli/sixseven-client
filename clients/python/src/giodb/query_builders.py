"""Query builders for SixSevenDB-specific SQL operations.

All builders return a dict with 'text' (SQL string) and 'values' (parameter list),
designed for use with the extended query protocol ($1, $2, ...).
"""

from __future__ import annotations

import re
from typing import Any, Sequence, Union

import numpy as np

from .type_parser import serialize_embedding
from .types import (
    LinkOptions,
    MatchEdge,
    MatchNode,
    NearestOptions,
    TraverseOptions,
)


def escape_identifier(name: str) -> str:
    """Escape a SQL identifier with double quotes."""
    return '"' + name.replace('"', '""') + '"'


def _validate_positive_int(value: Any, name: str) -> None:
    """Validate that a value is a positive integer."""
    if not isinstance(value, int) or isinstance(value, bool):
        raise ValueError(f"{name} must be a positive integer, got {type(value).__name__}")
    if value <= 0:
        raise ValueError(f"{name} must be a positive integer, got {value}")


def build_traverse(
    edge_type: str,
    from_table: str,
    start_id: Any,
    options: TraverseOptions | None = None,
) -> dict[str, Any]:
    """Build a TRAVERSE query.

    Syntax: TRAVERSE edge FROM table($1) [DIRECTION d] [MAX_DEPTH n] [MODE m] [WHERE expr] [FETCH]
    """
    parts = [
        f"TRAVERSE {escape_identifier(edge_type)} FROM {escape_identifier(from_table)}($1)"
    ]
    values: list[Any] = [start_id]

    if options is not None:
        if options.direction is not None:
            parts.append(f"DIRECTION {options.direction}")
        if options.max_depth is not None:
            _validate_positive_int(options.max_depth, "max_depth")
            parts.append(f"MAX_DEPTH {options.max_depth}")
        if options.mode is not None:
            parts.append(f"MODE {options.mode}")
        if options.where is not None:
            parts.append(f"WHERE {options.where}")
        if options.fetch:
            parts.append("FETCH")

    return {"text": " ".join(parts), "values": values}


def build_nearest(
    table: str,
    column: str,
    query: str | np.ndarray | list[float],
    options: NearestOptions | None = None,
) -> dict[str, Any]:
    """Build a NEAREST query.

    Syntax: NEAREST k FROM table.column TO $1 [WHERE expr] [USING metric]
           [WITHIN TRAVERSE edge FROM table($2)]
    """
    k = 10 if options is None else options.k
    _validate_positive_int(k, "k")

    parts = [
        f"NEAREST {k} FROM {escape_identifier(table)}.{escape_identifier(column)} TO $1"
    ]

    if isinstance(query, (np.ndarray, list)):
        query_str = serialize_embedding(query)
    else:
        query_str = query
    values: list[Any] = [query_str]

    if options is not None:
        if options.where is not None:
            parts.append(f"WHERE {options.where}")
        if options.metric is not None:
            parts.append(f"USING {options.metric}")
        if options.within_traverse is not None:
            parts.append(f"WITHIN TRAVERSE {escape_identifier(options.within_traverse)}")

    return {"text": " ".join(parts), "values": values}


def build_link(
    edge_type: str,
    from_table: str,
    from_id: Any,
    to_table: str,
    to_id: Any,
    options: LinkOptions | None = None,
) -> dict[str, Any]:
    """Build a LINK query.

    Syntax: LINK source($1) TO target($2) VIA edge [(prop = $3, ...)]
    """
    parts = [
        f"LINK {escape_identifier(from_table)}($1) TO {escape_identifier(to_table)}($2) VIA {escape_identifier(edge_type)}"
    ]
    values: list[Any] = [from_id, to_id]

    if options is not None and options.properties:
        prop_parts: list[str] = []
        for key, val in options.properties.items():
            idx = len(values) + 1
            prop_parts.append(f"{escape_identifier(key)} = ${idx}")
            values.append(val)
        parts.append(f"({', '.join(prop_parts)})")

    return {"text": " ".join(parts), "values": values}


def build_unlink(
    edge_type: str,
    from_table: str,
    from_id: Any,
    to_table: str,
    to_id: Any,
) -> dict[str, Any]:
    """Build an UNLINK query.

    Syntax: UNLINK source($1) FROM target($2) VIA edge
    """
    text = f"UNLINK {escape_identifier(from_table)}($1) FROM {escape_identifier(to_table)}($2) VIA {escape_identifier(edge_type)}"
    return {"text": text, "values": [from_id, to_id]}


def _build_edge_label(edge: MatchEdge) -> str:
    """Build the edge label portion, supporting cross-edge-type patterns."""
    if edge.edge_types:
        return "|".join(escape_identifier(et) for et in edge.edge_types)
    return escape_identifier(edge.edge_type)


def _build_edge_sql(edge: MatchEdge) -> str:
    """Build the SQL fragment for a single MatchEdge including direction and quantifier."""
    label = _build_edge_label(edge)
    bracket = f"[{edge.alias}:{label}]"
    quantifier = edge.quantifier or ""

    if edge.direction == "IN":
        return f"<-{bracket}-{quantifier}"
    elif edge.direction == "BOTH":
        return f"-{bracket}-{quantifier}"
    else:  # OUT (default)
        return f"-{bracket}->{quantifier}"


def build_match(
    pattern: list[Union[MatchNode, MatchEdge]],
    return_items: list[str],
    where: str | None = None,
    *,
    legacy_syntax: bool = False,
) -> dict[str, Any]:
    """Build a MATCH query for graph pattern matching.

    New syntax (default):
        SELECT a, b FROM MATCH (a:"table")-[r:"edge"]->(b:"table") [WHERE expr]

    Legacy syntax (``legacy_syntax=True``):
        MATCH (a:"table")-[r:"edge"]->(b:"table") RETURN a, b [WHERE expr]

    Supports hop quantifiers on edges (``{min,max}``, ``+``, ``*``) and
    cross-edge-type patterns via :attr:`MatchEdge.edge_types`.
    """
    if not pattern:
        raise ValueError("MATCH pattern must not be empty")

    parts_sql: list[str] = []
    for item in pattern:
        if isinstance(item, MatchNode):
            parts_sql.append(f"({item.alias}:{escape_identifier(item.table)})")
        elif isinstance(item, MatchEdge):
            parts_sql.append(_build_edge_sql(item))

    pattern_str = "".join(parts_sql)
    select_str = ", ".join(return_items)

    if legacy_syntax:
        sql = f"MATCH {pattern_str} RETURN {select_str}"
    else:
        sql = f"SELECT {select_str} FROM MATCH {pattern_str}"

    if where is not None:
        sql += f" WHERE {where}"

    return {"text": sql, "values": []}


def build_shortest_match(
    pattern: list[Union[MatchNode, MatchEdge]],
    return_items: list[str],
    selector: str = "ANY SHORTEST",
    *,
    k: int | None = None,
    weight: str | None = None,
    where: str | None = None,
) -> dict[str, Any]:
    """Build a shortest-path match query with a path selector.

    Syntax:
        SELECT <items> FROM MATCH <selector> <pattern> [WHERE expr]

    Selectors: ``ANY SHORTEST``, ``ALL SHORTEST``, ``SHORTEST <k>``.
    Optional ``WEIGHT`` clause specifies the cost property for weighted
    shortest-path computation.
    """
    if not pattern:
        raise ValueError("MATCH pattern must not be empty")

    valid_selectors = {"ANY SHORTEST", "ALL SHORTEST", "SHORTEST"}
    base = selector.upper()
    if base not in valid_selectors:
        raise ValueError(
            f"selector must be one of {sorted(valid_selectors)}, got {selector!r}"
        )

    if base == "SHORTEST":
        if k is None:
            raise ValueError("k is required when selector is 'SHORTEST'")
        _validate_positive_int(k, "k")
        selector_str = f"SHORTEST {k}"
    else:
        selector_str = base

    parts_sql: list[str] = []
    for item in pattern:
        if isinstance(item, MatchNode):
            parts_sql.append(f"({item.alias}:{escape_identifier(item.table)})")
        elif isinstance(item, MatchEdge):
            parts_sql.append(_build_edge_sql(item))

    pattern_str = "".join(parts_sql)
    select_str = ", ".join(return_items)

    sql = f"SELECT {select_str} FROM MATCH {selector_str} {pattern_str}"
    if weight is not None:
        sql += f" WEIGHT {weight}"
    if where is not None:
        sql += f" WHERE {where}"

    return {"text": sql, "values": []}


def build_shortest_path(
    edge_type: str,
    from_table: str,
    from_id: Any,
    to_table: str,
    to_id: Any,
    direction: str | None = None,
    max_depth: int | None = None,
    *,
    select: str = "*",
    legacy_syntax: bool = False,
) -> dict[str, Any]:
    """Build a SHORTEST PATH query.

    New syntax (default):
        SELECT <select> FROM SHORTEST PATH FROM table($1) TO table($2) VIA edge
        [DIRECTION d] [MAX_DEPTH n]

    Legacy syntax (``legacy_syntax=True``):
        SHORTEST PATH FROM table($1) TO table($2) VIA edge
        [DIRECTION d] [MAX_DEPTH n]
    """
    inner_parts = [
        f"SHORTEST PATH FROM {escape_identifier(from_table)}($1) TO {escape_identifier(to_table)}($2) VIA {escape_identifier(edge_type)}"
    ]
    values: list[Any] = [from_id, to_id]

    if direction is not None:
        inner_parts.append(f"DIRECTION {direction}")
    if max_depth is not None:
        _validate_positive_int(max_depth, "max_depth")
        inner_parts.append(f"MAX_DEPTH {max_depth}")

    inner_sql = " ".join(inner_parts)

    if legacy_syntax:
        return {"text": inner_sql, "values": values}

    return {"text": f"SELECT {select} FROM {inner_sql}", "values": values}


# ---------------------------------------------------------------------------
# Graph algorithm query builders (GDB-491)
#
# Each builder generates a SELECT against a table-valued function (TVF) for
# the corresponding graph algorithm. The edge type is bound as a query
# parameter ($1) and any additional algorithm parameters follow ($2, $3, ...).
# Generated SQL has the shape:
#
#     SELECT <select> FROM <algorithm>($1, $2, ...)
#
# Callers can JOIN the result against other tables using composable SQL
# (e.g. ``SELECT u.name, p.score FROM pagerank('knows') p JOIN users u
# ON u.id = p.node_id``) — the builder produces the right-hand side of any
# such JOIN.
# ---------------------------------------------------------------------------


_VALID_DEGREE_DIRECTIONS = {"IN", "OUT", "BOTH"}
_VALID_CLOSENESS_VARIANTS = {"STANDARD", "WASSERMAN_FAUST", "HARMONIC"}


def _validate_non_empty_str(value: Any, name: str) -> None:
    """Validate that a value is a non-empty, non-whitespace string.

    See GDB-664: previously only rejected the empty string, which let
    whitespace-only values such as ``" "``, ``"\\t"``, ``"\\n"``, and
    ``"\\r\\n"`` slip through and be emitted as parameter values.
    """
    if not isinstance(value, str):
        raise ValueError(f"{name} must be a string, got {type(value).__name__}")
    if not value or not value.strip():
        raise ValueError(f"{name} must be a non-empty string")


def _validate_probability(value: Any, name: str) -> None:
    """Validate that a value is a float in the open interval (0, 1)."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be a number, got {type(value).__name__}")
    if not (0.0 < float(value) < 1.0):
        raise ValueError(f"{name} must be between 0 and 1 (exclusive), got {value}")


def _validate_positive_number(value: Any, name: str) -> None:
    """Validate that a value is a positive (>0) number."""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{name} must be a number, got {type(value).__name__}")
    if float(value) <= 0.0:
        raise ValueError(f"{name} must be positive, got {value}")


# Strict identifier pattern for column names accepted by ``select``.
# Only ASCII letters, digits, and underscores; must not start with a digit.
_IDENTIFIER_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _validate_select(select: Union[str, Sequence[str], None]) -> str:
    """Validate ``select`` and return the SQL fragment to interpolate.

    Accepts:
      * ``"*"`` (the default sentinel) — returns ``"*"``.
      * ``None`` — treated as ``"*"``.
      * A ``Sequence[str]`` of column identifiers. Each identifier must
        match ``^[A-Za-z_][A-Za-z0-9_]*$``. Identifiers are quoted with
        :func:`escape_identifier` and joined with ``", "``.

    Rejects everything else (including arbitrary strings) with
    :class:`ValueError`. This prevents SQL injection via the ``select``
    parameter — see GDB-662.
    """
    if select is None or select == "*":
        return "*"

    if isinstance(select, str):
        # Bare strings are no longer accepted because they were the source
        # of the SQL-injection bug. Callers that previously passed
        # ``select="col_a, col_b"`` must now pass ``select=["col_a", "col_b"]``.
        raise ValueError(
            "select must be '*' or a sequence of column identifiers; "
            "raw strings are not accepted (use a list of column names)"
        )

    # Reject str-like sequences (bytes, bytearray) explicitly.
    if isinstance(select, (bytes, bytearray)):
        raise ValueError(
            "select must be '*' or a sequence of column identifiers, "
            f"got {type(select).__name__}"
        )

    try:
        columns = list(select)
    except TypeError as exc:
        raise ValueError(
            "select must be '*' or a sequence of column identifiers, "
            f"got {type(select).__name__}"
        ) from exc

    if not columns:
        raise ValueError("select must contain at least one column identifier")

    quoted: list[str] = []
    for col in columns:
        if not isinstance(col, str):
            raise ValueError(
                "select column identifiers must be strings, "
                f"got {type(col).__name__}"
            )
        if not _IDENTIFIER_RE.fullmatch(col):
            raise ValueError(
                f"select column identifier {col!r} is not a valid identifier "
                "(must match ^[A-Za-z_][A-Za-z0-9_]*$)"
            )
        quoted.append(escape_identifier(col))

    return ", ".join(quoted)


def _algorithm_sql(
    func_name: str,
    values: list[Any],
    *,
    select: Union[str, Sequence[str], None] = "*",
) -> dict[str, Any]:
    """Construct the standard ``SELECT <select> FROM <func>($1, $2, ...)`` SQL.

    ``select`` is validated by :func:`_validate_select`. See GDB-662.
    """
    select_sql = _validate_select(select)
    placeholders = ", ".join(f"${i + 1}" for i in range(len(values)))
    text = f"SELECT {select_sql} FROM {func_name}({placeholders})"
    return {"text": text, "values": values}


def build_pagerank(
    edge_type: str,
    damping: float = 0.85,
    iterations: int = 20,
    *,
    select: Union[str, Sequence[str], None] = "*",
) -> dict[str, Any]:
    """Build a PageRank query.

    SQL: ``SELECT <select> FROM pagerank($1, $2, $3)`` with arguments
    ``(edge_type, damping, iterations)``.
    """
    _validate_non_empty_str(edge_type, "edge_type")
    _validate_probability(damping, "damping")
    _validate_positive_int(iterations, "iterations")
    return _algorithm_sql(
        "pagerank",
        [edge_type, float(damping), iterations],
        select=select,
    )


def build_betweenness_centrality(
    edge_type: str,
    *,
    select: Union[str, Sequence[str], None] = "*",
) -> dict[str, Any]:
    """Build a betweenness centrality query.

    SQL: ``SELECT <select> FROM betweenness_centrality($1)``.
    """
    _validate_non_empty_str(edge_type, "edge_type")
    return _algorithm_sql("betweenness_centrality", [edge_type], select=select)


def build_connected_components(
    edge_type: str,
    *,
    select: Union[str, Sequence[str], None] = "*",
) -> dict[str, Any]:
    """Build a connected components query.

    SQL: ``SELECT <select> FROM connected_components($1)``.
    """
    _validate_non_empty_str(edge_type, "edge_type")
    return _algorithm_sql("connected_components", [edge_type], select=select)


def build_louvain(
    edge_type: str,
    resolution: float = 1.0,
    *,
    select: Union[str, Sequence[str], None] = "*",
) -> dict[str, Any]:
    """Build a Louvain community detection query.

    SQL: ``SELECT <select> FROM louvain($1, $2)`` with arguments
    ``(edge_type, resolution)``.
    """
    _validate_non_empty_str(edge_type, "edge_type")
    _validate_positive_number(resolution, "resolution")
    return _algorithm_sql(
        "louvain",
        [edge_type, float(resolution)],
        select=select,
    )


def build_degree_centrality(
    edge_type: str,
    direction: str = "BOTH",
    *,
    select: Union[str, Sequence[str], None] = "*",
) -> dict[str, Any]:
    """Build a degree centrality query.

    SQL: ``SELECT <select> FROM degree_centrality($1, $2)`` with arguments
    ``(edge_type, direction)``. ``direction`` must be one of ``IN``, ``OUT``,
    or ``BOTH`` (case-insensitive).
    """
    _validate_non_empty_str(edge_type, "edge_type")
    _validate_non_empty_str(direction, "direction")
    direction_upper = direction.upper()
    if direction_upper not in _VALID_DEGREE_DIRECTIONS:
        raise ValueError(
            f"direction must be one of {sorted(_VALID_DEGREE_DIRECTIONS)}, "
            f"got {direction!r}"
        )
    return _algorithm_sql(
        "degree_centrality",
        [edge_type, direction_upper],
        select=select,
    )


def build_closeness_centrality(
    edge_type: str,
    variant: str = "STANDARD",
    *,
    select: Union[str, Sequence[str], None] = "*",
) -> dict[str, Any]:
    """Build a closeness centrality query.

    SQL: ``SELECT <select> FROM closeness_centrality($1, $2)`` with arguments
    ``(edge_type, variant)``. ``variant`` must be one of ``STANDARD``,
    ``WASSERMAN_FAUST``, or ``HARMONIC`` (case-insensitive).
    """
    _validate_non_empty_str(edge_type, "edge_type")
    _validate_non_empty_str(variant, "variant")
    variant_upper = variant.upper()
    if variant_upper not in _VALID_CLOSENESS_VARIANTS:
        raise ValueError(
            f"variant must be one of {sorted(_VALID_CLOSENESS_VARIANTS)}, "
            f"got {variant!r}"
        )
    return _algorithm_sql(
        "closeness_centrality",
        [edge_type, variant_upper],
        select=select,
    )


def build_eigenvector_centrality(
    edge_type: str,
    iterations: int = 100,
    tolerance: float = 1e-6,
    *,
    select: Union[str, Sequence[str], None] = "*",
) -> dict[str, Any]:
    """Build an eigenvector centrality query.

    SQL: ``SELECT <select> FROM eigenvector_centrality($1, $2, $3)`` with
    arguments ``(edge_type, iterations, tolerance)``.
    """
    _validate_non_empty_str(edge_type, "edge_type")
    _validate_positive_int(iterations, "iterations")
    _validate_positive_number(tolerance, "tolerance")
    return _algorithm_sql(
        "eigenvector_centrality",
        [edge_type, iterations, float(tolerance)],
        select=select,
    )


def build_harmonic_centrality(
    edge_type: str,
    *,
    select: Union[str, Sequence[str], None] = "*",
) -> dict[str, Any]:
    """Build a harmonic centrality query.

    SQL: ``SELECT <select> FROM harmonic_centrality($1)``.
    """
    _validate_non_empty_str(edge_type, "edge_type")
    return _algorithm_sql("harmonic_centrality", [edge_type], select=select)


def build_clustering_coefficient(
    edge_type: str,
    *,
    select: Union[str, Sequence[str], None] = "*",
) -> dict[str, Any]:
    """Build a clustering coefficient query.

    SQL: ``SELECT <select> FROM clustering_coefficient($1)``.
    """
    _validate_non_empty_str(edge_type, "edge_type")
    return _algorithm_sql("clustering_coefficient", [edge_type], select=select)


def build_triangle_count(
    edge_type: str,
    *,
    select: Union[str, Sequence[str], None] = "*",
) -> dict[str, Any]:
    """Build a triangle count query.

    SQL: ``SELECT <select> FROM triangle_count($1)``.
    """
    _validate_non_empty_str(edge_type, "edge_type")
    return _algorithm_sql("triangle_count", [edge_type], select=select)


def build_strongly_connected_components(
    edge_type: str,
    *,
    select: Union[str, Sequence[str], None] = "*",
) -> dict[str, Any]:
    """Build a strongly connected components query.

    SQL: ``SELECT <select> FROM strongly_connected_components($1)``.
    """
    _validate_non_empty_str(edge_type, "edge_type")
    return _algorithm_sql(
        "strongly_connected_components",
        [edge_type],
        select=select,
    )
