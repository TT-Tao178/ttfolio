/** 个人主页（FR-13.7 / T-103）：本地单人身份卡。
 * 用户名与头像文件名存 settings 两键；头像文件写数据目录 avatar.png
 * （绝不写项目目录）；保存用户名即同步审计 actor 默认值。 */
import type { FastifyPluginAsync } from 'fastify';
import path from 'node:path';
import { writeFileSync, rmSync, existsSync } from 'node:fs';
import type { AppContext } from '../context.js';
import { ok, fail } from './helpers.js';
import { getSetting, setSetting, logActivity } from '../db/repo/metaRepo.js';
import { getAll } from '../db/sql.js';
import { setDefaultActorName } from '../core/actor.js';
import { profilePatchSchema, profileAvatarSchema } from '@ttfolio/shared';
import type { ProfileInfo } from '@ttfolio/shared';

/** 头像 dataURL 白名单：渲染层 canvas 固定输出 PNG；上限 ~1MB。 */
const AVATAR_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;
const AVATAR_MAX_LEN = 1_400_000;
export const AVATAR_FILE = 'avatar.png';

/** 使用天数：自最早一条审计记录起算（没有记录时按第 1 天）。 */
export function usedDays(db: import('better-sqlite3').Database, now: number = Date.now()): number {
  const row = getAll<{ first: string | null }>(db, 'SELECT MIN(at) AS first FROM activity_log')[0];
  const first = row?.first ?? null;
  if (first === null) return 1;
  const t = Date.parse(first);
  if (!Number.isFinite(t)) return 1;
  return Math.max(1, Math.floor((now - t) / 86_400_000) + 1);
}

export const profileRoutes: FastifyPluginAsync = async (app) => {
  const ctx = app.ttfolio as AppContext;

  app.get('/api/profile', async () => {
    const db = ctx.db();
    const name = getSetting(db, 'profile_name');
    const avatarPath = getSetting(db, 'profile_avatar_path');
    const projectRow = getAll<{ c: number }>(
      db,
      'SELECT COUNT(*) AS c FROM projects WHERE deleted_at IS NULL',
    )[0];
    const info: ProfileInfo = {
      name: name !== null && name.trim() !== '' ? name : null,
      hasAvatar: avatarPath !== null && existsSync(path.join(ctx.layout.dataDir, AVATAR_FILE)),
      projectCount: projectRow?.c ?? 0,
      usedDays: usedDays(db),
      version: ctx.version,
    };
    return ok(info);
  });

  app.patch('/api/profile', async (req) => {
    const parsed = profilePatchSchema.safeParse(req.body ?? {});
    if (!parsed.success) return fail('BAD_REQUEST', '用户名不合法（最多 30 字）');
    const db = ctx.db();
    const raw = parsed.data.name ?? null;
    const name = raw === null || raw.trim() === '' ? '' : raw.trim();
    setSetting(db, 'profile_name', name);
    // 审计 actor 默认值同步（本人后续操作用该名落审计）
    setDefaultActorName(name);
    logActivity(db, { kind: 'profile.update', level: 'L1', detail: { hasName: name !== '' } });
    return ok({ name: name === '' ? null : name });
  });

  app.post('/api/profile/avatar', async (req) => {
    const parsed = profileAvatarSchema.safeParse(req.body ?? {});
    if (!parsed.success) return fail('BAD_REQUEST', '参数不合法');
    const { dataUrl } = parsed.data;
    if (dataUrl.length > AVATAR_MAX_LEN || AVATAR_DATA_URL.test(dataUrl) === false) {
      return fail('BAD_REQUEST', '头像必须是 PNG dataURL 且不超过约 1MB');
    }
    const db = ctx.db();
    const target = path.join(ctx.layout.dataDir, AVATAR_FILE);
    try {
      writeFileSync(target, Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64'));
    } catch (err) {
      return fail('IO_ERROR', `头像写入失败：${err instanceof Error ? err.message : String(err)}`);
    }
    setSetting(db, 'profile_avatar_path', AVATAR_FILE);
    logActivity(db, { kind: 'profile.avatar.write', level: 'L1' });
    return ok({ hasAvatar: true });
  });

  app.delete('/api/profile/avatar', async () => {
    const db = ctx.db();
    try {
      rmSync(path.join(ctx.layout.dataDir, AVATAR_FILE), { force: true });
    } catch {
      /* 文件不存在或占用不阻断清除登记 */
    }
    setSetting(db, 'profile_avatar_path', '');
    logActivity(db, { kind: 'profile.avatar.clear', level: 'L1' });
    return ok({ hasAvatar: false });
  });
};
