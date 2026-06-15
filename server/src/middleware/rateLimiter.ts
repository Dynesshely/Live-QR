import type { Request, Response, NextFunction } from 'express';
import { channelExists, getChannel } from '../services/channelStore.js';
import { logger } from '../logger.js';
import type { AppConfig } from '../types.js';

// ── Upload rate limiter (per shareCode, sliding window) ──

export function createUploadRateLimiter(config: AppConfig) {
  return function uploadRateLimiter(req: Request, res: Response, next: NextFunction): void {
    const { shareCode } = req.body;

    if (!shareCode || typeof shareCode !== 'string') {
      next();
      return;
    }

    const channel = getChannel(shareCode);
    if (!channel) {
      next();
      return;
    }

    const windowMs = 1000; // 1 second window
    const cutoff = Date.now() - windowMs;

    // Trim stale entries
    channel.uploadWindow = channel.uploadWindow.filter(ts => ts > cutoff);

    if (channel.uploadWindow.length >= config.UPLOAD_RATE_LIMIT) {
      logger.warn('upload_rate_limited', `Rate limit exceeded`, shareCode);
      res.status(429).json({
        code: 429,
        error: 'RATE_LIMITED',
        message: `上传频率过高（限制 ${config.UPLOAD_RATE_LIMIT} 次/秒），请稍后重试`,
      });
      return;
    }

    next();
  };
}

// ── Verify rate limiter (per IP, sliding window) ──

const verifyAttempts = new Map<string, number[]>();

export function createVerifyRateLimiter(config: AppConfig) {
  return function verifyRateLimiter(req: Request, res: Response, next: NextFunction): void {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const windowMs = 60_000; // 60 second window
    const cutoff = Date.now() - windowMs;

    let attempts = verifyAttempts.get(ip) || [];

    // Trim stale entries
    attempts = attempts.filter(ts => ts > cutoff);

    if (attempts.length >= config.VERIFY_RATE_LIMIT) {
      logger.warn('verify_rate_limited', `Verify rate limit exceeded`, undefined, ip);
      res.status(429).json({
        code: 429,
        error: 'VERIFY_RATE_LIMITED',
        message: '验证请求过于频繁，请稍后重试',
      });
      return;
    }

    attempts.push(Date.now());
    verifyAttempts.set(ip, attempts);

    // Garbage collection: if map gets too large, sweep stale entries
    if (verifyAttempts.size > 1000) {
      for (const [storedIp, timestamps] of verifyAttempts) {
        const fresh = timestamps.filter(ts => ts > cutoff);
        if (fresh.length === 0) {
          verifyAttempts.delete(storedIp);
        } else {
          verifyAttempts.set(storedIp, fresh);
        }
      }
    }

    next();
  };
}
