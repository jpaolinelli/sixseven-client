/**
 * QA adversarial tests for type-parser.ts — GDB-48
 *
 * Tests edge cases, boundary values, malformed input, and error paths
 * for the type parsing system.
 */
import { describe, it, expect } from 'vitest';
import {
  TypeOID,
  parseEmbedding,
  serializeEmbedding,
  parseValue,
} from '../src/type-parser';

// ---------------------------------------------------------------------------
// parseValue — boundary and edge cases
// ---------------------------------------------------------------------------

describe('QA: parseValue edge cases', () => {
  describe('BOOL parsing', () => {
    it('should return false for unexpected string values', () => {
      // Any string not in the truthy set should be false
      expect(parseValue(TypeOID.BOOL, 'yes')).toBe(false);
      expect(parseValue(TypeOID.BOOL, 'Y')).toBe(false);
      expect(parseValue(TypeOID.BOOL, '')).toBe(false);
    });

    it('should handle whitespace-padded bool values', () => {
      // Whitespace-padded values should NOT match
      expect(parseValue(TypeOID.BOOL, ' t')).toBe(false);
      expect(parseValue(TypeOID.BOOL, 't ')).toBe(false);
    });
  });

  describe('INT2 parsing', () => {
    it('should handle zero', () => {
      expect(parseValue(TypeOID.INT2, '0')).toBe(0);
    });

    it('should handle INT2 max boundary (32767)', () => {
      expect(parseValue(TypeOID.INT2, '32767')).toBe(32767);
    });

    it('should handle INT2 min boundary (-32768)', () => {
      expect(parseValue(TypeOID.INT2, '-32768')).toBe(-32768);
    });

    it('should return NaN for non-numeric strings', () => {
      const result = parseValue(TypeOID.INT2, 'abc');
      expect(result).toBeNaN();
    });

    it('should return NaN for empty string', () => {
      const result = parseValue(TypeOID.INT2, '');
      expect(result).toBeNaN();
    });
  });

  describe('INT4 parsing', () => {
    it('should handle INT4 max boundary (2147483647)', () => {
      expect(parseValue(TypeOID.INT4, '2147483647')).toBe(2147483647);
    });

    it('should handle INT4 min boundary (-2147483648)', () => {
      expect(parseValue(TypeOID.INT4, '-2147483648')).toBe(-2147483648);
    });
  });

  describe('INT8 parsing', () => {
    it('should handle Number.MAX_SAFE_INTEGER as number', () => {
      const result = parseValue(TypeOID.INT8, '9007199254740991');
      expect(typeof result).toBe('number');
      expect(result).toBe(9007199254740991);
    });

    it('should handle Number.MAX_SAFE_INTEGER + 1 as bigint', () => {
      const result = parseValue(TypeOID.INT8, '9007199254740992');
      expect(typeof result).toBe('bigint');
      expect(result).toBe(BigInt('9007199254740992'));
    });

    it('should handle negative bigints', () => {
      const result = parseValue(TypeOID.INT8, '-9007199254740993');
      expect(typeof result).toBe('bigint');
      expect(result).toBe(BigInt('-9007199254740993'));
    });

    it('should handle zero as number', () => {
      expect(parseValue(TypeOID.INT8, '0')).toBe(0);
    });

    it('should throw for non-numeric values requiring BigInt path', () => {
      // "abc" -> Number("abc") = NaN, NaN is not safe integer -> BigInt("abc") throws
      expect(() => parseValue(TypeOID.INT8, 'abc')).toThrow();
    });

    it('should throw for decimal values on BigInt path', () => {
      // "1.5" -> Number("1.5") = 1.5, not safe integer -> BigInt("1.5") throws
      expect(() => parseValue(TypeOID.INT8, '99999999999999999.5')).toThrow();
    });
  });

  describe('FLOAT4 / FLOAT8 parsing', () => {
    it('should handle Infinity string', () => {
      expect(parseValue(TypeOID.FLOAT8, 'Infinity')).toBe(Infinity);
    });

    it('should handle -Infinity string', () => {
      expect(parseValue(TypeOID.FLOAT8, '-Infinity')).toBe(-Infinity);
    });

    it('should handle NaN string', () => {
      expect(parseValue(TypeOID.FLOAT8, 'NaN')).toBeNaN();
    });

    it('should handle very small float', () => {
      const result = parseValue(TypeOID.FLOAT4, '1e-38') as number;
      expect(result).toBeGreaterThan(0);
    });

    it('should handle very large float', () => {
      const result = parseValue(TypeOID.FLOAT4, '3.4e38') as number;
      expect(result).toBe(3.4e38);
    });

    it('should handle zero float', () => {
      expect(parseValue(TypeOID.FLOAT4, '0.0')).toBe(0);
    });

    it('should handle negative zero', () => {
      expect(parseValue(TypeOID.FLOAT8, '-0')).toBe(-0);
    });
  });

  describe('JSON parsing', () => {
    it('should parse a valid JSON object', () => {
      expect(parseValue(TypeOID.JSON, '{"a":1}')).toEqual({ a: 1 });
    });

    it('should parse a JSON array', () => {
      expect(parseValue(TypeOID.JSON, '[1,2,3]')).toEqual([1, 2, 3]);
    });

    it('should parse JSON null', () => {
      expect(parseValue(TypeOID.JSON, 'null')).toBeNull();
    });

    it('should parse JSON boolean', () => {
      expect(parseValue(TypeOID.JSON, 'true')).toBe(true);
    });

    it('should parse JSON number', () => {
      expect(parseValue(TypeOID.JSON, '42')).toBe(42);
    });

    it('should parse JSON string', () => {
      expect(parseValue(TypeOID.JSON, '"hello"')).toBe('hello');
    });

    it('should throw on malformed JSON', () => {
      expect(() => parseValue(TypeOID.JSON, '{invalid}')).toThrow();
    });

    it('should throw on empty string as JSON', () => {
      expect(() => parseValue(TypeOID.JSON, '')).toThrow();
    });

    it('should handle deeply nested JSON', () => {
      const deep = '{"a":{"b":{"c":{"d":{"e":"deep"}}}}}';
      const result = parseValue(TypeOID.JSON, deep);
      expect((result as any).a.b.c.d.e).toBe('deep');
    });

    it('should handle JSON with special characters', () => {
      const result = parseValue(TypeOID.JSON, '{"key":"value with \\"quotes\\""}');
      expect((result as any).key).toBe('value with "quotes"');
    });
  });

  describe('EMBEDDING parsing', () => {
    it('should return Float32Array for embeddings', () => {
      const result = parseValue(TypeOID.EMBEDDING, '[0.1,0.2,0.3]');
      expect(result).toBeInstanceOf(Float32Array);
    });
  });

  describe('Registered and unknown OIDs', () => {
    it('should parse NUMERIC OID to string', () => {
      expect(parseValue(TypeOID.NUMERIC, '12345.6789')).toBe('12345.6789');
    });

    it('should parse DATE OID to Date object', () => {
      const result = parseValue(TypeOID.DATE, '2024-01-15');
      expect(result).toBeInstanceOf(Date);
      expect((result as Date).toISOString()).toBe('2024-01-15T00:00:00.000Z');
    });

    it('should parse TIMESTAMP OID to Date object', () => {
      const result = parseValue(TypeOID.TIMESTAMP, '2024-01-15 12:30:00');
      expect(result).toBeInstanceOf(Date);
      expect((result as Date).toISOString()).toBe('2024-01-15T12:30:00.000Z');
    });

    it('should parse BYTEA OID to Buffer', () => {
      const result = parseValue(TypeOID.BYTEA, '\\x48656c6c6f');
      expect(Buffer.isBuffer(result)).toBe(true);
      expect((result as Buffer).toString()).toBe('Hello');
    });

    it('should return raw string for completely unknown OID', () => {
      expect(parseValue(999999, 'anything')).toBe('anything');
    });
  });
});

// ---------------------------------------------------------------------------
// parseEmbedding — adversarial inputs
// ---------------------------------------------------------------------------

describe('QA: parseEmbedding adversarial', () => {
  it('should handle whitespace in embedding values', () => {
    // "[0.1, 0.2, 0.3]" — spaces after commas
    const result = parseEmbedding('[0.1, 0.2, 0.3]');
    expect(result).toBeInstanceOf(Float32Array);
    expect(result.length).toBe(3);
    // parseFloat trims whitespace, so this should work
    expect(result[0]).toBeCloseTo(0.1);
    expect(result[1]).toBeCloseTo(0.2);
    expect(result[2]).toBeCloseTo(0.3);
  });

  it('should produce NaN for non-numeric embedding values', () => {
    // This is a correctness concern: malformed embedding data produces NaN silently
    const result = parseEmbedding('[abc,def]');
    expect(result.length).toBe(2);
    expect(result[0]).toBeNaN();
    expect(result[1]).toBeNaN();
  });

  it('should handle very large embedding vectors', () => {
    const size = 1536; // Common LLM embedding dimension
    const values = Array.from({ length: size }, (_, i) => (i / size).toFixed(6));
    const input = '[' + values.join(',') + ']';
    const result = parseEmbedding(input);
    expect(result.length).toBe(size);
    expect(result[0]).toBeCloseTo(0);
    expect(result[size - 1]).toBeCloseTo((size - 1) / size);
  });

  it('should handle embedding with scientific notation', () => {
    const result = parseEmbedding('[1e-5,2.5e3,-1.5e-2]');
    expect(result.length).toBe(3);
    expect(result[0]).toBeCloseTo(1e-5);
    expect(result[1]).toBeCloseTo(2500);
    expect(result[2]).toBeCloseTo(-0.015);
  });

  it('should handle embedding with Infinity values', () => {
    const result = parseEmbedding('[Infinity,-Infinity]');
    expect(result[0]).toBe(Infinity);
    expect(result[1]).toBe(-Infinity);
  });
});

// ---------------------------------------------------------------------------
// serializeEmbedding — adversarial inputs
// ---------------------------------------------------------------------------

describe('QA: serializeEmbedding adversarial', () => {
  it('should handle single-element array', () => {
    expect(serializeEmbedding([42])).toBe('[42]');
  });

  it('should handle NaN values in input', () => {
    const result = serializeEmbedding([NaN, 0.5]);
    expect(result).toBe('[NaN,0.5]');
  });

  it('should handle Infinity values in input', () => {
    const result = serializeEmbedding([Infinity, -Infinity]);
    expect(result).toBe('[Infinity,-Infinity]');
  });

  it('should handle very large embedding', () => {
    const arr = new Float32Array(4096);
    for (let i = 0; i < arr.length; i++) arr[i] = i * 0.001;
    const result = serializeEmbedding(arr);
    expect(result.startsWith('[')).toBe(true);
    expect(result.endsWith(']')).toBe(true);
    // Verify round-trip
    const parsed = parseEmbedding(result);
    expect(parsed.length).toBe(4096);
  });
});
