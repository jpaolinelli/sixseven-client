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

describe("parseAlgorithmNodeId", () => {
  it("parses table:pk format", () => {
    expect(parseAlgorithmNodeId("users:42")).toEqual({ table: "users", pk: "42" });
  });

  it("handles plain pk without table", () => {
    expect(parseAlgorithmNodeId("42")).toEqual({ table: "", pk: "42" });
  });

  it("handles id with multiple colons", () => {
    expect(parseAlgorithmNodeId("items:a:b")).toEqual({ table: "items", pk: "a:b" });
  });

  it("handles empty string", () => {
    expect(parseAlgorithmNodeId("")).toEqual({ table: "", pk: "" });
  });
});

describe("computeStats", () => {
  it("computes stats for a normal array", () => {
    const stats = computeStats([1, 2, 3, 4, 5]);
    expect(stats.min).toBe(1);
    expect(stats.max).toBe(5);
    expect(stats.mean).toBe(3);
    expect(stats.median).toBe(3);
    expect(stats.count).toBe(5);
  });

  it("computes stats for empty array", () => {
    const stats = computeStats([]);
    expect(stats.min).toBe(0);
    expect(stats.max).toBe(0);
    expect(stats.mean).toBe(0);
    expect(stats.median).toBe(0);
    expect(stats.count).toBe(0);
  });

  it("computes correct median for even-length array", () => {
    const stats = computeStats([1, 2, 3, 4]);
    expect(stats.median).toBe(2.5);
  });

  it("handles single element", () => {
    const stats = computeStats([7]);
    expect(stats.min).toBe(7);
    expect(stats.max).toBe(7);
    expect(stats.mean).toBe(7);
    expect(stats.median).toBe(7);
    expect(stats.count).toBe(1);
  });

  it("handles duplicate values", () => {
    const stats = computeStats([5, 5, 5]);
    expect(stats.min).toBe(5);
    expect(stats.max).toBe(5);
    expect(stats.mean).toBe(5);
    expect(stats.median).toBe(5);
  });

  it("handles unsorted input", () => {
    const stats = computeStats([5, 1, 3, 2, 4]);
    expect(stats.min).toBe(1);
    expect(stats.max).toBe(5);
    expect(stats.mean).toBe(3);
    expect(stats.median).toBe(3);
  });

  it("handles negative values", () => {
    const stats = computeStats([-3, -1, 0, 2, 4]);
    expect(stats.min).toBe(-3);
    expect(stats.max).toBe(4);
    expect(stats.mean).toBeCloseTo(0.4);
    expect(stats.median).toBe(0);
  });
});

describe("scoreToColor", () => {
  it("returns blue for minimum score", () => {
    const color = scoreToColor(0, 0, 10);
    expect(color).toBe("rgb(59,130,246)");
  });

  it("returns red for maximum score", () => {
    const color = scoreToColor(10, 0, 10);
    expect(color).toBe("rgb(239,68,68)");
  });

  it("returns yellow-ish for middle score", () => {
    const color = scoreToColor(5, 0, 10);
    expect(color).toBe("rgb(234,179,8)");
  });

  it("returns blue when min equals max", () => {
    expect(scoreToColor(5, 5, 5)).toBe("#3b82f6");
  });

  it("clamps below minimum to blue", () => {
    const color = scoreToColor(-5, 0, 10);
    expect(color).toBe("rgb(59,130,246)");
  });

  it("clamps above maximum to red", () => {
    const color = scoreToColor(15, 0, 10);
    expect(color).toBe("rgb(239,68,68)");
  });
});

describe("buildHeatMap", () => {
  it("builds a map from node IDs to colors", () => {
    const nodes = [
      { nodeId: "users:1", table: "users", pk: "1", score: 0 },
      { nodeId: "users:2", table: "users", pk: "2", score: 10 },
    ];
    const map = buildHeatMap(nodes, 0, 10);
    expect(map.size).toBe(2);
    expect(map.get("users:1")).toBe("rgb(59,130,246)");
    expect(map.get("users:2")).toBe("rgb(239,68,68)");
  });

  it("returns empty map for empty input", () => {
    const map = buildHeatMap([], 0, 10);
    expect(map.size).toBe(0);
  });
});

describe("parseAlgorithmResult", () => {
  const pageRankAlgo = getAlgorithm("pagerank")!;

  it("parses results with node and score columns", () => {
    const data = {
      columns: ["node", "score"],
      rows: [
        ["users:1", 0.35],
        ["users:2", 0.65],
      ] as (string | number | boolean | null)[][],
    };

    const result = parseAlgorithmResult(pageRankAlgo, data);
    expect(result.algorithmId).toBe("pagerank");
    expect(result.algorithmName).toBe("PageRank");
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0].nodeId).toBe("users:1");
    expect(result.nodes[0].score).toBe(0.35);
    expect(result.nodes[1].nodeId).toBe("users:2");
    expect(result.nodes[1].score).toBe(0.65);
    expect(result.stats.min).toBe(0.35);
    expect(result.stats.max).toBe(0.65);
  });

  it("handles case-insensitive column names", () => {
    const data = {
      columns: ["Node", "Score"],
      rows: [["users:1", 0.5]] as (string | number | boolean | null)[][],
    };

    const result = parseAlgorithmResult(pageRankAlgo, data);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].score).toBe(0.5);
  });

  it("handles empty rows", () => {
    const data = {
      columns: ["node", "score"],
      rows: [] as (string | number | boolean | null)[][],
    };

    const result = parseAlgorithmResult(pageRankAlgo, data);
    expect(result.nodes).toHaveLength(0);
    expect(result.stats.count).toBe(0);
  });

  it("handles null values as 0", () => {
    const data = {
      columns: ["node", "score"],
      rows: [["users:1", null]] as (string | number | boolean | null)[][],
    };

    const result = parseAlgorithmResult(pageRankAlgo, data);
    expect(result.nodes[0].score).toBe(0);
  });

  it("parses connected components with component column", () => {
    const algo = getAlgorithm("connected_components")!;
    const data = {
      columns: ["node", "component"],
      rows: [
        ["users:1", 0],
        ["users:2", 1],
        ["users:3", 0],
      ] as (string | number | boolean | null)[][],
    };

    const result = parseAlgorithmResult(algo, data);
    expect(result.nodes).toHaveLength(3);
    expect(result.nodes[0].score).toBe(0);
    expect(result.nodes[1].score).toBe(1);
  });
});

describe("buildAlgorithmSQL", () => {
  it("builds PageRank SQL with all parameters", () => {
    const algo = getAlgorithm("pagerank")!;
    const sql = buildAlgorithmSQL(algo, "social", {
      iterations: 20,
      damping: 0.85,
      tolerance: 0.0001,
    });
    expect(sql).toBe("CALL PAGERANK ITERATIONS 20 DAMPING 0.85 TOLERANCE 0.0001");
  });

  it("builds Betweenness Centrality SQL with direction", () => {
    const algo = getAlgorithm("betweenness_centrality")!;
    const sql = buildAlgorithmSQL(algo, "social", { direction: "out" });
    expect(sql).toBe("CALL BETWEENNESS_CENTRALITY DIRECTION OUT");
  });

  it("builds Connected Components SQL with no params", () => {
    const algo = getAlgorithm("connected_components")!;
    const sql = buildAlgorithmSQL(algo, "social", {});
    expect(sql).toBe("CALL CONNECTED_COMPONENTS");
  });

  it("builds Degree Centrality SQL with variant", () => {
    const algo = getAlgorithm("degree_centrality")!;
    const sql = buildAlgorithmSQL(algo, "social", { variant: "in" });
    expect(sql).toBe("CALL DEGREE_CENTRALITY VARIANT IN");
  });

  it("builds Community Detection SQL with iterations", () => {
    const algo = getAlgorithm("community_detection")!;
    const sql = buildAlgorithmSQL(algo, "social", { iterations: 10 });
    expect(sql).toBe("CALL COMMUNITY_DETECTION ITERATIONS 10");
  });

  it("builds Weighted Shortest Path SQL", () => {
    const algo = getAlgorithm("weighted_shortest_path")!;
    const sql = buildAlgorithmSQL(algo, "social", {
      source_table: "users",
      source_id: 1,
      target_table: "posts",
      target_id: 5,
      weight_property: "cost",
    });
    expect(sql).toBe(
      'SHORTEST PATH FROM "users" WHERE id = 1 TO "posts" WHERE id = 5 WEIGHT cost'
    );
  });

  it("builds Eigenvector Centrality SQL", () => {
    const algo = getAlgorithm("eigenvector_centrality")!;
    const sql = buildAlgorithmSQL(algo, "social", {
      iterations: 50,
      tolerance: 0.001,
    });
    expect(sql).toBe("CALL EIGENVECTOR_CENTRALITY ITERATIONS 50 TOLERANCE 0.001");
  });

  it("uses default direction for closeness centrality", () => {
    const algo = getAlgorithm("closeness_centrality")!;
    const sql = buildAlgorithmSQL(algo, "social", { direction: "both" });
    expect(sql).toBe("CALL CLOSENESS_CENTRALITY DIRECTION BOTH");
  });
});

describe("formatScore", () => {
  it("formats integer as plain number", () => {
    expect(formatScore(42)).toBe("42");
  });

  it("formats decimal to 4 places", () => {
    expect(formatScore(0.123456)).toBe("0.1235");
  });

  it("formats very small numbers in scientific notation", () => {
    expect(formatScore(0.0000001)).toBe("1.00e-7");
  });

  it("formats zero as integer", () => {
    expect(formatScore(0)).toBe("0");
  });
});

describe("getAlgorithm", () => {
  it("returns algorithm by ID", () => {
    const algo = getAlgorithm("pagerank");
    expect(algo).toBeDefined();
    expect(algo!.name).toBe("PageRank");
  });

  it("returns undefined for invalid ID", () => {
    expect(getAlgorithm("not_real" as any)).toBeUndefined();
  });
});

describe("getAlgorithmsByCategory", () => {
  it("groups all algorithms by category", () => {
    const grouped = getAlgorithmsByCategory();
    expect(grouped.size).toBeGreaterThanOrEqual(3);
    expect(grouped.has("centrality")).toBe(true);
    expect(grouped.has("community")).toBe(true);
    expect(grouped.has("path")).toBe(true);
  });

  it("includes all 13 algorithms", () => {
    const grouped = getAlgorithmsByCategory();
    let total = 0;
    grouped.forEach((algos) => {
      total += algos.length;
    });
    expect(total).toBe(13);
  });
});

describe("ALGORITHMS", () => {
  it("has exactly 13 entries", () => {
    expect(ALGORITHMS).toHaveLength(13);
  });

  it("has unique IDs", () => {
    const ids = new Set(ALGORITHMS.map((a) => a.id));
    expect(ids.size).toBe(ALGORITHMS.length);
  });

  it("has unique names", () => {
    const names = new Set(ALGORITHMS.map((a) => a.name));
    expect(names.size).toBe(ALGORITHMS.length);
  });

  it("all have valid categories", () => {
    for (const algo of ALGORITHMS) {
      expect(CATEGORY_LABELS).toHaveProperty(algo.category);
    }
  });

  it("all have non-empty sqlFunction", () => {
    for (const algo of ALGORITHMS) {
      expect(algo.sqlFunction.length).toBeGreaterThan(0);
    }
  });
});
