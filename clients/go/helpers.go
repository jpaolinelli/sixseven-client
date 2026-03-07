package sixsevendb

import "fmt"

// SHOW command SQL generators.

// ShowDatabasesSQL returns the SQL for SHOW DATABASES.
func ShowDatabasesSQL() string { return "SHOW DATABASES" }

// ShowTablesSQL returns the SQL for SHOW TABLES.
func ShowTablesSQL() string { return "SHOW TABLES" }

// ShowColumnsSQL returns the SQL for SHOW COLUMNS FROM a table.
func ShowColumnsSQL(table string) string {
	return fmt.Sprintf("SHOW COLUMNS FROM %s", QuoteIdentifier(table))
}

// ShowEdgeTypesSQL returns the SQL for SHOW EDGE TYPES.
func ShowEdgeTypesSQL() string { return "SHOW EDGE TYPES" }

// ShowIndexesSQL returns the SQL for SHOW INDEXES.
func ShowIndexesSQL() string { return "SHOW INDEXES" }

// ShowEmbeddingsSQL returns the SQL for SHOW EMBEDDINGS.
func ShowEmbeddingsSQL() string { return "SHOW EMBEDDINGS" }

// ShowProvidersSQL returns the SQL for SHOW PROVIDERS.
func ShowProvidersSQL() string { return "SHOW PROVIDERS" }

// EXPLAIN helpers.

// ExplainSQL returns the SQL for EXPLAIN.
func ExplainSQL(sql string) string {
	return fmt.Sprintf("EXPLAIN %s", sql)
}

// ExplainAnalyzeSQL returns the SQL for EXPLAIN ANALYZE.
func ExplainAnalyzeSQL(sql string) string {
	return fmt.Sprintf("EXPLAIN ANALYZE %s", sql)
}

// Edge type DDL helpers.

// CreateEdgeTypeSQL generates a CREATE EDGE TYPE statement.
func CreateEdgeTypeSQL(name, fromTable, toTable string, properties map[string]string) string {
	sql := fmt.Sprintf("CREATE EDGE TYPE %s FROM %s TO %s",
		QuoteIdentifier(name), QuoteIdentifier(fromTable), QuoteIdentifier(toTable))
	if len(properties) > 0 {
		var parts []string
		for k, v := range properties {
			parts = append(parts, fmt.Sprintf("%s %s", QuoteIdentifier(k), v))
		}
		sql += fmt.Sprintf(" (%s)", joinStrings(parts, ", "))
	}
	return sql
}

// DropEdgeTypeSQL generates a DROP EDGE TYPE statement.
func DropEdgeTypeSQL(name string, ifExists bool) string {
	ie := ""
	if ifExists {
		ie = " IF EXISTS"
	}
	return fmt.Sprintf("DROP EDGE TYPE%s %s", ie, QuoteIdentifier(name))
}

func joinStrings(parts []string, sep string) string {
	if len(parts) == 0 {
		return ""
	}
	result := parts[0]
	for _, p := range parts[1:] {
		result += sep + p
	}
	return result
}
