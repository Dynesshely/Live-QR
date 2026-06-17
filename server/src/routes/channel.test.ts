import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createChannelRouter } from './channel.js';
import { shutdownAll } from '../services/channelStore.js';
import type { AppConfig } from '../config.js';

function mockConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    PORT_HTTP: 41601,
    PORT_WS: 41602,
    CHANNEL_TTL_SECONDS: 1800,
    CLEANUP_INTERVAL_SECONDS: 60,
    UPLOAD_RATE_LIMIT: 2,
    MAX_VIEWERS_PER_CHANNEL: 50,
    VERIFY_RATE_LIMIT: 100, // high limit for tests
    MAX_TEXT_LENGTH: 2000,
    ...overrides,
  };
}

describe('POST /api/channel/create', () => {
  let app: express.Application;

  beforeEach(() => {
    shutdownAll();
    app = express();
    app.use(express.json());
    app.use(createChannelRouter(mockConfig()));
  });

  it('returns 201 with shareCode, expireAt, createdAt', async () => {
    const res = await request(app).post('/api/channel/create').send({});
    expect(res.status).toBe(201);
    expect(res.body.code).toBe(201);
    expect(res.body.data.shareCode).toMatch(/^\d{8}$/);
    expect(res.body.data.expireAt).toBeDefined();
    expect(res.body.data.createdAt).toBeDefined();
  });

  it('accepts optional expire_seconds', async () => {
    const res = await request(app)
      .post('/api/channel/create')
      .send({ expire_seconds: 3600 });
    expect(res.status).toBe(201);
    expect(res.body.data.shareCode).toMatch(/^\d{8}$/);
  });

  it('rejects expire_seconds below 60', async () => {
    const res = await request(app)
      .post('/api/channel/create')
      .send({ expire_seconds: 30 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_EXPIRE_SECONDS');
  });

  it('rejects expire_seconds above 7200', async () => {
    const res = await request(app)
      .post('/api/channel/create')
      .send({ expire_seconds: 99999 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_EXPIRE_SECONDS');
  });
});

describe('GET /api/channel/verify', () => {
  let app: express.Application;

  beforeEach(() => {
    shutdownAll();
    app = express();
    app.use(express.json());
    app.use(createChannelRouter(mockConfig()));
  });

  it('returns 200 with valid:true for existing channel', async () => {
    const created = await request(app).post('/api/channel/create').send({});
    const { shareCode } = created.body.data;

    const res = await request(app).get(`/api/channel/verify?shareCode=${shareCode}`);
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body).toHaveProperty('latestText');
    expect(res.body).toHaveProperty('updatedAt');
  });

  it('returns 404 for non-existent channel', async () => {
    const res = await request(app).get('/api/channel/verify?shareCode=00000000');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('CHANNEL_NOT_FOUND');
  });

  it('returns 400 for invalid shareCode format', async () => {
    const res = await request(app).get('/api/channel/verify?shareCode=abc');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_SHARE_CODE');
  });
});
