/** 系统路由：health / settings / ignore-rules / command-templates / backup / restore / activity / export / library reset。 */
import type { FastifyPluginAsync } from 'fastify';
import type { AppContext } from '../context.js';
import { ok, fail } from './helpers.js';
import { getSetting, setSetting, getAllSettings, logActivity, listActivity } from '../db/repo/metaRepo.js';
import {
  listIgnoreRules,
  createIgnoreRule,
  updateIgnoreRule,
  deleteIgnoreRule,
  listCommandTemplates,
  createCommandTemplate,
  updateCommandTemplate,
  deleteCommandTemplate,
} from '../db/repo/rulesRepo.js';
import { createBackup, listBackups, restoreBackup, applyRetentionByDays } from '../core/backup.js';
import { integrityCheck } from '../db/migrate.js';
import { buildProjectIndex, clearProjectIndex } from '../core/search.js';
import { listTaskRuns } from '../db/repo/taskRunRepo.js';
import { validateTemplateArgs, openUrlInBrowser } from '../core/openExternal.js';
import { AppError } from '../core/errors.js';
import {
  SETTING_KEYS,
  TRASH_RETENTION_DAYS,
  GITHUB_REPO,
  GITHUB_RELEASES_URL,
  semverNewer,
  isSyntaxScheme,
  DEFAULT_SYNTAX_SCHEME,
  customViewsSchema,
  type CustomView,
} from '@ttfolio/shared';
import { statSafe, existsSync, readFileSync } from '../core/fsx.js';
import { runCommand } from '../core/exec.js';
import { copyFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { z } from 'zod';
import type Database from 'better-sqlite3';
import { listProjects } from '../db/repo/projectsRepo.js';
import { rewatchAll } from './helpers.js';
import { currentActor } from '../core/actor.js';
import { listDocRoots, createDocRoot } from '../db/repo/docsRepo.js';

/** 在册未删除项目（watcher 全量重建用）。 */
function activeProjects(db: Database.Database): Array<{ id: string; dir_path: string }> {
  return listProjects(db, { status: 'all' }).map((p) => ({ id: p.id, dir_path: p.dirPath }));
}

/** 迁移清单标签（库体检展示用；与 src/migrations/ 目录一一对应）。 */
const MIGRATION_LABELS: Array<{ file: string; label: string }> = [
  { file: '0001', label: '初始结构' },
  { file: '0002', label: '会话活动标签' },
  { file: '0003', label: '提交主题列' },
  { file: '0004', label: '集合成员索引' },
  { file: '0005', label: '资源仓库' },
  { file: '0006', label: '多媒体库' },
  { file: '0007', label: '架构图查看快照' },
  { file: '0008', label: '后台任务历史' },
];

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
      projectCount:
        ctx
          .db()
          .prepare<[], { c: number }>('SELECT COUNT(*) AS c FROM projects WHERE deleted_at IS NULL')
          .get()?.c ?? 0,
      // 状态栏要显示「最近分析」（对齐界面原型）；空库时为 null
      lastAnalyzeAt:
        ctx
          .db()
          .prepare<[], { t: string | null }>(
            'SELECT MAX(analyzed_at) AS t FROM projects WHERE deleted_at IS NULL',
          )
          .get()?.t ?? null,
      uptime: Math.floor((Date.now() - ctx.startedAt) / 1000),
      dataDir: ctx.layout.dataDir,
      trashDir: ctx.layout.trashDir,
      backupDir: ctx.layout.backupDir,
      logDir: ctx.layout.logDir,
    });
  });

  app.get('/api/settings', async () => {
    const db = ctx.db();
    const all = getAllSettings(db);
    const docBlacklist = getSetting(db, SETTING_KEYS.docRootBlacklist);
    return ok({
      theme: all[SETTING_KEYS.theme] ?? 'light',
      density: all[SETTING_KEYS.density] ?? 'middle',
      watchEnabled: (all[SETTING_KEYS.watchEnabled] ?? '0') === '1',
      effectsEnabled: (all[SETTING_KEYS.effectsEnabled] ?? '1') === '1',
      watchStabilityMs: Number(all[SETTING_KEYS.watchStabilityMs] ?? '300'),
      autoSave: (all[SETTING_KEYS.autoSave] ?? '0') === '1',
      trashRetentionDays: Number(all[SETTING_KEYS.trashRetentionDays] ?? String(TRASH_RETENTION_DAYS)),
      backupKeepDays: Number(all['backup_keep_days'] ?? '0'),
      // 资源仓库（FR-13.3 v2 / T-112）：全局默认记录 + 可选快照层 + 首次确认标记
      agentRepoMode: all['agent_repo_mode'] === 'off' ? 'off' : 'on',
      agentRepoSnapshots: all['agent_repo_snapshots'] === '1',
      agentRepoConfirmed: all['agent_repo_confirmed'] === '1',
      terminalShell: ['pwsh', 'powershell', 'cmd'].includes(all['terminal_shell'] ?? '')
        ? all['terminal_shell']
        : 'powershell',
      defaultArchDirName: all[SETTING_KEYS.defaultArchDirName] ?? '架构图',
      cardSort: all[SETTING_KEYS.cardSort] ?? 'last_opened',
      showIgnored: (all[SETTING_KEYS.showIgnored] ?? '0') === '1',
      defaultProjectTab: all[SETTING_KEYS.defaultProjectTab] ?? 'files',
      docRootBlacklist:
        docBlacklist !== null && docBlacklist !== '' ? (JSON.parse(docBlacklist) as string[]) : [],
      syntaxScheme: isSyntaxScheme(all[SETTING_KEYS.syntaxScheme])
        ? all[SETTING_KEYS.syntaxScheme]
        : DEFAULT_SYNTAX_SCHEME,
      keybindings: safeJson(all[SETTING_KEYS.keybindings] ?? '{}'),
      scanRootDirs: safeJson(all[SETTING_KEYS.scanRootDirs] ?? '[]'),
      uiLayout: safeJson(all[SETTING_KEYS.uiLayout] ?? '{}'),
      customViews: parseCustomViews(all[SETTING_KEYS.customViews]),
    });
  });

  app.patch('/api/settings', async (req) => {
    const db = ctx.db();
    const body = (typeof req.body === 'object' && req.body !== null ? req.body : {}) as Record<
      string,
      unknown
    >;
    const allowed: Record<string, (v: unknown) => string> = {
      theme: (v) => String(v),
      density: (v) => String(v),
      watch_enabled: (v) => (v === true || v === 'true' ? '1' : '0'),
      effects_enabled: (v) => (v === true || v === 'true' ? '1' : '0'),
      watch_stability_ms: (v) => {
        // 体检附带：Number(v) 可能 NaN，NaN 落库会让 chokidar awaitWriteFinish 参数非法
        const n = Number(v);
        return String(Number.isFinite(n) && n >= 50 ? Math.round(n) : 300);
      },
      auto_save: (v) => (v === true || v === 'true' ? '1' : '0'),
      trash_retention_days: (v) => {
        const n = Number(v);
        return String(Number.isFinite(n) && n >= 1 ? Math.round(n) : 30);
      },
      agent_repo_mode: (v) => (v === 'off' ? 'off' : 'on'),
      agent_repo_snapshots: (v) => (v === true || v === 'true' || v === '1' ? '1' : '0'),
      agent_repo_confirmed: (v) => (v === true || v === 'true' || v === '1' ? '1' : '0'),
      terminal_shell: (v) => (v === 'pwsh' || v === 'cmd' ? v : 'powershell'),
      backup_keep_days: (v) => {
        // 0 = 沿用智能保留（最近 10 份 + 每周 1 份）；>0 = 按天清理过期快照
        const n = Number(v);
        return String(Number.isFinite(n) && n >= 1 ? Math.round(n) : 0);
      },
      default_arch_dir_name: (v) => String(v),
      card_sort: (v) => String(v),
      show_ignored: (v) => (v === true || v === 'true' ? '1' : '0'),
      default_project_tab: (v) => String(v),
      doc_root_blacklist_json: (v) => JSON.stringify(v),
      syntax_scheme: (v) => (isSyntaxScheme(v) ? v : DEFAULT_SYNTAX_SCHEME),
      keybindings_json: (v) => JSON.stringify(v),
      scan_root_dirs_json: (v) => JSON.stringify(v),
      ui_layout_json: (v) => JSON.stringify(v),
      custom_views_json: (v) => JSON.stringify(v),
    };
    // 自定义视图（FR-4.11）：入参 zod 全量校验，坏值明确 400 而不是静默丢弃
    if (body['custom_views_json'] !== undefined) {
      const parsed = customViewsSchema.safeParse(body['custom_views_json']);
      if (!parsed.success) return fail('BAD_REQUEST', '视图定义不合法');
    }
    for (const [k, v] of Object.entries(body)) {
      const fn = allowed[k];
      if (fn !== undefined) setSetting(db, k, fn(v));
    }
    // 监听开关/参数变化即时生效（体检 P1：原先关闭后重开所有项目保持无监听）
    if (body['watch_enabled'] !== undefined || body['watch_stability_ms'] !== undefined) {
      const enabled =
        body['watch_enabled'] === undefined ||
        body['watch_enabled'] === true ||
        body['watch_enabled'] === 'true';
      if (enabled) rewatchAll(ctx.db(), ctx.watcher, activeProjects(ctx.db()));
      else ctx.watcher.unwatchAll();
    }
    return ok({ saved: true });
  });

  // ---- 检查更新（轻方案）：只经 api.github.com 查 Releases 元数据（加速器不拦该域），
  // 不做自动下载——安装包按现行惯例由用户手动下载/浏览器拖传。仓库私有，需要能读该
  // 仓库的 Token（存 settings.github_token，仅写不回显）。 ----

  app.get('/api/update/status', async () => {
    const token = getSetting(ctx.db(), SETTING_KEYS.githubToken);
    return ok({
      currentVersion: ctx.version,
      repo: GITHUB_REPO,
      releaseUrl: GITHUB_RELEASES_URL,
      tokenSet: token !== null && token !== '',
    });
  });

  app.post('/api/update/token', async (req) => {
    const b = (req.body ?? {}) as { token?: string | null };
    const token = typeof b.token === 'string' ? b.token.trim() : '';
    if (token !== '') {
      // 宽松校验：GitHub Token 形态（ghp_/gho_/github_pat_ 开头）且无空白；长度下限防手滑
      if (token.length < 20 || /\s/.test(token) || !/^(ghp_|gho_|ghub_|github_pat_)/.test(token)) {
        return fail(
          'BAD_REQUEST',
          '不像 GitHub Token：应以 ghp_ / gho_ / github_pat_ 开头、无空白、长度 ≥ 20',
        );
      }
      setSetting(ctx.db(), SETTING_KEYS.githubToken, token);
      logActivity(ctx.db(), {
        kind: 'settings.change',
        level: 'L1',
        detail: { key: SETTING_KEYS.githubToken, action: 'set' },
      });
    } else {
      setSetting(ctx.db(), SETTING_KEYS.githubToken, '');
      logActivity(ctx.db(), {
        kind: 'settings.change',
        level: 'L1',
        detail: { key: SETTING_KEYS.githubToken, action: 'clear' },
      });
    }
    return ok({ saved: true, tokenSet: token !== '' });
  });

  // ---- 设置迁移（FR-13.12 / T-110）：导出 / 导入 / 恢复默认 ----
  // github_token / 项目清单 / 会话 / 草稿 / ui_layout（机器相关）绝不入包。
  const EXPORT_SETTING_KEYS = [
    'theme',
    'density',
    'watch_enabled',
    'effects_enabled',
    'watch_stability_ms',
    'auto_save',
    'card_sort',
    'show_ignored',
    'default_project_tab',
    'syntax_scheme',
    'keybindings_json',
    'backup_keep_days',
    'trash_retention_days',
    'default_arch_dir_name',
    'doc_root_blacklist_json',
  ];

  app.get('/api/settings/export', async () => {
    const db = ctx.db();
    const all = getAllSettings(db);
    const settings: Record<string, string> = {};
    for (const k of EXPORT_SETTING_KEYS) {
      if (all[k] !== undefined && all[k] !== '') settings[k] = all[k];
    }
    return ok({
      kind: 'ttfolio-settings',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings,
      ignoreRules: listIgnoreRules(db)
        .filter((r) => !r.isBuiltin)
        .map((r) => ({ scope: r.scope, pattern: r.pattern, mode: r.mode, enabled: r.enabled })),
      commandTemplates: listCommandTemplates(db)
        .filter((t) => !t.isBuiltin)
        .map((t) => ({
          label: t.label,
          executable: t.executable,
          args: t.argsJson,
          needsConfirm: t.needsConfirm,
          platforms: t.platforms,
          enabled: t.enabled,
          sortOrder: t.sortOrder,
        })),
      docRoots: listDocRoots(db).map((r) => ({ path: r.path, label: r.label, enabled: r.enabled })),
    });
  });

  app.post('/api/settings/import', async (req) => {
    const b = (req.body ?? {}) as { data?: unknown; strategy?: string };
    const strategy = b.strategy === 'overwrite' ? 'overwrite' : 'skip';
    const d = b.data as {
      kind?: unknown;
      settings?: unknown;
      ignoreRules?: unknown;
      commandTemplates?: unknown;
      docRoots?: unknown;
    } | null;
    if (typeof d !== 'object' || d === null || d.kind !== 'ttfolio-settings') {
      return fail('BAD_REQUEST', '不是有效的 ttFolio 设置包');
    }
    const db = ctx.db();
    let settingsApplied = 0;
    let rulesCreated = 0;
    let templatesCreated = 0;
    let docRootsCreated = 0;
    let skipped = 0;
    if (typeof d.settings === 'object' && d.settings !== null) {
      for (const [k, v] of Object.entries(d.settings as Record<string, string>)) {
        if (!EXPORT_SETTING_KEYS.includes(k) || typeof v !== 'string') {
          skipped++;
          continue;
        }
        if (strategy === 'skip' && getSetting(db, k) !== null) {
          skipped++;
          continue;
        }
        setSetting(db, k, v);
        settingsApplied++;
      }
    }
    if (Array.isArray(d.ignoreRules)) {
      const existing = new Set(listIgnoreRules(db).map((r) => `${r.scope}|${r.pattern}`));
      for (const r of d.ignoreRules as Array<Record<string, unknown>>) {
        const scope = r['scope'] === 'project' ? 'project' : 'global';
        const pattern = typeof r['pattern'] === 'string' ? r['pattern'] : '';
        if (pattern === '') {
          skipped++;
          continue;
        }
        if (strategy === 'skip' && existing.has(`${scope}|${pattern}`)) {
          skipped++;
          continue;
        }
        createIgnoreRule(db, {
          scope,
          projectId: null,
          pattern,
          mode: r['mode'] === 'analyze_only' ? 'analyze_only' : 'hide',
          enabled: r['enabled'] !== false,
        });
        rulesCreated++;
      }
    }
    if (Array.isArray(d.commandTemplates)) {
      const existing = new Set(listCommandTemplates(db).map((t) => t.label));
      for (const t of d.commandTemplates as Array<Record<string, unknown>>) {
        const label = typeof t['label'] === 'string' ? t['label'] : '';
        const executable = typeof t['executable'] === 'string' ? t['executable'] : '';
        const args = Array.isArray(t['args'])
          ? (t['args'] as unknown[]).filter((x): x is string => typeof x === 'string')
          : [];
        if (label === '' || executable === '') {
          skipped++;
          continue;
        }
        if (strategy === 'skip' && existing.has(label)) {
          skipped++;
          continue;
        }
        try {
          validateTemplateArgs(args, false);
          createCommandTemplate(db, {
            label,
            executable,
            args,
            needsConfirm: t['needsConfirm'] !== false,
            platforms: typeof t['platforms'] === 'string' ? t['platforms'] : null,
            enabled: t['enabled'] !== false,
            sortOrder: Number.isFinite(Number(t['sortOrder'])) ? Math.round(Number(t['sortOrder'])) : 0,
          });
          templatesCreated++;
        } catch {
          skipped++;
        }
      }
    }
    if (Array.isArray(d.docRoots)) {
      const existing = new Set(listDocRoots(db).map((r) => r.path.toLowerCase()));
      for (const r of d.docRoots as Array<Record<string, unknown>>) {
        const p = typeof r['path'] === 'string' ? r['path'] : '';
        if (p === '' || (strategy === 'skip' && existing.has(p.toLowerCase()))) {
          skipped++;
          continue;
        }
        try {
          createDocRoot(db, p, typeof r['label'] === 'string' ? r['label'] : null);
          docRootsCreated++;
        } catch {
          skipped++;
        }
      }
    }
    logActivity(ctx.db(), {
      kind: 'settings.import',
      level: 'L2',
      detail: { strategy, settingsApplied, rulesCreated, templatesCreated, docRootsCreated, skipped },
      actor: currentActor().actor,
    });
    return ok({ settingsApplied, rulesCreated, templatesCreated, docRootsCreated, skipped });
  });

  // 恢复默认：删除外观/行为类白名单设置键（读取侧回落默认值）；不动数据类（忽略规则/模板/文档根）
  app.post('/api/settings/reset-defaults', async () => {
    const db = ctx.db();
    let removed = 0;
    for (const k of EXPORT_SETTING_KEYS) {
      const r = db.prepare('DELETE FROM settings WHERE key = ?').run(k);
      removed += r.changes;
    }
    logActivity(ctx.db(), {
      kind: 'settings.reset',
      level: 'L2',
      detail: { removed },
      actor: currentActor().actor,
    });
    return ok({ removed });
  });

  /**
   * 取 Releases 元数据：先 Node fetch（无加速器的干净网络直连即成）；
   * 失败（实测加速器对 github 域做 TLS 中间人，Node 报 UNABLE_TO_VERIFY_LEAF_SIGNATURE）
   * 回退系统 curl——curl.exe 走 Schannel 系统证书库，与用户浏览器/git 同一信任源。
   * 打包版 server 进程内跑在 Electron 里，NODE_USE_SYSTEM_CA 这类启动期 env 不可靠，
   * 故回退必须在代码层做。
   */
  async function githubGetLatestRelease(token: string | null): Promise<{ status: number; data: unknown }> {
    const url = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'ttFolio-update-check',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (token !== null && token !== '') headers.Authorization = `Bearer ${token}`;
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
      const data: unknown = await res.json().catch(() => null);
      return { status: res.status, data };
    } catch {
      /* 落到 curl 回退 */
    }
    const args = [
      '-sS',
      '--max-time',
      '10',
      '-w',
      '\n%{http_code}',
      '-H',
      'Accept: application/vnd.github+json',
      '-H',
      'User-Agent: ttFolio-update-check',
    ];
    if (token !== null && token !== '') args.push('-H', `Authorization: Bearer ${token}`);
    args.push(url);
    const r = await runCommand(process.platform === 'win32' ? 'curl.exe' : 'curl', args, {
      timeoutMs: 15000,
    });
    const idx = r.stdout.lastIndexOf('\n');
    const code = parseInt(r.stdout.slice(idx + 1).trim(), 10) || 0;
    let data: unknown = null;
    try {
      data = JSON.parse(idx >= 0 ? r.stdout.slice(0, idx) : r.stdout) as unknown;
    } catch {
      /* 非 JSON（错误页/空响应），按 status 走错误分支 */
    }
    return { status: code, data };
  }

  app.get('/api/update/check', async () => {
    const db = ctx.db();
    const token = getSetting(db, SETTING_KEYS.githubToken);
    let res: { status: number; data: unknown };
    try {
      res = await githubGetLatestRelease(token !== null && token !== '' ? token : null);
    } catch {
      return fail(
        'IO_ERROR',
        '访问 GitHub 失败（网络/加速器原因）。可稍后重试，或直接打开 Releases 页面查看。',
        502,
      );
    }
    if (res.status === 401 || res.status === 403) {
      return fail(
        'PERMISSION_DENIED',
        'GitHub 返回无权限：Token 无效/过期，或触发 API 限流（私有仓库需要能读本仓库的 Token）。',
        res.status === 401 ? 401 : 429,
      );
    }
    if (res.status === 404) {
      return ok({
        currentVersion: ctx.version,
        latestVersion: null,
        hasUpdate: false,
        releaseUrl: GITHUB_RELEASES_URL,
        assets: [] as string[],
        note: '没有查到 Release：可能是还没有发布过，或仓库为私有且未配置（或配置了无权限的）Token',
      });
    }
    if (res.status === 0 || res.status >= 500) {
      return fail(
        'IO_ERROR',
        `访问 GitHub 失败（状态 ${res.status}）。可稍后重试，或直接打开 Releases 页面查看。`,
        502,
      );
    }
    const data = (res.data ?? {}) as {
      tag_name?: string;
      html_url?: string;
      assets?: Array<{ name: string }>;
    };
    const latestVersion = typeof data.tag_name === 'string' ? data.tag_name.replace(/^v/i, '') : '';
    const hasUpdate = latestVersion !== '' && semverNewer(latestVersion, ctx.version);
    const leading = !hasUpdate && latestVersion !== '' && semverNewer(ctx.version, latestVersion);
    return ok({
      currentVersion: ctx.version,
      latestVersion: latestVersion === '' ? null : latestVersion,
      hasUpdate,
      releaseUrl:
        typeof data.html_url === 'string' && data.html_url !== '' ? data.html_url : GITHUB_RELEASES_URL,
      assets: (data.assets ?? []).map((a) => a.name),
      note: leading
        ? `当前版本 v${ctx.version} 比已发布的最新版 v${latestVersion} 更新——之后的 Release 可能尚未发布或未补全安装包`
        : hasUpdate && !(data.assets ?? []).some((a) => a.name.endsWith('.exe'))
          ? '新版本尚未上传安装包资产（ Releases 页可能只有源码）'
          : null,
    });
  });

  app.post('/api/update/open-release', async () => {
    await openUrlInBrowser(GITHUB_RELEASES_URL);
    logActivity(ctx.db(), { kind: 'open.external', level: 'L1', detail: { target: 'releases' } });
    return ok({ opened: true });
  });

  // ---- 渲染层异常落盘（第 33 轮 M9）：白屏时用户与日志均无从诊断——
  // 前端把未捕获 error/rejection POST 到这里，进 pino 日志（7×10MB 滚动）
  // 与活动记录（L2）。日志通道自身绝不能成为新错误源：校验失败/落盘异常一律静默 200。----
  const clientErrorSchema = z.object({
    message: z.string().min(1).max(2000),
    stack: z.string().max(8000).optional(),
    source: z.enum(['error', 'unhandledrejection']).default('error'),
  });

  app.post('/api/log/client-error', async (req, reply) => {
    try {
      const parsed = clientErrorSchema.safeParse(req.body);
      if (parsed.success) {
        ctx.logger.warn(
          { mod: 'client', msg: parsed.data.message, stack: parsed.data.stack, source: parsed.data.source },
          '渲染层未捕获异常',
        );
        logActivity(ctx.db(), {
          kind: 'client.error',
          level: 'L2',
          detail: { message: parsed.data.message.slice(0, 300), source: parsed.data.source },
        });
      }
    } catch {
      /* 落盘失败不抛——见节首注释 */
    }
    return await reply.code(200).send({ ok: true });
  });

  // ---- 忽略规则 ----
  app.get('/api/ignore-rules', async () => ok(listIgnoreRules(ctx.db())));

  app.post('/api/ignore-rules', async (req) => {
    const b = (req.body ?? {}) as {
      scope?: string;
      projectId?: string | null;
      pattern?: string;
      mode?: string;
      enabled?: boolean;
    };
    if (b.pattern === undefined || b.pattern.trim() === '') return fail('INVALID_NAME', '忽略规则不能为空');
    const rule = createIgnoreRule(ctx.db(), {
      scope: b.scope === 'project' ? 'project' : 'global',
      projectId: b.projectId ?? null,
      pattern: b.pattern.trim(),
      mode: b.mode === 'analyze_only' ? 'analyze_only' : 'hide',
      enabled: b.enabled ?? true,
    });
    // 体检 P1：忽略规则变化即时重建监听（原先旧规则一直用到重启）
    rewatchAll(ctx.db(), ctx.watcher, activeProjects(ctx.db()));
    return ok(rule);
  });

  app.patch('/api/ignore-rules/:id', async (req) => {
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { pattern?: string; mode?: string; enabled?: boolean };
    const found = updateIgnoreRule(ctx.db(), id, {
      pattern: b.pattern,
      mode: b.mode === 'analyze_only' ? 'analyze_only' : b.mode === 'hide' ? 'hide' : undefined,
      enabled: b.enabled,
    });
    if (!found) return fail('NOT_FOUND', '规则不存在', 404);
    rewatchAll(ctx.db(), ctx.watcher, activeProjects(ctx.db()));
    return ok({ updated: true });
  });

  app.delete('/api/ignore-rules/:id', async (req) => {
    const { id } = req.params as { id: string };
    const found = deleteIgnoreRule(ctx.db(), id);
    if (!found) return fail('INVALID_NAME', '内置规则不可删除，可将其停用');
    rewatchAll(ctx.db(), ctx.watcher, activeProjects(ctx.db()));
    return ok({ deleted: true });
  });

  // ---- 命令模板 ----
  app.get('/api/command-templates', async () => ok(listCommandTemplates(ctx.db())));

  app.post('/api/command-templates', async (req) => {
    const b = (req.body ?? {}) as {
      label?: string;
      executable?: string;
      argsJson?: string[];
      needsConfirm?: boolean;
      platforms?: string | null;
      enabled?: boolean;
      sortOrder?: number;
    };
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
      sortOrder: b.sortOrder ?? 100,
    });
    return ok(t);
  });

  app.patch('/api/command-templates/:id', async (req) => {
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as {
      label?: string;
      executable?: string;
      argsJson?: string[];
      needsConfirm?: boolean;
      enabled?: boolean;
      sortOrder?: number;
    };
    if (b.argsJson !== undefined) validateTemplateArgs(b.argsJson, false);
    const found = updateCommandTemplate(ctx.db(), id, {
      label: b.label,
      executable: b.executable,
      args: b.argsJson,
      needsConfirm: b.needsConfirm,
      enabled: b.enabled,
      sortOrder: b.sortOrder,
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
    // 备份保留可配（FR-13.11 / T-108）：>0 天时顺带清理过期快照并如实返回
    const keepDays = Number(getSetting(ctx.db(), 'backup_keep_days') ?? '0');
    const purged = applyRetentionByDays(ctx.layout.backupDir, keepDays);
    logActivity(ctx.db(), {
      kind: 'library.backup',
      level: 'L1',
      detail: { file: r.file, integrity: r.integrity, purgedByRetention: purged },
    });
    return ok({ ...r, purgedByRetention: purged });
  });

  // ---- 库体检（FR-13.11 / T-108）----
  app.get('/api/health/overview', async () => {
    const db = ctx.db();
    const userVersion = db.pragma('user_version', { simple: true });
    const count = (sql: string): number => {
      const row = db.prepare<[], { c: number }>(sql).get();
      return row?.c ?? 0;
    };
    return ok({
      dbPath: ctx.layout.dbFile,
      dbSize: ctx.dbSize(),
      userVersion,
      migrations: MIGRATION_LABELS,
      tables: {
        projects: count('SELECT COUNT(*) AS c FROM projects WHERE deleted_at IS NULL'),
        trash: count('SELECT COUNT(*) AS c FROM trash'),
        collections: count('SELECT COUNT(*) AS c FROM collections'),
        tags: count('SELECT COUNT(*) AS c FROM tags'),
        todos: count('SELECT COUNT(*) AS c FROM todos WHERE deleted_at IS NULL'),
        editorDrafts: count('SELECT COUNT(*) AS c FROM editor_drafts'),
        recentFiles: count('SELECT COUNT(*) AS c FROM recent_files'),
        media: count('SELECT COUNT(*) AS c FROM media_files'),
        activity: count('SELECT COUNT(*) AS c FROM activity_log'),
        taskRuns: count('SELECT COUNT(*) AS c FROM task_runs'),
      },
    });
  });

  // schema 全外键级联 ⇒ 真正的孤儿行被约束杜绝；体检 = 完整性 + 外键两项检测下结论
  app.post('/api/health/integrity', async () => {
    const db = ctx.db();
    const integrity = db.pragma('integrity_check', { simple: true });
    const fkViolations = db.pragma('foreign_key_check');
    logActivity(ctx.db(), {
      kind: 'library.health_check',
      level: 'L1',
      detail: { integrity, fkViolations: Array.isArray(fkViolations) ? fkViolations.length : 0 },
      actor: currentActor().actor,
    });
    return ok({
      integrity: typeof integrity === 'string' ? integrity : JSON.stringify(integrity),
      fkViolations,
    });
  });

  app.post('/api/health/maintenance', async (req) => {
    const b = (req.body ?? {}) as { op?: string };
    if (b.op !== 'vacuum' && b.op !== 'analyze') return fail('BAD_REQUEST', 'op 必须是 vacuum 或 analyze');
    const db = ctx.db();
    const before = ctx.dbSize();
    db.exec(b.op.toUpperCase());
    logActivity(ctx.db(), {
      kind: b.op === 'vacuum' ? 'library.vacuum' : 'library.analyze',
      level: 'L2',
      detail: { sizeBytesBefore: before, sizeBytesAfter: ctx.dbSize() },
      actor: currentActor().actor,
    });
    return ok({ done: true, sizeBytesBefore: before, sizeBytesAfter: ctx.dbSize() });
  });

  // 内容索引清单（按项目）：状态表条目数 + FTS 行数
  app.get('/api/health/fts', async () => {
    const db = ctx.db();
    const rows = db
      .prepare<[], { projectId: string; name: string; stateCount: number; ftsRows: number }>(
        `SELECT p.id AS projectId,
                COALESCE(NULLIF(p.alias, ''), p.disk_name) AS name,
                (SELECT COUNT(*) FROM content_index_state s WHERE s.project_id = p.id) AS stateCount,
                (SELECT COUNT(*) FROM content_fts f WHERE f.project_id = p.id) AS ftsRows
         FROM projects p WHERE p.deleted_at IS NULL
         ORDER BY name`,
      )
      .all();
    return ok(rows);
  });

  // 重建 = 清空该项目索引后全量重析（复用搜索域的构建链与任务通道）
  app.post('/api/health/fts/rebuild', async (req) => {
    const b = (req.body ?? {}) as { projectId?: string };
    if (b.projectId === undefined) return fail('BAD_REQUEST', '缺少 projectId');
    const db = ctx.db();
    const row = db
      .prepare<[string], { id: string; disk_name: string; dir_path: string }>(
        'SELECT id, disk_name, dir_path FROM projects WHERE id = ? AND deleted_at IS NULL',
      )
      .get(b.projectId);
    if (row === undefined) return fail('NOT_FOUND', '项目不存在', 404);
    clearProjectIndex(db, row.id);
    const pid = row.id;
    const taskId = ctx.tasks.start('index', `重建内容索引：${row.disk_name}`, 0, async (taskCtx) => {
      await buildProjectIndex(db, pid, row.dir_path, taskCtx);
    });
    logActivity(ctx.db(), {
      kind: 'library.fts_rebuild',
      level: 'L2',
      projectId: row.id,
      actor: currentActor().actor,
    });
    return ok({ taskId });
  });

  // ---- 运行中任务（FR-4.7）：全 kind 列表与精确取消；index 专用端点保持不动 ----
  app.get('/api/tasks', async () => {
    return ok({ running: ctx.tasks.list() });
  });

  app.post('/api/tasks/cancel', async (req) => {
    const b = (req.body ?? {}) as { taskId?: string };
    if (b.taskId === undefined) return fail('BAD_REQUEST', '缺少 taskId');
    return ok({ cancelled: ctx.tasks.cancel(b.taskId) });
  });

  app.get('/api/tasks/history', async (req) => {
    const q = req.query as { limit?: string };
    const limit = Math.min(Math.max(Number(q.limit ?? '50'), 1), 200);
    return ok(listTaskRuns(ctx.db(), limit));
  });

  app.post('/api/restore', async (req) => {
    const b = (req.body ?? {}) as { file?: string; confirm?: boolean };
    if (b.confirm !== true) return fail('CONFIRM_REQUIRED', '恢复备份会覆盖当前索引库，需要 confirm 确认');
    if (b.file === undefined) return fail('BAD_REQUEST', '缺少 file');
    // 只接受备份目录顶层的文件名：basename 防绝对路径 / ..\ 逃出备份目录（体检 P2 守卫缺口）
    const target = join(ctx.layout.backupDir, basename(b.file));
    if (!existsSync(target)) return fail('NOT_FOUND', '备份文件不存在', 404);
    // 体检 P0：恢复覆盖库文件前必须关连接，否则存活句柄的页缓存/WAL 与新文件错位
    //（轻则 malformed 重则丢数据）；失败用 restoreBackup 留下的 .before-restore 回滚
    ctx.store.close();
    try {
      restoreBackup(ctx.layout.dbFile, target);
    } catch (e) {
      const rollback = `${ctx.layout.dbFile}.before-restore`;
      try {
        if (existsSync(rollback)) copyFileSync(rollback, ctx.layout.dbFile);
      } catch {
        /* 回滚失败只能如实上报原错误 */
      }
      ctx.store.open();
      throw e;
    }
    ctx.store.open();
    const integrity = integrityCheck(ctx.store.get());
    if (!integrity.ok) throw new AppError('IO_ERROR', `恢复后完整性校验失败：${integrity.message}`);
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
        esc(p.alias ?? ''),
        esc(p.diskName),
        esc(p.dirPath),
        esc(p.type),
        esc(p.primaryLanguage ?? ''),
        String(p.fileCount),
        String(p.sizeBytes),
        esc(p.techStack.join('|')),
        esc(p.gitBranch ?? ''),
        p.gitDirty ? '是' : '否',
        esc(p.gitLastCommitAt ?? ''),
        esc(p.lastOpenedAt ?? ''),
      ].join(','),
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
      for (const t of [
        'projects',
        'language_stats',
        'analysis_runs',
        'collections',
        'collection_members',
        'tags',
        'project_tags',
        'doc_roots',
        'project_paths',
        'archives',
        'todos',
        'editor_drafts',
        'sessions',
        'session_tabs',
        'recent_files',
        'content_fts',
        'content_index_state',
      ]) {
        db.prepare(`DELETE FROM ${t}`).run();
      }
      db.prepare(
        `INSERT INTO sessions (id, name, is_active, created_at, updated_at) VALUES ('default', '默认会话', 1, ?, ?)`,
      ).run(new Date().toISOString(), new Date().toISOString());
    });
    tx();
    logActivity(db, { kind: 'library.reset', level: 'L3', detail: { note: '仅清空索引数据，项目文件未动' } });
    return ok({ reset: true });
  });

  app.get('/api/activity', async (req) => {
    // FR-13.8 / T-105：活动中心查询——limit/offset 分页 + 项目/actor/级别/kind 前缀/时间段过滤
    const q = req.query as {
      limit?: string;
      offset?: string;
      projectId?: string;
      actor?: string;
      level?: string;
      kind?: string;
      kinds?: string;
      since?: string;
      until?: string;
    };
    const limit = Math.min(Math.max(Number(q.limit ?? '100'), 1), 1000);
    const offset = Math.max(Number(q.offset ?? '0') || 0, 0);
    const level = q.level === 'L1' || q.level === 'L2' || q.level === 'L3' ? q.level : undefined;
    const kinds =
      q.kinds !== undefined && q.kinds !== ''
        ? q.kinds
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s !== '')
        : undefined;
    const nz = (v: string | undefined): string | undefined => (v === undefined || v === '' ? undefined : v);
    return ok(
      listActivity(ctx.db(), {
        limit,
        offset,
        projectId: nz(q.projectId),
        actor: nz(q.actor),
        level,
        kindPrefix: nz(q.kind),
        kinds,
        since: nz(q.since),
        until: nz(q.until),
      }),
    );
  });

  app.get('/api/data-stats', async () => {
    const dbSize = ctx.dbSize();
    const trash = ctx
      .db()
      .prepare<[], { c: number; b: number }>(
        'SELECT COUNT(*) AS c, COALESCE(SUM(size_bytes),0) AS b FROM trash',
      )
      .get();
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
      logSize: statSafe(join(ctx.layout.logDir, 'ttfolio.log'))?.size ?? 0,
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

/** 自定义视图（FR-4.11）：坏值回落空数组，绝不因手改库炸接口。 */
function parseCustomViews(raw: string | undefined): CustomView[] {
  if (raw === undefined || raw === '') return [];
  const parsed = customViewsSchema.safeParse(safeJson(raw));
  return parsed.success ? parsed.data : [];
}

export { readFileSync, AppError };
