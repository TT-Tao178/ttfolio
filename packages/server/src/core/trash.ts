/**
 * 回收站（C-03/C-16/8.11）：删除 = 移动到数据目录 trash/<ulid>/，库中记录原路径，可恢复。
 * 跨盘 = 复制 + 校验 + 删源（失败绝不删源）。
 */
import path from 'node:path';
import { existsSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import type Database from 'better-sqlite3';
import { getAll } from '../db/sql.js';
import type { TrashItem } from '@ttfolio/shared';
import { AppError } from './errors.js';
import * as fsx from './fsx.js';
import { insertTrash, getTrashRow, deleteTrashRow } from '../db/repo/filesRepo.js';
import type { TrashRow } from '../db/rowTypes.js';

export class TrashService {
  constructor(private readonly trashDir: string) {}

  /** 把若干路径移入回收站，返回回收站条目 id。 */
  moveToTrash(db: Database.Database, paths: string[], projectId: string | null, originProjectPath: string | null): string[] {
    const ids: string[] = [];
    for (const p of paths) {
      const st = statSync(p);
      const kind = st.isDirectory() ? 'dir' : 'file';
      const id = insertTrash(db, {
        projectId,
        originPath: p,
        originProjectPath,
        trashRelPath: '', // 先占位，拿到 id 后更新
        kind,
        sizeBytes: st.size
      });
      const destDir = path.join(this.trashDir, id);
      fsx.ensureDir(destDir);
      const dest = path.join(destDir, path.basename(p));
      try {
        renameSync(p, dest);
      } catch (err) {
        // 跨盘：复制 + 校验 + 删源
        if (isExdev(err)) {
          fsx.copyRecursive(p, dest);
          fsx.verifyRecursive(p, dest);
          rmSync(p, { recursive: true, force: false });
        } else {
          deleteTrashRow(db, id);
          try {
            rmSync(destDir, { recursive: true, force: true });
          } catch {
            /* 清理失败忽略 */
          }
          throw err;
        }
      }
      fsx.markSelfWrite(dest);
      db.prepare('UPDATE trash SET trash_rel_path = ? WHERE id = ?').run(
        path.join(id, path.basename(p)),
        id
      );
      ids[ids.length] = id;
    }
    return ids;
  }

  list(db: Database.Database): TrashItem[] {
    const rows = db.prepare<[], TrashRow>('SELECT * FROM trash ORDER BY deleted_at DESC').all();
    return rows.map((r) => {
      const segs = r.origin_path.split(/[\\/]/).filter((s) => s !== '');
      return {
        id: r.id,
        projectId: r.project_id,
        originPath: r.origin_path,
        kind: r.kind === 'dir' ? 'dir' : 'file',
        sizeBytes: r.size_bytes,
        deletedAt: r.deleted_at,
        name: segs[segs.length - 1] ?? r.origin_path
      };
    });
  }

  /** 预览：条目内文件清单（前 50 条）。 */
  previewEntries(id: string, limit = 50): string[] {
    const row = getTrashRowCompat(this.trashDir, id);
    if (row === null) return [];
    const abs = path.join(this.trashDir, row.trash_rel_path);
    if (!existsSync(abs)) return [];
    const out: string[] = [];
    if (statSync(abs).isFile()) return [path.basename(abs)];
    const stack = [''];
    while (stack.length > 0 && out.length < limit) {
      const rel = stack.pop();
      if (rel === undefined) break;
      const full = rel === '' ? abs : path.join(abs, rel);
      let entries;
      try {
        entries = fsx.listEntries(full);
      } catch {
        continue;
      }
      for (const e of entries) {
        const relChild = rel === '' ? e.name : `${rel}/${e.name}`;
        if (e.isDir) stack.concat([relChild]);
        if (e.isDir) stack[stack.length] = relChild;
        else out[out.length] = relChild;
      }
    }
    return out;
  }

  /** 恢复到原路径；目标被占用时返回 'taken'。 */
  restore(db: Database.Database, id: string, targetDir?: string): { status: 'ok' | 'taken'; restoredTo?: string } {
    const row = getTrashRow(db, id);
    if (row === undefined) throw new AppError('NOT_FOUND', '回收站条目不存在');
    const src = path.join(this.trashDir, row.trash_rel_path);
    if (!existsSync(src)) {
      deleteTrashRow(db, id);
      throw new AppError('IO_ERROR', '回收站内容已丢失，条目已清除');
    }
    const name = path.basename(row.origin_path);
    const parent = targetDir ?? path.dirname(row.origin_path);
    const dest = path.join(parent, name);
    if (existsSync(dest)) {
      return { status: 'taken' };
    }
    fsx.ensureDir(parent);
    try {
      renameSync(src, dest);
    } catch (err) {
      if (isExdev(err)) {
        fsx.copyRecursive(src, dest);
        fsx.verifyRecursive(src, dest);
        rmSync(src, { recursive: true, force: false });
      } else {
        throw err;
      }
    }
    fsx.markSelfWrite(dest);
    deleteTrashRow(db, id);
    try {
      rmSync(path.join(this.trashDir, row.id), { recursive: true, force: true });
    } catch {
      /* 目录可能非空（多同名场景），忽略 */
    }
    return { status: 'ok', restoredTo: dest };
  }

  purge(db: Database.Database, id: string): void {
    const row = getTrashRow(db, id);
    if (row === undefined) return;
    const abs = path.join(this.trashDir, row.trash_rel_path);
    try {
      rmSync(abs, { recursive: true, force: true });
    } catch {
      /* 已不存在则忽略 */
    }
    deleteTrashRow(db, id);
  }

  /** 清空（可取消，逐条删除，失败项保留）。 */
  empty(db: Database.Database, ctx: { checkCancelled(): void; progress(done: number, total: number): void }): { removed: number; failed: number } {
    const rows = db.prepare<[], TrashRow>('SELECT * FROM trash').all();
    let removed = 0;
    let failed = 0;
    for (let i = 0; i < rows.length; i++) {
      ctx.checkCancelled();
      const row = rows[i];
      if (row === undefined) continue;
      try {
        this.purge(db, row.id);
        removed++;
      } catch {
        failed++;
      }
      ctx.progress(i + 1, rows.length);
    }
    return { removed, failed };
  }

  /** 清理超过 retentionDays 的条目（保留策略）。 */
  purgeOlderThan(db: Database.Database, retentionDays: number): number {
    if (retentionDays <= 0) return 0;
    const cutoff = Date.now() - retentionDays * 24 * 3600 * 1000;
    const rows = getAll<TrashRow>(db, 'SELECT * FROM trash WHERE deleted_at < ?', [new Date(cutoff).toISOString()]);
    let removed = 0;
    for (const row of rows) {
      this.purge(db, row.id);
      removed++;
    }
    return removed;
  }
}

function isExdev(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: unknown }).code === 'EXDEV'
  );
}

function getTrashRowCompat(_dir: string, id: string): TrashRow | null {
  // 由路由层传入 db 后走 getTrashRow；这里仅用于 previewEntries 的独立路径检查
  void _dir;
  void id;
  return null;
}
