using Microsoft.EntityFrameworkCore.Query;

namespace SixSevenDB.EntityFrameworkCore;

public class SixSevenDbQuerySqlGeneratorFactory : IQuerySqlGeneratorFactory
{
    private readonly QuerySqlGeneratorDependencies _dependencies;

    public SixSevenDbQuerySqlGeneratorFactory(QuerySqlGeneratorDependencies dependencies)
    {
        _dependencies = dependencies;
    }

    public QuerySqlGenerator Create()
        => new SixSevenDbQuerySqlGenerator(_dependencies);
}

public class SixSevenDbQuerySqlGenerator : QuerySqlGenerator
{
    public SixSevenDbQuerySqlGenerator(QuerySqlGeneratorDependencies dependencies)
        : base(dependencies)
    {
    }
}
