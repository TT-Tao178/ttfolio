/** 进程外沙箱运行器（FR-16.4 / T-135，2026-11-07 用户点名 A 组）：
 *  声明 execution=sandbox 的脚本插件在独立 Node 子进程执行（崩溃/超时/输出
 *  失控均隔离，绝不影响主进程与索引库）；受控 API 调用经 stdio JSON-lines
 *  RPC 回到父进程，**权限校验与审计都在父进程侧逐调用执行**（子进程只能请求）。
 *
 *  宿主脚本由服务端生成写入数据目录（sandbox-host.cjs，与运行版本同源），
 *  子进程以 Node 模式启动（Electron 打包环境强制 ELECTRON_RUN_AS_NODE=1——
 *  环境预置的该变量在这里是「要」的，与启动冒烟的剔除方向相反）。
 *
 *  边界（如实）：本地单机信任模型不承诺防恶意代码，承诺崩溃隔离与资源配额
 *  （超时杀、输出 ≤64KB）。Web/独立服务模式（非 Electron）不可用，如实拒绝。 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import type { Logger } from '../logger.js';
import type { SseHub } from '../sse.js';
import { runAs } from '../actor.js';
import { logActivity } from '../../db/repo/metaRepo.js';
import { getProjectSummary, listProjects } from '../../db/repo/projectsRepo.js';
import { analyzeProjects } from '../analyzer/runner.js';
import type { PluginInfo } from './manifest.js';
import type { PluginPermission } from './manifest.js';

export interface SandboxDeps {
  getDb: () => Database.Database;
  sse: SseHub;
  logger: Logger;
  dataDir: string;
}

export const SANDBOX_TIMEOUT_MS = 30_000;
export const SANDBOX_OUTPUT_CAP = 64 * 1024;

/** 宿主脚本源码：收到 run 行后动态 import 插件入口，activate(api) 的每个调用
 *  经 stdin/stdout RPC 回父进程；完事回 done。绝不碰 fs/网络（子进程无句柄）。 */
const HOST_SOURCE = `#!/ nodetype: commonjs
const rl = require('node:readline').createInterface({ input: process.stdin });
let api = null;
function send(o) { process.stdout.write(JSON.stringify(o) + '\\n'); }
function call(method, args) {
  return new Promise((resolve, reject) => {
    const id = 'c' + Math.random().toString(36).slice(2);
    const onMsg = (line) => {
      try {
        const m = JSON.parse(line);
        if (m.type === 'result' && m.id === id) {
          rl.off('line', onMsg);
          if (m.ok) resolve(m.data);
          else reject(new Error(m.error ?? '调用失败'));
        }
      } catch { /* 忽略非 JSON 行 */ }
    };
    rl.on('line', onMsg);
    send({ type: 'call', id, method, args });
  });
}
rl.on('line', async (line) => {
  let m;
  try { m = JSON.parse(line); } catch { return; }
  if (m.type !== 'run') return;
  try {
    const mod = await import(require('node:url').pathToFileURL(m.file).href);
    const fn = mod.activate ?? mod.default;
    if (typeof fn !== 'function') throw new Error('插件未导出 activate(api)');
    api = {
      log(msg) { return call('log', [msg]); },
      projects: {
        list() { return call('projects.list', []); },
        get(id) { return call('projects.get', [id]); },
      },
      analyze(projectId) { return call('analyze', [projectId]); },
    };
    await fn(api);
    send({ type: 'done', ok: true, error: null });
  } catch (err) {
    send({ type: 'done', ok: false, error: err instanceof Error ? err.message : String(err) });
  }
  setTimeout(() => process.exit(0), 50);
});
send({ type: 'ready' });
`;

function ensureHostScript(dataDir: string): string {
  const dir = path.join(dataDir, 'plugins');
  fs.mkdirSync(dir, { recursive: true });
  const host = path.join(dir, 'sandbox-host.cjs');
  const existing = fs.existsSync(host) ? fs.readFileSync(host, 'utf8') : '';
  if (existing !== HOST_SOURCE) fs.writeFileSync(host, HOST_SOURCE, 'utf8');
  return host;
}

type SandboxMsg =
  | { type: 'ready' }
  | { type: 'call'; id: string; method: string; args: unknown[] }
  | { type: 'done'; ok: boolean; error: string | null }
  | { type: 'result'; id: string; ok: boolean; data?: unknown; error?: string };

export interface SandboxRunResult {
  ok: boolean;
  output: string[];
  error: string | null;
}

/** 在进程外沙箱运行脚本插件（权限/审计在父进程逐调用执行）。 */
export async function runSandboxPlugin(
  deps: SandboxDeps,
  plugin: PluginInfo,
  opts?: { entryPath?: string; timeoutMs?: number; allowNonDesktop?: boolean },
): Promise<SandboxRunResult> {
  const output: string[] = [];
  let outBytes = 0;
  const emit = (line: string): void => {
    if (outBytes >= SANDBOX_OUTPUT_CAP) return;
    output.push(line);
    outBytes += line.length + 1;
    deps.sse.publish('plugin.output', { pluginId: plugin.id, line });
  };
  if (process.versions.electron === undefined && opts?.allowNonDesktop !== true) {
    return { ok: false, output, error: '进程外沙箱仅桌面版可用（当前为 Web/独立服务模式）' };
  }
  if (plugin.dirPath === null || plugin.dirPath === '') {
    return { ok: false, output, error: '插件目录缺失（重新安装该插件）' };
  }
  // 入口与 inproc 同一套安全规则：读清单 main 并做目录内校验
  let main: string | undefined;
  try {
    const raw = fs.readFileSync(path.join(plugin.dirPath, 'plugin.json'), 'utf8');
    main = (JSON.parse(raw) as { main?: string }).main;
  } catch {
    return { ok: false, output, error: '插件清单 plugin.json 丢失或不是合法 JSON' };
  }
  if (
    main === undefined ||
    main === '' ||
    /^[a-zA-Z]:/.test(main) ||
    /^[\\/]/.test(main) ||
    main.split(/[\\/]/).includes('..')
  ) {
    return { ok: false, output, error: '入口文件路径不合法' };
  }
  const entry = path.resolve(plugin.dirPath, main);
  const hostPath = ensureHostScript(deps.dataDir);
  const timeoutMs = opts?.timeoutMs ?? SANDBOX_TIMEOUT_MS;

  const perms = new Set<PluginPermission>(plugin.permissions);
  const actorName = `plugin:${plugin.id}`;
  const assertPerm = (perm: PluginPermission): void => {
    if (!perms.has(perm)) throw new Error(`缺少权限 ${perm}（在插件清单中声明并重新安装）`);
  };
  /** 父进程侧执行 + 插件身份审计（与 inproc 同口径）。 */
  const execCall = (method: string, args: unknown[]): unknown => {
    const run = (): unknown => {
      switch (method) {
        case 'log':
          assertPerm('panel.output');
          emit(String(args[0] ?? '').slice(0, 2000));
          return null;
        case 'projects.list':
          assertPerm('projects.read');
          return listProjects(deps.getDb(), { status: 'active' }).map((p) => ({
            id: p.id,
            name: p.alias ?? p.diskName,
            type: p.type,
            fileCount: p.fileCount,
          }));
        case 'projects.get':
          assertPerm('projects.read');
          {
            const p = getProjectSummary(deps.getDb(), String(args[0] ?? ''));
            return p === null
              ? null
              : { id: p.id, name: p.alias ?? p.diskName, type: p.type, fileCount: p.fileCount };
          }
        case 'analyze':
          assertPerm('analysis.trigger');
          // analyze 是异步动作：同步通道里先触发，完成事件经 SSE 通知（与 inproc 语义一致）
          void analyzeProjects({ db: deps.getDb, sse: deps.sse } as never, [String(args[0] ?? '')]);
          return null;
        default:
          throw new Error(`未知调用 ${method}`);
      }
    };
    return runAs({ actor: actorName, ownerId: null }, () => {
      try {
        return { ok: true, data: run() };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      } finally {
        logActivity(deps.getDb(), {
          kind: 'plugin.call',
          level: 'L1',
          detail: { pluginId: plugin.id, sandbox: true },
          actor: actorName,
        });
      }
    });
  };

  return await new Promise<SandboxRunResult>((resolve) => {
    const child = spawn(process.execPath, [hostPath], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });
    let done = false;
    let buffer = '';
    const write = (o: unknown): void => {
      if (done) return;
      try {
        child.stdin?.write(`${JSON.stringify(o)}
`);
      } catch {
        /* 管道已关（EPIPE）：子进程将被超时/exit 兜底 */
      }
    };
    child.stdout?.on('error', () => {});
    child.stderr?.on('error', () => {});
    child.stdin?.on('error', () => {});
    const finish = (ok: boolean, error: string | null): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        child.kill();
      } catch {
        /* 已退出 */
      }
      resolve({ ok, output, error });
    };
    const timer = setTimeout(
      () => finish(false, `插件执行超时（${Math.round(timeoutMs / 1000)}s，已强制结束）`),
      timeoutMs,
    );
    child.stdout?.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let idx = buffer.indexOf('\n');
      while (idx >= 0) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        idx = buffer.indexOf('\n');
        let m: SandboxMsg | null = null;
        try {
          m = JSON.parse(line) as SandboxMsg;
        } catch {
          continue;
        }
        if (m === null) continue;
        if (m.type === 'ready') {
          write({ type: 'run', file: opts?.entryPath ?? entry });
        } else if (m.type === 'call' && m.id !== undefined) {
          const r = execCall(m.method ?? '', m.args ?? []) as { ok: boolean; data?: unknown; error?: string };
          write({
            type: 'result',
            id: m.id,
            ok: r.ok,
            data: r.ok ? r.data : undefined,
            error: r.ok ? undefined : r.error,
          });
        } else if (m.type === 'done') {
          if (m.ok === true) finish(true, null);
          else {
            const msg = m.error ?? '插件执行失败';
            emit(`[错误] ${msg}`);
            finish(false, msg);
          }
        }
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      emit(`[stderr] ${chunk.toString('utf8').slice(0, 500)}`);
    });
    child.on('exit', (code) => {
      if (!done) finish(false, `沙箱进程提前退出（code=${code ?? 'null'}）`);
    });
    child.on('error', (err) => finish(false, `沙箱进程启动失败：${err.message}`));
  });
}
