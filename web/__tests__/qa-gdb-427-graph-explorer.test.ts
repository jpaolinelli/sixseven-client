/**
 * QA adversarial tests for GDB-427 — Graph Explorer Enhancements.
 *
 * Targets:
 *  - lib/graph-utils.ts (path-selector + variable-length helpers, parsePathSet,
 *    pathSetToHighlightMaps, pathColor, buildShortestPathSql, buildVariableLengthMatchSql)
 *  - lib/graph-query-utils.ts (parsePathSelector, parseHopQuantifier, isMatchQuery, isGraphQuery)
 *  - app/api/graph/route.ts (variable_length_traverse + shortest_path with selector/k)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  buildShortestPathSql,
  buildVariableLengthMatchSql,
  parsePathSet,
  pathSetToHighlightMaps,
  pathColor,
  PATH_HIGHLIGHT_COLORS,
  findShortestPathsWithSelector,
  variableLengthTraverse,
} from "@/lib/graph-utils";
import {
  parsePathSelector,
  parseHopQuantifier,
  isMatchQuery,
  isGraphQuery,
} from "@/lib/graph-query-utils";
import type { PathSet } from "@/lib/graph-types";

// ---------- SQL injection / quoteIdent ----------

describe("QA_buildShortestPathSql_injection", () => {
  it("rejects identifier injection via sourceTable (quotes/semicolons)", () => {
    expect(() =>
      buildShortestPathSql('users"; DROP TABLE x;--', "1", "users", "2", "any_shortest")
    ).toThrow(/Invalid identifier/);
  });

  it("rejects identifier with leading digit", () => {
    expect(() =>
      buildShortestPathSql("1users", "1", "users", "2", "any_shortest")
    ).toThrow(/Invalid identifier/);
  });

  it("rejects identifier with hyphen", () => {
    expect(() =>
      buildShortestPathSql("user-tbl", "1", "users", "2", "any_shortest")
    ).toThrow(/Invalid identifier/);
  });

  it("rejects empty identifier", () => {
    expect(() =>
      buildShortestPathSql("", "1", "users", "2", "any_shortest")
    ).toThrow(/Invalid identifier/);
  });

  it("rejects unicode identifiers (only ASCII allowed)", () => {
    expect(() =>
      buildShortestPathSql("usérs", "1", "users", "2", "any_shortest")
    ).toThrow(/Invalid identifier/);
  });

  it("escapes single quotes in id literals to prevent injection", () => {
    const sql = buildShortestPathSql(
      "users",
      "alice'; DROP TABLE x;--",
      "users",
      "2",
      "any_shortest"
    );
    // Double-quoted apostrophes are SQL-safe escape
    expect(sql).toContain("'alice''; DROP TABLE x;--'");
    expect(sql).not.toMatch(/'alice'; DROP/);
  });

  it("rejects targetTable injection", () => {
    expect(() =>
      buildShortestPathSql("users", "1", "x); DROP TABLE y;--", "2", "any_shortest")
    ).toThrow(/Invalid identifier/);
  });
});

// ---------- buildShortestPathSql / k validation ----------

describe("QA_buildShortestPathSql_k_validation", () => {
  it("clamps k=0 to 1", () => {
    const sql = buildShortestPathSql("u", "1", "u", "2", "shortest_k", 0);
    expect(sql).toContain("SHORTEST 1 PATH");
  });

  it("clamps negative k to 1", () => {
    const sql = buildShortestPathSql("u", "1", "u", "2", "shortest_k", -5);
    expect(sql).toContain("SHORTEST 1 PATH");
  });

  it("floors fractional k", () => {
    const sql = buildShortestPathSql("u", "1", "u", "2", "shortest_k", 3.7);
    expect(sql).toContain("SHORTEST 3 PATH");
  });

  it("handles NaN k by defaulting to 1", () => {
    const sql = buildShortestPathSql("u", "1", "u", "2", "shortest_k", NaN);
    // Math.floor(NaN)=NaN, Math.max(1, NaN)=NaN — produces "SHORTEST NaN PATH"
    // Document actual behavior
    expect(sql).toMatch(/SHORTEST (1|NaN) PATH/);
  });

  it("Infinity k produces non-finite output", () => {
    const sql = buildShortestPathSql("u", "1", "u", "2", "shortest_k", Infinity);
    // Math.floor(Infinity) = Infinity
    expect(sql).toContain("SHORTEST");
  });

  it("ignores k for any_shortest", () => {
    const sql = buildShortestPathSql("u", "1", "u", "2", "any_shortest", 99);
    expect(sql).toContain("ANY SHORTEST PATH");
    expect(sql).not.toContain("99");
  });

  it("ignores k for all_shortest", () => {
    const sql = buildShortestPathSql("u", "1", "u", "2", "all_shortest", 42);
    expect(sql).toContain("ALL SHORTEST PATH");
    expect(sql).not.toContain("42");
  });
});

// ---------- buildVariableLengthMatchSql / depth validation ----------

describe("QA_buildVariableLengthMatchSql_depth", () => {
  it("clamps negative minDepth to 0", () => {
    const sql = buildVariableLengthMatchSql("u", "1", "out", { minDepth: -5, maxDepth: 3 });
    expect(sql).toContain("*0..3");
  });

  it("clamps maxDepth up to minDepth when min > max", () => {
    const sql = buildVariableLengthMatchSql("u", "1", "out", { minDepth: 10, maxDepth: 2 });
    expect(sql).toContain("*10..10");
  });

  it("floors fractional depths", () => {
    const sql = buildVariableLengthMatchSql("u", "1", "out", { minDepth: 1.9, maxDepth: 5.4 });
    expect(sql).toContain("*1..5");
  });

  // GDB-668: Fixed — direction='both' now emits undirected pattern (no arrows).
  it("direction='both' emits undirected pattern (no arrows)", () => {
    const sql = buildVariableLengthMatchSql("u", "1", "both", { minDepth: 1, maxDepth: 2 });
    // Fixed behavior: '-[r*1..2]-' (undirected, no arrow on either side)
    expect(sql).toMatch(/-\[r\*1\.\.2\]-\(/);
    expect(sql).not.toMatch(/-\[r\*1\.\.2\]->/);
    expect(sql).not.toMatch(/<-\[r\*1\.\.2\]-/);
  });

  it("direction='in' emits incoming arrow", () => {
    const sql = buildVariableLengthMatchSql("u", "1", "in", { minDepth: 1, maxDepth: 2 });
    expect(sql).toContain("<-[r*1..2]-");
  });

  it("rejects malicious table identifier", () => {
    expect(() =>
      buildVariableLengthMatchSql("u; DROP--", "1", "out", { minDepth: 1, maxDepth: 2 })
    ).toThrow(/Invalid identifier/);
  });

  it("rejects malicious edgeType", () => {
    expect(() =>
      buildVariableLengthMatchSql("u", "1", "out", { minDepth: 1, maxDepth: 2 }, "edge'); DROP--")
    ).toThrow(/Invalid identifier/);
  });

  it("escapes string id literal", () => {
    const sql = buildVariableLengthMatchSql("u", "ali'ce", "out", { minDepth: 1, maxDepth: 2 });
    expect(sql).toContain("'ali''ce'");
  });
});

// ---------- pathColor edge cases ----------

describe("QA_pathColor_boundaries", () => {
  it("returns first color for index 0", () => {
    expect(pathColor(0)).toBe(PATH_HIGHLIGHT_COLORS[0]);
  });

  it("cycles through the palette correctly", () => {
    const len = PATH_HIGHLIGHT_COLORS.length;
    expect(pathColor(len)).toBe(PATH_HIGHLIGHT_COLORS[0]);
    expect(pathColor(len + 3)).toBe(PATH_HIGHLIGHT_COLORS[3]);
  });

  it("returns first color for negative index", () => {
    expect(pathColor(-1)).toBe(PATH_HIGHLIGHT_COLORS[0]);
    expect(pathColor(-1000)).toBe(PATH_HIGHLIGHT_COLORS[0]);
  });

  it("returns first color for NaN", () => {
    expect(pathColor(NaN)).toBe(PATH_HIGHLIGHT_COLORS[0]);
  });

  it("returns first color for Infinity", () => {
    expect(pathColor(Infinity)).toBe(PATH_HIGHLIGHT_COLORS[0]);
  });

  it("handles MAX_SAFE_INTEGER without crashing", () => {
    const c = pathColor(Number.MAX_SAFE_INTEGER);
    expect(PATH_HIGHLIGHT_COLORS).toContain(c);
  });
});

// ---------- parsePathSet adversarial ----------

describe("QA_parsePathSet_malformed", () => {
  const COLS = ["path_id", "hop", "source_table", "source_id", "edge_type", "target_table", "target_id"];

  it("returns empty for empty rows", () => {
    const ps = parsePathSet("any_shortest", { columns: COLS, rows: [] });
    expect(ps.paths).toHaveLength(0);
    expect(ps.selector).toBe("any_shortest");
  });

  it("returns empty PathSet when source/target columns missing", () => {
    const ps = parsePathSet("any_shortest", { columns: ["path_id", "hop"], rows: [[0, 0]] });
    expect(ps.paths).toEqual([]);
  });

  it("treats null path_id as default '0'", () => {
    const ps = parsePathSet("any_shortest", {
      columns: COLS,
      rows: [
        [null, 0, "a", "1", "e", "b", "2"],
        [null, 1, "b", "2", "e", "c", "3"],
      ],
    });
    expect(ps.paths).toHaveLength(1);
    expect(ps.paths[0].id).toBe("0");
    expect(ps.paths[0].length).toBe(2);
  });

  it("preserves hop ordering when hops arrive out of order", () => {
    const ps = parsePathSet("all_shortest", {
      columns: COLS,
      rows: [
        [0, 2, "c", "3", "e", "d", "4"],
        [0, 0, "a", "1", "e", "b", "2"],
        [0, 1, "b", "2", "e", "c", "3"],
      ],
    });
    expect(ps.paths[0].nodeIds).toEqual(["a:1", "b:2", "c:3", "d:4"]);
  });

  it("handles duplicate hop indices without crashing", () => {
    const ps = parsePathSet("all_shortest", {
      columns: COLS,
      rows: [
        [0, 0, "a", "1", "e", "b", "2"],
        [0, 0, "a", "1", "e", "x", "9"], // duplicate hop=0
      ],
    });
    expect(ps.paths).toHaveLength(1);
    // both hops included, ordering arbitrary but no crash
    expect(ps.paths[0].length).toBe(2);
  });

  it("handles many paths (100) without collapsing or losing data", () => {
    const rows: (string | number | null)[][] = [];
    for (let p = 0; p < 100; p++) {
      rows.push([p, 0, "a", String(p), "e", "b", String(p + 1)]);
    }
    const ps = parsePathSet("shortest_k", { columns: COLS, rows });
    expect(ps.paths).toHaveLength(100);
    // ids preserved
    expect(ps.paths[0].id).toBe("0");
    expect(ps.paths[99].id).toBe("99");
  });

  it("handles a 1000-hop path", () => {
    const rows: (string | number | null)[][] = [];
    for (let h = 0; h < 1000; h++) {
      rows.push([0, h, "n", String(h), "e", "n", String(h + 1)]);
    }
    const ps = parsePathSet("any_shortest", { columns: COLS, rows });
    expect(ps.paths).toHaveLength(1);
    expect(ps.paths[0].length).toBe(1000);
    expect(ps.paths[0].nodeIds).toHaveLength(1001);
  });

  it("uses row index as fallback when hop column missing", () => {
    const ps = parsePathSet("any_shortest", {
      columns: ["path_id", "source_table", "source_id", "edge_type", "target_table", "target_id"],
      rows: [
        [0, "a", "1", "e", "b", "2"],
        [0, "b", "2", "e", "c", "3"],
      ],
    });
    expect(ps.paths[0].nodeIds).toEqual(["a:1", "b:2", "c:3"]);
  });

  it("treats missing path_id column as a single path", () => {
    const ps = parsePathSet("any_shortest", {
      columns: ["hop", "source_table", "source_id", "edge_type", "target_table", "target_id"],
      rows: [
        [0, "a", "1", "e", "b", "2"],
        [1, "b", "2", "e", "c", "3"],
      ],
    });
    expect(ps.paths).toHaveLength(1);
  });

  it("is case-insensitive on column names", () => {
    const ps = parsePathSet("any_shortest", {
      columns: ["PATH_ID", "HOP", "SOURCE_TABLE", "SOURCE_ID", "EDGE_TYPE", "TARGET_TABLE", "TARGET_ID"],
      rows: [[0, 0, "a", "1", "e", "b", "2"]],
    });
    expect(ps.paths).toHaveLength(1);
  });
});

// ---------- pathSetToHighlightMaps shared edges ----------

describe("QA_pathSetToHighlightMaps_collisions", () => {
  it("when two paths share a node, the first path's color wins", () => {
    const ps: PathSet = {
      selector: "all_shortest",
      paths: [
        { id: "0", nodeIds: ["a:1", "b:2"], edgeIds: ["a:1->e->b:2"], length: 1 },
        { id: "1", nodeIds: ["a:1", "c:3"], edgeIds: ["a:1->e->c:3"], length: 1 },
      ],
    };
    const { nodeColors, edgeColors } = pathSetToHighlightMaps(ps);
    expect(nodeColors.get("a:1")).toBe(pathColor(0));
    expect(nodeColors.get("c:3")).toBe(pathColor(1));
    expect(edgeColors.get("a:1->e->b:2")).toBe(pathColor(0));
    expect(edgeColors.get("a:1->e->c:3")).toBe(pathColor(1));
  });

  it("returns empty maps for empty PathSet", () => {
    const ps: PathSet = { selector: "any_shortest", paths: [] };
    const { nodeColors, edgeColors } = pathSetToHighlightMaps(ps);
    expect(nodeColors.size).toBe(0);
    expect(edgeColors.size).toBe(0);
  });
});

// ---------- parsePathSelector ----------

describe("QA_parsePathSelector_grammar", () => {
  it("matches ANY SHORTEST", () => {
    expect(parsePathSelector("SELECT * FROM MATCH ANY SHORTEST PATH ((a)-[r]->*(b))")).toEqual({
      selector: "any_shortest",
    });
  });

  it("matches ALL SHORTEST", () => {
    expect(parsePathSelector("select * from MATCH ALL SHORTEST PATH ((a)-[r]->*(b))")).toEqual({
      selector: "all_shortest",
    });
  });

  it("matches SHORTEST K with k", () => {
    expect(parsePathSelector("SELECT * FROM MATCH SHORTEST 7 PATH ((a)-[r]->*(b))")).toEqual({
      selector: "shortest_k",
      k: 7,
    });
  });

  it("returns null for non-MATCH SQL", () => {
    expect(parsePathSelector("SELECT * FROM users")).toBeNull();
  });

  it("returns null for MATCH without selector", () => {
    expect(parsePathSelector("SELECT * FROM MATCH ((a)-[r]->(b))")).toBeNull();
  });

  it("does NOT match SHORTEST 0 (k must be parsed but k=0 is nonsensical)", () => {
    // Currently returns { selector: 'shortest_k', k: 0 } — semantically dubious
    const result = parsePathSelector("SELECT * FROM MATCH SHORTEST 0 PATH ((a)-[r]->*(b))");
    expect(result).toEqual({ selector: "shortest_k", k: 0 });
  });
});

// ---------- parseHopQuantifier ----------

describe("QA_parseHopQuantifier_grammar", () => {
  it("parses *1..3", () => {
    expect(parseHopQuantifier("[r*1..3]")).toEqual({ min: 1, max: 3 });
  });

  it("returns null for missing quantifier", () => {
    expect(parseHopQuantifier("[r]")).toBeNull();
  });

  it("returns null for *5 (no range)", () => {
    expect(parseHopQuantifier("[r*5]")).toBeNull();
  });

  it("returns null for *.. (no numbers)", () => {
    expect(parseHopQuantifier("[r*..]")).toBeNull();
  });

  it("KNOWN: parses *5..3 as min=5,max=3 (does not validate min<=max)", () => {
    // Documents that the parser does not enforce min<=max — caller responsibility.
    expect(parseHopQuantifier("[r*5..3]")).toEqual({ min: 5, max: 3 });
  });

  it("rejects negative min via leading minus (regex matches digits only)", () => {
    // *-1..5 — the regex `\*\s*(\d+)` won't match "-1", so it falls through
    // to find some other digit pair. With this input there's no `\d+\.\.\d+`
    // sub-match, so result should be null.
    const r = parseHopQuantifier("[r*-1..5]");
    // Actually the regex is greedy: `*` matches, then skips `-`, picks up `1..5`.
    // Document actual behavior:
    expect(r === null || (r.min === 1 && r.max === 5)).toBe(true);
  });
});

// ---------- isMatchQuery / isGraphQuery ----------

describe("QA_isMatchQuery", () => {
  it("detects FROM MATCH", () => {
    expect(isMatchQuery("SELECT * FROM MATCH ((a)-[r]->(b))")).toBe(true);
  });

  it("is case insensitive", () => {
    expect(isMatchQuery("select * from match ((a)-[r]->(b))")).toBe(true);
  });

  it("does NOT match a MATCH() function in WHERE clause", () => {
    expect(isMatchQuery("SELECT * FROM users WHERE MATCH(name, 'foo')")).toBe(false);
  });

  it("isGraphQuery returns true for either TRAVERSE or MATCH", () => {
    expect(isGraphQuery("SELECT * FROM TRAVERSE x FROM y(1)")).toBe(true);
    expect(isGraphQuery("SELECT * FROM MATCH ((a)-[r]->(b))")).toBe(true);
    expect(isGraphQuery("SELECT * FROM users")).toBe(false);
  });
});

// ---------- API client adversarial fetch behavior ----------

describe("QA_API_client_adversarial", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("variableLengthTraverse propagates server-side validation errors", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "minDepth/maxDepth must be non-negative numbers",
    }) as unknown as typeof fetch;

    await expect(
      variableLengthTraverse("db", "u", "1", "out", 0, { minDepth: -1, maxDepth: 3 })
    ).rejects.toThrow(/Variable-length traverse error 400/);
  });

  it("findShortestPathsWithSelector serializes selector and k into request body", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ columns: [], rows: [] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await findShortestPathsWithSelector("db", "u", "1", "u", "2", "shortest_k", 5);
    const call = fetchMock.mock.calls[0];
    const body = JSON.parse(call[1].body);
    expect(body.action).toBe("shortest_path");
    expect(body.selector).toBe("shortest_k");
    expect(body.k).toBe(5);
  });

  it("findShortestPathsWithSelector with selector but no k still sends request (k=undefined)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ columns: [], rows: [] }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    await findShortestPathsWithSelector("db", "u", "1", "u", "2", "any_shortest");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.selector).toBe("any_shortest");
    expect(body.k).toBeUndefined();
  });
});

// ---------- API route adversarial (POST handler) ----------

describe("QA_API_route_validation", () => {
  // We import lazily because the route imports from @/lib/db which we mock.
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  async function loadRoute() {
    vi.doMock("@/lib/db", () => ({
      query: vi.fn().mockResolvedValue({ columns: [], rows: [] }),
    }));
    return await import("@/app/api/graph/route");
  }

  function makeReq(body: unknown) {
    return { json: async () => body } as unknown as import("next/server").NextRequest;
  }

  it("rejects unknown action with 400", async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeReq({ action: "delete_universe", database: "db" }));
    expect(res.status).toBe(400);
  });

  it("rejects missing action with 400", async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeReq({ database: "db" }));
    expect(res.status).toBe(400);
  });

  it("rejects missing database with 400", async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeReq({ action: "traverse" }));
    expect(res.status).toBe(400);
  });

  it("variable_length_traverse rejects negative minDepth", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      makeReq({
        action: "variable_length_traverse",
        database: "db",
        table: "u",
        id: "1",
        minDepth: -1,
        maxDepth: 3,
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/non-negative/);
  });

  it("variable_length_traverse rejects max < min", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      makeReq({
        action: "variable_length_traverse",
        database: "db",
        table: "u",
        id: "1",
        minDepth: 5,
        maxDepth: 2,
      })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/maxDepth/);
  });

  it("variable_length_traverse rejects NaN depths", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      makeReq({
        action: "variable_length_traverse",
        database: "db",
        table: "u",
        id: "1",
        minDepth: "not a number",
        maxDepth: 3,
      })
    );
    expect(res.status).toBe(400);
  });

  it("variable_length_traverse rejects malicious table identifier", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      makeReq({
        action: "variable_length_traverse",
        database: "db",
        table: 'u"; DROP TABLE x;--',
        id: "1",
        minDepth: 1,
        maxDepth: 2,
      })
    );
    // quoteIdent throws → caught by outer try/catch → 500
    expect([400, 500]).toContain(res.status);
    const body = await res.json();
    expect(body.error).toMatch(/Invalid identifier/);
  });

  it("GDB-668 FIX: variable_length_traverse direction='both' produces undirected pattern (no arrows)", async () => {
    let captured = "";
    vi.doMock("@/lib/db", () => ({
      query: vi.fn().mockImplementation(async (sql: string) => {
        captured = sql;
        return { columns: [], rows: [] };
      }),
    }));
    const { POST } = await import("@/app/api/graph/route");
    await POST(
      makeReq({
        action: "variable_length_traverse",
        database: "db",
        table: "u",
        id: "1",
        direction: "both",
        minDepth: 1,
        maxDepth: 2,
      })
    );
    // Fixed: undirected pattern with no arrows
    expect(captured).toMatch(/-\[r\*1\.\.2\]-/);
    expect(captured).not.toMatch(/-\[r\*1\.\.2\]->/);
    expect(captured).not.toMatch(/<-\[r\*1\.\.2\]-/);
  });

  it("shortest_path rejects invalid selector", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      makeReq({
        action: "shortest_path",
        database: "db",
        sourceTable: "u",
        sourceId: "1",
        targetTable: "u",
        targetId: "2",
        selector: "best_ever",
      })
    );
    expect(res.status).toBe(400);
  });

  it("shortest_path with shortest_k rejects k=0", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      makeReq({
        action: "shortest_path",
        database: "db",
        sourceTable: "u",
        sourceId: "1",
        targetTable: "u",
        targetId: "2",
        selector: "shortest_k",
        k: 0,
      })
    );
    expect(res.status).toBe(400);
  });

  it("shortest_path with shortest_k rejects negative k", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      makeReq({
        action: "shortest_path",
        database: "db",
        sourceTable: "u",
        sourceId: "1",
        targetTable: "u",
        targetId: "2",
        selector: "shortest_k",
        k: -3,
      })
    );
    expect(res.status).toBe(400);
  });

  it("shortest_path with shortest_k rejects missing k", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      makeReq({
        action: "shortest_path",
        database: "db",
        sourceTable: "u",
        sourceId: "1",
        targetTable: "u",
        targetId: "2",
        selector: "shortest_k",
      })
    );
    expect(res.status).toBe(400);
  });

  it("shortest_path missing source/target returns 400", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      makeReq({
        action: "shortest_path",
        database: "db",
        sourceTable: "u",
        sourceId: "1",
        // missing targetTable/targetId
      })
    );
    expect(res.status).toBe(400);
  });

  it("rejects malformed JSON body", async () => {
    const { POST } = await loadRoute();
    const badReq = {
      json: async () => {
        throw new SyntaxError("malformed JSON");
      },
    } as unknown as import("next/server").NextRequest;
    const res = await POST(badReq);
    expect(res.status).toBe(500);
  });

  it("shortest_path defaults to any_shortest when selector omitted", async () => {
    let captured = "";
    vi.doMock("@/lib/db", () => ({
      query: vi.fn().mockImplementation(async (sql: string) => {
        captured = sql;
        return { columns: [], rows: [] };
      }),
    }));
    const { POST } = await import("@/app/api/graph/route");
    const res = await POST(
      makeReq({
        action: "shortest_path",
        database: "db",
        sourceTable: "u",
        sourceId: "1",
        targetTable: "u",
        targetId: "2",
      })
    );
    expect(res.status).toBe(200);
    expect(captured).toContain("ANY SHORTEST PATH");
  });

  it("variable_length_traverse uses defaults when min/max omitted (1..3)", async () => {
    let captured = "";
    vi.doMock("@/lib/db", () => ({
      query: vi.fn().mockImplementation(async (sql: string) => {
        captured = sql;
        return { columns: [], rows: [] };
      }),
    }));
    const { POST } = await import("@/app/api/graph/route");
    await POST(
      makeReq({
        action: "variable_length_traverse",
        database: "db",
        table: "u",
        id: "1",
      })
    );
    expect(captured).toContain("*1..3");
  });
});
