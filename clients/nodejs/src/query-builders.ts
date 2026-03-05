import type {
  TraverseOptions,
  NearestOptions,
  LinkOptions,
} from './types';
import { serializeEmbedding } from './type-mapping';

/**
 * Escape a SQL identifier (table name, column name) by double-quoting it.
 */
function escapeIdentifier(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"';
}

// ---------------------------------------------------------------------------
// TRAVERSE query builder
// ---------------------------------------------------------------------------

export interface TraverseQuery {
  text: string;
  values: unknown[];
}

/**
 * Build a TRAVERSE SQL statement.
 *
 * Server syntax:
 *   TRAVERSE edge FROM table($1) [DIRECTION IN|OUT|BOTH]
 *     [MAX_DEPTH n] [MODE NODES|EDGES] [WHERE expr] [FETCH]
 */
export function buildTraverse(
  edgeType: string,
  fromTable: string,
  startId: unknown,
  options: TraverseOptions = {},
): TraverseQuery {
  const {
    direction = 'OUT',
    maxDepth,
    mode = 'NODES',
    fetch = false,
    where,
  } = options;

  const values: unknown[] = [startId];
  let sql = `TRAVERSE ${escapeIdentifier(edgeType)} FROM ${escapeIdentifier(fromTable)}($1)`;

  sql += ` DIRECTION ${direction}`;

  if (maxDepth !== undefined) {
    sql += ` MAX_DEPTH ${maxDepth}`;
  }

  sql += ` MODE ${mode}`;

  if (where) {
    sql += ` WHERE ${where}`;
  }

  if (fetch) {
    sql += ' FETCH';
  }

  return { text: sql, values };
}

// ---------------------------------------------------------------------------
// NEAREST query builder
// ---------------------------------------------------------------------------

export interface NearestQuery {
  text: string;
  values: unknown[];
}

/**
 * Build a NEAREST SQL statement for vector similarity search.
 *
 * Server syntax:
 *   NEAREST k FROM table.column TO $1 [WHERE expr] [USING COSINE|L2|DOT]
 */
export function buildNearest(
  table: string,
  column: string,
  query: string | Float32Array | number[],
  options: NearestOptions = {},
): NearestQuery {
  const { k = 10, metric, where } = options;

  const values: unknown[] = [];

  if (typeof query === 'string') {
    values.push(query);
  } else {
    values.push(serializeEmbedding(query));
  }

  let sql = `NEAREST ${k} FROM ${escapeIdentifier(table)}.${escapeIdentifier(column)} TO $1`;

  if (where) {
    sql += ` WHERE ${where}`;
  }

  if (metric && metric !== 'COSINE') {
    sql += ` USING ${metric}`;
  }

  return { text: sql, values };
}

// ---------------------------------------------------------------------------
// LINK query builder
// ---------------------------------------------------------------------------

/**
 * Build a LINK SQL statement to create a graph edge.
 *
 * Server syntax:
 *   LINK source_table($1) TO target_table($2) VIA edge_type [(prop = $3, ...)]
 */
export function buildLink(
  edgeType: string,
  fromTable: string,
  fromId: unknown,
  toTable: string,
  toId: unknown,
  options: LinkOptions = {},
): { text: string; values: unknown[] } {
  const values: unknown[] = [fromId, toId];
  let sql = `LINK ${escapeIdentifier(fromTable)}($1) TO ${escapeIdentifier(toTable)}($2) VIA ${escapeIdentifier(edgeType)}`;

  const { properties } = options;
  if (properties && Object.keys(properties).length > 0) {
    const propParts: string[] = [];
    for (const [key, val] of Object.entries(properties)) {
      values.push(val);
      propParts.push(`${escapeIdentifier(key)} = $${values.length}`);
    }
    sql += ' (' + propParts.join(', ') + ')';
  }

  return { text: sql, values };
}

// ---------------------------------------------------------------------------
// UNLINK query builder
// ---------------------------------------------------------------------------

/**
 * Build an UNLINK SQL statement to remove a graph edge.
 *
 * Server syntax:
 *   UNLINK source_table($1) FROM target_table($2) VIA edge_type [WHERE expr]
 */
export function buildUnlink(
  edgeType: string,
  fromTable: string,
  fromId: unknown,
  toTable: string,
  toId: unknown,
): { text: string; values: unknown[] } {
  const sql = `UNLINK ${escapeIdentifier(fromTable)}($1) FROM ${escapeIdentifier(toTable)}($2) VIA ${escapeIdentifier(edgeType)}`;
  return { text: sql, values: [fromId, toId] };
}
