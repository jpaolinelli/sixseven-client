/**
 * QA adversarial tests for GDB-490: Graph Algorithm Results Panel
 *
 * Tests edge cases, boundary values, null/NaN handling, error paths,
 * and potential security issues in algorithm-utils and algorithm-types.
 */

import { describe, it, expect } from "vitest";
import {
  parseAlgorithmResult,
  parseAlgorithmNodeId,
  computeStats,
  scoreToColor,
  buildHeatMap,
  buildAlgorithmSQL,
  formatScore,
} from "@/lib/algorithm-utils";
import {
  getAlgorithm,
  getAlgorithmsByCategory,
  ALGORITHMS,
  CATEGORY_LABELS,
} from "@/lib/algorithm-types";
import type { AlgorithmDef } from "@/lib/algorithm-types";

// ---------------------------------------------------------------------------
// AC1: All 13 algorithms selectable and runnable from UI
// ---------------------------------------------------------------------------
describe("QA — AC1: All 13 algorithms defined and retrievable", () => {
  const EXPECTED_IDS = [
    "pagerank",
    "betweenness_centrality",
    "connected_components",
    "community_detection",
    "degree_centrality",
    "closeness_centrality",
    "closeness_centrality_wf",
    "eigenvector_centrality",
    "harmonic_centrality",
    "clustering_coefficient",
    "triangle_count",
    "strongly_connected_components",
    "weighted_shortest_path",
  ] as const;

  it("ALGORITHMS array has exactly 13 entries", () => {
    expect(ALGORITHMS).toHaveLength(13);
  });

  it.each(EXPECTED_IDS)("getAlgorithm('%s') returns a valid definition", (id) => {
    const algo = getAlgorithm(id);
    expect(algo).toBeDefined();
    expect(algo!.id).toBe(id);
    expect(algo!.name.length).toBeGreaterThan(0);
    expect(algo!.sqlFunction.length).toBeGreaterThan(0);
    expect(algo!.nodeColumn.length).toBeGreaterThan(0);
    expect(algo!.scoreColumn.length).toBeGreaterThan(0);
  });

  it("every algorithm belongs to a category with a label", () => {
    for (const algo of ALGORITHMS) {
      expect(CATEGORY_LABELS[algo.category]).toBeDefined();
      expect(typeof CATEGORY_LABELS[algo.category]).toBe("string");
    }
  });

  it("getAlgorithmsByCategory returns all 3 categories", () => {
    const grouped = getAlgorithmsByCategory();
    expect(grouped.has("centrality")).toBe(true);
    expect(grouped.has("community")).toBe(true);
    expect(grouped.has("path")).toBe(true);
  });

  it("getAlgorithmsByCategory total matches ALGORITHMS length", () => {
    const grouped = getAlgorithmsByCategory();
    let total = 0;
    grouped.forEach((algos) => (total += algos.length));
    expect(total).toBe(13);
  });

  it("no duplicate algorithm IDs", () => {
    const ids = ALGORITHMS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("no duplicate algorithm names", () => {
    const names = ALGORITHMS.map((a) => a.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

// ---------------------------------------------------------------------------
// AC2: Parameter inputs match each algorithm's signature
// ---------------------------------------------------------------------------
describe("QA — AC2: Parameter inputs match algorithm signatures", () => {
  it("PageRank has iterations, damping, tolerance", () => {
    const algo = getAlgorithm("pagerank")!;
    const paramNames = algo.params.map((p) => p.name);
    expect(paramNames).toContain("iterations");
    expect(paramNames).toContain("damping");
    expect(paramNames).toContain("tolerance");
  });

  it("Betweenness Centrality has direction param", () => {
    const algo = getAlgorithm("betweenness_centrality")!;
    expect(algo.params.map((p) => p.name)).toContain("direction");
  });

  it("Connected Components has no params", () => {
    const algo = getAlgorithm("connected_components")!;
    expect(algo.params).toHaveLength(0);
  });

  it("Community Detection has iterations", () => {
    const algo = getAlgorithm("community_detection")!;
    expect(algo.params.map((p) => p.name)).toContain("iterations");
  });

  it("Degree Centrality has variant param with total/in/out options", () => {
    const algo = getAlgorithm("degree_centrality")!;
    const variantParam = algo.params.find((p) => p.name === "variant");
    expect(variantParam).toBeDefined();
    expect(variantParam!.type).toBe("select");
    const optionValues = variantParam!.options!.map((o) => o.value);
    expect(optionValues).toContain("total");
    expect(optionValues).toContain("in");
    expect(optionValues).toContain("out");
  });

  it("direction-based algorithms have both/out/in options", () => {
    const directionAlgos = [
      "betweenness_centrality",
      "closeness_centrality",
      "closeness_centrality_wf",
      "harmonic_centrality",
    ] as const;

    for (const id of directionAlgos) {
      const algo = getAlgorithm(id)!;
      const dirParam = algo.params.find((p) => p.name === "direction");
      expect(dirParam).toBeDefined();
      const optionValues = dirParam!.options!.map((o) => o.value);
      expect(optionValues).toEqual(["both", "out", "in"]);
    }
  });

  it("Weighted Shortest Path has source_table, source_id, target_table, target_id, weight_property", () => {
    const algo = getAlgorithm("weighted_shortest_path")!;
    const paramNames = algo.params.map((p) => p.name);
    expect(paramNames).toContain("source_table");
    expect(paramNames).toContain("source_id");
    expect(paramNames).toContain("target_table");
    expect(paramNames).toContain("target_id");
    expect(paramNames).toContain("weight_property");
  });

  it("number params have reasonable defaults", () => {
    for (const algo of ALGORITHMS) {
      for (const param of algo.params) {
        if (param.type === "number") {
          expect(typeof param.default).toBe("number");
          if (param.min !== undefined) {
            expect(param.default).toBeGreaterThanOrEqual(param.min);
          }
          if (param.max !== undefined) {
            expect(param.default).toBeLessThanOrEqual(param.max);
          }
        }
      }
    }
  });
});

// ---------------------------------------------------------------------------
// AC3: Results visualized — parseAlgorithmResult edge cases
// ---------------------------------------------------------------------------
describe("QA — AC3: parseAlgorithmResult adversarial", () => {
  const pagerank = getAlgorithm("pagerank")!;

  it("handles empty rows gracefully", () => {
    const result = parseAlgorithmResult(pagerank, { columns: ["node", "score"], rows: [] });
    expect(result.nodes).toHaveLength(0);
    expect(result.stats.count).toBe(0);
    expect(result.stats.min).toBe(0);
    expect(result.stats.max).toBe(0);
  });

  it("handles null node values as empty string via nullish coalescing", () => {
    const result = parseAlgorithmResult(pagerank, {
      columns: ["node", "score"],
      rows: [[null, 0.5]],
    });
    // null ?? "" -> "", String("") -> ""
    expect(result.nodes[0].nodeId).toBe("");
  });

  it("handles null score values as 0", () => {
    const result = parseAlgorithmResult(pagerank, {
      columns: ["node", "score"],
      rows: [["users:1", null]],
    });
    expect(result.nodes[0].score).toBe(0);
  });

  it("handles boolean score values", () => {
    const result = parseAlgorithmResult(pagerank, {
      columns: ["node", "score"],
      rows: [
        ["users:1", true],
        ["users:2", false],
      ],
    });
    expect(result.nodes[0].score).toBe(1);
    expect(result.nodes[1].score).toBe(0);
  });

  it("handles non-numeric string scores as NaN", () => {
    const result = parseAlgorithmResult(pagerank, {
      columns: ["node", "score"],
      rows: [["users:1", "not_a_number" as any]],
    });
    expect(Number.isNaN(result.nodes[0].score)).toBe(true);
  });

  it("handles case-insensitive column lookup", () => {
    const result = parseAlgorithmResult(pagerank, {
      columns: ["NODE", "SCORE"],
      rows: [["users:1", 0.75]],
    });
    expect(result.nodes[0].nodeId).toBe("users:1");
    expect(result.nodes[0].score).toBe(0.75);
  });

  it("handles extra columns gracefully", () => {
    const result = parseAlgorithmResult(pagerank, {
      columns: ["id", "node", "score", "extra"],
      rows: [["100", "users:1", 0.5, "ignored"]],
    });
    expect(result.nodes[0].nodeId).toBe("users:1");
    expect(result.nodes[0].score).toBe(0.5);
  });

  it("falls back to index 0/1 when columns don't match", () => {
    const result = parseAlgorithmResult(pagerank, {
      columns: ["unknown_col1", "unknown_col2"],
      rows: [["users:1", 0.5]],
    });
    // Falls back to index 0 for node and index 1 for score
    expect(result.nodes[0].nodeId).toBe("users:1");
    expect(result.nodes[0].score).toBe(0.5);
  });

  it("correctly parses table:pk from node IDs", () => {
    const result = parseAlgorithmResult(pagerank, {
      columns: ["node", "score"],
      rows: [["products:42", 0.9]],
    });
    expect(result.nodes[0].table).toBe("products");
    expect(result.nodes[0].pk).toBe("42");
  });

  it("preserves raw columns and rows in result", () => {
    const data = {
      columns: ["node", "score"],
      rows: [["users:1", 0.5]] as (string | number | boolean | null)[][],
    };
    const result = parseAlgorithmResult(pagerank, data);
    expect(result.columns).toEqual(data.columns);
    expect(result.rows).toEqual(data.rows);
  });

  it("handles connected_components with component column", () => {
    const algo = getAlgorithm("connected_components")!;
    const result = parseAlgorithmResult(algo, {
      columns: ["node", "component"],
      rows: [
        ["users:1", 0],
        ["users:2", 1],
        ["users:3", 0],
      ],
    });
    expect(result.nodes).toHaveLength(3);
    expect(result.nodes[0].score).toBe(0);
    expect(result.nodes[1].score).toBe(1);
  });

  it("handles triangle_count with count column", () => {
    const algo = getAlgorithm("triangle_count")!;
    const result = parseAlgorithmResult(algo, {
      columns: ["node", "count"],
      rows: [
        ["users:1", 5],
        ["users:2", 0],
      ],
    });
    expect(result.nodes[0].score).toBe(5);
    expect(result.nodes[1].score).toBe(0);
  });

  it("handles very large result sets", () => {
    const rows: (string | number)[][] = [];
    for (let i = 0; i < 10000; i++) {
      rows.push([`users:${i}`, Math.random()]);
    }
    const result = parseAlgorithmResult(pagerank, { columns: ["node", "score"], rows });
    expect(result.nodes).toHaveLength(10000);
    expect(result.stats.count).toBe(10000);
    expect(result.stats.min).toBeLessThanOrEqual(result.stats.max);
  });
});

// ---------------------------------------------------------------------------
// AC3 continued: parseAlgorithmNodeId adversarial
// ---------------------------------------------------------------------------
describe("QA — parseAlgorithmNodeId adversarial", () => {
  it("handles colon-only string", () => {
    expect(parseAlgorithmNodeId(":")).toEqual({ table: "", pk: "" });
  });

  it("handles leading colon", () => {
    expect(parseAlgorithmNodeId(":42")).toEqual({ table: "", pk: "42" });
  });

  it("handles trailing colon", () => {
    expect(parseAlgorithmNodeId("users:")).toEqual({ table: "users", pk: "" });
  });

  it("handles multiple colons — only splits on first", () => {
    expect(parseAlgorithmNodeId("a:b:c:d")).toEqual({ table: "a", pk: "b:c:d" });
  });

  it("handles very long node IDs", () => {
    const longTable = "t".repeat(1000);
    const longPk = "p".repeat(1000);
    const result = parseAlgorithmNodeId(`${longTable}:${longPk}`);
    expect(result.table).toBe(longTable);
    expect(result.pk).toBe(longPk);
  });

  it("handles special characters in table and pk", () => {
    expect(parseAlgorithmNodeId("my-table:uuid-123-456")).toEqual({
      table: "my-table",
      pk: "uuid-123-456",
    });
  });

  it("handles spaces in node IDs", () => {
    expect(parseAlgorithmNodeId("my table:my pk")).toEqual({
      table: "my table",
      pk: "my pk",
    });
  });
});

// ---------------------------------------------------------------------------
// AC4: Color scale heat map working correctly
// ---------------------------------------------------------------------------
describe("QA — AC4: scoreToColor adversarial", () => {
  it("returns blue at min", () => {
    expect(scoreToColor(0, 0, 100)).toBe("rgb(59,130,246)");
  });

  it("returns red at max", () => {
    expect(scoreToColor(100, 0, 100)).toBe("rgb(239,68,68)");
  });

  it("returns yellow at midpoint", () => {
    expect(scoreToColor(50, 0, 100)).toBe("rgb(234,179,8)");
  });

  it("clamps score below min to blue", () => {
    expect(scoreToColor(-100, 0, 100)).toBe("rgb(59,130,246)");
  });

  it("clamps score above max to red", () => {
    expect(scoreToColor(200, 0, 100)).toBe("rgb(239,68,68)");
  });

  it("handles min === max", () => {
    expect(scoreToColor(5, 5, 5)).toBe("#3b82f6");
  });

  it("handles negative range", () => {
    const color = scoreToColor(-50, -100, 0);
    // -50 is midpoint of -100..0, should be yellow
    expect(color).toBe("rgb(234,179,8)");
  });

  it("handles very small range (floating point precision)", () => {
    const color = scoreToColor(0.00001, 0, 0.00002);
    // Should be yellow-ish (midpoint)
    expect(color).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
  });

  it("handles very large values", () => {
    const color = scoreToColor(5e15, 0, 1e16);
    expect(color).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
  });

  it("quarter point produces valid blue-yellow interpolation", () => {
    const color = scoreToColor(25, 0, 100);
    // t=0.25, in blue-yellow range (t < 0.5)
    expect(color).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
    // Verify it's between blue and yellow
    const match = color.match(/rgb\((\d+),(\d+),(\d+)\)/);
    const r = parseInt(match![1]);
    const g = parseInt(match![2]);
    const b = parseInt(match![3]);
    expect(r).toBeGreaterThan(59);
    expect(r).toBeLessThan(234);
  });

  it("three-quarter point produces valid yellow-red interpolation", () => {
    const color = scoreToColor(75, 0, 100);
    // t=0.75, in yellow-red range (t >= 0.5)
    expect(color).toMatch(/^rgb\(\d+,\d+,\d+\)$/);
    const match = color.match(/rgb\((\d+),(\d+),(\d+)\)/);
    const r = parseInt(match![1]);
    const g = parseInt(match![2]);
    expect(r).toBeGreaterThanOrEqual(234);
    expect(g).toBeLessThan(179);
  });
});

describe("QA — AC4: buildHeatMap adversarial", () => {
  it("handles empty input", () => {
    expect(buildHeatMap([], 0, 10).size).toBe(0);
  });

  it("handles single node", () => {
    const map = buildHeatMap(
      [{ nodeId: "users:1", table: "users", pk: "1", score: 5 }],
      5,
      5
    );
    expect(map.size).toBe(1);
    expect(map.get("users:1")).toBe("#3b82f6"); // min === max => blue
  });

  it("handles duplicate node IDs — last one wins", () => {
    const nodes = [
      { nodeId: "users:1", table: "users", pk: "1", score: 0 },
      { nodeId: "users:1", table: "users", pk: "1", score: 10 },
    ];
    const map = buildHeatMap(nodes, 0, 10);
    expect(map.size).toBe(1);
    // The second (score=10) should overwrite
    expect(map.get("users:1")).toBe("rgb(239,68,68)");
  });

  it("correctly maps min score to blue and max to red", () => {
    const nodes = [
      { nodeId: "a:1", table: "a", pk: "1", score: 0 },
      { nodeId: "a:2", table: "a", pk: "2", score: 50 },
      { nodeId: "a:3", table: "a", pk: "3", score: 100 },
    ];
    const map = buildHeatMap(nodes, 0, 100);
    expect(map.get("a:1")).toBe("rgb(59,130,246)");
    expect(map.get("a:2")).toBe("rgb(234,179,8)");
    expect(map.get("a:3")).toBe("rgb(239,68,68)");
  });
});

// ---------------------------------------------------------------------------
// AC5: Export to CSV functional
// ---------------------------------------------------------------------------
describe("QA — AC5: CSV export data integrity", () => {
  it("parseAlgorithmResult preserves raw columns for export", () => {
    const algo = getAlgorithm("pagerank")!;
    const data = {
      columns: ["node", "score"],
      rows: [
        ["users:1", 0.35],
        ["users:2", 0.65],
      ] as (string | number | boolean | null)[][],
    };
    const result = parseAlgorithmResult(algo, data);
    expect(result.columns).toEqual(["node", "score"]);
    expect(result.rows).toEqual(data.rows);
  });

  it("parseAlgorithmResult preserves null values in raw rows", () => {
    const algo = getAlgorithm("pagerank")!;
    const data = {
      columns: ["node", "score"],
      rows: [[null, null]] as (string | number | boolean | null)[][],
    };
    const result = parseAlgorithmResult(algo, data);
    expect(result.rows[0][0]).toBeNull();
    expect(result.rows[0][1]).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// computeStats adversarial
// ---------------------------------------------------------------------------
describe("QA — computeStats adversarial", () => {
  it("handles single value", () => {
    const stats = computeStats([42]);
    expect(stats.min).toBe(42);
    expect(stats.max).toBe(42);
    expect(stats.mean).toBe(42);
    expect(stats.median).toBe(42);
    expect(stats.count).toBe(1);
  });

  it("handles two values — even-length median", () => {
    const stats = computeStats([10, 20]);
    expect(stats.median).toBe(15);
  });

  it("handles all zeros", () => {
    const stats = computeStats([0, 0, 0]);
    expect(stats.min).toBe(0);
    expect(stats.max).toBe(0);
    expect(stats.mean).toBe(0);
    expect(stats.median).toBe(0);
  });

  it("handles all negative values", () => {
    const stats = computeStats([-5, -3, -1]);
    expect(stats.min).toBe(-5);
    expect(stats.max).toBe(-1);
    expect(stats.mean).toBeCloseTo(-3);
    expect(stats.median).toBe(-3);
  });

  it("handles mixed positive and negative", () => {
    const stats = computeStats([-10, 0, 10]);
    expect(stats.min).toBe(-10);
    expect(stats.max).toBe(10);
    expect(stats.mean).toBeCloseTo(0);
    expect(stats.median).toBe(0);
  });

  it("handles very large numbers", () => {
    const stats = computeStats([1e15, 2e15, 3e15]);
    expect(stats.min).toBe(1e15);
    expect(stats.max).toBe(3e15);
    expect(stats.mean).toBeCloseTo(2e15);
  });

  it("handles very small numbers (near zero)", () => {
    const stats = computeStats([0.0001, 0.0002, 0.0003]);
    expect(stats.min).toBeCloseTo(0.0001);
    expect(stats.max).toBeCloseTo(0.0003);
    expect(stats.mean).toBeCloseTo(0.0002);
  });

  it("does not mutate input array", () => {
    const input = [5, 1, 3, 2, 4];
    const original = [...input];
    computeStats(input);
    expect(input).toEqual(original);
  });

  it("handles NaN in scores — produces NaN stats", () => {
    const stats = computeStats([NaN, 1, 2]);
    // NaN pollutes sort and arithmetic
    // This verifies the behavior — NaN in input produces NaN stats
    expect(Number.isNaN(stats.mean)).toBe(true);
  });

  it("handles Infinity in scores", () => {
    const stats = computeStats([0, Infinity, 1]);
    expect(stats.max).toBe(Infinity);
    expect(stats.mean).toBe(Infinity);
  });
});

// ---------------------------------------------------------------------------
// buildAlgorithmSQL adversarial
// ---------------------------------------------------------------------------
describe("QA — buildAlgorithmSQL adversarial", () => {
  it("builds SQL for each of the 13 algorithms without throwing", () => {
    for (const algo of ALGORITHMS) {
      const defaultParams: Record<string, string | number> = {};
      for (const p of algo.params) {
        defaultParams[p.name] = p.default;
      }
      expect(() => buildAlgorithmSQL(algo, "testdb", defaultParams)).not.toThrow();
    }
  });

  it("handles missing params by using defaults", () => {
    const algo = getAlgorithm("pagerank")!;
    const sql = buildAlgorithmSQL(algo, "testdb", {});
    // Defaults: iterations=20, damping=0.85, tolerance=0.0001
    expect(sql).toContain("ITERATIONS 20");
    expect(sql).toContain("DAMPING 0.85");
    expect(sql).toContain("TOLERANCE 0.0001");
  });

  it("handles unknown direction gracefully — defaults to BOTH", () => {
    const algo = getAlgorithm("betweenness_centrality")!;
    const sql = buildAlgorithmSQL(algo, "testdb", { direction: "unknown" });
    expect(sql).toContain("DIRECTION BOTH");
  });

  it("handles unknown variant gracefully — defaults to TOTAL", () => {
    const algo = getAlgorithm("degree_centrality")!;
    const sql = buildAlgorithmSQL(algo, "testdb", { variant: "unknown" });
    expect(sql).toContain("VARIANT TOTAL");
  });

  it("builds Weighted Shortest Path with empty table names (defaults to 't')", () => {
    const algo = getAlgorithm("weighted_shortest_path")!;
    const sql = buildAlgorithmSQL(algo, "testdb", {
      source_table: "",
      source_id: 1,
      target_table: "",
      target_id: 1,
      weight_property: "weight",
    });
    // Empty tables now default to "t" via quoteIdent fallback (GDB-556 fix)
    expect(sql).toContain('"t"');
  });

  it("Weighted Shortest Path — special characters in weight_property throws", () => {
    const algo = getAlgorithm("weighted_shortest_path")!;
    // GDB-556 fix: weight_property is now validated via quoteIdent
    expect(() =>
      buildAlgorithmSQL(algo, "testdb", {
        source_table: "users",
        source_id: 1,
        target_table: "posts",
        target_id: 2,
        weight_property: "cost; DROP TABLE users",
      })
    ).toThrow(/Invalid identifier/);
  });

  it("handles negative iteration count", () => {
    const algo = getAlgorithm("pagerank")!;
    const sql = buildAlgorithmSQL(algo, "testdb", {
      iterations: -1,
      damping: 0.85,
      tolerance: 0.0001,
    });
    expect(sql).toContain("ITERATIONS -1");
  });

  it("handles zero iterations", () => {
    const algo = getAlgorithm("pagerank")!;
    const sql = buildAlgorithmSQL(algo, "testdb", {
      iterations: 0,
      damping: 0.85,
      tolerance: 0.0001,
    });
    expect(sql).toContain("ITERATIONS 0");
  });

  it("handles damping factor outside 0-1 range", () => {
    const algo = getAlgorithm("pagerank")!;
    const sql = buildAlgorithmSQL(algo, "testdb", {
      iterations: 20,
      damping: 5.0,
      tolerance: 0.0001,
    });
    expect(sql).toContain("DAMPING 5");
  });

  it("handles NaN in numeric params", () => {
    const algo = getAlgorithm("pagerank")!;
    const sql = buildAlgorithmSQL(algo, "testdb", {
      iterations: NaN,
      damping: 0.85,
      tolerance: 0.0001,
    });
    expect(sql).toContain("ITERATIONS NaN");
  });

  it("Weighted Shortest Path — special chars in table name throws", () => {
    const algo = getAlgorithm("weighted_shortest_path")!;
    // GDB-556 fix: table names are now validated via quoteIdent
    expect(() =>
      buildAlgorithmSQL(algo, "testdb", {
        source_table: 'users"; DROP TABLE users; --',
        source_id: 1,
        target_table: "posts",
        target_id: 2,
        weight_property: "weight",
      })
    ).toThrow(/Invalid identifier/);
  });
});

// ---------------------------------------------------------------------------
// formatScore adversarial
// ---------------------------------------------------------------------------
describe("QA — formatScore adversarial", () => {
  it("formats 0 as integer", () => {
    expect(formatScore(0)).toBe("0");
  });

  it("formats negative integer", () => {
    expect(formatScore(-42)).toBe("-42");
  });

  it("formats negative decimal", () => {
    expect(formatScore(-0.5678)).toBe("-0.5678");
  });

  it("formats very small positive number in scientific notation", () => {
    expect(formatScore(0.00001)).toBe("1.00e-5");
  });

  it("formats very small negative number in scientific notation", () => {
    expect(formatScore(-0.00001)).toBe("-1.00e-5");
  });

  it("formats large integer", () => {
    expect(formatScore(1000000)).toBe("1000000");
  });

  it("formats NaN", () => {
    const result = formatScore(NaN);
    expect(result).toBe("NaN");
  });

  it("formats Infinity", () => {
    const result = formatScore(Infinity);
    expect(result).toBe("Infinity");
  });

  it("formats -Infinity", () => {
    const result = formatScore(-Infinity);
    expect(result).toBe("-Infinity");
  });

  it("formats number at boundary (0.0001 exactly)", () => {
    expect(formatScore(0.0001)).toBe("0.0001");
  });

  it("formats number just below boundary (0.00009999)", () => {
    expect(formatScore(0.00009999)).toBe("1.00e-4");
  });
});

// ---------------------------------------------------------------------------
// API route adversarial — via buildAlgorithmSQL for all 13 algorithms
// ---------------------------------------------------------------------------
describe("QA — buildAlgorithmSQL for all 13 algorithms with default params", () => {
  it.each(ALGORITHMS.map((a) => a.id))("builds valid SQL for %s", (id) => {
    const algo = getAlgorithm(id as any)!;
    const defaultParams: Record<string, string | number> = {};
    for (const p of algo.params) {
      defaultParams[p.name] = p.default;
    }
    const sql = buildAlgorithmSQL(algo, "testdb", defaultParams);
    expect(sql.length).toBeGreaterThan(0);
    // All non-shortest-path algorithms should start with CALL
    if (id !== "weighted_shortest_path") {
      expect(sql).toMatch(/^CALL /);
    } else {
      expect(sql).toMatch(/^SHORTEST PATH /);
    }
  });
});
