using System.Data.Common;

namespace SixSevenDB.Client;

public sealed class SixSevenDbProviderFactory : DbProviderFactory
{
    public static readonly SixSevenDbProviderFactory Instance = new();

    private SixSevenDbProviderFactory() { }

    public override DbConnection CreateConnection() => new SixSevenDbConnection();
    public override DbCommand CreateCommand() => new SixSevenDbCommand();
    public override DbParameter CreateParameter() => new SixSevenDbParameter();
    public override DbConnectionStringBuilder CreateConnectionStringBuilder() => new SixSevenDbConnectionStringBuilder();
}
