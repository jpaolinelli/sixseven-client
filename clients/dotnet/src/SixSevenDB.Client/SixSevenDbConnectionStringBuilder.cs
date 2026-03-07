using System.Data.Common;

namespace SixSevenDB.Client;

public sealed class SixSevenDbConnectionStringBuilder : DbConnectionStringBuilder
{
    public const string DefaultHost = "localhost";
    public const int DefaultPort = 6767;
    public const string DefaultUser = "sixseven";
    public const string DefaultDatabase = "sixseven";
    public const int DefaultPoolSize = 10;
    public const int DefaultConnectionTimeout = 30;

    public SixSevenDbConnectionStringBuilder() { }

    public SixSevenDbConnectionStringBuilder(string connectionString)
    {
        ConnectionString = connectionString;
    }

    public string Host
    {
        get => GetString("Host", DefaultHost);
        set => this["Host"] = value;
    }

    public int Port
    {
        get => GetInt("Port", DefaultPort);
        set => this["Port"] = value;
    }

    public string Username
    {
        get => GetString("Username", DefaultUser);
        set => this["Username"] = value;
    }

    public string? Password
    {
        get => TryGetValue("Password", out var val) ? val?.ToString() : null;
        set => this["Password"] = value;
    }

    public string Database
    {
        get => GetString("Database", DefaultDatabase);
        set => this["Database"] = value;
    }

    public int MaxPoolSize
    {
        get => GetInt("Max Pool Size", DefaultPoolSize);
        set => this["Max Pool Size"] = value;
    }

    public bool Pooling
    {
        get => GetBool("Pooling", true);
        set => this["Pooling"] = value;
    }

    public int ConnectionTimeout
    {
        get => GetInt("Connection Timeout", DefaultConnectionTimeout);
        set => this["Connection Timeout"] = value;
    }

    private string GetString(string key, string defaultValue)
    {
        return TryGetValue(key, out var val) && val is not null ? val.ToString()! : defaultValue;
    }

    private int GetInt(string key, int defaultValue)
    {
        return TryGetValue(key, out var val) && val is not null && int.TryParse(val.ToString(), out var result) ? result : defaultValue;
    }

    private bool GetBool(string key, bool defaultValue)
    {
        return TryGetValue(key, out var val) && val is not null && bool.TryParse(val.ToString(), out var result) ? result : defaultValue;
    }
}
