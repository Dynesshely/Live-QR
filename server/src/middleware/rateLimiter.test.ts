import { describe, it, expect } from 'vitest';
import { createUploadRateLimiter, createVerifyRateLimiter } from './rateLimiter.js';
import { createChannel, updateText, getChannel, shutdownAll } from '../services/channelStore.js';
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

function mockReq(body: unknown = {}, ip = '127.0.0.1'): any {
  return { body, ip, socket: { remoteAddress: ip } };
}

function mockRes(): any {
  const res: any = {};
  res.status = (code: number) => {
    res._status = code;
    return { json: (data: any) => { res._json = data; } };
  };
  return res;
}

describe('uploadRateLimiter', () => {
  it('allows uploads within limit', () => {
    const config = mockConfig({ UPLOAD_RATE_LIMIT: 2 });
    const ch = createChannel(config);
    const limiter = createUploadRateLimiter(config);

    // Simulate two uploads (populates uploadWindow)
    updateText(ch.shareCode, 'text1');
    updateText(ch.shareCode, 'text2');

    let nextCalled = false;
    limiter(mockReq({ shareCode: ch.shareCode }), mockRes(), () => { nextCalled = true; });
    // Third should be blocked because uploadWindow already has 2 entries
    expect(nextCalled).toBe(false);
  });

  it('blocks when uploadWindow is full', () => {
    const config = mockConfig({ UPLOAD_RATE_LIMIT: 1 });
    const ch = createChannel(config);
    const limiter = createUploadRateLimiter(config);

    updateText(ch.shareCode, 'text1');

    let nextCalled = false;
    const res = mockRes();
    limiter(mockReq({ shareCode: ch.shareCode }), res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(res._status).toBe(429);
    expect(res._json.error).toBe('RATE_LIMITED');
  });

  it('passes through when shareCode is missing', () => {
    const config = mockConfig();
    const limiter = createUploadRateLimiter(config);
    let nextCalled = false;
    limiter(mockReq({}), mockRes(), () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });

  it('passes through when channel does not exist', () => {
    const config = mockConfig();
    const limiter = createUploadRateLimiter(config);
    let nextCalled = false;
    limiter(mockReq({ shareCode: '12345678' }), mockRes(), () => { nextCalled = true; });
    expect(nextCalled).toBe(true);
  });
});

describe('verifyRateLimiter', () => {
  it('allows requests up to limit', () => {
    const config = mockConfig({ VERIFY_RATE_LIMIT: 3 });
    const limiter = createVerifyRateLimiter(config);
    let blocked = 0;

    for (let i = 0; i < 3; i++) {
      const res = mockRes();
      let nextCalled = false;
      limiter(mockReq(undefined, '10.0.0.1'), res, () => { nextCalled = true; });
      expect(nextCalled).toBe(true);
    }
  });

  it('blocks requests exceeding limit', () => {
    const config = mockConfig({ VERIFY_RATE_LIMIT: 2 });
    const limiter = createVerifyRateLimiter(config);

    // First 2 allowed
    for (let i = 0; i < 2; i++) {
      let nextCalled = false;
      limiter(mockReq(undefined, '10.0.0.3'), mockRes(), () => { nextCalled = true; });
      expect(nextCalled).toBe(true);
    }

    // 3rd blocked
    let nextCalled = false;
    const res = mockRes();
    limiter(mockReq(undefined, '10.0.0.3'), res, () => { nextCalled = true; });
    expect(nextCalled).toBe(false);
    expect(res._status).toBe(429);
    expect(res._json.error).toBe('VERIFY_RATE_LIMITED');
  });

  it('counts per-IP independently', () => {
    const config = mockConfig({ VERIFY_RATE_LIMIT: 1 });
    const limiter = createVerifyRateLimiter(config);

    // First IP hits limit
    let n1 = false, n2 = false;
    limiter(mockReq(undefined, '10.0.0.1'), mockRes(), () => { n1 = true; });

    // Different IP — should still be allowed
    limiter(mockReq(undefined, '10.0.0.2'), mockRes(), () => { n2 = true; });
    expect(n2).toBe(true);
  });
});
