using Microsoft.EntityFrameworkCore.Update;

namespace SixSevenDB.EntityFrameworkCore;

public class SixSevenDbUpdateSqlGenerator : UpdateSqlGenerator
{
    public SixSevenDbUpdateSqlGenerator(UpdateSqlGeneratorDependencies dependencies)
        : base(dependencies)
    {
    }
}
