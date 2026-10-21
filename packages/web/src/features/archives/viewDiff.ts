/** 架构图变更明细（FR-13.9 ③ / T-106c）：上次查看快照 → 现在清单 的增减。 */
import type { ArchiveInfo } from '@ttfolio/shared';

export interface ViewDiff {
  hasSnapshot: boolean;
  viewedAt: string | null;
  added: string[];
  removed: string[];
}

export function computeViewDiff(info: ArchiveInfo): ViewDiff {
  const snap = info.viewSnapshot;
  if (snap === undefined || snap === null) {
    return { hasSnapshot: false, viewedAt: null, added: [], removed: [] };
  }
  const prev = new Set(snap.files);
  const cur = new Set(info.htmlFiles.map((f) => f.rel));
  return {
    hasSnapshot: true,
    viewedAt: snap.viewedAt,
    added: info.htmlFiles.map((f) => f.rel).filter((r) => !prev.has(r)),
    removed: snap.files.filter((r) => !cur.has(r)),
  };
}

/** 展示截断：最多 n 条，超出聚合计数。 */
export function capList(items: string[], n: number): { shown: string[]; rest: number } {
  return { shown: items.slice(0, n), rest: Math.max(0, items.length - n) };
}
