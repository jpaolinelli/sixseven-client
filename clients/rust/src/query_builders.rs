use crate::error::{Error, Result};
use crate::types::{Embedding, Value};

/// A built query with its SQL text and parameter values.
#[derive(Debug, Clone)]
pub struct Query {
    pub text: String,
    pub values: Vec<Value>,
}

/// Double-quote a SQL identifier, escaping internal double quotes.
pub fn quote_identifier(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

fn validate_positive(value: i32, name: &str) -> Result<()> {
    if value <= 0 {
        Err(Error::Builder(format!("{name} must be positive, got {value}")))
    } else {
        Ok(())
    }
}

// ── TRAVERSE ────────────────────────────────────────────────────────

/// Options for the TRAVERSE query builder.
#[derive(Debug, Clone, Default)]
pub struct TraverseOptions {
    pub direction: Option<String>,
    pub max_depth: Option<i32>,
    pub mode: Option<String>,
    pub where_clause: Option<String>,
    pub fetch: bool,
}

impl TraverseOptions {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn direction(mut self, d: &str) -> Self {
        self.direction = Some(d.to_uppercase());
        self
    }

    pub fn max_depth(mut self, n: i32) -> Self {
        self.max_depth = Some(n);
        self
    }

    pub fn mode(mut self, m: &str) -> Self {
        self.mode = Some(m.to_uppercase());
        self
    }

    pub fn where_clause(mut self, expr: &str) -> Self {
        self.where_clause = Some(expr.to_string());
        self
    }

    pub fn fetch(mut self) -> Self {
        self.fetch = true;
        self
    }
}

/// Build a TRAVERSE query.
///
/// SQL: `TRAVERSE "edge" FROM "table"($1) [DIRECTION d] [MAX_DEPTH n] [MODE m] [WHERE expr] [FETCH]`
pub fn build_traverse(
    edge_type: &str,
    from_table: &str,
    start_id: Value,
    opts: TraverseOptions,
) -> Result<Query> {
    if let Some(depth) = opts.max_depth {
        validate_positive(depth, "max_depth")?;
    }

    let mut sql = format!(
        "TRAVERSE {} FROM {}($1)",
        quote_identifier(edge_type),
        quote_identifier(from_table),
    );

    if let Some(ref d) = opts.direction {
        sql.push_str(&format!(" DIRECTION {d}"));
    }
    if let Some(n) = opts.max_depth {
        sql.push_str(&format!(" MAX_DEPTH {n}"));
    }
    if let Some(ref m) = opts.mode {
        sql.push_str(&format!(" MODE {m}"));
    }
    if let Some(ref w) = opts.where_clause {
        sql.push_str(&format!(" WHERE {w}"));
    }
    if opts.fetch {
        sql.push_str(" FETCH");
    }

    Ok(Query { text: sql, values: vec![start_id] })
}

// ── NEAREST (Vector Search) ─────────────────────────────────────────

/// Options for the NEAREST query builder.
#[derive(Debug, Clone)]
pub struct NearestOptions {
    pub k: i32,
    pub metric: Option<String>,
    pub where_clause: Option<String>,
    pub within_traverse: Option<String>,
}

impl Default for NearestOptions {
    fn default() -> Self {
        Self {
            k: 10,
            metric: None,
            where_clause: None,
            within_traverse: None,
        }
    }
}

impl NearestOptions {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn k(mut self, k: i32) -> Self {
        self.k = k;
        self
    }

    pub fn metric(mut self, m: &str) -> Self {
        self.metric = Some(m.to_uppercase());
        self
    }

    pub fn where_clause(mut self, expr: &str) -> Self {
        self.where_clause = Some(expr.to_string());
        self
    }

    pub fn within_traverse(mut self, edge_type: &str) -> Self {
        self.within_traverse = Some(edge_type.to_string());
        self
    }
}

/// Build a NEAREST (vector search) query.
///
/// SQL: `NEAREST k FROM "table"."column" TO $1 [WHERE expr] [USING metric] [WITHIN TRAVERSE "edge"]`
pub fn build_nearest(
    table: &str,
    column: &str,
    query_vec: Embedding,
    opts: NearestOptions,
) -> Result<Query> {
    validate_positive(opts.k, "k")?;

    let vec_str = query_vec.to_string();
    let mut sql = format!(
        "NEAREST {} FROM {}.{} TO $1",
        opts.k,
        quote_identifier(table),
        quote_identifier(column),
    );

    if let Some(ref w) = opts.where_clause {
        sql.push_str(&format!(" WHERE {w}"));
    }
    if let Some(ref m) = opts.metric {
        sql.push_str(&format!(" USING {m}"));
    }
    if let Some(ref edge) = opts.within_traverse {
        sql.push_str(&format!(" WITHIN TRAVERSE {}", quote_identifier(edge)));
    }

    Ok(Query {
        text: sql,
        values: vec![Value::Text(vec_str)],
    })
}

// ── LINK ────────────────────────────────────────────────────────────

/// Properties for a LINK operation.
pub type LinkProperties = Vec<(String, Value)>;

/// Build a LINK query.
///
/// SQL: `LINK "from"($1) TO "to"($2) VIA "edge" [(prop = $3, ...)]`
pub fn build_link(
    edge_type: &str,
    from_table: &str,
    from_id: Value,
    to_table: &str,
    to_id: Value,
    properties: &LinkProperties,
) -> Result<Query> {
    let mut sql = format!(
        "LINK {}($1) TO {}($2) VIA {}",
        quote_identifier(from_table),
        quote_identifier(to_table),
        quote_identifier(edge_type),
    );

    let mut values = vec![from_id, to_id];

    if !properties.is_empty() {
        let prop_strs: Vec<String> = properties
            .iter()
            .enumerate()
            .map(|(i, (name, _))| {
                format!("{} = ${}", quote_identifier(name), i + 3)
            })
            .collect();
        sql.push_str(&format!(" ({})", prop_strs.join(", ")));
        for (_, val) in properties {
            values.push(val.clone());
        }
    }

    Ok(Query { text: sql, values })
}

// ── UNLINK ──────────────────────────────────────────────────────────

/// Build an UNLINK query.
///
/// SQL: `UNLINK "from"($1) FROM "to"($2) VIA "edge"`
pub fn build_unlink(
    edge_type: &str,
    from_table: &str,
    from_id: Value,
    to_table: &str,
    to_id: Value,
) -> Query {
    let sql = format!(
        "UNLINK {}($1) FROM {}($2) VIA {}",
        quote_identifier(from_table),
        quote_identifier(to_table),
        quote_identifier(edge_type),
    );
    Query { text: sql, values: vec![from_id, to_id] }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_quote_identifier() {
        assert_eq!(quote_identifier("users"), "\"users\"");
        assert_eq!(quote_identifier("my table"), "\"my table\"");
        assert_eq!(quote_identifier("he\"llo"), "\"he\"\"llo\"");
    }

    // ── TRAVERSE tests ──

    #[test]
    fn test_build_traverse_basic() {
        let q = build_traverse("follows", "users", Value::Int4(1), TraverseOptions::new()).unwrap();
        assert_eq!(q.text, "TRAVERSE \"follows\" FROM \"users\"($1)");
        assert_eq!(q.values.len(), 1);
    }

    #[test]
    fn test_build_traverse_all_options() {
        let opts = TraverseOptions::new()
            .direction("OUT")
            .max_depth(3)
            .mode("NODES")
            .where_clause("depth < 5")
            .fetch();
        let q = build_traverse("follows", "users", Value::Int4(1), opts).unwrap();
        assert_eq!(
            q.text,
            "TRAVERSE \"follows\" FROM \"users\"($1) DIRECTION OUT MAX_DEPTH 3 MODE NODES WHERE depth < 5 FETCH"
        );
    }

    #[test]
    fn test_build_traverse_invalid_max_depth() {
        let opts = TraverseOptions::new().max_depth(0);
        assert!(build_traverse("follows", "users", Value::Int4(1), opts).is_err());

        let opts = TraverseOptions::new().max_depth(-1);
        assert!(build_traverse("follows", "users", Value::Int4(1), opts).is_err());
    }

    // ── NEAREST tests ──

    #[test]
    fn test_build_nearest_basic() {
        let vec = Embedding::new(vec![0.1, 0.2, 0.3]);
        let q = build_nearest("products", "embedding", vec, NearestOptions::new()).unwrap();
        assert_eq!(q.text, "NEAREST 10 FROM \"products\".\"embedding\" TO $1");
        assert_eq!(q.values.len(), 1);
    }

    #[test]
    fn test_build_nearest_all_options() {
        let vec = Embedding::new(vec![0.1, 0.2]);
        let opts = NearestOptions::new()
            .k(5)
            .metric("COSINE")
            .where_clause("active = true")
            .within_traverse("product_links");
        let q = build_nearest("products", "embedding", vec, opts).unwrap();
        assert_eq!(
            q.text,
            "NEAREST 5 FROM \"products\".\"embedding\" TO $1 WHERE active = true USING COSINE WITHIN TRAVERSE \"product_links\""
        );
    }

    #[test]
    fn test_build_nearest_invalid_k() {
        let vec = Embedding::new(vec![0.1]);
        let opts = NearestOptions::new().k(0);
        assert!(build_nearest("t", "c", vec, opts).is_err());
    }

    // ── LINK tests ──

    #[test]
    fn test_build_link_basic() {
        let q = build_link("follows", "users", Value::Int4(1), "users", Value::Int4(2), &vec![]).unwrap();
        assert_eq!(q.text, "LINK \"users\"($1) TO \"users\"($2) VIA \"follows\"");
        assert_eq!(q.values.len(), 2);
    }

    #[test]
    fn test_build_link_with_properties() {
        let props = vec![
            ("weight".to_string(), Value::Float8(0.5)),
            ("label".to_string(), Value::Text("friend".to_string())),
        ];
        let q = build_link("follows", "users", Value::Int4(1), "users", Value::Int4(2), &props).unwrap();
        assert_eq!(
            q.text,
            "LINK \"users\"($1) TO \"users\"($2) VIA \"follows\" (\"weight\" = $3, \"label\" = $4)"
        );
        assert_eq!(q.values.len(), 4);
    }

    // ── UNLINK tests ──

    #[test]
    fn test_build_unlink() {
        let q = build_unlink("follows", "users", Value::Int4(1), "users", Value::Int4(2));
        assert_eq!(q.text, "UNLINK \"users\"($1) FROM \"users\"($2) VIA \"follows\"");
        assert_eq!(q.values.len(), 2);
    }

    // ── Edge cases ──

    #[test]
    fn test_traverse_with_uuid_start_id() {
        let uid = uuid::Uuid::new_v4();
        let q = build_traverse("likes", "items", Value::Uuid(uid), TraverseOptions::new()).unwrap();
        assert!(q.text.contains("TRAVERSE \"likes\" FROM \"items\"($1)"));
    }

    #[test]
    fn test_link_with_special_characters_in_names() {
        let q = build_link(
            "my edge",
            "my table",
            Value::Int4(1),
            "other table",
            Value::Int4(2),
            &vec![],
        ).unwrap();
        assert_eq!(q.text, "LINK \"my table\"($1) TO \"other table\"($2) VIA \"my edge\"");
    }
}
