import { describe, it, expect, vi, beforeEach } from "vitest";

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
  vi.clearAllMocks();
});

describe("POST /api/graph — algorithm action", () => {
  it("returns 400 when algorithm is missing", async () => {
    const res = await POST(
      makeRequest({ action: "algorithm", database: "test" })
    );
    expect(res.status).toBe(400);
    const body = await parseResponse(res);
    expect(body.error).toContain("algorithm");
  });

  it("returns 400 for unknown algorithm ID", async () => {
    const res = await POST(
      makeRequest({
        action: "algorithm",
        database: "test",
        algorithm: "not_real",
      })
    );
    expect(res.status).toBe(400);
    const body = await parseResponse(res);
    expect(body.error).toContain("Unknown algorithm");
  });

  it("executes PageRank with default params", async () => {
    mockedQuery.mockResolvedValueOnce({
      columns: ["node", "score"],
      rows: [
        ["users:1", 0.35],
        ["users:2", 0.65],
      ],
    });

    const res = await POST(
      makeRequest({
        action: "algorithm",
        database: "social",
        algorithm: "pagerank",
      })
    );

    expect(res.status).toBe(200);
    expect(mockedQuery).toHaveBeenCalledWith(
      expect.stringContaining("CALL PAGERANK"),
      "social",
      undefined
    );

    const body = await parseResponse(res);
    expect(body.columns).toEqual(["node", "score"]);
    expect(body.rows).toHaveLength(2);
  });

  it("executes PageRank with custom params", async () => {
    mockedQuery.mockResolvedValueOnce({
      columns: ["node", "score"],
      rows: [["users:1", 0.5]],
    });

    const res = await POST(
      makeRequest({
        action: "algorithm",
        database: "social",
        algorithm: "pagerank",
        params: { iterations: 50, damping: 0.9, tolerance: 0.001 },
      })
    );

    expect(res.status).toBe(200);
    const calledSQL = mockedQuery.mock.calls[0][0];
    expect(calledSQL).toContain("ITERATIONS 50");
    expect(calledSQL).toContain("DAMPING 0.9");
    expect(calledSQL).toContain("TOLERANCE 0.001");
  });

  it("executes Connected Components", async () => {
    mockedQuery.mockResolvedValueOnce({
      columns: ["node", "component"],
      rows: [
        ["users:1", 0],
        ["users:2", 1],
      ],
    });

    const res = await POST(
      makeRequest({
        action: "algorithm",
        database: "social",
        algorithm: "connected_components",
      })
    );

    expect(res.status).toBe(200);
    expect(mockedQuery).toHaveBeenCalledWith(
      "CALL CONNECTED_COMPONENTS",
      "social",
      undefined
    );
  });

  it("executes Betweenness Centrality with direction", async () => {
    mockedQuery.mockResolvedValueOnce({
      columns: ["node", "score"],
      rows: [["users:1", 0.8]],
    });

    const res = await POST(
      makeRequest({
        action: "algorithm",
        database: "social",
        algorithm: "betweenness_centrality",
        params: { direction: "out" },
      })
    );

    expect(res.status).toBe(200);
    expect(mockedQuery).toHaveBeenCalledWith(
      "CALL BETWEENNESS_CENTRALITY DIRECTION OUT",
      "social",
      undefined
    );
  });

  it("executes Degree Centrality with variant", async () => {
    mockedQuery.mockResolvedValueOnce({
      columns: ["node", "score"],
      rows: [["users:1", 5]],
    });

    const res = await POST(
      makeRequest({
        action: "algorithm",
        database: "social",
        algorithm: "degree_centrality",
        params: { variant: "in" },
      })
    );

    expect(res.status).toBe(200);
    expect(mockedQuery).toHaveBeenCalledWith(
      "CALL DEGREE_CENTRALITY VARIANT IN",
      "social",
      undefined
    );
  });

  it("executes Weighted Shortest Path", async () => {
    mockedQuery.mockResolvedValueOnce({
      columns: ["node", "total_weight"],
      rows: [
        ["users:1", 0],
        ["users:3", 2.5],
        ["users:5", 4.1],
      ],
    });

    const res = await POST(
      makeRequest({
        action: "algorithm",
        database: "social",
        algorithm: "weighted_shortest_path",
        params: {
          source_table: "users",
          source_id: 1,
          target_table: "users",
          target_id: 5,
          weight_property: "cost",
        },
      })
    );

    expect(res.status).toBe(200);
    const calledSQL = mockedQuery.mock.calls[0][0];
    expect(calledSQL).toContain("SHORTEST PATH");
    expect(calledSQL).toContain('"users"');
    expect(calledSQL).toContain("WEIGHT cost");
  });

  it("passes connection params when provided", async () => {
    mockedQuery.mockResolvedValueOnce({
      columns: ["node", "score"],
      rows: [],
    });

    await POST(
      makeRequest({
        action: "algorithm",
        database: "social",
        algorithm: "clustering_coefficient",
        connection: { host: "db.example.com", port: 5432, user: "admin" },
      })
    );

    expect(mockedQuery).toHaveBeenCalledWith(
      "CALL CLUSTERING_COEFFICIENT",
      "social",
      { host: "db.example.com", port: 5432, user: "admin", password: "sixseven" }
    );
  });

  it("returns 500 when query throws", async () => {
    mockedQuery.mockRejectedValueOnce(new Error("Connection refused"));

    const res = await POST(
      makeRequest({
        action: "algorithm",
        database: "social",
        algorithm: "pagerank",
      })
    );

    expect(res.status).toBe(500);
    const body = await parseResponse(res);
    expect(body.error).toContain("Connection refused");
  });

  it("executes all centrality algorithms", async () => {
    const centralityAlgos = [
      "closeness_centrality",
      "closeness_centrality_wf",
      "eigenvector_centrality",
      "harmonic_centrality",
      "clustering_coefficient",
      "triangle_count",
    ];

    for (const algoId of centralityAlgos) {
      mockedQuery.mockResolvedValueOnce({
        columns: ["node", "score"],
        rows: [["users:1", 0.5]],
      });

      const res = await POST(
        makeRequest({
          action: "algorithm",
          database: "social",
          algorithm: algoId,
        })
      );

      expect(res.status).toBe(200);
    }
  });

  it("executes Community Detection with iterations", async () => {
    mockedQuery.mockResolvedValueOnce({
      columns: ["node", "community"],
      rows: [
        ["users:1", 0],
        ["users:2", 0],
        ["users:3", 1],
      ],
    });

    const res = await POST(
      makeRequest({
        action: "algorithm",
        database: "social",
        algorithm: "community_detection",
        params: { iterations: 15 },
      })
    );

    expect(res.status).toBe(200);
    expect(mockedQuery).toHaveBeenCalledWith(
      "CALL COMMUNITY_DETECTION ITERATIONS 15",
      "social",
      undefined
    );
  });

  it("executes Strongly Connected Components", async () => {
    mockedQuery.mockResolvedValueOnce({
      columns: ["node", "component"],
      rows: [["users:1", 0]],
    });

    const res = await POST(
      makeRequest({
        action: "algorithm",
        database: "social",
        algorithm: "strongly_connected_components",
      })
    );

    expect(res.status).toBe(200);
    expect(mockedQuery).toHaveBeenCalledWith(
      "CALL STRONGLY_CONNECTED_COMPONENTS",
      "social",
      undefined
    );
  });
});
