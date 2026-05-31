package com.sixsevendb;

import java.util.Collections;
import java.util.List;

/**
 * A built query with SQL text and parameter values.
 */
public final class PreparedQuery {

    private final String sql;
    private final List<Object> values;

    public PreparedQuery(String sql, List<Object> values) {
        this.sql = sql;
        this.values = values != null ? Collections.unmodifiableList(values) : Collections.emptyList();
    }

    /** Returns the SQL text with $1, $2, ... placeholders. */
    public String getSql() { return sql; }

    /** Returns the parameter values (in order). */
    public List<Object> getValues() { return values; }

    @Override
    public String toString() {
        return "PreparedQuery{sql='" + sql + "', values=" + values + "}";
    }
}
