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
  SelectClause,
} from './types';

// Re-export SelectClause for backward compatibility — historically defined
// here in GDB-665, now lives in `./types` so `ShortestPathOptions` (and any
// future option-bag) can reference it without circular imports (GDB-670).
export type { SelectClause } from './types';
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

// Allowlist of valid edge-traversal direction tokens. Used by every builder
// that emits a `DIRECTION <token>` clause (buildTraverse, buildShortestPath,
// buildDegreeCentrality, and the WITHIN TRAVERSE clause in buildNearest).
// Consolidated from the former VALID_DEGREE_DIRECTIONS duplicate (GDB-674).
const VALID_TRAVERSAL_DIRECTIONS = ['IN', 'OUT', 'BOTH'] as const;
type TraversalDirection = (typeof VALID_TRAVERSAL_DIRECTIONS)[number];

/**
 * Validate a user-provided traversal direction against the allowlist and
 * return its uppercase form for safe interpolation. Throws TypeError for
 * non-strings, empty/whitespace strings, or strings outside the allowlist.
 *
 * This is the runtime defense against `as any` casts that bypass the
 * TypeScript `'OUT' | 'IN' | 'BOTH'` narrowing. (GDB-671: same class as the
 * GDB-665 / GDB-670 SELECT-clause injections.)
 */
function validateTraversalDirection(value: unknown, name: string): TraversalDirection {
  assertNonEmptyString(value, name);
  const upper = value.toUpperCase();
  if (!(VALID_TRAVERSAL_DIRECTIONS as readonly string[]).includes(upper)) {
    throw new TypeError(
      `${name} must be one of ${VALID_TRAVERSAL_DIRECTIONS.join(', ')}, got ${JSON.stringify(value)}`,
    );
  }
  return upper as TraversalDirection;
}
const VALID_CLOSENESS_VARIANTS = [
  'STANDARD',
  'WASSERMAN_FAUST',
  'HARMONIC',
] as const;

export type DegreeDirection = (typeof VALID_TRAVERSAL_DIRECTIONS)[number];
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

// Maximum identifier length (matches PostgreSQL's NAMEDATALEN convention).
const MAX_SELECT_IDENTIFIER_LENGTH = 64;
// Maximum number of columns in a single select array.
const MAX_SELECT_IDENTIFIER_COUNT = 1000;
// Anchored allowlist regex. JavaScript's `$` (without the `m` flag) matches
// the very end of string, so `\n` at the end is correctly rejected — this is
// equivalent to Python's `re.fullmatch`. (See GDB-669 lesson.)
const SELECT_IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Validate a user-provided SELECT projection.
 *
 * SELECT clauses cannot be parameterized — the projection is interpolated
 * directly into SQL. To eliminate the risk of injection, only two shapes are
 * accepted:
 *
 *   1. The literal string `"*"` (selects all columns).
 *   2. A non-empty array of column identifiers, each matching the allowlist
 *      regex `^[A-Za-z_][A-Za-z0-9_]*$` (ASCII letter/underscore start; ASCII
 *      letters, digits, underscores thereafter).
 *
 * Returns the rendered SQL fragment to splice into `SELECT ... FROM`.
 *
 * Each identifier is also length-capped at 64 characters (PostgreSQL
 * NAMEDATALEN convention) and the array is capped at 1000 entries (GDB-666).
 */
function renderSelect(value: unknown, name: string): string {
  // Accept the literal "*" (the documented default).
  if (value === '*') {
    return '*';
  }

  // Reject all other strings — including raw projection strings like
  // "col1, col2", "*", with surrounding whitespace, etc. This is what closes
  // the GDB-665 SQL injection: there is no string-shaped escape hatch.
  if (typeof value === 'string') {
    throw new TypeError(
      `${name} must be the string "*" or an array of column identifiers, got string ${JSON.stringify(value)}`,
    );
  }

  if (!Array.isArray(value)) {
    throw new TypeError(
      `${name} must be the string "*" or an array of column identifiers, got ${typeof value}`,
    );
  }

  if (value.length === 0) {
    throw new TypeError(`${name} must contain at least one column identifier`);
  }

  if (value.length > MAX_SELECT_IDENTIFIER_COUNT) {
    throw new RangeError(
      `${name} has ${value.length} entries; maximum is ${MAX_SELECT_IDENTIFIER_COUNT}`,
    );
  }

  const rendered: string[] = [];
  for (let i = 0; i < value.length; i++) {
    const ident = value[i];
    if (typeof ident !== 'string') {
      throw new TypeError(
        `${name}[${i}] must be a string, got ${typeof ident}`,
      );
    }
    if (ident.length === 0) {
      throw new TypeError(`${name}[${i}] must be a non-empty string`);
    }
    if (ident.length > MAX_SELECT_IDENTIFIER_LENGTH) {
      throw new RangeError(
        `${name}[${i}] is ${ident.length} characters; maximum is ${MAX_SELECT_IDENTIFIER_LENGTH}`,
      );
    }
    if (!SELECT_IDENTIFIER_RE.test(ident)) {
      throw new TypeError(
        `${name}[${i}] is not a valid column identifier: ${JSON.stringify(ident)}`,
      );
    }
    // The allowlist regex forbids `"`, but double-quote-escape anyway as
    // defense in depth.
    rendered.push('"' + ident.replace(/"/g, '""') + '"');
  }

  return rendered.join(', ');
}

export interface AlgorithmQuery {
  text: string;
  values: unknown[];
}

function buildAlgorithmSql(
  funcName: string,
  values: unknown[],
  selectSql: string,
): AlgorithmQuery {
  const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
  return {
    text: `SELECT ${selectSql} FROM ${funcName}(${placeholders})`,
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

  // GDB-671: validate `direction` against an allowlist before interpolating,
  // mirroring the buildDegreeCentrality pattern. The TypeScript type narrows
  // this to 'OUT' | 'IN' | 'BOTH', but TS is not enforced at runtime — `as any`
  // casts can otherwise smuggle arbitrary SQL into the DIRECTION clause.
  const safeDirection = validateTraversalDirection(direction, 'direction');
  sql += ` DIRECTION ${safeDirection}`;

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
    if (wt.direction !== undefined) {
      // GDB-671: WITHIN TRAVERSE shares the same DIRECTION-clause shape as
      // buildTraverse / buildShortestPath; route it through the same allowlist.
      const safeDir = validateTraversalDirection(wt.direction, 'withinTraverse.direction');
      sql += ` DIRECTION ${safeDir}`;
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

  if (options.direction !== undefined) {
    // GDB-671: validate against allowlist; raw interpolation here was the
    // SQL-injection sink reported during QA of GDB-670.
    const safeDirection = validateTraversalDirection(options.direction, 'direction');
    coreSql += ` DIRECTION ${safeDirection}`;
  }

  if (options.maxDepth !== undefined) {
    assertPositiveInt(options.maxDepth, 'maxDepth');
    coreSql += ` MAX_DEPTH ${options.maxDepth}`;
  }

  let sql: string;
  if (options.legacySyntax) {
    sql = coreSql;
  } else {
    // GDB-670: route options.select through the same allowlist used by the
    // graph-algorithm builders (GDB-665) to eliminate SQL injection via raw
    // projection-string interpolation.
    const selectSql = renderSelect(options.select ?? '*', 'select');
    sql = `SELECT ${selectSql} FROM ${coreSql}`;
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
  /**
   * Projection. Either the literal `"*"` (default — all columns) or an array
   * of column identifiers matching `^[A-Za-z_][A-Za-z0-9_]*$`. Raw projection
   * strings (e.g. `"col1, col2"`) are rejected to prevent SQL injection
   * (GDB-665).
   */
  select?: SelectClause | null;
}

export interface PagerankRow {
  node_id: unknown;
  score: number;
}

export function buildPagerank(
  edgeType: string,
  options: PagerankOptions = {},
): AlgorithmQuery {
  const { damping = 0.85, iterations = 20, select } = options;
  assertNonEmptyString(edgeType, 'edgeType');
  assertProbability(damping, 'damping');
  assertPositiveInt(iterations, 'iterations');
  const selectSql = renderSelect(select ?? '*', 'select');
  return buildAlgorithmSql('pagerank', [edgeType, damping, iterations], selectSql);
}

export interface BetweennessCentralityRow {
  node_id: unknown;
  score: number;
}

export function buildBetweennessCentrality(
  edgeType: string,
  options: { select?: SelectClause | null } = {},
): AlgorithmQuery {
  const { select } = options;
  assertNonEmptyString(edgeType, 'edgeType');
  const selectSql = renderSelect(select ?? '*', 'select');
  return buildAlgorithmSql('betweenness_centrality', [edgeType], selectSql);
}

export interface ConnectedComponentsRow {
  node_id: unknown;
  component_id: number;
}

export function buildConnectedComponents(
  edgeType: string,
  options: { select?: SelectClause | null } = {},
): AlgorithmQuery {
  const { select } = options;
  assertNonEmptyString(edgeType, 'edgeType');
  const selectSql = renderSelect(select ?? '*', 'select');
  return buildAlgorithmSql('connected_components', [edgeType], selectSql);
}

export interface LouvainOptions {
  /** Resolution parameter; >0. Defaults to 1.0. */
  resolution?: number;
  select?: SelectClause | null;
}

export interface LouvainRow {
  node_id: unknown;
  community_id: number;
}

export function buildLouvain(
  edgeType: string,
  options: LouvainOptions = {},
): AlgorithmQuery {
  const { resolution = 1.0, select } = options;
  assertNonEmptyString(edgeType, 'edgeType');
  assertPositiveNumber(resolution, 'resolution');
  const selectSql = renderSelect(select ?? '*', 'select');
  return buildAlgorithmSql('louvain', [edgeType, resolution], selectSql);
}

export interface DegreeCentralityOptions {
  /** Edge direction to count. Defaults to 'BOTH'. */
  direction?: DegreeDirection | Lowercase<DegreeDirection>;
  select?: SelectClause | null;
}

export interface DegreeCentralityRow {
  node_id: unknown;
  degree: number;
}

export function buildDegreeCentrality(
  edgeType: string,
  options: DegreeCentralityOptions = {},
): AlgorithmQuery {
  const { direction = 'BOTH', select } = options;
  assertNonEmptyString(edgeType, 'edgeType');
  // GDB-674: route through the shared validateTraversalDirection helper
  // instead of an inline allowlist+normalization block, matching the pattern
  // used by buildTraverse, buildShortestPath, and buildNearest.
  const upper = validateTraversalDirection(direction, 'direction');
  const selectSql = renderSelect(select ?? '*', 'select');
  return buildAlgorithmSql('degree_centrality', [edgeType, upper], selectSql);
}

export interface ClosenessCentralityOptions {
  /** Closeness variant. Defaults to 'STANDARD'. */
  variant?: ClosenessVariant | Lowercase<ClosenessVariant>;
  select?: SelectClause | null;
}

export interface ClosenessCentralityRow {
  node_id: unknown;
  score: number;
}

export function buildClosenessCentrality(
  edgeType: string,
  options: ClosenessCentralityOptions = {},
): AlgorithmQuery {
  const { variant = 'STANDARD', select } = options;
  assertNonEmptyString(edgeType, 'edgeType');
  assertNonEmptyString(variant, 'variant');
  const upper = variant.toUpperCase() as ClosenessVariant;
  if (!VALID_CLOSENESS_VARIANTS.includes(upper)) {
    throw new TypeError(
      `variant must be one of ${VALID_CLOSENESS_VARIANTS.join(', ')}, got ${variant}`,
    );
  }
  const selectSql = renderSelect(select ?? '*', 'select');
  return buildAlgorithmSql('closeness_centrality', [edgeType, upper], selectSql);
}

export interface EigenvectorCentralityOptions {
  /** Power-iteration count. Defaults to 100. */
  iterations?: number;
  /** Convergence tolerance; >0. Defaults to 1e-6. */
  tolerance?: number;
  select?: SelectClause | null;
}

export interface EigenvectorCentralityRow {
  node_id: unknown;
  score: number;
}

export function buildEigenvectorCentrality(
  edgeType: string,
  options: EigenvectorCentralityOptions = {},
): AlgorithmQuery {
  const { iterations = 100, tolerance = 1e-6, select } = options;
  assertNonEmptyString(edgeType, 'edgeType');
  assertPositiveInt(iterations, 'iterations');
  assertPositiveNumber(tolerance, 'tolerance');
  const selectSql = renderSelect(select ?? '*', 'select');
  return buildAlgorithmSql(
    'eigenvector_centrality',
    [edgeType, iterations, tolerance],
    selectSql,
  );
}

export interface HarmonicCentralityRow {
  node_id: unknown;
  score: number;
}

export function buildHarmonicCentrality(
  edgeType: string,
  options: { select?: SelectClause | null } = {},
): AlgorithmQuery {
  const { select } = options;
  assertNonEmptyString(edgeType, 'edgeType');
  const selectSql = renderSelect(select ?? '*', 'select');
  return buildAlgorithmSql('harmonic_centrality', [edgeType], selectSql);
}

export interface ClusteringCoefficientRow {
  node_id: unknown;
  coefficient: number;
}

export function buildClusteringCoefficient(
  edgeType: string,
  options: { select?: SelectClause | null } = {},
): AlgorithmQuery {
  const { select } = options;
  assertNonEmptyString(edgeType, 'edgeType');
  const selectSql = renderSelect(select ?? '*', 'select');
  return buildAlgorithmSql('clustering_coefficient', [edgeType], selectSql);
}

export interface TriangleCountRow {
  node_id: unknown;
  triangles: number;
}

export function buildTriangleCount(
  edgeType: string,
  options: { select?: SelectClause | null } = {},
): AlgorithmQuery {
  const { select } = options;
  assertNonEmptyString(edgeType, 'edgeType');
  const selectSql = renderSelect(select ?? '*', 'select');
  return buildAlgorithmSql('triangle_count', [edgeType], selectSql);
}

export interface StronglyConnectedComponentsRow {
  node_id: unknown;
  component_id: number;
}

export function buildStronglyConnectedComponents(
  edgeType: string,
  options: { select?: SelectClause | null } = {},
): AlgorithmQuery {
  const { select } = options;
  assertNonEmptyString(edgeType, 'edgeType');
  const selectSql = renderSelect(select ?? '*', 'select');
  return buildAlgorithmSql(
    'strongly_connected_components',
    [edgeType],
    selectSql,
  );
}
