import { describe, it, expect, afterEach, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { createServers, type LiveQRServers } from './server.js';
import { isDirectRun } from './index.js';
import { createChannel } from './services/channelStore.js';
import { mockConfig } from './testing/mocks.js';

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'liveqr-server-audit-'));
  tempDirs.push(dir);
  return dir;
}

interface JsonLine {
  [key: string]: unknown;
}

async function readAuditLines(file: string): Promise<JsonLine[]> {
  const raw = await readFile(file, 'utf8');
  return raw
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as JsonLine);
}

afterEach(async () => {
  while (tempDirs.length > 0) {
    await rm(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

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

describe('audit log lifecycle', () => {
  it('writes audit_started on start and flushes uploads on close', async () => {
    const auditDir = join(await makeTempDir(), 'logs');
    const config = mockConfig({
      PORT_HTTP: 0,
      PORT_WS: 0,
      AUDIT_LOG_ENABLED: true,
      AUDIT_LOG_DIR: auditDir,
      AUDIT_LOG_RETENTION_DAYS: 243,
    });
    const servers = track(createServers(config, { onFatal: vi.fn() }));
    expect(servers.audit).toBeDefined();

    const { httpPort } = await servers.start();

    const createRes = await fetch('http://127.0.0.1:' + httpPort + '/api/channel/create', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    const created = (await createRes.json()) as { data: { shareCode: string } };

    await fetch('http://127.0.0.1:' + httpPort + '/api/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'e2e-uploader' },
      body: JSON.stringify({ shareCode: created.data.shareCode, text: 'audited text' }),
    });

    await servers.close();

    const dateKey = new Date().toISOString().slice(0, 10);
    const lines = await readAuditLines(join(auditDir, 'transfer-' + dateKey + '.jsonl'));

    expect(lines[0]).toMatchObject({
      type: 'audit_started',
      dir: auditDir,
      retentionDays: 243,
    });

    const upload = lines.find((line) => line.type === 'upload');
    expect(upload).toMatchObject({
      type: 'upload',
      shareCode: created.data.shareCode,
      uploaderUa: 'e2e-uploader',
      text: 'audited text',
      recipients: [],
    });
    expect(upload?.uploaderIp).toBe('127.0.0.1');
  });

  it('records WS viewer connect/disconnect and flushes them on close', async () => {
    const auditDir = join(await makeTempDir(), 'logs');
    const config = mockConfig({
      PORT_HTTP: 0,
      PORT_WS: 0,
      AUDIT_LOG_ENABLED: true,
      AUDIT_LOG_DIR: auditDir,
    });
    const servers = track(createServers(config, { onFatal: vi.fn() }));
    const { wsPort } = await servers.start();

    const ch = createChannel(config);
    const ws = new WebSocket('ws://127.0.0.1:' + wsPort + '/ws?shareCode=' + ch.shareCode, {
      headers: { 'user-agent': 'e2e-viewer' },
    });
    await new Promise<void>((resolve, reject) => {
      ws.once('open', () => resolve());
      ws.once('error', (err: Error) => reject(err));
    });

    await servers.close();

    const dateKey = new Date().toISOString().slice(0, 10);
    const lines = await readAuditLines(join(auditDir, 'transfer-' + dateKey + '.jsonl'));

    expect(lines.find((line) => line.type === 'viewer_connect')).toMatchObject({
      shareCode: ch.shareCode,
      ip: '127.0.0.1',
      ua: 'e2e-viewer',
    });
    const disconnect = lines.find((line) => line.type === 'viewer_disconnect');
    expect(disconnect).toMatchObject({ shareCode: ch.shareCode, ip: '127.0.0.1' });
    expect(typeof disconnect?.durationMs).toBe('number');
  });

  it('does not create a directory or a record when AUDIT_LOG_ENABLED=false', async () => {
    const auditDir = join(await makeTempDir(), 'logs');
    const config = mockConfig({
      PORT_HTTP: 0,
      PORT_WS: 0,
      AUDIT_LOG_ENABLED: false,
      AUDIT_LOG_DIR: auditDir,
    });
    const servers = track(createServers(config, { onFatal: vi.fn() }));

    expect(servers.audit).toBeUndefined();

    await servers.start();
    await servers.close();

    expect(existsSync(auditDir)).toBe(false);
  });

  it('starts and serves requests even when the audit directory cannot be created', async () => {
    const root = await makeTempDir();
    const blockedParent = join(root, 'blocked');
    await mkdir(blockedParent, { recursive: true });
    await chmod(blockedParent, 0o500);

    try {
      const config = mockConfig({
        PORT_HTTP: 0,
        PORT_WS: 0,
        AUDIT_LOG_ENABLED: true,
        AUDIT_LOG_DIR: join(blockedParent, 'logs'),
      });
      const servers = track(createServers(config, { onFatal: vi.fn() }));

      const { httpPort } = await servers.start();

      // Audit failed, but requests are unaffected: that is the priority.
      const res = await fetch('http://127.0.0.1:' + httpPort + '/api/health');
      expect(res.status).toBe(200);
    } finally {
      await chmod(blockedParent, 0o700).catch(() => {});
    }
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
