import { describe, it, expect } from 'vitest';
import {
  SERVER_ERROR_CODES,
  applyUploadOutcome,
  classifyUploadStatus,
  serverErrorKey,
  type UploadDedupState,
} from './upload';
import en from '../locales/en.json';

describe('classifyUploadStatus', () => {
  it('classifies 2xx as accepted', () => {
    expect(classifyUploadStatus(200)).toBe('ok');
    expect(classifyUploadStatus(201)).toBe('ok');
    expect(classifyUploadStatus(204)).toBe('ok');
  });

  it('classifies 404 as expired channel', () => {
    expect(classifyUploadStatus(404)).toBe('expired');
  });

  it('classifies 429 as rate limited (retryable, not queued)', () => {
    expect(classifyUploadStatus(429)).toBe('rate_limited');
  });

  it('classifies other 4xx as permanent rejection (must not enter offline queue)', () => {
    // 400 TEXT_TOO_LONG 是永久性错误：重试多少次都不会成功
    expect(classifyUploadStatus(400)).toBe('rejected');
    expect(classifyUploadStatus(401)).toBe('rejected');
    expect(classifyUploadStatus(403)).toBe('rejected');
    expect(classifyUploadStatus(413)).toBe('rejected');
    // 未预期到的重定向也算不可重试
    expect(classifyUploadStatus(302)).toBe('rejected');
  });

  it('classifies 5xx as transient network error (may be retried)', () => {
    expect(classifyUploadStatus(500)).toBe('network_error');
    expect(classifyUploadStatus(502)).toBe('network_error');
    expect(classifyUploadStatus(503)).toBe('network_error');
  });
});

describe('applyUploadOutcome', () => {
  const empty: UploadDedupState = { lastAcceptedText: null, lastRejectedText: null };

  it('records accepted text so identical frames are not resubmitted', () => {
    expect(applyUploadOutcome(empty, 'ok', 'A')).toEqual({
      lastAcceptedText: 'A',
      lastRejectedText: null,
    });
  });

  it('also records 429 as the dedup baseline (does not resend every 250ms)', () => {
    // 回归：原实现 429 返回 'ok' 却不更新 lastSuccessfulText，
    // 扫描循环每 250ms 重发同一文本，限流永远不结束。
    expect(applyUploadOutcome(empty, 'rate_limited', 'A')).toEqual({
      lastAcceptedText: 'A',
      lastRejectedText: null,
    });
  });

  it('remembers permanently rejected text so it is not retried', () => {
    expect(applyUploadOutcome(empty, 'rejected', 'TOO_LONG')).toEqual({
      lastAcceptedText: null,
      lastRejectedText: 'TOO_LONG',
    });
  });

  it('leaves the baseline untouched for transient failures', () => {
    expect(applyUploadOutcome(empty, 'network_error', 'A')).toBe(empty);
    expect(applyUploadOutcome(empty, 'expired', 'A')).toBe(empty);
  });

  it('does not mutate the previous state', () => {
    const state: UploadDedupState = { lastAcceptedText: 'OLD', lastRejectedText: null };
    const next = applyUploadOutcome(state, 'ok', 'NEW');

    expect(state.lastAcceptedText).toBe('OLD');
    expect(next.lastAcceptedText).toBe('NEW');
  });
});

describe('serverErrorKey', () => {
  it('maps known server error codes to i18n keys', () => {
    expect(serverErrorKey('TEXT_TOO_LONG')).toBe('serverErrors.TEXT_TOO_LONG');
    expect(serverErrorKey('RATE_LIMITED')).toBe('serverErrors.RATE_LIMITED');
  });

  it('returns null for unknown or non-string codes (falls back to generic text)', () => {
    expect(serverErrorKey('SOMETHING_NEW')).toBeNull();
    expect(serverErrorKey(undefined)).toBeNull();
    expect(serverErrorKey(429)).toBeNull();
  });

  it('has a localized message for every known server error code', () => {
    for (const code of SERVER_ERROR_CODES) {
      expect(en.serverErrors[code], `missing serverErrors.${code}`).toBeTruthy();
    }
  });
});
