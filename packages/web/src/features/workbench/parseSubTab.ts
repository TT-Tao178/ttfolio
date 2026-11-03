/**
 * 卡片墙 subTab → /api/projects 查询参数（FR-2.8/4.11）。
 * 第 33 轮从 Workbench.tsx 原样抽出为纯函数（行为零变化），使其可被单测覆盖——
 * 这里曾是「集合视图不过滤」（0.2.8 修复）与多个「我的视图」映射的所在，
 * 属历史 bug 高发区。
 * 第 62 轮（KNOWN-GAPS #5）：新增 view:custom:<id> 分支——按调用方传入的
 * 自定义视图表解析出 filters；表缺失或 id 不存在一律回落 active（视图被删后旧标签不炸）。
 */
export function parseSubTab(
  subTab: string | null,
  customViews?: Array<{ id: string; filters: Record<string, string> }>,
): Record<string, string> {
  if (subTab === null) return { status: 'active' };
  if (subTab === 'view:recent') return { status: 'active', sort: 'last_opened' };
  if (subTab === 'view:pinned') return { status: 'active' };
  if (subTab === 'view:stats') {
    // 项目统计面板（FR-15.3 / T-144）：数据面独立接口，列表查询仅兜底
    return { status: 'active' };
  }
  if (subTab.startsWith('view:custom:')) {
    const id = subTab.slice('view:custom:'.length);
    const view = customViews?.find((v) => v.id === id);
    return view !== undefined ? { status: 'active', ...view.filters } : { status: 'active' };
  }
  if (subTab.startsWith('view:my-')) {
    const key = subTab.slice(8);
    switch (key) {
      case 'dirty':
        return { status: 'active', dirty: '1' };
      case 'nodocs':
        return { status: 'active', hasDocs: '0' };
      case 'noarch':
        return { status: 'active', hasArch: '0' };
      case 'unanalyzed':
        return { status: 'active', analyzed: '0' };
      case 'stale':
        return { status: 'active', stale: '30' };
      case 'archived':
        return { status: 'archived' };
      default:
        return { status: 'active' };
    }
  }
  if (subTab === 'col:unassigned') {
    // 「未分配」虚拟分组（2026-11-03 用户需求）：不属于任何集合的登记项目
    return { status: 'active', unassigned: '1' };
  }
  // 父子集合（FR-15.1）：col:<id> 默认含全部子孙集合；col:<id>:direct 切回仅本集合
  const colDirect = /^col:(.+):direct$/.exec(subTab);
  if (colDirect !== null) {
    return { status: 'active', collection: colDirect[1] ?? '', includeChildren: '0' };
  }
  if (subTab.startsWith('col:')) {
    return { status: 'active', collection: subTab.slice(4), includeChildren: '1' };
  }
  if (subTab.startsWith('tag:')) return { status: 'active', tag: subTab.slice(4) };
  if (subTab.startsWith('{')) {
    try {
      return JSON.parse(subTab) as Record<string, string>;
    } catch {
      return { status: 'active' };
    }
  }
  return { status: 'active' };
}
