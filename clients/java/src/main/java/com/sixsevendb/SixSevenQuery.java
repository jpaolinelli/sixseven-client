package com.sixsevendb;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;

/**
 * Static entry point for building SixSevenDB-specific queries.
 */
public final class SixSevenQuery {

    private SixSevenQuery() {}

    /** Escapes a SQL identifier with double quotes. */
    public static String quoteIdentifier(String name) {
        return "\"" + name.replace("\"", "\"\"") + "\"";
    }

    // --- TRAVERSE ---

    public static TraverseBuilder traverse(String edgeType, String fromTable, Object startID) {
        return new TraverseBuilder(edgeType, fromTable, startID);
    }

    /** Builds a TRAVERSE query with default options. */
    public static PreparedQuery buildTraverse(String edgeType, String fromTable, Object startID) {
        return new TraverseBuilder(edgeType, fromTable, startID).build();
    }

    // --- NEAREST ---

    public static NearestBuilder nearest(String table, String column, Object queryVec) {
        return new NearestBuilder(table, column, queryVec);
    }

    // --- LINK ---

    public static PreparedQuery buildLink(String edgeType, String fromTable, Object fromID,
                                          String toTable, Object toID, Map<String, Object> properties) {
        StringBuilder sb = new StringBuilder();
        sb.append("LINK ").append(quoteIdentifier(fromTable)).append("($1) TO ")
          .append(quoteIdentifier(toTable)).append("($2) VIA ")
          .append(quoteIdentifier(edgeType));

        List<Object> values = new ArrayList<>(Arrays.asList(fromID, toID));

        if (properties != null && !properties.isEmpty()) {
            List<String> propParts = new ArrayList<>();
            for (Map.Entry<String, Object> entry : properties.entrySet()) {
                int idx = values.size() + 1;
                propParts.add(quoteIdentifier(entry.getKey()) + " = $" + idx);
                values.add(entry.getValue());
            }
            sb.append(" (").append(String.join(", ", propParts)).append(")");
        }

        return new PreparedQuery(sb.toString(), values);
    }

    // --- UNLINK ---

    public static PreparedQuery buildUnlink(String edgeType, String fromTable, Object fromID,
                                            String toTable, Object toID) {
        String sql = "UNLINK " + quoteIdentifier(fromTable) + "($1) FROM "
                   + quoteIdentifier(toTable) + "($2) VIA " + quoteIdentifier(edgeType);
        return new PreparedQuery(sql, Arrays.asList(fromID, toID));
    }

    // --- MATCH ---

    public static MatchBuilder match() {
        return new MatchBuilder();
    }

    // --- SHORTEST PATH ---

    public static ShortestPathBuilder shortestPath(String edgeType, String fromTable, Object fromID,
                                                   String toTable, Object toID) {
        return new ShortestPathBuilder(edgeType, fromTable, fromID, toTable, toID);
    }

    // --- Validation ---

    static void validatePositiveInt(int value, String name) {
        if (value <= 0) {
            throw new IllegalArgumentException(name + " must be a positive integer, got " + value);
        }
    }
}
