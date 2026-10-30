import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type express from 'express';
import { createApp } from '../app.js';
import { shutdownAll, getChannel } from '../services/channelStore.js';
import { clearAttempts } from '../services/attemptStore.js';
import type { AppConfig } from '../config.js';
import { mockConfig } from '../testing/mocks.js';

function makeApp(overrides: Partial<AppConfig> = {}): express.Application {
  return createApp(
    mockConfig({ UPLOAD_RATE_LIMIT: 100, VERIFY_RATE_LIMIT: 100, ...overrides }),
  );
}

async function createChannelVia(app: express.Application, body: object = {}) {
  const res = await request(app).post('/api/channel/create').send(body);
  expect(res.status).toBe(201);
  return res.body.data.shareCode as string;
}

describe('POST /api/upload', () => {
  let app: express.Application;

  beforeEach(() => {
    shutdownAll();
    clearAttempts();
    app = makeApp();
  });

  it('returns 200 for a valid upload', async () => {
    const shareCode = await createChannelVia(app);

    const res = await request(app).post('/api/upload').send({ shareCode, text: 'Hello World' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ code: 200, message: 'ok' });
  });

  it('stores the uploaded text', async () => {
    const shareCode = await createChannelVia(app);
    await request(app).post('/api/upload').send({ shareCode, text: 'Test123' });
    expect(getChannel(shareCode)!.latestText).toBe('Test123');
  });

  it('returns 400 for missing shareCode', async () => {
    const res = await request(app).post('/api/upload').send({ text: 'hello' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_SHARE_CODE');
  });

  it('returns 400 (not 500) when the request has no body at all', async () => {
    const res = await request(app).post('/api/upload');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_SHARE_CODE');
  });

  it('returns 400 for empty text', async () => {
    const shareCode = await createChannelVia(app);
    const res = await request(app).post('/api/upload').send({ shareCode, text: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('TEXT_EMPTY');
  });

  it('returns 400 for whitespace-only text', async () => {
    const shareCode = await createChannelVia(app);
    const res = await request(app).post('/api/upload').send({ shareCode, text: '   \n\t  ' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('TEXT_EMPTY');
  });

  it('counts MAX_TEXT_LENGTH in Unicode code points, not UTF-16 units', async () => {
    const shareCode = await createChannelVia(app);
    const emoji = '\u{1F600}'; // one code point, two UTF-16 units
    const text = emoji.repeat(2000);

    const res = await request(app).post('/api/upload').send({ shareCode, text });
    expect(res.status).toBe(200);
    expect(getChannel(shareCode)!.latestText).toBe(text);
  });

  it('rejects text exceeding MAX_TEXT_LENGTH in code points', async () => {
    const shareCode = await createChannelVia(app);
    const text = '\u{1F600}'.repeat(2001);

    const res = await request(app).post('/api/upload').send({ shareCode, text });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('TEXT_TOO_LONG');
  });

  it('honours a small MAX_TEXT_LENGTH', async () => {
    const small = makeApp({ MAX_TEXT_LENGTH: 5 });
    const shareCode = await createChannelVia(small);

    const res = await request(small).post('/api/upload').send({ shareCode, text: 'too long text' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('TEXT_TOO_LONG');
  });

  it('returns 413 PAYLOAD_TOO_LARGE for a body over the JSON limit', async () => {
    const shareCode = await createChannelVia(app);
    // 20k ASCII chars ≈ 20KB > the 16kb floor derived from MAX_TEXT_LENGTH (2000).
    const res = await request(app)
      .post('/api/upload')
      .send({ shareCode, text: 'x'.repeat(20_000) });
    expect(res.status).toBe(413);
    expect(res.body.error).toBe('PAYLOAD_TOO_LARGE');
  });

  it('returns 400 INVALID_JSON for a malformed JSON body', async () => {
    const res = await request(app)
      .post('/api/upload')
      .set('Content-Type', 'application/json')
      .send('{"shareCode": "12345678", "text": ');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_JSON');
  });

  it('returns 404 for a non-existent channel', async () => {
    const res = await request(app).post('/api/upload').send({ shareCode: '12345678', text: 'hello' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('CHANNEL_NOT_FOUND');
  });

  it('returns 404 for an expired channel and never revives it', async () => {
    const shareCode = await createChannelVia(app, { expire_seconds: 60 });
    getChannel(shareCode)!.lastUploadAt -= 61_000;

    const res = await request(app).post('/api/upload').send({ shareCode, text: 'zombie' });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('CHANNEL_NOT_FOUND');
    expect(getChannel(shareCode)).toBeUndefined();
  });

  it('returns 429 when the per-channel upload limit is exceeded', async () => {
    const limited = makeApp({ UPLOAD_RATE_LIMIT: 1 });
    const shareCode = await createChannelVia(limited);

    expect((await request(limited).post('/api/upload').send({ shareCode, text: 'a' })).status).toBe(
      200,
    );
    const blocked = await request(limited)
      .post('/api/upload')
      .send({ shareCode, text: 'b' });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe('RATE_LIMITED');
  });

  it('does not consume upload quota for a malformed share code', async () => {
    const limited = makeApp({ UPLOAD_RATE_LIMIT: 1 });
    const shareCode = await createChannelVia(limited);

    for (let i = 0; i < 5; i++) {
      const bad = await request(limited).post('/api/upload').send({ shareCode: 'bad', text: 'x' });
      expect(bad.status).toBe(400);
    }

    const ok = await request(limited).post('/api/upload').send({ shareCode, text: 'first' });
    expect(ok.status).toBe(200);
  });
});
