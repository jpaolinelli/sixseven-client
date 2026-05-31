using Xunit;

namespace SixSevenDB.Client.Tests;

/// <summary>
/// QA adversarial tests for GDB-667: AssertPositiveInt must throw
/// ArgumentOutOfRangeException (not plain ArgumentException) for all callers.
/// </summary>
public class QaGdb667AssertPositiveIntTests
{
    // -----------------------------------------------------------------------
    // 1. BuildPageRank — iterations parameter
    // -----------------------------------------------------------------------

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(-100)]
    [InlineData(int.MinValue)]
    public void PageRank_NonPositiveIterations_ThrowsArgumentOutOfRangeException(int iterations)
    {
        var ex = Assert.Throws<ArgumentOutOfRangeException>(
            () => QueryBuilder.BuildPageRank("knows", iterations: iterations));

        // Verify ParamName is set correctly
        Assert.Equal("iterations", ex.ParamName);

        // Verify ActualValue carries the offending value
        Assert.Equal(iterations, ex.ActualValue);
    }

    [Fact]
    public void PageRank_Iterations1_Succeeds_BoundaryValue()
    {
        // iterations=1 is the minimum valid value — must not throw
        var q = QueryBuilder.BuildPageRank("knows", iterations: 1);
        Assert.NotNull(q);
        Assert.Contains("pagerank", q.Text);
    }

    [Fact]
    public void PageRank_Iterations0_IsNotPlainArgumentException()
    {
        // The exception must be specifically ArgumentOutOfRangeException,
        // NOT plain ArgumentException. Assert.Throws<T> is exact-type by default.
        var ex = Assert.Throws<ArgumentOutOfRangeException>(
            () => QueryBuilder.BuildPageRank("knows", iterations: 0));

        // Double-check: the runtime type must be exactly ArgumentOutOfRangeException
        Assert.Equal(typeof(ArgumentOutOfRangeException), ex.GetType());
    }

    // -----------------------------------------------------------------------
    // 2. BuildEigenvectorCentrality — iterations parameter
    // -----------------------------------------------------------------------

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(-999)]
    [InlineData(int.MinValue)]
    public void Eigenvector_NonPositiveIterations_ThrowsArgumentOutOfRangeException(int iterations)
    {
        var ex = Assert.Throws<ArgumentOutOfRangeException>(
            () => QueryBuilder.BuildEigenvectorCentrality("knows", iterations: iterations));

        Assert.Equal("iterations", ex.ParamName);
        Assert.Equal(iterations, ex.ActualValue);
    }

    [Fact]
    public void Eigenvector_Iterations1_Succeeds_BoundaryValue()
    {
        var q = QueryBuilder.BuildEigenvectorCentrality("knows", iterations: 1);
        Assert.NotNull(q);
        Assert.Contains("eigenvector_centrality", q.Text);
    }

    [Fact]
    public void Eigenvector_Iterations0_IsNotPlainArgumentException()
    {
        var ex = Assert.Throws<ArgumentOutOfRangeException>(
            () => QueryBuilder.BuildEigenvectorCentrality("knows", iterations: 0));
        Assert.Equal(typeof(ArgumentOutOfRangeException), ex.GetType());
    }

    // -----------------------------------------------------------------------
    // 3. BuildShortestPath — MaxDepth parameter
    // -----------------------------------------------------------------------

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(-50)]
    [InlineData(int.MinValue)]
    public void ShortestPath_NonPositiveMaxDepth_ThrowsArgumentOutOfRangeException(int maxDepth)
    {
        var ex = Assert.Throws<ArgumentOutOfRangeException>(
            () => QueryBuilder.BuildShortestPath(
                "knows", "person", 1, "person", 2,
                new ShortestPathOptions { MaxDepth = maxDepth }));

        Assert.Equal("MaxDepth", ex.ParamName);
        Assert.Equal(maxDepth, ex.ActualValue);
    }

    [Fact]
    public void ShortestPath_MaxDepth1_Succeeds_BoundaryValue()
    {
        var q = QueryBuilder.BuildShortestPath(
            "knows", "person", 1, "person", 2,
            new ShortestPathOptions { MaxDepth = 1 });
        Assert.NotNull(q);
        Assert.Contains("MAX_DEPTH 1", q.Text);
    }

    [Fact]
    public void ShortestPath_MaxDepth0_IsNotPlainArgumentException()
    {
        var ex = Assert.Throws<ArgumentOutOfRangeException>(
            () => QueryBuilder.BuildShortestPath(
                "knows", "person", 1, "person", 2,
                new ShortestPathOptions { MaxDepth = 0 }));
        Assert.Equal(typeof(ArgumentOutOfRangeException), ex.GetType());
    }

    // -----------------------------------------------------------------------
    // 4. BuildShortestMatch — K parameter (via ValidateAndReturnK)
    // -----------------------------------------------------------------------

    private static object[] MinimalMatchPattern =>
    [
        new MatchNode { Alias = "a", Table = "person" },
        new MatchEdge { Alias = "e", EdgeType = "knows", Direction = "OUT" },
        new MatchNode { Alias = "b", Table = "person" }
    ];

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(-42)]
    [InlineData(int.MinValue)]
    public void ShortestMatch_NonPositiveK_ThrowsArgumentOutOfRangeException(int k)
    {
        var ex = Assert.Throws<ArgumentOutOfRangeException>(
            () => QueryBuilder.BuildShortestMatch(
                MinimalMatchPattern,
                ["a", "b"],
                ShortestMatchSelector.Shortest,
                new ShortestMatchOptions { K = k }));

        Assert.Equal("K", ex.ParamName);
        Assert.Equal(k, ex.ActualValue);
    }

    [Fact]
    public void ShortestMatch_K1_Succeeds_BoundaryValue()
    {
        var q = QueryBuilder.BuildShortestMatch(
            MinimalMatchPattern,
            ["a", "b"],
            ShortestMatchSelector.Shortest,
            new ShortestMatchOptions { K = 1 });
        Assert.NotNull(q);
        Assert.Contains("SHORTEST 1", q.Text);
    }

    [Fact]
    public void ShortestMatch_K0_IsNotPlainArgumentException()
    {
        var ex = Assert.Throws<ArgumentOutOfRangeException>(
            () => QueryBuilder.BuildShortestMatch(
                MinimalMatchPattern,
                ["a", "b"],
                ShortestMatchSelector.Shortest,
                new ShortestMatchOptions { K = 0 }));
        Assert.Equal(typeof(ArgumentOutOfRangeException), ex.GetType());
    }

    // -----------------------------------------------------------------------
    // 5. Catching ArgumentOutOfRangeException works (documented contract)
    // -----------------------------------------------------------------------

    [Fact]
    public void PageRank_CatchingArgumentOutOfRangeException_Works()
    {
        // This is the exact pattern from the bug report's "Steps to Reproduce"
        bool caught = false;
        try
        {
            QueryBuilder.BuildPageRank("knows", iterations: 0);
        }
        catch (ArgumentOutOfRangeException)
        {
            caught = true;
        }

        Assert.True(caught, "catch(ArgumentOutOfRangeException) must catch the thrown exception");
    }

    [Fact]
    public void Eigenvector_CatchingArgumentOutOfRangeException_Works()
    {
        bool caught = false;
        try
        {
            QueryBuilder.BuildEigenvectorCentrality("knows", iterations: 0);
        }
        catch (ArgumentOutOfRangeException)
        {
            caught = true;
        }

        Assert.True(caught, "catch(ArgumentOutOfRangeException) must catch the thrown exception");
    }

    // -----------------------------------------------------------------------
    // 6. Backwards compatibility: catching ArgumentException still works
    //    (since AOORE inherits from AE)
    // -----------------------------------------------------------------------

    [Fact]
    public void PageRank_CatchingArgumentException_StillWorks_BackwardsCompat()
    {
        bool caught = false;
        try
        {
            QueryBuilder.BuildPageRank("knows", iterations: -1);
        }
        catch (ArgumentException)
        {
            caught = true;
        }

        Assert.True(caught, "catch(ArgumentException) must still catch AOORE (inheritance)");
    }

    [Fact]
    public void ShortestPath_CatchingArgumentException_StillWorks_BackwardsCompat()
    {
        bool caught = false;
        try
        {
            QueryBuilder.BuildShortestPath(
                "knows", "person", 1, "person", 2,
                new ShortestPathOptions { MaxDepth = -1 });
        }
        catch (ArgumentException)
        {
            caught = true;
        }

        Assert.True(caught, "catch(ArgumentException) must still catch AOORE (inheritance)");
    }

    // -----------------------------------------------------------------------
    // 7. Exception message contains useful information
    // -----------------------------------------------------------------------

    [Fact]
    public void PageRank_ExceptionMessage_ContainsParameterNameAndValue()
    {
        var ex = Assert.Throws<ArgumentOutOfRangeException>(
            () => QueryBuilder.BuildPageRank("knows", iterations: -7));

        Assert.Contains("iterations", ex.Message);
        Assert.Contains("-7", ex.Message);
    }

    [Fact]
    public void ShortestPath_ExceptionMessage_ContainsParameterNameAndValue()
    {
        var ex = Assert.Throws<ArgumentOutOfRangeException>(
            () => QueryBuilder.BuildShortestPath(
                "knows", "person", 1, "person", 2,
                new ShortestPathOptions { MaxDepth = -3 }));

        Assert.Contains("MaxDepth", ex.Message);
        Assert.Contains("-3", ex.Message);
    }

    // -----------------------------------------------------------------------
    // 8. Consistency: AssertProbability and AssertPositiveDouble also throw AOORE
    // -----------------------------------------------------------------------

    [Fact]
    public void AssertProbability_ThrowsArgumentOutOfRangeException_ViaPageRankDamping()
    {
        // damping=0 goes through AssertProbability
        var ex = Assert.Throws<ArgumentOutOfRangeException>(
            () => QueryBuilder.BuildPageRank("knows", damping: 0.0));

        Assert.Equal("damping", ex.ParamName);
        Assert.Equal(0.0, ex.ActualValue);
        Assert.Equal(typeof(ArgumentOutOfRangeException), ex.GetType());
    }

    [Fact]
    public void AssertProbability_DampingTooHigh_ThrowsArgumentOutOfRangeException()
    {
        var ex = Assert.Throws<ArgumentOutOfRangeException>(
            () => QueryBuilder.BuildPageRank("knows", damping: 1.0));

        Assert.Equal("damping", ex.ParamName);
        Assert.Equal(1.0, ex.ActualValue);
    }

    [Fact]
    public void AssertPositiveDouble_ThrowsArgumentOutOfRangeException_ViaLouvainResolution()
    {
        // resolution=0 goes through AssertPositiveDouble
        var ex = Assert.Throws<ArgumentOutOfRangeException>(
            () => QueryBuilder.BuildLouvain("knows", resolution: 0.0));

        Assert.Equal("resolution", ex.ParamName);
        Assert.Equal(0.0, ex.ActualValue);
        Assert.Equal(typeof(ArgumentOutOfRangeException), ex.GetType());
    }

    [Fact]
    public void AssertPositiveDouble_NegativeValue_ThrowsArgumentOutOfRangeException()
    {
        var ex = Assert.Throws<ArgumentOutOfRangeException>(
            () => QueryBuilder.BuildLouvain("knows", resolution: -1.0));

        Assert.Equal("resolution", ex.ParamName);
        Assert.Equal(-1.0, ex.ActualValue);
    }

    [Fact]
    public void AssertPositiveDouble_Tolerance_ThrowsArgumentOutOfRangeException()
    {
        // tolerance=0 goes through AssertPositiveDouble in BuildEigenvectorCentrality
        var ex = Assert.Throws<ArgumentOutOfRangeException>(
            () => QueryBuilder.BuildEigenvectorCentrality("knows", tolerance: 0.0));

        Assert.Equal("tolerance", ex.ParamName);
        Assert.Equal(0.0, ex.ActualValue);
        Assert.Equal(typeof(ArgumentOutOfRangeException), ex.GetType());
    }

    // -----------------------------------------------------------------------
    // 9. Large boundary values — int.MaxValue should succeed
    // -----------------------------------------------------------------------

    [Fact]
    public void PageRank_IntMaxIterations_Succeeds()
    {
        var q = QueryBuilder.BuildPageRank("knows", iterations: int.MaxValue);
        Assert.NotNull(q);
        Assert.Equal(int.MaxValue, q.Values[2]);
    }

    [Fact]
    public void Eigenvector_IntMaxIterations_Succeeds()
    {
        var q = QueryBuilder.BuildEigenvectorCentrality("knows", iterations: int.MaxValue);
        Assert.NotNull(q);
        Assert.Equal(int.MaxValue, q.Values[1]);
    }

    [Fact]
    public void ShortestPath_IntMaxDepth_Succeeds()
    {
        var q = QueryBuilder.BuildShortestPath(
            "knows", "person", 1, "person", 2,
            new ShortestPathOptions { MaxDepth = int.MaxValue });
        Assert.NotNull(q);
        Assert.Contains($"MAX_DEPTH {int.MaxValue}", q.Text);
    }

    [Fact]
    public void ShortestMatch_IntMaxK_Succeeds()
    {
        var q = QueryBuilder.BuildShortestMatch(
            MinimalMatchPattern,
            ["a", "b"],
            ShortestMatchSelector.Shortest,
            new ShortestMatchOptions { K = int.MaxValue });
        Assert.NotNull(q);
        Assert.Contains($"SHORTEST {int.MaxValue}", q.Text);
    }
}
