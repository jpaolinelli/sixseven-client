namespace SixSevenDB.Client.Tests;

/// <summary>
/// QA adversarial tests for GDB-52: QueryBuilder SQL injection, edge cases, and boundary tests.
/// </summary>
public class QaGdb52QueryBuilderAdversarialTests
{
    // ── SQL injection via identifiers ─────────────────────────────────────

    [Fact]
    public void EscapeIdentifier_SqlInjectionAttempt_IsEscaped()
    {
        var malicious = "users\"; DROP TABLE users; --";
        var result = QueryBuilder.EscapeIdentifier(malicious);
        Assert.Equal("\"users\"\"; DROP TABLE users; --\"", result);
    }

    [Fact]
    public void EscapeIdentifier_DoubleQuotesEscaped()
    {
        Assert.Equal("\"a\"\"b\"\"c\"", QueryBuilder.EscapeIdentifier("a\"b\"c"));
    }

    [Fact]
    public void EscapeIdentifier_EmptyString()
    {
        Assert.Equal("\"\"", QueryBuilder.EscapeIdentifier(""));
    }

    [Fact]
    public void EscapeIdentifier_UnicodeCharacters()
    {
        var result = QueryBuilder.EscapeIdentifier("表名");
        Assert.Equal("\"表名\"", result);
    }

    // ── BuildTraverse edge cases ──────────────────────────────────────────

    [Fact]
    public void BuildTraverse_SqlInjectionInEdgeType_IsEscaped()
    {
        var result = QueryBuilder.BuildTraverse("follows\"--", "users", 1);
        Assert.Contains("\"follows\"\"--\"", result.Text);
        Assert.DoesNotContain("--\"", result.Text.Replace("\"\"--\"", ""));
    }

    [Fact]
    public void BuildTraverse_SqlInjectionInFromTable_IsEscaped()
    {
        var result = QueryBuilder.BuildTraverse("follows", "users\";DROP TABLE--", 1);
        Assert.Contains("\"users\"\";DROP TABLE--\"", result.Text);
    }

    [Fact]
    public void BuildTraverse_ZeroDepth_IncludesDepthClause()
    {
        var result = QueryBuilder.BuildTraverse("follows", "users", 1, new TraverseOptions { MaxDepth = 0 });
        Assert.Contains("DEPTH 0", result.Text);
    }

    [Fact]
    public void BuildTraverse_NegativeDepth_NoGuard()
    {
        // Note: negative depth is not validated — documenting behavior
        var result = QueryBuilder.BuildTraverse("follows", "users", 1, new TraverseOptions { MaxDepth = -1 });
        Assert.Contains("DEPTH -1", result.Text);
    }

    [Fact]
    public void BuildTraverse_NullWhere_OmitsWhereClause()
    {
        var result = QueryBuilder.BuildTraverse("follows", "users", 1, new TraverseOptions { Where = null });
        Assert.DoesNotContain("WHERE", result.Text);
    }

    [Fact]
    public void BuildTraverse_EmptyWhere_OmitsWhereClause()
    {
        var result = QueryBuilder.BuildTraverse("follows", "users", 1, new TraverseOptions { Where = "" });
        Assert.DoesNotContain("WHERE", result.Text);
    }

    [Fact]
    public void BuildTraverse_StringStartId_Works()
    {
        var result = QueryBuilder.BuildTraverse("follows", "users", "user-abc-123");
        Assert.Equal("user-abc-123", result.Values[0]);
    }

    // ── BuildNearest edge cases ───────────────────────────────────────────

    [Fact]
    public void BuildNearest_ZeroK_GeneratesValidSql()
    {
        var result = QueryBuilder.BuildNearest("posts", "embedding", new float[] { 0.1f }, new NearestOptions { K = 0 });
        Assert.Contains("NEAREST 0", result.Text);
    }

    [Fact]
    public void BuildNearest_NegativeK_NoValidation()
    {
        var result = QueryBuilder.BuildNearest("posts", "embedding", new float[] { 0.1f }, new NearestOptions { K = -1 });
        Assert.Contains("NEAREST -1", result.Text);
    }

    [Fact]
    public void BuildNearest_EmptyEmbedding_Works()
    {
        var result = QueryBuilder.BuildNearest("posts", "embedding", Array.Empty<float>());
        Assert.Equal("[]", result.Values[0]);
    }

    [Fact]
    public void BuildNearest_SqlInjectionInTableName_IsEscaped()
    {
        var result = QueryBuilder.BuildNearest("posts\"--", "embedding", new float[] { 0.1f });
        Assert.Contains("\"posts\"\"--\"", result.Text);
    }

    [Fact]
    public void BuildNearest_SqlInjectionInColumnName_IsEscaped()
    {
        var result = QueryBuilder.BuildNearest("posts", "emb\"--", new float[] { 0.1f });
        Assert.Contains("\"emb\"\"--\"", result.Text);
    }

    [Fact]
    public void BuildNearest_NoMetric_OmitsUsingClause()
    {
        var result = QueryBuilder.BuildNearest("posts", "embedding", new float[] { 0.1f }, new NearestOptions { Metric = null });
        Assert.DoesNotContain("USING", result.Text);
    }

    // ── BuildLink edge cases ──────────────────────────────────────────────

    [Fact]
    public void BuildLink_NullPropertyValue_Included()
    {
        var result = QueryBuilder.BuildLink("follows", "users", 1, "users", 2, new LinkOptions
        {
            Properties = new Dictionary<string, object?> { ["label"] = null }
        });
        Assert.Equal(3, result.Values.Length);
        Assert.Null(result.Values[2]);
    }

    [Fact]
    public void BuildLink_EmptyProperties_NoPropertyClause()
    {
        var result = QueryBuilder.BuildLink("follows", "users", 1, "users", 2, new LinkOptions
        {
            Properties = new Dictionary<string, object?>()
        });
        Assert.DoesNotContain("(", result.Text.Replace("($1)", "").Replace("($2)", ""));
    }

    [Fact]
    public void BuildLink_SqlInjectionInPropertyKey_IsEscaped()
    {
        var result = QueryBuilder.BuildLink("follows", "users", 1, "users", 2, new LinkOptions
        {
            Properties = new Dictionary<string, object?> { ["key\"--"] = "value" }
        });
        Assert.Contains("\"key\"\"--\"", result.Text);
    }

    [Fact]
    public void BuildLink_SameFromAndToId_Works()
    {
        var result = QueryBuilder.BuildLink("self_loop", "nodes", 1, "nodes", 1);
        Assert.Equal(1, result.Values[0]);
        Assert.Equal(1, result.Values[1]);
    }

    // ── BuildUnlink edge cases ────────────────────────────────────────────

    [Fact]
    public void BuildUnlink_SqlInjectionInEdgeType_IsEscaped()
    {
        var result = QueryBuilder.BuildUnlink("evil\"--", "users", 1, "users", 2);
        Assert.Contains("\"evil\"\"--\"", result.Text);
    }

    [Fact]
    public void BuildUnlink_GuidIds_Work()
    {
        var fromId = Guid.NewGuid();
        var toId = Guid.NewGuid();
        var result = QueryBuilder.BuildUnlink("follows", "users", fromId, "users", toId);
        Assert.Equal(fromId, result.Values[0]);
        Assert.Equal(toId, result.Values[1]);
    }

    // ── Null options ──────────────────────────────────────────────────────

    [Fact]
    public void BuildTraverse_NullOptions_UsesDefaults()
    {
        var result = QueryBuilder.BuildTraverse("follows", "users", 1, null);
        Assert.Contains("DIRECTION OUT", result.Text);
        Assert.Contains("MODE NODES", result.Text);
        Assert.DoesNotContain("FETCH", result.Text);
        Assert.DoesNotContain("WHERE", result.Text);
        Assert.DoesNotContain("DEPTH", result.Text);
    }

    [Fact]
    public void BuildNearest_NullOptions_UsesDefaults()
    {
        var result = QueryBuilder.BuildNearest("posts", "embedding", new float[] { 0.1f }, null);
        Assert.Contains("NEAREST 10", result.Text);
        Assert.DoesNotContain("USING", result.Text);
        Assert.DoesNotContain("WHERE", result.Text);
    }

    [Fact]
    public void BuildLink_NullOptions_NoProperties()
    {
        var result = QueryBuilder.BuildLink("follows", "users", 1, "users", 2, null);
        Assert.Equal(2, result.Values.Length);
    }
}
