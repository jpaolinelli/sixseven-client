import type { ConnectionConfig } from './types';
import { DEFAULTS } from './types';

/**
 * Parse a SixSevenDB connection string into a ConnectionConfig.
 *
 * Format: sixseven://[user[:password]@]host[:port][/database]
 */
export function parseConnectionString(url: string): ConnectionConfig {
  const parsed = new URL(url);

  if (parsed.protocol !== 'sixseven:') {
    throw new Error(`unsupported protocol: ${parsed.protocol} (expected sixseven:)`);
  }

  return {
    host: parsed.hostname || DEFAULTS.host,
    port: parsed.port ? parseInt(parsed.port, 10) : DEFAULTS.port,
    user: parsed.username ? decodeURIComponent(parsed.username) : DEFAULTS.user,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    database: parsed.pathname && parsed.pathname.length > 1
      ? decodeURIComponent(parsed.pathname.substring(1))
      : DEFAULTS.database,
  };
}
