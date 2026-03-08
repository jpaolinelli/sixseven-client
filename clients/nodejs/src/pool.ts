/**
 * SixSevenDB connection pool.
 *
 * Manages a set of TCP connections and distributes queries across them.
 *
 * ```ts
 * const pool = new Pool({ host: 'localhost', port: 6767, max: 10 });
 *
 * // One-off query (auto-acquires and releases):
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

import { Connection } from './connection';
import {
  buildTraverse,
  buildNearest,
  buildLink,
  buildUnlink,
  buildMatch,
  buildShortestPath,
} from './query-builders';
import { parseConnectionString } from './connection-string';
import type {
  ConnectionConfig,
  PoolConfig,
  QueryResult,
  TraverseOptions,
  NearestOptions,
  LinkOptions,
  MatchPatternElement,
  MatchOptions,
  ShortestPathOptions,
  WithinTraverseOptions,
  DatabaseInfo,
  TableInfo,
  ColumnInfo,
  EdgeTypeInfo,
  EdgeTypeProperty,
  IndexInfo,
  EmbeddingInfo,
  ProviderInfo,
} from './types';
import { DEFAULTS } from './types';

// ---------------------------------------------------------------------------
// PoolClient — a checked-out connection
// ---------------------------------------------------------------------------

/** A connection checked out from the pool. Call `release()` when done. */
export class PoolClient {
  private released = false;

  /** @internal */
  constructor(
    private connection: Connection,
    private releaseCallback: (conn: Connection, err?: Error | boolean) => void,
  ) {}

  /** Return this connection to the pool. Pass an error to destroy it instead. */
  release(err?: Error | boolean): void {
    if (this.released) return;
    this.released = true;
    this.releaseCallback(this.connection, err);
  }

  /** Execute a SQL query on this connection. */
  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<T>> {
    if (this.released) throw new Error('client already released');
    return this.connection.query<T>(text, values);
  }

  async begin(): Promise<QueryResult> {
    return this.query('BEGIN');
  }

  async commit(): Promise<QueryResult> {
    return this.query('COMMIT');
  }

  async rollback(): Promise<QueryResult> {
    return this.query('ROLLBACK');
  }
}

// ---------------------------------------------------------------------------
// Pool
// ---------------------------------------------------------------------------

interface Waiter {
  resolve: (conn: Connection) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class Pool {
  private idle: Connection[] = [];
  private active = new Set<Connection>();
  private waiters: Waiter[] = [];
  private closed = false;
  private idleTimers = new Map<Connection, ReturnType<typeof setTimeout>>();

  private readonly connConfig: ConnectionConfig;
  private readonly max: number;
  private readonly min: number;
  private readonly connectionTimeoutMillis: number;
  private readonly idleTimeoutMillis: number;

  constructor(config?: PoolConfig | string) {
    const resolved = typeof config === 'string'
      ? parseConnectionString(config)
      : config;
    this.connConfig = {
      host: resolved?.host ?? DEFAULTS.host,
      port: resolved?.port ?? DEFAULTS.port,
      user: resolved?.user ?? DEFAULTS.user,
      password: resolved?.password,
      database: resolved?.database ?? DEFAULTS.database,
    };
    const poolCfg = typeof config === 'string' ? undefined : config;
    this.max = poolCfg?.max ?? 10;
    this.min = Math.min(poolCfg?.min ?? 0, this.max);
    this.connectionTimeoutMillis = poolCfg?.connectionTimeoutMillis ?? 30_000;
    this.idleTimeoutMillis = poolCfg?.idleTimeoutMillis ?? 0;

    if (this.min > 0) {
      this.warmPool().catch(() => {});
    }
  }

  /** Check out a connection from the pool. Remember to call `release()`. */
  async connect(): Promise<PoolClient> {
    const conn = await this.acquire();
    return new PoolClient(conn, (c, err) => this.release(c, err));
  }

  /** Shut down the pool and close all connections. */
  async end(): Promise<void> {
    this.closed = true;

    for (const w of this.waiters) {
      clearTimeout(w.timer);
      w.reject(new Error('pool is ending'));
    }
    this.waiters = [];

    for (const timer of this.idleTimers.values()) {
      clearTimeout(timer);
    }
    this.idleTimers.clear();

    const all = [...this.idle, ...this.active];
    this.idle = [];
    this.active.clear();
    await Promise.all(all.map((c) => c.end()));
  }

  /**
   * Execute a query using a pooled connection.
   * The connection is automatically acquired and released.
   */
  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<T>> {
    const client = await this.connect();
    try {
      return await client.query<T>(text, values);
    } finally {
      client.release();
    }
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

  /** Total number of connections (active + idle). */
  get totalCount(): number {
    return this.active.size + this.idle.length;
  }

  /** Number of idle connections. */
  get idleCount(): number {
    return this.idle.length;
  }

  /** Number of queued connect requests waiting for a free connection. */
  get waitingCount(): number {
    return this.waiters.length;
  }

  /** Run a callback inside a transaction. Auto-commits on success, auto-rollbacks on error. */
  async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.connect();
    try {
      await client.begin();
      const result = await fn(client);
      await client.commit();
      client.release();
      return result;
    } catch (err) {
      try { await client.rollback(); } catch { /* ignore rollback errors */ }
      client.release(err instanceof Error ? err : true);
      throw err;
    }
  }

  async match(
    pattern: MatchPatternElement[],
    options: MatchOptions,
  ): Promise<QueryResult> {
    const q = buildMatch(pattern, options);
    return this.query(q.text, q.values);
  }

  async shortestPath(
    edgeType: string,
    fromTable: string,
    fromId: unknown,
    toTable: string,
    toId: unknown,
    options?: ShortestPathOptions,
  ): Promise<QueryResult> {
    const q = buildShortestPath(edgeType, fromTable, fromId, toTable, toId, options);
    return this.query(q.text, q.values);
  }

  async showDatabases(): Promise<QueryResult<DatabaseInfo>> {
    return this.query<DatabaseInfo>('SHOW DATABASES');
  }

  async showTables(): Promise<QueryResult<TableInfo>> {
    return this.query<TableInfo>('SHOW TABLES');
  }

  async showColumns(table: string): Promise<QueryResult<ColumnInfo>> {
    return this.query<ColumnInfo>(`SHOW COLUMNS FROM "${table.replace(/"/g, '""')}"`);
  }

  async showEdgeTypes(): Promise<QueryResult<EdgeTypeInfo>> {
    return this.query<EdgeTypeInfo>('SHOW EDGE TYPES');
  }

  async showIndexes(): Promise<QueryResult<IndexInfo>> {
    return this.query<IndexInfo>('SHOW INDEXES');
  }

  async showEmbeddings(): Promise<QueryResult<EmbeddingInfo>> {
    return this.query<EmbeddingInfo>('SHOW EMBEDDINGS');
  }

  async showProviders(): Promise<QueryResult<ProviderInfo>> {
    return this.query<ProviderInfo>('SHOW PROVIDERS');
  }

  async createEdgeType(
    name: string,
    properties: EdgeTypeProperty[],
    fromTable: string,
    toTable: string,
  ): Promise<QueryResult> {
    const escapedName = `"${name.replace(/"/g, '""')}"`;
    const propsSql = properties.map(
      (p) => `"${p.name.replace(/"/g, '""')}" ${p.type}`,
    ).join(', ');
    const sql = `CREATE EDGE TYPE ${escapedName} (${propsSql}) FROM "${fromTable.replace(/"/g, '""')}" TO "${toTable.replace(/"/g, '""')}"`;
    return this.query(sql);
  }

  async dropEdgeType(name: string, opts?: { ifExists?: boolean }): Promise<QueryResult> {
    const escapedName = `"${name.replace(/"/g, '""')}"`;
    const ifExists = opts?.ifExists ? 'IF EXISTS ' : '';
    return this.query(`DROP EDGE TYPE ${ifExists}${escapedName}`);
  }

  async explain(sql: string, values?: unknown[]): Promise<QueryResult> {
    return this.query(`EXPLAIN ${sql}`, values);
  }

  async explainAnalyze(sql: string, values?: unknown[]): Promise<QueryResult> {
    return this.query(`EXPLAIN ANALYZE ${sql}`, values);
  }

  async explainJson(sql: string, values?: unknown[]): Promise<QueryResult> {
    return this.query(`EXPLAIN (FORMAT JSON) ${sql}`, values);
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private async acquire(): Promise<Connection> {
    if (this.closed) throw new Error('pool is closed');

    // Reuse an idle connection
    if (this.idle.length > 0) {
      const conn = this.idle.pop()!;
      const timer = this.idleTimers.get(conn);
      if (timer) {
        clearTimeout(timer);
        this.idleTimers.delete(conn);
      }
      this.active.add(conn);
      return conn;
    }

    // Create a new connection if under the limit
    if (this.active.size < this.max) {
      const conn = new Connection(this.connConfig);
      await conn.connect();
      this.active.add(conn);
      return conn;
    }

    // Wait for a connection to be released
    return new Promise<Connection>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = this.waiters.findIndex((w) => w.resolve === resolve);
        if (idx >= 0) this.waiters.splice(idx, 1);
        reject(new Error('connection pool timeout'));
      }, this.connectionTimeoutMillis);

      this.waiters.push({ resolve, reject, timer });
    });
  }

  private release(conn: Connection, err?: Error | boolean): void {
    this.active.delete(conn);

    if (err || this.closed) {
      conn.end().catch(() => {});
      return;
    }

    // Hand to a waiting caller
    if (this.waiters.length > 0) {
      const w = this.waiters.shift()!;
      clearTimeout(w.timer);
      this.active.add(conn);
      w.resolve(conn);
      return;
    }

    // Return to idle pool
    this.idle.push(conn);
    this.scheduleIdleTimeout(conn);
  }

  private scheduleIdleTimeout(conn: Connection): void {
    if (this.idleTimeoutMillis <= 0) return;

    const timer = setTimeout(() => {
      this.evictIdle(conn);
    }, this.idleTimeoutMillis);

    // Don't let idle timers keep the Node.js process alive
    if (timer && typeof timer === 'object' && 'unref' in timer) {
      timer.unref();
    }

    this.idleTimers.set(conn, timer);
  }

  private evictIdle(conn: Connection): void {
    this.idleTimers.delete(conn);

    const idx = this.idle.indexOf(conn);
    if (idx === -1) return;

    // Don't evict below the minimum idle count
    if (this.idle.length <= this.min) return;

    this.idle.splice(idx, 1);
    conn.end().catch(() => {});
  }

  private async warmPool(): Promise<void> {
    const needed = this.min - this.totalCount;
    for (let i = 0; i < needed; i++) {
      if (this.closed) break;
      try {
        const conn = new Connection(this.connConfig);
        await conn.connect();
        this.idle.push(conn);
        this.scheduleIdleTimeout(conn);
      } catch {
        // Pre-warming is best-effort; ignore connection failures
      }
    }
  }
}
