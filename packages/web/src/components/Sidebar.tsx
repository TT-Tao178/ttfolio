/** 侧栏（3.2）：内容随域切换，动作走「打开标签/视图」。 */
import { App as AntdApp, Menu } from 'antd';
import type { MenuProps } from 'antd';
import {
  AppstoreOutlined,
  ArrowDownOutlined,
  ArrowUpOutlined,
  BranchesOutlined,
  CopyOutlined,
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  StarFilled,
  StarOutlined,
} from '@ant-design/icons';
import React, { useEffect, useState } from 'react';
import { useAppStore, type TabLocation } from '@/app/store';
import { api, ApiClientError } from '@/lib/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CollectionInfo, CustomView, ProjectSummary } from '@ttfolio/shared';
import { useSettings } from '@/app/settings';
import { SETTINGS_SECTIONS } from '@/features/settings/sections';
import { CollectionPickerModal } from '@/features/workbench/CollectionPickerModal';
import { CollectionEditModal, type CollectionEditTarget } from '@/features/workbench/CollectionEditModal';
import { CustomViewModal } from '@/features/workbench/CustomViewModal';
import { downloadProjectReport } from '@/features/workbench/projectMenu';
import { SEMANTIC } from '@/theme/tokens';
import { AccountBar } from '@/features/profile/AccountBar';
import { openAgo } from '@/lib/format';

type MenuKey = string;

/** 侧栏条目：集合项带 children（可折叠成员列表，第 30 轮），其余为平面项 */
type SidebarItem = {
  key: MenuKey;
  label: React.ReactNode;
  children?: Array<{ key: MenuKey; label: React.ReactNode }>;
};

export function Sidebar(): React.JSX.Element {
  // 按字段订阅（体检 P2：全量订阅会被编辑器键入等无关变化连带重渲染大菜单树）
  const domain = useAppStore((s) => s.domain);
  const openTab = useAppStore((s) => s.openTab);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const queryClient = useQueryClient();
  const { message, modal } = AntdApp.useApp();
  const { settings, setSetting } = useSettings();

  const { data: projects } = useQuery({
    queryKey: ['projects', 'sidebar'],
    queryFn: () => api.get<ProjectSummary[]>('/api/projects', { status: 'active' }),
  });
  const { data: collections } = useQuery({
    queryKey: ['collections'],
    queryFn: () => api.get<CollectionInfo[]>('/api/collections'),
  });
  // 标签入口（第 36 轮 A2 补齐 KNOWN-GAPS #8）：带项目计数，点击开对应标签的卡片墙
  const { data: tags } = useQuery({
    queryKey: ['tags'],
    queryFn: () =>
      api.get<Array<{ id: string; name: string; color: string | null; projectCount: number }>>('/api/tags'),
  });

  const openWorkbench = (filter?: Record<string, string>): void => {
    void queryClient.invalidateQueries({ queryKey: ['projects'] });
    openTab(
      {
        kind: 'overview',
        projectId: null,
        targetPath: null,
        subTab: filter === undefined ? null : JSON.stringify(filter),
        scroll: 0,
      },
      '工作台',
    );
  };

  const openProject = (p: ProjectSummary, subTab: string): void => {
    if (subTab === 'files') useAppStore.getState().requestAutoOpenProject(p.id);
    const loc: TabLocation = { kind: 'project', projectId: p.id, targetPath: null, subTab, scroll: 0 };
    openTab(loc, p.alias ?? p.diskName);
    // 打开计数/最近打开（评审：卡片与命令面板都上报，侧栏漏报——导致「继续上次」
    // 与总览「今天动过」漏掉从侧栏打开的项目）
    void api.post(`/api/projects/${p.id}/open`);
  };

  const openView = (key: string): void => {
    // 自定义视图（FR-4.11）：标题取视图名；查不到（已删除）回落内置映射
    const custom = key.startsWith('custom:')
      ? settings.customViews.find((v) => v.id === key.slice(7))
      : undefined;
    openTab(
      { kind: 'overview', projectId: null, targetPath: null, subTab: `view:${key}`, scroll: 0 },
      custom?.name ?? viewTitle(key),
    );
  };

  // 项目右键菜单（第 29 轮）：document 级原生 contextmenu 监听 + 受控固定定位菜单——
  // 文件树 0.2.3 / 项目卡片 0.2.8 同款定稿模式（React 合成事件与渲染时序竞争的历史教训，
  // 见 PROGRESS 右键菜单两次返工记录）。用户点名「左侧项目那一列」要有右键菜单。
  // 第 31 轮扩展为双类型：集合条目（data-collection-id）右键可 编辑/删除/打开视图。
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    kind: 'project' | 'collection' | 'view';
    id: string;
  } | null>(null);
  // 归属集合弹窗：条件渲染 + key=项目 id，每次打开全新挂载（勾选态取打开瞬间快照）
  const [pickerProject, setPickerProject] = useState<ProjectSummary | null>(null);
  // 集合编辑弹窗（重命名/备注）
  const [editingCol, setEditingCol] = useState<CollectionEditTarget | null>(null);
  // 自定义视图编辑弹窗（FR-4.11）：initial=null 为新建
  const [viewEditor, setViewEditor] = useState<{ initial: CustomView | null } | null>(null);
  const pin = useMutation({
    mutationFn: (p: ProjectSummary) =>
      api.patch(`/api/projects/${p.id}`, { rev: p.rev, isPinned: !p.isPinned }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (e) => void message.error(e instanceof ApiClientError ? e.message : '操作失败'),
  });

  // 项目项右侧的「最后打开」相对时间会随时间流逝变档（1分钟内 → N分钟前 → …），
  // 打开项目后由 SSE 失效 projects 查询即时刷新；这里再 30s 心跳覆盖"挂着不动"的场景，
  // 粒度到分钟级分桶，30s 足够且开销可忽略。
  const [, setTimeTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => setTimeTick((x) => x + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const onCtx = (e: MouseEvent): void => {
      const t = e.target as HTMLElement;
      if (t.closest?.('[data-testid="sidebar-ctx-menu"]') !== null) return;
      // 项目行任意位置（含行内空白）：优先带标记的 label，回退到所在 Menu 行内查找
      const projEl =
        t.closest('[data-project-id]') ??
        t.closest('.ant-menu-item')?.querySelector('[data-project-id]') ??
        null;
      // 集合子菜单标题：label 带 data-collection-id，行内空白回退 submenu 标题内查找
      const colEl =
        projEl === null
          ? (t.closest('[data-collection-id]') ??
            t.closest('.ant-menu-submenu-title')?.querySelector('[data-collection-id]') ??
            null)
          : null;
      // 自定义视图条目（FR-4.11）：label 带 data-view-id
      const viewEl =
        projEl === null && colEl === null
          ? (t.closest('[data-view-id]') ??
            t.closest('.ant-menu-item')?.querySelector('[data-view-id]') ??
            null)
          : null;
      if (projEl === null && colEl === null && viewEl === null) return;
      e.preventDefault();
      const kind = projEl !== null ? 'project' : colEl !== null ? 'collection' : 'view';
      const el = projEl ?? colEl ?? viewEl;
      const attr =
        kind === 'project'
          ? 'data-project-id'
          : kind === 'collection'
            ? 'data-collection-id'
            : 'data-view-id';
      const id = el?.getAttribute(attr) ?? '';
      // 10 行菜单（8 项 + 2 分隔）：贴右边留菜单宽度、贴底下留菜单高度，小窗口保底 8px
      setCtxMenu({
        x: Math.min(e.clientX, window.innerWidth - 232),
        y: Math.min(e.clientY, Math.max(8, window.innerHeight - 360)),
        kind,
        id,
      });
    };
    document.addEventListener('contextmenu', onCtx);
    return () => document.removeEventListener('contextmenu', onCtx);
  }, []);

  // 右键菜单打开时，点击任意其它位置/滚动/Esc 关闭（菜单容器 onMouseDown 已阻止冒泡，菜单内点击不受影响）
  useEffect(() => {
    if (ctxMenu === null) return;
    const close = (): void => setCtxMenu(null);
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('scroll', close, true);
    window.addEventListener('blur', close);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('scroll', close, true);
      window.removeEventListener('blur', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [ctxMenu]);

  const ctxProject =
    ctxMenu?.kind === 'project' ? (projects ?? []).find((x) => x.id === ctxMenu.id) : undefined;
  const ctxCollection =
    ctxMenu?.kind === 'collection' ? (collections ?? []).find((c) => c.id === ctxMenu.id) : undefined;
  const ctxView =
    ctxMenu?.kind === 'view' ? settings.customViews.find((v) => v.id === ctxMenu.id) : undefined;
  const ctxItems: MenuProps['items'] =
    ctxProject !== undefined
      ? [
          { key: 'open', label: '打开项目', icon: <FolderOpenOutlined /> },
          { key: 'files', label: '打开文件页', icon: <FileTextOutlined /> },
          { key: 'git', label: '查看 Git', icon: <BranchesOutlined />, disabled: !ctxProject.gitIsRepo },
          { type: 'divider' as const },
          { key: 'collections', label: '归属集合…', icon: <AppstoreOutlined /> },
          {
            key: 'pin',
            label: ctxProject.isPinned ? '取消固定' : '固定',
            icon: ctxProject.isPinned ? <StarFilled /> : <StarOutlined />,
          },
          { type: 'divider' as const },
          { key: 'copy', label: '复制路径', icon: <CopyOutlined /> },
          { key: 'explorer', label: '在资源管理器中显示', disabled: ctxProject.pathOk === false },
          { key: 'analyze', label: '重新分析', disabled: ctxProject.pathOk === false },
          { key: 'report', label: '导出 Markdown 报告', icon: <DownloadOutlined /> },
        ]
      : ctxCollection !== undefined
        ? [
            { key: 'openview', label: '打开集合视图', icon: <FolderOpenOutlined /> },
            { type: 'divider' as const },
            {
              key: 'moveup',
              label: '上移',
              icon: <ArrowUpOutlined />,
              disabled: (collections ?? []).findIndex((c) => c.id === ctxCollection.id) <= 0,
            },
            {
              key: 'movedown',
              label: '下移',
              icon: <ArrowDownOutlined />,
              disabled:
                (collections ?? []).findIndex((c) => c.id === ctxCollection.id) === -1 ||
                (collections ?? []).findIndex((c) => c.id === ctxCollection.id) ===
                  (collections ?? []).length - 1,
            },
            { type: 'divider' as const },
            { key: 'editcol', label: '编辑名称 / 备注…', icon: <EditOutlined /> },
            { key: 'delcol', label: '删除集合…', icon: <DeleteOutlined />, danger: true },
          ]
        : ctxView !== undefined
          ? [
              { key: 'openview', label: '打开视图', icon: <FolderOpenOutlined /> },
              { key: 'editview', label: '编辑视图…', icon: <EditOutlined /> },
              { key: 'delview', label: '删除视图…', icon: <DeleteOutlined />, danger: true },
            ]
          : [];
  const openCollectionView = (cid: string): void => {
    const col = (collections ?? []).find((c) => c.id === cid);
    void queryClient.invalidateQueries({ queryKey: ['projects'] });
    openTab(
      { kind: 'overview', projectId: null, targetPath: null, subTab: `col:${cid}`, scroll: 0 },
      col?.name ?? '集合',
    );
  };
  const confirmDeleteCollection = (cid: string): void => {
    const col = (collections ?? []).find((c) => c.id === cid);
    if (col === undefined) return;
    modal.confirm({
      title: `删除集合「${col.name}」？`,
      content: `集合下 ${col.memberCount} 个项目的归属关系将一并移除；项目本身与磁盘文件不受影响。`,
      okText: '删除集合',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => {
        void api
          .del(`/api/collections/${cid}`)
          .then(async () => {
            void message.success('已删除集合');
            await queryClient.invalidateQueries({ queryKey: ['collections'] });
            await queryClient.invalidateQueries({ queryKey: ['projects'] });
          })
          .catch((e: unknown) => void message.error(e instanceof ApiClientError ? e.message : '删除失败'));
      },
    });
  };
  const confirmDeleteView = (v: CustomView): void => {
    modal.confirm({
      title: `删除视图「${v.name}」？`,
      content: '仅移除这个保存的筛选入口，项目数据不受影响；指向它的已打开标签会回落到工作台。',
      okText: '删除视图',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => {
        setSetting(
          'customViews',
          settings.customViews.filter((x) => x.id !== v.id),
        );
        void message.success('已删除视图');
      },
    });
  };
  const handleCtxAction = (key: string): void => {
    const p = ctxProject;
    const col = ctxCollection;
    const view = ctxView;
    setCtxMenu(null);
    if (view !== undefined) {
      switch (key) {
        case 'openview':
          openView(`custom:${view.id}`);
          break;
        case 'editview':
          setViewEditor({ initial: view });
          break;
        case 'delview':
          confirmDeleteView(view);
          break;
      }
      return;
    }
    if (p !== undefined) {
      switch (key) {
        case 'open':
        case 'files':
          openProject(p, 'files');
          break;
        case 'git':
          openProject(p, 'git');
          break;
        case 'collections':
          setPickerProject(p);
          break;
        case 'pin':
          pin.mutate(p);
          break;
        case 'copy':
          void navigator.clipboard.writeText(p.dirPath);
          void message.success('已复制路径');
          break;
        case 'explorer':
          void api.post('/api/open', { target: 'explorer', projectId: p.id });
          break;
        case 'analyze':
          void api.post('/api/projects/analyze', { projectIds: [p.id] });
          void message.success('已开始重新分析');
          break;
        case 'report':
          void downloadProjectReport(p)
            .then((msg) => message.success(msg))
            .catch(() => message.error('导出报告失败'));
          break;
      }
      return;
    }
    if (col !== undefined) {
      switch (key) {
        case 'openview':
          openCollectionView(col.id);
          break;
        case 'moveup':
        case 'movedown': {
          // 集合手动排序（0.3.8 补 KNOWN-GAPS #9）：与相邻集合交换位置，全量重排
          const list = (collections ?? []).slice();
          const i = list.findIndex((c) => c.id === col.id);
          const j = key === 'moveup' ? i - 1 : i + 1;
          if (i < 0 || j < 0 || j >= list.length) break;
          const a = list[i];
          const b = list[j];
          if (a === undefined || b === undefined) break;
          list[i] = b;
          list[j] = a;
          void api
            .post('/api/collections/reorder', { ids: list.map((c) => c.id) })
            .then(() => queryClient.invalidateQueries({ queryKey: ['collections'] }))
            .catch(() => void message.error('排序失败'));
          break;
        }
        case 'editcol':
          setEditingCol({ id: col.id, name: col.name, note: col.note });
          break;
        case 'delcol':
          confirmDeleteCollection(col.id);
          break;
      }
    }
  };

  const items: SidebarItem[] = [];
  // 选中态（评审：原实现对 proj:/col: 键恒为空，点项目/集合后侧栏无任何高亮；
  // 还有 subTab.replace('view:','view:') 无操作死代码——一并重写）
  const activeTab =
    activeTabId !== null ? useAppStore.getState().tabs.find((t) => t.id === activeTabId) : undefined;
  let selected = '';
  if (domain === 'projects') {
    // 用户要求移除「已固定/有未提交改动/缺文档/缺架构图/未分析/30 天没打开/已归档」侧栏项。
    // 这些"我的视图"本身仍保留：工作台总览的「需要处理」卡片会直接跳到对应卡片墙（viewTitle 映射保留）。
    items.push({ key: 'view:all', label: '工作台总览' });
    items.push({ key: 'view:recent', label: '最近打开' });
    // 自定义「我的视图」（FR-4.11 / KNOWN-GAPS #5）：入口在侧栏（KNOWN-GAPS 原补法），
    // 右键可编辑/删除；「新建视图…」打开七字段编辑弹窗
    items.push({ key: 'sep-views', label: '我的视图' });
    for (const v of settings.customViews) {
      items.push({
        key: `view:custom:${v.id}`,
        label: (
          <span
            data-view-id={v.id}
            className="tt-ellipsis"
            style={{ display: 'block', maxWidth: 170 }}
            title={v.name}
          >
            {v.name}
          </span>
        ),
      });
    }
    items.push({ key: 'view-new', label: '新建视图…' });
    // 集合 = 可折叠子菜单（第 30 轮，用户需求：加入集合的项目要在侧栏能展开/收起查看）——
    // 点集合名=展开/收起成员列表；子项首位「打开集合视图」保留原平面条目的卡片墙入口；
    // 成员项目可直接点开，且带 data-project-id 可用右键整套菜单。收起为默认态。
    for (const c of collections ?? []) {
      const members = c.projectIds
        .map((pid) => (projects ?? []).find((p) => p.id === pid))
        .filter((p): p is ProjectSummary => p !== undefined);
      items.push({
        key: `col:${c.id}`,
        // data-collection-id 供 document 级右键委托定位集合（第 31 轮：集合可右键编辑/删除）
        label: <span data-collection-id={c.id}>{`${c.name}（${c.memberCount}）`}</span>,
        children: [
          { key: `colview:${c.id}`, label: '打开集合视图' },
          ...members.map((p) => ({
            key: `colproj:${c.id}:${p.id}`,
            label: (
              <span
                data-project-id={p.id}
                className="tt-ellipsis"
                style={{ display: 'block', maxWidth: 150 }}
              >
                {p.alias ?? p.diskName}
              </span>
            ),
          })),
        ],
      });
    }
    // 标签 = 平面条目（第 36 轮 A2）：点击开该标签的卡片墙（subTab=tag:<id>），
    // 计数与集合条目同口径；无项目数 0 的标签仍显示，便于发现空标签
    for (const t of tags ?? []) {
      items.push({ key: `tag:${t.id}`, label: `${t.name}（${t.projectCount}）` });
    }
    if (activeTab !== undefined) {
      if (activeTab.kind === 'overview') {
        // 总览屏（subTab=null）→ 工作台总览；卡片墙视图 → view:*/col:*/tag:* → 高亮对应条目
        if (activeTab.subTab === null) selected = 'view:all';
        else if (
          activeTab.subTab.startsWith('view:') ||
          activeTab.subTab.startsWith('col:') ||
          activeTab.subTab.startsWith('tag:')
        )
          selected = activeTab.subTab;
      } else if (activeTab.kind === 'project' && activeTab.projectId !== null) {
        selected = `proj:${activeTab.projectId}:files`;
      } else if (activeTab.kind === 'settings' && activeTab.subTab !== null) {
        selected = `set:${activeTab.subTab}`;
      }
    }
  } else if (domain === 'git') {
    items.push({ key: 'git-overview', label: '跨项目 Git 总览' });
    if (activeTab?.kind === 'project' && activeTab.projectId !== null)
      selected = `proj:${activeTab.projectId}:git`;
    else if (activeTab?.kind === 'search' && activeTab.subTab === 'git-overview') selected = 'git-overview';
  } else if (domain === 'search') {
    items.push({ key: 'search-all', label: '全局搜索（Ctrl+K）' });
    items.push({ key: 'search-current', label: '在当前项目内搜索' });
    selected = '';
  } else if (domain === 'activity') {
    // 活动中心（FR-13.8 / T-105）：单页三页签，侧栏只一个入口
    items.push({ key: 'activity-hub', label: '活动中心' });
    if (activeTab?.kind === 'activity') selected = 'activity-hub';
  } else if (domain === 'settings') {
    // 设置域原先没有任何分支 → items 恒为空菜单（用户报障："左侧设置里面是空的，啥都没有"）。
    // 这里按 sections.ts 的单一来源列分组，点击后打开设置标签并滚动到对应分组。
    for (const s of SETTINGS_SECTIONS) items.push({ key: `set:${s.key}`, label: s.label });
    const cur =
      activeTabId !== null ? useAppStore.getState().tabs.find((t) => t.id === activeTabId) : undefined;
    selected = cur !== undefined && cur.kind === 'settings' && cur.subTab !== null ? `set:${cur.subTab}` : '';
  }

  const projectItems = (projects ?? []).slice(0, 30).map((p) => ({
    key: `proj:${p.id}:files`,
    // data-project-id 供 document 级右键委托定位项目（第 29 轮）
    // 用户要求：起了别名时别名与原始名都要看到 → 两行展示（上=别名，下=原名）；无别名只显示原名。
    // 第 34 轮：右侧补「最后打开」相对时间（左名称自适应收窄、时间不换行；悬浮 title 给精确时刻）
    label: (
      <span
        data-project-id={p.id}
        className={p.alias !== null ? 'tt-proj-2line' : undefined}
        style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', maxWidth: 190 }}
      >
        <span style={{ flex: 1, minWidth: 0 }}>
          {p.alias !== null ? (
            <>
              <span className="tt-ellipsis" style={{ display: 'block' }}>
                {p.alias}
              </span>
              <span
                className="tt-ellipsis tt-mono tt-proj-diskname"
                style={{ display: 'block', fontSize: 11, opacity: 0.6 }}
              >
                {p.diskName}
              </span>
            </>
          ) : (
            <span className="tt-ellipsis" style={{ display: 'block' }}>
              {p.diskName}
            </span>
          )}
        </span>
        <span
          style={{ flexShrink: 0, fontSize: 11, opacity: 0.55, whiteSpace: 'nowrap' }}
          title={
            p.lastOpenedAt === null
              ? '从未打开'
              : `最后打开：${new Date(p.lastOpenedAt).toLocaleString('zh-CN')}`
          }
        >
          {openAgo(p.lastOpenedAt)}
        </span>
      </span>
    ),
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
    if (activeTab?.kind === 'project' && activeTab.projectId !== null)
      selected = `proj:${activeTab.projectId}:archives`;
  } else if (domain === 'docs') {
    items.push({ key: 'doclib', label: '文档库（跨项目浏览）' });
    items.push({ key: 'sep-projects', label: '项目文档' });
    items.push(...projectItems.map((it) => ({ ...it, key: it.key.replace(':files', ':docs') })));
    if (activeTab?.kind === 'project' && activeTab.projectId !== null)
      selected = `proj:${activeTab.projectId}:docs`;
    else if (activeTab?.kind === 'doclib') selected = 'doclib';
  }

  const onClick = (e: { key: string }): void => {
    const key = e.key;
    if (key.startsWith('set:')) {
      // 设置分组：kind=settings 的标签 key 不含 subTab，所以会复用同一个设置标签并同步定位
      openTab(
        { kind: 'settings', projectId: null, targetPath: null, subTab: key.slice(4), scroll: 0 },
        '设置',
      );
      return;
    }
    if (key === 'view-new') {
      setViewEditor({ initial: null });
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
      openTab(
        { kind: 'search', projectId: null, targetPath: null, subTab: 'git-overview', scroll: 0 },
        'Git 总览',
      );
      return;
    }
    if (key === 'activity-hub') {
      openTab({ kind: 'activity', projectId: null, targetPath: null, subTab: null, scroll: 0 }, '活动中心');
      return;
    }
    if (key === 'doclib') {
      openTab({ kind: 'doclib', projectId: null, targetPath: null, subTab: null, scroll: 0 }, '文档库');
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
      // 体检 P2：把项目作用域传给命令面板（原先只开面板，scope 仍是全局）
      useAppStore.getState().setPalette(true, { scope: 'project' });
      return;
    }
    if (key.startsWith('tag:')) {
      // 标签条目点击 = 打开该标签的卡片墙视图，标签名作标签页标题
      const t = (tags ?? []).find((x) => x.id === key.slice(4));
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      openTab(
        { kind: 'overview', projectId: null, targetPath: null, subTab: key, scroll: 0 },
        t?.name ?? '标签',
      );
      return;
    }
    if (key.startsWith('col:')) {
      // 集合标题点击=antd 子菜单原生展开/收起（第 30 轮），这里不再开标签，直接吞掉
      return;
    }
    if (key.startsWith('colview:')) {
      openCollectionView(key.slice(8));
      return;
    }
    if (key.startsWith('colproj:')) {
      // 集合成员项目直接点开（files 页签），与主列表点项目一致
      const pid = key.split(':')[2];
      const p = (projects ?? []).find((x) => x.id === pid);
      if (p !== undefined) openProject(p, 'files');
      return;
    }
    if (key.startsWith('proj:')) {
      const [, pid, sub] = key.split(':');
      const p = (projects ?? []).find((x) => x.id === pid);
      if (p !== undefined && sub !== undefined) openProject(p, sub);
    }
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <Menu
          mode="inline"
          inlineCollapsed={false}
          selectedKeys={[selected]}
          items={items.map((it) =>
            it.key.startsWith('sep-') ? { key: it.key, type: 'group', label: it.label } : it,
          )}
          onClick={onClick}
          style={{ borderInlineEnd: 'none' }}
        />
      </div>
      {/* 侧栏底部账户条（FR-13.7）：常驻、不随菜单滚动 */}
      <AccountBar />
      {/* 受控右键菜单（第 29 轮项目 / 第 31 轮集合，文件树/项目卡片同款）：固定定位 + document mousedown 关闭，
          容器 onMouseDown 阻止冒泡保证菜单内点击先于关闭执行 */}
      {ctxMenu !== null &&
        (ctxProject !== undefined || ctxCollection !== undefined || ctxView !== undefined) && (
          <div
            data-testid="sidebar-ctx-menu"
            style={{
              position: 'fixed',
              left: ctxMenu.x,
              top: ctxMenu.y,
              zIndex: 1050,
              borderRadius: 8,
              background: SEMANTIC.layoutBg,
              boxShadow: '0 6px 16px rgba(0, 0, 0, 0.16)',
              padding: 4,
            }}
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
        <CollectionPickerModal
          key={pickerProject.id}
          project={pickerProject}
          onClose={() => setPickerProject(null)}
        />
      )}
      <CollectionEditModal collection={editingCol} onClose={() => setEditingCol(null)} />
      {viewEditor !== null && (
        <CustomViewModal
          key={viewEditor.initial?.id ?? 'new'}
          initial={viewEditor.initial}
          onClose={() => setViewEditor(null)}
        />
      )}
    </div>
  );
}

function viewTitle(key: string): string {
  switch (key) {
    // 缺这两个映射时标签标题会显示成字面量 "recent" / "pinned"（侧栏点「最近打开」就会出现）
    case 'all':
      return '工作台总览';
    case 'recent':
      return '最近打开';
    case 'pinned':
      return '已固定';
    case 'my-dirty':
      return '有未提交改动';
    case 'my-nodocs':
      return '缺文档';
    case 'my-noarch':
      return '缺架构图';
    case 'my-unanalyzed':
      return '未分析';
    case 'my-stale':
      return '30 天没打开';
    case 'my-archived':
      return '已归档';
    default:
      return key;
  }
}
