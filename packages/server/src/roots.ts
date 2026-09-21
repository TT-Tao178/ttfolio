/** 白名单辅助：项目 → allowedRoots（项目目录 + 文档挂载 + 架构图目录）（C-01/8.6）。 */
import path from 'node:path';
import type Database from 'better-sqlite3';
import { guardPath, type GuardedPath } from './core/pathGuard.js';
import { AppError } from './core/errors.js';
import { listMounts, listArchives } from './db/repo/docsRepo.js';
import { getProjectRow } from './db/repo/projectsRepo.js';

export interface ProjectRoots {
  projectRoot: string;
  roots: string[];
}

export function projectRoots(db: Database.Database, projectId: string): ProjectRoots {
  const row = getProjectRow(db, projectId);
  if (row === undefined) {
    throw new AppError('NOT_FOUND', '项目不存在', { projectId }, 404);
  }
  const roots = [row.dir_path];
  for (const m of listMounts(db, projectId)) {
    roots[roots.length] = m.path;
  }
  for (const a of listArchives(db, projectId)) {
    roots[roots.length] = a.dir_path;
  }
  return { projectRoot: row.dir_path, roots };
}

/** 解析用户路径（相对项目根或绝对路径），校验白名单，返回真实路径与相对路径。 */
export async function resolveInProject(
  db: Database.Database,
  projectId: string,
  userPath: string,
  opts: { mustExist: boolean; abs?: boolean }
): Promise<GuardedPath & { projectRoot: string }> {
  const { roots } = projectRoots(db, projectId);
  const p = opts.abs === true ? userPath : path.resolve(roots[0] ?? '.', userPath);
  const guarded = await guardPath({ userPath: p, allowedRoots: roots }, { mustExist: opts.mustExist });
  return { ...guarded, projectRoot: roots[0] ?? '' };
}
