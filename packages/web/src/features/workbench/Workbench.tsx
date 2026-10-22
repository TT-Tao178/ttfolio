/** 工作台总览（FR-2.1/2.8/4.11/9.3/11.x）：卡片墙 + 表格视图 + 我的视图 + 添加项目。 */
import {
  Button,
  Dropdown,
  Empty,
  Input,
  Menu,
  Modal,
  Segmented,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  App,
} from 'antd';
import { InboxOutlined, MoreOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import React, { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError } from '@/lib/api';
import type { CollectionInfo, ProjectSummary } from '@ttfolio/shared';
import { useAppStore, useTabScroll } from '@/app/store';
import { useSettings } from '@/app/settings';
import { Dashboard } from './Dashboard';
import { ProjectCard } from './ProjectCard';
import { StateView } from '@/components/StateView';
import { fmtBytes, relTime } from '@/lib/format';
import { typeLabel } from '@/components/DetailPanel';
import { RelocateModal } from './RelocateModal';
import { CollectionPickerModal } from './CollectionPickerModal';
import { buildProjectMenu, useArchiveProject, downloadProjectReport } from './projectMenu';
import { parseSubTab } from './parseSubTab';
import { BatchActionBar } from './BatchActionBar';
export { parseSubTab };
import { SEMANTIC } from '@/theme/tokens';

/** 已消费过的「添加项目」信号值：跨挂载保留，避免重新挂载时重复弹窗。 */
let lastAddNonce = 0;

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
  const [addOpen, setAddOpen] = useState(false);
  const queryClient = useQueryClient();

  // 顶栏/总览「添加项目」信号：nonce 变化即打开弹窗（模块级 lastAddNonce 保证"只消费一次"——
  // 若用组件内 ref，切到项目页再回总览会因 nonce 仍 >0 而弹出上次的弹窗）。
  const addProjectNonce = useAppStore((s) => s.addProjectNonce);
  useEffect(() => {
    if (addProjectNonce > lastAddNonce) {
      lastAddNonce = addProjectNonce;
      setAddOpen(true);
    }
  }, [addProjectNonce]);

  // ---- 表格视图的项目操作（评审 P2：此前操作列只有「打开」、行无右键，与卡片不对等）----
  // 菜单定义/分发与卡片共用 buildProjectMenu；确认类动作在此注入（确认弹窗与请求归本组件）
  const { message, modal } = App.useApp();
  const [pickerProject, setPickerProject] = useState<ProjectSummary | null>(null);
  const [relocateProject, setRelocateProject] = useState<ProjectSummary | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; projectId: string } | null>(null);
  // 批量多选（FR-13.10 / T-107）：卡片 Ctrl+点选 / 勾选角标与表格行选择框共享同一份选中集
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const toggleSelect = (id: string): void =>
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const pinnedOnly = subTab === 'view:pinned';
  const filters = parseSubTab(subTab, settings.customViews);
  // 集合视图标识：传给「添加项目」弹窗，登记成功后项目随即加入该集合（0.3.5 修复）
  const collectionId = filters['collection'] ?? null;
  const {
    data: allProjects,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['projects', filters, q, sort],
    queryFn: () => api.get<ProjectSummary[]>('/api/projects', { ...filters, q, sort }),
  });

  const projects = (allProjects ?? []).filter((p) => !pinnedOnly || p.isPinned);

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

  // 移除登记/移除并删除（与 ProjectCard 同款语义；确认弹窗在 confirmXxx 内）
  const remove = useMutation({
    mutationFn: ({ p, mode }: { p: ProjectSummary; mode: string }) =>
      api.del(`/api/projects/${p.id}${mode === 'delete' ? '?mode=delete&confirm=1' : '?mode=unregister'}`),
    onSuccess: () => {
      void message.success('已移除');
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (e) => void message.error(e instanceof ApiClientError ? e.message : '操作失败'),
  });
  const confirmUnregister = (p: ProjectSummary): void => {
    modal.confirm({
      title: `仅移除「${p.alias ?? p.diskName}」的登记？`,
      content: '只删除 ttFolio 里的索引记录，不会动磁盘上的任何文件。之后可重新添加。',
      okText: '移除登记',
      okButtonProps: { danger: true },
      onOk: () => remove.mutateAsync({ p, mode: 'unregister' }),
    });
  };
  const confirmDelete = (p: ProjectSummary): void => {
    modal.confirm({
      title: `移除登记并删除「${p.alias ?? p.diskName}」的文件？`,
      content: '整个项目目录将移入 ttFolio 回收站（可在回收站恢复原路径）。',
      okText: '移入回收站',
      okButtonProps: { danger: true },
      onOk: () => remove.mutateAsync({ p, mode: 'delete' }),
    });
  };

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
      onUnregister: () => confirmUnregister(p),
      onDelete: () => confirmDelete(p),
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
    <div ref={wbRef} style={{ padding: 16, height: '100%', overflow: 'auto' }} data-testid="workbench">
      {/* 工作台总览（subTab=null）与卡片墙是两个屏：前者回答"哪里需要我"，后者用于筛选/浏览项目 */}
      {subTab === null ? (
        <>
          <Dashboard />
          <AddProjectModal open={addOpen} onClose={() => setAddOpen(false)} collectionId={collectionId} />
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
            <div style={{ flex: 1 }} />
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
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => setAddOpen(true)}
              data-testid="add-project-btn"
            >
              添加项目
            </Button>
          </div>
          <StateView
            loading={isLoading}
            error={error}
            empty={(projects ?? []).length === 0}
            emptyText="还没有登记任何项目"
            emptyAction={{ label: '添加第一个项目', onClick: () => setAddOpen(true) }}
          >
            {view === 'card' ? (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                  gap: 12,
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
                    selectMode={selectedIds.length > 0}
                    onToggleSelect={() => toggleSelect(p.id)}
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
                rowSelection={{
                  selectedRowKeys: selectedIds,
                  onChange: (keys) => setSelectedIds(keys as string[]),
                }}
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
          <AddProjectModal open={addOpen} onClose={() => setAddOpen(false)} collectionId={collectionId} />
          {selectedIds.length > 0 && (
            <BatchActionBar selectedIds={selectedIds} onClear={() => setSelectedIds([])} />
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
  );
}

function AddProjectModal({
  open,
  onClose,
  collectionId = null,
}: {
  open: boolean;
  onClose: () => void;
  /** 集合视图传入：登记成功后项目随即加入该集合（追加语义，不影响其他成员） */
  collectionId?: string | null;
}): React.JSX.Element {
  const [text, setText] = useState('');
  const [parentPath, setParentPath] = useState('');
  const [children, setChildren] = useState<
    Array<{ name: string; path: string; registered: boolean; checked: boolean }>
  >([]);
  const [picking, setPicking] = useState(false);
  const [browsing, setBrowsing] = useState(false);
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  // 集合上下文仅用于展示与登记后入集：名字取 ['collections'] 缓存（与侧栏共享，未加载时降级中性文案）
  const { data: collections } = useQuery({
    queryKey: ['collections'],
    queryFn: () => api.get<CollectionInfo[]>('/api/collections'),
    enabled: open && collectionId !== null,
  });
  const collectionName =
    collectionId !== null ? (collections ?? []).find((c) => c.id === collectionId)?.name : undefined;

  const add = useMutation({
    mutationFn: async (body: unknown) => {
      const r = await api.post<{ added: string[]; skipped: Array<{ path: string; reason: string }> }>(
        '/api/projects',
        body,
      );
      // 集合上下文（修复：集合视图里「添加项目」此前只进公共池不进集合）：
      // 登记成功即加入当前集合——members 为追加语义，不影响集合已有成员
      let joined = false;
      if (collectionId !== null && r.added.length > 0) {
        try {
          await api.post(`/api/collections/${collectionId}/members`, { projectIds: r.added });
          joined = true;
        } catch {
          joined = false;
        }
      }
      return { ...r, joined };
    },
    onSuccess: (r) => {
      if (r.added.length > 0) {
        if (collectionId !== null) {
          if (r.joined) void message.success(`已登记 ${r.added.length} 个项目并加入集合，正在分析…`);
          else void message.warning('项目已登记，但加入集合失败——可稍后在项目右键「归属集合…」中补加', 5);
        } else {
          void message.success(`已登记 ${r.added.length} 个项目，正在分析…`);
          // 登记成功后切到卡片墙：否则停在总览屏看不到刚登记的项目（"添加了但没反应"）。
          // 集合视图不切走：登记结果直接体现在当前集合卡片墙（invalidate 后新卡片出现）
          const st = useAppStore.getState();
          const cur = st.tabs.find((t) => t.id === st.activeTabId);
          if (cur?.kind === 'overview') st.updateActiveLocation({ subTab: 'view:all' }, true);
          else
            st.openTab(
              { kind: 'overview', projectId: null, targetPath: null, subTab: 'view:all', scroll: 0 },
              '工作台',
            );
        }
        void queryClient.invalidateQueries({ queryKey: ['collections'] });
      }
      for (const s of r.skipped) void message.warning(`跳过 ${s.path}：${s.reason}`);
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      onClose();
      setText('');
    },
    onError: (e) => void message.error(e instanceof ApiClientError ? e.message : '登记失败'),
  });

  const pickFolder = async (): Promise<void> => {
    setPicking(true);
    try {
      // 对话框由服务端弹出（可能有几百毫秒延迟），必须立刻给提示，否则像"点了没反应"；
      // 后台进程弹的系统对话框可能被浏览器压在后面（Win11 前台锁定），提示里带 Alt+Tab 指引
      void message.info('正在弹出系统对话框；若被其他窗口挡住，请按 Alt+Tab 查看', 5);
      const r = await api.post<{ paths: string[] }>('/api/dialogs/pick-folder');
      if (r.paths.length > 0) setText(r.paths.join('\n'));
      else void message.info('未选择目录');
    } catch {
      void message.error('打开系统对话框失败，请粘贴路径');
    } finally {
      setPicking(false);
    }
  };

  const browseParent = async (): Promise<void> => {
    setBrowsing(true);
    try {
      void message.info('正在弹出系统对话框选择父目录；若被其他窗口挡住，请按 Alt+Tab 查看', 5);
      const r = await api.post<{ paths: string[] }>('/api/dialogs/pick-folder');
      if (r.paths.length > 0) setParentPath(r.paths[0] ?? '');
      else void message.info('未选择目录');
    } catch {
      void message.error('打开系统对话框失败');
    } finally {
      setBrowsing(false);
    }
  };

  const loadChildren = async (): Promise<void> => {
    if (parentPath === '') return;
    try {
      const r = await api.get<{
        path: string;
        children: Array<{ name: string; path: string; registered: boolean }>;
      }>('/api/folders/children', { path: parentPath });
      setChildren(r.children.map((c) => ({ ...c, checked: !c.registered })));
    } catch (e) {
      void message.error(e instanceof ApiClientError ? e.message : '读取子目录失败');
    }
  };

  return (
    <Modal
      title={collectionId !== null ? `添加项目到「${collectionName ?? '集合'}」` : '添加项目'}
      open={open}
      onCancel={onClose}
      footer={null}
      width={640}
      data-testid="add-project-modal"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div style={{ marginBottom: 6 }}>
            ① 添加单个项目（粘贴项目文件夹路径）——也支持一次粘贴多行批量登记，可带引号、\\?\ 前缀
          </div>
          <Input.TextArea
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'D:\\code\\project-a\n"D:\\code\\project b"'}
            data-testid="paste-paths"
          />
          <Space style={{ marginTop: 8 }}>
            <Button loading={picking} onClick={() => void pickFolder()}>
              系统对话框选择…
            </Button>
            <Button
              type="primary"
              disabled={text.trim() === ''}
              data-testid="paste-add-btn"
              onClick={() => add.mutate({ paths: text.split(/\r?\n/) })}
            >
              登记以上目录
            </Button>
          </Space>
        </div>
        <div>
          <div style={{ marginBottom: 6 }}>
            ② 批量登记（选一个父目录，扫描其下的子文件夹，一次登记多个项目）
          </div>
          <Space.Compact style={{ width: '100%' }}>
            <Input
              value={parentPath}
              onChange={(e) => setParentPath(e.target.value)}
              placeholder="父目录路径"
            />
            <Button loading={browsing} onClick={() => void browseParent()}>
              选择…
            </Button>
            <Button onClick={() => void loadChildren()}>载入子目录</Button>
          </Space.Compact>
          {children.length > 0 && (
            <div
              style={{
                marginTop: 8,
                maxHeight: 200,
                overflow: 'auto',
                border: `1px solid ${SEMANTIC.split}`,
                borderRadius: 6,
                padding: 8,
              }}
            >
              {children.map((c, i) => (
                <label key={c.path} style={{ display: 'block' }}>
                  <input
                    type="checkbox"
                    checked={c.checked}
                    disabled={c.registered}
                    onChange={(e) => {
                      const next = [...children];
                      const cur = next[i];
                      if (cur !== undefined) next[i] = { ...cur, checked: e.target.checked };
                      setChildren(next);
                    }}
                  />{' '}
                  {c.name}
                  {c.registered && <Tag style={{ marginLeft: 6 }}>已登记</Tag>}
                </label>
              ))}
              <Button
                type="primary"
                size="small"
                style={{ marginTop: 8 }}
                onClick={() =>
                  add.mutate({
                    parentPath,
                    children: children.filter((c) => c.checked && !c.registered).map((c) => c.name),
                  })
                }
              >
                登记勾选的 {children.filter((c) => c.checked && !c.registered).length} 个目录
              </Button>
            </div>
          )}
        </div>
        <div style={{ fontSize: 12, opacity: 0.65 }}>
          提示：浏览器安全限制拿不到拖拽文件夹的绝对路径，拖拽添加暂不可用——请用上方三种入口（粘贴路径 /
          系统对话框 / 父目录批量登记）。
        </div>
      </div>
    </Modal>
  );
}

export function Empty_(props: { text: string }): React.JSX.Element {
  return <Empty description={props.text} />;
}
