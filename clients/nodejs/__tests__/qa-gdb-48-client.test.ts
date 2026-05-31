/**
 * QA adversarial tests for client.ts — GDB-48
 *
 * Tests Client API edge cases, error handling, and query builder delegation.
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

import { Client } from '../src/client';

describe('QA: Client adversarial', () => {
  beforeEach(() => {
    mockConnect.mockReset().mockResolvedValue(undefined);
    mockEnd.mockReset().mockResolvedValue(undefined);
    mockQuery.mockReset();
  });

  describe('constructor', () => {
    it('should accept empty config', () => {
      const client = new Client({});
      expect(client).toBeDefined();
    });

    it('should accept no config', () => {
      const client = new Client();
      expect(client).toBeDefined();
    });

    it('should accept full config', () => {
      const client = new Client({
        host: '192.168.1.1',
        port: 9999,
        user: 'testuser',
        password: 'testpass',
        database: 'testdb',
      });
      expect(client).toBeDefined();
    });
  });

  describe('connect/end lifecycle', () => {
    it('should propagate connect errors', async () => {
      const client = new Client();
      mockConnect.mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(client.connect()).rejects.toThrow('ECONNREFUSED');
    });

    it('should propagate end errors', async () => {
      const client = new Client();
      mockEnd.mockRejectedValue(new Error('end failed'));
      await expect(client.end()).rejects.toThrow('end failed');
    });
  });

  describe('query edge cases', () => {
    it('should handle empty string query', async () => {
      const client = new Client();
      mockQuery.mockResolvedValue({
        rows: [],
        fields: [],
        rowCount: 0,
        command: '',
      });
      const result = await client.query('');
      expect(result.rows).toEqual([]);
    });

    it('should handle query with undefined params', async () => {
      const client = new Client();
      mockQuery.mockResolvedValue({
        rows: [],
        fields: [],
        rowCount: 0,
        command: 'SELECT',
      });
      await client.query('SELECT 1', undefined);
      expect(mockQuery).toHaveBeenCalledWith('SELECT 1', undefined);
    });

    it('should handle query with empty params array', async () => {
      const client = new Client();
      mockQuery.mockResolvedValue({
        rows: [],
        fields: [],
        rowCount: 0,
        command: 'SELECT',
      });
      await client.query('SELECT 1', []);
      expect(mockQuery).toHaveBeenCalledWith('SELECT 1', []);
    });

    it('should handle query with null param value', async () => {
      const client = new Client();
      mockQuery.mockResolvedValue({
        rows: [],
        fields: [],
        rowCount: 0,
        command: 'INSERT',
      });
      await client.query('INSERT INTO t(col) VALUES($1)', [null]);
      expect(mockQuery).toHaveBeenCalledWith(
        'INSERT INTO t(col) VALUES($1)',
        [null],
      );
    });

    it('should propagate query errors', async () => {
      const client = new Client();
      mockQuery.mockRejectedValue(new Error('syntax error'));
      await expect(client.query('INVALID SQL')).rejects.toThrow('syntax error');
    });

    it('should handle large result sets', async () => {
      const client = new Client();
      const rows = Array.from({ length: 10000 }, (_, i) => ({ id: i, name: `row${i}` }));
      mockQuery.mockResolvedValue({
        rows,
        fields: [
          { name: 'id', dataTypeID: 23 },
          { name: 'name', dataTypeID: 25 },
        ],
        rowCount: 10000,
        command: 'SELECT',
      });
      const result = await client.query('SELECT * FROM big_table');
      expect(result.rows.length).toBe(10000);
      expect(result.rowCount).toBe(10000);
    });
  });

  describe('traverse edge cases', () => {
    it('should handle traverse with no options', async () => {
      const client = new Client();
      mockQuery.mockResolvedValue({
        rows: [],
        fields: [],
        rowCount: 0,
        command: 'SELECT',
      });
      const result = await client.traverse('follows', 'users', 1);
      expect(result.rows).toEqual([]);
      const [sql] = mockQuery.mock.calls[0];
      expect(sql).toContain('TRAVERSE');
      expect(sql).toContain('DIRECTION OUT');
      expect(sql).toContain('MODE NODES');
    });

    it('should handle traverse with all options', async () => {
      const client = new Client();
      mockQuery.mockResolvedValue({
        rows: [],
        fields: [],
        rowCount: 0,
        command: 'SELECT',
      });
      await client.traverse('follows', 'users', 1, {
        direction: 'BOTH',
        maxDepth: 10,
        mode: 'EDGES',
        fetch: true,
        where: '__depth > 1',
      });
      const [sql] = mockQuery.mock.calls[0];
      expect(sql).toContain('DIRECTION BOTH');
      expect(sql).toContain('MAX_DEPTH 10');
      expect(sql).toContain('MODE EDGES');
      expect(sql).toContain('FETCH');
      expect(sql).toContain('WHERE __depth > 1');
    });
  });

  describe('nearest edge cases', () => {
    it('should handle nearest with string query', async () => {
      const client = new Client();
      mockQuery.mockResolvedValue({
        rows: [],
        fields: [],
        rowCount: 0,
        command: 'SELECT',
      });
      await client.nearest('posts', 'embedding', 'machine learning');
      const [, values] = mockQuery.mock.calls[0];
      expect(values[0]).toBe('machine learning');
    });

    it('should handle nearest with Float32Array query', async () => {
      const client = new Client();
      mockQuery.mockResolvedValue({
        rows: [],
        fields: [],
        rowCount: 0,
        command: 'SELECT',
      });
      const vec = new Float32Array([0.1, 0.2, 0.3]);
      await client.nearest('posts', 'embedding', vec);
      const [, values] = mockQuery.mock.calls[0];
      expect(typeof values[0]).toBe('string');
    });

    it('should handle nearest with number[] query', async () => {
      const client = new Client();
      mockQuery.mockResolvedValue({
        rows: [],
        fields: [],
        rowCount: 0,
        command: 'SELECT',
      });
      await client.nearest('posts', 'embedding', [0.1, 0.2, 0.3]);
      const [, values] = mockQuery.mock.calls[0];
      expect(typeof values[0]).toBe('string');
    });
  });

  describe('link/unlink edge cases', () => {
    it('should handle link with properties', async () => {
      const client = new Client();
      mockQuery.mockResolvedValue({
        rows: [],
        fields: [],
        rowCount: 1,
        command: 'LINK',
      });
      await client.link('rated', 'users', 1, 'products', 5, {
        properties: { score: 4.5 },
      });
      const [sql, values] = mockQuery.mock.calls[0];
      expect(sql).toContain('LINK');
      expect(sql).toContain('"score"');
      expect(values).toEqual([1, 5, 4.5]);
    });

    it('should handle unlink with UUID IDs', async () => {
      const client = new Client();
      mockQuery.mockResolvedValue({
        rows: [],
        fields: [],
        rowCount: 1,
        command: 'UNLINK',
      });
      const id1 = '550e8400-e29b-41d4-a716-446655440000';
      const id2 = '550e8400-e29b-41d4-a716-446655440001';
      await client.unlink('follows', 'users', id1, 'users', id2);
      const [, values] = mockQuery.mock.calls[0];
      expect(values).toEqual([id1, id2]);
    });
  });
});
