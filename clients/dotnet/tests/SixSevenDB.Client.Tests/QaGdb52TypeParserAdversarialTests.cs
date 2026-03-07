using System.Globalization;
using System.Text.Json;

namespace SixSevenDB.Client.Tests;

/// <summary>
/// QA adversarial tests for GDB-52: TypeParser edge cases, boundary values, and error paths.
/// </summary>
public class QaGdb52TypeParserAdversarialTests
{
    // ── ParseBool edge cases ──────────────────────────────────────────────

    [Theory]
    [InlineData("True")]
    [InlineData("T")]
    [InlineData("yes")]
    [InlineData("Y")]
    [InlineData("")]
    [InlineData(" ")]
    [InlineData("tRUE")]
    public void ParseBool_NonStandardTruthyValues_ReturnFalse(string input)
    {
        // PG wire protocol only sends "t" or "f", so anything else should be false
        Assert.False(TypeParser.ParseBool(input));
    }

    // ── ParseValue null handling ──────────────────────────────────────────

    [Theory]
    [InlineData(TypeOid.Bool)]
    [InlineData(TypeOid.Int4)]
    [InlineData(TypeOid.Float8)]
    [InlineData(TypeOid.Uuid)]
    [InlineData(TypeOid.Embedding)]
    [InlineData(TypeOid.Json)]
    public void ParseValue_Null_ReturnsNull_ForAllTypes(int typeOid)
    {
        Assert.Null(TypeParser.ParseValue(null, typeOid));
    }

    // ── Numeric overflow / boundary values ────────────────────────────────

    [Fact]
    public void ParseValue_Int2_MaxValue_Works()
    {
        var result = TypeParser.ParseValue("32767", TypeOid.Int2);
        Assert.Equal(short.MaxValue, result);
    }

    [Fact]
    public void ParseValue_Int2_MinValue_Works()
    {
        var result = TypeParser.ParseValue("-32768", TypeOid.Int2);
        Assert.Equal(short.MinValue, result);
    }

    [Fact]
    public void ParseValue_Int2_Overflow_Throws()
    {
        Assert.ThrowsAny<Exception>(() => TypeParser.ParseValue("32768", TypeOid.Int2));
    }

    [Fact]
    public void ParseValue_Int4_MaxValue_Works()
    {
        var result = TypeParser.ParseValue("2147483647", TypeOid.Int4);
        Assert.Equal(int.MaxValue, result);
    }

    [Fact]
    public void ParseValue_Int4_MinValue_Works()
    {
        var result = TypeParser.ParseValue("-2147483648", TypeOid.Int4);
        Assert.Equal(int.MinValue, result);
    }

    [Fact]
    public void ParseValue_Int4_Overflow_Throws()
    {
        Assert.ThrowsAny<Exception>(() => TypeParser.ParseValue("2147483648", TypeOid.Int4));
    }

    [Fact]
    public void ParseValue_Int8_MaxValue_Works()
    {
        var result = TypeParser.ParseValue("9223372036854775807", TypeOid.Int8);
        Assert.Equal(long.MaxValue, result);
    }

    [Fact]
    public void ParseValue_Int8_MinValue_Works()
    {
        var result = TypeParser.ParseValue("-9223372036854775808", TypeOid.Int8);
        Assert.Equal(long.MinValue, result);
    }

    [Fact]
    public void ParseValue_Int8_Overflow_Throws()
    {
        Assert.ThrowsAny<Exception>(() => TypeParser.ParseValue("9223372036854775808", TypeOid.Int8));
    }

    // ── Float special values ──────────────────────────────────────────────

    [Fact]
    public void ParseValue_Float4_NaN_Throws()
    {
        // PG can return "NaN" for float columns
        var result = TypeParser.ParseValue("NaN", TypeOid.Float4);
        Assert.IsType<float>(result);
        Assert.True(float.IsNaN((float)result!));
    }

    [Fact]
    public void ParseValue_Float8_NaN_Parses()
    {
        var result = TypeParser.ParseValue("NaN", TypeOid.Float8);
        Assert.IsType<double>(result);
        Assert.True(double.IsNaN((double)result!));
    }

    [Fact]
    public void ParseValue_Float4_Infinity_Parses()
    {
        var result = TypeParser.ParseValue("Infinity", TypeOid.Float4);
        Assert.IsType<float>(result);
        Assert.True(float.IsPositiveInfinity((float)result!));
    }

    [Fact]
    public void ParseValue_Float4_NegativeInfinity_Parses()
    {
        var result = TypeParser.ParseValue("-Infinity", TypeOid.Float4);
        Assert.IsType<float>(result);
        Assert.True(float.IsNegativeInfinity((float)result!));
    }

    [Fact]
    public void ParseValue_Float4_Zero_Works()
    {
        var result = TypeParser.ParseValue("0", TypeOid.Float4);
        Assert.Equal(0f, result);
    }

    [Fact]
    public void ParseValue_Float4_NegativeZero_Works()
    {
        var result = TypeParser.ParseValue("-0", TypeOid.Float4);
        Assert.IsType<float>(result);
    }

    // ── Numeric edge cases ────────────────────────────────────────────────

    [Fact]
    public void ParseValue_Numeric_VeryLargeDecimal_Works()
    {
        var result = TypeParser.ParseValue("79228162514264337593543950335", TypeOid.Numeric);
        Assert.Equal(decimal.MaxValue, result);
    }

    [Fact]
    public void ParseValue_Numeric_VerySmallDecimal_Works()
    {
        var result = TypeParser.ParseValue("-79228162514264337593543950335", TypeOid.Numeric);
        Assert.Equal(decimal.MinValue, result);
    }

    // ── UUID edge cases ───────────────────────────────────────────────────

    [Fact]
    public void ParseValue_Uuid_EmptyGuid_Works()
    {
        var result = TypeParser.ParseValue("00000000-0000-0000-0000-000000000000", TypeOid.Uuid);
        Assert.Equal(Guid.Empty, result);
    }

    [Fact]
    public void ParseValue_Uuid_InvalidFormat_Throws()
    {
        Assert.ThrowsAny<Exception>(() => TypeParser.ParseValue("not-a-guid", TypeOid.Uuid));
    }

    [Fact]
    public void ParseValue_Uuid_MalformedDashes_Throws()
    {
        Assert.ThrowsAny<Exception>(() => TypeParser.ParseValue("12345678123412341234123456789abc-extra", TypeOid.Uuid));
    }

    // ── JSON edge cases ───────────────────────────────────────────────────

    [Fact]
    public void ParseValue_Json_InvalidJson_Throws()
    {
        Assert.ThrowsAny<Exception>(() => TypeParser.ParseValue("{invalid json}", TypeOid.Json));
    }

    [Fact]
    public void ParseValue_Json_NullLiteral_ReturnsJsonDocument()
    {
        var result = TypeParser.ParseValue("null", TypeOid.Json);
        Assert.IsType<JsonDocument>(result);
    }

    [Fact]
    public void ParseValue_Json_Array_ReturnsJsonDocument()
    {
        var result = TypeParser.ParseValue("[1,2,3]", TypeOid.Json);
        Assert.IsType<JsonDocument>(result);
    }

    [Fact]
    public void ParseValue_Json_EmptyObject_Works()
    {
        var result = TypeParser.ParseValue("{}", TypeOid.Json);
        Assert.IsType<JsonDocument>(result);
    }

    [Fact]
    public void ParseValue_Json_DeepNesting_Works()
    {
        var json = "{\"a\":{\"b\":{\"c\":{\"d\":\"deep\"}}}}";
        var result = TypeParser.ParseValue(json, TypeOid.Json);
        Assert.IsType<JsonDocument>(result);
    }

    [Fact]
    public void ParseValue_Jsonb_AlsoWorks()
    {
        var result = TypeParser.ParseValue("{\"key\":1}", TypeOid.Jsonb);
        Assert.IsType<JsonDocument>(result);
    }

    // ── Embedding edge cases ──────────────────────────────────────────────

    [Fact]
    public void ParseEmbedding_SingleElement()
    {
        var result = TypeParser.ParseEmbedding("[0.5]");
        Assert.Single(result);
        Assert.Equal(0.5f, result[0]);
    }

    [Fact]
    public void ParseEmbedding_NegativeValues()
    {
        var result = TypeParser.ParseEmbedding("[-1.0,-2.5,-0.1]");
        Assert.Equal(3, result.Length);
        Assert.Equal(-1.0f, result[0]);
        Assert.Equal(-2.5f, result[1]);
        Assert.Equal(-0.1f, result[2]);
    }

    [Fact]
    public void ParseEmbedding_ScientificNotation()
    {
        // PG might send scientific notation for very small/large floats
        var result = TypeParser.ParseEmbedding("[1E-7,2.5E3]");
        Assert.Equal(2, result.Length);
        Assert.Equal(1e-7f, result[0], 5);
        Assert.Equal(2.5e3f, result[1], 1);
    }

    [Fact]
    public void ParseEmbedding_NoBrackets()
    {
        // If server sends without brackets
        var result = TypeParser.ParseEmbedding("0.1,0.2,0.3");
        Assert.Equal(3, result.Length);
    }

    [Fact]
    public void ParseEmbedding_MalformedValue_Throws()
    {
        Assert.ThrowsAny<Exception>(() => TypeParser.ParseEmbedding("[not,a,number]"));
    }

    [Fact]
    public void SerializeEmbedding_EmptyArray()
    {
        var result = TypeParser.SerializeEmbedding([]);
        Assert.Equal("[]", result);
    }

    [Fact]
    public void SerializeEmbedding_SingleElement()
    {
        var result = TypeParser.SerializeEmbedding([1.5f]);
        Assert.Equal("[1.5]", result);
    }

    [Fact]
    public void SerializeEmbedding_NegativeValues()
    {
        var result = TypeParser.SerializeEmbedding([-1f, -0.5f]);
        Assert.Contains("-1", result);
        Assert.Contains("-0.5", result);
    }

    [Fact]
    public void SerializeEmbedding_SpecialFloats()
    {
        // NaN and Infinity in embeddings
        var result = TypeParser.SerializeEmbedding([float.NaN, float.PositiveInfinity]);
        Assert.NotNull(result);
    }

    [Fact]
    public void ParseEmbedding_LargeVector_1536Dimensions()
    {
        // OpenAI text-embedding-ada-002 produces 1536-dim vectors
        var parts = new string[1536];
        for (var i = 0; i < 1536; i++)
            parts[i] = (i * 0.001f).ToString(CultureInfo.InvariantCulture);
        var input = "[" + string.Join(",", parts) + "]";

        var result = TypeParser.ParseEmbedding(input);
        Assert.Equal(1536, result.Length);
    }

    // ── Type OID coverage for Date/Time types ─────────────────────────────

    [Fact]
    public void ParseValue_Date_FallsBackToString()
    {
        // TypeOid.Date (1082) has no explicit handler — should return string
        var result = TypeParser.ParseValue("2024-01-15", TypeOid.Date);
        Assert.IsType<string>(result);
        Assert.Equal("2024-01-15", result);
    }

    [Fact]
    public void ParseValue_Timestamp_FallsBackToString()
    {
        var result = TypeParser.ParseValue("2024-01-15 10:30:00", TypeOid.Timestamp);
        Assert.IsType<string>(result);
    }

    [Fact]
    public void ParseValue_UnknownTypeOid_ReturnsString()
    {
        var result = TypeParser.ParseValue("some data", 999999);
        Assert.Equal("some data", result);
    }

    // ── Empty string handling ─────────────────────────────────────────────

    [Fact]
    public void ParseValue_EmptyString_Int4_Throws()
    {
        Assert.ThrowsAny<Exception>(() => TypeParser.ParseValue("", TypeOid.Int4));
    }

    [Fact]
    public void ParseValue_EmptyString_Bool_ReturnsFalse()
    {
        Assert.False((bool)TypeParser.ParseValue("", TypeOid.Bool)!);
    }

    [Fact]
    public void ParseValue_EmptyString_Text_ReturnsEmptyString()
    {
        var result = TypeParser.ParseValue("", TypeOid.Text);
        Assert.Equal("", result);
    }
}
