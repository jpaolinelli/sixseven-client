import { describe, it, expect } from 'vitest';
import {
  buildTraverse,
  buildNearest,
  buildLink,
  buildUnlink,
} from '../src/query-builders';

describe('buildTraverse', () => {
  it('builds a basic TRAVERSE query with defaults', () => {
    const q = buildTraverse('follows', 'users', 1);
    expect(q.text).toBe(
      'TRAVERSE "follows" FROM "users"($1) DIRECTION OUT MODE NODES',
    );
    expect(q.values).toEqual([1]);
  });

  it('respects direction option', () => {
    const q = buildTraverse('follows', 'users', 1, { direction: 'IN' });
    expect(q.text).toContain('DIRECTION IN');
  });

  it('respects maxDepth option', () => {
    const q = buildTraverse('follows', 'users', 1, { maxDepth: 3 });
    expect(q.text).toContain('MAX_DEPTH 3');
  });

  it('respects mode EDGES option', () => {
    const q = buildTraverse('follows', 'users', 1, { mode: 'EDGES' });
    expect(q.text).toContain('MODE EDGES');
  });

  it('includes FETCH when requested', () => {
    const q = buildTraverse('follows', 'users', 1, { fetch: true });
    expect(q.text).toMatch(/FETCH$/)
  });

  it('appends WHERE clause for post-filtering', () => {
    const q = buildTraverse('follows', 'users', 1, { where: '__depth > 1' });
    expect(q.text).toContain('WHERE __depth > 1');
    // Only one WHERE clause
    expect(q.text.match(/WHERE/g)?.length).toBe(1);
  });

  it('places WHERE before FETCH', () => {
    const q = buildTraverse('follows', 'users', 1, {
      where: '__depth > 1',
      fetch: true,
    });
    const whereIdx = q.text.indexOf('WHERE');
    const fetchIdx = q.text.indexOf('FETCH');
    expect(whereIdx).toBeLessThan(fetchIdx);
  });

  it('combines all options', () => {
    const q = buildTraverse('knows', 'people', 42, {
      direction: 'BOTH',
      maxDepth: 5,
      mode: 'NODES',
      fetch: true,
      where: '__depth <= 3',
    });
    expect(q.text).toBe(
      'TRAVERSE "knows" FROM "people"($1) DIRECTION BOTH MAX_DEPTH 5 MODE NODES WHERE __depth <= 3 FETCH',
    );
    expect(q.values).toEqual([42]);
  });

  it('escapes identifiers with double-quotes', () => {
    const q = buildTraverse('edge"type', 'my"table', 1);
    expect(q.text).toContain('"edge""type"');
    expect(q.text).toContain('"my""table"');
  });
});

describe('buildNearest', () => {
  it('builds a text-query NEAREST statement', () => {
    const q = buildNearest('posts', 'embedding', 'machine learning');
    expect(q.text).toBe(
      'NEAREST 10 FROM "posts"."embedding" TO $1',
    );
    expect(q.values).toEqual(['machine learning']);
  });

  it('respects k option', () => {
    const q = buildNearest('posts', 'embedding', 'test', { k: 5 });
    expect(q.text).toContain('NEAREST 5');
  });

  it('adds USING metric when not COSINE', () => {
    const q = buildNearest('posts', 'embedding', 'test', { metric: 'L2' });
    expect(q.text).toMatch(/USING L2$/)
  });

  it('omits USING for default COSINE metric', () => {
    const q = buildNearest('posts', 'embedding', 'test', { metric: 'COSINE' });
    expect(q.text).not.toContain('USING');
  });

  it('adds WHERE clause before USING', () => {
    const q = buildNearest('posts', 'embedding', 'test', {
      where: "category = 'tech'",
      metric: 'L2',
    });
    const whereIdx = q.text.indexOf('WHERE');
    const usingIdx = q.text.indexOf('USING');
    expect(whereIdx).toBeLessThan(usingIdx);
  });

  it('handles Float32Array query input', () => {
    const vec = new Float32Array([0.1, 0.2, 0.3]);
    const q = buildNearest('posts', 'embedding', vec);
    expect(q.values.length).toBe(1);
    expect(typeof q.values[0]).toBe('string');
  });

  it('handles number[] query input', () => {
    const q = buildNearest('posts', 'embedding', [0.1, 0.2, 0.3]);
    expect(q.values.length).toBe(1);
  });
});

describe('buildLink', () => {
  it('builds a basic LINK statement', () => {
    const q = buildLink('follows', 'users', 1, 'users', 2);
    expect(q.text).toBe(
      'LINK "users"($1) TO "users"($2) VIA "follows"',
    );
    expect(q.values).toEqual([1, 2]);
  });

  it('includes properties as parenthesized assignments', () => {
    const q = buildLink('rated', 'users', 1, 'products', 5, {
      properties: { score: 4.5, review: 'Great!' },
    });
    expect(q.text).toContain('VIA "rated"');
    expect(q.text).toContain('("score" = $3, "review" = $4)');
    expect(q.values).toEqual([1, 5, 4.5, 'Great!']);
  });

  it('omits properties when empty', () => {
    const q = buildLink('follows', 'users', 1, 'users', 2, { properties: {} });
    expect(q.text).toMatch(/VIA "follows"$/)
  });
});

describe('buildUnlink', () => {
  it('builds an UNLINK statement', () => {
    const q = buildUnlink('follows', 'users', 1, 'users', 2);
    expect(q.text).toBe(
      'UNLINK "users"($1) FROM "users"($2) VIA "follows"',
    );
    expect(q.values).toEqual([1, 2]);
  });
});
