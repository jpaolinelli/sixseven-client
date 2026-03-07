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

public static class QueryBuilder
{
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
}
