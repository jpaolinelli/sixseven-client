/**
 * QA adversarial tests for GDB-670: SQL injection via raw `select`
 * interpolation in `buildShortestPath`.
 *
 * The fix routes `options.select` through `renderSelect(...)` (the same
 * allowlist used for the GDB-665 algorithm builders) and tightens the type:
 *   `SelectClause = '*' | readonly string[]`
 *
 * The `legacySyntax: true` branch was deliberately untouched — that branch
 * never emits a SELECT clause, so any provided `select` should be silently
 * ignored without leaking into the generated SQL.
 *
 * These tests probe the buildShortestPath-specific surface (legacy branch,
 * truthiness coercion, direction/maxDepth side channels, pool/client
 * forwarding, and `as any` runtime bypass attempts).
 */
import { describe, it, expect } from 'vitest';
import { buildShortestPath } from '../src/query-builders';
import type { ShortestPathOptions } from '../src/types';

// ---------------------------------------------------------------------------
// Core injection vectors via options.select (non-legacy path)
// ---------------------------------------------------------------------------

describe('QA GDB-670 buildShortestPath select injection (non-legacy)', () => {
  it('rejects classic injection string "*; DROP TABLE users; --"', () => {
    expect(() =>
      buildShortestPath('knows', 'u', 1, 'u', 2, {
        select: '*; DROP TABLE users; --' as unknown as never,
      } as ShortestPathOptions),
    ).toThrow(TypeError);
  });

  it('rejects raw projection string "col1, col2"', () => {
    expect(() =>
      buildShortestPath('knows', 'u', 1, 'u', 2, {
        select: 'col1, col2' as unknown as never,
      } as ShortestPathOptions),
    ).toThrow(/must be the string "\*"/);
  });

  it('rejects function call projection "COUNT(*)"', () => {
    expect(() =>
      buildShortestPath('knows', 'u', 1, 'u', 2, {
        select: 'COUNT(*)' as unknown as never,
      } as ShortestPathOptions),
    ).toThrow(TypeError);
  });

  it('rejects subquery injection "id FROM other_table; --"', () => {
    expect(() =>
      buildShortestPath('knows', 'u', 1, 'u', 2, {
        select: 'id FROM other_table; --' as unknown as never,
      } as ShortestPathOptions),
    ).toThrow(TypeError);
  });

  it('rejects array element with semicolon', () => {
    expect(() =>
      buildShortestPath('knows', 'u', 1, 'u', 2, {
        select: ['id; DROP TABLE users; --'] as unknown as readonly string[],
      }),
    ).toThrow(TypeError);
  });

  it('rejects array element with comma (would emit "id", "x" as injection)', () => {
    expect(() =>
      buildShortestPath('knows', 'u', 1, 'u', 2, {
        select: ['id, x'] as unknown as readonly string[],
      }),
    ).toThrow(TypeError);
  });

  it('rejects array element with embedded quote', () => {
    expect(() =>
      buildShortestPath('knows', 'u', 1, 'u', 2, {
        select: ['id"x'] as unknown as readonly string[],
      }),
    ).toThrow(TypeError);
  });

  it('rejects empty array', () => {
    expect(() =>
      buildShortestPath('knows', 'u', 1, 'u', 2, { select: [] }),
    ).toThrow(/at least one column identifier/);
  });

  it('rejects array element starting with digit', () => {
    expect(() =>
      buildShortestPath('knows', 'u', 1, 'u', 2, {
        select: ['1abc'] as unknown as readonly string[],
      }),
    ).toThrow(TypeError);
  });

  it('rejects null select (null is typeof object, not array, not "*")', () => {
    // The implementation uses `options.select ?? '*'`, so explicit null
    // should resolve to '*' (defaults to all). Document the behavior.
    const q = buildShortestPath('knows', 'u', 1, 'u', 2, { select: null });
    expect(q.text).toContain('SELECT * FROM');
  });

  it('rejects undefined select gracefully — defaults to "*"', () => {
    const q = buildShortestPath('knows', 'u', 1, 'u', 2, { select: undefined });
    expect(q.text).toContain('SELECT * FROM');
  });

  it('rejects non-string array element (number)', () => {
    expect(() =>
      buildShortestPath('knows', 'u', 1, 'u', 2, {
        select: [123] as unknown as readonly string[],
      }),
    ).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// Valid select rendering
// ---------------------------------------------------------------------------

describe('QA GDB-670 buildShortestPath valid SELECT rendering', () => {
  it('renders default "*" projection', () => {
    const q = buildShortestPath('knows', 'u', 1, 'u', 2);
    expect(q.text).toMatch(/^SELECT \* FROM SHORTEST PATH FROM "u"\(\$1\) TO "u"\(\$2\) VIA "knows"$/);
    expect(q.values).toEqual([1, 2]);
  });

  it('renders explicit "*" projection', () => {
    const q = buildShortestPath('knows', 'u', 1, 'u', 2, { select: '*' });
    expect(q.text).toMatch(/^SELECT \* FROM /);
  });

  it('renders array projection with double-quoted identifiers', () => {
    const q = buildShortestPath('knows', 'u', 1, 'u', 2, { select: ['col1', 'col2'] });
    expect(q.text).toContain('SELECT "col1", "col2" FROM');
  });

  it('renders path-relevant column names (path_length, path_cost, nodes, edges)', () => {
    const q = buildShortestPath('knows', 'u', 1, 'u', 2, {
      select: ['path_length', 'path_cost', 'nodes', 'edges'],
    });
    expect(q.text).toContain('SELECT "path_length", "path_cost", "nodes", "edges" FROM');
  });

  it('preserves direction and maxDepth in coreSql', () => {
    const q = buildShortestPath('knows', 'u', 1, 'u', 2, {
      select: ['path_length'],
      direction: 'BOTH',
      maxDepth: 5,
    });
    expect(q.text).toBe(
      'SELECT "path_length" FROM SHORTEST PATH FROM "u"($1) TO "u"($2) VIA "knows" DIRECTION BOTH MAX_DEPTH 5',
    );
  });
});

// ---------------------------------------------------------------------------
// legacySyntax: true branch — must not leak select into SQL
// ---------------------------------------------------------------------------

describe('QA GDB-670 legacySyntax branch isolation', () => {
  it('legacySyntax: true emits no SELECT clause and does not leak provided select', () => {
    const q = buildShortestPath('knows', 'u', 1, 'u', 2, {
      legacySyntax: true,
      select: ['col1', 'col2'],
    });
    expect(q.text).not.toMatch(/^SELECT/);
    expect(q.text).not.toContain('col1');
    expect(q.text).not.toContain('col2');
    expect(q.text).toMatch(/^SHORTEST PATH FROM /);
  });

  it('legacySyntax: true silently ignores malicious select string (no validation, no leak)', () => {
    // This is a deliberate trade-off in the fix: legacy branch never emits
    // SELECT, so it cannot be exploited via select. Verify the malicious
    // string never appears in the generated SQL.
    const malicious = '*; DROP TABLE users; --';
    const q = buildShortestPath('knows', 'u', 1, 'u', 2, {
      legacySyntax: true,
      select: malicious as unknown as never,
    } as ShortestPathOptions);
    expect(q.text).not.toContain('DROP');
    expect(q.text).not.toContain(';');
    expect(q.text).not.toContain('users');
    expect(q.text).toBe(
      'SHORTEST PATH FROM "u"($1) TO "u"($2) VIA "knows"',
    );
  });

  it('legacySyntax: true with malicious select array silently ignored', () => {
    const q = buildShortestPath('knows', 'u', 1, 'u', 2, {
      legacySyntax: true,
      select: ['id; DROP TABLE users; --'] as unknown as readonly string[],
    });
    expect(q.text).not.toContain('DROP');
    expect(q.text).not.toContain('id;');
  });

  it('legacySyntax: false still validates select (sanity)', () => {
    expect(() =>
      buildShortestPath('knows', 'u', 1, 'u', 2, {
        legacySyntax: false,
        select: '*; DROP TABLE x; --' as unknown as never,
      } as ShortestPathOptions),
    ).toThrow(TypeError);
  });

  it('legacySyntax truthy non-boolean ("true" string) IS treated as legacy', () => {
    // Documents current behavior: `if (options.legacySyntax)` truth-tests,
    // so any truthy value engages legacy mode. A malicious select is then
    // silently dropped (still safe), but type-system circumvention works.
    const q = buildShortestPath('knows', 'u', 1, 'u', 2, {
      legacySyntax: 'true' as unknown as boolean,
      select: ['col1'],
    });
    expect(q.text).not.toMatch(/^SELECT/);
    expect(q.text).toBe('SHORTEST PATH FROM "u"($1) TO "u"($2) VIA "knows"');
  });

  it('legacySyntax: 1 (truthy number) treated as legacy', () => {
    const q = buildShortestPath('knows', 'u', 1, 'u', 2, {
      legacySyntax: 1 as unknown as boolean,
    });
    expect(q.text).not.toMatch(/^SELECT/);
  });

  it('legacySyntax: {} (truthy object) treated as legacy', () => {
    const q = buildShortestPath('knows', 'u', 1, 'u', 2, {
      legacySyntax: {} as unknown as boolean,
    });
    expect(q.text).not.toMatch(/^SELECT/);
  });

  it('legacySyntax: 0 (falsy number) requires valid select', () => {
    expect(() =>
      buildShortestPath('knows', 'u', 1, 'u', 2, {
        legacySyntax: 0 as unknown as boolean,
        select: '*; DROP TABLE x' as unknown as never,
      } as ShortestPathOptions),
    ).toThrow(TypeError);
  });

  it('legacySyntax: "" (empty string, falsy) requires valid select', () => {
    expect(() =>
      buildShortestPath('knows', 'u', 1, 'u', 2, {
        legacySyntax: '' as unknown as boolean,
        select: 'COUNT(*)' as unknown as never,
      } as ShortestPathOptions),
    ).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// Type-system circumvention attempts
// ---------------------------------------------------------------------------

describe('QA GDB-670 type-system bypass attempts', () => {
  it('`as any` cast on options does not bypass runtime validation', () => {
    const opts = { select: 'raw; DROP TABLE x' } as any;
    expect(() => buildShortestPath('knows', 'u', 1, 'u', 2, opts)).toThrow(
      TypeError,
    );
  });

  it('Object.assign last-write-wins still validated at runtime', () => {
    const opts = Object.assign(
      { select: '*' },
      { select: 'evil; DROP' },
    ) as ShortestPathOptions;
    expect(() => buildShortestPath('knows', 'u', 1, 'u', 2, opts)).toThrow(
      TypeError,
    );
  });

  it('JSON.parse-derived adversarial select rejected at runtime', () => {
    const userInput = '{"select":"id; DROP TABLE users; --"}';
    const parsed = JSON.parse(userInput) as ShortestPathOptions;
    expect(() => buildShortestPath('knows', 'u', 1, 'u', 2, parsed)).toThrow(
      TypeError,
    );
  });

  it('JSON.parse-derived adversarial array element rejected', () => {
    const userInput = '{"select":["id; DROP TABLE users; --"]}';
    const parsed = JSON.parse(userInput) as ShortestPathOptions;
    expect(() => buildShortestPath('knows', 'u', 1, 'u', 2, parsed)).toThrow(
      TypeError,
    );
  });

  it('frozen options object validated normally', () => {
    const opts = Object.freeze({
      select: Object.freeze(['col_a', 'col_b']),
    }) as ShortestPathOptions;
    const q = buildShortestPath('knows', 'u', 1, 'u', 2, opts);
    expect(q.text).toContain('SELECT "col_a", "col_b" FROM');
  });
});

// ---------------------------------------------------------------------------
// Pool / Client wiring — verify no pre-processing happens
// ---------------------------------------------------------------------------

describe('QA GDB-670 pool/client forwarding', () => {
  it('Client.shortestPath forwards options.select unchanged into buildShortestPath', async () => {
    // Mock the connection layer; capture the SQL generated.
    const { Client } = await import('../src/client');
    const captured: { text: string; values: unknown[] }[] = [];
    const mockConn = {
      query: async (text: string, values: unknown[]) => {
        captured.push({ text, values });
        return { rows: [], fields: [], rowCount: 0, command: 'SELECT' };
      },
      close: async () => {},
    };
    // @ts-expect-error — wedge the mock connection into the private field
    const c = new Client({});
    // @ts-expect-error — overwrite private field for the test
    c.connection = mockConn;

    await c.shortestPath('knows', 'u', 1, 'u', 2, { select: ['col1'] });
    expect(captured[0].text).toContain('SELECT "col1" FROM SHORTEST PATH');

    await expect(
      c.shortestPath('knows', 'u', 1, 'u', 2, {
        select: '*; DROP TABLE users; --' as unknown as never,
      } as ShortestPathOptions),
    ).rejects.toThrow(TypeError);
  });

  it('Pool.shortestPath rejects malicious select (forwards to buildShortestPath)', async () => {
    // The shortestPath helper at pool.ts:283 lives on the `Pool` class itself.
    // Mock the underlying acquire/query path: we patch the Pool prototype's
    // `query` method to capture the SQL passed through.
    const { Pool } = await import('../src/pool');
    const captured: { text: string; values: unknown[] }[] = [];
    const pool = new Pool({});
    // @ts-expect-error — overwrite for test
    pool.query = async (text: string, values: unknown[]) => {
      captured.push({ text, values });
      return { rows: [], fields: [], rowCount: 0, command: 'SELECT' };
    };

    await pool.shortestPath('knows', 'u', 1, 'u', 2, {
      select: ['path_cost'],
    });
    expect(captured[0].text).toContain('SELECT "path_cost" FROM SHORTEST PATH');

    await expect(
      pool.shortestPath('knows', 'u', 1, 'u', 2, {
        select: 'COUNT(*)' as unknown as never,
      } as ShortestPathOptions),
    ).rejects.toThrow(TypeError);

    await pool.end().catch(() => {});
  });
});

// ---------------------------------------------------------------------------
// Side-channel: other ShortestPathOptions fields
// ---------------------------------------------------------------------------

describe('QA GDB-670 side-channel: non-select options', () => {
  it('maxDepth is type-validated (no raw interpolation of strings)', () => {
    expect(() =>
      buildShortestPath('knows', 'u', 1, 'u', 2, {
        maxDepth: '5; DROP TABLE x' as unknown as number,
      }),
    ).toThrow(TypeError);
  });

  it('maxDepth NaN rejected', () => {
    expect(() =>
      buildShortestPath('knows', 'u', 1, 'u', 2, { maxDepth: NaN }),
    ).toThrow(TypeError);
  });

  it('maxDepth 0 rejected (must be positive)', () => {
    expect(() =>
      buildShortestPath('knows', 'u', 1, 'u', 2, { maxDepth: 0 }),
    ).toThrow(TypeError);
  });

  it('maxDepth negative rejected', () => {
    expect(() =>
      buildShortestPath('knows', 'u', 1, 'u', 2, { maxDepth: -1 }),
    ).toThrow(TypeError);
  });

  it('maxDepth float rejected (must be integer)', () => {
    expect(() =>
      buildShortestPath('knows', 'u', 1, 'u', 2, { maxDepth: 1.5 }),
    ).toThrow(TypeError);
  });

  it('FINDING: direction is NOT validated and is raw-interpolated', () => {
    // This is a SEPARATE injection vector beyond the GDB-670 fix scope.
    // buildShortestPath does `coreSql += " DIRECTION " + options.direction`
    // with no allowlist. A malicious caller can inject SQL via the
    // `direction` field. Documenting as a finding.
    const q = buildShortestPath('knows', 'u', 1, 'u', 2, {
      direction: "OUT; DROP TABLE users; --" as unknown as 'OUT',
    });
    // The malicious payload appears verbatim in the SQL text.
    expect(q.text).toContain('DIRECTION OUT; DROP TABLE users; --');
  });

  it('edgeType is identifier-escaped (double-quoted)', () => {
    // Verify edgeType is safe (escapeIdentifier path, not raw).
    const q = buildShortestPath('knows"; DROP TABLE x; --', 'u', 1, 'u', 2);
    // Internal `"` doubled, payload contained inside the quoted identifier.
    expect(q.text).toContain('VIA "knows""; DROP TABLE x; --"');
    expect(q.text).not.toMatch(/VIA "knows"; DROP/);
  });

  it('fromTable is identifier-escaped', () => {
    const q = buildShortestPath('knows', 'u"; DROP TABLE x; --', 1, 'u', 2);
    expect(q.text).toContain('FROM "u""; DROP TABLE x; --"($1)');
  });

  it('toTable is identifier-escaped', () => {
    const q = buildShortestPath('knows', 'u', 1, 'u"; DROP', 2);
    expect(q.text).toContain('TO "u""; DROP"($2)');
  });

  it('fromId/toId are bound as parameters (not raw)', () => {
    const q = buildShortestPath('knows', 'u', "1'; DROP TABLE x; --", 'u', 2);
    expect(q.text).toContain('"u"($1)');
    expect(q.values[0]).toBe("1'; DROP TABLE x; --");
  });
});

// ---------------------------------------------------------------------------
// Identifier shape edge cases
// ---------------------------------------------------------------------------

describe('QA GDB-670 select identifier edge cases', () => {
  it('rejects unicode letter (allowlist is ASCII-only)', () => {
    expect(() =>
      buildShortestPath('knows', 'u', 1, 'u', 2, {
        select: ['café'] as unknown as readonly string[],
      }),
    ).toThrow(TypeError);
  });

  it('rejects identifier with trailing newline (full-string anchored)', () => {
    expect(() =>
      buildShortestPath('knows', 'u', 1, 'u', 2, {
        select: ['col\n; DROP TABLE x'] as unknown as readonly string[],
      }),
    ).toThrow(TypeError);
  });

  it('rejects whitespace-only identifier', () => {
    expect(() =>
      buildShortestPath('knows', 'u', 1, 'u', 2, {
        select: ['   '] as unknown as readonly string[],
      }),
    ).toThrow(TypeError);
  });

  it('rejects identifier exceeding 64-char cap', () => {
    const long = 'a' + 'b'.repeat(64); // 65 chars, all ASCII
    expect(() =>
      buildShortestPath('knows', 'u', 1, 'u', 2, {
        select: [long] as unknown as readonly string[],
      }),
    ).toThrow(RangeError);
  });

  it('accepts identifier exactly 64 chars (boundary)', () => {
    const ident = 'a' + 'b'.repeat(63); // 64 chars
    const q = buildShortestPath('knows', 'u', 1, 'u', 2, {
      select: [ident] as unknown as readonly string[],
    });
    expect(q.text).toContain(`SELECT "${ident}" FROM`);
  });

  it('rejects array exceeding 1000 entries', () => {
    const big = Array.from({ length: 1001 }, (_, i) => `c${i}`);
    expect(() =>
      buildShortestPath('knows', 'u', 1, 'u', 2, {
        select: big as unknown as readonly string[],
      }),
    ).toThrow(RangeError);
  });

  it('accepts array of exactly 1000 entries (boundary)', () => {
    const big = Array.from({ length: 1000 }, (_, i) => `c${i}`);
    const q = buildShortestPath('knows', 'u', 1, 'u', 2, {
      select: big as unknown as readonly string[],
    });
    expect(q.text).toContain('"c0"');
    expect(q.text).toContain('"c999"');
  });
});
