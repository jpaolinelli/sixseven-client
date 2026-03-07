using System.Data;

namespace SixSevenDB.Client.Tests;

/// <summary>
/// QA adversarial tests for GDB-52: Connection, ConnectionPool, and ParameterCollection edge cases.
/// </summary>
public class QaGdb52ConnectionAdversarialTests
{
    // ── Connection state management ───────────────────────────────────────

    [Fact]
    public void Connection_DefaultState_IsClosed()
    {
        using var conn = new SixSevenDbConnection();
        Assert.Equal(ConnectionState.Closed, conn.State);
    }

    [Fact]
    public void Connection_EmptyConnectionString_UsesDefaults()
    {
        using var conn = new SixSevenDbConnection("");
        Assert.Equal("localhost:6767", conn.DataSource);
        Assert.Equal("sixseven", conn.Database);
    }

    [Fact]
    public void Connection_NullConnectionString_CoercesToEmpty()
    {
        using var conn = new SixSevenDbConnection();
        conn.ConnectionString = null;
        Assert.Equal("", conn.ConnectionString);
    }

    [Fact]
    public void Connection_SetConnectionString_UpdatesProperties()
    {
        using var conn = new SixSevenDbConnection();
        conn.ConnectionString = "Host=newhost;Port=1234;Database=newdb";
        Assert.Equal("newhost:1234", conn.DataSource);
        Assert.Equal("newdb", conn.Database);
    }

    [Fact]
    public void Connection_CloseWhenAlreadyClosed_IsIdempotent()
    {
        using var conn = new SixSevenDbConnection();
        conn.Close();
        conn.Close();
        Assert.Equal(ConnectionState.Closed, conn.State);
    }

    [Fact]
    public async Task Connection_CloseAsyncWhenClosed_IsIdempotent()
    {
        await using var conn = new SixSevenDbConnection();
        await conn.CloseAsync();
        await conn.CloseAsync();
        Assert.Equal(ConnectionState.Closed, conn.State);
    }

    [Fact]
    public void Connection_DisposeMultipleTimes_DoesNotThrow()
    {
        var conn = new SixSevenDbConnection();
        conn.Dispose();
        conn.Dispose();
    }

    [Fact]
    public async Task Connection_DisposeAsyncMultipleTimes_DoesNotThrow()
    {
        var conn = new SixSevenDbConnection();
        await conn.DisposeAsync();
        await conn.DisposeAsync();
    }

    [Fact]
    public void Connection_GetRawConnection_WhenClosed_Throws()
    {
        using var conn = new SixSevenDbConnection();
        Assert.Throws<InvalidOperationException>(() => conn.GetRawConnection());
    }

    [Fact]
    public void Connection_CreateCommand_HasConnectionSet()
    {
        using var conn = new SixSevenDbConnection("Host=localhost");
        var cmd = conn.CreateCommand();
        Assert.Same(conn, cmd.Connection);
    }

    // ── ConnectionStringBuilder edge cases ────────────────────────────────

    [Fact]
    public void ConnectionStringBuilder_InvalidPort_UsesDefault()
    {
        var builder = new SixSevenDbConnectionStringBuilder("Port=notanumber");
        Assert.Equal(SixSevenDbConnectionStringBuilder.DefaultPort, builder.Port);
    }

    [Fact]
    public void ConnectionStringBuilder_NegativePort_Accepted()
    {
        var builder = new SixSevenDbConnectionStringBuilder("Port=-1");
        Assert.Equal(-1, builder.Port);
    }

    [Fact]
    public void ConnectionStringBuilder_ZeroPoolSize_Accepted()
    {
        var builder = new SixSevenDbConnectionStringBuilder("Max Pool Size=0");
        Assert.Equal(0, builder.MaxPoolSize);
    }

    [Fact]
    public void ConnectionStringBuilder_NegativeTimeout_Accepted()
    {
        var builder = new SixSevenDbConnectionStringBuilder("Connection Timeout=-5");
        Assert.Equal(-5, builder.ConnectionTimeout);
    }

    [Fact]
    public void ConnectionStringBuilder_ExtraProperties_AreIgnored()
    {
        var builder = new SixSevenDbConnectionStringBuilder("Host=localhost;SomeUnknownProp=value");
        Assert.Equal("localhost", builder.Host);
    }

    [Fact]
    public void ConnectionStringBuilder_PasswordCanBeNull()
    {
        var builder = new SixSevenDbConnectionStringBuilder("Host=localhost");
        Assert.Null(builder.Password);
    }

    [Fact]
    public void ConnectionStringBuilder_EmptyString_UsesDefaults()
    {
        var builder = new SixSevenDbConnectionStringBuilder("");
        Assert.Equal("localhost", builder.Host);
        Assert.Equal(6767, builder.Port);
    }

    // ── ConnectionPool edge cases ─────────────────────────────────────────

    [Fact]
    public void ConnectionPool_InitialState()
    {
        var config = new SixSevenDbConnectionStringBuilder("Host=localhost;Port=6767;Max Pool Size=5");
        var pool = new ConnectionPool(config);
        Assert.Equal(0, pool.TotalCount);
        Assert.Equal(0, pool.IdleCount);
        Assert.Equal(0, pool.ActiveCount);
    }

    [Fact]
    public async Task ConnectionPool_DoubleDispose_IsIdempotent()
    {
        var config = new SixSevenDbConnectionStringBuilder("Host=localhost;Port=6767");
        var pool = new ConnectionPool(config);
        await pool.DisposeAsync();
        await pool.DisposeAsync(); // Must not throw
    }

    [Fact]
    public async Task ConnectionPool_AcquireAfterDispose_ThrowsObjectDisposed()
    {
        var config = new SixSevenDbConnectionStringBuilder("Host=localhost;Port=6767");
        var pool = new ConnectionPool(config);
        await pool.DisposeAsync();
        await Assert.ThrowsAsync<ObjectDisposedException>(() => pool.AcquireAsync());
    }

    // ── ConnectionPoolManager ─────────────────────────────────────────────

    [Fact]
    public void ConnectionPoolManager_SameConnectionString_ReturnsSamePool()
    {
        var config1 = new SixSevenDbConnectionStringBuilder("Host=test-qa-host-1;Port=6767");
        var config2 = new SixSevenDbConnectionStringBuilder("Host=test-qa-host-1;Port=6767");

        var pool1 = ConnectionPoolManager.GetPool(config1);
        var pool2 = ConnectionPoolManager.GetPool(config2);
        Assert.Same(pool1, pool2);
    }

    [Fact]
    public void ConnectionPoolManager_DifferentConnectionStrings_ReturnDifferentPools()
    {
        var config1 = new SixSevenDbConnectionStringBuilder("Host=qa-host-a;Port=6767");
        var config2 = new SixSevenDbConnectionStringBuilder("Host=qa-host-b;Port=6767");

        var pool1 = ConnectionPoolManager.GetPool(config1);
        var pool2 = ConnectionPoolManager.GetPool(config2);
        Assert.NotSame(pool1, pool2);
    }

    // ── ParameterCollection edge cases ────────────────────────────────────

    [Fact]
    public void ParameterCollection_GetParameter_InvalidIndex_Throws()
    {
        var cmd = new SixSevenDbCommand();
        cmd.Parameters.Add("p1", 1);
        Assert.ThrowsAny<Exception>(() => cmd.Parameters[5]);
    }

    [Fact]
    public void ParameterCollection_GetParameter_NegativeIndex_Throws()
    {
        var cmd = new SixSevenDbCommand();
        cmd.Parameters.Add("p1", 1);
        Assert.ThrowsAny<Exception>(() => cmd.Parameters[-1]);
    }

    [Fact]
    public void ParameterCollection_RemoveAt_ByName_NonExistent_IsNoOp()
    {
        var cmd = new SixSevenDbCommand();
        cmd.Parameters.Add("p1", 1);
        cmd.Parameters.RemoveAt("nonexistent");
        Assert.Single(cmd.Parameters);
    }

    [Fact]
    public void ParameterCollection_ToValueArray_EmptyCollection_ReturnsEmptyArray()
    {
        var cmd = new SixSevenDbCommand();
        var values = cmd.Parameters.ToValueArray();
        Assert.Empty(values);
    }

    [Fact]
    public void ParameterCollection_Insert_AtPosition()
    {
        var cmd = new SixSevenDbCommand();
        cmd.Parameters.Add("p1", 1);
        cmd.Parameters.Add("p2", 2);
        cmd.Parameters.Insert(1, new SixSevenDbParameter("inserted", 99));
        Assert.Equal(3, cmd.Parameters.Count);
        Assert.Equal("inserted", cmd.Parameters[1].ParameterName);
    }

    // ── SixSevenDbException ───────────────────────────────────────────────

    [Fact]
    public void SixSevenDbException_WithSeverityAndCode()
    {
        var ex = new SixSevenDbException("test error", "ERROR", "42P01");
        Assert.Equal("test error", ex.Message);
        Assert.Equal("ERROR", ex.Severity);
        Assert.Equal("42P01", ex.SqlState);
    }

    [Fact]
    public void SixSevenDbException_WithInnerException()
    {
        var inner = new InvalidOperationException("inner");
        var ex = new SixSevenDbException("outer", inner);
        Assert.Equal("outer", ex.Message);
        Assert.Same(inner, ex.InnerException);
    }

    [Fact]
    public void SixSevenDbException_SimpleMessage()
    {
        var ex = new SixSevenDbException("simple");
        Assert.Equal("simple", ex.Message);
        Assert.Null(ex.Severity);
        Assert.Null(ex.SqlState);
    }

    // ── Command validation ────────────────────────────────────────────────

    [Fact]
    public void Command_ExecuteNonQuery_NoConnection_Throws()
    {
        var cmd = new SixSevenDbCommand { CommandText = "SELECT 1" };
        Assert.Throws<InvalidOperationException>(() => cmd.ExecuteNonQuery());
    }

    [Fact]
    public void Command_ExecuteScalar_NoConnection_Throws()
    {
        var cmd = new SixSevenDbCommand { CommandText = "SELECT 1" };
        Assert.Throws<InvalidOperationException>(() => cmd.ExecuteScalar());
    }

    [Fact]
    public void Command_ExecuteReader_NoConnection_Throws()
    {
        var cmd = new SixSevenDbCommand { CommandText = "SELECT 1" };
        Assert.ThrowsAny<Exception>(() => cmd.ExecuteReader());
    }

    [Fact]
    public void Command_ExecuteNonQuery_ClosedConnection_Throws()
    {
        using var conn = new SixSevenDbConnection("Host=localhost;Port=6767");
        var cmd = new SixSevenDbCommand("SELECT 1", conn);
        Assert.Throws<InvalidOperationException>(() => cmd.ExecuteNonQuery());
    }

    [Fact]
    public void Command_Prepare_IsNoOp()
    {
        var cmd = new SixSevenDbCommand();
        cmd.Prepare(); // Should not throw
    }

    [Fact]
    public void Command_Cancel_IsNoOp()
    {
        var cmd = new SixSevenDbCommand();
        cmd.Cancel(); // Should not throw
    }

    // ── ProviderFactory ───────────────────────────────────────────────────

    [Fact]
    public void ProviderFactory_Singleton_SameInstance()
    {
        Assert.Same(SixSevenDbProviderFactory.Instance, SixSevenDbProviderFactory.Instance);
    }

    [Fact]
    public void ProviderFactory_CreateConnection_IsNewInstance()
    {
        var conn1 = SixSevenDbProviderFactory.Instance.CreateConnection();
        var conn2 = SixSevenDbProviderFactory.Instance.CreateConnection();
        Assert.NotSame(conn1, conn2);
    }
}
