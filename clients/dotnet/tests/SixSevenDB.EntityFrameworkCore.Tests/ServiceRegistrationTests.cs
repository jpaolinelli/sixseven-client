using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Query;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.DependencyInjection;

namespace SixSevenDB.EntityFrameworkCore.Tests;

public class ServiceRegistrationTests
{
    [Fact]
    public void AddEntityFrameworkSixSevenDb_RegistersTypeMappingSource()
    {
        var services = new ServiceCollection()
            .AddEntityFrameworkSixSevenDb()
            .BuildServiceProvider();

        var source = services.GetService<IRelationalTypeMappingSource>();
        Assert.NotNull(source);
        Assert.IsType<SixSevenDbTypeMappingSource>(source);
    }

    [Fact]
    public void AddEntityFrameworkSixSevenDb_RegistersSqlGenerationHelper()
    {
        var services = new ServiceCollection()
            .AddEntityFrameworkSixSevenDb()
            .BuildServiceProvider();

        var helper = services.GetService<ISqlGenerationHelper>();
        Assert.NotNull(helper);
        Assert.IsType<SixSevenDbSqlGenerationHelper>(helper);
    }

    [Fact]
    public void AddEntityFrameworkSixSevenDb_RegistersQuerySqlGeneratorFactory()
    {
        var services = new ServiceCollection()
            .AddEntityFrameworkSixSevenDb()
            .BuildServiceProvider();

        var factory = services.GetService<IQuerySqlGeneratorFactory>();
        Assert.NotNull(factory);
        Assert.IsType<SixSevenDbQuerySqlGeneratorFactory>(factory);
    }

    [Fact]
    public void DbContext_GetService_ResolvesConnection()
    {
        var options = new DbContextOptionsBuilder()
            .UseSixSevenDb("Host=localhost;Port=6767")
            .Options;

        using var context = new ServiceTestDbContext(options);
        var connection = context.GetService<IRelationalConnection>();
        Assert.NotNull(connection);
        Assert.IsType<SixSevenDbRelationalConnection>(connection);
    }

    [Fact]
    public void DbContext_GetService_ResolvesMigrationsSqlGenerator()
    {
        var options = new DbContextOptionsBuilder()
            .UseSixSevenDb("Host=localhost;Port=6767")
            .Options;

        using var context = new ServiceTestDbContext(options);
        var generator = context.GetService<IMigrationsSqlGenerator>();
        Assert.NotNull(generator);
        Assert.IsType<SixSevenDbMigrationsSqlGenerator>(generator);
    }
}

public class ServiceTestDbContext : DbContext
{
    public ServiceTestDbContext(DbContextOptions options) : base(options) { }
}
