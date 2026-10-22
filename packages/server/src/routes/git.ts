/** Git 路由（FR-5.x）：状态/diff/暂存/放弃/提交/历史/分支/总览。 */
import type { FastifyPluginAsync } from 'fastify';
import type { AppContext } from '../context.js';
import { ok, fail, toApiError } from './helpers.js';
import {
  gitAvailable,
  status,
  diff,
  stage,
  unstage,
  discard,
  commit,
  log,
  commitDetail,
  branches,
  checkout,
  createBranch,
  isRepo,
  inProgress,
  identity,
} from '../core/git.js';
import { runCommand } from '../core/exec.js';
import { getProjectRow, listProjects } from '../db/repo/projectsRepo.js';
import { logActivity } from '../db/repo/metaRepo.js';
import { currentActor } from '../core/actor.js';
import { invalidateGitMarks } from '../core/gitfs.js';
import { resolveInProject } from '../roots.js';
import { AppError } from '../core/errors.js';

export const gitRoutes: FastifyPluginAsync = async (app) => {
  const ctx = app.ttfolio as AppContext;

  function projectDir(id: string): string {
    const row = getProjectRow(ctx.db(), id);
    if (row === undefined) throw new AppError('NOT_FOUND', '项目不存在', undefined, 404);
    return row.dir_path;
  }

  app.get('/api/git/:projectId/status', async (req) => {
    const { projectId } = req.params as { projectId: string };
    try {
      const dir = projectDir(projectId);
      const st = await status(dir);
      ctx
        .db()
        .prepare('UPDATE projects SET git_is_repo = ? WHERE id = ?')
        .run(st.isRepo ? 1 : 0, projectId);
      return ok(st);
    } catch (err) {
      return fail(...toApiErrorTuple(err));
    }
  });

  // 体检 P2：用户可控的 git 引用/作者参数以 - 开头会被 git 当作选项解析
  //（如 diff 的 --output=<path> 可把输出写到白名单外）。shell:false 挡住了命令拼接，
  // 但选项注入只能靠这里拒绝。
  function assertGitArg(v: string, label: string): void {
    // 不用 startsWith（lint C-02 全局禁用该模式）；0x2d = '-'
    if (v.charCodeAt(0) === 0x2d) throw new AppError('INVALID_NAME', `${label} 不能以 "-" 开头`);
  }

  app.get('/api/git/:projectId/diff', async (req) => {
    const { projectId } = req.params as { projectId: string };
    const q = req.query as {
      path?: string;
      staged?: string;
      ref?: string;
      offsetLines?: string;
      limitLines?: string;
    };
    if (q.path === undefined) return fail('BAD_REQUEST', '缺少 path');
    try {
      if (q.ref !== undefined) assertGitArg(q.ref, 'ref');
      const dir = projectDir(projectId);
      // 行级分块（FR-5.2 / KNOWN-GAPS #6）：缺省不传 = 全量（兼容旧调用方）
      const offsetLines =
        q.offsetLines !== undefined ? Math.max(0, Number.parseInt(q.offsetLines, 10) || 0) : undefined;
      const limitLines =
        q.limitLines !== undefined ? Math.max(1, Number.parseInt(q.limitLines, 10) || 500) : undefined;
      const d = await diff(dir, q.path, q.staged === '1', q.ref, { offsetLines, limitLines });
      return ok(d);
    } catch (err) {
      return fail(...toApiErrorTuple(err));
    }
  });

  app.post('/api/git/:projectId/stage', async (req) => {
    const { projectId } = req.params as { projectId: string };
    const b = (req.body ?? {}) as { paths?: string[]; all?: boolean };
    try {
      const dir = projectDir(projectId);
      await stage(dir, b.all === true ? null : (b.paths ?? []));
      invalidateGitMarks(projectId);
      ctx.sse.publish('git.changed', { projectId });
      return ok({ done: true });
    } catch (err) {
      return fail(...toApiErrorTuple(err));
    }
  });

  app.post('/api/git/:projectId/unstage', async (req) => {
    const { projectId } = req.params as { projectId: string };
    const b = (req.body ?? {}) as { paths?: string[]; all?: boolean };
    try {
      const dir = projectDir(projectId);
      await unstage(dir, b.all === true ? null : (b.paths ?? []));
      invalidateGitMarks(projectId);
      ctx.sse.publish('git.changed', { projectId });
      return ok({ done: true });
    } catch (err) {
      return fail(...toApiErrorTuple(err));
    }
  });

  app.post('/api/git/:projectId/discard', async (req) => {
    const { projectId } = req.params as { projectId: string };
    const b = (req.body ?? {}) as { paths?: string[]; confirm?: boolean };
    if (b.paths === undefined || b.paths.length === 0) return fail('BAD_REQUEST', '缺少 paths');
    if (b.confirm !== true) {
      return fail('CONFIRM_REQUIRED', '放弃改动不可通过 Ctrl+Z 撤销（L3），需要 confirm=true');
    }
    const db = ctx.db();
    try {
      const dir = projectDir(projectId);
      const st = await status(dir);
      const tracked = b.paths.filter((p) => !st.untracked.some((u) => u.path === p));
      const untrackedPaths = b.paths.filter((p) => st.untracked.some((u) => u.path === p));
      if (tracked.length > 0) await discard(dir, tracked);
      // 未跟踪文件：送回收站
      for (const p of untrackedPaths) {
        const g = await resolveInProject(db, projectId, p, { mustExist: true });
        ctx.trash.moveToTrash(db, [g.real], projectId, dir);
      }
      invalidateGitMarks(projectId);
      logActivity(db, {
        kind: 'git.discard',
        level: 'L3',
        projectId,
        detail: { paths: b.paths },
        targetPath: dir,
        actor: currentActor().actor,
      });
      ctx.sse.publish('git.changed', { projectId });
      ctx.sse.publish('trash.changed', {});
      return ok({ done: true });
    } catch (err) {
      return fail(...toApiErrorTuple(err));
    }
  });

  app.post('/api/git/:projectId/commit', async (req) => {
    const { projectId } = req.params as { projectId: string };
    const b = (req.body ?? {}) as { message?: string };
    if (b.message === undefined || b.message.trim() === '') return fail('BAD_REQUEST', '提交信息不能为空');
    try {
      const dir = projectDir(projectId);
      const r = await commit(dir, b.message);
      invalidateGitMarks(projectId);
      logActivity(ctx.db(), {
        kind: 'git.commit',
        level: 'L2',
        projectId,
        detail: { short: r.short },
        targetPath: dir,
        actor: currentActor().actor,
      });
      ctx.sse.publish('git.changed', { projectId });
      return ok(r);
    } catch (err) {
      return fail(...toApiErrorTuple(err));
    }
  });

  app.get('/api/git/:projectId/log', async (req) => {
    const { projectId } = req.params as { projectId: string };
    const q = req.query as { limit?: string; skip?: string; path?: string; author?: string };
    try {
      if (q.author !== undefined) assertGitArg(q.author, 'author');
      const dir = projectDir(projectId);
      const entries = await log(dir, {
        limit: Math.min(Number(q.limit ?? '50'), 200),
        skip: q.skip !== undefined ? Number(q.skip) : undefined,
        path: q.path,
        author: q.author,
      });
      return ok(entries);
    } catch (err) {
      return fail(...toApiErrorTuple(err));
    }
  });

  app.get('/api/git/:projectId/commit/:hash', async (req) => {
    const { projectId, hash } = req.params as { projectId: string; hash: string };
    try {
      assertGitArg(hash, 'hash');
      const dir = projectDir(projectId);
      const d = await commitDetail(dir, hash);
      const patch = await diffForCommit(dir, hash);
      return ok({ ...d, patch });
    } catch (err) {
      return fail(...toApiErrorTuple(err));
    }
  });

  app.get('/api/git/:projectId/branches', async (req) => {
    const { projectId } = req.params as { projectId: string };
    try {
      const dir = projectDir(projectId);
      return ok(await branches(dir));
    } catch (err) {
      return fail(...toApiErrorTuple(err));
    }
  });

  app.post('/api/git/:projectId/checkout', async (req) => {
    const { projectId } = req.params as { projectId: string };
    const b = (req.body ?? {}) as { branch?: string; confirmDirty?: boolean };
    if (b.branch === undefined) return fail('BAD_REQUEST', '缺少 branch');
    try {
      assertGitArg(b.branch, '分支名');
      const dir = projectDir(projectId);
      const st = await status(dir);
      const dirty = st.staged.length + st.unstaged.length > 0;
      if (dirty && b.confirmDirty !== true) {
        return fail('GIT_DIRTY', '工作区有未提交改动，切换分支可能丢失/带走的改动，请确认', 422);
      }
      await checkout(dir, b.branch);
      invalidateGitMarks(projectId);
      logActivity(ctx.db(), {
        kind: 'git.checkout',
        level: 'L2',
        projectId,
        detail: { branch: b.branch },
        targetPath: dir,
        actor: currentActor().actor,
      });
      ctx.sse.publish('git.changed', { projectId });
      // 切分支会批量改工作区：只发刷新信号不落流水（避免一次 checkout 塞数千行）
      ctx.changes.publish({ projectId, relPaths: [], kind: 'update', source: 'api' });
      return ok({ done: true });
    } catch (err) {
      return fail(...toApiErrorTuple(err));
    }
  });

  app.post('/api/git/:projectId/branch', async (req) => {
    const { projectId } = req.params as { projectId: string };
    const b = (req.body ?? {}) as { branch?: string };
    if (b.branch === undefined || b.branch.trim() === '') return fail('BAD_REQUEST', '缺少 branch');
    try {
      assertGitArg(b.branch.trim(), '分支名');
      const dir = projectDir(projectId);
      await createBranch(dir, b.branch.trim());
      invalidateGitMarks(projectId);
      ctx.sse.publish('git.changed', { projectId });
      return ok({ done: true });
    } catch (err) {
      return fail(...toApiErrorTuple(err));
    }
  });

  app.get('/api/git/overview', async () => {
    const db = ctx.db();
    const projects = listProjects(db, { status: 'active' });
    const available = await gitAvailable();
    const items = [];
    for (const p of projects.slice(0, 200)) {
      if (!available || !p.gitIsRepo) {
        items.push({
          projectId: p.id,
          name: p.alias ?? p.diskName,
          isRepo: false,
          branch: null,
          dirty: false,
          untracked: 0,
          lastCommitAt: null,
          pathOk: p.pathOk,
        });
        continue;
      }
      items.push({
        projectId: p.id,
        name: p.alias ?? p.diskName,
        isRepo: true,
        branch: p.gitBranch,
        dirty: p.gitDirty,
        untracked: p.gitUntracked,
        lastCommitAt: p.gitLastCommitAt,
        pathOk: p.pathOk,
      });
    }
    return ok({ gitAvailable: available, items });
  });

  app.get('/api/git/env', async (req) => {
    const q = req.query as { projectId?: string };
    const available = await gitAvailable();
    if (!available) return ok({ available, identity: null, isRepo: false, inProgress: null });
    if (q.projectId !== undefined) {
      try {
        const dir = projectDir(q.projectId);
        const id = await identity(dir);
        return ok({ available, identity: id, isRepo: await isRepo(dir), inProgress: await inProgress(dir) });
      } catch (err) {
        return fail(...toApiErrorTuple(err));
      }
    }
    return ok({ available, identity: null, isRepo: false, inProgress: null });
  });
};

async function diffForCommit(dir: string, hash: string): Promise<string> {
  const r = await runCommand(
    'git',
    ['show', '--no-color', '--no-ext-diff', '--unified=3', '--format=', hash],
    {
      cwd: dir,
    },
  );
  return r.stdout.slice(0, 200000);
}

function toApiErrorTuple(err: unknown): [import('@ttfolio/shared').ErrorCode, string, number, unknown?] {
  const e = toApiError(err);
  return [e.code, e.message, e.status, e.detail];
}
