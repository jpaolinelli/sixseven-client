"""Tests for advanced query builders (MATCH, SHORTEST PATH, path selector, validation)."""

from __future__ import annotations

import pytest

from giodb.query_builders import (
    build_match,
    build_nearest,
    build_shortest_match,
    build_shortest_path,
    build_traverse,
    _validate_positive_int,
)
from giodb.types import MatchEdge, MatchNode, NearestOptions, TraverseOptions


class TestValidatePositiveInt:
    def test_valid(self):
        _validate_positive_int(1, "k")
        _validate_positive_int(100, "k")

    def test_zero(self):
        with pytest.raises(ValueError, match="positive integer"):
            _validate_positive_int(0, "k")

    def test_negative(self):
        with pytest.raises(ValueError, match="positive integer"):
            _validate_positive_int(-1, "max_depth")

    def test_float(self):
        with pytest.raises(ValueError, match="positive integer"):
            _validate_positive_int(3.5, "k")

    def test_bool(self):
        with pytest.raises(ValueError, match="positive integer"):
            _validate_positive_int(True, "k")

    def test_string(self):
        with pytest.raises(ValueError, match="positive integer"):
            _validate_positive_int("5", "k")


class TestBuildTraverseValidation:
    def test_negative_max_depth_raises(self):
        opts = TraverseOptions(max_depth=-1)
        with pytest.raises(ValueError, match="max_depth"):
            build_traverse("follows", "users", 1, opts)

    def test_zero_max_depth_raises(self):
        opts = TraverseOptions(max_depth=0)
        with pytest.raises(ValueError, match="max_depth"):
            build_traverse("follows", "users", 1, opts)


class TestBuildNearestValidation:
    def test_negative_k_raises(self):
        opts = NearestOptions(k=-1)
        with pytest.raises(ValueError, match="k"):
            build_nearest("posts", "embedding", "[0.1]", opts)

    def test_zero_k_raises(self):
        opts = NearestOptions(k=0)
        with pytest.raises(ValueError, match="k"):
            build_nearest("posts", "embedding", "[0.1]", opts)

    def test_within_traverse(self):
        opts = NearestOptions(k=5, within_traverse="follows")
        q = build_nearest("posts", "embedding", "[0.1]", opts)
        assert 'WITHIN TRAVERSE "follows"' in q["text"]


# ---------------------------------------------------------------------------
# MATCH builder (new SELECT...FROM MATCH syntax)
# ---------------------------------------------------------------------------


class TestBuildMatch:
    def test_single_hop_new_syntax(self):
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT"),
            MatchNode("b", "users"),
        ]
        q = build_match(pattern, ["a", "b"])
        assert q["text"] == 'SELECT a, b FROM MATCH (a:"users")-[r:"follows"]->(b:"users")'
        assert q["values"] == []

    def test_multi_hop(self):
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r1", "follows", "OUT"),
            MatchNode("b", "users"),
            MatchEdge("r2", "likes", "OUT"),
            MatchNode("c", "posts"),
        ]
        q = build_match(pattern, ["a", "b", "c"])
        expected = 'SELECT a, b, c FROM MATCH (a:"users")-[r1:"follows"]->(b:"users")-[r2:"likes"]->(c:"posts")'
        assert q["text"] == expected

    def test_in_direction(self):
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "IN"),
            MatchNode("b", "users"),
        ]
        q = build_match(pattern, ["a"])
        assert '<-[r:"follows"]-' in q["text"]

    def test_both_direction(self):
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "friends", "BOTH"),
            MatchNode("b", "users"),
        ]
        q = build_match(pattern, ["a", "b"])
        assert '-[r:"friends"]-' in q["text"]
        assert "->" not in q["text"]
        assert "<-" not in q["text"]

    def test_with_where(self):
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT"),
            MatchNode("b", "users"),
        ]
        q = build_match(pattern, ["a"], where="a.age > 18")
        assert q["text"].endswith("WHERE a.age > 18")

    def test_empty_pattern_raises(self):
        with pytest.raises(ValueError, match="empty"):
            build_match([], ["a"])

    def test_sql_injection_in_identifiers(self):
        pattern = [
            MatchNode("a", 'users"; DROP TABLE x; --'),
            MatchEdge("r", "follows", "OUT"),
            MatchNode("b", "users"),
        ]
        q = build_match(pattern, ["a", "b"])
        assert '"users""; DROP TABLE x; --"' in q["text"]


# ---------------------------------------------------------------------------
# MATCH builder — hop quantifiers
# ---------------------------------------------------------------------------


class TestBuildMatchQuantifiers:
    def test_quantifier_range(self):
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT", quantifier="{2,5}"),
            MatchNode("b", "users"),
        ]
        q = build_match(pattern, ["a", "b"])
        assert '-[r:"follows"]->{2,5}' in q["text"]

    def test_quantifier_plus(self):
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT", quantifier="+"),
            MatchNode("b", "users"),
        ]
        q = build_match(pattern, ["a", "b"])
        assert '-[r:"follows"]->+' in q["text"]

    def test_quantifier_star(self):
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT", quantifier="*"),
            MatchNode("b", "users"),
        ]
        q = build_match(pattern, ["a", "b"])
        assert '-[r:"follows"]->*' in q["text"]

    def test_quantifier_in_direction(self):
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "IN", quantifier="{1,3}"),
            MatchNode("b", "users"),
        ]
        q = build_match(pattern, ["a", "b"])
        assert '<-[r:"follows"]-{1,3}' in q["text"]

    def test_quantifier_both_direction(self):
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "BOTH", quantifier="*"),
            MatchNode("b", "users"),
        ]
        q = build_match(pattern, ["a", "b"])
        assert '-[r:"follows"]-*' in q["text"]


# ---------------------------------------------------------------------------
# MATCH builder — cross-edge-type patterns
# ---------------------------------------------------------------------------


class TestBuildMatchCrossEdge:
    def test_two_edge_types(self):
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT", edge_types=["follows", "likes"]),
            MatchNode("b", "users"),
        ]
        q = build_match(pattern, ["a", "b"])
        assert '-[r:"follows"|"likes"]->' in q["text"]

    def test_three_edge_types(self):
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT", edge_types=["follows", "likes", "blocks"]),
            MatchNode("b", "users"),
        ]
        q = build_match(pattern, ["a", "b"])
        assert '-[r:"follows"|"likes"|"blocks"]->' in q["text"]

    def test_cross_edge_with_quantifier(self):
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT", quantifier="{1,3}", edge_types=["follows", "likes"]),
            MatchNode("b", "users"),
        ]
        q = build_match(pattern, ["a", "b"])
        assert '-[r:"follows"|"likes"]->{1,3}' in q["text"]

    def test_edge_types_overrides_edge_type(self):
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "IGNORED", "OUT", edge_types=["real_edge"]),
            MatchNode("b", "users"),
        ]
        q = build_match(pattern, ["a", "b"])
        assert '"IGNORED"' not in q["text"]
        assert '"real_edge"' in q["text"]


# ---------------------------------------------------------------------------
# MATCH builder — legacy backward compatibility
# ---------------------------------------------------------------------------


class TestBuildMatchLegacy:
    def test_legacy_syntax(self):
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT"),
            MatchNode("b", "users"),
        ]
        q = build_match(pattern, ["a", "b"], legacy_syntax=True)
        assert q["text"] == 'MATCH (a:"users")-[r:"follows"]->(b:"users") RETURN a, b'
        assert q["values"] == []

    def test_legacy_syntax_with_where(self):
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT"),
            MatchNode("b", "users"),
        ]
        q = build_match(pattern, ["a"], where="a.age > 18", legacy_syntax=True)
        assert q["text"].startswith("MATCH ")
        assert q["text"].endswith("WHERE a.age > 18")

    def test_legacy_with_quantifiers(self):
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT", quantifier="{2,5}"),
            MatchNode("b", "users"),
        ]
        q = build_match(pattern, ["a", "b"], legacy_syntax=True)
        assert q["text"].startswith("MATCH ")
        assert '-[r:"follows"]->{2,5}' in q["text"]
        assert "RETURN a, b" in q["text"]


# ---------------------------------------------------------------------------
# SHORTEST PATH builder (SELECT composability)
# ---------------------------------------------------------------------------


class TestBuildShortestPath:
    def test_basic_new_syntax(self):
        q = build_shortest_path("follows", "users", 1, "users", 2)
        assert q["text"] == 'SELECT * FROM SHORTEST PATH FROM "users"($1) TO "users"($2) VIA "follows"'
        assert q["values"] == [1, 2]

    def test_custom_select(self):
        q = build_shortest_path("follows", "users", 1, "users", 2, select="path, cost")
        assert q["text"].startswith("SELECT path, cost FROM SHORTEST PATH")

    def test_with_direction(self):
        q = build_shortest_path("follows", "users", 1, "users", 2, direction="OUT")
        assert "DIRECTION OUT" in q["text"]
        assert q["text"].startswith("SELECT * FROM")

    def test_with_max_depth(self):
        q = build_shortest_path("follows", "users", 1, "users", 2, max_depth=5)
        assert "MAX_DEPTH 5" in q["text"]

    def test_negative_max_depth_raises(self):
        with pytest.raises(ValueError, match="max_depth"):
            build_shortest_path("follows", "users", 1, "users", 2, max_depth=-1)

    def test_different_tables(self):
        q = build_shortest_path("works_at", "users", 1, "companies", 5)
        assert '"users"($1)' in q["text"]
        assert '"companies"($2)' in q["text"]

    def test_legacy_syntax(self):
        q = build_shortest_path("follows", "users", 1, "users", 2, legacy_syntax=True)
        assert q["text"] == 'SHORTEST PATH FROM "users"($1) TO "users"($2) VIA "follows"'
        assert not q["text"].startswith("SELECT")

    def test_legacy_with_options(self):
        q = build_shortest_path(
            "follows", "users", 1, "users", 2,
            direction="OUT", max_depth=5, legacy_syntax=True,
        )
        assert q["text"].startswith("SHORTEST PATH FROM")
        assert "DIRECTION OUT" in q["text"]
        assert "MAX_DEPTH 5" in q["text"]


# ---------------------------------------------------------------------------
# Path selector builder (build_shortest_match)
# ---------------------------------------------------------------------------


class TestBuildShortestMatch:
    def test_any_shortest(self):
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT"),
            MatchNode("b", "users"),
        ]
        q = build_shortest_match(pattern, ["a", "b"], selector="ANY SHORTEST")
        assert q["text"] == 'SELECT a, b FROM MATCH ANY SHORTEST (a:"users")-[r:"follows"]->(b:"users")'

    def test_all_shortest(self):
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT"),
            MatchNode("b", "users"),
        ]
        q = build_shortest_match(pattern, ["a", "b"], selector="ALL SHORTEST")
        assert "MATCH ALL SHORTEST" in q["text"]

    def test_shortest_k(self):
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT"),
            MatchNode("b", "users"),
        ]
        q = build_shortest_match(pattern, ["a", "b"], selector="SHORTEST", k=3)
        assert "MATCH SHORTEST 3" in q["text"]

    def test_shortest_k_missing_raises(self):
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT"),
            MatchNode("b", "users"),
        ]
        with pytest.raises(ValueError, match="k is required"):
            build_shortest_match(pattern, ["a", "b"], selector="SHORTEST")

    def test_invalid_k_raises(self):
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT"),
            MatchNode("b", "users"),
        ]
        with pytest.raises(ValueError, match="positive integer"):
            build_shortest_match(pattern, ["a", "b"], selector="SHORTEST", k=-1)

    def test_invalid_selector_raises(self):
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT"),
            MatchNode("b", "users"),
        ]
        with pytest.raises(ValueError, match="selector"):
            build_shortest_match(pattern, ["a", "b"], selector="BOGUS")

    def test_weight_clause(self):
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT"),
            MatchNode("b", "users"),
        ]
        q = build_shortest_match(
            pattern, ["a", "b"],
            selector="ANY SHORTEST",
            weight="r.cost",
        )
        assert q["text"].endswith("WEIGHT r.cost")

    def test_with_where(self):
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT"),
            MatchNode("b", "users"),
        ]
        q = build_shortest_match(
            pattern, ["a", "b"],
            selector="ANY SHORTEST",
            where="a.active = true",
        )
        assert q["text"].endswith("WHERE a.active = true")

    def test_weight_and_where(self):
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT"),
            MatchNode("b", "users"),
        ]
        q = build_shortest_match(
            pattern, ["a", "b"],
            selector="ANY SHORTEST",
            weight="r.cost",
            where="a.active = true",
        )
        assert "WEIGHT r.cost" in q["text"]
        assert q["text"].endswith("WHERE a.active = true")

    def test_empty_pattern_raises(self):
        with pytest.raises(ValueError, match="empty"):
            build_shortest_match([], ["a"], selector="ANY SHORTEST")

    def test_default_selector_is_any_shortest(self):
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT"),
            MatchNode("b", "users"),
        ]
        q = build_shortest_match(pattern, ["a", "b"])
        assert "MATCH ANY SHORTEST" in q["text"]

    def test_case_insensitive_selector(self):
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT"),
            MatchNode("b", "users"),
        ]
        q = build_shortest_match(pattern, ["a", "b"], selector="any shortest")
        assert "MATCH ANY SHORTEST" in q["text"]
