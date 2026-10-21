/** 插件注册表（FR-14.1 / T-101）：DB 存取、启用过滤、内置示例注入。 */
import type Database from 'better-sqlite3';
import { getAll, getOne, run } from '../../db/sql.js';
import type { PluginInfo, PluginManifest } from './manifest.js';

interface PluginRow {
  id: string;
  name: string;
  version: string;
  author: string | null;
  kind: string;
  manifest_json: string;
  enabled: number;
  builtin: number;
  installed_at: string;
  dir_path: string | null;
}

function toInfo(r: PluginRow): PluginInfo | null {
  try {
    const m = JSON.parse(r.manifest_json) as PluginManifest;
    return {
      id: r.id,
      name: r.name,
      version: r.version,
      author: r.author,
      kind: r.kind === 'script' ? 'script' : 'declarative',
      enabled: r.enabled === 1,
      builtin: r.builtin === 1,
      installedAt: r.installed_at,
      dirPath: r.dir_path,
      description: m.description ?? null,
      permissions: m.permissions ?? [],
      commands: (m.contributes?.commands ?? []).map((c) => ({
        id: c.id,
        title: c.title,
        category: c.category ?? null,
        action: c.action,
      })),
      cards: m.contributes?.cards ?? [],
    };
  } catch {
    return null;
  }
}

/**
 * 内置示例插件（随包，声明式）：演示「清单 → 命令 → 命令面板」全链路。
 * 诚实标注为示例；可在插件页禁用（状态存库，不改包内定义）。
 */
export const BUILTIN_PLUGINS: PluginManifest[] = [
  {
    id: 'ttfolio.example.stats',
    name: '示例：项目规模速览',
    version: '1.0.0',
    author: 'ttFolio',
    description: '声明式插件示例：贡献一条命令，在命令面板里查看项目规模统计。',
    kind: 'declarative',
    permissions: ['commands.contribute'],
    contributes: {
      commands: [
        {
          id: 'show-scale',
          title: '插件：查看项目规模',
          category: '插件',
          action: { type: 'openTab', tab: 'overview' },
        },
      ],
      cards: [],
    },
  },
];

/** 启动时把随包内置插件登记进库（幂等；不覆盖用户的启用/禁用状态）。 */
export function ensureBuiltinPlugins(db: Database.Database): void {
  for (const m of BUILTIN_PLUGINS) {
    const exists = getOne<{ id: string }>(db, 'SELECT id FROM plugins WHERE id = ?', [m.id]);
    if (exists !== undefined) continue;
    run(
      db,
      `INSERT INTO plugins (id, name, version, author, kind, manifest_json, enabled, builtin, installed_at, dir_path)
       VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?, NULL)`,
      [m.id, m.name, m.version, m.author ?? null, m.kind, JSON.stringify(m), new Date().toISOString()],
    );
  }
}

export function listPlugins(db: Database.Database): PluginInfo[] {
  return getAll<PluginRow>(db, 'SELECT * FROM plugins ORDER BY builtin DESC, name')
    .map(toInfo)
    .filter((x): x is PluginInfo => x !== null);
}

export function getPlugin(db: Database.Database, id: string): PluginInfo | null {
  const r = getOne<PluginRow>(db, 'SELECT * FROM plugins WHERE id = ?', [id]);
  return r === undefined ? null : toInfo(r);
}

export function upsertPlugin(
  db: Database.Database,
  manifest: PluginManifest,
  dirPath: string | null,
): PluginInfo {
  const now = new Date().toISOString();
  run(
    db,
    `INSERT INTO plugins (id, name, version, author, kind, manifest_json, enabled, builtin, installed_at, dir_path)
     VALUES (?, ?, ?, ?, ?, ?, 1, 0, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, version = excluded.version, author = excluded.author,
       kind = excluded.kind, manifest_json = excluded.manifest_json, dir_path = excluded.dir_path`,
    [
      manifest.id,
      manifest.name,
      manifest.version,
      manifest.author ?? null,
      manifest.kind,
      JSON.stringify(manifest),
      now,
      dirPath,
    ],
  );
  const info = getPlugin(db, manifest.id);
  if (info === null) throw new Error('upsert plugin failed');
  return info;
}

export function setPluginEnabled(db: Database.Database, id: string, enabled: boolean): boolean {
  return run(db, 'UPDATE plugins SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, id]).changes > 0;
}

export function removePlugin(db: Database.Database, id: string): boolean {
  // 内置插件只允许禁用，不允许卸载（避免「随包功能被删」的误导）
  return run(db, 'DELETE FROM plugins WHERE id = ? AND builtin = 0', [id]).changes > 0;
}

/** 启用的插件贡献的命令（命令面板并入用）。 */
export function listPluginCommands(
  db: Database.Database,
): Array<{ pluginId: string; pluginName: string; command: PluginInfo['commands'][number] }> {
  const out: Array<{ pluginId: string; pluginName: string; command: PluginInfo['commands'][number] }> = [];
  for (const p of listPlugins(db)) {
    if (!p.enabled) continue;
    for (const c of p.commands) out.push({ pluginId: p.id, pluginName: p.name, command: c });
  }
  return out;
}

/** 声明式卡片统计（只读、白名单来源）。 */
export function cardStat(db: Database.Database, source: string): number {
  if (source === 'projects.count') {
    return getOne<{ c: number }>(db, 'SELECT COUNT(*) AS c FROM projects WHERE deleted_at IS NULL')?.c ?? 0;
  }
  if (source === 'projects.archived') {
    return (
      getOne<{ c: number }>(
        db,
        "SELECT COUNT(*) AS c FROM projects WHERE deleted_at IS NULL AND status = 'archived'",
      )?.c ?? 0
    );
  }
  if (source === 'analysis.failed') {
    return (
      getOne<{ c: number }>(
        db,
        'SELECT COUNT(*) AS c FROM projects WHERE deleted_at IS NULL AND analyze_error IS NOT NULL',
      )?.c ?? 0
    );
  }
  return 0;
}
