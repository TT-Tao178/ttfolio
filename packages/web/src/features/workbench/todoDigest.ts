/** 跨项目未完成清单摘要（FR-9.3）：纯函数——Dashboard 汇总卡用它做分组/排序/截断。 */
import type { TodoItem } from '@ttfolio/shared';

export interface TodoDigestGroup {
  projectId: string;
  projectName: string;
  /** 组内最早截止（无截止为 null），用于组间排序 */
  earliestDue: string | null;
  items: TodoItem[];
}

export interface TodoDigest {
  groups: TodoDigestGroup[];
  /** 未完成总数（含被截断未展示的） */
  total: number;
  /** 超出上限未展示的条数 */
  hidden: number;
}

const DUE_SENTINEL = '9999-12-31';

/** 组内排序：截止升序（无截止垫底），同截止按创建时间。 */
function itemLess(a: TodoItem, b: TodoItem): number {
  const d = (a.dueOn ?? DUE_SENTINEL).localeCompare(b.dueOn ?? DUE_SENTINEL);
  return d !== 0 ? d : String(a.createdAt).localeCompare(String(b.createdAt));
}

/**
 * 分组摘要：组间按最早截止（都无截止按项目名），组内 itemLess；
 * 只保留前 limit 条（一组放得下就整组保留，放不下的部分计入 hidden）。
 */
export function buildTodoDigest(
  todos: TodoItem[],
  projectNames: Map<string, string>,
  limit: number,
): TodoDigest {
  const byProject = new Map<string, TodoItem[]>();
  for (const t of todos) {
    const bucket = byProject.get(t.projectId);
    if (bucket === undefined) byProject.set(t.projectId, [t]);
    else bucket.push(t);
  }
  const groups: TodoDigestGroup[] = [...byProject.entries()].map(([projectId, items]) => {
    const sorted = [...items].sort(itemLess);
    return {
      projectId,
      projectName: projectNames.get(projectId) ?? '（项目未登记）',
      earliestDue: sorted.find((t) => t.dueOn !== null)?.dueOn ?? null,
      items: sorted,
    };
  });
  groups.sort((a, b) => {
    const ka = a.earliestDue ?? DUE_SENTINEL;
    const kb = b.earliestDue ?? DUE_SENTINEL;
    if (ka !== kb) return ka.localeCompare(kb);
    return a.projectName.localeCompare(b.projectName, 'zh');
  });
  const shown: TodoDigestGroup[] = [];
  let used = 0;
  let hidden = 0;
  for (const g of groups) {
    const take = g.items.slice(0, Math.max(0, limit - used));
    hidden += g.items.length - take.length;
    used += take.length;
    if (take.length > 0) shown.push({ ...g, items: take });
  }
  return { groups: shown, total: todos.length, hidden };
}
