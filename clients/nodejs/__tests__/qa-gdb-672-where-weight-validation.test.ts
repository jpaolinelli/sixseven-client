/**
 * QA adversarial tests for GDB-672: SQL fragment validation in WHERE/WEIGHT.
 *
 * Tests the validateSqlFragment deny-list approach for bypass vectors,
 * edge cases, and correct acceptance of legitimate expressions.
 */
import { describe, it, expect } from 'vitest';
import {
  buildTraverse,
  buildNearest,
  buildMatch,
  buildShortestMatch,
} from '../src/query-builders';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function traverseW(where: unknown) {
  return buildTraverse('follows', 'users', 1, { where: where as string });
}

function nearestW(where: unknown) {
  return buildNearest('docs', 'embedding', [0.1, 0.2], { where: where as string });
}

function matchW(where: unknown) {
  return buildMatch(
    [{ alias: 'a', table: 'users' }],
    { returnItems: ['a.id'], where: where as string },
  );
}

function shortestW(where: unknown) {
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

function shortestWeight(weight: unknown) {
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
  ['buildTraverse', traverseW],
  ['buildNearest', nearestW],
  ['buildMatch', matchW],
  ['buildShortestMatch', shortestW],
];

const allBuilders: ReadonlyArray<[string, BuilderFn, string]> = [
  ...whereBuilders.map(([n, f]) => [n, f, 'where'] as [string, BuilderFn, string]),
  ['buildShortestMatch (weight)', shortestWeight, 'weight'],
];

// ===================================================================
// 1. ACCEPTANCE CRITERIA: Semicolon injection must throw
// ===================================================================

describe('QA GDB-672 — AC1: semicolon injection rejected', () => {
  const payloads = [
    '1=1; DROP TABLE users',
    'age > 21; --',
    '; DELETE FROM users',
    "name = 'x'; UPDATE users SET admin=true",
    'x;',
    ';',
  ];

  for (const [name, build, param] of allBuilders) {
    for (const payload of payloads) {
      it(`${name} (${param}) rejects: "${payload}"`, () => {
        expect(() => build(payload)).toThrow(/semicolons/);
      });
    }
  }
});

// ===================================================================
// 2. ACCEPTANCE CRITERIA: Comment injection must throw
// ===================================================================

describe('QA GDB-672 — AC2: comment injection rejected', () => {
  const payloads: Array<[string, RegExp]> = [
    ['age > 5 -- ignore rest', /comment/i],
    ['age /* comment */ > 5', /comment/i],
    ['1=1--', /comment/i],
    ['/* start block', /comment/i],
    ['end block */', /comment/i],
    ['-- only comment', /comment/i],
  ];

  for (const [name, build, param] of allBuilders) {
    for (const [payload, pattern] of payloads) {
      it(`${name} (${param}) rejects: "${payload}"`, () => {
        expect(() => build(payload)).toThrow(pattern);
      });
    }
  }
});

// ===================================================================
// 3. ACCEPTANCE CRITERIA: Subquery injection must throw
// ===================================================================

describe('QA GDB-672 — AC3: subquery injection rejected', () => {
  const payloads = [
    'id IN (SELECT id FROM secrets)',
    'id = (select 1)',
    'name IN ( SELECT name FROM admin)',
    'x = (  SELECT password FROM creds)',
    'id IN (\tSELECT id FROM t)',
    'id IN (\nSELECT id FROM t)',
  ];

  for (const [name, build, param] of allBuilders) {
    for (const payload of payloads) {
      it(`${name} (${param}) rejects subquery: "${payload.slice(0, 40)}"`, () => {
        expect(() => build(payload)).toThrow(/subquer/i);
      });
    }
  }
});

// ===================================================================
// 4. ACCEPTANCE CRITERIA: Length bomb must throw
// ===================================================================

describe('QA GDB-672 — AC4: length bomb rejected', () => {
  for (const [name, build, param] of allBuilders) {
    it(`${name} (${param}) rejects string exceeding 2048 chars`, () => {
      const bomb = 'a'.repeat(2049);
      expect(() => build(bomb)).toThrow(RangeError);
    });
  }

  it('accepts exactly 2048 chars (boundary)', () => {
    const fragment = 'x'.repeat(2048);
    const q = traverseW(fragment);
    expect(q.text).toContain(`WHERE ${fragment}`);
  });

  it('rejects exactly 2049 chars (boundary)', () => {
    const fragment = 'x'.repeat(2049);
    expect(() => traverseW(fragment)).toThrow(RangeError);
  });
});

// ===================================================================
// 5. ACCEPTANCE CRITERIA: Legitimate expressions still work
// ===================================================================

describe('QA GDB-672 — AC5: legitimate expressions accepted', () => {
  const valid = [
    'age > 30',
    "name = 'test'",
    'cost',
    'a.score >= 0.5 AND active = true',
    'depth < 3',
    'a.name IS NOT NULL',
    'r.weight > 0',
    'a.age BETWEEN 18 AND 65',
    "a.name LIKE '%test%'",
    'a.id IN (1, 2, 3)',
    'a.score + b.score > 10',
    "status != 'deleted'",
    'age > 0 OR age < 100',
    "type = 'A' AND category = 'B'",
  ];

  for (const [name, build] of whereBuilders) {
    for (const fragment of valid) {
      it(`${name} accepts: "${fragment}"`, () => {
        const q = build(fragment);
        expect(q.text).toContain(`WHERE ${fragment}`);
      });
    }
  }

  it('buildShortestMatch accepts valid weight "r.cost"', () => {
    const q = shortestWeight('r.cost');
    expect(q.text).toContain('WEIGHT r.cost');
  });

  it('buildShortestMatch accepts valid weight "r.distance + 1"', () => {
    const q = shortestWeight('r.distance + 1');
    expect(q.text).toContain('WEIGHT r.distance + 1');
  });
});

// ===================================================================
// 6. ACCEPTANCE CRITERIA: All four builders protected
// ===================================================================

describe('QA GDB-672 — AC6: all four builders protected', () => {
  const injection = '1=1; DROP TABLE x';

  it('buildTraverse rejects injection in where', () => {
    expect(() => traverseW(injection)).toThrow(TypeError);
  });

  it('buildNearest rejects injection in where', () => {
    expect(() => nearestW(injection)).toThrow(TypeError);
  });

  it('buildMatch rejects injection in where', () => {
    expect(() => matchW(injection)).toThrow(TypeError);
  });

  it('buildShortestMatch rejects injection in where', () => {
    expect(() => shortestW(injection)).toThrow(TypeError);
  });

  it('buildShortestMatch rejects injection in weight', () => {
    expect(() => shortestWeight(injection)).toThrow(TypeError);
  });
});

// ===================================================================
// 7. ACCEPTANCE CRITERIA: weight in buildShortestMatch specifically
// ===================================================================

describe('QA GDB-672 — AC7: buildShortestMatch weight validation', () => {
  it('rejects semicolon in weight', () => {
    expect(() => shortestWeight('1; DROP TABLE x')).toThrow(/semicolons/);
  });

  it('rejects line comment in weight', () => {
    expect(() => shortestWeight('cost -- ignore')).toThrow(/comment/i);
  });

  it('rejects block comment in weight', () => {
    expect(() => shortestWeight('cost /* block */')).toThrow(/comment/i);
  });

  it('rejects subquery in weight', () => {
    expect(() => shortestWeight('(SELECT 1)')).toThrow(/subquer/i);
  });

  it('rejects length bomb in weight', () => {
    expect(() => shortestWeight('x'.repeat(2049))).toThrow(RangeError);
  });

  it('accepts simple column name as weight', () => {
    const q = shortestWeight('cost');
    expect(q.text).toContain('WEIGHT cost');
  });

  it('accepts arithmetic expression as weight', () => {
    const q = shortestWeight('r.distance * 2 + 1');
    expect(q.text).toContain('WEIGHT r.distance * 2 + 1');
  });
});

// ===================================================================
// 8. Edge cases: empty string, whitespace only, null/undefined
// ===================================================================

describe('QA GDB-672 — AC8: empty/whitespace/null/undefined edge cases', () => {
  for (const [name, build] of whereBuilders) {
    it(`${name} skips empty string where (falsy, no WHERE clause)`, () => {
      const q = build('');
      expect(q.text).not.toContain('WHERE');
    });

    it(`${name} rejects whitespace-only where`, () => {
      expect(() => build('   ')).toThrow(TypeError);
    });

    it(`${name} rejects tab-only where`, () => {
      expect(() => build('\t\t')).toThrow(TypeError);
    });

    it(`${name} rejects newline-only where`, () => {
      expect(() => build('\n\n')).toThrow(TypeError);
    });

    it(`${name} skips null where (falsy)`, () => {
      const q = build(null);
      expect(q.text).not.toContain('WHERE');
    });

    it(`${name} skips undefined where (falsy)`, () => {
      const q = build(undefined);
      expect(q.text).not.toContain('WHERE');
    });
  }

  it('buildShortestMatch skips empty weight', () => {
    const q = shortestWeight('');
    expect(q.text).not.toContain('WEIGHT');
  });

  it('buildShortestMatch rejects whitespace-only weight', () => {
    expect(() => shortestWeight('   ')).toThrow(TypeError);
  });

  it('buildShortestMatch skips null weight', () => {
    const q = shortestWeight(null);
    expect(q.text).not.toContain('WEIGHT');
  });

  it('buildShortestMatch skips undefined weight', () => {
    const q = shortestWeight(undefined);
    expect(q.text).not.toContain('WEIGHT');
  });
});

// ===================================================================
// 9. Type coercion: non-string truthy values
// ===================================================================

describe('QA GDB-672 — AC9: non-string types rejected', () => {
  const nonStrings: Array<[string, unknown]> = [
    ['number 42', 42],
    ['boolean true', true],
    ['object with toString', { toString: () => 'age > 1' }],
    ['array', ['age > 1']],
    ['number 0 (falsy)', 0],
  ];

  for (const [name, build] of whereBuilders) {
    for (const [label, val] of nonStrings) {
      if (val === 0 || val === false) {
        it(`${name} skips falsy ${label} (no WHERE)`, () => {
          const q = build(val);
          expect(q.text).not.toContain('WHERE');
        });
      } else {
        it(`${name} rejects ${label} as where`, () => {
          expect(() => build(val)).toThrow(TypeError);
        });
      }
    }
  }
});

// ===================================================================
// 10. ADVERSARIAL: UNION injection bypass attempt
// ===================================================================

describe('QA GDB-672 — ADVERSARIAL: UNION injection bypass', () => {
  // UNION does not contain semicolons, comments, or parenthesized SELECT.
  // The deny-list approach does NOT block it. This is a potential bypass.
  const unionPayloads = [
    'age > 5 UNION SELECT * FROM secrets',
    'age > 5 UNION ALL SELECT password FROM users',
    'age > 5 union select 1',
  ];

  for (const [name, build] of whereBuilders) {
    for (const payload of unionPayloads) {
      it(`${name} — UNION bypass: "${payload.slice(0, 50)}" (BUG: passes validation)`, () => {
        // BUG: UNION injection is NOT blocked by the current deny-list.
        // The fragment passes all deny patterns since there are no semicolons,
        // no comments, and no parenthesized SELECT.
        const q = build(payload);
        expect(q.text).toContain(`WHERE ${payload}`);
      });
    }
  }

  it('buildShortestMatch weight — UNION bypass (BUG: passes validation)', () => {
    const payload = 'cost UNION SELECT 1';
    const q = shortestWeight(payload);
    expect(q.text).toContain(`WEIGHT ${payload}`);
  });
});

// ===================================================================
// 11. ADVERSARIAL: Unicode homoglyph bypass attempts
// ===================================================================

describe('QA GDB-672 — ADVERSARIAL: Unicode tricks', () => {
  // Unicode full-width semicolon U+FF1B
  it('full-width semicolon is not caught by ASCII ; pattern', () => {
    const payload = 'age > 5； DROP TABLE users';
    // The regex /;/ only matches ASCII semicolon.
    // Full-width semicolon passes through. Whether this is exploitable
    // depends on the database parser.
    const q = traverseW(payload);
    expect(q.text).toContain('WHERE');
  });

  // Unicode em-dash (U+2014) is NOT two hyphens, so -- pattern won't match
  it('em-dash is not caught by -- pattern', () => {
    const payload = 'age > 5 —— comment';
    const q = traverseW(payload);
    expect(q.text).toContain('WHERE');
  });

  // NULL byte injection
  it('null byte in string does not bypass validation', () => {
    const payload = 'age > 5\x00; DROP TABLE x';
    // The semicolon is still present, so it should still be caught
    expect(() => traverseW(payload)).toThrow(/semicolons/);
  });
});

// ===================================================================
// 12. ADVERSARIAL: Encoding tricks and whitespace in subquery pattern
// ===================================================================

describe('QA GDB-672 — ADVERSARIAL: subquery pattern bypass attempts', () => {
  // Tab between ( and SELECT
  it('rejects tab between paren and SELECT', () => {
    expect(() => traverseW('id IN (\tSELECT 1)')).toThrow(/subquer/i);
  });

  // Newline between ( and SELECT
  it('rejects newline between paren and SELECT', () => {
    expect(() => traverseW('id IN (\nSELECT 1)')).toThrow(/subquer/i);
  });

  // Multiple whitespace types
  it('rejects mixed whitespace between paren and SELECT', () => {
    expect(() => traverseW('id IN ( \t\n SELECT 1)')).toThrow(/subquer/i);
  });

  // Bare SELECT without parens — NOT caught by the subquery pattern
  it('bare SELECT without parens passes validation (BUG: not blocked)', () => {
    const payload = 'age > 5 UNION SELECT 1';
    const q = traverseW(payload);
    expect(q.text).toContain(`WHERE ${payload}`);
  });

  // Mixed case sElEcT in parens
  it('rejects mixed-case SELECT in subquery', () => {
    expect(() => traverseW('id IN (sElEcT 1)')).toThrow(/subquer/i);
  });
});

// ===================================================================
// 13. ADVERSARIAL: nested parentheses
// ===================================================================

describe('QA GDB-672 — ADVERSARIAL: nested parentheses', () => {
  // Legitimate nested parens (no SELECT)
  it('allows legitimate nested parens without SELECT', () => {
    const q = traverseW('(age > 5 AND (status = 1 OR status = 2))');
    expect(q.text).toContain('WHERE');
  });

  // Deeply nested SELECT
  it('rejects deeply nested subquery', () => {
    expect(() => traverseW('((( SELECT 1 )))')).toThrow(/subquer/i);
  });
});

// ===================================================================
// 14. ADVERSARIAL: buildMatch legacy syntax path
// ===================================================================

describe('QA GDB-672 — buildMatch legacy syntax validates where', () => {
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

  it('rejects subquery in legacy syntax', () => {
    expect(() =>
      buildMatch(
        [{ alias: 'a', table: 'users' }],
        { returnItems: ['a.id'], where: 'id IN (SELECT 1)', legacySyntax: true },
      ),
    ).toThrow(/subquer/i);
  });
});

// ===================================================================
// 15. ADVERSARIAL: combined vectors
// ===================================================================

describe('QA GDB-672 — ADVERSARIAL: combined injection vectors', () => {
  const combined = [
    '1=1; DROP TABLE users; -- comment',
    'x = (SELECT 1); --',
    '1=1 /* block */ ; DROP TABLE x',
    '; /* comment */ (SELECT 1)',
  ];

  for (const [name, build] of whereBuilders) {
    for (const payload of combined) {
      it(`${name} rejects combined: "${payload.slice(0, 40)}"`, () => {
        expect(() => build(payload)).toThrow(TypeError);
      });
    }
  }
});

// ===================================================================
// 16. ADVERSARIAL: INSERT/UPDATE/DELETE/DROP without semicolons
// ===================================================================

describe('QA GDB-672 — ADVERSARIAL: DML/DDL keywords without semicolons', () => {
  // These payloads avoid semicolons, comments, and subqueries.
  // They abuse the fact that the deny-list does not block standalone
  // SQL keywords like DROP, INSERT, UPDATE, DELETE.
  const ddlPayloads: Array<[string, string]> = [
    ['DROP TABLE users', 'DROP TABLE'],
    ['DELETE FROM users WHERE 1=1', 'DELETE FROM'],
    ['UPDATE users SET admin = true', 'UPDATE ... SET'],
    ['INSERT INTO log VALUES (1)', 'INSERT INTO'],
    ['TRUNCATE TABLE users', 'TRUNCATE'],
    ['ALTER TABLE users ADD col INT', 'ALTER TABLE'],
    ['CREATE TABLE evil (id INT)', 'CREATE TABLE'],
  ];

  for (const [name, build] of whereBuilders) {
    for (const [payload, label] of ddlPayloads) {
      it(`${name} — DML/DDL keyword "${label}" passes validation (BUG: not blocked)`, () => {
        // BUG: These dangerous SQL statements pass through validation
        // because they contain no semicolons, comments, or subqueries.
        const q = build(payload);
        expect(q.text).toContain(`WHERE ${payload}`);
      });
    }
  }
});

// ===================================================================
// 17. ADVERSARIAL: EXEC / xp_cmdshell style payloads
// ===================================================================

describe('QA GDB-672 — ADVERSARIAL: EXEC-style payloads', () => {
  // These would be dangerous on SQL Server but likely not on PostgreSQL.
  // Testing to document behavior.
  it('EXEC payload passes validation (no deny pattern matches)', () => {
    const payload = "EXEC xp_cmdshell 'whoami'";
    // No semicolons, no SQL comments, no parens+SELECT
    const q = traverseW(payload);
    expect(q.text).toContain(`WHERE ${payload}`);
  });
});

// ===================================================================
// 18. Verify error message quality
// ===================================================================

describe('QA GDB-672 — error message quality', () => {
  it('semicolon error includes param name "where"', () => {
    expect(() => traverseW('x; y')).toThrow(/where.*semicolons/);
  });

  it('semicolon error includes param name "weight"', () => {
    expect(() => shortestWeight('x; y')).toThrow(/weight.*semicolons/);
  });

  it('length error includes actual length', () => {
    const long = 'x'.repeat(2049);
    expect(() => traverseW(long)).toThrow(/2049/);
  });

  it('length error is RangeError, not TypeError', () => {
    expect(() => traverseW('x'.repeat(2049))).toThrow(RangeError);
  });

  it('non-string error is TypeError', () => {
    expect(() => traverseW(42)).toThrow(TypeError);
  });
});

// ===================================================================
// 19. Verify the fix does NOT break the query structure
// ===================================================================

describe('QA GDB-672 — query structure preserved after validation', () => {
  it('buildTraverse WHERE appears in correct position', () => {
    const q = traverseW('age > 30');
    expect(q.text).toMatch(/MODE NODES WHERE age > 30$/);
  });

  it('buildNearest WHERE appears before USING', () => {
    const q = buildNearest('docs', 'embedding', [0.1], {
      where: 'active = true',
      metric: 'L2',
    });
    expect(q.text).toMatch(/WHERE active = true.*USING L2/);
  });

  it('buildMatch modern syntax preserves WHERE position', () => {
    const q = buildMatch(
      [{ alias: 'a', table: 'users' }],
      { returnItems: ['a.id'], where: 'a.age > 21' },
    );
    expect(q.text).toMatch(/FROM MATCH.*WHERE a\.age > 21$/);
  });

  it('buildShortestMatch preserves WEIGHT before WHERE', () => {
    const q = buildShortestMatch(
      [
        { alias: 'a', table: 'users' },
        { alias: 'r', edgeType: 'knows', direction: 'OUT' },
        { alias: 'b', table: 'users' },
      ],
      ['a.id'],
      'ANY',
      { weight: 'r.cost', where: 'r.active = true' },
    );
    expect(q.text).toMatch(/WEIGHT r\.cost WHERE r\.active = true$/);
  });
});
