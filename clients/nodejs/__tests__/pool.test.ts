import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPoolQuery = vi.fn();
const mockPoolConnect = vi.fn();
const mockPoolEnd = vi.fn();

// Mock pg before importing our module
vi.mock('pg', () => {
  class MockPool {
    query = mockPoolQuery;
    connect = mockPoolConnect;
    end = mockPoolEnd;
    totalCount = 5;
    idleCount = 3;
    waitingCount = 0;
    constructor(_config: any) {}
  }

  const mockTypes = {
    setTypeParser: vi.fn(),
  };

  return {
    default: { Pool: MockPool, types: mockTypes },
    Pool: MockPool,
    types: mockTypes,
  };
});

import { Pool, PoolClient } from '../src/pool';

describe('Pool', () => {
  let pool: Pool;

  beforeEach(() => {
    mockPoolQuery.mockReset();
    mockPoolConnect.mockReset();
    mockPoolEnd.mockReset();
  });

  it('query() returns a properly shaped QueryResult', async () => {
    pool = new Pool();
    mockPoolQuery.mockResolvedValue({
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
    pool = new Pool();
    const mockRelease = vi.fn();
    const mockClientQuery = vi.fn().mockResolvedValue({
      rows: [],
      fields: [],
      rowCount: 0,
      command: 'SELECT',
    });
    mockPoolConnect.mockResolvedValue({
      release: mockRelease,
      query: mockClientQuery,
    });

    const client = await pool.connect();
    expect(client).toBeInstanceOf(PoolClient);

    // Query through the pool client
    await client.query('SELECT 1');
    expect(mockClientQuery).toHaveBeenCalledWith('SELECT 1', undefined);

    // Release back to pool
    client.release();
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it('end() shuts down the pool', async () => {
    pool = new Pool();
    mockPoolEnd.mockResolvedValue(undefined);
    await pool.end();
    expect(mockPoolEnd).toHaveBeenCalledOnce();
  });

  it('exposes totalCount', () => {
    pool = new Pool();
    expect(pool.totalCount).toBe(5);
  });

  it('exposes idleCount', () => {
    pool = new Pool();
    expect(pool.idleCount).toBe(3);
  });

  it('exposes waitingCount', () => {
    pool = new Pool();
    expect(pool.waitingCount).toBe(0);
  });

  it('traverse() delegates to query with TRAVERSE SQL', async () => {
    pool = new Pool();
    mockPoolQuery.mockResolvedValue({
      rows: [],
      fields: [],
      rowCount: 0,
      command: 'SELECT',
    });

    await pool.traverse('follows', 'users', 1, { maxDepth: 3 });
    const [sql] = mockPoolQuery.mock.calls[0];
    expect(sql).toContain('TRAVERSE');
    expect(sql).toContain('MAX_DEPTH 3');
  });

  it('nearest() delegates to query with NEAREST SQL', async () => {
    pool = new Pool();
    mockPoolQuery.mockResolvedValue({
      rows: [],
      fields: [],
      rowCount: 0,
      command: 'SELECT',
    });

    await pool.nearest('posts', 'embedding', 'test query', { k: 5 });
    const [sql] = mockPoolQuery.mock.calls[0];
    expect(sql).toContain('NEAREST');
  });

  it('link() delegates to query with LINK SQL', async () => {
    pool = new Pool();
    mockPoolQuery.mockResolvedValue({
      rows: [],
      fields: [],
      rowCount: 0,
      command: 'LINK',
    });

    await pool.link('follows', 'users', 1, 'users', 2);
    const [sql] = mockPoolQuery.mock.calls[0];
    expect(sql).toContain('LINK');
  });

  it('unlink() delegates to query with UNLINK SQL', async () => {
    pool = new Pool();
    mockPoolQuery.mockResolvedValue({
      rows: [],
      fields: [],
      rowCount: 0,
      command: 'UNLINK',
    });

    await pool.unlink('follows', 'users', 1, 'users', 2);
    const [sql] = mockPoolQuery.mock.calls[0];
    expect(sql).toContain('UNLINK');
  });
});
