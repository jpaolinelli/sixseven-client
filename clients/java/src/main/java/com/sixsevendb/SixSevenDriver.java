package com.sixsevendb;

import java.sql.*;
import java.util.Properties;
import java.util.logging.Logger;

/**
 * JDBC Type 4 Driver for SixSevenDB.
 * <p>
 * Connection URL format: {@code jdbc:sixseven://host:port/database}
 * <p>
 * Also accepts: {@code sixseven://host:port/database} or {@code postgresql://host:port/database}
 * <p>
 * Registered via SPI (META-INF/services/java.sql.Driver) — no manual Class.forName needed.
 */
public class SixSevenDriver implements Driver {

    private static final String URL_PREFIX = "jdbc:sixseven:";
    private static final String ALT_PREFIX_1 = "sixseven:";
    private static final String ALT_PREFIX_2 = "postgresql:";
    private static final String ALT_PREFIX_3 = "postgres:";

    static {
        try {
            DriverManager.registerDriver(new SixSevenDriver());
        } catch (SQLException e) {
            throw new RuntimeException("Failed to register SixSevenDB driver", e);
        }
    }

    @Override
    public Connection connect(String url, Properties info) throws SQLException {
        if (!acceptsURL(url)) return null;
        ConnectionConfig cfg = parseURL(url, info);
        return new SixSevenConnection(cfg.host, cfg.port, cfg.user, cfg.password, cfg.database);
    }

    @Override
    public boolean acceptsURL(String url) {
        if (url == null) return false;
        String lower = url.toLowerCase();
        return lower.startsWith(URL_PREFIX)
            || lower.startsWith(ALT_PREFIX_1)
            || lower.startsWith(ALT_PREFIX_2)
            || lower.startsWith(ALT_PREFIX_3);
    }

    @Override
    public DriverPropertyInfo[] getPropertyInfo(String url, Properties info) {
        return new DriverPropertyInfo[0];
    }

    @Override
    public int getMajorVersion() { return 0; }

    @Override
    public int getMinorVersion() { return 1; }

    @Override
    public boolean jdbcCompliant() { return false; }

    @Override
    public Logger getParentLogger() throws SQLFeatureNotSupportedException {
        throw new SQLFeatureNotSupportedException();
    }

    /** Parses a JDBC URL + properties into connection config. */
    static ConnectionConfig parseURL(String url, Properties info) throws SQLException {
        ConnectionConfig cfg = new ConnectionConfig();

        // Strip JDBC prefix
        String dsn = url;
        if (dsn.toLowerCase().startsWith("jdbc:")) {
            dsn = dsn.substring(5);
        }

        // Handle key-value format
        if (!dsn.contains("://")) {
            return parseKeyValue(dsn, cfg, info);
        }

        // URI format: scheme://[user[:password]@]host[:port]/database[?params]
        int schemeEnd = dsn.indexOf("://");
        String rest = dsn.substring(schemeEnd + 3);

        // Split userinfo from host
        String userinfo = null;
        String hostpath;
        int atIdx = rest.indexOf('@');
        if (atIdx >= 0) {
            userinfo = rest.substring(0, atIdx);
            hostpath = rest.substring(atIdx + 1);
        } else {
            hostpath = rest;
        }

        // Parse userinfo
        if (userinfo != null && !userinfo.isEmpty()) {
            int colonIdx = userinfo.indexOf(':');
            if (colonIdx >= 0) {
                cfg.user = userinfo.substring(0, colonIdx);
                cfg.password = userinfo.substring(colonIdx + 1);
            } else {
                cfg.user = userinfo;
            }
        }

        // Split host:port from /database
        String hostport;
        String dbpath = "";
        int slashIdx = hostpath.indexOf('/');
        if (slashIdx >= 0) {
            hostport = hostpath.substring(0, slashIdx);
            dbpath = hostpath.substring(slashIdx + 1);
        } else {
            hostport = hostpath;
        }

        // Parse host:port
        if (!hostport.isEmpty()) {
            int colonIdx = hostport.lastIndexOf(':');
            if (colonIdx >= 0) {
                cfg.host = hostport.substring(0, colonIdx);
                try {
                    cfg.port = Integer.parseInt(hostport.substring(colonIdx + 1));
                } catch (NumberFormatException e) {
                    throw new SQLException("sixsevendb: invalid port in URL: " + hostport.substring(colonIdx + 1));
                }
            } else {
                cfg.host = hostport;
            }
        }

        // Parse database (strip query parameters)
        if (!dbpath.isEmpty()) {
            int qIdx = dbpath.indexOf('?');
            if (qIdx >= 0) {
                // Parse query params
                String queryStr = dbpath.substring(qIdx + 1);
                dbpath = dbpath.substring(0, qIdx);
                parseQueryParams(queryStr, cfg);
            }
            if (!dbpath.isEmpty()) {
                cfg.database = dbpath;
            }
        }

        // Override with Properties
        applyProperties(cfg, info);
        return cfg;
    }

    private static ConnectionConfig parseKeyValue(String dsn, ConnectionConfig cfg, Properties info) {
        String[] pairs = dsn.split("\\s+");
        for (String pair : pairs) {
            int eqIdx = pair.indexOf('=');
            if (eqIdx < 0) continue;
            String key = pair.substring(0, eqIdx);
            String value = pair.substring(eqIdx + 1);
            switch (key) {
                case "host": cfg.host = value; break;
                case "port": cfg.port = Integer.parseInt(value); break;
                case "user": cfg.user = value; break;
                case "password": cfg.password = value; break;
                case "database":
                case "dbname": cfg.database = value; break;
            }
        }
        applyProperties(cfg, info);
        return cfg;
    }

    private static void parseQueryParams(String queryStr, ConnectionConfig cfg) {
        for (String param : queryStr.split("&")) {
            int eqIdx = param.indexOf('=');
            if (eqIdx < 0) continue;
            String key = param.substring(0, eqIdx);
            String value = param.substring(eqIdx + 1);
            switch (key) {
                case "user": cfg.user = value; break;
                case "password": cfg.password = value; break;
            }
        }
    }

    private static void applyProperties(ConnectionConfig cfg, Properties info) {
        if (info == null) return;
        if (info.containsKey("user")) cfg.user = info.getProperty("user");
        if (info.containsKey("password")) cfg.password = info.getProperty("password");
    }

    static final class ConnectionConfig {
        String host = "localhost";
        int port = 6767;
        String user = "sixseven";
        String password = "";
        String database = "sixseven";
    }
}
