import { describe, it, expect } from 'vitest';
import {
  buildTraverse,
  buildNearest,
  buildLink,
  buildUnlink,
  buildMatch,
  buildShortestPath,
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

// GDB-399: Input validation
describe('input validation', () => {
  it('buildTraverse: rejects negative maxDepth', () => {
    expect(() => buildTraverse('e', 't', 1, { maxDepth: -1 })).toThrow(TypeError);
  });

  it('buildTraverse: rejects float maxDepth', () => {
    expect(() => buildTraverse('e', 't', 1, { maxDepth: 2.5 })).toThrow(TypeError);
  });

  it('buildTraverse: rejects zero maxDepth', () => {
    expect(() => buildTraverse('e', 't', 1, { maxDepth: 0 })).toThrow(TypeError);
  });

  it('buildNearest: rejects negative k', () => {
    expect(() => buildNearest('t', 'c', 'q', { k: -5 })).toThrow(TypeError);
  });

  it('buildNearest: rejects zero k', () => {
    expect(() => buildNearest('t', 'c', 'q', { k: 0 })).toThrow(TypeError);
  });

  it('buildNearest: rejects float k', () => {
    expect(() => buildNearest('t', 'c', 'q', { k: 3.14 })).toThrow(TypeError);
  });

  it('buildTraverse: accepts valid maxDepth', () => {
    expect(() => buildTraverse('e', 't', 1, { maxDepth: 1 })).not.toThrow();
    expect(() => buildTraverse('e', 't', 1, { maxDepth: 100 })).not.toThrow();
  });

  it('buildNearest: accepts valid k', () => {
    expect(() => buildNearest('t', 'c', 'q', { k: 1 })).not.toThrow();
    expect(() => buildNearest('t', 'c', 'q', { k: 100 })).not.toThrow();
  });

  it('error message includes parameter name and value', () => {
    try {
      buildTraverse('e', 't', 1, { maxDepth: -3 });
    } catch (err: any) {
      expect(err.message).toContain('maxDepth');
      expect(err.message).toContain('-3');
    }
  });
});

// GDB-397: buildMatch
describe('buildMatch', () => {
  it('generates single-hop MATCH syntax (new SELECT...FROM MATCH)', () => {
    const q = buildMatch(
      [
        { alias: 'a', table: 'users' },
        { alias: 'r', edgeType: 'follows', direction: 'OUT' },
        { alias: 'b', table: 'users' },
      ],
      { returnItems: ['a', 'r', 'b'] },
    );
    expect(q.text).toBe('SELECT a, r, b FROM MATCH (a:"users")-[r:"follows"]->(b:"users")');
  });

  it('generates multi-hop MATCH', () => {
    const q = buildMatch(
      [
        { alias: 'a', table: 'users' },
        { alias: 'r1', edgeType: 'follows', direction: 'OUT' },
        { alias: 'b', table: 'users' },
        { alias: 'r2', edgeType: 'likes', direction: 'OUT' },
        { alias: 'c', table: 'posts' },
      ],
      { returnItems: ['a', 'c'] },
    );
    expect(q.text).toContain('(a:"users")-[r1:"follows"]->(b:"users")-[r2:"likes"]->(c:"posts")');
    expect(q.text).toContain('SELECT a, c FROM MATCH');
  });

  it('supports undirected edges (BOTH)', () => {
    const q = buildMatch(
      [
        { alias: 'a', table: 'users' },
        { alias: 'r', edgeType: 'knows', direction: 'BOTH' },
        { alias: 'b', table: 'users' },
      ],
      { returnItems: ['a', 'b'] },
    );
    expect(q.text).toContain('-[r:"knows"]-');
    expect(q.text).not.toContain('->');
    expect(q.text).not.toContain('<-');
  });

  it('supports IN direction', () => {
    const q = buildMatch(
      [
        { alias: 'a', table: 'users' },
        { alias: 'r', edgeType: 'follows', direction: 'IN' },
        { alias: 'b', table: 'users' },
      ],
      { returnItems: ['a'] },
    );
    expect(q.text).toContain('<-[r:"follows"]-');
  });

  it('appends WHERE clause', () => {
    const q = buildMatch(
      [
        { alias: 'a', table: 'users' },
        { alias: 'r', edgeType: 'follows', direction: 'OUT' },
        { alias: 'b', table: 'users' },
      ],
      { where: 'a.age > 21', returnItems: ['a'] },
    );
    expect(q.text).toContain('WHERE a.age > 21');
  });

  it('escapes identifiers', () => {
    const q = buildMatch(
      [
        { alias: 'a', table: 'my"table' },
        { alias: 'r', edgeType: 'edge"type', direction: 'OUT' },
        { alias: 'b', table: 'other' },
      ],
      { returnItems: ['a'] },
    );
    expect(q.text).toContain('"my""table"');
    expect(q.text).toContain('"edge""type"');
  });
});

// GDB-398: buildShortestPath + withinTraverse
describe('buildShortestPath', () => {
  it('generates correct SHORTEST PATH SQL (new SELECT-wrapped)', () => {
    const q = buildShortestPath('follows', 'users', 1, 'users', 2);
    expect(q.text).toBe(
      'SELECT * FROM SHORTEST PATH FROM "users"($1) TO "users"($2) VIA "follows"',
    );
    expect(q.values).toEqual([1, 2]);
  });

  it('supports direction option', () => {
    const q = buildShortestPath('follows', 'users', 1, 'users', 2, { direction: 'BOTH' });
    expect(q.text).toContain('DIRECTION BOTH');
  });

  it('supports maxDepth option', () => {
    const q = buildShortestPath('follows', 'users', 1, 'users', 2, { maxDepth: 5 });
    expect(q.text).toContain('MAX_DEPTH 5');
  });

  it('validates maxDepth', () => {
    expect(() => buildShortestPath('e', 't', 1, 't', 2, { maxDepth: -1 })).toThrow(TypeError);
  });

  it('escapes identifiers', () => {
    const q = buildShortestPath('e"dge', 'ta"ble', 1, 'ta"ble', 2);
    expect(q.text).toContain('"e""dge"');
    expect(q.text).toContain('"ta""ble"');
  });
});

describe('buildNearest with withinTraverse', () => {
  it('appends WITHIN TRAVERSE clause', () => {
    const q = buildNearest('posts', 'embedding', 'test', {
      k: 5,
      withinTraverse: {
        edgeType: 'follows',
        fromTable: 'users',
        startId: 1,
      },
    });
    expect(q.text).toContain('WITHIN TRAVERSE "follows" FROM "users"($2)');
    expect(q.values).toEqual(['test', 1]);
  });

  it('includes direction and maxDepth in WITHIN TRAVERSE', () => {
    const q = buildNearest('posts', 'embedding', 'test', {
      k: 5,
      withinTraverse: {
        edgeType: 'follows',
        fromTable: 'users',
        startId: 1,
        direction: 'OUT',
        maxDepth: 3,
      },
    });
    expect(q.text).toContain('DIRECTION OUT');
    expect(q.text).toContain('MAX_DEPTH 3');
  });
});
