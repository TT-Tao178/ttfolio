/** 插件系统锚点（FR-14.1 / T-101）：清单校验、内置登记、启停、命令贡献、权限白名单。 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { runMigrations } from '../../db/migrate.js';
import { insertProject } from '../../db/repo/projectsRepo.js';
import { pathKey } from '../../db/repo/docsRepo.js';
import { isSafeMainPath, validateManifest } from './manifest.js';
import {
  ensureBuiltinPlugins,
  getPlugin,
  listPluginCommands,
  listPlugins,
  removePlugin,
  setPluginEnabled,
  upsertPlugin,
} from './registry.js';

let root: string;
let db: Database.Database;
let pid: string;

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ttfolio-plugins-'));
  db = new Database(path.join(root, 'library.db'));
  db.pragma('journal_mode = WAL');
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
});

afterAll(() => {
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe('插件清单校验（FR-14.1）', () => {
  it('合法声明式清单通过；非法 id/权限/脚本缺 main 被拒', () => {
    const ok = validateManifest({
      id: 'demo.hello',
      name: '演示',
      version: '1.0.0',
      kind: 'declarative',
      permissions: ['commands.contribute'],
      contributes: { commands: [{ id: 'hi', title: '打招呼', action: { type: 'message', text: 'hi' } }] },
    });
    expect(ok.ok).toBe(true);

    expect(validateManifest({ id: 'Bad Id', name: 'x', version: '1', kind: 'declarative' }).ok).toBe(false);
    expect(
      validateManifest({
        id: 'a.b',
        name: 'x',
        version: '1',
        kind: 'declarative',
        permissions: ['fs.write'],
      }).ok,
    ).toBe(false);
    expect(validateManifest({ id: 'a.b', name: 'x', version: '1', kind: 'script' }).ok).toBe(false);
  });

  it('脚本入口路径：拒绝绝对路径与 ../ 逃逸', () => {
    expect(isSafeMainPath('index.js')).toBe(true);
    expect(isSafeMainPath('src/main.js')).toBe(true);
    expect(isSafeMainPath('../evil.js')).toBe(false);
    expect(isSafeMainPath('C:\\evil.js')).toBe(false);
    expect(isSafeMainPath('/etc/passwd')).toBe(false);
    expect(isSafeMainPath('\\evil.js')).toBe(false);
  });
});

describe('插件注册表与命令贡献（FR-14.1）', () => {
  it('内置示例幂等登记、可禁用但不可卸载；插件命令随启用状态进出面板', () => {
    ensureBuiltinPlugins(db);
    ensureBuiltinPlugins(db);
    const builtins = listPlugins(db).filter((p) => p.builtin);
    expect(builtins).toHaveLength(1);
    expect(builtins[0]?.id).toBe('ttfolio.example.stats');

    expect(listPluginCommands(db).some((c) => c.pluginId === 'ttfolio.example.stats')).toBe(true);
    setPluginEnabled(db, 'ttfolio.example.stats', false);
    expect(listPluginCommands(db).some((c) => c.pluginId === 'ttfolio.example.stats')).toBe(false);
    expect(removePlugin(db, 'ttfolio.example.stats')).toBe(false);
    setPluginEnabled(db, 'ttfolio.example.stats', true);
  });

  it('第三方声明式插件 upsert：版本覆盖、可卸载', () => {
    const m = {
      id: 'demo.cards',
      name: '演示卡片',
      version: '1.0.0',
      kind: 'declarative' as const,
      permissions: [] as [],
      contributes: {
        commands: [],
        cards: [{ id: 'c1', title: '项目数', source: 'projects.count' as const }],
      },
    };
    upsertPlugin(db, m, null);
    expect(getPlugin(db, 'demo.cards')?.version).toBe('1.0.0');
    upsertPlugin(db, { ...m, version: '1.1.0' }, null);
    expect(getPlugin(db, 'demo.cards')?.version).toBe('1.1.0');
    expect(removePlugin(db, 'demo.cards')).toBe(true);
    expect(getPlugin(db, 'demo.cards')).toBeNull();
    void pid;
  });
});
