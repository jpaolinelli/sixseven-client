import type {
  GraphNode,
  GraphEdge,
  GraphPath,
  PathSelector,
  PathSet,
  TraverseResult,
  VariableLengthTraversal,
} from "./graph-types";
import type { ConnectionParams } from "./connection-types";

const API_BASE = "/api";

interface TraverseApiResponse {
  columns: string[];
  rows: (string | number | boolean | null)[][];
}

/** Highlight colors used to distinguish multiple simultaneous paths. */
export const PATH_HIGHLIGHT_COLORS: readonly string[] = [
  "#f59e0b", // amber
  "#22d3ee", // cyan
  "#a78bfa", // violet
  "#f472b6", // pink
  "#34d399", // emerald
  "#fb923c", // orange
  "#60a5fa", // blue
  "#facc15", // yellow
];

/** Stable color for a path by index (cycles through the palette). */
export function pathColor(index: number): string {
  if (!Number.isFinite(index) || index < 0) return PATH_HIGHLIGHT_COLORS[0];
  return PATH_HIGHLIGHT_COLORS[index % PATH_HIGHLIGHT_COLORS.length];
}

/** Execute a graph traversal and return parsed nodes/edges. */
export async function traverseNode(
  database: string,
  table: string,
  id: string,
  direction: "out" | "in" | "both",
  parentDepth: number,
  edgeType?: string,
  conn?: ConnectionParams
): Promise<TraverseResult> {
  const res = await fetch(`${API_BASE}/graph`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "traverse",
      database,
      table,
      id,
      direction,
      edgeType,
      connection: conn,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Traverse error ${res.status}: ${body}`);
  }
  const data: TraverseApiResponse = await res.json();
  return parseTraverseResult(data, table, id, parentDepth);
}

/** Find shortest path between two nodes. */
export async function findShortestPath(
  database: string,
  sourceTable: string,
  sourceId: string,
  targetTable: string,
  targetId: string,
  conn?: ConnectionParams
): Promise<{ columns: string[]; rows: (string | number | boolean | null)[][] }> {
  const res = await fetch(`${API_BASE}/graph`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "shortest_path",
      database,
      sourceTable,
      sourceId,
      targetTable,
      targetId,
      connection: conn,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Shortest path error ${res.status}: ${body}`);
  }
  return res.json();
}

/** Fetch full row data for a node. */
export async function fetchNodeDetails(
  database: string,
  table: string,
  id: string,
  conn?: ConnectionParams
): Promise<Record<string, unknown>> {
  const res = await fetch(`${API_BASE}/graph`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "node_details", database, table, id, connection: conn }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Node details error ${res.status}: ${body}`);
  }
  const data: TraverseApiResponse = await res.json();
  if (data.rows.length === 0) return {};
  const record: Record<string, unknown> = {};
  data.columns.forEach((col, i) => {
    record[col] = data.rows[0][i];
  });
  return record;
}

/**
 * Parse the result of a TRAVERSE query into graph nodes and edges.
 *
 * Expected columns from TRAVERSE:
 *   source_table, source_id, edge_type, target_table, target_id
 *
 * This may vary — we adapt to whatever columns are returned.
 */
function parseTraverseResult(
  data: TraverseApiResponse,
  originTable: string,
  originId: string,
  parentDepth: number
): TraverseResult {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const seenNodes = new Set<string>();

  // Map column indices
  const colIdx = new Map<string, number>();
  data.columns.forEach((col, i) => colIdx.set(col.toLowerCase(), i));

  // Try to detect column positions
  const srcTableIdx = colIdx.get("source_table") ?? colIdx.get("src_table") ?? -1;
  const srcIdIdx = colIdx.get("source_id") ?? colIdx.get("src_id") ?? -1;
  const edgeTypeIdx = colIdx.get("edge_type") ?? colIdx.get("edgetype") ?? -1;
  const tgtTableIdx = colIdx.get("target_table") ?? colIdx.get("tgt_table") ?? -1;
  const tgtIdIdx = colIdx.get("target_id") ?? colIdx.get("tgt_id") ?? -1;

  // If we can't detect edge columns, return raw rows as connected nodes
  if (srcTableIdx === -1 || tgtTableIdx === -1) {
    // Fallback: treat each row as a neighbor node, using first two columns as table + id
    const tableIdx = colIdx.get("table") ?? colIdx.get("_table") ?? 0;
    const idIdx = colIdx.get("id") ?? colIdx.get("_id") ?? 1;

    for (const row of data.rows) {
      const nTable = String(row[tableIdx] ?? originTable);
      const nId = String(row[idIdx] ?? "");
      const nodeId = makeNodeId(nTable, nId);
      if (!seenNodes.has(nodeId)) {
        seenNodes.add(nodeId);
        nodes.push({
          id: nodeId,
          table: nTable,
          pk: nId,
          label: `${nTable}:${nId}`,
          expanded: false,
          depth: parentDepth + 1,
        });
      }
      edges.push({
        id: `${makeNodeId(originTable, originId)}->${nodeId}`,
        from: makeNodeId(originTable, originId),
        to: nodeId,
        edgeType: "related",
        label: "related",
      });
    }
    return { nodes, edges };
  }

  // Standard edge-column parsing
  for (const row of data.rows) {
    const srcTable = String(row[srcTableIdx] ?? "");
    const srcId = String(row[srcIdIdx] ?? "");
    const edgeType = String(row[edgeTypeIdx] ?? "edge");
    const tgtTable = String(row[tgtTableIdx] ?? "");
    const tgtId = String(row[tgtIdIdx] ?? "");

    const srcNodeId = makeNodeId(srcTable, srcId);
    const tgtNodeId = makeNodeId(tgtTable, tgtId);

    if (!seenNodes.has(srcNodeId)) {
      seenNodes.add(srcNodeId);
      nodes.push({
        id: srcNodeId,
        table: srcTable,
        pk: srcId,
        label: `${srcTable}:${srcId}`,
        expanded: false,
        depth: parentDepth + 1,
      });
    }

    if (!seenNodes.has(tgtNodeId)) {
      seenNodes.add(tgtNodeId);
      nodes.push({
        id: tgtNodeId,
        table: tgtTable,
        pk: tgtId,
        label: `${tgtTable}:${tgtId}`,
        expanded: false,
        depth: parentDepth + 1,
      });
    }

    const edgeId = `${srcNodeId}->${edgeType}->${tgtNodeId}`;
    edges.push({
      id: edgeId,
      from: srcNodeId,
      to: tgtNodeId,
      edgeType,
      label: edgeType,
    });
  }

  return { nodes, edges };
}

export function makeNodeId(table: string, id: string): string {
  return `${table}:${id}`;
}

/** Deterministic color for a table name. */
export function tableColor(table: string): string {
  const colors = [
    "#3b82f6", // blue
    "#10b981", // emerald
    "#f59e0b", // amber
    "#ef4444", // red
    "#8b5cf6", // violet
    "#06b6d4", // cyan
    "#f97316", // orange
    "#ec4899", // pink
    "#14b8a6", // teal
    "#a855f7", // purple
  ];
  let hash = 0;
  for (let i = 0; i < table.length; i++) {
    hash = (hash * 31 + table.charCodeAt(i)) | 0;
  }
  return colors[Math.abs(hash) % colors.length];
}

/** Parse a node ID back to table and pk. */
export function parseNodeId(nodeId: string): { table: string; pk: string } {
  const idx = nodeId.indexOf(":");
  if (idx === -1) return { table: nodeId, pk: "" };
  return { table: nodeId.slice(0, idx), pk: nodeId.slice(idx + 1) };
}

/**
 * Execute a variable-length traversal (MIN_DEPTH ... MAX_DEPTH).
 *
 * Sends a `variable_length_traverse` action to the graph API. The server is
 * expected to translate this into the new SELECT ... FROM MATCH SQL syntax
 * with a hop quantifier (e.g. `-[r:edge*minDepth..maxDepth]->`).
 */
export async function variableLengthTraverse(
  database: string,
  table: string,
  id: string,
  direction: "out" | "in" | "both",
  parentDepth: number,
  config: VariableLengthTraversal,
  edgeType?: string,
  conn?: ConnectionParams
): Promise<TraverseResult> {
  const res = await fetch(`${API_BASE}/graph`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "variable_length_traverse",
      database,
      table,
      id,
      direction,
      edgeType,
      minDepth: config.minDepth,
      maxDepth: config.maxDepth,
      connection: conn,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Variable-length traverse error ${res.status}: ${body}`);
  }
  const data: TraverseApiResponse = await res.json();
  return parseTraverseResult(data, table, id, parentDepth);
}

/**
 * Execute a shortest-path query with a path selector
 * (`ANY SHORTEST`, `ALL SHORTEST`, or `SHORTEST K`).
 */
export async function findShortestPathsWithSelector(
  database: string,
  sourceTable: string,
  sourceId: string,
  targetTable: string,
  targetId: string,
  selector: PathSelector,
  k?: number,
  conn?: ConnectionParams
): Promise<{ columns: string[]; rows: (string | number | boolean | null)[][] }> {
  const res = await fetch(`${API_BASE}/graph`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "shortest_path",
      database,
      sourceTable,
      sourceId,
      targetTable,
      targetId,
      selector,
      k,
      connection: conn,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Shortest path error ${res.status}: ${body}`);
  }
  return res.json();
}

/**
 * Build the new SELECT ... FROM MATCH SQL syntax for a path-selector
 * shortest-path query.
 *
 * Examples:
 *  - selector="any_shortest":
 *      SELECT * FROM MATCH ANY SHORTEST PATH ((s)-[r]->*(t)) WHERE s.id = 1 AND t.id = 5
 *  - selector="all_shortest":
 *      SELECT * FROM MATCH ALL SHORTEST PATH ((s)-[r]->*(t)) WHERE ...
 *  - selector="shortest_k" with k=3:
 *      SELECT * FROM MATCH SHORTEST 3 PATH ((s)-[r]->*(t)) WHERE ...
 */
export function buildShortestPathSql(
  sourceTable: string,
  sourceId: string,
  targetTable: string,
  targetId: string,
  selector: PathSelector,
  k?: number
): string {
  const head =
    selector === "any_shortest"
      ? "ANY SHORTEST"
      : selector === "all_shortest"
        ? "ALL SHORTEST"
        : `SHORTEST ${Math.max(1, Math.floor(k ?? 1))}`;

  const sLit = quoteIdLiteral(sourceId);
  const tLit = quoteIdLiteral(targetId);

  return (
    `SELECT * FROM MATCH ${head} PATH ` +
    `((s:${quoteIdent(sourceTable)})-[r]->*(t:${quoteIdent(targetTable)})) ` +
    `WHERE s.id = ${sLit} AND t.id = ${tLit}`
  );
}

/**
 * Build the new SELECT ... FROM MATCH SQL syntax for a variable-length
 * traversal with a hop quantifier `*minDepth..maxDepth`.
 */
export function buildVariableLengthMatchSql(
  table: string,
  id: string,
  direction: "out" | "in" | "both",
  config: VariableLengthTraversal,
  edgeType?: string
): string {
  const lit = quoteIdLiteral(id);
  const min = Math.max(0, Math.floor(config.minDepth));
  const max = Math.max(min, Math.floor(config.maxDepth));
  const edge = edgeType ? `:${quoteIdent(edgeType)}` : "";
  const quant = `*${min}..${max}`;

  // direction arrows on left/right of the edge
  const left = direction === "in" ? "<-" : "-";
  const right = direction === "out" ? "->" : "-";

  return (
    `SELECT * FROM MATCH ((s:${quoteIdent(table)})` +
    `${left}[r${edge}${quant}]${right}(t)) ` +
    `WHERE s.id = ${lit}`
  );
}

/**
 * Sanitize a SQL identifier. SixSevenDB does not support double-quoted
 * identifiers, so we validate the name contains only safe characters and
 * pass it through unchanged. Mirrors `lib/schema-utils.ts:quoteIdent`.
 */
function quoteIdent(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`Invalid identifier: ${name}`);
  }
  return name;
}

/** Quote an id value for safe SQL embedding. Numerics pass through. */
function quoteIdLiteral(value: string): string {
  if (/^\d+$/.test(value)) return value;
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Parse a path-selector result set into a {@link PathSet}.
 *
 * Expected columns (case-insensitive):
 *   - `path_id` (or `pid`): integer/string identifying which path the row belongs to
 *   - `hop` (or `hop_index`, `step`): integer ordering within a path
 *   - `source_table`, `source_id`, `edge_type`, `target_table`, `target_id`:
 *     the edge for this hop
 *
 * Rows without an explicit `path_id` are treated as a single path (id "0").
 *
 * The function preserves hop ordering and tolerates rows arriving out of order.
 */
export function parsePathSet(
  selector: PathSelector,
  data: TraverseApiResponse
): PathSet {
  const colIdx = new Map<string, number>();
  data.columns.forEach((col, i) => colIdx.set(col.toLowerCase(), i));

  const pathIdIdx =
    colIdx.get("path_id") ?? colIdx.get("pid") ?? colIdx.get("path") ?? -1;
  const hopIdx =
    colIdx.get("hop") ?? colIdx.get("hop_index") ?? colIdx.get("step") ?? -1;
  const srcTableIdx =
    colIdx.get("source_table") ?? colIdx.get("src_table") ?? -1;
  const srcIdIdx = colIdx.get("source_id") ?? colIdx.get("src_id") ?? -1;
  const edgeTypeIdx = colIdx.get("edge_type") ?? colIdx.get("edgetype") ?? -1;
  const tgtTableIdx =
    colIdx.get("target_table") ?? colIdx.get("tgt_table") ?? -1;
  const tgtIdIdx = colIdx.get("target_id") ?? colIdx.get("tgt_id") ?? -1;

  // Without source/target columns we cannot reconstruct paths.
  if (srcTableIdx < 0 || tgtTableIdx < 0) {
    return { selector, paths: [] };
  }

  // Group hops by path id, preserving input order to handle missing hop indices.
  const groups = new Map<
    string,
    {
      seq: number; // first-seen ordinal so paths come out stable
      hops: {
        hop: number;
        srcNodeId: string;
        tgtNodeId: string;
        edgeId: string;
      }[];
    }
  >();
  let seqCounter = 0;

  data.rows.forEach((row, rowIdx) => {
    const pathId =
      pathIdIdx >= 0 && row[pathIdIdx] !== null && row[pathIdIdx] !== undefined
        ? String(row[pathIdIdx])
        : "0";
    const hop =
      hopIdx >= 0 && row[hopIdx] !== null && row[hopIdx] !== undefined
        ? Number(row[hopIdx])
        : rowIdx;

    const sTable = String(row[srcTableIdx] ?? "");
    const sId = String(row[srcIdIdx] ?? "");
    const tTable = String(row[tgtTableIdx] ?? "");
    const tId = String(row[tgtIdIdx] ?? "");
    const edgeType =
      edgeTypeIdx >= 0 ? String(row[edgeTypeIdx] ?? "edge") : "edge";

    const srcNodeId = makeNodeId(sTable, sId);
    const tgtNodeId = makeNodeId(tTable, tId);
    const edgeId = `${srcNodeId}->${edgeType}->${tgtNodeId}`;

    let group = groups.get(pathId);
    if (!group) {
      group = { seq: seqCounter++, hops: [] };
      groups.set(pathId, group);
    }
    group.hops.push({ hop, srcNodeId, tgtNodeId, edgeId });
  });

  // Build ordered paths
  const paths: GraphPath[] = Array.from(groups.entries())
    .sort((a, b) => a[1].seq - b[1].seq)
    .map(([pathId, group]) => {
      const sorted = [...group.hops].sort((a, b) => a.hop - b.hop);
      const nodeIds: string[] = [];
      const edgeIds: string[] = [];
      sorted.forEach((h, i) => {
        if (i === 0) nodeIds.push(h.srcNodeId);
        nodeIds.push(h.tgtNodeId);
        edgeIds.push(h.edgeId);
      });
      return {
        id: pathId,
        nodeIds,
        edgeIds,
        length: edgeIds.length,
      };
    });

  return { selector, paths };
}

/**
 * Convert a PathSet into a map of node-id -> highlight color and
 * edge-id -> highlight color. Each path is assigned a distinct color
 * cycled from {@link PATH_HIGHLIGHT_COLORS}; nodes/edges that appear
 * in multiple paths are colored by the first path that contains them.
 */
export function pathSetToHighlightMaps(pathSet: PathSet): {
  nodeColors: Map<string, string>;
  edgeColors: Map<string, string>;
} {
  const nodeColors = new Map<string, string>();
  const edgeColors = new Map<string, string>();
  pathSet.paths.forEach((path, i) => {
    const color = pathColor(i);
    for (const nid of path.nodeIds) {
      if (!nodeColors.has(nid)) nodeColors.set(nid, color);
    }
    for (const eid of path.edgeIds) {
      if (!edgeColors.has(eid)) edgeColors.set(eid, color);
    }
  });
  return { nodeColors, edgeColors };
}
