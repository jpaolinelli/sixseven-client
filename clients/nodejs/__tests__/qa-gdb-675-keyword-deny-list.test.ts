/**
 * QA adversarial tests for GDB-675.
 *
 * Verifies the dangerous-keyword extension to validateSqlFragment in
 * `clients/nodejs/src/query-builders.ts`. Focuses on bypass attempts the
 * developer may have missed: whitespace tricks, encoding tricks, unicode
 * lookalikes, word-boundary edge cases, false-positive risks (string
 * literals), other dangerous keywords NOT in the list, multi-keyword combos,
 * and length-boundary stuffing.
 *
 * Severity intent (per QA brief):
 *   - True bypasses (raw ASCII keywords slipping through, semicolon stacking
 *     not detected) → High/Critical, file Bug.
 *   - Unicode lookalikes / unlisted keywords like MERGE/CALL → Medium/Low,
 *     document gap, no Bug ticket.
 */
import { describe, it, expect } from 'vitest';
import {
  buildTraverse,
  buildNearest,
  buildMatch,
  buildShortestMatch,
} from '../src/query-builders';

// ---------------------------------------------------------------------------
// Builder adapters
// ---------------------------------------------------------------------------

const traverseW = (where: unknown) =>
  buildTraverse('follows', 'users', 1, { where: where as string });

const nearestW = (where: unknown) =>
  buildNearest('docs', 'embedding', [0.1, 0.2], { where: where as string });

const matchW = (where: unknown) =>
  buildMatch(
    [{ alias: 'a', table: 'users' }],
    { returnItems: ['a.id'], where: where as string },
  );

const shortestW = (where: unknown) =>
  buildShortestMatch(
    [
      { alias: 'a', table: 'users' },
      { alias: 'r', edgeType: 'knows', direction: 'OUT' },
      { alias: 'b', table: 'users' },
    ],
    ['a.id'],
    'ANY',
    { where: where as string },
  );

const shortestWeight = (weight: unknown) =>
  buildShortestMatch(
    [
      { alias: 'a', table: 'users' },
      { alias: 'r', edgeType: 'knows', direction: 'OUT' },
      { alias: 'b', table: 'users' },
    ],
    ['a.id'],
    'ANY',
    { weight: weight as string },
  );

type BuilderFn = (val: unknown) => { text: string; values: unknown[] };
const whereBuilders: ReadonlyArray<[string, BuilderFn]> = [
  ['buildTraverse', traverseW],
  ['buildNearest', nearestW],
  ['buildMatch', matchW],
  ['buildShortestMatch', shortestW],
];

// ---------------------------------------------------------------------------
// 1. Whitespace-variant tricks between keywords
// ---------------------------------------------------------------------------

describe('QA_GDB_675 — whitespace tricks between UNION and SELECT', () => {
  // Each individual keyword is rejected independently, so even if "UNION SELECT"
  // is broken up by tabs/newlines, each token still trips the deny-list.
  const payloads = [
    'a=1 UNION\tSELECT 1',
    'a=1 UNION\nSELECT 1',
    'a=1 UNION\rSELECT 1',
    'a=1 UNION SELECT 1', // non-breaking space
    'a=1 UNION   SELECT 1',
    'a=1\fUNION\fSELECT 1',
    'a=1\vUNION\vSELECT 1',
  ];

  for (const p of payloads) {
    it(`rejects whitespace-variant: ${JSON.stringify(p)}`, () => {
      expect(() => traverseW(p)).toThrow(/disallowed SQL keywords/i);
    });
  }
});

// ---------------------------------------------------------------------------
// 2. Encoding tricks — validator must NOT decode hex/url/unicode escapes
// ---------------------------------------------------------------------------

describe('QA_GDB_675 — hex/url-encoded keywords (raw text only)', () => {
  // Server may not decode these either, so they should be either harmless
  // *or* rejected (but the validator is text-level only — we just confirm
  // it does not crash and accepts them as opaque tokens).
  const payloads = [
    "a=1 AND name = '%55NION'", // %55 = 'U' if URL-decoded; literal as-is
    "a=1 AND name = '\\x55NION'", // hex escape as literal
    "a=1 AND name = 'U%4eION'",
  ];

  for (const p of payloads) {
    it(`encoded payload (treated as raw text): ${JSON.stringify(p)}`, () => {
      // These contain no raw UNION token, so validator must accept them.
      expect(() => traverseW(p)).not.toThrow();
    });
  }
});

// ---------------------------------------------------------------------------
// 3. Unicode lookalike characters — DOCUMENTED GAP
// ---------------------------------------------------------------------------

describe('QA_GDB_675 — unicode lookalikes (documented gap, NOT a Bug)', () => {
  // The deny-list regex matches ASCII keywords only. Full-width and Cyrillic
  // lookalikes are NOT recognized as keywords by the validator. They are also
  // unlikely to be parsed as SQL by the server (which uses ASCII keywords),
  // so the gap is informational only — Medium severity at most.
  it('full-width "ＵＮＩＯＮ" passes the deny-list', () => {
    const payload = 'a=1 ＵＮＩＯＮ ＳＥＬＥＣＴ 1';
    // We document — not enforce — that this passes today. If the server
    // unicode-folds keywords, this would become a real bypass. As of GDB-675
    // it does not, so we treat as a gap, not a bug.
    expect(() => traverseW(payload)).not.toThrow();
  });

  it('Cyrillic-lookalike "ՍNION" passes the deny-list', () => {
    // Armenian Ս (U+054D) + ASCII NION — visually similar to UNION.
    const payload = 'a=1 ՍNION SELECT 1';
    // SELECT is real ASCII so this still trips the deny-list on SELECT.
    expect(() => traverseW(payload)).toThrow(/disallowed SQL keywords/i);
  });

  it('pure non-ASCII U+0423 Cyrillic "У" + NION passes', () => {
    const payload = 'a=1 УNION SOMETHING';
    // No real ASCII keyword present — validator accepts. Server likely
    // rejects as syntax error. Gap is benign.
    expect(() => traverseW(payload)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 4. Word-boundary edge cases
// ---------------------------------------------------------------------------

describe('QA_GDB_675 — word-boundary edges', () => {
  it('UNION at very start of string is rejected', () => {
    expect(() => traverseW('UNION SELECT 1')).toThrow(/disallowed SQL keywords/i);
  });

  it('UNION at very end of string is rejected', () => {
    expect(() => traverseW('a=1 UNION')).toThrow(/disallowed SQL keywords/i);
  });

  it('UNION as the entire string is rejected', () => {
    expect(() => traverseW('UNION')).toThrow(/disallowed SQL keywords/i);
  });

  it('column_UNION (underscore-prefixed) is accepted (\\b does not match)', () => {
    const q = traverseW('column_UNION = 1');
    expect(q.text).toContain('WHERE column_UNION = 1');
  });

  it('UNION_column (underscore-suffixed) is accepted', () => {
    const q = traverseW('UNION_column = 1');
    expect(q.text).toContain('WHERE UNION_column = 1');
  });

  it('1UNION1 — surrounded by digits, \\b does NOT match (word-char to word-char)', () => {
    // \b only triggers at a word/non-word transition. Digits are word chars,
    // so "1UNION1" has no boundary between 1↔U or N↔1. The validator accepts
    // this — but the resulting SQL is also invalid syntax (a SQL parser would
    // reject `a=1UNION1` as a single bad identifier). Documented gap, Low.
    expect(() => traverseW('a=1UNION1')).not.toThrow();
  });

  it("UNION inside a quoted string literal is REJECTED — known false positive", () => {
    // Documented limitation: the validator does NOT understand SQL string
    // literals, so a legitimate `name = 'UNION'` predicate is blocked. This
    // is a false-positive trade-off, not a security bug. Severity Medium.
    expect(() => traverseW("name = 'UNION'")).toThrow(/disallowed SQL keywords/i);
  });

  it("CREATED string literal is REJECTED — known false positive", () => {
    // Similar to above — substring "CREATE" inside 'CREATED' would not
    // match (\b after E before D fails — D is a word char). But the literal
    // 'CREATE' WOULD be rejected. Confirm exact behavior:
    expect(() => traverseW("category = 'CREATED'")).not.toThrow(); // 'CREATE' inside CREATED is not a token
    expect(() => traverseW("category = 'CREATE'")).toThrow(/disallowed SQL keywords/i);
  });
});

// ---------------------------------------------------------------------------
// 5. Other dangerous SQL keywords NOT in the deny-list (DOCUMENTED GAP)
// ---------------------------------------------------------------------------

describe('QA_GDB_675 — dangerous keywords NOT in the deny-list (gap)', () => {
  // These keywords also have side-effects (some destructive) but are not
  // blocked by the GDB-675 list. Filing as Medium gap — not a regression of
  // the GDB-675 acceptance criteria, but worth following up.
  const unlisted = [
    'MERGE INTO target USING source ON 1=1 WHEN MATCHED THEN DELETE',
    'REPLACE INTO users VALUES (1)',
    "LOAD DATA INFILE '/etc/passwd'",
    'CALL admin_proc()',
    'DECLARE v INT',
    'COPY users TO STDOUT',
    'VACUUM FULL users',
    'ANALYZE users',
    'LOCK TABLE users',
    'RESET ALL',
    'SET search_path = pg_catalog',
    'BEGIN; DROP TABLE x; COMMIT', // semicolons trip the existing pattern, but BEGIN/COMMIT/ROLLBACK do not on their own
    'COMMIT',
    'ROLLBACK',
    'USE other_db',
    'SHOW TABLES',
    'EXPLAIN SELECT 1', // SELECT trips it but EXPLAIN alone wouldn't
    'DESCRIBE users',
  ];

  for (const p of unlisted) {
    it(`gap: "${p.slice(0, 50)}" — current behavior recorded`, () => {
      // We don't assert pass or fail here — we record current behavior so a
      // future change is visible. Some payloads also contain SELECT/DELETE/
      // DROP and will be caught indirectly. We just call and record.
      let threw: Error | null = null;
      try {
        traverseW(p);
      } catch (e) {
        threw = e as Error;
      }
      // Record but do not enforce — this is a "gap" test, not a regression.
      expect(threw === null || /disallowed/.test(threw.message)).toBe(true);
    });
  }

  it('MERGE alone is currently accepted (gap — Medium)', () => {
    expect(() => traverseW('MERGE INTO target USING src ON true')).not.toThrow();
  });

  it('CALL alone is currently accepted (gap — Medium)', () => {
    expect(() => traverseW('CALL evil_proc()')).not.toThrow();
  });

  it('SET alone is currently accepted (gap — Medium)', () => {
    expect(() => traverseW("SET search_path = 'public'")).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 6. Multi-keyword combinations
// ---------------------------------------------------------------------------

describe('QA_GDB_675 — multi-keyword combinations', () => {
  const payloads = [
    'DROP TABLE x; CREATE TABLE y(id INT)',
    'UPDATE users SET admin=true; DELETE FROM logs',
    'TRUNCATE x; ALTER TABLE y ADD c INT',
    'GRANT ALL TO public; REVOKE FROM admin',
    'EXEC a; EXECUTE b',
  ];

  for (const p of payloads) {
    it(`multi-keyword: ${JSON.stringify(p.slice(0, 50))}`, () => {
      expect(() => traverseW(p)).toThrow(/disallowed/i);
    });
  }
});

// ---------------------------------------------------------------------------
// 7. Length boundary — UNION at end of MAX_SQL_FRAGMENT_LENGTH (2048) input
// ---------------------------------------------------------------------------

describe('QA_GDB_675 — length boundary stuffing', () => {
  it('rejects 2048-char string with UNION at the end (length OK, keyword trips)', () => {
    // Pad to exactly 2048 chars with UNION at the tail.
    const tail = ' UNION SELECT 1';
    const padding = 'a'.repeat(2048 - tail.length);
    const payload = padding + tail;
    expect(payload.length).toBe(2048);
    expect(() => traverseW(payload)).toThrow(/disallowed SQL keywords/i);
  });

  it('2049-char string with UNION at end is rejected by length cap first', () => {
    const tail = ' UNION SELECT 1';
    const padding = 'a'.repeat(2049 - tail.length);
    const payload = padding + tail;
    expect(payload.length).toBe(2049);
    expect(() => traverseW(payload)).toThrow(RangeError);
  });
});

// ---------------------------------------------------------------------------
// 8. False-positive risk surface — predicates that LOOK risky but aren't
// ---------------------------------------------------------------------------

describe('QA_GDB_675 — false-positive surface (column/value names)', () => {
  // Column names with embedded keywords: `\b` does NOT trigger between
  // word-chars (letter+letter/digit/underscore), so `created_at`, `user_id`
  // etc. should pass.
  const benignColumns = [
    'created_at IS NOT NULL',
    'updated_at IS NOT NULL',
    'deleted_at IS NULL',
    'selected_id = 1',
    'inserted_by = 1',
    'truncate_count > 0',
    'altered_at IS NOT NULL',
    'creation_ts > 0',
    'execution_id IS NOT NULL',
    'dropped_count = 0',
    'merged_at IS NOT NULL',
  ];

  for (const [name, build] of whereBuilders) {
    for (const col of benignColumns) {
      it(`${name} accepts benign column: "${col}"`, () => {
        const q = build(col);
        expect(q.text).toContain(`WHERE ${col}`);
      });
    }
  }

  it('id IN (1,2,3) is accepted (no parenthesized SELECT, no keywords)', () => {
    const q = traverseW('id IN (1, 2, 3)');
    expect(q.text).toContain('WHERE id IN (1, 2, 3)');
  });

  it("LIKE 'select%' is REJECTED — known false positive (string literal)", () => {
    // The validator cannot distinguish keyword tokens from text inside
    // string literals. This is documented Medium-severity false positive.
    expect(() => traverseW("name LIKE 'select%'")).toThrow(/disallowed SQL keywords/i);
  });
});

// ---------------------------------------------------------------------------
// 9. Cross-builder consistency — every builder rejects every keyword
// ---------------------------------------------------------------------------

describe('QA_GDB_675 — every builder rejects every dangerous keyword', () => {
  const keywords = [
    'UNION', 'SELECT', 'INSERT', 'UPDATE', 'DELETE',
    'DROP', 'TRUNCATE', 'ALTER', 'CREATE', 'GRANT',
    'REVOKE', 'EXEC', 'EXECUTE',
  ];

  for (const [name, build] of whereBuilders) {
    for (const kw of keywords) {
      it(`${name} rejects bare keyword "${kw}"`, () => {
        expect(() => build(`a=1 ${kw} foo`)).toThrow(/disallowed SQL keywords/i);
      });
    }
  }

  for (const kw of keywords) {
    it(`buildShortestMatch.weight rejects bare keyword "${kw}"`, () => {
      expect(() => shortestWeight(`a ${kw} b`)).toThrow(/disallowed SQL keywords/i);
    });
  }
});

// ---------------------------------------------------------------------------
// 10. Mixed-case + boundary combinations (final stress)
// ---------------------------------------------------------------------------

describe('QA_GDB_675 — mixed case + adjacent punctuation', () => {
  const payloads = [
    'a=1)UnIoN(SeLeCt 1',
    'a=1,union,select,1',
    "a=1'UNION'SELECT'1",
    'a=1+UNION+SELECT+1',
    'a=1|UNION|SELECT|1',
  ];

  for (const p of payloads) {
    it(`rejects mixed-case + punctuation: ${JSON.stringify(p)}`, () => {
      expect(() => traverseW(p)).toThrow(/disallowed/i);
    });
  }
});
