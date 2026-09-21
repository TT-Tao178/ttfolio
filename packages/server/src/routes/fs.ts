/** 文件路由：树/读/写(冲突三选一)/新建/重命名/移动复制/删除(回收站)/raw/文件名搜索/草稿。 */
import type { FastifyPluginAsync } from 'fastify';
import path from 'node:path';
import type { AppContext } from '../context.js';
import { ok, fail, toApiError } from './helpers.js';
import { AppError } from '../core/errors.js';
import * as fsx from '../core/fsx.js';
import { assertSafeName } from '../core/pathGuard.js';
import { resolveInProject } from '../roots.js';
import { buildMatcher } from '../core/search.js';
import { draftPutSchema, fsEntryCreateSchema, fsFileSaveSchema, fsMoveSchema, fsRenameSchema } from '@ttfolio/shared';
import { MAX_TEXT_EDIT_BYTES, MAX_PREVIEW_BYTES } from '@ttfolio/shared';
import { getDraft, putDraft, deleteDraft } from '../db/repo/filesRepo.js';
import { recordRecentFile } from '../db/repo/metaRepo.js';
import { gitStatusMarks } from '../core/gitfs.js';
import { logActivity } from '../db/repo/metaRepo.js';
import { currentActor } from '../core/actor.js';

const BINARY_EXTS = new Set(['png','jpg','jpeg','gif','webp','bmp','ico','pdf','zip','gz','tar','rar','7z','exe','dll','so','dylib','mp4','mov','mp3','wav','woff','woff2','ttf','otf','eot','psd','ai']);

export const fsRoutes: FastifyPluginAsync = async (app) => {
  const ctx = app.ttfolio as AppContext;

  // ---- 文件树（懒加载一层） ----
  app.get('/api/fs/tree', async (req) => {
    const q = req.query as { projectId?: string; path?: string; showIgnored?: string };
    if (q.projectId === undefined) return fail('BAD_REQUEST', '缺少 projectId');
    const showIgnored = q.showIgnored === '1' || q.showIgnored === 'true';
    let guarded;
    try {
      guarded = await resolveInProject(ctx.db(), q.projectId, q.path ?? '', { mustExist: true });
    } catch (err) {
      return fail(...toApiErrorTuple(err));
    }
    const matcher = buildMatcher(ctx.db(), q.projectId);
    const marks = await gitStatusMarks(ctx.db(), q.projectId);
    let entries: fsx.FsEntry[] = [];
    try {
      entries = fsx.listEntries(guarded.real);
    } catch (err) {
      return fail(...toApiErrorTuple(err));
    }
    const nodes = [];
    for (const e of entries.slice(0, 2000)) {
      const rel = guarded.relToRoot === '' ? e.name : `${guarded.relToRoot}/${e.name}`;
      const hidden = matcher.isHidden(rel);
      if (hidden && !showIgnored) continue;
      const abs = path.join(guarded.real, e.name);
      const st = e.isFile ? fsx.statSafe(abs) : null;
      nodes.push({
        name: e.name,
        path: rel,
        kind: e.isDir ? 'dir' : 'file',
        size: st?.size,
        mtime: st?.mtimeIso,
        gitState: marks.get(rel.toLowerCase()),
        ignored: hidden
      });
    }
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name, 'zh-CN');
    });
    return ok({ path: guarded.relToRoot, nodes });
  });

  // ---- 读文件 ----
  app.get('/api/fs/file', async (req) => {
    const q = req.query as { projectId?: string; path?: string };
    if (q.projectId === undefined || q.path === undefined) return fail('BAD_REQUEST', '缺少参数');
    try {
      const guarded = await resolveInProject(ctx.db(), q.projectId, q.path, { mustExist: true });
      const st = fsx.statSafe(guarded.real);
      if (st === null) return fail('NOT_FOUND', '文件不存在', 404);
      const ext = path.extname(guarded.real).replace(/^\./, '').toLowerCase();
      const buf = fsx.readFileSync(guarded.real);
      const isBinaryExt = BINARY_EXTS.has(ext);
      const tooLarge = st.size > MAX_PREVIEW_BYTES;
      const binary = isBinaryExt || (!tooLarge && fsx.looksBinary(buf.subarray(0, 8192)));
      if (binary || tooLarge) {
        return ok({
          projectId: q.projectId,
          path: guarded.relToRoot,
          absPath: guarded.real,
          content: '',
          encoding: 'utf8',
          eol: 'LF',
          mtime: st.mtimeIso,
          size: st.size,
          hash: '',
          truncated: false,
          isBinary: binary,
          tooLarge
        });
      }
      // 文本：>5MB 只读预览（截断到 5MB）
      const truncated = st.size > MAX_TEXT_EDIT_BYTES;
      const content = fsx.readTextFile(guarded.real, truncated ? MAX_TEXT_EDIT_BYTES : st.size);
      recordRecentFile(ctx.db(), q.projectId, guarded.relToRoot);
      return ok({
        projectId: q.projectId,
        path: guarded.relToRoot,
        absPath: guarded.real,
        content: content.content,
        encoding: content.encoding,
        eol: content.eol,
        mtime: st.mtimeIso,
        size: st.size,
        hash: content.hash,
        truncated,
        isBinary: false,
        tooLarge: false
      });
    } catch (err) {
      return fail(...toApiErrorTuple(err));
    }
  });

  // ---- 保存（三元组校验 + 原子写，C-05/C-06） ----
  app.put('/api/fs/file', async (req) => {
    const parsed = fsFileSaveSchema.safeParse(req.body);
    if (!parsed.success) return fail('BAD_REQUEST', '参数不合法');
    const b = parsed.data;
    try {
      const guarded = await resolveInProject(ctx.db(), b.projectId, b.path, { mustExist: true });
      const st = fsx.statSafe(guarded.real);
      if (st === null) return fail('NOT_FOUND', '文件不存在', 404);
      // 只读文件明确报错，不改权限（C-08）
      checkWritable(guarded.real);
      if (!b.force) {
        const disk = fsx.readTextFile(guarded.real, st.size > MAX_TEXT_EDIT_BYTES ? MAX_TEXT_EDIT_BYTES : st.size);
        const baseKnown = b.baseHash !== null && b.baseHash !== undefined && b.baseHash !== '';
        if (!baseKnown || disk.hash !== b.baseHash || st.size !== (b.baseSize ?? -1) || st.mtimeIso !== b.baseMtime) {
          return fail('MTIME_CONFLICT', '文件已在磁盘上被修改', 409, {
            current: {
              mtime: st.mtimeIso,
              size: st.size,
              hash: disk.hash,
              content: disk.content,
              encoding: disk.encoding,
              eol: disk.eol
            }
          });
        }
      }
      const eol = b.eol === 'CRLF' ? 'CRLF' : b.eol === 'MIXED' ? 'MIXED' : 'LF';
      fsx.atomicWriteText(guarded.real, b.content, (b.encoding as fsx.DetectedEncoding) ?? 'utf8', eol);
      const after = fsx.readTextFile(guarded.real, MAX_TEXT_EDIT_BYTES + 1);
      logActivity(ctx.db(), { kind: 'fs.save', level: 'L2', projectId: b.projectId, targetPath: guarded.real, actor: currentActor().actor });
      return ok({ mtime: after.mtimeMs ? new Date(after.mtimeMs).toISOString() : '', size: after.size, hash: after.hash });
    } catch (err) {
      return fail(...toApiErrorTuple(err));
    }
  });

  // ---- 新建文件/文件夹 ----
  app.post('/api/fs/entry', async (req) => {
    const parsed = fsEntryCreateSchema.safeParse(req.body);
    if (!parsed.success) return fail('BAD_REQUEST', '参数不合法');
    const b = parsed.data;
    try {
      const name = assertSafeName(b.name);
      const guarded = await resolveInProject(ctx.db(), b.projectId, path.join(b.parentPath, name), { mustExist: false });
      if (fsx.exists(guarded.real)) return fail('INVALID_NAME', '同名文件或目录已存在');
      if (b.kind === 'dir') {
        fsx.ensureDir(guarded.real);
      } else {
        fsx.ensureDir(path.dirname(guarded.real));
        fsx.writeFileSync(guarded.real, '', 'utf8');
      }
      fsx.markSelfWrite(guarded.real);
      logActivity(ctx.db(), { kind: 'fs.create', level: 'L2', projectId: b.projectId, targetPath: guarded.real, actor: currentActor().actor });
      ctx.sse.publish('fs.changed', { projectId: b.projectId, paths: [guarded.real], kind: 'create' });
      return ok({ path: guarded.relToRoot });
    } catch (err) {
      return fail(...toApiErrorTuple(err));
    }
  });

  // ---- 重命名（文件 L2 / 目录 L3 需 confirm） ----
  app.post('/api/fs/rename', async (req) => {
    const parsed = fsRenameSchema.safeParse(req.body);
    if (!parsed.success) return fail('BAD_REQUEST', '参数不合法');
    const b = parsed.data;
    try {
      const name = assertSafeName(b.newName);
      const guarded = await resolveInProject(ctx.db(), b.projectId, b.path, { mustExist: true });
      const isDir = fsx.statSafe(guarded.real)?.isDir ?? false;
      if (isDir && b.confirm !== true) {
        return fail('CONFIRM_REQUIRED', '目录重命名是 L3 破坏性操作，会影响内部所有路径，需要 confirm');
      }
      const target = path.join(path.dirname(guarded.real), name);
      if (fsx.exists(target) && target.toLowerCase() !== guarded.real.toLowerCase()) {
        return fail('INVALID_NAME', '同名目标已存在');
      }
      const before = fsx.measureTree(guarded.real);
      fsx.renameSync(guarded.real, target);
      fsx.markSelfWrite(target);
      logActivity(ctx.db(), {
        kind: 'fs.rename',
        level: isDir ? 'L3' : 'L2',
        projectId: b.projectId,
        targetPath: target,
        detail: { from: guarded.real, to: target, affectedFiles: before.files },
        actor: currentActor().actor
      });
      ctx.sse.publish('fs.changed', { projectId: b.projectId, paths: [guarded.real, target], kind: 'delete' });
      return ok({ path: path.relative(guarded.projectRoot, target).split(path.sep).join('/') });
    } catch (err) {
      return fail(...toApiErrorTuple(err));
    }
  });

  // ---- 移动 / 复制（异步任务 + 进度 + 可取消） ----
  app.post('/api/fs/move', async (req) => {
    const parsed = fsMoveSchema.safeParse(req.body);
    if (!parsed.success) return fail('BAD_REQUEST', '参数不合法');
    const b = parsed.data;
    try {
      const targetDir = await resolveInProject(ctx.db(), b.projectId, b.targetDir, { mustExist: true });
      const items = [];
      for (const p of b.items) {
        const g = await resolveInProject(ctx.db(), b.projectId, p, { mustExist: true });
        items.push(g);
      }
      for (const item of items) {
        const name = path.basename(item.real);
        const dest = path.join(targetDir.real, name);
        if (dest.toLowerCase() === item.real.toLowerCase()) continue;
        if (fsx.exists(dest)) {
          if (b.onConflict === 'skip') continue;
          if (b.onConflict === 'ask') return fail('INVALID_NAME', `目标已存在：${name}（可选择 覆盖 或 跳过）`);
        }
        if (b.mode === 'move') {
          const isDirMove = fsx.statSafe(item.real)?.isDir ?? false;
          if (isDirMove && item.real.toLowerCase() !== dest.toLowerCase() && path.dirname(item.real).toLowerCase() !== targetDir.real.toLowerCase()) {
            // 目录移动到自身子目录：拒绝
            if (dest.toLowerCase().indexOf(item.real.toLowerCase()) === 0) {
              return fail('INVALID_NAME', '不能把目录移动到它自己的子目录内');
            }
          }
          fsx.movePath(item.real, dest);
          if (b.confirm !== true && (fsx.statSafe(item.real) === null)) {
            // move 完成
          }
        } else {
          fsx.copyRecursive(item.real, dest);
        }
        fsx.markSelfWrite(dest);
      }
      logActivity(ctx.db(), {
        kind: b.mode === 'move' ? 'fs.move' : 'fs.copy',
        level: 'L2',
        projectId: b.projectId,
        detail: { items: b.items, target: targetDir.real },
        actor: currentActor().actor
      });
      ctx.sse.publish('fs.changed', { projectId: b.projectId, paths: [targetDir.real], kind: 'create' });
      return ok({ done: true });
    } catch (err) {
      return fail(...toApiErrorTuple(err));
    }
  });

  // ---- 删除（进回收站，L3） ----
  app.post('/api/fs/delete', async (req) => {
    const b = (req.body ?? {}) as { projectId?: string; paths?: string[]; confirm?: boolean };
    if (b.projectId === undefined || b.paths === undefined) return fail('BAD_REQUEST', '缺少参数');
    if (b.confirm !== true) {
      return fail('CONFIRM_REQUIRED', '删除是 L3 操作：文件将移入回收站（可在回收站恢复），需要 confirm=true');
    }
    const db = ctx.db();
    const ids = [];
    const affected = { files: 0, bytes: 0 };
    try {
      for (const p of b.paths) {
        const g = await resolveInProject(db, b.projectId, p, { mustExist: true });
        const before = fsx.measureTree(g.real);
        affected.files += before.files;
        affected.bytes += before.bytes;
        const moved = ctx.trash.moveToTrash(db, [g.real], b.projectId, g.projectRoot);
        ids.push(...moved);
        logActivity(db, { kind: 'fs.delete', level: 'L3', projectId: b.projectId, targetPath: g.real, detail: { files: before.files, bytes: before.bytes }, actor: currentActor().actor });
      }
    } catch (err) {
      return fail(...toApiErrorTuple(err));
    }
    ctx.sse.publish('fs.changed', { projectId: b.projectId, paths: [], kind: 'delete' });
    ctx.sse.publish('trash.changed', {});
    return ok({ trashIds: ids, affected });
  });

  // ---- 文件名搜索（FR-4.10） ----
  app.get('/api/fs/search', async (req) => {
    const q = req.query as { projectId?: string; q?: string; caseSensitive?: string; wholeWord?: string };
    if (q.projectId === undefined || q.q === undefined || q.q === '') return fail('BAD_REQUEST', '缺少参数');
    let guarded;
    try {
      guarded = await resolveInProject(ctx.db(), q.projectId, '', { mustExist: true });
    } catch (err) {
      return fail(...toApiErrorTuple(err));
    }
    const matcher = buildMatcher(ctx.db(), q.projectId);
    const needle = q.caseSensitive === '1' ? q.q : q.q.toLowerCase();
    const results: Array<{ name: string; path: string; kind: 'dir' | 'file' }> = [];
    const stack: string[] = [guarded.real];
    while (stack.length > 0 && results.length < 500) {
      const dir = stack.pop();
      if (dir === undefined) break;
      let entries: fsx.FsEntry[] = [];
      try {
        entries = fsx.listEntries(dir);
      } catch {
        continue;
      }
      for (const e of entries) {
        const abs = path.join(dir, e.name);
        const rel = path.relative(guarded.real, abs).split(path.sep).join('/');
        if (matcher.isHidden(rel)) continue;
        const hay = q.caseSensitive === '1' ? e.name : e.name.toLowerCase();
        const hit = q.wholeWord === '1' ? hay === needle : hay.includes(needle);
        if (hit) results.push({ name: e.name, path: rel, kind: e.isDir ? 'dir' : 'file' });
        if (e.isDir) stack.push(abs);
      }
    }
    return ok({ results });
  });

  // ---- 草稿 ----
  app.get('/api/drafts', async (req) => {
    const q = req.query as { scope?: string; pathKey?: string };
    if (q.pathKey === undefined) return fail('BAD_REQUEST', '缺少 pathKey');
    const row = getDraft(ctx.db(), q.scope ?? 'project_file', q.pathKey);
    if (row === undefined) return ok(null);
    return ok({
      pathKey: row.path_key,
      content: row.content,
      baseMtime: row.base_mtime,
      baseSize: row.base_size,
      baseHash: row.base_hash,
      encoding: row.encoding,
      eol: row.eol,
      updatedAt: row.updated_at,
      projectId: row.project_id
    });
  });

  app.put('/api/drafts', async (req) => {
    const parsed = draftPutSchema.safeParse(req.body);
    if (!parsed.success) return fail('BAD_REQUEST', '参数不合法');
    const b = parsed.data;
    putDraft(ctx.db(), {
      scope: b.scope,
      projectId: b.projectId ?? null,
      mountId: b.mountId ?? null,
      pathKey: b.pathKey,
      content: b.content,
      baseMtime: b.baseMtime ?? null,
      baseSize: b.baseSize ?? null,
      baseHash: b.baseHash ?? null,
      encoding: b.encoding ?? null,
      eol: b.eol ?? null
    });
    return ok({ saved: true });
  });

  app.delete('/api/drafts', async (req) => {
    const q = req.query as { scope?: string; pathKey?: string };
    if (q.pathKey === undefined) return fail('BAD_REQUEST', '缺少 pathKey');
    deleteDraft(ctx.db(), q.scope ?? 'project_file', q.pathKey);
    return ok({ deleted: true });
  });
};

function checkWritable(absPath: string): void {
  try {
    fsx.accessSyncForWrite(absPath);
  } catch {
    throw new AppError('PERMISSION_DENIED', '文件只读或权限不足，保存失败（不会修改文件权限）');
  }
}

function toApiErrorTuple(err: unknown): [import('@ttfolio/shared').ErrorCode, string, number, unknown?] {
  const e = toApiError(err);
  return [e.code, e.message, e.status, e.detail];
}
