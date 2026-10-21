/** 回归锚点：媒体网格纯函数（FR-13.5 / T-099）——分组排序、密度列数、缩略图命名。 */
import { describe, expect, it } from 'vitest';
import { columnsFor, groupByFolder, thumbNameOf, type MediaGroup } from './mediaHelpers';
import type { MediaItem } from '@ttfolio/shared';

function item(path: string, kind: 'image' | 'video' | 'audio' = 'image'): MediaItem {
  return { path, kind, bytes: 10, mtime: null, w: null, h: null, durationMs: null };
}

describe('groupByFolder（按目录分组）', () => {
  it('根目录组排最前，其余按目录名字典序', () => {
    const groups: MediaGroup[] = groupByFolder([
      item('assets/b.mp4', 'video'),
      item('top.png'),
      item('assets/a.jpg'),
      item('docs/img/1.gif'),
    ]);
    expect(groups.map((g) => g.dir)).toEqual(['', 'assets', 'docs/img']);
    // 组内保持输入顺序（服务端已按 path 排好，前端不重排）
    expect(groups[1]?.items.map((i) => i.path)).toEqual(['assets/b.mp4', 'assets/a.jpg']);
    expect(groups[0]?.items).toHaveLength(1);
  });

  it('空输入返回空数组', () => {
    expect(groupByFolder([])).toEqual([]);
  });
});

describe('columnsFor（响应式列数）', () => {
  it('按单元边长 + 8px 间隙计算，最小 1 列', () => {
    expect(columnsFor(0, 112)).toBe(1);
    expect(columnsFor(120, 112)).toBe(1);
    // 112*2 + 8 间隙 + 8 = 240 → 240 宽放两列
    expect(columnsFor(240, 112)).toBe(2);
    expect(columnsFor(1000, 240)).toBe(4);
  });
});

describe('thumbNameOf（缩略图命名，与服务端 sha1 一致）', () => {
  it('稳定且为 40 位 hex.png', async () => {
    const a = await thumbNameOf('assets/a.jpg');
    const b = await thumbNameOf('assets/a.jpg');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{40}\.png$/);
    expect(await thumbNameOf('assets/b.jpg')).not.toBe(a);
  });
});
