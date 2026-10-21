/** 媒体路由（FR-13.5 / T-099）：清单读取 + 缩略图落盘（渲染层 canvas 生成）。 */
import type { FastifyPluginAsync } from 'fastify';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import type { AppContext } from '../context.js';
import { ok, fail } from './helpers.js';
import { getProjectRow } from '../db/repo/projectsRepo.js';
import { listMedia } from '../db/repo/mediaRepo.js';
import { logActivity } from '../db/repo/metaRepo.js';
import { mediaThumbPostSchema } from '@ttfolio/shared';

/** dataURL 白名单：只收 PNG（canvas.toDataURL('image/png')），上限 ~600KB 二进制。 */
const THUMB_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;
const THUMB_MAX_LEN = 800_000;

export const mediaRoutes: FastifyPluginAsync = async (app) => {
  const ctx = app.ttfolio as AppContext;

  app.get('/api/projects/:id/media', async (req) => {
    const { id } = req.params as { id: string };
    if (getProjectRow(ctx.db(), id) === undefined) return fail('NOT_FOUND', '项目不存在', 404);
    return ok(listMedia(ctx.db(), id));
  });

  /**
   * 缩略图落盘：媒体名只进哈希（sha1(relPath).png），不落文件系统路径——
   * 天然无穿越；数据目录单写者（M-1）由服务端保持。绝不写项目目录。
   */
  app.post('/api/media/:projectId/thumb', async (req) => {
    const { projectId } = req.params as { projectId: string };
    const parsed = mediaThumbPostSchema.safeParse(req.body ?? {});
    if (!parsed.success) return fail('BAD_REQUEST', '参数不合法');
    const db = ctx.db();
    if (getProjectRow(db, projectId) === undefined) return fail('NOT_FOUND', '项目不存在', 404);
    const { path: relPath, dataUrl } = parsed.data;
    if (dataUrl.length > THUMB_MAX_LEN || THUMB_DATA_URL.test(dataUrl) === false) {
      return fail('BAD_REQUEST', '缩略图 dataURL 不合法或超限');
    }
    const name = `${createHash('sha1').update(relPath).digest('hex')}.png`;
    const dir = path.join(ctx.layout.thumbsDir, projectId);
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        path.join(dir, name),
        Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64'),
      );
    } catch (err) {
      return fail('IO_ERROR', `缩略图写入失败：${err instanceof Error ? err.message : String(err)}`);
    }
    logActivity(db, { kind: 'media.thumb.write', level: 'L1', projectId, detail: { file: name } });
    // 只返回文件名：前端 thumbUrl(projectId, name) 负责拼 /thumbs/:projectId/:name
    return ok({ thumb: name });
  });
};
