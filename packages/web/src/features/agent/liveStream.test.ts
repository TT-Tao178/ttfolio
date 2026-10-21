/** 回归锚点：动态页签文件流 reducer（FR-13.2）——相对路径归一、窗口封顶、kind 归一。 */
import { describe, expect, it } from 'vitest';
import { applyFsChanged, changedRelPaths, LIVE_STREAM_CAP, toRelPath, type LiveEntry } from './liveStream';

describe('toRelPath（绝对路径 → 项目内相对路径）', () => {
  it('Windows 反斜杠与混合分隔符归一为正斜杠', () => {
    expect(toRelPath('D:\\demo\\proj\\src\\a.ts', 'D:\\demo\\proj')).toBe('src/a.ts');
  });

  it('正斜杠路径正常切片，尾随斜杠的根不产生空段', () => {
    expect(toRelPath('/tmp/p/src/a.ts', '/tmp/p/')).toBe('src/a.ts');
  });

  it('不在项目内时回退 basename（诚实降级，不虚构归属）', () => {
    expect(toRelPath('E:\\elsewhere\\b.ts', 'D:\\demo\\proj')).toBe('b.ts');
  });
});

describe('applyFsChanged（事件 → 流窗口）', () => {
  const root = 'D:\\demo\\proj';
  let id = 0;
  const nextId = (): number => ++id;

  it('paths 逐条插入流头部，kind 归一（未知动作按 update）', () => {
    const out = applyFsChanged(
      [],
      { kind: 'create', paths: ['D:\\demo\\proj\\a.ts', 'D:\\demo\\proj\\b.ts'] },
      root,
      100,
      nextId,
    );
    expect(out.map((e) => e.relPath)).toEqual(['b.ts', 'a.ts']);
    expect(out.every((e) => e.kind === 'create')).toBe(true);
    const out2 = applyFsChanged(out, { kind: 'change', paths: ['D:\\demo\\proj\\a.ts'] }, root, 200, nextId);
    expect(out2[0]).toMatchObject({ kind: 'update', relPath: 'a.ts', at: 200 });
  });

  it('无 paths 的事件原样返回（不产生空条目）', () => {
    const prev: LiveEntry[] = [{ id: 1, kind: 'update', relPath: 'a.ts', at: 1 }];
    expect(applyFsChanged(prev, { kind: 'update', paths: [] }, root, 2, nextId)).toBe(prev);
    expect(applyFsChanged(prev, {}, root, 2, nextId)).toBe(prev);
  });

  it(`窗口封顶 ${LIVE_STREAM_CAP} 条，旧条目被挤出`, () => {
    let prev: LiveEntry[] = [];
    for (let i = 0; i < LIVE_STREAM_CAP + 30; i++) {
      prev = applyFsChanged(prev, { kind: 'update', paths: [`D:\\demo\\proj\\f${i}.ts`] }, root, i, nextId);
    }
    expect(prev).toHaveLength(LIVE_STREAM_CAP);
    expect(prev[0]?.relPath).toBe(`f${LIVE_STREAM_CAP + 29}.ts`);
    expect(prev.at(-1)?.relPath).toBe('f30.ts');
  });
});

describe('changedRelPaths（防抖刷新判断）', () => {
  it('返回事件涉及的相对路径集合', () => {
    const s = changedRelPaths(
      { paths: ['D:\\demo\\proj\\a.ts', 'D:\\demo\\proj\\dir\\b.ts'] },
      'D:\\demo\\proj',
    );
    expect(s.has('a.ts')).toBe(true);
    expect(s.has('dir/b.ts')).toBe(true);
    expect(s.size).toBe(2);
  });
});
