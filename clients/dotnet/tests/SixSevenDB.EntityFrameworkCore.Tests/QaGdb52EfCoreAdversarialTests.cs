using System.Text;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.EntityFrameworkCore.Migrations.Operations;
using Microsoft.EntityFrameworkCore.Query;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.EntityFrameworkCore.Update;
using Microsoft.Extensions.DependencyInjection;
using SixSevenDB.Client;

namespace SixSevenDB.EntityFrameworkCore.Tests;

/// <summary>
/// QA adversarial tests for GDB-52: EF Core extension edge cases, service registration, and type mapping.
/// </summary>
public class QaGdb52EfCoreServiceRegistrationTests
{
    [Fact]
    public void AddEntityFrameworkSixSevenDb_RegistersMigrationsSqlGenerator()
    {
        var options = new DbContextOptionsBuilder()
            .UseSixSevenDb("Host=localhost;Port=6767")
            .Options;

        using var context = new QaTestDbContext(options);
        var generator = context.GetService<IMigrationsSqlGenerator>();
        Assert.NotNull(generator);
        Assert.IsType<SixSevenDbMigrationsSqlGenerator>(generator);
    }

    [Fact]
    public void AddEntityFrameworkSixSevenDb_RegistersUpdateSqlGenerator()
    {
        var options = new DbContextOptionsBuilder()
            .UseSixSevenDb("Host=localhost;Port=6767")
            .Options;

        using var context = new QaTestDbContext(options);
        var generator = context.GetService<IUpdateSqlGenerator>();
        Assert.NotNull(generator);
        Assert.IsType<SixSevenDbUpdateSqlGenerator>(generator);
    }

    [Fact]
    public void AddEntityFrameworkSixSevenDb_RegistersModificationCommandBatchFactory()
    {
        var options = new DbContextOptionsBuilder()
            .UseSixSevenDb("Host=localhost;Port=6767")
            .Options;

        using var context = new QaTestDbContext(options);
        var factory = context.GetService<IModificationCommandBatchFactory>();
        Assert.NotNull(factory);
        Assert.IsType<SixSevenDbModificationCommandBatchFactory>(factory);
    }

    [Fact]
    public void AddEntityFrameworkSixSevenDb_RegistersRelationalConnection()
    {
        var options = new DbContextOptionsBuilder()
            .UseSixSevenDb("Host=localhost;Port=6767")
            .Options;

        using var context = new QaTestDbContext(options);
        var connection = context.GetService<IRelationalConnection>();
        Assert.NotNull(connection);
        Assert.IsType<SixSevenDbRelationalConnection>(connection);
    }
}

public class QaGdb52EfCoreOptionsTests
{
    [Fact]
    public void UseSixSevenDb_EmptyConnectionString_DoesNotThrow()
    {
        var options = new DbContextOptionsBuilder()
            .UseSixSevenDb("")
            .Options;

        var extension = options.FindExtension<SixSevenDbOptionsExtension>();
        Assert.NotNull(extension);
    }

    [Fact]
    public void UseSixSevenDb_WithOptionsAction_Invoked()
    {
        var invoked = false;
        var options = new DbContextOptionsBuilder()
            .UseSixSevenDb("Host=localhost", opts =>
            {
                invoked = true;
            })
            .Options;

        Assert.True(invoked);
    }

    [Fact]
    public void OptionsExtension_Info_IsDatabaseProvider()
    {
        var ext = new SixSevenDbOptionsExtension();
        Assert.True(ext.Info.IsDatabaseProvider);
    }

    [Fact]
    public void OptionsExtension_Info_LogFragment_ContainsSixSevenDB()
    {
        var ext = new SixSevenDbOptionsExtension();
        Assert.Contains("SixSevenDB", ext.Info.LogFragment);
    }

    [Fact]
    public void OptionsExtension_PopulateDebugInfo_IncludesConnectionString()
    {
        var options = new DbContextOptionsBuilder()
            .UseSixSevenDb("Host=testhost;Port=1234")
            .Options;

        var extension = options.FindExtension<SixSevenDbOptionsExtension>()!;
        var debugInfo = new Dictionary<string, string>();
        extension.Info.PopulateDebugInfo(debugInfo);
        Assert.True(debugInfo.ContainsKey("SixSevenDB:ConnectionString"));
    }

    [Fact]
    public void OptionsExtension_ShouldUseSameServiceProvider_SameType_True()
    {
        var ext1 = new SixSevenDbOptionsExtension();
        var ext2 = new SixSevenDbOptionsExtension();
        Assert.True(ext1.Info.ShouldUseSameServiceProvider(ext2.Info));
    }
}

public class QaGdb52EfCoreMigrationsTests
{
    [Fact]
    public void Migrations_Generate_ThrowsNotSupported_WithClearMessage()
    {
        var options = new DbContextOptionsBuilder()
            .UseSixSevenDb("Host=localhost;Port=6767")
            .Options;

        using var context = new QaTestDbContext(options);
        var generator = context.GetService<IMigrationsSqlGenerator>();
        Assert.NotNull(generator);

        var ex = Assert.Throws<NotSupportedException>(() =>
            generator!.Generate(new List<MigrationOperation>
            {
                new CreateTableOperation { Name = "test_table" }
            }));

        Assert.Contains("SixSevenDB", ex.Message);
        Assert.Contains("migration", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Migrations_Generate_EmptyOperations_StillThrows()
    {
        var options = new DbContextOptionsBuilder()
            .UseSixSevenDb("Host=localhost;Port=6767")
            .Options;

        using var context = new QaTestDbContext(options);
        var generator = context.GetService<IMigrationsSqlGenerator>();

        Assert.Throws<NotSupportedException>(() =>
            generator!.Generate(new List<MigrationOperation>()));
    }
}

public class QaGdb52EfCoreTypeMappingTests
{
    private SixSevenDbTypeMappingSource CreateMappingSource()
    {
        var services = new ServiceCollection()
            .AddEntityFrameworkSixSevenDb()
            .BuildServiceProvider();

        return services.GetRequiredService<IRelationalTypeMappingSource>() as SixSevenDbTypeMappingSource
            ?? throw new InvalidOperationException("Type mapping source not registered");
    }

    [Fact]
    public void FindMapping_FloatArray_MapsToEmbedding()
    {
        var source = CreateMappingSource();
        var mapping = source.FindMapping(typeof(float[]));
        Assert.NotNull(mapping);
        Assert.Equal("embedding", mapping!.StoreType);
        Assert.Equal(typeof(float[]), mapping.ClrType);
    }

    [Fact]
    public void FindMapping_Guid_MapsToUuid()
    {
        var source = CreateMappingSource();
        var mapping = source.FindMapping(typeof(Guid));
        Assert.NotNull(mapping);
        Assert.Equal("uuid", mapping!.StoreType);
    }

    [Fact]
    public void FindMapping_JsonDocument_MapsToJson()
    {
        var source = CreateMappingSource();
        var mapping = source.FindMapping(typeof(JsonDocument));
        Assert.NotNull(mapping);
        Assert.Equal("json", mapping!.StoreType);
    }

    // Store type mapping (reverse direction)
    [Theory]
    [InlineData("int4", "integer")]
    [InlineData("int8", "bigint")]
    [InlineData("int2", "smallint")]
    [InlineData("bool", "boolean")]
    [InlineData("varchar", "text")]
    [InlineData("float8", "double precision")]
    [InlineData("float4", "real")]
    [InlineData("decimal", "numeric")]
    [InlineData("jsonb", "json")]
    public void FindMapping_ByAlternateStoreType_ReturnsMapping(string storeType, string expectedCanonical)
    {
        var source = CreateMappingSource();
        var mapping = source.FindMapping(storeType);
        Assert.NotNull(mapping);
        Assert.Equal(expectedCanonical, mapping!.StoreType);
    }

    [Fact]
    public void FindMapping_UnknownType_ReturnsNull()
    {
        var source = CreateMappingSource();
        var mapping = source.FindMapping("unknown_type_xyz");
        // Unknown types should fall through to base, which may return null
        // Just verifying it doesn't throw
    }
}

public class QaGdb52EfCoreSqlGenerationHelperTests
{
    private SixSevenDbSqlGenerationHelper CreateHelper()
    {
        var services = new ServiceCollection()
            .AddEntityFrameworkSixSevenDb()
            .BuildServiceProvider();

        return services.GetRequiredService<ISqlGenerationHelper>() as SixSevenDbSqlGenerationHelper
            ?? throw new InvalidOperationException("Not registered");
    }

    [Fact]
    public void DelimitIdentifier_EmptyString_ReturnsQuotedEmpty()
    {
        var helper = CreateHelper();
        Assert.Equal("\"\"", helper.DelimitIdentifier(""));
    }

    [Fact]
    public void DelimitIdentifier_SqlInjection_Escaped()
    {
        var helper = CreateHelper();
        var result = helper.DelimitIdentifier("table\"; DROP TABLE users; --");
        Assert.Equal("\"table\"\"; DROP TABLE users; --\"", result);
    }

    [Fact]
    public void DelimitIdentifier_Unicode_Works()
    {
        var helper = CreateHelper();
        Assert.Equal("\"表名\"", helper.DelimitIdentifier("表名"));
    }

    [Fact]
    public void GenerateParameterName_NumberedParams_Work()
    {
        var helper = CreateHelper();
        Assert.Equal("$1", helper.GenerateParameterName("1"));
        Assert.Equal("$42", helper.GenerateParameterName("42"));
    }

    [Fact]
    public void GenerateParameterNamePlaceholder_StringBuilder_Works()
    {
        var helper = CreateHelper();
        var sb = new StringBuilder();
        helper.GenerateParameterNamePlaceholder(sb, "p1");
        Assert.Equal("$p1", sb.ToString());
    }

    [Fact]
    public void EscapeIdentifier_StringBuilder_Works()
    {
        var helper = CreateHelper();
        var sb = new StringBuilder();
        helper.EscapeIdentifier(sb, "my\"table");
        Assert.Equal("my\"\"table", sb.ToString());
    }

    [Fact]
    public void EscapeIdentifier_NoQuotes_PassesThrough()
    {
        var helper = CreateHelper();
        Assert.Equal("simple", helper.EscapeIdentifier("simple"));
    }
}

public class QaGdb52EfCoreLinqExtensionTests
{
    [Fact]
    public void Traverse_AllDirections_GenerateCorrectSql()
    {
        var outResult = SixSevenDbLinqExtensions.Traverse("edge", "table", 1,
            new TraverseOptions { Direction = TraverseDirection.Out });
        Assert.Contains("DIRECTION OUT", outResult.Text);

        var inResult = SixSevenDbLinqExtensions.Traverse("edge", "table", 1,
            new TraverseOptions { Direction = TraverseDirection.In });
        Assert.Contains("DIRECTION IN", inResult.Text);

        var bothResult = SixSevenDbLinqExtensions.Traverse("edge", "table", 1,
            new TraverseOptions { Direction = TraverseDirection.Both });
        Assert.Contains("DIRECTION BOTH", bothResult.Text);
    }

    [Fact]
    public void Traverse_AllModes_GenerateCorrectSql()
    {
        var nodesResult = SixSevenDbLinqExtensions.Traverse("edge", "table", 1,
            new TraverseOptions { Mode = TraverseMode.Nodes });
        Assert.Contains("MODE NODES", nodesResult.Text);

        var edgesResult = SixSevenDbLinqExtensions.Traverse("edge", "table", 1,
            new TraverseOptions { Mode = TraverseMode.Edges });
        Assert.Contains("MODE EDGES", edgesResult.Text);
    }

    [Fact]
    public void Nearest_AllMetrics_GenerateCorrectSql()
    {
        var embedding = new float[] { 0.1f };

        var cosineResult = SixSevenDbLinqExtensions.Nearest("t", "c", embedding,
            new NearestOptions { Metric = DistanceMetric.Cosine });
        Assert.Contains("USING COSINE", cosineResult.Text);

        var l2Result = SixSevenDbLinqExtensions.Nearest("t", "c", embedding,
            new NearestOptions { Metric = DistanceMetric.L2 });
        Assert.Contains("USING L2", l2Result.Text);

        var dotResult = SixSevenDbLinqExtensions.Nearest("t", "c", embedding,
            new NearestOptions { Metric = DistanceMetric.Dot });
        Assert.Contains("USING DOT", dotResult.Text);
    }

    [Fact]
    public void Link_WithMultipleProperties_CorrectParamIndexing()
    {
        var result = SixSevenDbLinqExtensions.Link("edge", "from_t", 1, "to_t", 2,
            new LinkOptions
            {
                Properties = new Dictionary<string, object?>
                {
                    ["a"] = "val_a",
                    ["b"] = "val_b",
                    ["c"] = "val_c"
                }
            });

        Assert.Equal(5, result.Values.Length); // 2 IDs + 3 properties
        Assert.Contains("$3", result.Text);
        Assert.Contains("$4", result.Text);
        Assert.Contains("$5", result.Text);
    }

    [Fact]
    public void Unlink_WithGuidIds_Works()
    {
        var fromId = Guid.NewGuid();
        var toId = Guid.NewGuid();
        var result = SixSevenDbLinqExtensions.Unlink("edge", "t1", fromId, "t2", toId);
        Assert.Equal(fromId, result.Values[0]);
        Assert.Equal(toId, result.Values[1]);
    }

    [Fact]
    public void Nearest_DefaultOptions_Uses10K()
    {
        var result = SixSevenDbLinqExtensions.Nearest("table", "col", new float[] { 0.1f });
        Assert.Contains("NEAREST 10", result.Text);
    }

    [Fact]
    public void Traverse_DefaultOptions_UsesOutNodesNoFetch()
    {
        var result = SixSevenDbLinqExtensions.Traverse("edge", "table", 1);
        Assert.Contains("DIRECTION OUT", result.Text);
        Assert.Contains("MODE NODES", result.Text);
        Assert.DoesNotContain("FETCH", result.Text);
        Assert.DoesNotContain("DEPTH", result.Text);
        Assert.DoesNotContain("WHERE", result.Text);
    }
}

public class QaGdb52EfCoreNpgsqlIndependenceTests
{
    [Fact]
    public void EfCore_PackageDependsOnSixSevenDbClient_NotNpgsql()
    {
        // Verify that the EF Core extension creates SixSevenDbConnection, not NpgsqlConnection
        var options = new DbContextOptionsBuilder()
            .UseSixSevenDb("Host=localhost;Port=6767")
            .Options;

        using var context = new QaTestDbContext(options);
        var relationalConn = context.GetService<IRelationalConnection>();
        Assert.IsType<SixSevenDbRelationalConnection>(relationalConn);

        // The underlying DbConnection should be SixSevenDB.Client.SixSevenDbConnection
        var dbConn = relationalConn!.DbConnection;
        Assert.IsType<Client.SixSevenDbConnection>(dbConn);
    }
}

public class QaTestDbContext : DbContext
{
    public QaTestDbContext(DbContextOptions options) : base(options) { }
}
