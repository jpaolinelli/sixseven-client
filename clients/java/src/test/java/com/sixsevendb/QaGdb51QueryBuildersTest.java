package com.sixsevendb;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.DisplayName;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * QA adversarial tests for query builders — GDB-51.
 * Targets edge cases, boundary values, null handling, SQL injection, and error paths.
 */
class QaGdb51QueryBuildersTest {

    // === quoteIdentifier edge cases ===

    @Test
    @DisplayName("quoteIdentifier escapes double quotes in names")
    void quoteIdentifierEscapesQuotes() {
        assertEquals("\"table\"\"name\"", SixSevenQuery.quoteIdentifier("table\"name"));
    }

    @Test
    @DisplayName("quoteIdentifier handles empty string")
    void quoteIdentifierEmptyString() {
        assertEquals("\"\"", SixSevenQuery.quoteIdentifier(""));
    }

    @Test
    @DisplayName("quoteIdentifier handles SQL injection attempt safely")
    void quoteIdentifierSqlInjection() {
        // The identifier should be safely quoted, preventing injection
        String malicious = "users\"; DROP TABLE users; --";
        String quoted = SixSevenQuery.quoteIdentifier(malicious);
        assertTrue(quoted.startsWith("\""));
        assertTrue(quoted.endsWith("\""));
        // The internal quote is escaped to "" so the entire string stays inside the identifier
        assertEquals("\"users\"\"; DROP TABLE users; --\"", quoted);
    }

    @Test
    @DisplayName("quoteIdentifier handles null-byte in name")
    void quoteIdentifierNullByte() {
        // Null bytes in identifiers could be dangerous
        String result = SixSevenQuery.quoteIdentifier("table\0name");
        assertNotNull(result);
        assertTrue(result.contains("\0")); // Should be inside quotes at minimum
    }

    // === TraverseBuilder edge cases ===

    @Test
    @DisplayName("TraverseBuilder with negative maxDepth throws IllegalArgumentException")
    void traverseNegativeMaxDepth() {
        assertThrows(IllegalArgumentException.class, () ->
            SixSevenQuery.traverse("follows", "users", 1)
                .maxDepth(-1).build());
    }

    @Test
    @DisplayName("TraverseBuilder with zero maxDepth is valid (no limit)")
    void traverseZeroMaxDepth() {
        PreparedQuery q = SixSevenQuery.traverse("follows", "users", 1)
            .maxDepth(0).build();
        assertFalse(q.getSql().contains("MAX_DEPTH"));
    }

    @Test
    @DisplayName("TraverseBuilder with maxDepth=1 is the minimum valid depth")
    void traverseMinimalMaxDepth() {
        PreparedQuery q = SixSevenQuery.traverse("follows", "users", 1)
            .maxDepth(1).build();
        assertTrue(q.getSql().contains("MAX_DEPTH 1"));
    }

    @Test
    @DisplayName("TraverseBuilder SQL injection in where clause passes through")
    void traverseWhereClauseInjection() {
        // WHERE clauses are user-controlled raw SQL — this is expected behavior
        // but documents that parameterized queries should be used
        PreparedQuery q = SixSevenQuery.traverse("follows", "users", 1)
            .where("1=1; DROP TABLE users;").build();
        assertTrue(q.getSql().contains("WHERE 1=1; DROP TABLE users;"));
    }

    @Test
    @DisplayName("TraverseBuilder parameter is correctly in values list")
    void traverseParameterInValues() {
        PreparedQuery q = SixSevenQuery.traverse("follows", "users", "uuid-123").build();
        assertEquals(1, q.getValues().size());
        assertEquals("uuid-123", q.getValues().get(0));
    }

    @Test
    @DisplayName("TraverseBuilder with all options generates correct SQL")
    void traverseAllOptions() {
        PreparedQuery q = SixSevenQuery.traverse("follows", "users", 1)
            .direction("OUT").maxDepth(5).mode("BFS").where("depth < 3").fetch().build();
        String sql = q.getSql();
        assertTrue(sql.contains("DIRECTION OUT"));
        assertTrue(sql.contains("MAX_DEPTH 5"));
        assertTrue(sql.contains("MODE BFS"));
        assertTrue(sql.contains("WHERE depth < 3"));
        assertTrue(sql.contains("FETCH"));
    }

    // === NearestBuilder edge cases ===

    @Test
    @DisplayName("NearestBuilder with k=0 throws IllegalArgumentException")
    void nearestZeroK() {
        assertThrows(IllegalArgumentException.class, () ->
            SixSevenQuery.nearest("items", "embedding", new Embedding(new float[]{0.1f}))
                .k(0).build());
    }

    @Test
    @DisplayName("NearestBuilder with negative k throws IllegalArgumentException")
    void nearestNegativeK() {
        assertThrows(IllegalArgumentException.class, () ->
            SixSevenQuery.nearest("items", "embedding", new Embedding(new float[]{0.1f}))
                .k(-5).build());
    }

    @Test
    @DisplayName("NearestBuilder default k is 10")
    void nearestDefaultK() {
        PreparedQuery q = SixSevenQuery.nearest("items", "embedding",
            new Embedding(new float[]{0.1f})).build();
        assertTrue(q.getSql().contains("NEAREST 10"));
    }

    @Test
    @DisplayName("NearestBuilder accepts float[] as query vector")
    void nearestFloatArray() {
        PreparedQuery q = SixSevenQuery.nearest("items", "embedding",
            new float[]{0.1f, 0.2f, 0.3f}).build();
        assertTrue(q.getSql().contains("NEAREST"));
        assertEquals(1, q.getValues().size());
        assertTrue(q.getValues().get(0).toString().contains("0.1"));
    }

    @Test
    @DisplayName("NearestBuilder accepts String as query vector")
    void nearestStringVector() {
        PreparedQuery q = SixSevenQuery.nearest("items", "embedding",
            "[0.1,0.2,0.3]").build();
        assertEquals("[0.1,0.2,0.3]", q.getValues().get(0));
    }

    @Test
    @DisplayName("NearestBuilder rejects unsupported query vector type")
    void nearestUnsupportedVectorType() {
        assertThrows(IllegalArgumentException.class, () ->
            SixSevenQuery.nearest("items", "embedding", 42).build());
    }

    @Test
    @DisplayName("BUG: NearestBuilder with null queryVec throws NPE instead of IllegalArgumentException")
    void nearestNullQueryVec() {
        // null instanceof X is always false, so it falls through to the else branch
        // which calls queryVec.getClass().getName() → NullPointerException
        assertThrows(NullPointerException.class, () ->
            SixSevenQuery.nearest("items", "embedding", null).build());
    }

    @Test
    @DisplayName("NearestBuilder withinTraverse generates correct SQL")
    void nearestWithinTraverse() {
        PreparedQuery q = SixSevenQuery.nearest("items", "embedding",
            new Embedding(new float[]{0.1f}))
            .withinTraverse("similar_to").build();
        assertTrue(q.getSql().contains("WITHIN TRAVERSE \"similar_to\""));
    }

    @Test
    @DisplayName("NearestBuilder with empty float array produces valid query")
    void nearestEmptyFloatArray() {
        PreparedQuery q = SixSevenQuery.nearest("items", "embedding",
            new float[]{}).build();
        assertEquals("[]", q.getValues().get(0));
    }

    // === MatchBuilder edge cases ===

    @Test
    @DisplayName("MatchBuilder empty pattern throws IllegalArgumentException")
    void matchEmptyPattern() {
        assertThrows(IllegalArgumentException.class, () ->
            SixSevenQuery.match().build());
    }

    @Test
    @DisplayName("BUG: MatchBuilder with no return items generates invalid SQL")
    void matchNoReturnItems() {
        // MATCH (a:"users") RETURN  — trailing space, no return items = invalid SQL
        PreparedQuery q = SixSevenQuery.match()
            .node("a", "users")
            .build();
        String sql = q.getSql();
        // The SQL ends with "RETURN " which is invalid
        assertTrue(sql.endsWith("RETURN "),
            "Expected invalid SQL ending with 'RETURN ' but got: " + sql);
    }

    @Test
    @DisplayName("MatchBuilder generates correct OUT direction")
    void matchOutDirection() {
        PreparedQuery q = SixSevenQuery.match()
            .node("a", "users")
            .edge("r", "follows", MatchBuilder.Direction.OUT)
            .node("b", "users")
            .returning("a", "b")
            .build();
        assertTrue(q.getSql().contains("-[r:\"follows\"]->")); // OUT uses ->
    }

    @Test
    @DisplayName("MatchBuilder generates correct IN direction")
    void matchInDirection() {
        PreparedQuery q = SixSevenQuery.match()
            .node("a", "users")
            .edge("r", "follows", MatchBuilder.Direction.IN)
            .node("b", "users")
            .returning("a", "b")
            .build();
        assertTrue(q.getSql().contains("<-[r:\"follows\"]-")); // IN uses <-
    }

    @Test
    @DisplayName("MatchBuilder generates correct BOTH direction")
    void matchBothDirection() {
        PreparedQuery q = SixSevenQuery.match()
            .node("a", "users")
            .edge("r", "follows", MatchBuilder.Direction.BOTH)
            .node("b", "users")
            .returning("a", "b")
            .build();
        String sql = q.getSql();
        assertTrue(sql.contains("-[r:\"follows\"]-")); // BOTH uses - on both sides
        assertFalse(sql.contains("->")); // No arrow for BOTH
        assertFalse(sql.contains("<-")); // No arrow for BOTH
    }

    @Test
    @DisplayName("MatchBuilder with WHERE clause")
    void matchWithWhere() {
        PreparedQuery q = SixSevenQuery.match()
            .node("a", "users")
            .edge("r", "follows")
            .node("b", "users")
            .returning("a", "b")
            .where("a.age > 25")
            .build();
        assertTrue(q.getSql().contains("WHERE a.age > 25"));
    }

    @Test
    @DisplayName("MatchBuilder has empty values list (no parameterization)")
    void matchNoParameters() {
        PreparedQuery q = SixSevenQuery.match()
            .node("a", "users")
            .returning("a")
            .build();
        assertTrue(q.getValues().isEmpty());
    }

    // === ShortestPathBuilder edge cases ===

    @Test
    @DisplayName("ShortestPathBuilder basic query")
    void shortestPathBasic() {
        PreparedQuery q = SixSevenQuery.shortestPath("follows", "users", 1, "users", 2)
            .build();
        assertTrue(q.getSql().contains("SHORTEST PATH"));
        assertEquals(2, q.getValues().size());
        assertEquals(1, q.getValues().get(0));
        assertEquals(2, q.getValues().get(1));
    }

    @Test
    @DisplayName("ShortestPathBuilder negative maxDepth throws")
    void shortestPathNegativeMaxDepth() {
        assertThrows(IllegalArgumentException.class, () ->
            SixSevenQuery.shortestPath("follows", "users", 1, "users", 2)
                .maxDepth(-1).build());
    }

    @Test
    @DisplayName("ShortestPathBuilder with direction and maxDepth")
    void shortestPathWithOptions() {
        PreparedQuery q = SixSevenQuery.shortestPath("follows", "users", 1, "users", 2)
            .direction("OUT").maxDepth(10).build();
        assertTrue(q.getSql().contains("DIRECTION OUT"));
        assertTrue(q.getSql().contains("MAX_DEPTH 10"));
    }

    // === LINK builder edge cases ===

    @Test
    @DisplayName("LINK builder with properties generates correct SQL")
    void linkWithProperties() {
        Map<String, Object> props = new LinkedHashMap<>();
        props.put("weight", 1.5);
        props.put("created", "2024-01-01");
        PreparedQuery q = SixSevenQuery.buildLink("follows", "users", 1, "users", 2, props);
        assertTrue(q.getSql().contains("LINK"));
        assertTrue(q.getSql().contains("VIA"));
        assertEquals(4, q.getValues().size()); // fromID, toID, weight, created
    }

    @Test
    @DisplayName("LINK builder with null properties generates no extra property clause")
    void linkNullProperties() {
        PreparedQuery q = SixSevenQuery.buildLink("follows", "users", 1, "users", 2, null);
        // SQL has ($1) and ($2) for IDs but should NOT have property-list parens after VIA
        String afterVia = q.getSql().substring(q.getSql().indexOf("VIA"));
        assertFalse(afterVia.contains(" ("), "Should not have property clause after VIA");
        assertEquals(2, q.getValues().size());
    }

    @Test
    @DisplayName("LINK builder with empty properties generates no extra property clause")
    void linkEmptyProperties() {
        PreparedQuery q = SixSevenQuery.buildLink("follows", "users", 1, "users", 2,
            Collections.emptyMap());
        String afterVia = q.getSql().substring(q.getSql().indexOf("VIA"));
        assertFalse(afterVia.contains(" ("), "Should not have property clause after VIA");
        assertEquals(2, q.getValues().size());
    }

    // === UNLINK builder edge cases ===

    @Test
    @DisplayName("UNLINK builder generates correct SQL")
    void unlinkBasic() {
        PreparedQuery q = SixSevenQuery.buildUnlink("follows", "users", 1, "users", 2);
        assertTrue(q.getSql().contains("UNLINK"));
        assertTrue(q.getSql().contains("VIA"));
        assertEquals(2, q.getValues().size());
    }

    // === validatePositiveInt edge cases ===

    @Test
    @DisplayName("validatePositiveInt rejects zero")
    void validatePositiveIntZero() {
        assertThrows(IllegalArgumentException.class,
            () -> SixSevenQuery.validatePositiveInt(0, "testParam"));
    }

    @Test
    @DisplayName("validatePositiveInt rejects negative")
    void validatePositiveIntNegative() {
        assertThrows(IllegalArgumentException.class,
            () -> SixSevenQuery.validatePositiveInt(-1, "testParam"));
    }

    @Test
    @DisplayName("validatePositiveInt accepts 1")
    void validatePositiveIntOne() {
        assertDoesNotThrow(() -> SixSevenQuery.validatePositiveInt(1, "testParam"));
    }

    @Test
    @DisplayName("validatePositiveInt accepts Integer.MAX_VALUE")
    void validatePositiveIntMax() {
        assertDoesNotThrow(() -> SixSevenQuery.validatePositiveInt(Integer.MAX_VALUE, "testParam"));
    }

    @Test
    @DisplayName("validatePositiveInt error message includes parameter name")
    void validatePositiveIntMessage() {
        IllegalArgumentException ex = assertThrows(IllegalArgumentException.class,
            () -> SixSevenQuery.validatePositiveInt(-5, "myParam"));
        assertTrue(ex.getMessage().contains("myParam"));
        assertTrue(ex.getMessage().contains("-5"));
    }
}
