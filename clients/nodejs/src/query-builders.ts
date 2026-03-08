import type {
  TraverseOptions,
  NearestOptions,
  LinkOptions,
  MatchPatternElement,
  MatchNode,
  MatchEdge,
  MatchOptions,
  ShortestPathOptions,
  WithinTraverseOptions,
  ShortestMatchSelector,
  ShortestMatchOptions,
} from './types';
import { serializeEmbedding } from './type-parser';

/**
 * Escape a SQL identifier (table name, column name) by double-quoting it.
 */
function escapeIdentifier(name: string): string {
  return '"' + name.replace(/"/g, '""') + '"';
}

function assertPositiveInt(value: number, name: string): void {
  if (!Number.isInteger(value) || value < 1) {
    throw new TypeError(
      `${name} must be a positive integer, got ${value}`,
    );
  }
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
    assertPositiveInt(maxDepth, 'maxDepth');
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
  options: NearestOptions & { withinTraverse?: WithinTraverseOptions } = {},
): NearestQuery {
  const { k = 10, metric, where, withinTraverse } = options;

  assertPositiveInt(k, 'k');

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

  if (withinTraverse) {
    const wt = withinTraverse;
    values.push(wt.startId);
    const paramIdx = values.length;
    sql += ` WITHIN TRAVERSE ${escapeIdentifier(wt.edgeType)} FROM ${escapeIdentifier(wt.fromTable)}($${paramIdx})`;
    if (wt.direction) {
      sql += ` DIRECTION ${wt.direction}`;
    }
    if (wt.maxDepth !== undefined) {
      assertPositiveInt(wt.maxDepth, 'maxDepth');
      sql += ` MAX_DEPTH ${wt.maxDepth}`;
    }
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

// ---------------------------------------------------------------------------
// MATCH query builder
// ---------------------------------------------------------------------------

function isMatchNode(el: MatchPatternElement): el is MatchNode {
  return 'table' in el && !('edgeType' in el);
}

function buildEdgeLabel(edge: MatchEdge): string {
  if (edge.edgeTypes && edge.edgeTypes.length > 0) {
    return edge.edgeTypes.map(escapeIdentifier).join('|');
  }
  return escapeIdentifier(edge.edgeType);
}

function buildEdgeSql(edge: MatchEdge): string {
  const label = buildEdgeLabel(edge);
  const inner = `[${edge.alias}:${label}]`;
  const quantifier = edge.quantifier ?? '';
  if (edge.direction === 'OUT') {
    return `-${inner}->${quantifier}`;
  } else if (edge.direction === 'IN') {
    return `<-${inner}-${quantifier}`;
  }
  return `-${inner}-${quantifier}`;
}

export function buildMatchPattern(pattern: MatchPatternElement[]): string {
  const parts: string[] = [];
  for (const el of pattern) {
    if (isMatchNode(el)) {
      parts.push(`(${el.alias}:${escapeIdentifier(el.table)})`);
    } else {
      parts.push(buildEdgeSql(el as MatchEdge));
    }
  }
  return parts.join('');
}

export function buildMatch(
  pattern: MatchPatternElement[],
  options: MatchOptions,
): { text: string; values: unknown[] } {
  const patternSql = buildMatchPattern(pattern);

  let sql: string;
  if (options.legacySyntax) {
    sql = `MATCH ${patternSql}`;
    if (options.where) {
      sql += ` WHERE ${options.where}`;
    }
    sql += ` RETURN ${options.returnItems.join(', ')}`;
  } else {
    sql = `SELECT ${options.returnItems.join(', ')} FROM MATCH ${patternSql}`;
    if (options.where) {
      sql += ` WHERE ${options.where}`;
    }
  }

  return { text: sql, values: [] };
}

// ---------------------------------------------------------------------------
// SHORTEST MATCH query builder (path selectors)
// ---------------------------------------------------------------------------

export function buildShortestMatch(
  pattern: MatchPatternElement[],
  returnItems: string[],
  selector: ShortestMatchSelector,
  options: ShortestMatchOptions & { k?: number } = {},
): { text: string; values: unknown[] } {
  const normalized = selector.toUpperCase() as ShortestMatchSelector;
  const patternSql = buildMatchPattern(pattern);

  let selectorSql: string;
  if (normalized === 'SHORTEST') {
    if (options.k === undefined) {
      throw new TypeError('k is required when selector is SHORTEST');
    }
    assertPositiveInt(options.k, 'k');
    selectorSql = `SHORTEST ${options.k}`;
  } else {
    selectorSql = normalized;
  }

  let sql = `SELECT ${returnItems.join(', ')} FROM MATCH ${selectorSql} ${patternSql}`;

  if (options.weight) {
    sql += ` WEIGHT ${options.weight}`;
  }

  if (options.where) {
    sql += ` WHERE ${options.where}`;
  }

  return { text: sql, values: [] };
}

// ---------------------------------------------------------------------------
// SHORTEST PATH query builder
// ---------------------------------------------------------------------------

export function buildShortestPath(
  edgeType: string,
  fromTable: string,
  fromId: unknown,
  toTable: string,
  toId: unknown,
  options: ShortestPathOptions = {},
): { text: string; values: unknown[] } {
  const values: unknown[] = [fromId, toId];
  let coreSql = `SHORTEST PATH FROM ${escapeIdentifier(fromTable)}($1) TO ${escapeIdentifier(toTable)}($2) VIA ${escapeIdentifier(edgeType)}`;

  if (options.direction) {
    coreSql += ` DIRECTION ${options.direction}`;
  }

  if (options.maxDepth !== undefined) {
    assertPositiveInt(options.maxDepth, 'maxDepth');
    coreSql += ` MAX_DEPTH ${options.maxDepth}`;
  }

  let sql: string;
  if (options.legacySyntax) {
    sql = coreSql;
  } else {
    const selectClause = options.select ?? '*';
    sql = `SELECT ${selectClause} FROM ${coreSql}`;
  }

  return { text: sql, values };
}
