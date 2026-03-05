import { describe, it, expect } from 'vitest';
import { parseEmbedding, serializeEmbedding } from '../src/type-mapping';

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

  it('handles high-precision floats', () => {
    const result = parseEmbedding('[0.123456789,0.987654321]');
    expect(result.length).toBe(2);
    expect(result[0]).toBeCloseTo(0.123456789, 5);
    expect(result[1]).toBeCloseTo(0.987654321, 5);
  });
});

describe('serializeEmbedding', () => {
  it('serializes a Float32Array to bracket-delimited string', () => {
    const arr = new Float32Array([0.1, 0.2, 0.3]);
    const result = serializeEmbedding(arr);
    expect(result).toMatch(/^\[.*\]$/);
    // Round-trip: parse it back and verify
    const parsed = parseEmbedding(result);
    expect(parsed[0]).toBeCloseTo(0.1);
    expect(parsed[1]).toBeCloseTo(0.2);
    expect(parsed[2]).toBeCloseTo(0.3);
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
