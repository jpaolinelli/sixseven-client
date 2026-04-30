import { describe, it, expect } from 'vitest';
import {
  buildMatch,
  buildMatchPattern,
  buildShortestMatch,
  buildShortestPath,
} from '../src/query-builders';
import { parsePath, parseValue, TypeOID } from '../src/type-parser';
import type {
  MatchPatternElement,
  MatchNode,
  MatchEdge,
  ShortestMatchSelector,
  Path,
} from '../src/types';

// ===========================================================================
// QA adversarial tests for GDB-430: Node.js Client Graph Query Builder Updates
// ===========================================================================

// ---------------------------------------------------------------------------
// buildMatch — boundary and edge cases
// ---------------------------------------------------------------------------

describe('QA buildMatch — boundary values', () => {
  it('should handle empty pattern array', () => {
    const q = buildMatch([], { returnItems: ['a'] });
    expect(q.text).toBe('SELECT a FROM MATCH ');
    expect(q.values).toEqual([]);
  });

  it('should handle single-node pattern (no edges)', () => {
    const q = buildMatch(
      [{ alias: 'a', table: 'users' }],
      { returnItems: ['a'] },
    );
    expect(q.text).toBe('SELECT a FROM MATCH (a:"users")');
  });

  it('should reject empty returnItems array (GDB-673)', () => {
    expect(() =>
      buildMatch(
        [
          { alias: 'a', table: 'users' },
          { alias: 'r', edgeType: 'follows', direction: 'OUT' },
          { alias: 'b', table: 'users' },
        ],
        { returnItems: [] },
      ),
    ).toThrow(TypeError);
  });

  it('should reject very long returnItems identifiers (GDB-673)', () => {
    const longName = 'a'.repeat(500);
    // The table/alias are not validated by returnItems, but the return item
    // exceeds the 64-char limit and must be rejected.
    expect(() =>
      buildMatch(
        [{ alias: longName, table: longName }],
        { returnItems: [longName] },
      ),
    ).toThrow(RangeError);
  });

  it('should handle special characters in table names', () => {
    const q = buildMatch(
      [
        { alias: 'a', table: "table'with;special--chars" },
        { alias: 'r', edgeType: 'edge', direction: 'OUT' },
        { alias: 'b', table: 'normal' },
      ],
      { returnItems: ['a'] },
    );
    // Double-quoting should handle special chars
    expect(q.text).toContain('"table\'with;special--chars"');
  });

  it('should handle unicode in identifiers', () => {
    const q = buildMatch(
      [
        { alias: 'a', table: '表テーブル' },
        { alias: 'r', edgeType: '関係', direction: 'OUT' },
        { alias: 'b', table: '表テーブル' },
      ],
      { returnItems: ['a', 'b'] },
    );
    expect(q.text).toContain('"表テーブル"');
    expect(q.text).toContain('"関係"');
  });
});

describe('QA buildMatch — edge quantifier edge cases', () => {
  it('should handle empty string quantifier', () => {
    const q = buildMatch(
      [
        { alias: 'a', table: 'users' },
        { alias: 'r', edgeType: 'follows', direction: 'OUT', quantifier: '' },
        { alias: 'b', table: 'users' },
      ],
      { returnItems: ['a', 'b'] },
    );
    // Empty quantifier should produce the same as no quantifier
    expect(q.text).toBe(
      'SELECT a, b FROM MATCH (a:"users")-[r:"follows"]->(b:"users")',
    );
  });

  it('should pass through arbitrary quantifier string without validation', () => {
    // The builder does not validate quantifier format — it passes through as-is
    const q = buildMatch(
      [
        { alias: 'a', table: 'users' },
        { alias: 'r', edgeType: 'follows', direction: 'OUT', quantifier: '{0,0}' },
        { alias: 'b', table: 'users' },
      ],
      { returnItems: ['a', 'b'] },
    );
    expect(q.text).toContain('->{0,0}');
  });

  it('should handle quantifier with large range', () => {
    const q = buildMatch(
      [
        { alias: 'a', table: 'users' },
        { alias: 'r', edgeType: 'follows', direction: 'OUT', quantifier: '{1,999999}' },
        { alias: 'b', table: 'users' },
      ],
      { returnItems: ['a', 'b'] },
    );
    expect(q.text).toContain('->{1,999999}');
  });
});

describe('QA buildMatch — cross-edge-type edge cases', () => {
  it('should fall back to edgeType when edgeTypes is empty array', () => {
    const q = buildMatch(
      [
        { alias: 'a', table: 'users' },
        { alias: 'r', edgeType: 'follows', direction: 'OUT', edgeTypes: [] },
        { alias: 'b', table: 'users' },
      ],
      { returnItems: ['a', 'b'] },
    );
    // Empty edgeTypes should fall back to edgeType
    expect(q.text).toContain('[r:"follows"]');
  });

  it('should handle single edgeType in edgeTypes array', () => {
    const q = buildMatch(
      [
        { alias: 'a', table: 'users' },
        { alias: 'r', edgeType: 'follows', direction: 'OUT', edgeTypes: ['follows'] },
        { alias: 'b', table: 'users' },
      ],
      { returnItems: ['a', 'b'] },
    );
    expect(q.text).toContain('[r:"follows"]');
  });

  it('should handle many edge types', () => {
    const types = Array.from({ length: 20 }, (_, i) => `edge_${i}`);
    const q = buildMatch(
      [
        { alias: 'a', table: 'users' },
        { alias: 'r', edgeType: 'default', direction: 'OUT', edgeTypes: types },
        { alias: 'b', table: 'users' },
      ],
      { returnItems: ['a', 'b'] },
    );
    // All 20 edge types should appear pipe-separated
    for (const t of types) {
      expect(q.text).toContain(`"${t}"`);
    }
  });

  it('should handle edge types with quotes in names', () => {
    const q = buildMatch(
      [
        { alias: 'a', table: 'users' },
        { alias: 'r', edgeType: 'default', direction: 'OUT', edgeTypes: ['a"b', 'c"d'] },
        { alias: 'b', table: 'users' },
      ],
      { returnItems: ['a', 'b'] },
    );
    expect(q.text).toContain('"a""b"|"c""d"');
  });
});

describe('QA buildMatch — legacy syntax edge cases', () => {
  it('should omit WHERE with empty string in legacy syntax', () => {
    const q = buildMatch(
      [
        { alias: 'a', table: 'users' },
        { alias: 'r', edgeType: 'follows', direction: 'OUT' },
        { alias: 'b', table: 'users' },
      ],
      { returnItems: ['a'], where: '', legacySyntax: true },
    );
    // Empty string is falsy — should NOT produce WHERE clause
    expect(q.text).not.toContain('WHERE');
  });

  it('should produce SELECT...FROM MATCH with empty WHERE', () => {
    const q = buildMatch(
      [
        { alias: 'a', table: 'users' },
        { alias: 'r', edgeType: 'follows', direction: 'OUT' },
        { alias: 'b', table: 'users' },
      ],
      { returnItems: ['a'], where: '' },
    );
    // Empty where string is falsy — should NOT produce WHERE clause
    expect(q.text).not.toContain('WHERE');
  });

  it('should handle both legacySyntax=false explicitly and default', () => {
    const explicit = buildMatch(
      [
        { alias: 'a', table: 'users' },
        { alias: 'r', edgeType: 'follows', direction: 'OUT' },
        { alias: 'b', table: 'users' },
      ],
      { returnItems: ['a'], legacySyntax: false },
    );
    const defaultSyntax = buildMatch(
      [
        { alias: 'a', table: 'users' },
        { alias: 'r', edgeType: 'follows', direction: 'OUT' },
        { alias: 'b', table: 'users' },
      ],
      { returnItems: ['a'] },
    );
    expect(explicit.text).toBe(defaultSyntax.text);
  });
});

// ---------------------------------------------------------------------------
// buildMatchPattern — isolated
// ---------------------------------------------------------------------------

describe('QA buildMatchPattern — edge cases', () => {
  it('should handle empty pattern', () => {
    expect(buildMatchPattern([])).toBe('');
  });

  it('should handle node-only pattern', () => {
    const pattern: MatchPatternElement[] = [{ alias: 'x', table: 'users' }];
    expect(buildMatchPattern(pattern)).toBe('(x:"users")');
  });

  it('should handle long chain pattern (5 nodes, 4 edges)', () => {
    const pattern: MatchPatternElement[] = [];
    for (let i = 0; i < 5; i++) {
      if (i > 0) {
        pattern.push({
          alias: `r${i}`,
          edgeType: `edge${i}`,
          direction: 'OUT',
        } as MatchEdge);
      }
      pattern.push({ alias: `n${i}`, table: `table${i}` } as MatchNode);
    }
    const result = buildMatchPattern(pattern);
    // Should have 5 node segments and 4 edge segments
    expect(result.match(/\(/g)?.length).toBe(5);
    expect(result.match(/->/g)?.length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// buildShortestMatch — adversarial tests
// ---------------------------------------------------------------------------

describe('QA buildShortestMatch — boundary values', () => {
  const pattern: MatchPatternElement[] = [
    { alias: 'a', table: 'users' },
    { alias: 'r', edgeType: 'follows', direction: 'OUT' },
    { alias: 'b', table: 'users' },
  ];

  it('should throw for SHORTEST with k=0', () => {
    expect(() =>
      buildShortestMatch(pattern, ['a', 'b'], 'SHORTEST', { k: 0 }),
    ).toThrow(TypeError);
  });

  it('should throw for SHORTEST with negative k', () => {
    expect(() =>
      buildShortestMatch(pattern, ['a', 'b'], 'SHORTEST', { k: -5 }),
    ).toThrow(TypeError);
  });

  it('should throw for SHORTEST with fractional k', () => {
    expect(() =>
      buildShortestMatch(pattern, ['a', 'b'], 'SHORTEST', { k: 1.5 }),
    ).toThrow(TypeError);
  });

  it('should accept SHORTEST with k=1', () => {
    const q = buildShortestMatch(pattern, ['a', 'b'], 'SHORTEST', { k: 1 });
    expect(q.text).toContain('SHORTEST 1');
  });

  it('should accept SHORTEST with large k', () => {
    const q = buildShortestMatch(pattern, ['a', 'b'], 'SHORTEST', { k: 1000000 });
    expect(q.text).toContain('SHORTEST 1000000');
  });

  it('should not require k for ANY SHORTEST', () => {
    const q = buildShortestMatch(pattern, ['a', 'b'], 'ANY SHORTEST');
    expect(q.text).toContain('ANY SHORTEST');
    expect(q.text).not.toMatch(/ANY SHORTEST \d/);
  });

  it('should not require k for ALL SHORTEST', () => {
    const q = buildShortestMatch(pattern, ['a', 'b'], 'ALL SHORTEST');
    expect(q.text).toContain('ALL SHORTEST');
  });

  it('should ignore k for ANY SHORTEST', () => {
    const q = buildShortestMatch(pattern, ['a', 'b'], 'ANY SHORTEST', { k: 5 });
    // k should be ignored (not injected into SQL)
    expect(q.text).not.toContain('5');
  });

  it('should reject empty returnItems (GDB-673)', () => {
    expect(() =>
      buildShortestMatch(pattern, [], 'ANY SHORTEST'),
    ).toThrow(TypeError);
  });

  it('should handle empty pattern', () => {
    const q = buildShortestMatch([], ['a', 'b'], 'ANY SHORTEST');
    expect(q.text).toContain('ANY SHORTEST ');
  });
});

describe('QA buildShortestMatch — WEIGHT and WHERE interaction', () => {
  const pattern: MatchPatternElement[] = [
    { alias: 'a', table: 'users' },
    { alias: 'r', edgeType: 'follows', direction: 'OUT' },
    { alias: 'b', table: 'users' },
  ];

  it('should place WEIGHT before WHERE when both present', () => {
    const q = buildShortestMatch(pattern, ['a', 'b'], 'ANY SHORTEST', {
      weight: 'r.cost',
      where: 'a.active = true',
    });
    const weightIdx = q.text.indexOf('WEIGHT');
    const whereIdx = q.text.indexOf('WHERE');
    expect(weightIdx).toBeGreaterThan(-1);
    expect(whereIdx).toBeGreaterThan(-1);
    expect(weightIdx).toBeLessThan(whereIdx);
  });

  it('should handle empty weight string', () => {
    const q = buildShortestMatch(pattern, ['a', 'b'], 'ANY SHORTEST', {
      weight: '',
    });
    // Empty string is falsy — should NOT add WEIGHT clause
    expect(q.text).not.toContain('WEIGHT');
  });

  it('should handle empty where string', () => {
    const q = buildShortestMatch(pattern, ['a', 'b'], 'ANY SHORTEST', {
      where: '',
    });
    // Empty string is falsy — should NOT add WHERE clause
    expect(q.text).not.toContain('WHERE');
  });

  it('should handle weight only (no where)', () => {
    const q = buildShortestMatch(pattern, ['a', 'b'], 'ALL SHORTEST', {
      weight: 'r.distance',
    });
    expect(q.text).toContain('WEIGHT r.distance');
    expect(q.text).not.toContain('WHERE');
  });

  it('should handle where only (no weight)', () => {
    const q = buildShortestMatch(pattern, ['a', 'b'], 'ALL SHORTEST', {
      where: 'b.active',
    });
    expect(q.text).toContain('WHERE b.active');
    expect(q.text).not.toContain('WEIGHT');
  });
});

describe('QA buildShortestMatch — selector case sensitivity', () => {
  const pattern: MatchPatternElement[] = [
    { alias: 'a', table: 'users' },
    { alias: 'r', edgeType: 'follows', direction: 'OUT' },
    { alias: 'b', table: 'users' },
  ];

  it('should normalize lowercase selector to uppercase', () => {
    // Type cast to bypass TypeScript checking, simulating JS runtime behavior
    const q = buildShortestMatch(
      pattern,
      ['a', 'b'],
      'any shortest' as ShortestMatchSelector,
    );
    expect(q.text).toContain('ANY SHORTEST');
  });

  it('should normalize mixed case selector', () => {
    const q = buildShortestMatch(
      pattern,
      ['a', 'b'],
      'All Shortest' as ShortestMatchSelector,
    );
    expect(q.text).toContain('ALL SHORTEST');
  });

  it('should normalize lowercase SHORTEST with k', () => {
    const q = buildShortestMatch(
      pattern,
      ['a', 'b'],
      'shortest' as ShortestMatchSelector,
      { k: 3 },
    );
    expect(q.text).toContain('SHORTEST 3');
  });
});

// ---------------------------------------------------------------------------
// buildShortestPath — adversarial tests
// ---------------------------------------------------------------------------

describe('QA buildShortestPath — boundary and edge cases', () => {
  it('should default to SELECT * FROM when no options', () => {
    const q = buildShortestPath('edge', 'from_table', 1, 'to_table', 2);
    expect(q.text).toMatch(/^SELECT \* FROM SHORTEST PATH/);
  });

  it('should use custom select clause as identifier array (GDB-670)', () => {
    // GDB-670: select is now SelectClause = '*' | readonly string[]. Raw
    // function-call strings like "count(*)" are rejected — callers compose
    // aggregates server-side in the outer query.
    const q = buildShortestPath('edge', 'from_table', 1, 'to_table', 2, {
      select: ['path_length'],
    });
    expect(q.text).toMatch(/^SELECT "path_length" FROM SHORTEST PATH/);
  });

  it('should reject raw function-call select string (GDB-670)', () => {
    expect(() =>
      buildShortestPath('edge', 'from_table', 1, 'to_table', 2, {
        select: 'count(*)' as never,
      }),
    ).toThrow(TypeError);
  });

  it('should ignore select when legacySyntax is true', () => {
    const q = buildShortestPath('edge', 'from_table', 1, 'to_table', 2, {
      select: ['path_length'],
      legacySyntax: true,
    });
    expect(q.text).not.toContain('SELECT');
    expect(q.text).not.toContain('path_length');
  });

  it('should validate maxDepth=0 throws', () => {
    expect(() =>
      buildShortestPath('e', 't', 1, 't', 2, { maxDepth: 0 }),
    ).toThrow(TypeError);
  });

  it('should validate maxDepth=NaN throws', () => {
    expect(() =>
      buildShortestPath('e', 't', 1, 't', 2, { maxDepth: NaN }),
    ).toThrow(TypeError);
  });

  it('should accept maxDepth=1', () => {
    const q = buildShortestPath('e', 't', 1, 't', 2, { maxDepth: 1 });
    expect(q.text).toContain('MAX_DEPTH 1');
  });

  it('should handle null-like IDs', () => {
    const q = buildShortestPath('e', 't', null, 't', undefined);
    expect(q.values).toEqual([null, undefined]);
  });

  it('should handle string IDs', () => {
    const q = buildShortestPath('e', 't', 'uuid-1', 't', 'uuid-2');
    expect(q.values).toEqual(['uuid-1', 'uuid-2']);
  });

  it('should handle empty string edge type', () => {
    const q = buildShortestPath('', 'from', 1, 'to', 2);
    expect(q.text).toContain('VIA ""');
  });

  it('should preserve parameter order [$1=fromId, $2=toId]', () => {
    const q = buildShortestPath('e', 'source', 'A', 'target', 'B');
    expect(q.values[0]).toBe('A');
    expect(q.values[1]).toBe('B');
    expect(q.text).toContain('"source"($1)');
    expect(q.text).toContain('"target"($2)');
  });
});

// ---------------------------------------------------------------------------
// parsePath — adversarial tests
// ---------------------------------------------------------------------------

describe('QA parsePath — malformed inputs', () => {
  it('should throw on invalid JSON', () => {
    expect(() => parsePath('not json')).toThrow();
  });

  it('should silently return empty path for non-array JSON (missing validation)', () => {
    // BUG (Medium): parsePath accepts non-array JSON without error.
    // It returns {nodes: [], edges: []} because object.length is undefined
    // and the for loop condition `0 < undefined` is false.
    const path = parsePath('{"key": "value"}');
    expect(path.nodes).toHaveLength(0);
    expect(path.edges).toHaveLength(0);
  });

  it('should handle empty array', () => {
    const path = parsePath('[]');
    expect(path.nodes).toHaveLength(0);
    expect(path.edges).toHaveLength(0);
  });

  it('should handle node with missing table field', () => {
    const json = JSON.stringify([{ id: 1, name: 'Alice' }]);
    const path = parsePath(json);
    // table should be undefined since the field is missing
    expect(path.nodes).toHaveLength(1);
    expect(path.nodes[0].table).toBeUndefined();
    expect(path.nodes[0].id).toBe(1);
    expect(path.nodes[0].properties).toEqual({ name: 'Alice' });
  });

  it('should handle node with missing id field', () => {
    const json = JSON.stringify([{ table: 'users', name: 'Alice' }]);
    const path = parsePath(json);
    expect(path.nodes[0].id).toBeUndefined();
    expect(path.nodes[0].table).toBe('users');
  });

  it('should handle edge with missing edge_type field', () => {
    const json = JSON.stringify([
      { table: 'users', id: 1 },
      { from_id: 1, to_id: 2 },
      { table: 'users', id: 2 },
    ]);
    const path = parsePath(json);
    expect(path.edges[0].edgeType).toBeUndefined();
    expect(path.edges[0].fromId).toBe(1);
    expect(path.edges[0].toId).toBe(2);
  });

  it('should handle even-length array (trailing edge without target node)', () => {
    const json = JSON.stringify([
      { table: 'users', id: 1 },
      { edge_type: 'follows', from_id: 1, to_id: 2 },
    ]);
    const path = parsePath(json);
    // Should get 1 node and 1 edge (no destination node)
    expect(path.nodes).toHaveLength(1);
    expect(path.edges).toHaveLength(1);
  });

  it('should handle null values within elements', () => {
    const json = JSON.stringify([
      { table: null, id: null, name: null },
    ]);
    const path = parsePath(json);
    expect(path.nodes[0].table).toBeNull();
    expect(path.nodes[0].id).toBeNull();
    expect(path.nodes[0].properties).toEqual({ name: null });
  });
});

describe('QA parsePath — large and complex paths', () => {
  it('should handle a long path (100 nodes, 99 edges)', () => {
    const elements: Record<string, unknown>[] = [];
    for (let i = 0; i < 100; i++) {
      elements.push({ table: 'nodes', id: i });
      if (i < 99) {
        elements.push({ edge_type: 'connects', from_id: i, to_id: i + 1 });
      }
    }
    const path = parsePath(JSON.stringify(elements));
    expect(path.nodes).toHaveLength(100);
    expect(path.edges).toHaveLength(99);
  });

  it('should preserve node order', () => {
    const json = JSON.stringify([
      { table: 'users', id: 'first' },
      { edge_type: 'follows', from_id: 'first', to_id: 'second' },
      { table: 'users', id: 'second' },
      { edge_type: 'follows', from_id: 'second', to_id: 'third' },
      { table: 'users', id: 'third' },
    ]);
    const path = parsePath(json);
    expect(path.nodes[0].id).toBe('first');
    expect(path.nodes[1].id).toBe('second');
    expect(path.nodes[2].id).toBe('third');
  });

  it('should preserve edge order', () => {
    const json = JSON.stringify([
      { table: 'users', id: 1 },
      { edge_type: 'alpha', from_id: 1, to_id: 2 },
      { table: 'users', id: 2 },
      { edge_type: 'beta', from_id: 2, to_id: 3 },
      { table: 'users', id: 3 },
    ]);
    const path = parsePath(json);
    expect(path.edges[0].edgeType).toBe('alpha');
    expect(path.edges[1].edgeType).toBe('beta');
  });

  it('should handle nodes with many properties', () => {
    const props: Record<string, unknown> = {};
    for (let i = 0; i < 50; i++) {
      props[`prop_${i}`] = `value_${i}`;
    }
    const json = JSON.stringify([{ table: 'users', id: 1, ...props }]);
    const path = parsePath(json);
    expect(Object.keys(path.nodes[0].properties)).toHaveLength(50);
    expect(path.nodes[0].properties['prop_0']).toBe('value_0');
    expect(path.nodes[0].properties['prop_49']).toBe('value_49');
  });

  it('should handle edges with many properties', () => {
    const json = JSON.stringify([
      { table: 'a', id: 1 },
      {
        edge_type: 'rel',
        from_id: 1,
        to_id: 2,
        weight: 0.5,
        label: 'test',
        count: 42,
        nested: { key: 'val' },
      },
      { table: 'b', id: 2 },
    ]);
    const path = parsePath(json);
    expect(path.edges[0].properties).toEqual({
      weight: 0.5,
      label: 'test',
      count: 42,
      nested: { key: 'val' },
    });
  });
});

describe('QA parsePath — TypeOID.PATH integration', () => {
  it('should parse PATH via parseValue', () => {
    const json = JSON.stringify([
      { table: 'users', id: 1 },
      { edge_type: 'follows', from_id: 1, to_id: 2 },
      { table: 'users', id: 2 },
    ]);
    const result = parseValue(TypeOID.PATH, json) as Path;
    expect(result.nodes).toHaveLength(2);
    expect(result.edges).toHaveLength(1);
  });

  it('should parse empty path via parseValue', () => {
    const result = parseValue(TypeOID.PATH, '[]') as Path;
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
  });

  it('should throw on invalid JSON via parseValue for PATH', () => {
    expect(() => parseValue(TypeOID.PATH, '{invalid')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// buildMatch + buildShortestMatch — SQL injection-like inputs
// ---------------------------------------------------------------------------

describe('QA query builders — SQL injection resistance', () => {
  it('should escape double quotes in table names for MATCH', () => {
    const q = buildMatch(
      [
        { alias: 'a', table: '"; DROP TABLE users; --' },
        { alias: 'r', edgeType: 'follows', direction: 'OUT' },
        { alias: 'b', table: 'users' },
      ],
      { returnItems: ['a'] },
    );
    // Double quotes should be doubled inside the identifier
    // Input: "; DROP TABLE users; --
    // Escaped: ""; DROP TABLE users; --"  (the leading " is doubled)
    expect(q.text).toContain('""; DROP TABLE users; --"');
  });

  it('should escape double quotes in edge types', () => {
    const q = buildMatch(
      [
        { alias: 'a', table: 'users' },
        { alias: 'r', edgeType: '"; DROP TABLE', direction: 'OUT' },
        { alias: 'b', table: 'users' },
      ],
      { returnItems: ['a'] },
    );
    expect(q.text).toContain('""; DROP TABLE"');
  });

  it('should escape quotes in SHORTEST PATH identifiers', () => {
    const q = buildShortestPath('"evil', '"table', 1, '"table', 2);
    expect(q.text).toContain('"""evil"');
    expect(q.text).toContain('"""table"');
  });
});

// ---------------------------------------------------------------------------
// Acceptance criteria coverage verification
// ---------------------------------------------------------------------------

describe('QA AC verification — MATCH builder generates SELECT...FROM MATCH', () => {
  it('should generate SELECT...FROM MATCH (AC #1)', () => {
    const q = buildMatch(
      [
        { alias: 'a', table: 'users' },
        { alias: 'r', edgeType: 'follows', direction: 'OUT' },
        { alias: 'b', table: 'users' },
      ],
      { returnItems: ['a', 'r', 'b'] },
    );
    expect(q.text).toMatch(/^SELECT .+ FROM MATCH /);
  });
});

describe('QA AC verification — Hop quantifiers supported (AC #2)', () => {
  it('should support {min,max} quantifier', () => {
    const q = buildMatch(
      [
        { alias: 'a', table: 'users' },
        { alias: 'r', edgeType: 'follows', direction: 'OUT', quantifier: '{2,5}' },
        { alias: 'b', table: 'users' },
      ],
      { returnItems: ['a', 'b'] },
    );
    expect(q.text).toContain('{2,5}');
  });

  it('should support + quantifier', () => {
    const q = buildMatch(
      [
        { alias: 'a', table: 'users' },
        { alias: 'r', edgeType: 'follows', direction: 'OUT', quantifier: '+' },
        { alias: 'b', table: 'users' },
      ],
      { returnItems: ['a', 'b'] },
    );
    expect(q.text).toContain('->+');
  });

  it('should support * quantifier', () => {
    const q = buildMatch(
      [
        { alias: 'a', table: 'users' },
        { alias: 'r', edgeType: 'follows', direction: 'OUT', quantifier: '*' },
        { alias: 'b', table: 'users' },
      ],
      { returnItems: ['a', 'b'] },
    );
    expect(q.text).toContain('->*');
  });
});

describe('QA AC verification — Path selector builder works (AC #3)', () => {
  const pattern: MatchPatternElement[] = [
    { alias: 'a', table: 'users' },
    { alias: 'r', edgeType: 'follows', direction: 'OUT' },
    { alias: 'b', table: 'users' },
  ];

  it('should support ANY SHORTEST selector', () => {
    const q = buildShortestMatch(pattern, ['a', 'b'], 'ANY SHORTEST');
    expect(q.text).toContain('ANY SHORTEST');
    expect(q.text).toMatch(/^SELECT .+ FROM MATCH /);
  });

  it('should support ALL SHORTEST selector', () => {
    const q = buildShortestMatch(pattern, ['a', 'b'], 'ALL SHORTEST');
    expect(q.text).toContain('ALL SHORTEST');
  });

  it('should support SHORTEST K selector', () => {
    const q = buildShortestMatch(pattern, ['a', 'b'], 'SHORTEST', { k: 5 });
    expect(q.text).toContain('SHORTEST 5');
  });

  it('should support WEIGHT clause', () => {
    const q = buildShortestMatch(pattern, ['a', 'b'], 'ANY SHORTEST', {
      weight: 'r.cost',
    });
    expect(q.text).toContain('WEIGHT r.cost');
  });
});

describe('QA AC verification — SHORTEST PATH SELECT composability (AC #4)', () => {
  it('should wrap with SELECT * FROM by default', () => {
    const q = buildShortestPath('follows', 'users', 1, 'users', 2);
    expect(q.text).toMatch(/^SELECT \* FROM SHORTEST PATH/);
  });

  it('should support custom SELECT clause as identifier array (GDB-670)', () => {
    const q = buildShortestPath('follows', 'users', 1, 'users', 2, {
      select: ['path_length', 'nodes'],
    });
    expect(q.text).toMatch(
      /^SELECT "path_length", "nodes" FROM SHORTEST PATH/,
    );
  });
});

describe('QA AC verification — Path result parsing with TypeScript types (AC #5)', () => {
  it('should parse path with correct TypeScript types', () => {
    const json = JSON.stringify([
      { table: 'users', id: 1, name: 'Alice' },
      { edge_type: 'follows', from_id: 1, to_id: 2 },
      { table: 'users', id: 2, name: 'Bob' },
    ]);
    const path: Path = parsePath(json);
    // Verify PathNode shape
    expect(path.nodes[0]).toHaveProperty('table');
    expect(path.nodes[0]).toHaveProperty('id');
    expect(path.nodes[0]).toHaveProperty('properties');
    // Verify PathEdge shape
    expect(path.edges[0]).toHaveProperty('edgeType');
    expect(path.edges[0]).toHaveProperty('fromId');
    expect(path.edges[0]).toHaveProperty('toId');
    expect(path.edges[0]).toHaveProperty('properties');
  });

  it('should have PATH TypeOID registered', () => {
    expect(TypeOID.PATH).toBe(100006);
  });
});

describe('QA AC verification — Backward compatibility preserved (AC #6)', () => {
  it('should generate legacy MATCH...RETURN syntax when requested', () => {
    const q = buildMatch(
      [
        { alias: 'a', table: 'users' },
        { alias: 'r', edgeType: 'follows', direction: 'OUT' },
        { alias: 'b', table: 'users' },
      ],
      { returnItems: ['a', 'b'], legacySyntax: true },
    );
    expect(q.text).toMatch(/^MATCH .+ RETURN /);
    expect(q.text).not.toContain('SELECT');
  });

  it('should generate legacy SHORTEST PATH without SELECT when requested', () => {
    const q = buildShortestPath('follows', 'users', 1, 'users', 2, {
      legacySyntax: true,
    });
    expect(q.text).toMatch(/^SHORTEST PATH/);
    expect(q.text).not.toContain('SELECT');
  });
});
