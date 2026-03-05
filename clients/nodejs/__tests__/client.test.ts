import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
const mockConnect = vi.fn();
const mockEnd = vi.fn();

// Mock pg before importing our module
vi.mock('pg', () => {
  class MockClient {
    connect = mockConnect;
    end = mockEnd;
    query = mockQuery;
    _config: any;
    constructor(config: any) {
      this._config = config;
    }
  }

  const mockTypes = {
    setTypeParser: vi.fn(),
  };

  return {
    default: { Client: MockClient, types: mockTypes },
    Client: MockClient,
    types: mockTypes,
  };
});

import { Client } from '../src/client';
import pg from 'pg';

function getLastPgConfig(): any {
  // Access the stored config from the last constructed mock instance
  const results = (pg.Client as any).prototype;
  // Instead, we need to capture config another way since we use a class mock.
  // We'll inspect by creating a new Client and checking the underlying pg instance.
  return undefined;
}

describe('Client', () => {
  let client: Client;

  beforeEach(() => {
    mockQuery.mockReset();
    mockConnect.mockReset();
    mockEnd.mockReset();
  });

  it('connect() delegates to pg.Client.connect()', async () => {
    client = new Client({ host: '127.0.0.1', port: 6767 });
    mockConnect.mockResolvedValue(undefined);
    await client.connect();
    expect(mockConnect).toHaveBeenCalledOnce();
  });

  it('end() delegates to pg.Client.end()', async () => {
    client = new Client();
    mockEnd.mockResolvedValue(undefined);
    await client.end();
    expect(mockEnd).toHaveBeenCalledOnce();
  });

  it('query() returns a properly shaped QueryResult', async () => {
    client = new Client();
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
    client = new Client();
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
    client = new Client();
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
    expect(sql).toContain('MAX_DEPTH 2');
    expect(values).toEqual([1]);
    expect(result.rows).toEqual([{ __node: 2, __depth: 1 }]);
  });

  it('nearest() builds and executes a NEAREST query', async () => {
    client = new Client();
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
    expect(sql).toContain('NEAREST');
    expect(sql).toContain('"posts"');
    expect(sql).toContain(', 5)');
    expect(values).toEqual(['machine learning']);
    expect(result.rows[0]._distance).toBe(0.12);
  });

  it('link() builds and executes a LINK query', async () => {
    client = new Client();
    mockQuery.mockResolvedValue({
      rows: [],
      fields: [],
      rowCount: 1,
      command: 'LINK',
    });

    await client.link('follows', 'users', 1, 'users', 2);

    const [sql, values] = mockQuery.mock.calls[0];
    expect(sql).toContain('LINK');
    expect(values).toEqual([1, 2]);
  });

  it('unlink() builds and executes an UNLINK query', async () => {
    client = new Client();
    mockQuery.mockResolvedValue({
      rows: [],
      fields: [],
      rowCount: 1,
      command: 'UNLINK',
    });

    await client.unlink('follows', 'users', 1, 'users', 2);

    const [sql, values] = mockQuery.mock.calls[0];
    expect(sql).toContain('UNLINK');
    expect(values).toEqual([1, 2]);
  });
});
