import type { Request, Response, NextFunction } from 'express';
import type { ErrorResponse } from '../types.js';
import { logger } from '../logger.js';

/**
 * Errors with an explicit API contract. Route handlers and validators throw
 * these; the middleware below renders them in the standard error envelope.
 */
export class AppError extends Error {
  constructor(
    public statusCode: number,
    public errorType: string,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function createError(statusCode: number, errorType: string, message: string): AppError {
  return new AppError(statusCode, errorType, message);
}

/** Shape of body-parser / http-errors errors we care about. */
interface HttpError extends Error {
  type?: string;
  status?: number;
  statusCode?: number;
}

function send(res: Response, status: number, error: string, message: string): void {
  const body: ErrorResponse = { code: status, error, message };
  res.status(status).json(body);
}

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Response already started: let Express abort the socket.
  if (res.headersSent) {
    next(err);
    return;
  }

  if (err instanceof AppError) {
    send(res, err.statusCode, err.errorType, err.message);
    return;
  }

  const httpError = err as HttpError;

  // body-parser failures: these arrive with a type set and used to surface as 500.
  switch (httpError.type) {
    case 'entity.parse.failed':
      logger.debug('validation_failed', 'Invalid JSON body');
      send(res, 400, 'INVALID_JSON', '请求体不是合法的 JSON');
      return;
    case 'entity.too.large':
      logger.debug('validation_failed', 'Request body too large');
      send(res, 413, 'PAYLOAD_TOO_LARGE', '请求体过大');
      return;
    case 'entity.verify.failed':
      logger.debug('validation_failed', 'Request body verification failed');
      send(res, 400, 'INVALID_BODY', '请求体校验失败');
      return;
    default:
      break;
  }

  // Respect an explicit status on the error object (http-errors/body-parser set
  // it), but never echo the raw message of a 5xx back to the client.
  const status = httpError.statusCode ?? httpError.status;
  if (typeof status === 'number' && status >= 400 && status <= 599) {
    if (status >= 500) {
      logger.error('internal_error', 'Unhandled error (' + status + '): ' + err.message);
      send(res, status, 'INTERNAL_ERROR', '服务器内部错误');
      return;
    }
    send(res, status, 'BAD_REQUEST', httpError.message || '请求无效');
    return;
  }

  logger.error('internal_error', 'Unhandled error: ' + err.message);
  send(res, 500, 'INTERNAL_ERROR', '服务器内部错误');
}

/** JSON 404 for anything that did not match a route (never HTML). */
export function notFoundHandler(_req: Request, res: Response): void {
  send(res, 404, 'NOT_FOUND', '接口不存在');
}
