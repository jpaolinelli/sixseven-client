/**
 * TCP connection to SixSevenDB using wire protocol v3.
 *
 * Manages the raw socket, startup handshake, authentication,
 * and query execution (simple + extended query protocol).
 */

import * as net from 'net';
import {
  buildStartupMessage,
  buildPasswordMessage,
  buildMD5PasswordMessage,
  buildQueryMessage,
  buildParseMessage,
  buildBindMessage,
  buildDescribeMessage,
  buildExecuteMessage,
  buildSyncMessage,
  buildTerminateMessage,
  MessageReader,
  BackendMessageType,
  type BackendMessage,
  type FieldDescription,
} from './protocol';
import { parseValue } from './type-parser';
import type { ConnectionConfig, QueryResult, FieldInfo } from './types';
import { DEFAULTS } from './types';

export class Connection {
  private socket: net.Socket | null = null;
  private reader = new MessageReader();
  private ended = false;

  private readonly host: string;
  private readonly port: number;
  private readonly user: string;
  private readonly password?: string;
  private readonly database: string;

  /** Message queue for async processing. */
  private pendingMessages: BackendMessage[] = [];
  private messageWaiter: {
    resolve: (msg: BackendMessage) => void;
    reject: (err: Error) => void;
  } | null = null;

  constructor(config: ConnectionConfig = {}) {
    this.host = config.host ?? DEFAULTS.host;
    this.port = config.port ?? DEFAULTS.port;
    this.user = config.user ?? DEFAULTS.user;
    this.password = config.password;
    this.database = config.database ?? DEFAULTS.database;
  }

  // ---------------------------------------------------------------------------
  // Connect
  // ---------------------------------------------------------------------------

  async connect(): Promise<void> {
    if (this.socket) throw new Error('already connected');

    const socket = new net.Socket();
    this.socket = socket;

    socket.on('data', (data: Buffer) => {
      this.reader.append(data);
      this.drainReader();
    });

    socket.on('error', (err: Error) => {
      if (this.messageWaiter) {
        const w = this.messageWaiter;
        this.messageWaiter = null;
        w.reject(err);
      }
    });

    socket.on('close', () => {
      if (this.messageWaiter) {
        const w = this.messageWaiter;
        this.messageWaiter = null;
        w.reject(new Error('connection closed'));
      }
    });

    // TCP connect
    await new Promise<void>((resolve, reject) => {
      socket.once('error', reject);
      socket.connect(this.port, this.host, () => {
        socket.removeListener('error', reject);
        resolve();
      });
    });

    // Send startup message
    socket.write(buildStartupMessage(this.user, this.database));

    // Handle authentication handshake
    await this.handleStartup();
  }

  // ---------------------------------------------------------------------------
  // Query execution
  // ---------------------------------------------------------------------------

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<T>> {
    if (!this.socket || this.ended) throw new Error('connection is closed');

    if (!values || values.length === 0) {
      return this.simpleQuery<T>(text);
    }
    return this.extendedQuery<T>(text, values);
  }

  // ---------------------------------------------------------------------------
  // Close
  // ---------------------------------------------------------------------------

  async end(): Promise<void> {
    if (!this.socket || this.ended) return;
    this.ended = true;

    try {
      this.socket.write(buildTerminateMessage());
    } catch {
      // Ignore write errors during shutdown
    }

    this.socket.destroy();
    this.socket = null;
  }

  // ---------------------------------------------------------------------------
  // Internals — message processing
  // ---------------------------------------------------------------------------

  private drainReader(): void {
    let msg: BackendMessage | null;
    while ((msg = this.reader.read()) !== null) {
      if (this.messageWaiter) {
        const w = this.messageWaiter;
        this.messageWaiter = null;
        w.resolve(msg);
      } else {
        this.pendingMessages.push(msg);
      }
    }
  }

  private readMessage(): Promise<BackendMessage> {
    if (this.pendingMessages.length > 0) {
      return Promise.resolve(this.pendingMessages.shift()!);
    }
    return new Promise((resolve, reject) => {
      this.messageWaiter = { resolve, reject };
    });
  }

  // ---------------------------------------------------------------------------
  // Internals — startup / auth
  // ---------------------------------------------------------------------------

  private async handleStartup(): Promise<void> {
    while (true) {
      const msg = await this.readMessage();

      switch (msg.type) {
        case BackendMessageType.AuthenticationOk:
          break;

        case BackendMessageType.AuthenticationCleartextPassword:
          if (!this.password) {
            throw new Error('server requires password but none was provided');
          }
          this.socket!.write(buildPasswordMessage(this.password));
          break;

        case BackendMessageType.AuthenticationMD5Password:
          if (!this.password) {
            throw new Error('server requires password but none was provided');
          }
          this.socket!.write(
            buildMD5PasswordMessage(this.user, this.password, msg.salt),
          );
          break;

        case BackendMessageType.ParameterStatus:
        case BackendMessageType.BackendKeyData:
        case BackendMessageType.NoticeResponse:
          break;

        case BackendMessageType.ReadyForQuery:
          return;

        case BackendMessageType.ErrorResponse:
          throw new Error(`${msg.severity}: ${msg.message} (${msg.code})`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Internals — simple query protocol
  // ---------------------------------------------------------------------------

  private async simpleQuery<T extends Record<string, unknown>>(
    text: string,
  ): Promise<QueryResult<T>> {
    this.socket!.write(buildQueryMessage(text));

    let fields: FieldDescription[] = [];
    const rows: T[] = [];
    let command = '';
    let rowCount = 0;

    while (true) {
      const msg = await this.readMessage();

      switch (msg.type) {
        case BackendMessageType.RowDescription:
          fields = msg.fields;
          break;

        case BackendMessageType.DataRow:
          rows.push(this.buildRow<T>(fields, msg.values));
          break;

        case BackendMessageType.CommandComplete:
          command = this.parseCommand(msg.tag);
          rowCount = this.parseRowCount(msg.tag);
          break;

        case BackendMessageType.ReadyForQuery:
          return {
            rows,
            fields: fields.map((f) => ({ name: f.name, dataTypeID: f.typeOID })),
            rowCount: rows.length > 0 ? rows.length : rowCount,
            command,
          };

        case BackendMessageType.ErrorResponse:
          await this.waitForReady();
          throw new Error(`${msg.severity}: ${msg.message} (${msg.code})`);

        case BackendMessageType.EmptyQueryResponse:
        case BackendMessageType.NoticeResponse:
          break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Internals — extended query protocol
  // ---------------------------------------------------------------------------

  private async extendedQuery<T extends Record<string, unknown>>(
    text: string,
    values: unknown[],
  ): Promise<QueryResult<T>> {
    const paramStrings = values.map((v) =>
      v === null || v === undefined ? null : String(v),
    );

    // Send Parse + Bind + Describe(Portal) + Execute + Sync as one batch
    const batch = Buffer.concat([
      buildParseMessage(text),
      buildBindMessage(paramStrings),
      buildDescribeMessage('P'),
      buildExecuteMessage(),
      buildSyncMessage(),
    ]);
    this.socket!.write(batch);

    let fields: FieldDescription[] = [];
    const rows: T[] = [];
    let command = '';
    let rowCount = 0;

    while (true) {
      const msg = await this.readMessage();

      switch (msg.type) {
        case BackendMessageType.ParseComplete:
        case BackendMessageType.BindComplete:
        case BackendMessageType.NoData:
          break;

        case BackendMessageType.RowDescription:
          fields = msg.fields;
          break;

        case BackendMessageType.DataRow:
          rows.push(this.buildRow<T>(fields, msg.values));
          break;

        case BackendMessageType.CommandComplete:
          command = this.parseCommand(msg.tag);
          rowCount = this.parseRowCount(msg.tag);
          break;

        case BackendMessageType.ReadyForQuery:
          return {
            rows,
            fields: fields.map((f) => ({ name: f.name, dataTypeID: f.typeOID })),
            rowCount: rows.length > 0 ? rows.length : rowCount,
            command,
          };

        case BackendMessageType.ErrorResponse:
          await this.waitForReady();
          throw new Error(`${msg.severity}: ${msg.message} (${msg.code})`);

        case BackendMessageType.NoticeResponse:
          break;
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Internals — helpers
  // ---------------------------------------------------------------------------

  private buildRow<T>(
    fields: FieldDescription[],
    values: (string | null)[],
  ): T {
    const row: Record<string, unknown> = {};
    for (let i = 0; i < fields.length; i++) {
      const val = values[i];
      row[fields[i].name] =
        val === null ? null : parseValue(fields[i].typeOID, val);
    }
    return row as T;
  }

  private parseCommand(tag: string): string {
    const space = tag.indexOf(' ');
    return space === -1 ? tag : tag.substring(0, space);
  }

  private parseRowCount(tag: string): number {
    const parts = tag.split(' ');
    const last = parts[parts.length - 1];
    const n = parseInt(last, 10);
    return isNaN(n) ? 0 : n;
  }

  private async waitForReady(): Promise<void> {
    while (true) {
      const msg = await this.readMessage();
      if (msg.type === BackendMessageType.ReadyForQuery) return;
    }
  }
}
