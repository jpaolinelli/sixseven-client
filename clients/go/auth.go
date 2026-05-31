package sixsevendb

import (
	"crypto/hmac"
	"crypto/md5"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"

	"golang.org/x/crypto/pbkdf2"
)

// buildMD5Password builds an MD5 authentication response.
// Format: "md5" + md5(md5(password + user) + salt)
func buildMD5Password(user, password string, salt []byte) string {
	inner := md5.Sum([]byte(password + user))
	innerHex := fmt.Sprintf("%x", inner)
	outer := md5.Sum(append([]byte(innerHex), salt...))
	return fmt.Sprintf("md5%x", outer)
}

// scramState tracks state across the SCRAM-SHA-256 handshake.
type scramState struct {
	username              string
	password              string
	clientNonce           string
	clientFirstMessageBare string
	serverNonce           string
	salt                  []byte
	iterations            int
	authMessage           string
	serverKey             []byte
}

// scramClientFirst builds the client-first-message for SCRAM-SHA-256.
func scramClientFirst(username, password string) (*scramState, []byte) {
	nonce := make([]byte, 18)
	_, _ = rand.Read(nonce)
	clientNonce := base64.StdEncoding.EncodeToString(nonce)

	clientFirstBare := fmt.Sprintf("n=%s,r=%s", username, clientNonce)
	clientFirstMessage := fmt.Sprintf("n,,%s", clientFirstBare)

	state := &scramState{
		username:              username,
		password:              password,
		clientNonce:           clientNonce,
		clientFirstMessageBare: clientFirstBare,
	}
	return state, []byte(clientFirstMessage)
}

// scramClientFinal processes the server-first-message and returns the client-final-message.
func scramClientFinal(state *scramState, serverFirstMessage []byte) ([]byte, error) {
	serverMsg := string(serverFirstMessage)
	parts := make(map[byte]string)
	for _, part := range strings.Split(serverMsg, ",") {
		if len(part) >= 2 && part[1] == '=' {
			parts[part[0]] = part[2:]
		}
	}

	serverNonce, ok := parts['r']
	if !ok {
		return nil, fmt.Errorf("sixsevendb: SCRAM server-first-message missing nonce")
	}
	saltB64, ok := parts['s']
	if !ok {
		return nil, fmt.Errorf("sixsevendb: SCRAM server-first-message missing salt")
	}
	iterStr, ok := parts['i']
	if !ok {
		return nil, fmt.Errorf("sixsevendb: SCRAM server-first-message missing iterations")
	}

	if !strings.HasPrefix(serverNonce, state.clientNonce) {
		return nil, fmt.Errorf("sixsevendb: server nonce does not start with client nonce")
	}

	salt, err := base64.StdEncoding.DecodeString(saltB64)
	if err != nil {
		return nil, fmt.Errorf("sixsevendb: invalid SCRAM salt: %w", err)
	}
	iterations, err := strconv.Atoi(iterStr)
	if err != nil {
		return nil, fmt.Errorf("sixsevendb: invalid SCRAM iterations: %w", err)
	}

	state.serverNonce = serverNonce
	state.salt = salt
	state.iterations = iterations

	// SaltedPassword = Hi(password, salt, iterations)
	saltedPassword := pbkdf2.Key([]byte(state.password), salt, iterations, 32, sha256.New)

	// ClientKey = HMAC(SaltedPassword, "Client Key")
	clientKey := hmacSHA256(saltedPassword, []byte("Client Key"))

	// StoredKey = H(ClientKey)
	storedKey := sha256Sum(clientKey)

	// ServerKey = HMAC(SaltedPassword, "Server Key")
	serverKey := hmacSHA256(saltedPassword, []byte("Server Key"))
	state.serverKey = serverKey

	// channel-binding = base64("n,,")
	channelBinding := base64.StdEncoding.EncodeToString([]byte("n,,"))

	// client-final-message-without-proof
	clientFinalNoProof := fmt.Sprintf("c=%s,r=%s", channelBinding, serverNonce)

	// AuthMessage
	authMessage := fmt.Sprintf("%s,%s,%s", state.clientFirstMessageBare, serverMsg, clientFinalNoProof)
	state.authMessage = authMessage

	// ClientSignature = HMAC(StoredKey, AuthMessage)
	clientSignature := hmacSHA256(storedKey, []byte(authMessage))

	// ClientProof = ClientKey XOR ClientSignature
	clientProof := xorBytes(clientKey, clientSignature)
	proofB64 := base64.StdEncoding.EncodeToString(clientProof)

	clientFinalMessage := fmt.Sprintf("%s,p=%s", clientFinalNoProof, proofB64)
	return []byte(clientFinalMessage), nil
}

// scramVerifyServer verifies the server's final signature.
func scramVerifyServer(state *scramState, serverFinalMessage []byte) bool {
	serverMsg := string(serverFinalMessage)
	if !strings.HasPrefix(serverMsg, "v=") {
		return false
	}
	serverSignatureB64 := serverMsg[2:]
	serverSignature, err := base64.StdEncoding.DecodeString(serverSignatureB64)
	if err != nil {
		return false
	}
	if state.serverKey == nil || state.authMessage == "" {
		return false
	}
	expected := hmacSHA256(state.serverKey, []byte(state.authMessage))
	return hmac.Equal(serverSignature, expected)
}

func hmacSHA256(key, msg []byte) []byte {
	h := hmac.New(sha256.New, key)
	h.Write(msg)
	return h.Sum(nil)
}

func sha256Sum(data []byte) []byte {
	h := sha256.Sum256(data)
	return h[:]
}

func xorBytes(a, b []byte) []byte {
	result := make([]byte, len(a))
	for i := range a {
		result[i] = a[i] ^ b[i]
	}
	return result
}
