import type { QueryResult, FieldInfo } from './types';

/** Shape of the raw result returned by the underlying wire-protocol driver. */
interface RawQueryResult {
  rows: unknown[];
  fields: { name: string; dataTypeID: number }[];
  rowCount: number | null;
  command: string;
}

/**
 * Convert a raw wire-protocol result into our QueryResult shape.
 */
export function toQueryResult<T extends Record<string, unknown>>(raw: RawQueryResult): QueryResult<T> {
  const fields: FieldInfo[] = raw.fields.map((f) => ({
    name: f.name,
    dataTypeID: f.dataTypeID,
  }));

  return {
    rows: raw.rows as T[],
    fields,
    rowCount: raw.rowCount ?? 0,
    command: raw.command,
  };
}
