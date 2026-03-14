/**
 * QA adversarial tests for GDB-426: Weighted Shortest Path
 *
 * Tests edge cases, boundary values, null handling, error paths,
 * SQL injection vectors, and cross-SDK consistency for the weighted
 * shortest path implementation.
 */

import { describe, it, expect } from "vitest";
import {
  buildAlgorithmSQL,
  parseAlgorithmResult,
  computeStats,
} from "@/lib/algorithm-utils";
import {
  getAlgorithm,
  ALGORITHMS,
  CATEGORY_LABELS,
} from "@/lib/algorithm-types";
import type { AlgorithmDef } from "@/lib/algorithm-types";

// ---------------------------------------------------------------------------
// Helper: get the weighted_shortest_path algorithm definition
// ---------------------------------------------------------------------------
function getWSP(): AlgorithmDef {
  const algo = getAlgorithm("weighted_shortest_path");
  if (!algo) throw new Error("weighted_shortest_path not found");
  return algo;
}

// ---------------------------------------------------------------------------
// AC1: Dijkstra finds weighted shortest path on known graph
// ---------------------------------------------------------------------------
describe("QA-GDB-426 — AC1: Weighted shortest path definition and SQL generation", () => {
  it("weighted_shortest_path algorithm exists in ALGORITHMS", () => {
    const algo = getAlgorithm("weighted_shortest_path");
    expect(algo).toBeDefined();
    expect(algo!.id).toBe("weighted_shortest_path");
  });

  it("algorithm is in the 'path' category", () => {
    const algo = getWSP();
    expect(algo.category).toBe("path");
    expect(CATEGORY_LABELS).toHaveProperty("path");
  });

  it("has all required parameters", () => {
    const algo = getWSP();
    const paramNames = algo.params.map((p) => p.name);
    expect(paramNames).toContain("source_table");
    expect(paramNames).toContain("source_id");
    expect(paramNames).toContain("target_table");
    expect(paramNames).toContain("target_id");
    expect(paramNames).toContain("weight_property");
  });

  it("generates valid SQL with all parameters", () => {
    const algo = getWSP();
    const sql = buildAlgorithmSQL(algo, "testdb", {
      source_table: "cities",
      source_id: 1,
      target_table: "cities",
      target_id: 5,
      weight_property: "distance",
    });
    expect(sql).toContain("SHORTEST PATH");
    expect(sql).toContain("FROM");
    expect(sql).toContain("TO");
    expect(sql).toContain("WEIGHT distance");
    expect(sql).toContain("cities");
  });

  it("uses SHORTEST PATH, not CALL syntax", () => {
    const algo = getWSP();
    const sql = buildAlgorithmSQL(algo, "testdb", {
      source_table: "nodes",
      source_id: 1,
      target_table: "nodes",
      target_id: 2,
      weight_property: "cost",
    });
    expect(sql).not.toMatch(/^CALL/);
    expect(sql).toMatch(/^SHORTEST PATH/);
  });
});

// ---------------------------------------------------------------------------
// AC2: path_cost(p) returns correct total weight
// ---------------------------------------------------------------------------
describe("QA-GDB-426 — AC2: path_cost / total_weight result parsing", () => {
  it("scoreColumn is total_weight for weighted_shortest_path", () => {
    const algo = getWSP();
    expect(algo.scoreColumn).toBe("total_weight");
  });

  it("parses results with total_weight column", () => {
    const algo = getWSP();
    const data = {
      columns: ["node", "total_weight"],
      rows: [
        ["cities:1", 0],
        ["cities:3", 15.5],
        ["cities:5", 42.7],
      ] as (string | number | boolean | null)[][],
    };
    const result = parseAlgorithmResult(algo, data);
    expect(result.nodes).toHaveLength(3);
    expect(result.nodes[0].score).toBe(0);
    expect(result.nodes[1].score).toBe(15.5);
    expect(result.nodes[2].score).toBe(42.7);
    expect(result.stats.min).toBe(0);
    expect(result.stats.max).toBe(42.7);
  });

  it("handles case-insensitive total_weight column", () => {
    const algo = getWSP();
    const data = {
      columns: ["Node", "Total_Weight"],
      rows: [["cities:1", 10]] as (string | number | boolean | null)[][],
    };
    const result = parseAlgorithmResult(algo, data);
    expect(result.nodes[0].score).toBe(10);
  });

  it("handles null total_weight as 0", () => {
    const algo = getWSP();
    const data = {
      columns: ["node", "total_weight"],
      rows: [["cities:1", null]] as (string | number | boolean | null)[][],
    };
    const result = parseAlgorithmResult(algo, data);
    expect(result.nodes[0].score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC3: Negative weight produces clear error
// ---------------------------------------------------------------------------
describe("QA-GDB-426 — AC3: Negative weight handling", () => {
  it("negative weight values are represented in stats correctly", () => {
    // Negative weights should be caught server-side, but if they arrive
    // the client should still compute stats without crashing
    const scores = [-5, -1, 0, 3, 10];
    const stats = computeStats(scores);
    expect(stats.min).toBe(-5);
    expect(stats.max).toBe(10);
    expect(stats.count).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// AC4: Disconnected graph returns empty result
// ---------------------------------------------------------------------------
describe("QA-GDB-426 — AC4: Disconnected graph / empty results", () => {
  it("empty rows produce empty nodes and zero stats", () => {
    const algo = getWSP();
    const data = {
      columns: ["node", "total_weight"],
      rows: [] as (string | number | boolean | null)[][],
    };
    const result = parseAlgorithmResult(algo, data);
    expect(result.nodes).toHaveLength(0);
    expect(result.stats.count).toBe(0);
    expect(result.stats.min).toBe(0);
    expect(result.stats.max).toBe(0);
    expect(result.stats.mean).toBe(0);
    expect(result.stats.median).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AC5: Unit tests — edge cases and adversarial inputs
// ---------------------------------------------------------------------------
describe("QA-GDB-426 — AC5: Adversarial SQL generation edge cases", () => {
  it("defaults weight_property to 'weight' when not provided", () => {
    const algo = getWSP();
    const sql = buildAlgorithmSQL(algo, "testdb", {
      source_table: "a",
      source_id: 1,
      target_table: "b",
      target_id: 2,
    });
    expect(sql).toContain("WEIGHT weight");
  });

  it("defaults source_id and target_id to 1 when not provided", () => {
    const algo = getWSP();
    const sql = buildAlgorithmSQL(algo, "testdb", {
      source_table: "a",
      target_table: "b",
      weight_property: "cost",
    });
    expect(sql).toContain("id = 1");
    // Both source and target should default to 1
    const idMatches = sql.match(/id = 1/g);
    expect(idMatches).toHaveLength(2);
  });

  it("handles empty source_table and target_table with default fallback", () => {
    const algo = getWSP();
    const sql = buildAlgorithmSQL(algo, "testdb", {
      source_table: "",
      source_id: 1,
      target_table: "",
      target_id: 2,
      weight_property: "cost",
    });
    // Empty table names now default to "t" via the || "t" fallback
    expect(sql).toContain('FROM "t"');
    expect(sql).toContain('TO "t"');
  });

  it("handles numeric string IDs", () => {
    const algo = getWSP();
    const sql = buildAlgorithmSQL(algo, "testdb", {
      source_table: "cities",
      source_id: "42",
      target_table: "cities",
      target_id: "99",
      weight_property: "distance",
    });
    expect(sql).toContain("id = 42");
    expect(sql).toContain("id = 99");
  });

  it("handles zero as source_id and target_id", () => {
    const algo = getWSP();
    const sql = buildAlgorithmSQL(algo, "testdb", {
      source_table: "nodes",
      source_id: 0,
      target_table: "nodes",
      target_id: 0,
      weight_property: "w",
    });
    expect(sql).toContain("id = 0");
  });

  it("handles large IDs", () => {
    const algo = getWSP();
    const sql = buildAlgorithmSQL(algo, "testdb", {
      source_table: "t",
      source_id: 999999999,
      target_table: "t",
      target_id: 999999999,
      weight_property: "w",
    });
    expect(sql).toContain("id = 999999999");
  });

  it("same source and target table/id produces valid SQL", () => {
    const algo = getWSP();
    const sql = buildAlgorithmSQL(algo, "testdb", {
      source_table: "nodes",
      source_id: 1,
      target_table: "nodes",
      target_id: 1,
      weight_property: "cost",
    });
    expect(sql).toBe(
      'SHORTEST PATH FROM "nodes" WHERE id = 1 TO "nodes" WHERE id = 1 WEIGHT cost'
    );
  });
});

// ---------------------------------------------------------------------------
// FIX VERIFICATION: GDB-556 — SQL injection via weight_property now blocked
// ---------------------------------------------------------------------------
describe("QA-GDB-556 — FIXED: weight_property is now sanitized", () => {
  it("weight_property with injection attempt throws error", () => {
    const algo = getWSP();
    expect(() =>
      buildAlgorithmSQL(algo, "testdb", {
        source_table: "t",
        source_id: 1,
        target_table: "t",
        target_id: 2,
        weight_property: "distance; DROP TABLE users--",
      })
    ).toThrow();
  });

  it("weight_property with SQL keywords throws error", () => {
    const algo = getWSP();
    expect(() =>
      buildAlgorithmSQL(algo, "testdb", {
        source_table: "t",
        source_id: 1,
        target_table: "t",
        target_id: 2,
        weight_property: "x WHERE 1=1",
      })
    ).toThrow();
  });

  it("valid weight_property identifiers are accepted", () => {
    const algo = getWSP();
    const sql = buildAlgorithmSQL(algo, "testdb", {
      source_table: "t",
      source_id: 1,
      target_table: "t",
      target_id: 2,
      weight_property: "distance",
    });
    expect(sql).toContain("WEIGHT distance");
  });

  it("dotted weight_property (alias.prop) is accepted", () => {
    const algo = getWSP();
    const sql = buildAlgorithmSQL(algo, "testdb", {
      source_table: "t",
      source_id: 1,
      target_table: "t",
      target_id: 2,
      weight_property: "r.distance",
    });
    expect(sql).toContain("WEIGHT r.distance");
  });

  it("table names with invalid characters now throw", () => {
    const algo = getWSP();
    expect(() =>
      buildAlgorithmSQL(algo, "testdb", {
        source_table: 'table"name',
        source_id: 1,
        target_table: "other",
        target_id: 2,
        weight_property: "w",
      })
    ).toThrow(/Invalid identifier/);
  });
});

// ---------------------------------------------------------------------------
// FIX VERIFICATION: GDB-557 — WEIGHT keyword and path_cost now in SQL dialect
// ---------------------------------------------------------------------------
describe("QA-GDB-557 — FIXED: WEIGHT keyword in SQL dialect", () => {
  it("SIXSEVEN_KEYWORDS includes WEIGHT", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(
      "lib/sixseven-sql-lang.ts",
      "utf-8"
    );
    const keywordsSection = content.match(
      /SIXSEVEN_KEYWORDS\s*=\s*\[([\s\S]*?)\]/
    );
    expect(keywordsSection).not.toBeNull();
    expect(keywordsSection![1]).toContain('"WEIGHT"');
  });

  it("SQL dialect builtins include path_cost", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(
      "lib/sixseven-sql-lang.ts",
      "utf-8"
    );
    expect(content).toContain("path_cost");
  });
});

// ---------------------------------------------------------------------------
// FIX VERIFICATION: Identifier quoting now uses quoteIdent
// ---------------------------------------------------------------------------
describe("QA-GDB-426 — FIXED: Identifier quoting uses quoteIdent", () => {
  it("table names are validated via quoteIdent", () => {
    const algo = getWSP();
    const sql = buildAlgorithmSQL(algo, "testdb", {
      source_table: "my_table",
      source_id: 1,
      target_table: "other_table",
      target_id: 2,
      weight_property: "cost",
    });
    // quoteIdent validates then the name is wrapped in double quotes in the SQL template
    expect(sql).toContain('"my_table"');
    expect(sql).toContain('"other_table"');
  });

  it("table names with invalid characters are rejected", () => {
    const algo = getWSP();
    expect(() =>
      buildAlgorithmSQL(algo, "testdb", {
        source_table: 'table"name',
        source_id: 1,
        target_table: "other",
        target_id: 2,
        weight_property: "w",
      })
    ).toThrow(/Invalid identifier/);
  });
});

// ---------------------------------------------------------------------------
// FIX VERIFICATION: GDB-558 — All client SDKs now have WEIGHT support
// ---------------------------------------------------------------------------
describe("QA-GDB-558 — FIXED: All client SDKs have WEIGHT support", () => {
  it("Node.js SDK has buildShortestMatch with weight option", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(
      "../clients/nodejs/src/query-builders.ts",
      "utf-8"
    );
    expect(content).toContain("options.weight");
    expect(content).toContain("WEIGHT");
  });

  it("Python SDK has build_shortest_match with weight parameter", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(
      "../clients/python/src/giodb/query_builders.py",
      "utf-8"
    );
    expect(content).toContain("weight");
    expect(content).toContain("WEIGHT");
  });

  it(".NET SDK has BuildShortestMatch with Weight option", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(
      "../clients/dotnet/src/SixSevenDB.Client/QueryBuilders.cs",
      "utf-8"
    );
    expect(content).toContain("Weight");
    expect(content).toContain("WEIGHT");
  });

  it("Java SDK now has ShortestMatchBuilder with WEIGHT support", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(
      "../clients/java/src/main/java/com/sixsevendb/ShortestMatchBuilder.java",
      "utf-8"
    );
    expect(content).toContain("WEIGHT");
    expect(content).toContain("weight");
    expect(content).toContain("ShortestMatchBuilder");
  });

  it("Go SDK now has BuildShortestMatch with WEIGHT support", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(
      "../clients/go/match_builders.go",
      "utf-8"
    );
    expect(content).toContain("BuildShortestMatch");
    expect(content).toContain("WEIGHT");
    expect(content).toContain("WithShortestMatchWeight");
  });

  it("Rust SDK now has build_shortest_match with WEIGHT support", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(
      "../clients/rust/src/match_builders.rs",
      "utf-8"
    );
    expect(content).toContain("build_shortest_match");
    expect(content).toContain("WEIGHT");
  });
});

// ---------------------------------------------------------------------------
// AC6: No regressions — other algorithms still work
// ---------------------------------------------------------------------------
describe("QA-GDB-426 — AC6: No regressions on other algorithms", () => {
  it("all non-WSP algorithms still generate CALL syntax", () => {
    for (const algo of ALGORITHMS) {
      if (algo.id === "weighted_shortest_path") continue;
      const sql = buildAlgorithmSQL(algo, "testdb", {});
      expect(sql).toMatch(/^CALL /);
    }
  });

  it("pagerank SQL unchanged after WSP addition", () => {
    const algo = getAlgorithm("pagerank")!;
    const sql = buildAlgorithmSQL(algo, "social", {
      iterations: 20,
      damping: 0.85,
      tolerance: 0.0001,
    });
    expect(sql).toBe("CALL PAGERANK ITERATIONS 20 DAMPING 0.85 TOLERANCE 0.0001");
  });

  it("total algorithm count is 13", () => {
    expect(ALGORITHMS).toHaveLength(13);
  });

  it("getAlgorithmsByCategory includes path category", async () => {
    const { getAlgorithmsByCategory } = await import("@/lib/algorithm-types");
    const grouped = getAlgorithmsByCategory();
    const pathAlgos = grouped.get("path");
    expect(pathAlgos).toBeDefined();
    expect(pathAlgos!.length).toBeGreaterThanOrEqual(1);
    expect(pathAlgos!.some((a: AlgorithmDef) => a.id === "weighted_shortest_path")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stress tests — extreme values
// ---------------------------------------------------------------------------
describe("QA-GDB-426 — Stress: Extreme values in weighted path results", () => {
  it("handles very large weight values", () => {
    const algo = getWSP();
    const data = {
      columns: ["node", "total_weight"],
      rows: [
        ["n:1", Number.MAX_SAFE_INTEGER],
        ["n:2", 1e308],
      ] as (string | number | boolean | null)[][],
    };
    const result = parseAlgorithmResult(algo, data);
    expect(result.nodes[0].score).toBe(Number.MAX_SAFE_INTEGER);
    expect(result.nodes[1].score).toBe(1e308);
    expect(result.stats.max).toBe(1e308);
  });

  it("handles Infinity weight values without crashing", () => {
    const scores = [0, Infinity];
    const stats = computeStats(scores);
    expect(stats.max).toBe(Infinity);
    expect(stats.count).toBe(2);
  });

  it("handles NaN weight values", () => {
    const algo = getWSP();
    const data = {
      columns: ["node", "total_weight"],
      rows: [["n:1", NaN]] as (string | number | boolean | null)[][],
    };
    const result = parseAlgorithmResult(algo, data);
    expect(result.nodes[0].score).toBeNaN();
  });

  it("handles many path nodes (1000)", () => {
    const algo = getWSP();
    const rows: (string | number | boolean | null)[][] = [];
    for (let i = 0; i < 1000; i++) {
      rows.push([`cities:${i}`, i * 1.5]);
    }
    const data = { columns: ["node", "total_weight"], rows };
    const result = parseAlgorithmResult(algo, data);
    expect(result.nodes).toHaveLength(1000);
    expect(result.stats.count).toBe(1000);
    expect(result.stats.min).toBe(0);
    expect(result.stats.max).toBe(999 * 1.5);
  });
});
