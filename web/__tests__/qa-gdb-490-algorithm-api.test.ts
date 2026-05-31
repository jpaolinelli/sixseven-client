/**
 * QA adversarial tests for GDB-490: Graph Algorithm API route
 *
 * Tests error handling, edge cases, and all 13 algorithm paths
 * through the POST /api/graph algorithm action.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  query: vi.fn(),
}));

import { POST } from "@/app/api/graph/route";
import { query } from "@/lib/db";
import { NextRequest } from "next/server";
import { ALGORITHMS } from "@/lib/algorithm-types";

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
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------
describe("QA — API algorithm action error handling", () => {
  it("returns 400 when action is algorithm but algorithm field is missing", async () => {
    const res = await POST(
      makeRequest({ action: "algorithm", database: "test" })
    );
    expect(res.status).toBe(400);
    const body = await parseResponse(res);
    expect(body.error).toBeDefined();
  });

  it("returns 400 when algorithm field is empty string", async () => {
    const res = await POST(
      makeRequest({ action: "algorithm", database: "test", algorithm: "" })
    );
    expect(res.status).toBe(400);
  });

  it("returns 400 for unknown algorithm ID", async () => {
    const res = await POST(
      makeRequest({
        action: "algorithm",
        database: "test",
        algorithm: "fake_algorithm",
      })
    );
    expect(res.status).toBe(400);
    const body = await parseResponse(res);
    expect(body.error).toContain("Unknown algorithm");
  });

  it("returns 400 when database is missing", async () => {
    const res = await POST(
      makeRequest({ action: "algorithm", algorithm: "pagerank" })
    );
    expect(res.status).toBe(400);
  });

  it("returns 500 when query throws", async () => {
    mockedQuery.mockRejectedValueOnce(new Error("Connection timeout"));
    const res = await POST(
      makeRequest({
        action: "algorithm",
        database: "test",
        algorithm: "pagerank",
      })
    );
    expect(res.status).toBe(500);
    const body = await parseResponse(res);
    expect(body.error).toContain("Connection timeout");
  });

  it("returns 500 when query throws non-Error", async () => {
    mockedQuery.mockRejectedValueOnce("raw string error");
    const res = await POST(
      makeRequest({
        action: "algorithm",
        database: "test",
        algorithm: "pagerank",
      })
    );
    expect(res.status).toBe(500);
  });
});

// ---------------------------------------------------------------------------
// All 13 algorithms execute via API
// ---------------------------------------------------------------------------
describe("QA — API executes all 13 algorithms", () => {
  it.each(ALGORITHMS.map((a) => [a.id, a.sqlFunction]))(
    "executes %s (SQL: %s)",
    async (id, sqlFunc) => {
      mockedQuery.mockResolvedValueOnce({
        columns: ["node", "score"],
        rows: [["users:1", 0.5]],
      });

      const res = await POST(
        makeRequest({
          action: "algorithm",
          database: "testdb",
          algorithm: id,
        })
      );

      expect(res.status).toBe(200);
      const calledSQL = mockedQuery.mock.calls[0][0];
      expect(typeof calledSQL).toBe("string");
      expect(calledSQL.length).toBeGreaterThan(0);
    }
  );
});

// ---------------------------------------------------------------------------
// Parameter passing
// ---------------------------------------------------------------------------
describe("QA — API algorithm parameter passing", () => {
  it("passes custom PageRank params into SQL", async () => {
    mockedQuery.mockResolvedValueOnce({
      columns: ["node", "score"],
      rows: [["a:1", 0.1]],
    });

    await POST(
      makeRequest({
        action: "algorithm",
        database: "testdb",
        algorithm: "pagerank",
        params: { iterations: 100, damping: 0.9, tolerance: 0.001 },
      })
    );

    const sql = mockedQuery.mock.calls[0][0];
    expect(sql).toContain("ITERATIONS 100");
    expect(sql).toContain("DAMPING 0.9");
    expect(sql).toContain("TOLERANCE 0.001");
  });

  it("uses default params when params object is empty", async () => {
    mockedQuery.mockResolvedValueOnce({
      columns: ["node", "score"],
      rows: [],
    });

    await POST(
      makeRequest({
        action: "algorithm",
        database: "testdb",
        algorithm: "pagerank",
        params: {},
      })
    );

    const sql = mockedQuery.mock.calls[0][0];
    expect(sql).toContain("CALL PAGERANK");
    // Should use defaults
    expect(sql).toContain("ITERATIONS 20");
    expect(sql).toContain("DAMPING 0.85");
  });

  it("uses default params when params is not provided", async () => {
    mockedQuery.mockResolvedValueOnce({
      columns: ["node", "score"],
      rows: [],
    });

    await POST(
      makeRequest({
        action: "algorithm",
        database: "testdb",
        algorithm: "pagerank",
      })
    );

    const sql = mockedQuery.mock.calls[0][0];
    expect(sql).toContain("ITERATIONS 20");
  });

  it("passes direction parameter correctly", async () => {
    mockedQuery.mockResolvedValueOnce({
      columns: ["node", "score"],
      rows: [],
    });

    await POST(
      makeRequest({
        action: "algorithm",
        database: "testdb",
        algorithm: "closeness_centrality",
        params: { direction: "in" },
      })
    );

    const sql = mockedQuery.mock.calls[0][0];
    expect(sql).toBe("CALL CLOSENESS_CENTRALITY DIRECTION IN");
  });

  it("passes variant parameter for degree centrality", async () => {
    mockedQuery.mockResolvedValueOnce({
      columns: ["node", "score"],
      rows: [],
    });

    await POST(
      makeRequest({
        action: "algorithm",
        database: "testdb",
        algorithm: "degree_centrality",
        params: { variant: "out" },
      })
    );

    const sql = mockedQuery.mock.calls[0][0];
    expect(sql).toBe("CALL DEGREE_CENTRALITY VARIANT OUT");
  });

  it("passes Weighted Shortest Path params correctly", async () => {
    mockedQuery.mockResolvedValueOnce({
      columns: ["node", "total_weight"],
      rows: [["a:1", 0]],
    });

    await POST(
      makeRequest({
        action: "algorithm",
        database: "testdb",
        algorithm: "weighted_shortest_path",
        params: {
          source_table: "users",
          source_id: 1,
          target_table: "orders",
          target_id: 42,
          weight_property: "distance",
        },
      })
    );

    const sql = mockedQuery.mock.calls[0][0];
    expect(sql).toContain('FROM "users"');
    expect(sql).toContain("id = 1");
    expect(sql).toContain('TO "orders"');
    expect(sql).toContain("id = 42");
    expect(sql).toContain("WEIGHT distance");
  });
});

// ---------------------------------------------------------------------------
// Connection parameter forwarding
// ---------------------------------------------------------------------------
describe("QA — API connection parameter forwarding", () => {
  it("passes connection params to query", async () => {
    mockedQuery.mockResolvedValueOnce({
      columns: ["node", "score"],
      rows: [],
    });

    await POST(
      makeRequest({
        action: "algorithm",
        database: "testdb",
        algorithm: "pagerank",
        connection: { host: "db.example.com", port: 5432, user: "admin" },
      })
    );

    expect(mockedQuery).toHaveBeenCalledWith(
      expect.any(String),
      "testdb",
      { host: "db.example.com", port: 5432, user: "admin" }
    );
  });

  it("passes undefined connection when not provided", async () => {
    mockedQuery.mockResolvedValueOnce({
      columns: ["node", "score"],
      rows: [],
    });

    await POST(
      makeRequest({
        action: "algorithm",
        database: "testdb",
        algorithm: "pagerank",
      })
    );

    expect(mockedQuery).toHaveBeenCalledWith(
      expect.any(String),
      "testdb",
      undefined
    );
  });

  it("ignores connection with empty host", async () => {
    mockedQuery.mockResolvedValueOnce({
      columns: ["node", "score"],
      rows: [],
    });

    await POST(
      makeRequest({
        action: "algorithm",
        database: "testdb",
        algorithm: "pagerank",
        connection: { host: "", port: 5432, user: "admin" },
      })
    );

    expect(mockedQuery).toHaveBeenCalledWith(
      expect.any(String),
      "testdb",
      undefined
    );
  });
});

// ---------------------------------------------------------------------------
// Response structure
// ---------------------------------------------------------------------------
describe("QA — API response structure", () => {
  it("returns columns and rows on success", async () => {
    mockedQuery.mockResolvedValueOnce({
      columns: ["node", "score"],
      rows: [
        ["users:1", 0.5],
        ["users:2", 0.3],
      ],
    });

    const res = await POST(
      makeRequest({
        action: "algorithm",
        database: "testdb",
        algorithm: "pagerank",
      })
    );

    expect(res.status).toBe(200);
    const body = await parseResponse(res);
    expect(body.columns).toEqual(["node", "score"]);
    expect(body.rows).toHaveLength(2);
  });

  it("returns empty rows when algorithm has no results", async () => {
    mockedQuery.mockResolvedValueOnce({
      columns: ["node", "score"],
      rows: [],
    });

    const res = await POST(
      makeRequest({
        action: "algorithm",
        database: "testdb",
        algorithm: "pagerank",
      })
    );

    expect(res.status).toBe(200);
    const body = await parseResponse(res);
    expect(body.rows).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Edge cases: no-param algorithms
// ---------------------------------------------------------------------------
describe("QA — API no-param algorithms produce clean SQL", () => {
  const noParamAlgos = ALGORITHMS.filter(
    (a) => a.params.length === 0
  ).map((a) => a.id);

  it.each(noParamAlgos)("%s generates CALL without extra clauses", async (id) => {
    mockedQuery.mockResolvedValueOnce({
      columns: ["node", "score"],
      rows: [],
    });

    await POST(
      makeRequest({
        action: "algorithm",
        database: "testdb",
        algorithm: id,
      })
    );

    const sql = mockedQuery.mock.calls[0][0];
    // Should be just "CALL FUNCTION_NAME" with no trailing spaces or params
    expect(sql).toMatch(/^CALL \S+$/);
  });
});
