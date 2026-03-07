export { Client } from './client';
export { Pool, PoolClient } from './pool';
export { Connection } from './connection';
export { parseEmbedding, serializeEmbedding, TypeOID, parseValue, numericToNumber } from './type-parser';
export {
  buildTraverse,
  buildNearest,
  buildLink,
  buildUnlink,
  buildMatch,
  buildShortestPath,
} from './query-builders';
export { parseConnectionString } from './connection-string';
export {
  buildSASLInitialResponse,
  buildSASLResponse,
  buildCloseMessage,
  generateClientNonce,
  buildClientFirstMessage,
  parseServerFirstMessage,
  computeSaltedPassword,
  computeClientProof,
  buildAuthMessage,
  verifyServerSignature,
} from './protocol';
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
  MatchPatternElement,
  MatchNode,
  MatchEdge,
  MatchOptions,
  ShortestPathOptions,
  WithinTraverseOptions,
  IntervalValue,
  EdgeTypeProperty,
  DatabaseInfo,
  TableInfo,
  ColumnInfo,
  EdgeTypeInfo,
  IndexInfo,
  EmbeddingInfo,
  ProviderInfo,
} from './types';
export { DEFAULTS } from './types';
