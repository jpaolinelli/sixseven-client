"""Query builders for SixSevenDB-specific SQL operations.

All builders return a dict with 'text' (SQL string) and 'values' (parameter list),
designed for use with the extended query protocol ($1, $2, ...).
"""

from __future__ import annotations

from typing import Any, Union

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
