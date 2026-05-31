"""Tests for GioDB-specific query builders."""

import numpy as np
import pytest

from giodb.query_builders import (
    build_link,
    build_nearest,
    build_traverse,
    build_unlink,
    escape_identifier,
)
from giodb.types import LinkOptions, NearestOptions, TraverseOptions


class TestEscapeIdentifier:
    def test_simple(self):
        assert escape_identifier("users") == '"users"'

    def test_with_double_quotes(self):
        assert escape_identifier('my"table') == '"my""table"'

    def test_sql_injection_attempt(self):
        result = escape_identifier('edge"; DROP TABLE users; --')
        assert result == '"edge""; DROP TABLE users; --"'

    def test_empty(self):
        assert escape_identifier("") == '""'

    def test_unicode(self):
        assert escape_identifier("tablé") == '"tablé"'


class TestBuildTraverse:
    def test_basic(self):
        q = build_traverse("follows", "users", 1)
        assert q["text"] == 'TRAVERSE "follows" FROM "users"($1)'
        assert q["values"] == [1]

    def test_with_direction(self):
        opts = TraverseOptions(direction="OUT")
        q = build_traverse("follows", "users", 1, opts)
        assert "DIRECTION OUT" in q["text"]

    def test_with_max_depth(self):
        opts = TraverseOptions(max_depth=3)
        q = build_traverse("follows", "users", 1, opts)
        assert "MAX_DEPTH 3" in q["text"]

    def test_with_mode(self):
        opts = TraverseOptions(mode="EDGES")
        q = build_traverse("follows", "users", 1, opts)
        assert "MODE EDGES" in q["text"]

    def test_with_where(self):
        opts = TraverseOptions(where="depth < 5")
        q = build_traverse("follows", "users", 1, opts)
        assert "WHERE depth < 5" in q["text"]

    def test_with_fetch(self):
        opts = TraverseOptions(fetch=True)
        q = build_traverse("follows", "users", 1, opts)
        assert q["text"].endswith("FETCH")

    def test_all_options(self):
        opts = TraverseOptions(
            direction="BOTH",
            max_depth=5,
            mode="NODES",
            fetch=True,
            where="active = true",
        )
        q = build_traverse("follows", "users", 42, opts)
        text = q["text"]
        assert text.startswith('TRAVERSE "follows" FROM "users"($1)')
        assert "DIRECTION BOTH" in text
        assert "MAX_DEPTH 5" in text
        assert "MODE NODES" in text
        assert "WHERE active = true" in text
        assert text.endswith("FETCH")
        assert q["values"] == [42]

    def test_sql_injection_in_edge_type(self):
        q = build_traverse('edge"; DROP TABLE users; --', "users", 1)
        assert '"edge""; DROP TABLE users; --"' in q["text"]


class TestBuildNearest:
    def test_basic_string_query(self):
        q = build_nearest("posts", "embedding", "[0.1,0.2,0.3]")
        assert q["text"] == 'NEAREST 10 FROM "posts"."embedding" TO $1'
        assert q["values"] == ["[0.1,0.2,0.3]"]

    def test_custom_k(self):
        opts = NearestOptions(k=5)
        q = build_nearest("posts", "embedding", "[0.1]", opts)
        assert "NEAREST 5" in q["text"]

    def test_with_metric(self):
        opts = NearestOptions(metric="L2")
        q = build_nearest("posts", "embedding", "[0.1]", opts)
        assert "USING L2" in q["text"]

    def test_with_where(self):
        opts = NearestOptions(where="active = true")
        q = build_nearest("posts", "embedding", "[0.1]", opts)
        assert "WHERE active = true" in q["text"]

    def test_numpy_array_query(self):
        arr = np.array([0.1, 0.2, 0.3], dtype=np.float32)
        q = build_nearest("posts", "embedding", arr)
        # Value should be serialized
        assert isinstance(q["values"][0], str)
        assert q["values"][0].startswith("[")

    def test_python_list_query(self):
        q = build_nearest("posts", "embedding", [0.1, 0.2, 0.3])
        assert isinstance(q["values"][0], str)


class TestBuildLink:
    def test_basic(self):
        q = build_link("follows", "users", 1, "users", 2)
        assert q["text"] == 'LINK "users"($1) TO "users"($2) VIA "follows"'
        assert q["values"] == [1, 2]

    def test_with_properties(self):
        opts = LinkOptions(properties={"score": 4.5, "since": "2024-01-01"})
        q = build_link("rated", "users", 1, "products", 5, opts)
        assert "$3" in q["text"]
        assert "$4" in q["text"]
        assert q["values"] == [1, 5, 4.5, "2024-01-01"]

    def test_no_properties(self):
        q = build_link("follows", "users", 1, "users", 2, LinkOptions())
        # Empty properties should not add parentheses
        assert "(" not in q["text"].split("VIA")[1]

    def test_sql_injection_in_property_key(self):
        opts = LinkOptions(properties={'key"; DROP TABLE x; --': "value"})
        q = build_link("edge", "a", 1, "b", 2, opts)
        assert '"key""; DROP TABLE x; --"' in q["text"]


class TestBuildUnlink:
    def test_basic(self):
        q = build_unlink("follows", "users", 1, "users", 2)
        assert q["text"] == 'UNLINK "users"($1) FROM "users"($2) VIA "follows"'
        assert q["values"] == [1, 2]

    def test_different_tables(self):
        q = build_unlink("rated", "users", 10, "products", 20)
        assert '"users"($1)' in q["text"]
        assert '"products"($2)' in q["text"]
        assert '"rated"' in q["text"]
        assert q["values"] == [10, 20]
