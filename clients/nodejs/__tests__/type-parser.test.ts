import { describe, it, expect } from 'vitest';
import {
  TypeOID,
  parseEmbedding,
  serializeEmbedding,
  parseValue,
  numericToNumber,
} from '../src/type-parser';

describe('TypeOID', () => {
  it('has EMBEDDING = 100000', () => {
    expect(TypeOID.EMBEDDING).toBe(100000);
  });

  it('has standard OIDs', () => {
    expect(TypeOID.BOOL).toBe(16);
    expect(TypeOID.INT4).toBe(23);
    expect(TypeOID.TEXT).toBe(25);
    expect(TypeOID.JSON).toBe(114);
    expect(TypeOID.FLOAT8).toBe(701);
    expect(TypeOID.UUID).toBe(2950);
  });
});

describe('parseValue', () => {
  it('parses BOOL true', () => {
    expect(parseValue(TypeOID.BOOL, 't')).toBe(true);
    expect(parseValue(TypeOID.BOOL, 'true')).toBe(true);
    expect(parseValue(TypeOID.BOOL, 'TRUE')).toBe(true);
    expect(parseValue(TypeOID.BOOL, '1')).toBe(true);
  });

  it('parses BOOL false', () => {
    expect(parseValue(TypeOID.BOOL, 'f')).toBe(false);
    expect(parseValue(TypeOID.BOOL, 'false')).toBe(false);
    expect(parseValue(TypeOID.BOOL, '0')).toBe(false);
  });

  it('parses INT2', () => {
    expect(parseValue(TypeOID.INT2, '42')).toBe(42);
    expect(parseValue(TypeOID.INT2, '-10')).toBe(-10);
  });

  it('parses INT4', () => {
    expect(parseValue(TypeOID.INT4, '12345')).toBe(12345);
  });

  it('parses INT8 as number when safe', () => {
    expect(parseValue(TypeOID.INT8, '999')).toBe(999);
  });

  it('parses INT8 as BigInt for unsafe integers', () => {
    const big = '9007199254740993'; // Number.MAX_SAFE_INTEGER + 2
    const result = parseValue(TypeOID.INT8, big);
    expect(typeof result).toBe('bigint');
    expect(result).toBe(BigInt(big));
  });

  it('parses FLOAT4', () => {
    expect(parseValue(TypeOID.FLOAT4, '3.14')).toBeCloseTo(3.14);
  });

  it('parses FLOAT8', () => {
    expect(parseValue(TypeOID.FLOAT8, '2.718281828')).toBeCloseTo(2.718281828);
  });

  it('parses JSON', () => {
    const result = parseValue(TypeOID.JSON, '{"key":"value"}');
    expect(result).toEqual({ key: 'value' });
  });

  it('parses EMBEDDING into Float32Array', () => {
    const result = parseValue(TypeOID.EMBEDDING, '[0.1,0.2,0.3]');
    expect(result).toBeInstanceOf(Float32Array);
    const arr = result as Float32Array;
    expect(arr.length).toBe(3);
    expect(arr[0]).toBeCloseTo(0.1);
  });

  it('returns raw string for TEXT', () => {
    expect(parseValue(TypeOID.TEXT, 'hello')).toBe('hello');
  });

  it('parses UUID and lowercases', () => {
    const uuid = '550E8400-E29B-41D4-A716-446655440000';
    expect(parseValue(TypeOID.UUID, uuid)).toBe(uuid.toLowerCase());
  });

  it('returns raw string for unknown OID', () => {
    expect(parseValue(99999, 'whatever')).toBe('whatever');
  });

  // GDB-395: Temporal parsers
  it('parses DATE to Date object', () => {
    const result = parseValue(TypeOID.DATE, '2024-01-15') as Date;
    expect(result).toBeInstanceOf(Date);
    expect(result.getUTCFullYear()).toBe(2024);
    expect(result.getUTCMonth()).toBe(0); // January
    expect(result.getUTCDate()).toBe(15);
  });

  it('parses TIMESTAMP to Date object', () => {
    const result = parseValue(TypeOID.TIMESTAMP, '2024-01-15 14:30:00') as Date;
    expect(result).toBeInstanceOf(Date);
    expect(result.getUTCHours()).toBe(14);
    expect(result.getUTCMinutes()).toBe(30);
  });

  it('parses TIME as string', () => {
    expect(parseValue(TypeOID.TIME, '14:30:00')).toBe('14:30:00');
  });

  it('parses INTERVAL to structured object', () => {
    const result = parseValue(TypeOID.INTERVAL, '1 year 2 mons 3 days 04:05:06') as any;
    expect(result.years).toBe(1);
    expect(result.months).toBe(2);
    expect(result.days).toBe(3);
    expect(result.hours).toBe(4);
    expect(result.minutes).toBe(5);
    expect(result.seconds).toBe(6);
  });

  it('parses zero INTERVAL', () => {
    const result = parseValue(TypeOID.INTERVAL, '00:00:00') as any;
    expect(result.years).toBe(0);
    expect(result.months).toBe(0);
    expect(result.days).toBe(0);
    expect(result.hours).toBe(0);
    expect(result.minutes).toBe(0);
    expect(result.seconds).toBe(0);
  });

  // GDB-396: NUMERIC, unsigned ints, BLOB, UUID
  it('parses NUMERIC as string (preserves precision)', () => {
    expect(parseValue(TypeOID.NUMERIC, '123456789.123456789')).toBe('123456789.123456789');
  });

  it('parses TINYINT', () => {
    expect(parseValue(TypeOID.TINYINT, '127')).toBe(127);
  });

  it('parses UINT8', () => {
    expect(parseValue(TypeOID.UINT8, '255')).toBe(255);
  });

  it('parses UINT16', () => {
    expect(parseValue(TypeOID.UINT16, '65535')).toBe(65535);
  });

  it('parses UINT32', () => {
    expect(parseValue(TypeOID.UINT32, '4294967295')).toBe(4294967295);
  });

  it('parses UINT64 as number when safe', () => {
    expect(parseValue(TypeOID.UINT64, '42')).toBe(42);
  });

  it('parses UINT64 as BigInt when unsafe', () => {
    const result = parseValue(TypeOID.UINT64, '18446744073709551615');
    expect(typeof result).toBe('bigint');
  });

  it('parses BYTEA hex to Buffer', () => {
    const result = parseValue(TypeOID.BYTEA, '\\xDEADBEEF') as Buffer;
    expect(result).toBeInstanceOf(Buffer);
    expect(result.toString('hex')).toBe('deadbeef');
  });

  it('parses CHAR as string', () => {
    expect(parseValue(TypeOID.CHAR, 'A')).toBe('A');
  });

  it('parses VARCHAR as string', () => {
    expect(parseValue(TypeOID.VARCHAR, 'hello')).toBe('hello');
  });
});

describe('numericToNumber', () => {
  it('converts numeric string to number', () => {
    expect(numericToNumber('123.456')).toBe(123.456);
  });
});

describe('parseEmbedding', () => {
  it('parses a vector string into Float32Array', () => {
    const result = parseEmbedding('[0.1,0.2,0.3]');
    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(3);
    expect(result[0]).toBeCloseTo(0.1);
    expect(result[1]).toBeCloseTo(0.2);
    expect(result[2]).toBeCloseTo(0.3);
  });

  it('handles empty embedding', () => {
    const result = parseEmbedding('[]');
    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(0);
  });

  it('handles single-element embedding', () => {
    const result = parseEmbedding('[1.5]');
    expect(result.length).toBe(1);
    expect(result[0]).toBeCloseTo(1.5);
  });

  it('handles negative values', () => {
    const result = parseEmbedding('[-0.5,0.0,0.5]');
    expect(result.length).toBe(3);
    expect(result[0]).toBeCloseTo(-0.5);
    expect(result[1]).toBeCloseTo(0.0);
    expect(result[2]).toBeCloseTo(0.5);
  });
});

describe('serializeEmbedding', () => {
  it('serializes a Float32Array to bracket-delimited string', () => {
    const arr = new Float32Array([0.1, 0.2, 0.3]);
    const result = serializeEmbedding(arr);
    expect(result).toMatch(/^\[.*\]$/);
    const parsed = parseEmbedding(result);
    expect(parsed[0]).toBeCloseTo(0.1);
  });

  it('serializes a number array', () => {
    const result = serializeEmbedding([1.0, 2.0, 3.0]);
    expect(result).toBe('[1,2,3]');
  });

  it('handles empty array', () => {
    const result = serializeEmbedding(new Float32Array(0));
    expect(result).toBe('[]');
  });

  it('round-trips correctly', () => {
    const original = new Float32Array([0.5, -0.25, 0.75, 0.0]);
    const serialized = serializeEmbedding(original);
    const parsed = parseEmbedding(serialized);
    expect(parsed.length).toBe(original.length);
    for (let i = 0; i < original.length; i++) {
      expect(parsed[i]).toBeCloseTo(original[i]);
    }
  });
});
