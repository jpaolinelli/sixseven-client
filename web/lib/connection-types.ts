/**
 * Types for server connection management.
 */

export interface ServerProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  /** Password for md5/scram-sha-256 auth. Ignored by servers using trust auth. */
  password: string;
  isDefault?: boolean;
}

export type ConnectionStatus =
  | "connected"
  | "disconnected"
  | "connecting"
  | "error";

/** Connection params sent with every API request. */
export interface ConnectionParams {
  host: string;
  port: number;
  user: string;
  password: string;
}
