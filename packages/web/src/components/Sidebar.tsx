/** 侧栏（3.2）：内容随域切换，动作走「打开标签/视图」。 */
import { App as AntdApp, Menu } from 'antd';
import type { MenuProps } from 'antd';
import {
  AppstoreOutlined, BranchesOutlined, CopyOutlined, FileTextOutlined, FolderOpenOutlined,
  StarFilled, StarOutlined
} from '@ant-design/icons';
import React, { useEffect, useState } from 'react';
import { useAppStore, type TabLocation } from '@/app/store';
import { api, ApiClientError } from '@/lib/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CollectionInfo, ProjectSummary } from '@ttfolio/shared';
import { SETTINGS_SECTIONS } from '@/features/settings/sections';
import { CollectionPickerModal } from '@/features/workbench/CollectionPickerModal';
import { SEMANTIC } from '@/theme/tokens';


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
    if (subTab === 'files') useAppStore.getState().requestAutoOpenProject(p.id);
    const loc: TabLocation = { kind: 'project', projectId: p.id, targetPath: null, subTab, scroll: 0 };
    openTab(loc, p.alias ?? p.diskName);
  };

  const openView = (key: string): void => {
    openTab({ kind: 'overview', projectId: null, targetPath: null, subTab: `view:${key}`, scroll: 0 }, viewTitle(key));
  };

  // 项目右键菜单（第 29 轮）：document 级原生 contextmenu 监听 + 受控固定定位菜单——
  // 文件树 0.2.3 / 项目卡片 0.2.8 同款定稿模式（React 合成事件与渲染时序竞争的历史教训，
  // 见 PROGRESS 右键菜单两次返工记录）。用户点名「左侧项目那一列」要有右键菜单。
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; projectId: string } | null>(null);
  // 归属集合弹窗：条件渲染 + key=项目 id，每次打开全新挂载（勾选态取打开瞬间快照）
  const [pickerProject, setPickerProject] = useState<ProjectSummary | null>(null);
  const pin = useMutation({
    mutationFn: (p: ProjectSummary) => api.patch(`/api/projects/${p.id}`, { rev: p.rev, isPinned: !p.isPinned }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (e) => void message.error(e instanceof ApiClientError ? e.message : '操作失败')
  });

  useEffect(() => {
    const onCtx = (e: MouseEvent): void => {
      const t = e.target as HTMLElement;
      if (t.closest?.('[data-testid="sidebar-ctx-menu"]') !== null) return;
      // 项目行任意位置（含行内空白）可识别：优先带标记的 label，回退到所在 Menu 行内查找
      const el = t.closest('[data-project-id]') ?? t.closest('.ant-menu-item')?.querySelector('[data-project-id]') ?? null;
      if (el === null) return;
      e.preventDefault();
      // 10 行菜单（8 项 + 2 分隔）：贴右边留菜单宽度、贴底下留菜单高度，小窗口保底 8px
      setCtxMenu({
        x: Math.min(e.clientX, window.innerWidth - 232),
        y: Math.min(e.clientY, Math.max(8, window.innerHeight - 360)),
        projectId: el.getAttribute('data-project-id') ?? ''
      });
    };
    document.addEventListener('contextmenu', onCtx);
    return () => document.removeEventListener('contextmenu', onCtx);
  }, []);

  // 右键菜单打开时，点击任意其它位置关闭（菜单容器 onMouseDown 已阻止冒泡，菜单内点击不受影响）
  useEffect(() => {
    if (ctxMenu === null) return;
    const close = (): void => setCtxMenu(null);
    document.addEventListener('mousedown', close);
    window.addEventListener('blur', close);
    return () => {
      document.removeEventListener('mousedown', close);
      window.removeEventListener('blur', close);
    };
  }, [ctxMenu]);

  const ctxProject = ctxMenu !== null ? (projects ?? []).find((x) => x.id === ctxMenu.projectId) : undefined;
  const ctxItems: MenuProps['items'] = ctxProject === undefined ? [] : [
    { key: 'open', label: '打开项目', icon: <FolderOpenOutlined /> },
    { key: 'files', label: '打开文件页', icon: <FileTextOutlined /> },
    { key: 'git', label: '查看 Git', icon: <BranchesOutlined />, disabled: !ctxProject.gitIsRepo },
    { type: 'divider' as const },
    { key: 'collections', label: '归属集合…', icon: <AppstoreOutlined /> },
    { key: 'pin', label: ctxProject.isPinned ? '取消固定' : '固定', icon: ctxProject.isPinned ? <StarFilled /> : <StarOutlined /> },
    { type: 'divider' as const },
    { key: 'copy', label: '复制路径', icon: <CopyOutlined /> },
    { key: 'explorer', label: '在资源管理器中显示', disabled: ctxProject.pathOk === false },
    { key: 'analyze', label: '重新分析', disabled: ctxProject.pathOk === false }
  ];
  const handleCtxAction = (key: string): void => {
    const p = ctxProject;
    setCtxMenu(null);
    if (p === undefined) return;
    switch (key) {
      case 'open':
      case 'files': openProject(p, 'files'); break;
      case 'git': openProject(p, 'git'); break;
      case 'collections': setPickerProject(p); break;
      case 'pin': pin.mutate(p); break;
      case 'copy': void navigator.clipboard.writeText(p.dirPath); void message.success('已复制路径'); break;
      case 'explorer': void api.post('/api/open', { target: 'explorer', projectId: p.id }); break;
      case 'analyze': void api.post('/api/projects/analyze', { projectIds: [p.id] }); void message.success('已开始重新分析'); break;
    }
  };

  const items: Array<{ key: MenuKey; label: React.ReactNode }> = [];
  let selected: string = '';

  if (domain === 'projects') {
    // 用户要求移除「已固定/有未提交改动/缺文档/缺架构图/未分析/30 天没打开/已归档」侧栏项。
    // 这些"我的视图"本身仍保留：工作台总览的「需要处理」卡片会直接跳到对应卡片墙（viewTitle 映射保留）。
    items.push({ key: 'view:all', label: '工作台总览' });
    items.push({ key: 'view:recent', label: '最近打开' });
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
    // data-project-id 供 document 级右键委托定位项目（第 29 轮）
    // 用户要求：起了别名时别名与原始名都要看到 → 两行展示（上=别名，下=原名）；无别名只显示原名
    label: (
      <span data-project-id={p.id} style={{ display: 'inline-block', maxWidth: 190, lineHeight: 1.3, verticalAlign: 'middle' }}>
        {p.alias !== null ? (
          <>
            <span className="tt-ellipsis" style={{ display: 'block' }}>{p.alias}</span>
            <span className="tt-ellipsis tt-mono" style={{ display: 'block', fontSize: 11, opacity: 0.6 }}>{p.diskName}</span>
          </>
        ) : (
          <span className="tt-ellipsis" style={{ display: 'block' }}>{p.diskName}</span>
        )}
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
    <>
      <Menu
        mode="inline"
        inlineCollapsed={false}
        selectedKeys={[selected]}
        items={items.map((it) => (it.key.startsWith('sep-') ? { key: it.key, type: 'group', label: it.label } : it))}
        onClick={onClick}
        style={{ height: '100%', borderInlineEnd: 'none' }}
      />
      {/* 受控右键菜单（第 29 轮，文件树/项目卡片同款）：固定定位 + document mousedown 关闭，
          容器 onMouseDown 阻止冒泡保证菜单内点击先于关闭执行 */}
      {ctxMenu !== null && ctxProject !== undefined && (
        <div
          data-testid="sidebar-ctx-menu"
          style={{ position: 'fixed', left: ctxMenu.x, top: ctxMenu.y, zIndex: 1050, borderRadius: 8, background: SEMANTIC.layoutBg, boxShadow: '0 6px 16px rgba(0, 0, 0, 0.16)', padding: 4 }}
          onMouseDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <Menu
            selectable={false}
            style={{ border: 'none', background: 'transparent' }}
            items={ctxItems}
            onClick={({ key }) => handleCtxAction(key)}
          />
        </div>
      )}
      {pickerProject !== null && (
        <CollectionPickerModal key={pickerProject.id} project={pickerProject} onClose={() => setPickerProject(null)} />
      )}
    </>
  );
}

function viewTitle(key: string): string {
  switch (key) {
    // 缺这两个映射时标签标题会显示成字面量 "recent" / "pinned"（侧栏点「最近打开」就会出现）
    case 'all': return '工作台总览';
    case 'recent': return '最近打开';
    case 'pinned': return '已固定';
    case 'my-dirty': return '有未提交改动';
    case 'my-nodocs': return '缺文档';
    case 'my-noarch': return '缺架构图';
    case 'my-unanalyzed': return '未分析';
    case 'my-stale': return '30 天没打开';
    case 'my-archived': return '已归档';
    default: return key;
  }
}
