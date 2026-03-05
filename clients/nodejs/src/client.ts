import pg from 'pg';
import { registerTypes } from './type-mapping';
import { buildTraverse, buildNearest, buildLink, buildUnlink } from './query-builders';
import type {
  ConnectionConfig,
  QueryResult,
  FieldInfo,
  TraverseOptions,
  NearestOptions,
  LinkOptions,
  DEFAULTS,
} from './types';
import { DEFAULTS as defaults } from './types';

// Register custom type parsers on module load.
registerTypes();

/**
 * Convert a pg.QueryResult to our QueryResult shape.
 */
function toQueryResult<T extends Record<string, unknown>>(pgResult: pg.QueryResult): QueryResult<T> {
  const fields: FieldInfo[] = pgResult.fields.map((f) => ({
    name: f.name,
    dataTypeID: f.dataTypeID,
  }));

  return {
    rows: pgResult.rows as T[],
    fields,
    rowCount: pgResult.rowCount ?? 0,
    command: pgResult.command,
  };
}

/**
 * Resolve a ConnectionConfig into the shape expected by pg.Client.
 */
function resolveConfig(config: ConnectionConfig = {}): pg.ClientConfig {
  return {
    host: config.host ?? defaults.host,
    port: config.port ?? defaults.port,
    user: config.user ?? defaults.user,
    password: config.password,
    database: config.database ?? defaults.database,
  };
}

/**
 * A SixSevenDB client wrapping node-postgres with helpers for graph and vector
 * queries. Fully promise-based — use async/await.
 *
 * ```ts
 * const client = new Client({ host: 'localhost', port: 6767 });
 * await client.connect();
 * const res = await client.query('SELECT 1 AS n');
 * console.log(res.rows); // [{ n: 1 }]
 * await client.end();
 * ```
 */
export class Client {
  private pg: pg.Client;

  constructor(config?: ConnectionConfig) {
    this.pg = new pg.Client(resolveConfig(config));
  }

  /** Open the connection. */
  async connect(): Promise<void> {
    await this.pg.connect();
  }

  /** Close the connection. */
  async end(): Promise<void> {
    await this.pg.end();
  }

  /**
   * Execute an arbitrary SQL query.
   *
   * Supports parameterized queries with `$1, $2, ...` placeholders.
   */
  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<T>> {
    const pgResult = await this.pg.query(text, values);
    return toQueryResult<T>(pgResult);
  }

  /**
   * Execute a graph traversal starting from a node.
   *
   * ```ts
   * const nodes = await client.traverse('follows', 'users', userId, {
   *   direction: 'OUT',
   *   maxDepth: 3,
   *   mode: 'NODES',
   *   fetch: true,
   * });
   * ```
   */
  async traverse(
    edgeType: string,
    fromTable: string,
    startId: unknown,
    options?: TraverseOptions,
  ): Promise<QueryResult> {
    const q = buildTraverse(edgeType, fromTable, startId, options);
    return this.query(q.text, q.values);
  }

  /**
   * Execute a vector similarity search using NEAREST.
   *
   * ```ts
   * const results = await client.nearest('posts', 'embedding', 'machine learning', {
   *   k: 5,
   *   metric: 'COSINE',
   * });
   * ```
   */
  async nearest(
    table: string,
    column: string,
    queryInput: string | Float32Array | number[],
    options?: NearestOptions,
  ): Promise<QueryResult> {
    const q = buildNearest(table, column, queryInput, options);
    return this.query(q.text, q.values);
  }

  /**
   * Create a graph edge between two nodes.
   *
   * ```ts
   * await client.link('follows', 'users', userId1, 'users', userId2, {
   *   properties: { since: '2024-01-01' },
   * });
   * ```
   */
  async link(
    edgeType: string,
    fromTable: string,
    fromId: unknown,
    toTable: string,
    toId: unknown,
    options?: LinkOptions,
  ): Promise<QueryResult> {
    const q = buildLink(edgeType, fromTable, fromId, toTable, toId, options);
    return this.query(q.text, q.values);
  }

  /**
   * Remove a graph edge between two nodes.
   *
   * ```ts
   * await client.unlink('follows', 'users', userId1, 'users', userId2);
   * ```
   */
  async unlink(
    edgeType: string,
    fromTable: string,
    fromId: unknown,
    toTable: string,
    toId: unknown,
  ): Promise<QueryResult> {
    const q = buildUnlink(edgeType, fromTable, fromId, toTable, toId);
    return this.query(q.text, q.values);
  }
}
