import { createServer } from 'node:http';
import type { AppConfig } from './types.js';
import { createApp } from './app.js';
import { createWSServer } from './ws/handler.js';
import { startCleanupTimer, stopCleanupTimer, shutdownAll } from './services/channelStore.js';
import { logger } from './logger.js';

// ── Configuration ──

function loadConfig(): AppConfig {
  return {
    PORT_HTTP: parseInt(process.env.PORT_HTTP || '41601', 10),
    PORT_WS: parseInt(process.env.PORT_WS || '41602', 10),
    CHANNEL_TTL_SECONDS: parseInt(process.env.CHANNEL_TTL_SECONDS || '1800', 10),
    CLEANUP_INTERVAL_SECONDS: parseInt(process.env.CLEANUP_INTERVAL_SECONDS || '60', 10),
    UPLOAD_RATE_LIMIT: parseInt(process.env.UPLOAD_RATE_LIMIT || '2', 10),
    MAX_VIEWERS_PER_CHANNEL: parseInt(process.env.MAX_VIEWERS_PER_CHANNEL || '50', 10),
    VERIFY_RATE_LIMIT: parseInt(process.env.VERIFY_RATE_LIMIT || '10', 10),
    MAX_TEXT_LENGTH: parseInt(process.env.MAX_TEXT_LENGTH || '2000', 10),
  };
}

// ── Main ──

function main(): void {
  const config = loadConfig();

  logger.info('server_start', `Starting QR-Live server with config: ${JSON.stringify(config)}`);

  // Create Express app
  const app = createApp(config);

  // Create HTTP server
  const httpServer = createServer(app);

  // Start HTTP
  httpServer.listen(config.PORT_HTTP, () => {
    logger.info('server_start', `HTTP API server listening on port ${config.PORT_HTTP}`);
  });

  // Start WebSocket server
  const wss = createWSServer(config);

  // Start cleanup timer
  startCleanupTimer(config);

  // ── Graceful shutdown ──

  function shutdown(signal: string): void {
    logger.info('server_shutdown', `Received ${signal}, shutting down...`);

    // Stop cleanup
    stopCleanupTimer();

    // Close all WS connections and clear channels
    shutdownAll();

    // Close WS server
    wss.close(() => {
      logger.info('server_shutdown', 'WebSocket server closed');
    });

    // Close HTTP server
    httpServer.close(() => {
      logger.info('server_shutdown', 'HTTP server closed');
      process.exit(0);
    });

    // Force exit after 10s
    setTimeout(() => {
      logger.error('server_shutdown', 'Forced exit after timeout');
      process.exit(1);
    }, 10_000).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main();
