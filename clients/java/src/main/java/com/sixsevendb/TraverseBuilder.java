package com.sixsevendb;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Fluent builder for TRAVERSE queries.
 * <pre>
 * TRAVERSE edge FROM table($1) [DIRECTION d] [MAX_DEPTH n] [MODE m] [WHERE expr] [FETCH]
 * </pre>
 */
public final class TraverseBuilder {

    private final String edgeType;
    private final String fromTable;
    private final Object startID;
    private String direction;
    private int maxDepth;
    private String mode;
    private String where;
    private boolean fetch;

    TraverseBuilder(String edgeType, String fromTable, Object startID) {
        this.edgeType = edgeType;
        this.fromTable = fromTable;
        this.startID = startID;
    }

    public TraverseBuilder direction(String direction) {
        this.direction = direction;
        return this;
    }

    public TraverseBuilder maxDepth(int maxDepth) {
        this.maxDepth = maxDepth;
        return this;
    }

    public TraverseBuilder mode(String mode) {
        this.mode = mode;
        return this;
    }

    public TraverseBuilder where(String where) {
        this.where = where;
        return this;
    }

    public TraverseBuilder fetch() {
        this.fetch = true;
        return this;
    }

    public PreparedQuery build() {
        if (maxDepth != 0) {
            SixSevenQuery.validatePositiveInt(maxDepth, "maxDepth");
        }

        List<String> parts = new ArrayList<>();
        parts.add("TRAVERSE " + SixSevenQuery.quoteIdentifier(edgeType)
                + " FROM " + SixSevenQuery.quoteIdentifier(fromTable) + "($1)");

        if (direction != null) parts.add("DIRECTION " + direction);
        if (maxDepth > 0) parts.add("MAX_DEPTH " + maxDepth);
        if (mode != null) parts.add("MODE " + mode);
        if (where != null) parts.add("WHERE " + where);
        if (fetch) parts.add("FETCH");

        return new PreparedQuery(String.join(" ", parts), Collections.singletonList(startID));
    }
}
