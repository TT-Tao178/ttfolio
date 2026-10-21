/** 媒体网格与缩略图辅助（FR-13.5 / T-099）：纯函数 + 哈希，供 MediaTab/Lightbox 复用。 */
import type { MediaItem, MediaKind } from '@ttfolio/shared';

/** 缩略图文件名：sha1(相对路径) hex + .png——与服务端落盘命名一致。 */
export async function thumbNameOf(relPath: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(relPath));
  let hex = '';
  for (const b of new Uint8Array(buf)) hex += b.toString(16).padStart(2, '0');
  return `${hex}.png`;
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
