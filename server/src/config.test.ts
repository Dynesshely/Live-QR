import { describe, it, expect } from 'vitest';
import { appConfigSchema } from './config.js';

describe('appConfigSchema', () => {
  it('provides defaults for all fields', () => {
    const result = appConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PORT_HTTP).toBe(41601);
      expect(result.data.PORT_WS).toBe(41602);
      expect(result.data.CHANNEL_TTL_SECONDS).toBe(1800);
      expect(result.data.CLEANUP_INTERVAL_SECONDS).toBe(60);
      expect(result.data.UPLOAD_RATE_LIMIT).toBe(2);
      expect(result.data.MAX_VIEWERS_PER_CHANNEL).toBe(50);
      expect(result.data.VERIFY_RATE_LIMIT).toBe(10);
      expect(result.data.MAX_TEXT_LENGTH).toBe(2000);
    }
  });

  it('coerces string values to numbers', () => {
    const result = appConfigSchema.safeParse({ PORT_HTTP: '9999' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PORT_HTTP).toBe(9999);
    }
  });

  it('rejects out-of-range port numbers', () => {
    const result = appConfigSchema.safeParse({ PORT_HTTP: '99999' });
    expect(result.success).toBe(false);
  });

  it('rejects non-numeric string values', () => {
    const result = appConfigSchema.safeParse({ PORT_HTTP: 'abc' });
    expect(result.success).toBe(false);
  });

  it('accepts valid custom values', () => {
    const result = appConfigSchema.safeParse({
      PORT_HTTP: '3000',
      CHANNEL_TTL_SECONDS: '3600',
      MAX_TEXT_LENGTH: '500',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PORT_HTTP).toBe(3000);
      expect(result.data.CHANNEL_TTL_SECONDS).toBe(3600);
      expect(result.data.MAX_TEXT_LENGTH).toBe(500);
      // others remain default
      expect(result.data.PORT_WS).toBe(41602);
    }
  });
});
