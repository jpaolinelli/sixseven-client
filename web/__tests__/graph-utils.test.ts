import { describe, it, expect } from "vitest";
import {
  makeNodeId,
  tableColor,
  parseNodeId,
  buildVariableLengthMatchSql,
} from "@/lib/graph-utils";

describe("makeNodeId", () => {
  it("combines table and id with colon separator", () => {
    expect(makeNodeId("users", "42")).toBe("users:42");
  });

  it("handles empty table name", () => {
    expect(makeNodeId("", "1")).toBe(":1");
  });

  it("handles empty id", () => {
    expect(makeNodeId("users", "")).toBe("users:");
  });

  it("preserves special characters in table/id", () => {
    expect(makeNodeId("my-table", "abc-123")).toBe("my-table:abc-123");
  });
});

describe("parseNodeId", () => {
  it("splits on first colon", () => {
    expect(parseNodeId("users:42")).toEqual({ table: "users", pk: "42" });
  });

  it("handles id containing colons", () => {
    expect(parseNodeId("items:a:b:c")).toEqual({ table: "items", pk: "a:b:c" });
  });

  it("handles no colon (fallback)", () => {
    expect(parseNodeId("foobar")).toEqual({ table: "foobar", pk: "" });
  });

  it("handles empty string", () => {
    expect(parseNodeId("")).toEqual({ table: "", pk: "" });
  });

  it("roundtrips with makeNodeId", () => {
    const id = makeNodeId("products", "99");
    const parsed = parseNodeId(id);
    expect(parsed.table).toBe("products");
    expect(parsed.pk).toBe("99");
  });
});

describe("buildVariableLengthMatchSql", () => {
  const cfg = { minDepth: 1, maxDepth: 3 };

  it("should emit outgoing arrow for direction='out'", () => {
    const sql = buildVariableLengthMatchSql("users", "1", "out", cfg);
    expect(sql).toContain("-[r*1..3]->(t)");
    expect(sql).not.toContain("<-");
  });

  it("should emit incoming arrow for direction='in'", () => {
    const sql = buildVariableLengthMatchSql("users", "1", "in", cfg);
    expect(sql).toContain("<-[r*1..3]-(t)");
    expect(sql).not.toContain("->");
  });

  it("should emit undirected pattern for direction='both'", () => {
    const sql = buildVariableLengthMatchSql("users", "1", "both", cfg);
    expect(sql).toContain("-[r*1..3]-(t)");
    expect(sql).not.toContain("->");
    expect(sql).not.toContain("<-");
  });

  it("should include edge type when provided", () => {
    const sql = buildVariableLengthMatchSql("users", "1", "out", cfg, "follows");
    expect(sql).toContain(":follows");
  });

  it("should quote string id values", () => {
    const sql = buildVariableLengthMatchSql("users", "alice", "out", cfg);
    expect(sql).toContain("'alice'");
  });

  it("should pass numeric id values unquoted", () => {
    const sql = buildVariableLengthMatchSql("users", "42", "out", cfg);
    expect(sql).toContain("s.id = 42");
  });

  it("should produce consistent arrows across all three directions", () => {
    const outSql = buildVariableLengthMatchSql("t", "1", "out", { minDepth: 2, maxDepth: 4 });
    const inSql = buildVariableLengthMatchSql("t", "1", "in", { minDepth: 2, maxDepth: 4 });
    const bothSql = buildVariableLengthMatchSql("t", "1", "both", { minDepth: 2, maxDepth: 4 });

    // out: -[...]->
    expect(outSql).toMatch(/-\[r\*2\.\.4\]->/);
    // in: <-[...]-
    expect(inSql).toMatch(/<-\[r\*2\.\.4\]-/);
    expect(inSql).not.toMatch(/-\[r\*2\.\.4\]->/);
    // both: -[...]-  (no arrows)
    expect(bothSql).toMatch(/-\[r\*2\.\.4\]-\(/);
    expect(bothSql).not.toMatch(/<-/);
    expect(bothSql).not.toMatch(/->/);
  });
});

describe("tableColor", () => {
  it("returns a hex color string", () => {
    const color = tableColor("users");
    expect(color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("returns deterministic color for same table", () => {
    expect(tableColor("orders")).toBe(tableColor("orders"));
  });

  it("returns different colors for different tables", () => {
    // Not guaranteed but very likely for these names
    const colors = new Set([
      tableColor("users"),
      tableColor("products"),
      tableColor("orders"),
      tableColor("reviews"),
      tableColor("categories"),
    ]);
    // Should get at least 2 distinct colors from 5 different names
    expect(colors.size).toBeGreaterThanOrEqual(2);
  });

  it("handles empty string", () => {
    const color = tableColor("");
    expect(color).toMatch(/^#[0-9a-f]{6}$/);
  });
});
