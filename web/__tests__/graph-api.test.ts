import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the db module before importing the route
vi.mock("@/lib/db", () => ({
  query: vi.fn(),
}));

import { POST } from "@/app/api/graph/route";
import { query } from "@/lib/db";
import { NextRequest } from "next/server";

const mockedQuery = vi.mocked(query);

function makeRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost:3000/api/graph", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function parseResponse(res: Response) {
  return res.json();
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("POST /api/graph", () => {
  describe("validation", () => {
    it("returns 400 when action is missing", async () => {
      const res = await POST(makeRequest({ database: "test" }));
      expect(res.status).toBe(400);
      const body = await parseResponse(res);
      expect(body.error).toContain("action");
    });

    it("returns 400 when database is missing", async () => {
      const res = await POST(makeRequest({ action: "traverse" }));
      expect(res.status).toBe(400);
      const body = await parseResponse(res);
      expect(body.error).toContain("database");
    });

    it("returns 400 for unknown action", async () => {
      const res = await POST(
        makeRequest({ action: "unknown", database: "test" })
      );
      expect(res.status).toBe(400);
      const body = await parseResponse(res);
      expect(body.error).toContain("Unknown action");
    });
  });

  describe("traverse action", () => {
    it("returns 400 when table is missing", async () => {
      const res = await POST(
        makeRequest({ action: "traverse", database: "test", id: "1" })
      );
      expect(res.status).toBe(400);
      const body = await parseResponse(res);
      expect(body.error).toContain("table");
    });

    it("executes TRAVERSE BOTH query by default", async () => {
      mockedQuery.mockResolvedValueOnce({
        columns: ["source_table", "source_id", "edge_type", "target_table", "target_id"],
        rows: [["users", "1", "follows", "users", "2"]],
      });

      const res = await POST(
        makeRequest({
          action: "traverse",
          database: "social",
          table: "users",
          id: "1",
        })
      );
      expect(res.status).toBe(200);
      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining("TRAVERSE BOTH"),
        "social",
        undefined
      );
    });

    it("respects direction parameter", async () => {
      mockedQuery.mockResolvedValueOnce({ columns: [], rows: [] });

      await POST(
        makeRequest({
          action: "traverse",
          database: "social",
          table: "users",
          id: "1",
          direction: "out",
        })
      );
      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining("TRAVERSE OUT"),
        "social",
        undefined
      );
    });

    it("includes edge type when specified", async () => {
      mockedQuery.mockResolvedValueOnce({ columns: [], rows: [] });

      await POST(
        makeRequest({
          action: "traverse",
          database: "social",
          table: "users",
          id: "1",
          edgeType: "follows",
        })
      );
      // quoteIdent validates identifiers without wrapping them in quotes.
      expect(mockedQuery).toHaveBeenCalledWith(
        expect.stringContaining("EDGE follows"),
        "social",
        undefined
      );
    });

    it("rejects table names with SQL injection attempts", async () => {
      // quoteIdent throws on identifiers that don't match [A-Za-z_][A-Za-z0-9_]*
      const res = await POST(
        makeRequest({
          action: "traverse",
          database: "test",
          table: 'users"; DROP TABLE--',
          id: "1",
        })
      );
      expect(res.status).toBe(500);
      // The query should never have been issued.
      expect(mockedQuery).not.toHaveBeenCalled();
    });

    it("handles numeric IDs without quotes", async () => {
      mockedQuery.mockResolvedValueOnce({ columns: [], rows: [] });

      await POST(
        makeRequest({
          action: "traverse",
          database: "test",
          table: "users",
          id: "42",
        })
      );
      const sql = mockedQuery.mock.calls[0][0];
      expect(sql).toContain("id = 42");
    });

    it("quotes string IDs", async () => {
      mockedQuery.mockResolvedValueOnce({ columns: [], rows: [] });

      await POST(
        makeRequest({
          action: "traverse",
          database: "test",
          table: "users",
          id: "alice",
        })
      );
      const sql = mockedQuery.mock.calls[0][0];
      expect(sql).toContain("id = 'alice'");
    });
  });

  describe("shortest_path action", () => {
    it("returns 400 when source/target info is missing", async () => {
      const res = await POST(
        makeRequest({
          action: "shortest_path",
          database: "test",
          sourceTable: "users",
        })
      );
      expect(res.status).toBe(400);
      const body = await parseResponse(res);
      expect(body.error).toContain("source/target");
    });

    it("executes SELECT FROM MATCH ANY SHORTEST PATH by default", async () => {
      mockedQuery.mockResolvedValueOnce({
        columns: ["source_table", "source_id", "edge_type", "target_table", "target_id"],
        rows: [
          ["users", "1", "follows", "users", "3"],
          ["users", "3", "follows", "users", "5"],
        ],
      });

      const res = await POST(
        makeRequest({
          action: "shortest_path",
          database: "social",
          sourceTable: "users",
          sourceId: "1",
          targetTable: "users",
          targetId: "5",
        })
      );
      expect(res.status).toBe(200);
      const sql = mockedQuery.mock.calls[0][0] as string;
      expect(sql).toContain("SELECT * FROM MATCH ANY SHORTEST PATH");
      expect(sql).toContain("s.id = 1");
      expect(sql).toContain("t.id = 5");
    });

    it("supports ALL SHORTEST selector", async () => {
      mockedQuery.mockResolvedValueOnce({ columns: [], rows: [] });

      await POST(
        makeRequest({
          action: "shortest_path",
          database: "social",
          sourceTable: "users",
          sourceId: "1",
          targetTable: "users",
          targetId: "5",
          selector: "all_shortest",
        })
      );
      const sql = mockedQuery.mock.calls[0][0] as string;
      expect(sql).toContain("ALL SHORTEST PATH");
    });

    it("supports SHORTEST K selector with k", async () => {
      mockedQuery.mockResolvedValueOnce({ columns: [], rows: [] });

      await POST(
        makeRequest({
          action: "shortest_path",
          database: "social",
          sourceTable: "users",
          sourceId: "1",
          targetTable: "users",
          targetId: "5",
          selector: "shortest_k",
          k: 3,
        })
      );
      const sql = mockedQuery.mock.calls[0][0] as string;
      expect(sql).toContain("SHORTEST 3 PATH");
    });

    it("rejects shortest_k without a positive k value", async () => {
      const res = await POST(
        makeRequest({
          action: "shortest_path",
          database: "social",
          sourceTable: "users",
          sourceId: "1",
          targetTable: "users",
          targetId: "5",
          selector: "shortest_k",
        })
      );
      expect(res.status).toBe(400);
      const body = await parseResponse(res);
      expect(body.error).toContain("k");
    });

    it("rejects an invalid selector value", async () => {
      const res = await POST(
        makeRequest({
          action: "shortest_path",
          database: "social",
          sourceTable: "users",
          sourceId: "1",
          targetTable: "users",
          targetId: "5",
          selector: "bogus",
        })
      );
      expect(res.status).toBe(400);
      const body = await parseResponse(res);
      expect(body.error).toContain("selector");
    });
  });

  describe("variable_length_traverse action", () => {
    it("returns 400 when table is missing", async () => {
      const res = await POST(
        makeRequest({
          action: "variable_length_traverse",
          database: "test",
          id: "1",
          minDepth: 1,
          maxDepth: 3,
        })
      );
      expect(res.status).toBe(400);
    });

    it("rejects negative depth values", async () => {
      const res = await POST(
        makeRequest({
          action: "variable_length_traverse",
          database: "test",
          table: "users",
          id: "1",
          minDepth: -1,
          maxDepth: 3,
        })
      );
      expect(res.status).toBe(400);
    });

    it("rejects maxDepth < minDepth", async () => {
      const res = await POST(
        makeRequest({
          action: "variable_length_traverse",
          database: "test",
          table: "users",
          id: "1",
          minDepth: 5,
          maxDepth: 2,
        })
      );
      expect(res.status).toBe(400);
      const body = await parseResponse(res);
      expect(body.error).toContain("maxDepth");
    });

    it("emits a hop quantifier in the MATCH SQL", async () => {
      mockedQuery.mockResolvedValueOnce({ columns: [], rows: [] });

      await POST(
        makeRequest({
          action: "variable_length_traverse",
          database: "social",
          table: "users",
          id: "1",
          direction: "out",
          edgeType: "follows",
          minDepth: 2,
          maxDepth: 4,
        })
      );
      const sql = mockedQuery.mock.calls[0][0] as string;
      expect(sql).toContain("FROM MATCH");
      expect(sql).toContain("*2..4");
      expect(sql).toContain(":follows");
      // direction "out" should produce -[...]->
      expect(sql).toMatch(/-\[[^\]]+\]->/);
    });

    it("uses default min=1 max=3 when omitted", async () => {
      mockedQuery.mockResolvedValueOnce({ columns: [], rows: [] });

      await POST(
        makeRequest({
          action: "variable_length_traverse",
          database: "social",
          table: "users",
          id: "1",
        })
      );
      const sql = mockedQuery.mock.calls[0][0] as string;
      expect(sql).toContain("*1..3");
    });
  });

  describe("node_details action", () => {
    it("returns 400 when table or id is missing", async () => {
      const res = await POST(
        makeRequest({
          action: "node_details",
          database: "test",
          table: "users",
        })
      );
      expect(res.status).toBe(400);
      const body = await parseResponse(res);
      expect(body.error).toContain("table");
    });

    it("executes SELECT query for node details", async () => {
      mockedQuery.mockResolvedValueOnce({
        columns: ["id", "name", "email"],
        rows: [["1", "Alice", "alice@example.com"]],
      });

      const res = await POST(
        makeRequest({
          action: "node_details",
          database: "social",
          table: "users",
          id: "1",
        })
      );
      expect(res.status).toBe(200);
      const body = await parseResponse(res);
      expect(body.columns).toEqual(["id", "name", "email"]);
      expect(body.rows).toHaveLength(1);
    });
  });

  describe("error handling", () => {
    it("returns 500 when database query fails", async () => {
      mockedQuery.mockRejectedValueOnce(new Error("Connection refused"));

      const res = await POST(
        makeRequest({
          action: "traverse",
          database: "social",
          table: "users",
          id: "1",
        })
      );
      expect(res.status).toBe(500);
      const body = await parseResponse(res);
      expect(body.error).toContain("Connection refused");
    });
  });
});
