/**
 * GDB-675: Tests for the dangerous-keyword extension to validateSqlFragment.
 *
 * Verifies that UNION, DML, and DDL keywords (UNION, SELECT, INSERT, UPDATE,
 * DELETE, DROP, TRUNCATE, ALTER, CREATE, GRANT, REVOKE, EXEC, EXECUTE) are
 * rejected as standalone SQL tokens in WHERE / WEIGHT fragments across all
 * four query builders, while column names that merely contain a keyword as a
 * substring (e.g. `user_union`, `create_date`) are still accepted.
 */
import { describe, it, expect } from 'vitest';
import {
  buildTraverse,
  buildNearest,
  buildMatch,
  buildShortestMatch,
} from '../src/query-builders';

// ---------------------------------------------------------------------------
// Builder helpers
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

// ---------------------------------------------------------------------------
// 1. UNION rejection (set-operator injection)
// ---------------------------------------------------------------------------

describe('GDB-675 — UNION keyword rejected in all builders', () => {
  const payloads = [
    'age > 5 UNION SELECT * FROM secrets',
    'age > 5 UNION ALL SELECT password FROM users',
    '1=1 UNION SELECT 1, 2, 3',
  ];

  for (const [name, build, param] of allBuilders) {
    for (const payload of payloads) {
      it(`${name} (${param}) rejects UNION: "${payload.slice(0, 40)}"`, () => {
        expect(() => build(payload)).toThrow(/disallowed SQL keywords/i);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// 2. DML/DDL keyword rejection (no semicolons, no comments, no subquery)
// ---------------------------------------------------------------------------

describe('GDB-675 — DML/DDL keywords rejected in all builders', () => {
  const payloads: Array<[string, string]> = [
    ['DROP TABLE users', 'DROP'],
    ['DELETE FROM users WHERE 1=1', 'DELETE'],
    ['UPDATE users SET admin = true', 'UPDATE'],
    ['INSERT INTO log VALUES (1)', 'INSERT'],
    ['TRUNCATE TABLE users', 'TRUNCATE'],
    ['ALTER TABLE users ADD col INT', 'ALTER'],
    ['CREATE TABLE evil (id INT)', 'CREATE'],
    ['GRANT ALL ON users TO public', 'GRANT'],
    ['REVOKE ALL ON users FROM public', 'REVOKE'],
    ["EXEC xp_cmdshell 'whoami'", 'EXEC'],
    ["EXECUTE sp_evil 'arg'", 'EXECUTE'],
  ];

  for (const [name, build, param] of allBuilders) {
    for (const [payload, keyword] of payloads) {
      it(`${name} (${param}) rejects ${keyword}: "${payload.slice(0, 40)}"`, () => {
        expect(() => build(payload)).toThrow(/disallowed SQL keywords/i);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// 3. Case-insensitivity
// ---------------------------------------------------------------------------

describe('GDB-675 — keyword matching is case-insensitive', () => {
  const variants = [
    'age > 5 UNION SELECT 1',
    'age > 5 union select 1',
    'age > 5 UnIoN sElEcT 1',
    'drop table users',
    'DrOp TaBle users',
    'delete from users',
  ];

  for (const variant of variants) {
    it(`rejects case variant: "${variant}"`, () => {
      expect(() => traverseW(variant)).toThrow(/disallowed SQL keywords/i);
    });
  }
});

// ---------------------------------------------------------------------------
// 4. Word-boundary correctness — substrings of column names are NOT rejected
// ---------------------------------------------------------------------------

describe('GDB-675 — column names containing keywords as substrings are accepted', () => {
  const valid = [
    // Column names that embed a keyword as a substring; word boundaries must
    // not match these.
    'user_union > 0',
    'union_member = true',
    'create_date > 0',
    'created_at IS NOT NULL',
    'updated_count > 5',
    'last_update > 0',
    'is_dropped = false',
    'deleted_at IS NULL',
    'inserted_by = 1',
    'truncated_text IS NOT NULL',
    'altered_count > 0',
    'execution_id > 0',
    'granted_role = 1',
    'select_count > 0',
  ];

  for (const [name, build] of whereBuilders) {
    for (const fragment of valid) {
      it(`${name} accepts column-name substring: "${fragment}"`, () => {
        const q = build(fragment);
        expect(q.text).toContain(`WHERE ${fragment}`);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// 5. Legitimate predicates still work (regression check)
// ---------------------------------------------------------------------------

describe('GDB-675 — legitimate predicates still accepted', () => {
  const valid = [
    'age > 30',
    "name = 'foo'",
    'a.score >= 0.5 AND active = true',
    'a.age BETWEEN 18 AND 65',
    "a.name LIKE '%test%'",
    'a.id IN (1, 2, 3)',
    "a.id IN ('a', 'b', 'c')",
    'a.score + b.score > 10',
    'depth < 3',
    'a.name IS NOT NULL',
    'r.weight > 0',
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

  it('buildShortestMatch accepts "r.cost" weight', () => {
    expect(shortestWeight('r.cost').text).toContain('WEIGHT r.cost');
  });

  it('buildShortestMatch accepts "r.distance + 1" weight', () => {
    expect(shortestWeight('r.distance + 1').text).toContain('WEIGHT r.distance + 1');
  });
});

// ---------------------------------------------------------------------------
// 6. Weight expression — keyword rejection coverage
// ---------------------------------------------------------------------------

describe('GDB-675 — buildShortestMatch weight rejects all dangerous keywords', () => {
  const payloads = [
    'cost UNION SELECT 1',
    'cost; DROP TABLE x',
    'DROP TABLE users',
    'DELETE FROM users',
    'UPDATE users SET x=1',
    'INSERT INTO log VALUES (1)',
    'TRUNCATE TABLE users',
    'ALTER TABLE users',
    'CREATE TABLE evil (id INT)',
    'GRANT ALL TO admin',
    'REVOKE ALL FROM admin',
    "EXEC sp_evil",
    "EXECUTE sp_evil",
  ];

  for (const payload of payloads) {
    it(`weight rejects: "${payload.slice(0, 40)}"`, () => {
      expect(() => shortestWeight(payload)).toThrow(TypeError);
    });
  }
});

// ---------------------------------------------------------------------------
// 7. Error message includes parameter name
// ---------------------------------------------------------------------------

describe('GDB-675 — error messages name the offending parameter', () => {
  it('UNION rejection in `where` mentions "where"', () => {
    expect(() => traverseW('age > 5 UNION SELECT 1')).toThrow(
      /where.*disallowed SQL keywords/i,
    );
  });

  it('DROP rejection in `weight` mentions "weight"', () => {
    expect(() => shortestWeight('DROP TABLE x')).toThrow(
      /weight.*disallowed SQL keywords/i,
    );
  });
});
