import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  auditDateKey,
  auditFileName,
  createAuditLog,
  shiftAuditDateKey,
} from './auditLog.js';
import type { AuditUploadInput } from './auditLog.js';

const DAY1 = Date.parse('2026-01-10T12:00:00.000Z');
const DAY1_KEY = '2026-01-10';

let root: string;
let dir: string;
let nowMs: number;

const clock = (): number => nowMs;

function uploadInput(overrides: Partial<AuditUploadInput> = {}): AuditUploadInput {
  return {
    shareCode: '12345678',
    uploaderIp: '203.0.113.7',
    uploaderUa: 'uploader-ua',
    text: 'hello',
    recipients: [],
    ...overrides,
  };
}

async function readRecords(dateKey: string): Promise<Array<Record<string, unknown>>> {
  const raw = await readFile(join(dir, auditFileName(dateKey)), 'utf8');
  return raw
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'liveqr-audit-'));
  dir = join(root, 'audit');
  nowMs = DAY1;
});

afterEach(async () => {
  // Restore permissions first, otherwise rm may fail on read-only fixtures.
  await chmod(root, 0o700).catch(() => {});
  await chmod(dir, 0o700).catch(() => {});
  await rm(root, { recursive: true, force: true });
});

describe('date helpers', () => {
  it('keys days in UTC', () => {
    expect(auditDateKey(Date.parse('2026-01-10T23:59:59.999Z'))).toBe('2026-01-10');
    expect(auditDateKey(Date.parse('2026-01-11T00:00:00.000Z'))).toBe('2026-01-11');
    expect(auditFileName('2026-01-10')).toBe('transfer-2026-01-10.jsonl');
  });

  it('shifts day keys across month/year/leap boundaries', () => {
    expect(shiftAuditDateKey('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftAuditDateKey('2024-03-01', -1)).toBe('2024-02-29');
    expect(shiftAuditDateKey('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftAuditDateKey('2026-01-10', -243)).toBe('2025-05-12');
  });
});

describe('init', () => {
  it('creates the directory (0700), writes audit_started and runs a purge', async () => {
    const log = createAuditLog({ dir, retentionDays: 243, now: clock });
    await log.init();
    await log.close();

    const dirStat = await stat(dir);
    expect(dirStat.isDirectory()).toBe(true);
    expect(dirStat.mode & 0o777).toBe(0o700);

    const fileStat = await stat(join(dir, auditFileName(DAY1_KEY)));
    expect(fileStat.mode & 0o777).toBe(0o600);

    const records = await readRecords(DAY1_KEY);
    expect(records[0]).toEqual({
      type: 'audit_started',
      ts: '2026-01-10T12:00:00.000Z',
      dir,
      retentionDays: 243,
    });
    expect(records[1]).toEqual({
      type: 'retention_purge',
      ts: '2026-01-10T12:00:00.000Z',
      cutoff: '2025-05-12',
      deleted: [],
    });
  });

  it('tightens an existing directory to 0700', async () => {
    await mkdir(dir, { recursive: true, mode: 0o755 });
    await chmod(dir, 0o755);

    const log = createAuditLog({ dir, retentionDays: 3, now: clock });
    await log.init();
    await log.close();

    expect((await stat(dir)).mode & 0o777).toBe(0o700);
  });

  it('does not throw when the directory cannot be created', async () => {
    const onError = vi.fn();
    const blockedParent = await mkdtemp(join(tmpdir(), 'liveqr-audit-ro-'));
    await chmod(blockedParent, 0o500);

    try {
      const log = createAuditLog({
        dir: join(blockedParent, 'nested'),
        retentionDays: 3,
        now: clock,
        onError,
      });

      await expect(log.init()).resolves.toBeUndefined();
      await expect(log.close()).resolves.toBeUndefined();
      expect(onError).toHaveBeenCalled();
    } finally {
      await chmod(blockedParent, 0o700).catch(() => {});
      await rm(blockedParent, { recursive: true, force: true });
    }
  });
});

describe('records', () => {
  it('writes an upload record with the exact text and full field set', async () => {
    const log = createAuditLog({ dir, retentionDays: 243, now: clock });
    await log.init();

    const text = '  hello\nworld \u{1F600} "quoted"  ';
    log.recordUpload(
      uploadInput({
        text,
        recipients: [
          { ip: '198.51.100.2', ua: 'viewer-a' },
          { ip: '198.51.100.3', ua: 'viewer-b' },
        ],
      }),
    );
    await log.close();

    const upload = (await readRecords(DAY1_KEY)).find((record) => record.type === 'upload');
    expect(upload).toEqual({
      type: 'upload',
      ts: '2026-01-10T12:00:00.000Z',
      shareCode: '12345678',
      uploaderIp: '203.0.113.7',
      uploaderUa: 'uploader-ua',
      text, // byte-for-byte the text that was broadcast
      textLength: [...text].length,
      recipients: [
        { ip: '198.51.100.2', ua: 'viewer-a' },
        { ip: '198.51.100.3', ua: 'viewer-b' },
      ],
    });
  });

  it('writes viewer_connect and viewer_disconnect records', async () => {
    const log = createAuditLog({ dir, retentionDays: 243, now: clock });
    await log.init();

    log.recordViewerConnect({ shareCode: '12345678', ip: '198.51.100.2', ua: 'viewer-ua' });
    nowMs += 12_345;
    log.recordViewerDisconnect({ shareCode: '12345678', ip: '198.51.100.2', durationMs: 12_345 });
    await log.close();

    const records = await readRecords(DAY1_KEY);
    const connect = records.find((record) => record.type === 'viewer_connect');
    const disconnect = records.find((record) => record.type === 'viewer_disconnect');

    expect(connect).toEqual({
      type: 'viewer_connect',
      ts: '2026-01-10T12:00:00.000Z',
      shareCode: '12345678',
      ip: '198.51.100.2',
      ua: 'viewer-ua',
    });
    expect(disconnect).toEqual({
      type: 'viewer_disconnect',
      ts: '2026-01-10T12:00:12.345Z',
      shareCode: '12345678',
      ip: '198.51.100.2',
      durationMs: 12_345,
    });
  });

  it('flushes every queued record on close, in order', async () => {
    const log = createAuditLog({ dir, retentionDays: 243, now: clock });
    await log.init();

    for (let index = 0; index < 5; index++) {
      log.recordUpload(uploadInput({ text: 'text-' + index }));
    }
    await log.close();

    const texts = (await readRecords(DAY1_KEY))
      .filter((record) => record.type === 'upload')
      .map((record) => record.text);
    expect(texts).toEqual(['text-0', 'text-1', 'text-2', 'text-3', 'text-4']);
  });

  it('ignores records after close without throwing', async () => {
    const log = createAuditLog({ dir, retentionDays: 243, now: clock });
    await log.init();
    await log.close();

    expect(() => log.recordUpload(uploadInput())).not.toThrow();
    expect(() => log.recordViewerConnect({ shareCode: '12345678', ip: 'x', ua: 'y' })).not.toThrow();
    expect(() => log.recordViewerDisconnect({ shareCode: '12345678', ip: 'x', durationMs: 1 })).not.toThrow();
  });
});

describe('retention', () => {
  it('keeps a file exactly N days old and deletes N+1 days old', async () => {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, auditFileName('2026-01-07')), '{"type":"upload"}\n');
    await writeFile(join(dir, auditFileName('2026-01-06')), '{"type":"upload"}\n');
    await writeFile(join(dir, 'notes.txt'), 'keep me\n');

    const log = createAuditLog({ dir, retentionDays: 3, now: clock });
    await log.init();
    await log.close();

    expect(existsSync(join(dir, auditFileName('2026-01-07')))).toBe(true);
    expect(existsSync(join(dir, auditFileName('2026-01-06')))).toBe(false);
    expect(existsSync(join(dir, 'notes.txt'))).toBe(true);

    const purge = (await readRecords(DAY1_KEY)).find(
      (record) => record.type === 'retention_purge',
    );
    expect(purge).toMatchObject({
      cutoff: '2026-01-07',
      deleted: ['transfer-2026-01-06.jsonl'],
    });
  });

  it('rotates to a new day file and purges immediately on rollover', async () => {
    const log = createAuditLog({ dir, retentionDays: 3, now: clock });
    await log.init();
    log.recordUpload(uploadInput({ text: 'day one' }));

    // A file that becomes too old on the next day.
    await writeFile(join(dir, auditFileName('2026-01-05')), '{"type":"upload"}\n');

    nowMs = Date.parse('2026-01-11T00:00:05.000Z');
    log.recordUpload(uploadInput({ text: 'day two' }));
    await log.close();

    expect(await readRecords('2026-01-10')).toHaveLength(3); // started + purge + upload
    expect(existsSync(join(dir, auditFileName('2026-01-05')))).toBe(false);

    const dayTwo = await readRecords('2026-01-11');
    expect(dayTwo.map((record) => record.type)).toEqual(['upload', 'retention_purge']);
    expect(dayTwo[0]).toMatchObject({ text: 'day two' });
    expect(dayTwo[1]).toMatchObject({
      cutoff: '2026-01-08',
      deleted: ['transfer-2026-01-05.jsonl'],
    });
  });
});

describe('write failures never affect the caller', () => {
  it('swallows a write error (read-only directory) and keeps the process alive', async () => {
    const onError = vi.fn();
    const log = createAuditLog({ dir, retentionDays: 3, now: clock, onError });
    await log.init();
    expect(onError).not.toHaveBeenCalled();

    await chmod(dir, 0o500);

    // Force a new file (day rollover) so the write needs directory permission.
    nowMs = Date.parse('2026-01-11T00:00:05.000Z');
    expect(() => log.recordUpload(uploadInput({ text: 'cannot be written' }))).not.toThrow();
    await expect(log.close()).resolves.toBeUndefined();

    expect(onError).toHaveBeenCalled();
    expect(existsSync(join(dir, auditFileName('2026-01-11')))).toBe(false);
  });

  it('survives an error sink that throws', async () => {
    const log = createAuditLog({
      dir,
      retentionDays: 3,
      now: clock,
      onError: () => {
        throw new Error('sink exploded');
      },
    });
    await log.init();
    await chmod(dir, 0o500);

    nowMs = Date.parse('2026-01-11T00:00:05.000Z');
    expect(() => log.recordUpload(uploadInput())).not.toThrow();
    await expect(log.close()).resolves.toBeUndefined();
  });
});
