package com.sixsevendb;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Fluent builder for MATCH queries (Cypher-style graph pattern matching).
 * <pre>
 * MATCH (a:"table")-[r:"edge"]->(b:"table") RETURN a, b [WHERE expr]
 * </pre>
 */
public final class MatchBuilder {

    /** Direction for edges in a MATCH pattern. */
    public enum Direction { OUT, IN, BOTH }

    private final List<PatternElement> elements = new ArrayList<>();
    private final List<String> returnItems = new ArrayList<>();
    private String where;

    MatchBuilder() {}

    /** Adds a node to the pattern. */
    public MatchBuilder node(String alias, String table) {
        elements.add(new NodeElement(alias, table));
        return this;
    }

    /** Adds an edge to the pattern. */
    public MatchBuilder edge(String alias, String edgeType, Direction direction) {
        elements.add(new EdgeElement(alias, edgeType, direction));
        return this;
    }

    /** Adds an outgoing edge to the pattern. */
    public MatchBuilder edge(String alias, String edgeType) {
        return edge(alias, edgeType, Direction.OUT);
    }

    /** Adds return items. */
    public MatchBuilder returning(String... items) {
        Collections.addAll(returnItems, items);
        return this;
    }

    /** Adds a WHERE clause. */
    public MatchBuilder where(String expr) {
        this.where = expr;
        return this;
    }

    public PreparedQuery build() {
        if (elements.isEmpty()) {
            throw new IllegalArgumentException("MATCH pattern must not be empty");
        }

        StringBuilder patternStr = new StringBuilder();
        for (PatternElement elem : elements) {
            patternStr.append(elem.toSQL());
        }

        String sql = "MATCH " + patternStr + " RETURN " + String.join(", ", returnItems);
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
