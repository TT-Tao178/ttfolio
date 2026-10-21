/** 动态页流水前端纯函数锚点（FR-13.2 v2 / T-111）。 */
import { describe, expect, it } from 'vitest';
import { mergeEvents, type ChangeEventInfo } from './liveStore';
import { groupBursts } from './AgentLiveTab';

function ev(seq: number, overrides: Partial<ChangeEventInfo> = {}): ChangeEventInfo {
  return {
    seq,
    projectId: 'p1',
    sessionId: null,
    burstId: 'b1',
    path: 'a.ts',
    kind: 'update',
    firstAt: '2026-10-22T00:00:00.000Z',
    lastAt: '2026-10-22T00:00:00.000Z',
    changeCount: 1,
    bytes: 10,
    source: 'watcher',
    ...overrides,
  };
}

describe('mergeEvents（FR-13.2 v2：按 seq 去重合并）', () => {
  it('空输入返回原引用（不触发重渲染）', () => {
    const prev = [ev(1)];
    expect(mergeEvents(prev, [])).toBe(prev);
  });

  it('同 seq 以新事件替换（合并计数/时间更新）', () => {
    const prev = [ev(1)];
    const next = mergeEvents(prev, [ev(1, { changeCount: 3, lastAt: '2026-10-22T00:00:05.000Z' })]);
    expect(next).toHaveLength(1);
    expect(next[0]?.changeCount).toBe(3);
  });

  it('新 seq 追加并保持升序', () => {
    const next = mergeEvents([ev(1), ev(3)], [ev(2)]);
    expect(next.map((e) => e.seq)).toEqual([1, 2, 3]);
  });

  it('完全重复的投递返回原引用', () => {
    const prev = [ev(1)];
    expect(mergeEvents(prev, [ev(1)])).toBe(prev);
  });
});

describe('groupBursts（FR-13.2 v2：按 burst 分组）', () => {
  it('连续同 burstId 归一组，切换后另起一组', () => {
    const g = groupBursts([ev(1, { burstId: 'a' }), ev(2, { burstId: 'a' }), ev(3, { burstId: 'b' })]);
    expect(g).toHaveLength(2);
    expect(g[0]?.items.map((e) => e.seq)).toEqual([1, 2]);
    expect(g[1]?.items).toHaveLength(1);
  });

  it('空输入空数组', () => {
    expect(groupBursts([])).toEqual([]);
  });
});
