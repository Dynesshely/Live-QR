import type { LogEntry, LogEvent } from './types.js';

function log(level: 'info' | 'warn' | 'error', event: LogEvent, message: string, shareCode?: string, clientIp?: string): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    event,
    message,
  };
  if (shareCode) entry.shareCode = shareCode;
  if (clientIp) entry.clientIp = clientIp;

  const line = JSON.stringify(entry);
  if (level === 'error') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

export const logger = {
  info(event: LogEvent, message: string, shareCode?: string, clientIp?: string) {
    log('info', event, message, shareCode, clientIp);
  },
  warn(event: LogEvent, message: string, shareCode?: string, clientIp?: string) {
    log('warn', event, message, shareCode, clientIp);
  },
  error(event: LogEvent, message: string, shareCode?: string, clientIp?: string) {
    log('error', event, message, shareCode, clientIp);
  },
};
