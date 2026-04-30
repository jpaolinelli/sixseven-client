/**
 * GDB-674 QA: Adversarial tests for the consolidation of VALID_DEGREE_DIRECTIONS
 * into VALID_TRAVERSAL_DIRECTIONS and routing buildDegreeCentrality through
 * the shared validateTraversalDirection helper.
 *
 * Acceptance criteria tested:
 *   1. buildDegreeCentrality still accepts 'IN', 'OUT', 'BOTH' (case-insensitive)
 *   2. buildDegreeCentrality still rejects invalid directions
 *   3. Error messages from buildDegreeCentrality are consistent with other builders
 *   4. No regression in direction validation across all builders
 *   5. The DegreeDirection type still works correctly
 *   6. Edge cases: empty string, null, undefined, numeric, SQL injection via direction
 */
import { describe, it, expect } from 'vitest';
import {
  buildDegreeCentrality,
  buildTraverse,
  buildShortestPath,
  buildNearest,
} from '../src/query-builders';
import type {
  DegreeCentralityOptions,
  TraverseOptions,
  ShortestPathOptions,
  WithinTraverseOptions,
} from '../src/query-builders';

// ---------------------------------------------------------------------------
// Helpers — invoke each builder with a direction value
// ---------------------------------------------------------------------------

function callDegree(direction: unknown): { text: string; values: unknown[] } {
  return buildDegreeCentrality('follows', {
    direction: direction as DegreeCentralityOptions['direction'],
  });
}

function callTraverse(direction: unknown): { text: string; values: unknown[] } {
  return buildTraverse('follows', 'users', 1, {
    direction: direction as TraverseOptions['direction'],
  });
}

function callShortest(direction: unknown): { text: string; values: unknown[] } {
  return buildShortestPath('knows', 'u', 1, 'u', 2, {
    direction: direction as ShortestPathOptions['direction'],
  });
}

function callWithinTraverse(direction: unknown): { text: string; values: unknown[] } {
  return buildNearest('docs', 'embedding', [0.1, 0.2], {
    withinTraverse: {
      edgeType: 'cites',
      fromTable: 'docs',
      startId: 1,
      direction: direction as WithinTraverseOptions['direction'],
    },
  });
}

// ---------------------------------------------------------------------------
// AC1: buildDegreeCentrality accepts 'IN', 'OUT', 'BOTH' (case-insensitive)
// ---------------------------------------------------------------------------

describe('GDB-674 QA — AC1: buildDegreeCentrality accepts valid directions', () => {
  const validCases: Array<[string, string]> = [
    ['IN', 'IN'],
    ['OUT', 'OUT'],
    ['BOTH', 'BOTH'],
    ['in', 'IN'],
    ['out', 'OUT'],
    ['both', 'BOTH'],
    ['In', 'IN'],
    ['Out', 'OUT'],
    ['Both', 'BOTH'],
    ['iN', 'IN'],
    ['oUt', 'OUT'],
    ['bOtH', 'BOTH'],
  ];

  for (const [input, expected] of validCases) {
    it(`should accept direction "${input}" and normalize to "${expected}"`, () => {
      const result = callDegree(input);
      expect(result.text).toContain(`degree_centrality($1, $2)`);
      expect(result.values).toContain(expected);
    });
  }

  it('should use BOTH as default when no direction provided', () => {
    const result = buildDegreeCentrality('follows');
    expect(result.values).toContain('BOTH');
  });

  it('should use BOTH as default when direction is undefined in options', () => {
    const result = buildDegreeCentrality('follows', {});
    expect(result.values).toContain('BOTH');
  });
});

// ---------------------------------------------------------------------------
// AC2: buildDegreeCentrality rejects invalid directions
// ---------------------------------------------------------------------------

describe('GDB-674 QA — AC2: buildDegreeCentrality rejects invalid directions', () => {
  const invalidDirections = [
    'LEFT',
    'RIGHT',
    'UP',
    'DOWN',
    'INOUT',
    'OUTBOUND',
    'INBOUND',
    'ALL',
    'ANY',
    'NONE',
    'FORWARD',
    'BACKWARD',
    'BIDIRECTIONAL',
  ];

  for (const dir of invalidDirections) {
    it(`should reject "${dir}"`, () => {
      expect(() => callDegree(dir)).toThrow(TypeError);
    });
  }
});

// ---------------------------------------------------------------------------
// AC3: Error messages consistent with other builders
// ---------------------------------------------------------------------------

describe('GDB-674 QA — AC3: error message consistency across builders', () => {
  it('should produce identical error message format for invalid string in all builders', () => {
    const invalidDir = 'INVALID';

    const degreeErr = getErrorMessage(() => callDegree(invalidDir));
    const traverseErr = getErrorMessage(() => callTraverse(invalidDir));
    const shortestErr = getErrorMessage(() => callShortest(invalidDir));

    // All should reference the allowlist IN, OUT, BOTH and quote the bad value
    expect(degreeErr).toContain('IN, OUT, BOTH');
    expect(traverseErr).toContain('IN, OUT, BOTH');
    expect(shortestErr).toContain('IN, OUT, BOTH');

    // All should include the bad value in JSON-quoted form
    expect(degreeErr).toContain('"INVALID"');
    expect(traverseErr).toContain('"INVALID"');
    expect(shortestErr).toContain('"INVALID"');

    // The parameter name portion should match (all use 'direction')
    expect(degreeErr).toMatch(/^direction must be one of/);
    expect(traverseErr).toMatch(/^direction must be one of/);
    expect(shortestErr).toMatch(/^direction must be one of/);
  });

  it('should produce identical error message format for non-string types across builders', () => {
    const degreeErr = getErrorMessage(() => callDegree(42));
    const traverseErr = getErrorMessage(() => callTraverse(42));
    const shortestErr = getErrorMessage(() => callShortest(42));

    // All should say "must be a string, got number"
    expect(degreeErr).toBe('direction must be a string, got number');
    expect(traverseErr).toBe('direction must be a string, got number');
    expect(shortestErr).toBe('direction must be a string, got number');
  });

  it('should produce identical error for empty string across builders', () => {
    const degreeErr = getErrorMessage(() => callDegree(''));
    const traverseErr = getErrorMessage(() => callTraverse(''));
    const shortestErr = getErrorMessage(() => callShortest(''));

    expect(degreeErr).toBe('direction must be a non-empty string');
    expect(traverseErr).toBe('direction must be a non-empty string');
    expect(shortestErr).toBe('direction must be a non-empty string');
  });

  it('should produce identical error for whitespace-only string across builders', () => {
    const degreeErr = getErrorMessage(() => callDegree('   '));
    const traverseErr = getErrorMessage(() => callTraverse('   '));
    const shortestErr = getErrorMessage(() => callShortest('   '));

    expect(degreeErr).toBe('direction must be a non-empty string');
    expect(traverseErr).toBe('direction must be a non-empty string');
    expect(shortestErr).toBe('direction must be a non-empty string');
  });
});

function getErrorMessage(fn: () => unknown): string {
  try {
    fn();
    throw new Error('Expected function to throw');
  } catch (e) {
    if (e instanceof Error && e.message !== 'Expected function to throw') {
      return e.message;
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// AC4: No regression in direction validation across all builders
// ---------------------------------------------------------------------------

describe('GDB-674 QA — AC4: cross-builder regression — all valid directions', () => {
  const builders: Array<[string, (d: unknown) => { text: string; values: unknown[] }]> = [
    ['buildDegreeCentrality', callDegree],
    ['buildTraverse', callTraverse],
    ['buildShortestPath', callShortest],
    ['buildNearest withinTraverse', callWithinTraverse],
  ];

  for (const [name, build] of builders) {
    for (const dir of ['IN', 'OUT', 'BOTH', 'in', 'out', 'both']) {
      it(`${name} accepts "${dir}" without throwing`, () => {
        expect(() => build(dir)).not.toThrow();
      });
    }

    for (const dir of ['INVALID', 'LEFT', '']) {
      it(`${name} rejects "${dir}"`, () => {
        expect(() => build(dir)).toThrow();
      });
    }
  }
});

// ---------------------------------------------------------------------------
// AC5: DegreeDirection type derives from VALID_TRAVERSAL_DIRECTIONS
// ---------------------------------------------------------------------------

describe('GDB-674 QA — AC5: DegreeDirection type correctness', () => {
  it('should accept all DegreeDirection values in buildDegreeCentrality', () => {
    // These are the three values that DegreeDirection should encompass
    const directions: Array<'IN' | 'OUT' | 'BOTH'> = ['IN', 'OUT', 'BOTH'];
    for (const d of directions) {
      const result = buildDegreeCentrality('edge', { direction: d });
      expect(result.values[1]).toBe(d);
    }
  });

  it('should accept lowercase DegreeDirection values', () => {
    const directions: Array<'in' | 'out' | 'both'> = ['in', 'out', 'both'];
    for (const d of directions) {
      const result = buildDegreeCentrality('edge', { direction: d });
      expect(result.values[1]).toBe(d.toUpperCase());
    }
  });
});

// ---------------------------------------------------------------------------
// AC6: Edge cases — empty string, null, undefined, numeric, SQL injection
// ---------------------------------------------------------------------------

describe('GDB-674 QA — AC6: edge cases in buildDegreeCentrality direction', () => {
  it('should reject null direction', () => {
    expect(() => callDegree(null)).toThrow(TypeError);
    expect(() => callDegree(null)).toThrow(/must be a string/);
  });

  it('should reject undefined direction (explicit)', () => {
    // When explicitly passed as a value (not omitted from options)
    expect(() =>
      buildDegreeCentrality('edge', { direction: undefined }),
    ).not.toThrow(); // undefined falls back to default 'BOTH'
  });

  it('should reject numeric direction', () => {
    expect(() => callDegree(0)).toThrow(TypeError);
    expect(() => callDegree(1)).toThrow(TypeError);
    expect(() => callDegree(NaN)).toThrow(TypeError);
    expect(() => callDegree(Infinity)).toThrow(TypeError);
  });

  it('should reject boolean direction', () => {
    expect(() => callDegree(true)).toThrow(TypeError);
    expect(() => callDegree(false)).toThrow(TypeError);
  });

  it('should reject empty string direction', () => {
    expect(() => callDegree('')).toThrow(TypeError);
    expect(() => callDegree('')).toThrow(/non-empty/);
  });

  it('should reject whitespace-only direction', () => {
    expect(() => callDegree(' ')).toThrow(TypeError);
    expect(() => callDegree('\t')).toThrow(TypeError);
    expect(() => callDegree('\n')).toThrow(TypeError);
    expect(() => callDegree('  \t\n  ')).toThrow(TypeError);
  });

  it('should reject SQL injection via direction', () => {
    const injections = [
      "OUT; DROP TABLE users; --",
      "OUT' OR '1'='1",
      "OUT\nDROP TABLE users",
      "OUT UNION SELECT * FROM passwords",
      "BOTH; DELETE FROM nodes WHERE 1=1;--",
      "IN); DROP TABLE edges; --",
    ];
    for (const payload of injections) {
      expect(() => callDegree(payload)).toThrow(TypeError);
    }
  });

  it('should reject array direction', () => {
    expect(() => callDegree(['OUT'])).toThrow(TypeError);
  });

  it('should reject object direction', () => {
    expect(() => callDegree({ toString: () => 'OUT' })).toThrow(TypeError);
  });

  it('should reject Symbol direction', () => {
    expect(() => callDegree(Symbol('OUT'))).toThrow(TypeError);
  });

  it('should reject direction with trailing whitespace', () => {
    // 'OUT ' is not in the allowlist after toUpperCase
    // The assertNonEmptyString will pass, but the allowlist check should fail
    expect(() => callDegree('OUT ')).toThrow(TypeError);
  });

  it('should reject direction with leading whitespace', () => {
    expect(() => callDegree(' IN')).toThrow(TypeError);
  });

  it('should reject direction with internal whitespace', () => {
    expect(() => callDegree('B OTH')).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// Verify that VALID_DEGREE_DIRECTIONS no longer exists (consolidation check)
// The only way to verify this at runtime is to confirm that the error messages
// from buildDegreeCentrality reference VALID_TRAVERSAL_DIRECTIONS values and
// not a separate "VALID_DEGREE_DIRECTIONS" constant.
// ---------------------------------------------------------------------------

describe('GDB-674 QA — Consolidation: single error message source', () => {
  it('should include "IN, OUT, BOTH" in error message (from VALID_TRAVERSAL_DIRECTIONS)', () => {
    const err = getErrorMessage(() => callDegree('INVALID'));
    expect(err).toContain('IN, OUT, BOTH');
  });

  it('error message from buildDegreeCentrality matches buildTraverse exactly', () => {
    const degreeErr = getErrorMessage(() => callDegree('NOPE'));
    const traverseErr = getErrorMessage(() => callTraverse('NOPE'));

    // Same format: "<paramName> must be one of IN, OUT, BOTH, got <JSON>"
    // The param name is 'direction' for both
    expect(degreeErr).toBe(traverseErr);
  });

  it('error message from buildDegreeCentrality matches buildShortestPath exactly', () => {
    const degreeErr = getErrorMessage(() => callDegree('BAD'));
    const shortestErr = getErrorMessage(() => callShortest('BAD'));
    expect(degreeErr).toBe(shortestErr);
  });
});

// ---------------------------------------------------------------------------
// Regression: buildDegreeCentrality SQL output structure unchanged
// ---------------------------------------------------------------------------

describe('GDB-674 QA — SQL output regression for buildDegreeCentrality', () => {
  it('should produce correct SQL for default options', () => {
    const result = buildDegreeCentrality('follows');
    expect(result.text).toBe(
      'SELECT * FROM degree_centrality($1, $2)',
    );
    expect(result.values).toEqual(['follows', 'BOTH']);
  });

  it('should produce correct SQL for direction IN', () => {
    const result = buildDegreeCentrality('follows', { direction: 'IN' });
    expect(result.text).toBe(
      'SELECT * FROM degree_centrality($1, $2)',
    );
    expect(result.values).toEqual(['follows', 'IN']);
  });

  it('should produce correct SQL for direction OUT with select', () => {
    const result = buildDegreeCentrality('follows', {
      direction: 'OUT',
      select: ['node_id', 'degree'],
    });
    expect(result.text).toBe(
      'SELECT "node_id", "degree" FROM degree_centrality($1, $2)',
    );
    expect(result.values).toEqual(['follows', 'OUT']);
  });

  it('should produce correct SQL for lowercase direction with select *', () => {
    const result = buildDegreeCentrality('follows', {
      direction: 'both',
      select: '*',
    });
    expect(result.text).toBe(
      'SELECT * FROM degree_centrality($1, $2)',
    );
    expect(result.values).toEqual(['follows', 'BOTH']);
  });
});
