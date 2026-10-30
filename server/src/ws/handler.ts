import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { AppConfig, ClientMessage } from '../types.js';
import {
  channelExists,
  getViewerCount,
  addClient,
  removeClient,
} from '../services/channelStore.js';
import { parseAllowedOrigins, parseTrustProxy } from '../config.js';
import { ipFromNodeRequest, userAgentFromNodeRequest } from '../services/clientIp.js';
import { tryRecord, type AuditRecorder } from '../services/auditLog.js';
import { logger } from '../logger.js';

/** Server → client heartbeat cadence. Two silent ticks (≈60s) kill the socket. */
const HEARTBEAT_INTERVAL_MS = 30_000;

/** The only valid WebSocket endpoint, optionally with a trailing slash. */
export const WS_PATH = '/ws';

const SHARE_CODE_REGEX = /^\d{8}$/;

// Per-connection heartbeat tracking
interface AliveWS extends WebSocket {
  isAlive: boolean;
  heartbeatTimer?: ReturnType<typeof setInterval>;
  shareCode?: string;
}

export interface HandshakeRequest {
  pathname: string;
  shareCode: string | null;
  origin: string | null;
  host: string | null;
}

export type HandshakeDecision =
  | { ok: true; shareCode: string }
  | { ok: false; status: number; error: string; reason: string };

export function isWsPath(pathname: string): boolean {
  return pathname === WS_PATH || pathname === WS_PATH + '/';
}

function parseOrigin(origin: string): { origin: string; host: string } | null {
  try {
    const url = new URL(origin);
    return { origin: url.origin.toLowerCase(), host: url.host.toLowerCase() };
  } catch {
    return null;
  }
}

/**
 * Origin policy:
 * - no Origin header → allowed (non-browser client such as the CLI or tests);
 * - WS_ALLOWED_ORIGINS contains '*' → allowed;
 * - WS_ALLOWED_ORIGINS non-empty → the Origin must be listed;
 * - otherwise same-origin: the Origin host must equal the request Host header
 *   (this is what a browser sends, whether it goes through Caddy or the Vite
 *   dev proxy, since both forward the original Host).
 */
export function isOriginAllowed(
  origin: string | null,
  host: string | null,
  allowedOrigins: string[],
): boolean {
  if (!origin) return true;

  const parsed = parseOrigin(origin);
  if (!parsed) return false;

  if (allowedOrigins.includes('*')) return true;
  if (allowedOrigins.length > 0) return allowedOrigins.includes(parsed.origin);
  return !!host && parsed.host === host.toLowerCase();
}

/**
 * Handshake policy, kept pure so it can be unit-tested without sockets.
 * Path is checked first (403), then the share code (400).
 */
export function evaluateHandshake(
  request: HandshakeRequest,
  allowedOrigins: string[],
): HandshakeDecision {
  if (!isWsPath(request.pathname)) {
    return {
      ok: false,
      status: 403,
      error: 'FORBIDDEN_PATH',
      reason: 'unexpected path ' + request.pathname,
    };
  }

  if (!request.shareCode || !SHARE_CODE_REGEX.test(request.shareCode)) {
    return {
      ok: false,
      status: 400,
      error: 'INVALID_SHARE_CODE',
      reason: 'missing or malformed shareCode',
    };
  }

  if (!isOriginAllowed(request.origin, request.host, allowedOrigins)) {
    return {
      ok: false,
      status: 403,
      error: 'FORBIDDEN_ORIGIN',
      reason: 'origin ' + String(request.origin) + ' is not allowed',
    };
  }

  return { ok: true, shareCode: request.shareCode };
}

export function toHandshakeRequest(req: IncomingMessage): HandshakeRequest {
  let pathname = '/';
  let shareCode: string | null = null;

  try {
    const url = new URL(req.url || '/', 'http://' + (req.headers.host || 'localhost'));
    pathname = url.pathname;
    shareCode = url.searchParams.get('shareCode');
  } catch {
    // Malformed request target: keep the defaults (path '/' → rejected).
  }

  return {
    pathname,
    shareCode,
    origin: req.headers.origin ?? null,
    host: req.headers.host ?? null,
  };
}

/** Wire a (already listening or not) HTTP server up to the WebSocket server. */
export function attachWebSocketServer(wss: WebSocketServer, server: HttpServer): void {
  server.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });
}

export interface WSServerDeps {
  /** Override WS_ALLOWED_ORIGINS (tests). */
  allowedOrigins?: string[];
  /** On-disk audit trail (undefined when AUDIT_LOG_ENABLED=false). */
  audit?: AuditRecorder;
}

export function createWSServer(config: AppConfig, deps: WSServerDeps = {}): WebSocketServer {
  const allowedOrigins = deps.allowedOrigins ?? parseAllowedOrigins(config.WS_ALLOWED_ORIGINS);
  const trustProxy = parseTrustProxy(config.TRUST_PROXY);
  const audit = deps.audit;

  // noServer: binding is the caller's job (createServers/start), which keeps
  // this module importable and testable without touching a port.
  const wss = new WebSocketServer({
    noServer: true,
    verifyClient: (
      info: { origin: string; secure: boolean; req: IncomingMessage },
      cb: (res: boolean, code?: number, message?: string, headers?: Record<string, string>) => void,
    ) => {
      const decision = evaluateHandshake(toHandshakeRequest(info.req), allowedOrigins);

      if (!decision.ok) {
        logger.warn('ws_rejected', 'WS rejected: ' + decision.reason);
        cb(false, decision.status, decision.error);
        return;
      }

      cb(true);
    },
  });

  wss.on('connection', (ws: AliveWS, req: IncomingMessage) => {
    // Re-derive the share code here as well: a channel can disappear between
    // the handshake and the connection event.
    const { shareCode } = toHandshakeRequest(req);

    if (!shareCode) {
      ws.close(4001, 'CHANNEL_NOT_FOUND');
      return;
    }

    // channelExists() applies lazy expiry, so an expired channel is 4001 here.
    if (!channelExists(shareCode)) {
      logger.warn('ws_rejected', 'WS rejected: channel not found', shareCode);
      ws.close(4001, 'CHANNEL_NOT_FOUND');
      return;
    }

    if (getViewerCount(shareCode) >= config.MAX_VIEWERS_PER_CHANNEL) {
      logger.warn('ws_rejected', 'WS rejected: too many viewers', shareCode);
      ws.close(4002, 'TOO_MANY_VIEWERS');
      return;
    }

    ws.isAlive = true;
    ws.shareCode = shareCode;

    // Identity comes from the handshake request (shared trust-proxy helper, so
    // a viewer behind Caddy is recorded with their real IP, not 127.0.0.1).
    const clientIp = ipFromNodeRequest(req, trustProxy);
    const clientUa = userAgentFromNodeRequest(req);
    const connectedAt = Date.now();

    // Register client (sends welcome + history and broadcasts viewer_count)
    addClient(shareCode, ws, { ip: clientIp, ua: clientUa });

    // Compliance trail: this viewer is now a potential recipient.
    tryRecord(() => audit?.recordViewerConnect({ shareCode, ip: clientIp, ua: clientUa }));

    ws.on('message', (data: Buffer) => {
      try {
        const msg: ClientMessage = JSON.parse(data.toString());

        if (msg.type === 'pong') {
          ws.isAlive = true;
        }
        // All other message types are ignored
      } catch {
        // Ignore invalid JSON
      }
    });

    // Heartbeat: send every 30s. If no pong arrived since the previous tick
    // the client has been silent for ~60s (two ticks) and is terminated.
    ws.heartbeatTimer = setInterval(() => {
      if (!ws.isAlive) {
        if (ws.heartbeatTimer) clearInterval(ws.heartbeatTimer);
        ws.terminate();
        return;
      }

      ws.isAlive = false;
      ws.send(JSON.stringify({ type: 'heartbeat', serverTime: Date.now() }));
    }, HEARTBEAT_INTERVAL_MS);

    ws.on('close', () => {
      if (ws.shareCode) {
        removeClient(ws.shareCode, ws);
        tryRecord(() =>
          audit?.recordViewerDisconnect({
            shareCode: ws.shareCode as string,
            ip: clientIp,
            durationMs: Date.now() - connectedAt,
          }),
        );
      }
      if (ws.heartbeatTimer) clearInterval(ws.heartbeatTimer);
    });

    ws.on('error', (err) => {
      logger.error('ws_disconnected', 'WebSocket error: ' + err.message, shareCode);
    });
  });

  return wss;
}
