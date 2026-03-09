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

    // -------------------------------------------------------------------
    // BuildMatch tests
    // -------------------------------------------------------------------

    [Fact]
    public void BuildMatch_BasicPattern_GeneratesSelectFromMatch()
    {
        var pattern = new object[]
        {
            new MatchNode { Alias = "a", Table = "users" },
            new MatchEdge { Alias = "r", EdgeType = "follows", Direction = "OUT" },
            new MatchNode { Alias = "b", Table = "users" }
        };
        var result = QueryBuilder.BuildMatch(pattern, new MatchOptions
        {
            ReturnItems = ["a", "b"]
        });

        Assert.Equal("SELECT a, b FROM MATCH (a:\"users\")-[r:\"follows\"]->(b:\"users\")", result.Text);
        Assert.Empty(result.Values);
    }

    [Fact]
    public void BuildMatch_LegacySyntax_GeneratesMatchReturn()
    {
        var pattern = new object[]
        {
            new MatchNode { Alias = "a", Table = "users" },
            new MatchEdge { Alias = "r", EdgeType = "follows", Direction = "OUT" },
            new MatchNode { Alias = "b", Table = "users" }
        };
        var result = QueryBuilder.BuildMatch(pattern, new MatchOptions
        {
            ReturnItems = ["a", "b"],
            LegacySyntax = true
        });

        Assert.Equal("MATCH (a:\"users\")-[r:\"follows\"]->(b:\"users\") RETURN a, b", result.Text);
    }

    [Fact]
    public void BuildMatch_WithWhere_AppendsWhereClause()
    {
        var pattern = new object[]
        {
            new MatchNode { Alias = "a", Table = "users" },
            new MatchEdge { Alias = "r", EdgeType = "follows", Direction = "OUT" },
            new MatchNode { Alias = "b", Table = "users" }
        };
        var result = QueryBuilder.BuildMatch(pattern, new MatchOptions
        {
            ReturnItems = ["a"],
            Where = "a.age > 18"
        });

        Assert.Equal("SELECT a FROM MATCH (a:\"users\")-[r:\"follows\"]->(b:\"users\") WHERE a.age > 18", result.Text);
    }

    [Fact]
    public void BuildMatch_LegacySyntax_WhereBeforeReturn()
    {
        var pattern = new object[]
        {
            new MatchNode { Alias = "a", Table = "users" },
            new MatchEdge { Alias = "r", EdgeType = "follows", Direction = "OUT" },
            new MatchNode { Alias = "b", Table = "users" }
        };
        var result = QueryBuilder.BuildMatch(pattern, new MatchOptions
        {
            ReturnItems = ["a"],
            Where = "a.age > 18",
            LegacySyntax = true
        });

        Assert.Equal("MATCH (a:\"users\")-[r:\"follows\"]->(b:\"users\") WHERE a.age > 18 RETURN a", result.Text);
    }

    [Fact]
    public void BuildMatch_InDirection_GeneratesCorrectArrow()
    {
        var pattern = new object[]
        {
            new MatchNode { Alias = "a", Table = "users" },
            new MatchEdge { Alias = "r", EdgeType = "follows", Direction = "IN" },
            new MatchNode { Alias = "b", Table = "users" }
        };
        var result = QueryBuilder.BuildMatch(pattern, new MatchOptions { ReturnItems = ["a"] });

        Assert.Contains("<-[r:\"follows\"]-", result.Text);
        Assert.DoesNotContain("->", result.Text);
    }

    [Fact]
    public void BuildMatch_BothDirection_GeneratesUndirectedEdge()
    {
        var pattern = new object[]
        {
            new MatchNode { Alias = "a", Table = "users" },
            new MatchEdge { Alias = "r", EdgeType = "follows", Direction = "BOTH" },
            new MatchNode { Alias = "b", Table = "users" }
        };
        var result = QueryBuilder.BuildMatch(pattern, new MatchOptions { ReturnItems = ["a"] });

        Assert.Contains("-[r:\"follows\"]-", result.Text);
        Assert.DoesNotContain("->", result.Text);
        Assert.DoesNotContain("<-", result.Text);
    }

    [Fact]
    public void BuildMatch_HopQuantifier_AppendedToEdge()
    {
        var pattern = new object[]
        {
            new MatchNode { Alias = "a", Table = "users" },
            new MatchEdge { Alias = "r", EdgeType = "follows", Direction = "OUT", Quantifier = "{1,5}" },
            new MatchNode { Alias = "b", Table = "users" }
        };
        var result = QueryBuilder.BuildMatch(pattern, new MatchOptions { ReturnItems = ["a", "b"] });

        Assert.Contains("-[r:\"follows\"]->{1,5}", result.Text);
    }

    [Fact]
    public void BuildMatch_PlusQuantifier_Works()
    {
        var pattern = new object[]
        {
            new MatchNode { Alias = "a", Table = "users" },
            new MatchEdge { Alias = "r", EdgeType = "follows", Direction = "OUT", Quantifier = "+" },
            new MatchNode { Alias = "b", Table = "users" }
        };
        var result = QueryBuilder.BuildMatch(pattern, new MatchOptions { ReturnItems = ["a"] });

        Assert.Contains("-[r:\"follows\"]->+", result.Text);
    }

    [Fact]
    public void BuildMatch_StarQuantifier_Works()
    {
        var pattern = new object[]
        {
            new MatchNode { Alias = "a", Table = "users" },
            new MatchEdge { Alias = "r", EdgeType = "follows", Direction = "OUT", Quantifier = "*" },
            new MatchNode { Alias = "b", Table = "users" }
        };
        var result = QueryBuilder.BuildMatch(pattern, new MatchOptions { ReturnItems = ["a"] });

        Assert.Contains("-[r:\"follows\"]->*", result.Text);
    }

    [Fact]
    public void BuildMatch_CrossEdgeType_UsesMultipleLabels()
    {
        var pattern = new object[]
        {
            new MatchNode { Alias = "a", Table = "users" },
            new MatchEdge
            {
                Alias = "r",
                EdgeType = "follows",
                Direction = "OUT",
                EdgeTypes = ["follows", "likes"]
            },
            new MatchNode { Alias = "b", Table = "users" }
        };
        var result = QueryBuilder.BuildMatch(pattern, new MatchOptions { ReturnItems = ["a"] });

        Assert.Contains("[r:\"follows\"|\"likes\"]", result.Text);
    }

    [Fact]
    public void BuildMatch_EmptyPattern_Throws()
    {
        Assert.Throws<ArgumentException>(() =>
            QueryBuilder.BuildMatch([], new MatchOptions { ReturnItems = ["a"] }));
    }

    // -------------------------------------------------------------------
    // BuildShortestMatch tests
    // -------------------------------------------------------------------

    [Fact]
    public void BuildShortestMatch_AnyShortest_GeneratesCorrectSql()
    {
        var pattern = new object[]
        {
            new MatchNode { Alias = "a", Table = "users" },
            new MatchEdge { Alias = "r", EdgeType = "follows", Direction = "OUT" },
            new MatchNode { Alias = "b", Table = "users" }
        };
        var result = QueryBuilder.BuildShortestMatch(
            pattern, ["a", "b"], ShortestMatchSelector.AnyShortest);

        Assert.Equal("SELECT a, b FROM MATCH ANY SHORTEST (a:\"users\")-[r:\"follows\"]->(b:\"users\")", result.Text);
        Assert.Empty(result.Values);
    }

    [Fact]
    public void BuildShortestMatch_AllShortest_GeneratesCorrectSql()
    {
        var pattern = new object[]
        {
            new MatchNode { Alias = "a", Table = "users" },
            new MatchEdge { Alias = "r", EdgeType = "follows", Direction = "OUT" },
            new MatchNode { Alias = "b", Table = "users" }
        };
        var result = QueryBuilder.BuildShortestMatch(
            pattern, ["a", "b"], ShortestMatchSelector.AllShortest);

        Assert.Contains("ALL SHORTEST", result.Text);
    }

    [Fact]
    public void BuildShortestMatch_ShortestK_GeneratesCorrectSql()
    {
        var pattern = new object[]
        {
            new MatchNode { Alias = "a", Table = "users" },
            new MatchEdge { Alias = "r", EdgeType = "follows", Direction = "OUT" },
            new MatchNode { Alias = "b", Table = "users" }
        };
        var result = QueryBuilder.BuildShortestMatch(
            pattern, ["a", "b"], ShortestMatchSelector.Shortest,
            new ShortestMatchOptions { K = 3 });

        Assert.Contains("SHORTEST 3", result.Text);
    }

    [Fact]
    public void BuildShortestMatch_ShortestWithoutK_Throws()
    {
        var pattern = new object[]
        {
            new MatchNode { Alias = "a", Table = "users" },
            new MatchEdge { Alias = "r", EdgeType = "follows", Direction = "OUT" },
            new MatchNode { Alias = "b", Table = "users" }
        };

        Assert.Throws<ArgumentException>(() =>
            QueryBuilder.BuildShortestMatch(
                pattern, ["a", "b"], ShortestMatchSelector.Shortest));
    }

    [Fact]
    public void BuildShortestMatch_WithWeight_AppendsWeightClause()
    {
        var pattern = new object[]
        {
            new MatchNode { Alias = "a", Table = "users" },
            new MatchEdge { Alias = "r", EdgeType = "follows", Direction = "OUT" },
            new MatchNode { Alias = "b", Table = "users" }
        };
        var result = QueryBuilder.BuildShortestMatch(
            pattern, ["a", "b"], ShortestMatchSelector.AnyShortest,
            new ShortestMatchOptions { Weight = "r.cost" });

        Assert.Contains("WEIGHT r.cost", result.Text);
    }

    [Fact]
    public void BuildShortestMatch_WithWhere_AppendsWhereClause()
    {
        var pattern = new object[]
        {
            new MatchNode { Alias = "a", Table = "users" },
            new MatchEdge { Alias = "r", EdgeType = "follows", Direction = "OUT" },
            new MatchNode { Alias = "b", Table = "users" }
        };
        var result = QueryBuilder.BuildShortestMatch(
            pattern, ["a", "b"], ShortestMatchSelector.AnyShortest,
            new ShortestMatchOptions { Where = "a.active = true" });

        Assert.Contains("WHERE a.active = true", result.Text);
    }

    [Fact]
    public void BuildShortestMatch_EmptyPattern_Throws()
    {
        Assert.Throws<ArgumentException>(() =>
            QueryBuilder.BuildShortestMatch([], ["a"], ShortestMatchSelector.AnyShortest));
    }

    // -------------------------------------------------------------------
    // BuildShortestPath tests
    // -------------------------------------------------------------------

    [Fact]
    public void BuildShortestPath_Default_GeneratesSelectWrappedSql()
    {
        var result = QueryBuilder.BuildShortestPath("follows", "users", 1, "users", 2);

        Assert.Equal("SELECT * FROM SHORTEST PATH FROM \"users\"($1) TO \"users\"($2) VIA \"follows\"", result.Text);
        Assert.Equal(2, result.Values.Length);
        Assert.Equal(1, result.Values[0]);
        Assert.Equal(2, result.Values[1]);
    }

    [Fact]
    public void BuildShortestPath_LegacySyntax_NoSelectWrapper()
    {
        var result = QueryBuilder.BuildShortestPath("follows", "users", 1, "users", 2,
            new ShortestPathOptions { LegacySyntax = true });

        Assert.StartsWith("SHORTEST PATH FROM", result.Text);
        Assert.DoesNotContain("SELECT", result.Text);
    }

    [Fact]
    public void BuildShortestPath_CustomSelect_UsesProvidedClause()
    {
        var result = QueryBuilder.BuildShortestPath("follows", "users", 1, "users", 2,
            new ShortestPathOptions { Select = "a.name, b.name" });

        Assert.StartsWith("SELECT a.name, b.name FROM SHORTEST PATH", result.Text);
    }

    [Fact]
    public void BuildShortestPath_WithDirection_AppendDirectionClause()
    {
        var result = QueryBuilder.BuildShortestPath("follows", "users", 1, "users", 2,
            new ShortestPathOptions { Direction = TraverseDirection.Both });

        Assert.Contains("DIRECTION BOTH", result.Text);
    }

    [Fact]
    public void BuildShortestPath_WithMaxDepth_AppendsMaxDepth()
    {
        var result = QueryBuilder.BuildShortestPath("follows", "users", 1, "users", 2,
            new ShortestPathOptions { MaxDepth = 5 });

        Assert.Contains("MAX_DEPTH 5", result.Text);
    }

    [Fact]
    public void BuildShortestPath_InvalidMaxDepth_Throws()
    {
        Assert.Throws<ArgumentException>(() =>
            QueryBuilder.BuildShortestPath("follows", "users", 1, "users", 2,
                new ShortestPathOptions { MaxDepth = 0 }));
    }

    [Fact]
    public void BuildShortestPath_DifferentTables_Works()
    {
        var result = QueryBuilder.BuildShortestPath("authored", "users", 1, "posts", 42);

        Assert.Contains("\"users\"($1) TO \"posts\"($2)", result.Text);
    }

    // -------------------------------------------------------------------
    // BuildMatchPattern / helper tests
    // -------------------------------------------------------------------

    [Fact]
    public void BuildMatchPattern_MultiEdgePattern_Works()
    {
        var pattern = new object[]
        {
            new MatchNode { Alias = "a", Table = "users" },
            new MatchEdge { Alias = "r1", EdgeType = "follows", Direction = "OUT" },
            new MatchNode { Alias = "b", Table = "users" },
            new MatchEdge { Alias = "r2", EdgeType = "likes", Direction = "OUT" },
            new MatchNode { Alias = "c", Table = "posts" }
        };
        var result = QueryBuilder.BuildMatchPattern(pattern);

        Assert.Equal("(a:\"users\")-[r1:\"follows\"]->(b:\"users\")-[r2:\"likes\"]->(c:\"posts\")", result);
    }

    [Fact]
    public void BuildEdgeLabel_SingleEdgeType_ReturnsEscaped()
    {
        var edge = new MatchEdge { Alias = "r", EdgeType = "follows", Direction = "OUT" };
        Assert.Equal("\"follows\"", QueryBuilder.BuildEdgeLabel(edge));
    }

    [Fact]
    public void BuildEdgeLabel_CrossEdgeTypes_JoinedWithPipe()
    {
        var edge = new MatchEdge
        {
            Alias = "r",
            EdgeType = "follows",
            Direction = "OUT",
            EdgeTypes = ["follows", "likes", "blocks"]
        };
        Assert.Equal("\"follows\"|\"likes\"|\"blocks\"", QueryBuilder.BuildEdgeLabel(edge));
    }

    // -------------------------------------------------------------------
    // Backward compatibility tests
    // -------------------------------------------------------------------

    [Fact]
    public void BuildMatch_BackwardCompat_LegacySyntaxMatchesOldFormat()
    {
        var pattern = new object[]
        {
            new MatchNode { Alias = "a", Table = "users" },
            new MatchEdge { Alias = "r", EdgeType = "follows", Direction = "OUT" },
            new MatchNode { Alias = "b", Table = "users" }
        };

        var legacy = QueryBuilder.BuildMatch(pattern, new MatchOptions
        {
            ReturnItems = ["a", "b"],
            LegacySyntax = true
        });
        var modern = QueryBuilder.BuildMatch(pattern, new MatchOptions
        {
            ReturnItems = ["a", "b"]
        });

        Assert.StartsWith("MATCH ", legacy.Text);
        Assert.Contains("RETURN a, b", legacy.Text);
        Assert.StartsWith("SELECT a, b FROM MATCH", modern.Text);
        Assert.DoesNotContain("RETURN", modern.Text);
    }

    [Fact]
    public void BuildShortestPath_BackwardCompat_LegacyVsModern()
    {
        var legacy = QueryBuilder.BuildShortestPath("follows", "users", 1, "users", 2,
            new ShortestPathOptions { LegacySyntax = true });
        var modern = QueryBuilder.BuildShortestPath("follows", "users", 1, "users", 2);

        Assert.DoesNotContain("SELECT", legacy.Text);
        Assert.StartsWith("SELECT * FROM", modern.Text);
    }
}
