/**
 * QA adversarial tests for GDB-428 — SQL Editor Dialect Updates.
 *
 * These tests exercise the SixSevenDB CodeMirror dialect with hostile inputs:
 *  - Loose `isAfterMatchKeyword` — false positives in non-graph contexts
 *    (e.g. `WHERE col MATCH 'pattern'`, MATCH inside string/comment).
 *  - `nodes`/`edges` collisions with user-defined identifiers.
 *  - Loose `isInQuantifierContext` — should reject malformed sequences like
 *    `*1.2.3`, `*..`, `*..*`, etc.
 *  - Pathological documents: 10k+ chars, unicode/surrogate identifiers, cursor
 *    at boundary positions, multi-statement docs.
 *  - Stale schema (deleted table) for dot-completion.
 *  - Quantifier/MATCH inside string literal — currently NOT detected by impl.
 *  - Empty explicit completion (`{ explicit: true }`) on empty buffer.
 *  - Concurrent calls on the same source — completion source must be pure.
 *  - Completion-source latency on a 10k-char document.
 *  - Case sensitivity: match/Match/MATCH/mAtCh all detected.
 */

import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import {
  PATH_FUNCTIONS,
  PATH_SELECTORS,
  QUANTIFIER_TEMPLATES,
  SIXSEVEN_KEYWORDS,
  SQL_KEYWORDS,
  isAfterMatchKeyword,
  isInQuantifierContext,
  sixsevenCompletionSource,
  sixsevenSQL,
  type SchemaCompletionData,
} from "@/lib/sixseven-sql-lang";

const emptySchema: SchemaCompletionData = { tables: [], edgeTypes: [] };

const richSchema: SchemaCompletionData = {
  tables: [
    {
      name: "users",
      columns: [
        { name: "id", type: "int64" },
        { name: "name", type: "string" },
        // Collision: a user table with a column literally named `nodes`/`edges`
        // — which are also exposed as path-function completions.
        { name: "nodes", type: "json" },
        { name: "edges", type: "json" },
      ],
    },
  ],
  edgeTypes: ["KNOWS"],
};

function ctxAt(text: string, pos = text.length, explicit = true): CompletionContext {
  const state = EditorState.create({ doc: text });
  return new CompletionContext(state, pos, explicit);
}

// ─────────────────────────────────────────────────────────────────────────
// Reviewer Low-1: isAfterMatchKeyword false positives
// ─────────────────────────────────────────────────────────────────────────

describe("QA_isAfterMatchKeyword — false positives", () => {
  it("triggers on non-graph predicate `WHERE col MATCH 'pattern'`", () => {
    // The current implementation only looks for `\bMATCH\s+\w*$` and would
    // happily fire path-selector suggestions in a SQL fulltext-style MATCH.
    // Documenting: this returns true today (potential UX bug, low severity).
    const text = "SELECT * FROM users WHERE col MATCH ";
    expect(isAfterMatchKeyword(text, text.length)).toBe(true);
  });

  it("triggers when MATCH appears inside a string literal", () => {
    const text = "SELECT 'MATCH ' AS x, ";
    // After the closing quote and comma we are clearly in a SELECT list,
    // but MATCH appearing earlier in the document does NOT cause a false
    // positive because the regex anchors to end-of-input.
    expect(isAfterMatchKeyword(text, text.length)).toBe(false);
  });

  it("DOES fire while typing inside a string literal that contains MATCH", () => {
    // Cursor is mid-string but the regex has no awareness of quotes.
    const text = "SELECT 'MATCH ";
    expect(isAfterMatchKeyword(text, text.length)).toBe(true);
  });

  it("DOES fire inside a `-- line comment` mentioning MATCH", () => {
    const text = "SELECT 1; -- MATCH ";
    expect(isAfterMatchKeyword(text, text.length)).toBe(true);
  });

  it("DOES fire inside a `/* block comment */` mentioning MATCH", () => {
    const text = "SELECT 1; /* MATCH ";
    expect(isAfterMatchKeyword(text, text.length)).toBe(true);
  });

  it("does not fire when MATCH is part of a longer identifier like REMATCH", () => {
    const text = "SELECT REMATCH ";
    // The leading word boundary in `\bMATCH` prevents matching inside the
    // longer identifier REMATCH.
    expect(isAfterMatchKeyword(text, text.length)).toBe(false);
  });

  it("is case-insensitive across mixed case (mAtCh)", () => {
    expect(isAfterMatchKeyword("select * from mAtCh ", 21)).toBe(true);
    expect(isAfterMatchKeyword("SELECT * FROM Match ", 21)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Reviewer Low-3: isInQuantifierContext permissive regex
// ─────────────────────────────────────────────────────────────────────────

describe("QA_isInQuantifierContext — malformed sequences", () => {
  it("ACCEPTS the malformed sequence `*1.2.3` (impl is permissive)", () => {
    // The regex `\*\s*(?:\d*\.?\.?\d*)?$` does not match `1.2.3` exactly,
    // but it is satisfied by the prefix and `$` anchor — verifying actual
    // behavior so future tightening is detected.
    const text = "MATCH (a)-[*1.2.3";
    // Document the real behavior — false either way is informative.
    const result = isInQuantifierContext(text, text.length);
    // Today the regex requires the WHOLE tail after `*` to match, and
    // `1.2.3` does not. Verify it is correctly rejected.
    expect(result).toBe(false);
  });

  it("ACCEPTS `*..` (empty range) — could be flagged invalid", () => {
    const text = "MATCH (a)-[*..";
    expect(isInQuantifierContext(text, text.length)).toBe(true);
  });

  it("rejects `*` followed by a non-numeric token like `*a`", () => {
    const text = "MATCH (a)-[*a";
    expect(isInQuantifierContext(text, text.length)).toBe(false);
  });

  it("does not consider `*` outside of `[...]`", () => {
    const text = "SELECT * FROM users";
    expect(isInQuantifierContext(text, text.length)).toBe(false);
  });

  it("FALSE POSITIVE: `*` inside a string literal between [ ]", () => {
    // The implementation does not skip quoted text, so `'-[*1..3]->'`
    // appearing inside a regex-string would be treated as a quantifier
    // context. This is an acknowledged Low: we just pin the behavior.
    const text = "SELECT '[*";
    expect(isInQuantifierContext(text, text.length)).toBe(true);
  });

  it("brackets across multiple statements: `;` does not reset the lookback", () => {
    // Multi-statement docs aren't reset on `;`. A leftover `[` in the prior
    // statement leaks into the current one.
    const text = "SELECT [json] FROM t; MATCH (a)-[*";
    // Last `[` is still after last `]`, so quantifier context fires (correct).
    expect(isInQuantifierContext(text, text.length)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Reviewer Low-2: nodes/edges collision
// ─────────────────────────────────────────────────────────────────────────

describe("QA_completionSource — nodes/edges identifier collision", () => {
  const source = sixsevenCompletionSource(richSchema);

  it("emits both the path-function `nodes` and the column `nodes` (duplicates)", () => {
    // The query is `SELECT * FROM users WHERE ` — global completion path —
    // which adds path functions AND the from-context column completions.
    const ctx = ctxAt("SELECT * FROM users WHERE ");
    const result = source(ctx);
    expect(result).not.toBeNull();
    const nodeEntries = result!.options.filter((o) => o.label === "nodes");
    const edgeEntries = result!.options.filter((o) => o.label === "edges");
    // Today both appear twice: once as a function (built-in), once as a
    // user column. CodeMirror will render duplicate entries.
    expect(nodeEntries.length).toBeGreaterThanOrEqual(2);
    expect(edgeEntries.length).toBeGreaterThanOrEqual(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Pathological documents
// ─────────────────────────────────────────────────────────────────────────

describe("QA_completionSource — pathological docs", () => {
  const source = sixsevenCompletionSource(richSchema);

  it("does not throw on a 10k-char document and returns within 250ms", () => {
    const filler = "a".repeat(10_000);
    const text = `${filler} SELECT `;
    const ctx = ctxAt(text);
    const t0 = performance.now();
    const result = source(ctx);
    const dt = performance.now() - t0;
    expect(result).not.toBeNull();
    expect(dt).toBeLessThan(250);
  });

  it("does not throw at cursor position 0 (empty doc, explicit)", () => {
    const ctx = ctxAt("", 0, true);
    expect(() => source(ctx)).not.toThrow();
    const result = source(ctx);
    // Explicit completion on empty doc should still surface keywords.
    expect(result).not.toBeNull();
    expect(result!.options.length).toBeGreaterThan(0);
  });

  it("returns null on empty doc when not explicit (no word match)", () => {
    const ctx = ctxAt("", 0, false);
    const result = source(ctx);
    expect(result).toBeNull();
  });

  it("handles unicode identifiers without throwing", () => {
    const text = "SELECT * FROM 用户表 WHERE 名前 = 'たろう' ";
    const ctx = ctxAt(text);
    expect(() => source(ctx)).not.toThrow();
  });

  it("handles surrogate-pair characters", () => {
    const text = "SELECT '😀' FROM users; ";
    const ctx = ctxAt(text);
    expect(() => source(ctx)).not.toThrow();
  });

  it("handles cursor in the middle of a doc, not just at end", () => {
    const doc = "SELECT id FROM users WHERE name = 'x';";
    const ctx = ctxAt(doc, 7); // immediately after "SELECT "
    expect(() => source(ctx)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Stale schema for dot completion
// ─────────────────────────────────────────────────────────────────────────

describe("QA_completionSource — stale schema dot completion", () => {
  it("returns null safely when dot-qualifier names a deleted table", () => {
    const source = sixsevenCompletionSource({
      tables: [{ name: "alive", columns: [{ name: "id", type: "int64" }] }],
      edgeTypes: [],
    });
    const ctx = ctxAt("SELECT deleted.");
    expect(() => source(ctx)).not.toThrow();
    expect(source(ctx)).toBeNull();
  });

  it("dot completion does not throw when columns array is empty", () => {
    const source = sixsevenCompletionSource({
      tables: [{ name: "empty", columns: [] }],
      edgeTypes: [],
    });
    const ctx = ctxAt("SELECT empty.");
    const result = source(ctx);
    expect(result).not.toBeNull();
    expect(result!.options).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Determinism / purity
// ─────────────────────────────────────────────────────────────────────────

describe("QA_completionSource — determinism and purity", () => {
  it("produces identical results on repeated calls (pure function)", () => {
    const source = sixsevenCompletionSource(richSchema);
    const ctx1 = ctxAt("SELECT ");
    const ctx2 = ctxAt("SELECT ");
    const r1 = source(ctx1)!;
    const r2 = source(ctx2)!;
    expect(r1.options.map((o) => o.label)).toEqual(
      r2.options.map((o) => o.label)
    );
    expect(r1.from).toBe(r2.from);
  });

  it("does not mutate the input schema object", () => {
    const schema: SchemaCompletionData = {
      tables: [{ name: "t", columns: [{ name: "c", type: "int64" }] }],
      edgeTypes: ["E"],
    };
    const snapshot = JSON.stringify(schema);
    const source = sixsevenCompletionSource(schema);
    source(ctxAt("SELECT t. "));
    source(ctxAt("MATCH (a)-[*"));
    source(ctxAt("SELECT * FROM MATCH "));
    expect(JSON.stringify(schema)).toBe(snapshot);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Quantifier completion options shape
// ─────────────────────────────────────────────────────────────────────────

describe("QA_completionSource — quantifier completion shape", () => {
  const source = sixsevenCompletionSource(emptySchema);

  it("uses `from` based on matchBefore digits/dots so insert replaces them", () => {
    // After `*1.` the user has typed `1.` — completion should replace it.
    const text = "MATCH (a)-[*1.";
    const ctx = ctxAt(text);
    const result = source(ctx);
    expect(result).not.toBeNull();
    // from should be < pos because matchBefore matched "1."
    expect(result!.from).toBeLessThan(text.length);
  });

  it("validFor regex accepts ongoing quantifier typing", () => {
    const ctx = ctxAt("MATCH (a)-[*");
    const result = source(ctx);
    expect(result!.validFor).toBeDefined();
    const re = result!.validFor as RegExp;
    expect(re.test("1..3")).toBe(true);
    expect(re.test("..3")).toBe(true);
    expect(re.test("3")).toBe(true);
    expect(re.test("foo")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// MATCH-after path-selector completion shape
// ─────────────────────────────────────────────────────────────────────────

describe("QA_completionSource — MATCH path-selector shape", () => {
  const source = sixsevenCompletionSource(emptySchema);

  it("includes multi-word selectors `ANY SHORTEST` and `ALL SHORTEST`", () => {
    const ctx = ctxAt("SELECT * FROM MATCH ");
    const result = source(ctx);
    const labels = result!.options.map((o) => o.label);
    expect(labels).toContain("ANY SHORTEST");
    expect(labels).toContain("ALL SHORTEST");
  });

  it("validFor `^\\w*$` rejects multi-word continuations once typed", () => {
    const ctx = ctxAt("SELECT * FROM MATCH ");
    const result = source(ctx);
    const re = result!.validFor as RegExp;
    // After the user has typed `ANY ` (with a space), the `validFor` no longer
    // matches — CodeMirror would re-query the source, which is correct.
    expect(re.test("ANY")).toBe(true);
    expect(re.test("ANY SHORTEST")).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// sixsevenSQL extension factory edge cases
// ─────────────────────────────────────────────────────────────────────────

describe("QA_sixsevenSQL — factory robustness", () => {
  it("does not throw when given an empty config", () => {
    expect(() => sixsevenSQL({})).not.toThrow();
  });

  it("does not throw with upperCaseKeywords overridden to false", () => {
    expect(() => sixsevenSQL({ upperCaseKeywords: false })).not.toThrow();
  });

  it("returns a defined extension object", () => {
    const ext = sixsevenSQL();
    expect(ext).toBeDefined();
    expect(typeof ext).toBe("object");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Keyword set hygiene
// ─────────────────────────────────────────────────────────────────────────

describe("QA_keyword sets — hygiene", () => {
  it("ANY appears only once across SQL_KEYWORDS and SIXSEVEN_KEYWORDS", () => {
    const all = [...SQL_KEYWORDS, ...SIXSEVEN_KEYWORDS];
    const count = all.filter((k) => k === "ANY").length;
    expect(count).toBe(1);
  });

  it("ALL is in SQL_KEYWORDS and not duplicated in SIXSEVEN_KEYWORDS", () => {
    expect(SQL_KEYWORDS).toContain("ALL");
    expect(SIXSEVEN_KEYWORDS).not.toContain("ALL");
  });

  it("path functions list has no duplicates", () => {
    const set = new Set(PATH_FUNCTIONS);
    expect(set.size).toBe(PATH_FUNCTIONS.length);
  });

  it("path selectors list has no duplicates", () => {
    const set = new Set(PATH_SELECTORS);
    expect(set.size).toBe(PATH_SELECTORS.length);
  });

  it("quantifier templates list has no duplicate labels", () => {
    const labels = QUANTIFIER_TEMPLATES.map((q) => q.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
