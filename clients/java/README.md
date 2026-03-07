# sixsevendb-jdbc

Java JDBC Type 4 driver for [SixSevenDB](https://sixsevendb.com).

## Installation

### Maven

```xml
<dependency>
    <groupId>com.sixsevendb</groupId>
    <artifactId>sixsevendb-jdbc</artifactId>
    <version>0.1.0</version>
</dependency>
```

### Gradle

```groovy
implementation 'com.sixsevendb:sixsevendb-jdbc:0.1.0'
```

## Quick Start

```java
import java.sql.*;

public class Example {
    public static void main(String[] args) throws SQLException {
        // Driver auto-registered via SPI — no Class.forName needed
        Connection conn = DriverManager.getConnection("jdbc:sixseven://localhost:6767/mydb");

        Statement stmt = conn.createStatement();
        ResultSet rs = stmt.executeQuery("SELECT id, name FROM users");
        while (rs.next()) {
            System.out.printf("%d: %s%n", rs.getInt("id"), rs.getString("name"));
        }
        rs.close();
        conn.close();
    }
}
```

## JDBC URL Formats

```
jdbc:sixseven://user:password@host:port/database
sixseven://user:password@host:port/database
postgresql://user:password@host:port/database
host=localhost port=6767 user=sixseven database=mydb
```

Defaults: host=`localhost`, port=`6767`, user=`sixseven`, database=`sixseven`.

## HikariCP Integration

```java
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;

HikariConfig config = new HikariConfig();
config.setJdbcUrl("jdbc:sixseven://localhost:6767/mydb");
config.setUsername("sixseven");
config.setMaximumPoolSize(10);

HikariDataSource ds = new HikariDataSource(config);
Connection conn = ds.getConnection();
```

## Graph Queries

```java
import com.sixsevendb.*;

// TRAVERSE
PreparedQuery q = SixSevenQuery.traverse("follows", "users", userID)
    .direction("OUT").maxDepth(3).build();
PreparedStatement ps = conn.prepareStatement(q.getSql());
ps.setObject(1, q.getValues().get(0));
ResultSet rs = ps.executeQuery();

// LINK
PreparedQuery q = SixSevenQuery.buildLink("follows", "users", 1, "users", 2, null);

// UNLINK
PreparedQuery q = SixSevenQuery.buildUnlink("follows", "users", 1, "users", 2);

// MATCH (Cypher-style)
PreparedQuery q = SixSevenQuery.match()
    .node("a", "users").edge("r", "follows", MatchBuilder.Direction.OUT).node("b", "users")
    .returning("a", "b").where("a.age > 25").build();

// SHORTEST PATH
PreparedQuery q = SixSevenQuery.shortestPath("follows", "users", 1, "users", 2)
    .direction("OUT").maxDepth(10).build();
```

## Vector Queries

```java
Embedding vec = new Embedding(new float[]{0.1f, 0.2f, 0.3f});
PreparedQuery q = SixSevenQuery.nearest("products", "embedding", vec)
    .k(5).metric("COSINE").build();
```

## Transactions

```java
// Using SixSevenDB.transaction helper (auto-commit/rollback)
SixSevenDB.transaction(dataSource, conn -> {
    conn.createStatement().executeUpdate("INSERT INTO users (name) VALUES ('Alice')");
});

// Using standard JDBC
conn.setAutoCommit(false);
conn.createStatement().executeUpdate("INSERT INTO users (name) VALUES ('Bob')");
conn.commit();

// Savepoints
conn.setAutoCommit(false);
Savepoint sp = conn.setSavepoint("sp1");
// ... work ...
conn.rollback(sp);
conn.commit();
```

## Type Mapping

| SixSevenDB Type | Java Type |
|----------------|-----------|
| BOOL | `Boolean` |
| TINYINT | `Byte` |
| INT2 | `Short` |
| INT4 | `Integer` |
| INT8 | `Long` |
| UINT8-64 | `Short`/`Integer`/`Long` |
| FLOAT4 | `Float` |
| FLOAT8 | `Double` |
| NUMERIC | `BigDecimal` |
| TEXT/VARCHAR/CHAR | `String` |
| BYTEA/BLOB | `byte[]` |
| DATE | `java.sql.Date` |
| TIME | `java.sql.Time` |
| TIMESTAMP | `java.sql.Timestamp` |
| INTERVAL | `com.sixsevendb.Interval` |
| UUID | `java.util.UUID` |
| EMBEDDING | `com.sixsevendb.Embedding` |
| JSON | `String` |

## Schema Helpers

```java
// SHOW commands
stmt.executeQuery(SixSevenDB.showDatabasesSQL());
stmt.executeQuery(SixSevenDB.showTablesSQL());
stmt.executeQuery(SixSevenDB.showColumnsSQL("users"));
stmt.executeQuery(SixSevenDB.showEdgeTypesSQL());

// EXPLAIN
stmt.executeQuery(SixSevenDB.explainSQL("SELECT * FROM users"));
stmt.executeQuery(SixSevenDB.explainAnalyzeSQL("SELECT * FROM users"));

// Edge type management
stmt.executeUpdate(SixSevenDB.createEdgeTypeSQL("follows", "users", "users", null));
stmt.executeUpdate(SixSevenDB.dropEdgeTypeSQL("follows", true));
```

## Authentication

The driver supports trust, MD5, and SCRAM-SHA-256 authentication, auto-detected from the server's response during connection. Uses only JDK standard crypto (no external dependencies).

## Building

```bash
cd clients/java
mvn compile
mvn test
mvn package
```

## License

See the project root LICENSE file.
