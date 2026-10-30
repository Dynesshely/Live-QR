import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Request, Response } from 'express';
import {
  createUploadRateLimiter,
  createVerifyRateLimiter,
  createCreateRateLimiter,
} from './rateLimiter.js';
import { createChannel, updateText, shutdownAll } from '../services/channelStore.js';
import { clearAttempts, consumeAttempt, getAttemptKeys } from '../services/attemptStore.js';
import type { AppConfig } from '../config.js';
import { mockConfig, mockRequest, mockResponse } from '../testing/mocks.js';

function runLimiter(
  limiter: (req: Request, res: Response, next: () => void) => void,
  req: ReturnType<typeof mockRequest>,
  res: ReturnType<typeof mockResponse>,
): { nextCalled: boolean } {
  let nextCalled = false;
  limiter(req as unknown as Request, res as unknown as Response, () => {
    nextCalled = true;
  });
  return { nextCalled };
}

describe('uploadRateLimiter', () => {
  let config: AppConfig;

  beforeEach(() => {
    shutdownAll();
    config = mockConfig({ UPLOAD_RATE_LIMIT: 2 });
  });

  it('allows the first two uploads and blocks the third', () => {
    const ch = createChannel(config);
    const limiter = createUploadRateLimiter(config);

    // Two uploads populate uploadWindow
    updateText(ch.shareCode, 'text1');
    updateText(ch.shareCode, 'text2');

    const res = mockResponse();
    res.locals.shareCode = ch.shareCode;
    const { nextCalled } = runLimiter(limiter, mockRequest({ body: { shareCode: ch.shareCode } }), res);

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(429);
    expect((res.body as { error: string }).error).toBe('RATE_LIMITED');
  });

  it('lets an upload through once the 1s window has slid', () => {
    vi.useFakeTimers();
    try {
      const ch = createChannel(config);
      const limiter = createUploadRateLimiter(config);

      updateText(ch.shareCode, 'text1');
      updateText(ch.shareCode, 'text2');

      // 1.1s later the window is empty again
      vi.advanceTimersByTime(1100);

      const res = mockResponse();
      res.locals.shareCode = ch.shareCode;
      const { nextCalled } = runLimiter(
        limiter,
        mockRequest({ body: { shareCode: ch.shareCode } }),
        res,
      );
      expect(nextCalled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('passes through when the validator did not set a shareCode', () => {
    const limiter = createUploadRateLimiter(config);
    const { nextCalled } = runLimiter(limiter, mockRequest({ body: {} }), mockResponse());
    expect(nextCalled).toBe(true);
  });

  it('passes through when the channel does not exist', () => {
    const limiter = createUploadRateLimiter(config);
    const res = mockResponse();
    res.locals.shareCode = '12345678';
    const { nextCalled } = runLimiter(limiter, mockRequest(), res);
    expect(nextCalled).toBe(true);
  });
});

describe('verifyRateLimiter', () => {
  beforeEach(() => {
    shutdownAll();
    clearAttempts();
  });

  it('allows requests up to the limit', () => {
    const config = mockConfig({ VERIFY_RATE_LIMIT: 3 });
    const limiter = createVerifyRateLimiter(config);

    for (let i = 0; i < 3; i++) {
      const { nextCalled } = runLimiter(limiter, mockRequest({ ip: '10.0.0.1' }), mockResponse());
      expect(nextCalled).toBe(true);
    }
  });

  it('blocks requests exceeding the limit', () => {
    const config = mockConfig({ VERIFY_RATE_LIMIT: 2 });
    const limiter = createVerifyRateLimiter(config);

    for (let i = 0; i < 2; i++) {
      const { nextCalled } = runLimiter(limiter, mockRequest({ ip: '10.0.0.3' }), mockResponse());
      expect(nextCalled).toBe(true);
    }

    const res = mockResponse();
    const { nextCalled } = runLimiter(limiter, mockRequest({ ip: '10.0.0.3' }), res);
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(429);
    expect((res.body as { error: string }).error).toBe('VERIFY_RATE_LIMITED');
  });

  it('counts per IP independently', () => {
    const config = mockConfig({ VERIFY_RATE_LIMIT: 1 });
    const limiter = createVerifyRateLimiter(config);

    const first = runLimiter(limiter, mockRequest({ ip: '10.0.0.1' }), mockResponse());
    const blocked = runLimiter(limiter, mockRequest({ ip: '10.0.0.1' }), mockResponse());
    const other = runLimiter(limiter, mockRequest({ ip: '10.0.0.2' }), mockResponse());

    expect(first.nextCalled).toBe(true);
    expect(blocked.nextCalled).toBe(false);
    expect(other.nextCalled).toBe(true);
  });

  it('forgets attempts after the 60s window', () => {
    vi.useFakeTimers();
    try {
      const config = mockConfig({ VERIFY_RATE_LIMIT: 1 });
      const limiter = createVerifyRateLimiter(config);

      expect(runLimiter(limiter, mockRequest({ ip: '10.0.0.4' }), mockResponse()).nextCalled).toBe(
        true,
      );
      expect(runLimiter(limiter, mockRequest({ ip: '10.0.0.4' }), mockResponse()).nextCalled).toBe(
        false,
      );

      vi.advanceTimersByTime(61_000);
      expect(runLimiter(limiter, mockRequest({ ip: '10.0.0.4' }), mockResponse()).nextCalled).toBe(
        true,
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('createRateLimiter', () => {
  beforeEach(() => {
    clearAttempts();
  });

  it('allows up to CREATE_RATE_LIMIT requests per IP', () => {
    const config = mockConfig({ CREATE_RATE_LIMIT: 2 });
    const limiter = createCreateRateLimiter(config);

    expect(runLimiter(limiter, mockRequest(), mockResponse()).nextCalled).toBe(true);
    expect(runLimiter(limiter, mockRequest(), mockResponse()).nextCalled).toBe(true);

    const res = mockResponse();
    const { nextCalled } = runLimiter(limiter, mockRequest(), res);
    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(429);
    expect((res.body as { error: string }).error).toBe('CREATE_RATE_LIMITED');
  });

  it('keeps the create bucket separate from the verify bucket', () => {
    const config = mockConfig({ CREATE_RATE_LIMIT: 1, VERIFY_RATE_LIMIT: 1 });
    const createLimiter = createCreateRateLimiter(config);
    const verifyLimiter = createVerifyRateLimiter(config);

    expect(runLimiter(createLimiter, mockRequest({ ip: '10.9.9.9' }), mockResponse()).nextCalled).toBe(
      true,
    );
    // The create attempt must not block verifying from the same IP.
    expect(runLimiter(verifyLimiter, mockRequest({ ip: '10.9.9.9' }), mockResponse()).nextCalled).toBe(
      true,
    );
    expect(getAttemptKeys()).toEqual(
      expect.arrayContaining(['create:10.9.9.9', 'verify:10.9.9.9']),
    );
  });
});

describe('attemptStore', () => {
  afterEach(() => {
    clearAttempts();
  });

  it('does not record a rejected attempt', () => {
    clearAttempts();
    expect(consumeAttempt('k', 1)).toBe(true);
    expect(consumeAttempt('k', 1)).toBe(false);
    expect(getAttemptKeys()).toEqual(['k']);
  });
});
