import express from 'express';
import type { AppConfig } from './types.js';
import { createChannelRouter } from './routes/channel.js';
import { createUploadRouter } from './routes/upload.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { createAccessLog } from './middleware/accessLog.js';
import { jsonBodyLimitBytes, parseTrustProxy } from './config.js';
import type { AuditRecorder } from './services/auditLog.js';

export interface AppDeps {
  /** On-disk audit trail (undefined when AUDIT_LOG_ENABLED=false). */
  audit?: AuditRecorder;
}

export function createApp(config: AppConfig, deps: AppDeps = {}): express.Application {
  const app = express();

  app.disable('x-powered-by');

  // Trust proxy must be explicit: with the old 'true' any client could rotate
  // X-Forwarded-For and dodge the per-IP rate limits. Default is 'loopback',
  // which trusts exactly the reverse proxy running next to us.
  app.set('trust proxy', parseTrustProxy(config.TRUST_PROXY));

  // Access log sits before the body parser so rejected payloads are logged too.
  app.use(createAccessLog(config));

  // Body limit is derived from MAX_TEXT_LENGTH (worst-case JSON escaping) and
  // floored at 16kb, so raising MAX_TEXT_LENGTH cannot turn a valid upload
  // into a 413/500.
  app.use(express.json({ limit: jsonBodyLimitBytes(config.MAX_TEXT_LENGTH) }));

  // Routes
  app.use(createChannelRouter(config));
  app.use(createUploadRouter(config, deps.audit));

  // Health check (excluded from the access log)
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Unknown paths and errors must stay JSON: no HTML error pages.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
