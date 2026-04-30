import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db";
import { quoteIdent } from "@/lib/schema-utils";
import type { ConnectionParams } from "@/lib/connection-types";
import type { AlgorithmId } from "@/lib/algorithm-types";
import { getAlgorithm } from "@/lib/algorithm-types";
import { buildAlgorithmSQL } from "@/lib/algorithm-utils";

/**
 * POST /api/graph — Execute graph traversal or shortest-path queries.
 *
 * Body variants:
 *  { action: "traverse", database, table, id, direction?, edgeType?, connection? }
 *  { action: "variable_length_traverse", database, table, id, direction?, edgeType?,
 *    minDepth, maxDepth, connection? }
 *  { action: "shortest_path", database, sourceTable, sourceId, targetTable, targetId,
 *    selector?, k?, connection? }
 *  { action: "node_details", database, table, id, connection? }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, database } = body as { action: string; database: string };

    if (!action || !database) {
      return NextResponse.json(
        { error: "Missing 'action' or 'database'" },
        { status: 400 }
      );
    }

    const conn = parseConnectionParams(body);

    switch (action) {
      case "traverse":
        return await handleTraverse(body, database, conn);
      case "variable_length_traverse":
        return await handleVariableLengthTraverse(body, database, conn);
      case "shortest_path":
        return await handleShortestPath(body, database, conn);
      case "node_details":
        return await handleNodeDetails(body, database, conn);
      case "algorithm":
        return await handleAlgorithm(body, database, conn);
      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function handleTraverse(
  body: {
    table: string;
    id: string;
    direction?: "out" | "in" | "both";
    edgeType?: string;
  },
  database: string,
  conn?: ConnectionParams
) {
  const { table, id, direction = "both", edgeType } = body;

  if (!table || id === undefined) {
    return NextResponse.json(
      { error: "Missing 'table' or 'id'" },
      { status: 400 }
    );
  }

  const edgeClause = edgeType ? ` EDGE ${quoteIdent(edgeType)}` : "";
  const dirMap = { out: "OUT", in: "IN", both: "BOTH" } as const;
  const dir = dirMap[direction] || "BOTH";

  const sql = `TRAVERSE ${dir}${edgeClause} FROM ${quoteIdent(table)} WHERE id = ${quoteLiteral(id)} MAX_DEPTH 1`;

  const result = await query(sql, database, conn);
  return NextResponse.json(result);
}

type PathSelectorAction = "any_shortest" | "all_shortest" | "shortest_k";

async function handleShortestPath(
  body: {
    sourceTable: string;
    sourceId: string;
    targetTable: string;
    targetId: string;
    selector?: PathSelectorAction;
    k?: number;
  },
  database: string,
  conn?: ConnectionParams
) {
  const {
    sourceTable,
    sourceId,
    targetTable,
    targetId,
    selector = "any_shortest",
    k,
  } = body;

  if (!sourceTable || !sourceId || !targetTable || !targetId) {
    return NextResponse.json(
      { error: "Missing source/target table/id" },
      { status: 400 }
    );
  }

  if (
    selector !== "any_shortest" &&
    selector !== "all_shortest" &&
    selector !== "shortest_k"
  ) {
    return NextResponse.json(
      { error: `Invalid selector: ${selector}` },
      { status: 400 }
    );
  }

  if (selector === "shortest_k") {
    const kNum = Number(k);
    if (!Number.isFinite(kNum) || kNum < 1) {
      return NextResponse.json(
        { error: "Selector 'shortest_k' requires positive integer 'k'" },
        { status: 400 }
      );
    }
  }

  const head =
    selector === "any_shortest"
      ? "ANY SHORTEST"
      : selector === "all_shortest"
        ? "ALL SHORTEST"
        : `SHORTEST ${Math.max(1, Math.floor(Number(k)))}`;

  const sql =
    `SELECT * FROM MATCH ${head} PATH ` +
    `((s:${quoteIdent(sourceTable)})-[r]->*(t:${quoteIdent(targetTable)})) ` +
    `WHERE s.id = ${quoteLiteral(sourceId)} AND t.id = ${quoteLiteral(targetId)}`;

  const result = await query(sql, database, conn);
  return NextResponse.json(result);
}

async function handleVariableLengthTraverse(
  body: {
    table: string;
    id: string;
    direction?: "out" | "in" | "both";
    edgeType?: string;
    minDepth?: number;
    maxDepth?: number;
  },
  database: string,
  conn?: ConnectionParams
) {
  const {
    table,
    id,
    direction = "both",
    edgeType,
    minDepth = 1,
    maxDepth = 3,
  } = body;

  if (!table || id === undefined) {
    return NextResponse.json(
      { error: "Missing 'table' or 'id'" },
      { status: 400 }
    );
  }

  const minN = Number(minDepth);
  const maxN = Number(maxDepth);
  if (!Number.isFinite(minN) || !Number.isFinite(maxN) || minN < 0 || maxN < 0) {
    return NextResponse.json(
      { error: "minDepth/maxDepth must be non-negative numbers" },
      { status: 400 }
    );
  }
  if (maxN < minN) {
    return NextResponse.json(
      { error: "maxDepth must be >= minDepth" },
      { status: 400 }
    );
  }

  const min = Math.floor(minN);
  const max = Math.floor(maxN);
  const edge = edgeType ? `:${quoteIdent(edgeType)}` : "";
  const quant = `*${min}..${max}`;
  const left = direction === "in" ? "<-" : "-";
  const right = direction === "out" ? "->" : "-";

  const sql =
    `SELECT * FROM MATCH ((s:${quoteIdent(table)})` +
    `${left}[r${edge}${quant}]${right}(t)) ` +
    `WHERE s.id = ${quoteLiteral(id)}`;

  const result = await query(sql, database, conn);
  return NextResponse.json(result);
}

async function handleNodeDetails(
  body: { table: string; id: string },
  database: string,
  conn?: ConnectionParams
) {
  const { table, id } = body;

  if (!table || id === undefined) {
    return NextResponse.json(
      { error: "Missing 'table' or 'id'" },
      { status: 400 }
    );
  }

  const sql = `SELECT * FROM ${quoteIdent(table)} WHERE id = ${quoteLiteral(id)}`;

  const result = await query(sql, database, conn);
  return NextResponse.json(result);
}

async function handleAlgorithm(
  body: {
    algorithm: AlgorithmId;
    params?: Record<string, string | number>;
  },
  database: string,
  conn?: ConnectionParams
) {
  const { algorithm: algorithmId, params: algoParams = {} } = body;

  if (!algorithmId) {
    return NextResponse.json(
      { error: "Missing 'algorithm'" },
      { status: 400 }
    );
  }

  const algo = getAlgorithm(algorithmId);
  if (!algo) {
    return NextResponse.json(
      { error: `Unknown algorithm: ${algorithmId}` },
      { status: 400 }
    );
  }

  const sql = buildAlgorithmSQL(algo, database, algoParams);
  const result = await query(sql, database, conn);
  return NextResponse.json(result);
}

/** Quote a string literal for safe SQL embedding. */
function quoteLiteral(value: string): string {
  if (/^\d+$/.test(value)) return value;
  return `'${value.replace(/'/g, "''")}'`;
}

function parseConnectionParams(
  body: Record<string, unknown>
): ConnectionParams | undefined {
  const c = body.connection as Record<string, unknown> | undefined;
  if (!c || !c.host) return undefined;
  return {
    host: String(c.host),
    port: Number(c.port) || 6767,
    user: String(c.user || "sixseven"),
  };
}
