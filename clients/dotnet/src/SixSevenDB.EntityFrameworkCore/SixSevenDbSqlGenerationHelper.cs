using System.Text;
using Microsoft.EntityFrameworkCore.Storage;

namespace SixSevenDB.EntityFrameworkCore;

public class SixSevenDbSqlGenerationHelper : RelationalSqlGenerationHelper
{
    public SixSevenDbSqlGenerationHelper(RelationalSqlGenerationHelperDependencies dependencies)
        : base(dependencies)
    {
    }

    public override string DelimitIdentifier(string identifier)
        => $"\"{EscapeIdentifier(identifier)}\"";

    public override void DelimitIdentifier(StringBuilder builder, string identifier)
    {
        builder.Append('"');
        EscapeIdentifier(builder, identifier);
        builder.Append('"');
    }

    public override string EscapeIdentifier(string identifier)
        => identifier.Replace("\"", "\"\"");

    public override void EscapeIdentifier(StringBuilder builder, string identifier)
    {
        builder.Append(identifier.Replace("\"", "\"\""));
    }

    public override string GenerateParameterName(string name)
        => "$" + name;

    public override void GenerateParameterName(StringBuilder builder, string name)
    {
        builder.Append('$');
        builder.Append(name);
    }

    public override string GenerateParameterNamePlaceholder(string name)
        => "$" + name;

    public override void GenerateParameterNamePlaceholder(StringBuilder builder, string name)
    {
        builder.Append('$');
        builder.Append(name);
    }
}
