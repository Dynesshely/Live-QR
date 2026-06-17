import { describe, it, expect, beforeEach, vi } from 'vitest';
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
  shutdownAll,
} from './channelStore.js';
import type { AppConfig } from '../config.js';

function mockConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    PORT_HTTP: 41601,
    PORT_WS: 41602,
    CHANNEL_TTL_SECONDS: 1800,
    CLEANUP_INTERVAL_SECONDS: 60,
    UPLOAD_RATE_LIMIT: 2,
    MAX_VIEWERS_PER_CHANNEL: 50,
    VERIFY_RATE_LIMIT: 10,
    MAX_TEXT_LENGTH: 2000,
    ...overrides,
  };
}

function mockWS(): any {
  return {
    readyState: 1, // WebSocket.OPEN
    send: vi.fn(),
    close: vi.fn(),
    terminate: vi.fn(),
    on: vi.fn(),
  };
}

describe('channelStore', () => {
  let config: AppConfig;

  beforeEach(() => {
    config = mockConfig();
    stopCleanupTimer();
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

    it('initializes channel state correctly', () => {
      const ch = createChannel(config);
      const stored = getChannel(ch.shareCode)!;
      expect(stored.latestText).toBeNull();
      expect(stored.uploadCount).toBe(0);
      expect(stored.uploadWindow).toEqual([]);
      expect(stored.wsClients.size).toBe(0);
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

  describe('updateText', () => {
    it('updates latestText and increments uploadCount', () => {
      const ch = createChannel(config);
      updateText(ch.shareCode, 'hello');
      const stored = getChannel(ch.shareCode)!;
      expect(stored.latestText).toBe('hello');
      expect(stored.uploadCount).toBe(1);
    });

    it('refreshes lastUploadAt', async () => {
      const ch = createChannel(config);
      const before = getChannel(ch.shareCode)!.lastUploadAt;
      await new Promise((r) => setTimeout(r, 5));
      updateText(ch.shareCode, 'hello');
      const after = getChannel(ch.shareCode)!.lastUploadAt;
      expect(after).toBeGreaterThan(before);
    });

    it('broadcasts text message to connected clients', () => {
      const ch = createChannel(config);
      const ws = mockWS();
      addClient(ch.shareCode, ws);
      updateText(ch.shareCode, 'test');
      expect(ws.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"text"'),
      );
    });

    it('gracefully handles non-existent channel', () => {
      expect(() => updateText('00000000', 'noop')).not.toThrow();
    });
  });

  describe('addClient / removeClient / getViewerCount', () => {
    it('addClient sends welcome and returns viewer count', () => {
      const ch = createChannel(config);
      const ws = mockWS();
      const count = addClient(ch.shareCode, ws);
      expect(count).toBe(1);
      expect(getViewerCount(ch.shareCode)).toBe(1);
      expect(ws.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"welcome"'),
      );
    });

    it('sends history with latestText when available', () => {
      const ch = createChannel(config);
      updateText(ch.shareCode, 'existing text');
      const ws = mockWS();
      addClient(ch.shareCode, ws);
      expect(ws.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"history"'),
      );
    });

    it('removeClient decrements viewer count', () => {
      const ch = createChannel(config);
      const ws = mockWS();
      addClient(ch.shareCode, ws);
      removeClient(ch.shareCode, ws);
      expect(getViewerCount(ch.shareCode)).toBe(0);
    });

    it('tracks multiple viewers', () => {
      const ch = createChannel(config);
      const ws1 = mockWS();
      const ws2 = mockWS();
      addClient(ch.shareCode, ws1);
      addClient(ch.shareCode, ws2);
      expect(getViewerCount(ch.shareCode)).toBe(2);
      removeClient(ch.shareCode, ws1);
      expect(getViewerCount(ch.shareCode)).toBe(1);
    });
  });

  describe('cleanup', () => {
    it('removes expired channels', async () => {
      stopCleanupTimer();
      const shortConfig = mockConfig({ CHANNEL_TTL_SECONDS: 0, CLEANUP_INTERVAL_SECONDS: 1 });
      const ch = createChannel(shortConfig);

      // Set lastUploadAt far in the past to force expiration
      const stored = getChannel(ch.shareCode)!;
      stored.lastUploadAt = Date.now() - 100_000;

      await new Promise<void>((resolve) => {
        startCleanupTimer(shortConfig);
        setTimeout(() => {
          stopCleanupTimer();
          resolve();
        }, 1500);
      });

      expect(channelExists(ch.shareCode)).toBe(false);
    });

    it('keeps active channels', async () => {
      stopCleanupTimer();
      const config2 = mockConfig({ CHANNEL_TTL_SECONDS: 3600, CLEANUP_INTERVAL_SECONDS: 1 });
      const ch = createChannel(config2);

      await new Promise<void>((resolve) => {
        startCleanupTimer(config2);
        setTimeout(() => {
          stopCleanupTimer();
          resolve();
        }, 500);
      });

      expect(channelExists(ch.shareCode)).toBe(true);
    });
  });
});
