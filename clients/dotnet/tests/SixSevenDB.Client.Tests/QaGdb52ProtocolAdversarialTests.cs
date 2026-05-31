using System.Buffers.Binary;
using System.Text;

namespace SixSevenDB.Client.Tests;

/// <summary>
/// QA adversarial tests for GDB-52: Protocol message building/parsing edge cases.
/// </summary>
public class QaGdb52ProtocolAdversarialTests
{
    // ── Startup message ───────────────────────────────────────────────────

    [Fact]
    public void BuildStartupMessage_EmptyUser_DoesNotThrow()
    {
        var message = FrontendMessage.BuildStartupMessage("", "db");
        Assert.NotNull(message);
        Assert.True(message.Length > 8); // header + version minimum
    }

    [Fact]
    public void BuildStartupMessage_EmptyDatabase_DoesNotThrow()
    {
        var message = FrontendMessage.BuildStartupMessage("user", "");
        Assert.NotNull(message);
    }

    [Fact]
    public void BuildStartupMessage_UnicodeUser_Works()
    {
        var message = FrontendMessage.BuildStartupMessage("用户", "db");
        var str = Encoding.UTF8.GetString(message);
        Assert.Contains("用户", str);
    }

    [Fact]
    public void BuildStartupMessage_LengthField_IsCorrect()
    {
        var message = FrontendMessage.BuildStartupMessage("user", "db");
        var length = BinaryPrimitives.ReadInt32BigEndian(message.AsSpan(0, 4));
        Assert.Equal(message.Length, length);
    }

    // ── Query message ─────────────────────────────────────────────────────

    [Fact]
    public void BuildQueryMessage_EmptySql_Works()
    {
        var message = FrontendMessage.BuildQueryMessage("");
        Assert.Equal((byte)'Q', message[0]);
    }

    [Fact]
    public void BuildQueryMessage_UnicodeSql_Works()
    {
        var message = FrontendMessage.BuildQueryMessage("SELECT * FROM \"表\" WHERE \"名前\" = 'テスト'");
        Assert.Equal((byte)'Q', message[0]);
        var str = Encoding.UTF8.GetString(message);
        Assert.Contains("表", str);
    }

    [Fact]
    public void BuildQueryMessage_VeryLongSql_Works()
    {
        var sql = "SELECT " + new string('x', 100_000);
        var message = FrontendMessage.BuildQueryMessage(sql);
        Assert.Equal((byte)'Q', message[0]);
        var length = BinaryPrimitives.ReadInt32BigEndian(message.AsSpan(1));
        Assert.Equal(4 + Encoding.UTF8.GetByteCount(sql) + 1, length);
    }

    [Fact]
    public void BuildQueryMessage_NullTerminated()
    {
        var message = FrontendMessage.BuildQueryMessage("SELECT 1");
        Assert.Equal(0, message[^1]); // Last byte should be null terminator
    }

    // ── Password message ──────────────────────────────────────────────────

    [Fact]
    public void BuildPasswordMessage_EmptyPassword_Works()
    {
        var message = FrontendMessage.BuildPasswordMessage("");
        Assert.Equal((byte)'p', message[0]);
        var length = BinaryPrimitives.ReadInt32BigEndian(message.AsSpan(1));
        Assert.Equal(4 + 0 + 1, length); // 4 (length) + 0 (empty password) + 1 (null terminator)
    }

    [Fact]
    public void BuildPasswordMessage_UnicodePassword_Works()
    {
        var message = FrontendMessage.BuildPasswordMessage("пароль");
        Assert.Equal((byte)'p', message[0]);
    }

    // ── Bind message ──────────────────────────────────────────────────────

    [Fact]
    public void BuildBindMessage_EmptyParameters_Works()
    {
        var message = FrontendMessage.BuildBindMessage([]);
        Assert.Equal((byte)'B', message[0]);
    }

    [Fact]
    public void BuildBindMessage_ManyParameters_Works()
    {
        var parameters = Enumerable.Range(0, 100).Select(i => (object?)i.ToString()).ToArray();
        var message = FrontendMessage.BuildBindMessage(parameters);
        Assert.Equal((byte)'B', message[0]);
    }

    [Fact]
    public void BuildBindMessage_AllNullParameters_Works()
    {
        var message = FrontendMessage.BuildBindMessage([null, null, null]);
        Assert.Equal((byte)'B', message[0]);
    }

    [Fact]
    public void BuildBindMessage_EmbeddingParameter_Works()
    {
        var embedding = new float[] { 0.1f, 0.2f, 0.3f };
        var message = FrontendMessage.BuildBindMessage([embedding]);
        Assert.Equal((byte)'B', message[0]);
    }

    [Fact]
    public void BuildBindMessage_BoolTrue_SendsT()
    {
        var message = FrontendMessage.BuildBindMessage([true]);
        var str = Encoding.UTF8.GetString(message);
        Assert.Contains("t", str);
    }

    [Fact]
    public void BuildBindMessage_BoolFalse_SendsF()
    {
        var message = FrontendMessage.BuildBindMessage([false]);
        var str = Encoding.UTF8.GetString(message);
        Assert.Contains("f", str);
    }

    [Fact]
    public void BuildBindMessage_GuidParameter_Works()
    {
        var guid = Guid.NewGuid();
        var message = FrontendMessage.BuildBindMessage([guid]);
        var str = Encoding.UTF8.GetString(message);
        Assert.Contains(guid.ToString(), str);
    }

    [Fact]
    public void BuildBindMessage_DateTimeParameter_UsesIsoFormat()
    {
        var dt = new DateTime(2024, 6, 15, 10, 30, 0, DateTimeKind.Utc);
        var message = FrontendMessage.BuildBindMessage([dt]);
        var str = Encoding.UTF8.GetString(message);
        // Should contain ISO 8601 format
        Assert.Contains("2024-06-15", str);
    }

    // ── Parse / Describe / Execute / Sync ─────────────────────────────────

    [Fact]
    public void BuildParseMessage_EmptySql_Works()
    {
        var message = FrontendMessage.BuildParseMessage("");
        Assert.Equal((byte)'P', message[0]);
    }

    [Fact]
    public void BuildParseMessage_WithStatementName_Works()
    {
        var message = FrontendMessage.BuildParseMessage("SELECT $1", "stmt1");
        Assert.Equal((byte)'P', message[0]);
        var str = Encoding.UTF8.GetString(message);
        Assert.Contains("stmt1", str);
    }

    [Fact]
    public void BuildDescribeMessage_PortalType_Works()
    {
        var message = FrontendMessage.BuildDescribeMessage('P');
        Assert.Equal((byte)'D', message[0]);
        Assert.Equal((byte)'P', message[5]);
    }

    [Fact]
    public void BuildDescribeMessage_StatementType_Works()
    {
        var message = FrontendMessage.BuildDescribeMessage('S');
        Assert.Equal((byte)'D', message[0]);
        Assert.Equal((byte)'S', message[5]);
    }

    [Fact]
    public void BuildExecuteMessage_WithMaxRows_Works()
    {
        var message = FrontendMessage.BuildExecuteMessage("", 100);
        Assert.Equal((byte)'E', message[0]);
    }

    // ── MessageReader edge cases ──────────────────────────────────────────

    [Fact]
    public void MessageReader_EmptyQueryResponse_Parses()
    {
        var reader = new MessageReader();
        // 'I' type, length=4
        reader.Append(new byte[] { (byte)'I', 0, 0, 0, 4 }, 5);
        var message = reader.Read();
        Assert.IsType<EmptyQueryResponseMessage>(message);
    }

    [Fact]
    public void MessageReader_NoDataMessage_Parses()
    {
        var reader = new MessageReader();
        // 'n' type, length=4
        reader.Append(new byte[] { (byte)'n', 0, 0, 0, 4 }, 5);
        var message = reader.Read();
        Assert.IsType<NoDataMessage>(message);
    }

    [Fact]
    public void MessageReader_UnknownMessageType_Throws()
    {
        var reader = new MessageReader();
        // Unknown type 'X' is actually Terminate, but let's use another char
        reader.Append(new byte[] { (byte)'?', 0, 0, 0, 4 }, 5);
        Assert.ThrowsAny<Exception>(() => reader.Read());
    }

    [Fact]
    public void MessageReader_UnsupportedAuthType_Throws()
    {
        var reader = new MessageReader();
        // 'R' type, length=8, auth type=99 (unsupported)
        var data = new byte[] { (byte)'R', 0, 0, 0, 8, 0, 0, 0, 99 };
        reader.Append(data, data.Length);
        Assert.ThrowsAny<Exception>(() => reader.Read());
    }

    [Fact]
    public void MessageReader_NoticeResponse_Parses()
    {
        using var ms = new MemoryStream();
        ms.WriteByte((byte)'S');
        ms.Write(Encoding.UTF8.GetBytes("NOTICE"));
        ms.WriteByte(0);
        ms.WriteByte((byte)'M');
        ms.Write(Encoding.UTF8.GetBytes("advisory lock acquired"));
        ms.WriteByte(0);
        ms.WriteByte(0); // terminator

        var payload = ms.ToArray();
        var data = new byte[1 + 4 + payload.Length];
        data[0] = (byte)'N';
        BinaryPrimitives.WriteInt32BigEndian(data.AsSpan(1), 4 + payload.Length);
        payload.CopyTo(data.AsSpan(5));

        var reader = new MessageReader();
        reader.Append(data, data.Length);
        var message = reader.Read();
        var notice = Assert.IsType<NoticeResponseMessage>(message);
        Assert.Equal("NOTICE", notice.Severity);
        Assert.Equal("advisory lock acquired", notice.Message);
    }

    [Fact]
    public void MessageReader_BackendKeyData_Parses()
    {
        var reader = new MessageReader();
        var data = new byte[1 + 4 + 8];
        data[0] = (byte)'K';
        BinaryPrimitives.WriteInt32BigEndian(data.AsSpan(1), 12); // 4 + 8
        BinaryPrimitives.WriteInt32BigEndian(data.AsSpan(5), 1234); // process ID
        BinaryPrimitives.WriteInt32BigEndian(data.AsSpan(9), 5678); // secret key

        reader.Append(data, data.Length);
        var message = reader.Read();
        var key = Assert.IsType<BackendKeyDataMessage>(message);
        Assert.Equal(1234, key.ProcessId);
        Assert.Equal(5678, key.SecretKey);
    }

    [Fact]
    public void MessageReader_FragmentedMessage_AssemblesCorrectly()
    {
        var reader = new MessageReader();
        var fullMessage = new byte[] { (byte)'Z', 0, 0, 0, 5, (byte)'I' };

        // Send one byte at a time
        for (var i = 0; i < fullMessage.Length; i++)
        {
            reader.Append(new byte[] { fullMessage[i] }, 1);
            if (i < fullMessage.Length - 1)
            {
                Assert.Null(reader.Read()); // Not enough data yet
            }
        }

        var message = reader.Read();
        Assert.IsType<ReadyForQueryMessage>(message);
    }

    [Fact]
    public void MessageReader_MultipleMessagesInSingleAppend_AllParsed()
    {
        var reader = new MessageReader();

        // Three messages: ParseComplete, BindComplete, ReadyForQuery
        var combined = new byte[]
        {
            (byte)'1', 0, 0, 0, 4,           // ParseComplete
            (byte)'2', 0, 0, 0, 4,           // BindComplete
            (byte)'Z', 0, 0, 0, 5, (byte)'I' // ReadyForQuery
        };
        reader.Append(combined, combined.Length);

        Assert.IsType<ParseCompleteMessage>(reader.Read());
        Assert.IsType<BindCompleteMessage>(reader.Read());
        Assert.IsType<ReadyForQueryMessage>(reader.Read());
        Assert.Null(reader.Read());
    }

    [Fact]
    public void MessageReader_ErrorResponse_WithOnlyMessage()
    {
        using var ms = new MemoryStream();
        ms.WriteByte((byte)'M');
        ms.Write(Encoding.UTF8.GetBytes("something went wrong"));
        ms.WriteByte(0);
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
        Assert.Equal("something went wrong", err.Message);
        Assert.Equal("ERROR", err.Severity); // Default
    }

    [Fact]
    public void MessageReader_CommandComplete_WithoutNullTerminator()
    {
        // Some implementations might not have null terminator
        var tag = "INSERT 0 1";
        var tagBytes = Encoding.UTF8.GetBytes(tag);
        // No null terminator — test that parser still handles it
        var length = 4 + tagBytes.Length;
        var data = new byte[1 + 4 + tagBytes.Length];
        data[0] = (byte)'C';
        BinaryPrimitives.WriteInt32BigEndian(data.AsSpan(1), length);
        tagBytes.CopyTo(data.AsSpan(5));

        var reader = new MessageReader();
        reader.Append(data, data.Length);
        var message = reader.Read();
        var cmd = Assert.IsType<CommandCompleteMessage>(message);
        Assert.Equal("INSERT 0 1", cmd.Tag);
    }

    [Fact]
    public void MessageReader_DataRow_EmptyValues()
    {
        using var ms = new MemoryStream();
        WriteInt16BE(ms, 2); // 2 columns
        // Column 1: empty string
        WriteInt32BE(ms, 0); // length 0
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
        Assert.Equal("", dataRow.Values[0]);
        Assert.Null(dataRow.Values[1]);
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
