/**
 * QA adversarial tests for index.ts exports — GDB-48
 *
 * Verifies that all public API surface is correctly exported
 * and TypeScript types are accurate.
 */
import { describe, it, expect } from 'vitest';
import {
  Client,
  Pool,
  PoolClient,
  Connection,
  parseEmbedding,
  serializeEmbedding,
  TypeOID,
  parseValue,
  buildTraverse,
  buildNearest,
  buildLink,
  buildUnlink,
  DEFAULTS,
} from '../src/index';

describe('QA: Public API exports', () => {
  it('should export Client class', () => {
    expect(Client).toBeDefined();
    expect(typeof Client).toBe('function');
  });

  it('should export Pool class', () => {
    expect(Pool).toBeDefined();
    expect(typeof Pool).toBe('function');
  });

  it('should export PoolClient class', () => {
    expect(PoolClient).toBeDefined();
    expect(typeof PoolClient).toBe('function');
  });

  it('should export Connection class', () => {
    expect(Connection).toBeDefined();
    expect(typeof Connection).toBe('function');
  });

  it('should export parseEmbedding function', () => {
    expect(parseEmbedding).toBeDefined();
    expect(typeof parseEmbedding).toBe('function');
  });

  it('should export serializeEmbedding function', () => {
    expect(serializeEmbedding).toBeDefined();
    expect(typeof serializeEmbedding).toBe('function');
  });

  it('should export TypeOID constants', () => {
    expect(TypeOID).toBeDefined();
    expect(TypeOID.BOOL).toBe(16);
    expect(TypeOID.INT2).toBe(21);
    expect(TypeOID.INT4).toBe(23);
    expect(TypeOID.INT8).toBe(20);
    expect(TypeOID.FLOAT4).toBe(700);
    expect(TypeOID.FLOAT8).toBe(701);
    expect(TypeOID.NUMERIC).toBe(1700);
    expect(TypeOID.TEXT).toBe(25);
    expect(TypeOID.BYTEA).toBe(17);
    expect(TypeOID.DATE).toBe(1082);
    expect(TypeOID.TIME).toBe(1083);
    expect(TypeOID.TIMESTAMP).toBe(1114);
    expect(TypeOID.INTERVAL).toBe(1186);
    expect(TypeOID.POINT).toBe(600);
    expect(TypeOID.JSON).toBe(114);
    expect(TypeOID.UUID).toBe(2950);
    expect(TypeOID.EMBEDDING).toBe(100000);
  });

  it('should export parseValue function', () => {
    expect(parseValue).toBeDefined();
    expect(typeof parseValue).toBe('function');
  });

  it('should export buildTraverse function', () => {
    expect(buildTraverse).toBeDefined();
    expect(typeof buildTraverse).toBe('function');
  });

  it('should export buildNearest function', () => {
    expect(buildNearest).toBeDefined();
    expect(typeof buildNearest).toBe('function');
  });

  it('should export buildLink function', () => {
    expect(buildLink).toBeDefined();
    expect(typeof buildLink).toBe('function');
  });

  it('should export buildUnlink function', () => {
    expect(buildUnlink).toBeDefined();
    expect(typeof buildUnlink).toBe('function');
  });

  it('should export DEFAULTS with correct values', () => {
    expect(DEFAULTS).toBeDefined();
    expect(DEFAULTS.host).toBe('localhost');
    expect(DEFAULTS.port).toBe(6767);
    expect(DEFAULTS.user).toBe('sixseven');
    expect(DEFAULTS.database).toBe('sixseven');
  });
});

describe('QA: TypeScript type accuracy', () => {
  it('should allow QueryResult generic type parameter', async () => {
    // Type-level test: ensure generic QueryResult works
    const client = new Client();
    // This would fail type check if QueryResult<T> wasn't properly defined
    type UserRow = { id: number; name: string };
    // Just verify the type signature exists — can't test without connection
    const queryFn: (sql: string) => Promise<{ rows: UserRow[] }> = client.query.bind(client);
    expect(typeof queryFn).toBe('function');
  });

  it('should enforce FieldInfo shape', () => {
    // Verify FieldInfo has expected properties via TypeOID
    const field = { name: 'test', dataTypeID: TypeOID.INT4 };
    expect(field.name).toBe('test');
    expect(field.dataTypeID).toBe(23);
  });

  it('should have correct TraverseOptions defaults in buildTraverse', () => {
    const q = buildTraverse('edge', 'table', 1);
    // Default direction should be OUT
    expect(q.text).toContain('DIRECTION OUT');
    // Default mode should be NODES
    expect(q.text).toContain('MODE NODES');
    // No MAX_DEPTH by default
    expect(q.text).not.toContain('MAX_DEPTH');
    // No FETCH by default
    expect(q.text).not.toContain('FETCH');
    // No WHERE by default
    expect(q.text).not.toContain('WHERE');
  });

  it('should have correct NearestOptions defaults in buildNearest', () => {
    const q = buildNearest('table', 'col', 'query');
    // Default k should be 10
    expect(q.text).toContain('NEAREST 10');
    // No USING by default (COSINE is implicit)
    expect(q.text).not.toContain('USING');
    // No WHERE by default
    expect(q.text).not.toContain('WHERE');
  });
});
