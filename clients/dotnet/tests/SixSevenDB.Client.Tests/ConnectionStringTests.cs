namespace SixSevenDB.Client.Tests;

public class ConnectionStringTests
{
    [Fact]
    public void DefaultValues_AreCorrect()
    {
        var builder = new SixSevenDbConnectionStringBuilder();
        Assert.Equal("localhost", builder.Host);
        Assert.Equal(6767, builder.Port);
        Assert.Equal("sixseven", builder.Username);
        Assert.Null(builder.Password);
        Assert.Equal("sixseven", builder.Database);
        Assert.Equal(10, builder.MaxPoolSize);
        Assert.True(builder.Pooling);
        Assert.Equal(30, builder.ConnectionTimeout);
    }

    [Fact]
    public void ParsesConnectionString_Correctly()
    {
        var builder = new SixSevenDbConnectionStringBuilder("Host=myhost;Port=5432;Username=myuser;Password=secret;Database=mydb");
        Assert.Equal("myhost", builder.Host);
        Assert.Equal(5432, builder.Port);
        Assert.Equal("myuser", builder.Username);
        Assert.Equal("secret", builder.Password);
        Assert.Equal("mydb", builder.Database);
    }

    [Fact]
    public void SetProperties_UpdatesConnectionString()
    {
        var builder = new SixSevenDbConnectionStringBuilder
        {
            Host = "remote-host",
            Port = 1234,
            Username = "admin",
            Database = "production"
        };

        Assert.Equal("remote-host", builder.Host);
        Assert.Equal(1234, builder.Port);
        Assert.Contains("Host=remote-host", builder.ConnectionString);
    }

    [Fact]
    public void Pooling_CanBeDisabled()
    {
        var builder = new SixSevenDbConnectionStringBuilder("Pooling=false");
        Assert.False(builder.Pooling);
    }

    [Fact]
    public void MaxPoolSize_CanBeSet()
    {
        var builder = new SixSevenDbConnectionStringBuilder("Max Pool Size=20");
        Assert.Equal(20, builder.MaxPoolSize);
    }

    [Fact]
    public void ConnectionTimeout_CanBeSet()
    {
        var builder = new SixSevenDbConnectionStringBuilder("Connection Timeout=60");
        Assert.Equal(60, builder.ConnectionTimeout);
    }
}
