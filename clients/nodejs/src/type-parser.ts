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
  TINYINT: 3000,
  INT2: 21,
  INT4: 23,
  INT8: 20,
  UINT8: 3001,
  UINT16: 3002,
  UINT32: 3003,
  UINT64: 3004,
  FLOAT4: 700,
  FLOAT8: 701,
  NUMERIC: 1700,
  CHAR: 18,
  VARCHAR: 1043,
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

function parseTinyInt(value: string): number {
  return parseInt(value, 10);
}

function parseUint8(value: string): number {
  return parseInt(value, 10);
}

function parseUint16(value: string): number {
  return parseInt(value, 10);
}

function parseUint32(value: string): number {
  return parseInt(value, 10);
}

function parseUint64(value: string): number | bigint {
  const n = Number(value);
  if (Number.isSafeInteger(n)) return n;
  return BigInt(value);
}

function parseNumericValue(value: string): string {
  return value;
}

export function numericToNumber(value: string): number {
  return Number(value);
}

function parseDate(value: string): Date {
  // YYYY-MM-DD → Date at midnight UTC
  const [y, m, d] = value.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function parseTime(value: string): string {
  return value;
}

function parseTimestamp(value: string): Date {
  // YYYY-MM-DD HH:MM:SS[.microseconds]
  return new Date(value.replace(' ', 'T') + 'Z');
}

import type { IntervalValue } from './types';

function parseInterval(value: string): IntervalValue {
  const result: IntervalValue = { years: 0, months: 0, days: 0, hours: 0, minutes: 0, seconds: 0 };

  // Handle PostgreSQL interval formats:
  // "1 year 2 mons 3 days 04:05:06"
  // "00:00:00" (just time)
  // "1 year" etc.

  const yearMatch = value.match(/(-?\d+)\s+years?/);
  if (yearMatch) result.years = parseInt(yearMatch[1], 10);

  const monMatch = value.match(/(-?\d+)\s+mons?/);
  if (monMatch) result.months = parseInt(monMatch[1], 10);

  const dayMatch = value.match(/(-?\d+)\s+days?/);
  if (dayMatch) result.days = parseInt(dayMatch[1], 10);

  const timeMatch = value.match(/(-?\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (timeMatch) {
    result.hours = parseInt(timeMatch[1], 10);
    result.minutes = parseInt(timeMatch[2], 10);
    result.seconds = parseFloat(timeMatch[3]);
  }

  return result;
}

function parseBlob(value: string): Buffer {
  // Handle hex-encoded bytea: \\xDEADBEEF or \xDEADBEEF
  const hex = value.replace(/^\\?\\?x/i, '');
  return Buffer.from(hex, 'hex');
}

function parseUuid(value: string): string {
  const lower = value.toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(lower)) {
    throw new Error(`invalid UUID format: ${value}`);
  }
  return lower;
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
  [TypeOID.TINYINT, parseTinyInt],
  [TypeOID.INT2, parseInt2],
  [TypeOID.INT4, parseInt4],
  [TypeOID.INT8, parseInt8],
  [TypeOID.UINT8, parseUint8],
  [TypeOID.UINT16, parseUint16],
  [TypeOID.UINT32, parseUint32],
  [TypeOID.UINT64, parseUint64],
  [TypeOID.FLOAT4, parseFloat4],
  [TypeOID.FLOAT8, parseFloat8],
  [TypeOID.NUMERIC, parseNumericValue],
  [TypeOID.CHAR, (v: string) => v],
  [TypeOID.VARCHAR, (v: string) => v],
  [TypeOID.BYTEA, parseBlob],
  [TypeOID.DATE, parseDate],
  [TypeOID.TIME, parseTime],
  [TypeOID.TIMESTAMP, parseTimestamp],
  [TypeOID.INTERVAL, parseInterval],
  [TypeOID.JSON, parseJson],
  [TypeOID.UUID, parseUuid],
  [TypeOID.EMBEDDING, parseEmbedding],
]);

/**
 * Parse a text-format column value based on its type OID.
 * Returns the raw string for types without a registered parser.
 */
export function parseValue(typeOID: number, value: string): unknown {
  const parser = parsers.get(typeOID);
  return parser ? parser(value) : value;
}
