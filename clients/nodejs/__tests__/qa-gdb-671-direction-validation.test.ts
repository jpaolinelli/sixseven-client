/**
 * GDB-671 QA: Adversarial coverage for the traversal-direction allowlist
 * applied across `buildShortestPath`, `buildTraverse`, and `buildNearest`'s
 * `WITHIN TRAVERSE` clause. The implementer's `direction-validation.test.ts`
 * covers the happy path and obvious negatives — this file probes the harder
 * edges flagged by the reviewer:
 *
 *   - Unicode lookalikes / fullwidth / combining accents
 *   - Whitespace variants (leading, trailing, internal, newline)
 *   - Type-confusion (Symbol, object-with-toString, boolean, 0)
 *   - Cross-builder behavioral parity
 *   - Legacy-syntax interaction (`buildShortestPath({legacySyntax: true})`)
 *   - Round-trip case: emitted SQL always has the uppercase token
 *   - No regression in `buildDegreeCentrality` (its own inline allowlist)
 */
import { describe, it, expect } from 'vitest';
import {
  buildShortestPath,
  buildTraverse,
  buildNearest,
  buildDegreeCentrality,
  buildMatch,
  buildShortestMatch,
} from '../src/query-builders';
import type {
  ShortestPathOptions,
  TraverseOptions,
  WithinTraverseOptions,
} from '../src/types';

// ---------------------------------------------------------------------------
// Helpers — invoke each of the three patched builders with a single direction
// value and a stable surrounding shape, so cross-builder parity is testable.
// ---------------------------------------------------------------------------

function callShortest(direction: unknown): { text: string; values: unknown[] } {
  return buildShortestPath('knows', 'u', 1, 'u', 2, {
    direction: direction as ShortestPathOptions['direction'],
  });
}

function callTraverse(direction: unknown): { text: string; values: unknown[] } {
  return buildTraverse('follows', 'users', 1, {
    direction: direction as TraverseOptions['direction'],
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

const builderTriples: ReadonlyArray<
  readonly [string, (d: unknown) => { text: string }, RegExp]
> = [
  ['buildShortestPath', callShortest, /^direction /],
  ['buildTraverse', callTraverse, /^direction /],
  ['buildNearest withinTraverse', callWithinTraverse, /^withinTraverse\.direction /],
];

// ---------------------------------------------------------------------------
// Unicode lookalikes — must NOT bypass the allowlist
// ---------------------------------------------------------------------------

describe('GDB-671 QA — Unicode lookalike rejection', () => {
  // Cyrillic О (U+041E) followed by ASCII U,T -> visually "OUT" but not.
  const cyrillicOut = 'ОUT';
  // Fullwidth Latin O (U+FF2F) U,T
  const fullwidthOut = 'ＯUT';
  // Decomposed: O + combining acute (U+0301) + UT — visually "ÓUT"
  const accentedOut = 'ÓUT';

  for (const [name, build] of builderTriples) {
    it(`${name} rejects Cyrillic-O lookalike "ОUT"`, () => {
      expect(() => build(cyrillicOut)).toThrow(TypeError);
    });
    it(`${name} rejects fullwidth-O lookalike`, () => {
      expect(() => build(fullwidthOut)).toThrow(TypeError);
    });
    it(`${name} rejects "O" + combining accent + "UT"`, () => {
      expect(() => build(accentedOut)).toThrow(TypeError);
    });
  }
});

// ---------------------------------------------------------------------------
// Whitespace and case variants
// ---------------------------------------------------------------------------

describe('GDB-671 QA — Whitespace handling (no trim)', () => {
  const whitespaceVariants = [
    [' OUT', 'leading space'],
    ['OUT ', 'trailing space'],
    ['O UT', 'internal space'],
    ['OUT\n', 'trailing newline'],
    ['\tOUT', 'leading tab'],
    ['OUT\r', 'trailing CR'],
  ] as const;

  for (const [name, build] of builderTriples) {
    for (const [val, label] of whitespaceVariants) {
      it(`${name} rejects ${label} (${JSON.stringify(val)})`, () => {
        expect(() => build(val)).toThrow(TypeError);
      });
    }
  }
});

describe('GDB-671 QA — Case-folding parity (all 4 cases accepted)', () => {
  const cases = ['out', 'Out', 'OUT', 'oUt'];
  for (const [name, build] of builderTriples) {
    for (const c of cases) {
      it(`${name} accepts case variant "${c}"`, () => {
        const q = build(c);
        expect(q.text).toContain('DIRECTION OUT');
      });
    }
  }
});

describe('GDB-671 QA — Length / partial-match rejection', () => {
  const bad = ['O', 'OUTBOUND', 'FORWARDS', 'INNER', 'BOTHWAYS', 'IN ', 'INOUT'];
  for (const [name, build] of builderTriples) {
    for (const v of bad) {
      it(`${name} rejects "${v}"`, () => {
        expect(() => build(v)).toThrow(TypeError);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Type confusion — every non-string input must reject
// ---------------------------------------------------------------------------

describe('GDB-671 QA — Type confusion', () => {
  for (const [name, build] of builderTriples) {
    it(`${name} rejects Symbol("OUT")`, () => {
      expect(() => build(Symbol('OUT'))).toThrow(TypeError);
    });
    it(`${name} rejects object with toString → "OUT"`, () => {
      expect(() => build({ toString: () => 'OUT' })).toThrow(TypeError);
    });
    it(`${name} rejects boolean true`, () => {
      expect(() => build(true)).toThrow(TypeError);
    });
    it(`${name} rejects boolean false`, () => {
      expect(() => build(false)).toThrow(TypeError);
    });
    it(`${name} rejects number 0`, () => {
      expect(() => build(0)).toThrow(TypeError);
    });
    it(`${name} rejects array ["OUT"] (single valid entry)`, () => {
      expect(() => build(['OUT'])).toThrow(TypeError);
    });
    it(`${name} rejects null`, () => {
      expect(() => build(null)).toThrow(TypeError);
    });
    it(`${name} rejects bigint`, () => {
      expect(() => build(BigInt(1))).toThrow(TypeError);
    });
    it(`${name} rejects Map`, () => {
      expect(() => build(new Map())).toThrow(TypeError);
    });
  }
});

// ---------------------------------------------------------------------------
// undefined behavior — defaults differ between builders
// ---------------------------------------------------------------------------

describe('GDB-671 QA — undefined direction', () => {
  it('buildShortestPath omits DIRECTION clause when undefined', () => {
    // ShortestPath check is `options.direction !== undefined` — clause skipped.
    const q = buildShortestPath('knows', 'u', 1, 'u', 2, { direction: undefined });
    expect(q.text).not.toContain('DIRECTION');
  });

  it('buildTraverse falls back to default OUT when undefined', () => {
    // Traverse uses destructuring default `direction = 'OUT'`.
    const q = buildTraverse('follows', 'users', 1, { direction: undefined });
    expect(q.text).toContain('DIRECTION OUT');
  });

  it('buildNearest withinTraverse omits DIRECTION when undefined', () => {
    const q = buildNearest('docs', 'embedding', [0.1, 0.2], {
      withinTraverse: {
        edgeType: 'cites',
        fromTable: 'docs',
        startId: 1,
        direction: undefined,
      },
    });
    expect(q.text).toContain('WITHIN TRAVERSE');
    expect(q.text).not.toContain('DIRECTION');
  });
});

// ---------------------------------------------------------------------------
// Round-trip: emitted SQL always uses uppercase regardless of input case
// ---------------------------------------------------------------------------

describe('GDB-671 QA — Round-trip uppercase emission', () => {
  const inputs: Array<[string, 'IN' | 'OUT' | 'BOTH']> = [
    ['in', 'IN'],
    ['In', 'IN'],
    ['IN', 'IN'],
    ['out', 'OUT'],
    ['OUT', 'OUT'],
    ['both', 'BOTH'],
    ['BoTh', 'BOTH'],
    ['BOTH', 'BOTH'],
  ];
  for (const [name, build] of builderTriples) {
    for (const [input, expected] of inputs) {
      it(`${name} round-trips ${JSON.stringify(input)} -> DIRECTION ${expected}`, () => {
        const q = build(input);
        expect(q.text).toContain(`DIRECTION ${expected}`);
        // No lowercase form of the keyword should appear.
        expect(q.text).not.toMatch(/DIRECTION (in|out|both|In|Out|Both|BoTh)/);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Cross-builder consistency: same input -> same accept/reject across all 3
// ---------------------------------------------------------------------------

describe('GDB-671 QA — Cross-builder behavioral parity', () => {
  const accepted = ['IN', 'OUT', 'BOTH', 'in', 'out', 'both', 'BoTh', 'iN'];
  const rejected = [
    'OUT;', 'OUT--', 'OUT/*', 'INX', '', '   ', 'OUT ', 'OUT​' /* zero-width space */,
  ];

  for (const v of accepted) {
    it(`all 3 builders accept ${JSON.stringify(v)}`, () => {
      expect(() => callShortest(v)).not.toThrow();
      expect(() => callTraverse(v)).not.toThrow();
      expect(() => callWithinTraverse(v)).not.toThrow();
    });
  }

  for (const v of rejected) {
    it(`all 3 builders reject ${JSON.stringify(v)}`, () => {
      expect(() => callShortest(v)).toThrow(TypeError);
      expect(() => callTraverse(v)).toThrow(TypeError);
      expect(() => callWithinTraverse(v)).toThrow(TypeError);
    });
  }
});

// ---------------------------------------------------------------------------
// Legacy-syntax interaction in buildShortestPath
// ---------------------------------------------------------------------------

describe('GDB-671 QA — legacySyntax does not bypass validation', () => {
  it('rejects malicious direction even when legacySyntax=true', () => {
    expect(() =>
      buildShortestPath('knows', 'u', 1, 'u', 2, {
        direction: 'MALICIOUS; DROP TABLE x; --' as unknown as 'OUT',
        legacySyntax: true,
      }),
    ).toThrow(TypeError);
  });

  it('legacySyntax=true with valid direction still emits DIRECTION clause', () => {
    const q = buildShortestPath('knows', 'u', 1, 'u', 2, {
      direction: 'in' as unknown as 'IN',
      legacySyntax: true,
    });
    expect(q.text).toContain('DIRECTION IN');
    // legacySyntax suppresses the SELECT wrapper.
    expect(q.text).not.toMatch(/^SELECT/);
  });

  it('legacySyntax=true without direction omits the clause', () => {
    const q = buildShortestPath('knows', 'u', 1, 'u', 2, { legacySyntax: true });
    expect(q.text).not.toContain('DIRECTION');
  });
});

// ---------------------------------------------------------------------------
// Regression: buildDegreeCentrality (NOT touched by GDB-671) still works
// ---------------------------------------------------------------------------

describe('GDB-671 QA — buildDegreeCentrality regression (inline allowlist)', () => {
  it('still accepts "OUT"', () => {
    const q = buildDegreeCentrality('knows', { direction: 'OUT' });
    expect(q.values).toContain('OUT');
  });

  it('still accepts lowercase "in"', () => {
    const q = buildDegreeCentrality('knows', {
      direction: 'in' as unknown as 'IN',
    });
    expect(q.values).toContain('IN');
  });

  it('still rejects classic injection', () => {
    expect(() =>
      buildDegreeCentrality('knows', {
        direction: 'OUT; DROP TABLE x; --' as unknown as 'OUT',
      }),
    ).toThrow(TypeError);
  });

  it('still rejects unknown token', () => {
    expect(() =>
      buildDegreeCentrality('knows', {
        direction: 'sideways' as unknown as 'OUT',
      }),
    ).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// Reviewer audit follow-up — confirm raw `where` / `weight` / `returnItems`
// interpolation is exploitable. These are EVIDENCE tests for the bug tickets
// to be filed (NOT acceptance tests for GDB-671). They assert the bug exists
// today; once the follow-up tickets fix it, these tests will need updating.
// ---------------------------------------------------------------------------

describe('GDB-671 QA — Evidence: unrelated raw-interpolation sinks (audit)', () => {
  it('buildTraverse `where` interpolates raw SQL verbatim (BUG)', () => {
    const malicious = "1=1; DROP TABLE users; --";
    const q = buildTraverse('follows', 'users', 1, { where: malicious });
    expect(q.text).toContain(`WHERE ${malicious}`);
    expect(q.text).toContain('DROP TABLE users');
  });

  it('buildNearest `where` interpolates raw SQL verbatim (BUG)', () => {
    const malicious = "1=1; DROP TABLE docs; --";
    const q = buildNearest('docs', 'embedding', [0.1, 0.2], { where: malicious });
    expect(q.text).toContain(`WHERE ${malicious}`);
  });

  it('buildMatch `where` interpolates raw SQL verbatim (BUG)', () => {
    const malicious = "1=1; DROP TABLE u; --";
    const q = buildMatch(
      [{ alias: 'a', table: 'users' }],
      { returnItems: ['a.id'], where: malicious },
    );
    expect(q.text).toContain(malicious);
  });

  it('buildMatch `returnItems[]` interpolated raw (BUG)', () => {
    const malicious = '1, (SELECT password FROM secrets)';
    const q = buildMatch(
      [{ alias: 'a', table: 'users' }],
      { returnItems: [malicious] },
    );
    expect(q.text).toContain(malicious);
  });

  it('buildShortestMatch `weight` and `where` interpolated raw (BUG)', () => {
    const maliciousW = '1; DROP TABLE x; --';
    const maliciousWhere = '1=1; --';
    const q = buildShortestMatch(
      [
        { alias: 'a', table: 'users' },
        { alias: 'r', edgeType: 'knows', direction: 'OUT' },
        { alias: 'b', table: 'users' },
      ],
      ['a.id'],
      'ANY',
      { weight: maliciousW, where: maliciousWhere },
    );
    expect(q.text).toContain(`WEIGHT ${maliciousW}`);
    expect(q.text).toContain(`WHERE ${maliciousWhere}`);
  });
});
