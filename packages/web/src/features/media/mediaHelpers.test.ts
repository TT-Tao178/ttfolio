/** 回归锚点：媒体网格纯函数（FR-13.5 / T-099）——分组排序、密度列数、缩略图命名。 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MEDIA_VIEW,
  MEDIA_SIZE_MAX,
  MEDIA_SIZE_MIN,
  columnsFor,
  groupByFolder,
  layoutGeometry,
  missingItems,
  parseMediaView,
  thumbNameOf,
  type MediaGroup,
} from './mediaHelpers';
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

describe('媒体视图偏好（FR-13.5 v3）', () => {
  it('parseMediaView：坏值回落默认；size 钳到 96–320；枚举校验', () => {
    expect(parseMediaView(null)).toEqual(DEFAULT_MEDIA_VIEW);
    expect(parseMediaView('not-json')).toEqual(DEFAULT_MEDIA_VIEW);
    expect(parseMediaView(JSON.stringify({ size: 5, layout: 'x', fit: 'x' }))).toEqual({
      size: MEDIA_SIZE_MIN,
      layout: 'grid',
      fit: 'cover',
    });
    expect(parseMediaView(JSON.stringify({ size: 9999 }))).toMatchObject({ size: MEDIA_SIZE_MAX });
    expect(parseMediaView(JSON.stringify({ size: 200, layout: 'two', fit: 'contain' }))).toEqual({
      size: 200,
      layout: 'two',
      fit: 'contain',
    });
  });

  it('layoutGeometry：网格按尺寸多列；双列固定两列；单列满宽且高度封顶', () => {
    const grid = layoutGeometry('grid', 1000, 168);
    expect(grid.columns).toBe(columnsFor(1000, 168));
    expect(grid.cellW).toBe(168);
    expect(grid.cellH).toBe(168);

    const two = layoutGeometry('two', 1000, 168);
    expect(two.columns).toBe(2);
    expect(two.cellW).toBe(Math.floor((1000 - 8) / 2));
    expect(two.cellH).toBe(Math.round(two.cellW * 0.75));

    const one = layoutGeometry('one', 1000, 168);
    expect(one.columns).toBe(1);
    expect(one.cellW).toBe(1000);
    expect(one.cellH).toBe(480); // 1000*0.56=560 → 封顶 480
  });
});
