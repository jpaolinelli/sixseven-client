package sixsevendb

import (
	"strings"
	"testing"
)

func TestQuoteIdentifier(t *testing.T) {
	tests := []struct {
		input string
		want  string
	}{
		{"users", `"users"`},
		{"my table", `"my table"`},
		{`has"quote`, `"has""quote"`},
	}
	for _, tt := range tests {
		got := QuoteIdentifier(tt.input)
		if got != tt.want {
			t.Errorf("QuoteIdentifier(%q) = %q, want %q", tt.input, got, tt.want)
		}
	}
}

func TestBuildTraverse(t *testing.T) {
	q, err := BuildTraverse("follows", "users", 42)
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if !strings.Contains(q.Text, "TRAVERSE") {
		t.Errorf("query should contain TRAVERSE, got %q", q.Text)
	}
	if !strings.Contains(q.Text, `"follows"`) {
		t.Errorf("query should contain quoted edge type, got %q", q.Text)
	}
	if !strings.Contains(q.Text, `"users"($1)`) {
		t.Errorf("query should contain quoted table with param, got %q", q.Text)
	}
	if len(q.Values) != 1 || q.Values[0] != 42 {
		t.Errorf("values = %v, want [42]", q.Values)
	}
}

func TestBuildTraverseWithOptions(t *testing.T) {
	q, err := BuildTraverse("follows", "users", "abc",
		WithDirection("OUT"),
		WithMaxDepth(3),
		WithMode("NODES"),
		WithWhere("depth > 1"),
		WithFetch(),
	)
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if !strings.Contains(q.Text, "DIRECTION OUT") {
		t.Errorf("query should contain DIRECTION OUT, got %q", q.Text)
	}
	if !strings.Contains(q.Text, "MAX_DEPTH 3") {
		t.Errorf("query should contain MAX_DEPTH 3, got %q", q.Text)
	}
	if !strings.Contains(q.Text, "MODE NODES") {
		t.Errorf("query should contain MODE NODES, got %q", q.Text)
	}
	if !strings.Contains(q.Text, "WHERE depth > 1") {
		t.Errorf("query should contain WHERE clause, got %q", q.Text)
	}
	if !strings.Contains(q.Text, "FETCH") {
		t.Errorf("query should contain FETCH, got %q", q.Text)
	}
}

func TestBuildTraverseInvalidMaxDepth(t *testing.T) {
	_, err := BuildTraverse("follows", "users", 1, WithMaxDepth(-1))
	if err == nil {
		t.Error("expected error for negative maxDepth")
	}
	if !strings.Contains(err.Error(), "maxDepth") {
		t.Errorf("error should mention maxDepth, got %q", err.Error())
	}
}

func TestBuildNearest(t *testing.T) {
	vec := Embedding{0.1, 0.2, 0.3}
	q, err := BuildNearest("products", "embedding", vec)
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if !strings.Contains(q.Text, "NEAREST 10") {
		t.Errorf("query should default to NEAREST 10, got %q", q.Text)
	}
	if !strings.Contains(q.Text, `"products"."embedding"`) {
		t.Errorf("query should contain quoted table.column, got %q", q.Text)
	}
}

func TestBuildNearestWithOptions(t *testing.T) {
	q, err := BuildNearest("products", "embedding", "[0.1,0.2]",
		WithK(5),
		WithMetric("COSINE"),
		WithNearestWhere("price > 10"),
		WithinTraverse("similar_to"),
	)
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if !strings.Contains(q.Text, "NEAREST 5") {
		t.Errorf("query should contain NEAREST 5, got %q", q.Text)
	}
	if !strings.Contains(q.Text, "USING COSINE") {
		t.Errorf("query should contain USING COSINE, got %q", q.Text)
	}
	if !strings.Contains(q.Text, "WHERE price > 10") {
		t.Errorf("query should contain WHERE clause, got %q", q.Text)
	}
	if !strings.Contains(q.Text, `WITHIN TRAVERSE "similar_to"`) {
		t.Errorf("query should contain WITHIN TRAVERSE, got %q", q.Text)
	}
}

func TestBuildNearestInvalidK(t *testing.T) {
	_, err := BuildNearest("t", "c", "v", WithK(0))
	if err == nil {
		t.Error("expected error for k=0")
	}
	_, err = BuildNearest("t", "c", "v", WithK(-5))
	if err == nil {
		t.Error("expected error for negative k")
	}
}

func TestBuildLink(t *testing.T) {
	q, err := BuildLink("follows", "users", 1, "users", 2, nil)
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if !strings.Contains(q.Text, "LINK") {
		t.Errorf("query should contain LINK, got %q", q.Text)
	}
	if !strings.Contains(q.Text, `"users"($1)`) {
		t.Errorf("query should contain source with param, got %q", q.Text)
	}
	if !strings.Contains(q.Text, `"users"($2)`) {
		t.Errorf("query should contain target with param, got %q", q.Text)
	}
	if !strings.Contains(q.Text, `VIA "follows"`) {
		t.Errorf("query should contain VIA edge, got %q", q.Text)
	}
	if len(q.Values) != 2 {
		t.Errorf("values length = %d, want 2", len(q.Values))
	}
}

func TestBuildLinkWithProperties(t *testing.T) {
	props := LinkProperties{"weight": 0.5, "since": "2024-01-01"}
	q, err := BuildLink("follows", "users", 1, "users", 2, props)
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if !strings.Contains(q.Text, "$3") {
		t.Errorf("query should have property params, got %q", q.Text)
	}
	if len(q.Values) < 3 {
		t.Errorf("values should have at least 3 entries, got %d", len(q.Values))
	}
}

func TestBuildUnlink(t *testing.T) {
	q := BuildUnlink("follows", "users", 1, "users", 2)
	if !strings.Contains(q.Text, "UNLINK") {
		t.Errorf("query should contain UNLINK, got %q", q.Text)
	}
	if !strings.Contains(q.Text, `"users"($1)`) {
		t.Errorf("query should contain source with param, got %q", q.Text)
	}
	if !strings.Contains(q.Text, `FROM "users"($2)`) {
		t.Errorf("query should contain FROM target with param, got %q", q.Text)
	}
	if len(q.Values) != 2 {
		t.Errorf("values length = %d, want 2", len(q.Values))
	}
}

func TestBuildNearestWithStringQuery(t *testing.T) {
	q, err := BuildNearest("products", "embedding", "[0.1,0.2,0.3]")
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if q.Values[0] != "[0.1,0.2,0.3]" {
		t.Errorf("string query vector should be passed through, got %v", q.Values[0])
	}
}

func TestBuildNearestWithFloat32Slice(t *testing.T) {
	vec := []float32{1.0, 2.0, 3.0}
	q, err := BuildNearest("t", "c", vec)
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if !strings.Contains(q.Values[0].(string), "1") {
		t.Errorf("float32 slice should be serialized, got %v", q.Values[0])
	}
}

func TestValidatePositiveInt(t *testing.T) {
	if err := validatePositiveInt(1, "test"); err != nil {
		t.Errorf("1 should be valid: %v", err)
	}
	if err := validatePositiveInt(0, "test"); err == nil {
		t.Error("0 should be invalid")
	}
	if err := validatePositiveInt(-1, "test"); err == nil {
		t.Error("-1 should be invalid")
	}
}
