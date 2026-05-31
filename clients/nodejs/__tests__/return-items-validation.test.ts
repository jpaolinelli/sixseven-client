/**
 * GDB-673: Unit tests for `returnItems[]` validation in `buildMatch` and
 * `buildShortestMatch`. Verifies the qualified-identifier allowlist rejects
 * SQL injection payloads while accepting legitimate projection shapes.
 */
import { describe, it, expect } from 'vitest';
import { buildMatch, buildShortestMatch } from '../src/query-builders';
import type { MatchPatternElement, ShortestMatchSelector } from '../src/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const simplePattern: MatchPatternElement[] = [
  { alias: 'a', table: 'users' },
];

const threeNodePattern: MatchPatternElement[] = [
  { alias: 'a', table: 'users' },
  { alias: 'r', edgeType: 'knows', direction: 'OUT' },
  { alias: 'b', table: 'users' },
];

function matchWith(returnItems: unknown[]): { text: string; values: unknown[] } {
  return buildMatch(simplePattern, { returnItems: returnItems as string[] });
}

function shortestMatchWith(returnItems: unknown[]): { text: string; values: unknown[] } {
  return buildShortestMatch(
    threeNodePattern,
    returnItems as string[],
    'ANY SHORTEST' as ShortestMatchSelector,
  );
}

// ---------------------------------------------------------------------------
// Valid return items — accepted shapes
// ---------------------------------------------------------------------------

describe('GDB-673 — returnItems: valid shapes', () => {
  const validCases: Array<[string, string[]]> = [
    ['bare star', ['*']],
    ['simple identifier', ['name']],
    ['multiple identifiers', ['name', 'age', 'id']],
    ['qualified identifier (alias.column)', ['a.name']],
    ['qualified star (alias.*)', ['a.*']],
    ['mixed valid items', ['a.name', 'b.id', '*', 'score']],
    ['underscore-prefixed identifier', ['_private']],
    ['underscore-only identifier', ['_']],
    ['identifier with digits', ['col1', 'a.col2']],
    ['long valid identifier', ['a'.repeat(64)]],
  ];

  for (const [label, items] of validCases) {
    it(`buildMatch accepts ${label}`, () => {
      const q = matchWith(items);
      expect(q.text).toContain('SELECT');
      // Each valid item should appear in the output
      for (const item of items) {
        expect(q.text).toContain(item);
      }
    });

    it(`buildShortestMatch accepts ${label}`, () => {
      const q = shortestMatchWith(items);
      expect(q.text).toContain('SELECT');
      for (const item of items) {
        expect(q.text).toContain(item);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Invalid return items — must be rejected
// ---------------------------------------------------------------------------

describe('GDB-673 — returnItems: SQL injection payloads rejected', () => {
  const injectionPayloads: Array<[string, string[]]> = [
    ['subquery in item', ['1, (SELECT password FROM secrets)']],
    ['stacked statement', ['a.id; DROP TABLE users; --']],
    ['comment injection', ['a.id --']],
    ['union injection', ['a.id UNION SELECT secret FROM passwords']],
    ['function call', ['COUNT(*)']],
    ['expression', ['a.id + 1']],
    ['string literal', ["'malicious'"]],
    ['parenthesized expression', ['(a.id)']],
    ['semicolon', ['a.id;']],
    ['comma in single item', ['a.id, b.name']],
  ];

  for (const [label, items] of injectionPayloads) {
    it(`buildMatch rejects ${label}`, () => {
      expect(() => matchWith(items)).toThrow(TypeError);
    });

    it(`buildShortestMatch rejects ${label}`, () => {
      expect(() => shortestMatchWith(items)).toThrow(TypeError);
    });
  }
});

describe('GDB-673 — returnItems: malformed identifiers rejected', () => {
  const malformed: Array<[string, string[]]> = [
    ['empty string', ['']],
    ['whitespace only', ['  ']],
    ['starts with digit', ['1col']],
    ['contains space', ['a name']],
    ['double dot', ['a..b']],
    ['trailing dot', ['a.']],
    ['leading dot', ['.name']],
    ['triple qualification', ['a.b.c']],
    ['dash in identifier', ['my-col']],
    ['special chars', ['a.name$']],
    ['newline in item', ['a\n.name']],
    ['tab in item', ['a\t.name']],
  ];

  for (const [label, items] of malformed) {
    it(`buildMatch rejects ${label}`, () => {
      expect(() => matchWith(items)).toThrow();
    });

    it(`buildShortestMatch rejects ${label}`, () => {
      expect(() => shortestMatchWith(items)).toThrow();
    });
  }
});

// ---------------------------------------------------------------------------
// Type confusion
// ---------------------------------------------------------------------------

describe('GDB-673 — returnItems: type confusion', () => {
  it('buildMatch rejects non-string item in array', () => {
    expect(() => matchWith([42 as unknown as string])).toThrow(TypeError);
  });

  it('buildMatch rejects null item in array', () => {
    expect(() => matchWith([null as unknown as string])).toThrow(TypeError);
  });

  it('buildMatch rejects non-array returnItems', () => {
    expect(() =>
      buildMatch(simplePattern, { returnItems: 'a.id' as unknown as string[] }),
    ).toThrow(TypeError);
  });

  it('buildMatch rejects empty returnItems array', () => {
    expect(() => matchWith([])).toThrow(TypeError);
  });

  it('buildShortestMatch rejects non-array returnItems', () => {
    expect(() =>
      buildShortestMatch(
        threeNodePattern,
        'a.id' as unknown as string[],
        'ANY SHORTEST',
      ),
    ).toThrow(TypeError);
  });

  it('buildShortestMatch rejects empty returnItems array', () => {
    expect(() => shortestMatchWith([])).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// Length limits
// ---------------------------------------------------------------------------

describe('GDB-673 — returnItems: length limits', () => {
  it('rejects identifier longer than 64 characters', () => {
    expect(() => matchWith(['a'.repeat(65)])).toThrow(RangeError);
  });

  it('rejects array with more than 1000 items', () => {
    const items = Array.from({ length: 1001 }, (_, i) => `col${i}`);
    expect(() => matchWith(items)).toThrow(RangeError);
  });

  it('accepts array with exactly 1000 items', () => {
    const items = Array.from({ length: 1000 }, (_, i) => `col${i}`);
    expect(() => matchWith(items)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Legacy syntax path in buildMatch
// ---------------------------------------------------------------------------

describe('GDB-673 — buildMatch legacySyntax also validates returnItems', () => {
  it('rejects injection in legacy syntax mode', () => {
    expect(() =>
      buildMatch(simplePattern, {
        returnItems: ['1, (SELECT password FROM secrets)'],
        legacySyntax: true,
      }),
    ).toThrow(TypeError);
  });

  it('accepts valid items in legacy syntax mode', () => {
    const q = buildMatch(simplePattern, {
      returnItems: ['a.name', 'a.id'],
      legacySyntax: true,
    });
    expect(q.text).toContain('RETURN a.name, a.id');
    expect(q.text).not.toContain('SELECT');
  });
});
