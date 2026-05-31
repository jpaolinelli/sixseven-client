using System.Text;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.DependencyInjection;

namespace SixSevenDB.EntityFrameworkCore.Tests;

public class SqlGenerationHelperTests
{
    private SixSevenDbSqlGenerationHelper CreateHelper()
    {
        var services = new ServiceCollection()
            .AddEntityFrameworkSixSevenDb()
            .BuildServiceProvider();

        return services.GetRequiredService<ISqlGenerationHelper>() as SixSevenDbSqlGenerationHelper
            ?? throw new InvalidOperationException("SQL generation helper not registered");
    }

    [Fact]
    public void DelimitIdentifier_QuotesIdentifier()
    {
        var helper = CreateHelper();
        Assert.Equal("\"users\"", helper.DelimitIdentifier("users"));
    }

    [Fact]
    public void DelimitIdentifier_EscapesQuotes()
    {
        var helper = CreateHelper();
        Assert.Equal("\"my\"\"table\"", helper.DelimitIdentifier("my\"table"));
    }

    [Fact]
    public void DelimitIdentifier_StringBuilder_Works()
    {
        var helper = CreateHelper();
        var sb = new StringBuilder();
        helper.DelimitIdentifier(sb, "users");
        Assert.Equal("\"users\"", sb.ToString());
    }

    [Fact]
    public void EscapeIdentifier_EscapesQuotes()
    {
        var helper = CreateHelper();
        Assert.Equal("my\"\"table", helper.EscapeIdentifier("my\"table"));
    }

    [Fact]
    public void GenerateParameterName_UsesDollarPrefix()
    {
        var helper = CreateHelper();
        Assert.Equal("$p0", helper.GenerateParameterName("p0"));
    }

    [Fact]
    public void GenerateParameterNamePlaceholder_UsesDollarPrefix()
    {
        var helper = CreateHelper();
        Assert.Equal("$p0", helper.GenerateParameterNamePlaceholder("p0"));
    }

    [Fact]
    public void GenerateParameterName_StringBuilder_Works()
    {
        var helper = CreateHelper();
        var sb = new StringBuilder();
        helper.GenerateParameterName(sb, "p0");
        Assert.Equal("$p0", sb.ToString());
    }
}
