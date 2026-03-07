import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

  // ---------------------------------------------------------------------------
  // min — pre-warm and maintain minimum idle connections
  // ---------------------------------------------------------------------------

  describe('min config', () => {
    it('pre-warms connections up to min on construction', async () => {
      const pool = new Pool({ min: 3, max: 10 });
      // Allow async warmPool to complete
      await vi.waitFor(() => {
        expect(pool.totalCount).toBe(3);
      });
      expect(pool.idleCount).toBe(3);
      expect(mockConnect).toHaveBeenCalledTimes(3);
      await pool.end();
    });

    it('min is clamped to max', async () => {
      const pool = new Pool({ min: 20, max: 5 });
      await vi.waitFor(() => {
        expect(pool.totalCount).toBe(5);
      });
      expect(pool.idleCount).toBe(5);
      await pool.end();
    });

    it('warm connections are reused by acquire', async () => {
      const pool = new Pool({ min: 2, max: 5 });
      await vi.waitFor(() => {
        expect(pool.totalCount).toBe(2);
      });
      mockQuery.mockResolvedValue({ rows: [], fields: [], rowCount: 0, command: 'SELECT' });

      await pool.query('SELECT 1');
      // Should have reused a pre-warmed connection, not created a new one
      // 2 connects from warm-up, 0 additional
      expect(mockConnect).toHaveBeenCalledTimes(2);
      await pool.end();
    });

    it('warmPool ignores connection failures', async () => {
      mockConnect.mockRejectedValueOnce(new Error('connection refused'));
      mockConnect.mockResolvedValue(undefined);
      const pool = new Pool({ min: 3, max: 10 });
      await vi.waitFor(() => {
        expect(pool.totalCount).toBe(2);
      });
      // One failed, two succeeded
      expect(pool.idleCount).toBe(2);
      await pool.end();
    });
  });

  // ---------------------------------------------------------------------------
  // idleTimeoutMillis — evict idle connections after timeout
  // ---------------------------------------------------------------------------

  describe('idleTimeoutMillis config', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('evicts idle connections after timeout expires', async () => {
      const pool = new Pool({ idleTimeoutMillis: 500 });
      mockQuery.mockResolvedValue({ rows: [], fields: [], rowCount: 0, command: 'SELECT' });
      await pool.query('SELECT 1');

      expect(pool.idleCount).toBe(1);

      vi.advanceTimersByTime(500);
      expect(pool.idleCount).toBe(0);
      expect(mockEnd).toHaveBeenCalled();
      await pool.end();
    });

    it('does not evict connections before timeout', async () => {
      const pool = new Pool({ idleTimeoutMillis: 1000 });
      mockQuery.mockResolvedValue({ rows: [], fields: [], rowCount: 0, command: 'SELECT' });
      await pool.query('SELECT 1');

      vi.advanceTimersByTime(999);
      expect(pool.idleCount).toBe(1);
      expect(pool.totalCount).toBe(1);
      await pool.end();
    });

    it('clears idle timer when connection is acquired from idle', async () => {
      const pool = new Pool({ idleTimeoutMillis: 500 });
      mockQuery.mockResolvedValue({ rows: [], fields: [], rowCount: 0, command: 'SELECT' });

      // First query creates and releases connection
      await pool.query('SELECT 1');
      expect(pool.idleCount).toBe(1);

      // Second query reuses the idle connection, clearing its timer
      await pool.query('SELECT 2');
      expect(pool.idleCount).toBe(1);

      // Original timer fires but connection was reused; a new timer was set
      vi.advanceTimersByTime(500);
      expect(pool.idleCount).toBe(0);
      await pool.end();
    });

    it('does not evict below min idle count', async () => {
      // Use real timers briefly for warmPool, then switch to fake
      vi.useRealTimers();
      const pool = new Pool({ min: 2, max: 5, idleTimeoutMillis: 500 });
      await vi.waitFor(() => {
        expect(pool.totalCount).toBe(2);
      });

      vi.useFakeTimers();

      // Add a 3rd connection via query
      mockQuery.mockResolvedValue({ rows: [], fields: [], rowCount: 0, command: 'SELECT' });
      const client = await pool.connect();
      // Pool creates new connection since warm ones are idle
      // Actually, connect() should reuse an idle warm connection
      client.release();

      // Now we have at least 2 idle. Advance past timeout.
      vi.advanceTimersByTime(500);
      // Should not go below min=2
      expect(pool.idleCount).toBeGreaterThanOrEqual(2);
      await pool.end();
    });

    it('idleTimeoutMillis=0 means no eviction', async () => {
      const pool = new Pool({ idleTimeoutMillis: 0 });
      mockQuery.mockResolvedValue({ rows: [], fields: [], rowCount: 0, command: 'SELECT' });
      await pool.query('SELECT 1');

      vi.advanceTimersByTime(999_999);
      expect(pool.idleCount).toBe(1);
      await pool.end();
    });

    it('end() clears idle timers', async () => {
      const pool = new Pool({ idleTimeoutMillis: 500 });
      mockQuery.mockResolvedValue({ rows: [], fields: [], rowCount: 0, command: 'SELECT' });
      await pool.query('SELECT 1');

      await pool.end();
      // Advancing timers after end should not cause errors
      vi.advanceTimersByTime(1000);
    });
  });
});
