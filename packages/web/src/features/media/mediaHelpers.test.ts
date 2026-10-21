/** 回归锚点：媒体网格纯函数（FR-13.5 / T-099）——分组排序、密度列数、缩略图命名。 */
import { describe, expect, it } from 'vitest';
import { columnsFor, groupByFolder, missingItems, thumbNameOf, type MediaGroup } from './mediaHelpers';
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

describe('thumbNameOf（两级命名，与服务端 sha1 一致）', () => {
  it('稳定、tier 可区分、同为 40 位 hex', async () => {
    const g = await thumbNameOf('assets/a.jpg', 'g');
    const p = await thumbNameOf('assets/a.jpg', 'p');
    expect(g).toBe(await thumbNameOf('assets/a.jpg'));
    expect(g).toMatch(/^[0-9a-f]{40}@g\.webp$/);
    expect(p).toMatch(/^[0-9a-f]{40}@p\.webp$/);
    expect(g).not.toBe(p);
    expect(await thumbNameOf('assets/b.jpg')).not.toBe(g);
  });
});

describe('missingItems（T-113 缺口计划）', () => {
  const names = new Map([
    ['a.png', { g: 'a@g.webp', p: 'a@p.webp' }],
    ['b.mp4', { g: 'b@g.webp', p: 'b@p.webp' }],
    ['c.mp3', { g: 'c@g.webp', p: 'c@p.webp' }],
  ]);

  it('音频不计；已有 g 档跳过；cap 截断', () => {
    const items = [item('a.png'), item('b.mp4', 'video'), item('c.mp3', 'audio')];
    expect(missingItems(items, new Set(['a@g.webp']), names, 'g').map((i) => i.path)).toEqual(['b.mp4']);
    expect(missingItems(items, new Set(), names, 'g', 1).map((i) => i.path)).toEqual(['a.png']);
    expect(missingItems(items, new Set(['a@g.webp', 'b@g.webp']), names, 'g')).toEqual([]);
  });

  it('p 档独立判断（有 g 不等于有 p）', () => {
    const items = [item('a.png')];
    expect(missingItems(items, new Set(['a@g.webp']), names, 'p').map((i) => i.path)).toEqual(['a.png']);
  });
});
