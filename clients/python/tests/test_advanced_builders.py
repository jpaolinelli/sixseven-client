"""Tests for advanced query builders (MATCH, SHORTEST PATH, validation)."""

from __future__ import annotations

import pytest

from giodb.query_builders import (
    build_match,
    build_nearest,
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


class TestBuildMatch:
    def test_single_hop(self):
        pattern = [
            MatchNode("a", "users"),
            MatchEdge("r", "follows", "OUT"),
            MatchNode("b", "users"),
        ]
        q = build_match(pattern, ["a", "b"])
        assert q["text"] == 'MATCH (a:"users")-[r:"follows"]->(b:"users") RETURN a, b'
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
        expected = 'MATCH (a:"users")-[r1:"follows"]->(b:"users")-[r2:"likes"]->(c:"posts") RETURN a, b, c'
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


class TestBuildShortestPath:
    def test_basic(self):
        q = build_shortest_path("follows", "users", 1, "users", 2)
        assert q["text"] == 'SHORTEST PATH FROM "users"($1) TO "users"($2) VIA "follows"'
        assert q["values"] == [1, 2]

    def test_with_direction(self):
        q = build_shortest_path("follows", "users", 1, "users", 2, direction="OUT")
        assert "DIRECTION OUT" in q["text"]

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
