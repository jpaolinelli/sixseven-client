package sixsevendb

import (
	"strings"
	"testing"
)

func TestError_Error(t *testing.T) {
	e := &Error{
		Severity: "ERROR",
		Code:     "42000",
		Message:  "syntax error",
	}
	got := e.Error()
	if !strings.Contains(got, "ERROR") {
		t.Errorf("error string should contain severity, got %q", got)
	}
	if !strings.Contains(got, "syntax error") {
		t.Errorf("error string should contain message, got %q", got)
	}
	if !strings.Contains(got, "42000") {
		t.Errorf("error string should contain SQLSTATE, got %q", got)
	}
}

func TestError_ErrorNoCode(t *testing.T) {
	e := &Error{
		Severity: "WARNING",
		Message:  "something happened",
	}
	got := e.Error()
	if strings.Contains(got, "SQLSTATE") {
		t.Errorf("error without code should not contain SQLSTATE, got %q", got)
	}
}

func TestErrClosed(t *testing.T) {
	if ErrClosed == nil {
		t.Error("ErrClosed should not be nil")
	}
	if !strings.Contains(ErrClosed.Error(), "closed") {
		t.Errorf("ErrClosed should mention 'closed', got %q", ErrClosed.Error())
	}
}

func TestErrInvalidDSN(t *testing.T) {
	if ErrInvalidDSN == nil {
		t.Error("ErrInvalidDSN should not be nil")
	}
	if !strings.Contains(ErrInvalidDSN.Error(), "DSN") {
		t.Errorf("ErrInvalidDSN should mention 'DSN', got %q", ErrInvalidDSN.Error())
	}
}
