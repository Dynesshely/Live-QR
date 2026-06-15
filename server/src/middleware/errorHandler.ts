import type { Request, Response, NextFunction } from 'express';
import type { ErrorResponse } from '../types.js';
import { logger } from '../logger.js';

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

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof AppError) {
    const body: ErrorResponse = {
      code: err.statusCode,
      error: err.errorType,
      message: err.message,
    };
    res.status(err.statusCode).json(body);
    return;
  }

  logger.error('server_start' as any, `Unhandled error: ${err.message}`);

  const body: ErrorResponse = {
    code: 500,
    error: 'INTERNAL_ERROR',
    message: '服务器内部错误',
  };
  res.status(500).json(body);
}
