/** 内容索引（FR-8.3 / 8.9）：按需构建、增量、可取消；白名单 + 大小上限 + 敏感排除。 */
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { IgnoreRule } from '@ttfolio/shared';
import { INDEXABLE_EXTENSIONS, MAX_INDEX_FILE_BYTES } from '@ttfolio/shared';
import { compileIgnore, type CompiledIgnore } from './ignore.js';
import * as fsx from './fsx.js';
import {
  getIndexState,
  upsertIndexEntry,
  clearProjectIndex,
  searchFts,
  indexStats,
} from '../db/repo/filesRepo.js';
import { listIgnoreRules } from '../db/repo/rulesRepo.js';
import type { TaskContext } from './tasks.js';
import { AppError } from './errors.js';

export function buildMatcher(db: Database.Database, projectId: string | null): CompiledIgnore {
  const rules: IgnoreRule[] = listIgnoreRules(db).filter(
    (r) => r.scope === 'global' || (r.projectId !== null && r.projectId === projectId),
  );
  return compileIgnore(rules);
}

/** 遍历并构建 FTS 索引。幂等：mtime+size 未变即跳过。 */
export async function buildProjectIndex(
  db: Database.Database,
  projectId: string,
  projectRoot: string,
  ctx: TaskContext,
): Promise<{ indexed: number; skipped: number; total: number }> {
  const matcher = buildMatcher(db, projectId);
  const state = getIndexState(db, projectId);
  const files = collectIndexableFiles(projectRoot, matcher);
  let indexed = 0;
  let skipped = 0;
  let processed = 0;
  for (const abs of files) {
    ctx.checkCancelled();
    const rel = path.relative(projectRoot, abs).split(path.sep).join('/');
    const st = fsx.statSafe(abs);
    if (st === null) continue;
    processed++;
    const key = rel.toLowerCase();
    const prev = state.get(key);
    const mtimeIso = new Date(st.mtimeMs).toISOString();
    if (prev !== undefined && prev.mtime === mtimeIso && prev.size === st.size) {
      skipped++;
    } else {
      try {
        const buf = fsx.readFileSync(abs);
        const { content } = fsx.detectAndDecode(buf);
        upsertIndexEntry(db, projectId, key, mtimeIso, st.size, rel, content);
      } catch {
        // 读出失败的文件（权限/编码）跳过，不进入 state，下次重试
        continue;
      }
      indexed++;
    }
    if (processed % 200 === 0) {
      ctx.progress(processed, files.length);
      // 让出事件循环，保证取消能及时生效
      await new Promise<void>((r) => setTimeout(r, 0));
    }
  }
  ctx.progress(files.length, files.length);
  return { indexed, skipped, total: files.length };
}

function collectIndexableFiles(root: string, matcher: CompiledIgnore): string[] {
  const out: string[] = [];
  const stack: string[] = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (dir === undefined) break;
    let entries: fsx.FsEntry[];
    try {
      entries = fsx.listEntries(dir);
    } catch {
      continue;
    }
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      const rel = path.relative(root, abs).split(path.sep).join('/');
      if (e.isDir) {
        // 目录符号链接不入栈（体检 P1：junction 成环时索引永不终止）
        if (!e.isSymlink && !matcher.isHidden(rel)) stack[stack.length] = abs;
        continue;
      }
      if (matcher.isHidden(rel)) continue;
      if (matcher.isSensitive(rel)) continue;
      const ext = path.extname(e.name).replace(/^\./, '').toLowerCase();
      const nameNoExt = path.basename(e.name).toLowerCase();
      if (!INDEXABLE_EXTENSIONS.has(ext) && !INDEXABLE_EXTENSIONS.has(nameNoExt)) continue;
      const st = fsx.statSafe(abs);
      if (st === null || st.size > MAX_INDEX_FILE_BYTES || st.isDir) continue;
      out[out.length] = abs;
    }
  }
  return out;
}

/** FTS5 trigram 查询：转义用户输入并包成 phrase；<3 字符返回 null（trigram 最短 3）。 */
export function ftsMatchExpr(query: string): string | null {
  const cleaned = query.replace(/["*^:]/g, ' ').trim();
  if (cleaned.length < 3) return null;
  return `"${cleaned.replace(/"/g, '')}"`;
}

export function queryContent(
  db: Database.Database,
  projectId: string,
  query: string,
  limit: number,
): Array<{ relPath: string; snippet: string }> {
  const expr = ftsMatchExpr(query);
  if (expr === null) return [];
  try {
    return searchFts(db, projectId, expr, limit);
  } catch {
    throw new AppError('IO_ERROR', '内容搜索失败（索引可能损坏，可重建索引）');
  }
}

export { clearProjectIndex, indexStats };
