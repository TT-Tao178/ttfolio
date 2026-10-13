/** 项目路由：登记/列表/属性/移除/分析/重定位/磁盘改名/目录枚举/集合/标签。 */
import type { FastifyPluginAsync } from 'fastify';
import path from 'node:path';
import type { AppContext } from '../context.js';
import { ok, fail, toApiError } from './helpers.js';
import { AppError } from '../core/errors.js';
import * as fsx from '../core/fsx.js';
import { assertSafeName, validateRegistrableRoot } from '../core/pathGuard.js';
import {
  addProjectsSchema,
  projectPatchSchema,
  relocateSchema,
  renameDiskSchema,
  collectionCreateSchema,
  collectionMembersSchema,
} from '@ttfolio/shared';
import {
  listProjects,
  getProjectRow,
  getProjectSummary,
  getProjectByPathKey,
  getRemovedProjectByPathKey,
  reviveProject,
  insertProject,
  patchProject,
  softDeleteProject,
  markOpened,
  needsReanalyze,
  listCollections,
  type ListFilters,
} from '../db/repo/projectsRepo.js';
import { logActivity, recordRecentFile, listRecentFiles } from '../db/repo/metaRepo.js';
import { listMounts, listArchives, toArchiveInfo } from '../db/repo/docsRepo.js';
import { listTodos } from '../db/repo/sessionRepo.js';
import { pathKey } from '../db/repo/docsRepo.js';
import { analyzeProjects } from '../core/analyzer/runner.js';
import { currentActor } from '../core/actor.js';
import { ulid } from '../core/ulid.js';
import { computeArchiveMeta } from '../core/analyzer/index.js';

export const projectsRoutes: FastifyPluginAsync = async (app) => {
  const ctx = app.ttfolio as AppContext;

  app.get('/api/projects', async (req) => {
    const q = req.query as Record<string, string | undefined>;
    const filters: ListFilters = {
      status: q.status === 'archived' ? 'archived' : q.status === 'all' ? 'all' : 'active',
      type: q.type as ListFilters['type'],
      collectionId: q.collection,
      dirty:
        q.dirty === '1' || q.dirty === 'true'
          ? true
          : q.dirty === '0' || q.dirty === 'false'
            ? false
            : undefined,
      hasDocs: q.hasDocs === '1' ? true : q.hasDocs === '0' ? false : undefined,
      hasArch: q.hasArch === '1' ? true : q.hasArch === '0' ? false : undefined,
      pathOk: q.pathOk === '0' ? false : undefined,
      analyzed: q.analyzed === '0' ? false : undefined,
      staleDays: q.stale === '30' ? 30 : undefined,
      q: q.q,
      sort: q.sort as ListFilters['sort'],
    };
    return ok(listProjects(ctx.db(), filters));
  });

  app.post('/api/projects', async (req) => {
    const parsed = addProjectsSchema.safeParse(req.body);
    if (!parsed.success) return fail('BAD_REQUEST', '参数不合法');
    const db = ctx.db();
    const body = parsed.data;
    const candidates: string[] =
      'paths' in body ? body.paths : body.children.map((c) => path.join(body.parentPath, c));
    const added: string[] = [];
    const skipped: Array<{ path: string; reason: string }> = [];
    for (const raw of candidates) {
      // 清理粘贴噪声：引号、\\?\ 前缀、首尾空白
      let p = raw.trim().replace(/^"|"$/g, '').replace(/^'|'$/g, '');
      if (p.slice(0, 4) === '\\\\?\\') p = p.slice(4);
      if (p === '') continue;
      try {
        // 登记 = 定义新的白名单根：必须与"打开"用同一套危险段规则（P0-1）。
        // 否则会出现"能导入、却永远打不开"的项目（Windows 保留名根 / UNC 路径），
        // 且卡片显示 pathOk=true，用户完全看不出问题。
        const abs = path.resolve(p);
        const absReal = await validateRegistrableRoot(abs);
        const st = fsx.statSafe(absReal);
        if (st === null || !st.isDir) throw new AppError('NOT_FOUND', `不是目录：${p}`);
        const key = pathKey(absReal);
        const dup = getProjectByPathKey(db, key);
        if (dup !== undefined) {
          skipped[skipped.length] = { path: p, reason: `已登记为「${dup.alias ?? dup.disk_name}」` };
          continue;
        }
        // 之前"移除登记"过的同一目录：原地复活（保留别名/备注/清单），而不是撞 UNIQUE 约束
        const removed = getRemovedProjectByPathKey(db, key);
        if (removed !== undefined) {
          const revived = reviveProject(db, removed.id, {
            dirPath: absReal,
            diskName: path.basename(absReal),
          });
          if (revived !== undefined) {
            added[added.length] = revived.id;
            logActivity(db, {
              kind: 'project.add',
              level: 'L1',
              projectId: revived.id,
              targetPath: absReal,
              detail: { revived: true, alias: revived.alias },
              actor: currentActor().actor,
            });
            continue;
          }
        }
        const row = insertProject(db, {
          dirPath: absReal,
          dirPathKey: key,
          diskName: path.basename(absReal),
          defaultArchDir: defaultArchDirName(db),
        });
        added[added.length] = row.id;
        logActivity(db, {
          kind: 'project.add',
          level: 'L1',
          projectId: row.id,
          targetPath: absReal,
          actor: currentActor().actor,
        });
      } catch (err) {
        const e = toApiError(err);
        skipped[skipped.length] = { path: p, reason: e.message };
      }
    }
    // 添加时自动分析一次（异步）
    if (added.length > 0) {
      void analyzeProjects(ctx, added);
    }
    return ok({ added, skipped });
  });

  app.get('/api/projects/:id', async (req) => {
    const { id } = req.params as { id: string };
    const db = ctx.db();
    const summary = getProjectSummary(db, id);
    if (summary === null) return fail('NOT_FOUND', '项目不存在', 404);
    const archives = listArchives(db, id).map((row) => {
      const meta = computeArchiveMeta(row.dir_path, row.entry_source === 'manual' ? row.entry_rel : null);
      const countChanged = meta.htmlFiles.length !== row.html_count;
      const entryChanged =
        row.entry_rel !== null && meta.htmlFiles.some((f) => f.rel === row.entry_rel && false);
      return toArchiveInfo(
        row,
        meta.htmlFiles,
        meta.htmlFiles
          .filter((f) => f.hasSourceJson)
          .map((f) => f.rel.replace(/\.html?$/i, '.architecture.json')),
        countChanged || entryChanged,
        meta.imageFiles,
        meta.textFiles,
      );
    });
    return ok({
      ...summary,
      defaultArchDir: getProjectRow(db, id)?.default_arch_dir ?? '架构图',
      mounts: listMounts(db, id),
      archives,
      todoOpenCount: listTodos(db, { projectId: id, includeDone: false }).length,
    });
  });

  app.patch('/api/projects/:id', async (req) => {
    const { id } = req.params as { id: string };
    const parsed = projectPatchSchema.safeParse(req.body);
    if (!parsed.success) return fail('BAD_REQUEST', '参数不合法');
    const db = ctx.db();
    const row = getProjectRow(db, id);
    if (row === undefined) return fail('NOT_FOUND', '项目不存在', 404);
    if (parsed.data.rev !== row.rev) {
      return fail('REV_CONFLICT', '该项目已被其他窗口修改', 409, { currentRev: row.rev });
    }
    const b = parsed.data;
    const fields: Record<string, unknown> = {};
    if (b.alias !== undefined) fields['alias'] = b.alias === '' ? null : b.alias;
    if (b.type !== undefined) {
      fields['type'] = b.type;
      if (b.typeSource !== 'analyzed') fields['type_source'] = 'manual';
    }
    if (b.typeSource === 'analyzed') fields['type_source'] = 'analyzed';
    if (b.notes !== undefined) fields['notes'] = b.notes;
    if (b.isPinned !== undefined) fields['is_pinned'] = b.isPinned ? 1 : 0;
    if (b.status !== undefined) fields['status'] = b.status;
    if (b.defaultArchDir !== undefined) {
      const name = assertSafeName(b.defaultArchDir);
      fields['default_arch_dir'] = name;
    }
    const rev = patchProject(db, id, fields);
    ctx.sse.publish('project.updated', { projectId: id });
    return ok({ id, rev });
  });

  app.delete('/api/projects/:id', async (req) => {
    const { id } = req.params as { id: string };
    const q = req.query as { mode?: string };
    const mode = q.mode === 'delete' ? 'delete' : 'unregister';
    const db = ctx.db();
    const row = getProjectRow(db, id);
    if (row === undefined) return fail('NOT_FOUND', '项目不存在', 404);
    if (mode === 'delete') {
      const q2 = req.query as { confirm?: string };
      if (q2.confirm !== '1') return fail('CONFIRM_REQUIRED', '移除并删除文件需要 confirm=1');
      try {
        ctx.trash.moveToTrash(db, [row.dir_path], id, row.dir_path);
      } catch (err) {
        return fail(...toApiErrorTuple(err));
      }
      ctx.sse.publish('trash.changed', {});
    }
    softDeleteProject(db, id);
    logActivity(db, {
      kind: mode === 'delete' ? 'project.remove_and_delete' : 'project.unregister',
      level: mode === 'delete' ? 'L3' : 'L1',
      projectId: id,
      targetPath: row.dir_path,
    });
    ctx.sse.publish('project.updated', { projectId: id });
    return ok({ removed: true, mode });
  });

  app.post('/api/projects/:id/open', async (req) => {
    const { id } = req.params as { id: string };
    const db = ctx.db();
    markOpened(db, id);
    ctx.sse.publish('project.updated', { projectId: id });
    // 7 天静默重分析（FR-3.1 SHOULD，第 36 轮 A1 补齐 KNOWN-GAPS #3）：打开时
    // analyzed_at 超期则后台触发——fire-and-forget 不阻塞打开响应，与登记/
    // 重定位路径的异步分析同模式，任务系统自带排队与取消。
    const row = getProjectRow(db, id);
    if (row !== undefined && needsReanalyze(row)) void analyzeProjects(ctx, [id]);
    return ok({ opened: true });
  });

  app.post('/api/projects/:id/analyze', async (req) => {
    const { id } = req.params as { id: string };
    const row = getProjectRow(ctx.db(), id);
    if (row === undefined) return fail('NOT_FOUND', '项目不存在', 404);
    const taskId = await analyzeProjects(ctx, [id]);
    return ok({ taskId });
  });

  app.post('/api/projects/analyze', async (req) => {
    const b = (req.body ?? {}) as { projectIds?: string[] };
    let ids = b.projectIds;
    if (ids === undefined || ids.length === 0) {
      ids = listProjects(ctx.db(), { status: 'active' }).map((p) => p.id);
    }
    const taskId = await analyzeProjects(ctx, ids);
    return ok({ taskId });
  });

  app.post('/api/projects/:id/relocate', async (req) => {
    const { id } = req.params as { id: string };
    const parsed = relocateSchema.safeParse(req.body);
    if (!parsed.success) return fail('BAD_REQUEST', '参数不合法');
    const db = ctx.db();
    const row = getProjectRow(db, id);
    if (row === undefined) return fail('NOT_FOUND', '项目不存在', 404);
    const p = parsed.data.dirPath.trim().replace(/^"|"$/g, '');
    const st = fsx.statSafe(path.resolve(p));
    if (st === null || !st.isDir) return fail('NOT_FOUND', '新目录不存在', 404);
    const abs = await fsxPromised(path.resolve(p));
    const key = pathKey(abs);
    const dup = getProjectByPathKey(db, key);
    if (dup !== undefined && dup.id !== id) return fail('DUPLICATE_PROJECT', '新目录已登记为其他项目', 409);
    patchProject(db, id, {
      dir_path: abs,
      dir_path_key: key,
      disk_name: path.basename(abs),
      path_ok: 1,
      path_checked_at: new Date().toISOString(),
    });
    logActivity(db, {
      kind: 'project.relocate',
      level: 'L1',
      projectId: id,
      detail: { from: row.dir_path, to: abs },
    });
    ctx.sse.publish('project.updated', { projectId: id });
    void analyzeProjects(ctx, [id]);
    return ok({ relocated: true });
  });

  app.post('/api/projects/:id/rename-disk', async (req) => {
    const { id } = req.params as { id: string };
    const parsed = renameDiskSchema.safeParse(req.body);
    if (!parsed.success) return fail('BAD_REQUEST', '参数不合法');
    const db = ctx.db();
    const row = getProjectRow(db, id);
    if (row === undefined) return fail('NOT_FOUND', '项目不存在', 404);
    if (parsed.data.confirmText !== row.disk_name) {
      return fail('CONFIRM_REQUIRED', `请输入当前目录名 "${row.disk_name}" 以确认（L3 破坏性操作）`);
    }
    let newName: string;
    try {
      newName = assertSafeName(parsed.data.newName);
    } catch (err) {
      return fail('INVALID_NAME', err instanceof Error ? err.message : '名字非法');
    }
    const parent = path.dirname(row.dir_path);
    const from = row.dir_path;
    const to = path.join(parent, newName);
    if (fsx.exists(to)) return fail('INVALID_NAME', '目标目录名已存在');
    try {
      fsx.renameSync(from, to);
    } catch (err) {
      return fail(...toApiErrorTuple(err));
    }
    // 大小写-only 重命名在 Windows 上需两步；renameSync 同名不同大小写直接成功
    fsx.markSelfWrite(to);
    const abs = await fsxPromised(to);
    patchProject(db, id, {
      dir_path: abs,
      dir_path_key: pathKey(abs),
      disk_name: newName,
      path_ok: 1,
      path_checked_at: new Date().toISOString(),
    });
    logActivity(db, {
      kind: 'project.rename_disk',
      level: 'L3',
      projectId: id,
      detail: { from, to: abs },
      targetPath: abs,
    });
    ctx.sse.publish('project.updated', { projectId: id });
    void analyzeProjects(ctx, [id]);
    return ok({ renamed: true, newPath: abs });
  });

  // ---- 目录枚举（父目录批量登记） ----
  app.get('/api/folders/children', async (req) => {
    const q = req.query as { path?: string };
    if (q.path === undefined || q.path.trim() === '') return fail('BAD_REQUEST', '缺少 path');
    const abs = path.resolve(q.path.trim().replace(/^"|"$/g, ''));
    const st = fsx.statSafe(abs);
    if (st === null || !st.isDir) return fail('NOT_FOUND', '目录不存在', 404);
    let entries: fsx.FsEntry[];
    try {
      entries = fsx.listEntries(abs);
    } catch (err) {
      return fail(...toApiErrorTuple(err));
    }
    const db = ctx.db();
    const children = entries
      .filter((e) => e.isDir && e.name.indexOf('.') !== 0)
      .slice(0, 500)
      .map((e) => {
        const full = path.join(abs, e.name);
        const registered = getProjectByPathKey(db, pathKey(full));
        return {
          name: e.name,
          path: full,
          registered: registered !== undefined,
          registeredProjectId: registered?.id ?? null,
        };
      });
    return ok({ path: abs, children });
  });

  // ---- 最近打开 ----
  app.get('/api/recent', async (req) => {
    const q = req.query as { type?: string };
    if (q.type === 'files') return ok(listRecentFiles(ctx.db(), 50));
    return ok(listProjects(ctx.db(), { status: 'all', sort: 'last_opened' }).slice(0, 20));
  });

  // ---- 集合 ----
  app.get('/api/collections', async () => ok(listCollections(ctx.db())));

  app.post('/api/collections', async (req) => {
    const parsed = collectionCreateSchema.safeParse(req.body);
    if (!parsed.success) return fail('BAD_REQUEST', '参数不合法');
    const db = ctx.db();
    const id = ulid();
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO collections (id, name, note, sort_order, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)',
    ).run(id, parsed.data.name, parsed.data.note ?? null, now, now);
    return ok(listCollections(db).find((c) => c.id === id) ?? null);
  });

  app.patch('/api/collections/:id', async (req) => {
    const { id } = req.params as { id: string };
    const parsed = collectionCreateSchema.partial().safeParse(req.body);
    if (!parsed.success) return fail('BAD_REQUEST', '参数不合法');
    const db = ctx.db();
    db.prepare(
      'UPDATE collections SET name = COALESCE(?, name), note = COALESCE(?, note), updated_at = ? WHERE id = ?',
    ).run(parsed.data.name ?? null, parsed.data.note ?? null, new Date().toISOString(), id);
    return ok(listCollections(db).find((c) => c.id === id) ?? null);
  });

  app.delete('/api/collections/:id', async (req) => {
    const { id } = req.params as { id: string };
    ctx.db().prepare('DELETE FROM collections WHERE id = ?').run(id);
    return ok({ deleted: true });
  });

  app.post('/api/collections/:id/members', async (req) => {
    const { id } = req.params as { id: string };
    const parsed = collectionMembersSchema.safeParse(req.body);
    if (!parsed.success) return fail('BAD_REQUEST', '参数不合法');
    const db = ctx.db();
    const tx = db.transaction(() => {
      if (parsed.data.replace) {
        db.prepare('DELETE FROM collection_members WHERE collection_id = ?').run(id);
      }
      const ins = db.prepare(
        'INSERT OR IGNORE INTO collection_members (collection_id, project_id, sort_order) VALUES (?, ?, 0)',
      );
      for (const pid of parsed.data.projectIds) ins.run(id, pid);
    });
    tx();
    return ok(listCollections(db).find((c) => c.id === id) ?? null);
  });

  // 从集合移除单个项目：专用删除语义——此前前端用「全量替换成员列表」（replace:true +
  // 打开弹窗时的快照减自己）实现移除，两个窗口同时编辑同一集合时后保存者会覆盖先保存者的修改
  app.delete('/api/collections/:id/members/:projectId', async (req) => {
    const { id, projectId } = req.params as { id: string; projectId: string };
    ctx
      .db()
      .prepare('DELETE FROM collection_members WHERE collection_id = ? AND project_id = ?')
      .run(id, projectId);
    return ok(listCollections(ctx.db()).find((c) => c.id === id) ?? null);
  });

  // ---- 标签 ----
  app.get('/api/tags', async () => {
    const db = ctx.db();
    return ok(
      db
        .prepare<[], { id: string; name: string; color: string | null }>('SELECT * FROM tags ORDER BY name')
        .all(),
    );
  });

  app.post('/api/projects/:id/tags', async (req) => {
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { name?: string };
    if (b.name === undefined || b.name.trim() === '') return fail('INVALID_NAME', '标签名不能为空');
    const db = ctx.db();
    const name = b.name.trim();
    let tag = db
      .prepare<[string], { id: string; name: string; color: string | null }>(
        'SELECT * FROM tags WHERE name = ?',
      )
      .get(name);
    if (tag === undefined) {
      const tid = ulid();
      db.prepare('INSERT INTO tags (id, name) VALUES (?, ?)').run(tid, name);
      tag = { id: tid, name, color: null };
    }
    db.prepare('INSERT OR IGNORE INTO project_tags (project_id, tag_id) VALUES (?, ?)').run(id, tag.id);
    ctx.sse.publish('project.updated', { projectId: id });
    return ok(tag);
  });

  app.delete('/api/projects/:id/tags/:tagId', async (req) => {
    const { id, tagId } = req.params as { id: string; tagId: string };
    ctx.db().prepare('DELETE FROM project_tags WHERE project_id = ? AND tag_id = ?').run(id, tagId);
    ctx.sse.publish('project.updated', { projectId: id });
    return ok({ deleted: true });
  });
};

function defaultArchDirName(db: import('better-sqlite3').Database): string {
  const row = db
    .prepare<[string], { value: string | null }>('SELECT value FROM settings WHERE key = ?')
    .get('default_arch_dir_name');
  return row?.value ?? '架构图';
}

function toApiErrorTuple(err: unknown): [import('@ttfolio/shared').ErrorCode, string, number] {
  const e = toApiError(err);
  return [e.code, e.message, e.status];
}

async function fsxPromised(p: string): Promise<string> {
  const { promises } = await import('node:fs');
  try {
    return await promises.realpath(p);
  } catch {
    return p;
  }
}

export { recordRecentFile };
