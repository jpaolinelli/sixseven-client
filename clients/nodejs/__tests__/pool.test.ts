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

import { Pool, PoolClient } from '../src/pool';

describe('Pool', () => {
  beforeEach(() => {
    mockConnect.mockReset().mockResolvedValue(undefined);
    mockEnd.mockReset().mockResolvedValue(undefined);
    mockQuery.mockReset();
  });

  it('query() returns a properly shaped QueryResult', async () => {
    const pool = new Pool();
    mockQuery.mockResolvedValue({
      rows: [{ n: 1 }],
      fields: [{ name: 'n', dataTypeID: 23 }],
      rowCount: 1,
      command: 'SELECT',
    });

    const result = await pool.query('SELECT 1 AS n');
    expect(result.rows).toEqual([{ n: 1 }]);
    expect(result.rowCount).toBe(1);
    expect(result.command).toBe('SELECT');
  });

  it('connect() returns a PoolClient', async () => {
    const pool = new Pool();
    mockQuery.mockResolvedValue({
      rows: [],
      fields: [],
      rowCount: 0,
      command: 'SELECT',
    });

    const client = await pool.connect();
    expect(client).toBeInstanceOf(PoolClient);

    // Query through the pool client
    await client.query('SELECT 1');
    expect(mockQuery).toHaveBeenCalledWith('SELECT 1', undefined);

    // Release back to pool
    client.release();
  });

  it('end() shuts down the pool', async () => {
    const pool = new Pool();
    // Acquire a connection first so there's something to close
    mockQuery.mockResolvedValue({ rows: [], fields: [], rowCount: 0, command: 'SELECT' });
    await pool.query('SELECT 1');
    await pool.end();
    expect(mockEnd).toHaveBeenCalled();
  });

  it('totalCount reflects active + idle connections', async () => {
    const pool = new Pool();
    expect(pool.totalCount).toBe(0);
    mockQuery.mockResolvedValue({ rows: [], fields: [], rowCount: 0, command: 'SELECT' });
    await pool.query('SELECT 1');
    // After query, connection is released to idle
    expect(pool.totalCount).toBe(1);
    expect(pool.idleCount).toBe(1);
  });

  it('waitingCount starts at 0', () => {
    const pool = new Pool();
    expect(pool.waitingCount).toBe(0);
  });

  it('reuses idle connections', async () => {
    const pool = new Pool();
    mockQuery.mockResolvedValue({ rows: [], fields: [], rowCount: 0, command: 'SELECT' });
    await pool.query('SELECT 1');
    await pool.query('SELECT 2');
    // Only one connection should have been created
    expect(mockConnect).toHaveBeenCalledOnce();
    expect(pool.totalCount).toBe(1);
  });

  it('traverse() delegates to query with TRAVERSE SQL', async () => {
    const pool = new Pool();
    mockQuery.mockResolvedValue({
      rows: [],
      fields: [],
      rowCount: 0,
      command: 'SELECT',
    });

    await pool.traverse('follows', 'users', 1, { maxDepth: 3 });
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('TRAVERSE');
    expect(sql).toContain('MAX_DEPTH 3');
  });

  it('nearest() delegates to query with NEAREST SQL', async () => {
    const pool = new Pool();
    mockQuery.mockResolvedValue({
      rows: [],
      fields: [],
      rowCount: 0,
      command: 'SELECT',
    });

    await pool.nearest('posts', 'embedding', 'test query', { k: 5 });
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('NEAREST');
  });

  it('link() delegates to query with LINK SQL', async () => {
    const pool = new Pool();
    mockQuery.mockResolvedValue({
      rows: [],
      fields: [],
      rowCount: 0,
      command: 'LINK',
    });

    await pool.link('follows', 'users', 1, 'users', 2);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('LINK');
  });

  it('unlink() delegates to query with UNLINK SQL', async () => {
    const pool = new Pool();
    mockQuery.mockResolvedValue({
      rows: [],
      fields: [],
      rowCount: 0,
      command: 'UNLINK',
    });

    await pool.unlink('follows', 'users', 1, 'users', 2);
    const [sql] = mockQuery.mock.calls[0];
    expect(sql).toContain('UNLINK');
  });

  it('PoolClient throws after release', async () => {
    const pool = new Pool();
    const client = await pool.connect();
    client.release();
    await expect(client.query('SELECT 1')).rejects.toThrow('client already released');
  });

  it('release with error destroys the connection', async () => {
    const pool = new Pool();
    const client = await pool.connect();
    client.release(new Error('broken'));
    expect(mockEnd).toHaveBeenCalled();
    expect(pool.totalCount).toBe(0);
  });
});
