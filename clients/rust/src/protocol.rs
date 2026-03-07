use crate::error::{Error, ServerError};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

/// PostgreSQL v3 protocol version (3 << 16).
pub const PROTOCOL_VERSION: u32 = 196608;

// Backend message types
pub const MSG_AUTH: u8 = b'R';
pub const MSG_PARAMETER_STATUS: u8 = b'S';
pub const MSG_BACKEND_KEY_DATA: u8 = b'K';
pub const MSG_READY_FOR_QUERY: u8 = b'Z';
pub const MSG_ROW_DESCRIPTION: u8 = b'T';
pub const MSG_DATA_ROW: u8 = b'D';
pub const MSG_COMMAND_COMPLETE: u8 = b'C';
pub const MSG_ERROR_RESPONSE: u8 = b'E';
pub const MSG_NOTICE_RESPONSE: u8 = b'N';
pub const MSG_EMPTY_QUERY: u8 = b'I';
pub const MSG_PARSE_COMPLETE: u8 = b'1';
pub const MSG_BIND_COMPLETE: u8 = b'2';
pub const MSG_NO_DATA: u8 = b'n';

// Auth subtypes
pub const AUTH_OK: u32 = 0;
pub const AUTH_CLEARTEXT: u32 = 3;
pub const AUTH_MD5: u32 = 5;
pub const AUTH_SASL: u32 = 10;
pub const AUTH_SASL_CONTINUE: u32 = 11;
pub const AUTH_SASL_FINAL: u32 = 12;

/// Describes a column from a RowDescription message.
#[derive(Debug, Clone)]
pub struct FieldDescription {
    pub name: String,
    pub table_oid: u32,
    pub column_index: u16,
    pub type_oid: u32,
    pub type_size: i16,
    pub type_modifier: i32,
    pub format_code: i16,
}

/// A raw PG protocol message (type byte + payload).
#[derive(Debug)]
pub struct Message {
    pub msg_type: u8,
    pub payload: Vec<u8>,
}

/// Read a single message from the stream.
pub async fn read_message(stream: &mut TcpStream) -> crate::error::Result<Message> {
    let msg_type = stream.read_u8().await?;
    let len = stream.read_u32().await? as usize;
    if len < 4 {
        return Err(Error::Protocol("message length too short".into()));
    }
    let payload_len = len - 4;
    let mut payload = vec![0u8; payload_len];
    if payload_len > 0 {
        stream.read_exact(&mut payload).await?;
    }
    Ok(Message { msg_type, payload })
}

/// Write a tagged message (type byte + length + payload).
pub async fn write_message(stream: &mut TcpStream, msg_type: u8, payload: &[u8]) -> crate::error::Result<()> {
    let len = (payload.len() + 4) as u32;
    stream.write_u8(msg_type).await?;
    stream.write_u32(len).await?;
    if !payload.is_empty() {
        stream.write_all(payload).await?;
    }
    stream.flush().await?;
    Ok(())
}

/// Build the StartupMessage (no type byte, just length + version + params).
pub fn build_startup_message(user: &str, database: &str) -> Vec<u8> {
    let mut buf = Vec::new();
    // Placeholder for length (4 bytes)
    buf.extend_from_slice(&[0u8; 4]);
    buf.extend_from_slice(&PROTOCOL_VERSION.to_be_bytes());
    // user param
    buf.extend_from_slice(b"user\0");
    buf.extend_from_slice(user.as_bytes());
    buf.push(0);
    // database param
    buf.extend_from_slice(b"database\0");
    buf.extend_from_slice(database.as_bytes());
    buf.push(0);
    // terminator
    buf.push(0);
    // Fill in length
    let len = buf.len() as u32;
    buf[0..4].copy_from_slice(&len.to_be_bytes());
    buf
}

/// Build a Query ('Q') message.
pub fn build_query_message(sql: &str) -> Vec<u8> {
    let mut payload = Vec::new();
    payload.extend_from_slice(sql.as_bytes());
    payload.push(0);
    payload
}

/// Build a Parse ('P') message.
pub fn build_parse_message(sql: &str, stmt_name: &str) -> Vec<u8> {
    let mut payload = Vec::new();
    payload.extend_from_slice(stmt_name.as_bytes());
    payload.push(0);
    payload.extend_from_slice(sql.as_bytes());
    payload.push(0);
    // No parameter types
    payload.extend_from_slice(&0u16.to_be_bytes());
    payload
}

/// Build a Bind ('B') message with text-format parameters.
pub fn build_bind_message(values: &[Option<String>], portal: &str, stmt: &str) -> Vec<u8> {
    let mut payload = Vec::new();
    // Portal name
    payload.extend_from_slice(portal.as_bytes());
    payload.push(0);
    // Statement name
    payload.extend_from_slice(stmt.as_bytes());
    payload.push(0);
    // Parameter format codes: 0 = text for all
    payload.extend_from_slice(&1u16.to_be_bytes()); // one format code
    payload.extend_from_slice(&0u16.to_be_bytes()); // text format
    // Parameter values
    let num_params = values.len() as u16;
    payload.extend_from_slice(&num_params.to_be_bytes());
    for val in values {
        match val {
            None => {
                // NULL: length = -1
                payload.extend_from_slice(&(-1i32).to_be_bytes());
            }
            Some(s) => {
                let bytes = s.as_bytes();
                payload.extend_from_slice(&(bytes.len() as i32).to_be_bytes());
                payload.extend_from_slice(bytes);
            }
        }
    }
    // Result format codes: 0 = text for all
    payload.extend_from_slice(&1u16.to_be_bytes());
    payload.extend_from_slice(&0u16.to_be_bytes());
    payload
}

/// Build a Describe ('D') message for a portal.
pub fn build_describe_message(target_type: u8, name: &str) -> Vec<u8> {
    let mut payload = Vec::new();
    payload.push(target_type); // 'S' for statement, 'P' for portal
    payload.extend_from_slice(name.as_bytes());
    payload.push(0);
    payload
}

/// Build an Execute ('E') message.
pub fn build_execute_message(portal: &str, max_rows: u32) -> Vec<u8> {
    let mut payload = Vec::new();
    payload.extend_from_slice(portal.as_bytes());
    payload.push(0);
    payload.extend_from_slice(&max_rows.to_be_bytes());
    payload
}

/// Build a Sync ('S') message (empty payload).
pub fn build_sync_message() -> Vec<u8> {
    Vec::new()
}

/// Build a Terminate ('X') message (empty payload).
pub fn build_terminate_message() -> Vec<u8> {
    Vec::new()
}

/// Build a PasswordMessage ('p').
pub fn build_password_message(password: &str) -> Vec<u8> {
    let mut payload = Vec::new();
    payload.extend_from_slice(password.as_bytes());
    payload.push(0);
    payload
}

/// Build a SASLInitialResponse ('p') message.
pub fn build_sasl_initial_response(mechanism: &str, data: &[u8]) -> Vec<u8> {
    let mut payload = Vec::new();
    payload.extend_from_slice(mechanism.as_bytes());
    payload.push(0);
    payload.extend_from_slice(&(data.len() as i32).to_be_bytes());
    payload.extend_from_slice(data);
    payload
}

/// Build a SASLResponse ('p') message.
pub fn build_sasl_response(data: &[u8]) -> Vec<u8> {
    data.to_vec()
}

/// Parse error fields from an ErrorResponse payload.
pub fn parse_error_fields(payload: &[u8]) -> ServerError {
    let mut severity = String::new();
    let mut code = String::new();
    let mut message = String::new();
    let mut detail = None;
    let mut hint = None;

    let mut pos = 0;
    while pos < payload.len() {
        let field_type = payload[pos];
        pos += 1;
        if field_type == 0 {
            break;
        }
        let (value, next) = parse_cstring(payload, pos);
        pos = next;
        match field_type {
            b'S' => severity = value,
            b'C' => code = value,
            b'M' => message = value,
            b'D' => detail = Some(value),
            b'H' => hint = Some(value),
            _ => {} // ignore other fields
        }
    }

    ServerError { severity, code, message, detail, hint }
}

/// Parse a RowDescription payload into field descriptions.
pub fn parse_row_description(payload: &[u8]) -> Vec<FieldDescription> {
    if payload.len() < 2 {
        return Vec::new();
    }
    let num_fields = u16::from_be_bytes([payload[0], payload[1]]) as usize;
    let mut fields = Vec::with_capacity(num_fields);
    let mut pos = 2;

    for _ in 0..num_fields {
        let (name, next) = parse_cstring(payload, pos);
        pos = next;
        if pos + 18 > payload.len() {
            break;
        }
        let table_oid = u32::from_be_bytes([payload[pos], payload[pos + 1], payload[pos + 2], payload[pos + 3]]);
        pos += 4;
        let column_index = u16::from_be_bytes([payload[pos], payload[pos + 1]]);
        pos += 2;
        let type_oid = u32::from_be_bytes([payload[pos], payload[pos + 1], payload[pos + 2], payload[pos + 3]]);
        pos += 4;
        let type_size = i16::from_be_bytes([payload[pos], payload[pos + 1]]);
        pos += 2;
        let type_modifier = i32::from_be_bytes([payload[pos], payload[pos + 1], payload[pos + 2], payload[pos + 3]]);
        pos += 4;
        let format_code = i16::from_be_bytes([payload[pos], payload[pos + 1]]);
        pos += 2;

        fields.push(FieldDescription {
            name,
            table_oid,
            column_index,
            type_oid,
            type_size,
            type_modifier,
            format_code,
        });
    }

    fields
}

/// Parse a DataRow payload into column values (None = NULL).
pub fn parse_data_row(payload: &[u8]) -> Vec<Option<Vec<u8>>> {
    if payload.len() < 2 {
        return Vec::new();
    }
    let num_cols = u16::from_be_bytes([payload[0], payload[1]]) as usize;
    let mut cols = Vec::with_capacity(num_cols);
    let mut pos = 2;

    for _ in 0..num_cols {
        if pos + 4 > payload.len() {
            break;
        }
        let len = i32::from_be_bytes([payload[pos], payload[pos + 1], payload[pos + 2], payload[pos + 3]]);
        pos += 4;
        if len < 0 {
            cols.push(None);
        } else {
            let end = pos + len as usize;
            if end > payload.len() {
                break;
            }
            cols.push(Some(payload[pos..end].to_vec()));
            pos = end;
        }
    }

    cols
}

/// Parse a null-terminated C string from a byte slice.
pub fn parse_cstring(data: &[u8], offset: usize) -> (String, usize) {
    let mut end = offset;
    while end < data.len() && data[end] != 0 {
        end += 1;
    }
    let s = String::from_utf8_lossy(&data[offset..end]).into_owned();
    (s, end + 1) // skip the null terminator
}

/// Parse the command tag from CommandComplete (e.g., "INSERT 0 1" -> 1).
pub fn parse_row_count(tag: &str) -> u64 {
    // Formats: "INSERT oid count", "DELETE count", "UPDATE count", "SELECT count"
    let parts: Vec<&str> = tag.split_whitespace().collect();
    match parts.first().copied() {
        Some("INSERT") => parts.get(2).and_then(|s| s.parse().ok()).unwrap_or(0),
        Some("DELETE" | "UPDATE" | "SELECT" | "MERGE" | "COPY") => {
            parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0)
        }
        _ => 0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_startup_message() {
        let msg = build_startup_message("testuser", "testdb");
        // Should start with length (4 bytes) + protocol version
        let len = u32::from_be_bytes([msg[0], msg[1], msg[2], msg[3]]);
        assert_eq!(len as usize, msg.len());
        let version = u32::from_be_bytes([msg[4], msg[5], msg[6], msg[7]]);
        assert_eq!(version, PROTOCOL_VERSION);
    }

    #[test]
    fn test_build_query_message() {
        let payload = build_query_message("SELECT 1");
        assert_eq!(&payload[..8], b"SELECT 1");
        assert_eq!(payload[8], 0); // null terminator
    }

    #[test]
    fn test_parse_cstring() {
        let data = b"hello\0world\0";
        let (s, next) = parse_cstring(data, 0);
        assert_eq!(s, "hello");
        assert_eq!(next, 6);
        let (s2, next2) = parse_cstring(data, next);
        assert_eq!(s2, "world");
        assert_eq!(next2, 12);
    }

    #[test]
    fn test_parse_row_count() {
        assert_eq!(parse_row_count("INSERT 0 5"), 5);
        assert_eq!(parse_row_count("DELETE 3"), 3);
        assert_eq!(parse_row_count("UPDATE 10"), 10);
        assert_eq!(parse_row_count("SELECT 42"), 42);
        assert_eq!(parse_row_count("CREATE TABLE"), 0);
    }

    #[test]
    fn test_parse_error_fields() {
        // Build a minimal ErrorResponse payload
        let mut payload = Vec::new();
        payload.push(b'S');
        payload.extend_from_slice(b"ERROR\0");
        payload.push(b'C');
        payload.extend_from_slice(b"42P01\0");
        payload.push(b'M');
        payload.extend_from_slice(b"table not found\0");
        payload.push(b'D');
        payload.extend_from_slice(b"some detail\0");
        payload.push(0); // terminator

        let err = parse_error_fields(&payload);
        assert_eq!(err.severity, "ERROR");
        assert_eq!(err.code, "42P01");
        assert_eq!(err.message, "table not found");
        assert_eq!(err.detail.as_deref(), Some("some detail"));
        assert_eq!(err.hint, None);
    }

    #[test]
    fn test_parse_row_description() {
        // Build a RowDescription with 1 field
        let mut payload = Vec::new();
        payload.extend_from_slice(&1u16.to_be_bytes()); // 1 field
        payload.extend_from_slice(b"id\0"); // field name
        payload.extend_from_slice(&0u32.to_be_bytes()); // table OID
        payload.extend_from_slice(&0u16.to_be_bytes()); // column index
        payload.extend_from_slice(&23u32.to_be_bytes()); // type OID (INT4)
        payload.extend_from_slice(&4i16.to_be_bytes()); // type size
        payload.extend_from_slice(&(-1i32).to_be_bytes()); // type modifier
        payload.extend_from_slice(&0i16.to_be_bytes()); // format code (text)

        let fields = parse_row_description(&payload);
        assert_eq!(fields.len(), 1);
        assert_eq!(fields[0].name, "id");
        assert_eq!(fields[0].type_oid, 23);
        assert_eq!(fields[0].type_size, 4);
    }

    #[test]
    fn test_parse_data_row() {
        // Build a DataRow with 2 columns: "hello" and NULL
        let mut payload = Vec::new();
        payload.extend_from_slice(&2u16.to_be_bytes()); // 2 columns
        // Column 1: "hello" (5 bytes)
        payload.extend_from_slice(&5i32.to_be_bytes());
        payload.extend_from_slice(b"hello");
        // Column 2: NULL (-1)
        payload.extend_from_slice(&(-1i32).to_be_bytes());

        let cols = parse_data_row(&payload);
        assert_eq!(cols.len(), 2);
        assert_eq!(cols[0].as_deref(), Some(b"hello".as_slice()));
        assert!(cols[1].is_none());
    }

    #[test]
    fn test_build_bind_message_with_null() {
        let values = vec![Some("test".to_string()), None, Some("42".to_string())];
        let payload = build_bind_message(&values, "", "");
        // Verify it doesn't panic and produces non-empty output
        assert!(!payload.is_empty());
    }

    #[test]
    fn test_build_parse_message() {
        let payload = build_parse_message("SELECT $1", "stmt1");
        // Should contain stmt name, null, query, null, param count
        assert!(payload.starts_with(b"stmt1\0"));
    }
}
