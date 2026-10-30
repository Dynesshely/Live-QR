import type { Request, Response, NextFunction } from 'express';
import { getChannel } from '../services/channelStore.js';
import { logger } from '../logger.js';
import { parseTrustProxy } from '../config.js';
import type { AppConfig } from '../types.js';
import { consumeAttempt } from '../services/attemptStore.js';
import { ipFromNodeRequest, type TrustProxySetting } from '../services/clientIp.js';

const UPLOAD_WINDOW_MS = 1000;

/**
 * The client IP the limiters key on. Resolved by the shared trust-proxy helper
 * so HTTP, WS and the audit trail all agree on who the client is.
 */
export function clientIpOf(req: Request, trustProxy: TrustProxySetting): string {
  return ipFromNodeRequest(req, trustProxy);
}

// ── Upload rate limiter (per shareCode, sliding window) ──

/**
 * Must run *after* the share-code/text validators so malformed requests do not
 * consume a channel's quota.
 */
export function createUploadRateLimiter(config: AppConfig) {
  return function uploadRateLimiter(req: Request, res: Response, next: NextFunction): void {
    const shareCode = res.locals.shareCode as string | undefined;

    // Defensive: the validator in front of us normally guarantees this.
    if (!shareCode) {
      next();
      return;
    }

    const channel = getChannel(shareCode);
    if (!channel) {
      next();
      return;
    }

    const cutoff = Date.now() - UPLOAD_WINDOW_MS;

    // Trim stale entries
    channel.uploadWindow = channel.uploadWindow.filter((ts) => ts > cutoff);

    if (channel.uploadWindow.length >= config.UPLOAD_RATE_LIMIT) {
      logger.warn('upload_rate_limited', 'Rate limit exceeded', shareCode);
      res.status(429).json({
        code: 429,
        error: 'RATE_LIMITED',
        message: '上传频率过高（限制 ' + config.UPLOAD_RATE_LIMIT + ' 次/秒），请稍后重试',
      });
      return;
    }

    next();
  };
}

// ── Verify rate limiter (per IP, sliding window) ──

/**
 * Must run *after* the share-code format validator so invalid codes do not
 * consume the per-IP quota.
 */
export function createVerifyRateLimiter(config: AppConfig) {
  const trustProxy = parseTrustProxy(config.TRUST_PROXY);

  return function verifyRateLimiter(req: Request, res: Response, next: NextFunction): void {
    const ip = clientIpOf(req, trustProxy);

    if (!consumeAttempt('verify:' + ip, config.VERIFY_RATE_LIMIT)) {
      logger.warn('verify_rate_limited', 'Verify rate limit exceeded', undefined, ip);
      res.status(429).json({
        code: 429,
        error: 'VERIFY_RATE_LIMITED',
        message: '验证请求过于频繁，请稍后重试',
      });
      return;
    }

    next();
  };
}

// ── Create rate limiter (per IP, sliding window) ──

/** Channel creation is cheap for us but grows an in-memory map: cap it. */
export function createCreateRateLimiter(config: AppConfig) {
  const trustProxy = parseTrustProxy(config.TRUST_PROXY);

  return function createRateLimiter(req: Request, res: Response, next: NextFunction): void {
    const ip = clientIpOf(req, trustProxy);

    if (!consumeAttempt('create:' + ip, config.CREATE_RATE_LIMIT)) {
      logger.warn('create_rate_limited', 'Create rate limit exceeded', undefined, ip);
      res.status(429).json({
        code: 429,
        error: 'CREATE_RATE_LIMITED',
        message: '创建通道过于频繁，请稍后重试',
      });
      return;
    }

    next();
  };
}
