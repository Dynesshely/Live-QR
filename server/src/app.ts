import express from 'express';
import type { AppConfig } from './types.js';
import { createChannelRouter } from './routes/channel.js';
import { createUploadRouter } from './routes/upload.js';
import { errorHandler } from './middleware/errorHandler.js';

export function createApp(config: AppConfig): express.Application {
  const app = express();

  // Trust proxy (required for correct req.ip behind Caddy)
  app.set('trust proxy', true);

  // Body parsing
  app.use(express.json({ limit: '10kb' }));

  // Routes
  app.use(createChannelRouter(config));
  app.use(createUploadRouter(config));

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // Error handler (must be last)
  app.use(errorHandler);

  return app;
}
