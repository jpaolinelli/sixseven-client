namespace SixSevenDB.Client;

public class SixSevenDbException : Exception
{
    public string? Severity { get; }
    public string? SqlState { get; }

    public SixSevenDbException(string message) : base(message) { }

    public SixSevenDbException(string message, Exception innerException)
        : base(message, innerException) { }

    public SixSevenDbException(string message, string? severity, string? sqlState)
        : base(message)
    {
        Severity = severity;
        SqlState = sqlState;
    }
}
