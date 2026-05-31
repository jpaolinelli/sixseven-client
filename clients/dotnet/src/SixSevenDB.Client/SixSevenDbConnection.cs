using System.Data;
using System.Data.Common;
using System.Diagnostics.CodeAnalysis;

namespace SixSevenDB.Client;

public sealed class SixSevenDbConnection : DbConnection
{
    private string _connectionString = "";
    private SixSevenDbConnectionStringBuilder _config = new();
    private ConnectionPool? _pool;
    private RawConnection? _rawConnection;
    private ConnectionState _state = ConnectionState.Closed;

    [AllowNull]
    public override string ConnectionString
    {
        get => _connectionString;
        set
        {
            _connectionString = value ?? "";
            _config = new SixSevenDbConnectionStringBuilder(_connectionString);
        }
    }

    public override string Database => _config.Database;
    public override string DataSource => $"{_config.Host}:{_config.Port}";
    public override string ServerVersion => "SixSevenDB";
    public override ConnectionState State => _state;

    public SixSevenDbConnection() { }

    public SixSevenDbConnection(string connectionString)
    {
        ConnectionString = connectionString;
    }

    public override void Open()
    {
        OpenAsync(CancellationToken.None).GetAwaiter().GetResult();
    }

    public override async Task OpenAsync(CancellationToken cancellationToken)
    {
        if (_state == ConnectionState.Open) return;

        _state = ConnectionState.Connecting;
        try
        {
            if (_config.Pooling)
            {
                _pool = ConnectionPoolManager.GetPool(_config);
                _rawConnection = await _pool.AcquireAsync(cancellationToken);
            }
            else
            {
                _rawConnection = new RawConnection(
                    _config.Host,
                    _config.Port,
                    _config.Username,
                    _config.Password,
                    _config.Database
                );
                await _rawConnection.ConnectAsync(cancellationToken);
            }
            _state = ConnectionState.Open;
        }
        catch
        {
            _state = ConnectionState.Closed;
            throw;
        }
    }

    public override void Close()
    {
        CloseAsync().GetAwaiter().GetResult();
    }

    public override async Task CloseAsync()
    {
        if (_state == ConnectionState.Closed) return;

        if (_pool is not null && _rawConnection is not null)
        {
            await _pool.ReleaseAsync(_rawConnection);
        }
        else if (_rawConnection is not null)
        {
            await _rawConnection.DisposeAsync();
        }

        _rawConnection = null;
        _state = ConnectionState.Closed;
    }

    public override void ChangeDatabase(string databaseName)
    {
        throw new NotSupportedException("Changing database on an open connection is not supported. Create a new connection instead.");
    }

    protected override DbCommand CreateDbCommand()
    {
        return new SixSevenDbCommand { Connection = this };
    }

    public new SixSevenDbCommand CreateCommand()
    {
        return new SixSevenDbCommand { Connection = this };
    }

    protected override DbTransaction BeginDbTransaction(IsolationLevel isolationLevel)
    {
        throw new NotSupportedException("Transactions are not currently supported by SixSevenDB");
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            Close();
        }
        base.Dispose(disposing);
    }

    public override async ValueTask DisposeAsync()
    {
        await CloseAsync();
        await base.DisposeAsync();
    }

    internal RawConnection GetRawConnection()
    {
        return _rawConnection ?? throw new InvalidOperationException("Connection is not open");
    }
}
