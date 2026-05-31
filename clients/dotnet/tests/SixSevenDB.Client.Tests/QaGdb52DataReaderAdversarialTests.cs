namespace SixSevenDB.Client.Tests;

/// <summary>
/// QA adversarial tests for GDB-52: DataReader edge cases and error paths.
/// </summary>
public class QaGdb52DataReaderAdversarialTests
{
    // ── Reading before/after valid position ────────────────────────────────

    [Fact]
    public void GetValue_AfterLastRow_Throws()
    {
        var result = CreateSingleRowResult();
        var reader = new SixSevenDbDataReader(result);
        reader.Read(); // Row 1
        reader.Read(); // Past end
        Assert.Throws<InvalidOperationException>(() => reader.GetValue(0));
    }

    [Fact]
    public void GetValue_BeforeFirstRead_Throws()
    {
        var result = CreateSingleRowResult();
        var reader = new SixSevenDbDataReader(result);
        Assert.Throws<InvalidOperationException>(() => reader.GetValue(0));
    }

    [Fact]
    public void GetValue_NegativeOrdinal_Throws()
    {
        var result = CreateSingleRowResult();
        var reader = new SixSevenDbDataReader(result);
        reader.Read();
        Assert.ThrowsAny<Exception>(() => reader.GetValue(-1));
    }

    [Fact]
    public void GetValue_OrdinalOutOfRange_Throws()
    {
        var result = CreateSingleRowResult();
        var reader = new SixSevenDbDataReader(result);
        reader.Read();
        Assert.ThrowsAny<Exception>(() => reader.GetValue(999));
    }

    // ── Empty result set ──────────────────────────────────────────────────

    [Fact]
    public void EmptyResult_FieldCount_IsZero()
    {
        var reader = new SixSevenDbDataReader(new QueryResult());
        Assert.Equal(0, reader.FieldCount);
    }

    [Fact]
    public void EmptyResult_HasRows_IsFalse()
    {
        var reader = new SixSevenDbDataReader(new QueryResult());
        Assert.False(reader.HasRows);
    }

    [Fact]
    public void EmptyResult_Read_ReturnsFalse()
    {
        var reader = new SixSevenDbDataReader(new QueryResult());
        Assert.False(reader.Read());
    }

    [Fact]
    public void EmptyResult_GetSchemaTable_HasNoRows()
    {
        var reader = new SixSevenDbDataReader(new QueryResult());
        var schema = reader.GetSchemaTable();
        Assert.Empty(schema.Rows);
    }

    // ── NULL value handling ───────────────────────────────────────────────

    [Fact]
    public void GetValue_NullColumn_ReturnsDBNull()
    {
        var result = new QueryResult();
        result.Fields.Add(new FieldInfo { Name = "col", DataTypeId = TypeOid.Text });
        result.Rows.Add(new Dictionary<string, object?> { ["col"] = null });

        var reader = new SixSevenDbDataReader(result);
        reader.Read();
        Assert.Equal(DBNull.Value, reader.GetValue(0));
    }

    [Fact]
    public void GetString_NullColumn_DoesNotThrowNull()
    {
        var result = new QueryResult();
        result.Fields.Add(new FieldInfo { Name = "col", DataTypeId = TypeOid.Text });
        result.Rows.Add(new Dictionary<string, object?> { ["col"] = null });

        var reader = new SixSevenDbDataReader(result);
        reader.Read();
        // GetString calls GetValue which returns DBNull.Value, then calls ToString()
        // DBNull.Value.ToString() returns "" so this should not throw
        var value = reader.GetString(0);
        Assert.NotNull(value);
    }

    // ── Type cast edge cases ──────────────────────────────────────────────

    [Fact]
    public void GetEmbedding_NonEmbeddingColumn_Throws()
    {
        var result = new QueryResult();
        result.Fields.Add(new FieldInfo { Name = "name", DataTypeId = TypeOid.Text });
        result.Rows.Add(new Dictionary<string, object?> { ["name"] = "hello" });

        var reader = new SixSevenDbDataReader(result);
        reader.Read();
        Assert.Throws<InvalidCastException>(() => reader.GetEmbedding(0));
    }

    [Fact]
    public void GetBoolean_IntColumn_ThrowsInvalidCast()
    {
        var result = new QueryResult();
        result.Fields.Add(new FieldInfo { Name = "id", DataTypeId = TypeOid.Int4 });
        result.Rows.Add(new Dictionary<string, object?> { ["id"] = 1 });

        var reader = new SixSevenDbDataReader(result);
        reader.Read();
        Assert.ThrowsAny<Exception>(() => reader.GetBoolean(0));
    }

    [Fact]
    public void GetInt32_StringColumn_ThrowsInvalidCast()
    {
        var result = new QueryResult();
        result.Fields.Add(new FieldInfo { Name = "name", DataTypeId = TypeOid.Text });
        result.Rows.Add(new Dictionary<string, object?> { ["name"] = "hello" });

        var reader = new SixSevenDbDataReader(result);
        reader.Read();
        Assert.ThrowsAny<Exception>(() => reader.GetInt32(0));
    }

    // ── Indexer edge cases ────────────────────────────────────────────────

    [Fact]
    public void Indexer_ByName_UnknownColumn_Throws()
    {
        var result = CreateSingleRowResult();
        var reader = new SixSevenDbDataReader(result);
        reader.Read();
        Assert.ThrowsAny<Exception>(() => reader["nonexistent"]);
    }

    // ── GetValues with undersized array ───────────────────────────────────

    [Fact]
    public void GetValues_SmallArray_ReturnsPartial()
    {
        var result = CreateSingleRowResult();
        var reader = new SixSevenDbDataReader(result);
        reader.Read();

        var values = new object[1]; // Only room for 1 of 2 columns
        var count = reader.GetValues(values);
        Assert.Equal(1, count);
        Assert.Equal(42, values[0]);
    }

    [Fact]
    public void GetValues_OversizedArray_ReturnsFieldCount()
    {
        var result = CreateSingleRowResult();
        var reader = new SixSevenDbDataReader(result);
        reader.Read();

        var values = new object[10];
        var count = reader.GetValues(values);
        Assert.Equal(2, count); // Only 2 fields
    }

    // ── Multiple Read() calls ─────────────────────────────────────────────

    [Fact]
    public void Read_CalledRepeatedlyAfterEnd_ReturnsFalse()
    {
        var reader = new SixSevenDbDataReader(new QueryResult());
        Assert.False(reader.Read());
        Assert.False(reader.Read());
        Assert.False(reader.Read());
    }

    // ── Close behavior ────────────────────────────────────────────────────

    [Fact]
    public void Close_Idempotent()
    {
        var reader = new SixSevenDbDataReader(CreateSingleRowResult());
        reader.Close();
        reader.Close(); // Should not throw
        Assert.True(reader.IsClosed);
    }

    [Fact]
    public void GetValue_AfterClose_ThrowsOrReturnsFalse()
    {
        var result = CreateSingleRowResult();
        var reader = new SixSevenDbDataReader(result);
        reader.Read();
        reader.Close();
        // Read should return false after close
        Assert.False(reader.Read());
    }

    // ── GetBytes/GetChars ─────────────────────────────────────────────────

    [Fact]
    public void GetBytes_ThrowsNotSupported()
    {
        var reader = new SixSevenDbDataReader(CreateSingleRowResult());
        reader.Read();
        Assert.Throws<NotSupportedException>(() => reader.GetBytes(0, 0, null, 0, 0));
    }

    [Fact]
    public void GetChars_ThrowsNotSupported()
    {
        var reader = new SixSevenDbDataReader(CreateSingleRowResult());
        reader.Read();
        Assert.Throws<NotSupportedException>(() => reader.GetChars(0, 0, null, 0, 0));
    }

    // ── GetFieldType / GetDataTypeName for all types ──────────────────────

    [Theory]
    [InlineData(TypeOid.Bool, typeof(bool), "boolean")]
    [InlineData(TypeOid.Int2, typeof(short), "smallint")]
    [InlineData(TypeOid.Int4, typeof(int), "integer")]
    [InlineData(TypeOid.Int8, typeof(long), "bigint")]
    [InlineData(TypeOid.Float4, typeof(float), "real")]
    [InlineData(TypeOid.Float8, typeof(double), "double precision")]
    [InlineData(TypeOid.Numeric, typeof(decimal), "numeric")]
    [InlineData(TypeOid.Text, typeof(string), "text")]
    [InlineData(TypeOid.Varchar, typeof(string), "text")]
    [InlineData(TypeOid.Uuid, typeof(Guid), "uuid")]
    [InlineData(TypeOid.Json, typeof(string), "json")]
    [InlineData(TypeOid.Jsonb, typeof(string), "json")]
    [InlineData(TypeOid.Embedding, typeof(float[]), "embedding")]
    public void GetFieldType_And_GetDataTypeName_AllTypes(int typeOid, Type expectedClrType, string expectedDataTypeName)
    {
        var result = new QueryResult();
        result.Fields.Add(new FieldInfo { Name = "col", DataTypeId = typeOid });
        result.Rows.Add(new Dictionary<string, object?> { ["col"] = null });

        var reader = new SixSevenDbDataReader(result);
        Assert.Equal(expectedClrType, reader.GetFieldType(0));
        Assert.Equal(expectedDataTypeName, reader.GetDataTypeName(0));
    }

    [Fact]
    public void GetFieldType_UnknownTypeOid_ReturnsString()
    {
        var result = new QueryResult();
        result.Fields.Add(new FieldInfo { Name = "col", DataTypeId = 999999 });
        result.Rows.Add(new Dictionary<string, object?> { ["col"] = null });

        var reader = new SixSevenDbDataReader(result);
        Assert.Equal(typeof(string), reader.GetFieldType(0));
        Assert.Equal("text", reader.GetDataTypeName(0));
    }

    // ── GetEnumerator ─────────────────────────────────────────────────────

    [Fact]
    public void GetEnumerator_Works()
    {
        var reader = new SixSevenDbDataReader(CreateSingleRowResult());
        var enumerator = reader.GetEnumerator();
        Assert.NotNull(enumerator);
    }

    // ── Depth property ────────────────────────────────────────────────────

    [Fact]
    public void Depth_IsAlwaysZero()
    {
        var reader = new SixSevenDbDataReader(CreateSingleRowResult());
        Assert.Equal(0, reader.Depth);
    }

    // ── Helper ────────────────────────────────────────────────────────────

    private static QueryResult CreateSingleRowResult()
    {
        var result = new QueryResult();
        result.Fields.Add(new FieldInfo { Name = "id", DataTypeId = TypeOid.Int4 });
        result.Fields.Add(new FieldInfo { Name = "name", DataTypeId = TypeOid.Text });
        result.Rows.Add(new Dictionary<string, object?>
        {
            ["id"] = 42,
            ["name"] = "test"
        });
        result.RowCount = 1;
        return result;
    }
}
