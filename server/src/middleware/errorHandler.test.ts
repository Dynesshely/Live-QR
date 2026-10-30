import { describe, it, expect, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import { AppError, createError, errorHandler, notFoundHandler } from './errorHandler.js';
import { mockRequest, mockResponse } from '../testing/mocks.js';

interface Invocation {
  res: ReturnType<typeof mockResponse>;
  next: ReturnType<typeof vi.fn>;
}

function invoke(err: unknown): Invocation {
  const res = mockResponse();
  const next = vi.fn();
  errorHandler(
    err as Error,
    mockRequest() as unknown as Request,
    res as unknown as Response,
    next as unknown as NextFunction,
  );
  return { res, next };
}

function httpError(message: string, extra: Record<string, unknown>): Error {
  return Object.assign(new Error(message), extra);
}

describe('AppError', () => {
  it('is recognised by the error handler', () => {
    const { res } = invoke(createError(400, 'INVALID_SHARE_CODE', 'bad code'));
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ code: 400, error: 'INVALID_SHARE_CODE', message: 'bad code' });
  });

  it('marks itself as AppError', () => {
    const err = createError(404, 'CHANNEL_NOT_FOUND', 'nope');
    expect(err).toBeInstanceOf(AppError);
    expect(err.name).toBe('AppError');
  });
});

describe('errorHandler body-parser mapping', () => {
  it('maps entity.parse.failed to 400 INVALID_JSON', () => {
    const { res } = invoke(httpError('Unexpected token', { type: 'entity.parse.failed' }));
    expect(res.statusCode).toBe(400);
    expect((res.body as { error: string }).error).toBe('INVALID_JSON');
  });

  it('maps entity.too.large to 413 PAYLOAD_TOO_LARGE', () => {
    const { res } = invoke(httpError('request entity too large', { type: 'entity.too.large' }));
    expect(res.statusCode).toBe(413);
    expect((res.body as { error: string }).error).toBe('PAYLOAD_TOO_LARGE');
  });

  it('maps entity.verify.failed to 400 INVALID_BODY', () => {
    const { res } = invoke(httpError('verify failed', { type: 'entity.verify.failed' }));
    expect(res.statusCode).toBe(400);
    expect((res.body as { error: string }).error).toBe('INVALID_BODY');
  });
});

describe('errorHandler status handling', () => {
  it('respects err.status', () => {
    const { res } = invoke(httpError('teapot', { status: 418 }));
    expect(res.statusCode).toBe(418);
    expect((res.body as { error: string }).error).toBe('BAD_REQUEST');
  });

  it('respects err.statusCode', () => {
    const { res } = invoke(httpError('too many requests', { statusCode: 429 }));
    expect(res.statusCode).toBe(429);
  });

  it('keeps the supplied 5xx status but hides the raw message', () => {
    const { res } = invoke(httpError('upstream broke', { status: 502 }));
    expect(res.statusCode).toBe(502);
    expect(res.body).toEqual({
      code: 502,
      error: 'INTERNAL_ERROR',
      message: '服务器内部错误',
    });
  });

  it('falls back to 500 INTERNAL_ERROR for a plain Error', () => {
    const { res } = invoke(new Error('boom'));
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({
      code: 500,
      error: 'INTERNAL_ERROR',
      message: '服务器内部错误',
    });
  });

  it('delegates to next when the response already started', () => {
    const res = mockResponse();
    res.headersSent = true;
    const next = vi.fn();
    errorHandler(
      new Error('late'),
      mockRequest() as unknown as Request,
      res as unknown as Response,
      next as unknown as NextFunction,
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.body).toBeUndefined();
  });
});

describe('notFoundHandler', () => {
  it('renders a JSON 404 envelope', () => {
    const res = mockResponse();
    notFoundHandler(mockRequest() as unknown as Request, res as unknown as Response);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ code: 404, error: 'NOT_FOUND', message: '接口不存在' });
  });
});
