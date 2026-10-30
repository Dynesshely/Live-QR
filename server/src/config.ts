import 'dotenv/config';
import { z } from 'zod';

// ── Zod schema for environment variables ──
//
// Process: string → transform(Number) → pipe(number.validation)
// undefined → string.default() provides the fallback before transform

const numberFromEnv = (def: string, min: number, max: number) =>
  z.string()
    .default(def)
    .transform(Number)
    .pipe(z.number().int().min(min).max(max));

/**
 * Accepted `TRUST_PROXY` values (comma-separated lists allowed):
 * `true`, `false`, a hop count, `loopback`/`linklocal`/`uniquelocal`,
 * an IP literal or a CIDR block.
 */
const TRUST_PROXY_TOKEN =
  /^(true|false|\d+|loopback|linklocal|uniquelocal|\d{1,3}(?:\.\d{1,3}){3}(?:\/\d{1,2})?|[0-9a-fA-F:]+(?:\/\d{1,3})?)$/;

function isValidTrustProxy(value: string): boolean {
  return value
    .split(',')
    .map((token) => token.trim())
    .every((token) => TRUST_PROXY_TOKEN.test(token));
}

export const appConfigSchema = z.object({
  PORT_HTTP:                numberFromEnv('41601', 1, 65535),
  PORT_WS:                  numberFromEnv('41602', 1, 65535),
  CHANNEL_TTL_SECONDS:      numberFromEnv('1800', 60, 86400),
  CLEANUP_INTERVAL_SECONDS: numberFromEnv('60', 10, 3600),
  UPLOAD_RATE_LIMIT:        numberFromEnv('2', 1, 100),
  CREATE_RATE_LIMIT:        numberFromEnv('10', 1, 1000),
  MAX_VIEWERS_PER_CHANNEL:  numberFromEnv('50', 1, 500),
  VERIFY_RATE_LIMIT:        numberFromEnv('10', 1, 1000),
  MAX_TEXT_LENGTH:          numberFromEnv('2000', 1, 10000),
  // Express "trust proxy" setting: 'false' disables it, a number is a hop
  // count, any other accepted value is passed through as the subnet list.
  TRUST_PROXY:              z.string().default('loopback').refine(isValidTrustProxy, {
    message: 'must be false/true, a hop count, loopback/linklocal/uniquelocal or a subnet list',
  }),
  // Comma-separated Origin allow-list for the WebSocket handshake.
  // Empty (default) means same-origin only.
  WS_ALLOWED_ORIGINS:       z.string().default(''),
});

export type AppConfig = z.infer<typeof appConfigSchema>;

// ── Derived limits ──

/** Bounds accepted by `POST /api/channel/create` for `expire_seconds`. */
export const CHANNEL_EXPIRE_SECONDS_MIN = 60;
export const CHANNEL_EXPIRE_SECONDS_MAX = 7200;

/** Floor for the JSON body limit, independent of MAX_TEXT_LENGTH. */
export const MIN_JSON_BODY_LIMIT_BYTES = 16 * 1024;

/** Worst-case JSON escaping of one code point: 6 bytes (`\uXXXX`). */
const JSON_ESCAPE_WORST_CASE = 6;
const JSON_BODY_OVERHEAD_BYTES = 1024;

/**
 * `express.json({ limit })` must stay strictly above what a legal payload can
 * occupy, otherwise a large-but-valid MAX_TEXT_LENGTH value turns into a 413/500
 * before the route ever sees the text.
 */
export function jsonBodyLimitBytes(maxTextLength: number): number {
  return Math.max(
    MIN_JSON_BODY_LIMIT_BYTES,
    maxTextLength * JSON_ESCAPE_WORST_CASE + JSON_BODY_OVERHEAD_BYTES,
  );
}

/** Parse the raw TRUST_PROXY string into what `app.set('trust proxy', …)` wants. */
export function parseTrustProxy(value: string): boolean | number | string {
  const trimmed = value.trim();
  if (trimmed === 'true') return true;
  if (trimmed === 'false') return false;
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

/** Parse WS_ALLOWED_ORIGINS into a normalized list ('*' means allow any). */
export function parseAllowedOrigins(value: string): string[] {
  return value
    .split(',')
    .map((origin) => origin.trim().toLowerCase().replace(/\/+$/, ''))
    .filter((origin) => origin.length > 0);
}

// ── Load and validate ──

export function loadConfig(): AppConfig {
  const result = appConfigSchema.safeParse(process.env);

  if (!result.success) {
    console.error('❌ Invalid environment configuration:');
    for (const issue of result.error.issues) {
      const path = issue.path.join('.');
      console.error(`  - ${path}: ${issue.message}`);
    }
    process.exit(1);
  }

  return result.data;
}
