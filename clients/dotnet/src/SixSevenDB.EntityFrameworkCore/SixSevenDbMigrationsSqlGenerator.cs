using Microsoft.EntityFrameworkCore.Metadata;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Migrations.Operations;

namespace SixSevenDB.EntityFrameworkCore;

public class SixSevenDbMigrationsSqlGenerator : MigrationsSqlGenerator
{
    public SixSevenDbMigrationsSqlGenerator(MigrationsSqlGeneratorDependencies dependencies, IRelationalAnnotationProvider migrationsAnnotationProvider)
        : base(dependencies)
    {
    }

    public override IReadOnlyList<MigrationCommand> Generate(IReadOnlyList<MigrationOperation> operations, IModel? model = null, MigrationsSqlGenerationOptions options = MigrationsSqlGenerationOptions.Default)
    {
        throw new NotSupportedException(
            "SixSevenDB does not support Entity Framework Core migrations. " +
            "Please manage your database schema directly using SQL or the SixSevenDB admin console.");
    }
}
