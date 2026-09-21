/** 路由辅助：统一响应体（API-2）与错误映射（ERR-1..3）。 */
import type { ErrorCode } from '@ttfolio/shared';
import { AppError, isErrnoException } from '../core/errors.js';

export function ok<T>(data: T): { ok: true; data: T } {
  return { ok: true, data };
}

export function fail(code: ErrorCode, message: string, status?: number, detail?: unknown): { ok: false; error: { code: ErrorCode; message: string; detail?: unknown }; __status?: number } {
  return { ok: false, error: { code, message, detail }, __status: status };
}

import type { FastifyRequest } from 'fastify';
export type RouteRequest = FastifyRequest;

/** 把任意错误转成 {code, message, detail} 与 HTTP 状态。 */
export function toApiError(err: unknown): { code: ErrorCode; message: string; detail?: unknown; status: number } {
  if (err instanceof AppError) {
    return { code: err.code, message: err.message, detail: err.detail, status: err.httpStatus };
  }
  if (isErrnoException(err)) {
    if (err.code === 'ENOENT') return { code: 'NOT_FOUND', message: '路径不存在', status: 404 };
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      return { code: 'PERMISSION_DENIED', message: '权限不足', status: 403 };
    }
    if (err.code === 'EBUSY' || err.code === 'ETXTBSY') {
      return { code: 'IO_ERROR', message: '文件被其他程序占用', status: 500 };
    }
    if (err.code === 'ENOSPC') return { code: 'IO_ERROR', message: '磁盘空间不足', status: 500 };
    return { code: 'IO_ERROR', message: `文件系统错误：${err.code ?? ''}`, status: 500 };
  }
  const msg = err instanceof Error ? err.message : String(err);
  return { code: 'INTERNAL', message: msg, status: 500 };
}
