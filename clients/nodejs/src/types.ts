// ---------------------------------------------------------------------------
// Connection configuration
// ---------------------------------------------------------------------------

export interface ConnectionConfig {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
}

export interface PoolConfig extends ConnectionConfig {
  min?: number;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}

// ---------------------------------------------------------------------------
// Query result types
// ---------------------------------------------------------------------------

export interface FieldInfo {
  name: string;
  dataTypeID: number;
}

export interface QueryResult<T extends Record<string, unknown> = Record<string, unknown>> {
  rows: T[];
  fields: FieldInfo[];
  rowCount: number;
  command: string;
}

// ---------------------------------------------------------------------------
// SixSevenDB-specific query builder types
// ---------------------------------------------------------------------------

export type TraverseDirection = 'OUT' | 'IN' | 'BOTH';
export type TraverseMode = 'NODES' | 'EDGES';
export type DistanceMetric = 'COSINE' | 'L2' | 'DOT';

export interface TraverseOptions {
  direction?: TraverseDirection;
  maxDepth?: number;
  mode?: TraverseMode;
  fetch?: boolean;
  where?: string;
}

export interface NearestOptions {
  k?: number;
  metric?: DistanceMetric;
  where?: string;
}

export interface LinkOptions {
  properties?: Record<string, unknown>;
}

export interface WithinTraverseOptions {
  edgeType: string;
  fromTable: string;
  startId: unknown;
  direction?: TraverseDirection;
  maxDepth?: number;
}

export interface ShortestPathOptions {
  direction?: TraverseDirection;
  maxDepth?: number;
  select?: string;
  legacySyntax?: boolean;
}

export interface MatchNode {
  alias: string;
  table: string;
}

export interface MatchEdge {
  alias: string;
  edgeType: string;
  direction: 'OUT' | 'IN' | 'BOTH';
  quantifier?: string;
  edgeTypes?: string[];
}

export type MatchPatternElement = MatchNode | MatchEdge;

export interface MatchOptions {
  where?: string;
  returnItems: string[];
  legacySyntax?: boolean;
}

export type ShortestMatchSelector = 'ANY SHORTEST' | 'ALL SHORTEST' | 'SHORTEST';

export interface ShortestMatchOptions {
  where?: string;
  weight?: string;
}

// ---------------------------------------------------------------------------
// Path result types (graph traversal / shortest path results)
// ---------------------------------------------------------------------------

export interface PathNode {
  table: string;
  id: unknown;
  properties: Record<string, unknown>;
}

export interface PathEdge {
  edgeType: string;
  fromId: unknown;
  toId: unknown;
  properties: Record<string, unknown>;
}

export interface Path {
  nodes: PathNode[];
  edges: PathEdge[];
}

// ---------------------------------------------------------------------------
// Interval / SHOW types
// ---------------------------------------------------------------------------

export interface IntervalValue {
  years: number;
  months: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
}

export interface EdgeTypeProperty {
  name: string;
  type: string;
}

// SHOW command return types
export interface DatabaseInfo extends Record<string, unknown> {
  name: string;
}

export interface TableInfo extends Record<string, unknown> {
  name: string;
}

export interface ColumnInfo extends Record<string, unknown> {
  name: string;
  type: string;
  nullable: boolean;
}

export interface EdgeTypeInfo extends Record<string, unknown> {
  name: string;
  from_table: string;
  to_table: string;
}

export interface IndexInfo extends Record<string, unknown> {
  name: string;
  table: string;
  column: string;
  type: string;
}

export interface EmbeddingInfo extends Record<string, unknown> {
  table: string;
  column: string;
  dimensions: number;
  provider: string;
}

export interface ProviderInfo extends Record<string, unknown> {
  name: string;
  type: string;
}

// ---------------------------------------------------------------------------
// Default connection values
// ---------------------------------------------------------------------------

export const DEFAULTS = {
  host: 'localhost',
  port: 6767,
  user: 'sixseven',
  database: 'sixseven',
} as const;