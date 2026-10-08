/** 文件树的 Git 状态标记（FR-4.1）：复用 core/git.ts 的 porcelain 解析，带 30s 缓存。 */
import type Database from 'better-sqlite3';
import { status } from './git.js';
import { getProjectRow } from '../db/repo/projectsRepo.js';

interface CacheEntry {
  marks: Map<string, string>;
  at: number;
}

const cache = new Map<string, CacheEntry>();
const TTL_MS = 30000;

export async function gitStatusMarks(db: Database.Database, projectId: string): Promise<Map<string, string>> {
  const hit = cache.get(projectId);
  if (hit !== undefined && Date.now() - hit.at < TTL_MS) return hit.marks;
  const marks = new Map<string, string>();
  const row = getProjectRow(db, projectId);
  if (row === undefined || row.git_is_repo !== 1) return marks;
  try {
    const st = await status(row.dir_path);
    if (!st.isRepo) return marks;
    for (const e of [...st.staged, ...st.unstaged]) {
      if (e.state === 'staged') {
        marks.set(
          e.path.toLowerCase(),
          e.x === 'A' ? 'added' : e.x === 'D' ? 'deleted' : e.x === 'R' ? 'renamed' : 'modified',
        );
      } else if (e.state === 'conflicted') {
        marks.set(e.path.toLowerCase(), 'conflicted');
      } else {
        marks.set(e.path.toLowerCase(), e.y === 'D' ? 'deleted' : 'modified');
      }
    }
    for (const e of st.untracked) {
      marks.set(e.path.toLowerCase(), 'untracked');
    }
  } catch {
    return marks;
  }
  cache.set(projectId, { marks, at: Date.now() });
  return marks;
}

export function invalidateGitMarks(projectId: string): void {
  cache.delete(projectId);
}
