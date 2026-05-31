/**
 * GDB-671: Tests for traversal-direction allowlist validation across every
 * builder that emits a `DIRECTION <token>` SQL clause.
 *
 * Covered builders:
 *   - buildShortestPath  (options.direction)
 *   - buildTraverse      (options.direction)
 *   - buildNearest       (withinTraverse.direction in WITHIN TRAVERSE)
 *
 * Each suite verifies:
 *   1. Positive — every allowed value (IN, OUT, BOTH) and lowercase variants
 *      produce the expected uppercase SQL.
 *   2. Negative — adversarial payloads (semicolon injection, unknown token,
 *      empty/whitespace, non-string, undefined-with-no-default behavior) are
 *      rejected with TypeError.
 *
 * The TypeScript signature is unchanged; this is runtime defense against
 * `as any` casts that smuggle untrusted input past compile-time narrowing.
 */
import { describe, it, expect } from 'vitest';
import {
  buildShortestPath,
  buildTraverse,
  buildNearest,
} from '../src/query-builders';
import type { ShortestPathOptions, TraverseOptions } from '../src/types';

// ---------------------------------------------------------------------------
// buildShortestPath
// ---------------------------------------------------------------------------

describe('GDB-671 buildShortestPath direction allowlist', () => {
  it('emits DIRECTION OUT for "OUT"', () => {
    const q = buildShortestPath('knows', 'u', 1, 'u', 2, { direction: 'OUT' });
    expect(q.text).toContain('DIRECTION OUT');
  });

  it('emits DIRECTION IN for "IN"', () => {
    const q = buildShortestPath('knows', 'u', 1, 'u', 2, { direction: 'IN' });
    expect(q.text).toContain('DIRECTION IN');
  });

  it('emits DIRECTION BOTH for "BOTH"', () => {
    const q = buildShortestPath('knows', 'u', 1, 'u', 2, { direction: 'BOTH' });
    expect(q.text).toContain('DIRECTION BOTH');
  });

  it('normalizes lowercase "out" to OUT', () => {
    const q = buildShortestPath('knows', 'u', 1, 'u', 2, {
      direction: 'out' as unknown as 'OUT',
    });
    expect(q.text).toContain('DIRECTION OUT');
    expect(q.text).not.toContain('DIRECTION out');
  });

  it('normalizes mixed-case "BoTh" to BOTH', () => {
    const q = buildShortestPath('knows', 'u', 1, 'u', 2, {
      direction: 'BoTh' as unknown as 'BOTH',
    });
    expect(q.text).toContain('DIRECTION BOTH');
  });

  it('omits DIRECTION clause when direction is undefined', () => {
    const q = buildShortestPath('knows', 'u', 1, 'u', 2);
    expect(q.text).not.toContain('DIRECTION');
  });

  it('omits DIRECTION clause when options omits the field', () => {
    const q = buildShortestPath('knows', 'u', 1, 'u', 2, { maxDepth: 3 });
    expect(q.text).not.toContain('DIRECTION');
    expect(q.text).toContain('MAX_DEPTH 3');
  });

  it('rejects classic injection "OUT; DROP TABLE users; --"', () => {
    expect(() =>
      buildShortestPath('knows', 'u', 1, 'u', 2, {
        direction: 'OUT; DROP TABLE users; --' as unknown as 'OUT',
      }),
    ).toThrow(TypeError);
  });

  it('rejects unknown token "INVALID"', () => {
    expect(() =>
      buildShortestPath('knows', 'u', 1, 'u', 2, {
        direction: 'INVALID' as unknown as 'OUT',
      }),
    ).toThrow(/direction must be one of IN, OUT, BOTH/);
  });

  it('rejects unknown token "sideways"', () => {
    expect(() =>
      buildShortestPath('knows', 'u', 1, 'u', 2, {
        direction: 'sideways' as unknown as 'OUT',
      }),
    ).toThrow(TypeError);
  });

  it('rejects empty string', () => {
    expect(() =>
      buildShortestPath('knows', 'u', 1, 'u', 2, {
        direction: '' as unknown as 'OUT',
      }),
    ).toThrow(TypeError);
  });

  it('rejects whitespace-only string', () => {
    expect(() =>
      buildShortestPath('knows', 'u', 1, 'u', 2, {
        direction: '   ' as unknown as 'OUT',
      }),
    ).toThrow(TypeError);
  });

  it('rejects null (non-string)', () => {
    expect(() =>
      buildShortestPath('knows', 'u', 1, 'u', 2, {
        direction: null as unknown as 'OUT',
      } as ShortestPathOptions),
    ).toThrow(TypeError);
  });

  it('rejects number (non-string)', () => {
    expect(() =>
      buildShortestPath('knows', 'u', 1, 'u', 2, {
        direction: 1 as unknown as 'OUT',
      } as ShortestPathOptions),
    ).toThrow(/direction must be a string/);
  });

  it('rejects array (non-string)', () => {
    expect(() =>
      buildShortestPath('knows', 'u', 1, 'u', 2, {
        direction: ['OUT'] as unknown as 'OUT',
      } as ShortestPathOptions),
    ).toThrow(TypeError);
  });

  it('rejects object (non-string)', () => {
    expect(() =>
      buildShortestPath('knows', 'u', 1, 'u', 2, {
        direction: { toString: () => 'OUT' } as unknown as 'OUT',
      } as ShortestPathOptions),
    ).toThrow(TypeError);
  });

  it('rejects newline-suffixed token "OUT\\n--"', () => {
    expect(() =>
      buildShortestPath('knows', 'u', 1, 'u', 2, {
        direction: 'OUT\n--' as unknown as 'OUT',
      }),
    ).toThrow(TypeError);
  });

  it('legacy syntax path still validates direction', () => {
    expect(() =>
      buildShortestPath('knows', 'u', 1, 'u', 2, {
        direction: 'OUT; DROP TABLE x; --' as unknown as 'OUT',
        legacySyntax: true,
      }),
    ).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// buildTraverse
// ---------------------------------------------------------------------------

describe('GDB-671 buildTraverse direction allowlist', () => {
  it('emits DIRECTION OUT by default', () => {
    const q = buildTraverse('follows', 'users', 1);
    expect(q.text).toContain('DIRECTION OUT');
  });

  it('emits DIRECTION IN for "IN"', () => {
    const q = buildTraverse('follows', 'users', 1, { direction: 'IN' });
    expect(q.text).toContain('DIRECTION IN');
  });

  it('emits DIRECTION BOTH for "BOTH"', () => {
    const q = buildTraverse('follows', 'users', 1, { direction: 'BOTH' });
    expect(q.text).toContain('DIRECTION BOTH');
  });

  it('normalizes lowercase "in" to IN', () => {
    const q = buildTraverse('follows', 'users', 1, {
      direction: 'in' as unknown as 'IN',
    });
    expect(q.text).toContain('DIRECTION IN');
    expect(q.text).not.toContain('DIRECTION in');
  });

  it('rejects classic injection "OUT; DROP TABLE users; --"', () => {
    expect(() =>
      buildTraverse('follows', 'users', 1, {
        direction: 'OUT; DROP TABLE users; --' as unknown as 'OUT',
      }),
    ).toThrow(TypeError);
  });

  it('rejects unknown token "INVALID"', () => {
    expect(() =>
      buildTraverse('follows', 'users', 1, {
        direction: 'INVALID' as unknown as 'OUT',
      }),
    ).toThrow(/direction must be one of IN, OUT, BOTH/);
  });

  it('rejects empty string', () => {
    expect(() =>
      buildTraverse('follows', 'users', 1, {
        direction: '' as unknown as 'OUT',
      }),
    ).toThrow(TypeError);
  });

  it('rejects null', () => {
    expect(() =>
      buildTraverse('follows', 'users', 1, {
        direction: null as unknown as 'OUT',
      } as TraverseOptions),
    ).toThrow(TypeError);
  });

  it('rejects number', () => {
    expect(() =>
      buildTraverse('follows', 'users', 1, {
        direction: 42 as unknown as 'OUT',
      } as TraverseOptions),
    ).toThrow(/direction must be a string/);
  });

  it('explicit undefined falls back to default OUT', () => {
    // The TS destructuring `direction = 'OUT'` treats explicit undefined the
    // same as omission, so the validator sees 'OUT' (default) and passes.
    const q = buildTraverse('follows', 'users', 1, {
      direction: undefined,
    });
    expect(q.text).toContain('DIRECTION OUT');
  });
});

// ---------------------------------------------------------------------------
// buildNearest WITHIN TRAVERSE direction
// ---------------------------------------------------------------------------

describe('GDB-671 buildNearest withinTraverse.direction allowlist', () => {
  it('emits DIRECTION OUT inside WITHIN TRAVERSE', () => {
    const q = buildNearest('docs', 'embedding', [0.1, 0.2], {
      withinTraverse: {
        edgeType: 'cites',
        fromTable: 'docs',
        startId: 1,
        direction: 'OUT',
      },
    });
    expect(q.text).toContain('WITHIN TRAVERSE');
    expect(q.text).toContain('DIRECTION OUT');
  });

  it('normalizes lowercase "both" to BOTH', () => {
    const q = buildNearest('docs', 'embedding', [0.1, 0.2], {
      withinTraverse: {
        edgeType: 'cites',
        fromTable: 'docs',
        startId: 1,
        direction: 'both' as unknown as 'BOTH',
      },
    });
    expect(q.text).toContain('DIRECTION BOTH');
  });

  it('omits DIRECTION when withinTraverse.direction is undefined', () => {
    const q = buildNearest('docs', 'embedding', [0.1, 0.2], {
      withinTraverse: {
        edgeType: 'cites',
        fromTable: 'docs',
        startId: 1,
      },
    });
    expect(q.text).toContain('WITHIN TRAVERSE');
    expect(q.text).not.toContain('DIRECTION');
  });

  it('rejects classic injection in withinTraverse.direction', () => {
    expect(() =>
      buildNearest('docs', 'embedding', [0.1, 0.2], {
        withinTraverse: {
          edgeType: 'cites',
          fromTable: 'docs',
          startId: 1,
          direction: 'OUT; DROP TABLE docs; --' as unknown as 'OUT',
        },
      }),
    ).toThrow(/withinTraverse\.direction must be one of/);
  });

  it('rejects unknown token in withinTraverse.direction', () => {
    expect(() =>
      buildNearest('docs', 'embedding', [0.1, 0.2], {
        withinTraverse: {
          edgeType: 'cites',
          fromTable: 'docs',
          startId: 1,
          direction: 'sideways' as unknown as 'OUT',
        },
      }),
    ).toThrow(TypeError);
  });

  it('rejects non-string in withinTraverse.direction', () => {
    expect(() =>
      buildNearest('docs', 'embedding', [0.1, 0.2], {
        withinTraverse: {
          edgeType: 'cites',
          fromTable: 'docs',
          startId: 1,
          direction: 7 as unknown as 'OUT',
        },
      }),
    ).toThrow(TypeError);
  });
});
