using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using SixSevenDB.Client;

namespace SixSevenDB.EntityFrameworkCore;

public static class SixSevenDbContextExtensions
{
    public static async Task<List<T>> TraverseAsync<T>(
        this DbContext context,
        string edgeType,
        string fromTable,
        object startId,
        TraverseOptions? options = null,
        CancellationToken cancellationToken = default)
        where T : class
    {
        var query = QueryBuilder.BuildTraverse(edgeType, fromTable, startId, options);
        return await context.Set<T>()
            .FromSqlRaw(query.Text, query.Values.Cast<object>().ToArray())
            .ToListAsync(cancellationToken);
    }

    public static async Task<List<T>> NearestAsync<T>(
        this DbContext context,
        string table,
        string column,
        object queryInput,
        NearestOptions? options = null,
        CancellationToken cancellationToken = default)
        where T : class
    {
        var query = QueryBuilder.BuildNearest(table, column, queryInput, options);
        return await context.Set<T>()
            .FromSqlRaw(query.Text, query.Values.Cast<object>().ToArray())
            .ToListAsync(cancellationToken);
    }

    public static async Task<int> LinkAsync(
        this DbContext context,
        string edgeType,
        string fromTable,
        object fromId,
        string toTable,
        object toId,
        LinkOptions? options = null,
        CancellationToken cancellationToken = default)
    {
        var query = QueryBuilder.BuildLink(edgeType, fromTable, fromId, toTable, toId, options);
        return await context.Database.ExecuteSqlRawAsync(query.Text, query.Values.Cast<object>().ToArray(), cancellationToken);
    }

    public static async Task<int> UnlinkAsync(
        this DbContext context,
        string edgeType,
        string fromTable,
        object fromId,
        string toTable,
        object toId,
        CancellationToken cancellationToken = default)
    {
        var query = QueryBuilder.BuildUnlink(edgeType, fromTable, fromId, toTable, toId);
        return await context.Database.ExecuteSqlRawAsync(query.Text, query.Values.Cast<object>().ToArray(), cancellationToken);
    }
}
