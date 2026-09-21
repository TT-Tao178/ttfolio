/** 搜索路由（FR-8.x）：三档搜索 + 内容索引构建/状态/取消。 */
import type { FastifyPluginAsync } from 'fastify';
import path from 'node:path';
import type { AppContext } from '../context.js';
import { ok, fail } from './helpers.js';
import { addSearchHistory, listSearchHistory } from '../db/repo/metaRepo.js';
import { listProjects, getProjectRow } from '../db/repo/projectsRepo.js';
import { buildProjectIndex, queryContent, indexStats, buildMatcher } from '../core/search.js';
import { indexStats as ftsStats, clearProjectIndex } from '../db/repo/filesRepo.js';
import * as fsx from '../core/fsx.js';
import { matchScore, normalizeName } from './docs.js';

export const searchRoutes: FastifyPluginAsync = async (app) => {
  const ctx = app.ttfolio as AppContext;

  app.get('/api/search', async (req) => {
    const q = req.query as { q?: string; projectId?: string; types?: string; limit?: string };
    const query = (q.q ?? '').trim();
    if (query === '') return ok({ projects: [], files: [], contents: [], indexedProjects: [], unindexedProjects: [] });
    const db = ctx.db();
    const types = (q.types ?? 'project,file,content').split(',');
    const limit = Math.min(Number(q.limit ?? '20'), 50);
    addSearchHistory(db, query.slice(0, 200));

    const projects = types.includes('project')
      ? listProjects(db, { status: 'all', q: query }).slice(0, limit).map((p) => ({
          projectId: p.id,
          name: p.alias ?? p.diskName,
          alias: p.alias,
          dirPath: p.dirPath,
          matched: p.diskName
        }))
      : [];

    // 文件名搜索：遍历命中项目根（最多 8 个项目，每项目 30 条）
    const files: Array<{ projectId: string; name: string; relPath: string }> = [];
    const needle = query.toLowerCase();
    if (types.includes('file')) {
      const targets = q.projectId !== undefined
        ? listProjects(db, { status: 'all' }).filter((p) => p.id === q.projectId)
        : listProjects(db, { status: 'all' }).slice(0, 8);
      const matcher = buildMatcher(db, q.projectId ?? null);
      for (const p of targets) {
        if (files.length >= 30) break;
        const row = getProjectRow(db, p.id);
        if (row === undefined || p.pathOk !== true) continue;
        collectFileHits(row.dir_path, needle, matcher, p.id, files, 30);
      }
    }

    // 内容搜索：仅已索引项目
    const contents: Array<{ projectId: string; relPath: string; snippet: string }> = [];
    const indexedProjects: string[] = [];
    const unindexedProjects: string[] = [];
    if (types.includes('content')) {
      const targets = q.projectId !== undefined
        ? listProjects(db, { status: 'all' }).filter((p) => p.id === q.projectId)
        : listProjects(db, { status: 'active' });
      for (const p of targets.slice(0, 30)) {
        const stats = ftsStats(db, p.id);
        if (stats.files > 0) {
          indexedProjects.push(p.id);
          if (contents.length < limit) {
            try {
              const hits = queryContent(db, p.id, query, limit - contents.length);
              for (const h of hits) {
                contents.push({ projectId: p.id, relPath: h.relPath, snippet: h.snippet });
              }
            } catch {
              /* 单项目查询失败不阻断 */
            }
          }
        } else {
          unindexedProjects.push(p.id);
        }
      }
    }
    return ok({ projects, files: files.slice(0, limit), contents, indexedProjects, unindexedProjects });
  });

  app.get('/api/search/history', async () => ok(listSearchHistory(ctx.db(), 10)));

  app.post('/api/search/index', async (req) => {
    const b = (req.body ?? {}) as { projectId?: string };
    if (b.projectId === undefined) return fail('BAD_REQUEST', '缺少 projectId');
    const db = ctx.db();
    const row = getProjectRow(db, b.projectId);
    if (row === undefined) return fail('NOT_FOUND', '项目不存在', 404);
    const pid = b.projectId;
    const taskId = ctx.tasks.start('index', `建立内容索引：${row.disk_name}`, 0, async (taskCtx) => {
      const r = await buildProjectIndex(db, pid, row.dir_path, taskCtx);
      ctx.logger.info({ mod: 'search', msg: `index done: ${r.indexed} indexed, ${r.skipped} skipped` });
    });
    return ok({ taskId });
  });

  app.get('/api/search/index/status', async (req) => {
    const q = req.query as { projectId?: string };
    const running = ctx.tasks.list().filter((t) => t.kind === 'index');
    const stats = q.projectId !== undefined ? indexStats(ctx.db(), q.projectId) : null;
    return ok({ running, stats });
  });

  app.post('/api/search/index/cancel', async (req) => {
    const b = (req.body ?? {}) as { taskId?: string };
    if (b.taskId === undefined) return fail('BAD_REQUEST', '缺少 taskId');
    const found = ctx.tasks.cancel(b.taskId);
    return ok({ cancelled: found });
  });

  app.delete('/api/search/index/:projectId', async (req) => {
    const { projectId } = req.params as { projectId: string };
    clearProjectIndex(ctx.db(), projectId);
    return ok({ cleared: true });
  });

  // 命令面板：项目名快速跳转
  app.get('/api/search/quick', async (req) => {
    const q = req.query as { q?: string };
    const query = (q.q ?? '').trim();
    const db = ctx.db();
    const all = listProjects(db, { status: 'active' });
    if (query === '') {
      return ok(all.slice(0, 8).map((p) => ({ projectId: p.id, name: p.alias ?? p.diskName, dirPath: p.dirPath, score: 0 })));
    }
    const nq = normalizeName(query);
    const scored = all
      .map((p) => ({
        projectId: p.id,
        name: p.alias ?? p.diskName,
        dirPath: p.dirPath,
        score: Math.max(
          matchScore(nq, normalizeName(p.diskName)),
          p.alias !== null ? matchScore(nq, normalizeName(p.alias)) : 0
        )
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
    return ok(scored);
  });
};

function collectFileHits(
  root: string,
  needle: string,
  matcher: ReturnType<typeof buildMatcher>,
  projectId: string,
  out: Array<{ projectId: string; name: string; relPath: string }>,
  limit: number
): void {
  const stack: string[] = [root];
  while (stack.length > 0 && out.length < limit) {
    const cur = stack.pop();
    if (cur === undefined) break;
    let entries: fsx.FsEntry[];
    try {
      entries = fsx.listEntries(cur);
    } catch {
      continue;
    }
    for (const e of entries) {
      const abs = path.join(cur, e.name);
      const rel = path.relative(root, abs).split(path.sep).join('/');
      if (matcher.isHidden(rel)) continue;
      if (e.isDir) {
        stack[stack.length] = abs;
        continue;
      }
      if (e.name.toLowerCase().includes(needle)) {
        out[out.length] = { projectId, name: e.name, relPath: rel };
        if (out.length >= limit) return;
      }
    }
  }
}
