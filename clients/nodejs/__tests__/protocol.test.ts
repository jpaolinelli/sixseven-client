import { describe, it, expect } from 'vitest';
import {
  buildStartupMessage,
  buildPasswordMessage,
  buildMD5PasswordMessage,
  buildQueryMessage,
  buildParseMessage,
  buildBindMessage,
  buildDescribeMessage,
  buildExecuteMessage,
  buildSyncMessage,
  buildTerminateMessage,
  buildSASLInitialResponse,
  buildSASLResponse,
  buildCloseMessage,
  MessageReader,
  BackendMessageType,
  generateClientNonce,
  buildClientFirstMessage,
  parseServerFirstMessage,
  computeSaltedPassword,
  computeClientProof,
  buildAuthMessage,
  verifyServerSignature,
} from '../src/protocol';

// ---------------------------------------------------------------------------
// Frontend message builders
// ---------------------------------------------------------------------------

describe('buildStartupMessage', () => {
  it('encodes protocol version 3.0 and parameters', () => {
    const buf = buildStartupMessage('sixseven', 'mydb');
    // First 4 bytes = total length (int32)
    const len = buf.readInt32BE(0);
    expect(len).toBe(buf.length);
    // Next 4 bytes = protocol version 196608 (3 << 16)
    expect(buf.readInt32BE(4)).toBe(196608);
    // Params contain user, database, null terminators
    const params = buf.toString('utf8', 8);
    expect(params).toContain('user');
    expect(params).toContain('sixseven');
    expect(params).toContain('database');
    expect(params).toContain('mydb');
  });
});

describe('buildPasswordMessage', () => {
  it('has type byte 0x70 ("p")', () => {
    const buf = buildPasswordMessage('secret');
    expect(buf[0]).toBe(0x70);
    const len = buf.readInt32BE(1);
    expect(1 + len).toBe(buf.length);
  });
});

describe('buildMD5PasswordMessage', () => {
  it('produces a deterministic MD5 password', () => {
    const salt = Buffer.from([0x01, 0x02, 0x03, 0x04]);
    const buf = buildMD5PasswordMessage('user', 'pass', salt);
    expect(buf[0]).toBe(0x70);
    // The password payload starts with 'md5'
    const payload = buf.toString('utf8', 5, buf.length - 1);
    expect(payload.startsWith('md5')).toBe(true);
    expect(payload.length).toBe(35); // 'md5' + 32 hex chars
  });
});

describe('buildQueryMessage', () => {
  it('has type byte 0x51 ("Q") and null-terminated SQL', () => {
    const buf = buildQueryMessage('SELECT 1');
    expect(buf[0]).toBe(0x51);
    // Last byte of payload should be null terminator
    expect(buf[buf.length - 1]).toBe(0);
    // SQL content
    const sql = buf.toString('utf8', 5, buf.length - 1);
    expect(sql).toBe('SELECT 1');
  });
});

describe('buildParseMessage', () => {
  it('has type byte 0x50 ("P")', () => {
    const buf = buildParseMessage('SELECT $1');
    expect(buf[0]).toBe(0x50);
  });
});

describe('buildBindMessage', () => {
  it('has type byte 0x42 ("B") and encodes parameters', () => {
    const buf = buildBindMessage(['hello', null, '42']);
    expect(buf[0]).toBe(0x42);
    const len = buf.readInt32BE(1);
    expect(1 + len).toBe(buf.length);
  });

  it('encodes null as int32 -1', () => {
    const buf = buildBindMessage([null]);
    // Find the parameter section: after portal name + stmt name + format codes + param count
    // Portal name: '' + \0 = 1 byte at offset 5
    // Stmt name: '' + \0 = 1 byte at offset 6
    // Format codes: int16(0) = 2 bytes at offset 7
    // Param count: int16(1) = 2 bytes at offset 9
    // Param 1 (null): int32(-1) at offset 11
    expect(buf.readInt32BE(11)).toBe(-1);
  });
});

describe('buildDescribeMessage', () => {
  it('has type byte 0x44 ("D") with portal type', () => {
    const buf = buildDescribeMessage('P');
    expect(buf[0]).toBe(0x44);
    expect(buf[5]).toBe('P'.charCodeAt(0));
  });

  it('supports statement type', () => {
    const buf = buildDescribeMessage('S');
    expect(buf[5]).toBe('S'.charCodeAt(0));
  });
});

describe('buildExecuteMessage', () => {
  it('has type byte 0x45 ("E")', () => {
    const buf = buildExecuteMessage();
    expect(buf[0]).toBe(0x45);
  });
});

describe('buildSyncMessage', () => {
  it('has type byte 0x53 ("S") and length 4', () => {
    const buf = buildSyncMessage();
    expect(buf[0]).toBe(0x53);
    expect(buf.readInt32BE(1)).toBe(4);
    expect(buf.length).toBe(5);
  });
});

describe('buildTerminateMessage', () => {
  it('has type byte 0x58 ("X") and length 4', () => {
    const buf = buildTerminateMessage();
    expect(buf[0]).toBe(0x58);
    expect(buf.readInt32BE(1)).toBe(4);
    expect(buf.length).toBe(5);
  });
});

describe('buildSASLInitialResponse', () => {
  it('has type byte 0x70 ("p") with mechanism and message', () => {
    const buf = buildSASLInitialResponse('SCRAM-SHA-256', 'n,,n=user,r=nonce123');
    expect(buf[0]).toBe(0x70);
    const len = buf.readInt32BE(1);
    expect(1 + len).toBe(buf.length);
    // Check mechanism name is in the payload
    const mechEnd = buf.indexOf(0, 5);
    const mech = buf.toString('utf8', 5, mechEnd);
    expect(mech).toBe('SCRAM-SHA-256');
    // Check message length
    const msgLen = buf.readInt32BE(mechEnd + 1);
    const msg = buf.toString('utf8', mechEnd + 5, mechEnd + 5 + msgLen);
    expect(msg).toBe('n,,n=user,r=nonce123');
  });
});

describe('buildSASLResponse', () => {
  it('has type byte 0x70 ("p") with message', () => {
    const buf = buildSASLResponse('c=biws,r=nonce,p=proof');
    expect(buf[0]).toBe(0x70);
    const len = buf.readInt32BE(1);
    expect(1 + len).toBe(buf.length);
    const msg = buf.toString('utf8', 5);
    expect(msg).toBe('c=biws,r=nonce,p=proof');
  });
});

describe('buildCloseMessage', () => {
  it('has type byte 0x43 ("C") with statement type', () => {
    const buf = buildCloseMessage('S', 'stmt1');
    expect(buf[0]).toBe(0x43);
    expect(buf[5]).toBe('S'.charCodeAt(0));
    const name = buf.toString('utf8', 6, buf.length - 1);
    expect(name).toBe('stmt1');
  });

  it('supports portal type', () => {
    const buf = buildCloseMessage('P');
    expect(buf[5]).toBe('P'.charCodeAt(0));
  });
});

// ---------------------------------------------------------------------------
// MessageReader — backend message parsing
// ---------------------------------------------------------------------------

describe('MessageReader', () => {
  function makeBackendMessage(typeByte: number, payload: Buffer): Buffer {
    const len = 4 + payload.length;
    const buf = Buffer.alloc(1 + len);
    buf[0] = typeByte;
    buf.writeInt32BE(len, 1);
    payload.copy(buf, 5);
    return buf;
  }

  it('parses AuthenticationOk (R, authType=0)', () => {
    const reader = new MessageReader();
    const payload = Buffer.alloc(4);
    payload.writeInt32BE(0, 0);
    reader.append(makeBackendMessage(0x52, payload));
    const msg = reader.read();
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe(BackendMessageType.AuthenticationOk);
  });

  it('parses AuthenticationCleartextPassword (R, authType=3)', () => {
    const reader = new MessageReader();
    const payload = Buffer.alloc(4);
    payload.writeInt32BE(3, 0);
    reader.append(makeBackendMessage(0x52, payload));
    const msg = reader.read();
    expect(msg!.type).toBe(BackendMessageType.AuthenticationCleartextPassword);
  });

  it('parses AuthenticationMD5Password (R, authType=5) with salt', () => {
    const reader = new MessageReader();
    const payload = Buffer.alloc(8);
    payload.writeInt32BE(5, 0);
    payload[4] = 0xaa;
    payload[5] = 0xbb;
    payload[6] = 0xcc;
    payload[7] = 0xdd;
    reader.append(makeBackendMessage(0x52, payload));
    const msg = reader.read();
    expect(msg!.type).toBe(BackendMessageType.AuthenticationMD5Password);
    if (msg!.type === BackendMessageType.AuthenticationMD5Password) {
      expect(msg!.salt).toEqual(Buffer.from([0xaa, 0xbb, 0xcc, 0xdd]));
    }
  });

  it('parses ParameterStatus (S)', () => {
    const reader = new MessageReader();
    const payload = Buffer.from('server_version\0SixSevenDB 1.0\0', 'utf8');
    reader.append(makeBackendMessage(0x53, payload));
    const msg = reader.read();
    expect(msg!.type).toBe(BackendMessageType.ParameterStatus);
    if (msg!.type === BackendMessageType.ParameterStatus) {
      expect(msg!.name).toBe('server_version');
      expect(msg!.value).toBe('SixSevenDB 1.0');
    }
  });

  it('parses ReadyForQuery (Z)', () => {
    const reader = new MessageReader();
    const payload = Buffer.from('I');
    reader.append(makeBackendMessage(0x5a, payload));
    const msg = reader.read();
    expect(msg!.type).toBe(BackendMessageType.ReadyForQuery);
    if (msg!.type === BackendMessageType.ReadyForQuery) {
      expect(msg!.status).toBe('I');
    }
  });

  it('parses RowDescription (T)', () => {
    const reader = new MessageReader();
    // Build a RowDescription with one field "id" (INT4, typeOID=23)
    const name = Buffer.from('id\0', 'utf8');
    const fieldData = Buffer.alloc(name.length + 18);
    name.copy(fieldData, 0);
    let offset = name.length;
    fieldData.writeInt32BE(0, offset); offset += 4;  // tableOID
    fieldData.writeInt16BE(0, offset); offset += 2;  // columnIndex
    fieldData.writeInt32BE(23, offset); offset += 4;  // typeOID
    fieldData.writeInt16BE(4, offset); offset += 2;  // typeSize
    fieldData.writeInt32BE(-1, offset); offset += 4; // typeModifier
    fieldData.writeInt16BE(0, offset); // formatCode

    const payload = Buffer.alloc(2 + fieldData.length);
    payload.writeInt16BE(1, 0); // field count
    fieldData.copy(payload, 2);

    reader.append(makeBackendMessage(0x54, payload));
    const msg = reader.read();
    expect(msg!.type).toBe(BackendMessageType.RowDescription);
    if (msg!.type === BackendMessageType.RowDescription) {
      expect(msg!.fields.length).toBe(1);
      expect(msg!.fields[0].name).toBe('id');
      expect(msg!.fields[0].typeOID).toBe(23);
    }
  });

  it('parses DataRow (D)', () => {
    const reader = new MessageReader();
    const val1 = Buffer.from('42', 'utf8');
    const val2 = Buffer.from('hello', 'utf8');
    const payload = Buffer.alloc(2 + (4 + val1.length) + (4 + val2.length));
    let offset = 0;
    payload.writeInt16BE(2, offset); offset += 2;
    payload.writeInt32BE(val1.length, offset); offset += 4;
    val1.copy(payload, offset); offset += val1.length;
    payload.writeInt32BE(val2.length, offset); offset += 4;
    val2.copy(payload, offset);

    reader.append(makeBackendMessage(0x44, payload));
    const msg = reader.read();
    expect(msg!.type).toBe(BackendMessageType.DataRow);
    if (msg!.type === BackendMessageType.DataRow) {
      expect(msg!.values).toEqual(['42', 'hello']);
    }
  });

  it('parses DataRow with null values', () => {
    const reader = new MessageReader();
    const payload = Buffer.alloc(2 + 4);
    payload.writeInt16BE(1, 0);
    payload.writeInt32BE(-1, 2); // null
    reader.append(makeBackendMessage(0x44, payload));
    const msg = reader.read();
    if (msg!.type === BackendMessageType.DataRow) {
      expect(msg!.values).toEqual([null]);
    }
  });

  it('parses CommandComplete (C)', () => {
    const reader = new MessageReader();
    const payload = Buffer.from('SELECT 5\0', 'utf8');
    reader.append(makeBackendMessage(0x43, payload));
    const msg = reader.read();
    expect(msg!.type).toBe(BackendMessageType.CommandComplete);
    if (msg!.type === BackendMessageType.CommandComplete) {
      expect(msg!.tag).toBe('SELECT 5');
    }
  });

  it('parses ErrorResponse (E)', () => {
    const reader = new MessageReader();
    // Build error fields: S=ERROR, C=42P01, M=table not found
    const fields = Buffer.concat([
      Buffer.from([0x53]), Buffer.from('ERROR\0', 'utf8'),
      Buffer.from([0x43]), Buffer.from('42P01\0', 'utf8'),
      Buffer.from([0x4d]), Buffer.from('table not found\0', 'utf8'),
      Buffer.from([0x00]),
    ]);
    reader.append(makeBackendMessage(0x45, fields));
    const msg = reader.read();
    expect(msg!.type).toBe(BackendMessageType.ErrorResponse);
    if (msg!.type === BackendMessageType.ErrorResponse) {
      expect(msg!.severity).toBe('ERROR');
      expect(msg!.code).toBe('42P01');
      expect(msg!.message).toBe('table not found');
    }
  });

  it('parses ParseComplete (1)', () => {
    const reader = new MessageReader();
    reader.append(makeBackendMessage(0x31, Buffer.alloc(0)));
    const msg = reader.read();
    expect(msg!.type).toBe(BackendMessageType.ParseComplete);
  });

  it('parses BindComplete (2)', () => {
    const reader = new MessageReader();
    reader.append(makeBackendMessage(0x32, Buffer.alloc(0)));
    const msg = reader.read();
    expect(msg!.type).toBe(BackendMessageType.BindComplete);
  });

  it('parses NoData (n)', () => {
    const reader = new MessageReader();
    reader.append(makeBackendMessage(0x6e, Buffer.alloc(0)));
    const msg = reader.read();
    expect(msg!.type).toBe(BackendMessageType.NoData);
  });

  it('returns null when not enough data', () => {
    const reader = new MessageReader();
    reader.append(Buffer.from([0x5a])); // only 1 byte, need at least 5
    expect(reader.read()).toBeNull();
  });

  it('handles multiple messages in a single chunk', () => {
    const reader = new MessageReader();
    const msg1 = makeBackendMessage(0x31, Buffer.alloc(0)); // ParseComplete
    const msg2 = makeBackendMessage(0x32, Buffer.alloc(0)); // BindComplete
    reader.append(Buffer.concat([msg1, msg2]));

    const parsed1 = reader.read();
    expect(parsed1!.type).toBe(BackendMessageType.ParseComplete);
    const parsed2 = reader.read();
    expect(parsed2!.type).toBe(BackendMessageType.BindComplete);
    expect(reader.read()).toBeNull();
  });

  it('handles split messages across chunks', () => {
    const reader = new MessageReader();
    const full = makeBackendMessage(0x5a, Buffer.from('I'));
    // Split in the middle
    reader.append(full.subarray(0, 3));
    expect(reader.read()).toBeNull();
    reader.append(full.subarray(3));
    const msg = reader.read();
    expect(msg!.type).toBe(BackendMessageType.ReadyForQuery);
  });

  it('parses AuthenticationSASL (R, authType=10) with mechanisms', () => {
    const reader = new MessageReader();
    const mechList = Buffer.from('SCRAM-SHA-256\0\0', 'utf8');
    const payload = Buffer.alloc(4 + mechList.length);
    payload.writeInt32BE(10, 0);
    mechList.copy(payload, 4);
    reader.append(makeBackendMessage(0x52, payload));
    const msg = reader.read();
    expect(msg!.type).toBe(BackendMessageType.AuthenticationSASL);
    if (msg!.type === BackendMessageType.AuthenticationSASL) {
      expect(msg!.mechanisms).toEqual(['SCRAM-SHA-256']);
    }
  });

  it('parses AuthenticationSASLContinue (R, authType=11)', () => {
    const reader = new MessageReader();
    const serverFirst = 'r=clientNonce+serverNonce,s=c2FsdA==,i=4096';
    const msgBytes = Buffer.from(serverFirst, 'utf8');
    const payload = Buffer.alloc(4 + msgBytes.length);
    payload.writeInt32BE(11, 0);
    msgBytes.copy(payload, 4);
    reader.append(makeBackendMessage(0x52, payload));
    const msg = reader.read();
    expect(msg!.type).toBe(BackendMessageType.AuthenticationSASLContinue);
    if (msg!.type === BackendMessageType.AuthenticationSASLContinue) {
      expect(msg!.data).toBe(serverFirst);
    }
  });

  it('parses AuthenticationSASLFinal (R, authType=12)', () => {
    const reader = new MessageReader();
    const serverFinal = 'v=someBase64Signature';
    const msgBytes = Buffer.from(serverFinal, 'utf8');
    const payload = Buffer.alloc(4 + msgBytes.length);
    payload.writeInt32BE(12, 0);
    msgBytes.copy(payload, 4);
    reader.append(makeBackendMessage(0x52, payload));
    const msg = reader.read();
    expect(msg!.type).toBe(BackendMessageType.AuthenticationSASLFinal);
    if (msg!.type === BackendMessageType.AuthenticationSASLFinal) {
      expect(msg!.data).toBe(serverFinal);
    }
  });

  it('parses CloseComplete (3)', () => {
    const reader = new MessageReader();
    reader.append(makeBackendMessage(0x33, Buffer.alloc(0)));
    const msg = reader.read();
    expect(msg!.type).toBe(BackendMessageType.CloseComplete);
  });
});

// ---------------------------------------------------------------------------
// SCRAM-SHA-256 helpers
// ---------------------------------------------------------------------------

describe('generateClientNonce', () => {
  it('generates a base64-encoded nonce', () => {
    const nonce = generateClientNonce();
    expect(typeof nonce).toBe('string');
    expect(nonce.length).toBeGreaterThan(0);
    // Should be valid base64
    expect(Buffer.from(nonce, 'base64').toString('base64')).toBe(nonce);
  });

  it('generates unique nonces', () => {
    const n1 = generateClientNonce();
    const n2 = generateClientNonce();
    expect(n1).not.toBe(n2);
  });
});

describe('buildClientFirstMessage', () => {
  it('builds gs2-header + bare message', () => {
    const msg = buildClientFirstMessage('user', 'rOprNGfwEbeRWgbNEkqO');
    expect(msg).toBe('n,,n=user,r=rOprNGfwEbeRWgbNEkqO');
  });

  it('escapes special characters in username', () => {
    const msg = buildClientFirstMessage('us=er,name', 'nonce');
    expect(msg).toBe('n,,n=us=3Der=2Cname,r=nonce');
  });
});

describe('parseServerFirstMessage', () => {
  it('extracts nonce, salt, and iterations', () => {
    const salt = Buffer.from('salt').toString('base64');
    const data = `r=clientNonce+serverNonce,s=${salt},i=4096`;
    const result = parseServerFirstMessage(data);
    expect(result.nonce).toBe('clientNonce+serverNonce');
    expect(result.salt).toEqual(Buffer.from('salt'));
    expect(result.iterations).toBe(4096);
  });

  it('throws on malformed message', () => {
    expect(() => parseServerFirstMessage('invalid')).toThrow('invalid SCRAM');
  });
});

describe('computeSaltedPassword', () => {
  it('computes PBKDF2-SHA-256 with given parameters', () => {
    const salt = Buffer.from('salt');
    const result = computeSaltedPassword('password', salt, 4096);
    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBe(32);
  });

  it('is deterministic', () => {
    const salt = Buffer.from('test-salt');
    const r1 = computeSaltedPassword('pwd', salt, 1000);
    const r2 = computeSaltedPassword('pwd', salt, 1000);
    expect(r1).toEqual(r2);
  });
});

describe('computeClientProof', () => {
  it('returns clientProof and serverSignature as base64', () => {
    const salt = Buffer.from('test-salt');
    const saltedPwd = computeSaltedPassword('password', salt, 4096);
    const result = computeClientProof(saltedPwd, 'test auth message');
    expect(typeof result.clientProof).toBe('string');
    expect(typeof result.serverSignature).toBe('string');
    // Both should be valid base64
    expect(Buffer.from(result.clientProof, 'base64').length).toBeGreaterThan(0);
    expect(Buffer.from(result.serverSignature, 'base64').length).toBeGreaterThan(0);
  });
});

describe('verifyServerSignature', () => {
  it('succeeds with matching signature', () => {
    const sig = 'dGVzdFNpZw==';
    expect(() => verifyServerSignature(`v=${sig}`, sig)).not.toThrow();
  });

  it('throws on mismatch', () => {
    expect(() => verifyServerSignature('v=wrong', 'correct')).toThrow('verification failed');
  });
});
