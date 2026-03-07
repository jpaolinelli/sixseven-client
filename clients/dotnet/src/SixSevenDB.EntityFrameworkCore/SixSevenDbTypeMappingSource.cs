using System.Text.Json;
using Microsoft.EntityFrameworkCore.Storage;

namespace SixSevenDB.EntityFrameworkCore;

public class SixSevenDbTypeMappingSource : RelationalTypeMappingSource
{
    private static readonly RelationalTypeMapping IntMapping = new SixSevenDbTypeMapping("integer", typeof(int), System.Data.DbType.Int32);
    private static readonly RelationalTypeMapping LongMapping = new SixSevenDbTypeMapping("bigint", typeof(long), System.Data.DbType.Int64);
    private static readonly RelationalTypeMapping ShortMapping = new SixSevenDbTypeMapping("smallint", typeof(short), System.Data.DbType.Int16);
    private static readonly RelationalTypeMapping BoolMapping = new SixSevenDbTypeMapping("boolean", typeof(bool), System.Data.DbType.Boolean);
    private static readonly RelationalTypeMapping StringMapping = new SixSevenDbTypeMapping("text", typeof(string), System.Data.DbType.String);
    private static readonly RelationalTypeMapping DoubleMapping = new SixSevenDbTypeMapping("double precision", typeof(double), System.Data.DbType.Double);
    private static readonly RelationalTypeMapping FloatMapping = new SixSevenDbTypeMapping("real", typeof(float), System.Data.DbType.Single);
    private static readonly RelationalTypeMapping DecimalMapping = new SixSevenDbTypeMapping("numeric", typeof(decimal), System.Data.DbType.Decimal);
    private static readonly RelationalTypeMapping GuidMapping = new SixSevenDbTypeMapping("uuid", typeof(Guid), System.Data.DbType.Guid);
    private static readonly RelationalTypeMapping DateTimeMapping = new SixSevenDbTypeMapping("timestamp", typeof(DateTime), System.Data.DbType.DateTime);
    private static readonly RelationalTypeMapping EmbeddingMapping = new SixSevenDbTypeMapping("embedding", typeof(float[]), System.Data.DbType.Object);
    private static readonly RelationalTypeMapping JsonMapping = new SixSevenDbTypeMapping("json", typeof(JsonDocument), System.Data.DbType.String);

    public SixSevenDbTypeMappingSource(
        TypeMappingSourceDependencies dependencies,
        RelationalTypeMappingSourceDependencies relationalDependencies)
        : base(dependencies, relationalDependencies)
    {
    }

    protected override RelationalTypeMapping? FindMapping(in RelationalTypeMappingInfo mappingInfo)
    {
        // Map by CLR type
        var clrType = mappingInfo.ClrType;
        if (clrType is not null)
        {
            var mapping = MapClrType(clrType);
            if (mapping is not null) return mapping;
        }

        // Map by store type name
        var storeTypeName = mappingInfo.StoreTypeName;
        if (storeTypeName is not null)
        {
            var mapping = MapStoreType(storeTypeName);
            if (mapping is not null) return mapping;
        }

        return base.FindMapping(mappingInfo);
    }

    private static RelationalTypeMapping? MapClrType(Type clrType)
    {
        if (clrType == typeof(int)) return IntMapping;
        if (clrType == typeof(long)) return LongMapping;
        if (clrType == typeof(short)) return ShortMapping;
        if (clrType == typeof(bool)) return BoolMapping;
        if (clrType == typeof(string)) return StringMapping;
        if (clrType == typeof(double)) return DoubleMapping;
        if (clrType == typeof(float)) return FloatMapping;
        if (clrType == typeof(decimal)) return DecimalMapping;
        if (clrType == typeof(Guid)) return GuidMapping;
        if (clrType == typeof(DateTime)) return DateTimeMapping;
        if (clrType == typeof(float[])) return EmbeddingMapping;
        if (clrType == typeof(JsonDocument)) return JsonMapping;
        return null;
    }

    private static RelationalTypeMapping? MapStoreType(string storeTypeName)
    {
        return storeTypeName.ToLowerInvariant() switch
        {
            "integer" or "int4" => IntMapping,
            "bigint" or "int8" => LongMapping,
            "smallint" or "int2" => ShortMapping,
            "boolean" or "bool" => BoolMapping,
            "text" or "varchar" => StringMapping,
            "double precision" or "float8" => DoubleMapping,
            "real" or "float4" => FloatMapping,
            "numeric" or "decimal" => DecimalMapping,
            "uuid" => GuidMapping,
            "timestamp" => DateTimeMapping,
            "embedding" => EmbeddingMapping,
            "json" or "jsonb" => JsonMapping,
            _ => null
        };
    }
}

internal class SixSevenDbTypeMapping : RelationalTypeMapping
{
    public SixSevenDbTypeMapping(string storeType, Type clrType, System.Data.DbType dbType)
        : base(storeType, clrType, dbType)
    {
    }

    protected SixSevenDbTypeMapping(RelationalTypeMappingParameters parameters)
        : base(parameters)
    {
    }

    protected override RelationalTypeMapping Clone(RelationalTypeMappingParameters parameters)
        => new SixSevenDbTypeMapping(parameters);
}
