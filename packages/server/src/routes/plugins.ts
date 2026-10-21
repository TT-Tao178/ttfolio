/** 插件路由（FR-14.1 / T-101）：列表/安装/启停/卸载/运行/命令贡献/在线市场。 */
import type { FastifyPluginAsync } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import type { AppContext } from '../context.js';
import { ok, fail } from './helpers.js';
import {
  ensureBuiltinPlugins,
  getPlugin,
  cardStat,
  listPlugins,
  listPluginCommands,
  removePlugin,
  setPluginEnabled,
  upsertPlugin,
} from '../core/plugins/registry.js';
import { validateManifest, isSafeMainPath } from '../core/plugins/manifest.js';
import { runScriptPlugin, assertRunnable } from '../core/plugins/host.js';
import { logActivity } from '../db/repo/metaRepo.js';
import { currentActor } from '../core/actor.js';

export const pluginsRoutes: FastifyPluginAsync = async (app) => {
  const ctx = app.ttfolio as AppContext;
  // 随包内置插件登记（幂等；每次启动确保存在）
  try {
    ensureBuiltinPlugins(ctx.db());
  } catch {
    /* 登记失败不阻断启动 */
  }

  app.get('/api/plugins', async () => {
    const db = ctx.db();
    return ok(
      listPlugins(db).map((p) => ({
        ...p,
        cardValues: p.cards.map((c) => ({ ...c, value: cardStat(db, c.source) })),
      })),
    );
  });

  /** 安装：声明式传 manifest 对象；脚本插件传本地目录路径（含 plugin.json）。 */
  app.post('/api/plugins/install', async (req) => {
    const b = (req.body ?? {}) as { manifest?: unknown; dirPath?: string };
    const db = ctx.db();
    let manifestRaw: unknown = b.manifest;
    let dirPath: string | null = null;
    if (b.dirPath !== undefined && b.dirPath !== '') {
      const dir = path.resolve(b.dirPath.trim());
      if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
        return fail('NOT_FOUND', '插件目录不存在', 404);
      }
      const manifestFile = path.join(dir, 'plugin.json');
      if (!fs.existsSync(manifestFile)) return fail('BAD_REQUEST', '目录内缺少 plugin.json');
      try {
        manifestRaw = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
      } catch {
        return fail('BAD_REQUEST', 'plugin.json 不是合法 JSON');
      }
      dirPath = dir;
    }
    if (manifestRaw === undefined) return fail('BAD_REQUEST', '缺少 manifest 或 dirPath');
    const valid = validateManifest(manifestRaw);
    if (valid.ok !== true) return fail('BAD_REQUEST', valid.error);
    const m = valid.manifest;
    if (m.kind === 'script') {
      if (dirPath === null) return fail('BAD_REQUEST', '脚本插件必须从本地目录安装');
      const main = m.main ?? '';
      if (!isSafeMainPath(main)) return fail('BAD_REQUEST', '入口文件路径不合法');
      const entry = path.resolve(dirPath, main);
      const rel = path.relative(dirPath, entry);
      if (rel === '' || rel.split(path.sep).includes('..') || path.isAbsolute(rel)) {
        return fail('BAD_REQUEST', '入口文件越出插件目录');
      }
      if (!fs.existsSync(entry)) return fail('BAD_REQUEST', '入口文件不存在');
    } else if (dirPath !== null) {
      // 声明式从目录安装：只取清单，不记目录（零代码）
      dirPath = null;
    }
    const existing = getPlugin(db, m.id);
    if (existing !== null && existing.builtin) {
      return fail('INVALID_NAME', '内置插件的 id 不可被覆盖');
    }
    const info = upsertPlugin(db, m, dirPath);
    logActivity(db, {
      kind: 'plugin.install',
      level: 'L2',
      detail: { pluginId: m.id, version: m.version, kind: m.kind, permissions: m.permissions },
      actor: currentActor().actor,
    });
    ctx.sse.publish('plugin.changed', { pluginId: m.id });
    return ok(info);
  });

  app.patch('/api/plugins/:id', async (req) => {
    const { id } = req.params as { id: string };
    const b = (req.body ?? {}) as { enabled?: unknown };
    if (typeof b.enabled !== 'boolean') return fail('BAD_REQUEST', '缺少 enabled');
    const db = ctx.db();
    if (!setPluginEnabled(db, id, b.enabled)) return fail('NOT_FOUND', '插件不存在', 404);
    logActivity(db, {
      kind: b.enabled ? 'plugin.enable' : 'plugin.disable',
      level: 'L1',
      detail: { pluginId: id },
      actor: currentActor().actor,
    });
    ctx.sse.publish('plugin.changed', { pluginId: id });
    return ok({ enabled: b.enabled });
  });

  app.delete('/api/plugins/:id', async (req) => {
    const { id } = req.params as { id: string };
    const db = ctx.db();
    const p = getPlugin(db, id);
    if (p === null) return fail('NOT_FOUND', '插件不存在', 404);
    if (p.builtin) return fail('PERMISSION_DENIED', '内置插件只能禁用，不能卸载', 403);
    removePlugin(db, id);
    logActivity(db, {
      kind: 'plugin.uninstall',
      level: 'L1',
      detail: { pluginId: id },
      actor: currentActor().actor,
    });
    ctx.sse.publish('plugin.changed', { pluginId: id });
    return ok({ removed: true });
  });

  /** 运行脚本插件（声明式命令由前端直接执行 action，不走这里）。 */
  app.post('/api/plugins/:id/run', async (req) => {
    const { id } = req.params as { id: string };
    const db = ctx.db();
    const plugin = assertRunnable(db, id);
    if (plugin === null) return fail('NOT_FOUND', '插件不存在或已停用', 404);
    if (plugin.kind !== 'script') return fail('BAD_REQUEST', '声明式插件无需运行');
    const r = await runScriptPlugin(
      { getDb: () => ctx.db(), sse: ctx.sse, logger: ctx.logger, version: ctx.version },
      plugin,
    );
    logActivity(db, {
      kind: 'plugin.run',
      level: 'L1',
      detail: { pluginId: id, ok: r.ok, error: r.error },
      actor: `plugin:${id}`,
    });
    return ok(r);
  });

  /** 命令面板贡献（启用的插件命令；前端并入注册表）。 */
  app.get('/api/plugins/contributions', async () => {
    const db = ctx.db();
    return ok(
      listPluginCommands(db).map(({ pluginId, pluginName, command }) => ({
        pluginId,
        pluginName,
        command,
        cardValues: [],
      })),
    );
  });

  /**
   * 在线市场（可选联网能力；本地优先红线）：拉远程索引 JSON；失败/未配置时
   * 如实降级为「离线：仅本地」——核心功能永不依赖在线广场。
   */
  app.get('/api/plugins/market', async (req) => {
    const q = req.query as { url?: string };
    const url = q.url ?? '';
    if (url === '') {
      return ok({ online: false, reason: '未配置在线市场索引地址', plugins: [] });
    }
    if (!/^https:\/\//i.test(url)) {
      return ok({ online: false, reason: '只支持 https 索引地址', plugins: [] });
    }
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) return ok({ online: false, reason: `索引返回 HTTP ${res.status}`, plugins: [] });
      const data: unknown = await res.json();
      const list = Array.isArray(data) ? data : ((data as { plugins?: unknown }).plugins ?? []);
      if (!Array.isArray(list)) return ok({ online: false, reason: '索引格式不是插件数组', plugins: [] });
      return ok({ online: true, reason: null, plugins: list.slice(0, 100) });
    } catch (err) {
      return ok({
        online: false,
        reason: `无法连接在线市场（${err instanceof Error ? err.message : String(err)}）——已降级为仅本地`,
        plugins: [],
      });
    }
  });
};
