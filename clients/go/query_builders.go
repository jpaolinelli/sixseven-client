package sixsevendb

import (
	"fmt"
	"strings"
)

// Query represents a built query with SQL text and parameter values.
type Query struct {
	Text   string
	Values []interface{}
}

// TraverseOptions configures a TRAVERSE query.
type TraverseOptions struct {
	Direction string // "OUT", "IN", "BOTH"
	MaxDepth  int    // Must be positive if set
	Mode      string // "NODES", "EDGES"
	Where     string
	Fetch     bool
}

// TraverseOption is a functional option for BuildTraverse.
type TraverseOption func(*TraverseOptions)

// WithDirection sets the traversal direction.
func WithDirection(d string) TraverseOption {
	return func(o *TraverseOptions) { o.Direction = d }
}

// WithMaxDepth sets the maximum traversal depth.
func WithMaxDepth(n int) TraverseOption {
	return func(o *TraverseOptions) { o.MaxDepth = n }
}

// WithMode sets the traversal mode (NODES or EDGES).
func WithMode(m string) TraverseOption {
	return func(o *TraverseOptions) { o.Mode = m }
}

// WithWhere adds a WHERE clause to the query.
func WithWhere(expr string) TraverseOption {
	return func(o *TraverseOptions) { o.Where = expr }
}

// WithFetch enables the FETCH clause on traversal.
func WithFetch() TraverseOption {
	return func(o *TraverseOptions) { o.Fetch = true }
}

// BuildTraverse builds a TRAVERSE query.
// Syntax: TRAVERSE edge FROM table($1) [DIRECTION d] [MAX_DEPTH n] [MODE m] [WHERE expr] [FETCH]
func BuildTraverse(edgeType, fromTable string, startID interface{}, opts ...TraverseOption) (*Query, error) {
	options := &TraverseOptions{}
	for _, opt := range opts {
		opt(options)
	}

	if options.MaxDepth != 0 {
		if err := validatePositiveInt(options.MaxDepth, "maxDepth"); err != nil {
			return nil, err
		}
	}

	parts := []string{
		fmt.Sprintf("TRAVERSE %s FROM %s($1)", QuoteIdentifier(edgeType), QuoteIdentifier(fromTable)),
	}
	values := []interface{}{startID}

	if options.Direction != "" {
		parts = append(parts, fmt.Sprintf("DIRECTION %s", options.Direction))
	}
	if options.MaxDepth > 0 {
		parts = append(parts, fmt.Sprintf("MAX_DEPTH %d", options.MaxDepth))
	}
	if options.Mode != "" {
		parts = append(parts, fmt.Sprintf("MODE %s", options.Mode))
	}
	if options.Where != "" {
		parts = append(parts, fmt.Sprintf("WHERE %s", options.Where))
	}
	if options.Fetch {
		parts = append(parts, "FETCH")
	}

	return &Query{Text: strings.Join(parts, " "), Values: values}, nil
}

// NearestOptions configures a NEAREST query.
type NearestOptions struct {
	K              int    // Number of results (default 10, must be positive)
	Metric         string // "COSINE", "L2", "DOT"
	Where          string
	WithinTraverse string // Edge type for graph-scoped vector search
}

// NearestOption is a functional option for BuildNearest.
type NearestOption func(*NearestOptions)

// WithK sets the number of nearest results to return.
func WithK(k int) NearestOption {
	return func(o *NearestOptions) { o.K = k }
}

// WithMetric sets the distance metric.
func WithMetric(m string) NearestOption {
	return func(o *NearestOptions) { o.Metric = m }
}

// WithNearestWhere adds a WHERE clause to the NEAREST query.
func WithNearestWhere(expr string) NearestOption {
	return func(o *NearestOptions) { o.Where = expr }
}

// WithinTraverse scopes the NEAREST query to a graph traversal.
func WithinTraverse(edgeType string) NearestOption {
	return func(o *NearestOptions) { o.WithinTraverse = edgeType }
}

// BuildNearest builds a NEAREST query.
// Syntax: NEAREST k FROM table.column TO $1 [WHERE expr] [USING metric] [WITHIN TRAVERSE edge]
func BuildNearest(table, column string, queryVec interface{}, opts ...NearestOption) (*Query, error) {
	options := &NearestOptions{K: 10}
	for _, opt := range opts {
		opt(options)
	}

	if err := validatePositiveInt(options.K, "k"); err != nil {
		return nil, err
	}

	var queryStr string
	switch v := queryVec.(type) {
	case Embedding:
		queryStr = SerializeEmbedding(v)
	case []float32:
		queryStr = SerializeEmbedding(Embedding(v))
	case string:
		queryStr = v
	default:
		return nil, fmt.Errorf("unsupported query vector type %T", queryVec)
	}

	parts := []string{
		fmt.Sprintf("NEAREST %d FROM %s.%s TO $1", options.K, QuoteIdentifier(table), QuoteIdentifier(column)),
	}
	values := []interface{}{queryStr}

	if options.Where != "" {
		parts = append(parts, fmt.Sprintf("WHERE %s", options.Where))
	}
	if options.Metric != "" {
		parts = append(parts, fmt.Sprintf("USING %s", options.Metric))
	}
	if options.WithinTraverse != "" {
		parts = append(parts, fmt.Sprintf("WITHIN TRAVERSE %s", QuoteIdentifier(options.WithinTraverse)))
	}

	return &Query{Text: strings.Join(parts, " "), Values: values}, nil
}

// LinkProperties represents properties to set on a link.
type LinkProperties map[string]interface{}

// BuildLink builds a LINK query.
// Syntax: LINK source($1) TO target($2) VIA edge [(prop = $3, ...)]
func BuildLink(edgeType, fromTable string, fromID interface{}, toTable string, toID interface{}, properties LinkProperties) (*Query, error) {
	parts := []string{
		fmt.Sprintf("LINK %s($1) TO %s($2) VIA %s",
			QuoteIdentifier(fromTable), QuoteIdentifier(toTable), QuoteIdentifier(edgeType)),
	}
	values := []interface{}{fromID, toID}

	if len(properties) > 0 {
		var propParts []string
		for key, val := range properties {
			idx := len(values) + 1
			propParts = append(propParts, fmt.Sprintf("%s = $%d", QuoteIdentifier(key), idx))
			values = append(values, val)
		}
		parts = append(parts, fmt.Sprintf("(%s)", strings.Join(propParts, ", ")))
	}

	return &Query{Text: strings.Join(parts, " "), Values: values}, nil
}

// BuildUnlink builds an UNLINK query.
// Syntax: UNLINK source($1) FROM target($2) VIA edge
func BuildUnlink(edgeType, fromTable string, fromID interface{}, toTable string, toID interface{}) *Query {
	text := fmt.Sprintf("UNLINK %s($1) FROM %s($2) VIA %s",
		QuoteIdentifier(fromTable), QuoteIdentifier(toTable), QuoteIdentifier(edgeType))
	return &Query{Text: text, Values: []interface{}{fromID, toID}}
}

// QuoteIdentifier escapes a SQL identifier with double quotes.
func QuoteIdentifier(name string) string {
	return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
}

// validatePositiveInt validates that a value is a positive integer.
func validatePositiveInt(value int, name string) error {
	if value <= 0 {
		return fmt.Errorf("%s must be a positive integer, got %d", name, value)
	}
	return nil
}
