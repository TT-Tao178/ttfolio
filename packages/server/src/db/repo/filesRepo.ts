/** 草稿 / 回收站元数据 / 内容索引（FTS）仓储。 */
import type { TrashItem } from '@ttfolio/shared';
import type Database from 'better-sqlite3';
import { getAll, getOne, run } from '../sql.js';
import { ulid } from '../../core/ulid.js';
import type { DraftRow, TrashRow } from '../rowTypes.js';

// ---------- 草稿 ----------
export function getDraft(db: Database.Database, scope: string, pathKeyStr: string): DraftRow | undefined {
  return getOne<DraftRow>(db, 'SELECT * FROM editor_drafts WHERE scope = ? AND path_key = ?', [
    scope,
    pathKeyStr,
  ]);
}

export function getDraftsForProject(db: Database.Database, projectId: string): DraftRow[] {
  return getAll<DraftRow>(db, 'SELECT * FROM editor_drafts WHERE project_id = ?', [projectId]);
}

export function putDraft(
  db: Database.Database,
  data: {
    scope: string;
    projectId: string | null;
    mountId: string | null;
    pathKey: string;
    content: string;
    baseMtime: string | null;
    baseSize: number | null;
    baseHash: string | null;
    encoding: string | null;
    eol: string | null;
  },
): void {
  run(
    db,
    `INSERT INTO editor_drafts (id, scope, project_id, mount_id, path_key, content, base_mtime, base_size, base_hash, encoding, eol, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(scope, path_key) DO UPDATE SET
       content = excluded.content, base_mtime = excluded.base_mtime, base_size = excluded.base_size,
       base_hash = excluded.base_hash, encoding = excluded.encoding, eol = excluded.eol,
       project_id = excluded.project_id, mount_id = excluded.mount_id, updated_at = excluded.updated_at`,
    [
      ulid(),
      data.scope,
      data.projectId,
      data.mountId,
      data.pathKey,
      data.content,
      data.baseMtime,
      data.baseSize,
      data.baseHash,
      data.encoding,
      data.eol,
      new Date().toISOString(),
    ],
  );
}

export function deleteDraft(db: Database.Database, scope: string, pathKeyStr: string): boolean {
  const r = run(db, 'DELETE FROM editor_drafts WHERE scope = ? AND path_key = ?', [scope, pathKeyStr]);
  return r.changes > 0;
}

// ---------- 回收站 ----------
function mapTrash(r: TrashRow): TrashItem {
  const segs = r.origin_path.replace(/[\\/]+$/, '').split(/[\\/]/);
  return {
    id: r.id,
    projectId: r.project_id,
    originPath: r.origin_path,
    kind: r.kind === 'dir' ? 'dir' : 'file',
    sizeBytes: r.size_bytes,
    deletedAt: r.deleted_at,
    name: segs[segs.length - 1] ?? r.origin_path,
  };
}

export function listTrash(db: Database.Database): TrashItem[] {
  return getAll<TrashRow>(db, 'SELECT * FROM trash ORDER BY deleted_at DESC').map(mapTrash);
}

export function insertTrash(
  db: Database.Database,
  data: {
    projectId: string | null;
    originPath: string;
    originProjectPath: string | null;
    trashRelPath: string;
    kind: 'file' | 'dir';
    sizeBytes: number;
  },
): string {
  const id = ulid();
  run(
    db,
    `INSERT INTO trash (id, project_id, origin_path, origin_project_path, trash_rel_path, kind, size_bytes, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      data.projectId,
      data.originPath,
      data.originProjectPath,
      data.trashRelPath,
      data.kind,
      data.sizeBytes,
      new Date().toISOString(),
    ],
  );
  return id;
}

export function getTrashRow(db: Database.Database, id: string): TrashRow | undefined {
  return getOne<TrashRow>(db, 'SELECT * FROM trash WHERE id = ?', [id]);
}

export function deleteTrashRow(db: Database.Database, id: string): boolean {
  const r = run(db, 'DELETE FROM trash WHERE id = ?', [id]);
  return r.changes > 0;
}

export function trashStats(db: Database.Database): { count: number; bytes: number } {
  const row = getOne<{ c: number; b: number }>(
    db,
    'SELECT COUNT(*) AS c, COALESCE(SUM(size_bytes),0) AS b FROM trash',
  );
  return { count: row?.c ?? 0, bytes: row?.b ?? 0 };
}

// ---------- 内容索引 ----------
export function getIndexState(
  db: Database.Database,
  projectId: string,
): Map<string, { mtime: string; size: number }> {
  const rows = getAll<{ path_key: string; mtime: string | null; size: number | null }>(
    db,
    'SELECT path_key, mtime, size FROM content_index_state WHERE project_id = ?',
    [projectId],
  );
  const map = new Map<string, { mtime: string; size: number }>();
  for (const r of rows) map.set(r.path_key, { mtime: r.mtime ?? '', size: r.size ?? 0 });
  return map;
}

export function upsertIndexEntry(
  db: Database.Database,
  projectId: string,
  pathKeyStr: string,
  mtime: string,
  size: number,
  relPath: string,
  body: string,
): void {
  const tx = db.transaction(() => {
    run(db, 'DELETE FROM content_fts WHERE project_id = ? AND rel_path = ?', [projectId, relPath]);
    run(db, 'INSERT INTO content_fts (project_id, rel_path, body) VALUES (?, ?, ?)', [
      projectId,
      relPath,
      body,
    ]);
    run(
      db,
      `INSERT INTO content_index_state (project_id, path_key, mtime, size, indexed_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(project_id, path_key) DO UPDATE SET mtime = excluded.mtime, size = excluded.size, indexed_at = excluded.indexed_at`,
      [projectId, pathKeyStr, mtime, size, new Date().toISOString()],
    );
  });
  tx();
}

export function clearProjectIndex(db: Database.Database, projectId: string): void {
  const tx = db.transaction(() => {
    run(db, 'DELETE FROM content_fts WHERE project_id = ?', [projectId]);
    run(db, 'DELETE FROM content_index_state WHERE project_id = ?', [projectId]);
  });
  tx();
}

export function indexStats(db: Database.Database, projectId: string): { files: number; bytes: number } {
  const row = getOne<{ c: number; b: number }>(
    db,
    'SELECT COUNT(*) AS c, COALESCE(SUM(size),0) AS b FROM content_index_state WHERE project_id = ?',
    [projectId],
  );
  return { files: row?.c ?? 0, bytes: row?.b ?? 0 };
}

export interface FtsHit {
  relPath: string;
  snippet: string;
}

export function searchFts(
  db: Database.Database,
  projectId: string,
  matchExpr: string,
  limit: number,
): FtsHit[] {
  return getAll<{ rel_path: string; snippet: string }>(
    db,
    `SELECT rel_path, snippet(content_fts, 2, '[', ']', '…', 12) AS snippet
     FROM content_fts WHERE content_fts MATCH ? AND project_id = ?
     ORDER BY bm25(content_fts) LIMIT ?`,
    [matchExpr, projectId, limit],
  ).map((r) => ({ relPath: r.rel_path, snippet: r.snippet }));
}
