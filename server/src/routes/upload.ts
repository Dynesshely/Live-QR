import { Router, type Request, type Response } from 'express';
import { getChannel } from '../services/channelStore.js';
import { updateText } from '../services/channelStore.js';
import { createUploadRateLimiter } from '../middleware/rateLimiter.js';
import type { AppConfig } from '../types.js';
import { logger } from '../logger.js';

const SHARE_CODE_REGEX = /^\d{8}$/;

export function createUploadRouter(config: AppConfig): Router {
  const router = Router();
  const uploadRateLimiter = createUploadRateLimiter(config);

  // POST /api/upload
  router.post('/api/upload', uploadRateLimiter, (req: Request, res: Response) => {
    const { shareCode, text } = req.body;

    // Validate shareCode
    if (!shareCode || typeof shareCode !== 'string' || !SHARE_CODE_REGEX.test(shareCode)) {
      res.status(400).json({
        code: 400,
        error: 'INVALID_SHARE_CODE',
        message: '分享码格式无效（需为 8 位数字）',
      });
      return;
    }

    // Validate text
    if (!text || typeof text !== 'string') {
      res.status(400).json({
        code: 400,
        error: 'TEXT_EMPTY',
        message: '文本内容不能为空',
      });
      return;
    }

    if (text.length > config.MAX_TEXT_LENGTH) {
      res.status(400).json({
        code: 400,
        error: 'TEXT_TOO_LONG',
        message: `文本长度超过限制（最大 ${config.MAX_TEXT_LENGTH} 字符）`,
      });
      return;
    }

    // Check channel exists
    const channel = getChannel(shareCode);
    if (!channel) {
      logger.info('upload_channel_not_found', `Upload to non-existent channel`, shareCode);
      res.status(404).json({
        code: 404,
        error: 'CHANNEL_NOT_FOUND',
        message: '分享码不存在或已过期',
      });
      return;
    }

    // Update
    updateText(shareCode, text);

    logger.info('upload_success', `Text uploaded (${text.length} chars)`, shareCode);

    res.status(200).json({
      code: 200,
      message: 'ok',
    });
  });

  return router;
}
