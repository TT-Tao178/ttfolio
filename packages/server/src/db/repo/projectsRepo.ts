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
  /** 父子集合含子孙聚合（FR-15.1）：集合及全部子孙 id（路由层展开） */
  collectionIds?: string[];
  /** true = 只列不属于任何集合的项目（侧栏「未分配」虚拟分组） */
  unassigned?: boolean;
  tagId?: string;
  dirty?: boolean;
  hasDocs?: boolean;
  hasArch?: boolean;
  q?: string;
  sort?: 'last_opened' | 'last_commit' | 'name' | 'size';
  pathOk?: boolean;
  analyzed?: boolean;
  staleDays?: number;
  /** 主语言等值过滤（FR-4.11 自定义视图）：lower(primary_language) = lower(?) */
  lang?: string;
  /** 技术栈子串过滤：tech_stack 为 JSON 数组列，LIKE 即子串命中 */
  stack?: string;
  /** Git 状态过滤：dirty=有未提交改动 / clean=仓库干净 / nogit=非 Git 仓库 */
  git?: 'dirty' | 'clean' | 'nogit';
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
    // 修复（第 62 轮测试抓到的真实缺陷）：better-sqlite3 12.x 关闭了双引号字符串
    //（DQS=0），datetime("now") 会报 no such column——必须用单引号字面量
    where.push("(last_opened_at IS NULL OR last_opened_at < datetime('now', ?))");
    params.push(`-${filters.staleDays} days`);
  }
  if (filters.lang !== undefined && filters.lang !== '') {
    where.push('lower(primary_language) = ?');
    params.push(filters.lang.toLowerCase());
  }
  if (filters.stack !== undefined && filters.stack !== '') {
    where.push('lower(tech_stack) LIKE ?');
    params.push(`%${filters.stack.toLowerCase()}%`);
  }
  if (filters.git !== undefined) {
    if (filters.git === 'dirty') where.push('(git_is_repo = 1 AND git_dirty = 1)');
    else if (filters.git === 'clean') where.push('(git_is_repo = 1 AND git_dirty = 0)');
    else where.push('git_is_repo = 0');
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
  if (filters.collectionIds !== undefined) {
    // 父子集合含子孙聚合（FR-15.1）：路由层已把子孙 id 展开进列表
    const ids = filters.collectionIds;
    if (ids.length === 0) {
      // 空集合列表 = 该集合及子孙都没有成员，直接返回空
      where.push('0 = 1');
    } else {
      where.push(
        `id IN (SELECT project_id FROM collection_members WHERE collection_id IN (${ids
          .map(() => '?')
          .join(',')}))`,
      );
      params.push(...ids);
    }
  }
  if (filters.unassigned === true) {
    // 「未分配」虚拟分组（2026-11-03 用户需求）：不属于任何集合的登记项目
    where.push('id NOT IN (SELECT project_id FROM collection_members)');
  }
  if (filters.tagId !== undefined) {
    where.push('id IN (SELECT project_id FROM project_tags WHERE tag_id = ?)');
    params.push(filters.tagId);
  }
  const orderBy = (() => {
    switch (filters.sort) {
      case 'last_commit':
        return 'is_pinned DESC, git_last_commit_at DESC';
      case 'last_opened':
        // 显式传入才按最近打开（「最近打开」视图/继续上次 chips 用）
        return 'is_pinned DESC, CASE WHEN last_opened_at IS NULL THEN 1 ELSE 0 END, last_opened_at DESC';
      case 'size':
        return 'is_pinned DESC, size_bytes DESC';
      default:
        // 默认按名称稳定排序（2026-11-03 用户反馈：此前默认最近打开，「点开一个项目
        // 就被顶到列表最前」——侧栏/卡片墙/未分配成员列表全部会跳位置，已去掉）。
        // 打开计数仍照常上报，「最近打开」视图与继续上次 chips 不受影响。
        return 'is_pinned DESC, lower(coalesce(alias, disk_name)) ASC';
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

/** 复活一个被移除登记的项目：清空 deleted_at，刷新路径与目录名，rev +1。
 *  归属（集合/标签）已在移除登记时清空（2026-11-03 行为反转），复活即干净落回公共池；
 *  别名/备注/头像/打开计数保留。 */
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
  // 行为反转（用户 2026-11-03 拍板）：移除登记即清组织归属——集合/标签成员行随软删
  // 一并删除，「同路径再导入」落回公共池，不再自动回到上次的集合/标签
  // （原「复活归属恢复」设计废弃）。别名/备注/头像/打开计数保留。
  // 存量软删项目的残留成员行由迁移 0014 一次性清理。
  run(db, 'UPDATE projects SET deleted_at = ?, updated_at = ? WHERE id = ?', [now3, now3, id]);
  run(db, 'DELETE FROM collection_members WHERE project_id = ?', [id]);
  run(db, 'DELETE FROM project_tags WHERE project_id = ?', [id]);
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

/** FR-15.1 父子集合写入校验：父存在、防环（新父不得在自身子树内）、深度 ≤3。
 *  id=null 表示新建节点（无自身子树，高度视为 1）。返回错误文案或 null（通过）。 */
export function collectionParentError(
  cols: CollectionMeta[],
  id: string | null,
  parentId: string | null,
): string | null {
  if (parentId === null) return null;
  const byId = new Map(cols.map((c) => [c.id, c]));
  if (!byId.has(parentId)) return '父集合不存在';
  // FR-16.2：规则集合不参与父子嵌套（不可为父亦不可为子）
  if (id !== null && byId.get(id)?.kind === 'rule') return '规则集合不参与父子嵌套';
  if (byId.get(parentId)?.kind === 'rule') return '规则集合不参与父子嵌套';
  if (id !== null && parentId === id) return '父集合不能是自身';
  if (id !== null) {
    // 防环：沿新父的祖先链向上走，遇到自身 = 新父在自身子树内
    let cur: string | null = parentId;
    while (cur !== null) {
      if (cur === id) return '不能把子孙集合设为父集合（会形成环）';
      cur = byId.get(cur)?.parentId ?? null;
    }
  }
  // 深度：新位置自身层级 + 被移动子树高度 ≤ 3（新建节点高度视为 1）
  let depth = 1;
  let cur: string | null = parentId;
  while (cur !== null) {
    depth += 1;
    cur = byId.get(cur)?.parentId ?? null;
  }
  const height = (function h(cid: string): number {
    let max = 1;
    for (const c of cols) if (c.parentId === cid) max = Math.max(max, 1 + h(c.id));
    return max;
  })(id ?? '');
  if (depth + (id !== null ? height : 1) - 1 > 3) return '嵌套深度超限（最深 3 层）';
  return null;
}

/** 规则集合成员现算（FR-16.2 / T-133）：active 项目逐条判条件（contains 不区分大小写；
 *  tag 按标签名包含）。返回按条件全部命中的项目 id。 */
export function ruleMemberProjectIds(
  db: Database.Database,
  rules: { conditions: Array<{ field: 'path' | 'name' | 'language' | 'stack' | 'tag'; value: string }> },
): string[] {
  const rows = getAll<{
    id: string;
    dir_path: string;
    disk_name: string;
    alias: string | null;
    primary_language: string | null;
    tech_stack: string | null;
  }>(
    db,
    'SELECT id, dir_path, disk_name, alias, primary_language, tech_stack FROM projects WHERE deleted_at IS NULL',
  );
  const tagRows = getAll<{ project_id: string; name: string }>(
    db,
    'SELECT pt.project_id, t.name FROM project_tags pt JOIN tags t ON t.id = pt.tag_id',
  );
  const tagsBy = new Map<string, string[]>();
  for (const t of tagRows) {
    const arr = tagsBy.get(t.project_id) ?? [];
    arr.push(t.name.toLowerCase());
    tagsBy.set(t.project_id, arr);
  }
  const out: string[] = [];
  for (const p of rows) {
    const displayName = (p.alias ?? p.disk_name).toLowerCase();
    const tags = tagsBy.get(p.id) ?? [];
    const hit = rules.conditions.every((c0) => {
      const v = c0.value.toLowerCase();
      switch (c0.field) {
        case 'path':
          return p.dir_path.toLowerCase().includes(v);
        case 'name':
          return displayName.includes(v);
        case 'language':
          return (p.primary_language ?? '').toLowerCase().includes(v);
        case 'stack':
          return (p.tech_stack ?? '').toLowerCase().includes(v);
        case 'tag':
          return tags.some((t) => t.includes(v));
        default:
          return false;
      }
    });
    if (hit) out.push(p.id);
  }
  return out;
}

function parseCollectionRules(
  raw: string | null,
): { conditions: Array<{ field: 'path' | 'name' | 'language' | 'stack' | 'tag'; value: string }> } | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      Array.isArray((parsed as { conditions?: unknown }).conditions)
    ) {
      return parsed as {
        conditions: Array<{ field: 'path' | 'name' | 'language' | 'stack' | 'tag'; value: string }>;
      };
    }
  } catch {
    // 坏值兜底视为无规则
  }
  return null;
}

export function listCollections(db: Database.Database): CollectionMeta[] {
  const rows = getAll<CollectionRow>(db, 'SELECT * FROM collections ORDER BY sort_order, created_at');
  return rows.map((r) => {
    // JOIN projects 过滤已删项目：现行为（2026-11-03 反转）下 softDeleteProject 已即时
    // 清成员行、迁移 0014 清了存量，理论上不再有孤儿行；过滤保留作纵深防御
    // （2026-10-31 报障：孤儿成员行曾让侧栏集合计数不归零）
    const kind = r.kind === 'rule' ? 'rule' : 'manual';
    let memberCount = 0;
    let projectIds: string[] = [];
    if (kind === 'rule') {
      // 规则集合（FR-16.2）：成员查询时现算，不读成员表
      const rules = parseCollectionRules(r.rules_json);
      projectIds = rules !== null ? ruleMemberProjectIds(db, rules) : [];
      memberCount = projectIds.length;
    } else {
      const members = getAll<{ project_id: string }>(
        db,
        `SELECT cm.project_id FROM collection_members cm
         JOIN projects p ON p.id = cm.project_id
         WHERE cm.collection_id = ? AND p.deleted_at IS NULL`,
        [r.id],
      );
      const c = getOne<{ c: number }>(
        db,
        `SELECT COUNT(*) AS c FROM collection_members cm
         JOIN projects p ON p.id = cm.project_id
         WHERE cm.collection_id = ? AND p.deleted_at IS NULL`,
        [r.id],
      );
      memberCount = c?.c ?? 0;
      projectIds = members.map((m) => m.project_id);
    }
    return {
      id: r.id,
      name: r.name,
      note: r.note,
      parentId: r.parent_id ?? null,
      kind,
      rules: kind === 'rule' ? parseCollectionRules(r.rules_json) : null,
      memberCount,
      projectIds,
      sortOrder: r.sort_order,
    };
  });
}
