/** 扫描登记路由（FR-16.1 / T-132，2026-11-07 用户点名 A 组）：
 *  POST /api/scan/preview —— 只读扫描根目录出候选（过滤已登记/已忽略，护栏见 scanner）
 *  GET  /api/scan/ignore   —— 忽略名单
 *  PUT  /api/scan/ignore   —— 全量替换忽略名单（≤500 条）
 *  登记本身走既有 POST /api/projects（显式动作，绝不自动登记）。 */
import { promises as fs } from 'node:fs';
import type { FastifyPluginAsync } from 'fastify';
import type { AppContext } from '../context.js';
import { fail, ok } from './helpers.js';
import { getSetting, setSetting, logActivity } from '../db/repo/metaRepo.js';
import { scanDirectory } from '../core/scanner.js';
import { scanIgnoreSchema, scanPreviewSchema, SETTING_KEYS } from '@ttfolio/shared';

function readIgnorePaths(db: ReturnType<AppContext['db']>): string[] {
  const raw = getSetting(db, SETTING_KEYS.scanIgnoreJson);
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export const scanRoutes: FastifyPluginAsync = async (app) => {
  const ctx = app.ttfolio as AppContext;

  app.post('/api/scan/preview', async (req) => {
    const parsed = scanPreviewSchema.safeParse(req.body);
    if (!parsed.success) return fail('BAD_REQUEST', '参数不合法');
    const root = parsed.data.root.trim();
    let st;
    try {
      st = await fs.stat(root);
    } catch {
      return fail('NOT_FOUND', `目录不存在：${root}`, 404);
    }
    if (!st.isDirectory()) return fail('BAD_REQUEST', '不是目录');
    const db = ctx.db();
    const ignore = new Set(readIgnorePaths(db));
    // 已登记判定：与 projects.dir_path 大小写不敏感 + 去尾斜杠比较（Windows 口径）
    const registered = new Set(
      db
        .prepare<[], { dir_path: string }>('SELECT dir_path FROM projects WHERE deleted_at IS NULL')
        .all()
        .map((r) => r.dir_path.replace(/[\\/]+$/, '').toLowerCase()),
    );
    const result = await scanDirectory(root, {
      ignore,
      isRegistered: (abs) => registered.has(abs.replace(/[\\/]+$/, '').toLowerCase()),
    });
    return ok(result);
  });

  app.get('/api/scan/ignore', async () => {
    return ok({ paths: readIgnorePaths(ctx.db()) });
  });

  app.put('/api/scan/ignore', async (req) => {
    const parsed = scanIgnoreSchema.safeParse(req.body);
    if (!parsed.success) return fail('BAD_REQUEST', '参数不合法');
    setSetting(ctx.db(), SETTING_KEYS.scanIgnoreJson, JSON.stringify(parsed.data.paths));
    logActivity(ctx.db(), {
      kind: 'settings.change',
      level: 'L1',
      detail: { key: SETTING_KEYS.scanIgnoreJson, action: 'update', count: parsed.data.paths.length },
    });
    return ok({ saved: true, paths: parsed.data.paths });
  });
};
