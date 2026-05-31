package com.sixsevendb;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * Fluent builder for SHORTEST PATH queries.
 * <pre>
 * SHORTEST PATH FROM table($1) TO table($2) VIA edge [DIRECTION d] [MAX_DEPTH n]
 * </pre>
 */
public final class ShortestPathBuilder {

    private final String edgeType;
    private final String fromTable;
    private final Object fromID;
    private final String toTable;
    private final Object toID;
    private String direction;
    private int maxDepth;

    ShortestPathBuilder(String edgeType, String fromTable, Object fromID,
                        String toTable, Object toID) {
        this.edgeType = edgeType;
        this.fromTable = fromTable;
        this.fromID = fromID;
        this.toTable = toTable;
        this.toID = toID;
    }

    public ShortestPathBuilder direction(String direction) {
        this.direction = direction;
        return this;
    }

    public ShortestPathBuilder maxDepth(int maxDepth) {
        this.maxDepth = maxDepth;
        return this;
    }

    public PreparedQuery build() {
        if (maxDepth != 0) {
            SixSevenQuery.validatePositiveInt(maxDepth, "maxDepth");
        }

        List<String> parts = new ArrayList<>();
        parts.add("SHORTEST PATH FROM " + SixSevenQuery.quoteIdentifier(fromTable) + "($1) TO "
                + SixSevenQuery.quoteIdentifier(toTable) + "($2) VIA "
                + SixSevenQuery.quoteIdentifier(edgeType));

        if (direction != null) parts.add("DIRECTION " + direction);
        if (maxDepth > 0) parts.add("MAX_DEPTH " + maxDepth);

        return new PreparedQuery(String.join(" ", parts), Arrays.asList(fromID, toID));
    }
}
