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
    """The ``select`` keyword arg is interpolated raw into SQL — every
    builder is vulnerable to producing arbitrary SQL fragments via it.

    These tests *document* current behaviour and assert that the raw
    interpolation happens. They are not marked xfail because today's
    implementation passes them; the parametrized test that *demands*
    rejection of injection-shaped values IS marked xfail until the bug
    is fixed.
    """

    @pytest.mark.parametrize("builder", ALL_BUILDERS)
    def test_select_is_interpolated_raw_today(self, builder):
        # Demonstrates the current behaviour: arbitrary text appears in
        # the SELECT clause, including a stacked statement.
        payload = "*; DROP TABLE users;--"
        q = builder("knows", select=payload)
        assert payload in q["text"], (
            "select payload should appear raw in current implementation"
        )

    @pytest.mark.parametrize("builder", ALL_BUILDERS)
    @pytest.mark.xfail(
        reason="Bug: select is interpolated without validation; allows SQL injection",
        strict=True,
    )
    def test_select_should_reject_stacked_statements(self, builder):
        with pytest.raises((ValueError, TypeError)):
            builder("knows", select="*; DROP TABLE users;--")

    @pytest.mark.parametrize("builder", ALL_BUILDERS)
    @pytest.mark.xfail(
        reason="Bug: select accepts empty string and produces malformed 'SELECT  FROM ...' SQL",
        strict=True,
    )
    def test_select_empty_string_rejected(self, builder):
        with pytest.raises(ValueError):
            builder("knows", select="")

    @pytest.mark.parametrize("builder", ALL_BUILDERS)
    def test_select_empty_string_today_produces_malformed_sql(self, builder):
        # Today, an empty select silently produces a broken statement.
        q = builder("knows", select="")
        assert "SELECT  FROM" in q["text"]


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
