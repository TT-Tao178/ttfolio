/** 路由辅助：统一响应体（API-2）与错误映射（ERR-1..3）。 */
import type { ErrorCode } from '@ttfolio/shared';
import type Database from 'better-sqlite3';
import { AppError, isErrnoException } from '../core/errors.js';
import { getSetting } from '../db/repo/metaRepo.js';
import { listIgnoreRules } from '../db/repo/rulesRepo.js';
import { compileIgnore, type CompiledIgnore } from '../core/ignore.js';

export function ok<T>(data: T): { ok: true; data: T } {
  return { ok: true, data };
}

export function fail(
  code: ErrorCode,
  message: string,
  status?: number,
  detail?: unknown,
): { ok: false; error: { code: ErrorCode; message: string; detail?: unknown }; __status?: number } {
  return { ok: false, error: { code, message, detail }, __status: status };
}

import type { FastifyRequest } from 'fastify';
export type RouteRequest = FastifyRequest;

/** 把任意错误转成 {code, message, detail} 与 HTTP 状态。 */
export function toApiError(err: unknown): {
  code: ErrorCode;
  message: string;
  detail?: unknown;
  status: number;
} {
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

/** 最小 watcher 接口（避免 routes 依赖完整 Watcher 类型）。 */
export interface WatchLike {
  unwatch(projectId: string): void;
  unwatchAll(): void;
  watch(projectId: string, root: string, matcher: CompiledIgnore, stabilityMs: number): void;
}

function watchParams(db: Database.Database): { matcher: CompiledIgnore; stability: number } | null {
  // 体检 P1：watch_enabled=0 时不监听（返回 null 让调用方跳过）
  if (getSetting(db, 'watch_enabled') === '0') return null;
  const matcher = compileIgnore(listIgnoreRules(db));
  const n = Number(getSetting(db, 'watch_stability_ms') ?? '300');
  const stability = Number.isFinite(n) && n >= 50 ? n : 300;
  return { matcher, stability };
}

/** 项目登记/复活/重定位/改名后重建该项目的监听（watch 幂等；重定位必须先 unwatch 旧路径）。 */
export function rewatchProject(
  db: Database.Database,
  watcher: WatchLike,
  projectId: string,
  root: string,
): void {
  const p = watchParams(db);
  if (p === null) return;
  watcher.unwatch(projectId);
  try {
    watcher.watch(projectId, root, p.matcher, p.stability);
  } catch {
    /* 监听失败不阻断登记主流程（启动期同样容错） */
  }
}

/** 忽略规则/监听参数/开关变化后重建全部监听。 */
export function rewatchAll(
  db: Database.Database,
  watcher: WatchLike,
  projects: Array<{ id: string; dir_path: string }>,
): void {
  watcher.unwatchAll();
  for (const r of projects) rewatchProject(db, watcher, r.id, r.dir_path);
}
