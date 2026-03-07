using System.Collections.Concurrent;

namespace SixSevenDB.Client;

internal sealed class ConnectionPool : IAsyncDisposable
{
    private readonly SixSevenDbConnectionStringBuilder _config;
    private readonly ConcurrentQueue<RawConnection> _idle = new();
    private readonly ConcurrentDictionary<RawConnection, byte> _active = new();
    private readonly SemaphoreSlim _semaphore;
    private volatile bool _disposed;
    private int _totalCount;

    public int TotalCount => _totalCount;
    public int IdleCount => _idle.Count;
    public int ActiveCount => _active.Count;

    public ConnectionPool(SixSevenDbConnectionStringBuilder config)
    {
        _config = config;
        _semaphore = new SemaphoreSlim(config.MaxPoolSize, config.MaxPoolSize);
    }

    public async Task<RawConnection> AcquireAsync(CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);

        var timeout = TimeSpan.FromSeconds(_config.ConnectionTimeout);
        if (!await _semaphore.WaitAsync(timeout, cancellationToken))
        {
            throw new SixSevenDbException("Connection pool timeout — all connections are in use");
        }

        // Try to reuse an idle connection
        while (_idle.TryDequeue(out var idle))
        {
            if (idle.IsConnected)
            {
                _active.TryAdd(idle, 0);
                return idle;
            }
            // Dead connection — discard
            Interlocked.Decrement(ref _totalCount);
            await idle.DisposeAsync();
        }

        // Create new connection
        var conn = new RawConnection(
            _config.Host,
            _config.Port,
            _config.Username,
            _config.Password,
            _config.Database
        );
        await conn.ConnectAsync(cancellationToken);
        Interlocked.Increment(ref _totalCount);
        _active.TryAdd(conn, 0);
        return conn;
    }

    public async ValueTask ReleaseAsync(RawConnection connection, bool destroy = false)
    {
        _active.TryRemove(connection, out _);

        if (_disposed || destroy || !connection.IsConnected)
        {
            Interlocked.Decrement(ref _totalCount);
            await connection.DisposeAsync();
        }
        else
        {
            _idle.Enqueue(connection);
        }

        _semaphore.Release();
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed) return;
        _disposed = true;

        while (_idle.TryDequeue(out var conn))
        {
            await conn.DisposeAsync();
        }

        foreach (var conn in _active.Keys)
        {
            await conn.DisposeAsync();
        }
        _active.Clear();

        _semaphore.Dispose();
    }
}

internal static class ConnectionPoolManager
{
    private static readonly ConcurrentDictionary<string, ConnectionPool> Pools = new();

    public static ConnectionPool GetPool(SixSevenDbConnectionStringBuilder config)
    {
        var key = config.ConnectionString ?? "";
        return Pools.GetOrAdd(key, _ => new ConnectionPool(config));
    }

    public static async Task ClearAllAsync()
    {
        foreach (var pool in Pools.Values)
        {
            await pool.DisposeAsync();
        }
        Pools.Clear();
    }
}
