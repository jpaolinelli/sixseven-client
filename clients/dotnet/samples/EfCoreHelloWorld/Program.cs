using Microsoft.EntityFrameworkCore;
using SixSevenDB.Client;
using SixSevenDB.EntityFrameworkCore;

// Define your DbContext
var options = new DbContextOptionsBuilder<AppDbContext>()
    .UseSixSevenDb("Host=localhost;Port=6767;Username=sixseven;Database=sixseven")
    .Options;

await using var context = new AppDbContext(options);

// Query using LINQ
var users = await context.Users.Where(u => u.Name != null).ToListAsync();
foreach (var user in users)
{
    Console.WriteLine($"User: {user.Name}");
}

// Use graph operations
var traverseQuery = SixSevenDbLinqExtensions.Traverse("follows", "users", 1,
    new TraverseOptions { Direction = TraverseDirection.Out, Fetch = true });
Console.WriteLine($"Traverse SQL: {traverseQuery.Text}");

// Vector search
var nearestQuery = SixSevenDbLinqExtensions.Nearest("posts", "embedding",
    new float[] { 0.1f, 0.2f, 0.3f },
    new NearestOptions { K = 5, Metric = DistanceMetric.Cosine });
Console.WriteLine($"Nearest SQL: {nearestQuery.Text}");

Console.WriteLine("Done!");

// Model classes
public class User
{
    public int Id { get; set; }
    public string? Name { get; set; }
    public string? Email { get; set; }
}

public class Post
{
    public int Id { get; set; }
    public string? Title { get; set; }
    public int AuthorId { get; set; }
    public float[]? Embedding { get; set; }
}

// DbContext
public class AppDbContext : DbContext
{
    public DbSet<User> Users => Set<User>();
    public DbSet<Post> Posts => Set<Post>();

    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options) { }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<User>(entity =>
        {
            entity.ToTable("users");
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.Name).HasColumnName("name");
            entity.Property(e => e.Email).HasColumnName("email");
        });

        modelBuilder.Entity<Post>(entity =>
        {
            entity.ToTable("posts");
            entity.Property(e => e.Id).HasColumnName("id");
            entity.Property(e => e.Title).HasColumnName("title");
            entity.Property(e => e.AuthorId).HasColumnName("author_id");
            entity.Property(e => e.Embedding).HasColumnName("embedding").HasColumnType("embedding");
        });
    }
}
