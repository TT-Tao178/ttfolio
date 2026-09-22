/** 工作台总览（FR-2.1/2.8/4.11/9.3/11.x）：卡片墙 + 表格视图 + 我的视图 + 添加项目。 */
import {
  Avatar, Button, Card, Dropdown, Empty, Input, Modal, Segmented, Select, Space, Table, Tag, Tooltip, App
} from 'antd';
import {
  PlusOutlined, ReloadOutlined, FolderOpenOutlined, CopyOutlined, FileTextOutlined,
  BranchesOutlined, MoreOutlined, StarFilled, StarOutlined, WarningOutlined
} from '@ant-design/icons';
import React, { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError } from '@/lib/api';
import type { ProjectSummary } from '@ttfolio/shared';
import { useAppStore } from '@/app/store';
import { useSettings } from '@/app/settings';
import { LanguageBar } from '@/components/LanguageBar';
import { Dashboard } from './Dashboard';
import { StateView } from '@/components/StateView';
import { fmtBytes, relTime } from '@/lib/format';
import { typeLabel } from '@/components/DetailPanel';
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
  const { message } = App.useApp();

  // 顶栏/总览「添加项目」信号：nonce 变化即打开弹窗（模块级 lastAddNonce 保证"只消费一次"——
  // 若用组件内 ref，切到项目页再回总览会因 nonce 仍 >0 而弹出上次的弹窗）。
  const addProjectNonce = useAppStore((s) => s.addProjectNonce);
  useEffect(() => {
    if (addProjectNonce > lastAddNonce) {
      lastAddNonce = addProjectNonce;
      setAddOpen(true);
    }
  }, [addProjectNonce]);

  const pinnedOnly = subTab === 'view:pinned';
  const filters = parseSubTab(subTab);
  const { data: allProjects, isLoading, error } = useQuery({
    queryKey: ['projects', filters, q, sort],
    queryFn: () => api.get<ProjectSummary[]>('/api/projects', { ...filters, q, sort })
  });

  const projects = (allProjects ?? []).filter((p) => !pinnedOnly || p.isPinned);

  const openProjectTab = (p: ProjectSummary): void => {
    // 默认落点跟随设置 default_project_tab（原先硬编码 files，设置里改了不生效）
    const sub = settings.defaultProjectTab === 'overview' ? 'overview' : 'files';
    useAppStore.getState().openTab({ kind: 'project', projectId: p.id, targetPath: null, subTab: sub, scroll: 0 }, p.alias ?? p.diskName);
    void api.post(`/api/projects/${p.id}/open`);
  };

  const pin = useMutation({
    mutationFn: (p: ProjectSummary) => api.patch(`/api/projects/${p.id}`, { rev: p.rev, isPinned: !p.isPinned }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (e) => void message.error(e instanceof ApiClientError ? e.message : '操作失败')
  });

  const analyze = useMutation({
    mutationFn: (ids: string[]) => api.post('/api/projects/analyze', { projectIds: ids }),
    onSuccess: () => void message.success('已开始重新分析')
  });

  const columns = [
    { title: '名称', dataIndex: 'diskName', render: (_: unknown, p: ProjectSummary) => (p.alias ?? p.diskName) + (p.alias !== null ? '（别名）' : '') },
    { title: '类型', dataIndex: 'type', render: (t: string) => typeLabel(t) },
    { title: '主语言', dataIndex: 'primaryLanguage', render: (v: string | null) => v ?? '—' },
    { title: '规模', dataIndex: 'sizeBytes', render: (v: number, p: ProjectSummary) => `${p.fileCount} / ${fmtBytes(v)}` },
    { title: 'Git', render: (_: unknown, p: ProjectSummary) => (p.gitIsRepo ? `${p.gitBranch ?? ''}${p.gitDirty ? ' *' : ''}` : '—') },
    { title: '最近打开', dataIndex: 'lastOpenedAt', render: (v: string | null) => relTime(v) },
    { title: '操作', render: (_: unknown, p: ProjectSummary) => <a onClick={() => openProjectTab(p)}>打开</a> }
  ];

  return (
    <div style={{ padding: 16, height: '100%', overflow: 'auto' }} data-testid="workbench">
      {/* 工作台总览（subTab=null）与卡片墙是两个屏：前者回答"哪里需要我"，后者用于筛选/浏览项目 */}
      {subTab === null ? (
        <>
          <Dashboard />
          <AddProjectModal open={addOpen} onClose={() => setAddOpen(false)} />
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
        <Select value={sort} onChange={(v) => { sortTouched.current = true; setSort(v); }} style={{ width: 140 }}
          options={[
            { value: 'last_opened', label: '最近打开' },
            { value: 'last_commit', label: '最近提交' },
            { value: 'name', label: '名称' },
            { value: 'size', label: '体积' }
          ]}
        />
        <Segmented options={[{ label: '卡片', value: 'card' }, { label: '表格', value: 'table' }]} value={view} onChange={(v) => setView(v as 'card' | 'table')} />
        <div style={{ flex: 1 }} />
        <Tooltip title="重建分析（全部项目）">
          <Button icon={<ReloadOutlined />} onClick={() => analyze.mutate([])} />
        </Tooltip>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)} data-testid="add-project-btn">
          添加项目
        </Button>
      </div>
      <StateView loading={isLoading} error={error} empty={(projects ?? []).length === 0} emptyText="还没有登记任何项目" emptyAction={{ label: '添加第一个项目', onClick: () => setAddOpen(true) }}>
        {view === 'card' ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 12 }}>
            {(projects ?? []).map((p) => (
              <ProjectCard key={p.id} p={p} onOpen={() => openProjectTab(p)} onPin={() => pin.mutate(p)} onAnalyze={() => analyze.mutate([p.id])} />
            ))}
          </div>
        ) : (
          <Table rowKey="id" columns={columns} dataSource={projects ?? []} size="middle" pagination={{ pageSize: 30 }} />
        )}
      </StateView>
      <AddProjectModal open={addOpen} onClose={() => setAddOpen(false)} />
        </>
      )}
    </div>
  );
}

function ProjectCard({ p, onOpen, onPin, onAnalyze }: {
  p: ProjectSummary; onOpen: () => void; onPin: () => void; onAnalyze: () => void;
}): React.JSX.Element {
  const { message } = App.useApp();
  const queryClient2 = useQueryClient();
  const remove = useMutation({
    mutationFn: (mode: string) => api.del(`/api/projects/${p.id}${mode === 'delete' ? '?mode=delete&confirm=1' : '?mode=unregister'}`),
    onSuccess: () => {
      void message.success('已移除');
      void queryInvalidate();
    }
  });
  const queryInvalidate = async (): Promise<void> => {
    await queryClient2.invalidateQueries({ queryKey: ['projects'] });
  };

  const menu = {
    items: [
      { key: 'open', label: '打开项目', icon: <FolderOpenOutlined />, onClick: onOpen },
      { key: 'files', label: '打开文件页', icon: <FileTextOutlined />, onClick: onOpen },
      { key: 'git', label: '查看 Git', icon: <BranchesOutlined />, disabled: !p.gitIsRepo, onClick: () => useAppStore.getState().openTab({ kind: 'project', projectId: p.id, targetPath: null, subTab: 'git', scroll: 0 }, p.alias ?? p.diskName) },
      { type: 'divider' as const },
      { key: 'copy', label: '复制路径', icon: <CopyOutlined />, onClick: () => { void navigator.clipboard.writeText(p.dirPath); void message.success('已复制路径'); } },
      { key: 'explorer', label: '在资源管理器中显示', onClick: () => { void api.post('/api/open', { target: 'explorer', projectId: p.id }); } },
      { key: 'terminal', label: '在此打开终端', onClick: () => { void api.post('/api/open', { target: 'terminal', projectId: p.id }); } },
      { type: 'divider' as const },
      { key: 'analyze', label: '重新分析', icon: <ReloadOutlined />, onClick: onAnalyze },
      { key: 'pin', label: p.isPinned ? '取消固定' : '固定', icon: p.isPinned ? <StarFilled /> : <StarOutlined />, onClick: onPin },
      { type: 'divider' as const },
      { key: 'unregister', label: '仅从 ttFolio 移除登记', danger: false, onClick: () => remove.mutate('unregister') },
      { key: 'delete', label: '移除并删除文件（进回收站）', danger: true, onClick: () => remove.mutate('delete') }
    ]
  };

  return (
    <Card
      hoverable
      size="small"
      style={{ borderColor: p.pathOk ? undefined : SEMANTIC.error }}
      onClick={onOpen}
      data-testid="project-card"
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, maxWidth: '100%' }}>
          <Avatar style={{ background: SEMANTIC.primary, flexShrink: 0 }} size={24}>
            {(p.alias ?? p.diskName).charAt(0).toUpperCase()}
          </Avatar>
          <span className="tt-ellipsis">{p.alias ?? p.diskName}</span>
          {p.alias !== null && <Tag style={{ flexShrink: 0 }}>别名</Tag>}
          <Tag style={{ flexShrink: 0 }} color="blue">{typeLabel(p.type)}</Tag>
        </span>
      }
      extra={
        <Dropdown menu={menu} trigger={['contextMenu', 'click']}>
          <MoreOutlined onClick={(e) => e.stopPropagation()} />
        </Dropdown>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <LanguageBar languages={p.languages} />
        <div style={{ fontSize: 12, opacity: 0.75 }}>
          {p.primaryLanguage ?? '未分析'}
          {p.languages.length > 0 && ` · ${p.languages[0]?.percent}%`}
        </div>
        <div>
          {p.techStack.slice(0, 3).map((t) => (
            <Tag key={t} style={{ marginRight: 4 }}>{t}</Tag>
          ))}
          {p.techStack.length > 3 && <Tag>+{p.techStack.length - 3}</Tag>}
        </div>
        <div style={{ fontSize: 12, opacity: 0.75, display: 'flex', gap: 8, alignItems: 'center' }}>
          <span>{p.gitIsRepo ? `${p.gitBranch ?? ''}${p.gitDirty ? ' ⚠有改动' : ' ✓干净'}` : '非 git'}</span>
          <span>{relTime(p.gitLastCommitAt)}</span>
        </div>
        <div style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
          <Tag color={p.hasDocs ? 'success' : 'default'}>文档{p.hasDocs ? ' ✓' : ' ✗'}</Tag>
          <Tag color={p.hasArch ? 'success' : 'default'}>架构图{p.hasArch ? ' ✓' : ' ✗'}</Tag>
          {p.pathOk === false && <Tag color="error" icon={<WarningOutlined />}>路径失效</Tag>}
          {p.isPinned && <Tag icon={<StarFilled />}>已固定</Tag>}
          {p.status === 'archived' && <Tag>已归档</Tag>}
        </div>
        <div style={{ fontSize: 12, opacity: 0.6 }}>
          {relTime(p.lastOpenedAt)} · 打开 {p.openCount} 次
        </div>
      </div>
    </Card>
  );
}

function AddProjectModal({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element {
  const [text, setText] = useState('');
  const [parentPath, setParentPath] = useState('');
  const [children, setChildren] = useState<Array<{ name: string; path: string; registered: boolean; checked: boolean }>>([]);
  const { message } = App.useApp();
  const queryClient = useQueryClient();

  const add = useMutation({
    mutationFn: (body: unknown) => api.post<{ added: string[]; skipped: Array<{ path: string; reason: string }> }>('/api/projects', body),
    onSuccess: (r) => {
      if (r.added.length > 0) {
        void message.success(`已登记 ${r.added.length} 个项目，正在分析…`);
        // 登记成功后切到卡片墙：否则停在总览屏看不到刚登记的项目（"添加了但没反应"）。
        const st = useAppStore.getState();
        const cur = st.tabs.find((t) => t.id === st.activeTabId);
        if (cur?.kind === 'overview') st.updateActiveLocation({ subTab: 'view:all' }, true);
        else st.openTab({ kind: 'overview', projectId: null, targetPath: null, subTab: 'view:all', scroll: 0 }, '工作台');
      }
      for (const s of r.skipped) void message.warning(`跳过 ${s.path}：${s.reason}`);
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      onClose();
      setText('');
    },
    onError: (e) => void message.error(e instanceof ApiClientError ? e.message : '登记失败')
  });

  const pickFolder = async (): Promise<void> => {
    try {
      const r = await api.post<{ paths: string[] }>('/api/dialogs/pick-folder');
      if (r.paths.length > 0) setText(r.paths.join('\n'));
    } catch {
      void message.error('打开系统对话框失败，请粘贴路径');
    }
  };

  const browseParent = async (): Promise<void> => {
    try {
      const r = await api.post<{ paths: string[] }>('/api/dialogs/pick-folder');
      if (r.paths.length > 0) setParentPath(r.paths[0] ?? '');
    } catch {
      void message.error('打开系统对话框失败');
    }
  };

  const loadChildren = async (): Promise<void> => {
    if (parentPath === '') return;
    try {
      const r = await api.get<{ path: string; children: Array<{ name: string; path: string; registered: boolean }> }>('/api/folders/children', { path: parentPath });
      setChildren(r.children.map((c) => ({ ...c, checked: !c.registered })));
    } catch (e) {
      void message.error(e instanceof ApiClientError ? e.message : '读取子目录失败');
    }
  };

  return (
    <Modal
      title="添加项目"
      open={open}
      onCancel={onClose}
      footer={null}
      width={640}
      data-testid="add-project-modal"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div>
          <div style={{ marginBottom: 6 }}>① 粘贴路径（支持多行、带引号、\\?\ 前缀）</div>
          <Input.TextArea
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'D:\\code\\project-a\n"D:\\code\\project b"'}
            data-testid="paste-paths"
          />
          <Space style={{ marginTop: 8 }}>
            <Button onClick={() => void pickFolder()}>系统对话框选择…</Button>
            <Button type="primary" disabled={text.trim() === ''} data-testid="paste-add-btn" onClick={() => add.mutate({ paths: text.split(/\r?\n/) })}>
              登记以上目录
            </Button>
          </Space>
        </div>
        <div>
          <div style={{ marginBottom: 6 }}>② 从父目录批量登记</div>
          <Space.Compact style={{ width: '100%' }}>
            <Input value={parentPath} onChange={(e) => setParentPath(e.target.value)} placeholder="父目录路径" />
            <Button onClick={() => void browseParent()}>选择…</Button>
            <Button onClick={() => void loadChildren()}>载入子目录</Button>
          </Space.Compact>
          {children.length > 0 && (
            <div style={{ marginTop: 8, maxHeight: 200, overflow: 'auto', border: `1px solid ${SEMANTIC.split}`, borderRadius: 6, padding: 8 }}>
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
                    children: children.filter((c) => c.checked && !c.registered).map((c) => c.name)
                  })
                }
              >
                登记勾选的 {children.filter((c) => c.checked && !c.registered).length} 个目录
              </Button>
            </div>
          )}
        </div>
        <div style={{ fontSize: 12, opacity: 0.65 }}>
          提示：从系统资源管理器拖拽文件夹到本窗口也可添加（浏览器安全限制下会先按名称定位，请确认路径后登记）。
        </div>
      </div>
    </Modal>
  );
}

export function parseSubTab(subTab: string | null): Record<string, string> {
  if (subTab === null) return { status: 'active' };
  if (subTab === 'view:recent') return { status: 'active', sort: 'last_opened' };
  if (subTab === 'view:pinned') return { status: 'active' };
  if (subTab.startsWith('view:my-')) {
    const key = subTab.slice(8);
    switch (key) {
      case 'dirty': return { status: 'active', dirty: '1' };
      case 'nodocs': return { status: 'active', hasDocs: '0' };
      case 'noarch': return { status: 'active', hasArch: '0' };
      case 'unanalyzed': return { status: 'active', analyzed: '0' };
      case 'stale': return { status: 'active', stale: '30' };
      case 'archived': return { status: 'archived' };
      default: return { status: 'active' };
    }
  }
  if (subTab.startsWith('col:')) return { status: 'active' };
  if (subTab.startsWith('{')) {
    try {
      return JSON.parse(subTab) as Record<string, string>;
    } catch {
      return { status: 'active' };
    }
  }
  return { status: 'active' };
}

export function Empty_(props: { text: string }): React.JSX.Element {
  return <Empty description={props.text} />;
}
