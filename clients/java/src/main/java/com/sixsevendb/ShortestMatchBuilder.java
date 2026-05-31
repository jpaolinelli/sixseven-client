package com.sixsevendb;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Fluent builder for SELECT ... FROM MATCH shortest-path queries.
 * <pre>
 * SELECT a, b FROM MATCH ANY SHORTEST (a:"t")-[r:"e"]->(b:"t") [WEIGHT expr] [WHERE expr]
 * </pre>
 */
public final class ShortestMatchBuilder {

    /** Path selector for shortest match queries. */
    public enum Selector { ANY_SHORTEST, ALL_SHORTEST, SHORTEST_K }

    /** Direction for edges in a pattern. */
    public enum Direction { OUT, IN, BOTH }

    private final List<PatternElement> elements = new ArrayList<>();
    private final List<String> returnItems = new ArrayList<>();
    private Selector selector = Selector.ANY_SHORTEST;
    private int k;
    private String weight;
    private String where;

    ShortestMatchBuilder() {}

    /** Adds a node to the pattern. */
    public ShortestMatchBuilder node(String alias, String table) {
        elements.add(new NodeElement(alias, table));
        return this;
    }

    /** Adds an outgoing edge to the pattern. */
    public ShortestMatchBuilder edge(String alias, String edgeType) {
        return edge(alias, edgeType, Direction.OUT);
    }

    /** Adds an edge with direction to the pattern. */
    public ShortestMatchBuilder edge(String alias, String edgeType, Direction direction) {
        elements.add(new EdgeElement(alias, edgeType, direction));
        return this;
    }

    /** Sets return items. */
    public ShortestMatchBuilder returning(String... items) {
        Collections.addAll(returnItems, items);
        return this;
    }

    /** Sets the selector to ANY SHORTEST. */
    public ShortestMatchBuilder anyShortest() {
        this.selector = Selector.ANY_SHORTEST;
        return this;
    }

    /** Sets the selector to ALL SHORTEST. */
    public ShortestMatchBuilder allShortest() {
        this.selector = Selector.ALL_SHORTEST;
        return this;
    }

    /** Sets the selector to SHORTEST k. */
    public ShortestMatchBuilder shortestK(int k) {
        this.selector = Selector.SHORTEST_K;
        this.k = k;
        return this;
    }

    /** Adds a WEIGHT clause. */
    public ShortestMatchBuilder weight(String expr) {
        this.weight = expr;
        return this;
    }

    /** Adds a WHERE clause. */
    public ShortestMatchBuilder where(String expr) {
        this.where = expr;
        return this;
    }

    public PreparedQuery build() {
        if (elements.isEmpty()) {
            throw new IllegalArgumentException("MATCH pattern must not be empty");
        }
        if (returnItems.isEmpty()) {
            throw new IllegalArgumentException("must have at least one return item");
        }

        String selectorSql;
        switch (selector) {
            case ALL_SHORTEST:
                selectorSql = "ALL SHORTEST";
                break;
            case SHORTEST_K:
                SixSevenQuery.validatePositiveInt(k, "k");
                selectorSql = "SHORTEST " + k;
                break;
            default:
                selectorSql = "ANY SHORTEST";
                break;
        }

        StringBuilder patternStr = new StringBuilder();
        for (PatternElement elem : elements) {
            patternStr.append(elem.toSQL());
        }

        String sql = "SELECT " + String.join(", ", returnItems)
                + " FROM MATCH " + selectorSql + " " + patternStr;

        if (weight != null) {
            sql += " WEIGHT " + weight;
        }
        if (where != null) {
            sql += " WHERE " + where;
        }

        return new PreparedQuery(sql, Collections.emptyList());
    }

    // --- Internal pattern elements ---

    private interface PatternElement {
        String toSQL();
    }

    private static final class NodeElement implements PatternElement {
        final String alias;
        final String table;

        NodeElement(String alias, String table) {
            this.alias = alias;
            this.table = table;
        }

        @Override
        public String toSQL() {
            return "(" + alias + ":" + SixSevenQuery.quoteIdentifier(table) + ")";
        }
    }

    private static final class EdgeElement implements PatternElement {
        final String alias;
        final String edgeType;
        final Direction direction;

        EdgeElement(String alias, String edgeType, Direction direction) {
            this.alias = alias;
            this.edgeType = edgeType;
            this.direction = direction;
        }

        @Override
        public String toSQL() {
            String edgeRef = "[" + alias + ":" + SixSevenQuery.quoteIdentifier(edgeType) + "]";
            switch (direction) {
                case IN:   return "<-" + edgeRef + "-";
                case BOTH: return "-" + edgeRef + "-";
                default:   return "-" + edgeRef + "->";
            }
        }
    }
}
