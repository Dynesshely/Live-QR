import type { Request, Response, NextFunction } from 'express';
import { logger } from '../logger.js';
import { createError } from './errorHandler.js';

export const SHARE_CODE_REGEX = /^\d{8}$/;

/**
 * Share-code format validators. They are always mounted *before* a rate
 * limiter so that invalid traffic never consumes a client's quota.
 *
 * Validated values are handed to the route via res.locals so the handler does
 * not have to re-parse the request.
 */

export function requireShareCodeInQuery(req: Request, res: Response, next: NextFunction): void {
  const shareCode = req.query.shareCode;

  if (typeof shareCode !== 'string' || !SHARE_CODE_REGEX.test(shareCode)) {
    logger.debug('validation_failed', 'Invalid shareCode in query');
    next(createError(400, 'INVALID_SHARE_CODE', '分享码格式无效（需为 8 位数字）'));
    return;
  }

  res.locals.shareCode = shareCode;
  next();
}

export function requireShareCodeInBody(req: Request, res: Response, next: NextFunction): void {
  // Guard: a request without a JSON body has req.body === undefined.
  const body = req.body as Record<string, unknown> | undefined;
  const shareCode = body?.shareCode;

  if (typeof shareCode !== 'string' || !SHARE_CODE_REGEX.test(shareCode)) {
    logger.debug('validation_failed', 'Invalid shareCode in body');
    next(createError(400, 'INVALID_SHARE_CODE', '分享码格式无效（需为 8 位数字）'));
    return;
  }

  res.locals.shareCode = shareCode;
  next();
}
