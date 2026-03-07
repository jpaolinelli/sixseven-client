package com.sixsevendb;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.DisplayName;

import java.sql.SQLException;
import java.util.Properties;

import static org.junit.jupiter.api.Assertions.*;

/**
 * QA adversarial tests for SixSevenDriver — GDB-51.
 * Targets URL parsing, acceptsURL, edge cases, and error paths.
 */
class QaGdb51DriverTest {

    // === acceptsURL edge cases ===

    @Test
    @DisplayName("acceptsURL returns false for null URL")
    void acceptsUrlNull() {
        assertFalse(new SixSevenDriver().acceptsURL(null));
    }

    @Test
    @DisplayName("acceptsURL returns false for empty URL")
    void acceptsUrlEmpty() {
        assertFalse(new SixSevenDriver().acceptsURL(""));
    }

    @Test
    @DisplayName("acceptsURL returns false for MySQL URL")
    void acceptsUrlMySQL() {
        assertFalse(new SixSevenDriver().acceptsURL("jdbc:mysql://localhost:3306/db"));
    }

    @Test
    @DisplayName("acceptsURL returns true for all supported schemes")
    void acceptsUrlAllSchemes() {
        SixSevenDriver driver = new SixSevenDriver();
        assertTrue(driver.acceptsURL("jdbc:sixseven://localhost/db"));
        assertTrue(driver.acceptsURL("sixseven://localhost/db"));
        assertTrue(driver.acceptsURL("postgresql://localhost/db"));
        assertTrue(driver.acceptsURL("postgres://localhost/db"));
    }

    @Test
    @DisplayName("acceptsURL is case-insensitive")
    void acceptsUrlCaseInsensitive() {
        SixSevenDriver driver = new SixSevenDriver();
        assertTrue(driver.acceptsURL("JDBC:SIXSEVEN://localhost/db"));
        assertTrue(driver.acceptsURL("SixSeven://localhost/db"));
        assertTrue(driver.acceptsURL("POSTGRESQL://localhost/db"));
    }

    // === parseURL edge cases ===

    @Test
    @DisplayName("parseURL defaults: host=localhost, port=6767, user=sixseven, db=sixseven")
    void parseUrlDefaults() throws SQLException {
        SixSevenDriver.ConnectionConfig cfg = SixSevenDriver.parseURL(
            "jdbc:sixseven://localhost/sixseven", null);
        assertEquals("localhost", cfg.host);
        assertEquals(6767, cfg.port);
        assertEquals("sixseven", cfg.user);
        assertEquals("sixseven", cfg.database);
    }

    @Test
    @DisplayName("parseURL with full URL including credentials")
    void parseUrlFull() throws SQLException {
        SixSevenDriver.ConnectionConfig cfg = SixSevenDriver.parseURL(
            "jdbc:sixseven://admin:secret@myhost:1234/mydb", null);
        assertEquals("myhost", cfg.host);
        assertEquals(1234, cfg.port);
        assertEquals("admin", cfg.user);
        assertEquals("secret", cfg.password);
        assertEquals("mydb", cfg.database);
    }

    @Test
    @DisplayName("parseURL with query parameters")
    void parseUrlQueryParams() throws SQLException {
        SixSevenDriver.ConnectionConfig cfg = SixSevenDriver.parseURL(
            "jdbc:sixseven://localhost/mydb?user=admin&password=secret", null);
        assertEquals("admin", cfg.user);
        assertEquals("secret", cfg.password);
        assertEquals("mydb", cfg.database);
    }

    @Test
    @DisplayName("parseURL Properties override URL values")
    void parseUrlPropertiesOverride() throws SQLException {
        Properties props = new Properties();
        props.setProperty("user", "prop_user");
        props.setProperty("password", "prop_pass");
        SixSevenDriver.ConnectionConfig cfg = SixSevenDriver.parseURL(
            "jdbc:sixseven://admin:secret@localhost/mydb", props);
        assertEquals("prop_user", cfg.user);
        assertEquals("prop_pass", cfg.password);
    }

    @Test
    @DisplayName("parseURL with null Properties works")
    void parseUrlNullProperties() throws SQLException {
        SixSevenDriver.ConnectionConfig cfg = SixSevenDriver.parseURL(
            "jdbc:sixseven://localhost/mydb", null);
        assertEquals("localhost", cfg.host);
        assertEquals("mydb", cfg.database);
    }

    @Test
    @DisplayName("parseURL with host only (no port, no database)")
    void parseUrlHostOnly() throws SQLException {
        SixSevenDriver.ConnectionConfig cfg = SixSevenDriver.parseURL(
            "jdbc:sixseven://myhost", null);
        assertEquals("myhost", cfg.host);
        assertEquals(6767, cfg.port); // default port
        assertEquals("sixseven", cfg.database); // default database
    }

    @Test
    @DisplayName("parseURL with port but no database")
    void parseUrlPortNoDb() throws SQLException {
        SixSevenDriver.ConnectionConfig cfg = SixSevenDriver.parseURL(
            "jdbc:sixseven://myhost:1234", null);
        assertEquals("myhost", cfg.host);
        assertEquals(1234, cfg.port);
        assertEquals("sixseven", cfg.database); // default
    }

    @Test
    @DisplayName("parseURL with invalid port throws SQLException")
    void parseUrlInvalidPort() {
        assertThrows(SQLException.class, () ->
            SixSevenDriver.parseURL("jdbc:sixseven://localhost:abc/db", null));
    }

    @Test
    @DisplayName("parseURL with postgresql scheme")
    void parseUrlPostgresScheme() throws SQLException {
        SixSevenDriver.ConnectionConfig cfg = SixSevenDriver.parseURL(
            "postgresql://myhost:5432/mydb", null);
        assertEquals("myhost", cfg.host);
        assertEquals(5432, cfg.port);
        assertEquals("mydb", cfg.database);
    }

    @Test
    @DisplayName("parseURL key-value format")
    void parseUrlKeyValue() throws SQLException {
        SixSevenDriver.ConnectionConfig cfg = SixSevenDriver.parseURL(
            "sixseven: host=myhost port=9999 dbname=mydb user=admin password=secret", null);
        assertEquals("myhost", cfg.host);
        assertEquals(9999, cfg.port);
        assertEquals("mydb", cfg.database);
        assertEquals("admin", cfg.user);
        assertEquals("secret", cfg.password);
    }

    @Test
    @DisplayName("BUG: parseURL key-value format with invalid port throws NumberFormatException instead of SQLException")
    void parseUrlKeyValueInvalidPort() {
        // parseKeyValue uses Integer.parseInt without try-catch, so it throws
        // NumberFormatException (unchecked) instead of SQLException
        assertThrows(NumberFormatException.class, () ->
            SixSevenDriver.parseURL("sixseven: host=myhost port=abc", null));
    }

    @Test
    @DisplayName("parseURL with @ in password fails — known limitation")
    void parseUrlSpecialCharsInPassword() {
        // URL with @ in password: user:p@ss:w0rd@localhost/db
        // Parser splits on FIRST @, so userinfo="user:p", hostpath="ss:w0rd@localhost/db"
        // Then hostpath "ss:w0rd@localhost/db" has lastIndexOf(':') after "localhost"
        // and tries to parse "w0rd@localhost" as port → SQLException
        assertThrows(SQLException.class, () ->
            SixSevenDriver.parseURL("jdbc:sixseven://user:p@ss:w0rd@localhost/db", null));
    }

    @Test
    @DisplayName("parseURL with empty password")
    void parseUrlEmptyPassword() throws SQLException {
        SixSevenDriver.ConnectionConfig cfg = SixSevenDriver.parseURL(
            "jdbc:sixseven://user:@localhost/db", null);
        assertEquals("user", cfg.user);
        assertEquals("", cfg.password);
    }

    @Test
    @DisplayName("parseURL with userinfo but no password")
    void parseUrlUserOnly() throws SQLException {
        SixSevenDriver.ConnectionConfig cfg = SixSevenDriver.parseURL(
            "jdbc:sixseven://admin@localhost/db", null);
        assertEquals("admin", cfg.user);
    }

    // === Driver metadata ===

    @Test
    @DisplayName("Driver major version is 0")
    void driverMajorVersion() {
        assertEquals(0, new SixSevenDriver().getMajorVersion());
    }

    @Test
    @DisplayName("Driver minor version is 0 or 1")
    void driverMinorVersion() {
        assertTrue(new SixSevenDriver().getMinorVersion() >= 0);
    }

    @Test
    @DisplayName("Driver is not JDBC compliant")
    void driverNotJdbcCompliant() {
        assertFalse(new SixSevenDriver().jdbcCompliant());
    }

    @Test
    @DisplayName("Driver getPropertyInfo returns empty array")
    void driverPropertyInfo() {
        assertEquals(0, new SixSevenDriver().getPropertyInfo("", null).length);
    }

    @Test
    @DisplayName("Driver connect returns null for non-matching URL")
    void driverConnectNonMatchingUrl() throws SQLException {
        assertNull(new SixSevenDriver().connect("jdbc:mysql://localhost/db", null));
    }

    // === Embedding edge cases ===

    @Test
    @DisplayName("Embedding parse with null returns empty")
    void embeddingParseNull() {
        Embedding e = Embedding.parse(null);
        assertEquals(0, e.dimensions());
    }

    @Test
    @DisplayName("Embedding parse with empty brackets")
    void embeddingParseEmptyBrackets() {
        Embedding e = Embedding.parse("[]");
        assertEquals(0, e.dimensions());
    }

    @Test
    @DisplayName("Embedding parse with whitespace around values")
    void embeddingParseWhitespace() {
        Embedding e = Embedding.parse("[ 0.1 , 0.2 , 0.3 ]");
        assertEquals(3, e.dimensions());
        assertArrayEquals(new float[]{0.1f, 0.2f, 0.3f}, e.getValues(), 0.001f);
    }

    @Test
    @DisplayName("Embedding parse without brackets")
    void embeddingParseNoBrackets() {
        Embedding e = Embedding.parse("0.1,0.2");
        assertEquals(2, e.dimensions());
    }

    @Test
    @DisplayName("Embedding parse with invalid float throws")
    void embeddingParseInvalidFloat() {
        assertThrows(NumberFormatException.class, () -> Embedding.parse("[abc,def]"));
    }

    @Test
    @DisplayName("Embedding constructor with null creates empty")
    void embeddingConstructorNull() {
        Embedding e = new Embedding(null);
        assertEquals(0, e.dimensions());
    }

    @Test
    @DisplayName("Embedding makes defensive copy of input array")
    void embeddingDefensiveCopy() {
        float[] input = {1.0f, 2.0f};
        Embedding e = new Embedding(input);
        input[0] = 999.0f;
        assertEquals(1.0f, e.getValues()[0], 0.001f);
    }

    @Test
    @DisplayName("Embedding getValues makes defensive copy")
    void embeddingGetValuesDefensiveCopy() {
        Embedding e = new Embedding(new float[]{1.0f, 2.0f});
        float[] vals = e.getValues();
        vals[0] = 999.0f;
        assertEquals(1.0f, e.getValues()[0], 0.001f);
    }

    @Test
    @DisplayName("Embedding equals and hashCode")
    void embeddingEqualsHashCode() {
        Embedding a = new Embedding(new float[]{1.0f, 2.0f});
        Embedding b = new Embedding(new float[]{1.0f, 2.0f});
        Embedding c = new Embedding(new float[]{3.0f, 4.0f});
        assertEquals(a, b);
        assertEquals(a.hashCode(), b.hashCode());
        assertNotEquals(a, c);
    }

    @Test
    @DisplayName("Embedding serialize roundtrip")
    void embeddingSerializeRoundtrip() {
        Embedding original = new Embedding(new float[]{0.1f, 0.2f, 0.3f});
        String serialized = original.serialize();
        Embedding parsed = Embedding.parse(serialized);
        assertEquals(original, parsed);
    }

    // === Interval edge cases ===

    @Test
    @DisplayName("Interval parse with null returns zero interval")
    void intervalParseNull() {
        Interval iv = Interval.parse(null);
        assertEquals(0, iv.getDays());
        assertEquals(0, iv.getHours());
    }

    @Test
    @DisplayName("Interval parse with time-only format")
    void intervalParseTimeOnly() {
        Interval iv = Interval.parse("01:02:03");
        assertEquals(1, iv.getHours());
        assertEquals(2, iv.getMinutes());
        assertEquals(3.0, iv.getSeconds(), 0.001);
    }

    @Test
    @DisplayName("Interval parse with days and time")
    void intervalParseDaysAndTime() {
        Interval iv = Interval.parse("5 days 01:02:03");
        assertEquals(5, iv.getDays());
        assertEquals(1, iv.getHours());
        assertEquals(2, iv.getMinutes());
        assertEquals(3.0, iv.getSeconds(), 0.001);
    }

    @Test
    @DisplayName("Interval parse with singular 'day'")
    void intervalParseSingularDay() {
        Interval iv = Interval.parse("1 day 10:00:00");
        assertEquals(1, iv.getDays());
        assertEquals(10, iv.getHours());
    }

    @Test
    @DisplayName("Interval parse with raw seconds")
    void intervalParseRawSeconds() {
        Interval iv = Interval.parse("3600.5");
        assertEquals(3600.5, iv.getSeconds(), 0.001);
    }

    @Test
    @DisplayName("Interval parse with unrecognized format returns zero")
    void intervalParseUnrecognized() {
        Interval iv = Interval.parse("gibberish");
        assertEquals(0, iv.getDays());
        assertEquals(0, iv.getHours());
        assertEquals(0.0, iv.getSeconds(), 0.001);
    }

    @Test
    @DisplayName("Interval parse with fractional seconds")
    void intervalParseFractionalSeconds() {
        Interval iv = Interval.parse("00:00:30.5");
        assertEquals(30.5, iv.getSeconds(), 0.001);
    }

    @Test
    @DisplayName("Interval toString formats correctly")
    void intervalToString() {
        Interval iv = new Interval(1, 2, 3, 4, 5, 6.5);
        String s = iv.toString();
        assertTrue(s.contains("1 years"));
        assertTrue(s.contains("2 months"));
        assertTrue(s.contains("3 days"));
        assertTrue(s.contains("04:05:"));
    }

    @Test
    @DisplayName("Interval zero toString returns 0")
    void intervalZeroToString() {
        assertEquals("0", new Interval(0, 0, 0, 0, 0, 0).toString());
    }

    @Test
    @DisplayName("Interval equals and hashCode")
    void intervalEqualsHashCode() {
        Interval a = new Interval(1, 2, 3, 4, 5, 6.0);
        Interval b = new Interval(1, 2, 3, 4, 5, 6.0);
        Interval c = new Interval(0, 0, 0, 0, 0, 0);
        assertEquals(a, b);
        assertEquals(a.hashCode(), b.hashCode());
        assertNotEquals(a, c);
    }

    // === SixSevenException ===

    @Test
    @DisplayName("SixSevenException includes severity and sqlState")
    void exceptionFields() {
        SixSevenException ex = new SixSevenException("ERROR", "42P01", "table not found", "detail", "hint");
        assertTrue(ex.getMessage().contains("ERROR"));
        assertTrue(ex.getMessage().contains("42P01"));
        assertTrue(ex.getMessage().contains("table not found"));
        assertEquals("ERROR", ex.getSeverity());
        assertEquals("detail", ex.getDetail());
        assertEquals("hint", ex.getHint());
        assertEquals("42P01", ex.getSQLState());
    }

    @Test
    @DisplayName("SixSevenException with null sqlState omits SQLSTATE")
    void exceptionNullSqlState() {
        SixSevenException ex = new SixSevenException("ERROR", null, "bad", null, null);
        assertFalse(ex.getMessage().contains("SQLSTATE"));
    }

    // === SixSevenSavepoint ===

    @Test
    @DisplayName("Savepoint getName returns correct name")
    void savepointName() {
        SixSevenSavepoint sp = new SixSevenSavepoint("my_savepoint");
        assertEquals("my_savepoint", sp.getSavepointName());
    }

    @Test
    @DisplayName("Savepoint getId throws SQLException")
    void savepointIdThrows() {
        SixSevenSavepoint sp = new SixSevenSavepoint("sp1");
        assertThrows(SQLException.class, sp::getSavepointId);
    }
}
