/** 批量分析任务（FR-3.1/3.8）：异步 + 进度 + 可取消；同项目不并发（per-project 锁）。 */
import path from 'node:path';
import type { AppContext } from '../../context.js';
import { analyzeProject } from './index.js';
import { getProjectRow } from '../../db/repo/projectsRepo.js';
import { AppError } from '../errors.js';

const inFlight = new Set<string>();

export async function analyzeProjects(ctx: AppContext, projectIds: string[]): Promise<string | null> {
  const ids = projectIds.filter((id) => !inFlight.has(id));
  if (ids.length === 0) return null;
  const db = ctx.db();
  const rows = ids
    .map((id) => getProjectRow(db, id))
    .filter((r): r is NonNullable<typeof r> => r !== undefined);
  if (rows.length === 0) return null;

  const taskId = ctx.tasks.start('analyze', `分析 ${rows.length} 个项目`, rows.length, async (taskCtx) => {
    let done = 0;
    for (const row of rows) {
      taskCtx.checkCancelled();
      if (inFlight.has(row.id)) {
        done++;
        taskCtx.progress(done, rows.length);
        continue;
      }
      inFlight.add(row.id);
      try {
        await analyzeProject(
          ctx.db(),
          {
            id: row.id,
            dirPath: row.dir_path,
            typeSource: row.type_source,
            defaultArchDir: row.default_arch_dir,
          },
          ctx.sse,
          {
            taskId: taskCtx.taskId,
            checkCancelled: taskCtx.checkCancelled,
            isCancelled: taskCtx.isCancelled,
            progress: (done_, total, phase) => {
              void total;
              void phase;
            },
            markPartial: (): void => {},
          },
        );
      } catch (err) {
        if ((err as { code?: string }).code === 'CANCELLED') {
          inFlight.delete(row.id);
          throw err;
        }
        ctx
          .db()
          .prepare('UPDATE projects SET analyze_partial = 1, analyze_error = ? WHERE id = ?')
          .run(err instanceof Error ? err.message.slice(0, 300) : '分析失败', row.id);
        ctx.sse.publish('project.analyzed', { projectId: row.id });
      } finally {
        inFlight.delete(row.id);
      }
      done++;
      taskCtx.progress(done, rows.length);
    }
  });
  void taskId;
  return taskId;
}

/** 路径校验工具（供其它模块复用）：确保在项目目录内。 */
export function ensureInside(root: string, target: string): void {
  const rel = path.relative(root, target);
  if (rel !== '' && (rel === '..' || rel.split(path.sep).includes('..'))) {
    throw new AppError('PATH_OUT_OF_SCOPE', '路径越界');
  }
}
