package com.sixsevendb;

import javax.sql.DataSource;
import java.sql.Connection;
import java.sql.SQLException;
import java.util.Map;

/**
 * Static utility class for SixSevenDB helper operations.
 * Provides SHOW/EXPLAIN SQL generators and transaction helpers.
 */
public final class SixSevenDB {

    private SixSevenDB() {}

    // --- SHOW command SQL generators ---

    public static String showDatabasesSQL() { return "SHOW DATABASES"; }
    public static String showTablesSQL() { return "SHOW TABLES"; }
    public static String showColumnsSQL(String table) {
        return "SHOW COLUMNS FROM " + SixSevenQuery.quoteIdentifier(table);
    }
    public static String showEdgeTypesSQL() { return "SHOW EDGE TYPES"; }
    public static String showIndexesSQL() { return "SHOW INDEXES"; }
    public static String showEmbeddingsSQL() { return "SHOW EMBEDDINGS"; }
    public static String showProvidersSQL() { return "SHOW PROVIDERS"; }

    // --- EXPLAIN helpers ---

    public static String explainSQL(String sql) { return "EXPLAIN " + sql; }
    public static String explainAnalyzeSQL(String sql) { return "EXPLAIN ANALYZE " + sql; }

    // --- Edge type DDL ---

    public static String createEdgeTypeSQL(String name, String fromTable, String toTable,
                                           Map<String, String> properties) {
        StringBuilder sb = new StringBuilder();
        sb.append("CREATE EDGE TYPE ").append(SixSevenQuery.quoteIdentifier(name))
          .append(" FROM ").append(SixSevenQuery.quoteIdentifier(fromTable))
          .append(" TO ").append(SixSevenQuery.quoteIdentifier(toTable));

        if (properties != null && !properties.isEmpty()) {
            sb.append(" (");
            boolean first = true;
            for (Map.Entry<String, String> entry : properties.entrySet()) {
                if (!first) sb.append(", ");
                sb.append(SixSevenQuery.quoteIdentifier(entry.getKey())).append(" ").append(entry.getValue());
                first = false;
            }
            sb.append(")");
        }
        return sb.toString();
    }

    public static String dropEdgeTypeSQL(String name, boolean ifExists) {
        return "DROP EDGE TYPE" + (ifExists ? " IF EXISTS" : "")
             + " " + SixSevenQuery.quoteIdentifier(name);
    }

    // --- Transaction helper ---

    /**
     * Executes a function within a transaction. Auto-commits on success, rolls back on exception.
     */
    public static void transaction(DataSource dataSource, TransactionCallback callback) throws SQLException {
        Connection conn = dataSource.getConnection();
        try {
            conn.setAutoCommit(false);
            callback.execute(conn);
            conn.commit();
        } catch (Exception e) {
            conn.rollback();
            if (e instanceof SQLException) throw (SQLException) e;
            throw new SQLException("sixsevendb: transaction failed: " + e.getMessage(), e);
        } finally {
            conn.setAutoCommit(true);
            conn.close();
        }
    }

    @FunctionalInterface
    public interface TransactionCallback {
        void execute(Connection conn) throws Exception;
    }
}
