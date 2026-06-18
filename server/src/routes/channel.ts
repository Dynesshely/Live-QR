import { Router, type Request, type Response } from 'express';
import { createChannel, getChannel, channelExists, expireChannel } from '../services/channelStore.js';
import { createVerifyRateLimiter } from '../middleware/rateLimiter.js';
import type { AppConfig } from '../types.js';
import { logger } from '../logger.js';

const SHARE_CODE_REGEX = /^\d{8}$/;

export function createChannelRouter(config: AppConfig): Router {
  const router = Router();

  // POST /api/channel/create
  router.post('/api/channel/create', (req: Request, res: Response) => {
    try {
      // Optional expire_seconds (default 1800, range [60, 7200])
      let expireSeconds: number | undefined;
      if (req.body && typeof req.body.expire_seconds === 'number') {
        const val = req.body.expire_seconds;
        if (val < 60 || val > 7200) {
          res.status(400).json({
            code: 400,
            error: 'INVALID_EXPIRE_SECONDS',
            message: '过期时间范围无效（需在 60–7200 秒之间）',
          });
          return;
        }
        expireSeconds = val;
      }

      const result = createChannel(config, expireSeconds);
      res.status(201).json({
        code: 201,
        data: result,
      });
    } catch (err) {
      logger.error('channel_created', `Failed to create channel: ${err instanceof Error ? err.message : String(err)}`);
      res.status(503).json({
        code: 503,
        error: 'SERVICE_UNAVAILABLE',
        message: '服务暂时不可用，请稍后重试',
      });
    }
  });

  // GET /api/channel/verify?shareCode=...
  const verifyRateLimiter = createVerifyRateLimiter(config);
  router.get('/api/channel/verify', verifyRateLimiter, (req: Request, res: Response) => {
    const shareCode = req.query.shareCode as string | undefined;

    if (!shareCode || !SHARE_CODE_REGEX.test(shareCode)) {
      res.status(400).json({
        code: 400,
        error: 'INVALID_SHARE_CODE',
        message: '分享码格式无效（需为 8 位数字）',
      });
      return;
    }

    const channel = getChannel(shareCode);
    if (!channel) {
      res.status(404).json({
        code: 404,
        error: 'CHANNEL_NOT_FOUND',
        message: '分享码不存在或已过期',
      });
      return;
    }

    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    logger.info('channel_verified', `Channel verified`, shareCode, ip);

    res.status(200).json({
      code: 200,
      valid: true,
      latestText: channel.latestText,
      updatedAt: channel.latestText ? new Date(channel.lastUploadAt).toISOString() : null,
    });
  });

  // POST /api/channel/expire
  router.post('/api/channel/expire', (req: Request, res: Response) => {
    const { shareCode } = req.body;

    if (!shareCode || !SHARE_CODE_REGEX.test(shareCode)) {
      res.status(400).json({
        code: 400,
        error: 'INVALID_SHARE_CODE',
        message: '分享码格式无效（需为 8 位数字）',
      });
      return;
    }

    const expired = expireChannel(shareCode);
    if (!expired) {
      res.status(404).json({
        code: 404,
        error: 'CHANNEL_NOT_FOUND',
        message: '分享码不存在或已过期',
      });
      return;
    }

    res.status(200).json({ code: 200, message: 'ok' });
  });

  return router;
}
