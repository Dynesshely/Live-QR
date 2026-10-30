import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { start } from './server.js';
import { logger } from './logger.js';

/**
 * True when this module is the process entry point. Node (and tsx) always
 * resolve argv[1] to an absolute path, so comparing real paths is reliable;
 * importing this module from a test therefore has no side effects.
 */
export function isDirectRun(entry: string | undefined = process.argv[1]): boolean {
  if (!entry) return false;

  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

export { createServers } from './server.js';
export { start };

if (isDirectRun()) {
  start().catch((err: unknown) => {
    logger.error('server_error', 'Failed to start: ' + (err instanceof Error ? err.message : String(err)));
    process.exit(1);
  });
}
