export { Client } from './client';
export { Pool, PoolClient } from './pool';
export { parseEmbedding, serializeEmbedding, registerTypes } from './type-mapping';
export {
  buildTraverse,
  buildNearest,
  buildLink,
  buildUnlink,
} from './query-builders';
export type {
  ConnectionConfig,
  PoolConfig,
  QueryResult,
  FieldInfo,
  TraverseDirection,
  TraverseMode,
  DistanceMetric,
  TraverseOptions,
  NearestOptions,
  LinkOptions,
} from './types';
export { DEFAULTS, PG_OID_EMBEDDING } from './types';
