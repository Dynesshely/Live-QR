import { Router, type Request, type Response } from 'express';
import { createChannel, getChannel, expireChannel } from '../services/channelStore.js';
import { createCreateRateLimiter, createVerifyRateLimiter, clientIpOf } from '../middleware/rateLimiter.js';
import { requireShareCodeInQuery, requireShareCodeInBody } from '../middleware/validate.js';
import { createError } from '../middleware/errorHandler.js';
import { CHANNEL_EXPIRE_SECONDS_MIN, CHANNEL_EXPIRE_SECONDS_MAX } from '../config.js';
import type { AppConfig } from '../types.js';
import { logger } from '../logger.js';

/**
 * `expire_seconds` must be an integer inside the allowed range. Anything else
 * (string, float, null, out of range) is rejected — it used to be silently
 * ignored, which made the returned expireAt a lie.
 */
function parseExpireSeconds(body: unknown): number | undefined {
  const raw = (body as Record<string, unknown> | undefined)?.expire_seconds;
  if (raw === undefined) return undefined;

  if (
    typeof raw !== 'number' ||
    !Number.isInteger(raw) ||
    raw < CHANNEL_EXPIRE_SECONDS_MIN ||
    raw > CHANNEL_EXPIRE_SECONDS_MAX
  ) {
    logger.debug('validation_failed', 'Invalid expire_seconds');
    throw createError(
      400,
      'INVALID_EXPIRE_SECONDS',
      '过期时间范围无效（需为 ' + CHANNEL_EXPIRE_SECONDS_MIN + '–' + CHANNEL_EXPIRE_SECONDS_MAX + ' 秒之间的整数）',
    );
  }

  return raw;
}

export function createChannelRouter(config: AppConfig): Router {
  const router = Router();
  const createRateLimiter = createCreateRateLimiter(config);
  const verifyRateLimiter = createVerifyRateLimiter(config);

  // POST /api/channel/create
  router.post('/api/channel/create', createRateLimiter, (req: Request, res: Response) => {
    const expireSeconds = parseExpireSeconds(req.body);

    try {
      const result = createChannel(config, expireSeconds);
      res.status(201).json({
        code: 201,
        data: result,
      });
    } catch (err) {
      logger.error(
        'channel_create_failed',
        'Failed to create channel: ' + (err instanceof Error ? err.message : String(err)),
      );
      res.status(503).json({
        code: 503,
        error: 'SERVICE_UNAVAILABLE',
        message: '服务暂时不可用，请稍后重试',
      });
    }
  });

  // GET /api/channel/verify?shareCode=...
  // Format validation runs *before* the limiter: invalid codes cost nothing.
  router.get(
    '/api/channel/verify',
    requireShareCodeInQuery,
    verifyRateLimiter,
    (req: Request, res: Response) => {
      const shareCode = res.locals.shareCode as string;

      // getChannel() applies lazy expiry, so an expired channel 404s here.
      const channel = getChannel(shareCode);
      if (!channel) {
        throw createError(404, 'CHANNEL_NOT_FOUND', '分享码不存在或已过期');
      }

      logger.info('channel_verified', 'Channel verified', shareCode, clientIpOf(req));

      res.status(200).json({
        code: 200,
        valid: true,
        latestText: channel.latestText,
        updatedAt: channel.latestText ? new Date(channel.lastUploadAt).toISOString() : null,
      });
    },
  );

  // POST /api/channel/expire
  router.post('/api/channel/expire', requireShareCodeInBody, (_req: Request, res: Response) => {
    const shareCode = res.locals.shareCode as string;

    if (!expireChannel(shareCode)) {
      throw createError(404, 'CHANNEL_NOT_FOUND', '分享码不存在或已过期');
    }

    res.status(200).json({ code: 200, message: 'ok' });
  });

  return router;
}
