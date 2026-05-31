package sixsevendb

import (
	"encoding/binary"
	"fmt"
)

const protocolVersion = 196608 // 3 << 16, PostgreSQL v3

// nullValue is a sentinel string used to represent SQL NULL in the bind protocol.
// This distinguishes NULL from an actual empty string parameter.
const nullValue = "\x00NULL\x00"

// Backend message type bytes.
const (
	msgAuthentication    byte = 'R'
	msgParameterStatus   byte = 'S'
	msgBackendKeyData    byte = 'K'
	msgReadyForQuery     byte = 'Z'
	msgRowDescription    byte = 'T'
	msgDataRow           byte = 'D'
	msgCommandComplete   byte = 'C'
	msgErrorResponse     byte = 'E'
	msgNoticeResponse    byte = 'N'
	msgEmptyQueryResp    byte = 'I'
	msgParseComplete     byte = '1'
	msgBindComplete      byte = '2'
	msgCloseComplete     byte = '3'
	msgNoData            byte = 'n'
	msgPortalSuspended   byte = 's'
	msgCopyInResponse    byte = 'G'
	msgCopyOutResponse   byte = 'H'
	msgCopyBothResponse  byte = 'W'
	msgCopyData          byte = 'd'
	msgCopyDone          byte = 'c'
	msgNotificationResp  byte = 'A'
	msgFunctionCallResp  byte = 'V'
	msgNegotiateProtocol byte = 'v'
)

// Auth subtypes within 'R' messages.
const (
	authOK                = 0
	authCleartextPassword = 3
	authMD5Password       = 5
	authSASL              = 10
	authSASLContinue      = 11
	authSASLFinal         = 12
)

// fieldDescription describes a single column in a result set.
type fieldDescription struct {
	Name         string
	TableOID     uint32
	ColumnIndex  uint16
	TypeOID      uint32
	TypeSize     int16
	TypeModifier int32
	FormatCode   int16
}

// buildStartupMessage builds the initial startup message with protocol version and params.
func buildStartupMessage(user, database string) []byte {
	params := "user\x00" + user + "\x00database\x00" + database + "\x00\x00"
	paramsBytes := []byte(params)
	length := uint32(4 + 4 + len(paramsBytes))
	buf := make([]byte, 4+4+len(paramsBytes))
	binary.BigEndian.PutUint32(buf[0:4], length)
	binary.BigEndian.PutUint32(buf[4:8], protocolVersion)
	copy(buf[8:], paramsBytes)
	return buf
}

// buildPasswordMessage builds a cleartext password message.
func buildPasswordMessage(password string) []byte {
	pw := []byte(password)
	pw = append(pw, 0)
	length := uint32(4 + len(pw))
	buf := make([]byte, 0, 1+4+len(pw))
	buf = append(buf, 'p')
	buf = binary.BigEndian.AppendUint32(buf, length)
	buf = append(buf, pw...)
	return buf
}

// buildQueryMessage builds a simple query ('Q') message.
func buildQueryMessage(sql string) []byte {
	sqlBytes := []byte(sql)
	sqlBytes = append(sqlBytes, 0)
	length := uint32(4 + len(sqlBytes))
	buf := make([]byte, 0, 1+4+len(sqlBytes))
	buf = append(buf, 'Q')
	buf = binary.BigEndian.AppendUint32(buf, length)
	buf = append(buf, sqlBytes...)
	return buf
}

// buildParseMessage builds a Parse ('P') message for extended query protocol.
func buildParseMessage(sql string, statementName string) []byte {
	nameBytes := append([]byte(statementName), 0)
	sqlBytes := append([]byte(sql), 0)
	paramTypes := []byte{0, 0} // uint16: 0 parameter type OIDs
	length := uint32(4 + len(nameBytes) + len(sqlBytes) + len(paramTypes))
	buf := make([]byte, 0, 1+4+int(length)-4)
	buf = append(buf, 'P')
	buf = binary.BigEndian.AppendUint32(buf, length)
	buf = append(buf, nameBytes...)
	buf = append(buf, sqlBytes...)
	buf = append(buf, paramTypes...)
	return buf
}

// buildBindMessage builds a Bind ('B') message for extended query protocol.
func buildBindMessage(values []string, portalName, statementName string) []byte {
	portalBytes := append([]byte(portalName), 0)
	stmtBytes := append([]byte(statementName), 0)

	// Format codes: 0 = all text
	formatCodes := make([]byte, 2)
	binary.BigEndian.PutUint16(formatCodes, 0)

	// Parameters
	paramCount := make([]byte, 2)
	binary.BigEndian.PutUint16(paramCount, uint16(len(values)))

	var paramData []byte
	for _, val := range values {
		if val == nullValue {
			// NULL parameter: length -1 means SQL NULL in PG protocol
			paramData = binary.BigEndian.AppendUint32(paramData, 0xFFFFFFFF)
		} else {
			valBytes := []byte(val)
			paramData = binary.BigEndian.AppendUint32(paramData, uint32(len(valBytes)))
			paramData = append(paramData, valBytes...)
		}
	}

	// Result format codes: 0 = all text
	resultFormat := make([]byte, 2)
	binary.BigEndian.PutUint16(resultFormat, 0)

	payload := make([]byte, 0, len(portalBytes)+len(stmtBytes)+len(formatCodes)+len(paramCount)+len(paramData)+len(resultFormat))
	payload = append(payload, portalBytes...)
	payload = append(payload, stmtBytes...)
	payload = append(payload, formatCodes...)
	payload = append(payload, paramCount...)
	payload = append(payload, paramData...)
	payload = append(payload, resultFormat...)

	length := uint32(4 + len(payload))
	buf := make([]byte, 0, 1+4+len(payload))
	buf = append(buf, 'B')
	buf = binary.BigEndian.AppendUint32(buf, length)
	buf = append(buf, payload...)
	return buf
}

// buildDescribeMessage builds a Describe ('D') message.
func buildDescribeMessage(targetType byte, name string) []byte {
	nameBytes := append([]byte(name), 0)
	length := uint32(4 + 1 + len(nameBytes))
	buf := make([]byte, 0, 1+4+1+len(nameBytes))
	buf = append(buf, 'D')
	buf = binary.BigEndian.AppendUint32(buf, length)
	buf = append(buf, targetType)
	buf = append(buf, nameBytes...)
	return buf
}

// buildExecuteMessage builds an Execute ('E') message.
func buildExecuteMessage(portalName string, maxRows int32) []byte {
	portalBytes := append([]byte(portalName), 0)
	length := uint32(4 + len(portalBytes) + 4)
	buf := make([]byte, 0, 1+4+len(portalBytes)+4)
	buf = append(buf, 'E')
	buf = binary.BigEndian.AppendUint32(buf, length)
	buf = append(buf, portalBytes...)
	buf = binary.BigEndian.AppendUint32(buf, uint32(maxRows))
	return buf
}

// buildSyncMessage builds a Sync ('S') message.
func buildSyncMessage() []byte {
	return []byte{'S', 0, 0, 0, 4}
}

// buildTerminateMessage builds a Terminate ('X') message.
func buildTerminateMessage() []byte {
	return []byte{'X', 0, 0, 0, 4}
}

// buildSASLInitialResponse builds a SASLInitialResponse message.
func buildSASLInitialResponse(mechanism string, clientFirstMessage []byte) []byte {
	mechBytes := append([]byte(mechanism), 0)
	length := uint32(4 + len(mechBytes) + 4 + len(clientFirstMessage))
	buf := make([]byte, 0, 1+int(length))
	buf = append(buf, 'p')
	buf = binary.BigEndian.AppendUint32(buf, length)
	buf = append(buf, mechBytes...)
	buf = binary.BigEndian.AppendUint32(buf, uint32(len(clientFirstMessage)))
	buf = append(buf, clientFirstMessage...)
	return buf
}

// buildSASLResponse builds a SASLResponse message.
func buildSASLResponse(clientFinalMessage []byte) []byte {
	length := uint32(4 + len(clientFinalMessage))
	buf := make([]byte, 0, 1+4+len(clientFinalMessage))
	buf = append(buf, 'p')
	buf = binary.BigEndian.AppendUint32(buf, length)
	buf = append(buf, clientFinalMessage...)
	return buf
}

// parseErrorFields parses error/notice response fields.
func parseErrorFields(payload []byte) map[byte]string {
	fields := make(map[byte]string)
	pos := 0
	for pos < len(payload) {
		fieldType := payload[pos]
		pos++
		if fieldType == 0 {
			break
		}
		end := pos
		for end < len(payload) && payload[end] != 0 {
			end++
		}
		fields[fieldType] = string(payload[pos:end])
		pos = end + 1
	}
	return fields
}

// parseRowDescription parses a RowDescription ('T') message payload.
func parseRowDescription(payload []byte) ([]fieldDescription, error) {
	if len(payload) < 2 {
		return nil, fmt.Errorf("row description too short")
	}
	fieldCount := binary.BigEndian.Uint16(payload[0:2])
	fields := make([]fieldDescription, 0, fieldCount)
	pos := 2
	for i := 0; i < int(fieldCount); i++ {
		end := pos
		for end < len(payload) && payload[end] != 0 {
			end++
		}
		if end >= len(payload) {
			return nil, fmt.Errorf("malformed row description")
		}
		name := string(payload[pos:end])
		pos = end + 1
		if pos+18 > len(payload) {
			return nil, fmt.Errorf("row description field data too short")
		}
		tableOID := binary.BigEndian.Uint32(payload[pos : pos+4])
		colIdx := binary.BigEndian.Uint16(payload[pos+4 : pos+6])
		typeOID := binary.BigEndian.Uint32(payload[pos+6 : pos+10])
		typeSize := int16(binary.BigEndian.Uint16(payload[pos+10 : pos+12]))
		typeMod := int32(binary.BigEndian.Uint32(payload[pos+12 : pos+16]))
		fmtCode := int16(binary.BigEndian.Uint16(payload[pos+16 : pos+18]))
		pos += 18
		fields = append(fields, fieldDescription{
			Name:         name,
			TableOID:     tableOID,
			ColumnIndex:  colIdx,
			TypeOID:      typeOID,
			TypeSize:     typeSize,
			TypeModifier: typeMod,
			FormatCode:   fmtCode,
		})
	}
	return fields, nil
}

// parseDataRow parses a DataRow ('D') message payload into column values.
// NULL values are returned as nil.
func parseDataRow(payload []byte) ([][]byte, error) {
	if len(payload) < 2 {
		return nil, fmt.Errorf("data row too short")
	}
	colCount := binary.BigEndian.Uint16(payload[0:2])
	values := make([][]byte, 0, colCount)
	pos := 2
	for i := 0; i < int(colCount); i++ {
		if pos+4 > len(payload) {
			return nil, fmt.Errorf("data row column length too short")
		}
		length := int32(binary.BigEndian.Uint32(payload[pos : pos+4]))
		pos += 4
		if length == -1 {
			values = append(values, nil)
		} else {
			if pos+int(length) > len(payload) {
				return nil, fmt.Errorf("data row column data too short")
			}
			values = append(values, payload[pos:pos+int(length)])
			pos += int(length)
		}
	}
	return values, nil
}

// parseCString extracts a null-terminated string from payload at the given offset.
func parseCString(payload []byte, offset int) (string, int) {
	end := offset
	for end < len(payload) && payload[end] != 0 {
		end++
	}
	return string(payload[offset:end]), end + 1
}
