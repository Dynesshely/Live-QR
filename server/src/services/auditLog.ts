import { appendFile, chmod, mkdir, readdir, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { logger } from '../logger.js';
import type {
  AuditRecord,
  AuditRetentionPurgeRecord,
  AuditStartedRecord,
  AuditUploadRecord,
  AuditViewerConnectRecord,
  AuditViewerDisconnectRecord,
} from '../types.js';

/**
 * On-disk audit trail (compliance).
 *
 * - one JSON object per line, appended to `<dir>/transfer-YYYY-MM-DD.jsonl`
 *   (UTC date, so a day boundary is deterministic regardless of the host TZ);
 * - directory 0700, files 0600;
 * - retained for `retentionDays`; anything strictly older than
 *   `today - retentionDays` is deleted at startup and on every day rollover;
 * - **writing must never break a request**: every public record method is
 *   fire-and-forget, all failures are swallowed after being reported to
 *   stderr through the structured logger.
 *
 * Ordering: records are serialized through a single promise chain, so file
 * rollovers and purge records cannot interleave with data records.
 */

const DAILY_FILE_REGEX = /^transfer-(\d{4}-\d{2}-\d{2})\.jsonl$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface AuditUploadInput {
  shareCode: string;
  uploaderIp: string;
  uploaderUa: string;
  text: string;
  recipients: Array<{ ip: string; ua: string }>;
}

export interface AuditViewerConnectInput {
  shareCode: string;
  ip: string;
  ua: string;
}

export interface AuditViewerDisconnectInput {
  shareCode: string;
  ip: string;
  durationMs: number;
}

/** The subset request handlers need; keeps them decoupled from the file store. */
export interface AuditRecorder {
  recordUpload(input: AuditUploadInput): void;
  recordViewerConnect(input: AuditViewerConnectInput): void;
  recordViewerDisconnect(input: AuditViewerDisconnectInput): void;
}

export interface AuditLogOptions {
  dir: string;
  retentionDays: number;
  /** Injectable clock (tests). */
  now?: () => number;
  /** Injectable error sink (tests); defaults to the structured logger. */
  onError?: (error: unknown, context: string) => void;
}

export interface AuditLog extends AuditRecorder {
  /** Absolute directory the records are written to. */
  readonly dir: string;
  readonly retentionDays: number;
  /** Create the directory, write `audit_started` and run one retention purge. */
  init(): Promise<void>;
  /** Stop accepting records and flush everything already queued. */
  close(): Promise<void>;
}

/** YYYY-MM-DD in UTC. */
export function auditDateKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function auditFileName(dateKey: string): string {
  return `transfer-${dateKey}.jsonl`;
}

export function shiftAuditDateKey(dateKey: string, days: number): string {
  const base = Date.parse(dateKey + 'T00:00:00.000Z');
  return auditDateKey(base + days * DAY_MS);
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Run an audit write without ever letting it affect the caller. AuditLog's own
 * methods already swallow their failures; this guards against a custom
 * recorder (or a future refactor) throwing into a request handler.
 */
export function tryRecord(write: () => void): void {
  try {
    write();
  } catch {
    // Auditing is best-effort: request handling always wins.
  }
}

export function createAuditLog(options: AuditLogOptions): AuditLog {
  const dir = resolve(options.dir);
  const retentionDays = options.retentionDays;
  const now = options.now ?? ((): number => Date.now());
  const onError =
    options.onError ??
    ((error: unknown, context: string): void => {
      logger.error('audit_write_failed', 'Audit ' + context + ' failed: ' + describeError(error));
    });

  let initialized = false;
  let closed = false;
  let currentDate: string | null = null;
  let queue: Promise<void> = Promise.resolve();

  function report(error: unknown, context: string): void {
    try {
      onError(error, context);
    } catch {
      // An error sink that throws must not break the caller either.
    }
  }

  async function appendRecord(dateKey: string, record: AuditRecord): Promise<void> {
    await appendFile(join(dir, auditFileName(dateKey)), JSON.stringify(record) + '\n', {
      mode: 0o600,
    });
  }

  /**
   * Delete daily files older than the retention cutoff, then record the purge.
   * A file exactly `retentionDays` old is kept; `retentionDays + 1` is removed.
   */
  async function purgeExpired(): Promise<AuditRetentionPurgeRecord> {
    const at = now();
    const today = auditDateKey(at);
    const cutoff = shiftAuditDateKey(today, -retentionDays);
    const deleted: string[] = [];

    for (const name of await readdir(dir)) {
      const match = DAILY_FILE_REGEX.exec(name);
      if (!match) continue;
      if (match[1] >= cutoff) continue;

      try {
        await unlink(join(dir, name));
        deleted.push(name);
        logger.info('audit_purge', 'Removed expired audit file ' + name);
      } catch (error) {
        report(error, 'purge');
      }
    }

    const record: AuditRetentionPurgeRecord = {
      type: 'retention_purge',
      ts: new Date(at).toISOString(),
      cutoff,
      deleted,
    };
    await appendRecord(today, record);

    return record;
  }

  function enqueueRecord(record: AuditRecord): void {
    if (closed) return;

    // Partition by the event timestamp, not by the moment the write happens.
    const date = record.ts.slice(0, 10);

    queue = queue
      .then(async () => {
        const rotated = currentDate !== null && currentDate !== date;
        currentDate = date;

        await appendRecord(date, record);

        if (rotated) {
          // A new day started: enforce retention immediately.
          await purgeExpired();
        }
      })
      .catch((error: unknown) => report(error, 'write'));
  }

  async function init(): Promise<void> {
    if (initialized) return;
    initialized = true;

    try {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      // mkdir's mode only applies when the directory is created; enforce 0700
      // for a pre-existing directory too (best effort: a volume owned by
      // someone else may refuse, which only degrades auditing).
      await chmod(dir, 0o700);

      const at = now();
      const today = auditDateKey(at);
      currentDate = today;

      const started: AuditStartedRecord = {
        type: 'audit_started',
        ts: new Date(at).toISOString(),
        dir,
        retentionDays,
      };
      await appendRecord(today, started);
      await purgeExpired();
    } catch (error) {
      // An unwritable audit directory degrades auditing but must not stop the
      // service (priority #1: never affect requests).
      report(error, 'init');
    }
  }

  async function close(): Promise<void> {
    closed = true;
    try {
      await queue;
    } catch {
      // enqueueRecord already reports failures; nothing else to do on close.
    }
  }

  return {
    dir,
    retentionDays,
    init,
    close,

    recordUpload(input: AuditUploadInput): void {
      try {
        const record: AuditUploadRecord = {
          type: 'upload',
          ts: new Date(now()).toISOString(),
          shareCode: input.shareCode,
          uploaderIp: input.uploaderIp,
          uploaderUa: input.uploaderUa,
          // Exact text that was broadcast: never trimmed or truncated here.
          text: input.text,
          textLength: [...input.text].length,
          recipients: input.recipients.map((recipient) => ({
            ip: recipient.ip,
            ua: recipient.ua,
          })),
        };
        enqueueRecord(record);
      } catch (error) {
        report(error, 'upload');
      }
    },

    recordViewerConnect(input: AuditViewerConnectInput): void {
      try {
        const record: AuditViewerConnectRecord = {
          type: 'viewer_connect',
          ts: new Date(now()).toISOString(),
          shareCode: input.shareCode,
          ip: input.ip,
          ua: input.ua,
        };
        enqueueRecord(record);
      } catch (error) {
        report(error, 'viewer_connect');
      }
    },

    recordViewerDisconnect(input: AuditViewerDisconnectInput): void {
      try {
        const record: AuditViewerDisconnectRecord = {
          type: 'viewer_disconnect',
          ts: new Date(now()).toISOString(),
          shareCode: input.shareCode,
          ip: input.ip,
          durationMs: Math.max(0, Math.round(input.durationMs)),
        };
        enqueueRecord(record);
      } catch (error) {
        report(error, 'viewer_disconnect');
      }
    },
  };
}
