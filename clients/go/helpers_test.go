package sixsevendb

import (
	"strings"
	"testing"
)

func TestShowDatabasesSQL(t *testing.T) {
	if ShowDatabasesSQL() != "SHOW DATABASES" {
		t.Errorf("got %q", ShowDatabasesSQL())
	}
}

func TestShowTablesSQL(t *testing.T) {
	if ShowTablesSQL() != "SHOW TABLES" {
		t.Errorf("got %q", ShowTablesSQL())
	}
}

func TestShowColumnsSQL(t *testing.T) {
	got := ShowColumnsSQL("users")
	if got != `SHOW COLUMNS FROM "users"` {
		t.Errorf("got %q", got)
	}
}

func TestShowEdgeTypesSQL(t *testing.T) {
	if ShowEdgeTypesSQL() != "SHOW EDGE TYPES" {
		t.Errorf("got %q", ShowEdgeTypesSQL())
	}
}

func TestShowIndexesSQL(t *testing.T) {
	if ShowIndexesSQL() != "SHOW INDEXES" {
		t.Errorf("got %q", ShowIndexesSQL())
	}
}

func TestShowEmbeddingsSQL(t *testing.T) {
	if ShowEmbeddingsSQL() != "SHOW EMBEDDINGS" {
		t.Errorf("got %q", ShowEmbeddingsSQL())
	}
}

func TestShowProvidersSQL(t *testing.T) {
	if ShowProvidersSQL() != "SHOW PROVIDERS" {
		t.Errorf("got %q", ShowProvidersSQL())
	}
}

func TestExplainSQL(t *testing.T) {
	got := ExplainSQL("SELECT * FROM users")
	if got != "EXPLAIN SELECT * FROM users" {
		t.Errorf("got %q", got)
	}
}

func TestExplainAnalyzeSQL(t *testing.T) {
	got := ExplainAnalyzeSQL("SELECT 1")
	if got != "EXPLAIN ANALYZE SELECT 1" {
		t.Errorf("got %q", got)
	}
}

func TestCreateEdgeTypeSQL(t *testing.T) {
	got := CreateEdgeTypeSQL("follows", "users", "users", nil)
	if !strings.Contains(got, "CREATE EDGE TYPE") {
		t.Errorf("should contain CREATE EDGE TYPE, got %q", got)
	}
	if !strings.Contains(got, `"follows"`) {
		t.Errorf("should contain quoted name, got %q", got)
	}
	if !strings.Contains(got, `FROM "users" TO "users"`) {
		t.Errorf("should contain FROM/TO, got %q", got)
	}
}

func TestCreateEdgeTypeSQL_WithProperties(t *testing.T) {
	props := map[string]string{"weight": "FLOAT8", "since": "DATE"}
	got := CreateEdgeTypeSQL("rated", "users", "products", props)
	if !strings.Contains(got, "(") {
		t.Errorf("should contain properties list, got %q", got)
	}
	// At least one property should be present
	if !strings.Contains(got, "FLOAT8") && !strings.Contains(got, "DATE") {
		t.Errorf("should contain property types, got %q", got)
	}
}

func TestDropEdgeTypeSQL(t *testing.T) {
	got := DropEdgeTypeSQL("follows", false)
	if got != `DROP EDGE TYPE "follows"` {
		t.Errorf("got %q", got)
	}
}

func TestDropEdgeTypeSQL_IfExists(t *testing.T) {
	got := DropEdgeTypeSQL("follows", true)
	if got != `DROP EDGE TYPE IF EXISTS "follows"` {
		t.Errorf("got %q", got)
	}
}
