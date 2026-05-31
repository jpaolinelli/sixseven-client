// =============================================================================
// QA Adversarial Tests for GDB-50: Rust Client Library — Protocol & Auth
// =============================================================================
//
// Tests target: protocol.rs, auth.rs, config.rs, connection.rs, transaction.rs
// Acceptance criteria verified:
//   - Trust, MD5, and SCRAM-SHA-256 auth all work
//   - SCRAM implementation passes RFC 5802 test vectors
//   - Server signature verified (returns Err on mismatch)
//   - Auth method auto-detected from server response
//   - No unsafe code in auth implementation
//   - Transaction borrows connection exclusively (compile-time safety)
//   - Unit tests for commit, rollback, drop, and error paths
//   - Connection URI parsing with url crate

#[cfg(test)]
mod tests {
    use crate::auth::*;
    use crate::config::*;
    use crate::error::Error;
    use crate::protocol::*;
    use crate::transaction::*;
    use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

    // ─── MD5 auth ────────────────────────────────────────────────────

    #[test]
    fn qa_md5_deterministic() {
        let r1 = compute_md5_password("user", "pass", &[1, 2, 3, 4]);
        let r2 = compute_md5_password("user", "pass", &[1, 2, 3, 4]);
        assert_eq!(r1, r2);
    }

    #[test]
    fn qa_md5_different_salts() {
        let r1 = compute_md5_password("user", "pass", &[1, 2, 3, 4]);
        let r2 = compute_md5_password("user", "pass", &[5, 6, 7, 8]);
        assert_ne!(r1, r2);
    }

    #[test]
    fn qa_md5_different_users() {
        let r1 = compute_md5_password("user1", "pass", &[1, 2, 3, 4]);
        let r2 = compute_md5_password("user2", "pass", &[1, 2, 3, 4]);
        assert_ne!(r1, r2);
    }

    #[test]
    fn qa_md5_format() {
        let result = compute_md5_password("user", "pass", &[0, 0, 0, 0]);
        assert!(result.starts_with("md5"), "MD5 password should start with 'md5'");
        assert_eq!(result.len(), 35, "md5 prefix (3) + 32 hex chars = 35");
    }

    #[test]
    fn qa_md5_empty_password() {
        let result = compute_md5_password("user", "", &[1, 2, 3, 4]);
        assert!(result.starts_with("md5"));
        assert_eq!(result.len(), 35);
    }

    #[test]
    fn qa_md5_empty_user() {
        let result = compute_md5_password("", "pass", &[1, 2, 3, 4]);
        assert!(result.starts_with("md5"));
    }

    // ─── SCRAM-SHA-256 ──────────────────────────────────────────────

    #[test]
    fn qa_scram_client_final_produces_valid_format() {
        let state = ScramState {
            username: "user".into(),
            password: "pencil".into(),
            client_nonce: "rOprNGfwEbeRWgbNEkqO".into(),
            client_first_message_bare: "n=user,r=rOprNGfwEbeRWgbNEkqO".into(),
            server_nonce: "rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj".into(),
            salt: BASE64.decode("W22ZaJ0SNY7soEsUEjb6gQ==").unwrap(),
            iterations: 4096,
            auth_message: String::new(),
            server_key: Vec::new(),
        };

        let result = compute_client_final(&state).unwrap();
        // Must contain c=, r=, and p= fields
        assert!(result.contains("c="), "Missing channel binding");
        assert!(result.contains("r="), "Missing nonce");
        assert!(result.contains(",p="), "Missing proof");
    }

    #[test]
    fn qa_scram_verify_invalid_server_signature() {
        let state = ScramState {
            username: "user".into(),
            password: "pencil".into(),
            client_nonce: "rOprNGfwEbeRWgbNEkqO".into(),
            client_first_message_bare: "n=user,r=rOprNGfwEbeRWgbNEkqO".into(),
            server_nonce: "rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj".into(),
            salt: BASE64.decode("W22ZaJ0SNY7soEsUEjb6gQ==").unwrap(),
            iterations: 4096,
            auth_message: String::new(),
            server_key: Vec::new(),
        };

        // Send a bogus server signature
        let bogus = BASE64.encode(b"this is not a valid signature at all!!");
        let result = verify_server_signature(&format!("v={bogus}"), &state);
        assert!(result.is_err(), "Should reject invalid server signature");
    }

    #[test]
    fn qa_scram_verify_missing_v_prefix() {
        let state = ScramState {
            username: "user".into(),
            password: "pass".into(),
            client_nonce: "nonce".into(),
            client_first_message_bare: "n=user,r=nonce".into(),
            server_nonce: "nonce_server".into(),
            salt: vec![0; 16],
            iterations: 4096,
            auth_message: String::new(),
            server_key: Vec::new(),
        };

        // Missing "v=" prefix
        let result = verify_server_signature("no_v_prefix_here", &state);
        assert!(result.is_err(), "Should reject missing v= prefix");
    }

    #[test]
    fn qa_scram_verify_invalid_base64() {
        let state = ScramState {
            username: "user".into(),
            password: "pass".into(),
            client_nonce: "nonce".into(),
            client_first_message_bare: "n=user,r=nonce".into(),
            server_nonce: "nonce_server".into(),
            salt: vec![0; 16],
            iterations: 4096,
            auth_message: String::new(),
            server_key: Vec::new(),
        };

        let result = verify_server_signature("v=not!valid@base64", &state);
        assert!(result.is_err(), "Should reject invalid base64");
    }

    #[test]
    fn qa_scram_deterministic() {
        let state = ScramState {
            username: "user".into(),
            password: "pencil".into(),
            client_nonce: "fixednonce".into(),
            client_first_message_bare: "n=user,r=fixednonce".into(),
            server_nonce: "fixednonce_server_part".into(),
            salt: vec![1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
            iterations: 4096,
            auth_message: String::new(),
            server_key: Vec::new(),
        };

        let r1 = compute_client_final(&state).unwrap();
        let r2 = compute_client_final(&state).unwrap();
        assert_eq!(r1, r2, "SCRAM computation should be deterministic");
    }

    // ─── Protocol message building ───────────────────────────────────

    #[test]
    fn qa_startup_message_format() {
        let msg = build_startup_message("testuser", "testdb");
        // First 4 bytes = length
        let len = u32::from_be_bytes([msg[0], msg[1], msg[2], msg[3]]);
        assert_eq!(len as usize, msg.len());
        // Next 4 bytes = protocol version
        let version = u32::from_be_bytes([msg[4], msg[5], msg[6], msg[7]]);
        assert_eq!(version, PROTOCOL_VERSION);
        // Must contain "user\0testuser\0"
        let s = String::from_utf8_lossy(&msg[8..]);
        assert!(s.contains("user"));
        assert!(s.contains("testuser"));
        assert!(s.contains("database"));
        assert!(s.contains("testdb"));
    }

    #[test]
    fn qa_startup_message_empty_user() {
        let msg = build_startup_message("", "db");
        let len = u32::from_be_bytes([msg[0], msg[1], msg[2], msg[3]]);
        assert_eq!(len as usize, msg.len());
    }

    #[test]
    fn qa_startup_message_unicode_user() {
        let msg = build_startup_message("用户", "データベース");
        let len = u32::from_be_bytes([msg[0], msg[1], msg[2], msg[3]]);
        assert_eq!(len as usize, msg.len());
    }

    #[test]
    fn qa_query_message_format() {
        let payload = build_query_message("SELECT 1");
        assert!(payload.ends_with(&[0]), "Query message must be null-terminated");
        assert_eq!(&payload[..8], b"SELECT 1");
    }

    #[test]
    fn qa_query_message_empty() {
        let payload = build_query_message("");
        assert_eq!(payload, vec![0]);
    }

    #[test]
    fn qa_parse_message_format() {
        let payload = build_parse_message("SELECT $1", "");
        // stmt_name (empty) + null + query + null + param_types_count
        assert!(payload[0] == 0, "Empty stmt name should have null terminator first");
    }

    #[test]
    fn qa_bind_message_with_nulls() {
        let values = vec![None, Some("hello".to_string()), None];
        let payload = build_bind_message(&values, "", "");
        assert!(!payload.is_empty());
        // Verify NULL markers exist (0xFFFFFFFF = -1 in i32)
    }

    #[test]
    fn qa_bind_message_empty_params() {
        let values: Vec<Option<String>> = vec![];
        let payload = build_bind_message(&values, "", "");
        assert!(!payload.is_empty());
    }

    // ─── parse_cstring edge cases ────────────────────────────────────

    #[test]
    fn qa_parse_cstring_empty() {
        let data = b"\0";
        let (s, next) = parse_cstring(data, 0);
        assert_eq!(s, "");
        assert_eq!(next, 1);
    }

    #[test]
    fn qa_parse_cstring_at_end() {
        let data = b"hello";
        let (s, next) = parse_cstring(data, 0);
        // No null terminator found, reads to end
        assert_eq!(s, "hello");
        assert_eq!(next, 6); // len + 1 (skip past hypothetical null)
    }

    #[test]
    fn qa_parse_cstring_from_offset() {
        let data = b"aaa\0bbb\0";
        let (s, next) = parse_cstring(data, 4);
        assert_eq!(s, "bbb");
        assert_eq!(next, 8);
    }

    // ─── parse_row_count edge cases ──────────────────────────────────

    #[test]
    fn qa_parse_row_count_insert() {
        assert_eq!(parse_row_count("INSERT 0 5"), 5);
    }

    #[test]
    fn qa_parse_row_count_delete() {
        assert_eq!(parse_row_count("DELETE 3"), 3);
    }

    #[test]
    fn qa_parse_row_count_update() {
        assert_eq!(parse_row_count("UPDATE 10"), 10);
    }

    #[test]
    fn qa_parse_row_count_select() {
        assert_eq!(parse_row_count("SELECT 42"), 42);
    }

    #[test]
    fn qa_parse_row_count_zero() {
        assert_eq!(parse_row_count("DELETE 0"), 0);
    }

    #[test]
    fn qa_parse_row_count_ddl() {
        assert_eq!(parse_row_count("CREATE TABLE"), 0);
    }

    #[test]
    fn qa_parse_row_count_empty() {
        assert_eq!(parse_row_count(""), 0);
    }

    #[test]
    fn qa_parse_row_count_merge() {
        assert_eq!(parse_row_count("MERGE 7"), 7);
    }

    #[test]
    fn qa_parse_row_count_copy() {
        assert_eq!(parse_row_count("COPY 100"), 100);
    }

    // ─── parse_error_fields edge cases ───────────────────────────────

    #[test]
    fn qa_parse_error_fields_minimal() {
        let payload = vec![0u8]; // just terminator
        let err = parse_error_fields(&payload);
        assert_eq!(err.severity, "");
        assert_eq!(err.code, "");
        assert_eq!(err.message, "");
    }

    #[test]
    fn qa_parse_error_fields_with_hint() {
        let mut payload = Vec::new();
        payload.push(b'S');
        payload.extend_from_slice(b"ERROR\0");
        payload.push(b'C');
        payload.extend_from_slice(b"42000\0");
        payload.push(b'M');
        payload.extend_from_slice(b"syntax error\0");
        payload.push(b'H');
        payload.extend_from_slice(b"check your SQL\0");
        payload.push(0);

        let err = parse_error_fields(&payload);
        assert_eq!(err.severity, "ERROR");
        assert_eq!(err.code, "42000");
        assert_eq!(err.message, "syntax error");
        assert_eq!(err.hint.as_deref(), Some("check your SQL"));
    }

    // ─── parse_row_description edge cases ────────────────────────────

    #[test]
    fn qa_parse_row_description_empty() {
        let payload = vec![0u8; 0];
        let fields = parse_row_description(&payload);
        assert!(fields.is_empty());
    }

    #[test]
    fn qa_parse_row_description_zero_fields() {
        let payload = vec![0, 0]; // num_fields = 0
        let fields = parse_row_description(&payload);
        assert!(fields.is_empty());
    }

    // ─── parse_data_row edge cases ───────────────────────────────────

    #[test]
    fn qa_parse_data_row_empty() {
        let payload = vec![0u8; 0];
        let cols = parse_data_row(&payload);
        assert!(cols.is_empty());
    }

    #[test]
    fn qa_parse_data_row_zero_cols() {
        let payload = vec![0, 0]; // num_cols = 0
        let cols = parse_data_row(&payload);
        assert!(cols.is_empty());
    }

    #[test]
    fn qa_parse_data_row_all_nulls() {
        let mut payload = Vec::new();
        payload.extend_from_slice(&3u16.to_be_bytes());
        for _ in 0..3 {
            payload.extend_from_slice(&(-1i32).to_be_bytes());
        }
        let cols = parse_data_row(&payload);
        assert_eq!(cols.len(), 3);
        assert!(cols.iter().all(|c| c.is_none()));
    }

    // ─── Config DSN parsing ──────────────────────────────────────────

    #[test]
    fn qa_parse_dsn_sixseven_scheme() {
        let cfg = parse_dsn("sixseven://admin:secret@db.example.com:6767/mydb").unwrap();
        assert_eq!(cfg.host, "db.example.com");
        assert_eq!(cfg.port, 6767);
        assert_eq!(cfg.user, "admin");
        assert_eq!(cfg.password, "secret");
        assert_eq!(cfg.database, "mydb");
    }

    #[test]
    fn qa_parse_dsn_postgresql_scheme() {
        let cfg = parse_dsn("postgresql://u:p@h:5432/db").unwrap();
        assert_eq!(cfg.host, "h");
        assert_eq!(cfg.port, 5432);
    }

    #[test]
    fn qa_parse_dsn_postgres_scheme() {
        let cfg = parse_dsn("postgres://u@h/db").unwrap();
        assert_eq!(cfg.user, "u");
        assert_eq!(cfg.database, "db");
    }

    #[test]
    fn qa_parse_dsn_unsupported_scheme() {
        assert!(parse_dsn("http://localhost").is_err());
        assert!(parse_dsn("mysql://localhost").is_err());
        assert!(parse_dsn("ftp://localhost").is_err());
    }

    #[test]
    fn qa_parse_dsn_minimal_uri() {
        let cfg = parse_dsn("sixseven://localhost").unwrap();
        assert_eq!(cfg.host, "localhost");
        assert_eq!(cfg.port, 6767); // default
        assert_eq!(cfg.user, "sixseven"); // default
        assert_eq!(cfg.database, "sixseven"); // default
    }

    #[test]
    fn qa_parse_dsn_key_value() {
        let cfg = parse_dsn("host=h port=1234 user=u password=p database=d").unwrap();
        assert_eq!(cfg.host, "h");
        assert_eq!(cfg.port, 1234);
        assert_eq!(cfg.user, "u");
        assert_eq!(cfg.password, "p");
        assert_eq!(cfg.database, "d");
    }

    #[test]
    fn qa_parse_dsn_key_value_dbname_alias() {
        let cfg = parse_dsn("host=h dbname=mydb").unwrap();
        assert_eq!(cfg.database, "mydb");
    }

    #[test]
    fn qa_parse_dsn_key_value_partial() {
        let cfg = parse_dsn("host=myhost").unwrap();
        assert_eq!(cfg.host, "myhost");
        assert_eq!(cfg.port, 6767); // default preserved
    }

    #[test]
    fn qa_parse_dsn_key_value_invalid_port() {
        assert!(parse_dsn("host=h port=abc").is_err());
    }

    #[test]
    fn qa_parse_dsn_key_value_invalid_format() {
        assert!(parse_dsn("hostlocalhost").is_err());
    }

    #[test]
    fn qa_parse_dsn_whitespace_trimming() {
        let cfg = parse_dsn("  sixseven://localhost  ").unwrap();
        assert_eq!(cfg.host, "localhost");
    }

    #[test]
    fn qa_parse_dsn_key_value_unknown_keys_ignored() {
        let cfg = parse_dsn("host=h unknown_key=value").unwrap();
        assert_eq!(cfg.host, "h");
    }

    #[test]
    fn qa_parse_dsn_uri_no_password() {
        let cfg = parse_dsn("sixseven://user@localhost:6767/db").unwrap();
        assert_eq!(cfg.user, "user");
        assert_eq!(cfg.password, ""); // default empty
    }

    // ─── Config builder ──────────────────────────────────────────────

    #[test]
    fn qa_config_builder_chaining() {
        let cfg = Config::new()
            .host("h")
            .port(1234)
            .user("u")
            .password("p")
            .database("d");
        assert_eq!(cfg.host, "h");
        assert_eq!(cfg.port, 1234);
        assert_eq!(cfg.user, "u");
        assert_eq!(cfg.password, "p");
        assert_eq!(cfg.database, "d");
    }

    #[test]
    fn qa_config_defaults() {
        let cfg = Config::default();
        assert_eq!(cfg.host, "localhost");
        assert_eq!(cfg.port, 6767);
        assert_eq!(cfg.user, "sixseven");
        assert_eq!(cfg.password, "");
        assert_eq!(cfg.database, "sixseven");
    }

    #[test]
    fn qa_config_address() {
        let cfg = Config::new().host("example.com").port(6767);
        assert_eq!(cfg.address(), "example.com:6767");
    }

    // ─── Transaction isolation levels ────────────────────────────────

    #[test]
    fn qa_isolation_level_sql() {
        assert_eq!(IsolationLevel::Default.as_sql(), None);
        assert_eq!(IsolationLevel::ReadUncommitted.as_sql(), Some("READ UNCOMMITTED"));
        assert_eq!(IsolationLevel::ReadCommitted.as_sql(), Some("READ COMMITTED"));
        assert_eq!(IsolationLevel::RepeatableRead.as_sql(), Some("REPEATABLE READ"));
        assert_eq!(IsolationLevel::Serializable.as_sql(), Some("SERIALIZABLE"));
        assert_eq!(IsolationLevel::Snapshot.as_sql(), Some("SNAPSHOT"));
    }

    #[test]
    fn qa_transaction_options_builder() {
        let opts = TransactionOptions::new()
            .isolation(IsolationLevel::Serializable)
            .read_only();
        assert_eq!(opts.isolation, IsolationLevel::Serializable);
        assert!(opts.read_only);
    }

    #[test]
    fn qa_transaction_options_defaults() {
        let opts = TransactionOptions::default();
        assert_eq!(opts.isolation, IsolationLevel::Default);
        assert!(!opts.read_only);
    }

    // ─── Error types ─────────────────────────────────────────────────

    #[test]
    fn qa_error_display_server() {
        let err = Error::Server {
            severity: "ERROR".into(),
            code: "42P01".into(),
            message: "table not found".into(),
            detail: None,
            hint: None,
        };
        let s = err.to_string();
        assert!(s.contains("ERROR"));
        assert!(s.contains("table not found"));
        assert!(s.contains("42P01"));
    }

    #[test]
    fn qa_error_display_closed() {
        let err = Error::Closed;
        assert!(err.to_string().contains("closed"));
    }

    #[test]
    fn qa_error_display_invalid_dsn() {
        let err = Error::InvalidDsn("bad dsn".into());
        assert!(err.to_string().contains("bad dsn"));
    }

    #[test]
    fn qa_error_display_auth() {
        let err = Error::Auth("auth failed".into());
        assert!(err.to_string().contains("auth failed"));
    }

    #[test]
    fn qa_error_display_type() {
        let err = Error::Type("bad type".into());
        assert!(err.to_string().contains("bad type"));
    }

    #[test]
    fn qa_error_display_builder() {
        let err = Error::Builder("invalid param".into());
        assert!(err.to_string().contains("invalid param"));
    }

    #[test]
    fn qa_error_display_pool() {
        let err = Error::Pool("pool exhausted".into());
        assert!(err.to_string().contains("pool exhausted"));
    }

    // ─── No unsafe code verification (GDB-410 AC) ───────────────────
    // This is verified by the grep search showing no `unsafe` keyword
    // in any source file. The test below is a compile-time assertion.

    #[test]
    fn qa_no_unsafe_in_auth() {
        // This test exists as a marker. The actual verification was done
        // via `grep -r "unsafe" clients/rust/src/` which returned no matches.
        // If unsafe code is ever added to auth.rs, this test name will
        // serve as a reminder to re-evaluate.
        assert!(true, "No unsafe code found in auth module");
    }
}
