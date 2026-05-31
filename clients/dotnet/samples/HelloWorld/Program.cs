using SixSevenDB.Client;

// Connect to SixSevenDB
await using var connection = new SixSevenDbConnection("Host=localhost;Port=6767;Username=sixseven;Database=sixseven");
await connection.OpenAsync();
Console.WriteLine("Connected to SixSevenDB!");

// Execute a simple query
await using var cmd = connection.CreateCommand();
cmd.CommandText = "SELECT 1 AS value";
await using var reader = await cmd.ExecuteReaderAsync();
while (await reader.ReadAsync())
{
    Console.WriteLine($"Result: {reader.GetValue(0)}");
}

// Use parameterized queries
await using var paramCmd = connection.CreateCommand();
paramCmd.CommandText = "SELECT * FROM users WHERE id = $1";
paramCmd.Parameters.Add(new SixSevenDbParameter { Value = 1 });
await using var paramReader = await paramCmd.ExecuteReaderAsync();
while (await paramReader.ReadAsync())
{
    for (var i = 0; i < paramReader.FieldCount; i++)
    {
        Console.Write($"{paramReader.GetName(i)}={paramReader.GetValue(i)} ");
    }
    Console.WriteLine();
}

// Use query builders for graph traversal
var traverse = QueryBuilder.BuildTraverse("follows", "users", 1, new TraverseOptions
{
    Direction = TraverseDirection.Out,
    MaxDepth = 3,
    Fetch = true
});
Console.WriteLine($"Traverse SQL: {traverse.Text}");

// Vector search
var nearest = QueryBuilder.BuildNearest("posts", "embedding", new float[] { 0.1f, 0.2f, 0.3f }, new NearestOptions
{
    K = 5,
    Metric = DistanceMetric.Cosine
});
Console.WriteLine($"Nearest SQL: {nearest.Text}");

// Link two nodes
var link = QueryBuilder.BuildLink("follows", "users", 1, "users", 2, new LinkOptions
{
    Properties = new Dictionary<string, object?> { ["since"] = "2024-01-01" }
});
Console.WriteLine($"Link SQL: {link.Text}");

Console.WriteLine("Done!");
