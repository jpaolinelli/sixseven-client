namespace SixSevenDB.Client;

public sealed class QueryResult
{
    public List<Dictionary<string, object?>> Rows { get; } = [];
    public List<FieldInfo> Fields { get; } = [];
    public int RowCount { get; internal set; }
    public string Command { get; internal set; } = "";
}

public sealed class FieldInfo
{
    public required string Name { get; init; }
    public int DataTypeId { get; init; }
}
