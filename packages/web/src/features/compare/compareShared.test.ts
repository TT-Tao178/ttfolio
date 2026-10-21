/** compareShared 纯函数锚点（FR-13.9 / T-106b）：规格编解码 + 行对齐。 */
import { describe, expect, it } from 'vitest';
import { alignLines, decodeCompareSpec, encodeCompareSpec, type CompareSpec } from './compareShared';

describe('decodeCompareSpec（会话恢复的坏值兜底）', () => {
  it('合法规格往返一致', () => {
    const spec: CompareSpec = {
      left: { projectId: 'p1', path: 'a.md' },
      right: { trashId: 't1', name: 'a.md' },
    };
    expect(decodeCompareSpec(encodeCompareSpec(spec))).toEqual(spec);
  });

  it('坏 JSON / 结构不符 / 空串一律 null', () => {
    expect(decodeCompareSpec(null)).toBeNull();
    expect(decodeCompareSpec('')).toBeNull();
    expect(decodeCompareSpec('{bad')).toBeNull();
    expect(decodeCompareSpec('"str"')).toBeNull();
    expect(decodeCompareSpec(JSON.stringify({ left: { projectId: 1 }, right: {} }))).toBeNull();
  });
});

describe('alignLines（FR-13.9 并排对比）', () => {
  it('相同文本全 same', () => {
    const r = alignLines(['a', 'b'], ['a', 'b']);
    expect(r.aligned).toBe(true);
    expect(r.rows.every((x) => x.same)).toBe(true);
  });

  it('中段修改对齐：前后缀保持、单行替换成对出现', () => {
    const r = alignLines(['h', 'old', 't'], ['h', 'new', 't']);
    expect(r.aligned).toBe(true);
    const mid = r.rows.slice(1, -1);
    expect(mid).toEqual([{ left: 'old', right: 'new', same: false }]);
  });

  it('单侧插入/删除：出现单侧空档行', () => {
    const r = alignLines(['a', 'b', 'c'], ['a', 'x', 'b', 'c']);
    const added = r.rows.filter((x) => x.left === null && x.right !== null);
    expect(added.map((x) => x.right)).toEqual(['x']);
    const r2 = alignLines(['a', 'b', 'c'], ['a', 'c']);
    const removed = r2.rows.filter((x) => x.left !== null && x.right === null);
    expect(removed.map((x) => x.left)).toEqual(['b']);
  });

  it('空文本对多行文本：全部落到右侧', () => {
    const r = alignLines([], ['x', 'y']);
    expect(r.rows).toEqual([
      { left: null, right: 'x', same: false },
      { left: null, right: 'y', same: false },
    ]);
  });

  it('中段超限降级：aligned=false 且按行数平行排列', () => {
    const big = Array.from({ length: 2000 }, (_, i) => `l${i}`);
    const big2 = Array.from({ length: 1500 }, (_, i) => `r${i}`);
    const r = alignLines(big, big2);
    expect(r.aligned).toBe(false);
    expect(r.rows).toHaveLength(2000);
    expect(r.rows[0]).toEqual({ left: 'l0', right: 'r0', same: false });
  });
});
