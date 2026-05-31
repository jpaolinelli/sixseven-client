package com.sixsevendb;

import org.junit.jupiter.api.Test;

import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class HelpersTest {

    @Test
    void testShowDatabasesSQL() {
        assertEquals("SHOW DATABASES", SixSevenDB.showDatabasesSQL());
    }

    @Test
    void testShowTablesSQL() {
        assertEquals("SHOW TABLES", SixSevenDB.showTablesSQL());
    }

    @Test
    void testShowColumnsSQL() {
        assertEquals("SHOW COLUMNS FROM \"users\"", SixSevenDB.showColumnsSQL("users"));
    }

    @Test
    void testShowEdgeTypesSQL() {
        assertEquals("SHOW EDGE TYPES", SixSevenDB.showEdgeTypesSQL());
    }

    @Test
    void testShowIndexesSQL() {
        assertEquals("SHOW INDEXES", SixSevenDB.showIndexesSQL());
    }

    @Test
    void testShowEmbeddingsSQL() {
        assertEquals("SHOW EMBEDDINGS", SixSevenDB.showEmbeddingsSQL());
    }

    @Test
    void testShowProvidersSQL() {
        assertEquals("SHOW PROVIDERS", SixSevenDB.showProvidersSQL());
    }

    @Test
    void testExplainSQL() {
        assertEquals("EXPLAIN SELECT * FROM users", SixSevenDB.explainSQL("SELECT * FROM users"));
    }

    @Test
    void testExplainAnalyzeSQL() {
        assertEquals("EXPLAIN ANALYZE SELECT * FROM users", SixSevenDB.explainAnalyzeSQL("SELECT * FROM users"));
    }

    @Test
    void testCreateEdgeTypeSQL() {
        String sql = SixSevenDB.createEdgeTypeSQL("follows", "users", "users", null);
        assertEquals("CREATE EDGE TYPE \"follows\" FROM \"users\" TO \"users\"", sql);
    }

    @Test
    void testCreateEdgeTypeSQLWithProperties() {
        Map<String, String> props = new LinkedHashMap<>();
        props.put("weight", "FLOAT8");
        props.put("since", "DATE");
        String sql = SixSevenDB.createEdgeTypeSQL("follows", "users", "users", props);
        assertTrue(sql.contains("CREATE EDGE TYPE \"follows\" FROM \"users\" TO \"users\""));
        assertTrue(sql.contains("\"weight\" FLOAT8"));
        assertTrue(sql.contains("\"since\" DATE"));
    }

    @Test
    void testDropEdgeTypeSQL() {
        assertEquals("DROP EDGE TYPE \"follows\"", SixSevenDB.dropEdgeTypeSQL("follows", false));
    }

    @Test
    void testDropEdgeTypeSQLIfExists() {
        assertEquals("DROP EDGE TYPE IF EXISTS \"follows\"", SixSevenDB.dropEdgeTypeSQL("follows", true));
    }
}
