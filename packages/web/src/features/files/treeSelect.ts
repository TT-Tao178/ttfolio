/**
 * 文件树多选（T-128）的纯函数：可见顺序展开与 Shift 范围选择。
 * 从组件抽出的原因与 parseSubTab 同——树交互曾是历史 bug 高发区，须可单测。
 */

export interface TreeNodeLike {
  key: string;
  children?: TreeNodeLike[];
}

/**
 * 按当前展开状态输出「可见节点 key 的渲染顺序」（DFS：节点自身 → 展开的子层）。
 * 未展开的目录不深入其子层；折叠/展开状态由 expandedKeys 驱动。
 */
export function visibleKeysInOrder(
  nodes: TreeNodeLike[],
  expandedKeys: Iterable<string | number | bigint>,
): string[] {
  const expanded = expandedKeys instanceof Set ? expandedKeys : new Set(expandedKeys);
  const out: string[] = [];
  const walk = (list: TreeNodeLike[]): void => {
    for (const n of list) {
      out.push(n.key);
      if (n.children !== undefined && expanded.has(n.key)) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/**
 * Shift 范围选择：取 anchor 与 target 在可见顺序中的闭区间。
 * target 不在可见列表（树数据未跟上/被过滤）→ 返回空，绝不误选；
 * anchor 为 null 或不在可见列表 → 退化为仅 target；
 * anchor 在 target 之后时区间同样成立（反向选择合法）。
 */
export function rangeSelect(orderedKeys: string[], anchor: string | null, target: string): string[] {
  const from = anchor === null ? -1 : orderedKeys.indexOf(anchor);
  const to = orderedKeys.indexOf(target);
  if (to < 0) return [];
  if (from < 0) return [target];
  const [lo, hi] = from <= to ? [from, to] : [to, from];
  return orderedKeys.slice(lo, hi + 1);
}
