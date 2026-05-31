namespace SixSevenDB.Client.Tests;

/// <summary>
/// Tests for the 11 graph-algorithm query builders added by GDB-493.
///
/// Each algorithm has tests covering:
///   * happy path with default arguments
///   * happy path with custom arguments
///   * edge-type validation (null, empty, whitespace)
///   * numeric validation (NaN, +/- Infinity, out-of-range)
///   * enum coverage (where applicable)
/// </summary>
public class QueryBuildersAlgorithmsTests
{
    // -----------------------------------------------------------------------
    // PageRank
    // -----------------------------------------------------------------------

    [Fact]
    public void BuildPageRank_Defaults_ProducesExpectedSqlAndValues()
    {
        var q = QueryBuilder.BuildPageRank("knows");
        Assert.Equal("SELECT * FROM pagerank($1, $2, $3)", q.Text);
        Assert.Equal(3, q.Values.Length);
        Assert.Equal("knows", q.Values[0]);
        Assert.Equal(0.85, q.Values[1]);
        Assert.Equal(20, q.Values[2]);
    }

    [Fact]
    public void BuildPageRank_CustomParams_ProducesExpectedValues()
    {
        var q = QueryBuilder.BuildPageRank("follows", damping: 0.5, iterations: 50);
        Assert.Equal("SELECT * FROM pagerank($1, $2, $3)", q.Text);
        Assert.Equal("follows", q.Values[0]);
        Assert.Equal(0.5, q.Values[1]);
        Assert.Equal(50, q.Values[2]);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("\t\n")]
    public void BuildPageRank_RejectsBadEdgeType(string? edgeType)
    {
        Assert.Throws<ArgumentException>(() => QueryBuilder.BuildPageRank(edgeType!));
    }

    [Theory]
    [InlineData(0.0)]
    [InlineData(1.0)]
    [InlineData(-0.1)]
    [InlineData(1.5)]
    public void BuildPageRank_RejectsDampingOutsideOpenUnitInterval(double damping)
    {
        Assert.Throws<ArgumentOutOfRangeException>(
            () => QueryBuilder.BuildPageRank("knows", damping: damping));
    }

    [Theory]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    [InlineData(double.NegativeInfinity)]
    public void BuildPageRank_RejectsNonFiniteDamping(double damping)
    {
        Assert.Throws<ArgumentException>(
            () => QueryBuilder.BuildPageRank("knows", damping: damping));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(int.MinValue)]
    public void BuildPageRank_RejectsNonPositiveIterations(int iterations)
    {
        Assert.Throws<ArgumentOutOfRangeException>(
            () => QueryBuilder.BuildPageRank("knows", iterations: iterations));
    }

    // -----------------------------------------------------------------------
    // BetweennessCentrality
    // -----------------------------------------------------------------------

    [Fact]
    public void BuildBetweennessCentrality_HappyPath()
    {
        var q = QueryBuilder.BuildBetweennessCentrality("knows");
        Assert.Equal("SELECT * FROM betweenness_centrality($1)", q.Text);
        Assert.Single(q.Values);
        Assert.Equal("knows", q.Values[0]);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("  ")]
    public void BuildBetweennessCentrality_RejectsBadEdgeType(string? edgeType)
    {
        Assert.Throws<ArgumentException>(
            () => QueryBuilder.BuildBetweennessCentrality(edgeType!));
    }

    // -----------------------------------------------------------------------
    // ConnectedComponents
    // -----------------------------------------------------------------------

    [Fact]
    public void BuildConnectedComponents_HappyPath()
    {
        var q = QueryBuilder.BuildConnectedComponents("knows");
        Assert.Equal("SELECT * FROM connected_components($1)", q.Text);
        Assert.Single(q.Values);
        Assert.Equal("knows", q.Values[0]);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("  ")]
    public void BuildConnectedComponents_RejectsBadEdgeType(string? edgeType)
    {
        Assert.Throws<ArgumentException>(
            () => QueryBuilder.BuildConnectedComponents(edgeType!));
    }

    // -----------------------------------------------------------------------
    // Louvain
    // -----------------------------------------------------------------------

    [Fact]
    public void BuildLouvain_Defaults()
    {
        var q = QueryBuilder.BuildLouvain("knows");
        Assert.Equal("SELECT * FROM louvain($1, $2)", q.Text);
        Assert.Equal(2, q.Values.Length);
        Assert.Equal("knows", q.Values[0]);
        Assert.Equal(1.0, q.Values[1]);
    }

    [Fact]
    public void BuildLouvain_CustomResolution()
    {
        var q = QueryBuilder.BuildLouvain("knows", resolution: 2.5);
        Assert.Equal(2.5, q.Values[1]);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("\t")]
    public void BuildLouvain_RejectsBadEdgeType(string? edgeType)
    {
        Assert.Throws<ArgumentException>(() => QueryBuilder.BuildLouvain(edgeType!));
    }

    [Theory]
    [InlineData(0.0)]
    [InlineData(-1.0)]
    public void BuildLouvain_RejectsNonPositiveResolution(double r)
    {
        Assert.Throws<ArgumentOutOfRangeException>(
            () => QueryBuilder.BuildLouvain("knows", resolution: r));
    }

    [Theory]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    [InlineData(double.NegativeInfinity)]
    public void BuildLouvain_RejectsNonFiniteResolution(double r)
    {
        Assert.Throws<ArgumentException>(
            () => QueryBuilder.BuildLouvain("knows", resolution: r));
    }

    // -----------------------------------------------------------------------
    // DegreeCentrality
    // -----------------------------------------------------------------------

    [Fact]
    public void BuildDegreeCentrality_DefaultsToBoth()
    {
        var q = QueryBuilder.BuildDegreeCentrality("knows");
        Assert.Equal("SELECT * FROM degree_centrality($1, $2)", q.Text);
        Assert.Equal("knows", q.Values[0]);
        Assert.Equal("BOTH", q.Values[1]);
    }

    [Theory]
    [InlineData(DegreeDirection.In, "IN")]
    [InlineData(DegreeDirection.Out, "OUT")]
    [InlineData(DegreeDirection.Both, "BOTH")]
    public void BuildDegreeCentrality_CoversAllDirections(DegreeDirection dir, string expected)
    {
        var q = QueryBuilder.BuildDegreeCentrality("knows", dir);
        Assert.Equal(expected, q.Values[1]);
    }

    [Fact]
    public void BuildDegreeCentrality_RejectsUndefinedEnum()
    {
        Assert.Throws<ArgumentOutOfRangeException>(
            () => QueryBuilder.BuildDegreeCentrality("knows", (DegreeDirection)999));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" ")]
    public void BuildDegreeCentrality_RejectsBadEdgeType(string? edgeType)
    {
        Assert.Throws<ArgumentException>(
            () => QueryBuilder.BuildDegreeCentrality(edgeType!));
    }

    // -----------------------------------------------------------------------
    // ClosenessCentrality
    // -----------------------------------------------------------------------

    [Fact]
    public void BuildClosenessCentrality_DefaultsToStandard()
    {
        var q = QueryBuilder.BuildClosenessCentrality("knows");
        Assert.Equal("SELECT * FROM closeness_centrality($1, $2)", q.Text);
        Assert.Equal("knows", q.Values[0]);
        Assert.Equal("STANDARD", q.Values[1]);
    }

    [Theory]
    [InlineData(ClosenessVariant.Standard, "STANDARD")]
    [InlineData(ClosenessVariant.WassermanFaust, "WASSERMAN_FAUST")]
    [InlineData(ClosenessVariant.Harmonic, "HARMONIC")]
    public void BuildClosenessCentrality_CoversAllVariants(ClosenessVariant v, string expected)
    {
        var q = QueryBuilder.BuildClosenessCentrality("knows", v);
        Assert.Equal(expected, q.Values[1]);
    }

    [Fact]
    public void BuildClosenessCentrality_RejectsUndefinedEnum()
    {
        Assert.Throws<ArgumentOutOfRangeException>(
            () => QueryBuilder.BuildClosenessCentrality("knows", (ClosenessVariant)999));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" ")]
    public void BuildClosenessCentrality_RejectsBadEdgeType(string? edgeType)
    {
        Assert.Throws<ArgumentException>(
            () => QueryBuilder.BuildClosenessCentrality(edgeType!));
    }

    // -----------------------------------------------------------------------
    // EigenvectorCentrality
    // -----------------------------------------------------------------------

    [Fact]
    public void BuildEigenvectorCentrality_Defaults()
    {
        var q = QueryBuilder.BuildEigenvectorCentrality("knows");
        Assert.Equal("SELECT * FROM eigenvector_centrality($1, $2, $3)", q.Text);
        Assert.Equal("knows", q.Values[0]);
        Assert.Equal(100, q.Values[1]);
        Assert.Equal(1e-6, q.Values[2]);
    }

    [Fact]
    public void BuildEigenvectorCentrality_CustomParams()
    {
        var q = QueryBuilder.BuildEigenvectorCentrality("knows", iterations: 50, tolerance: 1e-9);
        Assert.Equal(50, q.Values[1]);
        Assert.Equal(1e-9, q.Values[2]);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-5)]
    public void BuildEigenvectorCentrality_RejectsNonPositiveIterations(int iters)
    {
        Assert.Throws<ArgumentOutOfRangeException>(
            () => QueryBuilder.BuildEigenvectorCentrality("knows", iterations: iters));
    }

    [Theory]
    [InlineData(0.0)]
    [InlineData(-1e-3)]
    public void BuildEigenvectorCentrality_RejectsNonPositiveTolerance(double tol)
    {
        Assert.Throws<ArgumentOutOfRangeException>(
            () => QueryBuilder.BuildEigenvectorCentrality("knows", tolerance: tol));
    }

    [Theory]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    [InlineData(double.NegativeInfinity)]
    public void BuildEigenvectorCentrality_RejectsNonFiniteTolerance(double tol)
    {
        Assert.Throws<ArgumentException>(
            () => QueryBuilder.BuildEigenvectorCentrality("knows", tolerance: tol));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" ")]
    public void BuildEigenvectorCentrality_RejectsBadEdgeType(string? edgeType)
    {
        Assert.Throws<ArgumentException>(
            () => QueryBuilder.BuildEigenvectorCentrality(edgeType!));
    }

    // -----------------------------------------------------------------------
    // HarmonicCentrality
    // -----------------------------------------------------------------------

    [Fact]
    public void BuildHarmonicCentrality_HappyPath()
    {
        var q = QueryBuilder.BuildHarmonicCentrality("knows");
        Assert.Equal("SELECT * FROM harmonic_centrality($1)", q.Text);
        Assert.Single(q.Values);
        Assert.Equal("knows", q.Values[0]);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" ")]
    public void BuildHarmonicCentrality_RejectsBadEdgeType(string? edgeType)
    {
        Assert.Throws<ArgumentException>(
            () => QueryBuilder.BuildHarmonicCentrality(edgeType!));
    }

    // -----------------------------------------------------------------------
    // ClusteringCoefficient
    // -----------------------------------------------------------------------

    [Fact]
    public void BuildClusteringCoefficient_HappyPath()
    {
        var q = QueryBuilder.BuildClusteringCoefficient("knows");
        Assert.Equal("SELECT * FROM clustering_coefficient($1)", q.Text);
        Assert.Single(q.Values);
        Assert.Equal("knows", q.Values[0]);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" ")]
    public void BuildClusteringCoefficient_RejectsBadEdgeType(string? edgeType)
    {
        Assert.Throws<ArgumentException>(
            () => QueryBuilder.BuildClusteringCoefficient(edgeType!));
    }

    // -----------------------------------------------------------------------
    // TriangleCount
    // -----------------------------------------------------------------------

    [Fact]
    public void BuildTriangleCount_HappyPath()
    {
        var q = QueryBuilder.BuildTriangleCount("knows");
        Assert.Equal("SELECT * FROM triangle_count($1)", q.Text);
        Assert.Single(q.Values);
        Assert.Equal("knows", q.Values[0]);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" ")]
    public void BuildTriangleCount_RejectsBadEdgeType(string? edgeType)
    {
        Assert.Throws<ArgumentException>(
            () => QueryBuilder.BuildTriangleCount(edgeType!));
    }

    // -----------------------------------------------------------------------
    // StronglyConnectedComponents
    // -----------------------------------------------------------------------

    [Fact]
    public void BuildStronglyConnectedComponents_HappyPath()
    {
        var q = QueryBuilder.BuildStronglyConnectedComponents("follows");
        Assert.Equal("SELECT * FROM strongly_connected_components($1)", q.Text);
        Assert.Single(q.Values);
        Assert.Equal("follows", q.Values[0]);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" ")]
    public void BuildStronglyConnectedComponents_RejectsBadEdgeType(string? edgeType)
    {
        Assert.Throws<ArgumentException>(
            () => QueryBuilder.BuildStronglyConnectedComponents(edgeType!));
    }

    // -----------------------------------------------------------------------
    // Edge type passthrough — value is bound as a parameter, not interpolated,
    // so even adversarial strings cannot inject SQL.
    // -----------------------------------------------------------------------

    [Fact]
    public void BuildPageRank_EdgeTypeIsBoundAsParameter_NotInterpolated()
    {
        var hostile = "knows'); DROP TABLE users; --";
        var q = QueryBuilder.BuildPageRank(hostile);
        // SQL text still uses placeholders, never interpolates the value.
        Assert.Equal("SELECT * FROM pagerank($1, $2, $3)", q.Text);
        Assert.Equal(hostile, q.Values[0]);
    }
}
