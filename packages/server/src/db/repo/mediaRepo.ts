/** 媒体仓储（FR-13.5 / T-099，EN-7：SQL 收敛于此）。
 * 只记路径与元数据（bytes/mtime + 预留 w/h/duration），不复制媒体本体。 */
import type { MediaItem, MediaKind } from '@ttfolio/shared';
import type Database from 'better-sqlite3';
import { getAll, run } from '../sql.js';
import { ulid } from '../../core/ulid.js';
import type { MediaFileRow } from '../rowTypes.js';

function mapItem(r: MediaFileRow): MediaItem {
  return {
    path: r.path,
    kind: r.kind as MediaKind,
    bytes: r.bytes,
    mtime: r.mtime,
    w: r.w,
    h: r.h,
    durationMs: r.duration_ms,
  };
}

/** 全量重写（分析器事务内调用）：重分析幂等，文件消失即从索引移除。 */
export function replaceMediaFiles(
  db: Database.Database,
  projectId: string,
  files: Array<{ rel: string; kind: MediaKind; bytes: number; mtime: string | null }>,
): void {
  run(db, 'DELETE FROM media_files WHERE project_id = ?', [projectId]);
  const ins = db.prepare(
    'INSERT INTO media_files (id, project_id, path, kind, bytes, mtime) VALUES (?, ?, ?, ?, ?, ?)',
  );
  for (const f of files) ins.run(ulid(), projectId, f.rel, f.kind, f.bytes, f.mtime);
}

export function listMedia(db: Database.Database, projectId: string): MediaItem[] {
  return getAll<MediaFileRow>(db, 'SELECT * FROM media_files WHERE project_id = ? ORDER BY path', [
    projectId,
  ]).map(mapItem);
}

export function mediaCount(db: Database.Database, projectId: string): number {
  const c = getAll<{ c: number }>(db, 'SELECT COUNT(*) AS c FROM media_files WHERE project_id = ?', [
    projectId,
  ]);
  return c[0]?.c ?? 0;
}
