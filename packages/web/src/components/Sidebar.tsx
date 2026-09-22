/** 侧栏（3.2）：内容随域切换，动作走「打开标签/视图」。 */
import { App as AntdApp, Menu } from 'antd';
import React from 'react';
import { useAppStore, type TabLocation } from '@/app/store';
import { api } from '@/lib/api';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CollectionInfo, ProjectSummary } from '@ttfolio/shared';
import { SETTINGS_SECTIONS } from '@/features/settings/sections';


type MenuKey = string;

export function Sidebar(): React.JSX.Element {
  const { domain, openTab, activeTabId } = useAppStore();
  const queryClient = useQueryClient();
  const { message } = AntdApp.useApp();

  const { data: projects } = useQuery({
    queryKey: ['projects', 'sidebar'],
    queryFn: () => api.get<ProjectSummary[]>('/api/projects', { status: 'active' })
  });
  const { data: collections } = useQuery({
    queryKey: ['collections'],
    queryFn: () => api.get<CollectionInfo[]>('/api/collections')
  });

  const openWorkbench = (filter?: Record<string, string>): void => {
    void queryClient.invalidateQueries({ queryKey: ['projects'] });
    openTab({ kind: 'overview', projectId: null, targetPath: null, subTab: filter === undefined ? null : JSON.stringify(filter), scroll: 0 }, '工作台');
  };

  const openProject = (p: ProjectSummary, subTab: string): void => {
    const loc: TabLocation = { kind: 'project', projectId: p.id, targetPath: null, subTab, scroll: 0 };
    openTab(loc, p.alias ?? p.diskName);
  };

  const openView = (key: string): void => {
    openTab({ kind: 'overview', projectId: null, targetPath: null, subTab: `view:${key}`, scroll: 0 }, viewTitle(key));
  };

  const items: Array<{ key: MenuKey; label: React.ReactNode }> = [];
  let selected: string = '';

  if (domain === 'projects') {
    items.push({ key: 'view:all', label: '工作台总览' });
    items.push({ key: 'view:recent', label: '最近打开' });
    items.push({ key: 'view:pinned', label: '已固定' });
    items.push({ key: 'view:my-dirty', label: '有未提交改动' });
    items.push({ key: 'view:my-nodocs', label: '缺文档' });
    items.push({ key: 'view:my-noarch', label: '缺架构图' });
    items.push({ key: 'view:my-unanalyzed', label: '未分析' });
    items.push({ key: 'view:my-stale', label: '30 天没打开' });
    items.push({ key: 'view:my-archived', label: '已归档' });
    for (const c of collections ?? []) items.push({ key: `col:${c.id}`, label: `${c.name}（${c.memberCount}）` });
    selected = activeTabId !== null ? (useAppStore.getState().tabs.find((t) => t.id === activeTabId)?.subTab?.replace('view:', 'view:') ?? '') : '';
  } else if (domain === 'git') {
    items.push({ key: 'git-overview', label: '跨项目 Git 总览' });
    selected = '';
  } else if (domain === 'search') {
    items.push({ key: 'search-all', label: '全局搜索（Ctrl+K）' });
    items.push({ key: 'search-current', label: '在当前项目内搜索' });
    selected = '';
  } else if (domain === 'settings') {
    // 设置域原先没有任何分支 → items 恒为空菜单（用户报障："左侧设置里面是空的，啥都没有"）。
    // 这里按 sections.ts 的单一来源列分组，点击后打开设置标签并滚动到对应分组。
    for (const s of SETTINGS_SECTIONS) items.push({ key: `set:${s.key}`, label: s.label });
    const cur = activeTabId !== null ? useAppStore.getState().tabs.find((t) => t.id === activeTabId) : undefined;
    selected = cur !== undefined && cur.kind === 'settings' && cur.subTab !== null ? `set:${cur.subTab}` : '';
  }

  const projectItems = (projects ?? []).slice(0, 30).map((p) => ({
    key: `proj:${p.id}:files`,
    label: (
      <span className="tt-ellipsis" style={{ display: 'inline-block', maxWidth: 180 }}>
        {p.alias !== null ? `${p.alias}（别名）` : p.diskName}
      </span>
    )
  }));
  if (domain === 'projects') {
    items.push({ key: 'sep-projects', label: '项目' });
    items.push(...projectItems);
  } else if (domain === 'git') {
    items.push({ key: 'sep-projects', label: '项目 Git' });
    items.push(...projectItems.map((it) => ({ ...it, key: it.key.replace(':files', ':git') })));
  } else if (domain === 'archives') {
    items.push({ key: 'sep-projects', label: '项目架构图' });
    items.push(...projectItems.map((it) => ({ ...it, key: it.key.replace(':files', ':archives') })));
  } else if (domain === 'docs') {
    items.push({ key: 'sep-projects', label: '项目文档' });
    items.push(...projectItems.map((it) => ({ ...it, key: it.key.replace(':files', ':docs') })));
  }

  const onClick = (e: { key: string }): void => {
    const key = e.key;
    if (key.startsWith('set:')) {
      // 设置分组：kind=settings 的标签 key 不含 subTab，所以会复用同一个设置标签并同步定位
      openTab({ kind: 'settings', projectId: null, targetPath: null, subTab: key.slice(4), scroll: 0 }, '设置');
      return;
    }
    if (key.startsWith('view:')) {
      // 工作台总览（Dashboard）与卡片墙是两个屏：只有 view:all 落到总览，
      // 最近打开/已固定以及"我的视图"都落到各自的卡片墙标签（各自独立，可并存）。
      if (key === 'view:all') openWorkbench();
      else openView(key.slice(5));
      return;
    }
    if (key === 'git-overview') {
      openTab({ kind: 'search', projectId: null, targetPath: null, subTab: 'git-overview', scroll: 0 }, 'Git 总览');
      return;
    }
    if (key === 'search-all') {
      useAppStore.getState().setPalette(true);
      return;
    }
    if (key === 'search-current') {
      const tab = useAppStore.getState().tabs.find((t) => t.id === activeTabId);
      if (tab?.projectId == null) {
        void message.info('请先打开一个项目');
        return;
      }
      useAppStore.getState().setPalette(true);
      return;
    }
    if (key.startsWith('col:')) {
      const cid = key.slice(4);
      const col = (collections ?? []).find((c) => c.id === cid);
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      openTab({ kind: 'overview', projectId: null, targetPath: null, subTab: `col:${cid}`, scroll: 0 }, col?.name ?? '集合');
      return;
    }
    if (key.startsWith('proj:')) {
      const [, pid, sub] = key.split(':');
      const p = (projects ?? []).find((x) => x.id === pid);
      if (p !== undefined && sub !== undefined) openProject(p, sub);
    }
  };

  return (
    <Menu
      mode="inline"
      inlineCollapsed={false}
      selectedKeys={[selected]}
      items={items.map((it) => (it.key.startsWith('sep-') ? { key: it.key, type: 'group', label: it.label } : it))}
      onClick={onClick}
      style={{ height: '100%', borderInlineEnd: 'none' }}
    />
  );
}

function viewTitle(key: string): string {
  switch (key) {
    case 'my-dirty': return '有未提交改动';
    case 'my-nodocs': return '缺文档';
    case 'my-noarch': return '缺架构图';
    case 'my-unanalyzed': return '未分析';
    case 'my-stale': return '30 天没打开';
    case 'my-archived': return '已归档';
    default: return key;
  }
}
