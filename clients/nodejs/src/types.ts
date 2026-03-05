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

// ---------------------------------------------------------------------------
// Default connection values
// ---------------------------------------------------------------------------

export const DEFAULTS = {
  host: 'localhost',
  port: 6767,
  user: 'sixseven',
  database: 'sixseven',
} as const;