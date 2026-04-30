/**
 * QA adversarial tests for GDB-673: returnItems[] SQL injection fix
 * in buildMatch and buildShortestMatch.
 *
 * These tests go beyond the dev tests to cover:
 * - Unicode tricks and homoglyphs
 * - Null bytes and control characters
 * - Prototype pollution via __proto__ / constructor
 * - Mixed valid + malicious arrays (poison-pill)
 * - Object/boolean/undefined type confusion
 * - Regex ReDoS-style long inputs at boundary
 * - Backtick and bracket escaping attempts
 * - Multiple dots and deep qualification attempts
 * - Whitespace smuggling (zero-width, NBSP, etc.)
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
// 1. SQL injection payloads (adversarial expansion of dev tests)
// ---------------------------------------------------------------------------

describe('QA GDB-673: SQL injection payloads must be rejected', () => {
  const injections: Array<[string, string[]]> = [
    ['subquery', ['1, (SELECT password FROM secrets)']],
    ['UNION SELECT', ['a UNION SELECT * FROM secrets']],
    ['semicolon drop', ['a; DROP TABLE users']],
    ['comment --', ['a -- comment']],
    ['comment /*', ['a /* comment */']],
    ['stacked with newline', ['a\n; DROP TABLE users']],
    ['OR 1=1', ["a OR '1'='1'"]],
    ['CAST expression', ['CAST(a AS int)']],
    ['INTO OUTFILE', ["a INTO OUTFILE '/tmp/dump'"]],
    ['WAITFOR DELAY (timing attack)', ["a; WAITFOR DELAY '0:0:5'"]],
    ['hex literal', ['0x414141']],
    ['backslash escape', ['a\\']],
    ['double-dash at end', ['name--']],
    ['single quote escape', ["name'"]],
    ['double quote escape', ['name"']],
  ];

  for (const [label, items] of injections) {
    it(`buildMatch rejects: ${label}`, () => {
      expect(() => matchWith(items)).toThrow();
    });

    it(`buildShortestMatch rejects: ${label}`, () => {
      expect(() => shortestMatchWith(items)).toThrow();
    });
  }
});

// ---------------------------------------------------------------------------
// 2. Poison-pill: one valid + one malicious item
// ---------------------------------------------------------------------------

describe('QA GDB-673: mixed valid and malicious items', () => {
  const poisonPills: Array<[string, string[]]> = [
    ['valid then subquery', ['name', '(SELECT 1)']],
    ['valid then union', ['name', 'a UNION SELECT 1']],
    ['valid then semicolon', ['name', 'a; DROP TABLE x']],
    ['valid then comment', ['name', 'a --']],
    ['three items, middle bad', ['name', '1+1', 'age']],
    ['last item bad', ['a.name', 'b.id', '*', 'COUNT(*)']],
  ];

  for (const [label, items] of poisonPills) {
    it(`buildMatch rejects: ${label}`, () => {
      expect(() => matchWith(items)).toThrow();
    });

    it(`buildShortestMatch rejects: ${label}`, () => {
      expect(() => shortestMatchWith(items)).toThrow();
    });
  }
});

// ---------------------------------------------------------------------------
// 3. Unicode tricks and homoglyphs
// ---------------------------------------------------------------------------

describe('QA GDB-673: Unicode smuggling must be rejected', () => {
  const unicodeTricks: Array<[string, string[]]> = [
    ['Cyrillic a (homoglyph)', ['а']],          // Cyrillic 'a' looks like Latin 'a'
    ['fullwidth asterisk', ['＊']],                // fullwidth *
    ['zero-width space in identifier', ['na​me']],
    ['zero-width joiner', ['na‍me']],
    ['non-breaking space', ['na me']],
    ['right-to-left override', ['‮name']],
    ['combining diacritical', ['namé']],
    ['em dash instead of hyphen', ['my—col']],
    ['fullwidth period', ['a．name']],            // fullwidth '.'
    ['ideographic period', ['a。name']],
    ['mathematical bold A', ['𝐀']],        // U+1D400
  ];

  for (const [label, items] of unicodeTricks) {
    it(`buildMatch rejects: ${label}`, () => {
      expect(() => matchWith(items)).toThrow();
    });

    it(`buildShortestMatch rejects: ${label}`, () => {
      expect(() => shortestMatchWith(items)).toThrow();
    });
  }
});

// ---------------------------------------------------------------------------
// 4. Type confusion (deeper than dev tests)
// ---------------------------------------------------------------------------

describe('QA GDB-673: type confusion edge cases', () => {
  it('buildMatch rejects undefined item', () => {
    expect(() => matchWith([undefined as unknown as string])).toThrow(TypeError);
  });

  it('buildMatch rejects boolean item', () => {
    expect(() => matchWith([true as unknown as string])).toThrow(TypeError);
  });

  it('buildMatch rejects object item', () => {
    expect(() => matchWith([{ toString: () => 'name' } as unknown as string])).toThrow(TypeError);
  });

  it('buildMatch rejects array item', () => {
    expect(() => matchWith([['name'] as unknown as string])).toThrow(TypeError);
  });

  it('buildMatch rejects Symbol item', () => {
    expect(() => matchWith([Symbol('name') as unknown as string])).toThrow(TypeError);
  });

  it('buildMatch rejects BigInt item', () => {
    expect(() => matchWith([BigInt(1) as unknown as string])).toThrow(TypeError);
  });

  it('buildShortestMatch rejects undefined returnItems', () => {
    expect(() =>
      buildShortestMatch(
        threeNodePattern,
        undefined as unknown as string[],
        'ANY SHORTEST',
      ),
    ).toThrow(TypeError);
  });

  it('buildShortestMatch rejects null returnItems', () => {
    expect(() =>
      buildShortestMatch(
        threeNodePattern,
        null as unknown as string[],
        'ANY SHORTEST',
      ),
    ).toThrow(TypeError);
  });

  it('buildMatch rejects returnItems as number', () => {
    expect(() =>
      buildMatch(simplePattern, { returnItems: 42 as unknown as string[] }),
    ).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// 5. Boundary values
// ---------------------------------------------------------------------------

describe('QA GDB-673: boundary values', () => {
  it('accepts exactly 64-char identifier', () => {
    const item = 'a'.repeat(64);
    const q = matchWith([item]);
    expect(q.text).toContain(item);
  });

  it('rejects 65-char identifier', () => {
    expect(() => matchWith(['a'.repeat(65)])).toThrow(RangeError);
  });

  it('accepts exactly 1000 items', () => {
    const items = Array.from({ length: 1000 }, (_, i) => `c${i}`);
    expect(() => matchWith(items)).not.toThrow();
  });

  it('rejects 1001 items', () => {
    const items = Array.from({ length: 1001 }, (_, i) => `c${i}`);
    expect(() => matchWith(items)).toThrow(RangeError);
  });

  it('rejects single empty string', () => {
    expect(() => matchWith([''])).toThrow();
  });

  it('single underscore is valid', () => {
    const q = matchWith(['_']);
    expect(q.text).toContain('_');
  });

  it('single letter is valid', () => {
    const q = matchWith(['a']);
    expect(q.text).toContain('SELECT a FROM');
  });
});

// ---------------------------------------------------------------------------
// 6. Bracket and backtick escaping attempts
// ---------------------------------------------------------------------------

describe('QA GDB-673: bracket and backtick escaping', () => {
  const escapingAttempts: Array<[string, string[]]> = [
    ['backtick-quoted identifier', ['`name`']],
    ['bracket-quoted identifier', ['[name]']],
    ['double-quoted identifier', ['"name"']],
    ['backtick with injection', ['`; DROP TABLE x; `']],
    ['bracket with injection', ['[1]; DROP TABLE x; --']],
  ];

  for (const [label, items] of escapingAttempts) {
    it(`buildMatch rejects: ${label}`, () => {
      expect(() => matchWith(items)).toThrow();
    });

    it(`buildShortestMatch rejects: ${label}`, () => {
      expect(() => shortestMatchWith(items)).toThrow();
    });
  }
});

// ---------------------------------------------------------------------------
// 7. Whitespace and control character smuggling
// ---------------------------------------------------------------------------

describe('QA GDB-673: whitespace and control characters', () => {
  const whitespace: Array<[string, string[]]> = [
    ['leading space', [' name']],
    ['trailing space', ['name ']],
    ['tab character', ['name\t']],
    ['newline', ['name\n']],
    ['carriage return', ['name\r']],
    ['vertical tab', ['name\v']],
    ['form feed', ['name\f']],
    ['null byte', ['name\0']],
    ['only spaces', ['   ']],
    ['space between qualifier and column', ['a . name']],
  ];

  for (const [label, items] of whitespace) {
    it(`buildMatch rejects: ${label}`, () => {
      expect(() => matchWith(items)).toThrow();
    });

    it(`buildShortestMatch rejects: ${label}`, () => {
      expect(() => shortestMatchWith(items)).toThrow();
    });
  }
});

// ---------------------------------------------------------------------------
// 8. Prototype pollution strings
// ---------------------------------------------------------------------------

describe('QA GDB-673: prototype pollution identifiers', () => {
  // These are valid identifiers syntactically -- they should be ACCEPTED
  // because they match the regex (letters/underscores only). The point is
  // to verify the regex doesn't have special handling that breaks on them.
  const protoNames = ['__proto__', 'constructor', 'prototype', 'hasOwnProperty'];

  for (const name of protoNames) {
    it(`buildMatch accepts valid identifier: ${name}`, () => {
      const q = matchWith([name]);
      expect(q.text).toContain(name);
    });
  }
});

// ---------------------------------------------------------------------------
// 9. Valid shapes produce correct SQL
// ---------------------------------------------------------------------------

describe('QA GDB-673: valid shapes produce correct output', () => {
  it('buildMatch with single star produces correct SQL', () => {
    const q = matchWith(['*']);
    expect(q.text).toBe('SELECT * FROM MATCH (a:"users")');
  });

  it('buildMatch with qualified column produces correct SQL', () => {
    const q = matchWith(['a.name']);
    expect(q.text).toBe('SELECT a.name FROM MATCH (a:"users")');
  });

  it('buildMatch with multiple items produces comma-separated SQL', () => {
    const q = matchWith(['a.name', 'a.id', '*']);
    expect(q.text).toBe('SELECT a.name, a.id, * FROM MATCH (a:"users")');
  });

  it('buildMatch with qualified star', () => {
    const q = matchWith(['a.*']);
    expect(q.text).toBe('SELECT a.* FROM MATCH (a:"users")');
  });

  it('buildShortestMatch with valid items produces correct SQL', () => {
    const q = shortestMatchWith(['a.name', 'b.id']);
    expect(q.text).toContain('SELECT a.name, b.id FROM MATCH');
  });

  it('buildMatch legacySyntax uses RETURN keyword', () => {
    const q = buildMatch(simplePattern, {
      returnItems: ['a.name'],
      legacySyntax: true,
    });
    expect(q.text).toContain('RETURN a.name');
    expect(q.text).not.toContain('SELECT');
  });

  it('buildMatch returns empty values array', () => {
    const q = matchWith(['name']);
    expect(q.values).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 10. Both functions protected (explicit parity)
// ---------------------------------------------------------------------------

describe('QA GDB-673: both buildMatch and buildShortestMatch are protected', () => {
  const payload = ['1, (SELECT password FROM secrets)'];

  it('buildMatch throws for subquery injection', () => {
    expect(() => matchWith(payload)).toThrow(TypeError);
  });

  it('buildShortestMatch throws for subquery injection', () => {
    expect(() => shortestMatchWith(payload)).toThrow(TypeError);
  });

  it('buildMatch legacy syntax throws for subquery injection', () => {
    expect(() =>
      buildMatch(simplePattern, {
        returnItems: payload,
        legacySyntax: true,
      }),
    ).toThrow(TypeError);
  });
});

// ---------------------------------------------------------------------------
// 11. Error message quality
// ---------------------------------------------------------------------------

describe('QA GDB-673: error messages contain useful context', () => {
  it('type error includes index for non-string item', () => {
    try {
      matchWith(['name', 42 as unknown as string]);
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(TypeError);
      expect((e as Error).message).toContain('returnItems[1]');
      expect((e as Error).message).toContain('number');
    }
  });

  it('regex error includes the rejected value', () => {
    try {
      matchWith(['valid', 'a; DROP TABLE x']);
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(TypeError);
      expect((e as Error).message).toContain('returnItems[1]');
      expect((e as Error).message).toContain('a; DROP TABLE x');
    }
  });

  it('length error includes character count', () => {
    try {
      matchWith(['a'.repeat(65)]);
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(RangeError);
      expect((e as Error).message).toContain('65');
    }
  });
});
