using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;

namespace SixSevenDB.EntityFrameworkCore;

public static class SixSevenDbContextOptionsBuilderExtensions
{
    public static DbContextOptionsBuilder UseSixSevenDb(
        this DbContextOptionsBuilder optionsBuilder,
        string connectionString,
        Action<SixSevenDbDbContextOptionsBuilder>? sixSevenDbOptionsAction = null)
    {
        var extension = (SixSevenDbOptionsExtension)GetOrCreateExtension(optionsBuilder)
            .WithConnectionString(connectionString);

        ((IDbContextOptionsBuilderInfrastructure)optionsBuilder).AddOrUpdateExtension(extension);

        sixSevenDbOptionsAction?.Invoke(new SixSevenDbDbContextOptionsBuilder(optionsBuilder));

        return optionsBuilder;
    }

    public static DbContextOptionsBuilder<TContext> UseSixSevenDb<TContext>(
        this DbContextOptionsBuilder<TContext> optionsBuilder,
        string connectionString,
        Action<SixSevenDbDbContextOptionsBuilder>? sixSevenDbOptionsAction = null)
        where TContext : DbContext
    {
        ((DbContextOptionsBuilder)optionsBuilder).UseSixSevenDb(connectionString, sixSevenDbOptionsAction);
        return optionsBuilder;
    }

    private static SixSevenDbOptionsExtension GetOrCreateExtension(DbContextOptionsBuilder optionsBuilder)
    {
        return optionsBuilder.Options.FindExtension<SixSevenDbOptionsExtension>()
            ?? new SixSevenDbOptionsExtension();
    }
}

public sealed class SixSevenDbDbContextOptionsBuilder : RelationalDbContextOptionsBuilder<SixSevenDbDbContextOptionsBuilder, SixSevenDbOptionsExtension>
{
    public SixSevenDbDbContextOptionsBuilder(DbContextOptionsBuilder optionsBuilder) : base(optionsBuilder) { }
}
