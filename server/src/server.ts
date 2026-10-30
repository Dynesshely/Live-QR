import { createServer, type Server as HttpServer } from 'node:http';
import type express from 'express';
import type { WebSocketServer } from 'ws';
import type { AppConfig } from './types.js';
import { createApp } from './app.js';
import { attachWebSocketServer, createWSServer } from './ws/handler.js';
import { startCleanupTimer, stopCleanupTimer, shutdownAll } from './services/channelStore.js';
import { createAuditLog, type AuditLog } from './services/auditLog.js';
import { loadConfig } from './config.js';
import { logger } from './logger.js';

/** Force-exit guard for shutdown(). */
const SHUTDOWN_TIMEOUT_MS = 10_000;

/** Fallback for socket close: terminate clients that never answer a close frame. */
const WS_CLOSE_FALLBACK_MS = 2_000;

export interface ServerDeps {
  /** Called on any server-level error (EADDRINUSE, ...). Default: log + exit(1). */
  onFatal?: (err: Error) => void;
}

export interface OpenedPorts {
  httpPort: number;
  wsPort: number;
}

export interface LiveQRServers {
  readonly config: AppConfig;
  readonly app: express.Application;
  readonly httpServer: HttpServer;
  readonly wsHttpServer: HttpServer;
  readonly wss: WebSocketServer;
  /** On-disk audit trail; undefined when AUDIT_LOG_ENABLED=false. */
  readonly audit?: AuditLog;
  start(): Promise<OpenedPorts>;
  close(): Promise<void>;
}

export function defaultOnFatal(err: Error): void {
  const code = (err as NodeJS.ErrnoException).code;
  logger.error('server_error', 'Fatal server error: ' + (code ? code + ' ' : '') + err.message);
  process.exit(1);
}

function listen(server: HttpServer, port: number): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const onError = (err: Error): void => {
      server.off('listening', onListening);
      reject(err);
    };

    const onListening = (): void => {
      server.off('error', onError);
      const address = server.address();
      resolve(typeof address === 'object' && address !== null ? address.port : port);
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port);
  });
}

function closeHttpServer(server: HttpServer): Promise<void> {
  return new Promise<void>((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }

    server.close(() => resolve());
    // Drop keep-alive connections so shutdown cannot hang on an idle client.
    server.closeAllConnections();
  });
}

function closeWSServer(wss: WebSocketServer): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(fallback);
      resolve();
    };

    const fallback = setTimeout(() => {
      for (const client of wss.clients) client.terminate();
    }, WS_CLOSE_FALLBACK_MS);
    fallback.unref();

    wss.close(finish);
  });
}

/**
 * Create both servers without touching a port, a timer or a signal handler.
 * `start()` does the side effects; this keeps the factory usable from tests.
 */
export function createServers(config: AppConfig, deps: ServerDeps = {}): LiveQRServers {
  const onFatal = deps.onFatal ?? defaultOnFatal;

  // Disabled means fully disabled: no directory, no writes, no timers.
  const audit = config.AUDIT_LOG_ENABLED
    ? createAuditLog({
        dir: config.AUDIT_LOG_DIR,
        retentionDays: config.AUDIT_LOG_RETENTION_DAYS,
      })
    : undefined;

  const app = createApp(config, { audit });
  const httpServer = createServer(app);
  const wsHttpServer = createServer();
  const wss = createWSServer(config, { audit });

  attachWebSocketServer(wss, wsHttpServer);

  httpServer.on('error', onFatal);
  wsHttpServer.on('error', onFatal);
  wss.on('error', onFatal);

  let started = false;
  let closed = false;

  async function start(): Promise<OpenedPorts> {
    if (started) throw new Error('servers already started');
    started = true;

    // Directory + audit_started + one retention purge, before the first
    // request can be served. init() never throws (an unwritable dir only
    // degrades auditing).
    await audit?.init();

    const httpPort = await listen(httpServer, config.PORT_HTTP);
    const wsPort = await listen(wsHttpServer, config.PORT_WS);

    startCleanupTimer(config);

    // Logged only once both listeners are actually up.
    logger.info('server_start', 'HTTP API server listening on port ' + httpPort);
    logger.info('server_start', 'WebSocket server listening on port ' + wsPort);

    return { httpPort, wsPort };
  }

  async function close(): Promise<void> {
    if (closed) return;
    closed = true;

    stopCleanupTimer();
    shutdownAll();

    await Promise.all([
      closeWSServer(wss),
      closeHttpServer(wsHttpServer),
      closeHttpServer(httpServer),
    ]);

    // Flush only after every socket is gone, so the viewer_disconnect records
    // of the closing clients are already queued.
    await audit?.close();

    logger.info('server_shutdown', 'All servers closed');
  }

  return { config, app, httpServer, wsHttpServer, wss, audit, start, close };
}

export interface StartedServer extends LiveQRServers {
  ports: OpenedPorts;
}

/** Full boot: load config, bind ports, register signal handlers. */
export async function start(deps: ServerDeps = {}): Promise<StartedServer> {
  const config = loadConfig();
  const servers = createServers(config, deps);

  logger.info('server_start', 'Starting Live-QR server with config: ' + JSON.stringify(config));

  const ports = await servers.start();
  installSignalHandlers(servers);

  return Object.assign(servers, { ports });
}

/**
 * Register SIGTERM/SIGINT handlers. Only called from start() so that importing
 * the module (or a test creating servers directly) never touches the process.
 */
export function installSignalHandlers(servers: LiveQRServers): void {
  let shuttingDown = false;

  function shutdown(signal: string): void {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info('server_shutdown', 'Received ' + signal + ', shutting down...');

    servers
      .close()
      .then(() => {
        logger.info('server_shutdown', 'All servers closed, exiting');
        process.exit(0);
      })
      .catch((err: unknown) => {
        logger.error(
          'server_shutdown',
          'Shutdown failed: ' + (err instanceof Error ? err.message : String(err)),
        );
        process.exit(1);
      });

    // Force exit after 10s
    setTimeout(() => {
      logger.error('server_shutdown', 'Forced exit after timeout');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS).unref();
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}
