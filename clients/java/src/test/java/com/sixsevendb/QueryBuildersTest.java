package com.sixsevendb;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class QueryBuildersTest {

    @Test
    void testQuoteIdentifier() {
        assertEquals("\"users\"", SixSevenQuery.quoteIdentifier("users"));
        assertEquals("\"my table\"", SixSevenQuery.quoteIdentifier("my table"));
        assertEquals("\"has\"\"quote\"", SixSevenQuery.quoteIdentifier("has\"quote"));
    }

    @Test
    void testBuildTraverse() {
        PreparedQuery q = SixSevenQuery.buildTraverse("follows", "users", 42);
        assertTrue(q.getSql().contains("TRAVERSE"));
        assertTrue(q.getSql().contains("\"follows\""));
        assertTrue(q.getSql().contains("\"users\"($1)"));
        assertEquals(1, q.getValues().size());
        assertEquals(42, q.getValues().get(0));
    }

    @Test
    void testBuildTraverseWithOptions() {
        PreparedQuery q = SixSevenQuery.traverse("follows", "users", "abc")
            .direction("OUT")
            .maxDepth(3)
            .mode("NODES")
            .where("depth > 1")
            .fetch()
            .build();

        assertTrue(q.getSql().contains("DIRECTION OUT"));
        assertTrue(q.getSql().contains("MAX_DEPTH 3"));
        assertTrue(q.getSql().contains("MODE NODES"));
        assertTrue(q.getSql().contains("WHERE depth > 1"));
        assertTrue(q.getSql().contains("FETCH"));
    }

    @Test
    void testBuildTraverseInvalidMaxDepth() {
        assertThrows(IllegalArgumentException.class, () ->
            SixSevenQuery.traverse("follows", "users", 1).maxDepth(-1).build()
        );
    }

    @Test
    void testBuildNearest() {
        Embedding vec = new Embedding(new float[]{0.1f, 0.2f, 0.3f});
        PreparedQuery q = SixSevenQuery.nearest("products", "embedding", vec).build();
        assertTrue(q.getSql().contains("NEAREST 10")); // default k
        assertTrue(q.getSql().contains("\"products\".\"embedding\""));
    }

    @Test
    void testBuildNearestWithOptions() {
        PreparedQuery q = SixSevenQuery.nearest("products", "embedding", "[0.1,0.2]")
            .k(5)
            .metric("COSINE")
            .where("price > 10")
            .withinTraverse("similar_to")
            .build();

        assertTrue(q.getSql().contains("NEAREST 5"));
        assertTrue(q.getSql().contains("USING COSINE"));
        assertTrue(q.getSql().contains("WHERE price > 10"));
        assertTrue(q.getSql().contains("WITHIN TRAVERSE \"similar_to\""));
    }

    @Test
    void testBuildNearestInvalidK() {
        assertThrows(IllegalArgumentException.class, () ->
            SixSevenQuery.nearest("t", "c", "v").k(0).build()
        );
        assertThrows(IllegalArgumentException.class, () ->
            SixSevenQuery.nearest("t", "c", "v").k(-5).build()
        );
    }

    @Test
    void testBuildNearestWithFloat32Array() {
        float[] vec = new float[]{1.0f, 2.0f, 3.0f};
        PreparedQuery q = SixSevenQuery.nearest("t", "c", vec).build();
        assertTrue(((String) q.getValues().get(0)).contains("1.0"));
    }

    @Test
    void testBuildLink() {
        PreparedQuery q = SixSevenQuery.buildLink("follows", "users", 1, "users", 2, null);
        assertTrue(q.getSql().contains("LINK"));
        assertTrue(q.getSql().contains("\"users\"($1)"));
        assertTrue(q.getSql().contains("\"users\"($2)"));
        assertTrue(q.getSql().contains("VIA \"follows\""));
        assertEquals(2, q.getValues().size());
    }

    @Test
    void testBuildLinkWithProperties() {
        Map<String, Object> props = new HashMap<>();
        props.put("weight", 0.5);
        props.put("since", "2024-01-01");
        PreparedQuery q = SixSevenQuery.buildLink("follows", "users", 1, "users", 2, props);
        assertTrue(q.getSql().contains("$3"));
        assertTrue(q.getValues().size() >= 3);
    }

    @Test
    void testBuildUnlink() {
        PreparedQuery q = SixSevenQuery.buildUnlink("follows", "users", 1, "users", 2);
        assertTrue(q.getSql().contains("UNLINK"));
        assertTrue(q.getSql().contains("\"users\"($1)"));
        assertTrue(q.getSql().contains("FROM \"users\"($2)"));
        assertEquals(2, q.getValues().size());
    }

    @Test
    void testValidatePositiveInt() {
        assertDoesNotThrow(() -> SixSevenQuery.validatePositiveInt(1, "test"));
        assertThrows(IllegalArgumentException.class, () -> SixSevenQuery.validatePositiveInt(0, "test"));
        assertThrows(IllegalArgumentException.class, () -> SixSevenQuery.validatePositiveInt(-1, "test"));
    }
}
