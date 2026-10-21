/** 缩略图管线 v2（FR-13.5 / T-113）：两级尺寸命名、存在性索引、配额与清理。
 * 所有缩略图只写数据目录 thumbs/<projectId>/，绝不写项目目录（红线）。
 * 命名：<sha1(项目内相对路径)>@g.webp（640px 网格）/ @p.webp（1920px 灯箱预览）。 */
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, statSync, unlinkSync, writeFileSync, renameSync, existsSync } from 'node:fs';

export type ThumbTier = 'g' | 'p';

/** 目标最长边（px）：g 兼顾 2x DPR 与网格密度；p 作灯箱先出预览。 */
export const TIER_PX: Record<ThumbTier, number> = { g: 640, p: 1920 };

/** 全库配额（字节）：超出按 mtime LRU 淘汰。 */
export const THUMB_QUOTA_BYTES = 2 * 1024 * 1024 * 1024;

/** 文件名白名单：新两级命名 + 旧版单级 png（兼容存量，读取端仍认）。 */
export const THUMB_NAME_RE = /^(?:[0-9a-f]{40}(?:@[gp]\.webp|\.png))$/;

export function thumbName(relPath: string, tier: ThumbTier): string {
  return `${createHash('sha1').update(relPath).digest('hex')}@${tier}.webp`;
}

export function legacyThumbName(relPath: string): string {
  return `${createHash('sha1').update(relPath).digest('hex')}.png`;
}

export function projectThumbDir(thumbsDir: string, projectId: string): string {
  return path.join(thumbsDir, projectId);
}

/** 已生成的缩略图文件名清单（不存在目录时为空）。索引读取失败按空处理（诚实降级：重新生成）。 */
export function listThumbNames(thumbsDir: string, projectId: string): string[] {
  const dir = projectThumbDir(thumbsDir, projectId);
  try {
    return readdirSync(dir).filter((n) => THUMB_NAME_RE.test(n));
  } catch {
    return [];
  }
}

/** 原子落盘（临时名 + rename）：避免读到半文件。 */
export function writeThumb(thumbsDir: string, projectId: string, name: string, buf: Buffer): void {
  if (THUMB_NAME_RE.test(name) === false) throw new Error('非法缩略图文件名');
  const dir = projectThumbDir(thumbsDir, projectId);
  mkdirSync(dir, { recursive: true });
  const full = path.join(dir, name);
  const tmp = `${full}.tmp-${process.pid}`;
  writeFileSync(tmp, buf);
  renameSync(tmp, full);
}

/** webp 魔数：RIFF....WEBP（渲染层 canvas.toBlob('image/webp') 的产物）。 */
export function isWebp(buf: Buffer): boolean {
  return buf.length > 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP';
}

/** 项目移除登记/删除时的级联清理（派生数据，可随时重建）。 */
export function clearProjectThumbs(thumbsDir: string, projectId: string): number {
  const dir = projectThumbDir(thumbsDir, projectId);
  if (!existsSync(dir)) return 0;
  let removed = 0;
  try {
    for (const n of readdirSync(dir)) {
      if (THUMB_NAME_RE.test(n) === false) continue;
      try {
        unlinkSync(path.join(dir, n));
        removed++;
      } catch {
        /* 单个文件被占用不阻断其余清理 */
      }
    }
  } catch {
    /* 目录读不到时按已清理处理 */
  }
  return removed;
}

export interface ThumbStat {
  projectId: string;
  count: number;
  bytes: number;
}

export function thumbsStats(thumbsDir: string): {
  totalBytes: number;
  totalCount: number;
  projects: ThumbStat[];
} {
  const projects: ThumbStat[] = [];
  let totalBytes = 0;
  let totalCount = 0;
  let entries: string[] = [];
  try {
    entries = readdirSync(thumbsDir);
  } catch {
    return { totalBytes: 0, totalCount: 0, projects: [] };
  }
  for (const pid of entries) {
    const dir = path.join(thumbsDir, pid);
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    let bytes = 0;
    let count = 0;
    for (const n of names) {
      if (THUMB_NAME_RE.test(n) === false) continue;
      try {
        const st = statSync(path.join(dir, n));
        bytes += st.size;
        count++;
      } catch {
        /* 采样期被清理的文件跳过 */
      }
    }
    if (count > 0) projects.push({ projectId: pid, count, bytes });
    totalBytes += bytes;
    totalCount += count;
  }
  return { totalBytes, totalCount, projects };
}

/**
 * 配额执行：超过配额时按「最后修改时间最旧优先」删除，直到降到配额内。
 * 不变量：只删缩略图文件（白名单命名），不触碰项目目录。
 */
export function enforceQuota(
  thumbsDir: string,
  maxBytes: number = THUMB_QUOTA_BYTES,
): { removed: number; freed: number } {
  const { totalBytes } = thumbsStats(thumbsDir);
  if (totalBytes <= maxBytes) return { removed: 0, freed: 0 };
  const files: Array<{ full: string; size: number; mtime: number }> = [];
  let entries: string[] = [];
  try {
    entries = readdirSync(thumbsDir);
  } catch {
    return { removed: 0, freed: 0 };
  }
  for (const pid of entries) {
    const dir = path.join(thumbsDir, pid);
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const n of names) {
      if (THUMB_NAME_RE.test(n) === false) continue;
      const full = path.join(dir, n);
      try {
        const st = statSync(full);
        files.push({ full, size: st.size, mtime: st.mtimeMs });
      } catch {
        /* 跳过 */
      }
    }
  }
  files.sort((a, b) => a.mtime - b.mtime);
  let removed = 0;
  let freed = 0;
  for (const f of files) {
    if (totalBytes - freed <= maxBytes) break;
    try {
      unlinkSync(f.full);
      removed++;
      freed += f.size;
    } catch {
      /* 占用中的文件留待下次 */
    }
  }
  return { removed, freed };
}
