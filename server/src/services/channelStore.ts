import { randomInt } from 'node:crypto';
import { WebSocket } from 'ws';
import type { ChannelState, ServerMessage, AppConfig } from '../types.js';
import { logger } from '../logger.js';

// ── In-memory store ──

const channels = new Map<string, ChannelState>();

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

// ── Helpers ──

function generateShareCode(): string {
  return String(randomInt(10_000_000, 99_999_999));
}

function now(): number {
  return Date.now();
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

  const ttl = expireSeconds ?? config.CHANNEL_TTL_SECONDS;
  const createdAt = now();
  const state: ChannelState = {
    shareCode,
    latestText: null,
    lastUploadAt: createdAt,
    createdAt,
    uploadCount: 0,
    uploadWindow: [],
    wsClients: new Set(),
  };

  channels.set(shareCode, state);

  logger.info('channel_created', `Channel created (TTL=${ttl}s)`, shareCode);

  return {
    shareCode,
    expireAt: new Date(createdAt + ttl * 1000).toISOString(),
    createdAt: new Date(createdAt).toISOString(),
  };
}

export function getChannel(shareCode: string): ChannelState | undefined {
  return channels.get(shareCode);
}

export function channelExists(shareCode: string): boolean {
  return channels.has(shareCode);
}

export function updateText(shareCode: string, text: string): void {
  const channel = channels.get(shareCode);
  if (!channel) return;

  const ts = now();
  channel.latestText = text;
  channel.lastUploadAt = ts;
  channel.uploadCount++;
  channel.uploadWindow.push(ts);

  // Broadcast to all viewers
  broadcast(shareCode, { type: 'text', data: text, timestamp: ts });
}

export function getViewerCount(shareCode: string): number {
  const channel = channels.get(shareCode);
  return channel ? channel.wsClients.size : 0;
}

export function addClient(shareCode: string, ws: WebSocket): number {
  const channel = channels.get(shareCode);
  if (!channel) return 0;

  channel.wsClients.add(ws);
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
  return count;
}

export function removeClient(shareCode: string, ws: WebSocket): void {
  const channel = channels.get(shareCode);
  if (!channel) return;

  channel.wsClients.delete(ws);
  logger.info('ws_disconnected', `Client disconnected, viewers=${channel.wsClients.size}`, shareCode);
}

export function startCleanupTimer(config: AppConfig): void {
  if (cleanupTimer) return;

  cleanupTimer = setInterval(() => {
    const cutoff = now() - config.CHANNEL_TTL_SECONDS * 1000;
    let cleaned = 0;

    for (const [code, channel] of channels) {
      if (channel.lastUploadAt < cutoff) {
        // Notify and close all viewers
        const expiredMsg: ServerMessage = {
          type: 'channel_expired',
          message: '该分享码已过期（30 分钟无上传），连接即将关闭',
        };
        for (const ws of channel.wsClients) {
          sendMessage(ws, expiredMsg);
          ws.close(1001, 'Channel expired');
        }
        channel.wsClients.clear();
        channels.delete(code);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info('channel_cleaned', `Cleaned ${cleaned} expired channels`);
    }
  }, config.CLEANUP_INTERVAL_SECONDS * 1000);

  // Allow process to exit
  cleanupTimer.unref();
}

export function expireChannel(shareCode: string): boolean {
  const channel = channels.get(shareCode);
  if (!channel) return false;

  const expiredMsg: ServerMessage = {
    type: 'channel_expired',
    message: '该分享码已过期（30 分钟无上传），连接即将关闭',
  };
  for (const ws of channel.wsClients) {
    sendMessage(ws, expiredMsg);
    ws.close(1001, 'Channel expired');
  }
  channel.wsClients.clear();
  channels.delete(shareCode);
  logger.info('channel_cleaned', `Channel manually expired`, shareCode);
  return true;
}

export function stopCleanupTimer(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

export function shutdownAll(): void {
  const expiredMsg: ServerMessage = {
    type: 'channel_expired',
    message: 'Server shutting down',
  };

  for (const [, channel] of channels) {
    for (const ws of channel.wsClients) {
      sendMessage(ws, expiredMsg);
      ws.close(1001, 'Server shutdown');
    }
    channel.wsClients.clear();
  }
  channels.clear();
}

// ── Internal helpers ──

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

function sendMessage(ws: WebSocket, message: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}
