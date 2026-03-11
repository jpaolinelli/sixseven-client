/**
 * Utility functions for running graph algorithms and processing results.
 */

import type {
  AlgorithmDef,
  AlgorithmId,
  AlgorithmNodeResult,
  AlgorithmResult,
  AlgorithmStats,
} from "./algorithm-types";
import { getAlgorithm } from "./algorithm-types";
import type { ConnectionParams } from "./connection-types";

const API_BASE = "/api";

interface AlgorithmApiResponse {
  columns: string[];
  rows: (string | number | boolean | null)[][];
}

/** Run an algorithm via the graph API. */
export async function runAlgorithm(
  database: string,
  algorithmId: AlgorithmId,
  params: Record<string, string | number>,
  conn?: ConnectionParams
): Promise<AlgorithmResult> {
  const algo = getAlgorithm(algorithmId);
  if (!algo) {
    throw new Error(`Unknown algorithm: ${algorithmId}`);
  }

  const res = await fetch(`${API_BASE}/graph`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "algorithm",
      database,
      algorithm: algorithmId,
      params,
      connection: conn,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Algorithm error ${res.status}: ${body}`);
  }

  const data: AlgorithmApiResponse = await res.json();
  return parseAlgorithmResult(algo, data);
}

/** Parse API response into structured algorithm results. */
export function parseAlgorithmResult(
  algo: AlgorithmDef,
  data: AlgorithmApiResponse
): AlgorithmResult {
  const colIdx = new Map<string, number>();
  data.columns.forEach((col, i) => colIdx.set(col.toLowerCase(), i));

  const nodeIdx = colIdx.get(algo.nodeColumn.toLowerCase()) ?? 0;
  const scoreIdx = colIdx.get(algo.scoreColumn.toLowerCase()) ?? 1;

  const nodeResults: AlgorithmNodeResult[] = [];

  for (const row of data.rows) {
    const rawNode = String(row[nodeIdx] ?? "");
    const score = Number(row[scoreIdx] ?? 0);

    const { table, pk } = parseAlgorithmNodeId(rawNode);

    nodeResults.push({
      nodeId: rawNode,
      table,
      pk,
      score,
    });
  }

  const scores = nodeResults.map((n) => n.score);
  const stats = computeStats(scores);

  return {
    algorithmId: algo.id,
    algorithmName: algo.name,
    nodes: nodeResults,
    stats,
    columns: data.columns,
    rows: data.rows,
  };
}

/** Parse a node identifier from algorithm results (formats: "table:pk" or just "pk"). */
export function parseAlgorithmNodeId(nodeId: string): { table: string; pk: string } {
  const colonIdx = nodeId.indexOf(":");
  if (colonIdx === -1) {
    return { table: "", pk: nodeId };
  }
  return { table: nodeId.slice(0, colonIdx), pk: nodeId.slice(colonIdx + 1) };
}

/** Compute summary statistics for a set of scores. */
export function computeStats(scores: number[]): AlgorithmStats {
  if (scores.length === 0) {
    return { min: 0, max: 0, mean: 0, median: 0, count: 0 };
  }

  const sorted = [...scores].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];

  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    mean: sum / sorted.length,
    median,
    count: sorted.length,
  };
}

/**
 * Interpolate a score into a heat map color.
 * Low scores -> blue (#3b82f6), mid -> yellow (#eab308), high -> red (#ef4444).
 */
export function scoreToColor(score: number, min: number, max: number): string {
  if (max === min) return "#3b82f6";

  const t = Math.max(0, Math.min(1, (score - min) / (max - min)));

  // Blue -> Yellow -> Red gradient
  if (t < 0.5) {
    const s = t * 2; // 0..1 in the blue-yellow range
    const r = Math.round(59 + s * (234 - 59));
    const g = Math.round(130 + s * (179 - 130));
    const b = Math.round(246 + s * (8 - 246));
    return `rgb(${r},${g},${b})`;
  } else {
    const s = (t - 0.5) * 2; // 0..1 in the yellow-red range
    const r = Math.round(234 + s * (239 - 234));
    const g = Math.round(179 + s * (68 - 179));
    const b = Math.round(8 + s * (68 - 8));
    return `rgb(${r},${g},${b})`;
  }
}

/** Build a map from node ID to color based on algorithm scores. */
export function buildHeatMap(
  results: AlgorithmNodeResult[],
  min: number,
  max: number
): Map<string, string> {
  const map = new Map<string, string>();
  for (const node of results) {
    map.set(node.nodeId, scoreToColor(node.score, min, max));
  }
  return map;
}

/** Build SQL for running an algorithm. */
export function buildAlgorithmSQL(
  algo: AlgorithmDef,
  database: string,
  params: Record<string, string | number>
): string {
  if (algo.id === "weighted_shortest_path") {
    return buildWeightedShortestPathSQL(params);
  }

  const paramClauses: string[] = [];

  for (const p of algo.params) {
    const value = params[p.name] ?? p.default;
    if (p.name === "direction") {
      const dirMap: Record<string, string> = {
        both: "BOTH",
        out: "OUT",
        in: "IN",
      };
      paramClauses.push(`DIRECTION ${dirMap[String(value)] ?? "BOTH"}`);
    } else if (p.name === "iterations") {
      paramClauses.push(`ITERATIONS ${Number(value)}`);
    } else if (p.name === "damping") {
      paramClauses.push(`DAMPING ${Number(value)}`);
    } else if (p.name === "tolerance") {
      paramClauses.push(`TOLERANCE ${Number(value)}`);
    } else if (p.name === "variant") {
      const variantMap: Record<string, string> = {
        total: "TOTAL",
        in: "IN",
        out: "OUT",
      };
      paramClauses.push(`VARIANT ${variantMap[String(value)] ?? "TOTAL"}`);
    }
  }

  const paramStr = paramClauses.length > 0 ? ` ${paramClauses.join(" ")}` : "";
  return `CALL ${algo.sqlFunction}${paramStr}`;
}

function buildWeightedShortestPathSQL(
  params: Record<string, string | number>
): string {
  const srcTable = String(params.source_table || "");
  const srcId = params.source_id ?? 1;
  const tgtTable = String(params.target_table || "");
  const tgtId = params.target_id ?? 1;
  const weightProp = String(params.weight_property || "weight");

  return `SHORTEST PATH FROM "${srcTable}" WHERE id = ${srcId} TO "${tgtTable}" WHERE id = ${tgtId} WEIGHT ${weightProp}`;
}

/** Format a number for display (truncate to reasonable precision). */
export function formatScore(value: number): string {
  if (Number.isInteger(value)) return String(value);
  if (Math.abs(value) < 0.0001) return value.toExponential(2);
  return value.toFixed(4);
}
