using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Query;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.EntityFrameworkCore.Update;
using Microsoft.Extensions.DependencyInjection;

namespace SixSevenDB.EntityFrameworkCore;

public static class SixSevenDbServiceCollectionExtensions
{
    public static IServiceCollection AddEntityFrameworkSixSevenDb(this IServiceCollection services)
    {
        var builder = new EntityFrameworkRelationalServicesBuilder(services);

        builder.TryAdd<IDatabaseProvider, DatabaseProvider<SixSevenDbOptionsExtension>>();
        builder.TryAdd<LoggingDefinitions, SixSevenDbLoggingDefinitions>();
        builder.TryAdd<IRelationalTypeMappingSource, SixSevenDbTypeMappingSource>();
        builder.TryAdd<IRelationalConnection, SixSevenDbRelationalConnection>();
        builder.TryAdd<ISqlGenerationHelper, SixSevenDbSqlGenerationHelper>();
        builder.TryAdd<IQuerySqlGeneratorFactory, SixSevenDbQuerySqlGeneratorFactory>();
        builder.TryAdd<IMigrationsSqlGenerator, SixSevenDbMigrationsSqlGenerator>();
        builder.TryAdd<IUpdateSqlGenerator, SixSevenDbUpdateSqlGenerator>();
        builder.TryAdd<IModificationCommandBatchFactory, SixSevenDbModificationCommandBatchFactory>();

        builder.TryAddCoreServices();

        return services;
    }
}
