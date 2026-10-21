/** 任务历史（FR-13.11 / T-108）：task_runs 落库与查询；保留 30 天启动清理。 */
import type Database from 'better-sqlite3';
import { getAll, getOne, run } from '../sql.js';

export interface TaskRunRow {
  id: string;
  kind: string;
  title: string;
  status: string;
  done: number | null;
  total: number | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

export interface TaskRunInfo {
  id: string;
  kind: string;
  title: string;
  status: string;
  done: number | null;
  total: number | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
}

function map(r: TaskRunRow): TaskRunInfo {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    status: r.status,
    done: r.done,
    total: r.total,
    error: r.error,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    durationMs:
      r.finished_at !== null ? Math.max(0, Date.parse(r.finished_at) - Date.parse(r.started_at)) : null,
  };
}

export function insertTaskRun(
  db: Database.Database,
  v: { id: string; kind: string; title: string; startedAt: string },
): void {
  run(db, 'INSERT OR IGNORE INTO task_runs (id, kind, title, status, started_at) VALUES (?, ?, ?, ?, ?)', [
    v.id,
    v.kind,
    v.title,
    'running',
    v.startedAt,
  ]);
}

export function finishTaskRun(
  db: Database.Database,
  v: {
    id: string;
    status: 'done' | 'error' | 'cancelled';
    error: string | null;
    finishedAt: string;
    done: number;
    total: number;
  },
): void {
  run(db, 'UPDATE task_runs SET status = ?, error = ?, finished_at = ?, done = ?, total = ? WHERE id = ?', [
    v.status,
    v.error,
    v.finishedAt,
    v.done,
    v.total,
    v.id,
  ]);
}

export function listTaskRuns(db: Database.Database, limit: number): TaskRunInfo[] {
  return getAll<TaskRunRow>(db, 'SELECT * FROM task_runs ORDER BY started_at DESC, id DESC LIMIT ?', [
    limit,
  ]).map(map);
}

/** 清理超过 keepDays 天的历史；返回删除行数。 */
export function purgeOldTaskRuns(db: Database.Database, keepDays: number): number {
  const cutoff = new Date(Date.now() - keepDays * 24 * 3600 * 1000).toISOString();
  return run(db, 'DELETE FROM task_runs WHERE started_at < ?', [cutoff]).changes;
}

/** 卡死兜底：进程崩溃后 status 停在 running 的行，按启动时间超时判死（默认 24h）。 */
export function failStaleRunningTaskRuns(db: Database.Database, timeoutHours = 24): void {
  const cutoff = new Date(Date.now() - timeoutHours * 3600 * 1000).toISOString();
  run(
    db,
    "UPDATE task_runs SET status = 'error', error = '进程中断（未正常结束）', finished_at = ? WHERE status = 'running' AND started_at < ?",
    [new Date().toISOString(), cutoff],
  );
}

export function getTaskRun(db: Database.Database, id: string): TaskRunInfo | null {
  const r = getOne<TaskRunRow>(db, 'SELECT * FROM task_runs WHERE id = ?', [id]);
  return r === undefined ? null : map(r);
}
