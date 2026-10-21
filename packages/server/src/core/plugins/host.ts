/**
 * 脚本插件宿主（FR-14.1 / T-101，T1 分期）。
 *
 * 只注入受控 API 子集：读项目元数据、触发分析、向插件页输出；**不提供任何
 * 文件系统句柄**。权限按清单声明授权（缺权限调用直接拒绝并审计）。单插件
 * 崩溃被 try/catch 与 Promise 捕获隔离，绝不影响主程序。
 *
 * 说明（诚实边界）：T1 为同进程脚本，不是安全沙箱；真正的进程外沙箱属 T2，
 * 本版不承诺。安装脚本插件时界面明示「只装可信来源」。
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type Database from 'better-sqlite3';
import type { Logger } from '../logger.js';
import type { SseHub } from '../sse.js';
import { runAs } from '../actor.js';
import { logActivity } from '../../db/repo/metaRepo.js';
import { getProjectSummary, listProjects } from '../../db/repo/projectsRepo.js';
import { analyzeProjects } from '../analyzer/runner.js';
import { getPlugin } from './registry.js';
import type { PluginInfo } from './manifest.js';
import { isSafeMainPath, type PluginPermission } from './manifest.js';

export interface PluginApi {
  log(message: string): void;
  projects: {
    list(): Array<{ id: string; name: string; type: string; fileCount: number }>;
    get(id: string): { id: string; name: string; type: string; fileCount: number } | null;
  };
  analyze(projectId: string): Promise<void>;
}

interface HostDeps {
  getDb: () => Database.Database;
  sse: SseHub;
  logger: Logger;
  version: string;
}

const RUN_TIMEOUT_MS = 10_000;

/**
 * 运行脚本插件：动态 import 入口，调用 activate(api)；整体加超时与异常隔离。
 * 返回本次输出行（同时经 SSE plugin.output 推给插件页）。
 */
export async function runScriptPlugin(
  deps: HostDeps,
  plugin: PluginInfo,
): Promise<{ ok: boolean; output: string[]; error: string | null }> {
  const output: string[] = [];
  const emit = (line: string): void => {
    output.push(line);
    deps.sse.publish('plugin.output', { pluginId: plugin.id, line });
  };
  if (plugin.kind !== 'script') {
    return { ok: false, output, error: '该插件不是脚本插件' };
  }
  if (plugin.dirPath === null || plugin.dirPath === '') {
    return { ok: false, output, error: '插件目录缺失（重新安装该插件）' };
  }
  const manifestRaw = await import('node:fs').then((fs) => {
    try {
      return fs.readFileSync(path.join(plugin.dirPath ?? '', 'plugin.json'), 'utf8');
    } catch {
      return null;
    }
  });
  if (manifestRaw === null) return { ok: false, output, error: '插件清单 plugin.json 丢失' };
  let main: string | undefined;
  try {
    main = (JSON.parse(manifestRaw) as { main?: string }).main;
  } catch {
    return { ok: false, output, error: 'plugin.json 不是合法 JSON' };
  }
  if (main === undefined || !isSafeMainPath(main)) {
    return { ok: false, output, error: '入口文件路径不合法' };
  }
  const entry = path.resolve(plugin.dirPath, main);
  const rel = path.relative(plugin.dirPath, entry);
  if (rel === '' || rel.split(path.sep).includes('..') || path.isAbsolute(rel)) {
    return { ok: false, output, error: '入口文件越出插件目录' };
  }

  const perms = new Set<PluginPermission>(plugin.permissions);
  const api = buildApi(deps, plugin, perms, emit);

  const work = (async (): Promise<void> => {
    const mod = (await import(`${pathToFileURL(entry).href}?t=${Date.now()}`)) as {
      activate?: (api: PluginApi) => unknown;
      default?: (api: PluginApi) => unknown;
    };
    const fn = mod.activate ?? mod.default;
    if (typeof fn !== 'function') {
      throw new Error('插件未导出 activate(api)');
    }
    await fn(api);
  })();

  try {
    await Promise.race([
      work,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`插件执行超时（${RUN_TIMEOUT_MS / 1000}s）`)), RUN_TIMEOUT_MS),
      ),
    ]);
    return { ok: true, output, error: null };
  } catch (err) {
    work.catch(() => {
      /* 超时后底层 promise 的拒绝不再冒泡 */
    });
    const message = err instanceof Error ? err.message : String(err);
    emit(`[错误] ${message}`);
    deps.logger.warn({ mod: 'plugins', msg: `plugin ${plugin.id} failed: ${message}` });
    return { ok: false, output, error: message };
  }
}

function buildApi(
  deps: HostDeps,
  plugin: PluginInfo,
  perms: Set<PluginPermission>,
  emit: (line: string) => void,
): PluginApi {
  const actorName = `plugin:${plugin.id}`;
  const assert = (perm: PluginPermission): void => {
    if (!perms.has(perm)) throw new Error(`缺少权限 ${perm}（在插件清单中声明并重新安装）`);
  };
  /** 插件调用一律以插件身份落审计（与用户/agent 区分）。 */
  const asPlugin = <T>(fn: () => T): T =>
    runAs({ actor: actorName, ownerId: null }, () => {
      try {
        return fn();
      } finally {
        logActivity(deps.getDb(), {
          kind: 'plugin.call',
          level: 'L1',
          detail: { pluginId: plugin.id },
          actor: actorName,
        });
      }
    });

  return {
    log(message: string) {
      assert('panel.output');
      if (typeof message === 'string') emit(message.slice(0, 2000));
    },
    projects: {
      list() {
        assert('projects.read');
        return asPlugin(() =>
          listProjects(deps.getDb(), { status: 'active' }).map((p) => ({
            id: p.id,
            name: p.alias ?? p.diskName,
            type: p.type,
            fileCount: p.fileCount,
          })),
        );
      },
      get(id: string) {
        assert('projects.read');
        return asPlugin(() => {
          const p = getProjectSummary(deps.getDb(), id);
          if (p === null) return null;
          return {
            id: p.id,
            name: p.alias ?? p.diskName,
            type: p.type,
            fileCount: p.fileCount,
          };
        });
      },
    },
    async analyze(projectId: string) {
      assert('analysis.trigger');
      await asPlugin(() => analyzeProjects({ db: deps.getDb, sse: deps.sse } as never, [projectId]));
    },
  };
}

/** 供路由层：调用前确认插件存在且启用。 */
export function assertRunnable(db: Database.Database, id: string): PluginInfo | null {
  const p = getPlugin(db, id);
  if (p === null || !p.enabled) return null;
  return p;
}
