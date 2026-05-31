# SixSevenDB.Client

ADO.NET provider for SixSevenDB — a graph-relational database with vector search.

## Installation

```bash
dotnet add package SixSevenDB.Client
```

## Quick Start

```csharp
using SixSevenDB.Client;

// Connect
await using var connection = new SixSevenDbConnection(
    "Host=localhost;Port=6767;Username=sixseven;Database=sixseven"
);
await connection.OpenAsync();

// Query
await using var cmd = connection.CreateCommand();
cmd.CommandText = "SELECT * FROM users WHERE id = $1";
cmd.Parameters.Add(new SixSevenDbParameter { Value = 1 });

await using var reader = await cmd.ExecuteReaderAsync();
while (await reader.ReadAsync())
{
    Console.WriteLine($"{reader.GetString(reader.GetOrdinal("name"))}");
}
```

## Connection String Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| Host | localhost | Server hostname |
| Port | 6767 | Server port |
| Username | sixseven | Username |
| Password | | Password (optional) |
| Database | sixseven | Database name |
| Pooling | true | Enable connection pooling |
| Max Pool Size | 10 | Maximum pool connections |
| Connection Timeout | 30 | Timeout in seconds |

## Graph & Vector Operations

```csharp
// Traverse graph edges
var traverse = QueryBuilder.BuildTraverse("follows", "users", userId,
    new TraverseOptions { Direction = TraverseDirection.Out, MaxDepth = 3, Fetch = true });

// Vector similarity search
var nearest = QueryBuilder.BuildNearest("posts", "embedding",
    new float[] { 0.1f, 0.2f, 0.3f },
    new NearestOptions { K = 10, Metric = DistanceMetric.Cosine });

// Link nodes
var link = QueryBuilder.BuildLink("follows", "users", 1, "users", 2,
    new LinkOptions { Properties = new() { ["since"] = "2024-01-01" } });

// Unlink nodes
var unlink = QueryBuilder.BuildUnlink("follows", "users", 1, "users", 2);
```

## Type Mapping

| SixSevenDB Type | .NET Type |
|-----------------|-----------|
| BOOL | bool |
| INT2 | short |
| INT4 | int |
| INT8 | long |
| FLOAT4 | float |
| FLOAT8 | double |
| NUMERIC | decimal |
| TEXT | string |
| UUID | Guid |
| JSON/JSONB | JsonDocument |
| EMBEDDING | float[] |

## Reading Embeddings

```csharp
var reader = await cmd.ExecuteReaderAsync();
while (await reader.ReadAsync())
{
    float[] embedding = reader.GetEmbedding(reader.GetOrdinal("embedding"));
}
```
