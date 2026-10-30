import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import type express from 'express';
import { createApp } from '../app.js';
import { addClient, getChannel, removeClient, shutdownAll } from '../services/channelStore.js';
import { clearAttempts } from '../services/attemptStore.js';
import type { AuditRecorder } from '../services/auditLog.js';
import type { AppConfig } from '../config.js';
import { FakeWebSocket, mockConfig } from '../testing/mocks.js';

function makeApp(overrides: Partial<AppConfig> = {}, audit?: AuditRecorder): express.Application {
  return createApp(
    mockConfig({ UPLOAD_RATE_LIMIT: 100, VERIFY_RATE_LIMIT: 100, ...overrides }),
    { audit },
  );
}

interface RecordedUpload {
  shareCode: string;
  uploaderIp: string;
  uploaderUa: string;
  text: string;
  recipients: Array<{ ip: string; ua: string }>;
}

function fakeAudit(): AuditRecorder & { uploads: RecordedUpload[] } {
  const uploads: RecordedUpload[] = [];
  return {
    uploads,
    recordUpload(input) {
      uploads.push(input);
    },
    recordViewerConnect() {},
    recordViewerDisconnect() {},
  };
}

function addViewer(shareCode: string, ip: string, ua: string): FakeWebSocket {
  const socket = new FakeWebSocket();
  addClient(shareCode, FakeWebSocket.asWS(socket), { ip, ua });
  return socket;
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

  it('records an audit upload with the exact text, uploader identity and online recipients', async () => {
    const audit = fakeAudit();
    const audited = makeApp({}, audit);
    const shareCode = await createChannelVia(audited);

    addViewer(shareCode, '198.51.100.2', 'viewer-a');
    addViewer(shareCode, '198.51.100.3', 'viewer-b');

    const text = '  hi\n"quoted" \u{1F600}  ';
    const res = await request(audited)
      .post('/api/upload')
      .set('User-Agent', 'uploader-ua')
      .send({ shareCode, text });

    expect(res.status).toBe(200);
    expect(audit.uploads).toHaveLength(1);
    expect(audit.uploads[0]).toEqual({
      shareCode,
      uploaderIp: '127.0.0.1',
      uploaderUa: 'uploader-ua',
      text, // never trimmed or truncated
      recipients: [
        { ip: '198.51.100.2', ua: 'viewer-a' },
        { ip: '198.51.100.3', ua: 'viewer-b' },
      ],
    });
  });

  it('does not count viewers that join after the broadcast or already left', async () => {
    const audit = fakeAudit();
    const audited = makeApp({}, audit);
    const shareCode = await createChannelVia(audited);

    const first = addViewer(shareCode, '198.51.100.2', 'viewer-a');
    await request(audited).post('/api/upload').send({ shareCode, text: 'one' });

    removeClient(shareCode, FakeWebSocket.asWS(first));
    addViewer(shareCode, '198.51.100.3', 'viewer-b');
    await request(audited).post('/api/upload').send({ shareCode, text: 'two' });

    expect(audit.uploads[0].recipients).toEqual([{ ip: '198.51.100.2', ua: 'viewer-a' }]);
    expect(audit.uploads[1].recipients).toEqual([{ ip: '198.51.100.3', ua: 'viewer-b' }]);
  });

  it('records the real client IP from X-Forwarded-For behind a trusted loopback proxy', async () => {
    const audit = fakeAudit();
    const proxied = makeApp({ TRUST_PROXY: 'loopback' }, audit);
    const shareCode = await createChannelVia(proxied);

    await request(proxied)
      .post('/api/upload')
      .set('X-Forwarded-For', '203.0.113.7, 127.0.0.1')
      .send({ shareCode, text: 'behind caddy' });

    expect(audit.uploads[0].uploaderIp).toBe('203.0.113.7');
  });

  it('ignores a client-supplied X-Forwarded-For when trust proxy is disabled', async () => {
    const audit = fakeAudit();
    const direct = makeApp({ TRUST_PROXY: 'false' }, audit);
    const shareCode = await createChannelVia(direct);

    await request(direct)
      .post('/api/upload')
      .set('X-Forwarded-For', '203.0.113.7')
      .send({ shareCode, text: 'direct' });

    expect(audit.uploads[0].uploaderIp).toBe('127.0.0.1');
  });

  it('never fails an upload when the audit recorder throws', async () => {
    const exploding: AuditRecorder = {
      recordUpload() {
        throw new Error('disk on fire');
      },
      recordViewerConnect() {},
      recordViewerDisconnect() {},
    };
    const audited = makeApp({}, exploding);
    const shareCode = await createChannelVia(audited);

    const res = await request(audited).post('/api/upload').send({ shareCode, text: 'still ok' });
    expect(res.status).toBe(200);
  });

  it('does not write an audit record for a rejected upload', async () => {
    const audit = fakeAudit();
    const audited = makeApp({ MAX_TEXT_LENGTH: 5 }, audit);
    const shareCode = await createChannelVia(audited);

    await request(audited).post('/api/upload').send({ shareCode, text: 'far too long' });
    await request(audited).post('/api/upload').send({ shareCode: '12345678', text: 'no channel' });

    expect(audit.uploads).toEqual([]);
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
