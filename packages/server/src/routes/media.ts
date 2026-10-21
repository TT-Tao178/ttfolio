/** 媒体路由（FR-13.5 / T-099 + T-113 v2）：清单读取、缩略图存在性索引、
 * 两级（g/p）WebP 二进制落盘、全库配额与统计。渲染层/主进程只负责解码缩放，
 * 数据目录单写者始终是服务端。 */
import type { FastifyPluginAsync } from 'fastify';
import type { AppContext } from '../context.js';
import { ok, fail } from './helpers.js';
import { getProjectRow } from '../db/repo/projectsRepo.js';
import { listMedia } from '../db/repo/mediaRepo.js';
import { logActivity } from '../db/repo/metaRepo.js';
import { mediaThumbPostSchema } from '@ttfolio/shared';
import {
  THUMB_QUOTA_BYTES,
  isWebp,
  legacyThumbName,
  listThumbNames,
  thumbName,
  thumbsStats,
  writeThumb,
  enforceQuota,
  type ThumbTier,
} from '../core/thumbs.js';

/** dataURL 白名单：只收 PNG（canvas.toDataURL('image/png')），上限 ~600KB 二进制。 */
const THUMB_DATA_URL = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/;
const THUMB_MAX_LEN = 800_000;
/** 两级二进制上限：g 640px 正常 <100KB；p 1920px 留足余量。 */
const TIER_MAX_BYTES: Record<ThumbTier, number> = { g: 600_000, p: 3_000_000 };
/** 配额检查节流：每 N 次写入触发一次全库统计（单次统计是目录遍历，不宜每写必扫）。 */
let writesSinceQuotaCheck = 0;
const QUOTA_CHECK_EVERY = 25;

export const mediaRoutes: FastifyPluginAsync = async (app) => {
  const ctx = app.ttfolio as AppContext;

  /** 存在性索引：首屏直接命中已生成缩略图，未命中才入队（T-113 核心）。 */
  app.get('/api/media/:projectId/thumb-index', async (req) => {
    const { projectId } = req.params as { projectId: string };
    if (getProjectRow(ctx.db(), projectId) === undefined) return fail('NOT_FOUND', '项目不存在', 404);
    return ok({ names: listThumbNames(ctx.layout.thumbsDir, projectId) });
  });

  /** 全库配额与按项目统计（设置/库体检可用）。 */
  app.get('/api/thumbs/stats', async () => {
    const stats = thumbsStats(ctx.layout.thumbsDir);
    return ok({ ...stats, quotaBytes: THUMB_QUOTA_BYTES });
  });

  /**
   * 两级缩略图二进制上传（T-113）：body 为 image/webp 原始字节。
   * 命名 <sha1(relPath)>@g.webp / @p.webp；校验 webp 魔数与体积；落数据目录。
   */
  app.post('/api/media/:projectId/thumb/:tier', async (req) => {
    const { projectId, tier } = req.params as { projectId: string; tier: string };
    if (tier !== 'g' && tier !== 'p') return fail('BAD_REQUEST', 'tier 只能是 g 或 p');
    const db = ctx.db();
    if (getProjectRow(db, projectId) === undefined) return fail('NOT_FOUND', '项目不存在', 404);
    const relPath = (req.query as { path?: string }).path ?? '';
    if (relPath === '' || relPath.length > 1024) return fail('BAD_REQUEST', '缺少 path 或过长');
    const body = req.body;
    if (!Buffer.isBuffer(body)) return fail('BAD_REQUEST', '需要 image/webp 原始字节体');
    if (body.length === 0 || body.length > TIER_MAX_BYTES[tier]) {
      return fail('BAD_REQUEST', '缩略图体积不合法');
    }
    if (isWebp(body) === false) return fail('BAD_REQUEST', '不是合法的 WebP 数据');
    const name = thumbName(relPath, tier);
    try {
      writeThumb(ctx.layout.thumbsDir, projectId, name, body);
    } catch (err) {
      return fail('IO_ERROR', `缩略图写入失败：${err instanceof Error ? err.message : String(err)}`);
    }
    logActivity(db, {
      kind: 'media.thumb.write',
      level: 'L1',
      projectId,
      detail: { file: name, bytes: body.length },
    });
    writesSinceQuotaCheck += 1;
    if (writesSinceQuotaCheck >= QUOTA_CHECK_EVERY) {
      writesSinceQuotaCheck = 0;
      try {
        enforceQuota(ctx.layout.thumbsDir);
      } catch {
        /* 配额清理失败不影响本次写入（下次再清） */
      }
    }
    return ok({ thumb: name });
  });

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
    const name = legacyThumbName(relPath);
    try {
      writeThumb(
        ctx.layout.thumbsDir,
        projectId,
        name,
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
