using System.Reflection;
using System.Text;

namespace SixSevenDB.Client.Tests;

/// <summary>
/// Adversarial QA regression tests for GDB-493 (.NET algorithm query builders).
///
/// These tests are intentionally trying to break the 11 algorithm builders:
///   BuildPageRank, BuildBetweennessCentrality, BuildConnectedComponents,
///   BuildLouvain, BuildDegreeCentrality, BuildClosenessCentrality,
///   BuildEigenvectorCentrality, BuildHarmonicCentrality, BuildClusteringCoefficient,
///   BuildTriangleCount, BuildStronglyConnectedComponents.
///
/// Particular focus areas (informed by sibling Python/Node bugs
/// GDB-662/663/664/665/666):
///   * SQL injection — confirm edgeType is bound as a parameter, never interpolated
///   * No back-door 'select' overload exposing the raw SQL projection surface
///   * Numeric edge cases (NaN, infinities, -0.0, denormals, 0/1 boundaries)
///   * Whitespace/null/empty edgeType
///   * Unicode edgeType (emoji, RTL marks, BOM, combining chars)
///   * Enum coverage with undefined values (DegreeDirection, ClosenessVariant)
///   * Builders are pure / synchronous / thread-safe
///   * XML doc claims (declared exception types match thrown ones)
///   * Parameter ordering ($1..$N matches Values count and order)
/// </summary>
public class QaGdb493AlgorithmBuildersTests
{
    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    /// <summary>
    /// All zero-extra-arg builders take only an edgeType. Used to factor
    /// the cross-cutting edgeType validation tests.
    /// </summary>
    private static readonly (string Name, Func<string, ParameterizedQuery> Build, string FuncName)[]
        SimpleBuilders =
        [
            ("BetweennessCentrality", QueryBuilder.BuildBetweennessCentrality, "betweenness_centrality"),
            ("ConnectedComponents", QueryBuilder.BuildConnectedComponents, "connected_components"),
            ("HarmonicCentrality", QueryBuilder.BuildHarmonicCentrality, "harmonic_centrality"),
            ("ClusteringCoefficient", QueryBuilder.BuildClusteringCoefficient, "clustering_coefficient"),
            ("TriangleCount", QueryBuilder.BuildTriangleCount, "triangle_count"),
            ("StronglyConnectedComponents", QueryBuilder.BuildStronglyConnectedComponents, "strongly_connected_components"),
        ];

    public static IEnumerable<object[]> SimpleBuilderNames =>
        SimpleBuilders.Select(b => new object[] { b.Name });

    private static Func<string, ParameterizedQuery> SimpleByName(string name) =>
        SimpleBuilders.First(b => b.Name == name).Build;

    private static string SimpleFuncByName(string name) =>
        SimpleBuilders.First(b => b.Name == name).FuncName;

    // -----------------------------------------------------------------------
    // SQL injection: edgeType MUST be bound as $1, never interpolated.
    // -----------------------------------------------------------------------

    /// <summary>
    /// Classic SQL-injection payloads the implementation must NOT splice
    /// into the SQL text. The expected behavior is that the entire payload
    /// appears verbatim in <see cref="ParameterizedQuery.Values"/>[0] and
    /// nowhere in the query <c>Text</c>.
    /// </summary>
    public static readonly string[] InjectionPayloads =
    [
        "knows; DROP TABLE users; --",
        "knows' OR '1'='1",
        "knows\"); DELETE FROM users; --",
        "knows\\\"; DROP",
        "knows /* comment */ UNION SELECT password FROM users",
        "knows --",
        "knows\0DROP",        // embedded null byte
        "knows\nUNION SELECT 1",  // embedded newline
        "knows\rDROP",            // embedded carriage return
        "knows\tDROP",            // embedded tab
        "$1; DROP TABLE x;",      // pretend to be a positional param
        "',$2,'",                 // try to break out of parameter binding
        "\"; SELECT * FROM information_schema.tables; --",
    ];

    public static IEnumerable<object[]> AllAlgorithmsAndPayloads()
    {
        foreach (var payload in InjectionPayloads)
        {
            yield return new object[] { "PageRank", payload };
            yield return new object[] { "Louvain", payload };
            yield return new object[] { "DegreeCentrality", payload };
            yield return new object[] { "ClosenessCentrality", payload };
            yield return new object[] { "EigenvectorCentrality", payload };
            foreach (var b in SimpleBuilders)
                yield return new object[] { b.Name, payload };
        }
    }

    [Theory]
    [MemberData(nameof(AllAlgorithmsAndPayloads))]
    public void EdgeType_NeverInterpolated_AlwaysBoundAsFirstParameter(string algorithm, string payload)
    {
        var query = InvokeAlgorithm(algorithm, payload);

        Assert.Equal(payload, query.Values[0]);

        // The query text must contain no fragment of the payload.
        // We pick a few stable, distinctive substrings to look for.
        var text = query.Text;
        Assert.DoesNotContain(payload, text);
        Assert.DoesNotContain("DROP", text, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("UNION", text, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("DELETE", text, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("--", text);
        Assert.DoesNotContain("/*", text);
        Assert.False(text.Contains('\n'), "SQL text must not contain newlines");
        Assert.False(text.Contains('\r'), "SQL text must not contain CR");
        Assert.False(text.Contains('\t'), "SQL text must not contain tab");
        Assert.False(text.Contains('\0'), "SQL text must not contain NUL");
        Assert.False(text.Contains('\''), "SQL text must not contain quotes");
        // SQL text must follow the rigid template: SELECT * FROM <name>($1, $2, ...)
        Assert.Matches(@"^SELECT \* FROM [a-z_]+\(\$\d+(, \$\d+)*\)$", text);
    }

    /// <summary>
    /// Invoke one of the 11 algorithm builders by short name with only an
    /// edgeType. Builders that require additional parameters fall back to
    /// their default values.
    /// </summary>
    private static ParameterizedQuery InvokeAlgorithm(string name, string edgeType) =>
        name switch
        {
            "PageRank" => QueryBuilder.BuildPageRank(edgeType),
            "Louvain" => QueryBuilder.BuildLouvain(edgeType),
            "DegreeCentrality" => QueryBuilder.BuildDegreeCentrality(edgeType),
            "ClosenessCentrality" => QueryBuilder.BuildClosenessCentrality(edgeType),
            "EigenvectorCentrality" => QueryBuilder.BuildEigenvectorCentrality(edgeType),
            _ => SimpleByName(name)(edgeType),
        };

    // -----------------------------------------------------------------------
    // No 'select' back-door — closes the GDB-665/666 SQLi class entirely.
    // -----------------------------------------------------------------------

    /// <summary>
    /// The .NET implementer deliberately omitted the user-controlled
    /// projection. Reflection over every public/non-public, instance/static
    /// method on <see cref="QueryBuilder"/> must show that no algorithm
    /// builder takes a parameter that smells like a SELECT projection.
    /// </summary>
    [Fact]
    public void NoAlgorithmBuilder_ExposesUserControlledSelect()
    {
        const BindingFlags flags =
            BindingFlags.Public | BindingFlags.NonPublic |
            BindingFlags.Static | BindingFlags.Instance | BindingFlags.DeclaredOnly;

        var algorithmMethods = typeof(QueryBuilder)
            .GetMethods(flags)
            .Where(m => m.Name.StartsWith("Build", StringComparison.Ordinal))
            .Where(m => m.Name.Contains("PageRank") ||
                        m.Name.Contains("Centrality") ||
                        m.Name.Contains("ConnectedComponents") ||
                        m.Name.Contains("Louvain") ||
                        m.Name.Contains("ClusteringCoefficient") ||
                        m.Name.Contains("TriangleCount"))
            .ToList();

        Assert.NotEmpty(algorithmMethods);

        foreach (var method in algorithmMethods)
        {
            foreach (var p in method.GetParameters())
            {
                var lname = p.Name?.ToLowerInvariant() ?? "";
                Assert.False(
                    lname == "select" || lname == "projection" || lname == "columns",
                    $"{method.Name} exposes user-controlled projection parameter '{p.Name}'");
            }
        }
    }

    /// <summary>
    /// Algorithm builders generate SQL of the form
    /// <c>SELECT * FROM &lt;funcName&gt;($1, ...)</c>. The projection must always
    /// be the literal <c>*</c> — there must be no opportunity for a caller
    /// to influence what columns are selected.
    /// </summary>
    [Fact]
    public void AllAlgorithmBuilders_AlwaysProjectStar()
    {
        var queries = new[]
        {
            QueryBuilder.BuildPageRank("e"),
            QueryBuilder.BuildBetweennessCentrality("e"),
            QueryBuilder.BuildConnectedComponents("e"),
            QueryBuilder.BuildLouvain("e"),
            QueryBuilder.BuildDegreeCentrality("e"),
            QueryBuilder.BuildClosenessCentrality("e"),
            QueryBuilder.BuildEigenvectorCentrality("e"),
            QueryBuilder.BuildHarmonicCentrality("e"),
            QueryBuilder.BuildClusteringCoefficient("e"),
            QueryBuilder.BuildTriangleCount("e"),
            QueryBuilder.BuildStronglyConnectedComponents("e"),
        };

        foreach (var q in queries)
            Assert.StartsWith("SELECT * FROM ", q.Text);
    }

    // -----------------------------------------------------------------------
    // edgeType validation across all 11 builders
    // -----------------------------------------------------------------------

    public static IEnumerable<object[]> BadEdgeTypeRows()
    {
        var bad = new string?[] { null, "", " ", "   ", "\t", "\n", "\r\n", "\t \r\n " };
        foreach (var v in bad)
        {
            yield return new object?[] { "PageRank", v };
            yield return new object?[] { "Louvain", v };
            yield return new object?[] { "DegreeCentrality", v };
            yield return new object?[] { "ClosenessCentrality", v };
            yield return new object?[] { "EigenvectorCentrality", v };
            foreach (var b in SimpleBuilders)
                yield return new object?[] { b.Name, v };
        }
    }

    [Theory]
    [MemberData(nameof(BadEdgeTypeRows))]
    public void EdgeType_NullEmptyOrWhitespace_Throws(string algorithm, string? edgeType)
    {
        Assert.Throws<ArgumentException>(() => InvokeAlgorithm(algorithm, edgeType!));
    }

    // -----------------------------------------------------------------------
    // Unicode edgeType — must be accepted and bound verbatim
    // -----------------------------------------------------------------------

    public static IEnumerable<object[]> UnicodeEdgeTypes()
    {
        // emoji
        yield return new object[] { "knows😀" };
        // combining characters: e + combining acute
        yield return new object[] { "knóws" };
        // RTL marker mid-string
        yield return new object[] { "knows‏backwards" };
        // BOM / ZWNBSP
        yield return new object[] { "﻿knows" };
        // CJK
        yield return new object[] { "知っている" };
        // very long unicode
        yield return new object[] { new string('中', 10_000) };
    }

    [Theory]
    [MemberData(nameof(UnicodeEdgeTypes))]
    public void EdgeType_Unicode_BoundVerbatim(string edgeType)
    {
        var q = QueryBuilder.BuildPageRank(edgeType);
        Assert.Equal(edgeType, q.Values[0]);
        Assert.Equal("SELECT * FROM pagerank($1, $2, $3)", q.Text);
    }

    [Fact]
    public void EdgeType_VeryLongAscii_Accepted_NoLengthCap()
    {
        // The .NET surface deliberately has no length cap — confirm a
        // multi-megabyte edgeType still binds cleanly. (Length capping is
        // the server's responsibility once the value reaches it.)
        var huge = new string('a', 1_000_000);
        var q = QueryBuilder.BuildTriangleCount(huge);
        Assert.Equal(huge, q.Values[0]);
        Assert.Equal("SELECT * FROM triangle_count($1)", q.Text);
    }

    // -----------------------------------------------------------------------
    // Numeric validation — PageRank.damping is open interval (0, 1)
    // -----------------------------------------------------------------------

    [Theory]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    [InlineData(double.NegativeInfinity)]
    public void PageRank_DampingNonFinite_Throws(double damping)
    {
        Assert.Throws<ArgumentException>(() => QueryBuilder.BuildPageRank("knows", damping: damping));
    }

    [Theory]
    [InlineData(0.0)]
    [InlineData(-0.0)]
    [InlineData(1.0)]
    [InlineData(-0.1)]
    [InlineData(1.1)]
    [InlineData(double.MinValue)]
    [InlineData(double.MaxValue)]
    public void PageRank_DampingOutsideOpenUnitInterval_Throws(double damping)
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => QueryBuilder.BuildPageRank("knows", damping: damping));
    }

    [Theory]
    [InlineData(double.Epsilon)]    // smallest positive subnormal
    [InlineData(1e-300)]
    [InlineData(0.5)]
    [InlineData(0.999999999)]
    public void PageRank_DampingInsideOpenUnitInterval_Accepted(double damping)
    {
        var q = QueryBuilder.BuildPageRank("knows", damping: damping);
        Assert.Equal(damping, q.Values[1]);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(int.MinValue)]
    public void PageRank_IterationsNotPositive_Throws(int iterations)
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => QueryBuilder.BuildPageRank("knows", iterations: iterations));
    }

    [Fact]
    public void PageRank_IterationsAtIntMax_Accepted()
    {
        // Boundary: int.MaxValue is valid by the validator; the server gets
        // to decide whether it can actually run that many iterations.
        var q = QueryBuilder.BuildPageRank("knows", iterations: int.MaxValue);
        Assert.Equal(int.MaxValue, q.Values[2]);
    }

    // -----------------------------------------------------------------------
    // Numeric validation — Louvain.resolution > 0
    // -----------------------------------------------------------------------

    [Theory]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    [InlineData(double.NegativeInfinity)]
    public void Louvain_ResolutionNonFinite_Throws(double resolution)
    {
        Assert.Throws<ArgumentException>(() => QueryBuilder.BuildLouvain("knows", resolution));
    }

    [Theory]
    [InlineData(0.0)]
    [InlineData(-0.0)]
    [InlineData(-1e-300)]
    [InlineData(double.MinValue)]
    public void Louvain_ResolutionNotPositive_Throws(double resolution)
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => QueryBuilder.BuildLouvain("knows", resolution));
    }

    [Theory]
    [InlineData(double.Epsilon)]
    [InlineData(double.MaxValue)]
    [InlineData(1.0)]
    public void Louvain_ResolutionPositive_Accepted(double resolution)
    {
        var q = QueryBuilder.BuildLouvain("knows", resolution);
        Assert.Equal(resolution, q.Values[1]);
    }

    // -----------------------------------------------------------------------
    // Numeric validation — EigenvectorCentrality(iterations, tolerance)
    // -----------------------------------------------------------------------

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(int.MinValue)]
    public void Eigenvector_IterationsNotPositive_Throws(int iterations)
    {
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            QueryBuilder.BuildEigenvectorCentrality("knows", iterations: iterations));
    }

    [Theory]
    [InlineData(double.NaN)]
    [InlineData(double.PositiveInfinity)]
    [InlineData(double.NegativeInfinity)]
    public void Eigenvector_ToleranceNonFinite_Throws(double tolerance)
    {
        Assert.Throws<ArgumentException>(() =>
            QueryBuilder.BuildEigenvectorCentrality("knows", tolerance: tolerance));
    }

    [Theory]
    [InlineData(0.0)]
    [InlineData(-0.0)]
    [InlineData(-1e-300)]
    public void Eigenvector_ToleranceNotPositive_Throws(double tolerance)
    {
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            QueryBuilder.BuildEigenvectorCentrality("knows", tolerance: tolerance));
    }

    [Fact]
    public void Eigenvector_DenormalToleranceAccepted()
    {
        var q = QueryBuilder.BuildEigenvectorCentrality("knows", tolerance: double.Epsilon);
        Assert.Equal(double.Epsilon, q.Values[2]);
    }

    // -----------------------------------------------------------------------
    // Enum coverage — undefined enum values must throw
    // -----------------------------------------------------------------------

    [Theory]
    [InlineData(999)]
    [InlineData(-1)]
    [InlineData(int.MaxValue)]
    [InlineData(int.MinValue)]
    public void DegreeCentrality_UndefinedEnumValue_Throws(int raw)
    {
        var dir = (DegreeDirection)raw;
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            QueryBuilder.BuildDegreeCentrality("knows", dir));
    }

    [Theory]
    [InlineData(999)]
    [InlineData(-1)]
    [InlineData(int.MaxValue)]
    [InlineData(int.MinValue)]
    public void ClosenessCentrality_UndefinedEnumValue_Throws(int raw)
    {
        var v = (ClosenessVariant)raw;
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            QueryBuilder.BuildClosenessCentrality("knows", v));
    }

    [Theory]
    [InlineData(DegreeDirection.In, "IN")]
    [InlineData(DegreeDirection.Out, "OUT")]
    [InlineData(DegreeDirection.Both, "BOTH")]
    public void DegreeCentrality_DefinedEnumValues_BoundCorrectly(DegreeDirection dir, string expected)
    {
        var q = QueryBuilder.BuildDegreeCentrality("knows", dir);
        Assert.Equal(expected, q.Values[1]);
    }

    [Theory]
    [InlineData(ClosenessVariant.Standard, "STANDARD")]
    [InlineData(ClosenessVariant.WassermanFaust, "WASSERMAN_FAUST")]
    [InlineData(ClosenessVariant.Harmonic, "HARMONIC")]
    public void ClosenessCentrality_DefinedEnumValues_BoundCorrectly(ClosenessVariant v, string expected)
    {
        var q = QueryBuilder.BuildClosenessCentrality("knows", v);
        Assert.Equal(expected, q.Values[1]);
    }

    // -----------------------------------------------------------------------
    // Parameter ordering — $1..$N matches Values length and order
    // -----------------------------------------------------------------------

    [Fact]
    public void ParameterPlaceholders_MatchValueCount_AcrossAllBuilders()
    {
        var rows = new (ParameterizedQuery Query, int Expected)[]
        {
            (QueryBuilder.BuildPageRank("e"), 3),
            (QueryBuilder.BuildBetweennessCentrality("e"), 1),
            (QueryBuilder.BuildConnectedComponents("e"), 1),
            (QueryBuilder.BuildLouvain("e"), 2),
            (QueryBuilder.BuildDegreeCentrality("e"), 2),
            (QueryBuilder.BuildClosenessCentrality("e"), 2),
            (QueryBuilder.BuildEigenvectorCentrality("e"), 3),
            (QueryBuilder.BuildHarmonicCentrality("e"), 1),
            (QueryBuilder.BuildClusteringCoefficient("e"), 1),
            (QueryBuilder.BuildTriangleCount("e"), 1),
            (QueryBuilder.BuildStronglyConnectedComponents("e"), 1),
        };

        foreach (var (q, expected) in rows)
        {
            Assert.Equal(expected, q.Values.Length);
            for (var i = 1; i <= expected; i++)
                Assert.Contains($"${i}", q.Text);
            // No off-by-one — ${expected+1} should NOT appear.
            Assert.DoesNotContain($"${expected + 1}", q.Text);
        }
    }

    [Fact]
    public void SimpleBuilders_GenerateExpectedFunctionName()
    {
        foreach (var (name, build, funcName) in SimpleBuilders)
        {
            var q = build("e");
            Assert.Equal($"SELECT * FROM {funcName}($1)", q.Text);
            Assert.Single(q.Values);
            Assert.Equal("e", q.Values[0]);
        }
    }

    // -----------------------------------------------------------------------
    // XML doc claims — declared exception types match thrown ones
    // -----------------------------------------------------------------------

    [Fact]
    public void PageRank_BadEdgeType_ThrowsArgumentException_AsDocumented()
    {
        // <exception cref="ArgumentException"> is documented for null/empty/whitespace
        var ex = Assert.Throws<ArgumentException>(() => QueryBuilder.BuildPageRank(""));
        Assert.Equal("edgeType", ex.ParamName);
    }

    [Fact]
    public void PageRank_NonFiniteDamping_ThrowsArgumentException_AsDocumented()
    {
        var ex = Assert.Throws<ArgumentException>(() =>
            QueryBuilder.BuildPageRank("knows", damping: double.NaN));
        Assert.Equal("damping", ex.ParamName);
    }

    [Fact]
    public void PageRank_OutOfRangeDamping_ThrowsArgumentOutOfRange_AsDocumented()
    {
        var ex = Assert.Throws<ArgumentOutOfRangeException>(() =>
            QueryBuilder.BuildPageRank("knows", damping: 1.5));
        Assert.Equal("damping", ex.ParamName);
    }

    [Fact]
    public void PageRank_NonPositiveIterations_ThrowsArgumentOutOfRange_AsDocumented()
    {
        // XML doc for PageRank says iterations triggers ArgumentOutOfRangeException.
        // The implementation routes through AssertPositiveInt, which throws
        // ArgumentException. This test pins down what currently happens.
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            QueryBuilder.BuildPageRank("knows", iterations: 0));
    }

    [Fact]
    public void Eigenvector_NonPositiveIterations_ThrowsArgumentOutOfRange_AsDocumented()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() =>
            QueryBuilder.BuildEigenvectorCentrality("knows", iterations: 0));
    }

    // -----------------------------------------------------------------------
    // Builders are pure / synchronous / thread-safe
    // -----------------------------------------------------------------------

    [Fact]
    public void Builders_AreSynchronous_NoTaskReturnTypes()
    {
        const BindingFlags flags = BindingFlags.Public | BindingFlags.Static | BindingFlags.DeclaredOnly;
        foreach (var m in typeof(QueryBuilder).GetMethods(flags)
                     .Where(m => m.Name.StartsWith("Build", StringComparison.Ordinal)))
        {
            Assert.False(typeof(Task).IsAssignableFrom(m.ReturnType),
                $"{m.Name} returns Task — algorithm builders should be sync");
            Assert.False(m.ReturnType.IsGenericType &&
                         m.ReturnType.GetGenericTypeDefinition() == typeof(ValueTask<>),
                $"{m.Name} returns ValueTask<T> — algorithm builders should be sync");
        }
    }

    [Fact]
    public void Builders_ArePure_RepeatedCallsProduceEqualOutput()
    {
        for (var i = 0; i < 50; i++)
        {
            var a = QueryBuilder.BuildPageRank("knows", 0.85, 20);
            var b = QueryBuilder.BuildPageRank("knows", 0.85, 20);
            Assert.Equal(a.Text, b.Text);
            Assert.Equal(a.Values, b.Values);
        }
    }

    [Fact]
    public void Builders_AreThreadSafe_UnderConcurrentInvocation()
    {
        const int n = 200;
        var results = new ParameterizedQuery[n];
        Parallel.For(0, n, i =>
        {
            results[i] = QueryBuilder.BuildEigenvectorCentrality(
                $"edge_{i % 7}", iterations: 10 + (i % 5), tolerance: 1e-6);
        });

        for (var i = 0; i < n; i++)
        {
            Assert.Equal("SELECT * FROM eigenvector_centrality($1, $2, $3)", results[i].Text);
            Assert.Equal($"edge_{i % 7}", results[i].Values[0]);
            Assert.Equal(10 + (i % 5), results[i].Values[1]);
            Assert.Equal(1e-6, results[i].Values[2]);
        }
    }

    // -----------------------------------------------------------------------
    // Reflection — no internal/private back-door overload exposes 'select'
    // -----------------------------------------------------------------------

    [Fact]
    public void NoInternalOrPrivateAlgorithmOverload_LeaksSelectParameter()
    {
        const BindingFlags flags =
            BindingFlags.Public | BindingFlags.NonPublic |
            BindingFlags.Static | BindingFlags.Instance | BindingFlags.DeclaredOnly;

        // Even compiler-generated, internal, and private members must not
        // expose a 'select' / 'projection' / 'columns' / 'sql' parameter on
        // anything that smells like an algorithm builder.
        foreach (var m in typeof(QueryBuilder).GetMethods(flags))
        {
            if (m.Name == "BuildAlgorithmSql") continue; // legitimate internal helper

            var isAlgoBuilder = m.Name.StartsWith("Build", StringComparison.Ordinal) &&
                (m.Name.Contains("PageRank") ||
                 m.Name.Contains("Centrality") ||
                 m.Name.Contains("ConnectedComponents") ||
                 m.Name.Contains("Louvain") ||
                 m.Name.Contains("ClusteringCoefficient") ||
                 m.Name.Contains("TriangleCount"));

            if (!isAlgoBuilder) continue;

            foreach (var p in m.GetParameters())
            {
                var n = p.Name?.ToLowerInvariant() ?? "";
                Assert.False(n is "select" or "projection" or "columns" or "sql" or "rawsql",
                    $"{m.Name} has back-door parameter '{p.Name}'");
            }
        }
    }

    // -----------------------------------------------------------------------
    // Smoke: literal SQL spelling for every builder. These pin the exact
    // wire-protocol text so accidental refactors that change capitalisation
    // or spacing are caught immediately.
    // -----------------------------------------------------------------------

    [Fact]
    public void AllBuilders_GenerateExpectedSqlText()
    {
        Assert.Equal("SELECT * FROM pagerank($1, $2, $3)",
            QueryBuilder.BuildPageRank("e").Text);
        Assert.Equal("SELECT * FROM betweenness_centrality($1)",
            QueryBuilder.BuildBetweennessCentrality("e").Text);
        Assert.Equal("SELECT * FROM connected_components($1)",
            QueryBuilder.BuildConnectedComponents("e").Text);
        Assert.Equal("SELECT * FROM louvain($1, $2)",
            QueryBuilder.BuildLouvain("e").Text);
        Assert.Equal("SELECT * FROM degree_centrality($1, $2)",
            QueryBuilder.BuildDegreeCentrality("e").Text);
        Assert.Equal("SELECT * FROM closeness_centrality($1, $2)",
            QueryBuilder.BuildClosenessCentrality("e").Text);
        Assert.Equal("SELECT * FROM eigenvector_centrality($1, $2, $3)",
            QueryBuilder.BuildEigenvectorCentrality("e").Text);
        Assert.Equal("SELECT * FROM harmonic_centrality($1)",
            QueryBuilder.BuildHarmonicCentrality("e").Text);
        Assert.Equal("SELECT * FROM clustering_coefficient($1)",
            QueryBuilder.BuildClusteringCoefficient("e").Text);
        Assert.Equal("SELECT * FROM triangle_count($1)",
            QueryBuilder.BuildTriangleCount("e").Text);
        Assert.Equal("SELECT * FROM strongly_connected_components($1)",
            QueryBuilder.BuildStronglyConnectedComponents("e").Text);
    }
}
