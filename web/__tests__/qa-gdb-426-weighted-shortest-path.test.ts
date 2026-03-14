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

  it("handles empty source_table and target_table", () => {
    const algo = getWSP();
    const sql = buildAlgorithmSQL(algo, "testdb", {
      source_table: "",
      source_id: 1,
      target_table: "",
      target_id: 2,
      weight_property: "cost",
    });
    // Empty table names produce SQL with empty quoted identifiers
    // This is valid SQL generation — server will reject it
    expect(sql).toContain('FROM ""');
    expect(sql).toContain('TO ""');
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
// BUG DETECTION: SQL injection via weight_property
// ---------------------------------------------------------------------------
describe("QA-GDB-426 — BUG: weight_property is not sanitized (SQL injection)", () => {
  it("weight_property with spaces is interpolated unsafely", () => {
    const algo = getWSP();
    const sql = buildAlgorithmSQL(algo, "testdb", {
      source_table: "t",
      source_id: 1,
      target_table: "t",
      target_id: 2,
      weight_property: "distance; DROP TABLE users--",
    });
    // BUG: The weight_property is interpolated directly without escaping
    // This means malicious input becomes part of the SQL
    expect(sql).toContain("WEIGHT distance; DROP TABLE users--");
  });

  it("weight_property with SQL keywords is not escaped", () => {
    const algo = getWSP();
    const sql = buildAlgorithmSQL(algo, "testdb", {
      source_table: "t",
      source_id: 1,
      target_table: "t",
      target_id: 2,
      weight_property: "x WHERE 1=1",
    });
    // BUG: arbitrary WHERE clause can be injected via weight_property
    expect(sql).toContain("WEIGHT x WHERE 1=1");
  });
});

// ---------------------------------------------------------------------------
// BUG DETECTION: Missing WEIGHT keyword in SQL dialect
// ---------------------------------------------------------------------------
describe("QA-GDB-426 — BUG: WEIGHT keyword missing from SQL dialect", () => {
  // The WEIGHT keyword is used in weighted shortest path queries but is
  // not included in SIXSEVEN_KEYWORDS in sixseven-sql-lang.ts.
  // This means the SQL editor won't syntax-highlight it.

  it("SIXSEVEN_KEYWORDS should include WEIGHT for syntax highlighting", async () => {
    // We can't directly import the keywords array (it's not exported),
    // but we can verify the file content
    const fs = await import("fs");
    const content = fs.readFileSync(
      "lib/sixseven-sql-lang.ts",
      "utf-8"
    );
    const keywordsSection = content.match(
      /SIXSEVEN_KEYWORDS\s*=\s*\[([\s\S]*?)\]/
    );
    expect(keywordsSection).not.toBeNull();
    // BUG: WEIGHT is missing from SIXSEVEN_KEYWORDS
    expect(keywordsSection![1]).not.toContain('"WEIGHT"');
  });
});

// ---------------------------------------------------------------------------
// BUG DETECTION: path_cost missing from SQL builtins
// ---------------------------------------------------------------------------
describe("QA-GDB-426 — BUG: path_cost function missing from SQL dialect builtins", () => {
  it("SQL dialect builtins should include path_cost for autocomplete", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync(
      "lib/sixseven-sql-lang.ts",
      "utf-8"
    );
    // BUG: path_cost is a key function for weighted shortest path
    // but is not listed in the builtin functions
    expect(content).not.toContain("path_cost");
  });
});

// ---------------------------------------------------------------------------
// BUG DETECTION: Inconsistent identifier quoting
// ---------------------------------------------------------------------------
describe("QA-GDB-426 — BUG: Inconsistent identifier quoting in buildWeightedShortestPathSQL", () => {
  it("uses double-quote wrapping instead of quoteIdent validation", () => {
    // quoteIdent in schema-utils.ts validates identifiers without quoting.
    // buildWeightedShortestPathSQL wraps table names in double quotes.
    // If SixSevenDB doesn't support double-quoted identifiers (per the
    // quoteIdent comment), this SQL would fail.
    const algo = getWSP();
    const sql = buildAlgorithmSQL(algo, "testdb", {
      source_table: "my_table",
      source_id: 1,
      target_table: "other_table",
      target_id: 2,
      weight_property: "cost",
    });
    // The SQL uses double-quoted identifiers
    expect(sql).toContain('"my_table"');
    expect(sql).toContain('"other_table"');
    // But handleShortestPath in graph/route.ts uses quoteIdent (no quotes)
    // This inconsistency means one approach or the other will fail
  });

  it("table names with double quotes in them are not escaped", () => {
    const algo = getWSP();
    const sql = buildAlgorithmSQL(algo, "testdb", {
      source_table: 'table"name',
      source_id: 1,
      target_table: "other",
      target_id: 2,
      weight_property: "w",
    });
    // BUG: Double quotes within the table name are not escaped
    // This produces broken SQL: FROM "table"name"
    expect(sql).toContain('"table"name"');
  });
});

// ---------------------------------------------------------------------------
// BUG DETECTION: Java, Go, Rust clients missing buildShortestMatch
// ---------------------------------------------------------------------------
describe("QA-GDB-426 — BUG: Client SDKs missing WEIGHT support", () => {
  it("Node.js SDK has buildShortestMatch with weight option", async () => {
    // Verify Node.js SDK supports WEIGHT - this should PASS
    const fs = await import("fs");
    const content = fs.readFileSync(
      "../clients/nodejs/src/query-builders.ts",
      "utf-8"
    );
    expect(content).toContain("options.weight");
    expect(content).toContain("WEIGHT");
  });

  it("Python SDK has build_shortest_match with weight parameter", async () => {
    // Verify Python SDK supports WEIGHT - this should PASS
    const fs = await import("fs");
    const content = fs.readFileSync(
      "../clients/python/src/giodb/query_builders.py",
      "utf-8"
    );
    expect(content).toContain("weight");
    expect(content).toContain("WEIGHT");
  });

  it(".NET SDK has BuildShortestMatch with Weight option", async () => {
    // Verify .NET SDK supports WEIGHT - this should PASS
    const fs = await import("fs");
    const content = fs.readFileSync(
      "../clients/dotnet/src/SixSevenDB.Client/QueryBuilders.cs",
      "utf-8"
    );
    expect(content).toContain("Weight");
    expect(content).toContain("WEIGHT");
  });

  it("Java SDK is missing buildShortestMatch with WEIGHT support", async () => {
    // BUG: Java client has ShortestPathBuilder but no ShortestMatchBuilder
    // and no WEIGHT clause support at all
    const fs = await import("fs");
    const javaDir = "../clients/java/src/main/java/com/sixsevendb";

    // Check if any Java file contains WEIGHT support
    const { readdirSync, readFileSync } = fs;
    const files = readdirSync(javaDir);
    let hasWeightSupport = false;
    for (const file of files) {
      if (file.endsWith(".java")) {
        const content = readFileSync(`${javaDir}/${file}`, "utf-8");
        if (content.includes("WEIGHT") || content.includes("weight()")) {
          hasWeightSupport = true;
          break;
        }
      }
    }
    // BUG: Java client has no WEIGHT support
    expect(hasWeightSupport).toBe(false);
  });

  it("Go SDK is missing buildShortestMatch with WEIGHT support", async () => {
    // BUG: Go client has no shortest match builder or WEIGHT support
    const fs = await import("fs");
    const goDir = "../clients/go";
    const { readdirSync, readFileSync } = fs;
    const files = readdirSync(goDir);
    let hasWeightSupport = false;
    for (const file of files) {
      if (file.endsWith(".go")) {
        const content = readFileSync(`${goDir}/${file}`, "utf-8");
        if (
          content.includes("ShortestMatch") ||
          content.includes("WEIGHT") ||
          content.includes("Weight")
        ) {
          hasWeightSupport = true;
          break;
        }
      }
    }
    // BUG: Go client has no WEIGHT support
    expect(hasWeightSupport).toBe(false);
  });

  it("Rust SDK is missing build_shortest_match with WEIGHT support", async () => {
    // BUG: Rust client has no shortest match builder or WEIGHT support
    const fs = await import("fs");
    const content = fs.readFileSync(
      "../clients/rust/src/query_builders.rs",
      "utf-8"
    );
    // BUG: No shortest_match or WEIGHT support in Rust client
    expect(content).not.toContain("shortest_match");
    expect(content).not.toContain("WEIGHT");
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
