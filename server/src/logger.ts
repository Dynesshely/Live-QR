import type { LogEntry, LogEvent } from './types.js';

type Level = LogEntry['level'];

function write(level: Level, entry: LogEntry): void {
  const line = JSON.stringify(entry);
  if (level === 'error') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

function log(
  level: Level,
  event: LogEvent,
  message: string,
  shareCode?: string,
  clientIp?: string,
): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    message,
  };
  if (shareCode) entry.shareCode = shareCode;
  if (clientIp) entry.clientIp = clientIp;
  write(level, entry);
}

export interface AccessLogFields {
  method: string;
  path: string;
  status: number;
  durationMs: number;
  clientIp?: string;
  userAgent?: string;
}

export const logger = {
  debug(event: LogEvent, message: string, shareCode?: string, clientIp?: string): void {
    log('debug', event, message, shareCode, clientIp);
  },
  info(event: LogEvent, message: string, shareCode?: string, clientIp?: string): void {
    log('info', event, message, shareCode, clientIp);
  },
  warn(event: LogEvent, message: string, shareCode?: string, clientIp?: string): void {
    log('warn', event, message, shareCode, clientIp);
  },
  error(event: LogEvent, message: string, shareCode?: string, clientIp?: string): void {
    log('error', event, message, shareCode, clientIp);
  },
  /**
   * Compliance access log: one JSON line per request. Never contains request
   * bodies or uploaded text — only transport metadata.
   */
  access(fields: AccessLogFields): void {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level: 'info',
      event: 'access',
      message: `${fields.method} ${fields.path} ${fields.status}`,
      method: fields.method,
      path: fields.path,
      status: fields.status,
      durationMs: Math.round(fields.durationMs),
    };
    if (fields.clientIp) entry.clientIp = fields.clientIp;
    if (fields.userAgent) entry.userAgent = fields.userAgent.slice(0, 200);
    write('info', entry);
  },
};
