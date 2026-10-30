import { describe, it, expect, afterEach, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { createAccessLog } from './accessLog.js';
import { mockConfig, mockRequest, mockResponse } from '../testing/mocks.js';

function captureStdout(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown): boolean => {
    lines.push(String(chunk));
    return true;
  });
  return { lines, restore: () => spy.mockRestore() };
}

const activeSpies: Array<() => void> = [];

afterEach(() => {
  while (activeSpies.length > 0) {
    activeSpies.pop()?.();
  }
});

describe('accessLog', () => {
  it('emits one JSON line per request with transport metadata only', () => {
    const { lines, restore } = captureStdout();
    activeSpies.push(restore);

    const req = mockRequest({
      method: 'POST',
      path: '/api/upload',
      ip: '10.1.2.3',
      headers: { 'user-agent': 'vitest-agent' },
    });
    const res = mockResponse();
    let nextCalled = false;

    createAccessLog(mockConfig())(
      req as unknown as Request,
      res as unknown as Response,
      (() => {
        nextCalled = true;
      }) as unknown as NextFunction,
    );

    expect(nextCalled).toBe(true);

    res.statusCode = 204;
    res.emit('finish');

    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]) as Record<string, unknown>;
    expect(entry).toMatchObject({
      level: 'info',
      event: 'access',
      message: 'POST /api/upload 204',
      method: 'POST',
      path: '/api/upload',
      status: 204,
      clientIp: '10.1.2.3',
      userAgent: 'vitest-agent',
    });
    expect(typeof entry.durationMs).toBe('number');
    // Never log request bodies or uploaded text.
    expect(entry).not.toHaveProperty('body');
    expect(entry).not.toHaveProperty('text');
  });

  it('skips /api/health entirely', () => {
    const { lines, restore } = captureStdout();
    activeSpies.push(restore);

    const req = mockRequest({ method: 'GET', path: '/api/health' });
    const res = mockResponse();
    let nextCalled = false;

    createAccessLog(mockConfig())(
      req as unknown as Request,
      res as unknown as Response,
      (() => {
        nextCalled = true;
      }) as unknown as NextFunction,
    );

    res.emit('finish');

    expect(nextCalled).toBe(true);
    expect(res.listeners.finish).toBeUndefined();
    expect(lines).toEqual([]);
  });
});
