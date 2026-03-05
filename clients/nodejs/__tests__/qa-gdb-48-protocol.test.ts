/**
 * QA adversarial tests for protocol.ts — GDB-48
 *
 * Tests edge cases, boundary values, malformed input, and error paths
 * for the wire protocol message encoding and decoding.
 */
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
  MessageReader,
  BackendMessageType,
} from '../src/protocol';

// Helper to build a backend message buffer
function makeBackendMessage(typeByte: number, payload: Buffer): Buffer {
  const len = 4 + payload.length;
  const buf = Buffer.alloc(1 + len);
  buf[0] = typeByte;
  buf.writeInt32BE(len, 1);
  payload.copy(buf, 5);
  return buf;
}

// ---------------------------------------------------------------------------
// Frontend message builders — edge cases
// ---------------------------------------------------------------------------

describe('QA: buildStartupMessage edge cases', () => {
  it('should handle empty user and database', () => {
    const buf = buildStartupMessage('', '');
    const len = buf.readInt32BE(0);
    expect(len).toBe(buf.length);
    expect(buf.readInt32BE(4)).toBe(196608);
  });

  it('should handle unicode user and database names', () => {
    const buf = buildStartupMessage('用户', '数据库');
    const len = buf.readInt32BE(0);
    expect(len).toBe(buf.length);
    const content = buf.toString('utf8', 8);
    expect(content).toContain('用户');
    expect(content).toContain('数据库');
  });

  it('should handle very long user and database names', () => {
    const longName = 'a'.repeat(1000);
    const buf = buildStartupMessage(longName, longName);
    const len = buf.readInt32BE(0);
    expect(len).toBe(buf.length);
  });
});

describe('QA: buildPasswordMessage edge cases', () => {
  it('should handle empty password', () => {
    const buf = buildPasswordMessage('');
    expect(buf[0]).toBe(0x70);
    // Payload is just the null terminator
    expect(buf.length).toBe(6); // type(1) + len(4) + \0(1)
  });

  it('should handle password with null bytes', () => {
    const buf = buildPasswordMessage('pass\0word');
    expect(buf[0]).toBe(0x70);
    // The password includes an embedded null, which may cause issues
    // with the server, but the builder should encode it faithfully
    const len = buf.readInt32BE(1);
    expect(1 + len).toBe(buf.length);
  });
});

describe('QA: buildMD5PasswordMessage edge cases', () => {
  it('should produce consistent output for same inputs', () => {
    const salt = Buffer.from([0x01, 0x02, 0x03, 0x04]);
    const buf1 = buildMD5PasswordMessage('user', 'pass', salt);
    const buf2 = buildMD5PasswordMessage('user', 'pass', salt);
    expect(buf1).toEqual(buf2);
  });

  it('should produce different output for different salts', () => {
    const salt1 = Buffer.from([0x01, 0x02, 0x03, 0x04]);
    const salt2 = Buffer.from([0x05, 0x06, 0x07, 0x08]);
    const buf1 = buildMD5PasswordMessage('user', 'pass', salt1);
    const buf2 = buildMD5PasswordMessage('user', 'pass', salt2);
    expect(buf1).not.toEqual(buf2);
  });

  it('should handle empty password and user', () => {
    const salt = Buffer.from([0x00, 0x00, 0x00, 0x00]);
    const buf = buildMD5PasswordMessage('', '', salt);
    expect(buf[0]).toBe(0x70);
    const payload = buf.toString('utf8', 5, buf.length - 1);
    expect(payload.startsWith('md5')).toBe(true);
  });
});

describe('QA: buildQueryMessage edge cases', () => {
  it('should handle empty SQL', () => {
    const buf = buildQueryMessage('');
    expect(buf[0]).toBe(0x51);
    // Should still have null terminator
    expect(buf[buf.length - 1]).toBe(0);
  });

  it('should handle SQL with unicode', () => {
    const buf = buildQueryMessage("SELECT '日本語'");
    expect(buf[0]).toBe(0x51);
    const sql = buf.toString('utf8', 5, buf.length - 1);
    expect(sql).toContain('日本語');
  });

  it('should handle very large SQL queries', () => {
    const longSQL = 'SELECT ' + 'col, '.repeat(10000) + 'col FROM t';
    const buf = buildQueryMessage(longSQL);
    expect(buf[0]).toBe(0x51);
    const len = buf.readInt32BE(1);
    expect(1 + len).toBe(buf.length);
  });
});

describe('QA: buildBindMessage edge cases', () => {
  it('should handle empty params array', () => {
    const buf = buildBindMessage([]);
    expect(buf[0]).toBe(0x42);
    const len = buf.readInt32BE(1);
    expect(1 + len).toBe(buf.length);
  });

  it('should handle all null params', () => {
    const buf = buildBindMessage([null, null, null]);
    expect(buf[0]).toBe(0x42);
    const len = buf.readInt32BE(1);
    expect(1 + len).toBe(buf.length);
  });

  it('should handle very long string params', () => {
    const longVal = 'x'.repeat(100000);
    const buf = buildBindMessage([longVal]);
    expect(buf[0]).toBe(0x42);
    const len = buf.readInt32BE(1);
    expect(1 + len).toBe(buf.length);
  });

  it('should handle mixed null and value params', () => {
    const buf = buildBindMessage(['hello', null, 'world', null]);
    expect(buf[0]).toBe(0x42);
    const len = buf.readInt32BE(1);
    expect(1 + len).toBe(buf.length);
  });

  it('should handle params with unicode', () => {
    const buf = buildBindMessage(['こんにちは', '🎉']);
    expect(buf[0]).toBe(0x42);
  });

  it('should handle custom portal and statement names', () => {
    const buf = buildBindMessage(['val'], 'portal1', 'stmt1');
    expect(buf[0]).toBe(0x42);
    const content = buf.toString('utf8', 5);
    expect(content).toContain('portal1');
    expect(content).toContain('stmt1');
  });
});

describe('QA: buildParseMessage edge cases', () => {
  it('should handle named statements', () => {
    const buf = buildParseMessage('SELECT $1', 'my_stmt');
    expect(buf[0]).toBe(0x50);
    const content = buf.toString('utf8', 5);
    expect(content).toContain('my_stmt');
  });

  it('should handle empty SQL', () => {
    const buf = buildParseMessage('');
    expect(buf[0]).toBe(0x50);
    const len = buf.readInt32BE(1);
    expect(1 + len).toBe(buf.length);
  });
});

describe('QA: buildExecuteMessage edge cases', () => {
  it('should handle named portal', () => {
    const buf = buildExecuteMessage('portal1');
    expect(buf[0]).toBe(0x45);
  });

  it('should handle maxRows limit', () => {
    const buf = buildExecuteMessage('', 100);
    expect(buf[0]).toBe(0x45);
    // maxRows should be written at end
    const nameEnd = 6; // 'E' + len(4) + '\0'(1)
    expect(buf.readInt32BE(nameEnd)).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// MessageReader — adversarial
// ---------------------------------------------------------------------------

describe('QA: MessageReader adversarial', () => {
  it('should return null for empty buffer', () => {
    const reader = new MessageReader();
    expect(reader.read()).toBeNull();
  });

  it('should return null for exactly 4 bytes (not enough for header)', () => {
    const reader = new MessageReader();
    reader.append(Buffer.from([0x5a, 0x00, 0x00, 0x00]));
    expect(reader.read()).toBeNull();
  });

  it('should handle message with zero-length payload', () => {
    const reader = new MessageReader();
    // ParseComplete has no payload
    reader.append(makeBackendMessage(0x31, Buffer.alloc(0)));
    const msg = reader.read();
    expect(msg).not.toBeNull();
    expect(msg!.type).toBe(BackendMessageType.ParseComplete);
  });

  it('should throw for unknown backend message type', () => {
    const reader = new MessageReader();
    reader.append(makeBackendMessage(0xff, Buffer.alloc(0)));
    expect(() => reader.read()).toThrow('unknown backend message type: 0xff');
  });

  it('should throw for unsupported authentication type', () => {
    const reader = new MessageReader();
    const payload = Buffer.alloc(4);
    payload.writeInt32BE(7, 0); // SASL auth = type 10, type 7 is unknown
    reader.append(makeBackendMessage(0x52, payload));
    expect(() => reader.read()).toThrow('unsupported authentication type: 7');
  });

  it('should handle ErrorResponse with missing fields', () => {
    const reader = new MessageReader();
    // ErrorResponse with only terminator, no fields
    const payload = Buffer.from([0x00]);
    reader.append(makeBackendMessage(0x45, payload));
    const msg = reader.read();
    expect(msg!.type).toBe(BackendMessageType.ErrorResponse);
    if (msg!.type === BackendMessageType.ErrorResponse) {
      expect(msg!.severity).toBe('');
      expect(msg!.code).toBe('');
      expect(msg!.message).toBe('');
    }
  });

  it('should handle NoticeResponse with missing fields', () => {
    const reader = new MessageReader();
    const payload = Buffer.from([0x00]);
    reader.append(makeBackendMessage(0x4e, payload));
    const msg = reader.read();
    expect(msg!.type).toBe(BackendMessageType.NoticeResponse);
    if (msg!.type === BackendMessageType.NoticeResponse) {
      expect(msg!.severity).toBe('');
      expect(msg!.message).toBe('');
    }
  });

  it('should parse ErrorResponse with extra fields beyond S/C/M', () => {
    const reader = new MessageReader();
    const fields = Buffer.concat([
      Buffer.from([0x53]), Buffer.from('ERROR\0', 'utf8'),
      Buffer.from([0x43]), Buffer.from('42P01\0', 'utf8'),
      Buffer.from([0x4d]), Buffer.from('table not found\0', 'utf8'),
      Buffer.from([0x44]), Buffer.from('details here\0', 'utf8'), // Detail field
      Buffer.from([0x48]), Buffer.from('try something else\0', 'utf8'), // Hint field
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

  it('should handle DataRow with zero columns', () => {
    const reader = new MessageReader();
    const payload = Buffer.alloc(2);
    payload.writeInt16BE(0, 0);
    reader.append(makeBackendMessage(0x44, payload));
    const msg = reader.read();
    expect(msg!.type).toBe(BackendMessageType.DataRow);
    if (msg!.type === BackendMessageType.DataRow) {
      expect(msg!.values).toEqual([]);
    }
  });

  it('should handle DataRow with very long column values', () => {
    const reader = new MessageReader();
    const longVal = Buffer.from('x'.repeat(100000), 'utf8');
    const payload = Buffer.alloc(2 + 4 + longVal.length);
    payload.writeInt16BE(1, 0);
    payload.writeInt32BE(longVal.length, 2);
    longVal.copy(payload, 6);
    reader.append(makeBackendMessage(0x44, payload));
    const msg = reader.read();
    expect(msg!.type).toBe(BackendMessageType.DataRow);
    if (msg!.type === BackendMessageType.DataRow) {
      expect(msg!.values[0]!.length).toBe(100000);
    }
  });

  it('should handle RowDescription with zero fields', () => {
    const reader = new MessageReader();
    const payload = Buffer.alloc(2);
    payload.writeInt16BE(0, 0);
    reader.append(makeBackendMessage(0x54, payload));
    const msg = reader.read();
    expect(msg!.type).toBe(BackendMessageType.RowDescription);
    if (msg!.type === BackendMessageType.RowDescription) {
      expect(msg!.fields).toEqual([]);
    }
  });

  it('should handle RowDescription with many fields', () => {
    const reader = new MessageReader();
    const fieldCount = 100;
    const buffers: Buffer[] = [];
    const countBuf = Buffer.alloc(2);
    countBuf.writeInt16BE(fieldCount, 0);
    buffers.push(countBuf);

    for (let i = 0; i < fieldCount; i++) {
      const name = Buffer.from(`col_${i}\0`, 'utf8');
      const meta = Buffer.alloc(18);
      meta.writeInt32BE(0, 0);   // tableOID
      meta.writeInt16BE(i, 4);   // columnIndex
      meta.writeInt32BE(25, 6);  // typeOID (TEXT)
      meta.writeInt16BE(-1, 10); // typeSize
      meta.writeInt32BE(-1, 12); // typeModifier
      meta.writeInt16BE(0, 16);  // formatCode
      buffers.push(name, meta);
    }

    reader.append(makeBackendMessage(0x54, Buffer.concat(buffers)));
    const msg = reader.read();
    expect(msg!.type).toBe(BackendMessageType.RowDescription);
    if (msg!.type === BackendMessageType.RowDescription) {
      expect(msg!.fields.length).toBe(fieldCount);
      expect(msg!.fields[0].name).toBe('col_0');
      expect(msg!.fields[99].name).toBe('col_99');
    }
  });

  it('should handle receiving multiple messages byte-by-byte', () => {
    const reader = new MessageReader();
    const msg1 = makeBackendMessage(0x31, Buffer.alloc(0)); // ParseComplete
    const msg2 = makeBackendMessage(0x32, Buffer.alloc(0)); // BindComplete
    const combined = Buffer.concat([msg1, msg2]);

    // Feed one byte at a time
    for (let i = 0; i < combined.length; i++) {
      reader.append(Buffer.from([combined[i]]));
      // Try reading — should return null until enough data
      if (i < msg1.length - 1) {
        expect(reader.read()).toBeNull();
      }
    }

    const parsed1 = reader.read();
    expect(parsed1!.type).toBe(BackendMessageType.ParseComplete);
    const parsed2 = reader.read();
    expect(parsed2!.type).toBe(BackendMessageType.BindComplete);
  });

  it('should handle CommandComplete with multi-word tags', () => {
    const reader = new MessageReader();
    // INSERT 0 5 — means "INSERT, OID=0, rowcount=5"
    const payload = Buffer.from('INSERT 0 5\0', 'utf8');
    reader.append(makeBackendMessage(0x43, payload));
    const msg = reader.read();
    expect(msg!.type).toBe(BackendMessageType.CommandComplete);
    if (msg!.type === BackendMessageType.CommandComplete) {
      expect(msg!.tag).toBe('INSERT 0 5');
    }
  });

  it('should handle EmptyQueryResponse', () => {
    const reader = new MessageReader();
    reader.append(makeBackendMessage(0x49, Buffer.alloc(0)));
    const msg = reader.read();
    expect(msg!.type).toBe(BackendMessageType.EmptyQueryResponse);
  });

  it('should handle BackendKeyData', () => {
    const reader = new MessageReader();
    const payload = Buffer.alloc(8);
    payload.writeInt32BE(12345, 0);
    payload.writeInt32BE(67890, 4);
    reader.append(makeBackendMessage(0x4b, payload));
    const msg = reader.read();
    expect(msg!.type).toBe(BackendMessageType.BackendKeyData);
    if (msg!.type === BackendMessageType.BackendKeyData) {
      expect(msg!.processId).toBe(12345);
      expect(msg!.secretKey).toBe(67890);
    }
  });
});
