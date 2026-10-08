/** 架构图路由（FR-7.x）：登记/元数据/入口设置/删除。 */
import type { FastifyPluginAsync } from 'fastify';
import path from 'node:path';
import type { AppContext } from '../context.js';
import { ok, fail } from './helpers.js';
import * as fsx from '../core/fsx.js';
import { archiveCreateSchema, archivePatchSchema } from '@ttfolio/shared';
import { toApiError } from './helpers.js';
import {
  listArchives,
  upsertArchive,
  patchArchive,
  deleteArchive,
  setArchiveViewed,
  toArchiveInfo,
} from '../db/repo/docsRepo.js';
import { getProjectRow } from '../db/repo/projectsRepo.js';
import { computeArchiveMeta } from '../core/analyzer/index.js';
import { logActivity } from '../db/repo/metaRepo.js';
import { currentActor } from '../core/actor.js';

export const archivesRoutes: FastifyPluginAsync = async (app) => {
  const ctx = app.ttfolio as AppContext;

  app.get('/api/projects/:id/archives', async (req) => {
    const { id } = req.params as { id: string };
    const db = ctx.db();
    const row = getProjectRow(db, id);
    if (row === undefined) return fail('NOT_FOUND', '项目不存在', 404);
    const infos = [];
    for (const a of listArchives(db, id)) {
      const meta = computeArchiveMeta(a.dir_path, a.entry_source === 'manual' ? a.entry_rel : null);
      const countChanged =
        meta.htmlFiles.length !== a.html_count || Math.abs(meta.totalBytes - a.total_bytes) > 512;
      const entryMtimeChanged =
        a.entry_rel !== null &&
        (() => {
          const hit = meta.htmlFiles.find((f) => f.rel === a.entry_rel);
          const seen = a.last_seen_at;
          return hit !== undefined && seen !== null && hit.mtime > seen;
        })();
      infos.push(
        toArchiveInfo(
          a,
          meta.htmlFiles,
          meta.htmlFiles
            .filter((f) => f.hasSourceJson)
            .map((f) => f.rel.replace(/\.html?$/i, '.architecture.json')),
          countChanged || entryMtimeChanged,
          meta.imageFiles,
          meta.textFiles,
        ),
      );
    }
    return ok(infos);
  });

  app.post('/api/projects/:id/archives', async (req) => {
    const { id } = req.params as { id: string };
    const parsed = archiveCreateSchema.safeParse(req.body);
    if (!parsed.success) return fail('BAD_REQUEST', '参数不合法');
    const db = ctx.db();
    const row = getProjectRow(db, id);
    if (row === undefined) return fail('NOT_FOUND', '项目不存在', 404);
    const abs = path.resolve(parsed.data.dirPath.trim().replace(/^"|"$/g, ''));
    const st = fsx.statSafe(abs);
    if (st === null || !st.isDir) return fail('NOT_FOUND', '目录不存在', 404);
    const meta = computeArchiveMeta(abs);
    const archive = upsertArchive(db, {
      projectId: id,
      dirPath: abs,
      label: parsed.data.label ?? path.basename(abs),
      isDefault: false,
      htmlCount: meta.htmlFiles.length,
      totalBytes: meta.totalBytes,
      entryRel: meta.entryRel,
      entrySource: meta.entrySource,
    });
    db.prepare('UPDATE projects SET has_arch = 1 WHERE id = ?').run(id);
    logActivity(db, {
      kind: 'archive.register',
      level: 'L1',
      projectId: id,
      targetPath: abs,
      actor: currentActor().actor,
    });
    ctx.sse.publish('project.updated', { projectId: id });
    return ok(archive);
  });

  app.patch('/api/archives/:id', async (req) => {
    const { id } = req.params as { id: string };
    const parsed = archivePatchSchema.safeParse(req.body);
    if (!parsed.success) return fail('BAD_REQUEST', '参数不合法');
    const db = ctx.db();
    const b = parsed.data;
    let entrySource: 'index_html' | 'manual' | 'list' | undefined;
    if (b.entryRel !== undefined && b.entryRel !== null && b.entryRel !== '') entrySource = 'manual';
    else if (b.entryRel === '') entrySource = 'list';
    const found = patchArchive(db, id, {
      entryRel: b.entryRel,
      entrySource,
      isDefault: b.isDefault,
      label: b.label,
    });
    if (!found) return fail('NOT_FOUND', '架构图目录不存在', 404);
    ctx.sse.publish('project.updated', { projectId: getArchiveProjectId(db, id) });
    return ok({ updated: true });
  });

  app.delete('/api/archives/:id', async (req) => {
    const { id } = req.params as { id: string };
    const db = ctx.db();
    const pid = getArchiveProjectId(db, id);
    const found = deleteArchive(db, id);
    if (!found) return fail('NOT_FOUND', '架构图目录不存在', 404);
    logActivity(db, { kind: 'archive.unregister', level: 'L1', projectId: pid, actor: currentActor().actor });
    if (pid !== null) ctx.sse.publish('project.updated', { projectId: pid });
    return ok({ deleted: true });
  });

  app.post('/api/archives/:id/viewed', async (req) => {
    const { id } = req.params as { id: string };
    setArchiveViewed(ctx.db(), id);
    return ok({ done: true });
  });

  // ---- 文本类文件只读内容（第 26 轮）----
  // 为什么不走 7817 arch 通道：页面与 7817 跨源，fetch 读文本会被 CORS 拦（iframe/img 不受限）。
  // 只读约束：rel 必须解析在登记目录内（防 ../ 越界）+ 文本扩展名白名单 + 2MB 上限，绝不写盘。
  app.get('/api/archives/:id/file', async (req) => {
    const { id } = req.params as { id: string };
    const q = req.query as { rel?: string };
    if (q.rel === undefined || q.rel === '') return fail('BAD_REQUEST', '缺少 rel');
    const db = ctx.db();
    const pid = getArchiveProjectId(db, id);
    if (pid === null) return fail('NOT_FOUND', '架构图目录不存在', 404);
    const row = listArchives(db, pid).find((a) => a.id === id);
    if (row === undefined) return fail('NOT_FOUND', '架构图目录不存在', 404);
    if (!/\.(md|markdown|txt|json)$/i.test(q.rel)) return fail('BAD_REQUEST', '仅支持文本类文件');
    const abs = path.resolve(row.dir_path, q.rel);
    const dirAbs = path.resolve(row.dir_path);
    const relCheck = path.relative(dirAbs, abs);
    if (relCheck.indexOf('..') === 0 || path.isAbsolute(relCheck))
      return fail('PATH_OUT_OF_SCOPE', '路径越界');
    const st = fsx.statSafe(abs);
    if (st === null || st.isDir) return fail('NOT_FOUND', '文件不存在', 404);
    if (st.size > 2 * 1024 * 1024) return fail('BAD_REQUEST', '文件超过 2MB，请用系统工具查看');
    try {
      const content = fsx.readTextFile(abs, st.size).content;
      logActivity(db, {
        kind: 'archive.read_text',
        level: 'L1',
        projectId: pid,
        targetPath: abs,
        actor: currentActor().actor,
      });
      return ok({ content });
    } catch (err) {
      return fail(...toApiErrorTuple(err));
    }
  });
};

function getArchiveProjectId(db: import('better-sqlite3').Database, id: string): string | null {
  const row = db
    .prepare<[string], { project_id: string }>('SELECT project_id FROM archives WHERE id = ?')
    .get(id);
  return row?.project_id ?? null;
}

function toApiErrorTuple(err: unknown): [import('@ttfolio/shared').ErrorCode, string, number, unknown?] {
  const e = toApiError(err);
  return [e.code, e.message, e.status, e.detail];
}
