import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type express from 'express';
import { createApp } from '../app.js';
import { shutdownAll, getChannel } from '../services/channelStore.js';
import { clearAttempts } from '../services/attemptStore.js';
import type { AppConfig } from '../config.js';
import { mockConfig } from '../testing/mocks.js';

function makeApp(overrides: Partial<AppConfig> = {}): express.Application {
  return createApp(mockConfig({ VERIFY_RATE_LIMIT: 100, ...overrides }));
}

describe('POST /api/channel/create', () => {
  let app: express.Application;

  beforeEach(() => {
    shutdownAll();
    clearAttempts();
    app = makeApp();
  });

  it('returns 201 with shareCode, expireAt, createdAt', async () => {
    const res = await request(app).post('/api/channel/create').send({});
    expect(res.status).toBe(201);
    expect(res.body.code).toBe(201);
    expect(res.body.data.shareCode).toMatch(/^\d{8}$/);
    expect(res.body.data.expireAt).toBeDefined();
    expect(res.body.data.createdAt).toBeDefined();
  });

  it('accepts a valid integer expire_seconds and reflects it in expireAt', async () => {
    const res = await request(app).post('/api/channel/create').send({ expire_seconds: 3600 });
    expect(res.status).toBe(201);

    const createdAt = new Date(res.body.data.createdAt).getTime();
    const expireAt = new Date(res.body.data.expireAt).getTime();
    expect(expireAt - createdAt).toBe(3600 * 1000);
    expect(getChannel(res.body.data.shareCode)!.ttlSeconds).toBe(3600);
  });

  it.each([
    ['below range', 30],
    ['above range', 99999],
    ['float', 90.5],
    ['numeric string', '3600'],
    ['null', null],
    ['boolean', true],
  ])('rejects expire_seconds: %s with 400 INVALID_EXPIRE_SECONDS', async (_label, value) => {
    const res = await request(app).post('/api/channel/create').send({ expire_seconds: value });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_EXPIRE_SECONDS');
  });

  it('rate limits channel creation per IP (429 CREATE_RATE_LIMITED)', async () => {
    const limited = makeApp({ CREATE_RATE_LIMIT: 3 });

    for (let i = 0; i < 3; i++) {
      const res = await request(limited).post('/api/channel/create').send({});
      expect(res.status).toBe(201);
    }

    const blocked = await request(limited).post('/api/channel/create').send({});
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe('CREATE_RATE_LIMITED');
  });

  it('ignores a client-supplied X-Forwarded-For when TRUST_PROXY=false', async () => {
    const limited = makeApp({ CREATE_RATE_LIMIT: 2, TRUST_PROXY: 'false' });

    for (let i = 0; i < 2; i++) {
      const res = await request(limited)
        .post('/api/channel/create')
        .set('X-Forwarded-For', '203.0.113.' + (i + 1))
        .send({});
      expect(res.status).toBe(201);
    }

    // Rotating the header must NOT buy a fresh bucket.
    const blocked = await request(limited)
      .post('/api/channel/create')
      .set('X-Forwarded-For', '203.0.113.99')
      .send({});
    expect(blocked.status).toBe(429);
  });
});

describe('GET /api/channel/verify', () => {
  let app: express.Application;

  beforeEach(() => {
    shutdownAll();
    clearAttempts();
    app = makeApp();
  });

  it('returns 200 with valid:true for existing channel', async () => {
    const created = await request(app).post('/api/channel/create').send({});
    const { shareCode } = created.body.data;

    const res = await request(app).get('/api/channel/verify?shareCode=' + shareCode);
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body).toHaveProperty('latestText', null);
    expect(res.body).toHaveProperty('updatedAt', null);
  });

  it('returns 404 for non-existent channel', async () => {
    const res = await request(app).get('/api/channel/verify?shareCode=00000000');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('CHANNEL_NOT_FOUND');
  });

  it('returns 404 for an expired-but-not-yet-swept channel (lazy expiry)', async () => {
    const created = await request(app).post('/api/channel/create').send({ expire_seconds: 60 });
    const { shareCode } = created.body.data;

    // Simulate 61s of inactivity without waiting or bypassing the TTL schema.
    getChannel(shareCode)!.lastUploadAt -= 61_000;

    const res = await request(app).get('/api/channel/verify?shareCode=' + shareCode);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('CHANNEL_NOT_FOUND');
    expect(getChannel(shareCode)).toBeUndefined();
  });

  it('returns 400 for invalid shareCode format', async () => {
    const res = await request(app).get('/api/channel/verify?shareCode=abc');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_SHARE_CODE');
  });

  it('does not consume the IP quota for malformed share codes', async () => {
    const strict = makeApp({ VERIFY_RATE_LIMIT: 1 });

    for (let i = 0; i < 5; i++) {
      const bad = await request(strict).get('/api/channel/verify?shareCode=bad' + i);
      expect(bad.status).toBe(400);
    }

    const created = await request(strict).post('/api/channel/create').send({});
    const ok = await request(strict).get(
      '/api/channel/verify?shareCode=' + created.body.data.shareCode,
    );
    expect(ok.status).toBe(200);
  });
});

describe('POST /api/channel/expire', () => {
  let app: express.Application;

  beforeEach(() => {
    shutdownAll();
    clearAttempts();
    app = makeApp();
  });

  it('expires an existing channel and 404s the second time', async () => {
    const created = await request(app).post('/api/channel/create').send({});
    const { shareCode } = created.body.data;

    const first = await request(app).post('/api/channel/expire').send({ shareCode });
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ code: 200, message: 'ok' });

    const second = await request(app).post('/api/channel/expire').send({ shareCode });
    expect(second.status).toBe(404);
    expect(second.body.error).toBe('CHANNEL_NOT_FOUND');
  });

  it('returns 400 (not 500) when the request has no body', async () => {
    const res = await request(app).post('/api/channel/expire');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_SHARE_CODE');
  });

  it('returns 400 INVALID_JSON for a malformed JSON body', async () => {
    const res = await request(app)
      .post('/api/channel/expire')
      .set('Content-Type', 'application/json')
      .send('{"shareCode": ');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_JSON');
  });

  it('returns 400 for a malformed share code', async () => {
    const res = await request(app).post('/api/channel/expire').send({ shareCode: '123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_SHARE_CODE');
  });
});

describe('app-level fallbacks', () => {
  let app: express.Application;

  beforeEach(() => {
    shutdownAll();
    clearAttempts();
    app = makeApp();
  });

  it('returns JSON 404 for an unknown path', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ code: 404, error: 'NOT_FOUND', message: '接口不存在' });
  });

  it('keeps the health endpoint shape unchanged', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('does not advertise Express', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
