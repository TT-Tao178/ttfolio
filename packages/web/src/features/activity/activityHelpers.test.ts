/** activityHelpers 纯函数锚点（FR-13.8 / T-105）：kind 分组、按天分组、CSV。 */
import { describe, expect, it } from 'vitest';
import type { ActivityEntry } from '@ttfolio/shared';
import { activityToCsv, groupActivityByDay, KIND_GROUPS, kindLabel, LEVEL_COLORS } from './activityHelpers';

function entry(overrides: Partial<ActivityEntry> & { id: number; at: string; kind: string }): ActivityEntry {
  return {
    level: 'L1',
    projectId: null,
    targetPath: null,
    detail: null,
    actor: 'local',
    ...overrides,
  };
}

describe('kindLabel / KIND_GROUPS（FR-13.8）', () => {
  it('前缀命中的 kind 显示中文分组，未覆盖的显示原始串', () => {
    expect(kindLabel('git.commit')).toBe('Git');
    expect(kindLabel('fs.save')).toBe('文件');
    expect(kindLabel('trash.empty')).toBe('回收站');
    expect(kindLabel('totally.unknown')).toBe('totally.unknown');
    expect(KIND_GROUPS.length).toBeGreaterThanOrEqual(8);
  });

  it('级别配色：L1 默认、L2 蓝、L3 红', () => {
    expect(LEVEL_COLORS.L1).toBeUndefined();
    expect(LEVEL_COLORS.L2).toBe('processing');
    expect(LEVEL_COLORS.L3).toBe('error');
  });
});

describe('groupActivityByDay（FR-13.8 时间线）', () => {
  it('按本地日期分组，倒序输入保持组序，同日条目聚拢', () => {
    const g = groupActivityByDay([
      entry({ id: 1, at: '2026-10-21T10:00:00.000Z', kind: 'fs.save' }),
      entry({ id: 2, at: '2026-10-20T09:00:00.000Z', kind: 'git.commit' }),
      entry({ id: 3, at: '2026-10-20T08:00:00.000Z', kind: 'fs.open' }),
    ]);
    expect(g.map((x) => x.day)).toEqual(['2026-10-21', '2026-10-20']);
    expect(g[0]?.items).toHaveLength(1);
    expect(g[1]?.items.map((e) => e.id)).toEqual([2, 3]);
  });

  it('空输入返回空数组', () => {
    expect(groupActivityByDay([])).toEqual([]);
  });
});

describe('activityToCsv（FR-13.8 导出）', () => {
  it('BOM 开头、表头齐全、引号转义', () => {
    const csv = activityToCsv([
      entry({ id: 1, at: '2026-10-21T10:00:00.000Z', kind: 'fs.save', level: 'L2', targetPath: 'a"b.md' }),
    ]);
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('时间,级别,类型,操作者,项目ID,目标,详情');
    expect(csv).toContain('"a""b.md"');
  });
});
