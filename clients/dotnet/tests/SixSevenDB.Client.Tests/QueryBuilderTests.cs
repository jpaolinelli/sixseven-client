namespace SixSevenDB.Client.Tests;

public class QueryBuilderTests
{
    [Fact]
    public void BuildTraverse_DefaultOptions_GeneratesCorrectSql()
    {
        var result = QueryBuilder.BuildTraverse("follows", "users", 1);
        Assert.Equal("TRAVERSE \"follows\" FROM \"users\"($1) DIRECTION OUT MODE NODES", result.Text);
        Assert.Single(result.Values);
        Assert.Equal(1, result.Values[0]);
    }

    [Fact]
    public void BuildTraverse_AllOptions_GeneratesCorrectSql()
    {
        var result = QueryBuilder.BuildTraverse("follows", "users", 42, new TraverseOptions
        {
            Direction = TraverseDirection.Both,
            MaxDepth = 3,
            Mode = TraverseMode.Edges,
            Fetch = true,
            Where = "age > 18"
        });

        Assert.Equal("TRAVERSE \"follows\" FROM \"users\"($1) DEPTH 3 DIRECTION BOTH MODE EDGES FETCH WHERE age > 18", result.Text);
        Assert.Single(result.Values);
        Assert.Equal(42, result.Values[0]);
    }

    [Fact]
    public void BuildTraverse_InDirection_GeneratesCorrectSql()
    {
        var result = QueryBuilder.BuildTraverse("follows", "users", 1, new TraverseOptions
        {
            Direction = TraverseDirection.In
        });
        Assert.Contains("DIRECTION IN", result.Text);
    }

    [Fact]
    public void BuildNearest_DefaultOptions_GeneratesCorrectSql()
    {
        var result = QueryBuilder.BuildNearest("posts", "embedding", new float[] { 0.1f, 0.2f });
        Assert.Equal("NEAREST 10 FROM \"posts\".\"embedding\" TO $1", result.Text);
        Assert.Single(result.Values);
        Assert.Equal("[0.1,0.2]", result.Values[0]);
    }

    [Fact]
    public void BuildNearest_WithMetric_GeneratesCorrectSql()
    {
        var result = QueryBuilder.BuildNearest("posts", "embedding", new float[] { 0.1f }, new NearestOptions
        {
            K = 5,
            Metric = DistanceMetric.Cosine
        });
        Assert.Equal("NEAREST 5 FROM \"posts\".\"embedding\" TO $1 USING COSINE", result.Text);
    }

    [Fact]
    public void BuildNearest_WithL2Metric_GeneratesCorrectSql()
    {
        var result = QueryBuilder.BuildNearest("posts", "embedding", new float[] { 0.1f }, new NearestOptions
        {
            K = 3,
            Metric = DistanceMetric.L2
        });
        Assert.Contains("USING L2", result.Text);
    }

    [Fact]
    public void BuildNearest_WithDotMetric_GeneratesCorrectSql()
    {
        var result = QueryBuilder.BuildNearest("posts", "embedding", new float[] { 0.1f }, new NearestOptions
        {
            K = 3,
            Metric = DistanceMetric.Dot
        });
        Assert.Contains("USING DOT", result.Text);
    }

    [Fact]
    public void BuildNearest_WithWhereClause_GeneratesCorrectSql()
    {
        var result = QueryBuilder.BuildNearest("posts", "embedding", new float[] { 0.1f }, new NearestOptions
        {
            K = 5,
            Where = "published = true"
        });
        Assert.Contains("WHERE published = true", result.Text);
    }

    [Fact]
    public void BuildNearest_StringInput_PassedDirectly()
    {
        var result = QueryBuilder.BuildNearest("posts", "embedding", "some-text-query");
        Assert.Equal("some-text-query", result.Values[0]);
    }

    [Fact]
    public void BuildLink_BasicLink_GeneratesCorrectSql()
    {
        var result = QueryBuilder.BuildLink("follows", "users", 1, "users", 2);
        Assert.Equal("LINK \"users\"($1) TO \"users\"($2) VIA \"follows\"", result.Text);
        Assert.Equal(2, result.Values.Length);
        Assert.Equal(1, result.Values[0]);
        Assert.Equal(2, result.Values[1]);
    }

    [Fact]
    public void BuildLink_WithProperties_GeneratesCorrectSql()
    {
        var result = QueryBuilder.BuildLink("follows", "users", 1, "users", 2, new LinkOptions
        {
            Properties = new Dictionary<string, object?> { ["since"] = "2024-01-01" }
        });
        Assert.Contains("(\"since\" = $3)", result.Text);
        Assert.Equal(3, result.Values.Length);
        Assert.Equal("2024-01-01", result.Values[2]);
    }

    [Fact]
    public void BuildLink_MultipleProperties_GeneratesCorrectSql()
    {
        var result = QueryBuilder.BuildLink("follows", "users", 1, "users", 2, new LinkOptions
        {
            Properties = new Dictionary<string, object?>
            {
                ["weight"] = 0.5,
                ["label"] = "friend"
            }
        });
        Assert.Equal(4, result.Values.Length);
        Assert.Contains("$3", result.Text);
        Assert.Contains("$4", result.Text);
    }

    [Fact]
    public void BuildUnlink_GeneratesCorrectSql()
    {
        var result = QueryBuilder.BuildUnlink("follows", "users", 1, "users", 2);
        Assert.Equal("UNLINK \"users\"($1) FROM \"users\"($2) VIA \"follows\"", result.Text);
        Assert.Equal(2, result.Values.Length);
        Assert.Equal(1, result.Values[0]);
        Assert.Equal(2, result.Values[1]);
    }

    [Fact]
    public void EscapeIdentifier_QuotesSimpleName()
    {
        Assert.Equal("\"users\"", QueryBuilder.EscapeIdentifier("users"));
    }

    [Fact]
    public void EscapeIdentifier_EscapesInternalQuotes()
    {
        Assert.Equal("\"my\"\"table\"", QueryBuilder.EscapeIdentifier("my\"table"));
    }

    [Fact]
    public void BuildTraverse_GuidStartId_Works()
    {
        var guid = Guid.NewGuid();
        var result = QueryBuilder.BuildTraverse("follows", "users", guid);
        Assert.Equal(guid, result.Values[0]);
    }

    [Fact]
    public void BuildLink_DifferentTables_Works()
    {
        var result = QueryBuilder.BuildLink("authored", "users", 1, "posts", 42);
        Assert.Contains("\"users\"($1) TO \"posts\"($2)", result.Text);
    }
}
