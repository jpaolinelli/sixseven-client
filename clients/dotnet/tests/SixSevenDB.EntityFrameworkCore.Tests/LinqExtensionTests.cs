using SixSevenDB.Client;

namespace SixSevenDB.EntityFrameworkCore.Tests;

public class LinqExtensionTests
{
    [Fact]
    public void Traverse_GeneratesCorrectSql()
    {
        var result = SixSevenDbLinqExtensions.Traverse("follows", "users", 1,
            new TraverseOptions { Direction = TraverseDirection.Out, MaxDepth = 3, Fetch = true });

        Assert.Contains("TRAVERSE", result.Text);
        Assert.Contains("\"follows\"", result.Text);
        Assert.Contains("\"users\"", result.Text);
        Assert.Contains("DEPTH 3", result.Text);
        Assert.Contains("FETCH", result.Text);
        Assert.Single(result.Values);
    }

    [Fact]
    public void Nearest_GeneratesCorrectSql()
    {
        var result = SixSevenDbLinqExtensions.Nearest("posts", "embedding",
            new float[] { 0.1f, 0.2f, 0.3f },
            new NearestOptions { K = 5, Metric = DistanceMetric.Cosine });

        Assert.Contains("NEAREST 5", result.Text);
        Assert.Contains("\"posts\".\"embedding\"", result.Text);
        Assert.Contains("USING COSINE", result.Text);
    }

    [Fact]
    public void Link_GeneratesCorrectSql()
    {
        var result = SixSevenDbLinqExtensions.Link("follows", "users", 1, "users", 2,
            new LinkOptions { Properties = new() { ["since"] = "2024-01-01" } });

        Assert.Contains("LINK", result.Text);
        Assert.Contains("VIA \"follows\"", result.Text);
        Assert.Equal(3, result.Values.Length);
    }

    [Fact]
    public void Unlink_GeneratesCorrectSql()
    {
        var result = SixSevenDbLinqExtensions.Unlink("follows", "users", 1, "users", 2);

        Assert.Contains("UNLINK", result.Text);
        Assert.Contains("VIA \"follows\"", result.Text);
        Assert.Equal(2, result.Values.Length);
    }

    [Fact]
    public void Match_GeneratesCorrectSql()
    {
        var pattern = new object[]
        {
            new MatchNode { Alias = "a", Table = "users" },
            new MatchEdge { Alias = "r", EdgeType = "follows", Direction = "OUT" },
            new MatchNode { Alias = "b", Table = "users" }
        };
        var result = SixSevenDbLinqExtensions.Match(pattern,
            new MatchOptions { ReturnItems = ["a", "b"] });

        Assert.Contains("SELECT a, b FROM MATCH", result.Text);
        Assert.Contains("\"users\"", result.Text);
        Assert.Empty(result.Values);
    }

    [Fact]
    public void ShortestMatch_GeneratesCorrectSql()
    {
        var pattern = new object[]
        {
            new MatchNode { Alias = "a", Table = "users" },
            new MatchEdge { Alias = "r", EdgeType = "follows", Direction = "OUT" },
            new MatchNode { Alias = "b", Table = "users" }
        };
        var result = SixSevenDbLinqExtensions.ShortestMatch(
            pattern, ["a", "b"], ShortestMatchSelector.AnyShortest);

        Assert.Contains("ANY SHORTEST", result.Text);
        Assert.Contains("SELECT a, b FROM MATCH", result.Text);
    }

    [Fact]
    public void ShortestPath_GeneratesCorrectSql()
    {
        var result = SixSevenDbLinqExtensions.ShortestPath(
            "follows", "users", 1, "users", 2);

        Assert.Contains("SELECT * FROM SHORTEST PATH", result.Text);
        Assert.Contains("\"users\"($1) TO \"users\"($2)", result.Text);
        Assert.Equal(2, result.Values.Length);
    }
}
