import { createServer } from 'node:http';
import { loadConfig } from './config.js';
import { createApp } from './app.js';
import { createWSServer } from './ws/handler.js';
import { startCleanupTimer, stopCleanupTimer, shutdownAll } from './services/channelStore.js';
import { logger } from './logger.js';

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

  let shuttingDown = false;

  function shutdown(signal: string): void {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info('server_shutdown', `Received ${signal}, shutting down...`);

    // Stop accepting new channels
    stopCleanupTimer();

    // Close all WS connections and clear channels
    shutdownAll();

    // Close both servers in parallel, then exit
    const closeWS = new Promise<void>((resolve) => {
      wss.close(() => {
        logger.info('server_shutdown', 'WebSocket server closed');
        resolve();
      });
    });

    const closeHTTP = new Promise<void>((resolve) => {
      httpServer.close(() => {
        logger.info('server_shutdown', 'HTTP server closed');
        resolve();
      });
    });

    Promise.all([closeWS, closeHTTP]).then(() => {
      logger.info('server_shutdown', 'All servers closed, exiting');
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
