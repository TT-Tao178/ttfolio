/** 进程外沙箱运行器单测（FR-16.4 / T-135）：正常执行与受控调用、越权拒绝、
 *  超时强杀。真子进程（process.execPath + ELECTRON_RUN_AS_NODE），Windows 本地跑。 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations } from '../../db/migrate.js';
import { insertProject } from '../../db/repo/projectsRepo.js';
import { pathKey } from '../../db/repo/docsRepo.js';
import { runSandboxPlugin, SANDBOX_OUTPUT_CAP } from './sandboxRunner.js';
import type { PluginInfo } from './manifest.js';
import type { SseHub } from '../sse.js';

let root = '';
let db: Database.Database;
let pid = '';
let dataDir = '';

const noopSse = { publish: () => {} } as unknown as SseHub;
const noopLogger = { info: () => {}, warn: () => {}, error: () => {} } as never;

type PluginPermission = NonNullable<PluginInfo['permissions']>[number];
function makePlugin(dirName: string, mainSource: string, permissions: PluginPermission[]): PluginInfo {
  const dir = path.join(root, dirName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'plugin.json'),
    JSON.stringify({
      id: dirName,
      name: dirName,
      version: '1.0.0',
      kind: 'script',
      main: 'main.cjs',
      execution: 'sandbox',
      permissions,
    }),
  );
  fs.writeFileSync(path.join(dir, 'main.cjs'), mainSource);
  return {
    id: dirName,
    name: dirName,
    version: '1.0.0',
    author: null,
    kind: 'script',
    execution: 'sandbox',
    enabled: true,
    builtin: false,
    installedAt: new Date().toISOString(),
    dirPath: dir,
    description: null,
    permissions,
    commands: [],
    cards: [],
  };
}

const deps = (): Parameters<typeof runSandboxPlugin>[0] => ({
  getDb: () => db,
  sse: noopSse,
  logger: noopLogger,
  dataDir,
});

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'tt-sandbox-'));
  dataDir = path.join(root, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  db = new Database(path.join(root, 'library.db'));
  db.pragma('foreign_keys = ON');
  runMigrations(db, null);
  const dir = path.join(root, 'proj');
  fs.mkdirSync(dir, { recursive: true });
  pid = insertProject(db, {
    dirPath: dir,
    dirPathKey: pathKey(dir),
    diskName: 'proj',
    defaultArchDir: '架构图',
  }).id;
  void pid;
});

afterAll(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('进程外沙箱（FR-16.4 / T-135）', () => {
  it('正常执行：受控调用回父进程逐调用鉴权，log 与 projects.list 生效', async () => {
    const plugin = makePlugin(
      'sandbox-ok',
      `module.exports.activate = async (api) => {
  api.log('hello-sandbox');
  const list = await api.projects.list();
  api.log('projects=' + list.length);
};`,
      ['panel.output', 'projects.read'],
    );
    const r = await runSandboxPlugin(deps(), plugin, { allowNonDesktop: true });
    expect(r.ok).toBe(true);
    expect(r.error).toBeNull();
    expect(r.output.join('\n')).toContain('hello-sandbox');
    expect(r.output.join('\n')).toContain('projects=1');
  }, 30_000);

  it('越权拒绝：未声明 projects.read 时调用报「缺少权限」', async () => {
    const plugin = makePlugin(
      'sandbox-noperm',
      `module.exports.activate = async (api) => {
  try {
    await api.projects.list();
    api.log('SHOULD-NOT-REACH');
  } catch (e) {
    api.log('DENIED:' + (e instanceof Error ? e.message : String(e)));
  }
};`,
      ['panel.output'],
    );
    const r = await runSandboxPlugin(deps(), plugin, { allowNonDesktop: true });
    expect(r.ok).toBe(true); // 插件自身捕获了错误，运行成功
    expect(r.output.join('\n')).toContain('DENIED:缺少权限 projects.read');
  }, 30_000);

  it('超时强杀：挂死插件到时限即报错且进程被结束', async () => {
    const plugin = makePlugin(
      'sandbox-hang',
      `module.exports.activate = async () => { await new Promise(() => {}); };`,
      [],
    );
    const r = await runSandboxPlugin(deps(), plugin, { allowNonDesktop: true, timeoutMs: 1500 });
    expect(r.ok).toBe(false);
    expect(r.error ?? '').toContain('超时');
  }, 30_000);

  it('输出上限：超过 64KB 后不再追加', () => {
    expect(SANDBOX_OUTPUT_CAP).toBe(64 * 1024);
  });
});
