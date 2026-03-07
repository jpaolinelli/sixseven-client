using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.DependencyInjection;

namespace SixSevenDB.EntityFrameworkCore.Tests;

public class TypeMappingTests
{
    private SixSevenDbTypeMappingSource CreateMappingSource()
    {
        var options = new DbContextOptionsBuilder()
            .UseSixSevenDb("Host=localhost;Port=6767")
            .Options;

        var serviceProvider = new ServiceCollection()
            .AddEntityFrameworkSixSevenDb()
            .BuildServiceProvider();

        return serviceProvider.GetRequiredService<IRelationalTypeMappingSource>() as SixSevenDbTypeMappingSource
            ?? throw new InvalidOperationException("Type mapping source not registered");
    }

    [Theory]
    [InlineData(typeof(int), "integer")]
    [InlineData(typeof(long), "bigint")]
    [InlineData(typeof(short), "smallint")]
    [InlineData(typeof(bool), "boolean")]
    [InlineData(typeof(string), "text")]
    [InlineData(typeof(double), "double precision")]
    [InlineData(typeof(float), "real")]
    [InlineData(typeof(decimal), "numeric")]
    [InlineData(typeof(Guid), "uuid")]
    [InlineData(typeof(DateTime), "timestamp")]
    public void FindMapping_ByClrType_ReturnsCorrectStoreType(Type clrType, string expectedStoreType)
    {
        var source = CreateMappingSource();
        var mapping = source.FindMapping(clrType);
        Assert.NotNull(mapping);
        Assert.Equal(expectedStoreType, mapping!.StoreType);
    }

    [Fact]
    public void FindMapping_FloatArray_MapsToEmbedding()
    {
        var source = CreateMappingSource();
        var mapping = source.FindMapping(typeof(float[]));
        Assert.NotNull(mapping);
        Assert.Equal("embedding", mapping!.StoreType);
    }

    [Fact]
    public void FindMapping_JsonDocument_MapsToJson()
    {
        var source = CreateMappingSource();
        var mapping = source.FindMapping(typeof(JsonDocument));
        Assert.NotNull(mapping);
        Assert.Equal("json", mapping!.StoreType);
    }

    [Theory]
    [InlineData("integer")]
    [InlineData("bigint")]
    [InlineData("smallint")]
    [InlineData("boolean")]
    [InlineData("text")]
    [InlineData("double precision")]
    [InlineData("real")]
    [InlineData("numeric")]
    [InlineData("uuid")]
    [InlineData("timestamp")]
    [InlineData("embedding")]
    [InlineData("json")]
    public void FindMapping_ByStoreType_ReturnsMapping(string storeType)
    {
        var source = CreateMappingSource();
        var mapping = source.FindMapping(storeType);
        Assert.NotNull(mapping);
    }
}
