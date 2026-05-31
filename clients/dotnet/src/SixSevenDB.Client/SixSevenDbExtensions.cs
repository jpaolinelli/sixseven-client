namespace SixSevenDB.Client;

public static class SixSevenDbExtensions
{
    public static async Task<SixSevenDbDataReader> TraverseAsync(
        this SixSevenDbConnection connection,
        string edgeType,
        string fromTable,
        object startId,
        TraverseOptions? options = null,
        CancellationToken cancellationToken = default)
    {
        var query = QueryBuilder.BuildTraverse(edgeType, fromTable, startId, options);
        using var cmd = connection.CreateCommand();
        cmd.CommandText = query.Text;
        foreach (var value in query.Values)
        {
            cmd.Parameters.Add(new SixSevenDbParameter { Value = value });
        }
        return await cmd.ExecuteReaderAsync(cancellationToken);
    }

    public static async Task<SixSevenDbDataReader> NearestAsync(
        this SixSevenDbConnection connection,
        string table,
        string column,
        object queryInput,
        NearestOptions? options = null,
        CancellationToken cancellationToken = default)
    {
        var query = QueryBuilder.BuildNearest(table, column, queryInput, options);
        using var cmd = connection.CreateCommand();
        cmd.CommandText = query.Text;
        foreach (var value in query.Values)
        {
            cmd.Parameters.Add(new SixSevenDbParameter { Value = value });
        }
        return await cmd.ExecuteReaderAsync(cancellationToken);
    }

    public static async Task<int> LinkAsync(
        this SixSevenDbConnection connection,
        string edgeType,
        string fromTable,
        object fromId,
        string toTable,
        object toId,
        LinkOptions? options = null,
        CancellationToken cancellationToken = default)
    {
        var query = QueryBuilder.BuildLink(edgeType, fromTable, fromId, toTable, toId, options);
        using var cmd = connection.CreateCommand();
        cmd.CommandText = query.Text;
        foreach (var value in query.Values)
        {
            cmd.Parameters.Add(new SixSevenDbParameter { Value = value });
        }
        return await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    public static async Task<int> UnlinkAsync(
        this SixSevenDbConnection connection,
        string edgeType,
        string fromTable,
        object fromId,
        string toTable,
        object toId,
        CancellationToken cancellationToken = default)
    {
        var query = QueryBuilder.BuildUnlink(edgeType, fromTable, fromId, toTable, toId);
        using var cmd = connection.CreateCommand();
        cmd.CommandText = query.Text;
        foreach (var value in query.Values)
        {
            cmd.Parameters.Add(new SixSevenDbParameter { Value = value });
        }
        return await cmd.ExecuteNonQueryAsync(cancellationToken);
    }

    public static async Task<SixSevenDbDataReader> MatchAsync(
        this SixSevenDbConnection connection,
        object[] pattern,
        MatchOptions options,
        CancellationToken cancellationToken = default)
    {
        var query = QueryBuilder.BuildMatch(pattern, options);
        using var cmd = connection.CreateCommand();
        cmd.CommandText = query.Text;
        return await cmd.ExecuteReaderAsync(cancellationToken);
    }

    public static async Task<SixSevenDbDataReader> ShortestMatchAsync(
        this SixSevenDbConnection connection,
        object[] pattern,
        string[] returnItems,
        ShortestMatchSelector selector,
        ShortestMatchOptions? options = null,
        CancellationToken cancellationToken = default)
    {
        var query = QueryBuilder.BuildShortestMatch(pattern, returnItems, selector, options);
        using var cmd = connection.CreateCommand();
        cmd.CommandText = query.Text;
        return await cmd.ExecuteReaderAsync(cancellationToken);
    }

    public static async Task<SixSevenDbDataReader> ShortestPathAsync(
        this SixSevenDbConnection connection,
        string edgeType,
        string fromTable,
        object fromId,
        string toTable,
        object toId,
        ShortestPathOptions? options = null,
        CancellationToken cancellationToken = default)
    {
        var query = QueryBuilder.BuildShortestPath(edgeType, fromTable, fromId, toTable, toId, options);
        using var cmd = connection.CreateCommand();
        cmd.CommandText = query.Text;
        foreach (var value in query.Values)
        {
            cmd.Parameters.Add(new SixSevenDbParameter { Value = value });
        }
        return await cmd.ExecuteReaderAsync(cancellationToken);
    }
}
