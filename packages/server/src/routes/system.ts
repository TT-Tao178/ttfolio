/** 系统路由：health / settings / ignore-rules / command-templates / backup / restore / activity / export / library reset。 */
import type { FastifyPluginAsync } from 'fastify';
import type { AppContext } from '../context.js';
import { ok, fail } from './helpers.js';
import { getSetting, setSetting, getAllSettings, logActivity, listActivity } from '../db/repo/metaRepo.js';
import {
  listIgnoreRules, createIgnoreRule, updateIgnoreRule, deleteIgnoreRule,
  listCommandTemplates, createCommandTemplate, updateCommandTemplate, deleteCommandTemplate
} from '../db/repo/rulesRepo.js';
import { createBackup, listBackups, restoreBackup } from '../core/backup.js';
import { validateTemplateArgs } from '../core/openExternal.js';
import { AppError } from '../core/errors.js';
import { SETTING_KEYS, TRASH_RETENTION_DAYS } from '@ttfolio/shared';
import { statSafe, existsSync, readFileSync } from '../core/fsx.js';
import { join } from 'node:path';
import { listProjects } from '../db/repo/projectsRepo.js';

export const systemRoutes: FastifyPluginAsync = async (app) => {
  const ctx = app.ttfolio as AppContext;

  app.get('/api/health', async (_req) => {
    return ok({
      version: ctx.version,
      port: ctx.port,
      userContentPort: ctx.userContentPort,
      mode: 'web',
      dbPath: ctx.layout.dbFile,
      dbSize: ctx.dbSize(),
      projectCount: ctx.db().prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM projects WHERE deleted_at IS NULL').get()?.c ?? 0,
      uptime: Math.floor((Date.now() - ctx.startedAt) / 1000),
      dataDir: ctx.layout.dataDir,
      trashDir: ctx.layout.trashDir,
      backupDir: ctx.layout.backupDir,
      logDir: ctx.layout.logDir
    });
  });

  app.get('/api/settings', async () => {
    const db = ctx.db();
    const all = getAllSettings(db);
    const docBlacklist = getSetting(db, SETTING_KEYS.docRootBlacklist);
    return ok({
      theme: all[SETTING_KEYS.theme] ?? 'light',
      density: all[SETTING_KEYS.density] ?? 'middle',
      watchEnabled: (all[SETTING_KEYS.watchEnabled] ?? '1') === '1',
      watchStabilityMs: Number(all[SETTING_KEYS.watchStabilityMs] ?? '300'),
      autoSave: (all[SETTING_KEYS.autoSave] ?? '0') === '1',
      trashRetentionDays: Number(all[SETTING_KEYS.trashRetentionDays] ?? String(TRASH_RETENTION_DAYS)),
      defaultArchDirName: all[SETTING_KEYS.defaultArchDirName] ?? '架构图',
      cardSort: all[SETTING_KEYS.cardSort] ?? 'last_opened',
      showIgnored: (all[SETTING_KEYS.showIgnored] ?? '0') === '1',
      defaultProjectTab: all[SETTING_KEYS.defaultProjectTab] ?? 'files',
      docRootBlacklist: docBlacklist !== null && docBlacklist !== '' ? JSON.parse(docBlacklist) as string[] : [],
      keybindings: safeJson(all[SETTING_KEYS.keybindings] ?? '{}'),
      scanRootDirs: safeJson(all[SETTING_KEYS.scanRootDirs] ?? '[]')
    });
  });

  app.patch('/api/settings', async (req) => {
    const db = ctx.db();
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<string, unknown>;
    const allowed: Record<string, (v: unknown) => string> = {
      theme: (v) => String(v),
      density: (v) => String(v),
      watch_enabled: (v) => (v === true || v === 'true' ? '1' : '0'),
      watch_stability_ms: (v) => String(Number(v)),
      auto_save: (v) => (v === true || v === 'true' ? '1' : '0'),
      trash_retention_days: (v) => String(Number(v)),
      default_arch_dir_name: (v) => String(v),
      card_sort: (v) => String(v),
      show_ignored: (v) => (v === true || v === 'true' ? '1' : '0'),
      default_project_tab: (v) => String(v),
      doc_root_blacklist_json: (v) => JSON.stringify(v),
      keybindings_json: (v) => JSON.stringify(v),
      scan_root_dirs_json: (v) => JSON.stringify(v)
    };
    for (const [k, v] of Object.entries(body)) {
      const fn = allowed[k];
      if (fn !== undefined) setSetting(db, k, fn(v));
    }
    // 监听开关变化即时生效
    if (body['watch_enabled'] !== undefined) {
      const enabled = body['watch_enabled'] === true || body['watch_enabled'] === 'true';
      if (!enabled) ctx.watcher.unwatchAll();
    }
    return ok({ saved: true });
  });

  // ---- 忽略规则 ----
  app.get('/api/ignore-rules', async () => ok(listIgnoreRules(ctx.db())));

  app.post('/api/ignore-rules', async (req) => {
    const b = (req.body ?? {}) as { scope?: string; projectId?: string | null; pattern?: string; mode?: string; enabled?: boolean };
    if (b.pattern === undefined || b.pattern.trim() === '') return fail('INVALID_NAME', '忽略规则不能为空');
    const rule = createIgnoreRule(ctx.db(), {
      scope: b.scope === 'project' ? 'project' : 'global',
      projectId: b.projectId ?? null,
      pattern: b.pattern.trim(),
      mode: b.mode === 'analyze_only' ? 'analyze_only' : 'hide',
      enabled: b.enabled ?? true
    });
    return ok(rule);
  });

  app.patch('/api/ignore-rules/:id', async (req) => {
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { pattern?: string; mode?: string; enabled?: boolean };
    const found = updateIgnoreRule(ctx.db(), id, {
      pattern: b.pattern,
      mode: b.mode === 'analyze_only' ? 'analyze_only' : b.mode === 'hide' ? 'hide' : undefined,
      enabled: b.enabled
    });
    if (!found) return fail('NOT_FOUND', '规则不存在', 404);
    return ok({ updated: true });
  });

  app.delete('/api/ignore-rules/:id', async (req) => {
    const { id } = req.params as { id: string };
    const found = deleteIgnoreRule(ctx.db(), id);
    if (!found) return fail('INVALID_NAME', '内置规则不可删除，可将其停用');
    return ok({ deleted: true });
  });

  // ---- 命令模板 ----
  app.get('/api/command-templates', async () => ok(listCommandTemplates(ctx.db())));

  app.post('/api/command-templates', async (req) => {
    const b = (req.body ?? {}) as { label?: string; executable?: string; argsJson?: string[]; needsConfirm?: boolean; platforms?: string | null; enabled?: boolean; sortOrder?: number };
    if (b.label === undefined || b.executable === undefined || b.argsJson === undefined) {
      return fail('INVALID_NAME', '模板必须包含 label、executable、argsJson');
    }
    validateTemplateArgs(b.argsJson, false);
    const t = createCommandTemplate(ctx.db(), {
      label: b.label,
      executable: b.executable,
      args: b.argsJson,
      needsConfirm: b.needsConfirm ?? true,
      platforms: b.platforms ?? null,
      enabled: b.enabled ?? true,
      sortOrder: b.sortOrder ?? 100
    });
    return ok(t);
  });

  app.patch('/api/command-templates/:id', async (req) => {
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { label?: string; executable?: string; argsJson?: string[]; needsConfirm?: boolean; enabled?: boolean; sortOrder?: number };
    if (b.argsJson !== undefined) validateTemplateArgs(b.argsJson, false);
    const found = updateCommandTemplate(ctx.db(), id, {
      label: b.label,
      executable: b.executable,
      args: b.argsJson,
      needsConfirm: b.needsConfirm,
      enabled: b.enabled,
      sortOrder: b.sortOrder
    });
    if (!found) return fail('NOT_FOUND', '模板不存在', 404);
    return ok({ updated: true });
  });

  app.delete('/api/command-templates/:id', async (req) => {
    const { id } = req.params as { id: string };
    const found = deleteCommandTemplate(ctx.db(), id);
    if (!found) return fail('NOT_FOUND', '内置模板不可删除', 404);
    return ok({ deleted: true });
  });

  // ---- 备份 / 恢复 / 导出 / 清空 ----
  app.get('/api/backups', async () => ok(listBackups(ctx.layout.backupDir)));

  app.post('/api/backup', async () => {
    const r = createBackup(ctx.layout.dbFile, ctx.layout.backupDir);
    setSetting(ctx.db(), SETTING_KEYS.lastBackupAt, new Date().toISOString());
    logActivity(ctx.db(), { kind: 'library.backup', level: 'L1', detail: { file: r.file, integrity: r.integrity } });
    return ok(r);
  });

  app.post('/api/restore', async (req) => {
    const b = (req.body ?? {}) as { file?: string; confirm?: boolean };
    if (b.confirm !== true) return fail('CONFIRM_REQUIRED', '恢复备份会覆盖当前索引库，需要 confirm 确认');
    if (b.file === undefined) return fail('BAD_REQUEST', '缺少 file');
    const target = join(ctx.layout.backupDir, b.file);
    if (!existsSync(target)) return fail('NOT_FOUND', '备份文件不存在', 404);
    restoreBackup(ctx.layout.dbFile, target);
    logActivity(ctx.db(), { kind: 'library.restore', level: 'L3', detail: { from: b.file } });
    return ok({ restored: true, note: '恢复完成，请刷新页面' });
  });

  app.get('/api/export/projects.json', async () => {
    const projects = listProjects(ctx.db(), { status: 'all' });
    return ok(projects);
  });

  app.get('/api/export/projects.csv', async (_req, reply) => {
    const projects = listProjects(ctx.db(), { status: 'all' });
    const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
    const head = '别名,目录名,路径,类型,主语言,文件数,体积,技术栈,Git分支,是否脏,最近提交,最后打开';
    const lines = projects.map((p) =>
      [
        esc(p.alias ?? ''), esc(p.diskName), esc(p.dirPath), esc(p.type), esc(p.primaryLanguage ?? ''),
        String(p.fileCount), String(p.sizeBytes), esc(p.techStack.join('|')), esc(p.gitBranch ?? ''),
        p.gitDirty ? '是' : '否', esc(p.gitLastCommitAt ?? ''), esc(p.lastOpenedAt ?? '')
      ].join(',')
    );
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename="ttfolio-projects.csv"');
    // BOM 让 Excel 正确识别 UTF-8
    return `\uFEFF${head}\n${lines.join('\n')}`;
  });

  app.post('/api/library/reset', async (req) => {
    const b = (req.body ?? {}) as { confirm?: boolean; confirmText?: string };
    if (b.confirm !== true || b.confirmText !== '清空索引库') {
      return fail('CONFIRM_REQUIRED', '请在确认框中输入"清空索引库"以确认（不会删除任何项目文件）');
    }
    const db = ctx.db();
    const tx = db.transaction(() => {
      for (const t of ['projects', 'language_stats', 'analysis_runs', 'collections', 'collection_members', 'tags', 'project_tags', 'doc_roots', 'project_paths', 'archives', 'todos', 'editor_drafts', 'sessions', 'session_tabs', 'recent_files', 'content_fts', 'content_index_state']) {
        db.prepare(`DELETE FROM ${t}`).run();
      }
      db.prepare(`INSERT INTO sessions (id, name, is_active, created_at, updated_at) VALUES ('default', '默认会话', 1, ?, ?)`).run(new Date().toISOString(), new Date().toISOString());
    });
    tx();
    logActivity(db, { kind: 'library.reset', level: 'L3', detail: { note: '仅清空索引数据，项目文件未动' } });
    return ok({ reset: true });
  });

  app.get('/api/activity', async (req) => {
    const q = req.query as { limit?: string; projectId?: string };
    const limit = Math.min(Math.max(Number(q.limit ?? '100'), 1), 1000);
    return ok(listActivity(ctx.db(), limit, q.projectId));
  });

  app.get('/api/data-stats', async () => {
    const dbSize = ctx.dbSize();
    const trash = ctx.db().prepare<[], { c: number; b: number }>('SELECT COUNT(*) AS c, COALESCE(SUM(size_bytes),0) AS b FROM trash').get();
    const backups = listBackups(ctx.layout.backupDir);
    return ok({
      dbPath: ctx.layout.dbFile,
      dbSize,
      trashPath: ctx.layout.trashDir,
      trashCount: trash?.c ?? 0,
      trashBytes: trash?.b ?? 0,
      backupDir: ctx.layout.backupDir,
      backups: backups.slice(0, 20),
      logDir: ctx.layout.logDir,
      logSize: statSafe(join(ctx.layout.logDir, 'ttfolio.log'))?.size ?? 0
    });
  });
};

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

export { readFileSync, AppError };
