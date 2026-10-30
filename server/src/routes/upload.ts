import { Router, type Request, type Response, type NextFunction } from 'express';
import { getViewerInfos, updateText } from '../services/channelStore.js';
import { createUploadRateLimiter, clientIpOf } from '../middleware/rateLimiter.js';
import { requireShareCodeInBody } from '../middleware/validate.js';
import { createError } from '../middleware/errorHandler.js';
import { parseTrustProxy } from '../config.js';
import { userAgentFromNodeRequest } from '../services/clientIp.js';
import { tryRecord, type AuditRecorder } from '../services/auditLog.js';
import type { AppConfig } from '../types.js';
import { logger } from '../logger.js';

/**
 * Text validation runs before the rate limiter so a rejected upload does not
 * consume the channel's quota. Length is counted in Unicode code points, not
 * UTF-16 units, so an emoji (and astral-plane characters in general) counts as
 * one character.
 */
function validateUploadText(config: AppConfig) {
  return function uploadTextValidator(req: Request, res: Response, next: NextFunction): void {
    const body = req.body as Record<string, unknown> | undefined;
    const text = body?.text;

    if (typeof text !== 'string' || text.trim().length === 0) {
      logger.debug('validation_failed', 'Empty or missing upload text');
      next(createError(400, 'TEXT_EMPTY', '文本内容不能为空'));
      return;
    }

    const length = [...text].length;
    if (length > config.MAX_TEXT_LENGTH) {
      logger.debug('validation_failed', 'Upload text too long (' + length + ' code points)');
      next(
        createError(
          400,
          'TEXT_TOO_LONG',
          '文本长度超过限制（最大 ' + config.MAX_TEXT_LENGTH + ' 字符）',
        ),
      );
      return;
    }

    res.locals.text = text;
    res.locals.textLength = length;
    next();
  };
}

export function createUploadRouter(config: AppConfig, audit?: AuditRecorder): Router {
  const router = Router();
  const uploadRateLimiter = createUploadRateLimiter(config);
  const trustProxy = parseTrustProxy(config.TRUST_PROXY);

  // POST /api/upload
  router.post(
    '/api/upload',
    requireShareCodeInBody,
    validateUploadText(config),
    uploadRateLimiter,
    (req: Request, res: Response) => {
      const shareCode = res.locals.shareCode as string;
      const text = res.locals.text as string;
      const length = res.locals.textLength as number;

      // Snapshot the viewers *at broadcast time*: anyone who joins after this
      // upload did not receive it and must not appear as a recipient.
      const recipients = getViewerInfos(shareCode).map((viewer) => ({
        ip: viewer.ip,
        ua: viewer.ua,
      }));

      // updateText() also refuses expired channels: an upload cannot revive one.
      if (!updateText(shareCode, text)) {
        logger.info('upload_channel_not_found', 'Upload to non-existent channel', shareCode);
        throw createError(404, 'CHANNEL_NOT_FOUND', '分享码不存在或已过期');
      }

      // Compliance trail: who uploaded what, and who received it. Audit writes
      // are fire-and-forget and can never fail this request.
      tryRecord(() =>
        audit?.recordUpload({
          shareCode,
          uploaderIp: clientIpOf(req, trustProxy),
          uploaderUa: userAgentFromNodeRequest(req),
          text,
          recipients,
        }),
      );

      logger.info('upload_success', 'Text uploaded (' + length + ' chars)', shareCode);

      res.status(200).json({
        code: 200,
        message: 'ok',
      });
    },
  );

  return router;
}
