using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Migrations.Operations;

namespace SixSevenDB.EntityFrameworkCore.Tests;

public class MigrationsTests
{
    [Fact]
    public void Generate_ThrowsNotSupported()
    {
        var options = new DbContextOptionsBuilder()
            .UseSixSevenDb("Host=localhost;Port=6767")
            .Options;

        using var context = new MigrationsTestDbContext(options);
        var generator = ((IInfrastructure<IServiceProvider>)context).Instance.GetService(typeof(IMigrationsSqlGenerator)) as IMigrationsSqlGenerator;

        Assert.NotNull(generator);
        var ex = Assert.Throws<NotSupportedException>(() =>
            generator!.Generate(new List<MigrationOperation>
            {
                new CreateTableOperation { Name = "test" }
            }));
        Assert.Contains("does not support", ex.Message);
        Assert.Contains("migrations", ex.Message, StringComparison.OrdinalIgnoreCase);
    }
}

public class MigrationsTestDbContext : DbContext
{
    public MigrationsTestDbContext(DbContextOptions options) : base(options) { }
}
