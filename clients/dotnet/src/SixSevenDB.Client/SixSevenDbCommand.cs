using System.Data;
using System.Data.Common;
using System.Diagnostics.CodeAnalysis;

namespace SixSevenDB.Client;

public sealed class SixSevenDbCommand : DbCommand
{
    private SixSevenDbConnection? _connection;
    private readonly SixSevenDbParameterCollection _parameters = new();

    [AllowNull]
    public override string CommandText { get; set; } = "";
    public override int CommandTimeout { get; set; } = 30;
    public override CommandType CommandType { get; set; } = CommandType.Text;
    public override bool DesignTimeVisible { get; set; }
    public override UpdateRowSource UpdatedRowSource { get; set; }

    protected override DbParameterCollection DbParameterCollection => _parameters;
    public new SixSevenDbParameterCollection Parameters => _parameters;

    protected override DbConnection? DbConnection
    {
        get => _connection;
        set => _connection = (SixSevenDbConnection?)value;
    }

    protected override DbTransaction? DbTransaction { get; set; }

    public SixSevenDbCommand() { }

    public SixSevenDbCommand(string commandText, SixSevenDbConnection connection)
    {
        CommandText = commandText;
        _connection = connection;
    }

    public override void Cancel() { }

    public override int ExecuteNonQuery()
    {
        return ExecuteNonQueryAsync(CancellationToken.None).GetAwaiter().GetResult();
    }

    public override async Task<int> ExecuteNonQueryAsync(CancellationToken cancellationToken)
    {
        var result = await ExecuteInternalAsync(cancellationToken);
        return result.RowCount;
    }

    public override object? ExecuteScalar()
    {
        return ExecuteScalarAsync(CancellationToken.None).GetAwaiter().GetResult();
    }

    public override async Task<object?> ExecuteScalarAsync(CancellationToken cancellationToken)
    {
        var result = await ExecuteInternalAsync(cancellationToken);
        if (result.Rows.Count == 0 || result.Fields.Count == 0) return null;
        return result.Rows[0][result.Fields[0].Name];
    }

    protected override DbDataReader ExecuteDbDataReader(CommandBehavior behavior)
    {
        return ExecuteDbDataReaderAsync(behavior, CancellationToken.None).GetAwaiter().GetResult();
    }

    protected override async Task<DbDataReader> ExecuteDbDataReaderAsync(CommandBehavior behavior, CancellationToken cancellationToken)
    {
        var result = await ExecuteInternalAsync(cancellationToken);
        return new SixSevenDbDataReader(result);
    }

    public new async Task<SixSevenDbDataReader> ExecuteReaderAsync(CancellationToken cancellationToken = default)
    {
        var result = await ExecuteInternalAsync(cancellationToken);
        return new SixSevenDbDataReader(result);
    }

    public override void Prepare() { /* No-op: extended protocol handles preparation */ }

    protected override DbParameter CreateDbParameter() => new SixSevenDbParameter();

    private async Task<QueryResult> ExecuteInternalAsync(CancellationToken cancellationToken)
    {
        if (_connection is null)
            throw new InvalidOperationException("Connection is not set");

        if (_connection.State != ConnectionState.Open)
            throw new InvalidOperationException("Connection is not open");

        var rawConn = _connection.GetRawConnection();
        var values = _parameters.Count > 0 ? _parameters.ToValueArray() : null;
        return await rawConn.QueryAsync(CommandText, values, cancellationToken);
    }
}
