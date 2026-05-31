/**
 * QA adversarial tests for query-builders.ts — GDB-48
 *
 * Tests SQL injection edge cases, boundary values, and malformed inputs
 * for all query builder functions.
 */
import { describe, it, expect } from 'vitest';
import {
  buildTraverse,
  buildNearest,
  buildLink,
  buildUnlink,
} from '../src/query-builders';

// ---------------------------------------------------------------------------
// buildTraverse — adversarial
// ---------------------------------------------------------------------------

describe('QA: buildTraverse adversarial', () => {
  it('should handle empty string edge type', () => {
    const q = buildTraverse('', 'users', 1);
    expect(q.text).toContain('""');
    expect(q.values).toEqual([1]);
  });

  it('should handle empty string table name', () => {
    const q = buildTraverse('follows', '', 1);
    expect(q.text).toContain('""($1)');
  });

  it('should handle null startId', () => {
    const q = buildTraverse('follows', 'users', null);
    expect(q.values).toEqual([null]);
  });

  it('should handle undefined startId', () => {
    const q = buildTraverse('follows', 'users', undefined);
    expect(q.values).toEqual([undefined]);
  });

  it('should handle string startId (UUID)', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    const q = buildTraverse('follows', 'users', uuid);
    expect(q.values).toEqual([uuid]);
  });

  it('should escape SQL injection in edge type identifier', () => {
    const q = buildTraverse('edge"; DROP TABLE users; --', 'users', 1);
    // Double-quoting should neutralize injection
    expect(q.text).toContain('"edge""; DROP TABLE users; --"');
  });

  it('should escape SQL injection in table name identifier', () => {
    const q = buildTraverse('follows', 'users"; DROP TABLE users; --', 1);
    expect(q.text).toContain('"users""; DROP TABLE users; --"');
  });

  it('should reject maxDepth of 0', () => {
    expect(() => buildTraverse('follows', 'users', 1, { maxDepth: 0 }))
      .toThrow('maxDepth must be a positive integer');
  });

  it('should reject negative maxDepth', () => {
    expect(() => buildTraverse('follows', 'users', 1, { maxDepth: -1 }))
      .toThrow('maxDepth must be a positive integer');
  });

  it('should reject floating-point maxDepth', () => {
    expect(() => buildTraverse('follows', 'users', 1, { maxDepth: 2.5 }))
      .toThrow('maxDepth must be a positive integer');
  });

  it('should reject where clause with SQL injection attempt (GDB-672)', () => {
    // GDB-672: WHERE fragments are now validated to reject dangerous patterns.
    expect(() =>
      buildTraverse('follows', 'users', 1, {
        where: "1=1; DROP TABLE users; --",
      }),
    ).toThrow(TypeError);
  });

  it('should handle all options as undefined', () => {
    const q = buildTraverse('follows', 'users', 1, {
      direction: undefined,
      maxDepth: undefined,
      mode: undefined,
      fetch: undefined,
      where: undefined,
    });
    // Should use defaults
    expect(q.text).toContain('DIRECTION OUT');
    expect(q.text).toContain('MODE NODES');
    expect(q.text).not.toContain('FETCH');
    expect(q.text).not.toContain('MAX_DEPTH');
    expect(q.text).not.toContain('WHERE');
  });

  it('should handle edge type with unicode characters', () => {
    const q = buildTraverse('关注', '用户', 1);
    expect(q.text).toContain('"关注"');
    expect(q.text).toContain('"用户"');
  });

  it('should handle edge type with newlines', () => {
    const q = buildTraverse('edge\ntype', 'users', 1);
    expect(q.text).toContain('"edge\ntype"');
  });
});

// ---------------------------------------------------------------------------
// buildNearest — adversarial
// ---------------------------------------------------------------------------

describe('QA: buildNearest adversarial', () => {
  it('should reject k=0', () => {
    expect(() => buildNearest('posts', 'embedding', 'test', { k: 0 }))
      .toThrow('k must be a positive integer');
  });

  it('should reject negative k', () => {
    expect(() => buildNearest('posts', 'embedding', 'test', { k: -5 }))
      .toThrow('k must be a positive integer');
  });

  it('should handle very large k', () => {
    const q = buildNearest('posts', 'embedding', 'test', { k: 1000000 });
    expect(q.text).toContain('NEAREST 1000000');
  });

  it('should handle empty string query', () => {
    const q = buildNearest('posts', 'embedding', '');
    expect(q.values).toEqual(['']);
  });

  it('should handle very long string query', () => {
    const longStr = 'a'.repeat(10000);
    const q = buildNearest('posts', 'embedding', longStr);
    expect(q.values[0]).toBe(longStr);
  });

  it('should handle Float32Array with zero length', () => {
    const q = buildNearest('posts', 'embedding', new Float32Array(0));
    expect(q.values[0]).toBe('[]');
  });

  it('should handle number array with zero length', () => {
    const q = buildNearest('posts', 'embedding', []);
    expect(q.values[0]).toBe('[]');
  });

  it('should handle all metric types', () => {
    expect(buildNearest('t', 'c', 'q', { metric: 'COSINE' }).text).not.toContain('USING');
    expect(buildNearest('t', 'c', 'q', { metric: 'L2' }).text).toContain('USING L2');
    expect(buildNearest('t', 'c', 'q', { metric: 'DOT' }).text).toContain('USING DOT');
  });

  it('should handle where and metric together', () => {
    const q = buildNearest('posts', 'embedding', 'test', {
      where: "category = 'tech'",
      metric: 'DOT',
    });
    expect(q.text).toContain('WHERE');
    expect(q.text).toContain('USING DOT');
    // WHERE should come before USING
    expect(q.text.indexOf('WHERE')).toBeLessThan(q.text.indexOf('USING'));
  });

  it('should escape table and column names with special chars', () => {
    const q = buildNearest('my"table', 'embed"col', 'test');
    expect(q.text).toContain('"my""table"');
    expect(q.text).toContain('"embed""col"');
  });
});

// ---------------------------------------------------------------------------
// buildLink — adversarial
// ---------------------------------------------------------------------------

describe('QA: buildLink adversarial', () => {
  it('should handle null IDs', () => {
    const q = buildLink('follows', 'users', null, 'users', null);
    expect(q.values).toEqual([null, null]);
  });

  it('should handle string IDs', () => {
    const q = buildLink('follows', 'users', 'uuid-1', 'users', 'uuid-2');
    expect(q.values).toEqual(['uuid-1', 'uuid-2']);
  });

  it('should handle properties with null values', () => {
    const q = buildLink('rated', 'users', 1, 'products', 2, {
      properties: { score: null, note: 'good' },
    });
    expect(q.values).toContain(null);
    expect(q.values).toContain('good');
    expect(q.values.length).toBe(4); // fromId, toId, score, note
  });

  it('should handle properties with undefined values', () => {
    const q = buildLink('rated', 'users', 1, 'products', 2, {
      properties: { score: undefined },
    });
    expect(q.values.length).toBe(3); // fromId, toId, score(undefined)
  });

  it('should handle many properties', () => {
    const properties: Record<string, unknown> = {};
    for (let i = 0; i < 50; i++) {
      properties[`prop${i}`] = `val${i}`;
    }
    const q = buildLink('edge', 'a', 1, 'b', 2, { properties });
    expect(q.values.length).toBe(52); // 2 IDs + 50 properties
    // Check parameter numbering is correct
    expect(q.text).toContain('$52');
  });

  it('should handle properties with special characters in keys', () => {
    const q = buildLink('edge', 'a', 1, 'b', 2, {
      properties: { 'key"with"quotes': 'value' },
    });
    expect(q.text).toContain('"key""with""quotes"');
  });

  it('should handle same table for from and to', () => {
    const q = buildLink('self_ref', 'nodes', 1, 'nodes', 1);
    expect(q.values).toEqual([1, 1]);
    expect(q.text).toContain('"nodes"($1) TO "nodes"($2)');
  });

  it('should handle no options at all', () => {
    const q = buildLink('follows', 'users', 1, 'users', 2);
    // No property assignments appended after VIA
    expect(q.text).toMatch(/VIA "follows"$/);
  });
});

// ---------------------------------------------------------------------------
// buildUnlink — adversarial
// ---------------------------------------------------------------------------

describe('QA: buildUnlink adversarial', () => {
  it('should handle null IDs', () => {
    const q = buildUnlink('follows', 'users', null, 'users', null);
    expect(q.values).toEqual([null, null]);
  });

  it('should escape all identifiers', () => {
    const q = buildUnlink('edge"type', 'from"tbl', 1, 'to"tbl', 2);
    expect(q.text).toContain('"edge""type"');
    expect(q.text).toContain('"from""tbl"');
    expect(q.text).toContain('"to""tbl"');
  });

  it('should only have two values in result', () => {
    const q = buildUnlink('follows', 'users', 1, 'users', 2);
    expect(q.values).toHaveLength(2);
  });
});
