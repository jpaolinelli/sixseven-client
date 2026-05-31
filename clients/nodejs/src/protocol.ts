/**
 * SixSevenDB wire protocol v3 message encoding and decoding.
 *
 * The wire protocol follows PostgreSQL v3 framing:
 *   Frontend (client → server): 1-byte type + 4-byte length + payload
 *   Backend  (server → client): 1-byte type + 4-byte length + payload
 *   Startup message has no type byte: 4-byte length + payload
 */

import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'crypto';

// ---------------------------------------------------------------------------
// Frontend message builders
// ---------------------------------------------------------------------------

export function buildStartupMessage(user: string, database: string): Buffer {
  const PROTOCOL_VERSION = 196608; // 3 << 16
  const params = Buffer.from(`user\0${user}\0database\0${database}\0\0`, 'utf8');
  const len = 4 + 4 + params.length; // length field + version + params
  const buf = Buffer.alloc(len);
  buf.writeInt32BE(len, 0);
  buf.writeInt32BE(PROTOCOL_VERSION, 4);
  params.copy(buf, 8);
  return buf;
}

export function buildPasswordMessage(password: string): Buffer {
  const payload = Buffer.from(password + '\0', 'utf8');
  const len = 4 + payload.length;
  const buf = Buffer.alloc(1 + len);
  buf[0] = 0x70; // 'p'
  buf.writeInt32BE(len, 1);
  payload.copy(buf, 5);
  return buf;
}

export function buildMD5PasswordMessage(
  user: string,
  password: string,
  salt: Buffer,
): Buffer {
  // md5(md5(password + user) + salt)
  const inner = createHash('md5')
    .update(password + user)
    .digest('hex');
  const outer = createHash('md5')
    .update(Buffer.concat([Buffer.from(inner, 'utf8'), salt]))
    .digest('hex');
  return buildPasswordMessage('md5' + outer);
}

export function buildQueryMessage(sql: string): Buffer {
  const payload = Buffer.from(sql + '\0', 'utf8');
  const len = 4 + payload.length;
  const buf = Buffer.alloc(1 + len);
  buf[0] = 0x51; // 'Q'
  buf.writeInt32BE(len, 1);
  payload.copy(buf, 5);
  return buf;
}

export function buildParseMessage(
  sql: string,
  statementName = '',
): Buffer {
  const nameBytes = Buffer.from(statementName + '\0', 'utf8');
  const queryBytes = Buffer.from(sql + '\0', 'utf8');
  const len = 4 + nameBytes.length + queryBytes.length + 2; // +2 for int16 param count
  const buf = Buffer.alloc(1 + len);
  let offset = 0;
  buf[offset++] = 0x50; // 'P'
  buf.writeInt32BE(len, offset);
  offset += 4;
  nameBytes.copy(buf, offset);
  offset += nameBytes.length;
  queryBytes.copy(buf, offset);
  offset += queryBytes.length;
  buf.writeInt16BE(0, offset); // no param type OIDs
  return buf;
}

export function buildBindMessage(
  params: (string | null)[],
  portalName = '',
  statementName = '',
): Buffer {
  const portalBytes = Buffer.from(portalName + '\0', 'utf8');
  const stmtBytes = Buffer.from(statementName + '\0', 'utf8');

  // Compute total size
  let payloadSize =
    portalBytes.length +
    stmtBytes.length +
    2 + // int16: number of format codes
    2 + // int16: number of parameters
    2;  // int16: number of result format codes

  const paramBuffers: (Buffer | null)[] = [];
  for (const p of params) {
    if (p === null) {
      paramBuffers.push(null);
      payloadSize += 4; // int32 -1
    } else {
      const b = Buffer.from(p, 'utf8');
      paramBuffers.push(b);
      payloadSize += 4 + b.length; // int32 length + data
    }
  }

  const len = 4 + payloadSize;
  const buf = Buffer.alloc(1 + len);
  let offset = 0;
  buf[offset++] = 0x42; // 'B'
  buf.writeInt32BE(len, offset);
  offset += 4;
  portalBytes.copy(buf, offset);
  offset += portalBytes.length;
  stmtBytes.copy(buf, offset);
  offset += stmtBytes.length;
  // Format codes: 0 = all text
  buf.writeInt16BE(0, offset);
  offset += 2;
  // Number of parameters
  buf.writeInt16BE(params.length, offset);
  offset += 2;
  // Parameter values
  for (const pb of paramBuffers) {
    if (pb === null) {
      buf.writeInt32BE(-1, offset);
      offset += 4;
    } else {
      buf.writeInt32BE(pb.length, offset);
      offset += 4;
      pb.copy(buf, offset);
      offset += pb.length;
    }
  }
  // Result format codes: 0 = all text
  buf.writeInt16BE(0, offset);
  return buf;
}

export function buildDescribeMessage(type: 'S' | 'P' = 'P', name = ''): Buffer {
  const nameBytes = Buffer.from(name + '\0', 'utf8');
  const len = 4 + 1 + nameBytes.length;
  const buf = Buffer.alloc(1 + len);
  buf[0] = 0x44; // 'D'
  buf.writeInt32BE(len, 1);
  buf[5] = type.charCodeAt(0);
  nameBytes.copy(buf, 6);
  return buf;
}

export function buildExecuteMessage(portalName = '', maxRows = 0): Buffer {
  const nameBytes = Buffer.from(portalName + '\0', 'utf8');
  const len = 4 + nameBytes.length + 4;
  const buf = Buffer.alloc(1 + len);
  buf[0] = 0x45; // 'E'
  buf.writeInt32BE(len, 1);
  nameBytes.copy(buf, 5);
  buf.writeInt32BE(maxRows, 5 + nameBytes.length);
  return buf;
}

export function buildSyncMessage(): Buffer {
  const buf = Buffer.alloc(5);
  buf[0] = 0x53; // 'S'
  buf.writeInt32BE(4, 1);
  return buf;
}

export function buildTerminateMessage(): Buffer {
  const buf = Buffer.alloc(5);
  buf[0] = 0x58; // 'X'
  buf.writeInt32BE(4, 1);
  return buf;
}

export function buildSASLInitialResponse(mechanism: string, clientFirstMessage: string): Buffer {
  const mechBytes = Buffer.from(mechanism + '\0', 'utf8');
  const msgBytes = Buffer.from(clientFirstMessage, 'utf8');
  const len = 4 + mechBytes.length + 4 + msgBytes.length;
  const buf = Buffer.alloc(1 + len);
  let offset = 0;
  buf[offset++] = 0x70; // 'p'
  buf.writeInt32BE(len, offset);
  offset += 4;
  mechBytes.copy(buf, offset);
  offset += mechBytes.length;
  buf.writeInt32BE(msgBytes.length, offset);
  offset += 4;
  msgBytes.copy(buf, offset);
  return buf;
}

export function buildSASLResponse(clientFinalMessage: string): Buffer {
  const msgBytes = Buffer.from(clientFinalMessage, 'utf8');
  const len = 4 + msgBytes.length;
  const buf = Buffer.alloc(1 + len);
  buf[0] = 0x70; // 'p'
  buf.writeInt32BE(len, 1);
  msgBytes.copy(buf, 5);
  return buf;
}

export function buildCloseMessage(type: 'S' | 'P', name = ''): Buffer {
  const nameBytes = Buffer.from(name + '\0', 'utf8');
  const len = 4 + 1 + nameBytes.length;
  const buf = Buffer.alloc(1 + len);
  buf[0] = 0x43; // 'C'
  buf.writeInt32BE(len, 1);
  buf[5] = type.charCodeAt(0);
  nameBytes.copy(buf, 6);
  return buf;
}

// ---------------------------------------------------------------------------
// Backend message types
// ---------------------------------------------------------------------------

export const enum BackendMessageType {
  AuthenticationOk = 'AuthenticationOk',
  AuthenticationCleartextPassword = 'AuthenticationCleartextPassword',
  AuthenticationMD5Password = 'AuthenticationMD5Password',
  AuthenticationSASL = 'AuthenticationSASL',
  AuthenticationSASLContinue = 'AuthenticationSASLContinue',
  AuthenticationSASLFinal = 'AuthenticationSASLFinal',
  ParameterStatus = 'ParameterStatus',
  BackendKeyData = 'BackendKeyData',
  ReadyForQuery = 'ReadyForQuery',
  RowDescription = 'RowDescription',
  DataRow = 'DataRow',
  CommandComplete = 'CommandComplete',
  ErrorResponse = 'ErrorResponse',
  NoticeResponse = 'NoticeResponse',
  ParseComplete = 'ParseComplete',
  BindComplete = 'BindComplete',
  CloseComplete = 'CloseComplete',
  NoData = 'NoData',
  EmptyQueryResponse = 'EmptyQueryResponse',
}

export interface FieldDescription {
  name: string;
  tableOID: number;
  columnIndex: number;
  typeOID: number;
  typeSize: number;
  typeModifier: number;
  formatCode: number;
}

export type BackendMessage =
  | { type: BackendMessageType.AuthenticationOk }
  | { type: BackendMessageType.AuthenticationCleartextPassword }
  | { type: BackendMessageType.AuthenticationMD5Password; salt: Buffer }
  | { type: BackendMessageType.AuthenticationSASL; mechanisms: string[] }
  | { type: BackendMessageType.AuthenticationSASLContinue; data: string }
  | { type: BackendMessageType.AuthenticationSASLFinal; data: string }
  | { type: BackendMessageType.ParameterStatus; name: string; value: string }
  | { type: BackendMessageType.BackendKeyData; processId: number; secretKey: number }
  | { type: BackendMessageType.ReadyForQuery; status: string }
  | { type: BackendMessageType.RowDescription; fields: FieldDescription[] }
  | { type: BackendMessageType.DataRow; values: (string | null)[] }
  | { type: BackendMessageType.CommandComplete; tag: string }
  | { type: BackendMessageType.ErrorResponse; severity: string; code: string; message: string }
  | { type: BackendMessageType.NoticeResponse; severity: string; message: string }
  | { type: BackendMessageType.ParseComplete }
  | { type: BackendMessageType.BindComplete }
  | { type: BackendMessageType.CloseComplete }
  | { type: BackendMessageType.NoData }
  | { type: BackendMessageType.EmptyQueryResponse };

// ---------------------------------------------------------------------------
// Backend message parsing
// ---------------------------------------------------------------------------

function readCString(buf: Buffer, offset: number): { value: string; end: number } {
  const nullPos = buf.indexOf(0, offset);
  if (nullPos === -1) throw new Error('unterminated string in message');
  return { value: buf.toString('utf8', offset, nullPos), end: nullPos + 1 };
}

function parseBackendMessage(typeByte: number, payload: Buffer): BackendMessage {
  switch (typeByte) {
    case 0x52: { // 'R' Authentication
      const authType = payload.readInt32BE(0);
      if (authType === 0) return { type: BackendMessageType.AuthenticationOk };
      if (authType === 3) return { type: BackendMessageType.AuthenticationCleartextPassword };
      if (authType === 5) {
        return {
          type: BackendMessageType.AuthenticationMD5Password,
          salt: Buffer.from(payload.subarray(4, 8)),
        };
      }
      if (authType === 10) {
        // AuthenticationSASL — list of mechanisms
        const mechanisms: string[] = [];
        let offset = 4;
        while (offset < payload.length) {
          const { value, end } = readCString(payload, offset);
          if (value === '') break;
          mechanisms.push(value);
          offset = end;
        }
        return { type: BackendMessageType.AuthenticationSASL, mechanisms };
      }
      if (authType === 11) {
        return {
          type: BackendMessageType.AuthenticationSASLContinue,
          data: payload.toString('utf8', 4),
        };
      }
      if (authType === 12) {
        return {
          type: BackendMessageType.AuthenticationSASLFinal,
          data: payload.toString('utf8', 4),
        };
      }
      throw new Error(`unsupported authentication type: ${authType}`);
    }

    case 0x53: { // 'S' ParameterStatus
      const { value: name, end: e1 } = readCString(payload, 0);
      const { value } = readCString(payload, e1);
      return { type: BackendMessageType.ParameterStatus, name, value };
    }

    case 0x4b: { // 'K' BackendKeyData
      return {
        type: BackendMessageType.BackendKeyData,
        processId: payload.readInt32BE(0),
        secretKey: payload.readInt32BE(4),
      };
    }

    case 0x5a: { // 'Z' ReadyForQuery
      return {
        type: BackendMessageType.ReadyForQuery,
        status: String.fromCharCode(payload[0]),
      };
    }

    case 0x54: { // 'T' RowDescription
      const fieldCount = payload.readInt16BE(0);
      let offset = 2;
      const fields: FieldDescription[] = [];
      for (let i = 0; i < fieldCount; i++) {
        const { value: name, end } = readCString(payload, offset);
        offset = end;
        const tableOID = payload.readInt32BE(offset); offset += 4;
        const columnIndex = payload.readInt16BE(offset); offset += 2;
        const typeOID = payload.readInt32BE(offset); offset += 4;
        const typeSize = payload.readInt16BE(offset); offset += 2;
        const typeModifier = payload.readInt32BE(offset); offset += 4;
        const formatCode = payload.readInt16BE(offset); offset += 2;
        fields.push({ name, tableOID, columnIndex, typeOID, typeSize, typeModifier, formatCode });
      }
      return { type: BackendMessageType.RowDescription, fields };
    }

    case 0x44: { // 'D' DataRow
      const colCount = payload.readInt16BE(0);
      let offset = 2;
      const values: (string | null)[] = [];
      for (let i = 0; i < colCount; i++) {
        const len = payload.readInt32BE(offset);
        offset += 4;
        if (len === -1) {
          values.push(null);
        } else {
          values.push(payload.toString('utf8', offset, offset + len));
          offset += len;
        }
      }
      return { type: BackendMessageType.DataRow, values };
    }

    case 0x43: { // 'C' CommandComplete
      const { value: tag } = readCString(payload, 0);
      return { type: BackendMessageType.CommandComplete, tag };
    }

    case 0x45: { // 'E' ErrorResponse
      let severity = '';
      let code = '';
      let message = '';
      let offset = 0;
      while (offset < payload.length) {
        const fieldType = payload[offset++];
        if (fieldType === 0) break;
        const { value, end } = readCString(payload, offset);
        offset = end;
        if (fieldType === 0x53) severity = value;     // 'S'
        else if (fieldType === 0x43) code = value;     // 'C'
        else if (fieldType === 0x4d) message = value;  // 'M'
      }
      return { type: BackendMessageType.ErrorResponse, severity, code, message };
    }

    case 0x4e: { // 'N' NoticeResponse
      let severity = '';
      let message = '';
      let offset = 0;
      while (offset < payload.length) {
        const fieldType = payload[offset++];
        if (fieldType === 0) break;
        const { value, end } = readCString(payload, offset);
        offset = end;
        if (fieldType === 0x53) severity = value;
        else if (fieldType === 0x4d) message = value;
      }
      return { type: BackendMessageType.NoticeResponse, severity, message };
    }

    case 0x31: return { type: BackendMessageType.ParseComplete };  // '1'
    case 0x32: return { type: BackendMessageType.BindComplete };   // '2'
    case 0x33: return { type: BackendMessageType.CloseComplete };  // '3'
    case 0x6e: return { type: BackendMessageType.NoData };         // 'n'
    case 0x49: return { type: BackendMessageType.EmptyQueryResponse }; // 'I'

    default:
      throw new Error(`unknown backend message type: 0x${typeByte.toString(16)}`);
  }
}

// ---------------------------------------------------------------------------
// Message stream reader — accumulates TCP data and yields complete messages
// ---------------------------------------------------------------------------

export class MessageReader {
  private buffer: Buffer = Buffer.alloc(0);

  /** Append raw data received from the socket. */
  append(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, data]);
  }

  /** Try to read one complete backend message. Returns null if not enough data. */
  read(): BackendMessage | null {
    if (this.buffer.length < 5) return null;

    const typeByte = this.buffer[0];
    const bodyLength = this.buffer.readInt32BE(1); // includes self (4 bytes), excludes type byte
    const totalLength = 1 + bodyLength;

    if (this.buffer.length < totalLength) return null;

    const payload = this.buffer.subarray(5, totalLength);
    this.buffer = this.buffer.subarray(totalLength);

    return parseBackendMessage(typeByte, payload);
  }
}

// ---------------------------------------------------------------------------
// SCRAM-SHA-256 helpers (RFC 5802)
// ---------------------------------------------------------------------------

export function generateClientNonce(length = 24): string {
  return randomBytes(length).toString('base64');
}

export function buildClientFirstMessage(user: string, nonce: string): string {
  // n,,n=<user>,r=<nonce>
  // gs2-header = "n,," (no channel binding)
  return `n,,n=${saslPrepName(user)},r=${nonce}`;
}

export function parseServerFirstMessage(data: string): {
  nonce: string;
  salt: Buffer;
  iterations: number;
} {
  const parts = new Map<string, string>();
  for (const attr of data.split(',')) {
    const eq = attr.indexOf('=');
    if (eq > 0) parts.set(attr[0], attr.substring(eq + 1));
  }
  const nonce = parts.get('r');
  const saltB64 = parts.get('s');
  const iterStr = parts.get('i');
  if (!nonce || !saltB64 || !iterStr) {
    throw new Error('invalid SCRAM server-first-message');
  }
  return {
    nonce,
    salt: Buffer.from(saltB64, 'base64'),
    iterations: parseInt(iterStr, 10),
  };
}

export function computeSaltedPassword(password: string, salt: Buffer, iterations: number): Buffer {
  return pbkdf2Sync(password, salt, iterations, 32, 'sha256');
}

export function computeClientProof(
  saltedPassword: Buffer,
  authMessage: string,
): { clientProof: string; serverSignature: string } {
  const clientKey = hmacSha256(saltedPassword, 'Client Key');
  const storedKey = createHash('sha256').update(clientKey).digest();
  const clientSignature = hmacSha256(storedKey, authMessage);
  const clientProof = Buffer.alloc(clientKey.length);
  for (let i = 0; i < clientKey.length; i++) {
    clientProof[i] = clientKey[i] ^ clientSignature[i];
  }

  const serverKey = hmacSha256(saltedPassword, 'Server Key');
  const serverSignature = hmacSha256(serverKey, authMessage);

  return {
    clientProof: clientProof.toString('base64'),
    serverSignature: serverSignature.toString('base64'),
  };
}

export function buildClientFinalMessage(
  clientFirstBare: string,
  serverFirstMessage: string,
  serverNonce: string,
  clientProof: string,
): string {
  const channelBinding = Buffer.from('n,,').toString('base64');
  const clientFinalWithoutProof = `c=${channelBinding},r=${serverNonce}`;
  return `${clientFinalWithoutProof},p=${clientProof}`;
}

export function buildAuthMessage(
  clientFirstBare: string,
  serverFirstMessage: string,
  serverNonce: string,
): string {
  const channelBinding = Buffer.from('n,,').toString('base64');
  const clientFinalWithoutProof = `c=${channelBinding},r=${serverNonce}`;
  return `${clientFirstBare},${serverFirstMessage},${clientFinalWithoutProof}`;
}

export function verifyServerSignature(serverFinalMessage: string, expectedSignature: string): void {
  const parts = new Map<string, string>();
  for (const attr of serverFinalMessage.split(',')) {
    const eq = attr.indexOf('=');
    if (eq > 0) parts.set(attr[0], attr.substring(eq + 1));
  }
  const v = parts.get('v');
  if (v !== expectedSignature) {
    throw new Error('SCRAM server signature verification failed');
  }
}

function hmacSha256(key: Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function saslPrepName(name: string): string {
  return name.replace(/=/g, '=3D').replace(/,/g, '=2C');
}
