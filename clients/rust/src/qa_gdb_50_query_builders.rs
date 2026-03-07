// =============================================================================
// QA Adversarial Tests for GDB-50: Rust Client Library — Query Builders
// =============================================================================
//
// Tests target: query_builders.rs, match_builders.rs, helpers.rs
// Acceptance criteria verified:
//   - GioDB query builders generate correct SQL
//   - Builder pattern follows Rust conventions (fluent, type-safe)
//   - MatchQuery generates correct MATCH syntax
//   - ShortestPathQuery generates correct SQL
//   - NearestQuery supports within_traverse
//   - Invalid inputs return Err(BuilderError) with descriptive message
//   - All identifiers properly escaped

#[cfg(test)]
mod tests {
    use crate::query_builders::*;
    use crate::match_builders::*;
    use crate::helpers::*;
    use crate::types::{Embedding, Value};

    // ─── quote_identifier edge cases ─────────────────────────────────

    #[test]
    fn qa_quote_identifier_empty() {
        assert_eq!(quote_identifier(""), "\"\"");
    }

    #[test]
    fn qa_quote_identifier_with_double_quotes() {
        assert_eq!(quote_identifier("he\"llo"), "\"he\"\"llo\"");
    }

    #[test]
    fn qa_quote_identifier_with_spaces() {
        assert_eq!(quote_identifier("my table"), "\"my table\"");
    }

    #[test]
    fn qa_quote_identifier_sql_keyword() {
        assert_eq!(quote_identifier("SELECT"), "\"SELECT\"");
    }

    #[test]
    fn qa_quote_identifier_unicode() {
        assert_eq!(quote_identifier("tàble_名前"), "\"tàble_名前\"");
    }

    #[test]
    fn qa_quote_identifier_multiple_quotes() {
        assert_eq!(quote_identifier("a\"b\"c"), "\"a\"\"b\"\"c\"");
    }

    // ─── TRAVERSE builder edge cases ─────────────────────────────────

    #[test]
    fn qa_traverse_basic_generates_correct_sql() {
        let q = build_traverse("follows", "users", Value::Int4(1), TraverseOptions::new()).unwrap();
        assert_eq!(q.text, "TRAVERSE \"follows\" FROM \"users\"($1)");
        assert_eq!(q.values, vec![Value::Int4(1)]);
    }

    #[test]
    fn qa_traverse_max_depth_zero_rejected() {
        let opts = TraverseOptions::new().max_depth(0);
        let result = build_traverse("e", "t", Value::Int4(1), opts);
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("positive"), "Error should mention 'positive': {err}");
    }

    #[test]
    fn qa_traverse_max_depth_negative_rejected() {
        let opts = TraverseOptions::new().max_depth(-5);
        assert!(build_traverse("e", "t", Value::Int4(1), opts).is_err());
    }

    #[test]
    fn qa_traverse_max_depth_one_accepted() {
        let opts = TraverseOptions::new().max_depth(1);
        assert!(build_traverse("e", "t", Value::Int4(1), opts).is_ok());
    }

    #[test]
    fn qa_traverse_all_options() {
        let opts = TraverseOptions::new()
            .direction("out")
            .max_depth(10)
            .mode("dfs")
            .where_clause("depth < 5")
            .fetch();
        let q = build_traverse("follows", "users", Value::Int4(1), opts).unwrap();
        assert!(q.text.contains("DIRECTION OUT"));
        assert!(q.text.contains("MAX_DEPTH 10"));
        assert!(q.text.contains("MODE DFS"));
        assert!(q.text.contains("WHERE depth < 5"));
        assert!(q.text.contains("FETCH"));
    }

    #[test]
    fn qa_traverse_direction_uppercased() {
        let opts = TraverseOptions::new().direction("both");
        let q = build_traverse("e", "t", Value::Int4(1), opts).unwrap();
        assert!(q.text.contains("DIRECTION BOTH"));
    }

    #[test]
    fn qa_traverse_with_special_chars_in_names() {
        let q = build_traverse("my edge", "my table", Value::Int4(1), TraverseOptions::new()).unwrap();
        assert!(q.text.contains("\"my edge\""));
        assert!(q.text.contains("\"my table\""));
    }

    // ─── NEAREST builder edge cases ──────────────────────────────────

    #[test]
    fn qa_nearest_k_zero_rejected() {
        let vec = Embedding::new(vec![0.1]);
        let opts = NearestOptions::new().k(0);
        assert!(build_nearest("t", "c", vec, opts).is_err());
    }

    #[test]
    fn qa_nearest_k_negative_rejected() {
        let vec = Embedding::new(vec![0.1]);
        let opts = NearestOptions::new().k(-1);
        assert!(build_nearest("t", "c", vec, opts).is_err());
    }

    #[test]
    fn qa_nearest_default_k_is_10() {
        let vec = Embedding::new(vec![0.1]);
        let q = build_nearest("t", "c", vec, NearestOptions::new()).unwrap();
        assert!(q.text.contains("NEAREST 10"));
    }

    #[test]
    fn qa_nearest_with_within_traverse() {
        let vec = Embedding::new(vec![0.1, 0.2]);
        let opts = NearestOptions::new().within_traverse("links");
        let q = build_nearest("products", "emb", vec, opts).unwrap();
        assert!(q.text.contains("WITHIN TRAVERSE \"links\""));
    }

    #[test]
    fn qa_nearest_all_options() {
        let vec = Embedding::new(vec![0.1]);
        let opts = NearestOptions::new()
            .k(5)
            .metric("cosine")
            .where_clause("active = true")
            .within_traverse("edges");
        let q = build_nearest("t", "c", vec, opts).unwrap();
        assert!(q.text.contains("NEAREST 5"));
        assert!(q.text.contains("USING COSINE"));
        assert!(q.text.contains("WHERE active = true"));
        assert!(q.text.contains("WITHIN TRAVERSE \"edges\""));
    }

    #[test]
    fn qa_nearest_empty_embedding() {
        let vec = Embedding::new(vec![]);
        let q = build_nearest("t", "c", vec, NearestOptions::new()).unwrap();
        // Should still generate valid SQL even with empty vector
        assert!(q.text.contains("NEAREST"));
    }

    // ─── LINK builder edge cases ─────────────────────────────────────

    #[test]
    fn qa_link_basic() {
        let q = build_link("follows", "users", Value::Int4(1), "users", Value::Int4(2), &vec![]).unwrap();
        assert_eq!(q.text, "LINK \"users\"($1) TO \"users\"($2) VIA \"follows\"");
        assert_eq!(q.values.len(), 2);
    }

    #[test]
    fn qa_link_many_properties() {
        let props: Vec<(String, Value)> = (0..10)
            .map(|i| (format!("prop{i}"), Value::Int4(i)))
            .collect();
        let q = build_link("edge", "from", Value::Int4(1), "to", Value::Int4(2), &props).unwrap();
        // Should have $1, $2 for IDs, then $3..$12 for props
        assert_eq!(q.values.len(), 12);
        for i in 0..10 {
            assert!(q.text.contains(&format!("${}", i + 3)));
        }
    }

    #[test]
    fn qa_link_with_null_property() {
        let props = vec![("weight".to_string(), Value::Null)];
        let q = build_link("e", "f", Value::Int4(1), "t", Value::Int4(2), &props).unwrap();
        assert_eq!(q.values.len(), 3);
        assert_eq!(q.values[2], Value::Null);
    }

    // ─── UNLINK builder ──────────────────────────────────────────────

    #[test]
    fn qa_unlink_basic() {
        let q = build_unlink("follows", "users", Value::Int4(1), "users", Value::Int4(2));
        assert_eq!(q.text, "UNLINK \"users\"($1) FROM \"users\"($2) VIA \"follows\"");
        assert_eq!(q.values.len(), 2);
    }

    #[test]
    fn qa_unlink_with_uuid_ids() {
        let u1 = uuid::Uuid::new_v4();
        let u2 = uuid::Uuid::new_v4();
        let q = build_unlink("edge", "t1", Value::Uuid(u1), "t2", Value::Uuid(u2));
        assert_eq!(q.values.len(), 2);
    }

    // ─── MATCH builder edge cases ────────────────────────────────────

    #[test]
    fn qa_match_empty_pattern_rejected() {
        let result = build_match(&[], &["a"], MatchOptions::new());
        assert!(result.is_err());
        let err = result.unwrap_err().to_string();
        assert!(err.contains("empty"), "Error should mention 'empty': {err}");
    }

    #[test]
    fn qa_match_empty_return_rejected() {
        let a = MatchNode::new("a", "users");
        let result = build_match(&[&a as &dyn PatternElement], &[], MatchOptions::new());
        assert!(result.is_err());
    }

    #[test]
    fn qa_match_single_node() {
        let a = MatchNode::new("a", "users");
        let q = build_match(&[&a as &dyn PatternElement], &["a"], MatchOptions::new()).unwrap();
        assert_eq!(q.text, "MATCH (a:\"users\") RETURN a");
    }

    #[test]
    fn qa_match_complex_chain() {
        let a = MatchNode::new("a", "users");
        let r1 = MatchEdge::new("r1", "follows", Direction::Out);
        let b = MatchNode::new("b", "users");
        let r2 = MatchEdge::new("r2", "likes", Direction::In);
        let c = MatchNode::new("c", "posts");
        let r3 = MatchEdge::new("r3", "tags", Direction::Both);
        let d = MatchNode::new("d", "topics");

        let q = build_match(
            &[&a as &dyn PatternElement, &r1, &b, &r2, &c, &r3, &d],
            &["a", "c", "d"],
            MatchOptions::new(),
        ).unwrap();

        assert!(q.text.contains("(a:\"users\")"));
        assert!(q.text.contains("-[r1:\"follows\"]->"));
        assert!(q.text.contains("<-[r2:\"likes\"]-"));
        assert!(q.text.contains("-[r3:\"tags\"]-"));
        assert!(q.text.contains("(d:\"topics\")"));
        assert!(q.text.contains("RETURN a, c, d"));
    }

    #[test]
    fn qa_match_with_where() {
        let a = MatchNode::new("a", "users");
        let opts = MatchOptions::new().where_clause("a.age > 18 AND a.active = true");
        let q = build_match(&[&a as &dyn PatternElement], &["a"], opts).unwrap();
        assert!(q.text.contains("WHERE a.age > 18 AND a.active = true"));
    }

    #[test]
    fn qa_match_no_params() {
        let a = MatchNode::new("a", "users");
        let q = build_match(&[&a as &dyn PatternElement], &["a"], MatchOptions::new()).unwrap();
        assert!(q.values.is_empty(), "MATCH queries should have no params");
    }

    // ─── SHORTEST PATH builder edge cases ────────────────────────────

    #[test]
    fn qa_shortest_path_basic() {
        let q = build_shortest_path(
            "follows", "users", Value::Int4(1), "users", Value::Int4(2),
            PathOptions::new(),
        ).unwrap();
        assert_eq!(q.text, "SHORTEST PATH FROM \"users\"($1) TO \"users\"($2) VIA \"follows\"");
        assert_eq!(q.values.len(), 2);
    }

    #[test]
    fn qa_shortest_path_max_depth_zero_rejected() {
        let opts = PathOptions::new().max_depth(0);
        assert!(build_shortest_path("e", "t", Value::Int4(1), "t", Value::Int4(2), opts).is_err());
    }

    #[test]
    fn qa_shortest_path_max_depth_negative_rejected() {
        let opts = PathOptions::new().max_depth(-1);
        assert!(build_shortest_path("e", "t", Value::Int4(1), "t", Value::Int4(2), opts).is_err());
    }

    #[test]
    fn qa_shortest_path_all_directions() {
        for (dir, expected) in [
            (Direction::Out, "DIRECTION OUT"),
            (Direction::In, "DIRECTION IN"),
            (Direction::Both, "DIRECTION BOTH"),
        ] {
            let opts = PathOptions::new().direction(dir);
            let q = build_shortest_path("e", "t", Value::Int4(1), "t", Value::Int4(2), opts).unwrap();
            assert!(q.text.contains(expected), "Missing {expected} in: {}", q.text);
        }
    }

    #[test]
    fn qa_shortest_path_different_tables() {
        let q = build_shortest_path(
            "cites", "authors", Value::Int4(1), "papers", Value::Int4(2),
            PathOptions::new(),
        ).unwrap();
        assert!(q.text.contains("\"authors\"($1)"));
        assert!(q.text.contains("\"papers\"($2)"));
    }

    // ─── Direction enum ──────────────────────────────────────────────

    #[test]
    fn qa_direction_as_str() {
        assert_eq!(Direction::Out.as_str(), "OUT");
        assert_eq!(Direction::In.as_str(), "IN");
        assert_eq!(Direction::Both.as_str(), "BOTH");
    }

    // ─── SHOW/EXPLAIN helpers ────────────────────────────────────────

    #[test]
    fn qa_show_databases() {
        assert_eq!(show_databases_sql(), "SHOW DATABASES");
    }

    #[test]
    fn qa_show_tables() {
        assert_eq!(show_tables_sql(), "SHOW TABLES");
    }

    #[test]
    fn qa_show_columns_escaping() {
        let sql = show_columns_sql("table with \"quotes\"");
        assert_eq!(sql, "SHOW COLUMNS FROM \"table with \"\"quotes\"\"\"");
    }

    #[test]
    fn qa_show_edge_types() {
        assert_eq!(show_edge_types_sql(), "SHOW EDGE TYPES");
    }

    #[test]
    fn qa_show_indexes() {
        assert_eq!(show_indexes_sql(), "SHOW INDEXES");
    }

    #[test]
    fn qa_show_embeddings() {
        assert_eq!(show_embeddings_sql(), "SHOW EMBEDDINGS");
    }

    #[test]
    fn qa_show_providers() {
        assert_eq!(show_providers_sql(), "SHOW PROVIDERS");
    }

    #[test]
    fn qa_explain() {
        assert_eq!(explain_sql("SELECT * FROM t"), "EXPLAIN SELECT * FROM t");
    }

    #[test]
    fn qa_explain_analyze() {
        assert_eq!(explain_analyze_sql("SELECT 1"), "EXPLAIN ANALYZE SELECT 1");
    }

    // ─── Edge Type DDL ───────────────────────────────────────────────

    #[test]
    fn qa_create_edge_type_no_props() {
        let sql = create_edge_type_sql("follows", "users", "users", &[]);
        assert_eq!(sql, "CREATE EDGE TYPE \"follows\" FROM \"users\" TO \"users\"");
    }

    #[test]
    fn qa_create_edge_type_with_props() {
        let props = vec![
            ("weight".to_string(), "FLOAT8".to_string()),
        ];
        let sql = create_edge_type_sql("e", "t1", "t2", &props);
        assert!(sql.contains("(\"weight\" FLOAT8)"));
    }

    #[test]
    fn qa_create_edge_type_special_chars() {
        let sql = create_edge_type_sql("my edge", "my \"table", "other", &[]);
        assert!(sql.contains("\"my edge\""));
        // quote_identifier("my \"table") → "my ""table"
        assert!(sql.contains("\"my \"\"table\""), "SQL was: {sql}");
    }

    #[test]
    fn qa_drop_edge_type() {
        assert_eq!(drop_edge_type_sql("follows", false), "DROP EDGE TYPE \"follows\"");
    }

    #[test]
    fn qa_drop_edge_type_if_exists() {
        assert_eq!(drop_edge_type_sql("follows", true), "DROP EDGE TYPE IF EXISTS \"follows\"");
    }
}
