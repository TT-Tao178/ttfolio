/** 文档路由：文档根 CRUD + 自动匹配（8.8 打分）+ 挂载 + 项目文档列表 + 文档读写。 */
import type { FastifyPluginAsync } from 'fastify';
import path from 'node:path';
import type { AppContext } from '../context.js';
import { ok, fail, toApiError } from './helpers.js';
import * as fsx from '../core/fsx.js';
import { AppError } from '../core/errors.js';
import { docRootCreateSchema, docsContentPutSchema, mountCreateSchema, mountRelocateSchema } from '@ttfolio/shared';
import {
  listDocRoots, createDocRoot, deleteDocRoot, listMounts, createMount, deleteMount,
  getMount, setMountExists, pathKey, listAllMounts
} from '../db/repo/docsRepo.js';
import { getProjectRow, listProjects } from '../db/repo/projectsRepo.js';
import { logActivity, getSetting } from '../db/repo/metaRepo.js';
import { resolveInProject } from '../roots.js';
import { buildMatcher } from '../core/search.js';
import { currentActor } from '../core/actor.js';
import { SETTING_KEYS } from '@ttfolio/shared';

// ---------- 归一化与打分（8.8） ----------
export function normalizeName(raw: string): string {
  let s = raw.trim();
  s = s.replace(/\s+/g, '');
  // 全角转半角
  s = s.replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
  s = s.toLowerCase();
  s = s.replace(/(设计文档|文档|docs|资料|笔记)+$/g, '');
  return s;
}

function tokenize(s: string): Set<string> {
  const parts = s.split(/[-_/.\s]+|(?<=[a-z0-9])(?=[A-Z])/).filter((p) => p !== '');
  return new Set(parts);
}

export function matchScore(target: string, name: string): number {
  if (target === '' || name === '') return 0;
  if (target === name) return 100;
  const lenDiff = Math.abs(target.length - name.length);
  if ((name.includes(target) || target.includes(name)) && lenDiff <= 6) return 70;
  const t = tokenize(target);
  const n = tokenize(name);
  let inter = 0;
  for (const tok of t) {
    if (n.has(tok)) inter++;
  }
  const union = new Set([...t, ...n]).size;
  if (union > 0 && inter / union >= 0.6) return 40;
  return 0;
}

export const docsRoutes: FastifyPluginAsync = async (app) => {
  const ctx = app.ttfolio as AppContext;

  // ---- 文档根 ----
  app.get('/api/doc-roots', async () => ok(listDocRoots(ctx.db())));

  app.post('/api/doc-roots', async (req) => {
    const parsed = docRootCreateSchema.safeParse(req.body);
    if (!parsed.success) return fail('BAD_REQUEST', '参数不合法');
    const abs = path.resolve(parsed.data.path.trim().replace(/^"|"$/g, ''));
    const st = fsx.statSafe(abs);
    if (st === null || !st.isDir) return fail('NOT_FOUND', '文档根目录不存在', 404);
    const root = createDocRoot(ctx.db(), abs, parsed.data.label ?? null);
    logActivity(ctx.db(), { kind: 'doc_root.add', level: 'L1', targetPath: abs, actor: currentActor().actor });
    return ok(root);
  });

  app.delete('/api/doc-roots/:id', async (req) => {
    const { id } = req.params as { id: string };
    const found = deleteDocRoot(ctx.db(), id);
    if (!found) return fail('NOT_FOUND', '文档根不存在', 404);
    return ok({ deleted: true });
  });

  // ---- 自动匹配（一层子目录名） ----
  app.get('/api/doc-roots/:id/matches', async (req) => {
    const { id } = req.params as { id: string };
    const db = ctx.db();
    const roots = listDocRoots(db);
    const root = roots.find((r) => r.id === id);
    if (root === undefined) return fail('NOT_FOUND', '文档根不存在', 404);
    let blacklist: string[] = [];
    try {
      const raw = getSetting(db, SETTING_KEYS.docRootBlacklist);
      if (raw !== null && raw !== '') blacklist = JSON.parse(raw) as string[];
    } catch {
      blacklist = [];
    }
    let subDirs: Array<{ name: string; path: string }> = [];
    try {
      const entries = fsx.listEntries(root.path);
      subDirs = entries.filter((e) => e.isDir).map((e) => ({ name: e.name, path: path.join(root.path, e.name) }));
    } catch {
      subDirs = [];
    }
    const projects = listProjects(db, { status: 'all' });
    const matches = [];
    for (const dir of subDirs) {
      const key = pathKey(dir.path);
      if (blacklist.includes(key)) {
        matches.push({ dirName: dir.name, path: dir.path, score: 0, projectId: null, projectName: '', status: 'blacklisted' });
        continue;
      }
      const name = normalizeName(dir.name);
      const scored = projects
        .map((p) => ({ p, score: matchScore(normalizeName(p.alias ?? p.diskName), name) }))
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score);
      const top = scored[0];
      const topScore = top?.score ?? 0;
      const tied = scored.filter((x) => x.score === topScore && topScore >= 100);
      let status: string;
      let projectId: string | null = null;
      if (topScore >= 100 && tied.length === 1) {
        status = 'matched';
        projectId = top?.p.id ?? null;
      } else if (topScore >= 100 && tied.length > 1) {
        status = 'ambiguous';
      } else if (topScore >= 70) {
        status = 'pending';
        projectId = top?.p.id ?? null;
      } else {
        status = 'unmatched';
      }
      matches.push({
        dirName: dir.name,
        path: dir.path,
        score: topScore,
        projectId,
        projectName: top?.p.alias ?? top?.p.diskName ?? '',
        status
      });
    }
    // 已绑定信息
    const existing = listAllMounts(db).filter((m) => m.source === 'auto_root');
    return ok({ matches, existing });
  });

  app.post('/api/doc-roots/:id/bind', async (req) => {
    const b = (req.body ?? {}) as { path?: string; projectId?: string };
    if (b.path === undefined || b.projectId === undefined) return fail('BAD_REQUEST', '缺少参数');
    const st = fsx.statSafe(b.path);
    if (st === null) return fail('NOT_FOUND', '目录不存在', 404);
    const mount = createMount(ctx.db(), {
      projectId: b.projectId,
      kind: 'dir',
      path: b.path,
      label: path.basename(b.path),
      source: 'auto_root',
      rootId: (req.params as { id: string }).id
    });
    ctx.sse.publish('project.updated', { projectId: b.projectId });
    return ok(mount);
  });

  app.post('/api/doc-roots/:id/blacklist', async (req) => {
    const b = (req.body ?? {}) as { path?: string };
    if (b.path === undefined) return fail('BAD_REQUEST', '缺少 path');
    const db = ctx.db();
    let list: string[] = [];
    try {
      const raw = getSetting(db, SETTING_KEYS.docRootBlacklist);
      if (raw !== null && raw !== '') list = JSON.parse(raw) as string[];
    } catch {
      list = [];
    }
    const key = pathKey(b.path);
    if (!list.includes(key)) list.push(key);
    db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
      SETTING_KEYS.docRootBlacklist, JSON.stringify(list), new Date().toISOString()
    );
    return ok({ blacklisted: true });
  });

  // ---- 挂载 ----
  app.get('/api/projects/:id/mounts', async (req) => {
    const { id } = req.params as { id: string };
    const mounts = listMounts(ctx.db(), id);
    for (const m of mounts) {
      const okExist = fsx.exists(m.path);
      if (!okExist !== !m.existsOk) setMountExists(ctx.db(), m.id, okExist);
      m.existsOk = okExist;
    }
    return ok(mounts);
  });

  app.post('/api/projects/:id/mounts', async (req) => {
    const { id } = req.params as { id: string };
    const parsed = mountCreateSchema.safeParse(req.body);
    if (!parsed.success) return fail('BAD_REQUEST', '参数不合法');
    const abs = path.resolve(parsed.data.path.trim().replace(/^"|"$/g, ''));
    const st = fsx.statSafe(abs);
    if (st === null) return fail('NOT_FOUND', '路径不存在', 404);
    const mount = createMount(ctx.db(), {
      projectId: id,
      kind: parsed.data.kind ?? (st.isDir ? 'dir' : 'file'),
      path: abs,
      label: parsed.data.label ?? path.basename(abs),
      source: 'manual',
      rootId: null
    });
    logActivity(ctx.db(), { kind: 'doc.mount', level: 'L1', projectId: id, targetPath: abs, actor: currentActor().actor });
    ctx.sse.publish('project.updated', { projectId: id });
    return ok(mount);
  });

  app.delete('/api/mounts/:id', async (req) => {
    const { id } = req.params as { id: string };
    const m = getMount(ctx.db(), id);
    const found = deleteMount(ctx.db(), id);
    if (!found) return fail('NOT_FOUND', '挂载不存在', 404);
    if (m !== null) {
      if (m.source === 'auto_root') {
        // 解绑自动匹配 → 进黑名单（FR-6.2）
        const db = ctx.db();
        let list: string[] = [];
        try {
          const raw = getSetting(db, SETTING_KEYS.docRootBlacklist);
          if (raw !== null && raw !== '') list = JSON.parse(raw) as string[];
        } catch {
          list = [];
        }
        const key = pathKey(m.path);
        if (!list.includes(key)) list.push(key);
        db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
          SETTING_KEYS.docRootBlacklist, JSON.stringify(list), new Date().toISOString()
        );
      }
      ctx.sse.publish('project.updated', { projectId: m.projectId });
    }
    return ok({ deleted: true });
  });

  app.post('/api/mounts/:id/relocate', async (req) => {
    const { id } = req.params as { id: string };
    const parsed = mountRelocateSchema.safeParse(req.body);
    if (!parsed.success) return fail('BAD_REQUEST', '参数不合法');
    const abs = path.resolve(parsed.data.path.trim());
    const st = fsx.statSafe(abs);
    if (st === null) return fail('NOT_FOUND', '新路径不存在', 404);
    const db = ctx.db();
    db.prepare('UPDATE project_paths SET path = ?, path_key = ?, exists_ok = 1, last_checked_at = ? WHERE id = ?').run(
      abs, pathKey(abs), new Date().toISOString(), id
    );
    return ok({ relocated: true });
  });

  // ---- 项目文档列表（FR-6.1/6.3/6.7） ----
  app.get('/api/projects/:id/docs', async (req) => {
    const { id } = req.params as { id: string };
    const db = ctx.db();
    const row = getProjectRow(db, id);
    if (row === undefined) return fail('NOT_FOUND', '项目不存在', 404);
    const matcher = buildMatcher(db, id);
    const results: Array<{ path: string; mountId: string | null; source: 'project' | 'mount'; label: string; existsOk: boolean; refs: number }> = [];
    // 项目内：README* / docs/**、设计文档/** / 根下 *.md
    const docsDirs = ['docs', '设计文档', 'doc', 'Docs', 'DOCS'];
    const mdFiles = new Map<string, { label: string }>();
    const collectMd = (absDir: string, relDir: string, depth: number): void => {
      if (depth > 2) return;
      let entries: fsx.FsEntry[] = [];
      try {
        entries = fsx.listEntries(absDir);
      } catch {
        return;
      }
      for (const e of entries) {
        const abs = path.join(absDir, e.name);
        const rel = relDir === '' ? e.name : `${relDir}/${e.name}`;
        if (matcher.isHidden(rel)) continue;
        if (e.isDir) {
          if (depth === 0 && docsDirs.includes(e.name)) collectMd(abs, rel, depth + 1);
          continue;
        }
        if (e.isDir) continue;
        const lower = e.name.toLowerCase();
        const isMd = lower.endsWith('.md') || lower.endsWith('.markdown');
        const isReadme = lower.indexOf('readme') === 0;
        if (isMd || isReadme) mdFiles.set(rel, { label: rel });
      }
    };
    collectMd(row.dir_path, '', 0);
    // 根下 docs 目录逐层
    for (const d of docsDirs) {
      const abs = path.join(row.dir_path, d);
      if (fsx.exists(abs) && (fsx.statSafe(abs)?.isDir ?? false)) collectMd(abs, d, 1);
    }
    // 引用计数（同一文档目录被多个项目挂载 → 标注"被 N 个项目引用"）
    const allMounts = listAllMounts(db);
    for (const [rel] of mdFiles) {
      results.push({ path: rel, mountId: null, source: 'project', label: rel, existsOk: true, refs: 1 });
    }
    // 挂载文档
    for (const m of listMounts(db, id)) {
      const exists = fsx.exists(m.path);
      if (!exists) {
        results.push({ path: m.path, mountId: m.id, source: m.source === 'manual' ? 'mount' : 'mount', label: m.label ?? m.path, existsOk: false, refs: allMounts.filter((x) => pathKey(x.path) === pathKey(m.path)).length });
        continue;
      }
      const st = fsx.statSafe(m.path);
      if (st === null) continue;
      if (!st.isDir) {
        results.push({ path: m.path, mountId: m.id, source: 'mount', label: m.label ?? path.basename(m.path), existsOk: true, refs: allMounts.filter((x) => pathKey(x.path) === pathKey(m.path)).length });
        continue;
      }
      // 目录挂载：扫一层 md
      let entries: fsx.FsEntry[] = [];
      try {
        entries = fsx.listEntries(m.path);
      } catch {
        entries = [];
      }
      const refs = allMounts.filter((x) => pathKey(x.path) === pathKey(m.path)).length;
      for (const e of entries) {
        if (!e.isFile) continue;
        const lower = e.name.toLowerCase();
        if (lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.txt')) {
          results.push({ path: path.join(m.path, e.name), mountId: m.id, source: 'mount', label: `${m.label ?? path.basename(m.path)}/${e.name}`, existsOk: true, refs });
        }
      }
      if (entries.length === 0) {
        results.push({ path: m.path, mountId: m.id, source: 'mount', label: m.label ?? path.basename(m.path), existsOk: true, refs });
      }
    }
    return ok({ docs: results });
  });

  // ---- 文档内容读写（与文件同一套冲突规则，FR-6.5） ----
  app.get('/api/docs/content', async (req) => {
    const q = req.query as { projectId?: string; path?: string; mountId?: string };
    if (q.projectId === undefined || q.path === undefined) return fail('BAD_REQUEST', '缺少参数');
    try {
      const abs = q.mountId !== undefined ? resolveMountPath(ctx, q.mountId, q.path) : (await resolveInProject(ctx.db(), q.projectId, q.path, { mustExist: true })).real;
      const st = fsx.statSafe(abs);
      if (st === null) return fail('NOT_FOUND', '文档不存在', 404);
      const content = fsx.readTextFile(abs, 20 * 1024 * 1024);
      return ok({
        path: q.path,
        mountId: q.mountId ?? null,
        content: content.content,
        encoding: content.encoding,
        eol: content.eol,
        mtime: new Date(content.mtimeMs).toISOString(),
        size: content.size,
        hash: content.hash
      });
    } catch (err) {
      return fail(...toApiErrorTuple(err));
    }
  });

  app.put('/api/docs/content', async (req) => {
    const parsed = docsContentPutSchema.safeParse(req.body);
    if (!parsed.success) return fail('BAD_REQUEST', '参数不合法');
    const b = parsed.data;
    try {
      const abs = b.mountId !== undefined ? resolveMountPath(ctx, b.mountId, b.path) : (await resolveInProject(ctx.db(), b.projectId, b.path, { mustExist: true })).real;
      fsx.accessSyncForWrite(abs);
      const st = fsx.statSafe(abs);
      if (st === null) return fail('NOT_FOUND', '文档不存在', 404);
      if (!b.force) {
        const disk = fsx.readTextFile(abs, 20 * 1024 * 1024);
        if (disk.hash !== b.baseHash || st.size !== (b.baseSize ?? -1) || new Date(st.mtimeMs).toISOString() !== b.baseMtime) {
          return fail('MTIME_CONFLICT', '文档已在磁盘上被修改', 409, {
            current: { mtime: new Date(st.mtimeMs).toISOString(), size: st.size, hash: disk.hash, content: disk.content }
          });
        }
      }
      fsx.atomicWriteText(abs, b.content, b.encoding as fsx.DetectedEncoding ?? 'utf8', b.eol === 'CRLF' ? 'CRLF' : 'LF');
      logActivity(ctx.db(), { kind: 'fs.save', level: 'L2', projectId: b.projectId, targetPath: abs, actor: currentActor().actor });
      return ok({ saved: true });
    } catch (err) {
      return fail(...toApiErrorTuple(err));
    }
  });
};

function resolveMountPath(ctx: AppContext, mountId: string, pathArg: string): string {
  const m = getMount(ctx.db(), mountId);
  if (m === null) throw new AppError('NOT_FOUND', '挂载不存在', undefined, 404);
  if (m.kind === 'file') return m.path;
  const abs = path.resolve(m.path, pathArg);
  if (path.relative(m.path, abs).split(path.sep).includes('..')) {
    throw new AppError('PATH_OUT_OF_SCOPE', '路径越界');
  }
  return abs;
}

function toApiErrorTuple(err: unknown): [import('@ttfolio/shared').ErrorCode, string, number, unknown?] {
  const e = toApiError(err);
  return [e.code, e.message, e.status, e.detail];
}
