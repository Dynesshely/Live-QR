import express from 'express';
import type { AppConfig } from './types.js';
import { createChannelRouter } from './routes/channel.js';
import { createUploadRouter } from './routes/upload.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { accessLog } from './middleware/accessLog.js';
import { jsonBodyLimitBytes, parseTrustProxy } from './config.js';

export function createApp(config: AppConfig): express.Application {
  const app = express();

  app.disable('x-powered-by');

  // Trust proxy must be explicit: with the old 'true' any client could rotate
  // X-Forwarded-For and dodge the per-IP rate limits. Default is 'loopback',
  // which trusts exactly the reverse proxy running next to us.
  app.set('trust proxy', parseTrustProxy(config.TRUST_PROXY));

  // Access log sits before the body parser so rejected payloads are logged too.
  app.use(accessLog);

  // Body limit is derived from MAX_TEXT_LENGTH (worst-case JSON escaping) and
  // floored at 16kb, so raising MAX_TEXT_LENGTH cannot turn a valid upload
  // into a 413/500.
  app.use(express.json({ limit: jsonBodyLimitBytes(config.MAX_TEXT_LENGTH) }));

  // Routes
  app.use(createChannelRouter(config));
  app.use(createUploadRouter(config));

  // Health check (excluded from the access log)
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Unknown paths and errors must stay JSON: no HTML error pages.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
