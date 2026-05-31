using System.Net.Sockets;

namespace SixSevenDB.Client;

internal sealed class RawConnection : IAsyncDisposable
{
    private TcpClient? _tcp;
    private NetworkStream? _stream;
    private readonly MessageReader _reader = new();
    private readonly byte[] _readBuffer = new byte[8192];
    private bool _isReady;

    public string Host { get; }
    public int Port { get; }
    public string User { get; }
    public string? Password { get; }
    public string Database { get; }
    public bool IsConnected => _tcp?.Connected == true && _isReady;

    public RawConnection(string host, int port, string user, string? password, string database)
    {
        Host = host;
        Port = port;
        User = user;
        Password = password;
        Database = database;
    }

    public async Task ConnectAsync(CancellationToken cancellationToken = default)
    {
        _tcp = new TcpClient();
        await _tcp.ConnectAsync(Host, Port, cancellationToken);
        _stream = _tcp.GetStream();

        // Send startup message
        var startup = FrontendMessage.BuildStartupMessage(User, Database);
        await _stream.WriteAsync(startup, cancellationToken);
        await _stream.FlushAsync(cancellationToken);

        // Handle authentication handshake
        await HandleAuthenticationAsync(cancellationToken);
    }

    public async Task<QueryResult> QueryAsync(string sql, object?[]? parameters = null, CancellationToken cancellationToken = default)
    {
        if (_stream is null) throw new SixSevenDbException("Not connected");

        if (parameters is null || parameters.Length == 0)
        {
            return await SimpleQueryAsync(sql, cancellationToken);
        }
        else
        {
            return await ExtendedQueryAsync(sql, parameters, cancellationToken);
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_stream is not null)
        {
            try
            {
                var terminate = FrontendMessage.BuildTerminateMessage();
                await _stream.WriteAsync(terminate);
                await _stream.FlushAsync();
            }
            catch { /* best effort */ }
        }

        _stream?.Dispose();
        _tcp?.Dispose();
        _stream = null;
        _tcp = null;
        _isReady = false;
    }

    private async Task HandleAuthenticationAsync(CancellationToken cancellationToken)
    {
        while (true)
        {
            var message = await ReadMessageAsync(cancellationToken);

            switch (message)
            {
                case AuthenticationOkMessage:
                    break;

                case AuthenticationCleartextPasswordMessage:
                    if (Password is null) throw new SixSevenDbException("Server requires password but none provided");
                    var pwMsg = FrontendMessage.BuildPasswordMessage(Password);
                    await _stream!.WriteAsync(pwMsg, cancellationToken);
                    await _stream.FlushAsync(cancellationToken);
                    continue;

                case AuthenticationMd5PasswordMessage md5:
                    if (Password is null) throw new SixSevenDbException("Server requires password but none provided");
                    var md5Msg = FrontendMessage.BuildMd5PasswordMessage(User, Password, md5.Salt);
                    await _stream!.WriteAsync(md5Msg, cancellationToken);
                    await _stream.FlushAsync(cancellationToken);
                    continue;

                case ParameterStatusMessage:
                case BackendKeyDataMessage:
                    continue;

                case ReadyForQueryMessage:
                    _isReady = true;
                    return;

                case ErrorResponseMessage err:
                    throw new SixSevenDbException(err.Message, err.Severity, err.Code);

                default:
                    continue;
            }
        }
    }

    private async Task<QueryResult> SimpleQueryAsync(string sql, CancellationToken cancellationToken)
    {
        var queryMsg = FrontendMessage.BuildQueryMessage(sql);
        await _stream!.WriteAsync(queryMsg, cancellationToken);
        await _stream.FlushAsync(cancellationToken);

        return await ReadQueryResultAsync(cancellationToken);
    }

    private async Task<QueryResult> ExtendedQueryAsync(string sql, object?[] parameters, CancellationToken cancellationToken)
    {
        // Convert $1, $2, etc. parameters — send all messages as a batch
        using var batch = new MemoryStream();
        batch.Write(FrontendMessage.BuildParseMessage(sql));
        batch.Write(FrontendMessage.BuildBindMessage(parameters));
        batch.Write(FrontendMessage.BuildDescribeMessage());
        batch.Write(FrontendMessage.BuildExecuteMessage());
        batch.Write(FrontendMessage.BuildSyncMessage());

        var batchBytes = batch.ToArray();
        await _stream!.WriteAsync(batchBytes, cancellationToken);
        await _stream.FlushAsync(cancellationToken);

        return await ReadExtendedQueryResultAsync(cancellationToken);
    }

    private async Task<QueryResult> ReadQueryResultAsync(CancellationToken cancellationToken)
    {
        var result = new QueryResult();
        FieldDescription[]? fields = null;

        while (true)
        {
            var message = await ReadMessageAsync(cancellationToken);

            switch (message)
            {
                case RowDescriptionMessage rowDesc:
                    fields = rowDesc.Fields;
                    foreach (var f in fields)
                    {
                        result.Fields.Add(new FieldInfo { Name = f.Name, DataTypeId = f.TypeOid });
                    }
                    break;

                case DataRowMessage dataRow:
                    if (fields is not null)
                    {
                        var row = new Dictionary<string, object?>();
                        for (var i = 0; i < fields.Length && i < dataRow.Values.Length; i++)
                        {
                            row[fields[i].Name] = TypeParser.ParseValue(dataRow.Values[i], fields[i].TypeOid);
                        }
                        result.Rows.Add(row);
                    }
                    break;

                case CommandCompleteMessage cmd:
                    result.Command = cmd.Tag;
                    result.RowCount = ParseRowCount(cmd.Tag);
                    break;

                case ReadyForQueryMessage:
                    _isReady = true;
                    return result;

                case ErrorResponseMessage err:
                    // Consume until ReadyForQuery
                    await ConsumeUntilReadyAsync(cancellationToken);
                    throw new SixSevenDbException(err.Message, err.Severity, err.Code);

                case EmptyQueryResponseMessage:
                    break;

                case NoticeResponseMessage:
                    break;
            }
        }
    }

    private async Task<QueryResult> ReadExtendedQueryResultAsync(CancellationToken cancellationToken)
    {
        var result = new QueryResult();
        FieldDescription[]? fields = null;

        while (true)
        {
            var message = await ReadMessageAsync(cancellationToken);

            switch (message)
            {
                case ParseCompleteMessage:
                case BindCompleteMessage:
                case NoDataMessage:
                    break;

                case RowDescriptionMessage rowDesc:
                    fields = rowDesc.Fields;
                    foreach (var f in fields)
                    {
                        result.Fields.Add(new FieldInfo { Name = f.Name, DataTypeId = f.TypeOid });
                    }
                    break;

                case DataRowMessage dataRow:
                    if (fields is not null)
                    {
                        var row = new Dictionary<string, object?>();
                        for (var i = 0; i < fields.Length && i < dataRow.Values.Length; i++)
                        {
                            row[fields[i].Name] = TypeParser.ParseValue(dataRow.Values[i], fields[i].TypeOid);
                        }
                        result.Rows.Add(row);
                    }
                    break;

                case CommandCompleteMessage cmd:
                    result.Command = cmd.Tag;
                    result.RowCount = ParseRowCount(cmd.Tag);
                    break;

                case ReadyForQueryMessage:
                    _isReady = true;
                    return result;

                case ErrorResponseMessage err:
                    await ConsumeUntilReadyAsync(cancellationToken);
                    throw new SixSevenDbException(err.Message, err.Severity, err.Code);

                case EmptyQueryResponseMessage:
                    break;

                case NoticeResponseMessage:
                    break;
            }
        }
    }

    private async Task ConsumeUntilReadyAsync(CancellationToken cancellationToken)
    {
        while (true)
        {
            var message = await ReadMessageAsync(cancellationToken);
            if (message is ReadyForQueryMessage)
            {
                _isReady = true;
                return;
            }
        }
    }

    private async Task<BackendMessage> ReadMessageAsync(CancellationToken cancellationToken)
    {
        while (true)
        {
            var message = _reader.Read();
            if (message is not null) return message;

            var bytesRead = await _stream!.ReadAsync(_readBuffer, cancellationToken);
            if (bytesRead == 0) throw new SixSevenDbException("Connection closed by server");
            _reader.Append(_readBuffer, bytesRead);
        }
    }

    private static int ParseRowCount(string tag)
    {
        // Tags like "SELECT 5", "INSERT 0 1", "UPDATE 3", "DELETE 1"
        var parts = tag.Split(' ');
        if (parts.Length >= 2 && int.TryParse(parts[^1], out var count))
        {
            return count;
        }
        return 0;
    }
}
