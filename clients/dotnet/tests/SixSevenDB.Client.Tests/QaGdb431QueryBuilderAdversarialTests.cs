using System.Text.Json;
using SixSevenDB.Client;

namespace SixSevenDB.Client.Tests;

/// <summary>
/// QA adversarial tests for GDB-431: .NET Client Graph Query Builder Updates.
/// Tests MATCH builder, path selectors, path parsing, SHORTEST PATH composability,
/// backward compatibility, and SQL injection resistance.
/// </summary>
public class QaGdb431QueryBuilderAdversarialTests
{
    // ── Helper: standard 3-element pattern (a)-[r]->(b) ─────────────────

    private static object[] StandardPattern() =>
    [
        new MatchNode { Alias = "a", Table = "users" },
        new MatchEdge { Alias = "r", EdgeType = "follows", Direction = "OUT" },
        new MatchNode { Alias = "b", Table = "users" }
    ];

    // =====================================================================
    // BuildMatch — boundary and edge cases
    // =====================================================================

    [Fact]
    public void BuildMatch_EmptyPattern_ThrowsArgumentException()
    {
        Assert.Throws<ArgumentException>(() =>
            QueryBuilder.BuildMatch([], new MatchOptions { ReturnItems = ["a"] }));
    }

    [Fact]
    public void BuildMatch_SingleNodePattern_GeneratesValidSql()
    {
        var pattern = new object[] { new MatchNode { Alias = "a", Table = "users" } };
        var result = QueryBuilder.BuildMatch(pattern, new MatchOptions { ReturnItems = ["a"] });
        Assert.Equal("SELECT a FROM MATCH (a:\"users\")", result.Text);
        Assert.Empty(result.Values);
    }

    [Fact]
    public void BuildMatch_EmptyReturnItems_GeneratesEmptySelect()
    {
        var result = QueryBuilder.BuildMatch(StandardPattern(), new MatchOptions { ReturnItems = [] });
        Assert.Contains("SELECT  FROM MATCH", result.Text);
    }

    [Fact]
    public void BuildMatch_VeryLongTableName_Works()
    {
        var longName = new string('a', 500);
        var pattern = new object[] { new MatchNode { Alias = "x", Table = longName } };
        var result = QueryBuilder.BuildMatch(pattern, new MatchOptions { ReturnItems = ["x"] });
        Assert.Contains($"(x:\"{longName}\")", result.Text);
    }

    [Fact]
    public void BuildMatch_SpecialCharsInTableName_Escaped()
    {
        var pattern = new object[]
        {
            new MatchNode { Alias = "a", Table = "table'with;special--chars" },
            new MatchEdge { Alias = "r", EdgeType = "edge", Direction = "OUT" },
            new MatchNode { Alias = "b", Table = "normal" }
        };
        var result = QueryBuilder.BuildMatch(pattern, new MatchOptions { ReturnItems = ["a"] });
        Assert.Contains("\"table'with;special--chars\"", result.Text);
    }

    [Fact]
    public void BuildMatch_UnicodeInIdentifiers_Works()
    {
        var pattern = new object[]
        {
            new MatchNode { Alias = "a", Table = "表テーブル" },
            new MatchEdge { Alias = "r", EdgeType = "関係", Direction = "OUT" },
            new MatchNode { Alias = "b", Table = "表テーブル" }
        };
        var result = QueryBuilder.BuildMatch(pattern, new MatchOptions { ReturnItems = ["a", "b"] });
        Assert.Contains("\"表テーブル\"", result.Text);
        Assert.Contains("\"関係\"", result.Text);
    }

    [Fact]
    public void BuildMatch_NoParameterValues_AlwaysEmpty()
    {
        var result = QueryBuilder.BuildMatch(StandardPattern(), new MatchOptions
        {
            ReturnItems = ["a", "b"],
            Where = "a.age > 18"
        });
        Assert.Empty(result.Values);
    }

    // ── Edge quantifier edge cases ──────────────────────────────────────

    [Fact]
    public void BuildMatch_EmptyQuantifier_ProducesNoQuantifier()
    {
        var pattern = new object[]
        {
            new MatchNode { Alias = "a", Table = "users" },
            new MatchEdge { Alias = "r", EdgeType = "follows", Direction = "OUT", Quantifier = "" },
            new MatchNode { Alias = "b", Table = "users" }
        };
        var result = QueryBuilder.BuildMatch(pattern, new MatchOptions { ReturnItems = ["a", "b"] });
        Assert.Equal("SELECT a, b FROM MATCH (a:\"users\")-[r:\"follows\"]->(b:\"users\")", result.Text);
    }

    [Fact]
    public void BuildMatch_NullQuantifier_ProducesNoQuantifier()
    {
        var pattern = new object[]
        {
            new MatchNode { Alias = "a", Table = "users" },
            new MatchEdge { Alias = "r", EdgeType = "follows", Direction = "OUT", Quantifier = null },
            new MatchNode { Alias = "b", Table = "users" }
        };
        var result = QueryBuilder.BuildMatch(pattern, new MatchOptions { ReturnItems = ["a", "b"] });
        Assert.Equal("SELECT a, b FROM MATCH (a:\"users\")-[r:\"follows\"]->(b:\"users\")", result.Text);
    }

    [Fact]
    public void BuildMatch_ArbitraryQuantifier_PassedThrough()
    {
        var pattern = new object[]
        {
            new MatchNode { Alias = "a", Table = "users" },
            new MatchEdge { Alias = "r", EdgeType = "follows", Direction = "OUT", Quantifier = "{0,0}" },
            new MatchNode { Alias = "b", Table = "users" }
        };
        var result = QueryBuilder.BuildMatch(pattern, new MatchOptions { ReturnItems = ["a", "b"] });
        Assert.Contains("->{0,0}", result.Text);
    }

    [Fact]
    public void BuildMatch_LargeRangeQuantifier_Works()
    {
        var pattern = new object[]
        {
            new MatchNode { Alias = "a", Table = "users" },
            new MatchEdge { Alias = "r", EdgeType = "follows", Direction = "OUT", Quantifier = "{1,999999}" },
            new MatchNode { Alias = "b", Table = "users" }
        };
        var result = QueryBuilder.BuildMatch(pattern, new MatchOptions { ReturnItems = ["a", "b"] });
        Assert.Contains("->{1,999999}", result.Text);
    }

    // ── Cross-edge-type edge cases ──────────────────────────────────────

    [Fact]
    public void BuildMatch_EmptyEdgeTypes_FallsBackToEdgeType()
    {
        var pattern = new object[]
        {
            new MatchNode { Alias = "a", Table = "users" },
            new MatchEdge { Alias = "r", EdgeType = "follows", Direction = "OUT", EdgeTypes = [] },
            new MatchNode { Alias = "b", Table = "users" }
        };
        var result = QueryBuilder.BuildMatch(pattern, new MatchOptions { ReturnItems = ["a", "b"] });
        Assert.Contains("[r:\"follows\"]", result.Text);
    }

    [Fact]
    public void BuildMatch_SingleEdgeTypeInEdgeTypes_Works()
    {
        var pattern = new object[]
        {
            new MatchNode { Alias = "a", Table = "users" },
            new MatchEdge { Alias = "r", EdgeType = "default", Direction = "OUT", EdgeTypes = ["follows"] },
            new MatchNode { Alias = "b", Table = "users" }
        };
        var result = QueryBuilder.BuildMatch(pattern, new MatchOptions { ReturnItems = ["a", "b"] });
        Assert.Contains("[r:\"follows\"]", result.Text);
    }

    [Fact]
    public void BuildMatch_ManyEdgeTypes_AllPipeSeparated()
    {
        var types = Enumerable.Range(0, 20).Select(i => $"edge_{i}").ToList();
        var pattern = new object[]
        {
            new MatchNode { Alias = "a", Table = "users" },
            new MatchEdge { Alias = "r", EdgeType = "default", Direction = "OUT", EdgeTypes = types },
            new MatchNode { Alias = "b", Table = "users" }
        };
        var result = QueryBuilder.BuildMatch(pattern, new MatchOptions { ReturnItems = ["a", "b"] });
        foreach (var t in types)
        {
            Assert.Contains($"\"{t}\"", result.Text);
        }
    }

    [Fact]
    public void BuildMatch_EdgeTypesWithQuotes_Escaped()
    {
        var pattern = new object[]
        {
            new MatchNode { Alias = "a", Table = "users" },
            new MatchEdge { Alias = "r", EdgeType = "default", Direction = "OUT", EdgeTypes = ["a\"b", "c\"d"] },
            new MatchNode { Alias = "b", Table = "users" }
        };
        var result = QueryBuilder.BuildMatch(pattern, new MatchOptions { ReturnItems = ["a", "b"] });
        Assert.Contains("\"a\"\"b\"|\"c\"\"d\"", result.Text);
    }

    // ── Legacy syntax edge cases ────────────────────────────────────────

    [Fact]
    public void BuildMatch_LegacySyntax_EmptyWhere_OmitsWhereClause()
    {
        var result = QueryBuilder.BuildMatch(StandardPattern(), new MatchOptions
        {
            ReturnItems = ["a"],
            Where = "",
            LegacySyntax = true
        });
        Assert.DoesNotContain("WHERE", result.Text);
    }

    [Fact]
    public void BuildMatch_ModernSyntax_EmptyWhere_OmitsWhereClause()
    {
        var result = QueryBuilder.BuildMatch(StandardPattern(), new MatchOptions
        {
            ReturnItems = ["a"],
            Where = ""
        });
        Assert.DoesNotContain("WHERE", result.Text);
    }

    [Fact]
    public void BuildMatch_LegacySyntax_NullWhere_OmitsWhereClause()
    {
        var result = QueryBuilder.BuildMatch(StandardPattern(), new MatchOptions
        {
            ReturnItems = ["a"],
            Where = null,
            LegacySyntax = true
        });
        Assert.DoesNotContain("WHERE", result.Text);
    }

    [Fact]
    public void BuildMatch_ExplicitFalse_MatchesDefault()
    {
        var explicit_ = QueryBuilder.BuildMatch(StandardPattern(), new MatchOptions
        {
            ReturnItems = ["a"],
            LegacySyntax = false
        });
        var default_ = QueryBuilder.BuildMatch(StandardPattern(), new MatchOptions
        {
            ReturnItems = ["a"]
        });
        Assert.Equal(explicit_.Text, default_.Text);
    }

    // =====================================================================
    // BuildMatchPattern — isolated
    // =====================================================================

    [Fact]
    public void BuildMatchPattern_EmptyPattern_ReturnsEmptyString()
    {
        Assert.Equal("", QueryBuilder.BuildMatchPattern([]));
    }

    [Fact]
    public void BuildMatchPattern_NodeOnly_ReturnsNodeSql()
    {
        var pattern = new object[] { new MatchNode { Alias = "x", Table = "users" } };
        Assert.Equal("(x:\"users\")", QueryBuilder.BuildMatchPattern(pattern));
    }

    [Fact]
    public void BuildMatchPattern_LongChain_HasCorrectNodeAndEdgeCounts()
    {
        var pattern = new List<object>();
        for (var i = 0; i < 5; i++)
        {
            if (i > 0)
                pattern.Add(new MatchEdge { Alias = $"r{i}", EdgeType = $"edge{i}", Direction = "OUT" });
            pattern.Add(new MatchNode { Alias = $"n{i}", Table = $"table{i}" });
        }
        var result = QueryBuilder.BuildMatchPattern(pattern.ToArray());
        Assert.Equal(5, result.Split('(').Length - 1); // 5 node openings
        Assert.Equal(4, result.Split("->").Length - 1); // 4 OUT arrows
    }

    // =====================================================================
    // BuildShortestMatch — adversarial tests
    // =====================================================================

    [Fact]
    public void BuildShortestMatch_ShortestK0_ThrowsArgumentException()
    {
        Assert.Throws<ArgumentException>(() =>
            QueryBuilder.BuildShortestMatch(StandardPattern(), ["a", "b"],
                ShortestMatchSelector.Shortest, new ShortestMatchOptions { K = 0 }));
    }

    [Fact]
    public void BuildShortestMatch_ShortestNegativeK_ThrowsArgumentException()
    {
        Assert.Throws<ArgumentException>(() =>
            QueryBuilder.BuildShortestMatch(StandardPattern(), ["a", "b"],
                ShortestMatchSelector.Shortest, new ShortestMatchOptions { K = -5 }));
    }

    [Fact]
    public void BuildShortestMatch_ShortestK1_Works()
    {
        var result = QueryBuilder.BuildShortestMatch(StandardPattern(), ["a", "b"],
            ShortestMatchSelector.Shortest, new ShortestMatchOptions { K = 1 });
        Assert.Contains("SHORTEST 1", result.Text);
    }

    [Fact]
    public void BuildShortestMatch_ShortestLargeK_Works()
    {
        var result = QueryBuilder.BuildShortestMatch(StandardPattern(), ["a", "b"],
            ShortestMatchSelector.Shortest, new ShortestMatchOptions { K = 1000000 });
        Assert.Contains("SHORTEST 1000000", result.Text);
    }

    [Fact]
    public void BuildShortestMatch_ShortestNullK_ThrowsArgumentException()
    {
        Assert.Throws<ArgumentException>(() =>
            QueryBuilder.BuildShortestMatch(StandardPattern(), ["a", "b"],
                ShortestMatchSelector.Shortest, new ShortestMatchOptions { K = null }));
    }

    [Fact]
    public void BuildShortestMatch_ShortestWithoutOptions_ThrowsArgumentException()
    {
        Assert.Throws<ArgumentException>(() =>
            QueryBuilder.BuildShortestMatch(StandardPattern(), ["a", "b"],
                ShortestMatchSelector.Shortest));
    }

    [Fact]
    public void BuildShortestMatch_AnyShortestNoK_Works()
    {
        var result = QueryBuilder.BuildShortestMatch(StandardPattern(), ["a", "b"],
            ShortestMatchSelector.AnyShortest);
        Assert.Contains("ANY SHORTEST", result.Text);
        Assert.DoesNotMatch("ANY SHORTEST \\d", result.Text);
    }

    [Fact]
    public void BuildShortestMatch_AllShortestNoK_Works()
    {
        var result = QueryBuilder.BuildShortestMatch(StandardPattern(), ["a", "b"],
            ShortestMatchSelector.AllShortest);
        Assert.Contains("ALL SHORTEST", result.Text);
    }

    [Fact]
    public void BuildShortestMatch_EmptyReturnItems_ProducesEmptySelect()
    {
        var result = QueryBuilder.BuildShortestMatch(StandardPattern(), [],
            ShortestMatchSelector.AnyShortest);
        Assert.Contains("SELECT  FROM MATCH", result.Text);
    }

    [Fact]
    public void BuildShortestMatch_EmptyPattern_ThrowsArgumentException()
    {
        Assert.Throws<ArgumentException>(() =>
            QueryBuilder.BuildShortestMatch([], ["a"], ShortestMatchSelector.AnyShortest));
    }

    [Fact]
    public void BuildShortestMatch_NoParameters_AlwaysEmpty()
    {
        var result = QueryBuilder.BuildShortestMatch(StandardPattern(), ["a", "b"],
            ShortestMatchSelector.AnyShortest, new ShortestMatchOptions
            {
                Weight = "r.cost",
                Where = "a.active = true"
            });
        Assert.Empty(result.Values);
    }

    // ── WEIGHT and WHERE interaction ────────────────────────────────────

    [Fact]
    public void BuildShortestMatch_WeightBeforeWhere_WhenBothPresent()
    {
        var result = QueryBuilder.BuildShortestMatch(StandardPattern(), ["a", "b"],
            ShortestMatchSelector.AnyShortest, new ShortestMatchOptions
            {
                Weight = "r.cost",
                Where = "a.active = true"
            });
        var weightIdx = result.Text.IndexOf("WEIGHT");
        var whereIdx = result.Text.IndexOf("WHERE");
        Assert.True(weightIdx > -1, "WEIGHT should be present");
        Assert.True(whereIdx > -1, "WHERE should be present");
        Assert.True(weightIdx < whereIdx, "WEIGHT should come before WHERE");
    }

    [Fact]
    public void BuildShortestMatch_EmptyWeight_OmitsWeightClause()
    {
        var result = QueryBuilder.BuildShortestMatch(StandardPattern(), ["a", "b"],
            ShortestMatchSelector.AnyShortest, new ShortestMatchOptions { Weight = "" });
        Assert.DoesNotContain("WEIGHT", result.Text);
    }

    [Fact]
    public void BuildShortestMatch_EmptyWhere_OmitsWhereClause()
    {
        var result = QueryBuilder.BuildShortestMatch(StandardPattern(), ["a", "b"],
            ShortestMatchSelector.AnyShortest, new ShortestMatchOptions { Where = "" });
        Assert.DoesNotContain("WHERE", result.Text);
    }

    [Fact]
    public void BuildShortestMatch_WeightOnly_NoWhere()
    {
        var result = QueryBuilder.BuildShortestMatch(StandardPattern(), ["a", "b"],
            ShortestMatchSelector.AllShortest, new ShortestMatchOptions { Weight = "r.distance" });
        Assert.Contains("WEIGHT r.distance", result.Text);
        Assert.DoesNotContain("WHERE", result.Text);
    }

    [Fact]
    public void BuildShortestMatch_WhereOnly_NoWeight()
    {
        var result = QueryBuilder.BuildShortestMatch(StandardPattern(), ["a", "b"],
            ShortestMatchSelector.AllShortest, new ShortestMatchOptions { Where = "b.active" });
        Assert.Contains("WHERE b.active", result.Text);
        Assert.DoesNotContain("WEIGHT", result.Text);
    }

    [Fact]
    public void BuildShortestMatch_NullOptions_UsesDefaults()
    {
        var result = QueryBuilder.BuildShortestMatch(StandardPattern(), ["a", "b"],
            ShortestMatchSelector.AnyShortest, null);
        Assert.DoesNotContain("WEIGHT", result.Text);
        Assert.DoesNotContain("WHERE", result.Text);
    }

    // =====================================================================
    // BuildShortestPath — adversarial tests
    // =====================================================================

    [Fact]
    public void BuildShortestPath_Default_SelectStarFrom()
    {
        var result = QueryBuilder.BuildShortestPath("edge", "from_table", 1, "to_table", 2);
        Assert.StartsWith("SELECT * FROM SHORTEST PATH", result.Text);
    }

    [Fact]
    public void BuildShortestPath_CustomSelect_Used()
    {
        var result = QueryBuilder.BuildShortestPath("edge", "from_table", 1, "to_table", 2,
            new ShortestPathOptions { Select = "count(*)" });
        Assert.StartsWith("SELECT count(*) FROM SHORTEST PATH", result.Text);
    }

    [Fact]
    public void BuildShortestPath_LegacySyntax_IgnoresSelect()
    {
        var result = QueryBuilder.BuildShortestPath("edge", "from_table", 1, "to_table", 2,
            new ShortestPathOptions { Select = "path_length", LegacySyntax = true });
        Assert.DoesNotContain("SELECT", result.Text);
        Assert.DoesNotContain("path_length", result.Text);
    }

    [Fact]
    public void BuildShortestPath_MaxDepth0_ThrowsArgumentException()
    {
        Assert.Throws<ArgumentException>(() =>
            QueryBuilder.BuildShortestPath("e", "t", 1, "t", 2,
                new ShortestPathOptions { MaxDepth = 0 }));
    }

    [Fact]
    public void BuildShortestPath_MaxDepthNegative_ThrowsArgumentException()
    {
        Assert.Throws<ArgumentException>(() =>
            QueryBuilder.BuildShortestPath("e", "t", 1, "t", 2,
                new ShortestPathOptions { MaxDepth = -1 }));
    }

    [Fact]
    public void BuildShortestPath_MaxDepth1_Works()
    {
        var result = QueryBuilder.BuildShortestPath("e", "t", 1, "t", 2,
            new ShortestPathOptions { MaxDepth = 1 });
        Assert.Contains("MAX_DEPTH 1", result.Text);
    }

    [Fact]
    public void BuildShortestPath_StringIds_Work()
    {
        var result = QueryBuilder.BuildShortestPath("e", "t", "uuid-1", "t", "uuid-2");
        Assert.Equal("uuid-1", result.Values[0]);
        Assert.Equal("uuid-2", result.Values[1]);
    }

    [Fact]
    public void BuildShortestPath_GuidIds_Work()
    {
        var fromId = Guid.NewGuid();
        var toId = Guid.NewGuid();
        var result = QueryBuilder.BuildShortestPath("e", "t", fromId, "t", toId);
        Assert.Equal(fromId, result.Values[0]);
        Assert.Equal(toId, result.Values[1]);
    }

    [Fact]
    public void BuildShortestPath_EmptyEdgeType_ProducesEmptyQuotedIdentifier()
    {
        var result = QueryBuilder.BuildShortestPath("", "from", 1, "to", 2);
        Assert.Contains("VIA \"\"", result.Text);
    }

    [Fact]
    public void BuildShortestPath_ParameterOrder_Preserved()
    {
        var result = QueryBuilder.BuildShortestPath("e", "source", "A", "target", "B");
        Assert.Equal("A", result.Values[0]);
        Assert.Equal("B", result.Values[1]);
        Assert.Contains("\"source\"($1)", result.Text);
        Assert.Contains("\"target\"($2)", result.Text);
    }

    [Fact]
    public void BuildShortestPath_AllDirections_Work()
    {
        var outResult = QueryBuilder.BuildShortestPath("e", "t", 1, "t", 2,
            new ShortestPathOptions { Direction = TraverseDirection.Out });
        Assert.Contains("DIRECTION OUT", outResult.Text);

        var inResult = QueryBuilder.BuildShortestPath("e", "t", 1, "t", 2,
            new ShortestPathOptions { Direction = TraverseDirection.In });
        Assert.Contains("DIRECTION IN", inResult.Text);

        var bothResult = QueryBuilder.BuildShortestPath("e", "t", 1, "t", 2,
            new ShortestPathOptions { Direction = TraverseDirection.Both });
        Assert.Contains("DIRECTION BOTH", bothResult.Text);
    }

    [Fact]
    public void BuildShortestPath_NoDirection_OmitsClause()
    {
        var result = QueryBuilder.BuildShortestPath("e", "t", 1, "t", 2);
        Assert.DoesNotContain("DIRECTION", result.Text);
    }

    [Fact]
    public void BuildShortestPath_NullOptions_UsesDefaults()
    {
        var result = QueryBuilder.BuildShortestPath("e", "t", 1, "t", 2, null);
        Assert.StartsWith("SELECT * FROM", result.Text);
        Assert.DoesNotContain("DIRECTION", result.Text);
        Assert.DoesNotContain("MAX_DEPTH", result.Text);
    }

    // =====================================================================
    // ParsePath — adversarial tests
    // =====================================================================

    [Fact]
    public void ParsePath_InvalidJson_Throws()
    {
        Assert.ThrowsAny<Exception>(() => TypeParser.ParsePath("not json"));
    }

    [Fact]
    public void ParsePath_NonArrayJson_Throws()
    {
        Assert.ThrowsAny<Exception>(() => TypeParser.ParsePath("{\"key\": \"value\"}"));
    }

    [Fact]
    public void ParsePath_NullJsonLiteral_Throws()
    {
        Assert.ThrowsAny<Exception>(() => TypeParser.ParsePath("null"));
    }

    [Fact]
    public void ParsePath_EmptyArray_ReturnsEmptyPath()
    {
        var path = TypeParser.ParsePath("[]");
        Assert.Empty(path.Nodes);
        Assert.Empty(path.Edges);
        Assert.Equal(0, path.PathLength);
    }

    [Fact]
    public void ParsePath_MissingTableField_DefaultsToEmptyString()
    {
        var json = JsonSerializer.Serialize(new object[] { new { id = 1, name = "Alice" } });
        var path = TypeParser.ParsePath(json);
        Assert.Single(path.Nodes);
        Assert.Equal("", path.Nodes[0].Table);
        Assert.Equal((long)1, path.Nodes[0].Id);
        Assert.Equal("Alice", path.Nodes[0].Properties["name"]);
    }

    [Fact]
    public void ParsePath_MissingIdField_DefaultsToNull()
    {
        var json = JsonSerializer.Serialize(new object[] { new { table = "users", name = "Alice" } });
        var path = TypeParser.ParsePath(json);
        Assert.Null(path.Nodes[0].Id);
        Assert.Equal("users", path.Nodes[0].Table);
    }

    [Fact]
    public void ParsePath_MissingEdgeTypeField_DefaultsToEmptyString()
    {
        var json = JsonSerializer.Serialize(new object[]
        {
            new { table = "users", id = 1 },
            new { from_id = 1, to_id = 2 },
            new { table = "users", id = 2 }
        });
        var path = TypeParser.ParsePath(json);
        Assert.Equal("", path.Edges[0].EdgeType);
        Assert.Equal((long)1, path.Edges[0].FromId);
        Assert.Equal((long)2, path.Edges[0].ToId);
    }

    [Fact]
    public void ParsePath_NullValuesInNode_HandledGracefully()
    {
        var json = "[{\"table\": null, \"id\": null, \"name\": null}]";
        var path = TypeParser.ParsePath(json);
        Assert.Equal("", path.Nodes[0].Table); // GetString() on null returns null, then ?? ""
        Assert.Null(path.Nodes[0].Id);
        Assert.Null(path.Nodes[0].Properties["name"]);
    }

    [Fact]
    public void ParsePath_EvenLengthArray_TrailingEdgeWithoutTargetNode()
    {
        var json = JsonSerializer.Serialize(new object[]
        {
            new { table = "users", id = 1 },
            new { edge_type = "follows", from_id = 1, to_id = 2 }
        });
        var path = TypeParser.ParsePath(json);
        Assert.Single(path.Nodes);
        Assert.Single(path.Edges);
    }

    [Fact]
    public void ParsePath_LongPath_100Nodes99Edges()
    {
        var elements = new List<object>();
        for (var i = 0; i < 100; i++)
        {
            elements.Add(new { table = "nodes", id = i });
            if (i < 99)
                elements.Add(new { edge_type = "connects", from_id = i, to_id = i + 1 });
        }
        var json = JsonSerializer.Serialize(elements);
        var path = TypeParser.ParsePath(json);
        Assert.Equal(100, path.Nodes.Count);
        Assert.Equal(99, path.Edges.Count);
        Assert.Equal(99, path.PathLength);
    }

    [Fact]
    public void ParsePath_NodeOrderPreserved()
    {
        var json = JsonSerializer.Serialize(new object[]
        {
            new { table = "users", id = "first" },
            new { edge_type = "follows", from_id = "first", to_id = "second" },
            new { table = "users", id = "second" },
            new { edge_type = "follows", from_id = "second", to_id = "third" },
            new { table = "users", id = "third" }
        });
        var path = TypeParser.ParsePath(json);
        Assert.Equal("first", path.Nodes[0].Id);
        Assert.Equal("second", path.Nodes[1].Id);
        Assert.Equal("third", path.Nodes[2].Id);
    }

    [Fact]
    public void ParsePath_EdgeOrderPreserved()
    {
        var json = JsonSerializer.Serialize(new object[]
        {
            new { table = "users", id = 1 },
            new { edge_type = "alpha", from_id = 1, to_id = 2 },
            new { table = "users", id = 2 },
            new { edge_type = "beta", from_id = 2, to_id = 3 },
            new { table = "users", id = 3 }
        });
        var path = TypeParser.ParsePath(json);
        Assert.Equal("alpha", path.Edges[0].EdgeType);
        Assert.Equal("beta", path.Edges[1].EdgeType);
    }

    [Fact]
    public void ParsePath_NodeWithManyProperties_AllPreserved()
    {
        var props = new Dictionary<string, object>();
        for (var i = 0; i < 50; i++)
            props[$"prop_{i}"] = $"value_{i}";
        props["table"] = "users";
        props["id"] = 1;

        var json = JsonSerializer.Serialize(new object[] { props });
        var path = TypeParser.ParsePath(json);
        Assert.Equal(50, path.Nodes[0].Properties.Count);
        Assert.Equal("value_0", path.Nodes[0].Properties["prop_0"]);
        Assert.Equal("value_49", path.Nodes[0].Properties["prop_49"]);
    }

    [Fact]
    public void ParsePath_EdgeWithExtraProperties_AllPreserved()
    {
        var json = JsonSerializer.Serialize(new object[]
        {
            new { table = "a", id = 1 },
            new { edge_type = "rel", from_id = 1, to_id = 2, weight = 0.5, label = "test", count = 42 },
            new { table = "b", id = 2 }
        });
        var path = TypeParser.ParsePath(json);
        Assert.Equal(0.5, path.Edges[0].Properties["weight"]);
        Assert.Equal("test", path.Edges[0].Properties["label"]);
        Assert.Equal((long)42, path.Edges[0].Properties["count"]);
    }

    [Fact]
    public void ParsePath_BooleanPropertyValues_Handled()
    {
        var json = "[{\"table\": \"users\", \"id\": 1, \"active\": true, \"deleted\": false}]";
        var path = TypeParser.ParsePath(json);
        Assert.Equal(true, path.Nodes[0].Properties["active"]);
        Assert.Equal(false, path.Nodes[0].Properties["deleted"]);
    }

    [Fact]
    public void ParsePath_GraphPathPathLength_EqualsEdgeCount()
    {
        var json = JsonSerializer.Serialize(new object[]
        {
            new { table = "a", id = 1 },
            new { edge_type = "e1", from_id = 1, to_id = 2 },
            new { table = "b", id = 2 },
            new { edge_type = "e2", from_id = 2, to_id = 3 },
            new { table = "c", id = 3 }
        });
        var path = TypeParser.ParsePath(json);
        Assert.Equal(2, path.PathLength);
        Assert.Equal(path.Edges.Count, path.PathLength);
    }

    // ── ParsePath — TypeOid.Path integration ────────────────────────────

    [Fact]
    public void ParseValue_PathTypeOid_DelegatestoParsePathIntegration()
    {
        var json = JsonSerializer.Serialize(new object[]
        {
            new { table = "users", id = 1 },
            new { edge_type = "follows", from_id = 1, to_id = 2 },
            new { table = "users", id = 2 }
        });
        var result = TypeParser.ParseValue(json, TypeOid.Path) as GraphPath;
        Assert.NotNull(result);
        Assert.Equal(2, result.Nodes.Count);
        Assert.Single(result.Edges);
    }

    [Fact]
    public void ParseValue_PathTypeOid_EmptyArray()
    {
        var result = TypeParser.ParseValue("[]", TypeOid.Path) as GraphPath;
        Assert.NotNull(result);
        Assert.Empty(result.Nodes);
        Assert.Empty(result.Edges);
    }

    [Fact]
    public void ParseValue_PathTypeOid_InvalidJson_Throws()
    {
        Assert.ThrowsAny<Exception>(() => TypeParser.ParseValue("{invalid", TypeOid.Path));
    }

    [Fact]
    public void ParseValue_PathTypeOid_NullValue_ReturnsNull()
    {
        var result = TypeParser.ParseValue(null, TypeOid.Path);
        Assert.Null(result);
    }

    [Fact]
    public void TypeOid_PathConstant_Is100006()
    {
        Assert.Equal(100006, TypeOid.Path);
    }

    // =====================================================================
    // SQL injection resistance — MATCH/SHORTEST MATCH/SHORTEST PATH
    // =====================================================================

    [Fact]
    public void BuildMatch_SqlInjectionInTableName_Escaped()
    {
        var pattern = new object[]
        {
            new MatchNode { Alias = "a", Table = "\"; DROP TABLE users; --" },
            new MatchEdge { Alias = "r", EdgeType = "follows", Direction = "OUT" },
            new MatchNode { Alias = "b", Table = "users" }
        };
        var result = QueryBuilder.BuildMatch(pattern, new MatchOptions { ReturnItems = ["a"] });
        Assert.Contains("\"\"\"; DROP TABLE users; --\"", result.Text);
    }

    [Fact]
    public void BuildMatch_SqlInjectionInEdgeType_Escaped()
    {
        var pattern = new object[]
        {
            new MatchNode { Alias = "a", Table = "users" },
            new MatchEdge { Alias = "r", EdgeType = "\"; DROP TABLE", Direction = "OUT" },
            new MatchNode { Alias = "b", Table = "users" }
        };
        var result = QueryBuilder.BuildMatch(pattern, new MatchOptions { ReturnItems = ["a"] });
        Assert.Contains("\"\"\"; DROP TABLE\"", result.Text);
    }

    [Fact]
    public void BuildShortestPath_SqlInjectionInIdentifiers_Escaped()
    {
        var result = QueryBuilder.BuildShortestPath("\"evil", "\"table", 1, "\"table", 2);
        Assert.Contains("\"\"\"evil\"", result.Text);
        Assert.Contains("\"\"\"table\"", result.Text);
    }

    [Fact]
    public void BuildShortestMatch_SqlInjectionInPattern_Escaped()
    {
        var pattern = new object[]
        {
            new MatchNode { Alias = "a", Table = "\"; DROP TABLE x; --" },
            new MatchEdge { Alias = "r", EdgeType = "follows", Direction = "OUT" },
            new MatchNode { Alias = "b", Table = "users" }
        };
        var result = QueryBuilder.BuildShortestMatch(pattern, ["a"],
            ShortestMatchSelector.AnyShortest);
        Assert.Contains("\"\"\"; DROP TABLE x; --\"", result.Text);
    }

    // =====================================================================
    // AC verification — MATCH builder generates SELECT...FROM MATCH (#1)
    // =====================================================================

    [Fact]
    public void AC1_MatchBuilder_GeneratesSelectFromMatch()
    {
        var result = QueryBuilder.BuildMatch(StandardPattern(), new MatchOptions
        {
            ReturnItems = ["a", "r", "b"]
        });
        Assert.Matches("^SELECT .+ FROM MATCH ", result.Text);
    }

    // =====================================================================
    // AC verification — Hop quantifiers supported (#2)
    // =====================================================================

    [Fact]
    public void AC2_HopQuantifier_MinMax()
    {
        var pattern = new object[]
        {
            new MatchNode { Alias = "a", Table = "users" },
            new MatchEdge { Alias = "r", EdgeType = "follows", Direction = "OUT", Quantifier = "{2,5}" },
            new MatchNode { Alias = "b", Table = "users" }
        };
        var result = QueryBuilder.BuildMatch(pattern, new MatchOptions { ReturnItems = ["a", "b"] });
        Assert.Contains("{2,5}", result.Text);
    }

    [Fact]
    public void AC2_HopQuantifier_Plus()
    {
        var pattern = new object[]
        {
            new MatchNode { Alias = "a", Table = "users" },
            new MatchEdge { Alias = "r", EdgeType = "follows", Direction = "OUT", Quantifier = "+" },
            new MatchNode { Alias = "b", Table = "users" }
        };
        var result = QueryBuilder.BuildMatch(pattern, new MatchOptions { ReturnItems = ["a", "b"] });
        Assert.Contains("->+", result.Text);
    }

    [Fact]
    public void AC2_HopQuantifier_Star()
    {
        var pattern = new object[]
        {
            new MatchNode { Alias = "a", Table = "users" },
            new MatchEdge { Alias = "r", EdgeType = "follows", Direction = "OUT", Quantifier = "*" },
            new MatchNode { Alias = "b", Table = "users" }
        };
        var result = QueryBuilder.BuildMatch(pattern, new MatchOptions { ReturnItems = ["a", "b"] });
        Assert.Contains("->*", result.Text);
    }

    // =====================================================================
    // AC verification — Path selector builder works (#3)
    // =====================================================================

    [Fact]
    public void AC3_PathSelector_AnyShortest()
    {
        var result = QueryBuilder.BuildShortestMatch(StandardPattern(), ["a", "b"],
            ShortestMatchSelector.AnyShortest);
        Assert.Contains("ANY SHORTEST", result.Text);
        Assert.Matches("^SELECT .+ FROM MATCH ", result.Text);
    }

    [Fact]
    public void AC3_PathSelector_AllShortest()
    {
        var result = QueryBuilder.BuildShortestMatch(StandardPattern(), ["a", "b"],
            ShortestMatchSelector.AllShortest);
        Assert.Contains("ALL SHORTEST", result.Text);
    }

    [Fact]
    public void AC3_PathSelector_ShortestK()
    {
        var result = QueryBuilder.BuildShortestMatch(StandardPattern(), ["a", "b"],
            ShortestMatchSelector.Shortest, new ShortestMatchOptions { K = 5 });
        Assert.Contains("SHORTEST 5", result.Text);
    }

    [Fact]
    public void AC3_PathSelector_WithWeight()
    {
        var result = QueryBuilder.BuildShortestMatch(StandardPattern(), ["a", "b"],
            ShortestMatchSelector.AnyShortest, new ShortestMatchOptions { Weight = "r.cost" });
        Assert.Contains("WEIGHT r.cost", result.Text);
    }

    // =====================================================================
    // AC verification — SHORTEST PATH SELECT composability (#4)
    // =====================================================================

    [Fact]
    public void AC4_ShortestPath_SelectStarFromByDefault()
    {
        var result = QueryBuilder.BuildShortestPath("follows", "users", 1, "users", 2);
        Assert.Matches("^SELECT \\* FROM SHORTEST PATH", result.Text);
    }

    [Fact]
    public void AC4_ShortestPath_CustomSelectClause()
    {
        var result = QueryBuilder.BuildShortestPath("follows", "users", 1, "users", 2,
            new ShortestPathOptions { Select = "path_length, nodes" });
        Assert.Matches("^SELECT path_length, nodes FROM SHORTEST PATH", result.Text);
    }

    // =====================================================================
    // AC verification — Path result parsing with C# types (#5)
    // =====================================================================

    [Fact]
    public void AC5_PathParsing_CSharpTypes()
    {
        var json = JsonSerializer.Serialize(new object[]
        {
            new { table = "users", id = 1, name = "Alice" },
            new { edge_type = "follows", from_id = 1, to_id = 2 },
            new { table = "users", id = 2, name = "Bob" }
        });
        var path = TypeParser.ParsePath(json);

        // Verify PathNode shape
        Assert.IsType<PathNode>(path.Nodes[0]);
        Assert.NotNull(path.Nodes[0].Table);
        Assert.NotNull(path.Nodes[0].Id);
        Assert.NotNull(path.Nodes[0].Properties);

        // Verify PathEdge shape
        Assert.IsType<PathEdge>(path.Edges[0]);
        Assert.NotNull(path.Edges[0].EdgeType);
        Assert.NotNull(path.Edges[0].FromId);
        Assert.NotNull(path.Edges[0].ToId);
        Assert.NotNull(path.Edges[0].Properties);

        // Verify GraphPath shape
        Assert.IsType<GraphPath>(path);
        Assert.Equal(path.Edges.Count, path.PathLength);
    }

    // =====================================================================
    // AC verification — Backward compatibility preserved (#7)
    // =====================================================================

    [Fact]
    public void AC7_BackwardCompat_LegacyMatch()
    {
        var legacy = QueryBuilder.BuildMatch(StandardPattern(), new MatchOptions
        {
            ReturnItems = ["a", "b"],
            LegacySyntax = true
        });
        var modern = QueryBuilder.BuildMatch(StandardPattern(), new MatchOptions
        {
            ReturnItems = ["a", "b"]
        });

        Assert.StartsWith("MATCH ", legacy.Text);
        Assert.Contains("RETURN a, b", legacy.Text);
        Assert.DoesNotContain("SELECT", legacy.Text);

        Assert.StartsWith("SELECT a, b FROM MATCH", modern.Text);
        Assert.DoesNotContain("RETURN", modern.Text);
    }

    [Fact]
    public void AC7_BackwardCompat_LegacyShortestPath()
    {
        var legacy = QueryBuilder.BuildShortestPath("follows", "users", 1, "users", 2,
            new ShortestPathOptions { LegacySyntax = true });
        var modern = QueryBuilder.BuildShortestPath("follows", "users", 1, "users", 2);

        Assert.StartsWith("SHORTEST PATH FROM", legacy.Text);
        Assert.DoesNotContain("SELECT", legacy.Text);

        Assert.StartsWith("SELECT * FROM", modern.Text);
    }

}
