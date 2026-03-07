using System.Data;

namespace SixSevenDB.Client.Tests;

public class CommandTests
{
    [Fact]
    public void CreateCommand_DefaultProperties()
    {
        var cmd = new SixSevenDbCommand();
        Assert.Equal("", cmd.CommandText);
        Assert.Equal(30, cmd.CommandTimeout);
        Assert.Equal(CommandType.Text, cmd.CommandType);
    }

    [Fact]
    public void CreateCommand_WithTextAndConnection()
    {
        var conn = new SixSevenDbConnection();
        var cmd = new SixSevenDbCommand("SELECT 1", conn);
        Assert.Equal("SELECT 1", cmd.CommandText);
    }

    [Fact]
    public void Parameters_AddAndAccess()
    {
        var cmd = new SixSevenDbCommand();
        cmd.Parameters.Add("p1", 42);
        cmd.Parameters.Add("p2", "hello");

        Assert.Equal(2, cmd.Parameters.Count);
        Assert.Equal(42, cmd.Parameters[0].Value);
        Assert.Equal("hello", cmd.Parameters[1].Value);
    }

    [Fact]
    public void Parameters_Clear()
    {
        var cmd = new SixSevenDbCommand();
        cmd.Parameters.Add("p1", 1);
        cmd.Parameters.Add("p2", 2);
        cmd.Parameters.Clear();
        Assert.Equal(0, cmd.Parameters.Count);
    }

    [Fact]
    public void Parameters_Contains()
    {
        var cmd = new SixSevenDbCommand();
        cmd.Parameters.Add("p1", 1);
        Assert.True(cmd.Parameters.Contains("p1"));
        Assert.False(cmd.Parameters.Contains("p2"));
    }

    [Fact]
    public void Parameters_IndexOf()
    {
        var cmd = new SixSevenDbCommand();
        cmd.Parameters.Add("p1", 1);
        cmd.Parameters.Add("p2", 2);
        Assert.Equal(0, cmd.Parameters.IndexOf("p1"));
        Assert.Equal(1, cmd.Parameters.IndexOf("p2"));
        Assert.Equal(-1, cmd.Parameters.IndexOf("p3"));
    }

    [Fact]
    public void Parameters_Remove()
    {
        var cmd = new SixSevenDbCommand();
        var p = cmd.Parameters.Add("p1", 1);
        cmd.Parameters.Remove(p);
        Assert.Equal(0, cmd.Parameters.Count);
    }

    [Fact]
    public void Parameters_RemoveAt()
    {
        var cmd = new SixSevenDbCommand();
        cmd.Parameters.Add("p1", 1);
        cmd.Parameters.Add("p2", 2);
        cmd.Parameters.RemoveAt(0);
        Assert.Single(cmd.Parameters);
        Assert.Equal("p2", cmd.Parameters[0].ParameterName);
    }

    [Fact]
    public void Parameters_ToValueArray()
    {
        var cmd = new SixSevenDbCommand();
        cmd.Parameters.Add("p1", 42);
        cmd.Parameters.Add("p2", "hello");
        cmd.Parameters.Add("p3", null);

        var values = cmd.Parameters.ToValueArray();
        Assert.Equal(3, values.Length);
        Assert.Equal(42, values[0]);
        Assert.Equal("hello", values[1]);
        Assert.Null(values[2]);
    }

    [Fact]
    public void ExecuteNonQuery_ThrowsWhenNoConnection()
    {
        var cmd = new SixSevenDbCommand { CommandText = "SELECT 1" };
        Assert.Throws<InvalidOperationException>(() => cmd.ExecuteNonQuery());
    }

    [Fact]
    public void ExecuteNonQuery_ThrowsWhenConnectionClosed()
    {
        var conn = new SixSevenDbConnection("Host=localhost");
        var cmd = new SixSevenDbCommand("SELECT 1", conn);
        Assert.Throws<InvalidOperationException>(() => cmd.ExecuteNonQuery());
    }

    [Fact]
    public void CreateParameter_ReturnsSixSevenDbParameter()
    {
        var cmd = new SixSevenDbCommand();
        var param = cmd.CreateParameter();
        Assert.IsType<SixSevenDbParameter>(param);
    }
}

public class ParameterTests
{
    [Fact]
    public void DefaultValues()
    {
        var param = new SixSevenDbParameter();
        Assert.Equal("", param.ParameterName);
        Assert.Null(param.Value);
        Assert.Equal(DbType.String, param.DbType);
        Assert.Equal(ParameterDirection.Input, param.Direction);
    }

    [Fact]
    public void ConstructorWithNameAndValue()
    {
        var param = new SixSevenDbParameter("name", 42);
        Assert.Equal("name", param.ParameterName);
        Assert.Equal(42, param.Value);
    }

    [Fact]
    public void ResetDbType_SetsToString()
    {
        var param = new SixSevenDbParameter { DbType = DbType.Int32 };
        param.ResetDbType();
        Assert.Equal(DbType.String, param.DbType);
    }
}
