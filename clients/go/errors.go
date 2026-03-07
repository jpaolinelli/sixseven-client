package sixsevendb

import "fmt"

// Error represents a server-side error returned by SixSevenDB.
type Error struct {
	Severity string
	Code     string
	Message  string
	Detail   string
	Hint     string
	Position string
}

func (e *Error) Error() string {
	s := fmt.Sprintf("%s: %s", e.Severity, e.Message)
	if e.Code != "" {
		s += fmt.Sprintf(" (SQLSTATE %s)", e.Code)
	}
	return s
}

// ErrClosed is returned when an operation is attempted on a closed connection.
var ErrClosed = fmt.Errorf("sixsevendb: connection is closed")

// ErrInvalidDSN is returned when a DSN string cannot be parsed.
var ErrInvalidDSN = fmt.Errorf("sixsevendb: invalid DSN")
