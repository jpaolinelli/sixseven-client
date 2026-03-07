using Microsoft.EntityFrameworkCore;

namespace SixSevenDB.EntityFrameworkCore.Tests;

public class OptionsExtensionTests
{
    [Fact]
    public void UseSixSevenDb_SetsConnectionString()
    {
        var options = new DbContextOptionsBuilder()
            .UseSixSevenDb("Host=localhost;Port=6767;Username=sixseven;Database=sixseven")
            .Options;

        var extension = options.FindExtension<SixSevenDbOptionsExtension>();
        Assert.NotNull(extension);
        Assert.Contains("localhost", extension!.ConnectionString);
    }

    [Fact]
    public void UseSixSevenDb_IsDatabaseProvider()
    {
        var options = new DbContextOptionsBuilder()
            .UseSixSevenDb("Host=localhost;Port=6767")
            .Options;

        var extension = options.FindExtension<SixSevenDbOptionsExtension>();
        Assert.NotNull(extension);
        Assert.True(extension!.Info.IsDatabaseProvider);
    }

    [Fact]
    public void UseSixSevenDb_Generic_Works()
    {
        var options = new DbContextOptionsBuilder<TestDbContext>()
            .UseSixSevenDb("Host=localhost;Port=6767")
            .Options;

        var extension = options.FindExtension<SixSevenDbOptionsExtension>();
        Assert.NotNull(extension);
    }

    [Fact]
    public void Info_LogFragment_ContainsSixSevenDB()
    {
        var extension = new SixSevenDbOptionsExtension();
        Assert.Contains("SixSevenDB", extension.Info.LogFragment);
    }

    [Fact]
    public void Info_ShouldUseSameServiceProvider_SameType()
    {
        var ext1 = new SixSevenDbOptionsExtension();
        var ext2 = new SixSevenDbOptionsExtension();
        Assert.True(ext1.Info.ShouldUseSameServiceProvider(ext2.Info));
    }
}

public class TestDbContext : DbContext
{
    public TestDbContext(DbContextOptions<TestDbContext> options) : base(options) { }
}
