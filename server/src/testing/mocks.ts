import { EventEmitter } from 'node:events';
import type { WebSocket } from 'ws';
import type { AppConfig } from '../config.js';

/** Complete AppConfig with sane test defaults. */
export function mockConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    PORT_HTTP: 41601,
    PORT_WS: 41602,
    CHANNEL_TTL_SECONDS: 1800,
    CLEANUP_INTERVAL_SECONDS: 60,
    UPLOAD_RATE_LIMIT: 2,
    CREATE_RATE_LIMIT: 10,
    MAX_VIEWERS_PER_CHANNEL: 50,
    VERIFY_RATE_LIMIT: 10,
    MAX_TEXT_LENGTH: 2000,
    TRUST_PROXY: 'false',
    WS_ALLOWED_ORIGINS: '',
    // Tests must never write the real audit directory; opt in explicitly with a
    // temp dir (auditLog.test.ts / server.test.ts do that).
    AUDIT_LOG_ENABLED: false,
    AUDIT_LOG_DIR: 'logs',
    AUDIT_LOG_RETENTION_DAYS: 243,
    ...overrides,
  };
}

/**
 * Minimal WebSocket stand-in: enough surface for channelStore and the WS
 * handler (EventEmitter + OPEN readyState + send/close/terminate recording).
 */
export class FakeWebSocket extends EventEmitter {
  readyState = 1; // WebSocket.OPEN
  sent: string[] = [];
  closeCalls: Array<{ code?: number; reason?: string }> = [];
  terminated = false;
  isAlive?: boolean;
  shareCode?: string;
  heartbeatTimer?: ReturnType<typeof setInterval>;

  send(data: string): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Parsed payloads received by this client. */
  messages(): Array<Record<string, unknown>> {
    return this.sent.map((raw) => JSON.parse(raw) as Record<string, unknown>);
  }

  messagesOfType(type: string): Array<Record<string, unknown>> {
    return this.messages().filter((message) => message.type === type);
  }

  static asWS(ws: FakeWebSocket): WebSocket {
    return ws as unknown as WebSocket;
  }
}

/** Express Response stand-in for middleware unit tests. */
export interface MockResponse {
  statusCode: number;
  body: unknown;
  status(code: number): MockResponse;
  json(payload: unknown): MockResponse;
  locals: Record<string, unknown>;
  headersSent: boolean;
  listeners: Record<string, Array<() => void>>;
  on(event: string, listener: () => void): MockResponse;
  emit(event: string): MockResponse;
}

export function mockResponse(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    body: undefined,
    headersSent: false,
    locals: {},
    listeners: {},
    status(code: number): MockResponse {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown): MockResponse {
      res.body = payload;
      return res;
    },
    on(event: string, listener: () => void): MockResponse {
      (res.listeners[event] ??= []).push(listener);
      return res;
    },
    emit(event: string): MockResponse {
      for (const listener of res.listeners[event] ?? []) listener();
      return res;
    },
  };
  return res;
}

/** Express Request stand-in for middleware unit tests. */
export interface MockRequest {
  body?: unknown;
  query?: Record<string, unknown>;
  ip?: string;
  method?: string;
  path?: string;
  headers: Record<string, string | undefined>;
  socket: { remoteAddress?: string };
}

export function mockRequest(overrides: Partial<MockRequest> = {}): MockRequest {
  // The shared IP resolver reads socket.remoteAddress, so keep it in sync with
  // the convenience `ip` field unless the caller sets it explicitly.
  const ip = overrides.ip ?? overrides.socket?.remoteAddress ?? '127.0.0.1';

  return {
    body: {},
    query: {},
    ip,
    method: 'POST',
    path: '/api/test',
    headers: {},
    socket: { remoteAddress: ip },
    ...overrides,
  };
}
