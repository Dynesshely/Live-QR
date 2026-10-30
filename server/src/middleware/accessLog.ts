import type { Request, Response, NextFunction } from 'express';
import { logger } from '../logger.js';
import { parseTrustProxy } from '../config.js';
import type { AppConfig } from '../types.js';
import { clientIpOf } from './rateLimiter.js';

/**
 * One JSON line per request for compliance. Contains transport metadata only —
 * never the request body, never uploaded text. (The text itself goes to the
 * separate on-disk audit trail, see services/auditLog.ts.)
 *
 * /api/health is excluded because probes would otherwise flood the log.
 */
export function createAccessLog(config: AppConfig): (req: Request, res: Response, next: NextFunction) => void {
  const trustProxy = parseTrustProxy(config.TRUST_PROXY);

  return function accessLog(req: Request, res: Response, next: NextFunction): void {
    if (req.path === '/api/health') {
      next();
      return;
    }

    const startedAt = process.hrtime.bigint();

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      logger.access({
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs,
        clientIp: clientIpOf(req, trustProxy),
        userAgent: req.headers['user-agent'],
      });
    });

    next();
  };
}
