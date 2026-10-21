/** 设置 / 活动日志 / 搜索历史（EN-7）。 */
import type { ActivityEntry } from '@ttfolio/shared';
import type Database from 'better-sqlite3';
import { getAll, getOne, run } from '../sql.js';
import type { ActivityRow } from '../rowTypes.js';
import { currentActor } from '../../core/actor.js';

export function getSetting(db: Database.Database, key: string): string | null {
  const row = getOne<{ value: string | null }>(db, 'SELECT value FROM settings WHERE key = ?', [key]);
  return row?.value ?? null;
}

export function setSetting(db: Database.Database, key: string, value: string): void {
  run(
    db,
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, value, new Date().toISOString()],
  );
}

export function getAllSettings(db: Database.Database): Record<string, string> {
  const rows = getAll<{ key: string; value: string | null }>(db, 'SELECT key, value FROM settings');
  const out: Record<string, string> = {};
  for (const r of rows) out[r.key] = r.value ?? '';
  return out;
}

export function logActivity(
  db: Database.Database,
  entry: {
    kind: string;
    level: 'L1' | 'L2' | 'L3';
    projectId?: string | null;
    targetPath?: string | null;
    detail?: unknown;
    actor?: string;
  },
): void {
  run(
    db,
    `INSERT INTO activity_log (at, kind, level, project_id, target_path, detail_json, actor)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      new Date().toISOString(),
      entry.kind,
      entry.level,
      entry.projectId ?? null,
      entry.targetPath ?? null,
      entry.detail === undefined ? null : JSON.stringify(entry.detail),
      // 未显式传 actor 时取当前异步链身份（FR-13.1：agent 携 actor 头调用时自动落 agent 身份）
      entry.actor ?? currentActor().actor,
    ],
  );
}

export interface ActivityQuery {
  limit: number;
  offset?: number;
  projectId?: string;
  actor?: string;
  level?: string;
  /** kind 前缀匹配（如 'git.' 匹配 git.commit/git.checkout…） */
  kindPrefix?: string;
  /** kind 精确集合（最近查看等聚合场景） */
  kinds?: string[];
  /** ISO 日期或日期时间；since 含端、until 传 YYYY-MM-DD 时按当日末尾含端 */
  since?: string;
  until?: string;
}

export function listActivity(db: Database.Database, opts: ActivityQuery): ActivityEntry[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.projectId !== undefined && opts.projectId !== '') {
    where.push('project_id = ?');
    params.push(opts.projectId);
  }
  if (opts.actor !== undefined && opts.actor !== '') {
    where.push('actor = ?');
    params.push(opts.actor);
  }
  if (opts.level !== undefined && opts.level !== '') {
    where.push('level = ?');
    params.push(opts.level);
  }
  if (opts.kindPrefix !== undefined && opts.kindPrefix !== '') {
    where.push('kind LIKE ?');
    params.push(`${opts.kindPrefix}%`);
  }
  if (opts.kinds !== undefined && opts.kinds.length > 0) {
    where.push(`kind IN (${opts.kinds.map(() => '?').join(',')})`);
    params.push(...opts.kinds);
  }
  if (opts.since !== undefined && opts.since !== '') {
    where.push('at >= ?');
    params.push(opts.since);
  }
  if (opts.until !== undefined && opts.until !== '') {
    where.push('at <= ?');
    params.push(/^\d{4}-\d{2}-\d{2}$/.test(opts.until) ? `${opts.until}T23:59:59.999` : opts.until);
  }
  const rows = getAll<ActivityRow>(
    db,
    `SELECT * FROM activity_log ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY at DESC, id DESC LIMIT ? OFFSET ?`,
    [...params, opts.limit, opts.offset ?? 0],
  );
  return rows.map((r) => ({
    id: r.id,
    at: r.at,
    kind: r.kind,
    level: r.level,
    projectId: r.project_id,
    targetPath: r.target_path,
    detail: safeParse(r.detail_json),
    actor: r.actor,
  }));
}

function safeParse(s: string | null): unknown {
  if (s === null) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

export function addSearchHistory(db: Database.Database, query: string): void {
  run(db, 'INSERT INTO search_history (query, at) VALUES (?, ?)', [query, new Date().toISOString()]);
}

export function listSearchHistory(db: Database.Database, limit: number): string[] {
  const rows = getAll<{ query: string }>(
    db,
    'SELECT DISTINCT query FROM search_history ORDER BY id DESC LIMIT ?',
    [limit],
  );
  return rows.map((r) => r.query);
}

export function recordRecentFile(db: Database.Database, projectId: string, path: string): void {
  run(
    db,
    `INSERT INTO recent_files (project_id, path, opened_at, open_count) VALUES (?, ?, ?, 1)
     ON CONFLICT(project_id, path) DO UPDATE SET opened_at = excluded.opened_at, open_count = open_count + 1`,
    [projectId, path, new Date().toISOString()],
  );
}

export function listRecentFiles(
  db: Database.Database,
  limit: number,
  projectId?: string,
): Array<{ projectId: string; path: string; openedAt: string; openCount: number }> {
  const rows =
    projectId !== undefined && projectId !== ''
      ? getAll<{ project_id: string; path: string; opened_at: string; open_count: number }>(
          db,
          'SELECT project_id, path, opened_at, open_count FROM recent_files WHERE project_id = ? ORDER BY opened_at DESC LIMIT ?',
          [projectId, limit],
        )
      : getAll<{ project_id: string; path: string; opened_at: string; open_count: number }>(
          db,
          'SELECT project_id, path, opened_at, open_count FROM recent_files ORDER BY opened_at DESC LIMIT ?',
          [limit],
        );
  return rows.map((r) => ({
    projectId: r.project_id,
    path: r.path,
    openedAt: r.opened_at,
    openCount: r.open_count,
  }));
}
