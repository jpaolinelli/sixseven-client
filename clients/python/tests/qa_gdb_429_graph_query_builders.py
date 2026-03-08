"""QA adversarial tests for GDB-429: Python Client — Graph Query Builder Updates.

Tests designed to break the implementation with edge cases, boundary values,
null handling, error paths, and stress scenarios across all subtasks:
- GDB-469: Update MATCH query builder (SELECT...FROM MATCH)
- GDB-470: Add path selector query builder (build_shortest_match)
- GDB-471: Path result parsing (_parse_path, Path helpers)
- GDB-472: Update SHORTEST PATH builder for SELECT composability
- GDB-473: Tests — Python client graph updates
"""

from __future__ import annotations

import json

import numpy as np
import pytest

from giodb.query_builders import (
    _build_edge_label,
    _build_edge_sql,
    build_match,
    build_shortest_match,
    build_shortest_path,
    escape_identifier,
)
from giodb.type_parser import TypeOID, _parse_path, parse_value
from giodb.types import MatchEdge, MatchNode, Path, PathEdge, PathNode


# ===========================================================================
# GDB-469: MATCH builder — SELECT...FROM MATCH syntax
# ===========================================================================


class TestQAMatchBuilderEmptyReturnItems:
    """AC: MATCH builder generates SELECT ... FROM MATCH — edge case of empty return_items."""

    def test_empty_return_items_produces_invalid_sql(self):
        """Empty return_items list generates 'SELECT  FROM MATCH ...' with empty SELECT."""
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT"),
            MatchNode("b", "users"),
        ]
        q = build_match(pattern, [])
        # This produces "SELECT  FROM MATCH ..." which is invalid SQL.
        # The builder should either raise ValueError or handle this gracefully.
        assert q["text"].startswith("SELECT  FROM MATCH")

    def test_single_return_item(self):
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT"),
            MatchNode("b", "users"),
        ]
        q = build_match(pattern, ["a"])
        assert "SELECT a FROM MATCH" in q["text"]


class TestQAMatchBuilderPatternStructure:
    """AC: MATCH builder — malformed pattern structures."""

    def test_single_node_only(self):
        """Pattern with a single node and no edges should still produce valid SQL."""
        pattern = [MatchNode("a", "users")]
        q = build_match(pattern, ["a"])
        assert q["text"] == 'SELECT a FROM MATCH (a:"users")'

    def test_consecutive_nodes_no_edge(self):
        """Two consecutive nodes without an edge in between — no validation."""
        pattern = [
            MatchNode("a", "users"),
            MatchNode("b", "posts"),
        ]
        q = build_match(pattern, ["a", "b"])
        # The builder doesn't validate pattern structure, so it concatenates
        assert '(a:"users")(b:"posts")' in q["text"]

    def test_consecutive_edges_no_node(self):
        """Two consecutive edges without a node in between — no validation."""
        pattern = [
            MatchEdge("r1", "follows", "OUT"),
            MatchEdge("r2", "likes", "OUT"),
        ]
        q = build_match(pattern, ["r1"])
        # Just concatenates the edges
        assert "->" in q["text"]

    def test_pattern_starting_with_edge(self):
        """Pattern starting with an edge instead of a node."""
        pattern = [
            MatchEdge("r", "follows", "OUT"),
            MatchNode("b", "users"),
        ]
        q = build_match(pattern, ["b"])
        # Builder doesn't validate — just generates the SQL
        assert '-[r:"follows"]->(b:"users")' in q["text"]

    def test_non_match_items_in_pattern_silently_ignored(self):
        """Items that are neither MatchNode nor MatchEdge are silently skipped."""
        pattern = [
            MatchNode("a", "users"),
            "not a valid item",  # type: ignore
            MatchNode("b", "users"),
        ]
        q = build_match(pattern, ["a", "b"])
        # The string item is silently ignored
        assert '(a:"users")(b:"users")' in q["text"]


class TestQAMatchBuilderSpecialCharacters:
    """AC: MATCH builder — special characters in identifiers and aliases."""

    def test_alias_with_spaces(self):
        """Aliases are not escaped — spaces would produce invalid SQL."""
        pattern = [
            MatchNode("my alias", "users"),
            MatchEdge("my edge", "follows", "OUT"),
            MatchNode("b", "users"),
        ]
        q = build_match(pattern, ["my alias"])
        # Alias goes into SQL unescaped
        assert "(my alias:" in q["text"]
        assert "[my edge:" in q["text"]

    def test_table_name_with_special_chars(self):
        pattern = [
            MatchNode("a", "user's table"),
            MatchEdge("r", "follows", "OUT"),
            MatchNode("b", "users"),
        ]
        q = build_match(pattern, ["a"])
        # Table names are properly escaped via escape_identifier
        assert "\"user's table\"" in q["text"]

    def test_empty_table_name(self):
        pattern = [
            MatchNode("a", ""),
            MatchEdge("r", "follows", "OUT"),
            MatchNode("b", "users"),
        ]
        q = build_match(pattern, ["a"])
        assert '(a:"")' in q["text"]

    def test_empty_alias(self):
        pattern = [
            MatchNode("", "users"),
            MatchEdge("", "follows", "OUT"),
            MatchNode("b", "users"),
        ]
        q = build_match(pattern, [""])
        assert '(:"users")' in q["text"]
        assert '[:"follows"]' in q["text"]


class TestQAMatchBuilderLegacyCompat:
    """AC: Backward compatibility preserved — legacy_syntax flag."""

    def test_legacy_uses_match_return(self):
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT"),
            MatchNode("b", "users"),
        ]
        q = build_match(pattern, ["a", "b"], legacy_syntax=True)
        assert q["text"].startswith("MATCH ")
        assert " RETURN " in q["text"]
        assert "SELECT" not in q["text"]
        assert "FROM MATCH" not in q["text"]

    def test_default_uses_new_syntax(self):
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT"),
            MatchNode("b", "users"),
        ]
        q = build_match(pattern, ["a", "b"])
        assert q["text"].startswith("SELECT ")
        assert "FROM MATCH" in q["text"]


# ===========================================================================
# GDB-469: MATCH builder — hop quantifiers
# ===========================================================================


class TestQAHopQuantifiers:
    """AC: Hop quantifiers supported in builder."""

    def test_quantifier_exact_count(self):
        """Exact count quantifier like {3}."""
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT", quantifier="{3}"),
            MatchNode("b", "users"),
        ]
        q = build_match(pattern, ["a", "b"])
        assert '-[r:"follows"]->{3}' in q["text"]

    def test_quantifier_open_ended_min(self):
        """Open-ended minimum like {2,}."""
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT", quantifier="{2,}"),
            MatchNode("b", "users"),
        ]
        q = build_match(pattern, ["a", "b"])
        assert '-[r:"follows"]->{2,}' in q["text"]

    def test_quantifier_zero_min(self):
        """Quantifier with zero minimum {0,5}."""
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT", quantifier="{0,5}"),
            MatchNode("b", "users"),
        ]
        q = build_match(pattern, ["a", "b"])
        assert '-[r:"follows"]->{0,5}' in q["text"]

    def test_no_quantifier_default(self):
        """No quantifier means single hop — no quantifier string appended."""
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT"),
            MatchNode("b", "users"),
        ]
        q = build_match(pattern, ["a", "b"])
        assert q["text"].endswith('(b:"users")')
        # No quantifier symbols after ->
        assert "->+" not in q["text"]
        assert "->*" not in q["text"]
        assert "->{" not in q["text"]

    def test_quantifier_none_explicitly(self):
        """Explicitly setting quantifier=None should be same as default."""
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT", quantifier=None),
            MatchNode("b", "users"),
        ]
        q = build_match(pattern, ["a", "b"])
        text = q["text"]
        # Should end with ->(...) not ->None(...)
        assert "None" not in text

    def test_quantifier_empty_string(self):
        """Empty string quantifier — produces no extra text (falsy)."""
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT", quantifier=""),
            MatchNode("b", "users"),
        ]
        q = build_match(pattern, ["a", "b"])
        # Empty string is falsy, same as None
        assert '-[r:"follows"]->(b:"users")' in q["text"]

    def test_quantifier_arbitrary_string_no_validation(self):
        """Builder does not validate quantifier syntax — passes through any string."""
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT", quantifier="INVALID"),
            MatchNode("b", "users"),
        ]
        q = build_match(pattern, ["a", "b"])
        # Quantifier is passed through as-is
        assert "->INVALID" in q["text"]


# ===========================================================================
# GDB-469: Cross-edge-type patterns
# ===========================================================================


class TestQACrossEdgeType:
    """AC: Cross-edge-type patterns in MATCH builder."""

    def test_edge_types_empty_list_falls_through(self):
        """Empty edge_types list is falsy — falls through to single edge_type."""
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT", edge_types=[]),
            MatchNode("b", "users"),
        ]
        q = build_match(pattern, ["a", "b"])
        assert '"follows"' in q["text"]

    def test_single_edge_type_in_list(self):
        """Single item in edge_types list."""
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT", edge_types=["likes"]),
            MatchNode("b", "users"),
        ]
        q = build_match(pattern, ["a", "b"])
        assert '"likes"' in q["text"]
        # No pipe separator for single item
        assert "|" not in q["text"]

    def test_edge_types_with_special_chars(self):
        """Edge types containing special characters are properly escaped."""
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT", edge_types=['edge"type', "another|edge"]),
            MatchNode("b", "users"),
        ]
        q = build_match(pattern, ["a", "b"])
        assert '"edge""type"' in q["text"]
        assert '"another|edge"' in q["text"]

    def test_cross_edge_with_in_direction(self):
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "IN", edge_types=["follows", "likes"]),
            MatchNode("b", "users"),
        ]
        q = build_match(pattern, ["a", "b"])
        assert '<-[r:"follows"|"likes"]-' in q["text"]


# ===========================================================================
# GDB-470: Path selector builder (build_shortest_match)
# ===========================================================================


class TestQAShortestMatchSelectors:
    """AC: Path selector builder works — adversarial selector inputs."""

    def test_selector_with_leading_trailing_whitespace(self):
        """Selector with whitespace is not stripped before validation."""
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT"),
            MatchNode("b", "users"),
        ]
        # Leading/trailing whitespace — .upper() does NOT strip
        with pytest.raises(ValueError, match="selector"):
            build_shortest_match(pattern, ["a", "b"], selector=" ANY SHORTEST ")

    def test_selector_mixed_case(self):
        """Mixed case is normalized by .upper()."""
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT"),
            MatchNode("b", "users"),
        ]
        q = build_shortest_match(pattern, ["a", "b"], selector="Any Shortest")
        assert "MATCH ANY SHORTEST" in q["text"]

    def test_shortest_k_zero_raises(self):
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT"),
            MatchNode("b", "users"),
        ]
        with pytest.raises(ValueError, match="positive integer"):
            build_shortest_match(pattern, ["a", "b"], selector="SHORTEST", k=0)

    def test_shortest_k_very_large(self):
        """Very large k value should be accepted (no upper bound validation)."""
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT"),
            MatchNode("b", "users"),
        ]
        q = build_shortest_match(pattern, ["a", "b"], selector="SHORTEST", k=999999)
        assert "SHORTEST 999999" in q["text"]

    def test_k_ignored_for_any_shortest(self):
        """k parameter is silently ignored when selector is not SHORTEST."""
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT"),
            MatchNode("b", "users"),
        ]
        q = build_shortest_match(pattern, ["a", "b"], selector="ANY SHORTEST", k=5)
        # k is silently ignored — no "5" in output
        assert "5" not in q["text"]
        assert "MATCH ANY SHORTEST" in q["text"]

    def test_empty_return_items(self):
        """Empty return items produces invalid SELECT."""
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT"),
            MatchNode("b", "users"),
        ]
        q = build_shortest_match(pattern, [])
        assert q["text"].startswith("SELECT  FROM")

    def test_weight_with_empty_string(self):
        """Empty string weight should still append WEIGHT clause."""
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT"),
            MatchNode("b", "users"),
        ]
        q = build_shortest_match(
            pattern, ["a", "b"], selector="ANY SHORTEST", weight=""
        )
        # Empty string is not None, so WEIGHT is appended with empty value
        assert "WEIGHT " in q["text"]

    def test_weight_and_where_order(self):
        """WEIGHT comes before WHERE in the output."""
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT"),
            MatchNode("b", "users"),
        ]
        q = build_shortest_match(
            pattern,
            ["a", "b"],
            selector="ANY SHORTEST",
            weight="r.cost",
            where="a.active = true",
        )
        weight_pos = q["text"].index("WEIGHT")
        where_pos = q["text"].index("WHERE")
        assert weight_pos < where_pos


class TestQAShortestMatchQuantifiersAndCrossEdge:
    """build_shortest_match supports the same edge features as build_match."""

    def test_with_hop_quantifier(self):
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT", quantifier="{1,5}"),
            MatchNode("b", "users"),
        ]
        q = build_shortest_match(pattern, ["a", "b"], selector="ANY SHORTEST")
        assert "->{1,5}" in q["text"]
        assert "ANY SHORTEST" in q["text"]

    def test_with_cross_edge_types(self):
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT", edge_types=["follows", "friends"]),
            MatchNode("b", "users"),
        ]
        q = build_shortest_match(pattern, ["a", "b"], selector="ALL SHORTEST")
        assert '"follows"|"friends"' in q["text"]
        assert "ALL SHORTEST" in q["text"]


# ===========================================================================
# GDB-471: Path result parsing
# ===========================================================================


class TestQAParsePathMalformed:
    """AC: Path result parsing works — malformed and adversarial inputs."""

    def test_non_json_string_raises(self):
        with pytest.raises(json.JSONDecodeError):
            _parse_path("not json at all")

    def test_json_string_value_raises(self):
        """JSON string (not array) raises ValueError."""
        with pytest.raises(ValueError, match="JSON array"):
            _parse_path('"hello"')

    def test_json_number_raises(self):
        with pytest.raises(ValueError, match="JSON array"):
            _parse_path("42")

    def test_json_null_raises(self):
        with pytest.raises(ValueError, match="JSON array"):
            _parse_path("null")

    def test_node_missing_table_key_raises(self):
        """Node element missing 'table' key raises KeyError."""
        data = json.dumps([{"id": 1, "name": "Alice"}])
        with pytest.raises(KeyError):
            _parse_path(data)

    def test_node_missing_id_key_raises(self):
        """Node element missing 'id' key raises KeyError."""
        data = json.dumps([{"table": "users", "name": "Alice"}])
        with pytest.raises(KeyError):
            _parse_path(data)

    def test_edge_missing_edge_type_raises(self):
        """Edge element missing 'edge_type' key raises KeyError."""
        data = json.dumps([
            {"table": "users", "id": 1},
            {"from_id": 1, "to_id": 2},
            {"table": "users", "id": 2},
        ])
        with pytest.raises(KeyError):
            _parse_path(data)

    def test_edge_missing_from_id_raises(self):
        data = json.dumps([
            {"table": "users", "id": 1},
            {"edge_type": "follows", "to_id": 2},
            {"table": "users", "id": 2},
        ])
        with pytest.raises(KeyError):
            _parse_path(data)

    def test_edge_missing_to_id_raises(self):
        data = json.dumps([
            {"table": "users", "id": 1},
            {"edge_type": "follows", "from_id": 1},
            {"table": "users", "id": 2},
        ])
        with pytest.raises(KeyError):
            _parse_path(data)

    def test_dangling_edge_even_element_count(self):
        """Array with even length: last element is an edge with no trailing node."""
        data = json.dumps([
            {"table": "users", "id": 1},
            {"edge_type": "follows", "from_id": 1, "to_id": 2},
        ])
        path = _parse_path(data)
        # Parser doesn't validate structure — 1 node, 1 edge, no trailing node
        assert len(path.nodes()) == 1
        assert len(path.edges()) == 1


class TestQAParsePathTypes:
    """AC: Path result parsing — type handling for node/edge properties."""

    def test_node_id_as_string(self):
        data = json.dumps([{"table": "users", "id": "uuid-string-id"}])
        path = _parse_path(data)
        assert path.nodes()[0].id == "uuid-string-id"

    def test_node_id_as_null(self):
        data = json.dumps([{"table": "users", "id": None}])
        path = _parse_path(data)
        assert path.nodes()[0].id is None

    def test_nested_properties(self):
        """Node properties can be nested dicts/lists from JSON."""
        data = json.dumps([
            {
                "table": "users",
                "id": 1,
                "metadata": {"nested": {"deep": True}},
                "tags": [1, 2, 3],
            }
        ])
        path = _parse_path(data)
        assert path.nodes()[0].properties["metadata"] == {"nested": {"deep": True}}
        assert path.nodes()[0].properties["tags"] == [1, 2, 3]

    def test_unicode_in_properties(self):
        data = json.dumps([
            {"table": "users", "id": 1, "name": "\u00e9\u00e0\u00fc\U0001f600\u4e16\u754c"}
        ])
        path = _parse_path(data)
        assert path.nodes()[0].properties["name"] == "\u00e9\u00e0\u00fc\U0001f600\u4e16\u754c"

    def test_very_large_path(self):
        """Stress test: large path with many hops."""
        elements = []
        for i in range(100):
            elements.append({"table": "users", "id": i})
            if i < 99:
                elements.append(
                    {"edge_type": "follows", "from_id": i, "to_id": i + 1}
                )
        data = json.dumps(elements)
        path = _parse_path(data)
        assert len(path.nodes()) == 100
        assert len(path.edges()) == 99
        assert path.path_length() == 99
        assert len(path) == 99


class TestQAPathHelperMethods:
    """AC: Path result parsing works — helper method correctness."""

    def test_nodes_returns_copy(self):
        """nodes() should return a copy, not the internal list."""
        data = json.dumps([
            {"table": "users", "id": 1},
            {"edge_type": "follows", "from_id": 1, "to_id": 2},
            {"table": "users", "id": 2},
        ])
        path = _parse_path(data)
        nodes = path.nodes()
        nodes.clear()
        # Internal list should be unaffected
        assert len(path.nodes()) == 2

    def test_edges_returns_copy(self):
        """edges() should return a copy, not the internal list."""
        data = json.dumps([
            {"table": "users", "id": 1},
            {"edge_type": "follows", "from_id": 1, "to_id": 2},
            {"table": "users", "id": 2},
        ])
        path = _parse_path(data)
        edges = path.edges()
        edges.clear()
        assert len(path.edges()) == 1

    def test_empty_path_helpers(self):
        path = _parse_path("[]")
        assert path.path_length() == 0
        assert path.nodes() == []
        assert path.edges() == []
        assert len(path) == 0

    def test_repr_empty_path(self):
        path = _parse_path("[]")
        r = repr(path)
        assert r == "Path()"

    def test_repr_single_node(self):
        data = json.dumps([{"table": "users", "id": 42}])
        path = _parse_path(data)
        r = repr(path)
        assert "users" in r
        assert "42" in r
        # No arrow since no edges
        assert "->" not in r

    def test_repr_multi_hop(self):
        data = json.dumps([
            {"table": "users", "id": 1},
            {"edge_type": "follows", "from_id": 1, "to_id": 2},
            {"table": "users", "id": 2},
            {"edge_type": "likes", "from_id": 2, "to_id": 3},
            {"table": "posts", "id": 3},
        ])
        path = _parse_path(data)
        r = repr(path)
        assert "follows" in r
        assert "likes" in r
        assert "posts" in r


class TestQAPathViaParseValue:
    """AC: Correct type mapping — PATH OID routed to _parse_path."""

    def test_parse_value_with_path_oid(self):
        data = json.dumps([
            {"table": "users", "id": 1},
            {"edge_type": "follows", "from_id": 1, "to_id": 2},
            {"table": "users", "id": 2},
        ])
        result = parse_value(TypeOID.PATH, data)
        assert isinstance(result, Path)
        assert result.path_length() == 1

    def test_path_oid_value(self):
        assert TypeOID.PATH == 100006


# ===========================================================================
# GDB-472: SHORTEST PATH builder — SELECT composability
# ===========================================================================


class TestQAShortestPathSelectComposability:
    """AC: SHORTEST PATH builder generates SELECT-composable form."""

    def test_default_select_star(self):
        q = build_shortest_path("follows", "users", 1, "users", 2)
        assert q["text"].startswith("SELECT * FROM SHORTEST PATH")

    def test_custom_select_expression(self):
        q = build_shortest_path("follows", "users", 1, "users", 2, select="path, cost")
        assert q["text"].startswith("SELECT path, cost FROM SHORTEST PATH")

    def test_empty_select_string(self):
        """Empty select string — produces 'SELECT  FROM ...'."""
        q = build_shortest_path("follows", "users", 1, "users", 2, select="")
        assert q["text"].startswith("SELECT  FROM")

    def test_legacy_no_select_wrapper(self):
        q = build_shortest_path("follows", "users", 1, "users", 2, legacy_syntax=True)
        assert q["text"].startswith("SHORTEST PATH FROM")
        assert "SELECT" not in q["text"]

    def test_legacy_ignores_select_param(self):
        """select parameter is irrelevant in legacy mode."""
        q = build_shortest_path(
            "follows", "users", 1, "users", 2, select="custom", legacy_syntax=True
        )
        assert "custom" not in q["text"]
        assert q["text"].startswith("SHORTEST PATH FROM")

    def test_all_options_combined_new_syntax(self):
        q = build_shortest_path(
            "follows", "users", 1, "users", 2,
            direction="OUT", max_depth=10, select="path",
        )
        assert q["text"].startswith("SELECT path FROM SHORTEST PATH")
        assert "DIRECTION OUT" in q["text"]
        assert "MAX_DEPTH 10" in q["text"]
        assert q["values"] == [1, 2]

    def test_max_depth_zero_raises(self):
        with pytest.raises(ValueError, match="max_depth"):
            build_shortest_path("follows", "users", 1, "users", 2, max_depth=0)

    def test_max_depth_bool_raises(self):
        with pytest.raises(ValueError, match="positive integer"):
            build_shortest_path("follows", "users", 1, "users", 2, max_depth=True)  # type: ignore

    def test_values_always_two_params(self):
        """Values list always contains [from_id, to_id] regardless of options."""
        q = build_shortest_path(
            "follows", "users", "uuid-a", "users", "uuid-b",
            direction="BOTH", max_depth=5,
        )
        assert q["values"] == ["uuid-a", "uuid-b"]


# ===========================================================================
# Edge builder internals
# ===========================================================================


class TestQABuildEdgeSql:
    """Internal _build_edge_sql and _build_edge_label adversarial tests."""

    def test_edge_label_single_type(self):
        edge = MatchEdge("r", "follows", "OUT")
        label = _build_edge_label(edge)
        assert label == '"follows"'

    def test_edge_label_cross_types(self):
        edge = MatchEdge("r", "ignored", "OUT", edge_types=["a", "b", "c"])
        label = _build_edge_label(edge)
        assert label == '"a"|"b"|"c"'

    def test_edge_label_none_edge_types(self):
        edge = MatchEdge("r", "follows", "OUT", edge_types=None)
        label = _build_edge_label(edge)
        assert label == '"follows"'

    def test_edge_sql_out_direction(self):
        edge = MatchEdge("r", "follows", "OUT")
        sql = _build_edge_sql(edge)
        assert sql == '-[r:"follows"]->'

    def test_edge_sql_in_direction(self):
        edge = MatchEdge("r", "follows", "IN")
        sql = _build_edge_sql(edge)
        assert sql == '<-[r:"follows"]-'

    def test_edge_sql_both_direction(self):
        edge = MatchEdge("r", "follows", "BOTH")
        sql = _build_edge_sql(edge)
        assert sql == '-[r:"follows"]-'

    def test_edge_sql_unknown_direction_defaults_out(self):
        """Unknown direction string treated as OUT (else branch)."""
        edge = MatchEdge("r", "follows", "UNKNOWN")
        sql = _build_edge_sql(edge)
        assert sql == '-[r:"follows"]->'

    def test_edge_sql_with_quantifier(self):
        edge = MatchEdge("r", "follows", "OUT", quantifier="{2,5}")
        sql = _build_edge_sql(edge)
        assert sql == '-[r:"follows"]->{2,5}'


# ===========================================================================
# SQL injection resistance
# ===========================================================================


class TestQASqlInjectionResistance:
    """Verify all builders properly escape identifiers to prevent SQL injection."""

    def test_match_table_injection(self):
        pattern = [
            MatchNode("a", '"; DROP TABLE users; --'),
            MatchEdge("r", "follows", "OUT"),
            MatchNode("b", "users"),
        ]
        q = build_match(pattern, ["a"])
        # Double quotes inside are escaped
        assert '""; DROP TABLE users; --"' in q["text"]

    def test_match_edge_type_injection(self):
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", '"; DELETE FROM edges; --', "OUT"),
            MatchNode("b", "users"),
        ]
        q = build_match(pattern, ["a"])
        assert '""; DELETE FROM edges; --"' in q["text"]

    def test_shortest_path_injection(self):
        q = build_shortest_path(
            '"; DROP TABLE x; --', "users", 1, "users", 2
        )
        assert '""; DROP TABLE x; --"' in q["text"]

    def test_shortest_match_injection_via_edge(self):
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", '"; TRUNCATE; --', "OUT"),
            MatchNode("b", "users"),
        ]
        q = build_shortest_match(pattern, ["a"], selector="ANY SHORTEST")
        assert '""; TRUNCATE; --"' in q["text"]


# ===========================================================================
# Integration: all builders produce consistent structure
# ===========================================================================


class TestQABuilderOutputStructure:
    """All builders return dict with 'text' (str) and 'values' (list)."""

    def test_build_match_structure(self):
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT"),
            MatchNode("b", "users"),
        ]
        q = build_match(pattern, ["a", "b"])
        assert isinstance(q, dict)
        assert isinstance(q["text"], str)
        assert isinstance(q["values"], list)

    def test_build_shortest_match_structure(self):
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT"),
            MatchNode("b", "users"),
        ]
        q = build_shortest_match(pattern, ["a", "b"])
        assert isinstance(q, dict)
        assert isinstance(q["text"], str)
        assert isinstance(q["values"], list)

    def test_build_shortest_path_structure(self):
        q = build_shortest_path("follows", "users", 1, "users", 2)
        assert isinstance(q, dict)
        assert isinstance(q["text"], str)
        assert isinstance(q["values"], list)

    def test_match_values_always_empty(self):
        """MATCH and SHORTEST MATCH don't use parameterized values."""
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT"),
            MatchNode("b", "users"),
        ]
        q1 = build_match(pattern, ["a"])
        q2 = build_shortest_match(pattern, ["a"])
        assert q1["values"] == []
        assert q2["values"] == []

    def test_shortest_path_values_two_ids(self):
        q = build_shortest_path("follows", "users", 1, "users", 2)
        assert len(q["values"]) == 2
        assert q["values"] == [1, 2]
