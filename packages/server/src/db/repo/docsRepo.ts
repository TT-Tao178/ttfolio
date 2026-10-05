/** 文档根 / 挂载 / 架构图目录仓储。 */
import type { DocRoot, MountInfo, ArchiveInfo, ArchiveEntryFile } from '@ttfolio/shared';
import type Database from 'better-sqlite3';
import { getAll, getOne, run } from '../sql.js';
import { ulid } from '../../core/ulid.js';
import type { ArchiveRow, DocRootRow, ProjectPathRow } from '../rowTypes.js';

export function pathKey(p: string): string {
  return p.toLowerCase().replace(/\//g, '\\').replace(/\\+$/, '');
}

// ---------- 文档根 ----------
function mapDocRoot(r: DocRootRow): DocRoot {
  return { id: r.id, label: r.label, path: r.path, enabled: r.enabled === 1, createdAt: r.created_at };
}

export function listDocRoots(db: Database.Database): DocRoot[] {
  return getAll<DocRootRow>(db, 'SELECT * FROM doc_roots ORDER BY created_at').map(mapDocRoot);
}

export function createDocRoot(db: Database.Database, path: string, label: string | null): DocRoot {
  const id = ulid();
  run(db, 'INSERT INTO doc_roots (id, label, path, path_key, enabled, created_at) VALUES (?, ?, ?, ?, 1, ?)', [id, label, path, pathKey(path), new Date().toISOString()]);
  const row = getOne<DocRootRow>(db, 'SELECT * FROM doc_roots WHERE id = ?', [id]);
  if (row === undefined) throw new Error('insert doc root failed');
  return mapDocRoot(row);
}

export function deleteDocRoot(db: Database.Database, id: string): boolean {
  const r = run(db, 'DELETE FROM doc_roots WHERE id = ?', [id]);
  return r.changes > 0;
}

// ---------- 挂载 ----------
function mapMount(r: ProjectPathRow): MountInfo {
  return {
    id: r.id,
    kind: r.kind === 'file' ? 'file' : 'dir',
    path: r.path,
    label: r.label,
    source: r.source === 'auto_root' ? 'auto_root' : 'manual',
    existsOk: r.exists_ok === 1,
    lastCheckedAt: r.last_checked_at
  };
}

export function listMounts(db: Database.Database, projectId: string): MountInfo[] {
  return getAll<ProjectPathRow>(db, 'SELECT * FROM project_paths WHERE project_id = ? ORDER BY created_at', [projectId]).map(mapMount);
}

export function listAllMounts(db: Database.Database): Array<MountInfo & { projectId: string }> {
  return getAll<ProjectPathRow>(db, 'SELECT * FROM project_paths ORDER BY created_at').map((r) => ({ ...mapMount(r), projectId: r.project_id }));
}

export function createMount(db: Database.Database, data: { projectId: string; kind: 'dir' | 'file'; path: string; label: string | null; source: 'auto_root' | 'manual'; rootId: string | null }): MountInfo {
  const id = ulid();
  run(
    db,
    `INSERT INTO project_paths (id, project_id, kind, path, path_key, label, source, root_id, exists_ok, last_checked_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(project_id, path_key) DO NOTHING`,
    [id, data.projectId, data.kind, data.path, pathKey(data.path), data.label, data.source, data.rootId, new Date().toISOString(), new Date().toISOString()]
  );
  const row = getOne<ProjectPathRow>(db, 'SELECT * FROM project_paths WHERE project_id = ? AND path_key = ?', [data.projectId, pathKey(data.path)]);
  if (row === undefined) throw new Error('insert mount failed');
  return mapMount(row);
}

export function deleteMount(db: Database.Database, id: string): boolean {
  const r = run(db, 'DELETE FROM project_paths WHERE id = ?', [id]);
  return r.changes > 0;
}

export function getMount(db: Database.Database, id: string): (MountInfo & { projectId: string }) | null {
  const row = getOne<ProjectPathRow>(db, 'SELECT * FROM project_paths WHERE id = ?', [id]);
  if (row === undefined) return null;
  return { ...mapMount(row), projectId: row.project_id };
}

export function setMountExists(db: Database.Database, id: string, ok: boolean): void {
  run(db, 'UPDATE project_paths SET exists_ok = ?, last_checked_at = ? WHERE id = ?', [ok ? 1 : 0, new Date().toISOString(), id]);
}

// ---------- 架构图 ----------
export function listArchives(db: Database.Database, projectId: string): ArchiveRow[] {
  return getAll<ArchiveRow>(db, 'SELECT * FROM archives WHERE project_id = ? ORDER BY is_default DESC, created_at', [projectId]);
}

export function getArchive(db: Database.Database, id: string): ArchiveRow | undefined {
  return getOne<ArchiveRow>(db, 'SELECT * FROM archives WHERE id = ?', [id]);
}

export function upsertArchive(db: Database.Database, data: {
  projectId: string;
  dirPath: string;
  label: string | null;
  isDefault: boolean;
  htmlCount: number;
  totalBytes: number;
  entryRel: string | null;
  entrySource: 'index_html' | 'manual' | 'list';
}): ArchiveRow {
  const existing = getOne<ArchiveRow>(db, 'SELECT * FROM archives WHERE project_id = ? AND dir_path_key = ?', [data.projectId, pathKey(data.dirPath)]);
  const now = new Date().toISOString();
  if (existing !== undefined) {
    run(db, 'UPDATE archives SET label = ?, html_count = ?, total_bytes = ?, entry_rel = ?, entry_source = ?, is_default = ?, last_seen_at = ? WHERE id = ?', [data.label, data.htmlCount, data.totalBytes, data.entryRel, data.entrySource, data.isDefault ? 1 : 0, now, existing.id]);
    const updated = getArchive(db, existing.id);
    if (updated === undefined) throw new Error('archive update failed');
    return updated;
  }
  const id = ulid();
  run(
    db,
    `INSERT INTO archives (id, project_id, label, dir_path, dir_path_key, entry_rel, entry_source, html_count, total_bytes, is_default, last_seen_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, data.projectId, data.label, data.dirPath, pathKey(data.dirPath), data.entryRel, data.entrySource, data.htmlCount, data.totalBytes, data.isDefault ? 1 : 0, now, now]
  );
  const created = getArchive(db, id);
  if (created === undefined) throw new Error('archive insert failed');
  return created;
}

export function patchArchive(db: Database.Database, id: string, fields: { entryRel?: string | null; entrySource?: 'index_html' | 'manual' | 'list'; isDefault?: boolean; label?: string | null }): boolean {
  const row = getArchive(db, id);
  if (row === undefined) return false;
  run(db, 'UPDATE archives SET entry_rel = ?, entry_source = ?, is_default = ?, label = ? WHERE id = ?', [
    fields.entryRel !== undefined ? fields.entryRel : row.entry_rel,
    fields.entrySource ?? row.entry_source,
    (fields.isDefault ?? row.is_default === 1) ? 1 : 0,
    fields.label !== undefined ? fields.label : row.label,
    id
  ]);
  return true;
}

export function deleteArchive(db: Database.Database, id: string): boolean {
  const r = run(db, 'DELETE FROM archives WHERE id = ?', [id]);
  return r.changes > 0;
}

export function setArchiveViewed(db: Database.Database, id: string): void {
  run(db, 'UPDATE archives SET last_viewed_at = ? WHERE id = ?', [new Date().toISOString(), id]);
}

export function toArchiveInfo(
  row: ArchiveRow,
  htmlFiles: ArchiveEntryFile[],
  sourceJsonFiles: string[],
  changed: boolean,
  imageFiles: ArchiveEntryFile[] = []
): ArchiveInfo {
  return {
    id: row.id,
    label: row.label,
    dirPath: row.dir_path,
    entryRel: row.entry_rel,
    entrySource: (['index_html', 'manual', 'list'] as const).includes(row.entry_source as 'index_html')
      ? (row.entry_source as ArchiveInfo['entrySource'])
      : 'list',
    htmlCount: row.html_count,
    totalBytes: row.total_bytes,
    isDefault: row.is_default === 1,
    lastSeenAt: row.last_seen_at,
    lastViewedAt: row.last_viewed_at,
    changed,
    htmlFiles,
    imageFiles,
    sourceJsonFiles
  };
}
