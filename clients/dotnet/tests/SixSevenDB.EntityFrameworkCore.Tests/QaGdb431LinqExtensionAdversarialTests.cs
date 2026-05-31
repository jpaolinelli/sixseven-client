using SixSevenDB.Client;
using SixSevenDB.EntityFrameworkCore;

namespace SixSevenDB.EntityFrameworkCore.Tests;

/// <summary>
/// QA adversarial tests for GDB-431: LINQ extension delegation for graph query builders.
/// Verifies Match, ShortestMatch, and ShortestPath LINQ wrappers delegate correctly.
/// </summary>
public class QaGdb431LinqExtensionAdversarialTests
{
    private static object[] StandardPattern() =>
    [
        new MatchNode { Alias = "a", Table = "users" },
        new MatchEdge { Alias = "r", EdgeType = "follows", Direction = "OUT" },
        new MatchNode { Alias = "b", Table = "users" }
    ];

    [Fact]
    public void LinqMatch_DelegatesToQueryBuilder()
    {
        var pattern = StandardPattern();
        var options = new MatchOptions { ReturnItems = ["a", "b"] };

        var direct = QueryBuilder.BuildMatch(pattern, options);
        var linq = SixSevenDbLinqExtensions.Match(pattern, options);

        Assert.Equal(direct.Text, linq.Text);
    }

    [Fact]
    public void LinqShortestMatch_DelegatesToQueryBuilder()
    {
        var pattern = StandardPattern();
        var direct = QueryBuilder.BuildShortestMatch(pattern, ["a", "b"],
            ShortestMatchSelector.AnyShortest);
        var linq = SixSevenDbLinqExtensions.ShortestMatch(
            pattern, ["a", "b"], ShortestMatchSelector.AnyShortest);

        Assert.Equal(direct.Text, linq.Text);
    }

    [Fact]
    public void LinqShortestPath_DelegatesToQueryBuilder()
    {
        var direct = QueryBuilder.BuildShortestPath("follows", "users", 1, "users", 2);
        var linq = SixSevenDbLinqExtensions.ShortestPath("follows", "users", 1, "users", 2);

        Assert.Equal(direct.Text, linq.Text);
    }

    [Fact]
    public void LinqShortestMatch_WithOptions_DelegatesToQueryBuilder()
    {
        var pattern = StandardPattern();
        var options = new ShortestMatchOptions { Weight = "r.cost", Where = "a.active" };
        var direct = QueryBuilder.BuildShortestMatch(pattern, ["a", "b"],
            ShortestMatchSelector.Shortest, new ShortestMatchOptions { K = 3, Weight = "r.cost", Where = "a.active" });
        var linq = SixSevenDbLinqExtensions.ShortestMatch(
            pattern, ["a", "b"], ShortestMatchSelector.Shortest,
            new ShortestMatchOptions { K = 3, Weight = "r.cost", Where = "a.active" });

        Assert.Equal(direct.Text, linq.Text);
    }

    [Fact]
    public void LinqShortestPath_WithOptions_DelegatesToQueryBuilder()
    {
        var direct = QueryBuilder.BuildShortestPath("follows", "users", 1, "users", 2,
            new ShortestPathOptions { Direction = TraverseDirection.Both, MaxDepth = 5 });
        var linq = SixSevenDbLinqExtensions.ShortestPath("follows", "users", 1, "users", 2,
            new ShortestPathOptions { Direction = TraverseDirection.Both, MaxDepth = 5 });

        Assert.Equal(direct.Text, linq.Text);
    }
}
