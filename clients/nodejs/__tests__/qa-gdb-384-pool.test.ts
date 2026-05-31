/**
 * QA adversarial tests for pool.ts — GDB-384
 *
 * Verifies that min and idleTimeoutMillis config options are properly
 * implemented: pre-warming connections, evicting idle connections after
 * timeout, respecting min during eviction, and edge cases.
 */
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

import { Pool } from '../src/pool';

describe('QA: Pool min and idleTimeoutMillis — GDB-384', () => {
  beforeEach(() => {
    mockConnect.mockReset().mockResolvedValue(undefined);
    mockEnd.mockReset().mockResolvedValue(undefined);
    mockQuery.mockReset();
  });

  // -------------------------------------------------------------------------
  // AC1: min should pre-create connections on pool initialization
  // -------------------------------------------------------------------------

  describe('min pre-warming', () => {
    it('should pre-warm exactly min connections', async () => {
      const pool = new Pool({ min: 3, max: 10 });
      await vi.waitFor(() => {
        expect(pool.totalCount).toBe(3);
      });
      expect(pool.idleCount).toBe(3);
      expect(mockConnect).toHaveBeenCalledTimes(3);
      await pool.end();
    });

    it('should not pre-warm when min=0', async () => {
      const pool = new Pool({ min: 0, max: 10 });
      // Give microtasks a chance to run
      await new Promise((r) => setTimeout(r, 50));
      expect(pool.totalCount).toBe(0);
      expect(mockConnect).not.toHaveBeenCalled();
      await pool.end();
    });

    it('should not pre-warm when min is omitted (defaults to 0)', async () => {
      const pool = new Pool({ max: 10 });
      await new Promise((r) => setTimeout(r, 50));
      expect(pool.totalCount).toBe(0);
      expect(mockConnect).not.toHaveBeenCalled();
      await pool.end();
    });

    it('should pre-warm exactly 1 connection when min=1', async () => {
      const pool = new Pool({ min: 1, max: 5 });
      await vi.waitFor(() => {
        expect(pool.totalCount).toBe(1);
      });
      expect(pool.idleCount).toBe(1);
      expect(mockConnect).toHaveBeenCalledTimes(1);
      await pool.end();
    });

    it('should clamp min to max when min > max', async () => {
      const pool = new Pool({ min: 50, max: 3 });
      await vi.waitFor(() => {
        expect(pool.totalCount).toBe(3);
      });
      expect(pool.idleCount).toBe(3);
      expect(mockConnect).toHaveBeenCalledTimes(3);
      await pool.end();
    });

    it('should pre-warm all slots when min equals max', async () => {
      const pool = new Pool({ min: 5, max: 5 });
      await vi.waitFor(() => {
        expect(pool.totalCount).toBe(5);
      });
      expect(pool.idleCount).toBe(5);
      expect(mockConnect).toHaveBeenCalledTimes(5);
      await pool.end();
    });

    it('should treat negative min as 0 (no pre-warming)', async () => {
      const pool = new Pool({ min: -5, max: 10 });
      await new Promise((r) => setTimeout(r, 50));
      expect(pool.totalCount).toBe(0);
      expect(mockConnect).not.toHaveBeenCalled();
      await pool.end();
    });

    it('should reuse pre-warmed connections on acquire', async () => {
      const pool = new Pool({ min: 2, max: 5 });
      await vi.waitFor(() => {
        expect(pool.totalCount).toBe(2);
      });

      mockQuery.mockResolvedValue({ rows: [], fields: [], rowCount: 0, command: 'SELECT' });
      await pool.query('SELECT 1');

      // Should have reused a pre-warmed connection, no additional connect calls
      expect(mockConnect).toHaveBeenCalledTimes(2);
      await pool.end();
    });

    it('should continue pre-warming past individual connection failures', async () => {
      // First connection fails, next two succeed
      mockConnect
        .mockRejectedValueOnce(new Error('refused'))
        .mockResolvedValue(undefined);

      const pool = new Pool({ min: 3, max: 10 });
      await vi.waitFor(() => {
        expect(pool.totalCount).toBe(2);
      });
      expect(pool.idleCount).toBe(2);
      // 3 attempts: 1 failed + 2 succeeded
      expect(mockConnect).toHaveBeenCalledTimes(3);
      await pool.end();
    });

    it('should stop pre-warming if pool is closed during warm-up', async () => {
      // Make connect slow so we can close mid-warm
      mockConnect.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 50)),
      );

      const pool = new Pool({ min: 10, max: 10 });
      // Close immediately — warmPool should abort
      await pool.end();

      // Should have created fewer than 10 connections
      expect(mockConnect.mock.calls.length).toBeLessThan(10);
    });
  });

  // -------------------------------------------------------------------------
  // AC2: idleTimeoutMillis should close idle connections after timeout
  // -------------------------------------------------------------------------

  describe('idleTimeoutMillis eviction', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should evict idle connection after exact timeout', async () => {
      const pool = new Pool({ idleTimeoutMillis: 1000 });
      mockQuery.mockResolvedValue({ rows: [], fields: [], rowCount: 0, command: 'SELECT' });
      await pool.query('SELECT 1');
      expect(pool.idleCount).toBe(1);

      vi.advanceTimersByTime(1000);
      expect(pool.idleCount).toBe(0);
      expect(pool.totalCount).toBe(0);
      expect(mockEnd).toHaveBeenCalled();
      await pool.end();
    });

    it('should not evict before timeout expires', async () => {
      const pool = new Pool({ idleTimeoutMillis: 1000 });
      mockQuery.mockResolvedValue({ rows: [], fields: [], rowCount: 0, command: 'SELECT' });
      await pool.query('SELECT 1');

      vi.advanceTimersByTime(999);
      expect(pool.idleCount).toBe(1);
      await pool.end();
    });

    it('should not evict when idleTimeoutMillis=0 (disabled)', async () => {
      const pool = new Pool({ idleTimeoutMillis: 0 });
      mockQuery.mockResolvedValue({ rows: [], fields: [], rowCount: 0, command: 'SELECT' });
      await pool.query('SELECT 1');

      vi.advanceTimersByTime(999_999);
      expect(pool.idleCount).toBe(1);
      await pool.end();
    });

    it('should not set up timers when idleTimeoutMillis is negative', async () => {
      const pool = new Pool({ idleTimeoutMillis: -100 });
      mockQuery.mockResolvedValue({ rows: [], fields: [], rowCount: 0, command: 'SELECT' });
      await pool.query('SELECT 1');

      vi.advanceTimersByTime(999_999);
      expect(pool.idleCount).toBe(1);
      await pool.end();
    });

    it('should evict with very small timeout (1ms)', async () => {
      const pool = new Pool({ idleTimeoutMillis: 1 });
      mockQuery.mockResolvedValue({ rows: [], fields: [], rowCount: 0, command: 'SELECT' });
      await pool.query('SELECT 1');
      expect(pool.idleCount).toBe(1);

      vi.advanceTimersByTime(1);
      expect(pool.idleCount).toBe(0);
      await pool.end();
    });

    it('should cancel idle timer when connection is reacquired', async () => {
      const pool = new Pool({ idleTimeoutMillis: 500 });
      mockQuery.mockResolvedValue({ rows: [], fields: [], rowCount: 0, command: 'SELECT' });

      await pool.query('SELECT 1');
      expect(pool.idleCount).toBe(1);

      // Advance part way through timeout
      vi.advanceTimersByTime(400);
      expect(pool.idleCount).toBe(1);

      // Reacquire the connection (resets the timer)
      await pool.query('SELECT 2');

      // Original timer's 500ms mark — should NOT evict because timer was cleared
      vi.advanceTimersByTime(100);
      expect(pool.idleCount).toBe(1);

      // New timer's 500ms mark — now it should evict
      vi.advanceTimersByTime(400);
      expect(pool.idleCount).toBe(0);
      await pool.end();
    });

    it('should evict multiple idle connections independently', async () => {
      const pool = new Pool({ max: 3, idleTimeoutMillis: 500 });
      mockQuery.mockResolvedValue({ rows: [], fields: [], rowCount: 0, command: 'SELECT' });

      // Create 3 connections by checking them out concurrently
      const c1 = await pool.connect();
      const c2 = await pool.connect();
      const c3 = await pool.connect();
      expect(pool.totalCount).toBe(3);

      // Release all — each gets an idle timer
      c1.release();
      c2.release();
      c3.release();
      expect(pool.idleCount).toBe(3);

      // All 3 should evict after timeout
      vi.advanceTimersByTime(500);
      expect(pool.idleCount).toBe(0);
      expect(pool.totalCount).toBe(0);
      await pool.end();
    });

    it('should clear all idle timers on pool.end()', async () => {
      const pool = new Pool({ idleTimeoutMillis: 5000 });
      mockQuery.mockResolvedValue({ rows: [], fields: [], rowCount: 0, command: 'SELECT' });
      await pool.query('SELECT 1');

      await pool.end();
      // Advancing timers after end should not cause errors or unexpected behavior
      vi.advanceTimersByTime(10000);
      // mockEnd called once for the pool.end() cleanup, not again from eviction
    });
  });

  // -------------------------------------------------------------------------
  // Combined: min + idleTimeoutMillis interaction
  // -------------------------------------------------------------------------

  describe('min + idleTimeoutMillis interaction', () => {
    it('should not evict below min idle count', async () => {
      // Use real timers for warm-up, then switch to fake
      vi.useFakeTimers ? vi.useRealTimers() : undefined;

      const pool = new Pool({ min: 2, max: 5, idleTimeoutMillis: 500 });
      await vi.waitFor(() => {
        expect(pool.totalCount).toBe(2);
      });

      vi.useFakeTimers();

      // All warm connections have idle timers. Advance past timeout.
      vi.advanceTimersByTime(500);

      // Should NOT drop below min=2
      expect(pool.idleCount).toBeGreaterThanOrEqual(2);
      await pool.end();
      vi.useRealTimers();
    });

    it('should evict connections above min but keep min count', async () => {
      // Use real timers for warm-up
      const pool = new Pool({ min: 2, max: 5, idleTimeoutMillis: 500 });
      await vi.waitFor(() => {
        expect(pool.totalCount).toBe(2);
      });

      vi.useFakeTimers();

      // Create a 3rd connection via query
      mockQuery.mockResolvedValue({ rows: [], fields: [], rowCount: 0, command: 'SELECT' });
      const client1 = await pool.connect();
      // This should create a new connection (since idle ones exist, it actually reuses one)
      // Let's check: connect() calls acquire(), which pops from idle
      // So we need to get above min by having 3 total

      // Actually we need to add connections above min.
      // With min=2, idle=2, acquiring one moves it to active.
      // Let's acquire all idle and create a new one, then release all.
      const client2 = await pool.connect();

      // Both warm connections are now active, pool creates a new one
      const client3 = await pool.connect();
      expect(pool.totalCount).toBe(3);

      // Release all — now 3 idle connections, each gets an idle timer
      client1.release();
      client2.release();
      client3.release();
      expect(pool.idleCount).toBe(3);

      // Advance past idle timeout
      vi.advanceTimersByTime(500);

      // Should evict down to min=2
      expect(pool.idleCount).toBe(2);
      expect(pool.totalCount).toBe(2);
      await pool.end();
      vi.useRealTimers();
    });

    it('should warm connections and schedule idle timers for them', async () => {
      const pool = new Pool({ min: 3, max: 5, idleTimeoutMillis: 1000 });
      await vi.waitFor(() => {
        expect(pool.totalCount).toBe(3);
      });
      expect(pool.idleCount).toBe(3);

      vi.useFakeTimers();

      // Advance to timeout — min guard should protect all 3
      vi.advanceTimersByTime(1000);
      expect(pool.idleCount).toBe(3);
      await pool.end();
      vi.useRealTimers();
    });
  });

  // -------------------------------------------------------------------------
  // Edge cases and stress
  // -------------------------------------------------------------------------

  describe('edge cases', () => {
    it('should handle max=0 gracefully (no connections possible)', async () => {
      const pool = new Pool({ max: 0, connectionTimeoutMillis: 50 });
      mockQuery.mockResolvedValue({ rows: [], fields: [], rowCount: 0, command: 'SELECT' });

      // Can't create any connections, should timeout
      await expect(pool.query('SELECT 1')).rejects.toThrow();
      await pool.end();
    });

    it('should handle min=1 max=1 with idleTimeoutMillis correctly', async () => {
      const pool = new Pool({ min: 1, max: 1, idleTimeoutMillis: 200 });
      await vi.waitFor(() => {
        expect(pool.totalCount).toBe(1);
      });

      vi.useFakeTimers();

      // The single warm connection should be protected by min
      vi.advanceTimersByTime(200);
      expect(pool.idleCount).toBe(1);

      // Acquire and release — should still work
      mockQuery.mockResolvedValue({ rows: [], fields: [], rowCount: 0, command: 'SELECT' });
      await pool.query('SELECT 1');
      expect(pool.idleCount).toBe(1);

      // Advance again — still protected
      vi.advanceTimersByTime(200);
      expect(pool.idleCount).toBe(1);

      await pool.end();
      vi.useRealTimers();
    });

    it('should handle all connection failures during warm-up', async () => {
      mockConnect.mockRejectedValue(new Error('all connections fail'));

      const pool = new Pool({ min: 5, max: 10 });
      // Wait a bit for warmPool to complete all attempts
      await new Promise((r) => setTimeout(r, 100));

      expect(pool.totalCount).toBe(0);
      expect(pool.idleCount).toBe(0);
      // Pool should still be usable for future connections
      expect(pool.waitingCount).toBe(0);
      await pool.end();
    });

    it('should correctly report counts during warm-up', async () => {
      // Slow connect to observe intermediate state
      let connectCount = 0;
      mockConnect.mockImplementation(() => {
        connectCount++;
        return new Promise((resolve) => setTimeout(resolve, 20));
      });

      const pool = new Pool({ min: 3, max: 10 });

      // Before warm-up completes
      expect(pool.totalCount).toBe(0);

      // Wait for full warm-up
      await vi.waitFor(
        () => {
          expect(pool.totalCount).toBe(3);
        },
        { timeout: 500 },
      );

      expect(pool.idleCount).toBe(3);
      expect(connectCount).toBe(3);
      await pool.end();
    });

    it('should handle rapid acquire-release cycles with idle timeout', async () => {
      vi.useFakeTimers();

      const pool = new Pool({ idleTimeoutMillis: 100 });
      mockQuery.mockResolvedValue({ rows: [], fields: [], rowCount: 0, command: 'SELECT' });

      // Rapid cycle: acquire, release, acquire, release — each should reset the timer
      for (let i = 0; i < 5; i++) {
        await pool.query(`SELECT ${i}`);
        vi.advanceTimersByTime(50); // Less than timeout
      }

      // Connection should still be alive because each reuse resets the timer
      expect(pool.idleCount).toBe(1);

      // Now wait for full timeout
      vi.advanceTimersByTime(100);
      expect(pool.idleCount).toBe(0);

      await pool.end();
      vi.useRealTimers();
    });

    it('should not evict a connection that was acquired between timer set and fire', async () => {
      vi.useFakeTimers();

      const pool = new Pool({ idleTimeoutMillis: 500 });
      mockQuery.mockResolvedValue({ rows: [], fields: [], rowCount: 0, command: 'SELECT' });

      // Create idle connection
      await pool.query('SELECT 1');
      expect(pool.idleCount).toBe(1);

      // Advance close to timeout
      vi.advanceTimersByTime(490);

      // Reacquire the connection
      const client = await pool.connect();
      expect(pool.idleCount).toBe(0);

      // Timer fires while connection is active — evictIdle should find idx === -1 and bail
      vi.advanceTimersByTime(10);
      expect(pool.totalCount).toBe(1); // Still active

      client.release();
      expect(pool.idleCount).toBe(1);
      await pool.end();
      vi.useRealTimers();
    });
  });
});
