using System.Data;
using System.Data.Common;
using System.Diagnostics.CodeAnalysis;

namespace SixSevenDB.Client;

public sealed class SixSevenDbParameter : DbParameter
{
    public override DbType DbType { get; set; } = DbType.String;
    public override ParameterDirection Direction { get; set; } = ParameterDirection.Input;
    public override bool IsNullable { get; set; }

    [AllowNull]
    public override string ParameterName { get; set; } = "";
    public override int Size { get; set; }

    [AllowNull]
    public override string SourceColumn { get; set; } = "";
    public override bool SourceColumnNullMapping { get; set; }
    public override object? Value { get; set; }

    public SixSevenDbParameter() { }

    public SixSevenDbParameter(string parameterName, object? value)
    {
        ParameterName = parameterName;
        Value = value;
    }

    public override void ResetDbType()
    {
        DbType = DbType.String;
    }
}
