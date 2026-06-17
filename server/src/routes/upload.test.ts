import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { createChannelRouter } from './channel.js';
import { createUploadRouter } from './upload.js';
import { shutdownAll, getChannel } from '../services/channelStore.js';
import type { AppConfig } from '../config.js';

function mockConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    PORT_HTTP: 41601,
    PORT_WS: 41602,
    CHANNEL_TTL_SECONDS: 1800,
    CLEANUP_INTERVAL_SECONDS: 60,
    UPLOAD_RATE_LIMIT: 100, // high limit to avoid test interference
    MAX_VIEWERS_PER_CHANNEL: 50,
    VERIFY_RATE_LIMIT: 100,
    MAX_TEXT_LENGTH: 2000,
    ...overrides,
  };
}

function createApp(config: AppConfig): express.Application {
  const app = express();
  app.use(express.json());
  app.use(createChannelRouter(config));
  app.use(createUploadRouter(config));
  return app;
}

describe('POST /api/upload', () => {
  let app: express.Application;

  beforeEach(() => {
    shutdownAll();
    app = createApp(mockConfig());
  });

  it('returns 200 for valid upload', async () => {
    const created = await request(app).post('/api/channel/create').send({});
    const { shareCode } = created.body.data;

    const res = await request(app)
      .post('/api/upload')
      .send({ shareCode, text: 'Hello World' });
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(200);
    expect(res.body.message).toBe('ok');
  });

  it('stores the uploaded text', async () => {
    const created = await request(app).post('/api/channel/create').send({});
    const { shareCode } = created.body.data;

    await request(app).post('/api/upload').send({ shareCode, text: 'Test123' });

    const stored = getChannel(shareCode);
    expect(stored!.latestText).toBe('Test123');
  });

  it('returns 400 for missing shareCode', async () => {
    const res = await request(app)
      .post('/api/upload')
      .send({ text: 'hello' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_SHARE_CODE');
  });

  it('returns 400 for empty text', async () => {
    const created = await request(app).post('/api/channel/create').send({});
    const { shareCode } = created.body.data;

    const res = await request(app)
      .post('/api/upload')
      .send({ shareCode, text: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('TEXT_EMPTY');
  });

  it('returns 400 for text exceeding MAX_TEXT_LENGTH', async () => {
    const config = mockConfig({ MAX_TEXT_LENGTH: 5 });
    const smallApp = createApp(config);
    const created = await request(smallApp).post('/api/channel/create').send({});
    const { shareCode } = created.body.data;

    const res = await request(smallApp)
      .post('/api/upload')
      .send({ shareCode, text: 'too long text' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('TEXT_TOO_LONG');
  });

  it('returns 404 for non-existent channel', async () => {
    const res = await request(app)
      .post('/api/upload')
      .send({ shareCode: '12345678', text: 'hello' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('CHANNEL_NOT_FOUND');
  });
});
