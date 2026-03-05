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

/**
 * Escape a SQL string literal by wrapping in single quotes and doubling any
 * internal single quotes.
 */
function escapeStringLiteral(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'";
}

/**
 * Format a value for inclusion in a SQL statement.
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  if (typeof value === 'string') {
    return escapeStringLiteral(value);
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? 'TRUE' : 'FALSE';
  }
  if (value instanceof Float32Array || value instanceof Float64Array) {
    return escapeStringLiteral(serializeEmbedding(Array.from(value)));
  }
  if (Array.isArray(value)) {
    return escapeStringLiteral(JSON.stringify(value));
  }
  if (typeof value === 'object') {
    return escapeStringLiteral(JSON.stringify(value));
  }
  return escapeStringLiteral(String(value));
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
 * Example output:
 *   TRAVERSE "follows" FROM "users" WHERE id = $1 DIRECTION OUT MAX_DEPTH 3 MODE NODES FETCH
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

  let sql = `TRAVERSE ${escapeIdentifier(edgeType)} FROM ${escapeIdentifier(fromTable)} WHERE id = $1`;
  const values: unknown[] = [startId];

  sql += ` DIRECTION ${direction}`;

  if (maxDepth !== undefined) {
    sql += ` MAX_DEPTH ${maxDepth}`;
  }

  sql += ` MODE ${mode}`;

  if (fetch) {
    sql += ' FETCH';
  }

  if (where) {
    sql += ` WHERE ${where}`;
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
 * Example output:
 *   SELECT * FROM NEAREST("posts", "embedding", $1, 5)
 */
export function buildNearest(
  table: string,
  column: string,
  query: string | Float32Array | number[],
  options: NearestOptions = {},
): NearestQuery {
  const { k = 10, metric, where } = options;

  const values: unknown[] = [];
  let queryParam: string;

  if (typeof query === 'string') {
    values.push(query);
    queryParam = '$1';
  } else {
    const embStr = serializeEmbedding(query);
    values.push(embStr);
    queryParam = '$1';
  }

  let sql = `SELECT * FROM NEAREST(${escapeIdentifier(table)}, ${escapeIdentifier(column)}, ${queryParam}, ${k})`;

  if (metric && metric !== 'COSINE') {
    sql += ` USING ${metric}`;
  }

  if (where) {
    sql += ` WHERE ${where}`;
  }

  return { text: sql, values };
}

// ---------------------------------------------------------------------------
// LINK query builder
// ---------------------------------------------------------------------------

/**
 * Build a LINK SQL statement to create a graph edge.
 *
 * Example output:
 *   LINK "follows" FROM "users" WHERE id = $1 TO "users" WHERE id = $2 SET score = $3
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
  let sql = `LINK ${escapeIdentifier(edgeType)} FROM ${escapeIdentifier(fromTable)} WHERE id = $1 TO ${escapeIdentifier(toTable)} WHERE id = $2`;

  const { properties } = options;
  if (properties && Object.keys(properties).length > 0) {
    const setParts: string[] = [];
    for (const [key, val] of Object.entries(properties)) {
      values.push(val);
      setParts.push(`${escapeIdentifier(key)} = $${values.length}`);
    }
    sql += ' SET ' + setParts.join(', ');
  }

  return { text: sql, values };
}

// ---------------------------------------------------------------------------
// UNLINK query builder
// ---------------------------------------------------------------------------

/**
 * Build an UNLINK SQL statement to remove a graph edge.
 *
 * Example output:
 *   UNLINK "follows" FROM "users" WHERE id = $1 TO "users" WHERE id = $2
 */
export function buildUnlink(
  edgeType: string,
  fromTable: string,
  fromId: unknown,
  toTable: string,
  toId: unknown,
): { text: string; values: unknown[] } {
  const sql = `UNLINK ${escapeIdentifier(edgeType)} FROM ${escapeIdentifier(fromTable)} WHERE id = $1 TO ${escapeIdentifier(toTable)} WHERE id = $2`;
  return { text: sql, values: [fromId, toId] };
}
