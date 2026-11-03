/** 工作台总览（FR-2.1/2.8/4.11/9.3/11.x）：卡片墙 + 表格视图 + 我的视图。
 *  「添加项目」弹窗在 ./AddProjectModal（App 层挂载）。 */
import { Button, Checkbox, Dropdown, Empty, Input, Menu, Segmented, Select, Table, Tooltip, App } from 'antd';
import {
  CheckSquareOutlined,
  InboxOutlined,
  MoreOutlined,
  PlusOutlined,
  ReloadOutlined,
  UserAddOutlined,
} from '@ant-design/icons';
import React, { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError } from '@/lib/api';
import type { ProjectSummary } from '@ttfolio/shared';
import { useAppStore, useTabScroll } from '@/app/store';
import { useSettings } from '@/app/settings';
import { Dashboard } from './Dashboard';
import { ProjectCard } from './ProjectCard';
import { StateView } from '@/components/StateView';
import { fmtBytes, relTime } from '@/lib/format';
import { typeLabel } from '@/components/DetailPanel';
import { RelocateModal } from './RelocateModal';
import { CollectionPickerModal } from './CollectionPickerModal';
import { CollectionAddMembersModal } from './CollectionAddMembersModal';
import { ProjectAvatarModal } from './ProjectAvatarModal';
import { buildProjectMenu, useArchiveProject, useRemoveProject, downloadProjectReport } from './projectMenu';
import { parseSubTab } from './parseSubTab';
import { BatchActionBar } from './BatchActionBar';
export { parseSubTab };
import { SEMANTIC } from '@/theme/tokens';

export function Workbench({ subTab }: { subTab: string | null }): React.JSX.Element {
  const { settings } = useSettings();
  const [view, setView] = useState<'card' | 'table'>('card');
  const [q, setQ] = useState('');
  // 排序默认值来自设置（card_sort）；用户在本页改过之后不再被设置回冲
  const [sort, setSort] = useState(settings.cardSort);
  const sortTouched = useRef(false);
  useEffect(() => {
    if (!sortTouched.current) setSort(settings.cardSort);
  }, [settings.cardSort]);
  // T-130：集合视图「从已登记项目中添加」弹窗开关（仅 collectionId 非空时可开）
  const [addMembersOpen, setAddMembersOpen] = useState(false);
  const queryClient = useQueryClient();

  // 「添加项目」弹窗已提升到 App 层（2026-11-03，AddProjectModal.tsx）：任意屏可用，
  // 这里各入口经 requestAddProject(collectionId) 发信号，集合上下文一并携带。

  // ---- 表格视图的项目操作（评审 P2：此前操作列只有「打开」、行无右键，与卡片不对等）----
  // 菜单定义/分发与卡片共用 buildProjectMenu；确认类动作在此注入（确认弹窗与请求归本组件）
  const { message } = App.useApp();
  const [pickerProject, setPickerProject] = useState<ProjectSummary | null>(null);
  const [relocateProject, setRelocateProject] = useState<ProjectSummary | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; projectId: string } | null>(null);
  // 批量多选（FR-13.10 / T-107；第 90 轮收敛为显式选择模式，用户 2026-10-31 点名）：
  // 右上角「选择」按钮进入；非模式零选择入口（无 hover 复选框、Ctrl+点即打开）。
  // 卡片点选 / 表格行选择框共享同一份选中集；Shift+点击从锚点做范围选（T-128 同手势）。
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  const selectAnchorRef = useRef<string | null>(null);
  const exitSelect = (): void => {
    setSelectMode(false);
    setSelectedIds([]);
    selectAnchorRef.current = null;
  };

  const pinnedOnly = subTab === 'view:pinned';
  const filters = parseSubTab(subTab, settings.customViews);
  // 集合视图标识：传给「添加项目」弹窗，登记成功后项目随即加入该集合（0.3.5 修复）
  const collectionId = filters['collection'] ?? null;
  // 父子集合（FR-15.1）：集合视图默认含全部子孙集合的项目；开关切换改写当前标签 subTab
  const includeChildren = collectionId === null ? false : filters['includeChildren'] !== '0';
  const {
    data: allProjects,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['projects', filters, q, sort],
    queryFn: () => api.get<ProjectSummary[]>('/api/projects', { ...filters, q, sort }),
  });

  const projects = (allProjects ?? []).filter((p) => !pinnedOnly || p.isPinned);

  // 范围选（Shift）：以当前视图顺序（projects）为准；普通点击更新锚点
  const toggleSelect = (id: string, opts?: { shift?: boolean }): void => {
    if (opts?.shift === true && selectAnchorRef.current !== null) {
      const ids = projects.map((p) => p.id);
      const a = ids.indexOf(selectAnchorRef.current);
      const b = ids.indexOf(id);
      if (a !== -1 && b !== -1) {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        setSelectedIds((prev) => Array.from(new Set([...prev, ...ids.slice(lo, hi + 1)])));
        return;
      }
    }
    selectAnchorRef.current = id;
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  const allIds = projects.map((p) => p.id);
  const allSelected = projects.length > 0 && allIds.every((id) => selectedIds.includes(id));

  const openProjectTab = (p: ProjectSummary): void => {
    // 默认落点跟随设置 default_project_tab（原先硬编码 files，设置里改了不生效）
    const sub = settings.defaultProjectTab === 'overview' ? 'overview' : 'files';
    if (sub === 'files') useAppStore.getState().requestAutoOpenProject(p.id);
    useAppStore
      .getState()
      .openTab(
        { kind: 'project', projectId: p.id, targetPath: null, subTab: sub, scroll: 0 },
        p.alias ?? p.diskName,
      );
    void api.post(`/api/projects/${p.id}/open`);
  };

  const pin = useMutation({
    mutationFn: (p: ProjectSummary) =>
      api.patch(`/api/projects/${p.id}`, { rev: p.rev, isPinned: !p.isPinned }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (e) => void message.error(e instanceof ApiClientError ? e.message : '操作失败'),
  });

  const analyze = useMutation({
    mutationFn: (ids: string[]) => api.post('/api/projects/analyze', { projectIds: ids }),
    onSuccess: () => void message.success('已开始重新分析'),
  });

  // 移除登记/移除并删除（T-129 收敛到共享 hook：与卡片菜单/侧栏右键同源，弹窗在 hook 内）
  const removeProject = useRemoveProject();
  // 项目头像（可选功能）：表格行菜单同样可设/清
  const clearAvatar = useMutation({
    mutationFn: (p: ProjectSummary) => api.del(`/api/projects/${p.id}/avatar`),
    onSuccess: () => {
      void message.success('已恢复默认首字母');
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (e) => void message.error(e instanceof ApiClientError ? e.message : '操作失败'),
  });
  const [avatarProject, setAvatarProject] = useState<ProjectSummary | null>(null);

  const openFilesTab = (p: ProjectSummary): void => {
    useAppStore.getState().requestAutoOpenProject(p.id);
    useAppStore
      .getState()
      .openTab(
        { kind: 'project', projectId: p.id, targetPath: null, subTab: 'files', scroll: 0 },
        p.alias ?? p.diskName,
      );
    void api.post(`/api/projects/${p.id}/open`);
  };
  const archiveProject = useArchiveProject();
  const menuFor = (p: ProjectSummary): ReturnType<typeof buildProjectMenu> =>
    buildProjectMenu(p, {
      onOpen: () => openProjectTab(p),
      onOpenFiles: () => openFilesTab(p),
      onPin: () => pin.mutate(p),
      onAnalyze: () => analyze.mutate([p.id]),
      onCollections: () => setPickerProject(p),
      onArchive: () => archiveProject(p),
      onRelocate: () => setRelocateProject(p),
      onUnregister: () => removeProject(p, 'unregister'),
      onDelete: () => removeProject(p, 'delete'),
      onSetAvatar: () => setAvatarProject(p),
      onClearAvatar: () => clearAvatar.mutate(p),
      onReport: () => {
        void downloadProjectReport(p)
          .then((m) => void message.success(m))
          .catch(() => void message.error('报告导出失败'));
      },
      message,
    });

  // 行右键菜单打开时，点击其它位置/滚动/Esc 关闭（与卡片受控菜单同款口径）
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

  const columns = [
    {
      title: '名称',
      dataIndex: 'diskName',
      render: (_: unknown, p: ProjectSummary) =>
        (p.alias ?? p.diskName) + (p.alias !== null ? '（别名）' : ''),
    },
    { title: '类型', dataIndex: 'type', render: (t: string) => typeLabel(t) },
    { title: '主语言', dataIndex: 'primaryLanguage', render: (v: string | null) => v ?? '—' },
    {
      title: '规模',
      dataIndex: 'sizeBytes',
      render: (v: number, p: ProjectSummary) => `${p.fileCount} / ${fmtBytes(v)}`,
    },
    {
      title: 'Git',
      render: (_: unknown, p: ProjectSummary) =>
        p.gitIsRepo ? `${p.gitBranch ?? ''}${p.gitDirty ? ' *' : ''}` : '—',
    },
    { title: '最近打开', dataIndex: 'lastOpenedAt', render: (v: string | null) => relTime(v) },
    {
      title: '操作',
      render: (_: unknown, p: ProjectSummary) => {
        const menu = menuFor(p);
        return (
          <span style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}>
            <a onClick={() => openProjectTab(p)}>打开</a>
            <Dropdown
              menu={{ items: menu.items, onClick: ({ key }) => menu.onAction(key) }}
              trigger={['click']}
            >
              <MoreOutlined style={{ cursor: 'pointer' }} />
            </Dropdown>
          </span>
        );
      },
    },
  ];

  // 标签滚动同步（0.3.8 补 KNOWN-GAPS #4）：滚动写回会话、切标签/视图回放
  const wbRef = useRef<HTMLDivElement>(null);
  const wbActiveTabId = useAppStore((s) => s.activeTabId);
  useTabScroll(wbRef, `${wbActiveTabId ?? ''}|${subTab ?? ''}`);

  return (
    // 2026-11-03（用户反馈「选择条不要浮动」）：根改 flex 列——内层滚动区 + 底部
    // 停靠 BatchActionBar（选择模式常驻贴底、不压内容、不再悬浮）；滚动还原 ref
    // 挂在内层滚动 div 上
    <div
      style={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}
      data-testid="workbench"
    >
      <div ref={wbRef} style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 16 }}>
        {/* 工作台总览（subTab=null）与卡片墙是两个屏：前者回答"哪里需要我"，后者用于筛选/浏览项目 */}
        {subTab === null ? (
          <>
            <Dashboard />
          </>
        ) : (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
              <Input.Search
                placeholder="搜索项目名 / 别名 / 路径 / 技术栈"
                allowClear
                style={{ width: 300 }}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <Select
                value={sort}
                onChange={(v) => {
                  sortTouched.current = true;
                  setSort(v);
                }}
                style={{ width: 140 }}
                options={[
                  { value: 'last_opened', label: '最近打开' },
                  { value: 'last_commit', label: '最近提交' },
                  { value: 'name', label: '名称' },
                  { value: 'size', label: '体积' },
                ]}
              />
              <Segmented
                options={[
                  { label: '卡片', value: 'card' },
                  { label: '表格', value: 'table' },
                ]}
                value={view}
                onChange={(v) => setView(v as 'card' | 'table')}
              />
              {/* 父子集合（FR-15.1）：集合视图专用——含子集合聚合开关，切换改写当前标签 */}
              {collectionId !== null && (
                <Checkbox
                  checked={includeChildren}
                  onChange={(e) => {
                    const next =
                      e.target.checked === true ? `col:${collectionId}` : `col:${collectionId}:direct`;
                    useAppStore.getState().updateActiveLocation({ subTab: next }, true);
                  }}
                >
                  含子集合
                </Checkbox>
              )}
              <div style={{ flex: 1 }} />
              {/* 显式选择模式（第 90 轮）：进入后卡片可点选/Shift 范围选，底条常驻 */}
              <Button
                type={selectMode ? 'primary' : 'default'}
                icon={<CheckSquareOutlined />}
                data-testid="select-mode-btn"
                onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
              >
                {selectMode ? '退出选择' : '选择'}
              </Button>
              <Tooltip title="重建分析（全部项目）">
                <Button icon={<ReloadOutlined />} onClick={() => analyze.mutate([])} />
              </Tooltip>
              {/* 归档的找回入口：归档后项目从卡片墙消失，这里进「已归档」视图（评审二.5 的闭环） */}
              <Tooltip title="已归档项目（查看 / 恢复）">
                <Button
                  icon={<InboxOutlined />}
                  data-testid="archived-view-btn"
                  onClick={() =>
                    useAppStore.getState().openTab(
                      {
                        kind: 'overview',
                        projectId: null,
                        targetPath: null,
                        subTab: 'view:my-archived',
                        scroll: 0,
                      },
                      '已归档',
                    )
                  }
                />
              </Tooltip>
              {/* T-130：集合视图专属——把已登记项目勾选加入本集合（与「添加项目」=登记新文件夹互补） */}
              {collectionId !== null && (
                <Tooltip title="把已登记的项目勾选加入本集合（不登记新文件夹）">
                  <Button
                    icon={<UserAddOutlined />}
                    onClick={() => setAddMembersOpen(true)}
                    data-testid="add-members-btn"
                  >
                    从已登记项目中添加
                  </Button>
                </Tooltip>
              )}
              <Button
                type="primary"
                icon={<PlusOutlined />}
                onClick={() => useAppStore.getState().requestAddProject(collectionId)}
                data-testid="add-project-btn"
              >
                添加项目
              </Button>
            </div>
            <StateView
              loading={isLoading}
              error={error}
              empty={(projects ?? []).length === 0}
              emptyText="还没有登记任何项目：① 粘贴路径 / 选文件夹 / 拖入文件夹（桌面版）登记 → ② 自动分析 → ③ 浏览 · Git · 搜索"
              emptyAction={{
                label: '添加第一个项目',
                onClick: () => useAppStore.getState().requestAddProject(collectionId),
              }}
            >
              {view === 'card' ? (
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                    gap: 16,
                  }}
                >
                  {(projects ?? []).map((p) => (
                    <ProjectCard
                      key={p.id}
                      p={p}
                      onOpen={() => openProjectTab(p)}
                      onPin={() => pin.mutate(p)}
                      onAnalyze={() => analyze.mutate([p.id])}
                      selected={selectedIds.includes(p.id)}
                      selectMode={selectMode}
                      onToggleSelect={(opts) => toggleSelect(p.id, opts)}
                      dragIds={selectMode === true && selectedIds.includes(p.id) ? selectedIds : [p.id]}
                    />
                  ))}
                </div>
              ) : (
                <Table
                  rowKey="id"
                  columns={columns}
                  dataSource={projects ?? []}
                  size="middle"
                  pagination={{ pageSize: 30 }}
                  rowSelection={
                    selectMode
                      ? {
                          selectedRowKeys: selectedIds,
                          onChange: (keys) => setSelectedIds(keys as string[]),
                        }
                      : undefined
                  }
                  onRow={(p) => ({
                    onContextMenu: (e) => {
                      e.preventDefault();
                      setCtxMenu({
                        x: Math.min(e.clientX, window.innerWidth - 232),
                        y: Math.min(e.clientY, Math.max(8, window.innerHeight - 520)),
                        projectId: p.id,
                      });
                    },
                  })}
                />
              )}
            </StateView>
            {addMembersOpen && collectionId !== null && (
              <CollectionAddMembersModal
                key={collectionId}
                collectionId={collectionId}
                onClose={() => setAddMembersOpen(false)}
              />
            )}
            {avatarProject !== null && (
              <ProjectAvatarModal
                key={avatarProject.id}
                project={avatarProject}
                onClose={() => setAvatarProject(null)}
              />
            )}
            {pickerProject !== null && (
              <CollectionPickerModal
                key={pickerProject.id}
                project={pickerProject}
                onClose={() => setPickerProject(null)}
              />
            )}
            {relocateProject !== null && (
              <RelocateModal
                projectId={relocateProject.id}
                name={relocateProject.alias ?? relocateProject.diskName}
                dirPath={relocateProject.dirPath}
                open
                onClose={() => setRelocateProject(null)}
              />
            )}
            {/* 表格行受控右键菜单：与卡片菜单同一份定义（projectMenu） */}
            {ctxMenu !== null &&
              (() => {
                const p = (projects ?? []).find((x) => x.id === ctxMenu.projectId);
                if (p === undefined) return null;
                const menu = menuFor(p);
                return (
                  <div
                    data-testid="table-row-ctx-menu"
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
                      items={menu.items}
                      onClick={({ key }) => {
                        setCtxMenu(null);
                        menu.onAction(key);
                      }}
                    />
                  </div>
                );
              })()}
          </>
        )}
      </div>
      {/* 选择模式底条：停靠在滚动区之下（组件级，与滚动内容不重叠） */}
      {selectMode && (
        <BatchActionBar
          selectedIds={selectedIds}
          onClear={() => setSelectedIds([])}
          onExit={exitSelect}
          onToggleAll={() => setSelectedIds(allSelected ? [] : allIds)}
          allSelected={allSelected}
        />
      )}
    </div>
  );
}

export function Empty_(props: { text: string }): React.JSX.Element {
  return <Empty description={props.text} />;
}
