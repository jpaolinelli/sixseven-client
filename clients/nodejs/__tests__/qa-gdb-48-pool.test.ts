/**
 * QA adversarial tests for pool.ts — GDB-48
 *
 * Tests connection pool edge cases: capacity limits, timeouts,
 * error handling, release behavior, and pool lifecycle.
 */
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

describe('QA: Pool adversarial', () => {
  beforeEach(() => {
    mockConnect.mockReset().mockResolvedValue(undefined);
    mockEnd.mockReset().mockResolvedValue(undefined);
    mockQuery.mockReset();
  });

  describe('pool configuration', () => {
    it('should accept max=1 configuration', async () => {
      const pool = new Pool({ max: 1 });
      mockQuery.mockResolvedValue({ rows: [], fields: [], rowCount: 0, command: 'SELECT' });
      const result = await pool.query('SELECT 1');
      expect(result.command).toBe('SELECT');
      await pool.end();
    });

    it('should use default max of 10', async () => {
      const pool = new Pool();
      mockQuery.mockResolvedValue({ rows: [], fields: [], rowCount: 0, command: 'SELECT' });

      // Create 10 connections
      const clients: PoolClient[] = [];
      for (let i = 0; i < 10; i++) {
        clients.push(await pool.connect());
      }

      expect(pool.totalCount).toBe(10);
      expect(pool.idleCount).toBe(0);

      // Release all
      for (const c of clients) c.release();
      await pool.end();
    });

    it('should use default connection values', () => {
      const pool = new Pool();
      expect(pool.totalCount).toBe(0);
      expect(pool.idleCount).toBe(0);
      expect(pool.waitingCount).toBe(0);
    });

    it('should accept min config (even though unused)', () => {
      // min is in PoolConfig but is not used in the implementation
      const pool = new Pool({ min: 5, max: 10 });
      // Should not pre-create connections
      expect(pool.totalCount).toBe(0);
    });

    it('should accept idleTimeoutMillis config (even though unused)', () => {
      // idleTimeoutMillis is in PoolConfig but is not used
      const pool = new Pool({ idleTimeoutMillis: 5000 });
      expect(pool.totalCount).toBe(0);
    });
  });

  describe('pool capacity and waiting', () => {
    it('should queue waiters when pool is at max capacity', async () => {
      const pool = new Pool({ max: 1, connectionTimeoutMillis: 500 });
      mockQuery.mockResolvedValue({ rows: [], fields: [], rowCount: 0, command: 'SELECT' });

      const client1 = await pool.connect();
      expect(pool.totalCount).toBe(1);

      // Second connect should wait
      const connectPromise = pool.connect();
      // Allow the promise to register as a waiter
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(pool.waitingCount).toBe(1);

      // Release client1 should give connection to waiter
      client1.release();
      const client2 = await connectPromise;
      expect(pool.waitingCount).toBe(0);
      expect(client2).toBeInstanceOf(PoolClient);

      client2.release();
      await pool.end();
    });

    it('should timeout waiting connections', async () => {
      const pool = new Pool({ max: 1, connectionTimeoutMillis: 50 });
      mockQuery.mockResolvedValue({ rows: [], fields: [], rowCount: 0, command: 'SELECT' });

      const client1 = await pool.connect();

      // Second connect should timeout
      await expect(pool.connect()).rejects.toThrow('connection pool timeout');

      client1.release();
      await pool.end();
    });
  });

  describe('pool close behavior', () => {
    it('should throw on query after end()', async () => {
      const pool = new Pool();
      await pool.end();
      await expect(pool.query('SELECT 1')).rejects.toThrow('pool is closed');
    });

    it('should throw on connect after end()', async () => {
      const pool = new Pool();
      await pool.end();
      await expect(pool.connect()).rejects.toThrow('pool is closed');
    });

    it('should reject waiters on end()', async () => {
      const pool = new Pool({ max: 1, connectionTimeoutMillis: 10000 });
      mockQuery.mockResolvedValue({ rows: [], fields: [], rowCount: 0, command: 'SELECT' });

      const client = await pool.connect();
      const waitPromise = pool.connect();

      // Allow waiter to register
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(pool.waitingCount).toBe(1);

      // End pool should reject waiter
      await pool.end();
      await expect(waitPromise).rejects.toThrow('pool is ending');

      // client is already ended by pool.end()
    });

    it('should handle double end() gracefully', async () => {
      const pool = new Pool();
      mockQuery.mockResolvedValue({ rows: [], fields: [], rowCount: 0, command: 'SELECT' });
      await pool.query('SELECT 1');
      await pool.end();
      // Second end should not throw
      await pool.end();
    });
  });

  describe('PoolClient behavior', () => {
    it('should throw on query after release', async () => {
      const pool = new Pool();
      const client = await pool.connect();
      client.release();
      await expect(client.query('SELECT 1')).rejects.toThrow('client already released');
      await pool.end();
    });

    it('should handle double release gracefully', async () => {
      const pool = new Pool();
      const client = await pool.connect();
      client.release();
      // Second release should be silently ignored
      client.release();
      expect(pool.idleCount).toBe(1);
      await pool.end();
    });

    it('should handle release with true (boolean) as error', async () => {
      const pool = new Pool();
      const client = await pool.connect();
      client.release(true);
      expect(mockEnd).toHaveBeenCalled();
      expect(pool.totalCount).toBe(0);
      await pool.end();
    });

    it('should handle query that throws on the connection', async () => {
      const pool = new Pool();
      mockQuery.mockRejectedValue(new Error('query failed'));

      const client = await pool.connect();
      await expect(client.query('BAD SQL')).rejects.toThrow('query failed');

      // Client should still be releasable
      client.release();
      await pool.end();
    });
  });

  describe('connection reuse', () => {
    it('should reuse idle connections for sequential queries', async () => {
      const pool = new Pool();
      mockQuery.mockResolvedValue({ rows: [], fields: [], rowCount: 0, command: 'SELECT' });

      await pool.query('SELECT 1');
      await pool.query('SELECT 2');
      await pool.query('SELECT 3');

      // Only one connection should have been created
      expect(mockConnect).toHaveBeenCalledOnce();
      expect(pool.totalCount).toBe(1);
      expect(pool.idleCount).toBe(1);
      await pool.end();
    });

    it('should create new connections for concurrent queries up to max', async () => {
      const pool = new Pool({ max: 3 });
      mockQuery.mockImplementation(
        () => new Promise((resolve) => setTimeout(() => resolve({
          rows: [], fields: [], rowCount: 0, command: 'SELECT',
        }), 50))
      );

      const p1 = pool.query('SELECT 1');
      const p2 = pool.query('SELECT 2');
      const p3 = pool.query('SELECT 3');

      await Promise.all([p1, p2, p3]);

      expect(mockConnect).toHaveBeenCalledTimes(3);
      expect(pool.totalCount).toBe(3);
      expect(pool.idleCount).toBe(3);
      await pool.end();
    });
  });

  describe('pool.query error handling', () => {
    it('should release connection on query error', async () => {
      const pool = new Pool();
      mockQuery.mockRejectedValue(new Error('query error'));

      await expect(pool.query('BAD SQL')).rejects.toThrow('query error');

      // Connection should still be in pool (released, not destroyed)
      expect(pool.totalCount).toBe(1);
      expect(pool.idleCount).toBe(1);
      await pool.end();
    });

    it('should release connection on connect error during acquire', async () => {
      const pool = new Pool();
      mockConnect.mockRejectedValue(new Error('connection refused'));

      await expect(pool.query('SELECT 1')).rejects.toThrow('connection refused');
      await pool.end();
    });
  });

  describe('pool convenience methods', () => {
    it('should support traverse through pool', async () => {
      const pool = new Pool();
      mockQuery.mockResolvedValue({
        rows: [{ __node: 2 }],
        fields: [{ name: '__node', dataTypeID: 23 }],
        rowCount: 1,
        command: 'SELECT',
      });

      const result = await pool.traverse('follows', 'users', 1);
      expect(result.rows).toEqual([{ __node: 2 }]);
      expect(mockQuery).toHaveBeenCalledOnce();
      const [sql] = mockQuery.mock.calls[0];
      expect(sql).toContain('TRAVERSE');
      await pool.end();
    });

    it('should support nearest through pool', async () => {
      const pool = new Pool();
      mockQuery.mockResolvedValue({
        rows: [],
        fields: [],
        rowCount: 0,
        command: 'SELECT',
      });

      await pool.nearest('posts', 'embedding', new Float32Array([0.1, 0.2]));
      const [sql, values] = mockQuery.mock.calls[0];
      expect(sql).toContain('NEAREST');
      expect(typeof values[0]).toBe('string'); // serialized embedding
      await pool.end();
    });

    it('should support link through pool', async () => {
      const pool = new Pool();
      mockQuery.mockResolvedValue({
        rows: [],
        fields: [],
        rowCount: 0,
        command: 'LINK',
      });

      await pool.link('follows', 'users', 1, 'users', 2, {
        properties: { weight: 0.5 },
      });
      const [sql] = mockQuery.mock.calls[0];
      expect(sql).toContain('LINK');
      expect(sql).toContain('VIA');
      expect(sql).toContain('"weight"');
      await pool.end();
    });

    it('should support unlink through pool', async () => {
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
      await pool.end();
    });
  });
});
