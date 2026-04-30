/**
 * QA adversarial tests for GDB-668 — Fix variable-length traverse
 * direction='both' emitting outgoing-only arrow.
 *
 * Targets:
 *  - lib/graph-utils.ts  buildVariableLengthMatchSql
 *  - app/api/graph/route.ts  handleVariableLengthTraverse
 *
 * Acceptance criteria:
 *  1. direction='both' produces undirected pattern  -[r*min..max]-
 *  2. direction='out'  still produces               -[r*min..max]->
 *  3. direction='in'   still produces              <-[r*min..max]-
 *  4. Edge cases: empty direction, invalid direction, case sensitivity
 *  5. buildVariableLengthMatchSql and API route are consistent
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { buildVariableLengthMatchSql } from "@/lib/graph-utils";

// ---------------------------------------------------------------------------
// Helper: extract the arrow pattern around the edge bracket from generated SQL
// ---------------------------------------------------------------------------
function extractArrowPattern(sql: string): string | null {
  // Matches things like: -[r*1..3]->  or  <-[r:edge*1..3]-  or  -[r*1..3]-
  const m = sql.match(/(<-|-)\[r[^\]]*\](->|-)/);
  return m ? `${m[1]}[...]${m[2]}` : null;
}

// ===========================================================================
// 1. buildVariableLengthMatchSql — direction arrow correctness
// ===========================================================================

describe("QA_GDB668_buildVariableLengthMatchSql_direction_arrows", () => {
  const cfg = { minDepth: 1, maxDepth: 3 };

  // --- AC1: direction='both' produces undirected pattern ---

  it("direction='both' produces undirected pattern -[...]-", () => {
    const sql = buildVariableLengthMatchSql("users", "1", "both", cfg);
    expect(extractArrowPattern(sql)).toBe("-[...]-");
  });

  it("direction='both' SQL does NOT contain -> anywhere", () => {
    const sql = buildVariableLengthMatchSql("users", "1", "both", cfg);
    expect(sql).not.toContain("->");
  });

  it("direction='both' SQL does NOT contain <- anywhere", () => {
    const sql = buildVariableLengthMatchSql("users", "1", "both", cfg);
    expect(sql).not.toContain("<-");
  });

  it("direction='both' with edgeType still produces undirected pattern", () => {
    const sql = buildVariableLengthMatchSql("users", "1", "both", cfg, "follows");
    expect(extractArrowPattern(sql)).toBe("-[...]-");
    expect(sql).toContain(":follows");
  });

  it("direction='both' with large depth range still produces undirected", () => {
    const sql = buildVariableLengthMatchSql("nodes", "42", "both", { minDepth: 0, maxDepth: 100 });
    expect(sql).toMatch(/-\[r\*0\.\.100\]-\(/);
    expect(sql).not.toContain("->");
    expect(sql).not.toContain("<-");
  });

  it("direction='both' with string id still produces undirected", () => {
    const sql = buildVariableLengthMatchSql("users", "alice", "both", cfg);
    expect(extractArrowPattern(sql)).toBe("-[...]-");
    expect(sql).toContain("'alice'");
  });

  // --- AC2: direction='out' still produces outgoing arrow ---

  it("direction='out' produces outgoing pattern -[...]->", () => {
    const sql = buildVariableLengthMatchSql("users", "1", "out", cfg);
    expect(extractArrowPattern(sql)).toBe("-[...]->");
  });

  it("direction='out' SQL contains -> but NOT <-", () => {
    const sql = buildVariableLengthMatchSql("users", "1", "out", cfg);
    expect(sql).toContain("->");
    expect(sql).not.toContain("<-");
  });

  // --- AC3: direction='in' still produces incoming arrow ---

  it("direction='in' produces incoming pattern <-[...]-", () => {
    const sql = buildVariableLengthMatchSql("users", "1", "in", cfg);
    expect(extractArrowPattern(sql)).toBe("<-[...]-");
  });

  it("direction='in' SQL contains <- but NOT ->", () => {
    const sql = buildVariableLengthMatchSql("users", "1", "in", cfg);
    expect(sql).toContain("<-");
    expect(sql).not.toContain("->");
  });

  // --- AC5: all three directions produce distinct patterns ---

  it("all three directions produce distinct arrow patterns", () => {
    const outSql = buildVariableLengthMatchSql("t", "1", "out", cfg);
    const inSql = buildVariableLengthMatchSql("t", "1", "in", cfg);
    const bothSql = buildVariableLengthMatchSql("t", "1", "both", cfg);

    const outArrow = extractArrowPattern(outSql);
    const inArrow = extractArrowPattern(inSql);
    const bothArrow = extractArrowPattern(bothSql);

    expect(outArrow).toBe("-[...]->");
    expect(inArrow).toBe("<-[...]-");
    expect(bothArrow).toBe("-[...]-");

    // All distinct
    const unique = new Set([outArrow, inArrow, bothArrow]);
    expect(unique.size).toBe(3);
  });
});

// ===========================================================================
// 2. buildVariableLengthMatchSql — edge cases for direction param
// ===========================================================================

describe("QA_GDB668_buildVariableLengthMatchSql_direction_edge_cases", () => {
  const cfg = { minDepth: 1, maxDepth: 2 };

  it("direction value is used as-is (no case normalization) — 'OUT' is not 'out'", () => {
    // TypeScript type system limits this at compile time, but at runtime
    // an uppercase string could sneak through from JSON. It should NOT
    // produce an outgoing arrow since it won't match === "out".
    const sql = buildVariableLengthMatchSql(
      "t", "1", "OUT" as unknown as "out" | "in" | "both", cfg
    );
    // "OUT" !== "out" and "OUT" !== "in", so left="-", right="-" (undirected)
    expect(extractArrowPattern(sql)).toBe("-[...]-");
  });

  it("direction='Both' (mixed case) falls through to undirected", () => {
    const sql = buildVariableLengthMatchSql(
      "t", "1", "Both" as unknown as "out" | "in" | "both", cfg
    );
    expect(extractArrowPattern(sql)).toBe("-[...]-");
  });

  it("empty string direction falls through to undirected (not outgoing)", () => {
    const sql = buildVariableLengthMatchSql(
      "t", "1", "" as unknown as "out" | "in" | "both", cfg
    );
    // "" !== "out" and "" !== "in" => left="-", right="-"
    expect(extractArrowPattern(sql)).toBe("-[...]-");
  });

  it("arbitrary invalid direction string falls through to undirected", () => {
    const sql = buildVariableLengthMatchSql(
      "t", "1", "backward" as unknown as "out" | "in" | "both", cfg
    );
    expect(extractArrowPattern(sql)).toBe("-[...]-");
    expect(sql).not.toContain("->");
    expect(sql).not.toContain("<-");
  });

  it("undefined direction (cast) falls through to undirected", () => {
    const sql = buildVariableLengthMatchSql(
      "t", "1", undefined as unknown as "out" | "in" | "both", cfg
    );
    expect(extractArrowPattern(sql)).toBe("-[...]-");
  });
});

// ===========================================================================
// 3. API route handleVariableLengthTraverse — direction consistency
// ===========================================================================

describe("QA_GDB668_API_route_direction_consistency", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  function makeReq(body: unknown) {
    return { json: async () => body } as unknown as import("next/server").NextRequest;
  }

  async function loadRouteCapturing(): Promise<{
    POST: (req: import("next/server").NextRequest) => Promise<Response>;
    getCapturedSql: () => string;
  }> {
    let captured = "";
    vi.doMock("@/lib/db", () => ({
      query: vi.fn().mockImplementation(async (sql: string) => {
        captured = sql;
        return { columns: [], rows: [] };
      }),
    }));
    const mod = await import("@/app/api/graph/route");
    return { POST: mod.POST, getCapturedSql: () => captured };
  }

  const base = {
    action: "variable_length_traverse",
    database: "testdb",
    table: "users",
    id: "1",
    minDepth: 1,
    maxDepth: 3,
  };

  // --- AC1: direction='both' in API route ---

  it("API route: direction='both' emits undirected pattern", async () => {
    const { POST, getCapturedSql } = await loadRouteCapturing();
    await POST(makeReq({ ...base, direction: "both" }));
    const sql = getCapturedSql();
    expect(sql).toMatch(/-\[r\*1\.\.3\]-\(/);
    expect(sql).not.toContain("->");
    expect(sql).not.toContain("<-");
  });

  // --- AC2: direction='out' in API route ---

  it("API route: direction='out' emits outgoing arrow", async () => {
    const { POST, getCapturedSql } = await loadRouteCapturing();
    await POST(makeReq({ ...base, direction: "out" }));
    const sql = getCapturedSql();
    expect(sql).toMatch(/-\[r\*1\.\.3\]->/);
    expect(sql).not.toContain("<-");
  });

  // --- AC3: direction='in' in API route ---

  it("API route: direction='in' emits incoming arrow", async () => {
    const { POST, getCapturedSql } = await loadRouteCapturing();
    await POST(makeReq({ ...base, direction: "in" }));
    const sql = getCapturedSql();
    expect(sql).toMatch(/<-\[r\*1\.\.3\]-/);
    expect(sql).not.toContain("->");
  });

  // --- AC4: default direction (omitted) should be 'both' ---

  it("API route: omitted direction defaults to 'both' (undirected)", async () => {
    const { POST, getCapturedSql } = await loadRouteCapturing();
    await POST(makeReq({ ...base })); // no direction field
    const sql = getCapturedSql();
    // Default is 'both', so undirected
    expect(sql).toMatch(/-\[r\*1\.\.3\]-\(/);
    expect(sql).not.toContain("->");
    expect(sql).not.toContain("<-");
  });

  // --- AC5: API route and lib function produce identical SQL for same inputs ---

  it("API route SQL matches buildVariableLengthMatchSql for direction='both'", async () => {
    const { POST, getCapturedSql } = await loadRouteCapturing();
    await POST(makeReq({ ...base, direction: "both" }));
    const routeSql = getCapturedSql();

    const libSql = buildVariableLengthMatchSql("users", "1", "both", {
      minDepth: 1,
      maxDepth: 3,
    });

    expect(routeSql).toBe(libSql);
  });

  it("API route SQL matches buildVariableLengthMatchSql for direction='out'", async () => {
    const { POST, getCapturedSql } = await loadRouteCapturing();
    await POST(makeReq({ ...base, direction: "out" }));
    const routeSql = getCapturedSql();

    const libSql = buildVariableLengthMatchSql("users", "1", "out", {
      minDepth: 1,
      maxDepth: 3,
    });

    expect(routeSql).toBe(libSql);
  });

  it("API route SQL matches buildVariableLengthMatchSql for direction='in'", async () => {
    const { POST, getCapturedSql } = await loadRouteCapturing();
    await POST(makeReq({ ...base, direction: "in" }));
    const routeSql = getCapturedSql();

    const libSql = buildVariableLengthMatchSql("users", "1", "in", {
      minDepth: 1,
      maxDepth: 3,
    });

    expect(routeSql).toBe(libSql);
  });

  // --- AC4: edge case — invalid direction strings at API level ---

  it("API route: direction='BOTH' (uppercase) defaults to undirected since default='both'", async () => {
    const { POST, getCapturedSql } = await loadRouteCapturing();
    // The route destructures direction with default 'both', so if the body
    // provides direction: "BOTH", that value is used (not the default).
    // "BOTH" !== "out" and "BOTH" !== "in" => left="-", right="-"
    await POST(makeReq({ ...base, direction: "BOTH" }));
    const sql = getCapturedSql();
    expect(sql).not.toContain("->");
    expect(sql).not.toContain("<-");
  });

  // --- direction='both' with edgeType in API route ---

  it("API route: direction='both' with edgeType still undirected", async () => {
    const { POST, getCapturedSql } = await loadRouteCapturing();
    await POST(makeReq({ ...base, direction: "both", edgeType: "follows" }));
    const sql = getCapturedSql();
    expect(sql).toContain(":follows");
    expect(sql).not.toContain("->");
    expect(sql).not.toContain("<-");
  });

  // --- Regression: ensure the old bug pattern does NOT appear ---

  it("REGRESSION: direction='both' never produces the old bug pattern -[r*...]->", async () => {
    const { POST, getCapturedSql } = await loadRouteCapturing();
    for (const depth of [
      { minDepth: 1, maxDepth: 3 },
      { minDepth: 0, maxDepth: 1 },
      { minDepth: 2, maxDepth: 10 },
    ]) {
      await POST(makeReq({ ...base, direction: "both", ...depth }));
      const sql = getCapturedSql();
      expect(sql).not.toContain("->");
    }
  });

  it("REGRESSION: buildVariableLengthMatchSql direction='both' never produces ->", () => {
    for (const depth of [
      { minDepth: 0, maxDepth: 0 },
      { minDepth: 1, maxDepth: 1 },
      { minDepth: 1, maxDepth: 3 },
      { minDepth: 0, maxDepth: 50 },
    ]) {
      const sql = buildVariableLengthMatchSql("t", "1", "both", depth);
      expect(sql).not.toContain("->");
      expect(sql).not.toContain("<-");
    }
  });
});
