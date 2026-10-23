/** 文件树多选纯函数单测（T-128）——树交互曾是历史 bug 高发区，须可单测。 */
import { describe, expect, it } from 'vitest';
import { visibleKeysInOrder, rangeSelect } from './treeSelect';

const tree = [
  {
    key: 'src',
    children: [
      { key: 'src/a.ts' },
      { key: 'src/b.ts' },
      {
        key: 'src/sub',
        children: [{ key: 'src/sub/c.ts' }],
      },
    ],
  },
  { key: 'README.md' },
];

describe('visibleKeysInOrder', () => {
  it('全部折叠：只出顶层', () => {
    expect(visibleKeysInOrder(tree, [])).toEqual(['src', 'README.md']);
  });

  it('按展开状态 DFS 输出可见顺序（未展开的子层不深入）', () => {
    expect(visibleKeysInOrder(tree, ['src'])).toEqual([
      'src',
      'src/a.ts',
      'src/b.ts',
      'src/sub',
      'README.md',
    ]);
  });

  it('多层展开保持渲染顺序', () => {
    expect(visibleKeysInOrder(tree, ['src', 'src/sub'])).toEqual([
      'src',
      'src/a.ts',
      'src/b.ts',
      'src/sub',
      'src/sub/c.ts',
      'README.md',
    ]);
  });
});

describe('rangeSelect', () => {
  const keys = ['a', 'b', 'c', 'd'];

  it('正向区间含两端', () => {
    expect(rangeSelect(keys, 'a', 'c')).toEqual(['a', 'b', 'c']);
  });

  it('反向点击同样成立', () => {
    expect(rangeSelect(keys, 'd', 'b')).toEqual(['b', 'c', 'd']);
  });

  it('anchor 为 null 退化为仅 target', () => {
    expect(rangeSelect(keys, null, 'c')).toEqual(['c']);
  });

  it('anchor 不在可见列表（被折叠/过滤）退化为仅 target', () => {
    expect(rangeSelect(keys, 'zzz', 'c')).toEqual(['c']);
  });

  it('target 不在可见列表返回空（不误选）', () => {
    expect(rangeSelect(keys, 'a', 'zzz')).toEqual([]);
  });
});
