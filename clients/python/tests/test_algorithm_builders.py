"""Tests for graph algorithm query builders (GDB-491)."""

from __future__ import annotations

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


class TestBuildPagerank:
    def test_defaults(self):
        q = build_pagerank("knows")
        assert q["text"] == "SELECT * FROM pagerank($1, $2, $3)"
        assert q["values"] == ["knows", 0.85, 20]

    def test_custom_params(self):
        q = build_pagerank("follows", damping=0.9, iterations=50)
        assert q["text"] == "SELECT * FROM pagerank($1, $2, $3)"
        assert q["values"] == ["follows", 0.9, 50]

    def test_custom_select(self):
        q = build_pagerank("knows", select=["node_id", "score"])
        assert q["text"] == 'SELECT "node_id", "score" FROM pagerank($1, $2, $3)'

    def test_damping_int_coerced_to_float(self):
        # An int in (0, 1) is impossible, but check basic non-bool int handling.
        # Using a fractional value via int rejection isn't applicable here,
        # so confirm float coercion with a float input.
        q = build_pagerank("knows", damping=0.5)
        assert q["values"][1] == 0.5
        assert isinstance(q["values"][1], float)

    def test_invalid_edge_type_empty(self):
        with pytest.raises(ValueError, match="edge_type"):
            build_pagerank("")

    def test_invalid_edge_type_type(self):
        with pytest.raises(ValueError, match="edge_type"):
            build_pagerank(123)  # type: ignore[arg-type]

    @pytest.mark.parametrize("damping", [0.0, 1.0, -0.1, 1.1, 2.0])
    def test_invalid_damping(self, damping):
        with pytest.raises(ValueError, match="damping"):
            build_pagerank("knows", damping=damping)

    def test_invalid_damping_bool(self):
        with pytest.raises(ValueError, match="damping"):
            build_pagerank("knows", damping=True)  # type: ignore[arg-type]

    @pytest.mark.parametrize("iterations", [0, -1, -100])
    def test_invalid_iterations(self, iterations):
        with pytest.raises(ValueError, match="iterations"):
            build_pagerank("knows", iterations=iterations)

    def test_invalid_iterations_type(self):
        with pytest.raises(ValueError, match="iterations"):
            build_pagerank("knows", iterations=1.5)  # type: ignore[arg-type]

    def test_invalid_iterations_bool(self):
        with pytest.raises(ValueError, match="iterations"):
            build_pagerank("knows", iterations=True)


class TestBuildBetweennessCentrality:
    def test_basic(self):
        q = build_betweenness_centrality("knows")
        assert q["text"] == "SELECT * FROM betweenness_centrality($1)"
        assert q["values"] == ["knows"]

    def test_custom_select(self):
        q = build_betweenness_centrality("knows", select=["node_id"])
        assert q["text"] == 'SELECT "node_id" FROM betweenness_centrality($1)'

    def test_invalid_edge_type(self):
        with pytest.raises(ValueError, match="edge_type"):
            build_betweenness_centrality("")


class TestBuildConnectedComponents:
    def test_basic(self):
        q = build_connected_components("knows")
        assert q["text"] == "SELECT * FROM connected_components($1)"
        assert q["values"] == ["knows"]

    def test_invalid_edge_type(self):
        with pytest.raises(ValueError, match="edge_type"):
            build_connected_components("")


class TestBuildLouvain:
    def test_defaults(self):
        q = build_louvain("knows")
        assert q["text"] == "SELECT * FROM louvain($1, $2)"
        assert q["values"] == ["knows", 1.0]

    def test_custom_resolution(self):
        q = build_louvain("knows", resolution=2.5)
        assert q["values"] == ["knows", 2.5]

    def test_invalid_edge_type(self):
        with pytest.raises(ValueError, match="edge_type"):
            build_louvain("")

    @pytest.mark.parametrize("resolution", [0.0, -1.0, -0.5])
    def test_invalid_resolution(self, resolution):
        with pytest.raises(ValueError, match="resolution"):
            build_louvain("knows", resolution=resolution)

    def test_invalid_resolution_type(self):
        with pytest.raises(ValueError, match="resolution"):
            build_louvain("knows", resolution="big")  # type: ignore[arg-type]

    def test_invalid_resolution_bool(self):
        with pytest.raises(ValueError, match="resolution"):
            build_louvain("knows", resolution=True)  # type: ignore[arg-type]


class TestBuildDegreeCentrality:
    def test_default_direction(self):
        q = build_degree_centrality("knows")
        assert q["text"] == "SELECT * FROM degree_centrality($1, $2)"
        assert q["values"] == ["knows", "BOTH"]

    @pytest.mark.parametrize("direction", ["IN", "OUT", "BOTH", "in", "out", "both"])
    def test_valid_directions(self, direction):
        q = build_degree_centrality("knows", direction=direction)
        assert q["values"][1] == direction.upper()

    def test_invalid_direction(self):
        with pytest.raises(ValueError, match="direction"):
            build_degree_centrality("knows", direction="UPWARD")

    def test_invalid_direction_empty(self):
        with pytest.raises(ValueError, match="direction"):
            build_degree_centrality("knows", direction="")

    def test_invalid_direction_type(self):
        with pytest.raises(ValueError, match="direction"):
            build_degree_centrality("knows", direction=1)  # type: ignore[arg-type]

    def test_invalid_edge_type(self):
        with pytest.raises(ValueError, match="edge_type"):
            build_degree_centrality("")


class TestBuildClosenessCentrality:
    def test_default_variant(self):
        q = build_closeness_centrality("knows")
        assert q["text"] == "SELECT * FROM closeness_centrality($1, $2)"
        assert q["values"] == ["knows", "STANDARD"]

    @pytest.mark.parametrize(
        "variant",
        ["STANDARD", "WASSERMAN_FAUST", "HARMONIC", "wasserman_faust"],
    )
    def test_valid_variants(self, variant):
        q = build_closeness_centrality("knows", variant=variant)
        assert q["values"][1] == variant.upper()

    def test_invalid_variant(self):
        with pytest.raises(ValueError, match="variant"):
            build_closeness_centrality("knows", variant="GEOMETRIC")

    def test_invalid_variant_empty(self):
        with pytest.raises(ValueError, match="variant"):
            build_closeness_centrality("knows", variant="")

    def test_invalid_variant_type(self):
        with pytest.raises(ValueError, match="variant"):
            build_closeness_centrality("knows", variant=None)  # type: ignore[arg-type]


class TestBuildEigenvectorCentrality:
    def test_defaults(self):
        q = build_eigenvector_centrality("knows")
        assert q["text"] == "SELECT * FROM eigenvector_centrality($1, $2, $3)"
        assert q["values"] == ["knows", 100, 1e-6]

    def test_custom_params(self):
        q = build_eigenvector_centrality("knows", iterations=50, tolerance=1e-4)
        assert q["values"] == ["knows", 50, 1e-4]

    def test_invalid_iterations(self):
        with pytest.raises(ValueError, match="iterations"):
            build_eigenvector_centrality("knows", iterations=0)

    def test_invalid_iterations_type(self):
        with pytest.raises(ValueError, match="iterations"):
            build_eigenvector_centrality("knows", iterations=1.0)  # type: ignore[arg-type]

    @pytest.mark.parametrize("tolerance", [0.0, -1e-6, -1.0])
    def test_invalid_tolerance(self, tolerance):
        with pytest.raises(ValueError, match="tolerance"):
            build_eigenvector_centrality("knows", tolerance=tolerance)

    def test_invalid_tolerance_type(self):
        with pytest.raises(ValueError, match="tolerance"):
            build_eigenvector_centrality("knows", tolerance="tiny")  # type: ignore[arg-type]

    def test_invalid_tolerance_bool(self):
        with pytest.raises(ValueError, match="tolerance"):
            build_eigenvector_centrality("knows", tolerance=True)  # type: ignore[arg-type]


class TestBuildHarmonicCentrality:
    def test_basic(self):
        q = build_harmonic_centrality("knows")
        assert q["text"] == "SELECT * FROM harmonic_centrality($1)"
        assert q["values"] == ["knows"]

    def test_invalid_edge_type(self):
        with pytest.raises(ValueError, match="edge_type"):
            build_harmonic_centrality("")


class TestBuildClusteringCoefficient:
    def test_basic(self):
        q = build_clustering_coefficient("knows")
        assert q["text"] == "SELECT * FROM clustering_coefficient($1)"
        assert q["values"] == ["knows"]

    def test_invalid_edge_type(self):
        with pytest.raises(ValueError, match="edge_type"):
            build_clustering_coefficient("")


class TestBuildTriangleCount:
    def test_basic(self):
        q = build_triangle_count("knows")
        assert q["text"] == "SELECT * FROM triangle_count($1)"
        assert q["values"] == ["knows"]

    def test_invalid_edge_type(self):
        with pytest.raises(ValueError, match="edge_type"):
            build_triangle_count("")


class TestBuildStronglyConnectedComponents:
    def test_basic(self):
        q = build_strongly_connected_components("follows")
        assert q["text"] == "SELECT * FROM strongly_connected_components($1)"
        assert q["values"] == ["follows"]

    def test_custom_select(self):
        q = build_strongly_connected_components("follows", select=["component_id"])
        assert q["text"] == (
            'SELECT "component_id" FROM strongly_connected_components($1)'
        )

    def test_invalid_edge_type(self):
        with pytest.raises(ValueError, match="edge_type"):
            build_strongly_connected_components("")


class TestAlgorithmBuildersExportedFromPackage:
    """Smoke test: every algorithm builder is importable from the top-level package."""

    def test_exports(self):
        import giodb

        for name in [
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
        ]:
            assert hasattr(giodb, name), f"giodb.{name} is not exported"
            assert name in giodb.__all__, f"{name} missing from __all__"
