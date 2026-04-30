"""QA adversarial tests for GDB-491 — Python algorithm query builders.

Adversarial categories:
  * SQL injection via the ``select`` parameter (raw interpolation, no validation).
  * Numeric edge cases: NaN, +inf, -inf, negative zero.
  * Boolean-as-int leakage (Python ``bool`` is a subclass of ``int``).
  * Whitespace-only / control-char / unicode-fold ``edge_type`` values.
  * Case sensitivity & whitespace handling on enum params.
  * Parameter binding consistency ($1, $2, ... order matches values list).
  * Type coercion surprises.

Each test asserts a *concrete* expected behaviour. Tests that currently
demonstrate bugs are explicitly marked as expected-failures (``xfail``)
with a reason pointing at the relevant Bug ticket so they will flip to
``xpass`` once the bug is fixed.
"""

from __future__ import annotations

import re

import pytest

from giodb.query_builders import (
    build_betweenness_centrality,
    build_closeness_centrality,
    build_clustering_coefficient,
    build_connected_components,
    build_degree_centrality,
    build_eigenvector_centrality,
    build_harmonic_centrality,
    build_louvain,
    build_pagerank,
    build_strongly_connected_components,
    build_triangle_count,
)


ALL_SINGLE_ARG_BUILDERS = [
    build_betweenness_centrality,
    build_connected_components,
    build_harmonic_centrality,
    build_clustering_coefficient,
    build_triangle_count,
    build_strongly_connected_components,
]

ALL_BUILDERS = ALL_SINGLE_ARG_BUILDERS + [
    build_pagerank,
    build_louvain,
    build_degree_centrality,
    build_closeness_centrality,
    build_eigenvector_centrality,
]


# ---------------------------------------------------------------------------
# 1. SQL injection / unvalidated `select`
# ---------------------------------------------------------------------------


class TestSelectInjection:
    """The ``select`` keyword arg used to be interpolated raw into SQL,
    making every builder vulnerable to SQL injection. GDB-662 fixed this
    by requiring ``select`` to be either ``"*"`` (default) or a
    ``Sequence[str]`` of validated column identifiers — raw strings are
    rejected outright.
    """

    @pytest.mark.parametrize("builder", ALL_BUILDERS)
    def test_select_raw_string_rejected(self, builder):
        # Any raw string other than "*" must be rejected after GDB-662.
        with pytest.raises(ValueError, match="select"):
            builder("knows", select="node_id, score")

    @pytest.mark.parametrize("builder", ALL_BUILDERS)
    def test_select_should_reject_stacked_statements(self, builder):
        with pytest.raises((ValueError, TypeError)):
            builder("knows", select="*; DROP TABLE users;--")

    @pytest.mark.parametrize("builder", ALL_BUILDERS)
    def test_select_should_reject_stacked_statements_in_list(self, builder):
        with pytest.raises(ValueError, match="select"):
            builder("knows", select=["node_id; DROP TABLE users;--"])

    @pytest.mark.parametrize("builder", ALL_BUILDERS)
    def test_select_should_reject_comment_payload(self, builder):
        with pytest.raises(ValueError, match="select"):
            builder("knows", select=["node_id /* comment */"])

    @pytest.mark.parametrize("builder", ALL_BUILDERS)
    def test_select_should_reject_union_select(self, builder):
        with pytest.raises(ValueError, match="select"):
            builder("knows", select="* UNION SELECT password FROM users")

    @pytest.mark.parametrize("builder", ALL_BUILDERS)
    def test_select_empty_string_rejected(self, builder):
        with pytest.raises(ValueError, match="select"):
            builder("knows", select="")

    @pytest.mark.parametrize("builder", ALL_BUILDERS)
    def test_select_empty_list_rejected(self, builder):
        with pytest.raises(ValueError, match="select"):
            builder("knows", select=[])

    @pytest.mark.parametrize("builder", ALL_BUILDERS)
    @pytest.mark.parametrize(
        "bad_identifier",
        [
            "1node_id",        # leading digit
            "node-id",         # hyphen
            "node id",         # space
            "node;id",         # semicolon
            "node/*x*/id",     # comment characters
            "node--id",        # SQL comment
            '"node_id"',       # already-quoted
            "",                # empty identifier
            "node_id, score",  # comma-joined string passed inside list
        ],
    )
    def test_select_should_reject_malformed_identifier(
        self, builder, bad_identifier
    ):
        with pytest.raises(ValueError, match="select"):
            builder("knows", select=[bad_identifier])

    @pytest.mark.parametrize("builder", ALL_BUILDERS)
    def test_select_should_reject_non_string_identifier(self, builder):
        with pytest.raises(ValueError, match="select"):
            builder("knows", select=[123])  # type: ignore[list-item]

    @pytest.mark.parametrize("builder", ALL_BUILDERS)
    def test_select_should_reject_non_sequence(self, builder):
        with pytest.raises(ValueError, match="select"):
            builder("knows", select=42)  # type: ignore[arg-type]

    @pytest.mark.parametrize("builder", ALL_BUILDERS)
    def test_select_star_default_unchanged(self, builder):
        # Default "*" continues to work as before.
        q = builder("knows")
        assert q["text"].startswith("SELECT * FROM ")

    @pytest.mark.parametrize("builder", ALL_BUILDERS)
    def test_select_none_treated_as_star(self, builder):
        q = builder("knows", select=None)
        assert q["text"].startswith("SELECT * FROM ")

    @pytest.mark.parametrize("builder", ALL_BUILDERS)
    def test_select_single_valid_column(self, builder):
        q = builder("knows", select=["node_id"])
        assert q["text"].startswith('SELECT "node_id" FROM ')

    @pytest.mark.parametrize("builder", ALL_BUILDERS)
    def test_select_multiple_valid_columns(self, builder):
        q = builder("knows", select=["node_id", "score", "rank"])
        assert q["text"].startswith(
            'SELECT "node_id", "score", "rank" FROM '
        )

    @pytest.mark.parametrize("builder", ALL_BUILDERS)
    def test_select_tuple_accepted(self, builder):
        # Any Sequence[str] is fine, not just lists.
        q = builder("knows", select=("a", "b"))
        assert q["text"].startswith('SELECT "a", "b" FROM ')


# ---------------------------------------------------------------------------
# 2. NaN / Infinity in numeric validators
# ---------------------------------------------------------------------------


class TestNumericEdgeCases:
    # --- damping (range-validated) — already correctly rejects nan/inf
    def test_pagerank_nan_damping_rejected(self):
        with pytest.raises(ValueError, match="damping"):
            build_pagerank("knows", damping=float("nan"))

    def test_pagerank_inf_damping_rejected(self):
        with pytest.raises(ValueError, match="damping"):
            build_pagerank("knows", damping=float("inf"))

    def test_pagerank_neg_inf_damping_rejected(self):
        with pytest.raises(ValueError, match="damping"):
            build_pagerank("knows", damping=float("-inf"))

    def test_pagerank_negative_zero_damping_rejected(self):
        # -0.0 is not in the open interval (0, 1).
        with pytest.raises(ValueError, match="damping"):
            build_pagerank("knows", damping=-0.0)

    # --- _validate_positive_number (resolution, tolerance) — has gaps
    @pytest.mark.xfail(
        reason="Bug: _validate_positive_number accepts NaN for louvain resolution",
        strict=True,
    )
    def test_louvain_nan_resolution_rejected(self):
        with pytest.raises(ValueError, match="resolution"):
            build_louvain("knows", resolution=float("nan"))

    @pytest.mark.xfail(
        reason="Bug: _validate_positive_number accepts +inf for louvain resolution",
        strict=True,
    )
    def test_louvain_inf_resolution_rejected(self):
        with pytest.raises(ValueError, match="resolution"):
            build_louvain("knows", resolution=float("inf"))

    @pytest.mark.xfail(
        reason="Bug: _validate_positive_number accepts NaN for eigenvector tolerance",
        strict=True,
    )
    def test_eigenvector_nan_tolerance_rejected(self):
        with pytest.raises(ValueError, match="tolerance"):
            build_eigenvector_centrality("knows", tolerance=float("nan"))

    @pytest.mark.xfail(
        reason="Bug: _validate_positive_number accepts +inf for eigenvector tolerance",
        strict=True,
    )
    def test_eigenvector_inf_tolerance_rejected(self):
        with pytest.raises(ValueError, match="tolerance"):
            build_eigenvector_centrality("knows", tolerance=float("inf"))

    def test_louvain_neg_inf_resolution_rejected(self):
        # -inf <= 0, so _validate_positive_number's existing check catches it.
        with pytest.raises(ValueError, match="resolution"):
            build_louvain("knows", resolution=float("-inf"))


# ---------------------------------------------------------------------------
# 3. Boolean-as-int leakage
# ---------------------------------------------------------------------------


class TestBooleanLeakage:
    def test_pagerank_iterations_true_rejected(self):
        with pytest.raises(ValueError, match="iterations"):
            build_pagerank("knows", iterations=True)

    def test_pagerank_iterations_false_rejected(self):
        with pytest.raises(ValueError, match="iterations"):
            build_pagerank("knows", iterations=False)

    def test_louvain_resolution_true_rejected(self):
        with pytest.raises(ValueError, match="resolution"):
            build_louvain("knows", resolution=True)

    def test_eigenvector_iterations_true_rejected(self):
        with pytest.raises(ValueError, match="iterations"):
            build_eigenvector_centrality("knows", iterations=True)

    def test_eigenvector_tolerance_true_rejected(self):
        with pytest.raises(ValueError, match="tolerance"):
            build_eigenvector_centrality("knows", tolerance=True)

    def test_pagerank_damping_true_rejected(self):
        with pytest.raises(ValueError, match="damping"):
            build_pagerank("knows", damping=True)


# ---------------------------------------------------------------------------
# 4. edge_type adversarial values
# ---------------------------------------------------------------------------


class TestEdgeTypeAdversarial:
    @pytest.mark.parametrize("builder", ALL_BUILDERS)
    def test_edge_type_none_rejected(self, builder):
        with pytest.raises(ValueError, match="edge_type"):
            builder(None)

    @pytest.mark.parametrize("builder", ALL_BUILDERS)
    def test_edge_type_int_rejected(self, builder):
        with pytest.raises(ValueError, match="edge_type"):
            builder(42)

    @pytest.mark.parametrize("builder", ALL_BUILDERS)
    def test_edge_type_bytes_rejected(self, builder):
        with pytest.raises(ValueError, match="edge_type"):
            builder(b"knows")

    @pytest.mark.parametrize("builder", ALL_BUILDERS)
    def test_edge_type_list_rejected(self, builder):
        with pytest.raises(ValueError, match="edge_type"):
            builder(["knows"])

    @pytest.mark.parametrize("builder", ALL_BUILDERS)
    def test_edge_type_unicode_passes_through_as_param(self, builder):
        # Unicode edge_type should pass through as a parameter value.
        q = builder("knöws_éπ")
        assert q["values"][0] == "knöws_éπ"

    @pytest.mark.parametrize(
        "value", ["   ", "\t", "\n", " \t\n "],
    )
    @pytest.mark.parametrize("builder", ALL_BUILDERS)
    @pytest.mark.xfail(
        reason="Bug: edge_type accepts whitespace-only strings (only checks `if not value`)",
        strict=True,
    )
    def test_edge_type_whitespace_only_rejected(self, builder, value):
        with pytest.raises(ValueError, match="edge_type"):
            builder(value)


# ---------------------------------------------------------------------------
# 5. Enum parameter handling — case + whitespace
# ---------------------------------------------------------------------------


class TestEnumHandling:
    def test_degree_direction_lowercase_normalized(self):
        q = build_degree_centrality("knows", direction="in")
        assert q["values"] == ["knows", "IN"]

    def test_degree_direction_padded_rejected(self):
        # Surrounding whitespace is NOT stripped — strict rejection is OK.
        with pytest.raises(ValueError, match="direction"):
            build_degree_centrality("knows", direction="  IN  ")

    def test_closeness_variant_mixed_case_normalized(self):
        q = build_closeness_centrality("knows", variant="Wasserman_Faust")
        assert q["values"] == ["knows", "WASSERMAN_FAUST"]

    def test_closeness_variant_bom_prefixed_rejected(self):
        # A BOM-prefixed variant must NOT silently match — uppercase
        # normalization is the only transformation; no Unicode stripping.
        with pytest.raises(ValueError, match="variant"):
            build_closeness_centrality("knows", variant="﻿STANDARD")

    def test_degree_direction_int_rejected(self):
        with pytest.raises(ValueError, match="direction"):
            build_degree_centrality("knows", direction=1)

    def test_closeness_variant_none_rejected(self):
        with pytest.raises(ValueError, match="variant"):
            build_closeness_centrality("knows", variant=None)


# ---------------------------------------------------------------------------
# 6. Parameter binding consistency
# ---------------------------------------------------------------------------


class TestParameterBinding:
    """Generated SQL placeholder count must equal len(values), and the
    placeholders must be 1-indexed and contiguous: $1, $2, ... $N."""

    @pytest.mark.parametrize(
        "result",
        [
            build_pagerank("knows"),
            build_pagerank("knows", damping=0.5, iterations=10),
            build_louvain("knows"),
            build_louvain("knows", resolution=2.0),
            build_degree_centrality("knows"),
            build_degree_centrality("knows", direction="IN"),
            build_closeness_centrality("knows"),
            build_closeness_centrality("knows", variant="HARMONIC"),
            build_eigenvector_centrality("knows"),
            build_eigenvector_centrality("knows", iterations=50, tolerance=1e-4),
            build_betweenness_centrality("knows"),
            build_connected_components("knows"),
            build_harmonic_centrality("knows"),
            build_clustering_coefficient("knows"),
            build_triangle_count("knows"),
            build_strongly_connected_components("knows"),
        ],
    )
    def test_placeholder_count_matches_values(self, result):
        placeholders = re.findall(r"\$(\d+)", result["text"])
        assert len(placeholders) == len(result["values"])
        # 1-indexed contiguous
        assert [int(p) for p in placeholders] == list(
            range(1, len(result["values"]) + 1)
        )

    def test_pagerank_values_in_documented_order(self):
        q = build_pagerank("E", damping=0.5, iterations=7)
        # ($1=edge_type, $2=damping, $3=iterations)
        assert q["values"] == ["E", 0.5, 7]

    def test_louvain_values_in_documented_order(self):
        q = build_louvain("E", resolution=3.5)
        assert q["values"] == ["E", 3.5]

    def test_eigenvector_values_in_documented_order(self):
        q = build_eigenvector_centrality("E", iterations=11, tolerance=1e-3)
        assert q["values"] == ["E", 11, 1e-3]

    def test_degree_values_in_documented_order(self):
        q = build_degree_centrality("E", direction="OUT")
        assert q["values"] == ["E", "OUT"]

    def test_closeness_values_in_documented_order(self):
        q = build_closeness_centrality("E", variant="HARMONIC")
        assert q["values"] == ["E", "HARMONIC"]


# ---------------------------------------------------------------------------
# 7. Type coercion surprises
# ---------------------------------------------------------------------------


class TestTypeCoercion:
    def test_pagerank_string_damping_rejected(self):
        with pytest.raises(ValueError, match="damping"):
            build_pagerank("knows", damping="0.5")

    def test_pagerank_string_iterations_rejected(self):
        with pytest.raises(ValueError, match="iterations"):
            build_pagerank("knows", iterations="20")

    def test_louvain_string_resolution_rejected(self):
        with pytest.raises(ValueError, match="resolution"):
            build_louvain("knows", resolution="1.0")

    def test_eigenvector_float_iterations_rejected(self):
        with pytest.raises(ValueError, match="iterations"):
            build_eigenvector_centrality("knows", iterations=100.0)

    def test_louvain_int_resolution_kept_as_float(self):
        # int resolution should be accepted and serialized as float.
        q = build_louvain("knows", resolution=2)
        assert q["values"][1] == 2.0
        assert isinstance(q["values"][1], float)

    def test_pagerank_int_damping_rejected_due_to_range(self):
        # int 0 / 1 fail the open-interval range check; no other ints
        # land in (0, 1).
        with pytest.raises(ValueError, match="damping"):
            build_pagerank("knows", damping=0)
        with pytest.raises(ValueError, match="damping"):
            build_pagerank("knows", damping=1)


# ---------------------------------------------------------------------------
# 8. SQL shape — sanity for every algorithm
# ---------------------------------------------------------------------------


EXPECTED_SQL = {
    "build_pagerank": ("SELECT * FROM pagerank($1, $2, $3)", 3),
    "build_betweenness_centrality": (
        "SELECT * FROM betweenness_centrality($1)",
        1,
    ),
    "build_connected_components": (
        "SELECT * FROM connected_components($1)",
        1,
    ),
    "build_louvain": ("SELECT * FROM louvain($1, $2)", 2),
    "build_degree_centrality": (
        "SELECT * FROM degree_centrality($1, $2)",
        2,
    ),
    "build_closeness_centrality": (
        "SELECT * FROM closeness_centrality($1, $2)",
        2,
    ),
    "build_eigenvector_centrality": (
        "SELECT * FROM eigenvector_centrality($1, $2, $3)",
        3,
    ),
    "build_harmonic_centrality": (
        "SELECT * FROM harmonic_centrality($1)",
        1,
    ),
    "build_clustering_coefficient": (
        "SELECT * FROM clustering_coefficient($1)",
        1,
    ),
    "build_triangle_count": ("SELECT * FROM triangle_count($1)", 1),
    "build_strongly_connected_components": (
        "SELECT * FROM strongly_connected_components($1)",
        1,
    ),
}


@pytest.mark.parametrize(
    "builder",
    ALL_BUILDERS,
    ids=lambda b: b.__name__,
)
def test_default_sql_matches_documented_shape(builder):
    expected_text, expected_n_values = EXPECTED_SQL[builder.__name__]
    q = builder("knows")
    assert q["text"] == expected_text
    assert len(q["values"]) == expected_n_values
    assert q["values"][0] == "knows"
