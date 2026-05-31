import { describe, it, expect } from 'vitest';
import { parseConnectionString } from '../src/connection-string';

describe('parseConnectionString', () => {
  it('parses full connection string', () => {
    const config = parseConnectionString('sixseven://myuser:mypass@dbhost:9999/mydb');
    expect(config.host).toBe('dbhost');
    expect(config.port).toBe(9999);
    expect(config.user).toBe('myuser');
    expect(config.password).toBe('mypass');
    expect(config.database).toBe('mydb');
  });

  it('uses defaults for missing components', () => {
    const config = parseConnectionString('sixseven://localhost');
    expect(config.host).toBe('localhost');
    expect(config.port).toBe(6767);
    expect(config.user).toBe('sixseven');
    expect(config.password).toBeUndefined();
    expect(config.database).toBe('sixseven');
  });

  it('parses without password', () => {
    const config = parseConnectionString('sixseven://admin@host:8080/testdb');
    expect(config.user).toBe('admin');
    expect(config.password).toBeUndefined();
    expect(config.host).toBe('host');
    expect(config.port).toBe(8080);
    expect(config.database).toBe('testdb');
  });

  it('parses without port', () => {
    const config = parseConnectionString('sixseven://user:pass@myhost/db');
    expect(config.port).toBe(6767);
    expect(config.host).toBe('myhost');
  });

  it('parses without database', () => {
    const config = parseConnectionString('sixseven://user@host:6767');
    expect(config.database).toBe('sixseven');
  });

  it('decodes URI-encoded components', () => {
    const config = parseConnectionString('sixseven://my%40user:p%40ss@host/db');
    expect(config.user).toBe('my@user');
    expect(config.password).toBe('p@ss');
  });

  it('throws on unsupported protocol', () => {
    expect(() => parseConnectionString('postgres://host/db')).toThrow('unsupported protocol');
  });
});
