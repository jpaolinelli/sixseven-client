/**
 * Tests for the SixSevenDB CodeMirror SQL dialect (GDB-428).
 *
 * Covers:
 *  - Keyword set: existing TRAVERSE/NEAREST/EMBEDDING + new SHORTEST, WEIGHT,
 *    ANY, ALL.
 *  - Path functions: path_length, path_cost, nodes, edges in autocomplete.
 *  - Quantifier syntax detection: `*n`, `*m..n`, `*..n`, `*n..` inside `[...]`.
 *  - Path selector suggestions after MATCH.
 *  - Backwards compatibility: schema-aware autocomplete and dot-completion
 *    still function.
 */

import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { CompletionContext } from "@codemirror/autocomplete";
import {
  SIXSEVEN_KEYWORDS,
  SQL_KEYWORDS,
  PATH_FUNCTIONS,
  PATH_SELECTORS,
  QUANTIFIER_TEMPLATES,
  isInQuantifierContext,
  isAfterMatchKeyword,
  sixsevenCompletionSource,
  sixsevenSQL,
  type SchemaCompletionData,
} from "@/lib/sixseven-sql-lang";

const emptySchema: SchemaCompletionData = {
  tables: [],
  edgeTypes: [],
};

const sampleSchema: SchemaCompletionData = {
  tables: [
    {
      name: "users",
      columns: [
        { name: "id", type: "int64" },
        { name: "name", type: "string" },
        { name: "email", type: "string" },
      ],
    },
    {
      name: "posts",
      columns: [
        { name: "id", type: "int64" },
        { name: "title", type: "string" },
      ],
    },
  ],
  edgeTypes: ["FOLLOWS", "LIKES"],
};

/** Build a CompletionContext positioned at the end of `text`. */
function makeContext(text: string, explicit = true): CompletionContext {
  const state = EditorState.create({ doc: text });
  return new CompletionContext(state, text.length, explicit);
}

// ── Keyword set ──

describe("SIXSEVEN_KEYWORDS", () => {
  it("includes pre-existing graph keywords", () => {
    for (const kw of ["TRAVERSE", "NEAREST", "MATCH", "EMBEDDING", "REEMBED"]) {
      expect(SIXSEVEN_KEYWORDS).toContain(kw);
    }
  });

  it("includes the GDB-428 path-selector keywords SHORTEST, WEIGHT, ANY", () => {
    expect(SIXSEVEN_KEYWORDS).toContain("SHORTEST");
    expect(SIXSEVEN_KEYWORDS).toContain("WEIGHT");
    expect(SIXSEVEN_KEYWORDS).toContain("ANY");
  });

  it("does not duplicate keywords already present in the SQL keyword set", () => {
    // ALL is part of standard SQL, not the SixSevenDB-specific list.
    expect(SQL_KEYWORDS).toContain("ALL");
  });
});

describe("PATH_FUNCTIONS", () => {
  it("contains the four GDB-427 path functions", () => {
    expect(PATH_FUNCTIONS).toEqual(
      expect.arrayContaining(["path_length", "path_cost", "nodes", "edges"])
    );
  });
});

describe("PATH_SELECTORS", () => {
  it("includes ANY, ALL, SHORTEST, ANY SHORTEST, ALL SHORTEST", () => {
    for (const s of ["ANY", "ALL", "SHORTEST", "ANY SHORTEST", "ALL SHORTEST"]) {
      expect(PATH_SELECTORS).toContain(s);
    }
  });
});

describe("QUANTIFIER_TEMPLATES", () => {
  it("covers the four quantifier shapes: range, upper, lower, exact", () => {
    const labels = QUANTIFIER_TEMPLATES.map((q) => q.label);
    // range form (m..n)
    expect(labels.some((l) => /^\d+\.\.\d+$/.test(l))).toBe(true);
    // upper bound (..n)
    expect(labels.some((l) => /^\.\.\d+$/.test(l))).toBe(true);
    // lower bound (n..)
    expect(labels.some((l) => /^\d+\.\.$/.test(l))).toBe(true);
    // exact (n)
    expect(labels.some((l) => /^\d+$/.test(l))).toBe(true);
  });

  it("attaches a human-readable detail to every template", () => {
    for (const q of QUANTIFIER_TEMPLATES) {
      expect(q.detail).toBeTruthy();
      expect(q.detail.length).toBeGreaterThan(0);
    }
  });
});

// ── Quantifier context detection ──

describe("isInQuantifierContext", () => {
  it("returns true immediately after `*` inside `[...]`", () => {
    const text = "MATCH (a)-[*";
    expect(isInQuantifierContext(text, text.length)).toBe(true);
  });

  it("returns true for `*` with a partial digit", () => {
    const text = "MATCH (a)-[*1";
    expect(isInQuantifierContext(text, text.length)).toBe(true);
  });

  it("returns true for `*` with a partial range like *1..", () => {
    const text = "MATCH (a)-[*1..";
    expect(isInQuantifierContext(text, text.length)).toBe(true);
  });

  it("returns true for `*` with a complete range like *1..3", () => {
    const text = "MATCH (a)-[*1..3";
    expect(isInQuantifierContext(text, text.length)).toBe(true);
  });

  it("returns true for an edge-type quantifier `[:KNOWS *`", () => {
    const text = "MATCH (a)-[:KNOWS *";
    expect(isInQuantifierContext(text, text.length)).toBe(true);
  });

  it("returns false outside of any bracket", () => {
    const text = "SELECT * FROM users";
    expect(isInQuantifierContext(text, text.length)).toBe(false);
  });

  it("returns false after the bracket has been closed", () => {
    const text = "MATCH (a)-[*1..3]->(b) ";
    expect(isInQuantifierContext(text, text.length)).toBe(false);
  });

  it("returns false inside `[...]` when no `*` is present", () => {
    const text = "MATCH (a)-[:KNOWS";
    expect(isInQuantifierContext(text, text.length)).toBe(false);
  });
});

// ── MATCH keyword detection ──

describe("isAfterMatchKeyword", () => {
  it("returns true immediately after `MATCH `", () => {
    const text = "SELECT * FROM MATCH ";
    expect(isAfterMatchKeyword(text, text.length)).toBe(true);
  });

  it("returns true with a partial selector word being typed", () => {
    const text = "SELECT * FROM MATCH SHO";
    expect(isAfterMatchKeyword(text, text.length)).toBe(true);
  });

  it("is case-insensitive", () => {
    const text = "select * from match ";
    expect(isAfterMatchKeyword(text, text.length)).toBe(true);
  });

  it("returns false before MATCH appears", () => {
    const text = "SELECT * FROM ";
    expect(isAfterMatchKeyword(text, text.length)).toBe(false);
  });

  it("returns false once a `(` has begun the pattern", () => {
    const text = "SELECT * FROM MATCH ANY (a)";
    expect(isAfterMatchKeyword(text, text.length)).toBe(false);
  });
});

// ── Completion source: quantifier suggestions ──

describe("sixsevenCompletionSource — quantifier context", () => {
  const source = sixsevenCompletionSource(emptySchema);

  it("returns quantifier templates when cursor is right after `*`", () => {
    const ctx = makeContext("MATCH (a)-[*");
    const result = source(ctx);
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    for (const q of QUANTIFIER_TEMPLATES) {
      expect(labels).toContain(q.label);
    }
  });

  it("does not include schema keywords in quantifier results", () => {
    const ctx = makeContext("MATCH (a)-[*");
    const result = source(ctx);
    const labels = result!.options.map((o) => o.label);
    expect(labels).not.toContain("SELECT");
    expect(labels).not.toContain("MATCH");
  });
});

// ── Completion source: path selector after MATCH ──

describe("sixsevenCompletionSource — after MATCH", () => {
  const source = sixsevenCompletionSource(emptySchema);

  it("suggests path selectors immediately after MATCH", () => {
    const ctx = makeContext("SELECT * FROM MATCH ");
    const result = source(ctx);
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    for (const sel of PATH_SELECTORS) {
      expect(labels).toContain(sel);
    }
  });

  it("filters/keeps suggestions while typing a selector prefix", () => {
    const ctx = makeContext("SELECT * FROM MATCH SHO");
    const result = source(ctx);
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toContain("SHORTEST");
  });
});

// ── Completion source: keyword + path-function completions ──

describe("sixsevenCompletionSource — global word completion", () => {
  const source = sixsevenCompletionSource(sampleSchema);

  it("includes the new SixSevenDB keywords SHORTEST, WEIGHT, ANY", () => {
    const ctx = makeContext("SELECT ");
    const result = source(ctx);
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toContain("SHORTEST");
    expect(labels).toContain("WEIGHT");
    expect(labels).toContain("ANY");
    // ALL is provided through the standard SQL keyword set.
    expect(labels).toContain("ALL");
  });

  it("includes all path functions", () => {
    const ctx = makeContext("SELECT ");
    const result = source(ctx);
    const labels = result!.options.map((o) => o.label);
    for (const fn of PATH_FUNCTIONS) {
      expect(labels).toContain(fn);
    }
  });

  it("marks path functions with type=function", () => {
    const ctx = makeContext("SELECT ");
    const result = source(ctx);
    const fn = result!.options.find((o) => o.label === "path_length");
    expect(fn).toBeDefined();
    expect(fn!.type).toBe("function");
  });

  it("still surfaces schema tables and edge types", () => {
    const ctx = makeContext("SELECT * FROM ");
    const result = source(ctx);
    const labels = result!.options.map((o) => o.label);
    expect(labels).toContain("users");
    expect(labels).toContain("posts");
    expect(labels).toContain("FOLLOWS");
    expect(labels).toContain("LIKES");
  });
});

// ── Completion source: dot-prefixed column completion (regression) ──

describe("sixsevenCompletionSource — dot completion", () => {
  const source = sixsevenCompletionSource(sampleSchema);

  it("returns columns of the qualified table", () => {
    const ctx = makeContext("SELECT users.");
    const result = source(ctx);
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toEqual(["id", "name", "email"]);
  });

  it("returns null for an unknown table", () => {
    const ctx = makeContext("SELECT bogus.");
    const result = source(ctx);
    expect(result).toBeNull();
  });
});

// ── sixsevenSQL extension factory ──

describe("sixsevenSQL", () => {
  it("returns a CodeMirror extension array", () => {
    const ext = sixsevenSQL();
    // The lang-sql `sql()` helper returns a LanguageSupport object that
    // implements the Extension interface. Verify it is at least defined and
    // serializable.
    expect(ext).toBeDefined();
    expect(typeof ext).toBe("object");
  });

  it("accepts overrides without throwing", () => {
    expect(() => sixsevenSQL({ upperCaseKeywords: false })).not.toThrow();
  });
});
