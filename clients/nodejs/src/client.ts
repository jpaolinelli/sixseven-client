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
import { buildTraverse, buildNearest, buildLink, buildUnlink } from './query-builders';
import type {
  ConnectionConfig,
  QueryResult,
  TraverseOptions,
  NearestOptions,
  LinkOptions,
} from './types';

export class Client {
  private connection: Connection;

  constructor(config?: ConnectionConfig) {
    this.connection = new Connection(config);
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
}
