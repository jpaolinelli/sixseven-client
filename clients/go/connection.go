package sixsevendb

import (
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"time"
)

// rawConn is a low-level TCP connection to SixSevenDB using the PG wire protocol.
type rawConn struct {
	conn       net.Conn
	mu         sync.Mutex
	closed     bool
	parameters map[string]string
	pid        uint32
	secretKey  uint32
}

// dialConfig holds connection parameters.
type dialConfig struct {
	Host     string
	Port     int
	User     string
	Password string
	Database string
}

// defaultDialConfig returns defaults.
func defaultDialConfig() *dialConfig {
	return &dialConfig{
		Host:     "localhost",
		Port:     6767,
		User:     "sixseven",
		Database: "sixseven",
	}
}

// dial creates a new raw connection and performs the startup handshake.
func dial(ctx context.Context, cfg *dialConfig) (*rawConn, error) {
	addr := fmt.Sprintf("%s:%d", cfg.Host, cfg.Port)

	var d net.Dialer
	nc, err := d.DialContext(ctx, "tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("sixsevendb: connect to %s: %w", addr, err)
	}

	rc := &rawConn{
		conn:       nc,
		parameters: make(map[string]string),
	}

	// Apply context deadline to the connection during startup.
	if deadline, ok := ctx.Deadline(); ok {
		_ = nc.SetDeadline(deadline)
		defer func() { _ = nc.SetDeadline(time.Time{}) }()
	}

	if err := rc.startup(cfg); err != nil {
		_ = nc.Close()
		return nil, err
	}

	return rc, nil
}

// startup performs the initial handshake and authentication.
func (c *rawConn) startup(cfg *dialConfig) error {
	if _, err := c.conn.Write(buildStartupMessage(cfg.User, cfg.Database)); err != nil {
		return fmt.Errorf("sixsevendb: send startup: %w", err)
	}
	return c.handleStartup(cfg)
}

// handleStartup reads messages until ReadyForQuery.
func (c *rawConn) handleStartup(cfg *dialConfig) error {
	for {
		msgType, payload, err := c.readMessage()
		if err != nil {
			return err
		}

		switch msgType {
		case msgAuthentication:
			if err := c.handleAuth(payload, cfg); err != nil {
				return err
			}
		case msgParameterStatus:
			name, nextPos := parseCString(payload, 0)
			value, _ := parseCString(payload, nextPos)
			c.parameters[name] = value
		case msgBackendKeyData:
			c.pid = binary.BigEndian.Uint32(payload[0:4])
			c.secretKey = binary.BigEndian.Uint32(payload[4:8])
		case msgReadyForQuery:
			return nil
		case msgErrorResponse:
			fields := parseErrorFields(payload)
			return &Error{
				Severity: fields['S'],
				Code:     fields['C'],
				Message:  fields['M'],
				Detail:   fields['D'],
				Hint:     fields['H'],
			}
		case msgNoticeResponse:
			continue
		}
	}
}

// handleAuth handles authentication challenge messages.
func (c *rawConn) handleAuth(payload []byte, cfg *dialConfig) error {
	if len(payload) < 4 {
		return fmt.Errorf("sixsevendb: authentication payload too short")
	}
	authType := binary.BigEndian.Uint32(payload[0:4])

	switch authType {
	case authOK:
		return nil
	case authCleartextPassword:
		if cfg.Password == "" {
			return fmt.Errorf("sixsevendb: server requires password but none provided")
		}
		_, err := c.conn.Write(buildPasswordMessage(cfg.Password))
		return err
	case authMD5Password:
		if cfg.Password == "" {
			return fmt.Errorf("sixsevendb: server requires password but none provided")
		}
		salt := payload[4:8]
		md5pw := buildMD5Password(cfg.User, cfg.Password, salt)
		_, err := c.conn.Write(buildPasswordMessage(md5pw))
		return err
	case authSASL:
		return c.handleSASL(payload[4:], cfg)
	default:
		return fmt.Errorf("sixsevendb: unsupported auth type %d", authType)
	}
}

// handleSASL performs the SCRAM-SHA-256 handshake.
func (c *rawConn) handleSASL(payload []byte, cfg *dialConfig) error {
	// Parse mechanisms
	var mechanisms []string
	pos := 0
	for pos < len(payload) {
		end := pos
		for end < len(payload) && payload[end] != 0 {
			end++
		}
		name := string(payload[pos:end])
		pos = end + 1
		if name == "" {
			break
		}
		mechanisms = append(mechanisms, name)
	}

	found := false
	for _, m := range mechanisms {
		if m == "SCRAM-SHA-256" {
			found = true
			break
		}
	}
	if !found {
		return fmt.Errorf("sixsevendb: server requires unsupported SASL mechanisms: %v", mechanisms)
	}
	if cfg.Password == "" {
		return fmt.Errorf("sixsevendb: server requires password but none provided")
	}

	state, clientFirst := scramClientFirst(cfg.User, cfg.Password)
	if _, err := c.conn.Write(buildSASLInitialResponse("SCRAM-SHA-256", clientFirst)); err != nil {
		return err
	}

	// Read SASLContinue
	contType, contPayload, err := c.readMessage()
	if err != nil {
		return err
	}
	if contType != msgAuthentication {
		return fmt.Errorf("sixsevendb: expected SASLContinue, got %c", contType)
	}
	if len(contPayload) < 4 || binary.BigEndian.Uint32(contPayload[0:4]) != authSASLContinue {
		return fmt.Errorf("sixsevendb: expected SASLContinue auth type")
	}

	clientFinal, err := scramClientFinal(state, contPayload[4:])
	if err != nil {
		return err
	}
	if _, err := c.conn.Write(buildSASLResponse(clientFinal)); err != nil {
		return err
	}

	// Read SASLFinal
	finalType, finalPayload, err := c.readMessage()
	if err != nil {
		return err
	}
	if finalType != msgAuthentication {
		return fmt.Errorf("sixsevendb: expected SASLFinal, got %c", finalType)
	}
	if len(finalPayload) < 4 || binary.BigEndian.Uint32(finalPayload[0:4]) != authSASLFinal {
		return fmt.Errorf("sixsevendb: expected SASLFinal auth type")
	}

	if !scramVerifyServer(state, finalPayload[4:]) {
		return fmt.Errorf("sixsevendb: server signature verification failed")
	}

	return nil
}

// readMessage reads one complete backend message from the connection.
func (c *rawConn) readMessage() (byte, []byte, error) {
	header := make([]byte, 5)
	if _, err := io.ReadFull(c.conn, header); err != nil {
		return 0, nil, fmt.Errorf("sixsevendb: read message header: %w", err)
	}
	msgType := header[0]
	length := binary.BigEndian.Uint32(header[1:5])
	if length < 4 {
		return 0, nil, fmt.Errorf("sixsevendb: invalid message length %d", length)
	}
	payloadLen := length - 4
	payload := make([]byte, payloadLen)
	if payloadLen > 0 {
		if _, err := io.ReadFull(c.conn, payload); err != nil {
			return 0, nil, fmt.Errorf("sixsevendb: read message payload: %w", err)
		}
	}
	return msgType, payload, nil
}

// writeMessage writes raw bytes to the connection.
func (c *rawConn) writeMessage(data []byte) error {
	_, err := c.conn.Write(data)
	return err
}

// simpleQuery executes a query via the simple query protocol (no parameters).
func (c *rawConn) simpleQuery(ctx context.Context, sql string) ([]fieldDescription, [][][]byte, string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.closed {
		return nil, nil, "", ErrClosed
	}

	// Set deadline from context
	if deadline, ok := ctx.Deadline(); ok {
		_ = c.conn.SetDeadline(deadline)
		defer func() { _ = c.conn.SetDeadline(time.Time{}) }()
	}

	if err := c.writeMessage(buildQueryMessage(sql)); err != nil {
		return nil, nil, "", err
	}

	var fields []fieldDescription
	var rows [][][]byte
	var command string

	for {
		msgType, payload, err := c.readMessage()
		if err != nil {
			return nil, nil, "", err
		}

		switch msgType {
		case msgRowDescription:
			fields, err = parseRowDescription(payload)
			if err != nil {
				return nil, nil, "", err
			}
		case msgDataRow:
			row, err := parseDataRow(payload)
			if err != nil {
				return nil, nil, "", err
			}
			rows = append(rows, row)
		case msgCommandComplete:
			command = parseCStringSimple(payload)
		case msgEmptyQueryResp:
			// empty query
		case msgErrorResponse:
			errFields := parseErrorFields(payload)
			serverErr := &Error{
				Severity: errFields['S'],
				Code:     errFields['C'],
				Message:  errFields['M'],
				Detail:   errFields['D'],
				Hint:     errFields['H'],
			}
			// Wait for ReadyForQuery before returning the error
			c.waitForReady()
			return nil, nil, "", serverErr
		case msgNoticeResponse:
			continue
		case msgReadyForQuery:
			return fields, rows, command, nil
		}
	}
}

// extendedQuery executes a parameterized query via the extended query protocol.
func (c *rawConn) extendedQuery(ctx context.Context, sql string, args []string) ([]fieldDescription, [][][]byte, string, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.closed {
		return nil, nil, "", ErrClosed
	}

	if deadline, ok := ctx.Deadline(); ok {
		_ = c.conn.SetDeadline(deadline)
		defer func() { _ = c.conn.SetDeadline(time.Time{}) }()
	}

	// Send Parse + Bind + Describe + Execute + Sync
	var buf []byte
	buf = append(buf, buildParseMessage(sql, "")...)
	buf = append(buf, buildBindMessage(args, "", "")...)
	buf = append(buf, buildDescribeMessage('P', "")...)
	buf = append(buf, buildExecuteMessage("", 0)...)
	buf = append(buf, buildSyncMessage()...)

	if err := c.writeMessage(buf); err != nil {
		return nil, nil, "", err
	}

	var fields []fieldDescription
	var rows [][][]byte
	var command string

	for {
		msgType, payload, err := c.readMessage()
		if err != nil {
			return nil, nil, "", err
		}

		switch msgType {
		case msgParseComplete, msgBindComplete, msgNoData:
			continue
		case msgRowDescription:
			fields, err = parseRowDescription(payload)
			if err != nil {
				return nil, nil, "", err
			}
		case msgDataRow:
			row, err := parseDataRow(payload)
			if err != nil {
				return nil, nil, "", err
			}
			rows = append(rows, row)
		case msgCommandComplete:
			command = parseCStringSimple(payload)
		case msgEmptyQueryResp:
			// empty query
		case msgErrorResponse:
			errFields := parseErrorFields(payload)
			serverErr := &Error{
				Severity: errFields['S'],
				Code:     errFields['C'],
				Message:  errFields['M'],
				Detail:   errFields['D'],
				Hint:     errFields['H'],
			}
			c.waitForReady()
			return nil, nil, "", serverErr
		case msgNoticeResponse:
			continue
		case msgReadyForQuery:
			return fields, rows, command, nil
		}
	}
}

// waitForReady reads messages until ReadyForQuery is received.
func (c *rawConn) waitForReady() {
	for {
		msgType, _, err := c.readMessage()
		if err != nil || msgType == msgReadyForQuery {
			return
		}
	}
}

// close closes the connection gracefully.
func (c *rawConn) close() error {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.closed {
		return nil
	}
	c.closed = true

	_ = c.writeMessage(buildTerminateMessage())
	return c.conn.Close()
}

// parseCStringSimple extracts a null-terminated string from the start of payload.
func parseCStringSimple(payload []byte) string {
	end := 0
	for end < len(payload) && payload[end] != 0 {
		end++
	}
	return string(payload[:end])
}

// parseCommandTag extracts the command name from a CommandComplete tag.
func parseCommandTag(tag string) string {
	parts := strings.SplitN(tag, " ", 2)
	if len(parts) > 0 {
		return parts[0]
	}
	return ""
}

// parseRowCount extracts the row count from a CommandComplete tag.
func parseRowCount(tag string) int64 {
	parts := strings.Split(tag, " ")
	if len(parts) >= 2 {
		count, err := strconv.ParseInt(parts[len(parts)-1], 10, 64)
		if err == nil {
			return count
		}
	}
	return 0
}
