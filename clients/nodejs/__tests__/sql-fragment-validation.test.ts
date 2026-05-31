/**
 * GDB-672: Tests for SQL fragment validation in WHERE and WEIGHT clauses
 * across buildTraverse, buildNearest, buildMatch, and buildShortestMatch.
 *
 * Validates that the `validateSqlFragment` helper rejects dangerous patterns
 * (semicolons, comments, subqueries, excessive length) while accepting
 * legitimate SQL expression fragments.
 */
import { describe, it, expect } from 'vitest';
import {
  buildTraverse,
  buildNearest,
  buildMatch,
  buildShortestMatch,
} from '../src/query-builders';

// ---------------------------------------------------------------------------
// Helpers — call each builder with a given where/weight value
// ---------------------------------------------------------------------------

function traverseWithWhere(where: unknown): { text: string; values: unknown[] } {
  return buildTraverse('follows', 'users', 1, {
    where: where as string,
  });
}

function nearestWithWhere(where: unknown): { text: string; values: unknown[] } {
  return buildNearest('docs', 'embedding', [0.1, 0.2], {
    where: where as string,
  });
}

function matchWithWhere(where: unknown): { text: string; values: unknown[] } {
  return buildMatch(
    [{ alias: 'a', table: 'users' }],
    { returnItems: ['a.id'], where: where as string },
  );
}

function shortestMatchWithWhere(where: unknown): { text: string; values: unknown[] } {
  return buildShortestMatch(
    [
      { alias: 'a', table: 'users' },
      { alias: 'r', edgeType: 'knows', direction: 'OUT' },
      { alias: 'b', table: 'users' },
    ],
    ['a.id'],
    'ANY',
    { where: where as string },
  );
}

function shortestMatchWithWeight(weight: unknown): { text: string; values: unknown[] } {
  return buildShortestMatch(
    [
      { alias: 'a', table: 'users' },
      { alias: 'r', edgeType: 'knows', direction: 'OUT' },
      { alias: 'b', table: 'users' },
    ],
    ['a.id'],
    'ANY',
    { weight: weight as string },
  );
}

type BuilderFn = (val: unknown) => { text: string; values: unknown[] };

const whereBuilders: ReadonlyArray<[string, BuilderFn]> = [
  ['buildTraverse', traverseWithWhere],
  ['buildNearest', nearestWithWhere],
  ['buildMatch', matchWithWhere],
  ['buildShortestMatch', shortestMatchWithWhere],
];

const allBuilders: ReadonlyArray<[string, BuilderFn, string]> = [
  ...whereBuilders.map(([name, fn]) => [name, fn, 'where'] as [string, BuilderFn, string]),
  ['buildShortestMatch (weight)', shortestMatchWithWeight, 'weight'],
];

// ---------------------------------------------------------------------------
// Happy path — legitimate SQL fragments should be accepted
// ---------------------------------------------------------------------------

describe('GDB-672 — valid SQL fragments accepted', () => {
  const validFragments = [
    'age > 21',
    'name = \'Alice\'',
    'score >= 0.5 AND active = true',
    'depth < 3',
    'a.name IS NOT NULL',
    'r.weight > 0',
    'a.age BETWEEN 18 AND 65',
    'a.name LIKE \'%test%\'',
    'a.id IN (1, 2, 3)',
    'a.score + b.score > 10',
  ];

  for (const [name, build] of whereBuilders) {
    for (const fragment of validFragments) {
      it(`${name} accepts "${fragment}"`, () => {
        const q = build(fragment);
        expect(q.text).toContain(`WHERE ${fragment}`);
      });
    }
  }

  it('buildShortestMatch accepts valid weight expression "r.cost"', () => {
    const q = shortestMatchWithWeight('r.cost');
    expect(q.text).toContain('WEIGHT r.cost');
  });

  it('buildShortestMatch accepts valid weight expression "r.distance + 1"', () => {
    const q = shortestMatchWithWeight('r.distance + 1');
    expect(q.text).toContain('WEIGHT r.distance + 1');
  });
});

// ---------------------------------------------------------------------------
// Semicolon rejection (query stacking)
// ---------------------------------------------------------------------------

describe('GDB-672 — semicolon rejection', () => {
  const payloads = [
    '1=1; DROP TABLE users',
    'age > 21; --',
    '; DELETE FROM users',
    'name = \'x\'; UPDATE users SET admin=true',
  ];

  for (const [name, build, paramName] of allBuilders) {
    for (const payload of payloads) {
      it(`${name} rejects semicolon in ${paramName}: "${payload}"`, () => {
        expect(() => build(payload)).toThrow(/semicolons/);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// SQL comment rejection
// ---------------------------------------------------------------------------

describe('GDB-672 — SQL comment rejection', () => {
  const commentPayloads = [
    ['1=1 -- comment', 'line comment'],
    ['1=1 /* block comment */', 'block comment open'],
    ['1=1 */ injected', 'block comment close'],
    ['age > 21--', 'line comment no space'],
  ];

  for (const [name, build, paramName] of allBuilders) {
    for (const [payload, label] of commentPayloads) {
      it(`${name} rejects ${label} in ${paramName}`, () => {
        expect(() => build(payload)).toThrow(/comment/i);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Subquery rejection
// ---------------------------------------------------------------------------

describe('GDB-672 — subquery rejection', () => {
  const subqueryPayloads = [
    'id IN (SELECT id FROM secrets)',
    'id = (select 1)',
    'name IN ( SELECT name FROM admin)',
    'x = (  SELECT password FROM creds)',
  ];

  for (const [name, build, paramName] of allBuilders) {
    for (const payload of subqueryPayloads) {
      it(`${name} rejects subquery in ${paramName}: "${payload.slice(0, 40)}"`, () => {
        expect(() => build(payload)).toThrow(/subquer/i);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Length cap
// ---------------------------------------------------------------------------

describe('GDB-672 — length cap enforcement', () => {
  const longFragment = 'a'.repeat(2049);

  for (const [name, build, paramName] of allBuilders) {
    it(`${name} rejects ${paramName} exceeding 2048 characters`, () => {
      expect(() => build(longFragment)).toThrow(RangeError);
    });
  }

  it('accepts a fragment at exactly 2048 characters', () => {
    const fragment = 'x'.repeat(2048);
    const q = traverseWithWhere(fragment);
    expect(q.text).toContain(`WHERE ${fragment}`);
  });
});

// ---------------------------------------------------------------------------
// Type rejection — non-string values
// ---------------------------------------------------------------------------

describe('GDB-672 — non-string where/weight rejected', () => {
  const nonStrings: Array<[string, unknown]> = [
    ['number', 42],
    ['boolean', true],
    ['null', null],
    ['undefined (explicit)', undefined],
    ['object', { toString: () => 'age > 1' }],
    ['array', ['age > 1']],
  ];

  for (const [name, build] of whereBuilders) {
    for (const [label, val] of nonStrings) {
      // undefined/null where is treated as "no where clause" in the builders
      // since they check `if (where)` before calling validateSqlFragment.
      // Only truthy non-string values should throw.
      if (val === undefined || val === null || val === false) {
        it(`${name} ignores falsy ${label} where (no WHERE clause)`, () => {
          const q = build(val);
          expect(q.text).not.toContain('WHERE');
        });
      } else {
        it(`${name} rejects ${label} where`, () => {
          expect(() => build(val)).toThrow(TypeError);
        });
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Empty / whitespace-only strings
// ---------------------------------------------------------------------------

describe('GDB-672 — empty and whitespace-only strings rejected', () => {
  // Empty string is falsy so `if (where)` skips it; whitespace-only is truthy
  // but assertNonEmptyString rejects it.
  for (const [name, build] of whereBuilders) {
    it(`${name} skips empty-string where (falsy)`, () => {
      const q = build('');
      expect(q.text).not.toContain('WHERE');
    });

    it(`${name} rejects whitespace-only where`, () => {
      expect(() => build('   ')).toThrow(TypeError);
    });
  }
});

// ---------------------------------------------------------------------------
// buildMatch legacy syntax also validates
// ---------------------------------------------------------------------------

describe('GDB-672 — buildMatch legacySyntax validates where', () => {
  it('rejects injection in legacy syntax', () => {
    expect(() =>
      buildMatch(
        [{ alias: 'a', table: 'users' }],
        { returnItems: ['a.id'], where: '1=1; DROP TABLE u', legacySyntax: true },
      ),
    ).toThrow(/semicolons/);
  });

  it('accepts valid where in legacy syntax', () => {
    const q = buildMatch(
      [{ alias: 'a', table: 'users' }],
      { returnItems: ['a.id'], where: 'a.age > 21', legacySyntax: true },
    );
    expect(q.text).toContain('WHERE a.age > 21');
    expect(q.text).toMatch(/^MATCH/);
  });
});

// ---------------------------------------------------------------------------
// Combined payloads — multiple injection vectors in one string
// ---------------------------------------------------------------------------

describe('GDB-672 — combined injection vectors', () => {
  const combined = [
    "1=1; DROP TABLE users; -- comment",
    "x = (SELECT 1); --",
    "1=1 /* block */ ; DROP TABLE x",
  ];

  for (const [name, build] of whereBuilders) {
    for (const payload of combined) {
      it(`${name} rejects combined payload: "${payload.slice(0, 40)}"`, () => {
        expect(() => build(payload)).toThrow(TypeError);
      });
    }
  }
});
