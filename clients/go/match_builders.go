package sixsevendb

import (
	"fmt"
	"strings"
)

// PatternElement is an interface for elements in a MATCH pattern.
type PatternElement interface {
	patternSQL() string
}

// MatchNode represents a node in a MATCH pattern.
type MatchNode struct {
	Alias string
	Table string
}

func (n MatchNode) patternSQL() string {
	return fmt.Sprintf("(%s:%s)", n.Alias, QuoteIdentifier(n.Table))
}

// MatchEdge represents an edge in a MATCH pattern.
type MatchEdge struct {
	Alias     string
	EdgeType  string
	Direction string // "OUT" (default), "IN", "BOTH"
}

func (e MatchEdge) patternSQL() string {
	edgeRef := fmt.Sprintf("[%s:%s]", e.Alias, QuoteIdentifier(e.EdgeType))
	switch e.Direction {
	case "IN":
		return fmt.Sprintf("<-%s-", edgeRef)
	case "BOTH":
		return fmt.Sprintf("-%s-", edgeRef)
	default: // OUT
		return fmt.Sprintf("-%s->", edgeRef)
	}
}

// MatchOption is a functional option for BuildMatch.
type MatchOption func(*matchOptions)

type matchOptions struct {
	where string
}

// WithMatchWhere adds a WHERE clause to the MATCH query.
func WithMatchWhere(expr string) MatchOption {
	return func(o *matchOptions) { o.where = expr }
}

// BuildMatch builds a MATCH query (Cypher-style graph pattern matching).
// Syntax: MATCH (a:"table")-[r:"edge"]->(b:"table") RETURN a, b [WHERE expr]
func BuildMatch(pattern []PatternElement, returnItems []string, opts ...MatchOption) (*Query, error) {
	if len(pattern) == 0 {
		return nil, fmt.Errorf("MATCH pattern must not be empty")
	}

	options := &matchOptions{}
	for _, opt := range opts {
		opt(options)
	}

	var parts []string
	for _, elem := range pattern {
		parts = append(parts, elem.patternSQL())
	}
	patternStr := strings.Join(parts, "")
	returnStr := strings.Join(returnItems, ", ")

	sql := fmt.Sprintf("MATCH %s RETURN %s", patternStr, returnStr)
	if options.where != "" {
		sql += fmt.Sprintf(" WHERE %s", options.where)
	}

	return &Query{Text: sql, Values: nil}, nil
}

// PathOption is a functional option for BuildShortestPath.
type PathOption func(*pathOptions)

type pathOptions struct {
	direction string
	maxDepth  int
}

// WithPathDirection sets the traversal direction for shortest path.
func WithPathDirection(d string) PathOption {
	return func(o *pathOptions) { o.direction = d }
}

// WithPathMaxDepth sets the maximum depth for shortest path.
func WithPathMaxDepth(n int) PathOption {
	return func(o *pathOptions) { o.maxDepth = n }
}

// BuildShortestPath builds a SHORTEST PATH query.
// Syntax: SHORTEST PATH FROM table($1) TO table($2) VIA edge [DIRECTION d] [MAX_DEPTH n]
func BuildShortestPath(edgeType, fromTable string, fromID interface{}, toTable string, toID interface{}, opts ...PathOption) (*Query, error) {
	options := &pathOptions{}
	for _, opt := range opts {
		opt(options)
	}

	if options.maxDepth != 0 {
		if err := validatePositiveInt(options.maxDepth, "maxDepth"); err != nil {
			return nil, err
		}
	}

	parts := []string{
		fmt.Sprintf("SHORTEST PATH FROM %s($1) TO %s($2) VIA %s",
			QuoteIdentifier(fromTable), QuoteIdentifier(toTable), QuoteIdentifier(edgeType)),
	}
	values := []interface{}{fromID, toID}

	if options.direction != "" {
		parts = append(parts, fmt.Sprintf("DIRECTION %s", options.direction))
	}
	if options.maxDepth > 0 {
		parts = append(parts, fmt.Sprintf("MAX_DEPTH %d", options.maxDepth))
	}

	return &Query{Text: strings.Join(parts, " "), Values: values}, nil
}
