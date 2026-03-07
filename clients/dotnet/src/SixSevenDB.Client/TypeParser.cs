using System.Globalization;
using System.Text.Json;

namespace SixSevenDB.Client;

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
}
