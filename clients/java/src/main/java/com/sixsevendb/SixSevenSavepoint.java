package com.sixsevendb;

import java.sql.SQLException;
import java.sql.Savepoint;

/**
 * JDBC Savepoint implementation for SixSevenDB.
 */
public class SixSevenSavepoint implements Savepoint {

    private final String name;

    SixSevenSavepoint(String name) {
        this.name = name;
    }

    @Override
    public int getSavepointId() throws SQLException {
        throw new SQLException("sixsevendb: named savepoints do not have IDs");
    }

    @Override
    public String getSavepointName() {
        return name;
    }
}
