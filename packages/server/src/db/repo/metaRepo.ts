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

export function listActivity(db: Database.Database, limit: number, projectId?: string): ActivityEntry[] {
  const rows =
    projectId !== undefined
      ? getAll<ActivityRow>(
          db,
          'SELECT * FROM activity_log WHERE project_id = ? ORDER BY at DESC, id DESC LIMIT ?',
          [projectId, limit],
        )
      : getAll<ActivityRow>(db, 'SELECT * FROM activity_log ORDER BY at DESC, id DESC LIMIT ?', [limit]);
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
): Array<{ projectId: string; path: string; openedAt: string; openCount: number }> {
  const rows = getAll<{ project_id: string; path: string; opened_at: string; open_count: number }>(
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
