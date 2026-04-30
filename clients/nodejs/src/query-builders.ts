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
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new TypeError(
      `${name} must be a positive integer, got ${value}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Algorithm builder helpers (GDB-492)
// ---------------------------------------------------------------------------

const VALID_DEGREE_DIRECTIONS = ['IN', 'OUT', 'BOTH'] as const;
const VALID_CLOSENESS_VARIANTS = [
  'STANDARD',
  'WASSERMAN_FAUST',
  'HARMONIC',
] as const;

export type DegreeDirection = (typeof VALID_DEGREE_DIRECTIONS)[number];
export type ClosenessVariant = (typeof VALID_CLOSENESS_VARIANTS)[number];

/**
 * Validate that a value is a non-empty (after trimming) string.
 *
 * Rejects whitespace-only strings to prevent SQL that ends up referencing
 * an empty edge type.
 */
function assertNonEmptyString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string') {
    throw new TypeError(`${name} must be a string, got ${typeof value}`);
  }
  if (value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

/**
 * Validate that a value is a finite number (rejects NaN and Infinity).
 *
 * Booleans coerce to numbers in JS but are not what callers mean here, so
 * reject them explicitly.
 */
function assertFiniteNumber(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number, got ${value}`);
  }
}

/**
 * Validate that a value is a number in the open interval (0, 1).
 */
function assertProbability(value: unknown, name: string): asserts value is number {
  assertFiniteNumber(value, name);
  if (value <= 0 || value >= 1) {
    throw new RangeError(
      `${name} must be between 0 and 1 (exclusive), got ${value}`,
    );
  }
}

/**
 * Validate that a value is a strictly positive (>0) finite number.
 */
function assertPositiveNumber(value: unknown, name: string): asserts value is number {
  assertFiniteNumber(value, name);
  if (value <= 0) {
    throw new RangeError(`${name} must be positive, got ${value}`);
  }
}

/**
 * Validate a user-provided SELECT projection clause.
 *
 * SELECT clauses cannot be parameterized — the value is interpolated directly
 * into the SQL. To avoid trivial injection (terminating the query, smuggling a
 * second statement, comments, etc.), reject any string containing semicolons,
 * SQL comment sequences, or null bytes. Callers needing complex projections
 * should compose them outside the builder.
 */
function assertSafeSelect(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string') {
    throw new TypeError(`${name} must be a string, got ${typeof value}`);
  }
  if (value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
  if (
    value.includes(';') ||
    value.includes('--') ||
    value.includes('/*') ||
    value.includes('*/') ||
    value.includes('\0')
  ) {
    throw new TypeError(
      `${name} contains disallowed SQL characters (\";\", \"--\", \"/*\", \"*/\", null byte)`,
    );
  }
}

export interface AlgorithmQuery {
  text: string;
  values: unknown[];
}

function buildAlgorithmSql(
  funcName: string,
  values: unknown[],
  select: string,
): AlgorithmQuery {
  const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
  return {
    text: `SELECT ${select} FROM ${funcName}(${placeholders})`,
    values,
  };
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

// ---------------------------------------------------------------------------
// Graph algorithm query builders (GDB-492)
//
// Each builder generates a SELECT against a server-side table-valued function
// (TVF) for the corresponding graph algorithm. The edge type is bound as $1
// and any additional algorithm parameters follow ($2, $3, ...). Generated SQL
// has the shape:
//
//     SELECT <select> FROM <algorithm>($1, $2, ...)
//
// Callers can compose the result into JOINs, e.g.
//
//     SELECT u.name, p.score
//     FROM (SELECT * FROM pagerank($1)) p
//     JOIN users u ON u.id = p.node_id
// ---------------------------------------------------------------------------

export interface PagerankOptions {
  /** Damping factor in (0, 1). Defaults to 0.85. */
  damping?: number;
  /** Power-iteration count. Defaults to 20. */
  iterations?: number;
  /** Projection clause (validated against trivial SQL injection). */
  select?: string;
}

export interface PagerankRow {
  node_id: unknown;
  score: number;
}

export function buildPagerank(
  edgeType: string,
  options: PagerankOptions = {},
): AlgorithmQuery {
  const { damping = 0.85, iterations = 20, select = '*' } = options;
  assertNonEmptyString(edgeType, 'edgeType');
  assertProbability(damping, 'damping');
  assertPositiveInt(iterations, 'iterations');
  assertSafeSelect(select, 'select');
  return buildAlgorithmSql('pagerank', [edgeType, damping, iterations], select);
}

export interface BetweennessCentralityRow {
  node_id: unknown;
  score: number;
}

export function buildBetweennessCentrality(
  edgeType: string,
  options: { select?: string } = {},
): AlgorithmQuery {
  const { select = '*' } = options;
  assertNonEmptyString(edgeType, 'edgeType');
  assertSafeSelect(select, 'select');
  return buildAlgorithmSql('betweenness_centrality', [edgeType], select);
}

export interface ConnectedComponentsRow {
  node_id: unknown;
  component_id: number;
}

export function buildConnectedComponents(
  edgeType: string,
  options: { select?: string } = {},
): AlgorithmQuery {
  const { select = '*' } = options;
  assertNonEmptyString(edgeType, 'edgeType');
  assertSafeSelect(select, 'select');
  return buildAlgorithmSql('connected_components', [edgeType], select);
}

export interface LouvainOptions {
  /** Resolution parameter; >0. Defaults to 1.0. */
  resolution?: number;
  select?: string;
}

export interface LouvainRow {
  node_id: unknown;
  community_id: number;
}

export function buildLouvain(
  edgeType: string,
  options: LouvainOptions = {},
): AlgorithmQuery {
  const { resolution = 1.0, select = '*' } = options;
  assertNonEmptyString(edgeType, 'edgeType');
  assertPositiveNumber(resolution, 'resolution');
  assertSafeSelect(select, 'select');
  return buildAlgorithmSql('louvain', [edgeType, resolution], select);
}

export interface DegreeCentralityOptions {
  /** Edge direction to count. Defaults to 'BOTH'. */
  direction?: DegreeDirection | Lowercase<DegreeDirection>;
  select?: string;
}

export interface DegreeCentralityRow {
  node_id: unknown;
  degree: number;
}

export function buildDegreeCentrality(
  edgeType: string,
  options: DegreeCentralityOptions = {},
): AlgorithmQuery {
  const { direction = 'BOTH', select = '*' } = options;
  assertNonEmptyString(edgeType, 'edgeType');
  assertNonEmptyString(direction, 'direction');
  const upper = direction.toUpperCase() as DegreeDirection;
  if (!VALID_DEGREE_DIRECTIONS.includes(upper)) {
    throw new TypeError(
      `direction must be one of ${VALID_DEGREE_DIRECTIONS.join(', ')}, got ${direction}`,
    );
  }
  assertSafeSelect(select, 'select');
  return buildAlgorithmSql('degree_centrality', [edgeType, upper], select);
}

export interface ClosenessCentralityOptions {
  /** Closeness variant. Defaults to 'STANDARD'. */
  variant?: ClosenessVariant | Lowercase<ClosenessVariant>;
  select?: string;
}

export interface ClosenessCentralityRow {
  node_id: unknown;
  score: number;
}

export function buildClosenessCentrality(
  edgeType: string,
  options: ClosenessCentralityOptions = {},
): AlgorithmQuery {
  const { variant = 'STANDARD', select = '*' } = options;
  assertNonEmptyString(edgeType, 'edgeType');
  assertNonEmptyString(variant, 'variant');
  const upper = variant.toUpperCase() as ClosenessVariant;
  if (!VALID_CLOSENESS_VARIANTS.includes(upper)) {
    throw new TypeError(
      `variant must be one of ${VALID_CLOSENESS_VARIANTS.join(', ')}, got ${variant}`,
    );
  }
  assertSafeSelect(select, 'select');
  return buildAlgorithmSql('closeness_centrality', [edgeType, upper], select);
}

export interface EigenvectorCentralityOptions {
  /** Power-iteration count. Defaults to 100. */
  iterations?: number;
  /** Convergence tolerance; >0. Defaults to 1e-6. */
  tolerance?: number;
  select?: string;
}

export interface EigenvectorCentralityRow {
  node_id: unknown;
  score: number;
}

export function buildEigenvectorCentrality(
  edgeType: string,
  options: EigenvectorCentralityOptions = {},
): AlgorithmQuery {
  const { iterations = 100, tolerance = 1e-6, select = '*' } = options;
  assertNonEmptyString(edgeType, 'edgeType');
  assertPositiveInt(iterations, 'iterations');
  assertPositiveNumber(tolerance, 'tolerance');
  assertSafeSelect(select, 'select');
  return buildAlgorithmSql(
    'eigenvector_centrality',
    [edgeType, iterations, tolerance],
    select,
  );
}

export interface HarmonicCentralityRow {
  node_id: unknown;
  score: number;
}

export function buildHarmonicCentrality(
  edgeType: string,
  options: { select?: string } = {},
): AlgorithmQuery {
  const { select = '*' } = options;
  assertNonEmptyString(edgeType, 'edgeType');
  assertSafeSelect(select, 'select');
  return buildAlgorithmSql('harmonic_centrality', [edgeType], select);
}

export interface ClusteringCoefficientRow {
  node_id: unknown;
  coefficient: number;
}

export function buildClusteringCoefficient(
  edgeType: string,
  options: { select?: string } = {},
): AlgorithmQuery {
  const { select = '*' } = options;
  assertNonEmptyString(edgeType, 'edgeType');
  assertSafeSelect(select, 'select');
  return buildAlgorithmSql('clustering_coefficient', [edgeType], select);
}

export interface TriangleCountRow {
  node_id: unknown;
  triangles: number;
}

export function buildTriangleCount(
  edgeType: string,
  options: { select?: string } = {},
): AlgorithmQuery {
  const { select = '*' } = options;
  assertNonEmptyString(edgeType, 'edgeType');
  assertSafeSelect(select, 'select');
  return buildAlgorithmSql('triangle_count', [edgeType], select);
}

export interface StronglyConnectedComponentsRow {
  node_id: unknown;
  component_id: number;
}

export function buildStronglyConnectedComponents(
  edgeType: string,
  options: { select?: string } = {},
): AlgorithmQuery {
  const { select = '*' } = options;
  assertNonEmptyString(edgeType, 'edgeType');
  assertSafeSelect(select, 'select');
  return buildAlgorithmSql(
    'strongly_connected_components',
    [edgeType],
    select,
  );
}
