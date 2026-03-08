import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockConnect = vi.fn();
const mockEnd = vi.fn();
const mockQuery = vi.fn();

vi.mock('../src/connection', () => {
  class MockConnection {
    connect = mockConnect;
    end = mockEnd;
    query = mockQuery;
    constructor(_config?: unknown) {}
  }
  return { Connection: MockConnection };
});

import { Client } from '../src/client';

describe('Client', () => {
  beforeEach(() => {
    mockConnect.mockReset();
    mockEnd.mockReset();
    mockQuery.mockReset();
  });

  it('connect() delegates to Connection.connect()', async () => {
    const client = new Client({ host: '127.0.0.1', port: 6767 });
    mockConnect.mockResolvedValue(undefined);
    await client.connect();
    expect(mockConnect).toHaveBeenCalledOnce();
  });

  it('end() delegates to Connection.end()', async () => {
    const client = new Client();
    mockEnd.mockResolvedValue(undefined);
    await client.end();
    expect(mockEnd).toHaveBeenCalledOnce();
  });

  it('query() returns a properly shaped QueryResult', async () => {
    const client = new Client();
    mockQuery.mockResolvedValue({
      rows: [{ id: 1, name: 'Alice' }],
      fields: [
        { name: 'id', dataTypeID: 23 },
        { name: 'name', dataTypeID: 25 },
      ],
      rowCount: 1,
      command: 'SELECT',
    });

    const result = await client.query('SELECT * FROM users');
    expect(result.rows).toEqual([{ id: 1, name: 'Alice' }]);
    expect(result.fields).toEqual([
      { name: 'id', dataTypeID: 23 },
      { name: 'name', dataTypeID: 25 },
    ]);
    expect(result.rowCount).toBe(1);
    expect(result.command).toBe('SELECT');
  });

  it('query() forwards parameters', async () => {
    const client = new Client();
    mockQuery.mockResolvedValue({
      rows: [],
      fields: [],
      rowCount: 0,
      command: 'SELECT',
    });

    await client.query('SELECT * FROM users WHERE id = $1', [42]);
    expect(mockQuery).toHaveBeenCalledWith(
      'SELECT * FROM users WHERE id = $1',
      [42],
    );
  });

  it('traverse() builds and executes a TRAVERSE query', async () => {
    const client = new Client();
    mockQuery.mockResolvedValue({
      rows: [{ __node: 2, __depth: 1 }],
      fields: [
        { name: '__node', dataTypeID: 23 },
        { name: '__depth', dataTypeID: 23 },
      ],
      rowCount: 1,
      command: 'SELECT',
    });

    const result = await client.traverse('follows', 'users', 1, {
      direction: 'OUT',
      maxDepth: 2,
    });

    expect(mockQuery).toHaveBeenCalledOnce();
    const [sql, values] = mockQuery.mock.calls[0];
    expect(sql).toContain('TRAVERSE');
    expect(sql).toContain('"follows"');
    expect(sql).toContain('"users"($1)');
    expect(sql).toContain('MAX_DEPTH 2');
    expect(values).toEqual([1]);
    expect(result.rows).toEqual([{ __node: 2, __depth: 1 }]);
  });

  it('nearest() builds and executes a NEAREST query', async () => {
    const client = new Client();
    mockQuery.mockResolvedValue({
      rows: [{ id: 5, _distance: 0.12 }],
      fields: [
        { name: 'id', dataTypeID: 23 },
        { name: '_distance', dataTypeID: 701 },
      ],
      rowCount: 1,
      command: 'SELECT',
    });

    const result = await client.nearest('posts', 'embedding', 'machine learning', {
      k: 5,
    });

    const [sql, values] = mockQuery.mock.calls[0];
    expect(sql).toContain('NEAREST 5');
    expect(sql).toContain('"posts"."embedding"');
    expect(sql).toContain('TO $1');
    expect(values).toEqual(['machine learning']);
    expect(result.rows[0]._distance).toBe(0.12);
  });

  it('link() builds and executes a LINK query', async () => {
    const client = new Client();
    mockQuery.mockResolvedValue({
      rows: [],
      fields: [],
      rowCount: 1,
      command: 'LINK',
    });

    await client.link('follows', 'users', 1, 'users', 2);

    const [sql, values] = mockQuery.mock.calls[0];
    expect(sql).toContain('LINK');
    expect(sql).toContain('VIA "follows"');
    expect(values).toEqual([1, 2]);
  });

  it('unlink() builds and executes an UNLINK query', async () => {
    const client = new Client();
    mockQuery.mockResolvedValue({
      rows: [],
      fields: [],
      rowCount: 1,
      command: 'UNLINK',
    });

    await client.unlink('follows', 'users', 1, 'users', 2);

    const [sql, values] = mockQuery.mock.calls[0];
    expect(sql).toContain('UNLINK');
    expect(sql).toContain('VIA "follows"');
    expect(values).toEqual([1, 2]);
  });

  // ---------------------------------------------------------------------------
  // Connection string constructor
  // ---------------------------------------------------------------------------

  it('accepts a connection string', () => {
    const client = new Client('sixseven://admin:secret@db.example.com:7777/mydb');
    expect(client).toBeInstanceOf(Client);
  });

  // ---------------------------------------------------------------------------
  // Transaction methods
  // ---------------------------------------------------------------------------

  describe('transactions', () => {
    const emptyResult = { rows: [], fields: [], rowCount: 0, command: 'SELECT' };

    beforeEach(() => {
      mockQuery.mockResolvedValue(emptyResult);
    });

    it('begin() sends BEGIN and sets inTransaction', async () => {
      const client = new Client();
      expect(client.inTransaction).toBe(false);
      await client.begin();
      expect(client.inTransaction).toBe(true);
      expect(mockQuery).toHaveBeenCalledWith('BEGIN', undefined);
    });

    it('commit() sends COMMIT and clears inTransaction', async () => {
      const client = new Client();
      await client.begin();
      await client.commit();
      expect(client.inTransaction).toBe(false);
      expect(mockQuery).toHaveBeenCalledWith('COMMIT', undefined);
    });

    it('rollback() sends ROLLBACK and clears inTransaction', async () => {
      const client = new Client();
      await client.begin();
      await client.rollback();
      expect(client.inTransaction).toBe(false);
      expect(mockQuery).toHaveBeenCalledWith('ROLLBACK', undefined);
    });

    it('begin() throws if already in a transaction', async () => {
      const client = new Client();
      await client.begin();
      await expect(client.begin()).rejects.toThrow('already in a transaction');
    });

    it('commit() throws if not in a transaction', async () => {
      const client = new Client();
      await expect(client.commit()).rejects.toThrow('not in a transaction');
    });

    it('rollback() throws if not in a transaction', async () => {
      const client = new Client();
      await expect(client.rollback()).rejects.toThrow('not in a transaction');
    });

    it('savepoint() sends SAVEPOINT with escaped name', async () => {
      const client = new Client();
      await client.savepoint('sp1');
      expect(mockQuery).toHaveBeenCalledWith('SAVEPOINT "sp1"', undefined);
    });

    it('rollbackTo() sends ROLLBACK TO SAVEPOINT', async () => {
      const client = new Client();
      await client.rollbackTo('sp1');
      expect(mockQuery).toHaveBeenCalledWith('ROLLBACK TO SAVEPOINT "sp1"', undefined);
    });

    it('transaction() auto-commits on success', async () => {
      const client = new Client();
      const result = await client.transaction(async (c) => {
        await c.query('INSERT INTO t VALUES ($1)', [1]);
        return 42;
      });
      expect(result).toBe(42);
      expect(mockQuery).toHaveBeenCalledWith('BEGIN', undefined);
      expect(mockQuery).toHaveBeenCalledWith('COMMIT', undefined);
    });

    it('transaction() auto-rollbacks on error', async () => {
      const client = new Client();
      await expect(
        client.transaction(async () => {
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect(mockQuery).toHaveBeenCalledWith('ROLLBACK', undefined);
    });
  });

  // ---------------------------------------------------------------------------
  // MATCH and SHORTEST PATH
  // ---------------------------------------------------------------------------

  it('match() builds and executes a MATCH query', async () => {
    const client = new Client();
    mockQuery.mockResolvedValue({ rows: [], fields: [], rowCount: 0, command: 'SELECT' });

    await client.match(
      [
        { table: 'users', alias: 'a' },
        { edgeType: 'follows', alias: 'e', direction: 'OUT' },
        { table: 'users', alias: 'b' },
      ],
      { where: 'a.id = 1', returnItems: ['b.name'] },
    );

    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('MATCH');
    expect(sql).toContain('SELECT b.name FROM MATCH');
  });

  it('shortestPath() builds and executes a SHORTEST PATH query', async () => {
    const client = new Client();
    mockQuery.mockResolvedValue({ rows: [], fields: [], rowCount: 0, command: 'SELECT' });

    await client.shortestPath('follows', 'users', 1, 'users', 2, { maxDepth: 5 });

    const [sql, values] = mockQuery.mock.calls[0];
    expect(sql).toContain('SHORTEST PATH');
    expect(sql).toContain('MAX_DEPTH 5');
    expect(values).toEqual([1, 2]);
  });

  // ---------------------------------------------------------------------------
  // SHOW helpers
  // ---------------------------------------------------------------------------

  describe('SHOW helpers', () => {
    const emptyResult = { rows: [], fields: [], rowCount: 0, command: 'SELECT' };

    beforeEach(() => {
      mockQuery.mockResolvedValue(emptyResult);
    });

    it('showDatabases()', async () => {
      const client = new Client();
      await client.showDatabases();
      expect(mockQuery).toHaveBeenCalledWith('SHOW DATABASES', undefined);
    });

    it('showTables()', async () => {
      const client = new Client();
      await client.showTables();
      expect(mockQuery).toHaveBeenCalledWith('SHOW TABLES', undefined);
    });

    it('showColumns()', async () => {
      const client = new Client();
      await client.showColumns('users');
      expect(mockQuery).toHaveBeenCalledWith('SHOW COLUMNS FROM "users"', undefined);
    });

    it('showEdgeTypes()', async () => {
      const client = new Client();
      await client.showEdgeTypes();
      expect(mockQuery).toHaveBeenCalledWith('SHOW EDGE TYPES', undefined);
    });

    it('showIndexes()', async () => {
      const client = new Client();
      await client.showIndexes();
      expect(mockQuery).toHaveBeenCalledWith('SHOW INDEXES', undefined);
    });

    it('showEmbeddings()', async () => {
      const client = new Client();
      await client.showEmbeddings();
      expect(mockQuery).toHaveBeenCalledWith('SHOW EMBEDDINGS', undefined);
    });

    it('showProviders()', async () => {
      const client = new Client();
      await client.showProviders();
      expect(mockQuery).toHaveBeenCalledWith('SHOW PROVIDERS', undefined);
    });
  });

  // ---------------------------------------------------------------------------
  // Edge type management
  // ---------------------------------------------------------------------------

  describe('edge type management', () => {
    const emptyResult = { rows: [], fields: [], rowCount: 0, command: 'SELECT' };

    beforeEach(() => {
      mockQuery.mockResolvedValue(emptyResult);
    });

    it('createEdgeType() builds correct SQL', async () => {
      const client = new Client();
      await client.createEdgeType(
        'follows',
        [{ name: 'since', type: 'DATE' }, { name: 'weight', type: 'FLOAT' }],
        'users',
        'users',
      );
      const [sql] = mockQuery.mock.calls[0];
      expect(sql).toBe('CREATE EDGE TYPE "follows" ("since" DATE, "weight" FLOAT) FROM "users" TO "users"');
    });

    it('dropEdgeType() builds correct SQL', async () => {
      const client = new Client();
      await client.dropEdgeType('follows');
      expect(mockQuery).toHaveBeenCalledWith('DROP EDGE TYPE "follows"', undefined);
    });

    it('dropEdgeType() with ifExists', async () => {
      const client = new Client();
      await client.dropEdgeType('follows', { ifExists: true });
      expect(mockQuery).toHaveBeenCalledWith('DROP EDGE TYPE IF EXISTS "follows"', undefined);
    });
  });

  // ---------------------------------------------------------------------------
  // EXPLAIN helpers
  // ---------------------------------------------------------------------------

  describe('EXPLAIN helpers', () => {
    const emptyResult = { rows: [], fields: [], rowCount: 0, command: 'SELECT' };

    beforeEach(() => {
      mockQuery.mockResolvedValue(emptyResult);
    });

    it('explain()', async () => {
      const client = new Client();
      await client.explain('SELECT 1');
      expect(mockQuery).toHaveBeenCalledWith('EXPLAIN SELECT 1', undefined);
    });

    it('explainAnalyze()', async () => {
      const client = new Client();
      await client.explainAnalyze('SELECT 1');
      expect(mockQuery).toHaveBeenCalledWith('EXPLAIN ANALYZE SELECT 1', undefined);
    });

    it('explainJson()', async () => {
      const client = new Client();
      await client.explainJson('SELECT 1');
      expect(mockQuery).toHaveBeenCalledWith('EXPLAIN (FORMAT JSON) SELECT 1', undefined);
    });
  });
});
