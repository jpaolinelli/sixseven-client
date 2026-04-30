import { describe, it, expect } from 'vitest';
import {
  buildMatch,
  buildMatchPattern,
  buildShortestMatch,
  buildShortestPath,
} from '../src/query-builders';
import { parsePath, parseValue, TypeOID } from '../src/type-parser';
import type { MatchPatternElement } from '../src/types';

// ---------------------------------------------------------------------------
// GDB-474: Updated MATCH builder — SELECT...FROM MATCH syntax
// ---------------------------------------------------------------------------

describe('buildMatch (new SELECT...FROM MATCH syntax)', () => {
  it('generates SELECT...FROM MATCH by default', () => {
    const q = buildMatch(
      [
        { alias: 'a', table: 'users' },
        { alias: 'r', edgeType: 'follows', direction: 'OUT' },
        { alias: 'b', table: 'users' },
      ],
      { returnItems: ['a', 'r', 'b'] },
    );
    expect(q.text).toBe(
      'SELECT a, r, b FROM MATCH (a:"users")-[r:"follows"]->(b:"users")',
    );
    expect(q.values).toEqual([]);
  });

  it('appends WHERE after pattern', () => {
    const q = buildMatch(
      [
        { alias: 'a', table: 'users' },
        { alias: 'r', edgeType: 'follows', direction: 'OUT' },
        { alias: 'b', table: 'users' },
      ],
      { returnItems: ['a'], where: 'a.age > 21' },
    );
    expect(q.text).toBe(
      'SELECT a FROM MATCH (a:"users")-[r:"follows"]->(b:"users") WHERE a.age > 21',
    );
  });

  it('supports hop quantifier {min,max}', () => {
    const q = buildMatch(
      [
        { alias: 'a', table: 'users' },
        { alias: 'r', edgeType: 'follows', direction: 'OUT', quantifier: '{2,5}' },
        { alias: 'b', table: 'users' },
      ],
      { returnItems: ['a', 'b'] },
    );
    expect(q.text).toBe(
      'SELECT a, b FROM MATCH (a:"users")-[r:"follows"]->{2,5}(b:"users")',
    );
  });

  it('supports hop quantifier +', () => {
    const q = buildMatch(
      [
        { alias: 'a', table: 'users' },
        { alias: 'r', edgeType: 'follows', direction: 'OUT', quantifier: '+' },
        { alias: 'b', table: 'users' },
      ],
      { returnItems: ['a', 'b'] },
    );
    expect(q.text).toContain('-[r:"follows"]->+');
  });

  it('supports hop quantifier *', () => {
    const q = buildMatch(
      [
        { alias: 'a', table: 'users' },
        { alias: 'r', edgeType: 'follows', direction: 'OUT', quantifier: '*' },
        { alias: 'b', table: 'users' },
      ],
      { returnItems: ['a', 'b'] },
    );
    expect(q.text).toContain('-[r:"follows"]->*');
  });

  it('supports cross-edge-type patterns', () => {
    const q = buildMatch(
      [
        { alias: 'a', table: 'users' },
        { alias: 'r', edgeType: 'follows', direction: 'OUT', edgeTypes: ['follows', 'likes'] },
        { alias: 'b', table: 'users' },
      ],
      { returnItems: ['a', 'b'] },
    );
    expect(q.text).toBe(
      'SELECT a, b FROM MATCH (a:"users")-[r:"follows"|"likes"]->(b:"users")',
    );
  });

  it('cross-edge-type with three types', () => {
    const q = buildMatch(
      [
        { alias: 'a', table: 'users' },
        { alias: 'r', edgeType: 'follows', direction: 'OUT', edgeTypes: ['follows', 'likes', 'blocks'] },
        { alias: 'b', table: 'users' },
      ],
      { returnItems: ['a', 'b'] },
    );
    expect(q.text).toContain('"follows"|"likes"|"blocks"');
  });

  it('supports IN direction with quantifier', () => {
    const q = buildMatch(
      [
        { alias: 'a', table: 'users' },
        { alias: 'r', edgeType: 'follows', direction: 'IN', quantifier: '{1,3}' },
        { alias: 'b', table: 'users' },
      ],
      { returnItems: ['a', 'b'] },
    );
    expect(q.text).toContain('<-[r:"follows"]-{1,3}');
  });

  it('supports BOTH direction with quantifier', () => {
    const q = buildMatch(
      [
        { alias: 'a', table: 'users' },
        { alias: 'r', edgeType: 'knows', direction: 'BOTH', quantifier: '+' },
        { alias: 'b', table: 'users' },
      ],
      { returnItems: ['a', 'b'] },
    );
    expect(q.text).toContain('-[r:"knows"]-+');
  });

  it('multi-hop with mixed quantifiers', () => {
    const q = buildMatch(
      [
        { alias: 'a', table: 'users' },
        { alias: 'r1', edgeType: 'follows', direction: 'OUT', quantifier: '{1,3}' },
        { alias: 'b', table: 'users' },
        { alias: 'r2', edgeType: 'likes', direction: 'OUT' },
        { alias: 'c', table: 'posts' },
      ],
      { returnItems: ['a', 'c'] },
    );
    expect(q.text).toBe(
      'SELECT a, c FROM MATCH (a:"users")-[r1:"follows"]->{1,3}(b:"users")-[r2:"likes"]->(c:"posts")',
    );
  });

  it('escapes identifiers in cross-edge-type patterns', () => {
    const q = buildMatch(
      [
        { alias: 'a', table: 'my"table' },
        { alias: 'r', edgeType: 'e', direction: 'OUT', edgeTypes: ['edge"one', 'edge"two'] },
        { alias: 'b', table: 'other' },
      ],
      { returnItems: ['a'] },
    );
    expect(q.text).toContain('"my""table"');
    expect(q.text).toContain('"edge""one"|"edge""two"');
  });
});

// ---------------------------------------------------------------------------
// GDB-474: Legacy syntax backward compatibility
// ---------------------------------------------------------------------------

describe('buildMatch (legacy syntax)', () => {
  it('generates MATCH...RETURN with legacySyntax=true', () => {
    const q = buildMatch(
      [
        { alias: 'a', table: 'users' },
        { alias: 'r', edgeType: 'follows', direction: 'OUT' },
        { alias: 'b', table: 'users' },
      ],
      { returnItems: ['a', 'b'], legacySyntax: true },
    );
    expect(q.text).toBe(
      'MATCH (a:"users")-[r:"follows"]->(b:"users") RETURN a, b',
    );
  });

  it('legacy syntax with WHERE clause', () => {
    const q = buildMatch(
      [
        { alias: 'a', table: 'users' },
        { alias: 'r', edgeType: 'follows', direction: 'OUT' },
        { alias: 'b', table: 'users' },
      ],
      { returnItems: ['a'], where: 'a.id = 1', legacySyntax: true },
    );
    expect(q.text).toBe(
      'MATCH (a:"users")-[r:"follows"]->(b:"users") WHERE a.id = 1 RETURN a',
    );
  });

  it('legacy syntax still supports hop quantifiers', () => {
    const q = buildMatch(
      [
        { alias: 'a', table: 'users' },
        { alias: 'r', edgeType: 'follows', direction: 'OUT', quantifier: '{2,5}' },
        { alias: 'b', table: 'users' },
      ],
      { returnItems: ['a', 'b'], legacySyntax: true },
    );
    expect(q.text).toContain('-[r:"follows"]->{2,5}');
    expect(q.text).toContain('RETURN a, b');
  });
});

// ---------------------------------------------------------------------------
// buildMatchPattern (shared helper)
// ---------------------------------------------------------------------------

describe('buildMatchPattern', () => {
  it('returns just the pattern SQL', () => {
    const pattern: MatchPatternElement[] = [
      { alias: 'a', table: 'users' },
      { alias: 'r', edgeType: 'follows', direction: 'OUT' },
      { alias: 'b', table: 'users' },
    ];
    expect(buildMatchPattern(pattern)).toBe(
      '(a:"users")-[r:"follows"]->(b:"users")',
    );
  });
});

// ---------------------------------------------------------------------------
// GDB-475: buildShortestMatch (path selector query builder)
// ---------------------------------------------------------------------------

describe('buildShortestMatch', () => {
  const pattern: MatchPatternElement[] = [
    { alias: 'a', table: 'users' },
    { alias: 'r', edgeType: 'follows', direction: 'OUT' },
    { alias: 'b', table: 'users' },
  ];

  it('generates ANY SHORTEST syntax', () => {
    const q = buildShortestMatch(pattern, ['a', 'b'], 'ANY SHORTEST');
    expect(q.text).toBe(
      'SELECT a, b FROM MATCH ANY SHORTEST (a:"users")-[r:"follows"]->(b:"users")',
    );
    expect(q.values).toEqual([]);
  });

  it('generates ALL SHORTEST syntax', () => {
    const q = buildShortestMatch(pattern, ['a', 'b'], 'ALL SHORTEST');
    expect(q.text).toBe(
      'SELECT a, b FROM MATCH ALL SHORTEST (a:"users")-[r:"follows"]->(b:"users")',
    );
  });

  it('generates SHORTEST K syntax', () => {
    const q = buildShortestMatch(pattern, ['a', 'b'], 'SHORTEST', { k: 3 });
    expect(q.text).toBe(
      'SELECT a, b FROM MATCH SHORTEST 3 (a:"users")-[r:"follows"]->(b:"users")',
    );
  });

  it('throws when SHORTEST without k', () => {
    expect(() =>
      buildShortestMatch(pattern, ['a', 'b'], 'SHORTEST'),
    ).toThrow('k is required');
  });

  it('validates k is positive integer', () => {
    expect(() =>
      buildShortestMatch(pattern, ['a', 'b'], 'SHORTEST', { k: 0 }),
    ).toThrow(TypeError);
    expect(() =>
      buildShortestMatch(pattern, ['a', 'b'], 'SHORTEST', { k: -1 }),
    ).toThrow(TypeError);
    expect(() =>
      buildShortestMatch(pattern, ['a', 'b'], 'SHORTEST', { k: 2.5 }),
    ).toThrow(TypeError);
  });

  it('supports WEIGHT clause', () => {
    const q = buildShortestMatch(pattern, ['a', 'b'], 'ANY SHORTEST', {
      weight: 'r.cost',
    });
    expect(q.text).toContain('WEIGHT r.cost');
  });

  it('supports WHERE clause', () => {
    const q = buildShortestMatch(pattern, ['a', 'b'], 'ANY SHORTEST', {
      where: 'a.active = true',
    });
    expect(q.text).toContain('WHERE a.active = true');
  });

  it('WEIGHT comes before WHERE', () => {
    const q = buildShortestMatch(pattern, ['a', 'b'], 'ANY SHORTEST', {
      weight: 'r.cost',
      where: 'a.active = true',
    });
    const weightIdx = q.text.indexOf('WEIGHT');
    const whereIdx = q.text.indexOf('WHERE');
    expect(weightIdx).toBeLessThan(whereIdx);
  });

  it('handles hop quantifiers in pattern', () => {
    const patternWithHops: MatchPatternElement[] = [
      { alias: 'a', table: 'users' },
      { alias: 'r', edgeType: 'follows', direction: 'OUT', quantifier: '{1,5}' },
      { alias: 'b', table: 'users' },
    ];
    const q = buildShortestMatch(patternWithHops, ['a', 'b'], 'ANY SHORTEST');
    expect(q.text).toContain('-[r:"follows"]->{1,5}');
  });
});

// ---------------------------------------------------------------------------
// GDB-477: buildShortestPath SELECT composability
// ---------------------------------------------------------------------------

describe('buildShortestPath (SELECT composability)', () => {
  it('wraps with SELECT * FROM by default', () => {
    const q = buildShortestPath('follows', 'users', 1, 'users', 2);
    expect(q.text).toBe(
      'SELECT * FROM SHORTEST PATH FROM "users"($1) TO "users"($2) VIA "follows"',
    );
    expect(q.values).toEqual([1, 2]);
  });

  it('supports custom SELECT clause as identifier array (GDB-670)', () => {
    const q = buildShortestPath('follows', 'users', 1, 'users', 2, {
      select: ['path_length', 'nodes'],
    });
    expect(
      q.text.startsWith('SELECT "path_length", "nodes" FROM SHORTEST PATH'),
    ).toBe(true);
  });

  it('supports direction and maxDepth with SELECT', () => {
    const q = buildShortestPath('follows', 'users', 1, 'users', 2, {
      direction: 'BOTH',
      maxDepth: 5,
    });
    expect(q.text).toBe(
      'SELECT * FROM SHORTEST PATH FROM "users"($1) TO "users"($2) VIA "follows" DIRECTION BOTH MAX_DEPTH 5',
    );
  });

  it('legacySyntax=true produces bare SHORTEST PATH', () => {
    const q = buildShortestPath('follows', 'users', 1, 'users', 2, {
      legacySyntax: true,
    });
    expect(q.text).toBe(
      'SHORTEST PATH FROM "users"($1) TO "users"($2) VIA "follows"',
    );
    expect(q.text).not.toContain('SELECT');
  });

  it('legacySyntax with direction and maxDepth', () => {
    const q = buildShortestPath('follows', 'users', 1, 'users', 2, {
      direction: 'OUT',
      maxDepth: 3,
      legacySyntax: true,
    });
    expect(q.text).toBe(
      'SHORTEST PATH FROM "users"($1) TO "users"($2) VIA "follows" DIRECTION OUT MAX_DEPTH 3',
    );
  });

  it('escapes identifiers with SELECT wrapper', () => {
    const q = buildShortestPath('e"dge', 'ta"ble', 1, 'ta"ble', 2);
    expect(q.text).toContain('"e""dge"');
    expect(q.text).toContain('"ta""ble"');
    expect(q.text.startsWith('SELECT * FROM')).toBe(true);
  });

  it('validates maxDepth with SELECT wrapper', () => {
    expect(() =>
      buildShortestPath('e', 't', 1, 't', 2, { maxDepth: -1 }),
    ).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// GDB-476: Path result parsing
// ---------------------------------------------------------------------------

describe('parsePath', () => {
  it('parses a simple 2-node, 1-edge path', () => {
    const json = JSON.stringify([
      { table: 'users', id: 1, name: 'Alice' },
      { edge_type: 'follows', from_id: 1, to_id: 2 },
      { table: 'users', id: 2, name: 'Bob' },
    ]);
    const path = parsePath(json);
    expect(path.nodes).toHaveLength(2);
    expect(path.edges).toHaveLength(1);
    expect(path.nodes[0]).toEqual({
      table: 'users',
      id: 1,
      properties: { name: 'Alice' },
    });
    expect(path.nodes[1]).toEqual({
      table: 'users',
      id: 2,
      properties: { name: 'Bob' },
    });
    expect(path.edges[0]).toEqual({
      edgeType: 'follows',
      fromId: 1,
      toId: 2,
      properties: {},
    });
  });

  it('parses a 3-node, 2-edge path', () => {
    const json = JSON.stringify([
      { table: 'users', id: 1 },
      { edge_type: 'follows', from_id: 1, to_id: 2 },
      { table: 'users', id: 2 },
      { edge_type: 'likes', from_id: 2, to_id: 3, weight: 0.9 },
      { table: 'posts', id: 3, title: 'Hello' },
    ]);
    const path = parsePath(json);
    expect(path.nodes).toHaveLength(3);
    expect(path.edges).toHaveLength(2);
    expect(path.edges[1].edgeType).toBe('likes');
    expect(path.edges[1].properties).toEqual({ weight: 0.9 });
    expect(path.nodes[2].table).toBe('posts');
    expect(path.nodes[2].properties).toEqual({ title: 'Hello' });
  });

  it('parses a single-node path (no edges)', () => {
    const json = JSON.stringify([
      { table: 'users', id: 1, name: 'Solo' },
    ]);
    const path = parsePath(json);
    expect(path.nodes).toHaveLength(1);
    expect(path.edges).toHaveLength(0);
  });

  it('handles edge properties', () => {
    const json = JSON.stringify([
      { table: 'users', id: 1 },
      { edge_type: 'rated', from_id: 1, to_id: 2, score: 4.5, review: 'Great!' },
      { table: 'products', id: 2 },
    ]);
    const path = parsePath(json);
    expect(path.edges[0].properties).toEqual({
      score: 4.5,
      review: 'Great!',
    });
  });

  it('handles nested properties', () => {
    const json = JSON.stringify([
      { table: 'users', id: 1, metadata: { role: 'admin', tags: ['a', 'b'] } },
      { edge_type: 'follows', from_id: 1, to_id: 2 },
      { table: 'users', id: 2 },
    ]);
    const path = parsePath(json);
    expect(path.nodes[0].properties.metadata).toEqual({
      role: 'admin',
      tags: ['a', 'b'],
    });
  });

  it('handles empty path array', () => {
    const path = parsePath('[]');
    expect(path.nodes).toHaveLength(0);
    expect(path.edges).toHaveLength(0);
  });
});

describe('PATH TypeOID', () => {
  it('TypeOID.PATH equals 100006', () => {
    expect(TypeOID.PATH).toBe(100006);
  });

  it('parseValue routes PATH type correctly', () => {
    const json = JSON.stringify([
      { table: 'users', id: 1 },
      { edge_type: 'follows', from_id: 1, to_id: 2 },
      { table: 'users', id: 2 },
    ]);
    const result = parseValue(TypeOID.PATH, json) as { nodes: unknown[]; edges: unknown[] };
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(1);
  });
});
