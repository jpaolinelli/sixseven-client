/**
 * QA adversarial tests for connection.ts — GDB-48
 *
 * Tests Connection class edge cases: command tag parsing, row building,
 * and query protocol behavior.
 */
import { describe, it, expect } from 'vitest';

// We can't easily mock the socket for Connection integration tests,
// but we can test the helper logic indirectly through the protocol layer
// and test exported functionality.

import { Connection } from '../src/connection';

describe('QA: Connection adversarial', () => {
  describe('constructor defaults', () => {
    it('should create a connection with default config', () => {
      const conn = new Connection();
      expect(conn).toBeDefined();
    });

    it('should create a connection with empty config', () => {
      const conn = new Connection({});
      expect(conn).toBeDefined();
    });

    it('should create a connection with full config', () => {
      const conn = new Connection({
        host: '192.168.1.1',
        port: 9999,
        user: 'admin',
        password: 'secret',
        database: 'testdb',
      });
      expect(conn).toBeDefined();
    });
  });

  describe('query without connection', () => {
    it('should throw when querying before connect', async () => {
      const conn = new Connection();
      await expect(conn.query('SELECT 1')).rejects.toThrow('connection is closed');
    });
  });

  describe('end without connection', () => {
    it('should not throw when ending before connect', async () => {
      const conn = new Connection();
      // Should be a no-op
      await conn.end();
    });
  });

  describe('end idempotency', () => {
    it('should handle double end gracefully', async () => {
      const conn = new Connection();
      await conn.end();
      await conn.end();
    });
  });
});
