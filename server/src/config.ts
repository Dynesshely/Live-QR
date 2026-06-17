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

export const appConfigSchema = z.object({
  PORT_HTTP:                numberFromEnv('41601', 1, 65535),
  PORT_WS:                  numberFromEnv('41602', 1, 65535),
  CHANNEL_TTL_SECONDS:      numberFromEnv('1800', 60, 86400),
  CLEANUP_INTERVAL_SECONDS: numberFromEnv('60', 10, 3600),
  UPLOAD_RATE_LIMIT:        numberFromEnv('2', 1, 100),
  MAX_VIEWERS_PER_CHANNEL:  numberFromEnv('50', 1, 500),
  VERIFY_RATE_LIMIT:        numberFromEnv('10', 1, 1000),
  MAX_TEXT_LENGTH:          numberFromEnv('2000', 1, 10000),
});

export type AppConfig = z.infer<typeof appConfigSchema>;

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
