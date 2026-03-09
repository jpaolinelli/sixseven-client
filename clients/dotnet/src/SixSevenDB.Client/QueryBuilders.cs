using System.Text;

namespace SixSevenDB.Client;

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
}
