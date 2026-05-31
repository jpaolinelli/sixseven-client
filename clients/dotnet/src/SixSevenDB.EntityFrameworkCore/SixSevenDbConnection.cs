using System.Data.Common;
using Microsoft.EntityFrameworkCore.Storage;

namespace SixSevenDB.EntityFrameworkCore;

public class SixSevenDbRelationalConnection : RelationalConnection
{
    public SixSevenDbRelationalConnection(RelationalConnectionDependencies dependencies)
        : base(dependencies)
    {
    }

    protected override DbConnection CreateDbConnection()
    {
        return new Client.SixSevenDbConnection(ConnectionString!);
    }
}
