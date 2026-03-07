package sixsevendb

import (
	"strings"
	"testing"
)

func TestBuildMatch(t *testing.T) {
	pattern := []PatternElement{
		MatchNode{Alias: "a", Table: "users"},
		MatchEdge{Alias: "r", EdgeType: "follows", Direction: "OUT"},
		MatchNode{Alias: "b", Table: "users"},
	}

	q, err := BuildMatch(pattern, []string{"a", "b"})
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if !strings.Contains(q.Text, "MATCH") {
		t.Errorf("query should contain MATCH, got %q", q.Text)
	}
	if !strings.Contains(q.Text, `(a:"users")`) {
		t.Errorf("query should contain node pattern, got %q", q.Text)
	}
	if !strings.Contains(q.Text, `-[r:"follows"]->`) {
		t.Errorf("query should contain edge pattern, got %q", q.Text)
	}
	if !strings.Contains(q.Text, "RETURN a, b") {
		t.Errorf("query should contain RETURN clause, got %q", q.Text)
	}
}

func TestBuildMatchWithWhere(t *testing.T) {
	pattern := []PatternElement{
		MatchNode{Alias: "a", Table: "users"},
		MatchEdge{Alias: "r", EdgeType: "follows"},
		MatchNode{Alias: "b", Table: "users"},
	}

	q, err := BuildMatch(pattern, []string{"a", "b"}, WithMatchWhere("a.age > 18"))
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if !strings.Contains(q.Text, "WHERE a.age > 18") {
		t.Errorf("query should contain WHERE clause, got %q", q.Text)
	}
}

func TestBuildMatchInDirection(t *testing.T) {
	pattern := []PatternElement{
		MatchNode{Alias: "a", Table: "users"},
		MatchEdge{Alias: "r", EdgeType: "follows", Direction: "IN"},
		MatchNode{Alias: "b", Table: "users"},
	}

	q, err := BuildMatch(pattern, []string{"a"})
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if !strings.Contains(q.Text, `<-[r:"follows"]-`) {
		t.Errorf("IN direction should use <- prefix, got %q", q.Text)
	}
}

func TestBuildMatchBothDirection(t *testing.T) {
	pattern := []PatternElement{
		MatchNode{Alias: "a", Table: "users"},
		MatchEdge{Alias: "r", EdgeType: "knows", Direction: "BOTH"},
		MatchNode{Alias: "b", Table: "users"},
	}

	q, err := BuildMatch(pattern, []string{"a", "b"})
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if !strings.Contains(q.Text, `-[r:"knows"]-`) {
		t.Errorf("BOTH direction should use - prefix/suffix, got %q", q.Text)
	}
	// Should NOT contain arrow
	if strings.Contains(q.Text, "->") || strings.Contains(q.Text, "<-") {
		t.Errorf("BOTH direction should not have arrows, got %q", q.Text)
	}
}

func TestBuildMatchEmptyPattern(t *testing.T) {
	_, err := BuildMatch([]PatternElement{}, []string{"a"})
	if err == nil {
		t.Error("expected error for empty pattern")
	}
}

func TestBuildShortestPath(t *testing.T) {
	q, err := BuildShortestPath("follows", "users", 1, "users", 2)
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if !strings.Contains(q.Text, "SHORTEST PATH") {
		t.Errorf("query should contain SHORTEST PATH, got %q", q.Text)
	}
	if !strings.Contains(q.Text, `FROM "users"($1)`) {
		t.Errorf("query should contain FROM with param, got %q", q.Text)
	}
	if !strings.Contains(q.Text, `TO "users"($2)`) {
		t.Errorf("query should contain TO with param, got %q", q.Text)
	}
	if !strings.Contains(q.Text, `VIA "follows"`) {
		t.Errorf("query should contain VIA edge, got %q", q.Text)
	}
	if len(q.Values) != 2 {
		t.Errorf("values length = %d, want 2", len(q.Values))
	}
}

func TestBuildShortestPathWithOptions(t *testing.T) {
	q, err := BuildShortestPath("follows", "users", 1, "users", 2,
		WithPathDirection("OUT"),
		WithPathMaxDepth(5),
	)
	if err != nil {
		t.Fatalf("error: %v", err)
	}
	if !strings.Contains(q.Text, "DIRECTION OUT") {
		t.Errorf("query should contain DIRECTION OUT, got %q", q.Text)
	}
	if !strings.Contains(q.Text, "MAX_DEPTH 5") {
		t.Errorf("query should contain MAX_DEPTH 5, got %q", q.Text)
	}
}

func TestBuildShortestPathInvalidMaxDepth(t *testing.T) {
	_, err := BuildShortestPath("e", "t1", 1, "t2", 2, WithPathMaxDepth(-1))
	if err == nil {
		t.Error("expected error for negative maxDepth")
	}
}

func TestMatchNodePatternSQL(t *testing.T) {
	n := MatchNode{Alias: "a", Table: "users"}
	got := n.patternSQL()
	if got != `(a:"users")` {
		t.Errorf("MatchNode.patternSQL() = %q, want %q", got, `(a:"users")`)
	}
}

func TestMatchEdgePatternSQL(t *testing.T) {
	tests := []struct {
		direction string
		want      string
	}{
		{"OUT", `-[r:"follows"]->`},
		{"IN", `<-[r:"follows"]-`},
		{"BOTH", `-[r:"follows"]-`},
		{"", `-[r:"follows"]->`}, // default is OUT
	}
	for _, tt := range tests {
		e := MatchEdge{Alias: "r", EdgeType: "follows", Direction: tt.direction}
		got := e.patternSQL()
		if got != tt.want {
			t.Errorf("MatchEdge(direction=%q).patternSQL() = %q, want %q", tt.direction, got, tt.want)
		}
	}
}
