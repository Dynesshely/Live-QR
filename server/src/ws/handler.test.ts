import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';
import {
  attachWebSocketServer,
  createWSServer,
  evaluateHandshake,
  isOriginAllowed,
  isWsPath,
  toHandshakeRequest,
  type HandshakeRequest,
} from './handler.js';
import { createChannel, shutdownAll } from '../services/channelStore.js';
import { clearAttempts } from '../services/attemptStore.js';
import type { AppConfig } from '../config.js';
import { FakeWebSocket, mockConfig } from '../testing/mocks.js';

// ── Pure handshake policy ──

function hs(overrides: Partial<HandshakeRequest> = {}): HandshakeRequest {
  return {
    pathname: '/ws',
    shareCode: '12345678',
    origin: null,
    host: '127.0.0.1:41605',
    ...overrides,
  };
}

describe('isWsPath', () => {
  it('accepts /ws and /ws/ only', () => {
    expect(isWsPath('/ws')).toBe(true);
    expect(isWsPath('/ws/')).toBe(true);
    expect(isWsPath('/')).toBe(false);
    expect(isWsPath('/wsx')).toBe(false);
    expect(isWsPath('/ws/extra')).toBe(false);
    expect(isWsPath('/other')).toBe(false);
  });
});

describe('isOriginAllowed', () => {
  it('allows clients without an Origin header (non-browser)', () => {
    expect(isOriginAllowed(null, '127.0.0.1:41602', [])).toBe(true);
  });

  it('enforces same-host by default', () => {
    expect(isOriginAllowed('http://127.0.0.1:41605', '127.0.0.1:41605', [])).toBe(true);
    expect(isOriginAllowed('http://127.0.0.1:41605', '127.0.0.1:41602', [])).toBe(false);
    expect(isOriginAllowed('http://evil.example', '127.0.0.1:41605', [])).toBe(false);
  });

  it('rejects an unparseable Origin', () => {
    expect(isOriginAllowed('not a url', '127.0.0.1:41605', [])).toBe(false);
  });

  it('honours an explicit allow-list and the * wildcard', () => {
    expect(isOriginAllowed('https://App.Example', 'x', ['https://app.example'])).toBe(true);
    expect(isOriginAllowed('https://other.example', 'x', ['https://app.example'])).toBe(false);
    expect(isOriginAllowed('https://anything.example', 'x', ['*'])).toBe(true);
  });
});

describe('evaluateHandshake', () => {
  it('accepts /ws with a valid share code', () => {
    expect(evaluateHandshake(hs(), [])).toEqual({ ok: true, shareCode: '12345678' });
  });

  it('accepts /ws/ with a valid share code', () => {
    expect(evaluateHandshake(hs({ pathname: '/ws/' }), [])).toEqual({
      ok: true,
      shareCode: '12345678',
    });
  });

  it('rejects any other path with 403 FORBIDDEN_PATH', () => {
    for (const pathname of ['/', '/wsx', '/other', '/ws/extra']) {
      const decision = evaluateHandshake(hs({ pathname }), []);
      expect(decision).toMatchObject({ ok: false, status: 403, error: 'FORBIDDEN_PATH' });
    }
  });

  it('rejects a missing or malformed share code with 400', () => {
    for (const shareCode of [null, '', 'abc', '1234567', '123456789']) {
      const decision = evaluateHandshake(hs({ shareCode }), []);
      expect(decision).toMatchObject({ ok: false, status: 400, error: 'INVALID_SHARE_CODE' });
    }
  });

  it('rejects a cross-origin browser request with 403 FORBIDDEN_ORIGIN', () => {
    const decision = evaluateHandshake(
      hs({ origin: 'https://evil.example', host: '127.0.0.1:41605' }),
      [],
    );
    expect(decision).toMatchObject({ ok: false, status: 403, error: 'FORBIDDEN_ORIGIN' });
  });
});

describe('toHandshakeRequest', () => {
  it('parses path, share code, origin and host', () => {
    const req = {
      url: '/ws/?shareCode=12345678',
      headers: { host: '127.0.0.1:41602', origin: 'http://127.0.0.1:41605' },
    } as unknown as IncomingMessage;

    expect(toHandshakeRequest(req)).toEqual({
      pathname: '/ws/',
      shareCode: '12345678',
      origin: 'http://127.0.0.1:41605',
      host: '127.0.0.1:41602',
    });
  });

  it('falls back to a rejected path for a malformed request target', () => {
    const req = { url: 'http://[bad', headers: {} } as unknown as IncomingMessage;
    expect(toHandshakeRequest(req).pathname).toBe('/');
  });
});

// ── Real sockets over ephemeral ports (never 41601/41602) ──

interface TestServer {
  wss: WebSocketServer;
  server: Server;
  port: number;
  clients: WebSocket[];
}

async function startTestServer(config: AppConfig): Promise<TestServer> {
  const wss = createWSServer(config);
  const server = createServer();
  attachWebSocketServer(wss, server);

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const port = (server.address() as AddressInfo).port;

  return { wss, server, port, clients: [] };
}

async function stopTestServer(ctx: TestServer): Promise<void> {
  for (const client of ctx.clients) client.terminate();
  await new Promise<void>((resolve) => ctx.wss.close(() => resolve()));
  await new Promise<void>((resolve) => {
    ctx.server.close(() => resolve());
    ctx.server.closeAllConnections();
  });
}

interface Client {
  ws: WebSocket;
  messages: Array<Record<string, unknown>>;
  closed: Promise<{ code: number; reason: string }>;
  waitFor(type: string, predicate?: (message: Record<string, unknown>) => boolean): Promise<Record<string, unknown>>;
}

function trackClient(ws: WebSocket): Client {
  const messages: Array<Record<string, unknown>> = [];

  ws.on('message', (data: Buffer) => {
    try {
      messages.push(JSON.parse(data.toString()) as Record<string, unknown>);
    } catch {
      // ignore
    }
  });

  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    ws.once('close', (code: number, reason: Buffer) => resolve({ code, reason: reason.toString() }));
  });

  function waitFor(
    type: string,
    predicate: (message: Record<string, unknown>) => boolean = () => true,
  ): Promise<Record<string, unknown>> {
    const existing = messages.find((message) => message.type === type && predicate(message));
    if (existing) return Promise.resolve(existing);

    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.off('message', onMessage);
        reject(new Error('timed out waiting for WS message ' + type));
      }, 3000);

      const onMessage = (data: Buffer): void => {
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(data.toString()) as Record<string, unknown>;
        } catch {
          return;
        }
        if (message.type === type && predicate(message)) {
          clearTimeout(timer);
          ws.off('message', onMessage);
          resolve(message);
        }
      };

      ws.on('message', onMessage);
    });
  }

  return { ws, messages, closed, waitFor };
}

async function openClient(
  port: number,
  path = '/ws',
  shareCode?: string,
  headers: Record<string, string> = {},
): Promise<Client> {
  const query = shareCode ? '?shareCode=' + shareCode : '';
  const ws = new WebSocket('ws://127.0.0.1:' + port + path + query, { headers });
  const client = trackClient(ws);

  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve());
    ws.once('error', (err: Error) => reject(err));
  });

  return client;
}

/** Resolve with the HTTP status of a rejected upgrade. */
async function rejectedHandshakeStatus(port: number, path: string): Promise<number> {
  const ws = new WebSocket('ws://127.0.0.1:' + port + path);

  const status = await new Promise<number>((resolve, reject) => {
    ws.once('unexpected-response', (_req: unknown, response: IncomingMessage) => {
      resolve(response.statusCode ?? 0);
    });
    ws.once('open', () => reject(new Error('expected the handshake to be rejected')));
    ws.once('error', (err: Error) => reject(err));
  });

  ws.terminate();
  return status;
}

describe('WebSocket handshake over real sockets', () => {
  let ctx: TestServer;

  beforeEach(async () => {
    shutdownAll();
    clearAttempts();
    ctx = await startTestServer(mockConfig());
  });

  afterEach(async () => {
    await stopTestServer(ctx);
  });

  it('rejects a non-/ws path with HTTP 403 before upgrading', async () => {
    const ch = createChannel(mockConfig());
    expect(await rejectedHandshakeStatus(ctx.port, '/not-ws?shareCode=' + ch.shareCode)).toBe(403);
  });

  it('rejects a missing shareCode with HTTP 400', async () => {
    expect(await rejectedHandshakeStatus(ctx.port, '/ws')).toBe(400);
  });

  it('accepts /ws and sends welcome', async () => {
    const ch = createChannel(mockConfig());
    const client = await openClient(ctx.port, '/ws', ch.shareCode);
    ctx.clients.push(client.ws);

    const welcome = await client.waitFor('welcome');
    expect(welcome).toMatchObject({ type: 'welcome', shareCode: ch.shareCode, viewerCount: 1 });
  });

  it('closes with 4001 for an unknown channel', async () => {
    const client = await openClient(ctx.port, '/ws', '12345678');
    ctx.clients.push(client.ws);

    const closed = await client.closed;
    expect(closed.code).toBe(4001);
  });

  it('closes with 4002 when the channel is full', async () => {
    const config = mockConfig({ MAX_VIEWERS_PER_CHANNEL: 1 });
    await stopTestServer(ctx);
    ctx = await startTestServer(config);

    const ch = createChannel(config);
    const first = await openClient(ctx.port, '/ws', ch.shareCode);
    ctx.clients.push(first.ws);
    await first.waitFor('welcome');

    const second = await openClient(ctx.port, '/ws', ch.shareCode);
    ctx.clients.push(second.ws);

    expect((await second.closed).code).toBe(4002);
  });

  it('broadcasts viewer_count on join and leave', async () => {
    const config = mockConfig();
    const ch = createChannel(config);

    const first = await openClient(ctx.port, '/ws', ch.shareCode);
    ctx.clients.push(first.ws);
    expect(await first.waitFor('viewer_count', (m) => m.count === 1)).toMatchObject({ count: 1 });

    const second = await openClient(ctx.port, '/ws', ch.shareCode);
    ctx.clients.push(second.ws);

    expect(await first.waitFor('viewer_count', (m) => m.count === 2)).toMatchObject({ count: 2 });
    expect(await second.waitFor('viewer_count', (m) => m.count === 2)).toMatchObject({ count: 2 });

    first.ws.close();
    expect(await second.waitFor('viewer_count', (m) => m.count === 1)).toMatchObject({ count: 1 });
  });

  it('rejects a cross-origin browser handshake with 403', async () => {
    const ch = createChannel(mockConfig());
    const ws = new WebSocket('ws://127.0.0.1:' + ctx.port + '/ws?shareCode=' + ch.shareCode, {
      headers: { Origin: 'https://evil.example' },
    });

    const status = await new Promise<number | null>((resolve) => {
      ws.once('unexpected-response', (_req: unknown, res: IncomingMessage) =>
        resolve(res.statusCode ?? 0),
      );
      ws.once('open', () => resolve(null));
      ws.once('error', () => resolve(null));
    });

    ws.terminate();
    expect(status).toBe(403);
  });

  it('accepts a same-origin browser handshake', async () => {
    const ch = createChannel(mockConfig());
    const ws = new WebSocket('ws://127.0.0.1:' + ctx.port + '/ws?shareCode=' + ch.shareCode, {
      headers: { Origin: 'http://127.0.0.1:' + ctx.port },
    });
    const client = trackClient(ws);
    ctx.clients.push(ws);

    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', (err: Error) => reject(err));
    });

    expect(await client.waitFor('welcome')).toMatchObject({ shareCode: ch.shareCode });
  });
});

// ── Heartbeat with fake timers (no real sleeping) ──

describe('WebSocket heartbeat', () => {
  afterEach(() => {
    vi.useRealTimers();
    shutdownAll();
  });

  function connectFake(wss: WebSocketServer, shareCode: string): FakeWebSocket {
    const ws = new FakeWebSocket();
    const req = {
      url: '/ws?shareCode=' + shareCode,
      headers: { host: '127.0.0.1:41602' },
    } as unknown as IncomingMessage;

    wss.emit('connection', FakeWebSocket.asWS(ws), req);
    return ws;
  }

  it('sends a heartbeat every 30s', () => {
    const wss = createWSServer(mockConfig());
    const ch = createChannel(mockConfig());
    vi.useFakeTimers();

    const ws = connectFake(wss, ch.shareCode);
    expect(ws.messagesOfType('welcome')).toHaveLength(1);

    vi.advanceTimersByTime(30_000);
    expect(ws.messagesOfType('heartbeat')).toHaveLength(1);

    // Answer the heartbeat so the connection stays alive for another tick.
    ws.emit('message', Buffer.from(JSON.stringify({ type: 'pong' })));

    vi.advanceTimersByTime(30_000);
    expect(ws.messagesOfType('heartbeat')).toHaveLength(2);
    expect(ws.terminated).toBe(false);

    ws.emit('close');
    wss.close();
  });

  it('terminates a silent client after two ticks (~60s)', () => {
    const wss = createWSServer(mockConfig());
    const ch = createChannel(mockConfig());
    vi.useFakeTimers();

    const ws = connectFake(wss, ch.shareCode);
    vi.advanceTimersByTime(29_999);
    expect(ws.terminated).toBe(false);

    vi.advanceTimersByTime(1); // 30s: first heartbeat, isAlive flipped
    expect(ws.terminated).toBe(false);

    vi.advanceTimersByTime(30_000); // 60s: no pong since previous tick
    expect(ws.terminated).toBe(true);

    wss.close();
  });

  it('keeps a client that answers pings alive past 90s', () => {
    const wss = createWSServer(mockConfig());
    const ch = createChannel(mockConfig());
    vi.useFakeTimers();

    const ws = connectFake(wss, ch.shareCode);

    for (let tick = 0; tick < 3; tick++) {
      vi.advanceTimersByTime(30_000);
      // Answer the heartbeat
      ws.emit('message', Buffer.from(JSON.stringify({ type: 'pong' })));
      expect(ws.terminated).toBe(false);
    }

    ws.emit('close');
    wss.close();
  });
});
