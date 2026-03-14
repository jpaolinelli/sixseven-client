use crate::error::{Error, Result};
use crate::query_builders::{quote_identifier, Query};
use crate::types::Value;

/// Direction for graph edges.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    Out,
    In,
    Both,
}

impl Direction {
    pub fn as_str(&self) -> &str {
        match self {
            Direction::Out => "OUT",
            Direction::In => "IN",
            Direction::Both => "BOTH",
        }
    }
}

/// A pattern element in a MATCH query.
pub trait PatternElement {
    fn pattern_sql(&self) -> String;
}

/// A node in a MATCH pattern: `(alias:"table")`.
#[derive(Debug, Clone)]
pub struct MatchNode {
    pub alias: String,
    pub table: String,
}

impl MatchNode {
    pub fn new(alias: &str, table: &str) -> Self {
        Self { alias: alias.to_string(), table: table.to_string() }
    }
}

impl PatternElement for MatchNode {
    fn pattern_sql(&self) -> String {
        format!("({}:{})", self.alias, quote_identifier(&self.table))
    }
}

/// An edge in a MATCH pattern: `-[alias:"edge"]->`, `<-[alias:"edge"]-`, or `-[alias:"edge"]-`.
#[derive(Debug, Clone)]
pub struct MatchEdge {
    pub alias: String,
    pub edge_type: String,
    pub direction: Direction,
}

impl MatchEdge {
    pub fn new(alias: &str, edge_type: &str, direction: Direction) -> Self {
        Self {
            alias: alias.to_string(),
            edge_type: edge_type.to_string(),
            direction,
        }
    }
}

impl PatternElement for MatchEdge {
    fn pattern_sql(&self) -> String {
        let inner = format!("[{}:{}]", self.alias, quote_identifier(&self.edge_type));
        match self.direction {
            Direction::Out => format!("-{inner}->"),
            Direction::In => format!("<-{inner}-"),
            Direction::Both => format!("-{inner}-"),
        }
    }
}

/// Options for a MATCH query.
#[derive(Debug, Clone, Default)]
pub struct MatchOptions {
    pub where_clause: Option<String>,
}

impl MatchOptions {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn where_clause(mut self, expr: &str) -> Self {
        self.where_clause = Some(expr.to_string());
        self
    }
}

/// Build a MATCH query from pattern elements.
///
/// SQL: `MATCH (a:"table")-[r:"edge"]->(b:"table") RETURN a, b [WHERE expr]`
pub fn build_match(
    pattern: &[&dyn PatternElement],
    return_items: &[&str],
    opts: MatchOptions,
) -> Result<Query> {
    if pattern.is_empty() {
        return Err(Error::Builder("MATCH pattern must not be empty".into()));
    }
    if return_items.is_empty() {
        return Err(Error::Builder("MATCH must have at least one RETURN item".into()));
    }

    let pattern_sql: String = pattern.iter().map(|e| e.pattern_sql()).collect();
    let return_sql = return_items.join(", ");

    let mut sql = format!("MATCH {pattern_sql} RETURN {return_sql}");

    if let Some(ref w) = opts.where_clause {
        sql.push_str(&format!(" WHERE {w}"));
    }

    Ok(Query { text: sql, values: vec![] })
}

/// Options for a SHORTEST PATH query.
#[derive(Debug, Clone, Default)]
pub struct PathOptions {
    pub direction: Option<Direction>,
    pub max_depth: Option<i32>,
}

impl PathOptions {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn direction(mut self, d: Direction) -> Self {
        self.direction = Some(d);
        self
    }

    pub fn max_depth(mut self, n: i32) -> Self {
        self.max_depth = Some(n);
        self
    }
}

/// Build a SHORTEST PATH query.
///
/// SQL: `SHORTEST PATH FROM "table"($1) TO "table"($2) VIA "edge" [DIRECTION d] [MAX_DEPTH n]`
pub fn build_shortest_path(
    edge_type: &str,
    from_table: &str,
    from_id: Value,
    to_table: &str,
    to_id: Value,
    opts: PathOptions,
) -> Result<Query> {
    if let Some(depth) = opts.max_depth {
        if depth <= 0 {
            return Err(Error::Builder(format!("max_depth must be positive, got {depth}")));
        }
    }

    let mut sql = format!(
        "SHORTEST PATH FROM {}($1) TO {}($2) VIA {}",
        quote_identifier(from_table),
        quote_identifier(to_table),
        quote_identifier(edge_type),
    );

    if let Some(d) = opts.direction {
        sql.push_str(&format!(" DIRECTION {}", d.as_str()));
    }
    if let Some(n) = opts.max_depth {
        sql.push_str(&format!(" MAX_DEPTH {n}"));
    }

    Ok(Query { text: sql, values: vec![from_id, to_id] })
}

/// Selector for shortest match queries.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShortestMatchSelector {
    AnyShortest,
    AllShortest,
    ShortestK(u32),
}

/// Options for a shortest match query.
#[derive(Debug, Clone, Default)]
pub struct ShortestMatchOptions {
    pub where_clause: Option<String>,
    pub weight: Option<String>,
}

impl ShortestMatchOptions {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn where_clause(mut self, expr: &str) -> Self {
        self.where_clause = Some(expr.to_string());
        self
    }

    pub fn weight(mut self, expr: &str) -> Self {
        self.weight = Some(expr.to_string());
        self
    }
}

/// Build a SELECT ... FROM MATCH shortest-path query.
///
/// SQL: `SELECT <return> FROM MATCH <selector> <pattern> [WEIGHT expr] [WHERE expr]`
pub fn build_shortest_match(
    pattern: &[&dyn PatternElement],
    return_items: &[&str],
    selector: ShortestMatchSelector,
    opts: ShortestMatchOptions,
) -> Result<Query> {
    if pattern.is_empty() {
        return Err(Error::Builder("MATCH pattern must not be empty".into()));
    }
    if return_items.is_empty() {
        return Err(Error::Builder("must have at least one RETURN item".into()));
    }

    let pattern_sql: String = pattern.iter().map(|e| e.pattern_sql()).collect();
    let return_sql = return_items.join(", ");

    let selector_sql = match selector {
        ShortestMatchSelector::AnyShortest => "ANY SHORTEST".to_string(),
        ShortestMatchSelector::AllShortest => "ALL SHORTEST".to_string(),
        ShortestMatchSelector::ShortestK(k) => {
            if k == 0 {
                return Err(Error::Builder("k must be positive".into()));
            }
            format!("SHORTEST {k}")
        }
    };

    let mut sql = format!("SELECT {return_sql} FROM MATCH {selector_sql} {pattern_sql}");

    if let Some(ref w) = opts.weight {
        sql.push_str(&format!(" WEIGHT {w}"));
    }
    if let Some(ref w) = opts.where_clause {
        sql.push_str(&format!(" WHERE {w}"));
    }

    Ok(Query { text: sql, values: vec![] })
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── Pattern SQL tests ──

    #[test]
    fn test_match_node_pattern() {
        let node = MatchNode::new("a", "users");
        assert_eq!(node.pattern_sql(), "(a:\"users\")");
    }

    #[test]
    fn test_match_edge_out() {
        let edge = MatchEdge::new("r", "follows", Direction::Out);
        assert_eq!(edge.pattern_sql(), "-[r:\"follows\"]->");
    }

    #[test]
    fn test_match_edge_in() {
        let edge = MatchEdge::new("r", "follows", Direction::In);
        assert_eq!(edge.pattern_sql(), "<-[r:\"follows\"]-");
    }

    #[test]
    fn test_match_edge_both() {
        let edge = MatchEdge::new("r", "follows", Direction::Both);
        assert_eq!(edge.pattern_sql(), "-[r:\"follows\"]-");
    }

    // ── MATCH query tests ──

    #[test]
    fn test_build_match_basic() {
        let a = MatchNode::new("a", "users");
        let r = MatchEdge::new("r", "follows", Direction::Out);
        let b = MatchNode::new("b", "users");

        let q = build_match(
            &[&a as &dyn PatternElement, &r, &b],
            &["a", "b"],
            MatchOptions::new(),
        ).unwrap();

        assert_eq!(q.text, "MATCH (a:\"users\")-[r:\"follows\"]->(b:\"users\") RETURN a, b");
        assert!(q.values.is_empty());
    }

    #[test]
    fn test_build_match_with_where() {
        let a = MatchNode::new("a", "users");
        let r = MatchEdge::new("r", "follows", Direction::Out);
        let b = MatchNode::new("b", "users");

        let opts = MatchOptions::new().where_clause("a.age > 21");
        let q = build_match(
            &[&a as &dyn PatternElement, &r, &b],
            &["a", "b", "r"],
            opts,
        ).unwrap();

        assert_eq!(
            q.text,
            "MATCH (a:\"users\")-[r:\"follows\"]->(b:\"users\") RETURN a, b, r WHERE a.age > 21"
        );
    }

    #[test]
    fn test_build_match_empty_pattern() {
        let result = build_match(&[], &["a"], MatchOptions::new());
        assert!(result.is_err());
    }

    #[test]
    fn test_build_match_empty_return() {
        let a = MatchNode::new("a", "users");
        let result = build_match(&[&a as &dyn PatternElement], &[], MatchOptions::new());
        assert!(result.is_err());
    }

    #[test]
    fn test_build_match_complex_pattern() {
        let a = MatchNode::new("a", "users");
        let r1 = MatchEdge::new("r1", "follows", Direction::Out);
        let b = MatchNode::new("b", "users");
        let r2 = MatchEdge::new("r2", "likes", Direction::Out);
        let c = MatchNode::new("c", "posts");

        let q = build_match(
            &[&a as &dyn PatternElement, &r1, &b, &r2, &c],
            &["a", "c"],
            MatchOptions::new(),
        ).unwrap();

        assert!(q.text.starts_with("MATCH (a:\"users\")-[r1:\"follows\"]->(b:\"users\")-[r2:\"likes\"]->(c:\"posts\")"));
    }

    // ── SHORTEST PATH tests ──

    #[test]
    fn test_build_shortest_path_basic() {
        let q = build_shortest_path(
            "follows",
            "users", Value::Int4(1),
            "users", Value::Int4(2),
            PathOptions::new(),
        ).unwrap();

        assert_eq!(
            q.text,
            "SHORTEST PATH FROM \"users\"($1) TO \"users\"($2) VIA \"follows\""
        );
        assert_eq!(q.values.len(), 2);
    }

    #[test]
    fn test_build_shortest_path_with_options() {
        let opts = PathOptions::new()
            .direction(Direction::Out)
            .max_depth(5);
        let q = build_shortest_path(
            "follows",
            "users", Value::Int4(1),
            "users", Value::Int4(2),
            opts,
        ).unwrap();

        assert_eq!(
            q.text,
            "SHORTEST PATH FROM \"users\"($1) TO \"users\"($2) VIA \"follows\" DIRECTION OUT MAX_DEPTH 5"
        );
    }

    #[test]
    fn test_build_shortest_path_invalid_depth() {
        let opts = PathOptions::new().max_depth(0);
        assert!(build_shortest_path(
            "follows", "users", Value::Int4(1), "users", Value::Int4(2), opts
        ).is_err());

        let opts = PathOptions::new().max_depth(-1);
        assert!(build_shortest_path(
            "follows", "users", Value::Int4(1), "users", Value::Int4(2), opts
        ).is_err());
    }

    #[test]
    fn test_build_shortest_path_different_tables() {
        let q = build_shortest_path(
            "links",
            "authors", Value::Int4(1),
            "papers", Value::Int4(2),
            PathOptions::new(),
        ).unwrap();

        assert_eq!(
            q.text,
            "SHORTEST PATH FROM \"authors\"($1) TO \"papers\"($2) VIA \"links\""
        );
    }

    // ── Direction tests ──

    #[test]
    fn test_direction_as_str() {
        assert_eq!(Direction::Out.as_str(), "OUT");
        assert_eq!(Direction::In.as_str(), "IN");
        assert_eq!(Direction::Both.as_str(), "BOTH");
    }
}
