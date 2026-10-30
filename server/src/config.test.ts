import { describe, it, expect } from 'vitest';
import {
  appConfigSchema,
  jsonBodyLimitBytes,
  parseAllowedOrigins,
  parseTrustProxy,
  CHANNEL_EXPIRE_SECONDS_MIN,
  CHANNEL_EXPIRE_SECONDS_MAX,
  MIN_JSON_BODY_LIMIT_BYTES,
} from './config.js';

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
      expect(result.data.CREATE_RATE_LIMIT).toBe(10);
      expect(result.data.MAX_VIEWERS_PER_CHANNEL).toBe(50);
      expect(result.data.VERIFY_RATE_LIMIT).toBe(10);
      expect(result.data.MAX_TEXT_LENGTH).toBe(2000);
      expect(result.data.TRUST_PROXY).toBe('loopback');
      expect(result.data.WS_ALLOWED_ORIGINS).toBe('');
      expect(result.data.AUDIT_LOG_ENABLED).toBe(true);
      expect(result.data.AUDIT_LOG_DIR).toBe('logs');
      expect(result.data.AUDIT_LOG_RETENTION_DAYS).toBe(243);
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
      CREATE_RATE_LIMIT: '30',
      TRUST_PROXY: 'false',
      WS_ALLOWED_ORIGINS: 'https://a.example, https://b.example',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PORT_HTTP).toBe(3000);
      expect(result.data.CHANNEL_TTL_SECONDS).toBe(3600);
      expect(result.data.MAX_TEXT_LENGTH).toBe(500);
      expect(result.data.CREATE_RATE_LIMIT).toBe(30);
      expect(result.data.TRUST_PROXY).toBe('false');
      // others remain default
      expect(result.data.PORT_WS).toBe(41602);
    }
  });

  it('accepts every documented TRUST_PROXY form', () => {
    for (const value of ['false', 'true', '2', 'loopback', 'linklocal', 'uniquelocal', '127.0.0.1', '10.0.0.0/8', '::1']) {
      const result = appConfigSchema.safeParse({ TRUST_PROXY: value });
      expect(result.success, value).toBe(true);
    }
  });

  it('rejects a garbage TRUST_PROXY value', () => {
    const result = appConfigSchema.safeParse({ TRUST_PROXY: 'trust-everything' });
    expect(result.success).toBe(false);
  });

  it('rejects an out-of-range CREATE_RATE_LIMIT', () => {
    expect(appConfigSchema.safeParse({ CREATE_RATE_LIMIT: '0' }).success).toBe(false);
    expect(appConfigSchema.safeParse({ CREATE_RATE_LIMIT: '5000' }).success).toBe(false);
  });
});

describe('audit log config', () => {
  it.each([
    ['true', true],
    ['TRUE', true],
    ['1', true],
    ['false', false],
    ['False', false],
    ['0', false],
  ])('parses AUDIT_LOG_ENABLED=%s as %s', (value, expected) => {
    const result = appConfigSchema.safeParse({ AUDIT_LOG_ENABLED: value });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.AUDIT_LOG_ENABLED).toBe(expected);
  });

  it('rejects an ambiguous AUDIT_LOG_ENABLED value', () => {
    expect(appConfigSchema.safeParse({ AUDIT_LOG_ENABLED: 'yes' }).success).toBe(false);
    expect(appConfigSchema.safeParse({ AUDIT_LOG_ENABLED: 'on' }).success).toBe(false);
  });

  it('accepts a custom directory and retention window', () => {
    const result = appConfigSchema.safeParse({
      AUDIT_LOG_ENABLED: 'false',
      AUDIT_LOG_DIR: ' /var/log/live-qr ',
      AUDIT_LOG_RETENTION_DAYS: '365',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.AUDIT_LOG_ENABLED).toBe(false);
      expect(result.data.AUDIT_LOG_DIR).toBe('/var/log/live-qr');
      expect(result.data.AUDIT_LOG_RETENTION_DAYS).toBe(365);
    }
  });

  it('rejects an empty directory and out-of-range retention', () => {
    expect(appConfigSchema.safeParse({ AUDIT_LOG_DIR: '   ' }).success).toBe(false);
    expect(appConfigSchema.safeParse({ AUDIT_LOG_RETENTION_DAYS: '0' }).success).toBe(false);
    expect(appConfigSchema.safeParse({ AUDIT_LOG_RETENTION_DAYS: '3651' }).success).toBe(false);
  });
});

describe('parseTrustProxy', () => {
  it('maps the documented strings onto Express values', () => {
    expect(parseTrustProxy('false')).toBe(false);
    expect(parseTrustProxy('true')).toBe(true);
    expect(parseTrustProxy('0')).toBe(0);
    expect(parseTrustProxy('2')).toBe(2);
    expect(parseTrustProxy('loopback')).toBe('loopback');
    expect(parseTrustProxy('loopback, linklocal')).toBe('loopback, linklocal');
  });
});

describe('parseAllowedOrigins', () => {
  it('splits, trims, lowercases and drops trailing slashes', () => {
    expect(parseAllowedOrigins('')).toEqual([]);
    expect(parseAllowedOrigins(' HTTPS://A.Example/ , https://b.example ')).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
    expect(parseAllowedOrigins(', ,')).toEqual([]);
    expect(parseAllowedOrigins('*')).toEqual(['*']);
  });
});

describe('jsonBodyLimitBytes', () => {
  it('never goes below the 16kb floor', () => {
    expect(MIN_JSON_BODY_LIMIT_BYTES).toBe(16 * 1024);
    expect(jsonBodyLimitBytes(2000)).toBe(16 * 1024);
    expect(jsonBodyLimitBytes(1)).toBe(16 * 1024);
  });

  it('grows above the floor for a large MAX_TEXT_LENGTH (worst-case 6x escaping)', () => {
    expect(jsonBodyLimitBytes(10000)).toBe(10000 * 6 + 1024);
    expect(jsonBodyLimitBytes(10000)).toBeGreaterThan(MIN_JSON_BODY_LIMIT_BYTES);
  });
});

describe('expire_seconds bounds', () => {
  it('is the documented 60..7200 range', () => {
    expect(CHANNEL_EXPIRE_SECONDS_MIN).toBe(60);
    expect(CHANNEL_EXPIRE_SECONDS_MAX).toBe(7200);
  });
});
