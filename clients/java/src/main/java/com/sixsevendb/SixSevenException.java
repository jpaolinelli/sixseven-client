package com.sixsevendb;

import java.sql.SQLException;

/**
 * Server-side error returned by SixSevenDB.
 */
public class SixSevenException extends SQLException {

    private final String severity;
    private final String detail;
    private final String hint;

    public SixSevenException(String severity, String sqlState, String message, String detail, String hint) {
        super(severity + ": " + message + (sqlState != null ? " (SQLSTATE " + sqlState + ")" : ""), sqlState);
        this.severity = severity;
        this.detail = detail;
        this.hint = hint;
    }

    public String getSeverity() { return severity; }
    public String getDetail() { return detail; }
    public String getHint() { return hint; }
}
