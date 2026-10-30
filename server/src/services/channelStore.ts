import { randomInt } from 'node:crypto';
import { WebSocket } from 'ws';
import type { ChannelState, ServerMessage, AppConfig, ViewerInfo } from '../types.js';
import { logger } from '../logger.js';
import { clearAttempts, pruneAttempts } from './attemptStore.js';

// ── In-memory store ──
//
// There is no database by design: a process restart loses every channel.
// Expiry is both active (cleanup timer) and lazy (every read drops an expired
// channel), so a channel can never be observed alive after its TTL.

const channels = new Map<string, ChannelState>();

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

/** Stable, non-localized payload used when a channel is going away. */
const CHANNEL_EXPIRED_MESSAGE = 'Channel expired';

// ── Helpers ──

function generateShareCode(): string {
  return String(randomInt(10_000_000, 99_999_999));
}

function now(): number {
  return Date.now();
}

/**
 * A channel expires `ttlSeconds` after its last upload (creation counts as the
 * first activity). Per-channel TTL is frozen at creation time.
 */
export function isChannelExpired(channel: ChannelState, at: number = now()): boolean {
  return at - channel.lastUploadAt >= channel.ttlSeconds * 1000;
}

function sendMessage(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function broadcast(shareCode: string, message: ServerMessage): void {
  const channel = channels.get(shareCode);
  if (!channel) return;

  const data = JSON.stringify(message);
  for (const ws of channel.wsClients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

/** Notify every viewer, close their sockets and drop the channel. */
function dropChannel(channel: ChannelState, closeReason: string): void {
  const payload: ServerMessage = {
    type: 'channel_expired',
    code: 'CHANNEL_EXPIRED',
    message: CHANNEL_EXPIRED_MESSAGE,
  };

  for (const ws of channel.wsClients) {
    sendMessage(ws, payload);
    ws.close(1001, closeReason);
  }
  channel.wsClients.clear();
  channel.viewerInfo.clear();
  channels.delete(channel.shareCode);
}

/**
 * Raw lookup + lazy expiry. Every public read goes through here so an expired
 * channel behaves exactly like a missing one (404 / WS 4001) even before the
 * cleanup timer gets to it.
 */
function getLiveChannel(shareCode: string): ChannelState | undefined {
  const channel = channels.get(shareCode);
  if (!channel) return undefined;

  if (isChannelExpired(channel)) {
    dropChannel(channel, 'Channel expired');
    logger.info('channel_cleaned', 'Channel lazily expired', shareCode);
    return undefined;
  }

  return channel;
}

// ── Public API ──

export function createChannel(config: AppConfig, expireSeconds?: number): {
  shareCode: string;
  expireAt: string;
  createdAt: string;
} {
  let shareCode: string;
  let attempts = 0;

  do {
    shareCode = generateShareCode();
    attempts++;
    if (attempts > 5) {
      throw new Error('Failed to generate unique share code after 5 attempts');
    }
  } while (channels.has(shareCode));

  const ttlSeconds = expireSeconds ?? config.CHANNEL_TTL_SECONDS;
  const createdAt = now();
  const state: ChannelState = {
    shareCode,
    latestText: null,
    lastUploadAt: createdAt,
    createdAt,
    ttlSeconds,
    uploadWindow: [],
    wsClients: new Set(),
    viewerInfo: new Map(),
  };

  channels.set(shareCode, state);

  logger.info('channel_created', `Channel created (TTL=${ttlSeconds}s)`, shareCode);

  return {
    shareCode,
    expireAt: new Date(createdAt + ttlSeconds * 1000).toISOString(),
    createdAt: new Date(createdAt).toISOString(),
  };
}

export function getChannel(shareCode: string): ChannelState | undefined {
  return getLiveChannel(shareCode);
}

export function channelExists(shareCode: string): boolean {
  return getLiveChannel(shareCode) !== undefined;
}

/**
 * Store the text and broadcast it. Returns false when the channel does not
 * exist or has already expired — an expired channel must never be revived by
 * an upload.
 */
export function updateText(shareCode: string, text: string): boolean {
  const channel = getLiveChannel(shareCode);
  if (!channel) return false;

  const ts = now();
  channel.latestText = text;
  channel.lastUploadAt = ts;
  channel.uploadWindow.push(ts);

  broadcast(shareCode, { type: 'text', data: text, timestamp: ts });
  return true;
}

export function getViewerCount(shareCode: string): number {
  const channel = getLiveChannel(shareCode);
  return channel ? channel.wsClients.size : 0;
}

/** Viewer identity captured at the WS handshake (audit recipients). */
export interface ViewerMeta {
  ip: string;
  ua: string;
}

/**
 * Snapshot of the viewers currently registered on a channel. Used to record
 * who received a broadcast; viewers connecting afterwards are not included.
 */
export function getViewerInfos(shareCode: string): ViewerInfo[] {
  const channel = getLiveChannel(shareCode);
  if (!channel) return [];
  return [...channel.viewerInfo.values()].map((viewer) => ({ ...viewer }));
}

export function addClient(shareCode: string, ws: WebSocket, meta?: ViewerMeta): number {
  const channel = getLiveChannel(shareCode);
  if (!channel) return 0;

  channel.wsClients.add(ws);
  channel.viewerInfo.set(ws, {
    ip: meta?.ip ?? '',
    ua: meta?.ua ?? '',
    connectedAt: now(),
  });
  const count = channel.wsClients.size;

  // Send welcome
  sendMessage(ws, { type: 'welcome', shareCode, viewerCount: count });

  // Send history (latest text before connection)
  if (channel.latestText) {
    sendMessage(ws, {
      type: 'history',
      messages: [
        {
          data: channel.latestText,
          timestamp: channel.lastUploadAt,
        },
      ],
    });
  }

  logger.info('ws_connected', `Client connected, viewers=${count}`, shareCode);

  // Keep every viewer's counter in sync (the newcomer included).
  broadcast(shareCode, { type: 'viewer_count', count });
  return count;
}

export function removeClient(shareCode: string, ws: WebSocket): void {
  const channel = channels.get(shareCode);
  if (!channel) return;

  if (!channel.wsClients.delete(ws)) return;
  channel.viewerInfo.delete(ws);

  const count = channel.wsClients.size;
  logger.info('ws_disconnected', `Client disconnected, viewers=${count}`, shareCode);
  broadcast(shareCode, { type: 'viewer_count', count });
}

/**
 * Active expiry sweep. Also prunes the shared rate-limit attempt table so no
 * individual request has to walk it.
 */
export function startCleanupTimer(config: AppConfig): void {
  if (cleanupTimer) return;

  cleanupTimer = setInterval(() => {
    const at = now();
    let cleaned = 0;

    for (const channel of channels.values()) {
      if (isChannelExpired(channel, at)) {
        dropChannel(channel, 'Channel expired');
        cleaned++;
      }
    }

    pruneAttempts(at);

    if (cleaned > 0) {
      logger.info('channel_cleaned', `Cleaned ${cleaned} expired channels`);
    }
  }, config.CLEANUP_INTERVAL_SECONDS * 1000);

  // Allow process to exit
  cleanupTimer.unref();
}

/** Manual expiry (POST /api/channel/expire). Returns false when already gone. */
export function expireChannel(shareCode: string): boolean {
  const channel = channels.get(shareCode);
  if (!channel) return false;

  if (isChannelExpired(channel)) {
    dropChannel(channel, 'Channel expired');
    return false;
  }

  dropChannel(channel, 'Channel closed');
  logger.info('channel_cleaned', 'Channel manually expired', shareCode);
  return true;
}

export function stopCleanupTimer(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

/**
 * Close every socket and forget all channels. Used on shutdown and between tests.
 *
 * Sockets are closed with **1012 (Service Restart)**, not 1001: 1001 means the
 * channel itself is gone (TTL expired / manually expired), and the web client
 * deliberately does **not** reconnect on it. A server restart must stay
 * retryable, otherwise every viewer is stuck on the "expired" banner until they
 * re-enter the 8-digit code.
 */
export function shutdownAll(): void {
  for (const channel of channels.values()) {
    for (const ws of channel.wsClients) {
      ws.close(1012, 'Server restart');
    }
    channel.wsClients.clear();
    channel.viewerInfo.clear();
  }
  channels.clear();
  clearAttempts();
}
