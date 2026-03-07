using System.Buffers.Binary;
using System.Text;

namespace SixSevenDB.Client.Tests;

public class ProtocolTests
{
    [Fact]
    public void BuildStartupMessage_ContainsProtocolVersion()
    {
        var message = FrontendMessage.BuildStartupMessage("sixseven", "testdb");

        // First 4 bytes = length, next 4 bytes = protocol version (196608 = 3.0)
        var version = BinaryPrimitives.ReadInt32BigEndian(message.AsSpan(4));
        Assert.Equal(196608, version);
    }

    [Fact]
    public void BuildStartupMessage_ContainsUserAndDatabase()
    {
        var message = FrontendMessage.BuildStartupMessage("myuser", "mydb");
        var str = Encoding.UTF8.GetString(message);

        Assert.Contains("user", str);
        Assert.Contains("myuser", str);
        Assert.Contains("database", str);
        Assert.Contains("mydb", str);
    }

    [Fact]
    public void BuildPasswordMessage_HasCorrectType()
    {
        var message = FrontendMessage.BuildPasswordMessage("secret");
        Assert.Equal((byte)'p', message[0]);
    }

    [Fact]
    public void BuildPasswordMessage_ContainsPassword()
    {
        var message = FrontendMessage.BuildPasswordMessage("secret");
        var payload = Encoding.UTF8.GetString(message, 5, message.Length - 6); // skip type+length, exclude null
        Assert.Equal("secret", payload);
    }

    [Fact]
    public void BuildMd5PasswordMessage_HasMd5Prefix()
    {
        var salt = new byte[] { 0x01, 0x02, 0x03, 0x04 };
        var message = FrontendMessage.BuildMd5PasswordMessage("user", "pass", salt);
        var str = Encoding.UTF8.GetString(message);
        Assert.Contains("md5", str);
    }

    [Fact]
    public void BuildQueryMessage_HasCorrectType()
    {
        var message = FrontendMessage.BuildQueryMessage("SELECT 1");
        Assert.Equal((byte)'Q', message[0]);
    }

    [Fact]
    public void BuildQueryMessage_ContainsSql()
    {
        var message = FrontendMessage.BuildQueryMessage("SELECT 1");
        var payload = Encoding.UTF8.GetString(message, 5, message.Length - 6);
        Assert.Equal("SELECT 1", payload);
    }

    [Fact]
    public void BuildQueryMessage_HasCorrectLength()
    {
        var sql = "SELECT 1";
        var message = FrontendMessage.BuildQueryMessage(sql);
        var length = BinaryPrimitives.ReadInt32BigEndian(message.AsSpan(1));
        Assert.Equal(4 + Encoding.UTF8.GetByteCount(sql) + 1, length);
    }

    [Fact]
    public void BuildParseMessage_HasCorrectType()
    {
        var message = FrontendMessage.BuildParseMessage("SELECT $1");
        Assert.Equal((byte)'P', message[0]);
    }

    [Fact]
    public void BuildBindMessage_HasCorrectType()
    {
        var message = FrontendMessage.BuildBindMessage(["hello"]);
        Assert.Equal((byte)'B', message[0]);
    }

    [Fact]
    public void BuildBindMessage_HandlesNullParameter()
    {
        var message = FrontendMessage.BuildBindMessage([null, "test"]);
        Assert.Equal((byte)'B', message[0]);
        // Should not throw
    }

    [Fact]
    public void BuildDescribeMessage_HasCorrectType()
    {
        var message = FrontendMessage.BuildDescribeMessage();
        Assert.Equal((byte)'D', message[0]);
    }

    [Fact]
    public void BuildExecuteMessage_HasCorrectType()
    {
        var message = FrontendMessage.BuildExecuteMessage();
        Assert.Equal((byte)'E', message[0]);
    }

    [Fact]
    public void BuildSyncMessage_HasCorrectTypeAndLength()
    {
        var message = FrontendMessage.BuildSyncMessage();
        Assert.Equal(5, message.Length);
        Assert.Equal((byte)'S', message[0]);
        Assert.Equal(4, BinaryPrimitives.ReadInt32BigEndian(message.AsSpan(1)));
    }

    [Fact]
    public void BuildTerminateMessage_HasCorrectTypeAndLength()
    {
        var message = FrontendMessage.BuildTerminateMessage();
        Assert.Equal(5, message.Length);
        Assert.Equal((byte)'X', message[0]);
        Assert.Equal(4, BinaryPrimitives.ReadInt32BigEndian(message.AsSpan(1)));
    }
}

public class MessageReaderTests
{
    [Fact]
    public void Read_ReturnsNull_WhenBufferEmpty()
    {
        var reader = new MessageReader();
        Assert.Null(reader.Read());
    }

    [Fact]
    public void Read_ReturnsNull_WhenIncompleteMessage()
    {
        var reader = new MessageReader();
        reader.Append(new byte[] { (byte)'Z', 0, 0 }, 3);
        Assert.Null(reader.Read());
    }

    [Fact]
    public void Read_ParsesReadyForQuery()
    {
        var reader = new MessageReader();
        // 'Z' type, length=5 (4+1), status='I' (idle)
        var data = new byte[] { (byte)'Z', 0, 0, 0, 5, (byte)'I' };
        reader.Append(data, data.Length);

        var message = reader.Read();
        Assert.IsType<ReadyForQueryMessage>(message);
        Assert.Equal('I', ((ReadyForQueryMessage)message).Status);
    }

    [Fact]
    public void Read_ParsesAuthenticationOk()
    {
        var reader = new MessageReader();
        // 'R' type, length=8 (4+4), auth type=0
        var data = new byte[] { (byte)'R', 0, 0, 0, 8, 0, 0, 0, 0 };
        reader.Append(data, data.Length);

        var message = reader.Read();
        Assert.IsType<AuthenticationOkMessage>(message);
    }

    [Fact]
    public void Read_ParsesAuthenticationCleartextPassword()
    {
        var reader = new MessageReader();
        // 'R' type, length=8, auth type=3
        var data = new byte[] { (byte)'R', 0, 0, 0, 8, 0, 0, 0, 3 };
        reader.Append(data, data.Length);

        var message = reader.Read();
        Assert.IsType<AuthenticationCleartextPasswordMessage>(message);
    }

    [Fact]
    public void Read_ParsesAuthenticationMd5Password()
    {
        var reader = new MessageReader();
        // 'R' type, length=12, auth type=5, salt=4 bytes
        var data = new byte[] { (byte)'R', 0, 0, 0, 12, 0, 0, 0, 5, 0xAA, 0xBB, 0xCC, 0xDD };
        reader.Append(data, data.Length);

        var message = reader.Read();
        var md5 = Assert.IsType<AuthenticationMd5PasswordMessage>(message);
        Assert.Equal(new byte[] { 0xAA, 0xBB, 0xCC, 0xDD }, md5.Salt);
    }

    [Fact]
    public void Read_ParsesCommandComplete()
    {
        var reader = new MessageReader();
        var tag = "SELECT 5\0";
        var tagBytes = Encoding.UTF8.GetBytes(tag);
        var length = 4 + tagBytes.Length;

        var data = new byte[1 + 4 + tagBytes.Length];
        data[0] = (byte)'C';
        BinaryPrimitives.WriteInt32BigEndian(data.AsSpan(1), length);
        tagBytes.CopyTo(data.AsSpan(5));

        reader.Append(data, data.Length);
        var message = reader.Read();
        var cmd = Assert.IsType<CommandCompleteMessage>(message);
        Assert.Equal("SELECT 5", cmd.Tag);
    }

    [Fact]
    public void Read_ParsesRowDescription()
    {
        using var ms = new MemoryStream();
        // Field count = 1
        WriteInt16BE(ms, 1);
        // Field name "id\0"
        ms.Write(Encoding.UTF8.GetBytes("id"));
        ms.WriteByte(0);
        // Table OID
        WriteInt32BE(ms, 0);
        // Column index
        WriteInt16BE(ms, 0);
        // Type OID (int4 = 23)
        WriteInt32BE(ms, 23);
        // Type size
        WriteInt16BE(ms, 4);
        // Type modifier
        WriteInt32BE(ms, -1);
        // Format code
        WriteInt16BE(ms, 0);

        var payload = ms.ToArray();
        var data = new byte[1 + 4 + payload.Length];
        data[0] = (byte)'T';
        BinaryPrimitives.WriteInt32BigEndian(data.AsSpan(1), 4 + payload.Length);
        payload.CopyTo(data.AsSpan(5));

        var reader = new MessageReader();
        reader.Append(data, data.Length);
        var message = reader.Read();
        var rowDesc = Assert.IsType<RowDescriptionMessage>(message);
        Assert.Single(rowDesc.Fields);
        Assert.Equal("id", rowDesc.Fields[0].Name);
        Assert.Equal(23, rowDesc.Fields[0].TypeOid);
    }

    [Fact]
    public void Read_ParsesDataRow()
    {
        using var ms = new MemoryStream();
        // Column count = 2
        WriteInt16BE(ms, 2);
        // Column 1: "hello"
        var val1 = Encoding.UTF8.GetBytes("hello");
        WriteInt32BE(ms, val1.Length);
        ms.Write(val1);
        // Column 2: null
        WriteInt32BE(ms, -1);

        var payload = ms.ToArray();
        var data = new byte[1 + 4 + payload.Length];
        data[0] = (byte)'D';
        BinaryPrimitives.WriteInt32BigEndian(data.AsSpan(1), 4 + payload.Length);
        payload.CopyTo(data.AsSpan(5));

        var reader = new MessageReader();
        reader.Append(data, data.Length);
        var message = reader.Read();
        var dataRow = Assert.IsType<DataRowMessage>(message);
        Assert.Equal(2, dataRow.Values.Length);
        Assert.Equal("hello", dataRow.Values[0]);
        Assert.Null(dataRow.Values[1]);
    }

    [Fact]
    public void Read_ParsesErrorResponse()
    {
        using var ms = new MemoryStream();
        // Severity
        ms.WriteByte((byte)'S');
        ms.Write(Encoding.UTF8.GetBytes("ERROR"));
        ms.WriteByte(0);
        // Code
        ms.WriteByte((byte)'C');
        ms.Write(Encoding.UTF8.GetBytes("42P01"));
        ms.WriteByte(0);
        // Message
        ms.WriteByte((byte)'M');
        ms.Write(Encoding.UTF8.GetBytes("relation does not exist"));
        ms.WriteByte(0);
        // Terminator
        ms.WriteByte(0);

        var payload = ms.ToArray();
        var data = new byte[1 + 4 + payload.Length];
        data[0] = (byte)'E';
        BinaryPrimitives.WriteInt32BigEndian(data.AsSpan(1), 4 + payload.Length);
        payload.CopyTo(data.AsSpan(5));

        var reader = new MessageReader();
        reader.Append(data, data.Length);
        var message = reader.Read();
        var err = Assert.IsType<ErrorResponseMessage>(message);
        Assert.Equal("ERROR", err.Severity);
        Assert.Equal("42P01", err.Code);
        Assert.Equal("relation does not exist", err.Message);
    }

    [Fact]
    public void Read_ParsesMultipleMessages()
    {
        var reader = new MessageReader();

        // ParseComplete ('1', length=4)
        var msg1 = new byte[] { (byte)'1', 0, 0, 0, 4 };
        // BindComplete ('2', length=4)
        var msg2 = new byte[] { (byte)'2', 0, 0, 0, 4 };

        var combined = new byte[msg1.Length + msg2.Length];
        msg1.CopyTo(combined, 0);
        msg2.CopyTo(combined, msg1.Length);
        reader.Append(combined, combined.Length);

        var first = reader.Read();
        Assert.IsType<ParseCompleteMessage>(first);

        var second = reader.Read();
        Assert.IsType<BindCompleteMessage>(second);

        Assert.Null(reader.Read());
    }

    [Fact]
    public void Read_HandlesPartialData()
    {
        var reader = new MessageReader();

        // Send first 3 bytes of a ReadyForQuery message
        reader.Append(new byte[] { (byte)'Z', 0, 0 }, 3);
        Assert.Null(reader.Read());

        // Send remaining bytes
        reader.Append(new byte[] { 0, 5, (byte)'I' }, 3);
        var message = reader.Read();
        Assert.IsType<ReadyForQueryMessage>(message);
    }

    [Fact]
    public void Read_ParsesParameterStatus()
    {
        using var ms = new MemoryStream();
        ms.Write(Encoding.UTF8.GetBytes("server_encoding"));
        ms.WriteByte(0);
        ms.Write(Encoding.UTF8.GetBytes("UTF8"));
        ms.WriteByte(0);

        var payload = ms.ToArray();
        var data = new byte[1 + 4 + payload.Length];
        data[0] = (byte)'S';
        BinaryPrimitives.WriteInt32BigEndian(data.AsSpan(1), 4 + payload.Length);
        payload.CopyTo(data.AsSpan(5));

        var reader = new MessageReader();
        reader.Append(data, data.Length);
        var message = reader.Read();
        var ps = Assert.IsType<ParameterStatusMessage>(message);
        Assert.Equal("server_encoding", ps.Name);
        Assert.Equal("UTF8", ps.Value);
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
