/** 回收站 / 清单 / 会话 / 对话框 / 外部打开 路由。 */
import type { FastifyPluginAsync } from 'fastify';
import type { AppContext } from '../context.js';
import { ok, fail, toApiError, type RouteRequest } from './helpers.js';
import { listTrash } from '../db/repo/filesRepo.js';
import type { SessionTab } from '@ttfolio/shared';
import { todosCreateSchema, todoPatchSchema, sessionPutSchema, openExternalSchema } from '@ttfolio/shared';
import { listTodos, createTodo, patchTodo, deleteTodo, getSession, putSession } from '../db/repo/sessionRepo.js';
import { logActivity } from '../db/repo/metaRepo.js';
import { pickFolder, pickFile } from '../core/dialogs.js';
import { openExplorer, openTerminal, runTemplate, renderTemplateArgs, validateTemplateArgs } from '../core/openExternal.js';
import { listCommandTemplates } from '../db/repo/rulesRepo.js';
import { resolveInProject } from '../roots.js';
import { currentActor } from '../core/actor.js';
import { getSetting } from '../db/repo/metaRepo.js';
import path from 'node:path';

export const miscRoutes: FastifyPluginAsync = async (app) => {
  const ctx = app.ttfolio as AppContext;

  // ---- 回收站 ----
  app.get('/api/trash', async () => ok(ctx.trash.list(ctx.db())));

  app.get('/api/trash/:id/preview', async (req) => {
    const { id } = req.params as { id: string };
    return ok({ entries: ctx.trash.previewEntries(id) });
  });

  app.post('/api/trash/restore', async (req) => {
    const b = (req.body ?? {}) as { id?: string; targetDir?: string };
    if (b.id === undefined) return fail('BAD_REQUEST', '缺少 id');
    try {
      const r = ctx.trash.restore(ctx.db(), b.id, b.targetDir);
      if (r.status === 'taken') {
        return fail('TRASH_PATH_TAKEN', '原路径已被占用，可指定其他目录恢复', 409, { originPath: b.id });
      }
      logActivity(ctx.db(), { kind: 'trash.restore', level: 'L2', detail: { id: b.id, to: r.restoredTo }, actor: currentActor().actor });
      ctx.sse.publish('trash.changed', {});
      ctx.sse.publish('fs.changed', { paths: [r.restoredTo ?? ''], kind: 'create' });
      return ok(r);
    } catch (err) {
      return fail(...toApiErrorTuple(err));
    }
  });

  app.delete('/api/trash/:id', async (req) => {
    const { id } = req.params as { id: string };
    const q = req.query as { confirm?: string };
    if (q.confirm !== '1') return fail('CONFIRM_REQUIRED', '彻底删除不可恢复（L3），需要 confirm=1');
    try {
      ctx.trash.purge(ctx.db(), id);
      logActivity(ctx.db(), { kind: 'trash.purge', level: 'L3', detail: { id } });
      ctx.sse.publish('trash.changed', {});
      return ok({ purged: true });
    } catch (err) {
      return fail(...toApiErrorTuple(err));
    }
  });

  app.post('/api/trash/empty', async (req) => {
    const b = (req.body ?? {}) as { confirm?: boolean };
    if (b.confirm !== true) {
      return fail('CONFIRM_REQUIRED', '清空回收站不可恢复（L3），需要 confirm=true');
    }
    const taskId = ctx.tasks.start('trash-empty', '清空回收站', 0, async (taskCtx) => {
      const r = ctx.trash.empty(ctx.db(), taskCtx);
      logActivity(ctx.db(), { kind: 'trash.empty', level: 'L3', detail: r, actor: currentActor().actor });
      ctx.sse.publish('trash.changed', {});
    });
    return ok({ taskId });
  });

  // ---- 清单 ----
  app.get('/api/todos', async (req) => {
    const q = req.query as { projectId?: string; scope?: string; includeDone?: string };
    const includeDone = q.includeDone !== '0';
    if (q.scope === 'all') return ok(listTodos(ctx.db(), { scopeAll: true, includeDone }));
    if (q.projectId === undefined) return fail('BAD_REQUEST', '缺少 projectId');
    return ok(listTodos(ctx.db(), { projectId: q.projectId, includeDone }));
  });

  app.post('/api/todos', async (req) => {
    const parsed = todosCreateSchema.safeParse(req.body);
    if (!parsed.success) return fail('BAD_REQUEST', '参数不合法');
    const todo = createTodo(ctx.db(), {
      projectId: parsed.data.projectId,
      title: parsed.data.title,
      category: parsed.data.category ?? null,
      dueOn: parsed.data.dueOn ?? null,
      sortOrder: parsed.data.sortOrder ?? Date.now() % 1e7
    });
    return ok(todo);
  });

  app.patch('/api/todos/:id', async (req) => {
    const { id } = req.params as { id: string };
    const parsed = todoPatchSchema.safeParse(req.body);
    if (!parsed.success) return fail('BAD_REQUEST', '参数不合法');
    const found = patchTodo(ctx.db(), id, parsed.data);
    if (!found) return fail('NOT_FOUND', '清单条目不存在', 404);
    return ok({ updated: true });
  });

  app.delete('/api/todos/:id', async (req) => {
    const { id } = req.params as { id: string };
    const found = deleteTodo(ctx.db(), id);
    if (!found) return fail('NOT_FOUND', '清单条目不存在', 404);
    return ok({ deleted: true });
  });

  // ---- 会话 ----
  app.get('/api/session', async () => ok(getSession(ctx.db())));

  app.put('/api/session', async (req) => {
    const parsed = sessionPutSchema.safeParse(req.body);
    if (!parsed.success) return fail('BAD_REQUEST', '参数不合法');
    putSession(ctx.db(), { tabs: parsed.data.tabs as unknown as SessionTab[], activeTabId: parsed.data.activeTabId ?? null });
    return ok({ saved: true });
  });

  // ---- 系统对话框 ----
  app.post('/api/dialogs/pick-folder', async () => {
    try {
      const paths = await pickFolder();
      return ok({ paths });
    } catch (err) {
      return fail('IO_ERROR', `打开系统对话框失败：${err instanceof Error ? err.message : String(err)}`);
    }
  });

  app.post('/api/dialogs/pick-file', async () => {
    try {
      const paths = await pickFile();
      return ok({ paths });
    } catch (err) {
      return fail('IO_ERROR', `打开系统对话框失败：${err instanceof Error ? err.message : String(err)}`);
    }
  });

  // ---- 外部打开（C-22/23：路径必须先过白名单） ----
  app.post('/api/open', async (req) => {
    const parsed = openExternalSchema.safeParse(req.body);
    if (!parsed.success) return fail('BAD_REQUEST', '参数不合法');
    const b = parsed.data;
    try {
      const g = await resolveInProject(ctx.db(), b.projectId, b.path ?? '', { mustExist: true });
      const target = b.path !== undefined && b.path !== '' ? g.real : g.projectRoot;
      if (b.target === 'explorer') {
        await openExplorer(target);
      } else if (b.target === 'terminal') {
        const st = await import('../core/fsx.js').then((m) => m.statSafe(target));
        const dir = st?.isDir === false ? path.dirname(target) : target;
        await openTerminal(dir);
      } else {
        if (b.templateId === undefined) return fail('BAD_REQUEST', '缺少 templateId');
        const templates = listCommandTemplates(ctx.db());
        const t = templates.find((x) => x.id === b.templateId);
        if (t === undefined) return fail('NOT_FOUND', '模板不存在', 404);
        validateTemplateArgs(t.argsJson, t.isBuiltin);
        const st = await import('../core/fsx.js').then((m) => m.statSafe(target));
        const args = renderTemplateArgs(t.argsJson, {
          path: target,
          file: st?.isDir === false ? path.basename(target) : '',
          project: path.basename(g.projectRoot),
          paths: target
        });
        await runTemplate(t.executable, args);
      }
      logActivity(ctx.db(), { kind: 'open.external', level: 'L2', projectId: b.projectId, targetPath: target, detail: { target: b.target, templateId: b.templateId }, actor: currentActor().actor });
      return ok({ opened: true });
    } catch (err) {
      return fail(...toApiErrorTuple(err));
    }
  });

  // 清理超过保留期的回收站条目（手动入口，保留策略天数来自设置）
  app.post('/api/trash/purge-old', async () => {
    const days = Number(getSetting(ctx.db(), 'trash_retention_days') ?? '30');
    const r = ctx.trash.purgeOlderThan(ctx.db(), days);
    ctx.sse.publish('trash.changed', {});
    return ok({ removed: r });
  });
};

function toApiErrorTuple(err: unknown): [import('@ttfolio/shared').ErrorCode, string, number, unknown?] {
  const e = toApiError(err);
  return [e.code, e.message, e.status, e.detail];
}
