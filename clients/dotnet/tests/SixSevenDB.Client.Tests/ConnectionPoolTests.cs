namespace SixSevenDB.Client.Tests;

public class ConnectionPoolTests
{
    [Fact]
    public void Pool_InitialState_IsEmpty()
    {
        var config = new SixSevenDbConnectionStringBuilder("Host=localhost;Port=6767;Max Pool Size=5");
        var pool = new ConnectionPool(config);

        Assert.Equal(0, pool.TotalCount);
        Assert.Equal(0, pool.IdleCount);
        Assert.Equal(0, pool.ActiveCount);
    }

    [Fact]
    public async Task Pool_Dispose_IsIdempotent()
    {
        var config = new SixSevenDbConnectionStringBuilder("Host=localhost;Port=6767");
        var pool = new ConnectionPool(config);

        await pool.DisposeAsync();
        await pool.DisposeAsync(); // Should not throw
    }

    [Fact]
    public async Task Pool_AcquireAfterDispose_Throws()
    {
        var config = new SixSevenDbConnectionStringBuilder("Host=localhost;Port=6767");
        var pool = new ConnectionPool(config);
        await pool.DisposeAsync();

        await Assert.ThrowsAsync<ObjectDisposedException>(() => pool.AcquireAsync());
    }
}
