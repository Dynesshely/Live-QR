import { describe, it, expect, afterEach, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { createServers, type LiveQRServers } from './server.js';
import { isDirectRun } from './index.js';
import { createChannel } from './services/channelStore.js';
import { mockConfig } from './testing/mocks.js';

const open: LiveQRServers[] = [];

function track(servers: LiveQRServers): LiveQRServers {
  open.push(servers);
  return servers;
}

afterEach(async () => {
  for (const servers of open.splice(0)) {
    await servers.close();
  }
});

describe('createServers', () => {
  it('does not bind any port until start() is called', () => {
    const servers = track(createServers(mockConfig({ PORT_HTTP: 0, PORT_WS: 0 }), { onFatal: vi.fn() }));

    expect(servers.httpServer.listening).toBe(false);
    expect(servers.wsHttpServer.listening).toBe(false);
    expect(servers.httpServer.address()).toBeNull();
  });

  it('starts HTTP and WS listeners on separate ephemeral ports', async () => {
    const servers = track(createServers(mockConfig({ PORT_HTTP: 0, PORT_WS: 0 }), { onFatal: vi.fn() }));

    const ports = await servers.start();

    expect(ports.httpPort).toBeGreaterThan(0);
    expect(ports.wsPort).toBeGreaterThan(0);
    expect(ports.httpPort).not.toBe(ports.wsPort);
    expect(servers.httpServer.listening).toBe(true);
    expect(servers.wsHttpServer.listening).toBe(true);
  });

  it('serves the health endpoint on the HTTP port', async () => {
    const servers = track(createServers(mockConfig({ PORT_HTTP: 0, PORT_WS: 0 }), { onFatal: vi.fn() }));
    const { httpPort } = await servers.start();

    const res = await fetch('http://127.0.0.1:' + httpPort + '/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('closes connected WS clients with 1012 (restart) before tearing the listeners down', async () => {
    const config = mockConfig({ PORT_HTTP: 0, PORT_WS: 0 });
    const servers = track(createServers(config, { onFatal: vi.fn() }));
    const { wsPort } = await servers.start();

    const ch = createChannel(config);
    const ws = new WebSocket('ws://127.0.0.1:' + wsPort + '/ws?shareCode=' + ch.shareCode);

    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', (err: Error) => reject(err));
    });
    const closeCode = new Promise<number>((resolve) => {
      ws.once('close', (code: number) => resolve(code));
    });

    await servers.close();

    // 1012 (Service Restart) 而不是 1001：1001 表示通道本身消失，前端不会重连
    expect(await closeCode).toBe(1012);
    expect(servers.wss.clients.size).toBe(0);
  });

  it('closes both listeners (and is idempotent)', async () => {
    const servers = track(createServers(mockConfig({ PORT_HTTP: 0, PORT_WS: 0 }), { onFatal: vi.fn() }));
    await servers.start();

    await servers.close();
    await servers.close();

    expect(servers.httpServer.listening).toBe(false);
    expect(servers.wsHttpServer.listening).toBe(false);
    expect(servers.wss.clients.size).toBe(0);
  });

  it('does not let a client keep the HTTP server open on close', async () => {
    const servers = track(createServers(mockConfig({ PORT_HTTP: 0, PORT_WS: 0 }), { onFatal: vi.fn() }));
    const { httpPort } = await servers.start();

    // Keep-alive connection that is left idle on purpose.
    await fetch('http://127.0.0.1:' + httpPort + '/api/health');

    const closed = servers.close();
    await expect(closed).resolves.toBeUndefined();
  });

  it('rejects start() and reports a fatal error when the HTTP port is taken', async () => {
    const first = track(createServers(mockConfig({ PORT_HTTP: 0, PORT_WS: 0 }), { onFatal: vi.fn() }));
    const firstPorts = await first.start();

    const onFatal = vi.fn();
    const second = track(
      createServers(
        mockConfig({ PORT_HTTP: firstPorts.httpPort, PORT_WS: 0 }),
        { onFatal },
      ),
    );

    await expect(second.start()).rejects.toMatchObject({ code: 'EADDRINUSE' });
    expect(onFatal).toHaveBeenCalledTimes(1);
  });
});

describe('index entry detection', () => {
  it('recognises the real entry point path', () => {
    const indexPath = fileURLToPath(new URL('./index.ts', import.meta.url));
    expect(isDirectRun(indexPath)).toBe(true);
  });

  it('returns false for a missing entry', () => {
    expect(isDirectRun(undefined)).toBe(false);
    expect(isDirectRun('/definitely/not/here.js')).toBe(false);
  });

  it('returns false when another module is the entry point (tests)', () => {
    expect(isDirectRun(process.argv[1])).toBe(false);
  });
});
