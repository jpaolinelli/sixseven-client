/**
 * QA adversarial tests for GDB-665 (SQL injection via select denylist bypass)
 * and GDB-666 (length cap on select identifiers).
 *
 * Verifies the new allowlist-based `renderSelect` in
 * `clients/nodejs/src/query-builders.ts`:
 *   - SelectClause = '*' | readonly string[]
 *   - Identifier regex: /^[A-Za-z_][A-Za-z0-9_]*$/  (no `m` flag)
 *   - Each identifier max 64 chars; max 1000 entries per array
 *   - Identifiers double-quoted with internal `"` doubled (defense in depth)
 *
 * Plus regression coverage for buildShortestPath, which historically
 * raw-interpolated options.select (closed in GDB-670 by routing through the
 * same renderSelect allowlist).
 */
import { describe, it, expect } from 'vitest';
import {
  buildPagerank,
  buildBetweennessCentrality,
  buildConnectedComponents,
  buildLouvain,
  buildDegreeCentrality,
  buildClosenessCentrality,
  buildEigenvectorCentrality,
  buildHarmonicCentrality,
  buildClusteringCoefficient,
  buildTriangleCount,
  buildStronglyConnectedComponents,
  buildShortestPath,
} from '../src/query-builders';

// All eleven algorithm builders that route through renderSelect.
// Each entry is [name, invoker(select)] — invoker takes the select option and
// returns a query object.
const ALGO_BUILDERS: ReadonlyArray<
  [string, (select: unknown) => { text: string; values: unknown[] }]
> = [
  ['buildPagerank', (s) => buildPagerank('knows', { select: s as never })],
  [
    'buildBetweennessCentrality',
    (s) => buildBetweennessCentrality('knows', { select: s as never }),
  ],
  [
    'buildConnectedComponents',
    (s) => buildConnectedComponents('knows', { select: s as never }),
  ],
  ['buildLouvain', (s) => buildLouvain('knows', { select: s as never })],
  [
    'buildDegreeCentrality',
    (s) => buildDegreeCentrality('knows', { select: s as never }),
  ],
  [
    'buildClosenessCentrality',
    (s) => buildClosenessCentrality('knows', { select: s as never }),
  ],
  [
    'buildEigenvectorCentrality',
    (s) => buildEigenvectorCentrality('knows', { select: s as never }),
  ],
  [
    'buildHarmonicCentrality',
    (s) => buildHarmonicCentrality('knows', { select: s as never }),
  ],
  [
    'buildClusteringCoefficient',
    (s) => buildClusteringCoefficient('knows', { select: s as never }),
  ],
  [
    'buildTriangleCount',
    (s) => buildTriangleCount('knows', { select: s as never }),
  ],
  [
    'buildStronglyConnectedComponents',
    (s) => buildStronglyConnectedComponents('knows', { select: s as never }),
  ],
];

// ---------------------------------------------------------------------------
// 1. Direct SQL injection attempts (GDB-665 originals)
// ---------------------------------------------------------------------------

describe('GDB-665 — classic SQL injection rejection', () => {
  const PAYLOADS = [
    '*; DROP TABLE users;--',
    "1; DROP TABLE users; --",
    "* FROM users; --",
    "(SELECT password FROM users)",
    "col1, col2; DELETE FROM nodes",
    "* UNION SELECT password FROM users --",
    "col, (SELECT pg_sleep(10))",
  ];

  for (const [name, build] of ALGO_BUILDERS) {
    for (const payload of PAYLOADS) {
      it(`${name} rejects raw injection string ${JSON.stringify(payload)}`, () => {
        expect(() => build(payload)).toThrow(TypeError);
      });
      it(`${name} rejects injection inside an array entry ${JSON.stringify(payload)}`, () => {
        expect(() => build([payload])).toThrow();
      });
      it(`${name} rejects injection in second array entry`, () => {
        expect(() => build(['node_id', payload])).toThrow();
      });
    }
  }
});

// ---------------------------------------------------------------------------
// 2. Allowlist bypass — Unicode lookalikes
// ---------------------------------------------------------------------------

describe('GDB-665 — Unicode lookalike rejection', () => {
  const UNICODE_LOOKALIKES = [
    'А',          // Cyrillic capital A
    'Аdmin',      // Cyrillic A + Latin
    'Ａ',          // Fullwidth A
    'Ａdmin',
    'á',         // a + combining acute
    'α',          // Greek lowercase alpha
    'αdmin',
    '\u{1D434}',       // Math italic A (surrogate pair)
    'col​',       // zero-width space
    'col﻿',       // BOM
    'µ',          // Micro sign
    'naïve',           // accented Latin
    'café',
  ];

  for (const ident of UNICODE_LOOKALIKES) {
    it(`buildPagerank rejects Unicode identifier ${JSON.stringify(ident)}`, () => {
      expect(() => buildPagerank('knows', { select: [ident] })).toThrow(
        TypeError,
      );
    });
  }
});

// ---------------------------------------------------------------------------
// 3. SQL keywords pass the regex but are safely double-quoted
// ---------------------------------------------------------------------------

describe('GDB-665 — SQL keywords accepted but rendered as quoted identifiers', () => {
  const KEYWORDS = [
    'select',
    'from',
    'union',
    'case',
    'when',
    'null',
    'true',
    'false',
    'where',
    'drop',
    'delete',
    'insert',
    'update',
    'table',
  ];

  // Words that legitimately appear in the SQL template ("SELECT ... FROM ...")
  // and so cannot be checked with the strip-quoted-identifiers heuristic.
  const TEMPLATE_WORDS = new Set(['select', 'from']);

  for (const kw of KEYWORDS) {
    it(`accepts keyword "${kw}" and double-quotes it`, () => {
      const q = buildPagerank('knows', { select: [kw] });
      // Must contain the quoted identifier — never bare.
      expect(q.text).toContain(`"${kw}"`);
      if (!TEMPLATE_WORDS.has(kw)) {
        // The keyword should ONLY appear inside the quoted identifier.
        const stripped = q.text.replace(/"[^"]*"/g, '');
        expect(stripped.toLowerCase()).not.toContain(kw);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// 4. Identifier length boundaries
// ---------------------------------------------------------------------------

describe('GDB-666 — identifier length cap (64 chars)', () => {
  it('accepts a 64-character identifier (boundary, inclusive)', () => {
    const id = 'a'.repeat(64);
    const q = buildPagerank('knows', { select: [id] });
    expect(q.text).toContain(`"${id}"`);
  });

  it('rejects a 65-character identifier (just over)', () => {
    const id = 'a'.repeat(65);
    expect(() => buildPagerank('knows', { select: [id] })).toThrow(RangeError);
  });

  it('rejects a 1000-character identifier', () => {
    const id = 'a'.repeat(1000);
    expect(() => buildPagerank('knows', { select: [id] })).toThrow(RangeError);
  });

  it('accepts a 1-character identifier', () => {
    const q = buildPagerank('knows', { select: ['a'] });
    expect(q.text).toContain('"a"');
  });

  it('rejects an empty-string identifier', () => {
    expect(() => buildPagerank('knows', { select: [''] })).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// 5. Array length boundaries
// ---------------------------------------------------------------------------

describe('GDB-666 — array length cap (1000 entries)', () => {
  it('accepts exactly 1000 entries (boundary, inclusive)', () => {
    const arr = Array.from({ length: 1000 }, (_, i) => `c${i}`);
    const q = buildPagerank('knows', { select: arr });
    // Should render all 1000 quoted identifiers.
    expect((q.text.match(/"c\d+"/g) ?? []).length).toBe(1000);
  });

  it('rejects 1001 entries (just over)', () => {
    const arr = Array.from({ length: 1001 }, (_, i) => `c${i}`);
    expect(() => buildPagerank('knows', { select: arr })).toThrow(RangeError);
  });

  it('rejects an empty array', () => {
    expect(() => buildPagerank('knows', { select: [] })).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// 6. Mixed valid + invalid in same array
// ---------------------------------------------------------------------------

describe('GDB-665 — mixed valid + invalid', () => {
  it('rejects array when second entry is an injection payload', () => {
    expect(() =>
      buildPagerank('knows', { select: ['valid_col', 'evil; DROP'] }),
    ).toThrow();
  });

  it('error message identifies the offending index', () => {
    try {
      buildPagerank('knows', { select: ['valid_col', '!!!bad!!!'] });
      throw new Error('should have thrown');
    } catch (err) {
      expect((err as Error).message).toContain('select[1]');
    }
  });
});

// ---------------------------------------------------------------------------
// 7. TypeScript bypass — runtime check catches non-string array entries
// ---------------------------------------------------------------------------

describe('GDB-665 — runtime type check on array entries', () => {
  it('rejects null in array', () => {
    expect(() =>
      buildPagerank('knows', { select: ['col', null] as never }),
    ).toThrow(TypeError);
  });

  it('rejects undefined in array', () => {
    expect(() =>
      buildPagerank('knows', { select: ['col', undefined] as never }),
    ).toThrow(TypeError);
  });

  it('rejects number in array', () => {
    expect(() =>
      buildPagerank('knows', { select: ['col', 42] as never }),
    ).toThrow(TypeError);
  });

  it('rejects boolean in array', () => {
    expect(() =>
      buildPagerank('knows', { select: ['col', true] as never }),
    ).toThrow(TypeError);
  });

  it('rejects nested array', () => {
    expect(() =>
      buildPagerank('knows', { select: ['col', ['nested']] as never }),
    ).toThrow(TypeError);
  });

  it('rejects object in array', () => {
    expect(() =>
      buildPagerank('knows', { select: ['col', { foo: 'bar' }] as never }),
    ).toThrow(TypeError);
  });

  it('rejects sparse array hole (undefined)', () => {
    // eslint-disable-next-line no-sparse-arrays
    const arr: string[] = ['col1', , 'col3'] as never;
    expect(() => buildPagerank('knows', { select: arr })).toThrow(TypeError);
  });

  it('rejects boxed String() primitive', () => {
    // String("x") returns a string primitive, but new String("x") is an object.
    const boxed = new String('col') as unknown as string;
    expect(() =>
      buildPagerank('knows', { select: [boxed] as never }),
    ).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// 8. Type confusion — non-Array iterables and array-likes
// ---------------------------------------------------------------------------

describe('GDB-665 — non-Array values rejected', () => {
  it('rejects array-like object {0,1,length}', () => {
    const arrayLike = { 0: 'col1', 1: 'col2', length: 2 };
    expect(() =>
      buildPagerank('knows', { select: arrayLike as never }),
    ).toThrow(TypeError);
  });

  it('rejects Uint8Array', () => {
    const ta = new Uint8Array([65, 66]);
    expect(() => buildPagerank('knows', { select: ta as never })).toThrow(
      TypeError,
    );
  });

  it('rejects Set', () => {
    const set = new Set(['col1', 'col2']);
    expect(() => buildPagerank('knows', { select: set as never })).toThrow(
      TypeError,
    );
  });

  it('rejects generator', () => {
    function* gen() {
      yield 'col1';
      yield 'col2';
    }
    expect(() => buildPagerank('knows', { select: gen() as never })).toThrow(
      TypeError,
    );
  });

  it('rejects Object.create(Array.prototype) masquerade', () => {
    const fake = Object.create(Array.prototype);
    fake[0] = 'col';
    fake.length = 1;
    expect(() => buildPagerank('knows', { select: fake as never })).toThrow(
      TypeError,
    );
  });
});

// ---------------------------------------------------------------------------
// 9. TOCTOU — Proxy / getter-mutation attempts
// ---------------------------------------------------------------------------

describe('GDB-665 — TOCTOU resistance', () => {
  it('accepts a Proxy array but binds whatever it returns at iteration time', () => {
    // Array.isArray returns true for Proxy of an array.
    const target: string[] = ['col1', 'col2'];
    const proxy = new Proxy(target, {});
    const q = buildPagerank('knows', { select: proxy });
    expect(q.text).toContain('"col1"');
    expect(q.text).toContain('"col2"');
  });

  it('getter-mutation: defineProperty getter returning malicious string is still validated', () => {
    const arr: string[] = ['col1', 'col2'];
    Object.defineProperty(arr, '0', {
      get: () => 'evil; DROP TABLE users; --',
      configurable: true,
    });
    // The getter returns an invalid identifier; renderSelect must reject it.
    expect(() => buildPagerank('knows', { select: arr })).toThrow();
  });

  it('Proxy that returns different valid identifier on each access still binds the validated value', () => {
    // Audit: renderSelect should iterate once, validate that value, and use
    // THAT validated value in the SQL — not re-fetch from the Proxy later.
    let calls = 0;
    const target: string[] = ['col1'];
    const proxy = new Proxy(target, {
      get(t, prop, recv) {
        if (prop === '0') {
          calls++;
          // First call (validation) returns valid; later calls would return evil.
          return calls === 1 ? 'valid_col' : 'evil; DROP';
        }
        return Reflect.get(t, prop, recv);
      },
    });
    const q = buildPagerank('knows', { select: proxy });
    // The SQL must NOT contain the evil string.
    expect(q.text).not.toContain('DROP');
    expect(q.text).not.toContain(';');
  });
});

// ---------------------------------------------------------------------------
// 10. Trailing whitespace / control char rejection (GDB-669 lesson)
// ---------------------------------------------------------------------------

describe('GDB-669 lesson — trailing/leading whitespace rejected', () => {
  const WHITESPACE_VARIANTS = [
    'col\n',
    'col\r',
    'col\r\n',
    'col\t',
    ' col',
    'col ',
    '\ncol',
    'col\n\n',
    'col\v',
    'col\f',
    'col ',
    'col ', // non-breaking space
    'col;',
    'col--',
    'col"',
    "col'",
  ];

  for (const ident of WHITESPACE_VARIANTS) {
    it(`rejects identifier ${JSON.stringify(ident)}`, () => {
      expect(() => buildPagerank('knows', { select: [ident] })).toThrow(
        TypeError,
      );
    });
  }
});

// ---------------------------------------------------------------------------
// 11. Empty / undefined / null select option
// ---------------------------------------------------------------------------

describe('GDB-665 — select option default and edge values', () => {
  it('rejects empty string select', () => {
    expect(() => buildPagerank('knows', { select: '' as never })).toThrow(
      TypeError,
    );
  });

  it('rejects whitespace-only string select', () => {
    expect(() => buildPagerank('knows', { select: ' ' as never })).toThrow(
      TypeError,
    );
  });

  it('rejects "**"', () => {
    expect(() => buildPagerank('knows', { select: '**' as never })).toThrow(
      TypeError,
    );
  });

  it('accepts the literal "*"', () => {
    const q = buildPagerank('knows', { select: '*' });
    expect(q.text).toBe('SELECT * FROM pagerank($1, $2, $3)');
  });

  it('treats undefined select as default "*"', () => {
    const q = buildPagerank('knows', { select: undefined });
    expect(q.text).toBe('SELECT * FROM pagerank($1, $2, $3)');
  });

  it('treats null select as default "*"', () => {
    const q = buildPagerank('knows', { select: null });
    expect(q.text).toBe('SELECT * FROM pagerank($1, $2, $3)');
  });

  it('treats omitted select as default "*"', () => {
    const q = buildPagerank('knows');
    expect(q.text).toBe('SELECT * FROM pagerank($1, $2, $3)');
  });
});

// ---------------------------------------------------------------------------
// 12. Round-trip: order preserved, no dedup, comma+space separator
// ---------------------------------------------------------------------------

describe('GDB-665 — round-trip rendering', () => {
  it('preserves identifier order', () => {
    const q = buildPagerank('knows', {
      select: ['z_col', 'a_col', 'm_col'],
    });
    expect(q.text).toBe(
      'SELECT "z_col", "a_col", "m_col" FROM pagerank($1, $2, $3)',
    );
  });

  it('does not deduplicate identifiers', () => {
    const q = buildPagerank('knows', {
      select: ['col', 'col', 'col'],
    });
    expect(q.text).toBe('SELECT "col", "col", "col" FROM pagerank($1, $2, $3)');
  });

  it('uses ", " separator (comma + single space)', () => {
    const q = buildPagerank('knows', { select: ['a', 'b'] });
    expect(q.text).toContain('"a", "b"');
  });

  it('all 11 builders use the same select rendering', () => {
    for (const [name, build] of ALGO_BUILDERS) {
      const q = build(['node_id', 'score']);
      expect(q.text, `${name} should quote identifiers`).toContain(
        '"node_id", "score"',
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 13. All 11 builders accept "*" by default and reject injection
// ---------------------------------------------------------------------------

describe('GDB-665 — all 11 algorithm builders covered', () => {
  for (const [name, build] of ALGO_BUILDERS) {
    it(`${name} routes injection through renderSelect (rejected)`, () => {
      expect(() => build('* FROM users; --')).toThrow(TypeError);
    });
    it(`${name} accepts "*" default`, () => {
      const q = build('*');
      expect(q.text.startsWith('SELECT * FROM ')).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// 14. Defense in depth — quote escape never reachable but verified
// ---------------------------------------------------------------------------

describe('GDB-665 — defense in depth: quote escaping', () => {
  it('regex disallows " inside identifier (so escape is unreachable)', () => {
    expect(() =>
      buildPagerank('knows', { select: ['col"; DROP--'] }),
    ).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// 15. GDB-670 — buildShortestPath select goes through renderSelect
//
// Historically buildShortestPath raw-interpolated options.select, leaving the
// same SQL-injection class GDB-665 closed for the algorithm builders open in
// the SHORTEST PATH builder. GDB-670 routes it through renderSelect; this
// section is the regression that locks the fix in.
// ---------------------------------------------------------------------------

describe('GDB-670 — buildShortestPath routes select through renderSelect', () => {
  // Mirror the algorithm-builder injection payloads.
  const PAYLOADS = [
    '*; DROP TABLE users;--',
    "1; DROP TABLE users; --",
    "* FROM users; --",
    "(SELECT password FROM users)",
    "col1, col2; DELETE FROM nodes",
    "* UNION SELECT password FROM users --",
    "col, (SELECT pg_sleep(10))",
    'col1, col2', // raw projection string — the original GDB-477 escape hatch
    'path_length, nodes',
    'col/*comment*/',
    '"; DROP TABLE users; --',
  ];

  for (const payload of PAYLOADS) {
    it(`rejects raw injection string ${JSON.stringify(payload)}`, () => {
      expect(() =>
        buildShortestPath('knows', 'users', 1, 'users', 2, {
          select: payload as never,
        }),
      ).toThrow(TypeError);
    });

    it(`rejects injection inside an array entry ${JSON.stringify(payload)}`, () => {
      expect(() =>
        buildShortestPath('knows', 'users', 1, 'users', 2, {
          select: [payload],
        }),
      ).toThrow();
    });

    it(`rejects injection in second array entry ${JSON.stringify(payload)}`, () => {
      expect(() =>
        buildShortestPath('knows', 'users', 1, 'users', 2, {
          select: ['node_id', payload],
        }),
      ).toThrow();
    });
  }

  it('rejects empty string select', () => {
    expect(() =>
      buildShortestPath('knows', 'users', 1, 'users', 2, {
        select: '' as never,
      }),
    ).toThrow(TypeError);
  });

  it('rejects whitespace-only string select', () => {
    expect(() =>
      buildShortestPath('knows', 'users', 1, 'users', 2, {
        select: ' ' as never,
      }),
    ).toThrow(TypeError);
  });

  it('rejects "**"', () => {
    expect(() =>
      buildShortestPath('knows', 'users', 1, 'users', 2, {
        select: '**' as never,
      }),
    ).toThrow(TypeError);
  });

  it('rejects empty array', () => {
    expect(() =>
      buildShortestPath('knows', 'users', 1, 'users', 2, { select: [] }),
    ).toThrow(TypeError);
  });

  it('accepts the literal "*"', () => {
    const q = buildShortestPath('knows', 'users', 1, 'users', 2, {
      select: '*',
    });
    expect(q.text).toBe(
      'SELECT * FROM SHORTEST PATH FROM "users"($1) TO "users"($2) VIA "knows"',
    );
  });

  it('treats undefined select as default "*"', () => {
    const q = buildShortestPath('knows', 'users', 1, 'users', 2, {
      select: undefined,
    });
    expect(q.text.startsWith('SELECT * FROM SHORTEST PATH ')).toBe(true);
  });

  it('treats null select as default "*"', () => {
    const q = buildShortestPath('knows', 'users', 1, 'users', 2, {
      select: null,
    });
    expect(q.text.startsWith('SELECT * FROM SHORTEST PATH ')).toBe(true);
  });

  it('treats omitted select as default "*"', () => {
    const q = buildShortestPath('knows', 'users', 1, 'users', 2);
    expect(q.text.startsWith('SELECT * FROM SHORTEST PATH ')).toBe(true);
  });

  it('accepts an identifier array and double-quotes each entry', () => {
    const q = buildShortestPath('knows', 'users', 1, 'users', 2, {
      select: ['path_length', 'nodes'],
    });
    expect(q.text).toBe(
      'SELECT "path_length", "nodes" FROM SHORTEST PATH FROM "users"($1) TO "users"($2) VIA "knows"',
    );
  });

  it('preserves identifier order and does not deduplicate', () => {
    const q = buildShortestPath('knows', 'users', 1, 'users', 2, {
      select: ['z', 'a', 'a'],
    });
    expect(q.text.startsWith('SELECT "z", "a", "a" FROM SHORTEST PATH ')).toBe(
      true,
    );
  });

  it('rejects a 65-character identifier (GDB-666 length cap)', () => {
    expect(() =>
      buildShortestPath('knows', 'users', 1, 'users', 2, {
        select: ['a'.repeat(65)],
      }),
    ).toThrow(RangeError);
  });

  it('accepts a 64-character identifier (GDB-666 boundary)', () => {
    const id = 'a'.repeat(64);
    const q = buildShortestPath('knows', 'users', 1, 'users', 2, {
      select: [id],
    });
    expect(q.text).toContain(`"${id}"`);
  });

  it('rejects 1001 entries (GDB-666 array cap)', () => {
    const arr = Array.from({ length: 1001 }, (_, i) => `c${i}`);
    expect(() =>
      buildShortestPath('knows', 'users', 1, 'users', 2, { select: arr }),
    ).toThrow(RangeError);
  });

  it('rejects Unicode lookalike identifier', () => {
    expect(() =>
      buildShortestPath('knows', 'users', 1, 'users', 2, {
        select: ['Аdmin'], // Cyrillic A
      }),
    ).toThrow(TypeError);
  });

  it('rejects non-Array iterable (Set)', () => {
    expect(() =>
      buildShortestPath('knows', 'users', 1, 'users', 2, {
        select: new Set(['col1', 'col2']) as never,
      }),
    ).toThrow(TypeError);
  });

  it('rejects null in array', () => {
    expect(() =>
      buildShortestPath('knows', 'users', 1, 'users', 2, {
        select: ['col', null] as never,
      }),
    ).toThrow(TypeError);
  });

  it('rejects trailing newline (GDB-669 lesson)', () => {
    expect(() =>
      buildShortestPath('knows', 'users', 1, 'users', 2, {
        select: ['col\n'],
      }),
    ).toThrow(TypeError);
  });

  it('legacySyntax=true bypasses SELECT wrapping entirely (no projection rendered)', () => {
    // When legacySyntax is requested the builder emits bare SHORTEST PATH —
    // there is no SELECT to inject into, so select is ignored. Verify no
    // throw and no SELECT in the output.
    const q = buildShortestPath('knows', 'users', 1, 'users', 2, {
      legacySyntax: true,
      // Even an obviously malicious string should be ignored in this branch
      // because the builder never reaches renderSelect.
      select: '*; DROP TABLE users; --' as never,
    });
    expect(q.text).toBe(
      'SHORTEST PATH FROM "users"($1) TO "users"($2) VIA "knows"',
    );
    expect(q.text).not.toContain('SELECT');
    expect(q.text).not.toContain('DROP');
  });
});
