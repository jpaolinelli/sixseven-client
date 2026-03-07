namespace SixSevenDB.Client.Tests;

public class DataReaderTests
{
    private static QueryResult CreateTestResult()
    {
        var result = new QueryResult();
        result.Fields.Add(new FieldInfo { Name = "id", DataTypeId = TypeOid.Int4 });
        result.Fields.Add(new FieldInfo { Name = "name", DataTypeId = TypeOid.Text });
        result.Fields.Add(new FieldInfo { Name = "active", DataTypeId = TypeOid.Bool });
        result.Fields.Add(new FieldInfo { Name = "score", DataTypeId = TypeOid.Float8 });
        result.Fields.Add(new FieldInfo { Name = "uuid", DataTypeId = TypeOid.Uuid });
        result.Fields.Add(new FieldInfo { Name = "embedding", DataTypeId = TypeOid.Embedding });

        var testGuid = Guid.Parse("12345678-1234-1234-1234-123456789abc");

        result.Rows.Add(new Dictionary<string, object?>
        {
            ["id"] = 1,
            ["name"] = "Alice",
            ["active"] = true,
            ["score"] = 95.5,
            ["uuid"] = testGuid,
            ["embedding"] = new float[] { 0.1f, 0.2f, 0.3f }
        });
        result.Rows.Add(new Dictionary<string, object?>
        {
            ["id"] = 2,
            ["name"] = "Bob",
            ["active"] = false,
            ["score"] = 87.3,
            ["uuid"] = Guid.Empty,
            ["embedding"] = new float[] { 0.4f, 0.5f, 0.6f }
        });
        result.RowCount = 2;
        result.Command = "SELECT 2";

        return result;
    }

    [Fact]
    public void FieldCount_ReturnsCorrectCount()
    {
        var reader = new SixSevenDbDataReader(CreateTestResult());
        Assert.Equal(6, reader.FieldCount);
    }

    [Fact]
    public void HasRows_ReturnsTrueWhenRowsExist()
    {
        var reader = new SixSevenDbDataReader(CreateTestResult());
        Assert.True(reader.HasRows);
    }

    [Fact]
    public void HasRows_ReturnsFalseWhenEmpty()
    {
        var reader = new SixSevenDbDataReader(new QueryResult());
        Assert.False(reader.HasRows);
    }

    [Fact]
    public void Read_AdvancesThroughRows()
    {
        var reader = new SixSevenDbDataReader(CreateTestResult());
        Assert.True(reader.Read());
        Assert.True(reader.Read());
        Assert.False(reader.Read());
    }

    [Fact]
    public void GetName_ReturnsFieldName()
    {
        var reader = new SixSevenDbDataReader(CreateTestResult());
        Assert.Equal("id", reader.GetName(0));
        Assert.Equal("name", reader.GetName(1));
    }

    [Fact]
    public void GetOrdinal_ReturnsFieldIndex()
    {
        var reader = new SixSevenDbDataReader(CreateTestResult());
        Assert.Equal(0, reader.GetOrdinal("id"));
        Assert.Equal(1, reader.GetOrdinal("name"));
    }

    [Fact]
    public void GetOrdinal_CaseInsensitive()
    {
        var reader = new SixSevenDbDataReader(CreateTestResult());
        Assert.Equal(0, reader.GetOrdinal("ID"));
        Assert.Equal(1, reader.GetOrdinal("Name"));
    }

    [Fact]
    public void GetOrdinal_ThrowsForUnknownColumn()
    {
        var reader = new SixSevenDbDataReader(CreateTestResult());
        Assert.Throws<IndexOutOfRangeException>(() => reader.GetOrdinal("nonexistent"));
    }

    [Fact]
    public void GetValue_ReturnsCorrectValues()
    {
        var reader = new SixSevenDbDataReader(CreateTestResult());
        reader.Read();

        Assert.Equal(1, reader.GetValue(0));
        Assert.Equal("Alice", reader.GetValue(1));
        Assert.Equal(true, reader.GetValue(2));
    }

    [Fact]
    public void GetInt32_ReturnsCorrectValue()
    {
        var reader = new SixSevenDbDataReader(CreateTestResult());
        reader.Read();
        Assert.Equal(1, reader.GetInt32(0));
    }

    [Fact]
    public void GetString_ReturnsCorrectValue()
    {
        var reader = new SixSevenDbDataReader(CreateTestResult());
        reader.Read();
        Assert.Equal("Alice", reader.GetString(1));
    }

    [Fact]
    public void GetBoolean_ReturnsCorrectValue()
    {
        var reader = new SixSevenDbDataReader(CreateTestResult());
        reader.Read();
        Assert.True(reader.GetBoolean(2));
    }

    [Fact]
    public void GetDouble_ReturnsCorrectValue()
    {
        var reader = new SixSevenDbDataReader(CreateTestResult());
        reader.Read();
        Assert.Equal(95.5, reader.GetDouble(3));
    }

    [Fact]
    public void GetGuid_ReturnsCorrectValue()
    {
        var reader = new SixSevenDbDataReader(CreateTestResult());
        reader.Read();
        Assert.Equal(Guid.Parse("12345678-1234-1234-1234-123456789abc"), reader.GetGuid(4));
    }

    [Fact]
    public void GetEmbedding_ReturnsFloatArray()
    {
        var reader = new SixSevenDbDataReader(CreateTestResult());
        reader.Read();
        var embedding = reader.GetEmbedding(5);
        Assert.Equal(3, embedding.Length);
        Assert.Equal(0.1f, embedding[0]);
    }

    [Fact]
    public void Indexer_ByOrdinal_ReturnsValue()
    {
        var reader = new SixSevenDbDataReader(CreateTestResult());
        reader.Read();
        Assert.Equal(1, reader[0]);
    }

    [Fact]
    public void Indexer_ByName_ReturnsValue()
    {
        var reader = new SixSevenDbDataReader(CreateTestResult());
        reader.Read();
        Assert.Equal("Alice", reader["name"]);
    }

    [Fact]
    public void IsDBNull_ReturnsTrueForNull()
    {
        var result = new QueryResult();
        result.Fields.Add(new FieldInfo { Name = "val", DataTypeId = TypeOid.Text });
        result.Rows.Add(new Dictionary<string, object?> { ["val"] = null });

        var reader = new SixSevenDbDataReader(result);
        reader.Read();
        Assert.True(reader.IsDBNull(0));
    }

    [Fact]
    public void IsDBNull_ReturnsFalseForNonNull()
    {
        var reader = new SixSevenDbDataReader(CreateTestResult());
        reader.Read();
        Assert.False(reader.IsDBNull(0));
    }

    [Fact]
    public void RecordsAffected_ReturnsRowCount()
    {
        var reader = new SixSevenDbDataReader(CreateTestResult());
        Assert.Equal(2, reader.RecordsAffected);
    }

    [Fact]
    public void NextResult_ReturnsFalse()
    {
        var reader = new SixSevenDbDataReader(CreateTestResult());
        Assert.False(reader.NextResult());
    }

    [Fact]
    public void Close_SetsIsClosed()
    {
        var reader = new SixSevenDbDataReader(CreateTestResult());
        Assert.False(reader.IsClosed);
        reader.Close();
        Assert.True(reader.IsClosed);
    }

    [Fact]
    public void Read_ReturnsFalseAfterClose()
    {
        var reader = new SixSevenDbDataReader(CreateTestResult());
        reader.Close();
        Assert.False(reader.Read());
    }

    [Fact]
    public void GetFieldType_ReturnsCorrectTypes()
    {
        var reader = new SixSevenDbDataReader(CreateTestResult());
        Assert.Equal(typeof(int), reader.GetFieldType(0));
        Assert.Equal(typeof(string), reader.GetFieldType(1));
        Assert.Equal(typeof(bool), reader.GetFieldType(2));
        Assert.Equal(typeof(double), reader.GetFieldType(3));
        Assert.Equal(typeof(Guid), reader.GetFieldType(4));
        Assert.Equal(typeof(float[]), reader.GetFieldType(5));
    }

    [Fact]
    public void GetDataTypeName_ReturnsCorrectNames()
    {
        var reader = new SixSevenDbDataReader(CreateTestResult());
        Assert.Equal("integer", reader.GetDataTypeName(0));
        Assert.Equal("text", reader.GetDataTypeName(1));
        Assert.Equal("boolean", reader.GetDataTypeName(2));
        Assert.Equal("double precision", reader.GetDataTypeName(3));
        Assert.Equal("uuid", reader.GetDataTypeName(4));
        Assert.Equal("embedding", reader.GetDataTypeName(5));
    }

    [Fact]
    public void GetSchemaTable_ReturnsCorrectSchema()
    {
        var reader = new SixSevenDbDataReader(CreateTestResult());
        var schema = reader.GetSchemaTable();
        Assert.Equal(6, schema.Rows.Count);
        Assert.Equal("id", schema.Rows[0]["ColumnName"]);
        Assert.Equal(0, schema.Rows[0]["ColumnOrdinal"]);
        Assert.Equal(typeof(int), schema.Rows[0]["DataType"]);
    }

    [Fact]
    public void GetValue_BeforeRead_Throws()
    {
        var reader = new SixSevenDbDataReader(CreateTestResult());
        Assert.Throws<InvalidOperationException>(() => reader.GetValue(0));
    }

    [Fact]
    public void GetValues_FillsArray()
    {
        var reader = new SixSevenDbDataReader(CreateTestResult());
        reader.Read();
        var values = new object[6];
        var count = reader.GetValues(values);
        Assert.Equal(6, count);
        Assert.Equal(1, values[0]);
        Assert.Equal("Alice", values[1]);
    }
}
