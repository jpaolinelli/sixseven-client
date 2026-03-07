namespace SixSevenDB.Client.Tests;

public class TypeParserTests
{
    [Theory]
    [InlineData("t", true)]
    [InlineData("true", true)]
    [InlineData("TRUE", true)]
    [InlineData("1", true)]
    [InlineData("f", false)]
    [InlineData("false", false)]
    [InlineData("0", false)]
    public void ParseBool_ReturnsCorrectValue(string input, bool expected)
    {
        Assert.Equal(expected, TypeParser.ParseBool(input));
    }

    [Fact]
    public void ParseValue_Bool_ReturnsBool()
    {
        var result = TypeParser.ParseValue("t", TypeOid.Bool);
        Assert.IsType<bool>(result);
        Assert.True((bool)result!);
    }

    [Fact]
    public void ParseValue_Int2_ReturnsShort()
    {
        var result = TypeParser.ParseValue("42", TypeOid.Int2);
        Assert.IsType<short>(result);
        Assert.Equal((short)42, result);
    }

    [Fact]
    public void ParseValue_Int4_ReturnsInt()
    {
        var result = TypeParser.ParseValue("12345", TypeOid.Int4);
        Assert.IsType<int>(result);
        Assert.Equal(12345, result);
    }

    [Fact]
    public void ParseValue_Int8_ReturnsLong()
    {
        var result = TypeParser.ParseValue("9999999999", TypeOid.Int8);
        Assert.IsType<long>(result);
        Assert.Equal(9999999999L, result);
    }

    [Fact]
    public void ParseValue_Float4_ReturnsFloat()
    {
        var result = TypeParser.ParseValue("3.14", TypeOid.Float4);
        Assert.IsType<float>(result);
        Assert.Equal(3.14f, (float)result!, 2);
    }

    [Fact]
    public void ParseValue_Float8_ReturnsDouble()
    {
        var result = TypeParser.ParseValue("3.14159265", TypeOid.Float8);
        Assert.IsType<double>(result);
        Assert.Equal(3.14159265, (double)result!, 5);
    }

    [Fact]
    public void ParseValue_Numeric_ReturnsDecimal()
    {
        var result = TypeParser.ParseValue("123.456", TypeOid.Numeric);
        Assert.IsType<decimal>(result);
        Assert.Equal(123.456m, result);
    }

    [Fact]
    public void ParseValue_Uuid_ReturnsGuid()
    {
        var guid = Guid.NewGuid();
        var result = TypeParser.ParseValue(guid.ToString(), TypeOid.Uuid);
        Assert.IsType<Guid>(result);
        Assert.Equal(guid, result);
    }

    [Fact]
    public void ParseValue_Text_ReturnsString()
    {
        var result = TypeParser.ParseValue("hello world", TypeOid.Text);
        Assert.IsType<string>(result);
        Assert.Equal("hello world", result);
    }

    [Fact]
    public void ParseValue_Null_ReturnsNull()
    {
        var result = TypeParser.ParseValue(null, TypeOid.Text);
        Assert.Null(result);
    }

    [Fact]
    public void ParseValue_Json_ReturnsJsonDocument()
    {
        var result = TypeParser.ParseValue("{\"key\":\"value\"}", TypeOid.Json);
        Assert.IsType<System.Text.Json.JsonDocument>(result);
    }

    [Fact]
    public void ParseEmbedding_ParsesBracketedFloatArray()
    {
        var result = TypeParser.ParseEmbedding("[0.1,0.2,0.3]");
        Assert.Equal(3, result.Length);
        Assert.Equal(0.1f, result[0], 5);
        Assert.Equal(0.2f, result[1], 5);
        Assert.Equal(0.3f, result[2], 5);
    }

    [Fact]
    public void ParseEmbedding_HandlesWhitespace()
    {
        var result = TypeParser.ParseEmbedding("[ 0.1 , 0.2 , 0.3 ]");
        Assert.Equal(3, result.Length);
    }

    [Fact]
    public void ParseEmbedding_EmptyArray()
    {
        var result = TypeParser.ParseEmbedding("[]");
        Assert.Empty(result);
    }

    [Fact]
    public void ParseValue_Embedding_ReturnsFloatArray()
    {
        var result = TypeParser.ParseValue("[1.0,2.0,3.0]", TypeOid.Embedding);
        Assert.IsType<float[]>(result);
        var arr = (float[])result!;
        Assert.Equal(3, arr.Length);
        Assert.Equal(1.0f, arr[0]);
    }

    [Fact]
    public void SerializeEmbedding_FormatsCorrectly()
    {
        var embedding = new float[] { 0.1f, 0.2f, 0.3f };
        var result = TypeParser.SerializeEmbedding(embedding);
        Assert.Equal("[0.1,0.2,0.3]", result);
    }

    [Fact]
    public void SerializeEmbedding_RoundTrips()
    {
        var original = new float[] { 1.5f, -2.3f, 0.0f, 99.99f };
        var serialized = TypeParser.SerializeEmbedding(original);
        var parsed = TypeParser.ParseEmbedding(serialized);
        Assert.Equal(original.Length, parsed.Length);
        for (var i = 0; i < original.Length; i++)
        {
            Assert.Equal(original[i], parsed[i], 2);
        }
    }

    [Fact]
    public void ParseValue_UnknownType_ReturnsString()
    {
        var result = TypeParser.ParseValue("some value", 99999);
        Assert.IsType<string>(result);
        Assert.Equal("some value", result);
    }
}
