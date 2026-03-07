use crate::query_builders::quote_identifier;

// ── SHOW commands ───────────────────────────────────────────────────

/// Returns the SQL for `SHOW DATABASES`.
pub fn show_databases_sql() -> &'static str {
    "SHOW DATABASES"
}

/// Returns the SQL for `SHOW TABLES`.
pub fn show_tables_sql() -> &'static str {
    "SHOW TABLES"
}

/// Returns the SQL for `SHOW COLUMNS FROM "table"`.
pub fn show_columns_sql(table: &str) -> String {
    format!("SHOW COLUMNS FROM {}", quote_identifier(table))
}

/// Returns the SQL for `SHOW EDGE TYPES`.
pub fn show_edge_types_sql() -> &'static str {
    "SHOW EDGE TYPES"
}

/// Returns the SQL for `SHOW INDEXES`.
pub fn show_indexes_sql() -> &'static str {
    "SHOW INDEXES"
}

/// Returns the SQL for `SHOW EMBEDDINGS`.
pub fn show_embeddings_sql() -> &'static str {
    "SHOW EMBEDDINGS"
}

/// Returns the SQL for `SHOW PROVIDERS`.
pub fn show_providers_sql() -> &'static str {
    "SHOW PROVIDERS"
}

// ── EXPLAIN ─────────────────────────────────────────────────────────

/// Returns the SQL for `EXPLAIN <sql>`.
pub fn explain_sql(sql: &str) -> String {
    format!("EXPLAIN {sql}")
}

/// Returns the SQL for `EXPLAIN ANALYZE <sql>`.
pub fn explain_analyze_sql(sql: &str) -> String {
    format!("EXPLAIN ANALYZE {sql}")
}

// ── Edge Type DDL ───────────────────────────────────────────────────

/// Property definition for edge types: (name, type).
pub type EdgeProperty = (String, String);

/// Returns the SQL for `CREATE EDGE TYPE "name" FROM "from" TO "to" [(prop type, ...)]`.
pub fn create_edge_type_sql(
    name: &str,
    from_table: &str,
    to_table: &str,
    properties: &[EdgeProperty],
) -> String {
    let mut sql = format!(
        "CREATE EDGE TYPE {} FROM {} TO {}",
        quote_identifier(name),
        quote_identifier(from_table),
        quote_identifier(to_table),
    );

    if !properties.is_empty() {
        let props: Vec<String> = properties
            .iter()
            .map(|(n, t)| format!("{} {}", quote_identifier(n), t))
            .collect();
        sql.push_str(&format!(" ({})", props.join(", ")));
    }

    sql
}

/// Returns the SQL for `DROP EDGE TYPE [IF EXISTS] "name"`.
pub fn drop_edge_type_sql(name: &str, if_exists: bool) -> String {
    if if_exists {
        format!("DROP EDGE TYPE IF EXISTS {}", quote_identifier(name))
    } else {
        format!("DROP EDGE TYPE {}", quote_identifier(name))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_show_databases() {
        assert_eq!(show_databases_sql(), "SHOW DATABASES");
    }

    #[test]
    fn test_show_tables() {
        assert_eq!(show_tables_sql(), "SHOW TABLES");
    }

    #[test]
    fn test_show_columns() {
        assert_eq!(show_columns_sql("users"), "SHOW COLUMNS FROM \"users\"");
    }

    #[test]
    fn test_show_edge_types() {
        assert_eq!(show_edge_types_sql(), "SHOW EDGE TYPES");
    }

    #[test]
    fn test_show_indexes() {
        assert_eq!(show_indexes_sql(), "SHOW INDEXES");
    }

    #[test]
    fn test_show_embeddings() {
        assert_eq!(show_embeddings_sql(), "SHOW EMBEDDINGS");
    }

    #[test]
    fn test_show_providers() {
        assert_eq!(show_providers_sql(), "SHOW PROVIDERS");
    }

    #[test]
    fn test_explain() {
        assert_eq!(explain_sql("SELECT 1"), "EXPLAIN SELECT 1");
    }

    #[test]
    fn test_explain_analyze() {
        assert_eq!(explain_analyze_sql("SELECT 1"), "EXPLAIN ANALYZE SELECT 1");
    }

    #[test]
    fn test_create_edge_type_no_props() {
        let sql = create_edge_type_sql("follows", "users", "users", &[]);
        assert_eq!(sql, "CREATE EDGE TYPE \"follows\" FROM \"users\" TO \"users\"");
    }

    #[test]
    fn test_create_edge_type_with_props() {
        let props = vec![
            ("weight".to_string(), "FLOAT8".to_string()),
            ("label".to_string(), "TEXT".to_string()),
        ];
        let sql = create_edge_type_sql("follows", "users", "users", &props);
        assert_eq!(
            sql,
            "CREATE EDGE TYPE \"follows\" FROM \"users\" TO \"users\" (\"weight\" FLOAT8, \"label\" TEXT)"
        );
    }

    #[test]
    fn test_drop_edge_type() {
        assert_eq!(drop_edge_type_sql("follows", false), "DROP EDGE TYPE \"follows\"");
    }

    #[test]
    fn test_drop_edge_type_if_exists() {
        assert_eq!(drop_edge_type_sql("follows", true), "DROP EDGE TYPE IF EXISTS \"follows\"");
    }

    #[test]
    fn test_show_columns_special_chars() {
        assert_eq!(show_columns_sql("my table"), "SHOW COLUMNS FROM \"my table\"");
    }

    #[test]
    fn test_create_edge_type_special_chars() {
        let sql = create_edge_type_sql("my edge", "table 1", "table 2", &[]);
        assert_eq!(sql, "CREATE EDGE TYPE \"my edge\" FROM \"table 1\" TO \"table 2\"");
    }
}
