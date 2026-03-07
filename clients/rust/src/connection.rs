use std::collections::HashMap;

use tokio::net::TcpStream;

use crate::config::Config;
use crate::error::{Error, Result};
use crate::protocol::*;
use crate::types::{self, Value};

/// A raw connection to a SixSevenDB server.
pub struct Connection {
    stream: TcpStream,
    closed: bool,
    /// Server parameters received during startup (e.g., "server_version").
    pub parameters: HashMap<String, String>,
    /// Backend process ID.
    pub pid: u32,
    /// Cancel secret key.
    pub secret_key: u32,
}

/// Query result from executing a statement.
#[derive(Debug)]
pub struct QueryResult {
    /// Column descriptions.
    pub fields: Vec<FieldDescription>,
    /// Rows of data (each row is a vector of optional byte vectors).
    pub rows: Vec<Vec<Option<Vec<u8>>>>,
    /// Command completion tag (e.g., "SELECT 5").
    pub command_tag: String,
}

impl QueryResult {
    /// Number of rows affected (parsed from command tag).
    pub fn rows_affected(&self) -> u64 {
        parse_row_count(&self.command_tag)
    }

    /// Parse all rows into typed Values.
    pub fn typed_rows(&self) -> Vec<Vec<Value>> {
        self.rows
            .iter()
            .map(|row| {
                row.iter()
                    .enumerate()
                    .map(|(i, col)| {
                        match col {
                            None => Value::Null,
                            Some(bytes) => {
                                let text = String::from_utf8_lossy(bytes);
                                let oid = self.fields.get(i).map(|f| f.type_oid).unwrap_or(0);
                                types::parse_value(oid, &text).unwrap_or(Value::Text(text.into_owned()))
                            }
                        }
                    })
                    .collect()
            })
            .collect()
    }
}

impl Connection {
    /// Connect to a SixSevenDB server using the given config.
    pub async fn connect(cfg: &Config) -> Result<Self> {
        let stream = TcpStream::connect(cfg.address()).await?;
        let mut conn = Connection {
            stream,
            closed: false,
            parameters: HashMap::new(),
            pid: 0,
            secret_key: 0,
        };

        conn.startup(cfg).await?;
        Ok(conn)
    }

    /// Connect using a DSN string.
    pub async fn connect_dsn(dsn: &str) -> Result<Self> {
        let cfg = crate::config::parse_dsn(dsn)?;
        Self::connect(&cfg).await
    }

    /// Send startup message and handle handshake.
    async fn startup(&mut self, cfg: &Config) -> Result<()> {
        let msg = build_startup_message(&cfg.user, &cfg.database);
        self.stream.try_write(&msg).map_err(Error::Io)?;
        // Flush after writing startup message
        tokio::io::AsyncWriteExt::flush(&mut self.stream).await?;
        self.handle_startup(cfg).await
    }

    /// Handle the startup handshake messages until ReadyForQuery.
    async fn handle_startup(&mut self, cfg: &Config) -> Result<()> {
        loop {
            let msg = read_message(&mut self.stream).await?;
            match msg.msg_type {
                MSG_AUTH => {
                    if msg.payload.len() < 4 {
                        return Err(Error::Protocol("auth payload too short".into()));
                    }
                    let auth_type = u32::from_be_bytes([
                        msg.payload[0], msg.payload[1], msg.payload[2], msg.payload[3],
                    ]);
                    if auth_type == AUTH_OK {
                        continue;
                    }
                    crate::auth::handle_auth(
                        &mut self.stream,
                        auth_type,
                        &msg.payload,
                        &cfg.user,
                        &cfg.password,
                    )
                    .await?;
                }
                MSG_PARAMETER_STATUS => {
                    let (key, next) = parse_cstring(&msg.payload, 0);
                    let (value, _) = parse_cstring(&msg.payload, next);
                    self.parameters.insert(key, value);
                }
                MSG_BACKEND_KEY_DATA => {
                    if msg.payload.len() >= 8 {
                        self.pid = u32::from_be_bytes([
                            msg.payload[0], msg.payload[1], msg.payload[2], msg.payload[3],
                        ]);
                        self.secret_key = u32::from_be_bytes([
                            msg.payload[4], msg.payload[5], msg.payload[6], msg.payload[7],
                        ]);
                    }
                }
                MSG_READY_FOR_QUERY => {
                    return Ok(());
                }
                MSG_ERROR_RESPONSE => {
                    let err = parse_error_fields(&msg.payload);
                    return Err(err.into());
                }
                MSG_NOTICE_RESPONSE => {
                    // Ignored
                }
                _ => {
                    tracing::debug!("ignoring startup message type: {}", msg.msg_type as char);
                }
            }
        }
    }

    /// Execute a simple query (no parameters).
    pub async fn simple_query(&mut self, sql: &str) -> Result<QueryResult> {
        self.check_closed()?;

        let payload = build_query_message(sql);
        write_message(&mut self.stream, b'Q', &payload).await?;

        self.read_query_result().await
    }

    /// Execute a parameterized query using the extended protocol.
    pub async fn query(&mut self, sql: &str, params: &[Value]) -> Result<QueryResult> {
        self.check_closed()?;

        if params.is_empty() {
            return self.simple_query(sql).await;
        }

        // Convert params to text format
        let text_params: Vec<Option<String>> = params
            .iter()
            .map(types::format_value)
            .collect();

        // Send Parse + Bind + Describe + Execute + Sync
        let parse = build_parse_message(sql, "");
        write_message(&mut self.stream, b'P', &parse).await?;

        let bind = build_bind_message(&text_params, "", "");
        write_message(&mut self.stream, b'B', &bind).await?;

        let describe = build_describe_message(b'P', "");
        write_message(&mut self.stream, b'D', &describe).await?;

        let execute = build_execute_message("", 0);
        write_message(&mut self.stream, b'E', &execute).await?;

        let sync = build_sync_message();
        write_message(&mut self.stream, b'S', &sync).await?;

        self.read_extended_result().await
    }

    /// Execute a statement and return only the number of rows affected.
    pub async fn execute(&mut self, sql: &str, params: &[Value]) -> Result<u64> {
        let result = self.query(sql, params).await?;
        Ok(result.rows_affected())
    }

    /// Ping the server with SELECT 1.
    pub async fn ping(&mut self) -> Result<()> {
        self.simple_query("SELECT 1").await?;
        Ok(())
    }

    /// Close the connection.
    pub async fn close(&mut self) -> Result<()> {
        if self.closed {
            return Ok(());
        }
        let payload = build_terminate_message();
        let _ = write_message(&mut self.stream, b'X', &payload).await;
        self.closed = true;
        Ok(())
    }

    /// Check if the connection is closed.
    pub fn is_closed(&self) -> bool {
        self.closed
    }

    fn check_closed(&self) -> Result<()> {
        if self.closed {
            Err(Error::Closed)
        } else {
            Ok(())
        }
    }

    /// Read result from a simple query.
    async fn read_query_result(&mut self) -> Result<QueryResult> {
        let mut fields = Vec::new();
        let mut rows = Vec::new();
        let mut command_tag = String::new();

        loop {
            let msg = read_message(&mut self.stream).await?;
            match msg.msg_type {
                MSG_ROW_DESCRIPTION => {
                    fields = parse_row_description(&msg.payload);
                }
                MSG_DATA_ROW => {
                    rows.push(parse_data_row(&msg.payload));
                }
                MSG_COMMAND_COMPLETE => {
                    let (tag, _) = parse_cstring(&msg.payload, 0);
                    command_tag = tag;
                }
                MSG_EMPTY_QUERY => {}
                MSG_ERROR_RESPONSE => {
                    let err = parse_error_fields(&msg.payload);
                    // Drain until ReadyForQuery
                    self.wait_for_ready().await?;
                    return Err(err.into());
                }
                MSG_NOTICE_RESPONSE => {}
                MSG_READY_FOR_QUERY => {
                    return Ok(QueryResult { fields, rows, command_tag });
                }
                _ => {
                    tracing::debug!("ignoring message type in query: {}", msg.msg_type as char);
                }
            }
        }
    }

    /// Read result from an extended protocol query.
    async fn read_extended_result(&mut self) -> Result<QueryResult> {
        let mut fields = Vec::new();
        let mut rows = Vec::new();
        let mut command_tag = String::new();

        loop {
            let msg = read_message(&mut self.stream).await?;
            match msg.msg_type {
                MSG_PARSE_COMPLETE | MSG_BIND_COMPLETE | MSG_NO_DATA => {}
                MSG_ROW_DESCRIPTION => {
                    fields = parse_row_description(&msg.payload);
                }
                MSG_DATA_ROW => {
                    rows.push(parse_data_row(&msg.payload));
                }
                MSG_COMMAND_COMPLETE => {
                    let (tag, _) = parse_cstring(&msg.payload, 0);
                    command_tag = tag;
                }
                MSG_EMPTY_QUERY => {}
                MSG_ERROR_RESPONSE => {
                    let err = parse_error_fields(&msg.payload);
                    self.wait_for_ready().await?;
                    return Err(err.into());
                }
                MSG_NOTICE_RESPONSE => {}
                MSG_READY_FOR_QUERY => {
                    return Ok(QueryResult { fields, rows, command_tag });
                }
                _ => {
                    tracing::debug!("ignoring extended message type: {}", msg.msg_type as char);
                }
            }
        }
    }

    /// Drain messages until ReadyForQuery.
    async fn wait_for_ready(&mut self) -> Result<()> {
        loop {
            let msg = read_message(&mut self.stream).await?;
            if msg.msg_type == MSG_READY_FOR_QUERY {
                return Ok(());
            }
        }
    }

}

impl Drop for Connection {
    fn drop(&mut self) {
        if !self.closed {
            self.closed = true;
            // Best-effort close; async close isn't possible in Drop
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_query_result_rows_affected() {
        let result = QueryResult {
            fields: vec![],
            rows: vec![],
            command_tag: "INSERT 0 5".to_string(),
        };
        assert_eq!(result.rows_affected(), 5);

        let result2 = QueryResult {
            fields: vec![],
            rows: vec![],
            command_tag: "DELETE 3".to_string(),
        };
        assert_eq!(result2.rows_affected(), 3);
    }

    #[test]
    fn test_query_result_typed_rows() {
        let result = QueryResult {
            fields: vec![
                FieldDescription {
                    name: "id".into(),
                    table_oid: 0,
                    column_index: 0,
                    type_oid: 23, // INT4
                    type_size: 4,
                    type_modifier: -1,
                    format_code: 0,
                },
                FieldDescription {
                    name: "name".into(),
                    table_oid: 0,
                    column_index: 1,
                    type_oid: 25, // TEXT
                    type_size: -1,
                    type_modifier: -1,
                    format_code: 0,
                },
            ],
            rows: vec![
                vec![Some(b"42".to_vec()), Some(b"Alice".to_vec())],
                vec![Some(b"7".to_vec()), None],
            ],
            command_tag: "SELECT 2".to_string(),
        };

        let typed = result.typed_rows();
        assert_eq!(typed.len(), 2);
        assert_eq!(typed[0][0], Value::Int4(42));
        assert_eq!(typed[0][1], Value::Text("Alice".into()));
        assert_eq!(typed[1][0], Value::Int4(7));
        assert_eq!(typed[1][1], Value::Null);
    }
}
