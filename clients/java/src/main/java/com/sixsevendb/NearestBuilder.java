package com.sixsevendb;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Fluent builder for NEAREST queries.
 * <pre>
 * NEAREST k FROM table.column TO $1 [WHERE expr] [USING metric] [WITHIN TRAVERSE edge]
 * </pre>
 */
public final class NearestBuilder {

    private final String table;
    private final String column;
    private final Object queryVec;
    private int k = 10;
    private String metric;
    private String where;
    private String withinTraverse;

    NearestBuilder(String table, String column, Object queryVec) {
        this.table = table;
        this.column = column;
        this.queryVec = queryVec;
    }

    public NearestBuilder k(int k) {
        this.k = k;
        return this;
    }

    public NearestBuilder metric(String metric) {
        this.metric = metric;
        return this;
    }

    public NearestBuilder where(String where) {
        this.where = where;
        return this;
    }

    public NearestBuilder withinTraverse(String edgeType) {
        this.withinTraverse = edgeType;
        return this;
    }

    public PreparedQuery build() {
        SixSevenQuery.validatePositiveInt(k, "k");

        String queryStr;
        if (queryVec instanceof Embedding) {
            queryStr = ((Embedding) queryVec).serialize();
        } else if (queryVec instanceof float[]) {
            queryStr = new Embedding((float[]) queryVec).serialize();
        } else if (queryVec instanceof String) {
            queryStr = (String) queryVec;
        } else {
            throw new IllegalArgumentException("unsupported query vector type: " + queryVec.getClass().getName());
        }

        List<String> parts = new ArrayList<>();
        parts.add("NEAREST " + k + " FROM " + SixSevenQuery.quoteIdentifier(table)
                + "." + SixSevenQuery.quoteIdentifier(column) + " TO $1");

        if (where != null) parts.add("WHERE " + where);
        if (metric != null) parts.add("USING " + metric);
        if (withinTraverse != null) parts.add("WITHIN TRAVERSE " + SixSevenQuery.quoteIdentifier(withinTraverse));

        return new PreparedQuery(String.join(" ", parts), Collections.singletonList((Object) queryStr));
    }
}
