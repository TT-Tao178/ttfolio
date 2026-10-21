/** 项目仓储（EN-7：所有 SQL 收敛在此）。 */
import type {
  CollectionInfo,
  LanguageStat,
  ProjectStatus,
  ProjectSummary,
  ProjectType,
} from '@ttfolio/shared';
import type Database from 'better-sqlite3';
import { getAll, getOne, run } from '../sql.js';
import { ulid } from '../../core/ulid.js';
import type { CollectionRow, LanguageStatRow, ProjectRow } from '../rowTypes.js';

export interface ListFilters {
  status?: ProjectStatus | 'all';
  type?: ProjectType | 'all';
  collectionId?: string;
  tagId?: string;
  dirty?: boolean;
  hasDocs?: boolean;
  hasArch?: boolean;
  q?: string;
  sort?: 'last_opened' | 'last_commit' | 'name' | 'size';
  pathOk?: boolean;
  analyzed?: boolean;
  staleDays?: number;
}

function mapSummary(
  row: ProjectRow,
  langs: LanguageStatRow[],
  tags: string[],
  collections: string[],
): ProjectSummary {
  const totalBytes = langs.reduce((acc, l) => acc + l.bytes, 0);
  const languages: LanguageStat[] = langs.map((l) => ({
    language: l.language,
    bytes: l.bytes,
    fileCount: l.file_count,
    percent: totalBytes > 0 ? Math.round((l.bytes / totalBytes) * 1000) / 10 : 0,
  }));
  let techStack: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.tech_stack);
    if (Array.isArray(parsed)) techStack = parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    techStack = [];
  }
  return {
    id: row.id,
    alias: row.alias,
    dirPath: row.dir_path,
    diskName: row.disk_name,
    type: row.type as ProjectType,
    typeSource: row.type_source === 'manual' ? 'manual' : 'analyzed',
    primaryLanguage: row.primary_language,
    fileCount: row.file_count,
    sizeBytes: row.size_bytes,
    techStack,
    hasDocs: row.has_docs === 1,
    hasArch: row.has_arch === 1,
    gitIsRepo: row.git_is_repo === 1,
    gitBranch: row.git_branch,
    gitDirty: row.git_dirty === 1,
    gitUntracked: row.git_untracked,
    gitLastCommitAt: row.git_last_commit_at,
    gitLastCommitAuthor: row.git_last_commit_author,
    gitLastCommitSubject: row.git_last_commit_subject,
    gitHeadShort: row.git_head_short,
    status: row.status === 'archived' ? 'archived' : 'active',
    isPinned: row.is_pinned === 1,
    openCount: row.open_count,
    lastOpenedAt: row.last_opened_at,
    notes: row.notes,
    pathOk: row.path_ok === 1,
    analyzedAt: row.analyzed_at,
    analyzeMs: row.analyze_ms,
    analyzePartial: row.analyze_partial === 1,
    analyzeError: row.analyze_error,
    rev: row.rev,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    languages,
    tags,
    collections,
    externalLinks: parseExternalLinks(row.external_links_json),
  };
}

/** 外链 JSON 反序列化：坏值/类型不符回落空数组。 */
export function parseExternalLinks(raw: string | null): Array<{ label: string; url: string }> {
  if (raw === null || raw === '') return [];
  try {
    const v: unknown = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v
      .filter(
        (x): x is { label: string; url: string } =>
          typeof x === 'object' &&
          x !== null &&
          typeof (x as { label?: unknown }).label === 'string' &&
          typeof (x as { url?: unknown }).url === 'string',
      )
      .map((x) => ({ label: x.label, url: x.url }));
  } catch {
    return [];
  }
}

function loadExtras(
  db: Database.Database,
  ids: string[],
): {
  langs: Map<string, LanguageStatRow[]>;
  tags: Map<string, string[]>;
  collections: Map<string, string[]>;
} {
  const langs = new Map<string, LanguageStatRow[]>();
  const tags = new Map<string, string[]>();
  const collections = new Map<string, string[]>();
  if (ids.length === 0) return { langs, tags, collections };
  const list = [...ids];
  const langRows = getAll<LanguageStatRow>(
    db,
    `SELECT project_id, language, bytes, file_count FROM language_stats
     WHERE project_id IN (${list.map(() => '?').join(',')}) ORDER BY bytes DESC`,
    list,
  );
  for (const r of langRows) {
    const arr = langs.get(r.project_id) ?? [];
    arr.push(r);
    langs.set(r.project_id, arr);
  }
  const tagRows = getAll<{ project_id: string; name: string }>(
    db,
    `SELECT pt.project_id, t.name FROM project_tags pt JOIN tags t ON t.id = pt.tag_id
     WHERE pt.project_id IN (${list.map(() => '?').join(',')})`,
    list,
  );
  for (const r of tagRows) {
    const arr = tags.get(r.project_id) ?? [];
    arr.push(r.name);
    tags.set(r.project_id, arr);
  }
  const colRows = getAll<{ project_id: string; collection_id: string }>(
    db,
    `SELECT project_id, collection_id FROM collection_members
     WHERE project_id IN (${list.map(() => '?').join(',')})`,
    list,
  );
  for (const r of colRows) {
    const arr = collections.get(r.project_id) ?? [];
    arr.push(r.collection_id);
    collections.set(r.project_id, arr);
  }
  return { langs, tags, collections };
}

export function listProjects(db: Database.Database, filters: ListFilters): ProjectSummary[] {
  const where: string[] = ['deleted_at IS NULL'];
  const params: unknown[] = [];
  if (filters.status !== undefined && filters.status !== 'all') {
    where.push('status = ?');
    params.push(filters.status);
  }
  if (filters.type !== undefined && filters.type !== 'all') {
    where.push('type = ?');
    params.push(filters.type);
  }
  if (filters.dirty !== undefined) {
    where.push('git_dirty = ?');
    params.push(filters.dirty ? 1 : 0);
  }
  if (filters.hasDocs !== undefined) {
    where.push('has_docs = ?');
    params.push(filters.hasDocs ? 1 : 0);
  }
  if (filters.hasArch !== undefined) {
    where.push('has_arch = ?');
    params.push(filters.hasArch ? 1 : 0);
  }
  if (filters.pathOk !== undefined) {
    where.push('path_ok = ?');
    params.push(filters.pathOk ? 1 : 0);
  }
  if (filters.analyzed !== undefined) {
    if (filters.analyzed) where.push('analyzed_at IS NOT NULL');
    else where.push('analyzed_at IS NULL');
  }
  if (filters.staleDays !== undefined) {
    where.push('(last_opened_at IS NULL OR last_opened_at < datetime("now", ?))');
    params.push(`-${filters.staleDays} days`);
  }
  if (filters.q !== undefined && filters.q !== '') {
    const like = `%${filters.q.toLowerCase()}%`;
    where.push(
      '(lower(alias) LIKE ? OR lower(disk_name) LIKE ? OR lower(dir_path) LIKE ? OR lower(tech_stack) LIKE ?)',
    );
    params.push(like, like, like, like);
  }
  if (filters.collectionId !== undefined) {
    where.push('id IN (SELECT project_id FROM collection_members WHERE collection_id = ?)');
    params.push(filters.collectionId);
  }
  if (filters.tagId !== undefined) {
    where.push('id IN (SELECT project_id FROM project_tags WHERE tag_id = ?)');
    params.push(filters.tagId);
  }
  const orderBy = (() => {
    switch (filters.sort) {
      case 'last_commit':
        return 'is_pinned DESC, git_last_commit_at DESC';
      case 'name':
        return 'is_pinned DESC, lower(coalesce(alias, disk_name)) ASC';
      case 'size':
        return 'is_pinned DESC, size_bytes DESC';
      case 'last_opened':
      default:
        return 'is_pinned DESC, CASE WHEN last_opened_at IS NULL THEN 1 ELSE 0 END, last_opened_at DESC';
    }
  })();
  const rows = getAll<ProjectRow>(
    db,
    `SELECT * FROM projects WHERE ${where.join(' AND ')} ORDER BY ${orderBy} LIMIT 1000`,
    params,
  );
  const { langs, tags, collections } = loadExtras(
    db,
    rows.map((r) => r.id),
  );
  return rows.map((r) =>
    mapSummary(r, langs.get(r.id) ?? [], tags.get(r.id) ?? [], collections.get(r.id) ?? []),
  );
}

export function getProjectRow(db: Database.Database, id: string): ProjectRow | undefined {
  return getOne<ProjectRow>(db, 'SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL', [id]);
}

export function getProjectSummary(db: Database.Database, id: string): ProjectSummary | null {
  const row = getProjectRow(db, id);
  if (row === undefined) return null;
  const extras = loadExtras(db, [id]);
  return mapSummary(
    row,
    extras.langs.get(id) ?? [],
    extras.tags.get(id) ?? [],
    extras.collections.get(id) ?? [],
  );
}

export function getProjectByPathKey(db: Database.Database, keyArg: string): ProjectRow | undefined {
  return getOne<ProjectRow>(db, 'SELECT * FROM projects WHERE dir_path_key = ? AND deleted_at IS NULL', [
    keyArg,
  ]);
}

/**
 * 按路径键找"已被移除登记"（软删除）的行。
 * 为什么需要：`dir_path_key` 上有 UNIQUE 约束，而移除登记走的是软删除（deleted_at 置位）。
 * 只查未删除行的话，重新登记同一目录会撞 UNIQUE，报成 SQLITE_CONSTRAINT_UNIQUE / IO_ERROR 500
 * ——实测"移除登记后无法再导入同一目录"。找到软删除行后可原地复活（保留原有别名/备注）。
 */
export function getRemovedProjectByPathKey(db: Database.Database, keyArg: string): ProjectRow | undefined {
  return getOne<ProjectRow>(db, 'SELECT * FROM projects WHERE dir_path_key = ? AND deleted_at IS NOT NULL', [
    keyArg,
  ]);
}

/** 复活一个被移除登记的项目：清空 deleted_at，刷新路径与目录名，rev +1。 */
export function reviveProject(
  db: Database.Database,
  id: string,
  data: { dirPath: string; diskName: string },
): ProjectRow | undefined {
  const now = new Date().toISOString();
  run(
    db,
    `UPDATE projects SET deleted_at = NULL, dir_path = ?, disk_name = ?, path_ok = 1,
       path_checked_at = ?, updated_at = ?, rev = rev + 1 WHERE id = ?`,
    [data.dirPath, data.diskName, now, now, id],
  );
  return getProjectRow(db, id);
}

export function insertProject(
  db: Database.Database,
  data: { dirPath: string; dirPathKey: string; diskName: string; defaultArchDir: string },
): ProjectRow {
  const now = new Date().toISOString();
  const id = ulid();
  run(
    db,
    `INSERT INTO projects (id, dir_path, dir_path_key, disk_name, default_arch_dir, created_at, updated_at, path_checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, data.dirPath, data.dirPathKey, data.diskName, data.defaultArchDir, now, now, now],
  );
  const row = getProjectRow(db, id);
  if (row === undefined) throw new Error('insert project failed');
  return row;
}

export function patchProject(db: Database.Database, id: string, fields: Record<string, unknown>): number {
  const keys = Object.keys(fields);
  if (keys.length === 0) return getProjectRow(db, id)?.rev ?? 1;
  const cur = getProjectRow(db, id);
  if (cur === undefined) return 0;
  const nextRev = cur.rev + 1;
  const sets = keys.map((k) => `${k} = ?`);
  sets.push('rev = ?', 'updated_at = ?');
  const values: unknown[] = keys.map((k) => fields[k]);
  values.push(nextRev, new Date().toISOString(), id);
  run(db, `UPDATE projects SET ${sets.join(', ')} WHERE id = ?`, values);
  return nextRev;
}

export function markOpened(db: Database.Database, id: string): void {
  const now2 = new Date().toISOString();
  run(
    db,
    'UPDATE projects SET open_count = open_count + 1, last_opened_at = ?, updated_at = ? WHERE id = ?',
    [now2, now2, id],
  );
}

/**
 * 打开时是否需要静默重分析（FR-3.1 SHOULD，第 36 轮 A1 补齐 KNOWN-GAPS #3）：
 * analyzed_at 超过 7 天即需要。从未分析（null）不算——大项目的全量分析必须
 * 由用户显式触发，不随打开隐式发生。now/maxAgeMs 供测试注入。
 */
export function needsReanalyze(
  row: { analyzed_at: string | null },
  now: number = Date.now(),
  maxAgeMs: number = 7 * 24 * 60 * 60 * 1000,
): boolean {
  if (row.analyzed_at === null) return false;
  const t = Date.parse(row.analyzed_at);
  if (!Number.isFinite(t)) return false;
  return now - t > maxAgeMs;
}

export function softDeleteProject(db: Database.Database, id: string): void {
  const now3 = new Date().toISOString();
  run(db, 'UPDATE projects SET deleted_at = ?, updated_at = ? WHERE id = ?', [now3, now3, id]);
}

export function checkPathOk(db: Database.Database, existsFn: (p: string) => boolean): number {
  const rows = getAll<ProjectRow>(db, 'SELECT * FROM projects WHERE deleted_at IS NULL');
  const now = new Date().toISOString();
  let missing = 0;
  for (const r of rows) {
    const isOk = existsFn(r.dir_path) ? 1 : 0;
    if (isOk === 0) missing++;
    run(db, 'UPDATE projects SET path_ok = ?, path_checked_at = ? WHERE id = ?', [isOk, now, r.id]);
  }
  return missing;
}

export interface CollectionMeta extends CollectionInfo {
  sortOrder: number;
}

export function listCollections(db: Database.Database): CollectionMeta[] {
  const rows = getAll<CollectionRow>(db, 'SELECT * FROM collections ORDER BY sort_order, created_at');
  return rows.map((r) => {
    const members = getAll<{ project_id: string }>(
      db,
      'SELECT project_id FROM collection_members WHERE collection_id = ?',
      [r.id],
    );
    const c = getOne<{ c: number }>(
      db,
      'SELECT COUNT(*) AS c FROM collection_members WHERE collection_id = ?',
      [r.id],
    );
    return {
      id: r.id,
      name: r.name,
      note: r.note,
      memberCount: c?.c ?? 0,
      projectIds: members.map((m) => m.project_id),
      sortOrder: r.sort_order,
    };
  });
}
