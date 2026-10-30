import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createChannel,
  getChannel,
  channelExists,
  updateText,
  getViewerCount,
  addClient,
  removeClient,
  startCleanupTimer,
  stopCleanupTimer,
  expireChannel,
  shutdownAll,
} from './channelStore.js';
import { clearAttempts, consumeAttempt, getAttemptKeys } from './attemptStore.js';
import type { AppConfig } from '../config.js';
import { FakeWebSocket, mockConfig } from '../testing/mocks.js';

const T0 = new Date('2026-01-01T00:00:00.000Z');

describe('channelStore', () => {
  let config: AppConfig;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    stopCleanupTimer();
    clearAttempts();
    shutdownAll();
    config = mockConfig();
  });

  afterEach(() => {
    stopCleanupTimer();
    shutdownAll();
    clearAttempts();
    vi.useRealTimers();
  });

  describe('createChannel', () => {
    it('creates a channel with an 8-digit share code', () => {
      const ch = createChannel(config);
      expect(ch.shareCode).toMatch(/^\d{8}$/);
    });

    it('returns expireAt and createdAt in ISO format', () => {
      const ch = createChannel(config);
      expect(ch.expireAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(ch.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('derives expireAt from the global TTL by default', () => {
      const ch = createChannel(config);
      expect(new Date(ch.expireAt).getTime() - new Date(ch.createdAt).getTime()).toBe(1800 * 1000);
      expect(getChannel(ch.shareCode)!.ttlSeconds).toBe(1800);
    });

    it('honours a per-channel expire_seconds instead of the global TTL', () => {
      const ch = createChannel(config, 60);
      expect(new Date(ch.expireAt).getTime() - new Date(ch.createdAt).getTime()).toBe(60 * 1000);
      expect(getChannel(ch.shareCode)!.ttlSeconds).toBe(60);
    });

    it('stores the channel in memory so getChannel can retrieve it', () => {
      const ch = createChannel(config);
      const stored = getChannel(ch.shareCode);
      expect(stored).toBeDefined();
      expect(stored!.shareCode).toBe(ch.shareCode);
    });

    it('creates unique share codes across multiple calls', () => {
      const codes = new Set(Array.from({ length: 20 }, () => createChannel(config).shareCode));
      expect(codes.size).toBe(20);
    });

    it('initializes channel state correctly (no dead uploadCount field)', () => {
      const ch = createChannel(config);
      const stored = getChannel(ch.shareCode)!;
      expect(stored.latestText).toBeNull();
      expect(stored.uploadWindow).toEqual([]);
      expect(stored.wsClients.size).toBe(0);
      expect('uploadCount' in stored).toBe(false);
    });
  });

  describe('channelExists', () => {
    it('returns true for existing channel', () => {
      const ch = createChannel(config);
      expect(channelExists(ch.shareCode)).toBe(true);
    });

    it('returns false for non-existent channel', () => {
      expect(channelExists('12345678')).toBe(false);
    });
  });

  describe('per-channel TTL and lazy expiry', () => {
    it('expires exactly ttlSeconds after the last activity', () => {
      const ch = createChannel(config, 60);

      vi.advanceTimersByTime(59_999);
      expect(getChannel(ch.shareCode)).toBeDefined();

      vi.advanceTimersByTime(1);
      // Expiry is lazy: the channel is gone on read even before the sweeper runs.
      expect(getChannel(ch.shareCode)).toBeUndefined();
      expect(channelExists(ch.shareCode)).toBe(false);
    });

    it('does not let a global TTL override a shorter per-channel TTL', () => {
      const shortLived = createChannel(config, 60);
      const longLived = createChannel(config, 3600);

      vi.advanceTimersByTime(61_000);

      expect(getChannel(shortLived.shareCode)).toBeUndefined();
      expect(getChannel(longLived.shareCode)).toBeDefined();
    });

    it('notifies and closes viewers when a channel expires lazily', () => {
      const ch = createChannel(config, 60);
      const ws = new FakeWebSocket();
      addClient(ch.shareCode, FakeWebSocket.asWS(ws));

      vi.advanceTimersByTime(60_000);
      expect(getChannel(ch.shareCode)).toBeUndefined();

      const expired = ws.messagesOfType('channel_expired');
      expect(expired).toHaveLength(1);
      expect(expired[0].code).toBe('CHANNEL_EXPIRED');
      // No hardcoded TTL in the copy any more.
      expect(String(expired[0].message)).not.toMatch(/\d/);
      expect(ws.closeCalls).toEqual([{ code: 1001, reason: 'Channel expired' }]);
    });

    it('does not revive an expired channel through updateText', () => {
      const ch = createChannel(config, 60);
      vi.advanceTimersByTime(60_000);

      expect(updateText(ch.shareCode, 'zombie')).toBe(false);
      expect(getChannel(ch.shareCode)).toBeUndefined();
    });
  });

  describe('updateText', () => {
    it('updates latestText and broadcasts a text message', () => {
      const ch = createChannel(config);
      const ws = new FakeWebSocket();
      addClient(ch.shareCode, FakeWebSocket.asWS(ws));
      ws.sent = [];

      expect(updateText(ch.shareCode, 'hello')).toBe(true);

      expect(getChannel(ch.shareCode)!.latestText).toBe('hello');
      const textMessages = ws.messagesOfType('text');
      expect(textMessages).toHaveLength(1);
      expect(textMessages[0].data).toBe('hello');
    });

    it('refreshes the TTL anchor on every upload', () => {
      const ch = createChannel(config, 60);

      vi.advanceTimersByTime(50_000);
      updateText(ch.shareCode, 'keep-alive');

      // 50s after the upload: still alive although 100s passed since creation.
      vi.advanceTimersByTime(50_000);
      expect(getChannel(ch.shareCode)).toBeDefined();

      vi.advanceTimersByTime(10_000);
      expect(getChannel(ch.shareCode)).toBeUndefined();
    });

    it('returns false for a non-existent channel', () => {
      expect(updateText('00000000', 'noop')).toBe(false);
    });
  });

  describe('addClient / removeClient / getViewerCount', () => {
    it('addClient sends welcome and broadcasts viewer_count 1', () => {
      const ch = createChannel(config);
      const ws = new FakeWebSocket();

      const count = addClient(ch.shareCode, FakeWebSocket.asWS(ws));

      expect(count).toBe(1);
      expect(getViewerCount(ch.shareCode)).toBe(1);
      expect(ws.messagesOfType('welcome')).toEqual([
        expect.objectContaining({ type: 'welcome', shareCode: ch.shareCode, viewerCount: 1 }),
      ]);
      expect(ws.messagesOfType('viewer_count')).toEqual([
        expect.objectContaining({ type: 'viewer_count', count: 1 }),
      ]);
    });

    it('broadcasts viewer_count to every viewer on join', () => {
      const ch = createChannel(config);
      const ws1 = new FakeWebSocket();
      const ws2 = new FakeWebSocket();

      addClient(ch.shareCode, FakeWebSocket.asWS(ws1));
      addClient(ch.shareCode, FakeWebSocket.asWS(ws2));

      expect(ws1.messagesOfType('viewer_count').at(-1)).toMatchObject({ count: 2 });
      expect(ws2.messagesOfType('viewer_count').at(-1)).toMatchObject({ count: 2 });
    });

    it('broadcasts viewer_count on leave', () => {
      const ch = createChannel(config);
      const ws1 = new FakeWebSocket();
      const ws2 = new FakeWebSocket();
      addClient(ch.shareCode, FakeWebSocket.asWS(ws1));
      addClient(ch.shareCode, FakeWebSocket.asWS(ws2));

      removeClient(ch.shareCode, FakeWebSocket.asWS(ws1));

      expect(getViewerCount(ch.shareCode)).toBe(1);
      expect(ws2.messagesOfType('viewer_count').at(-1)).toMatchObject({ count: 1 });
    });

    it('removeClient is a no-op for an unknown client', () => {
      const ch = createChannel(config);
      const ws = new FakeWebSocket();
      addClient(ch.shareCode, FakeWebSocket.asWS(ws));

      removeClient(ch.shareCode, FakeWebSocket.asWS(new FakeWebSocket()));
      expect(getViewerCount(ch.shareCode)).toBe(1);
    });

    it('sends history with latestText when available', () => {
      const ch = createChannel(config);
      updateText(ch.shareCode, 'existing text');
      const ws = new FakeWebSocket();

      addClient(ch.shareCode, FakeWebSocket.asWS(ws));

      const history = ws.messagesOfType('history');
      expect(history).toHaveLength(1);
      expect((history[0].messages as Array<{ data: string }>)[0].data).toBe('existing text');
    });

    it('returns 0 and sends nothing for a non-existent channel', () => {
      const ws = new FakeWebSocket();
      expect(addClient('00000000', FakeWebSocket.asWS(ws))).toBe(0);
      expect(ws.sent).toEqual([]);
    });
  });

  describe('expireChannel', () => {
    it('closes viewers and removes the channel', () => {
      const ch = createChannel(config);
      const ws = new FakeWebSocket();
      addClient(ch.shareCode, FakeWebSocket.asWS(ws));

      expect(expireChannel(ch.shareCode)).toBe(true);
      expect(channelExists(ch.shareCode)).toBe(false);
      expect(ws.messagesOfType('channel_expired')).toHaveLength(1);
      expect(ws.closeCalls[0].code).toBe(1001);
      // A closing channel must not broadcast viewer counts.
      expect(ws.messagesOfType('viewer_count').at(-1)).toMatchObject({ count: 1 });
    });

    it('returns false for unknown and already-expired channels', () => {
      expect(expireChannel('00000000')).toBe(false);

      const ch = createChannel(config, 60);
      vi.advanceTimersByTime(60_000);
      expect(expireChannel(ch.shareCode)).toBe(false);
      expect(channelExists(ch.shareCode)).toBe(false);
    });
  });

  describe('cleanup timer', () => {
    it('sweeps expired channels with their own TTL and keeps active ones', () => {
      const shortLived = createChannel(config, 60);
      const longLived = createChannel(config, 3600);
      startCleanupTimer(mockConfig({ CLEANUP_INTERVAL_SECONDS: 60 }));

      vi.advanceTimersByTime(60_000);

      expect(channelExists(shortLived.shareCode)).toBe(false);
      expect(channelExists(longLived.shareCode)).toBe(true);
    });

    it('prunes the rate-limit attempt table instead of every request sweeping it', () => {
      consumeAttempt('verify:10.0.0.1', 5);
      consumeAttempt('verify:10.0.0.2', 5);
      expect(getAttemptKeys()).toHaveLength(2);

      startCleanupTimer(mockConfig({ CLEANUP_INTERVAL_SECONDS: 60 }));
      vi.advanceTimersByTime(120_000);

      expect(getAttemptKeys()).toEqual([]);
    });
  });

  describe('shutdownAll', () => {
    it('closes viewers with 1012 (service restart) and clears all state', () => {
      const ch = createChannel(config);
      const ws = new FakeWebSocket();
      addClient(ch.shareCode, FakeWebSocket.asWS(ws));
      consumeAttempt('verify:10.0.0.9', 5);

      shutdownAll();

      expect(channelExists(ch.shareCode)).toBe(false);
      expect(getAttemptKeys()).toEqual([]);
      expect(ws.closeCalls).toEqual([{ code: 1012, reason: 'Server restart' }]);
      // Shutdown is not an expiry: no channel_expired message is sent.
      expect(ws.messagesOfType('channel_expired')).toHaveLength(0);
    });
  });
});
