/** 标签中枢（FR-13.10 / T-107）：重命名 / 合并 / 删除 / 颜色；列表带使用计数。 */
import type Database from 'better-sqlite3';
import { getAll, getOne, run } from '../sql.js';

export interface TagWithCount {
  id: string;
  name: string;
  color: string | null;
  projectCount: number;
}

export function listTagsWithCount(db: Database.Database): TagWithCount[] {
  return getAll<TagWithCount>(
    db,
    `SELECT t.id, t.name, t.color, COUNT(pt.project_id) AS projectCount
     FROM tags t LEFT JOIN project_tags pt ON pt.tag_id = t.id
     GROUP BY t.id ORDER BY t.name`,
  );
}

export type RenameResult = 'ok' | 'notfound' | 'conflict';

/** 重命名：tags.id 不变全库引用天然同步；重名（UNIQUE）拒绝。 */
export function renameTag(db: Database.Database, id: string, name: string): RenameResult {
  const dup = getOne<{ id: string }>(db, 'SELECT id FROM tags WHERE name = ? AND id != ?', [name, id]);
  if (dup !== undefined) return 'conflict';
  const r = run(db, 'UPDATE tags SET name = ? WHERE id = ?', [name, id]);
  return r.changes > 0 ? 'ok' : 'notfound';
}

export function setTagColor(db: Database.Database, id: string, color: string | null): boolean {
  const r = run(db, 'UPDATE tags SET color = ? WHERE id = ?', [color, id]);
  return r.changes > 0;
}

export type MergeResult = { status: 'ok'; moved: number } | { status: 'same' | 'missing' };

/**
 * 合并：source 的引用迁移到 target（重复引用去重），随后删除 source
 * （外键级联清掉它剩余的 project_tags 行）。事务保证迁移与删除原子。
 */
export function mergeTag(db: Database.Database, sourceId: string, targetId: string): MergeResult {
  if (sourceId === targetId) return { status: 'same' };
  const s = getOne<{ id: string }>(db, 'SELECT id FROM tags WHERE id = ?', [sourceId]);
  const t = getOne<{ id: string }>(db, 'SELECT id FROM tags WHERE id = ?', [targetId]);
  if (s === undefined || t === undefined) return { status: 'missing' };
  let moved = 0;
  db.transaction(() => {
    const r = run(
      db,
      `INSERT OR IGNORE INTO project_tags (project_id, tag_id)
       SELECT project_id, ? FROM project_tags WHERE tag_id = ?`,
      [targetId, sourceId],
    );
    moved = r.changes;
    run(db, 'DELETE FROM tags WHERE id = ?', [sourceId]);
  })();
  return { status: 'ok', moved };
}

/** 删除标签（外键级联清理引用）；返回受影响的项目数，标签不存在返回 null。 */
export function deleteTag(db: Database.Database, id: string): number | null {
  const row = getOne<{ c: number }>(
    db,
    'SELECT COUNT(DISTINCT project_id) AS c FROM project_tags WHERE tag_id = ?',
    [id],
  );
  const r = run(db, 'DELETE FROM tags WHERE id = ?', [id]);
  if (r.changes === 0) return null;
  return row?.c ?? 0;
}
