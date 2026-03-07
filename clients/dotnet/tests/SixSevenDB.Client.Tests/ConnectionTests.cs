using System.Data;

namespace SixSevenDB.Client.Tests;

public class ConnectionTests
{
    [Fact]
    public void DefaultState_IsClosed()
    {
        var conn = new SixSevenDbConnection();
        Assert.Equal(ConnectionState.Closed, conn.State);
    }

    [Fact]
    public void ConnectionString_SetsConfigProperties()
    {
        var conn = new SixSevenDbConnection("Host=myhost;Port=5555;Username=admin;Database=mydb");
        Assert.Equal("myhost:5555", conn.DataSource);
        Assert.Equal("mydb", conn.Database);
    }

    [Fact]
    public void ServerVersion_ReturnsSixSevenDB()
    {
        var conn = new SixSevenDbConnection();
        Assert.Equal("SixSevenDB", conn.ServerVersion);
    }

    [Fact]
    public void CreateCommand_ReturnsSixSevenDbCommand()
    {
        var conn = new SixSevenDbConnection();
        var cmd = conn.CreateCommand();
        Assert.IsType<SixSevenDbCommand>(cmd);
    }

    [Fact]
    public void ChangeDatabase_ThrowsNotSupported()
    {
        var conn = new SixSevenDbConnection();
        Assert.Throws<NotSupportedException>(() => conn.ChangeDatabase("other"));
    }

    [Fact]
    public void BeginTransaction_ThrowsNotSupported()
    {
        var conn = new SixSevenDbConnection();
        Assert.Throws<NotSupportedException>(() => conn.BeginTransaction());
    }

    [Fact]
    public void Open_ThrowsOnConnectionFailure()
    {
        var conn = new SixSevenDbConnection("Host=192.0.2.1;Port=1;Pooling=false;Connection Timeout=1");
        Assert.ThrowsAny<Exception>(() => conn.Open());
    }

    [Fact]
    public void Close_WhenAlreadyClosed_DoesNotThrow()
    {
        var conn = new SixSevenDbConnection();
        conn.Close(); // Should not throw
    }

    [Fact]
    public void Dispose_WhenClosed_DoesNotThrow()
    {
        var conn = new SixSevenDbConnection();
        conn.Dispose(); // Should not throw
    }

    [Fact]
    public void ConnectionString_CanBeSetToNull()
    {
        var conn = new SixSevenDbConnection();
        conn.ConnectionString = null;
        Assert.Equal("", conn.ConnectionString);
    }

    [Fact]
    public void DataSource_ShowsHostAndPort()
    {
        var conn = new SixSevenDbConnection("Host=example.com;Port=6767");
        Assert.Equal("example.com:6767", conn.DataSource);
    }

    [Fact]
    public void DefaultConnection_UsesDefaults()
    {
        var conn = new SixSevenDbConnection();
        Assert.Equal("localhost:6767", conn.DataSource);
        Assert.Equal("sixseven", conn.Database);
    }
}

public class ProviderFactoryTests
{
    [Fact]
    public void Instance_IsNotNull()
    {
        Assert.NotNull(SixSevenDbProviderFactory.Instance);
    }

    [Fact]
    public void CreateConnection_ReturnsSixSevenDbConnection()
    {
        var conn = SixSevenDbProviderFactory.Instance.CreateConnection();
        Assert.IsType<SixSevenDbConnection>(conn);
    }

    [Fact]
    public void CreateCommand_ReturnsSixSevenDbCommand()
    {
        var cmd = SixSevenDbProviderFactory.Instance.CreateCommand();
        Assert.IsType<SixSevenDbCommand>(cmd);
    }

    [Fact]
    public void CreateParameter_ReturnsSixSevenDbParameter()
    {
        var param = SixSevenDbProviderFactory.Instance.CreateParameter();
        Assert.IsType<SixSevenDbParameter>(param);
    }

    [Fact]
    public void CreateConnectionStringBuilder_ReturnsSixSevenDbConnectionStringBuilder()
    {
        var builder = SixSevenDbProviderFactory.Instance.CreateConnectionStringBuilder();
        Assert.IsType<SixSevenDbConnectionStringBuilder>(builder);
    }
}
