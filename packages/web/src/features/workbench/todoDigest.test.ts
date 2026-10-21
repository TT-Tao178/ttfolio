/** buildTodoDigest 纯函数锚点（FR-9.3 / T-109）：分组、排序、截断、缺名兜底。 */
import { describe, expect, it } from 'vitest';
import type { TodoItem } from '@ttfolio/shared';
import { buildTodoDigest } from './todoDigest';

function todo(overrides: Partial<TodoItem> & { id: string; projectId: string }): TodoItem {
  return {
    title: `任务 ${overrides.id}`,
    category: null,
    dueOn: null,
    done: false,
    sortOrder: 0,
    actor: 'local',
    source: 'manual',
    createdAt: '2026-10-21T00:00:00.000Z',
    doneAt: null,
    ...overrides,
  };
}

describe('buildTodoDigest（FR-9.3 跨项目未完成清单）', () => {
  const names = new Map([
    ['p1', '甲项目'],
    ['p2', '乙项目'],
  ]);

  it('组间按最早截止升序（无截止垫底），组内截止升序同值按创建时间', () => {
    const d = buildTodoDigest(
      [
        todo({ id: 'a', projectId: 'p1', dueOn: '2026-10-20' }),
        todo({ id: 'b', projectId: 'p1', dueOn: '2026-10-01' }),
        todo({ id: 'c', projectId: 'p2', createdAt: '2026-10-20T00:00:00.000Z' }),
        todo({ id: 'e', projectId: 'p2', createdAt: '2026-10-19T00:00:00.000Z' }),
        todo({ id: 'd', projectId: 'p2', dueOn: '2026-10-05' }),
      ],
      names,
      10,
    );
    expect(d.groups.map((g) => g.projectId)).toEqual(['p1', 'p2']);
    expect(d.groups[0]?.items.map((t) => t.id)).toEqual(['b', 'a']);
    expect(d.groups[1]?.items.map((t) => t.id)).toEqual(['d', 'e', 'c']);
  });

  it('都无截止的组按项目名排序', () => {
    const d = buildTodoDigest(
      [todo({ id: 'c', projectId: 'p2' }), todo({ id: 'a', projectId: 'p1' })],
      names,
      10,
    );
    expect(d.groups.map((g) => g.projectId)).toEqual(['p1', 'p2']);
  });

  it('超出上限截断：整组优先保留，hidden 计数正确', () => {
    const d = buildTodoDigest(
      [
        todo({ id: 'a', projectId: 'p1', dueOn: '2026-10-01' }),
        todo({ id: 'b', projectId: 'p1', dueOn: '2026-10-02' }),
        todo({ id: 'c', projectId: 'p2', dueOn: '2026-10-03' }),
      ],
      names,
      2,
    );
    expect(d.total).toBe(3);
    expect(d.groups).toHaveLength(1);
    expect(d.groups[0]?.items.map((t) => t.id)).toEqual(['a', 'b']);
    expect(d.hidden).toBe(1);
  });

  it('项目查无名称时兜底（登记已移除）', () => {
    const d = buildTodoDigest([todo({ id: 'a', projectId: 'ghost' })], names, 10);
    expect(d.groups[0]?.projectName).toBe('（项目未登记）');
  });

  it('空输入返回空摘要', () => {
    expect(buildTodoDigest([], names, 10)).toEqual({ groups: [], total: 0, hidden: 0 });
  });
});
