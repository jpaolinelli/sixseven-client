import pg from 'pg';
import { registerTypes } from './type-mapping';
import { buildTraverse, buildNearest, buildLink, buildUnlink } from './query-builders';
import type {
  PoolConfig,
  QueryResult,
  FieldInfo,
  TraverseOptions,
  NearestOptions,
  LinkOptions,
} from './types';
import { DEFAULTS as defaults } from './types';

// Ensure custom type parsers are registered.
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
 * A client checked out from the pool.
 *
 * Must call `release()` when done to return the connection to the pool.
 */
export class PoolClient {
  /** @internal */
  constructor(private pgClient: pg.PoolClient) {}

  /** Return this connection to the pool. */
  release(err?: Error | boolean): void {
    this.pgClient.release(err);
  }

  /** Execute a SQL query on this connection. */
  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<T>> {
    const pgResult = await this.pgClient.query(text, values);
    return toQueryResult<T>(pgResult);
  }
}

/**
 * A connection pool for SixSevenDB with configurable min/max connections.
 *
 * ```ts
 * const pool = new Pool({ host: 'localhost', port: 6767, min: 2, max: 10 });
 *
 * // Quick one-off query (auto-acquires and releases a connection):
 * const res = await pool.query('SELECT 1 AS n');
 *
 * // Or check out a dedicated connection:
 * const client = await pool.connect();
 * const res2 = await client.query('SELECT 2 AS n');
 * client.release();
 *
 * await pool.end();
 * ```
 */
export class Pool {
  private pg: pg.Pool;

  constructor(config?: PoolConfig) {
    this.pg = new pg.Pool({
      host: config?.host ?? defaults.host,
      port: config?.port ?? defaults.port,
      user: config?.user ?? defaults.user,
      password: config?.password,
      database: config?.database ?? defaults.database,
      min: config?.min,
      max: config?.max,
      idleTimeoutMillis: config?.idleTimeoutMillis,
      connectionTimeoutMillis: config?.connectionTimeoutMillis,
    });
  }

  /** Check out a connection from the pool. Remember to call `release()`. */
  async connect(): Promise<PoolClient> {
    const pgClient = await this.pg.connect();
    return new PoolClient(pgClient);
  }

  /** Shut down the pool and close all connections. */
  async end(): Promise<void> {
    await this.pg.end();
  }

  /**
   * Execute a query using a connection from the pool.
   * The connection is automatically acquired and released.
   */
  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<T>> {
    const pgResult = await this.pg.query(text, values);
    return toQueryResult<T>(pgResult);
  }

  /** Execute a graph traversal. See {@link Client.traverse}. */
  async traverse(
    edgeType: string,
    fromTable: string,
    startId: unknown,
    options?: TraverseOptions,
  ): Promise<QueryResult> {
    const q = buildTraverse(edgeType, fromTable, startId, options);
    return this.query(q.text, q.values);
  }

  /** Execute a vector similarity search. See {@link Client.nearest}. */
  async nearest(
    table: string,
    column: string,
    queryInput: string | Float32Array | number[],
    options?: NearestOptions,
  ): Promise<QueryResult> {
    const q = buildNearest(table, column, queryInput, options);
    return this.query(q.text, q.values);
  }

  /** Create a graph edge. See {@link Client.link}. */
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

  /** Remove a graph edge. See {@link Client.unlink}. */
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

  /** Total number of clients in the pool (active + idle). */
  get totalCount(): number {
    return this.pg.totalCount;
  }

  /** Number of clients currently checked out. */
  get activeCount(): number {
    return (this.pg as any).pool?._inUseObjectsCount ?? 0;
  }

  /** Number of idle clients in the pool. */
  get idleCount(): number {
    return this.pg.idleCount;
  }

  /** Number of queued connect requests waiting for a free client. */
  get waitingCount(): number {
    return this.pg.waitingCount;
  }
}
