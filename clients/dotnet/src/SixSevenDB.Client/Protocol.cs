using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;

namespace SixSevenDB.Client;

internal static class FrontendMessage
{
    public static byte[] BuildStartupMessage(string user, string database)
    {
        var parameters = new Dictionary<string, string>
        {
            ["user"] = user,
            ["database"] = database,
            ["client_encoding"] = "UTF8"
        };

        using var ms = new MemoryStream();
        using var writer = new BinaryWriter(ms);

        // Placeholder for length
        writer.Write(0);
        // Protocol version 3.0
        writer.Write(BinaryPrimitives.ReverseEndianness(196608));

        foreach (var (key, value) in parameters)
        {
            writer.Write(Encoding.UTF8.GetBytes(key));
            writer.Write((byte)0);
            writer.Write(Encoding.UTF8.GetBytes(value));
            writer.Write((byte)0);
        }
        writer.Write((byte)0); // terminator

        var bytes = ms.ToArray();
        var length = BinaryPrimitives.ReverseEndianness(bytes.Length);
        BitConverter.TryWriteBytes(bytes.AsSpan(0, 4), length);
        return bytes;
    }

    public static byte[] BuildPasswordMessage(string password)
    {
        var passwordBytes = Encoding.UTF8.GetBytes(password);
        var length = 4 + passwordBytes.Length + 1;

        var buffer = new byte[1 + length];
        buffer[0] = (byte)'p';
        BinaryPrimitives.WriteInt32BigEndian(buffer.AsSpan(1), length);
        passwordBytes.CopyTo(buffer.AsSpan(5));
        buffer[5 + passwordBytes.Length] = 0;
        return buffer;
    }

    public static byte[] BuildMd5PasswordMessage(string user, string password, byte[] salt)
    {
        var inner = MD5.HashData(Encoding.UTF8.GetBytes(password + user));
        var innerHex = Convert.ToHexString(inner).ToLowerInvariant();

        var outerInput = new byte[innerHex.Length + salt.Length];
        Encoding.UTF8.GetBytes(innerHex).CopyTo(outerInput, 0);
        salt.CopyTo(outerInput, innerHex.Length);
        var outer = MD5.HashData(outerInput);
        var outerHex = Convert.ToHexString(outer).ToLowerInvariant();

        return BuildPasswordMessage("md5" + outerHex);
    }

    public static byte[] BuildQueryMessage(string sql)
    {
        var sqlBytes = Encoding.UTF8.GetBytes(sql);
        var length = 4 + sqlBytes.Length + 1;

        var buffer = new byte[1 + length];
        buffer[0] = (byte)'Q';
        BinaryPrimitives.WriteInt32BigEndian(buffer.AsSpan(1), length);
        sqlBytes.CopyTo(buffer.AsSpan(5));
        buffer[5 + sqlBytes.Length] = 0;
        return buffer;
    }

    public static byte[] BuildParseMessage(string sql, string statementName = "")
    {
        var nameBytes = Encoding.UTF8.GetBytes(statementName);
        var sqlBytes = Encoding.UTF8.GetBytes(sql);
        var length = 4 + nameBytes.Length + 1 + sqlBytes.Length + 1 + 2;

        var buffer = new byte[1 + length];
        var offset = 0;
        buffer[offset++] = (byte)'P';
        BinaryPrimitives.WriteInt32BigEndian(buffer.AsSpan(offset), length);
        offset += 4;
        nameBytes.CopyTo(buffer.AsSpan(offset));
        offset += nameBytes.Length;
        buffer[offset++] = 0;
        sqlBytes.CopyTo(buffer.AsSpan(offset));
        offset += sqlBytes.Length;
        buffer[offset++] = 0;
        BinaryPrimitives.WriteInt16BigEndian(buffer.AsSpan(offset), 0); // no param type OIDs
        return buffer;
    }

    public static byte[] BuildBindMessage(object?[] parameters, string portalName = "", string statementName = "")
    {
        var portalBytes = Encoding.UTF8.GetBytes(portalName);
        var stmtBytes = Encoding.UTF8.GetBytes(statementName);

        using var ms = new MemoryStream();

        // Portal name + null
        ms.Write(portalBytes);
        ms.WriteByte(0);
        // Statement name + null
        ms.Write(stmtBytes);
        ms.WriteByte(0);
        // Format codes count = 0 (all text)
        WriteInt16BE(ms, 0);
        // Parameter count
        WriteInt16BE(ms, (short)parameters.Length);

        foreach (var param in parameters)
        {
            if (param is null)
            {
                WriteInt32BE(ms, -1);
            }
            else
            {
                var text = ConvertParameterToString(param);
                var paramBytes = Encoding.UTF8.GetBytes(text);
                WriteInt32BE(ms, paramBytes.Length);
                ms.Write(paramBytes);
            }
        }

        // Result format codes count = 0 (all text)
        WriteInt16BE(ms, 0);

        var payload = ms.ToArray();
        var length = 4 + payload.Length;
        var buffer = new byte[1 + length];
        buffer[0] = (byte)'B';
        BinaryPrimitives.WriteInt32BigEndian(buffer.AsSpan(1), length);
        payload.CopyTo(buffer.AsSpan(5));
        return buffer;
    }

    public static byte[] BuildDescribeMessage(char type = 'P', string name = "")
    {
        var nameBytes = Encoding.UTF8.GetBytes(name);
        var length = 4 + 1 + nameBytes.Length + 1;

        var buffer = new byte[1 + length];
        buffer[0] = (byte)'D';
        BinaryPrimitives.WriteInt32BigEndian(buffer.AsSpan(1), length);
        buffer[5] = (byte)type;
        nameBytes.CopyTo(buffer.AsSpan(6));
        buffer[6 + nameBytes.Length] = 0;
        return buffer;
    }

    public static byte[] BuildExecuteMessage(string portalName = "", int maxRows = 0)
    {
        var nameBytes = Encoding.UTF8.GetBytes(portalName);
        var length = 4 + nameBytes.Length + 1 + 4;

        var buffer = new byte[1 + length];
        buffer[0] = (byte)'E';
        BinaryPrimitives.WriteInt32BigEndian(buffer.AsSpan(1), length);
        nameBytes.CopyTo(buffer.AsSpan(5));
        buffer[5 + nameBytes.Length] = 0;
        BinaryPrimitives.WriteInt32BigEndian(buffer.AsSpan(6 + nameBytes.Length), maxRows);
        return buffer;
    }

    public static byte[] BuildSyncMessage()
    {
        var buffer = new byte[5];
        buffer[0] = (byte)'S';
        BinaryPrimitives.WriteInt32BigEndian(buffer.AsSpan(1), 4);
        return buffer;
    }

    public static byte[] BuildTerminateMessage()
    {
        var buffer = new byte[5];
        buffer[0] = (byte)'X';
        BinaryPrimitives.WriteInt32BigEndian(buffer.AsSpan(1), 4);
        return buffer;
    }

    private static string ConvertParameterToString(object value)
    {
        return value switch
        {
            float[] embedding => TypeParser.SerializeEmbedding(embedding),
            bool b => b ? "t" : "f",
            DateTime dt => dt.ToString("o"),
            Guid g => g.ToString(),
            _ => Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture) ?? ""
        };
    }

    private static void WriteInt16BE(MemoryStream ms, short value)
    {
        Span<byte> buf = stackalloc byte[2];
        BinaryPrimitives.WriteInt16BigEndian(buf, value);
        ms.Write(buf);
    }

    private static void WriteInt32BE(MemoryStream ms, int value)
    {
        Span<byte> buf = stackalloc byte[4];
        BinaryPrimitives.WriteInt32BigEndian(buf, value);
        ms.Write(buf);
    }
}

internal record FieldDescription(string Name, int TableOid, short ColumnIndex, int TypeOid, short TypeSize, int TypeModifier, short FormatCode);

internal abstract record BackendMessage;
internal sealed record AuthenticationOkMessage : BackendMessage;
internal sealed record AuthenticationCleartextPasswordMessage : BackendMessage;
internal sealed record AuthenticationMd5PasswordMessage(byte[] Salt) : BackendMessage;
internal sealed record ParameterStatusMessage(string Name, string Value) : BackendMessage;
internal sealed record BackendKeyDataMessage(int ProcessId, int SecretKey) : BackendMessage;
internal sealed record ReadyForQueryMessage(char Status) : BackendMessage;
internal sealed record RowDescriptionMessage(FieldDescription[] Fields) : BackendMessage;
internal sealed record DataRowMessage(string?[] Values) : BackendMessage;
internal sealed record CommandCompleteMessage(string Tag) : BackendMessage;
internal sealed record ErrorResponseMessage(string Severity, string Code, string Message) : BackendMessage;
internal sealed record NoticeResponseMessage(string Severity, string Message) : BackendMessage;
internal sealed record ParseCompleteMessage : BackendMessage;
internal sealed record BindCompleteMessage : BackendMessage;
internal sealed record NoDataMessage : BackendMessage;
internal sealed record EmptyQueryResponseMessage : BackendMessage;

internal class MessageReader
{
    private byte[] _buffer = new byte[8192];
    private int _length;

    public void Append(byte[] data, int count)
    {
        EnsureCapacity(_length + count);
        Buffer.BlockCopy(data, 0, _buffer, _length, count);
        _length += count;
    }

    public BackendMessage? Read()
    {
        if (_length < 5) return null;

        var type = (char)_buffer[0];
        var bodyLength = BinaryPrimitives.ReadInt32BigEndian(_buffer.AsSpan(1));
        var totalLength = 1 + bodyLength;

        if (_length < totalLength) return null;

        var body = _buffer.AsSpan(5, bodyLength - 4);
        var message = ParseMessage(type, body);

        // Shift remaining data
        var remaining = _length - totalLength;
        if (remaining > 0)
        {
            Buffer.BlockCopy(_buffer, totalLength, _buffer, 0, remaining);
        }
        _length = remaining;

        return message;
    }

    private static BackendMessage ParseMessage(char type, ReadOnlySpan<byte> body)
    {
        return type switch
        {
            'R' => ParseAuthentication(body),
            'S' => ParseParameterStatus(body),
            'K' => ParseBackendKeyData(body),
            'Z' => new ReadyForQueryMessage((char)body[0]),
            'T' => ParseRowDescription(body),
            'D' => ParseDataRow(body),
            'C' => ParseCommandComplete(body),
            'E' => ParseErrorResponse(body),
            'N' => ParseNoticeResponse(body),
            '1' => new ParseCompleteMessage(),
            '2' => new BindCompleteMessage(),
            'n' => new NoDataMessage(),
            'I' => new EmptyQueryResponseMessage(),
            _ => throw new SixSevenDbException($"Unknown backend message type: {type}")
        };
    }

    private static BackendMessage ParseAuthentication(ReadOnlySpan<byte> body)
    {
        var authType = BinaryPrimitives.ReadInt32BigEndian(body);
        return authType switch
        {
            0 => new AuthenticationOkMessage(),
            3 => new AuthenticationCleartextPasswordMessage(),
            5 => new AuthenticationMd5PasswordMessage(body[4..8].ToArray()),
            _ => throw new SixSevenDbException($"Unsupported authentication type: {authType}")
        };
    }

    private static ParameterStatusMessage ParseParameterStatus(ReadOnlySpan<byte> body)
    {
        var nameEnd = body.IndexOf((byte)0);
        var name = Encoding.UTF8.GetString(body[..nameEnd]);
        var valueStart = nameEnd + 1;
        var valueEnd = body[valueStart..].IndexOf((byte)0);
        var value = Encoding.UTF8.GetString(body.Slice(valueStart, valueEnd));
        return new ParameterStatusMessage(name, value);
    }

    private static BackendKeyDataMessage ParseBackendKeyData(ReadOnlySpan<byte> body)
    {
        var pid = BinaryPrimitives.ReadInt32BigEndian(body);
        var key = BinaryPrimitives.ReadInt32BigEndian(body[4..]);
        return new BackendKeyDataMessage(pid, key);
    }

    private static RowDescriptionMessage ParseRowDescription(ReadOnlySpan<byte> body)
    {
        var fieldCount = BinaryPrimitives.ReadInt16BigEndian(body);
        var fields = new FieldDescription[fieldCount];
        var offset = 2;

        for (var i = 0; i < fieldCount; i++)
        {
            var nameEnd = body[offset..].IndexOf((byte)0);
            var name = Encoding.UTF8.GetString(body.Slice(offset, nameEnd));
            offset += nameEnd + 1;

            var tableOid = BinaryPrimitives.ReadInt32BigEndian(body[offset..]);
            offset += 4;
            var columnIndex = BinaryPrimitives.ReadInt16BigEndian(body[offset..]);
            offset += 2;
            var typeOid = BinaryPrimitives.ReadInt32BigEndian(body[offset..]);
            offset += 4;
            var typeSize = BinaryPrimitives.ReadInt16BigEndian(body[offset..]);
            offset += 2;
            var typeModifier = BinaryPrimitives.ReadInt32BigEndian(body[offset..]);
            offset += 4;
            var formatCode = BinaryPrimitives.ReadInt16BigEndian(body[offset..]);
            offset += 2;

            fields[i] = new FieldDescription(name, tableOid, columnIndex, typeOid, typeSize, typeModifier, formatCode);
        }

        return new RowDescriptionMessage(fields);
    }

    private static DataRowMessage ParseDataRow(ReadOnlySpan<byte> body)
    {
        var columnCount = BinaryPrimitives.ReadInt16BigEndian(body);
        var values = new string?[columnCount];
        var offset = 2;

        for (var i = 0; i < columnCount; i++)
        {
            var length = BinaryPrimitives.ReadInt32BigEndian(body[offset..]);
            offset += 4;
            if (length == -1)
            {
                values[i] = null;
            }
            else
            {
                values[i] = Encoding.UTF8.GetString(body.Slice(offset, length));
                offset += length;
            }
        }

        return new DataRowMessage(values);
    }

    private static CommandCompleteMessage ParseCommandComplete(ReadOnlySpan<byte> body)
    {
        var end = body.IndexOf((byte)0);
        var tag = end >= 0 ? Encoding.UTF8.GetString(body[..end]) : Encoding.UTF8.GetString(body);
        return new CommandCompleteMessage(tag);
    }

    private static ErrorResponseMessage ParseErrorResponse(ReadOnlySpan<byte> body)
    {
        string severity = "ERROR", code = "", message = "";
        var offset = 0;

        while (offset < body.Length && body[offset] != 0)
        {
            var fieldType = (char)body[offset++];
            var end = body[offset..].IndexOf((byte)0);
            var value = Encoding.UTF8.GetString(body.Slice(offset, end));
            offset += end + 1;

            switch (fieldType)
            {
                case 'S': severity = value; break;
                case 'C': code = value; break;
                case 'M': message = value; break;
            }
        }

        return new ErrorResponseMessage(severity, code, message);
    }

    private static NoticeResponseMessage ParseNoticeResponse(ReadOnlySpan<byte> body)
    {
        string severity = "NOTICE", message = "";
        var offset = 0;

        while (offset < body.Length && body[offset] != 0)
        {
            var fieldType = (char)body[offset++];
            var end = body[offset..].IndexOf((byte)0);
            var value = Encoding.UTF8.GetString(body.Slice(offset, end));
            offset += end + 1;

            switch (fieldType)
            {
                case 'S': severity = value; break;
                case 'M': message = value; break;
            }
        }

        return new NoticeResponseMessage(severity, message);
    }

    private void EnsureCapacity(int required)
    {
        if (_buffer.Length >= required) return;
        var newSize = Math.Max(_buffer.Length * 2, required);
        var newBuffer = new byte[newSize];
        Buffer.BlockCopy(_buffer, 0, newBuffer, 0, _length);
        _buffer = newBuffer;
    }
}
