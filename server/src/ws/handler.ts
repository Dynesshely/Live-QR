import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import type { AppConfig, ClientMessage } from '../types.js';
import {
  channelExists,
  getViewerCount,
  addClient,
  removeClient,
} from '../services/channelStore.js';
import { logger } from '../logger.js';

// Per-connection heartbeat tracking
interface AliveWS extends WebSocket {
  isAlive: boolean;
  lastPong: number;
  heartbeatTimer?: ReturnType<typeof setInterval>;
  noMessageTimer?: ReturnType<typeof setTimeout>;
  shareCode?: string;
}

export function createWSServer(config: AppConfig): WebSocketServer {
  const wss = new WebSocketServer({
    port: config.PORT_WS,
    // verifyClient only validates shareCode format
    verifyClient(info: { req: IncomingMessage; origin: string; secure: boolean }, cb: (res: boolean, code?: number, message?: string, headers?: Record<string, string>) => void) {
      const url = new URL(info.req.url || '/', `http://${info.req.headers.host || 'localhost'}`);
      const shareCode = url.searchParams.get('shareCode');

      if (!shareCode) {
        logger.warn('ws_rejected', 'WS rejected: missing shareCode');
        cb(false, 400, 'CHANNEL_NOT_FOUND');
        return;
      }

      cb(true);
    },
  });

  wss.on('connection', (ws: AliveWS, req: IncomingMessage) => {
    // Parse shareCode from URL (already validated in verifyClient)
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const shareCode = url.searchParams.get('shareCode');

    if (!shareCode) {
      ws.close(4001, 'CHANNEL_NOT_FOUND');
      return;
    }

    // Check channel existence (may have expired between verify and WS connect)
    if (!channelExists(shareCode)) {
      logger.warn('ws_rejected', `WS rejected: channel not found`, shareCode);
      ws.close(4001, 'CHANNEL_NOT_FOUND');
      return;
    }

    // Check viewer limit
    if (getViewerCount(shareCode) >= config.MAX_VIEWERS_PER_CHANNEL) {
      logger.warn('ws_rejected', `WS rejected: too many viewers`, shareCode);
      ws.close(4002, 'TOO_MANY_VIEWERS');
      return;
    }

    // Track connection state
    ws.isAlive = true;
    ws.lastPong = Date.now();
    ws.shareCode = shareCode;

    // Register client (sends welcome + history)
    addClient(shareCode, ws);

    // Handle incoming messages
    ws.on('message', (data: Buffer) => {
      try {
        const msg: ClientMessage = JSON.parse(data.toString());

        if (msg.type === 'pong') {
          ws.isAlive = true;
          ws.lastPong = Date.now();
        }
        // All other message types are ignored
      } catch {
        // Ignore invalid JSON
      }
    });

    // Heartbeat: send every 30s, check stale
    ws.heartbeatTimer = setInterval(() => {
      if (!ws.isAlive) {
        // 3 * 30s = 90s without pong
        clearInterval(ws.heartbeatTimer);
        ws.terminate();
        return;
      }

      ws.isAlive = false;
      ws.send(JSON.stringify({ type: 'heartbeat', serverTime: Date.now() }));
    }, 30_000);

    // Reset the no-message timeout on every heartbeat send
    function resetNoMessageTimer() {
      if (ws.noMessageTimer) clearTimeout(ws.noMessageTimer);
      ws.noMessageTimer = setTimeout(() => {
        // No message received in 60s — assume dead
        ws.terminate();
      }, 60_000);
    }
    resetNoMessageTimer();

    ws.on('message', () => resetNoMessageTimer());

    // Cleanup on close
    ws.on('close', () => {
      if (ws.shareCode) {
        removeClient(ws.shareCode, ws);
      }
      if (ws.heartbeatTimer) clearInterval(ws.heartbeatTimer);
      if (ws.noMessageTimer) clearTimeout(ws.noMessageTimer);
    });

    ws.on('error', (err) => {
      logger.error('ws_disconnected', `WebSocket error: ${err.message}`, shareCode);
    });
  });

  logger.info('server_start', `WebSocket server started on port ${config.PORT_WS}`);

  return wss;
}
