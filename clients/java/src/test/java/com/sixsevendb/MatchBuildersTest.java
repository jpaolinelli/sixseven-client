package com.sixsevendb;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class MatchBuildersTest {

    @Test
    void testBuildMatch() {
        PreparedQuery q = SixSevenQuery.match()
            .node("a", "users")
            .edge("r", "follows", MatchBuilder.Direction.OUT)
            .node("b", "users")
            .returning("a", "b")
            .build();

        assertTrue(q.getSql().contains("MATCH"));
        assertTrue(q.getSql().contains("(a:\"users\")"));
        assertTrue(q.getSql().contains("-[r:\"follows\"]->"));
        assertTrue(q.getSql().contains("(b:\"users\")"));
        assertTrue(q.getSql().contains("RETURN a, b"));
    }

    @Test
    void testBuildMatchWithWhere() {
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
    void testBuildMatchInEdge() {
        PreparedQuery q = SixSevenQuery.match()
            .node("a", "users")
            .edge("r", "follows", MatchBuilder.Direction.IN)
            .node("b", "users")
            .returning("a", "b")
            .build();

        assertTrue(q.getSql().contains("<-[r:\"follows\"]-"));
    }

    @Test
    void testBuildMatchBothEdge() {
        PreparedQuery q = SixSevenQuery.match()
            .node("a", "users")
            .edge("r", "follows", MatchBuilder.Direction.BOTH)
            .node("b", "users")
            .returning("a", "b")
            .build();

        assertTrue(q.getSql().contains("-[r:\"follows\"]-"));
        assertFalse(q.getSql().contains("->"));
        assertFalse(q.getSql().contains("<-"));
    }

    @Test
    void testBuildMatchEmptyPattern() {
        assertThrows(IllegalArgumentException.class, () ->
            SixSevenQuery.match().returning("a").build()
        );
    }

    @Test
    void testBuildShortestPath() {
        PreparedQuery q = SixSevenQuery.shortestPath("follows", "users", 1, "users", 2)
            .build();

        assertTrue(q.getSql().contains("SHORTEST PATH FROM"));
        assertTrue(q.getSql().contains("\"users\"($1)"));
        assertTrue(q.getSql().contains("TO \"users\"($2)"));
        assertTrue(q.getSql().contains("VIA \"follows\""));
        assertEquals(2, q.getValues().size());
    }

    @Test
    void testBuildShortestPathWithOptions() {
        PreparedQuery q = SixSevenQuery.shortestPath("follows", "users", 1, "users", 2)
            .direction("OUT")
            .maxDepth(5)
            .build();

        assertTrue(q.getSql().contains("DIRECTION OUT"));
        assertTrue(q.getSql().contains("MAX_DEPTH 5"));
    }

    @Test
    void testBuildShortestPathInvalidMaxDepth() {
        assertThrows(IllegalArgumentException.class, () ->
            SixSevenQuery.shortestPath("follows", "users", 1, "users", 2)
                .maxDepth(-1)
                .build()
        );
    }
}
