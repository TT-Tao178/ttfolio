/** 活动中心（FR-13.8 / T-105）的纯函数：kind 中文分组、级别配色、按天分组、CSV 生成。 */
import type { ActivityEntry } from '@ttfolio/shared';

export interface RecentFileEntry {
  projectId: string;
  path: string;
  openedAt: string;
  openCount: number;
}

export interface KindGroup {
  key: string;
  label: string;
  prefix: string;
}

/** 活动记录的类型筛选分组（按 kind 前缀聚合，未覆盖的 kind 显示原始串） */
export const KIND_GROUPS: KindGroup[] = [
  { key: 'fs', label: '文件', prefix: 'fs.' },
  { key: 'git', label: 'Git', prefix: 'git.' },
  { key: 'project', label: '项目', prefix: 'project.' },
  { key: 'trash', label: '回收站', prefix: 'trash.' },
  { key: 'library', label: '索引库', prefix: 'library.' },
  { key: 'settings', label: '设置', prefix: 'settings.' },
  { key: 'profile', label: '个人', prefix: 'profile.' },
  { key: 'media', label: '媒体', prefix: 'media.' },
  { key: 'open', label: '外部打开', prefix: 'open.' },
];

export function kindLabel(kind: string): string {
  const g = KIND_GROUPS.find((x) => kind.startsWith(x.prefix));
  return g !== undefined ? g.label : kind;
}

/** 级别 → antd Tag color：L1（读/低危）用默认色，L2 蓝、L3 红 */
export const LEVEL_COLORS: Record<string, string | undefined> = {
  L1: undefined,
  L2: 'processing',
  L3: 'error',
};

export interface ActivityDayGroup {
  /** 本地日期 YYYY-MM-DD */
  day: string;
  items: ActivityEntry[];
}

/** 按本地日期分组；输入须已按时间倒序，组序随输入保持（日期倒序）。 */
export function groupActivityByDay(entries: ActivityEntry[]): ActivityDayGroup[] {
  const groups: ActivityDayGroup[] = [];
  const byDay = new Map<string, ActivityDayGroup>();
  for (const e of entries) {
    const d = new Date(e.at);
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate(),
    ).padStart(2, '0')}`;
    let g = byDay.get(day);
    if (g === undefined) {
      g = { day, items: [] };
      byDay.set(day, g);
      groups.push(g);
    }
    g.items.push(e);
  }
  return groups;
}

/** 导出 CSV：BOM UTF-8（Excel 直开不乱码）；导出范围 = 传入的行（调用方如实提示「当前已加载」）。 */
export function activityToCsv(rows: ActivityEntry[]): string {
  const esc = (v: string): string => `"${v.replace(/"/g, '""')}"`;
  const lines = [['时间', '级别', '类型', '操作者', '项目ID', '目标', '详情'].join(',')];
  for (const r of rows) {
    lines.push(
      [r.at, r.level, r.kind, r.actor, r.projectId ?? '', r.targetPath ?? '', JSON.stringify(r.detail ?? '')]
        .map(esc)
        .join(','),
    );
  }
  return `\uFEFF${lines.join('\r\n')}`;
}
