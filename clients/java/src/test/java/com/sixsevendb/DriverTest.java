package com.sixsevendb;

import org.junit.jupiter.api.Test;

import java.sql.SQLException;
import java.util.Properties;

import static org.junit.jupiter.api.Assertions.*;

class DriverTest {

    @Test
    void testAcceptsURL() {
        SixSevenDriver driver = new SixSevenDriver();
        assertTrue(driver.acceptsURL("jdbc:sixseven://localhost:6767/mydb"));
        assertTrue(driver.acceptsURL("sixseven://localhost:6767/mydb"));
        assertTrue(driver.acceptsURL("postgresql://localhost:6767/mydb"));
        assertTrue(driver.acceptsURL("postgres://localhost:6767/mydb"));
        assertFalse(driver.acceptsURL("mysql://localhost:3306/mydb"));
        assertFalse(driver.acceptsURL(null));
    }

    @Test
    void testParseURLDefaults() throws SQLException {
        SixSevenDriver.ConnectionConfig cfg = SixSevenDriver.parseURL("jdbc:sixseven://", null);
        assertEquals("localhost", cfg.host);
        assertEquals(6767, cfg.port);
        assertEquals("sixseven", cfg.user);
        assertEquals("sixseven", cfg.database);
    }

    @Test
    void testParseURLFull() throws SQLException {
        SixSevenDriver.ConnectionConfig cfg = SixSevenDriver.parseURL(
            "jdbc:sixseven://admin:secret@db.example.com:5432/mydb", null);
        assertEquals("db.example.com", cfg.host);
        assertEquals(5432, cfg.port);
        assertEquals("admin", cfg.user);
        assertEquals("secret", cfg.password);
        assertEquals("mydb", cfg.database);
    }

    @Test
    void testParseURLWithoutPort() throws SQLException {
        SixSevenDriver.ConnectionConfig cfg = SixSevenDriver.parseURL(
            "jdbc:sixseven://myhost/testdb", null);
        assertEquals("myhost", cfg.host);
        assertEquals(6767, cfg.port); // default
        assertEquals("testdb", cfg.database);
    }

    @Test
    void testParseURLNoJdbcPrefix() throws SQLException {
        SixSevenDriver.ConnectionConfig cfg = SixSevenDriver.parseURL(
            "sixseven://admin:pass@host:9999/db", null);
        assertEquals("host", cfg.host);
        assertEquals(9999, cfg.port);
        assertEquals("admin", cfg.user);
        assertEquals("pass", cfg.password);
        assertEquals("db", cfg.database);
    }

    @Test
    void testParseURLWithQueryParams() throws SQLException {
        SixSevenDriver.ConnectionConfig cfg = SixSevenDriver.parseURL(
            "jdbc:sixseven://localhost:6767/mydb?user=admin&password=secret", null);
        assertEquals("admin", cfg.user);
        assertEquals("secret", cfg.password);
        assertEquals("mydb", cfg.database);
    }

    @Test
    void testParseURLKeyValueFormat() throws SQLException {
        SixSevenDriver.ConnectionConfig cfg = SixSevenDriver.parseURL(
            "host=myhost port=9999 user=admin password=secret database=mydb", null);
        assertEquals("myhost", cfg.host);
        assertEquals(9999, cfg.port);
        assertEquals("admin", cfg.user);
        assertEquals("secret", cfg.password);
        assertEquals("mydb", cfg.database);
    }

    @Test
    void testParseURLPropertiesOverride() throws SQLException {
        Properties props = new Properties();
        props.setProperty("user", "override_user");
        props.setProperty("password", "override_pass");
        SixSevenDriver.ConnectionConfig cfg = SixSevenDriver.parseURL(
            "jdbc:sixseven://localhost/mydb", props);
        assertEquals("override_user", cfg.user);
        assertEquals("override_pass", cfg.password);
    }

    @Test
    void testParseURLPostgresScheme() throws SQLException {
        SixSevenDriver.ConnectionConfig cfg = SixSevenDriver.parseURL(
            "postgresql://user:pass@host:5432/db", null);
        assertEquals("host", cfg.host);
        assertEquals(5432, cfg.port);
        assertEquals("user", cfg.user);
        assertEquals("pass", cfg.password);
        assertEquals("db", cfg.database);
    }

    @Test
    void testDriverVersions() {
        SixSevenDriver driver = new SixSevenDriver();
        assertEquals(0, driver.getMajorVersion());
        assertEquals(1, driver.getMinorVersion());
    }

    @Test
    void testEmbeddingParseSerialization() {
        Embedding e = Embedding.parse("[1.5,2.5,3.5]");
        assertEquals(3, e.dimensions());
        assertArrayEquals(new float[]{1.5f, 2.5f, 3.5f}, e.getValues(), 0.001f);
        assertEquals("[1.5,2.5,3.5]", e.serialize());
    }

    @Test
    void testEmbeddingEmpty() {
        Embedding e = Embedding.parse("");
        assertEquals(0, e.dimensions());
        assertEquals("[]", e.serialize());
    }

    @Test
    void testIntervalParse() {
        Interval iv = Interval.parse("01:30:45.000");
        assertEquals(1, iv.getHours());
        assertEquals(30, iv.getMinutes());
        assertEquals(45.0, iv.getSeconds(), 0.001);
    }

    @Test
    void testIntervalParseDays() {
        Interval iv = Interval.parse("3 days 02:15:30.000");
        assertEquals(3, iv.getDays());
        assertEquals(2, iv.getHours());
        assertEquals(15, iv.getMinutes());
    }

    @Test
    void testIntervalToString() {
        Interval iv = new Interval(1, 2, 3, 4, 5, 6.0);
        String s = iv.toString();
        assertTrue(s.contains("1 years"));
        assertTrue(s.contains("2 months"));
        assertTrue(s.contains("3 days"));
        assertTrue(s.contains("04:05:06.000"));
    }

    @Test
    void testSixSevenExceptionFields() {
        SixSevenException ex = new SixSevenException("ERROR", "42000", "test", "detail", "hint");
        assertEquals("ERROR", ex.getSeverity());
        assertEquals("42000", ex.getSQLState());
        assertTrue(ex.getMessage().contains("test"));
        assertEquals("detail", ex.getDetail());
        assertEquals("hint", ex.getHint());
    }

    @Test
    void testSavepointName() throws SQLException {
        SixSevenSavepoint sp = new SixSevenSavepoint("mysp");
        assertEquals("mysp", sp.getSavepointName());
        assertThrows(SQLException.class, sp::getSavepointId);
    }
}
