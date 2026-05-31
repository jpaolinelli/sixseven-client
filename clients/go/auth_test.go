package sixsevendb

import (
	"encoding/base64"
	"strings"
	"testing"
)

func TestBuildMD5Password(t *testing.T) {
	result := buildMD5Password("testuser", "testpass", []byte{0x01, 0x02, 0x03, 0x04})

	if !strings.HasPrefix(result, "md5") {
		t.Errorf("MD5 password should start with 'md5', got %q", result)
	}
	// md5 prefix + 32 hex chars
	if len(result) != 35 {
		t.Errorf("MD5 password length = %d, want 35", len(result))
	}
}

func TestBuildMD5PasswordDeterministic(t *testing.T) {
	salt := []byte{0xAB, 0xCD, 0xEF, 0x01}
	result1 := buildMD5Password("user", "pass", salt)
	result2 := buildMD5Password("user", "pass", salt)
	if result1 != result2 {
		t.Error("MD5 password should be deterministic")
	}
}

func TestBuildMD5PasswordDifferentSalts(t *testing.T) {
	salt1 := []byte{0x01, 0x02, 0x03, 0x04}
	salt2 := []byte{0x05, 0x06, 0x07, 0x08}
	result1 := buildMD5Password("user", "pass", salt1)
	result2 := buildMD5Password("user", "pass", salt2)
	if result1 == result2 {
		t.Error("MD5 passwords with different salts should differ")
	}
}

func TestScramClientFirst(t *testing.T) {
	state, clientFirst := scramClientFirst("testuser", "testpass")

	msg := string(clientFirst)
	if !strings.HasPrefix(msg, "n,,") {
		t.Errorf("client-first should start with 'n,,', got %q", msg)
	}
	if !strings.Contains(msg, "n=testuser") {
		t.Errorf("client-first should contain 'n=testuser', got %q", msg)
	}
	if !strings.Contains(msg, "r=") {
		t.Errorf("client-first should contain 'r=', got %q", msg)
	}
	if state.username != "testuser" {
		t.Errorf("state username = %q, want %q", state.username, "testuser")
	}
	if state.password != "testpass" {
		t.Errorf("state password = %q, want %q", state.password, "testpass")
	}
	if state.clientNonce == "" {
		t.Error("state clientNonce should not be empty")
	}
}

func TestScramClientFinal(t *testing.T) {
	state := &scramState{
		username:              "user",
		password:              "pencil",
		clientNonce:           "rOprNGfwEbeRWgbNEkqO",
		clientFirstMessageBare: "n=user,r=rOprNGfwEbeRWgbNEkqO",
	}

	// RFC 5802 test vector (adapted)
	salt := base64.StdEncoding.EncodeToString([]byte("salt-value-here!"))
	serverFirst := []byte("r=rOprNGfwEbeRWgbNEkqO%hvYDpWUa2RaTCAfuxFIlj)hNlF$k0,s=" + salt + ",i=4096")

	clientFinal, err := scramClientFinal(state, serverFirst)
	if err != nil {
		t.Fatalf("scramClientFinal error: %v", err)
	}

	msg := string(clientFinal)
	if !strings.Contains(msg, "c=") {
		t.Errorf("client-final should contain 'c=', got %q", msg)
	}
	if !strings.Contains(msg, "r=") {
		t.Errorf("client-final should contain 'r=', got %q", msg)
	}
	if !strings.Contains(msg, "p=") {
		t.Errorf("client-final should contain proof 'p=', got %q", msg)
	}
}

func TestScramClientFinalRejectsInvalidNonce(t *testing.T) {
	state := &scramState{
		username:              "user",
		password:              "pass",
		clientNonce:           "myclientnonce",
		clientFirstMessageBare: "n=user,r=myclientnonce",
	}

	// Server nonce doesn't start with client nonce
	serverFirst := []byte("r=differentnonce,s=" + base64.StdEncoding.EncodeToString([]byte("salt")) + ",i=4096")

	_, err := scramClientFinal(state, serverFirst)
	if err == nil {
		t.Error("expected error for invalid server nonce, got nil")
	}
}

func TestScramVerifyServer(t *testing.T) {
	state := &scramState{
		serverKey:   []byte("some-server-key-32-bytes-long!!!"),
		authMessage: "test-auth-message",
	}

	// Compute the expected signature
	expected := hmacSHA256(state.serverKey, []byte(state.authMessage))
	serverFinal := "v=" + base64.StdEncoding.EncodeToString(expected)

	if !scramVerifyServer(state, []byte(serverFinal)) {
		t.Error("scramVerifyServer should return true for valid signature")
	}
}

func TestScramVerifyServerRejectsInvalid(t *testing.T) {
	state := &scramState{
		serverKey:   []byte("some-server-key-32-bytes-long!!!"),
		authMessage: "test-auth-message",
	}

	serverFinal := "v=" + base64.StdEncoding.EncodeToString([]byte("invalid-signature-value-here!!!!"))
	if scramVerifyServer(state, []byte(serverFinal)) {
		t.Error("scramVerifyServer should return false for invalid signature")
	}
}

func TestScramVerifyServerRejectsMalformed(t *testing.T) {
	state := &scramState{
		serverKey:   []byte("key"),
		authMessage: "msg",
	}

	if scramVerifyServer(state, []byte("not-a-valid-message")) {
		t.Error("scramVerifyServer should return false for malformed message")
	}
}

func TestScramFullHandshake(t *testing.T) {
	// Test a complete SCRAM handshake (client side only)
	state, clientFirst := scramClientFirst("testuser", "testpass")

	if len(clientFirst) == 0 {
		t.Fatal("client first message should not be empty")
	}

	// Simulate server response
	salt := base64.StdEncoding.EncodeToString([]byte("randomsaltbytes!"))
	serverNonce := state.clientNonce + "servernonce"
	serverFirst := []byte("r=" + serverNonce + ",s=" + salt + ",i=4096")

	clientFinal, err := scramClientFinal(state, serverFirst)
	if err != nil {
		t.Fatalf("scramClientFinal error: %v", err)
	}
	if len(clientFinal) == 0 {
		t.Fatal("client final message should not be empty")
	}

	// Verify state was populated
	if state.serverNonce != serverNonce {
		t.Errorf("state.serverNonce = %q, want %q", state.serverNonce, serverNonce)
	}
	if state.iterations != 4096 {
		t.Errorf("state.iterations = %d, want 4096", state.iterations)
	}
	if state.serverKey == nil {
		t.Error("state.serverKey should not be nil after handshake")
	}
	if state.authMessage == "" {
		t.Error("state.authMessage should not be empty after handshake")
	}

	// Compute expected server signature and verify
	expectedSig := hmacSHA256(state.serverKey, []byte(state.authMessage))
	serverFinal := "v=" + base64.StdEncoding.EncodeToString(expectedSig)
	if !scramVerifyServer(state, []byte(serverFinal)) {
		t.Error("server signature verification failed in full handshake")
	}
}
