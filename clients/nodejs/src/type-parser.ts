/**
 * SixSevenDB type OID constants and text-format parsers.
 *
 * Maps wire protocol type OIDs to JavaScript values.
 */

// ---------------------------------------------------------------------------
// SixSevenDB type OIDs (from server pg_protocol.h)
// ---------------------------------------------------------------------------

export const TypeOID = {
  BOOL: 16,
  INT2: 21,
  INT4: 23,
  INT8: 20,
  FLOAT4: 700,
  FLOAT8: 701,
  NUMERIC: 1700,
  TEXT: 25,
  BYTEA: 17,
  DATE: 1082,
  TIME: 1083,
  TIMESTAMP: 1114,
  INTERVAL: 1186,
  POINT: 600,
  JSON: 114,
  UUID: 2950,
  EMBEDDING: 100000,
} as const;

// ---------------------------------------------------------------------------
// Text-format parsers
// ---------------------------------------------------------------------------

function parseBool(value: string): boolean {
  return value === 't' || value === 'true' || value === 'TRUE' || value === '1';
}

function parseInt2(value: string): number {
  return parseInt(value, 10);
}

function parseInt4(value: string): number {
  return parseInt(value, 10);
}

function parseInt8(value: string): number | bigint {
  const n = Number(value);
  if (Number.isSafeInteger(n)) return n;
  return BigInt(value);
}

function parseFloat4(value: string): number {
  return parseFloat(value);
}

function parseFloat8(value: string): number {
  return parseFloat(value);
}

function parseJson(value: string): unknown {
  return JSON.parse(value);
}

/**
 * Parse a SixSevenDB EMBEDDING text value (e.g. "[0.1,0.2,0.3]") into Float32Array.
 */
export function parseEmbedding(value: string): Float32Array {
  const inner = value.slice(1, -1); // strip '[' and ']'
  if (inner.length === 0) return new Float32Array(0);
  const parts = inner.split(',');
  const arr = new Float32Array(parts.length);
  for (let i = 0; i < parts.length; i++) {
    arr[i] = parseFloat(parts[i]);
  }
  return arr;
}

/**
 * Serialize a Float32Array or number[] to the SixSevenDB EMBEDDING text format.
 */
export function serializeEmbedding(arr: Float32Array | number[]): string {
  return '[' + Array.from(arr).join(',') + ']';
}

// ---------------------------------------------------------------------------
// Parser registry
// ---------------------------------------------------------------------------

type TypeParser = (value: string) => unknown;

const parsers = new Map<number, TypeParser>([
  [TypeOID.BOOL, parseBool],
  [TypeOID.INT2, parseInt2],
  [TypeOID.INT4, parseInt4],
  [TypeOID.INT8, parseInt8],
  [TypeOID.FLOAT4, parseFloat4],
  [TypeOID.FLOAT8, parseFloat8],
  [TypeOID.JSON, parseJson],
  [TypeOID.EMBEDDING, parseEmbedding],
  // TEXT, UUID, DATE, TIME, TIMESTAMP, INTERVAL, NUMERIC, POINT, BYTEA
  // are returned as strings (no parsing needed).
]);

/**
 * Parse a text-format column value based on its type OID.
 * Returns the raw string for types without a registered parser.
 */
export function parseValue(typeOID: number, value: string): unknown {
  const parser = parsers.get(typeOID);
  return parser ? parser(value) : value;
}
