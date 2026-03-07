use crate::error::{Error, Result};

/// Configuration for connecting to a SixSevenDB server.
#[derive(Debug, Clone)]
pub struct Config {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: String,
    pub database: String,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            host: "localhost".to_string(),
            port: 6767,
            user: "sixseven".to_string(),
            password: String::new(),
            database: "sixseven".to_string(),
        }
    }
}

impl Config {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn host(mut self, host: &str) -> Self {
        self.host = host.to_string();
        self
    }

    pub fn port(mut self, port: u16) -> Self {
        self.port = port;
        self
    }

    pub fn user(mut self, user: &str) -> Self {
        self.user = user.to_string();
        self
    }

    pub fn password(mut self, password: &str) -> Self {
        self.password = password.to_string();
        self
    }

    pub fn database(mut self, database: &str) -> Self {
        self.database = database.to_string();
        self
    }

    /// Address string for TCP connection.
    pub fn address(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }
}

/// Parse a connection URI into a Config.
///
/// Supported formats:
/// - `sixseven://user:pass@host:port/database`
/// - `postgresql://user:pass@host:port/database`
/// - `postgres://user:pass@host:port/database`
/// - `host=localhost port=6767 user=sixseven database=mydb`
pub fn parse_dsn(dsn: &str) -> Result<Config> {
    let trimmed = dsn.trim();

    if trimmed.contains("://") {
        parse_uri(trimmed)
    } else {
        parse_key_value(trimmed)
    }
}

fn parse_uri(uri: &str) -> Result<Config> {
    let parsed = url::Url::parse(uri)
        .map_err(|e| Error::InvalidDsn(format!("invalid URI: {e}")))?;

    let scheme = parsed.scheme();
    if !matches!(scheme, "sixseven" | "postgresql" | "postgres") {
        return Err(Error::InvalidDsn(format!("unsupported scheme: {scheme}")));
    }

    let mut cfg = Config::default();

    if !parsed.username().is_empty() {
        cfg.user = parsed.username().to_string();
    }
    if let Some(password) = parsed.password() {
        cfg.password = password.to_string();
    }
    if let Some(host) = parsed.host_str() {
        if !host.is_empty() {
            cfg.host = host.to_string();
        }
    }
    if let Some(port) = parsed.port() {
        cfg.port = port;
    }
    let path = parsed.path().trim_start_matches('/');
    if !path.is_empty() {
        cfg.database = path.to_string();
    }

    Ok(cfg)
}

fn parse_key_value(s: &str) -> Result<Config> {
    let mut cfg = Config::default();

    for part in s.split_whitespace() {
        let (key, value) = part
            .split_once('=')
            .ok_or_else(|| Error::InvalidDsn(format!("invalid key=value pair: {part}")))?;

        match key {
            "host" => cfg.host = value.to_string(),
            "port" => cfg.port = value.parse().map_err(|e| Error::InvalidDsn(format!("invalid port: {e}")))?,
            "user" => cfg.user = value.to_string(),
            "password" => cfg.password = value.to_string(),
            "database" | "dbname" => cfg.database = value.to_string(),
            _ => {} // ignore unknown keys
        }
    }

    Ok(cfg)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_config() {
        let cfg = Config::default();
        assert_eq!(cfg.host, "localhost");
        assert_eq!(cfg.port, 6767);
        assert_eq!(cfg.user, "sixseven");
        assert_eq!(cfg.password, "");
        assert_eq!(cfg.database, "sixseven");
    }

    #[test]
    fn test_config_builder() {
        let cfg = Config::new()
            .host("myhost")
            .port(5432)
            .user("myuser")
            .password("mypass")
            .database("mydb");
        assert_eq!(cfg.host, "myhost");
        assert_eq!(cfg.port, 5432);
        assert_eq!(cfg.user, "myuser");
        assert_eq!(cfg.password, "mypass");
        assert_eq!(cfg.database, "mydb");
    }

    #[test]
    fn test_config_address() {
        let cfg = Config::new().host("example.com").port(6767);
        assert_eq!(cfg.address(), "example.com:6767");
    }

    #[test]
    fn test_parse_sixseven_uri() {
        let cfg = parse_dsn("sixseven://admin:secret@db.example.com:6767/mydb").unwrap();
        assert_eq!(cfg.host, "db.example.com");
        assert_eq!(cfg.port, 6767);
        assert_eq!(cfg.user, "admin");
        assert_eq!(cfg.password, "secret");
        assert_eq!(cfg.database, "mydb");
    }

    #[test]
    fn test_parse_postgresql_uri() {
        let cfg = parse_dsn("postgresql://user:pass@localhost:5432/testdb").unwrap();
        assert_eq!(cfg.host, "localhost");
        assert_eq!(cfg.port, 5432);
        assert_eq!(cfg.user, "user");
        assert_eq!(cfg.password, "pass");
        assert_eq!(cfg.database, "testdb");
    }

    #[test]
    fn test_parse_postgres_uri() {
        let cfg = parse_dsn("postgres://user@localhost/mydb").unwrap();
        assert_eq!(cfg.user, "user");
        assert_eq!(cfg.database, "mydb");
    }

    #[test]
    fn test_parse_uri_defaults() {
        let cfg = parse_dsn("sixseven://localhost").unwrap();
        assert_eq!(cfg.host, "localhost");
        assert_eq!(cfg.port, 6767);
        assert_eq!(cfg.user, "sixseven");
        assert_eq!(cfg.database, "sixseven");
    }

    #[test]
    fn test_parse_key_value() {
        let cfg = parse_dsn("host=myhost port=5432 user=myuser password=mypass database=mydb").unwrap();
        assert_eq!(cfg.host, "myhost");
        assert_eq!(cfg.port, 5432);
        assert_eq!(cfg.user, "myuser");
        assert_eq!(cfg.password, "mypass");
        assert_eq!(cfg.database, "mydb");
    }

    #[test]
    fn test_parse_key_value_dbname() {
        let cfg = parse_dsn("host=localhost dbname=testdb").unwrap();
        assert_eq!(cfg.database, "testdb");
    }

    #[test]
    fn test_parse_key_value_partial() {
        let cfg = parse_dsn("host=myhost").unwrap();
        assert_eq!(cfg.host, "myhost");
        assert_eq!(cfg.port, 6767); // default
    }

    #[test]
    fn test_parse_invalid_scheme() {
        assert!(parse_dsn("http://localhost").is_err());
    }

    #[test]
    fn test_parse_invalid_key_value() {
        assert!(parse_dsn("hostlocalhost").is_err());
    }

    #[test]
    fn test_parse_invalid_port() {
        assert!(parse_dsn("host=localhost port=notanumber").is_err());
    }
}
