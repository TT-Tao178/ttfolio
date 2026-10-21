/** 媒体网格与缩略图辅助（FR-13.5 / T-099）：纯函数 + 哈希，供 MediaTab/Lightbox 复用。 */
import type { MediaItem, MediaKind } from '@ttfolio/shared';

/** 缩略图文件名（T-113 两级）：<sha1(相对路径)>@g.webp / @p.webp——与服务端命名一致。 */
export async function thumbNameOf(relPath: string, tier: 'g' | 'p' = 'g'): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(relPath));
  let hex = '';
  for (const b of new Uint8Array(buf)) hex += b.toString(16).padStart(2, '0');
  return `${hex}@${tier}.webp`;
}

export interface MediaGroup {
  /** 目录（项目内相对路径，根为 ''，排最前） */
  dir: string;
  items: MediaItem[];
}

/** 按目录分组：根目录组排最前，其余按目录名字典序；组内保持服务端顺序（按 path）。 */
export function groupByFolder(items: MediaItem[]): MediaGroup[] {
  const map = new Map<string, MediaItem[]>();
  for (const it of items) {
    const slash = it.path.lastIndexOf('/');
    const dir = slash < 0 ? '' : it.path.slice(0, slash);
    const arr = map.get(dir) ?? [];
    arr.push(it);
    map.set(dir, arr);
  }
  return [...map.entries()]
    .map(([dir, groupItems]) => ({ dir, items: groupItems }))
    .sort((a, b) => {
      if (a.dir === '') return -1;
      if (b.dir === '') return 1;
      return a.dir.localeCompare(b.dir);
    });
}

export const KIND_LABEL: Record<MediaKind, string> = { image: '图片', video: '视频', audio: '音频' };

/** 网格密度：单元边长 px（卡片正方形，object-fit cover）。 */
export const DENSITY_PX = { compact: 112, cozy: 168, large: 240 } as const;
export type DensityKey = keyof typeof DENSITY_PX;

/** 一行能放几张（容器宽 + 间隙 8）。 */
export function columnsFor(width: number, cellPx: number): number {
  if (width <= 0) return 1;
  return Math.max(1, Math.floor((width + 8) / (cellPx + 8)));
}

/** 计划缺哪些档（T-113 纯函数）：音频除外；cap 限单次补建数量。 */
export function missingItems(
  items: MediaItem[],
  have: Set<string>,
  names: Map<string, { g: string; p: string }>,
  tier: 'g' | 'p',
  cap = Number.POSITIVE_INFINITY,
): MediaItem[] {
  const out: MediaItem[] = [];
  for (const it of items) {
    if (it.kind === 'audio') continue;
    const n = names.get(it.path);
    if (n === undefined) continue;
    if (have.has(n[tier])) continue;
    out.push(it);
    if (out.length >= cap) break;
  }
  return out;
}

// ---------------- 媒体视图偏好（FR-13.5 v3，参考图工具条） ----------------

export type MediaLayout = 'grid' | 'two' | 'one';
export type MediaFit = 'cover' | 'contain';

export interface MediaViewPrefs {
  /** 网格档缩略图边长（px，拖动实时生效） */
  size: number;
  layout: MediaLayout;
  /** cover=统一裁剪成方形；contain=保留原比例（letterbox） */
  fit: MediaFit;
}

export const MEDIA_VIEW_KEY = 'ttfolio-media-view';
export const MEDIA_SIZE_MIN = 96;
export const MEDIA_SIZE_MAX = 320;

export const DEFAULT_MEDIA_VIEW: MediaViewPrefs = { size: 168, layout: 'grid', fit: 'cover' };

/** 解析持久化偏好（容错：坏值回落默认；size 钳到 96–320）。 */
export function parseMediaView(raw: string | null): MediaViewPrefs {
  if (raw === null || raw === '') return DEFAULT_MEDIA_VIEW;
  try {
    const v = JSON.parse(raw) as Partial<MediaViewPrefs>;
    const size = Number(v.size);
    const layout: MediaLayout =
      v.layout === 'two' || v.layout === 'one' || v.layout === 'grid' ? v.layout : 'grid';
    const fit: MediaFit = v.fit === 'contain' ? 'contain' : 'cover';
    return {
      size: Number.isFinite(size)
        ? Math.min(MEDIA_SIZE_MAX, Math.max(MEDIA_SIZE_MIN, Math.round(size)))
        : DEFAULT_MEDIA_VIEW.size,
      layout,
      fit,
    };
  } catch {
    return DEFAULT_MEDIA_VIEW;
  }
}

export interface MediaGeometry {
  columns: number;
  cellW: number;
  cellH: number;
}

/**
 * 布局几何：
 * - grid：按滑条边长多列排布（方形单元）；
 * - two：固定两列，单元填满列宽，4:3 横向；
 * - one：单列大图，单元填满宽度，最高 480px。
 */
export function layoutGeometry(layout: MediaLayout, containerWidth: number, size: number): MediaGeometry {
  const width = Math.max(0, containerWidth);
  if (layout === 'one') {
    const cellW = Math.max(120, width);
    return { columns: 1, cellW, cellH: Math.min(480, Math.round(cellW * 0.56)) };
  }
  if (layout === 'two') {
    const cellW = Math.max(120, Math.floor((width - 8) / 2));
    return { columns: 2, cellW, cellH: Math.round(cellW * 0.75) };
  }
  const clamped = Math.min(MEDIA_SIZE_MAX, Math.max(MEDIA_SIZE_MIN, Math.round(size)));
  return { columns: columnsFor(width, clamped), cellW: clamped, cellH: clamped };
}
