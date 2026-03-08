/**
 * SixSevenDB client — single-connection API.
 *
 * ```ts
 * const client = new Client({ host: 'localhost', port: 6767 });
 * await client.connect();
 * const res = await client.query('SELECT 1 AS n');
 * console.log(res.rows); // [{ n: 1 }]
 * await client.end();
 * ```
 */

import { Connection } from './connection';
import {
  buildTraverse,
  buildNearest,
  buildLink,
  buildUnlink,
  buildMatch,
  buildShortestMatch,
  buildShortestPath,
} from './query-builders';
import { parseConnectionString } from './connection-string';
import type {
  ConnectionConfig,
  QueryResult,
  TraverseOptions,
  NearestOptions,
  LinkOptions,
  MatchPatternElement,
  MatchOptions,
  ShortestMatchSelector,
  ShortestMatchOptions,
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

export class Client {
  private connection: Connection;
  private _inTransaction = false;

  constructor(config?: ConnectionConfig | string) {
    if (typeof config === 'string') {
      this.connection = new Connection(parseConnectionString(config));
    } else {
      this.connection = new Connection(config);
    }
  }

  get inTransaction(): boolean {
    return this._inTransaction;
  }

  /** Open the connection. */
  async connect(): Promise<void> {
    await this.connection.connect();
  }

  /** Close the connection. */
  async end(): Promise<void> {
    await this.connection.end();
  }

  /** Execute a SQL query. Supports `$1, $2, ...` parameter placeholders. */
  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<T>> {
    return this.connection.query<T>(text, values);
  }

  /**
   * Execute a graph traversal.
   *
   * ```ts
   * const result = await client.traverse('follows', 'users', userId, {
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
   * Execute a vector similarity search.
   *
   * ```ts
   * const result = await client.nearest('posts', 'embedding', 'machine learning', {
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

  // Transaction methods

  async begin(): Promise<QueryResult> {
    if (this._inTransaction) throw new Error('already in a transaction');
    const result = await this.query('BEGIN');
    this._inTransaction = true;
    return result;
  }

  async commit(): Promise<QueryResult> {
    if (!this._inTransaction) throw new Error('not in a transaction');
    const result = await this.query('COMMIT');
    this._inTransaction = false;
    return result;
  }

  async rollback(): Promise<QueryResult> {
    if (!this._inTransaction) throw new Error('not in a transaction');
    const result = await this.query('ROLLBACK');
    this._inTransaction = false;
    return result;
  }

  async savepoint(name: string): Promise<QueryResult> {
    return this.query(`SAVEPOINT "${name.replace(/"/g, '""')}"`);
  }

  async rollbackTo(name: string): Promise<QueryResult> {
    return this.query(`ROLLBACK TO SAVEPOINT "${name.replace(/"/g, '""')}"`);
  }

  async transaction<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    await this.begin();
    try {
      const result = await fn(this);
      await this.commit();
      return result;
    } catch (err) {
      await this.rollback();
      throw err;
    }
  }

  // MATCH

  async match(
    pattern: MatchPatternElement[],
    options: MatchOptions,
  ): Promise<QueryResult> {
    const q = buildMatch(pattern, options);
    return this.query(q.text, q.values);
  }

  // SHORTEST MATCH (path selectors)

  async shortestMatch(
    pattern: MatchPatternElement[],
    returnItems: string[],
    selector: ShortestMatchSelector,
    options?: ShortestMatchOptions & { k?: number },
  ): Promise<QueryResult> {
    const q = buildShortestMatch(pattern, returnItems, selector, options);
    return this.query(q.text, q.values);
  }

  // SHORTEST PATH

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

  // SHOW helpers

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

  // Edge type management

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

  // EXPLAIN helpers

  async explain(sql: string, values?: unknown[]): Promise<QueryResult> {
    return this.query(`EXPLAIN ${sql}`, values);
  }

  async explainAnalyze(sql: string, values?: unknown[]): Promise<QueryResult> {
    return this.query(`EXPLAIN ANALYZE ${sql}`, values);
  }

  async explainJson(sql: string, values?: unknown[]): Promise<QueryResult> {
    return this.query(`EXPLAIN (FORMAT JSON) ${sql}`, values);
  }
}
