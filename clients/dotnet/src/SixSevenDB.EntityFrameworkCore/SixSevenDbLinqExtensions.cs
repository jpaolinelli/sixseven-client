using SixSevenDB.Client;

namespace SixSevenDB.EntityFrameworkCore;

public static class SixSevenDbLinqExtensions
{
    public static ParameterizedQuery Traverse(
        string edgeType,
        string fromTable,
        object startId,
        TraverseOptions? options = null)
    {
        return QueryBuilder.BuildTraverse(edgeType, fromTable, startId, options);
    }

    public static ParameterizedQuery Nearest(
        string table,
        string column,
        object queryInput,
        NearestOptions? options = null)
    {
        return QueryBuilder.BuildNearest(table, column, queryInput, options);
    }

    public static ParameterizedQuery Link(
        string edgeType,
        string fromTable,
        object fromId,
        string toTable,
        object toId,
        LinkOptions? options = null)
    {
        return QueryBuilder.BuildLink(edgeType, fromTable, fromId, toTable, toId, options);
    }

    public static ParameterizedQuery Unlink(
        string edgeType,
        string fromTable,
        object fromId,
        string toTable,
        object toId)
    {
        return QueryBuilder.BuildUnlink(edgeType, fromTable, fromId, toTable, toId);
    }

    public static ParameterizedQuery Match(
        object[] pattern,
        MatchOptions options)
    {
        return QueryBuilder.BuildMatch(pattern, options);
    }

    public static ParameterizedQuery ShortestMatch(
        object[] pattern,
        string[] returnItems,
        ShortestMatchSelector selector,
        ShortestMatchOptions? options = null)
    {
        return QueryBuilder.BuildShortestMatch(pattern, returnItems, selector, options);
    }

    public static ParameterizedQuery ShortestPath(
        string edgeType,
        string fromTable,
        object fromId,
        string toTable,
        object toId,
        ShortestPathOptions? options = null)
    {
        return QueryBuilder.BuildShortestPath(edgeType, fromTable, fromId, toTable, toId, options);
    }
}
