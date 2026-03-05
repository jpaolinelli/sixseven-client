import pg from 'pg';
import { PG_OID_EMBEDDING } from './types';

/**
 * Parse a SixSevenDB EMBEDDING text value (e.g. "[0.1,0.2,0.3]") into a Float32Array.
 */
export function parseEmbedding(value: string): Float32Array {
  const inner = value.slice(1, -1); // strip '[' and ']'
  if (inner.length === 0) {
    return new Float32Array(0);
  }
  const parts = inner.split(',');
  const arr = new Float32Array(parts.length);
  for (let i = 0; i < parts.length; i++) {
    arr[i] = parseFloat(parts[i]);
  }
  return arr;
}

/**
 * Serialize a Float32Array back to the SixSevenDB EMBEDDING text format.
 */
export function serializeEmbedding(arr: Float32Array | number[]): string {
  const values = Array.from(arr);
  return '[' + values.join(',') + ']';
}

/**
 * Register SixSevenDB custom type parsers with the pg type system.
 * Call this once before creating any connections.
 */
export function registerTypes(): void {
  // EMBEDDING (OID 100000) → Float32Array
  // pg-types TypeId enum only covers builtin OIDs; the runtime accepts any number.
  (pg.types.setTypeParser as (oid: number, fn: (val: string) => unknown) => void)(
    PG_OID_EMBEDDING,
    parseEmbedding,
  );
}
