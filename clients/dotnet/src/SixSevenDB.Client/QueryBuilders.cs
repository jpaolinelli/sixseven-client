using System.Text;

namespace SixSevenDB.Client;

// ---------------------------------------------------------------------------
// Graph algorithm builder enums and option DTOs (GDB-493)
// ---------------------------------------------------------------------------

/// <summary>
/// Edge direction used by <see cref="QueryBuilder.BuildDegreeCentrality"/>.
/// </summary>
public enum DegreeDirection
{
    /// <summary>Count incoming edges only.</summary>
    In,
    /// <summary>Count outgoing edges only.</summary>
    Out,
    /// <summary>Count both incoming and outgoing edges.</summary>
    Both,
}

/// <summary>
/// Variant selector for <see cref="QueryBuilder.BuildClosenessCentrality"/>.
/// </summary>
public enum ClosenessVariant
{
    /// <summary>Standard closeness: 1 / mean shortest-path distance.</summary>
    Standard,
    /// <summary>Wasserman–Faust normalization for disconnected graphs.</summary>
    WassermanFaust,
    /// <summary>Harmonic-mean variant (sum of reciprocals).</summary>
    Harmonic,
}

public sealed class ParameterizedQuery
{
    public string Text { get; }
    public object?[] Values { get; }

    public ParameterizedQuery(string text, object?[] values)
    {
        Text = text;
        Values = values;
    }
}

public enum TraverseDirection { Out, In, Both }
public enum TraverseMode { Nodes, Edges }
public enum DistanceMetric { Cosine, L2, Dot }

public sealed class TraverseOptions
{
    public TraverseDirection Direction { get; set; } = TraverseDirection.Out;
    public int? MaxDepth { get; set; }
    public TraverseMode Mode { get; set; } = TraverseMode.Nodes;
    public bool Fetch { get; set; }
    public string? Where { get; set; }
}

public sealed class NearestOptions
{
    public int K { get; set; } = 10;
    public DistanceMetric? Metric { get; set; }
    public string? Where { get; set; }
}

public sealed class LinkOptions
{
    public Dictionary<string, object?>? Properties { get; set; }
}

public sealed class MatchNode
{
    public string Alias { get; set; } = "";
    public string Table { get; set; } = "";
}

public sealed class MatchEdge
{
    public string Alias { get; set; } = "";
    public string EdgeType { get; set; } = "";
    public string Direction { get; set; } = "OUT";
    public string? Quantifier { get; set; }
    public List<string>? EdgeTypes { get; set; }
}

public sealed class MatchOptions
{
    public List<string> ReturnItems { get; set; } = [];
    public string? Where { get; set; }
    public bool LegacySyntax { get; set; }
}

public enum ShortestMatchSelector
{
    AnyShortest,
    AllShortest,
    Shortest
}

public sealed class ShortestMatchOptions
{
    public string? Where { get; set; }
    public string? Weight { get; set; }
    public int? K { get; set; }
}

public sealed class ShortestPathOptions
{
    public TraverseDirection? Direction { get; set; }
    public int? MaxDepth { get; set; }
    public string? Select { get; set; }
    public bool LegacySyntax { get; set; }
}

public static class QueryBuilder
{
    private static void AssertPositiveInt(int value, string name)
    {
        if (value < 1)
            throw new ArgumentException($"{name} must be a positive integer, got {value}", name);
    }
    public static ParameterizedQuery BuildTraverse(
        string edgeType,
        string fromTable,
        object startId,
        TraverseOptions? options = null)
    {
        options ??= new TraverseOptions();

        var sb = new StringBuilder();
        sb.Append($"TRAVERSE {EscapeIdentifier(edgeType)} FROM {EscapeIdentifier(fromTable)}($1)");

        if (options.MaxDepth.HasValue)
            sb.Append($" DEPTH {options.MaxDepth.Value}");

        var direction = options.Direction switch
        {
            TraverseDirection.Out => "OUT",
            TraverseDirection.In => "IN",
            TraverseDirection.Both => "BOTH",
            _ => "OUT"
        };
        sb.Append($" DIRECTION {direction}");

        var mode = options.Mode switch
        {
            TraverseMode.Nodes => "NODES",
            TraverseMode.Edges => "EDGES",
            _ => "NODES"
        };
        sb.Append($" MODE {mode}");

        if (options.Fetch)
            sb.Append(" FETCH");

        if (!string.IsNullOrEmpty(options.Where))
            sb.Append($" WHERE {options.Where}");

        return new ParameterizedQuery(sb.ToString(), [startId]);
    }

    public static ParameterizedQuery BuildNearest(
        string table,
        string column,
        object queryInput,
        NearestOptions? options = null)
    {
        options ??= new NearestOptions();

        var paramValue = queryInput switch
        {
            float[] embedding => TypeParser.SerializeEmbedding(embedding),
            string s => s,
            _ => queryInput
        };

        var sb = new StringBuilder();
        sb.Append($"NEAREST {options.K} FROM {EscapeIdentifier(table)}.{EscapeIdentifier(column)} TO $1");

        if (options.Metric.HasValue)
        {
            var metric = options.Metric.Value switch
            {
                DistanceMetric.Cosine => "COSINE",
                DistanceMetric.L2 => "L2",
                DistanceMetric.Dot => "DOT",
                _ => "COSINE"
            };
            sb.Append($" USING {metric}");
        }

        if (!string.IsNullOrEmpty(options.Where))
            sb.Append($" WHERE {options.Where}");

        return new ParameterizedQuery(sb.ToString(), [paramValue]);
    }

    public static ParameterizedQuery BuildLink(
        string edgeType,
        string fromTable,
        object fromId,
        string toTable,
        object toId,
        LinkOptions? options = null)
    {
        var values = new List<object?> { fromId, toId };
        var sb = new StringBuilder();
        sb.Append($"LINK {EscapeIdentifier(fromTable)}($1) TO {EscapeIdentifier(toTable)}($2) VIA {EscapeIdentifier(edgeType)}");

        if (options?.Properties is { Count: > 0 })
        {
            var propParts = new List<string>();
            var paramIndex = 3;
            foreach (var (key, value) in options.Properties)
            {
                propParts.Add($"{EscapeIdentifier(key)} = ${paramIndex}");
                values.Add(value);
                paramIndex++;
            }
            sb.Append($" ({string.Join(", ", propParts)})");
        }

        return new ParameterizedQuery(sb.ToString(), values.ToArray());
    }

    public static ParameterizedQuery BuildUnlink(
        string edgeType,
        string fromTable,
        object fromId,
        string toTable,
        object toId)
    {
        var sb = new StringBuilder();
        sb.Append($"UNLINK {EscapeIdentifier(fromTable)}($1) FROM {EscapeIdentifier(toTable)}($2) VIA {EscapeIdentifier(edgeType)}");
        return new ParameterizedQuery(sb.ToString(), [fromId, toId]);
    }

    public static string EscapeIdentifier(string name)
    {
        return "\"" + name.Replace("\"", "\"\"") + "\"";
    }

    // -----------------------------------------------------------------------
    // MATCH query builder
    // -----------------------------------------------------------------------

    public static bool IsMatchNode(object element) => element is MatchNode;

    internal static string BuildEdgeLabel(MatchEdge edge)
    {
        if (edge.EdgeTypes is { Count: > 0 })
            return string.Join("|", edge.EdgeTypes.Select(EscapeIdentifier));
        return EscapeIdentifier(edge.EdgeType);
    }

    internal static string BuildEdgeSql(MatchEdge edge)
    {
        var label = BuildEdgeLabel(edge);
        var inner = $"[{edge.Alias}:{label}]";
        var quantifier = edge.Quantifier ?? "";

        return edge.Direction.ToUpperInvariant() switch
        {
            "IN" => $"<-{inner}-{quantifier}",
            "BOTH" => $"-{inner}-{quantifier}",
            _ => $"-{inner}->{quantifier}" // OUT (default)
        };
    }

    public static string BuildMatchPattern(object[] pattern)
    {
        var parts = new List<string>();
        foreach (var el in pattern)
        {
            if (el is MatchNode node)
                parts.Add($"({node.Alias}:{EscapeIdentifier(node.Table)})");
            else if (el is MatchEdge edge)
                parts.Add(BuildEdgeSql(edge));
        }
        return string.Join("", parts);
    }

    public static ParameterizedQuery BuildMatch(
        object[] pattern,
        MatchOptions options)
    {
        if (pattern.Length == 0)
            throw new ArgumentException("MATCH pattern must not be empty", nameof(pattern));

        var patternSql = BuildMatchPattern(pattern);
        var selectStr = string.Join(", ", options.ReturnItems);

        string sql;
        if (options.LegacySyntax)
        {
            sql = $"MATCH {patternSql}";
            if (!string.IsNullOrEmpty(options.Where))
                sql += $" WHERE {options.Where}";
            sql += $" RETURN {selectStr}";
        }
        else
        {
            sql = $"SELECT {selectStr} FROM MATCH {patternSql}";
            if (!string.IsNullOrEmpty(options.Where))
                sql += $" WHERE {options.Where}";
        }

        return new ParameterizedQuery(sql, []);
    }

    // -----------------------------------------------------------------------
    // SHORTEST MATCH query builder (path selectors)
    // -----------------------------------------------------------------------

    public static ParameterizedQuery BuildShortestMatch(
        object[] pattern,
        string[] returnItems,
        ShortestMatchSelector selector,
        ShortestMatchOptions? options = null)
    {
        if (pattern.Length == 0)
            throw new ArgumentException("MATCH pattern must not be empty", nameof(pattern));

        options ??= new ShortestMatchOptions();

        var patternSql = BuildMatchPattern(pattern);
        var selectStr = string.Join(", ", returnItems);

        var selectorSql = selector switch
        {
            ShortestMatchSelector.AnyShortest => "ANY SHORTEST",
            ShortestMatchSelector.AllShortest => "ALL SHORTEST",
            ShortestMatchSelector.Shortest => options.K is null
                ? throw new ArgumentException("K is required when selector is Shortest", "options")
                : $"SHORTEST {ValidateAndReturnK(options.K.Value)}",
            _ => throw new ArgumentOutOfRangeException(nameof(selector))
        };

        var sql = $"SELECT {selectStr} FROM MATCH {selectorSql} {patternSql}";

        if (!string.IsNullOrEmpty(options.Weight))
            sql += $" WEIGHT {options.Weight}";

        if (!string.IsNullOrEmpty(options.Where))
            sql += $" WHERE {options.Where}";

        return new ParameterizedQuery(sql, []);
    }

    private static int ValidateAndReturnK(int k)
    {
        AssertPositiveInt(k, "K");
        return k;
    }

    // -----------------------------------------------------------------------
    // SHORTEST PATH query builder
    // -----------------------------------------------------------------------

    public static ParameterizedQuery BuildShortestPath(
        string edgeType,
        string fromTable,
        object fromId,
        string toTable,
        object toId,
        ShortestPathOptions? options = null)
    {
        options ??= new ShortestPathOptions();

        var sb = new StringBuilder();
        sb.Append($"SHORTEST PATH FROM {EscapeIdentifier(fromTable)}($1) TO {EscapeIdentifier(toTable)}($2) VIA {EscapeIdentifier(edgeType)}");

        if (options.Direction.HasValue)
        {
            var direction = options.Direction.Value switch
            {
                TraverseDirection.Out => "OUT",
                TraverseDirection.In => "IN",
                TraverseDirection.Both => "BOTH",
                _ => "OUT"
            };
            sb.Append($" DIRECTION {direction}");
        }

        if (options.MaxDepth.HasValue)
        {
            AssertPositiveInt(options.MaxDepth.Value, "MaxDepth");
            sb.Append($" MAX_DEPTH {options.MaxDepth.Value}");
        }

        string sql;
        if (options.LegacySyntax)
        {
            sql = sb.ToString();
        }
        else
        {
            var selectClause = options.Select ?? "*";
            sql = $"SELECT {selectClause} FROM {sb}";
        }

        return new ParameterizedQuery(sql, [fromId, toId]);
    }

    // -----------------------------------------------------------------------
    // Graph algorithm query builders (GDB-493)
    //
    // Each builder generates a parameterized SELECT against a server-side
    // table-valued function (TVF) for the corresponding graph algorithm:
    //
    //     SELECT * FROM <algorithm>($1, $2, ...)
    //
    // The edge type is bound as $1 and any additional algorithm parameters
    // follow ($2, $3, ...). All numeric parameters are validated to be finite
    // (NaN / Infinity are rejected) and to fall within their algorithm's
    // documented range. Edge type strings are validated to be non-empty after
    // trimming whitespace.
    //
    // The .NET surface deliberately does NOT expose a user-controlled SELECT
    // projection: the value would have to be interpolated directly into the
    // SQL text and a denylist-based sanitizer was previously defeated by
    // UNION SELECT and scalar subqueries (GDB-665). Callers needing a custom
    // projection should compose the generated SQL into a wrapping query in
    // application code.
    // -----------------------------------------------------------------------

    /// <summary>
    /// Reject null, empty, and whitespace-only edge type strings.
    /// </summary>
    private static void AssertNonEmptyEdgeType(string? value, string name)
    {
        if (string.IsNullOrWhiteSpace(value))
            throw new ArgumentException($"{name} must be a non-empty string", name);
    }

    /// <summary>
    /// Reject NaN, PositiveInfinity, and NegativeInfinity values.
    /// </summary>
    private static void AssertFinite(double value, string name)
    {
        if (!double.IsFinite(value))
            throw new ArgumentException(
                $"{name} must be a finite number, got {value}", name);
    }

    /// <summary>
    /// Validate that a value is in the open interval (0, 1).
    /// </summary>
    private static void AssertProbability(double value, string name)
    {
        AssertFinite(value, name);
        if (value <= 0.0 || value >= 1.0)
            throw new ArgumentOutOfRangeException(
                name, value, $"{name} must be between 0 and 1 (exclusive), got {value}");
    }

    /// <summary>
    /// Validate that a value is strictly positive (> 0) and finite.
    /// </summary>
    private static void AssertPositiveDouble(double value, string name)
    {
        AssertFinite(value, name);
        if (value <= 0.0)
            throw new ArgumentOutOfRangeException(
                name, value, $"{name} must be positive, got {value}");
    }

    /// <summary>
    /// Build a <c>SELECT * FROM &lt;funcName&gt;($1, $2, ...)</c> query with the
    /// given values bound to positional parameters. Edge-type values are passed
    /// as plain strings; numeric parameters are passed as their boxed numeric
    /// types so the underlying provider binds them correctly.
    /// </summary>
    private static ParameterizedQuery BuildAlgorithmSql(string funcName, object?[] values)
    {
        var placeholders = new StringBuilder();
        for (var i = 0; i < values.Length; i++)
        {
            if (i > 0) placeholders.Append(", ");
            placeholders.Append('$').Append(i + 1);
        }
        return new ParameterizedQuery($"SELECT * FROM {funcName}({placeholders})", values);
    }

    /// <summary>
    /// Build a PageRank query.
    /// </summary>
    /// <param name="edgeType">Edge type to traverse. Must be non-empty.</param>
    /// <param name="damping">Damping factor in the open interval (0, 1). Defaults to 0.85.</param>
    /// <param name="iterations">Number of power-iteration steps. Must be a positive integer. Defaults to 20.</param>
    /// <returns>A parameterized <c>SELECT * FROM pagerank($1, $2, $3)</c> query.</returns>
    /// <exception cref="ArgumentException">Thrown when <paramref name="edgeType"/> is null/empty/whitespace, or when <paramref name="damping"/> is not finite.</exception>
    /// <exception cref="ArgumentOutOfRangeException">Thrown when <paramref name="damping"/> is outside (0, 1) or <paramref name="iterations"/> is not positive.</exception>
    public static ParameterizedQuery BuildPageRank(
        string edgeType,
        double damping = 0.85,
        int iterations = 20)
    {
        AssertNonEmptyEdgeType(edgeType, nameof(edgeType));
        AssertProbability(damping, nameof(damping));
        AssertPositiveInt(iterations, nameof(iterations));
        return BuildAlgorithmSql("pagerank", [edgeType, damping, iterations]);
    }

    /// <summary>
    /// Build a betweenness-centrality query.
    /// </summary>
    /// <param name="edgeType">Edge type to traverse. Must be non-empty.</param>
    /// <returns>A parameterized <c>SELECT * FROM betweenness_centrality($1)</c> query.</returns>
    /// <exception cref="ArgumentException">Thrown when <paramref name="edgeType"/> is null/empty/whitespace.</exception>
    public static ParameterizedQuery BuildBetweennessCentrality(string edgeType)
    {
        AssertNonEmptyEdgeType(edgeType, nameof(edgeType));
        return BuildAlgorithmSql("betweenness_centrality", [edgeType]);
    }

    /// <summary>
    /// Build a (weakly) connected-components query.
    /// </summary>
    /// <param name="edgeType">Edge type to traverse. Must be non-empty.</param>
    /// <returns>A parameterized <c>SELECT * FROM connected_components($1)</c> query.</returns>
    /// <exception cref="ArgumentException">Thrown when <paramref name="edgeType"/> is null/empty/whitespace.</exception>
    public static ParameterizedQuery BuildConnectedComponents(string edgeType)
    {
        AssertNonEmptyEdgeType(edgeType, nameof(edgeType));
        return BuildAlgorithmSql("connected_components", [edgeType]);
    }

    /// <summary>
    /// Build a Louvain community-detection query.
    /// </summary>
    /// <param name="edgeType">Edge type to traverse. Must be non-empty.</param>
    /// <param name="resolution">Resolution parameter; must be strictly positive and finite. Defaults to 1.0.</param>
    /// <returns>A parameterized <c>SELECT * FROM louvain($1, $2)</c> query.</returns>
    /// <exception cref="ArgumentException">Thrown when <paramref name="edgeType"/> is null/empty/whitespace, or when <paramref name="resolution"/> is not finite.</exception>
    /// <exception cref="ArgumentOutOfRangeException">Thrown when <paramref name="resolution"/> is not positive.</exception>
    public static ParameterizedQuery BuildLouvain(
        string edgeType,
        double resolution = 1.0)
    {
        AssertNonEmptyEdgeType(edgeType, nameof(edgeType));
        AssertPositiveDouble(resolution, nameof(resolution));
        return BuildAlgorithmSql("louvain", [edgeType, resolution]);
    }

    /// <summary>
    /// Build a degree-centrality query.
    /// </summary>
    /// <param name="edgeType">Edge type to traverse. Must be non-empty.</param>
    /// <param name="direction">Edge direction to count. Defaults to <see cref="DegreeDirection.Both"/>.</param>
    /// <returns>A parameterized <c>SELECT * FROM degree_centrality($1, $2)</c> query.</returns>
    /// <exception cref="ArgumentException">Thrown when <paramref name="edgeType"/> is null/empty/whitespace.</exception>
    /// <exception cref="ArgumentOutOfRangeException">Thrown when <paramref name="direction"/> is not a defined enum value.</exception>
    public static ParameterizedQuery BuildDegreeCentrality(
        string edgeType,
        DegreeDirection direction = DegreeDirection.Both)
    {
        AssertNonEmptyEdgeType(edgeType, nameof(edgeType));
        var dirSql = direction switch
        {
            DegreeDirection.In => "IN",
            DegreeDirection.Out => "OUT",
            DegreeDirection.Both => "BOTH",
            _ => throw new ArgumentOutOfRangeException(nameof(direction), direction, null),
        };
        return BuildAlgorithmSql("degree_centrality", [edgeType, dirSql]);
    }

    /// <summary>
    /// Build a closeness-centrality query.
    /// </summary>
    /// <param name="edgeType">Edge type to traverse. Must be non-empty.</param>
    /// <param name="variant">Closeness variant. Defaults to <see cref="ClosenessVariant.Standard"/>.</param>
    /// <returns>A parameterized <c>SELECT * FROM closeness_centrality($1, $2)</c> query.</returns>
    /// <exception cref="ArgumentException">Thrown when <paramref name="edgeType"/> is null/empty/whitespace.</exception>
    /// <exception cref="ArgumentOutOfRangeException">Thrown when <paramref name="variant"/> is not a defined enum value.</exception>
    public static ParameterizedQuery BuildClosenessCentrality(
        string edgeType,
        ClosenessVariant variant = ClosenessVariant.Standard)
    {
        AssertNonEmptyEdgeType(edgeType, nameof(edgeType));
        var variantSql = variant switch
        {
            ClosenessVariant.Standard => "STANDARD",
            ClosenessVariant.WassermanFaust => "WASSERMAN_FAUST",
            ClosenessVariant.Harmonic => "HARMONIC",
            _ => throw new ArgumentOutOfRangeException(nameof(variant), variant, null),
        };
        return BuildAlgorithmSql("closeness_centrality", [edgeType, variantSql]);
    }

    /// <summary>
    /// Build an eigenvector-centrality query.
    /// </summary>
    /// <param name="edgeType">Edge type to traverse. Must be non-empty.</param>
    /// <param name="iterations">Number of power-iteration steps. Must be a positive integer. Defaults to 100.</param>
    /// <param name="tolerance">Convergence tolerance; must be strictly positive and finite. Defaults to 1e-6.</param>
    /// <returns>A parameterized <c>SELECT * FROM eigenvector_centrality($1, $2, $3)</c> query.</returns>
    /// <exception cref="ArgumentException">Thrown when <paramref name="edgeType"/> is null/empty/whitespace, or when <paramref name="tolerance"/> is not finite.</exception>
    /// <exception cref="ArgumentOutOfRangeException">Thrown when <paramref name="iterations"/> is not positive or <paramref name="tolerance"/> is not positive.</exception>
    public static ParameterizedQuery BuildEigenvectorCentrality(
        string edgeType,
        int iterations = 100,
        double tolerance = 1e-6)
    {
        AssertNonEmptyEdgeType(edgeType, nameof(edgeType));
        AssertPositiveInt(iterations, nameof(iterations));
        AssertPositiveDouble(tolerance, nameof(tolerance));
        return BuildAlgorithmSql("eigenvector_centrality", [edgeType, iterations, tolerance]);
    }

    /// <summary>
    /// Build a harmonic-centrality query.
    /// </summary>
    /// <param name="edgeType">Edge type to traverse. Must be non-empty.</param>
    /// <returns>A parameterized <c>SELECT * FROM harmonic_centrality($1)</c> query.</returns>
    /// <exception cref="ArgumentException">Thrown when <paramref name="edgeType"/> is null/empty/whitespace.</exception>
    public static ParameterizedQuery BuildHarmonicCentrality(string edgeType)
    {
        AssertNonEmptyEdgeType(edgeType, nameof(edgeType));
        return BuildAlgorithmSql("harmonic_centrality", [edgeType]);
    }

    /// <summary>
    /// Build a clustering-coefficient query.
    /// </summary>
    /// <param name="edgeType">Edge type to traverse. Must be non-empty.</param>
    /// <returns>A parameterized <c>SELECT * FROM clustering_coefficient($1)</c> query.</returns>
    /// <exception cref="ArgumentException">Thrown when <paramref name="edgeType"/> is null/empty/whitespace.</exception>
    public static ParameterizedQuery BuildClusteringCoefficient(string edgeType)
    {
        AssertNonEmptyEdgeType(edgeType, nameof(edgeType));
        return BuildAlgorithmSql("clustering_coefficient", [edgeType]);
    }

    /// <summary>
    /// Build a triangle-count query.
    /// </summary>
    /// <param name="edgeType">Edge type to traverse. Must be non-empty.</param>
    /// <returns>A parameterized <c>SELECT * FROM triangle_count($1)</c> query.</returns>
    /// <exception cref="ArgumentException">Thrown when <paramref name="edgeType"/> is null/empty/whitespace.</exception>
    public static ParameterizedQuery BuildTriangleCount(string edgeType)
    {
        AssertNonEmptyEdgeType(edgeType, nameof(edgeType));
        return BuildAlgorithmSql("triangle_count", [edgeType]);
    }

    /// <summary>
    /// Build a strongly-connected-components query.
    /// </summary>
    /// <param name="edgeType">Edge type to traverse. Must be non-empty.</param>
    /// <returns>A parameterized <c>SELECT * FROM strongly_connected_components($1)</c> query.</returns>
    /// <exception cref="ArgumentException">Thrown when <paramref name="edgeType"/> is null/empty/whitespace.</exception>
    public static ParameterizedQuery BuildStronglyConnectedComponents(string edgeType)
    {
        AssertNonEmptyEdgeType(edgeType, nameof(edgeType));
        return BuildAlgorithmSql("strongly_connected_components", [edgeType]);
    }
}
