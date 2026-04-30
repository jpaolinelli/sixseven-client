import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  pathColor,
  PATH_HIGHLIGHT_COLORS,
  buildShortestPathSql,
  buildVariableLengthMatchSql,
  parsePathSet,
  pathSetToHighlightMaps,
  variableLengthTraverse,
  findShortestPathsWithSelector,
} from "@/lib/graph-utils";
import type { PathSelector } from "@/lib/graph-types";

describe("pathColor", () => {
  it("returns colors from the highlight palette", () => {
    expect(PATH_HIGHLIGHT_COLORS).toContain(pathColor(0));
    expect(PATH_HIGHLIGHT_COLORS).toContain(pathColor(3));
  });

  it("cycles through the palette for large indices", () => {
    expect(pathColor(0)).toBe(pathColor(PATH_HIGHLIGHT_COLORS.length));
    expect(pathColor(1)).toBe(pathColor(PATH_HIGHLIGHT_COLORS.length + 1));
  });

  it("returns the first color for negative or non-finite indices", () => {
    expect(pathColor(-1)).toBe(PATH_HIGHLIGHT_COLORS[0]);
    expect(pathColor(NaN)).toBe(PATH_HIGHLIGHT_COLORS[0]);
  });
});

describe("buildShortestPathSql", () => {
  it("emits ANY SHORTEST PATH for any_shortest", () => {
    const sql = buildShortestPathSql(
      "users",
      "1",
      "users",
      "5",
      "any_shortest"
    );
    expect(sql).toContain("SELECT * FROM MATCH ANY SHORTEST PATH");
    expect(sql).toContain("s.id = 1");
    expect(sql).toContain("t.id = 5");
  });

  it("emits ALL SHORTEST PATH for all_shortest", () => {
    const sql = buildShortestPathSql(
      "users",
      "1",
      "users",
      "5",
      "all_shortest"
    );
    expect(sql).toContain("ALL SHORTEST PATH");
  });

  it("emits SHORTEST K PATH for shortest_k", () => {
    const sql = buildShortestPathSql("a", "1", "b", "2", "shortest_k", 4);
    expect(sql).toContain("SHORTEST 4 PATH");
  });

  it("defaults k to 1 when missing for shortest_k", () => {
    const sql = buildShortestPathSql("a", "1", "b", "2", "shortest_k");
    expect(sql).toContain("SHORTEST 1 PATH");
  });

  it("quotes string ids", () => {
    const sql = buildShortestPathSql(
      "users",
      "alice",
      "users",
      "bob",
      "any_shortest"
    );
    expect(sql).toContain("s.id = 'alice'");
    expect(sql).toContain("t.id = 'bob'");
  });

  it("escapes single quotes in id literals", () => {
    const sql = buildShortestPathSql(
      "users",
      "o'brien",
      "users",
      "1",
      "any_shortest"
    );
    expect(sql).toContain("s.id = 'o''brien'");
  });
});

describe("buildVariableLengthMatchSql", () => {
  it("includes the *min..max hop quantifier", () => {
    const sql = buildVariableLengthMatchSql(
      "users",
      "1",
      "out",
      { minDepth: 1, maxDepth: 3 }
    );
    expect(sql).toContain("*1..3");
  });

  it("uses outgoing arrow for direction=out", () => {
    const sql = buildVariableLengthMatchSql(
      "users",
      "1",
      "out",
      { minDepth: 1, maxDepth: 2 }
    );
    expect(sql).toMatch(/-\[[^\]]+\]->/);
  });

  it("uses incoming arrow for direction=in", () => {
    const sql = buildVariableLengthMatchSql(
      "users",
      "1",
      "in",
      { minDepth: 1, maxDepth: 2 }
    );
    expect(sql).toContain("<-[");
  });

  it("includes edge type when provided", () => {
    const sql = buildVariableLengthMatchSql(
      "users",
      "1",
      "both",
      { minDepth: 1, maxDepth: 2 },
      "follows"
    );
    expect(sql).toContain(":follows");
  });

  it("clamps maxDepth to be >= minDepth", () => {
    const sql = buildVariableLengthMatchSql(
      "users",
      "1",
      "both",
      { minDepth: 5, maxDepth: 2 }
    );
    expect(sql).toContain("*5..5");
  });
});

describe("parsePathSet", () => {
  const cols = [
    "path_id",
    "hop",
    "source_table",
    "source_id",
    "edge_type",
    "target_table",
    "target_id",
  ];

  it("returns an empty PathSet when source/target columns are missing", () => {
    const result = parsePathSet("any_shortest", {
      columns: ["foo", "bar"],
      rows: [["a", "b"]],
    });
    expect(result.selector).toBe("any_shortest");
    expect(result.paths).toEqual([]);
  });

  it("parses a single 2-hop path", () => {
    const result = parsePathSet("any_shortest", {
      columns: cols,
      rows: [
        ["1", 0, "users", "1", "follows", "users", "3"],
        ["1", 1, "users", "3", "follows", "users", "5"],
      ],
    });
    expect(result.paths).toHaveLength(1);
    expect(result.paths[0].length).toBe(2);
    expect(result.paths[0].nodeIds).toEqual([
      "users:1",
      "users:3",
      "users:5",
    ]);
    expect(result.paths[0].edgeIds).toEqual([
      "users:1->follows->users:3",
      "users:3->follows->users:5",
    ]);
  });

  it("groups multiple paths by path_id", () => {
    const result = parsePathSet("all_shortest", {
      columns: cols,
      rows: [
        ["1", 0, "users", "1", "follows", "users", "3"],
        ["1", 1, "users", "3", "follows", "users", "5"],
        ["2", 0, "users", "1", "knows", "users", "4"],
        ["2", 1, "users", "4", "knows", "users", "5"],
      ],
    });
    expect(result.paths).toHaveLength(2);
    expect(result.paths[0].id).toBe("1");
    expect(result.paths[1].id).toBe("2");
    expect(result.paths[1].nodeIds).toEqual([
      "users:1",
      "users:4",
      "users:5",
    ]);
  });

  it("sorts hops within a path by hop index", () => {
    const result = parsePathSet("any_shortest", {
      columns: cols,
      rows: [
        // Out of order on purpose
        ["1", 1, "users", "3", "follows", "users", "5"],
        ["1", 0, "users", "1", "follows", "users", "3"],
      ],
    });
    expect(result.paths[0].nodeIds).toEqual([
      "users:1",
      "users:3",
      "users:5",
    ]);
  });

  it("treats rows without path_id as a single path", () => {
    const colsNoPid = [
      "source_table",
      "source_id",
      "edge_type",
      "target_table",
      "target_id",
    ];
    const result = parsePathSet("any_shortest", {
      columns: colsNoPid,
      rows: [
        ["users", "1", "follows", "users", "3"],
        ["users", "3", "follows", "users", "5"],
      ],
    });
    expect(result.paths).toHaveLength(1);
    expect(result.paths[0].length).toBe(2);
  });

  it("handles an empty result", () => {
    const result = parsePathSet("any_shortest", { columns: cols, rows: [] });
    expect(result.paths).toEqual([]);
  });
});

describe("pathSetToHighlightMaps", () => {
  it("assigns distinct colors to each path", () => {
    const pathSet = parsePathSet("all_shortest", {
      columns: [
        "path_id",
        "hop",
        "source_table",
        "source_id",
        "edge_type",
        "target_table",
        "target_id",
      ],
      rows: [
        ["1", 0, "u", "1", "e", "u", "2"],
        ["2", 0, "u", "1", "e", "u", "3"],
      ],
    });
    const { nodeColors, edgeColors } = pathSetToHighlightMaps(pathSet);
    // Both paths share node u:1, so the first path's color wins
    const path1Color = pathColor(0);
    const path2Color = pathColor(1);
    expect(nodeColors.get("u:1")).toBe(path1Color);
    expect(nodeColors.get("u:2")).toBe(path1Color);
    expect(nodeColors.get("u:3")).toBe(path2Color);
    expect(edgeColors.size).toBe(2);
    expect(edgeColors.get("u:1->e->u:2")).toBe(path1Color);
    expect(edgeColors.get("u:1->e->u:3")).toBe(path2Color);
  });

  it("returns empty maps for an empty PathSet", () => {
    const { nodeColors, edgeColors } = pathSetToHighlightMaps({
      selector: "any_shortest",
      paths: [],
    });
    expect(nodeColors.size).toBe(0);
    expect(edgeColors.size).toBe(0);
  });
});

describe("API client helpers", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("variableLengthTraverse posts the new action with min/max depth", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ columns: [], rows: [] }),
    });

    await variableLengthTraverse(
      "social",
      "users",
      "1",
      "out",
      0,
      { minDepth: 1, maxDepth: 4 },
      "follows"
    );

    const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.action).toBe("variable_length_traverse");
    expect(body.minDepth).toBe(1);
    expect(body.maxDepth).toBe(4);
    expect(body.edgeType).toBe("follows");
    expect(body.direction).toBe("out");
  });

  it("findShortestPathsWithSelector includes selector and k in the request", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ columns: [], rows: [] }),
    });

    const selector: PathSelector = "shortest_k";
    await findShortestPathsWithSelector(
      "social",
      "users",
      "1",
      "users",
      "5",
      selector,
      3
    );

    const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.action).toBe("shortest_path");
    expect(body.selector).toBe("shortest_k");
    expect(body.k).toBe(3);
  });

  it("variableLengthTraverse throws when the API returns non-OK", async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "boom",
    });

    await expect(
      variableLengthTraverse("social", "users", "1", "out", 0, {
        minDepth: 1,
        maxDepth: 2,
      })
    ).rejects.toThrow(/500/);
  });
});
