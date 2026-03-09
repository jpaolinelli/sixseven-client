using System.Globalization;
using System.Text.Json;

namespace SixSevenDB.Client;

public sealed class PathNode
{
    public string Table { get; set; } = "";
    public object? Id { get; set; }
    public Dictionary<string, object?> Properties { get; set; } = new();
}

public sealed class PathEdge
{
    public string EdgeType { get; set; } = "";
    public object? FromId { get; set; }
    public object? ToId { get; set; }
    public Dictionary<string, object?> Properties { get; set; } = new();
}

public sealed class GraphPath
{
    public List<PathNode> Nodes { get; } = [];
    public List<PathEdge> Edges { get; } = [];

    public int PathLength => Edges.Count;
}

public static class TypeParser
{
    public static object? ParseValue(string? value, int typeOid)
    {
        if (value is null) return null;

        return typeOid switch
        {
            TypeOid.Bool => ParseBool(value),
            TypeOid.Int2 => short.Parse(value, CultureInfo.InvariantCulture),
            TypeOid.Int4 => int.Parse(value, CultureInfo.InvariantCulture),
            TypeOid.Int8 => long.Parse(value, CultureInfo.InvariantCulture),
            TypeOid.Float4 => float.Parse(value, CultureInfo.InvariantCulture),
            TypeOid.Float8 => double.Parse(value, CultureInfo.InvariantCulture),
            TypeOid.Numeric => decimal.Parse(value, CultureInfo.InvariantCulture),
            TypeOid.Json or TypeOid.Jsonb => JsonDocument.Parse(value),
            TypeOid.Uuid => Guid.Parse(value),
            TypeOid.Embedding => ParseEmbedding(value),
            TypeOid.Path => ParsePath(value),
            _ => value
        };
    }

    public static bool ParseBool(string value)
    {
        return value is "t" or "true" or "TRUE" or "1";
    }

    public static float[] ParseEmbedding(string value)
    {
        var trimmed = value.AsSpan().Trim();
        if (trimmed.Length >= 2 && trimmed[0] == '[' && trimmed[^1] == ']')
        {
            trimmed = trimmed[1..^1];
        }

        if (trimmed.IsEmpty) return [];

        var parts = trimmed.ToString().Split(',');
        var result = new float[parts.Length];
        for (var i = 0; i < parts.Length; i++)
        {
            result[i] = float.Parse(parts[i].Trim(), CultureInfo.InvariantCulture);
        }
        return result;
    }

    public static string SerializeEmbedding(float[] embedding)
    {
        var parts = new string[embedding.Length];
        for (var i = 0; i < embedding.Length; i++)
        {
            parts[i] = embedding[i].ToString(CultureInfo.InvariantCulture);
        }
        return "[" + string.Join(",", parts) + "]";
    }

    public static GraphPath ParsePath(string value)
    {
        var elements = JsonSerializer.Deserialize<JsonElement[]>(value)
            ?? throw new FormatException("Invalid path JSON");

        var path = new GraphPath();
        for (var i = 0; i < elements.Length; i++)
        {
            var el = elements[i];
            if (i % 2 == 0)
            {
                var node = new PathNode();
                foreach (var prop in el.EnumerateObject())
                {
                    switch (prop.Name)
                    {
                        case "table":
                            node.Table = prop.Value.GetString() ?? "";
                            break;
                        case "id":
                            node.Id = GetJsonValue(prop.Value);
                            break;
                        default:
                            node.Properties[prop.Name] = GetJsonValue(prop.Value);
                            break;
                    }
                }
                path.Nodes.Add(node);
            }
            else
            {
                var edge = new PathEdge();
                foreach (var prop in el.EnumerateObject())
                {
                    switch (prop.Name)
                    {
                        case "edge_type":
                            edge.EdgeType = prop.Value.GetString() ?? "";
                            break;
                        case "from_id":
                            edge.FromId = GetJsonValue(prop.Value);
                            break;
                        case "to_id":
                            edge.ToId = GetJsonValue(prop.Value);
                            break;
                        default:
                            edge.Properties[prop.Name] = GetJsonValue(prop.Value);
                            break;
                    }
                }
                path.Edges.Add(edge);
            }
        }
        return path;
    }

    private static object? GetJsonValue(JsonElement element)
    {
        return element.ValueKind switch
        {
            JsonValueKind.String => element.GetString(),
            JsonValueKind.Number when element.TryGetInt64(out var l) => l,
            JsonValueKind.Number => element.GetDouble(),
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Null => null,
            _ => element.GetRawText()
        };
    }
}
