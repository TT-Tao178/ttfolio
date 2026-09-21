/** 文件页签（FR-4.1..4.10）：懒加载树 + 编辑器/预览分流 + 新建/重命名/删除 + 文件名搜索。 */
import { Alert, Button, Empty, Input, Modal, Space, Switch, Tree, App } from 'antd';
import type { DataNode } from 'antd/es/tree';
import {
  FileOutlined, FolderOutlined, ReloadOutlined, SearchOutlined,
  FileAddOutlined, FolderAddOutlined
} from '@ant-design/icons';
import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError } from '@/lib/api';
import type { TreeNode } from '@ttfolio/shared';
import { useAppStore } from '@/app/store';
import { EditorPane } from './EditorPane';
import { ImagePreview } from './ImagePreview';

const GIT_COLORS: Record<string, string> = {
  modified: '#faad14',
  added: '#52c41a',
  untracked: '#52c41a',
  deleted: '#ff4d4f',
  renamed: '#1677ff',
  conflicted: '#ff4d4f'
};

export function FilesTab({ projectId }: { projectId: string }): React.JSX.Element {
  const [showIgnored, setShowIgnored] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [newEntry, setNewEntry] = useState<{ kind: 'file' | 'dir' } | null>(null);
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();

  const { data: rootData, isLoading, error, refetch } = useQuery({
    queryKey: ['tree', projectId, '', showIgnored],
    queryFn: () => api.get<{ path: string; nodes: TreeNode[] }>('/api/fs/tree', { projectId, path: '', showIgnored: showIgnored ? '1' : '0' })
  });
  const { data: searchData } = useQuery({
    queryKey: ['fssearch', projectId, filter],
    queryFn: () => api.get<{ results: Array<{ name: string; path: string; kind: string }> }>('/api/fs/search', { projectId, q: filter }),
    enabled: filter.length > 0
  });

  // 展开时懒加载
  const loadChildren = async (rel: string): Promise<void> => {
    const r = await api.get<{ path: string; nodes: TreeNode[] }>('/api/fs/tree', { projectId, path: rel, showIgnored: showIgnored ? '1' : '0' });
    const cacheKey = ['tree', projectId, rel, showIgnored];
    queryClient.setQueryData(cacheKey, r);
  };

  const treeData = useMemo(() => toAntdTree(rootData?.nodes ?? [], '', (rel) => void loadChildren(rel)), [rootData, showIgnored]); // eslint-disable-line react-hooks/exhaustive-deps

  const openFile = (rel: string): void => {
    setSelected(rel);
    useAppStore.getState().updateActiveLocation({ targetPath: rel }, true);
  };
  void openFile;

  const del = useMutation({
    mutationFn: (paths: string[]) => api.post('/api/fs/delete', { projectId, paths, confirm: true }),
    onSuccess: () => {
      void message.success('已移入回收站（可在回收站恢复）');
      setSelected(null);
      void refetch();
    },
    onError: (e) => void message.error(e instanceof ApiClientError ? e.message : '删除失败')
  });

  const ext = selected !== null ? (selected.split('.').pop() ?? '').toLowerCase() : '';
  const isImage = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'].includes(ext);

  return (
    <div style={{ display: 'flex', gap: 8, height: '100%', overflow: 'hidden' }}>
      <div style={{ width: 300, display: 'flex', flexDirection: 'column', gap: 6, borderRight: '1px solid rgba(128,128,128,.15)', paddingRight: 8 }}>
        <Space size={4} style={{ flexWrap: 'wrap' }}>
          <Button size="small" icon={<ReloadOutlined />} onClick={() => void refetch()} />
          <Button size="small" icon={<FileAddOutlined />} onClick={() => setNewEntry({ kind: 'file' })} title="新建文件" />
          <Button size="small" icon={<FolderAddOutlined />} onClick={() => setNewEntry({ kind: 'dir' })} title="新建文件夹" />
          <Button
            size="small"
            danger
            disabled={selected === null}
            onClick={() => {
              if (selected !== null) {
                modal.confirm({
                  title: `删除 ${selected}？`,
                  content: '将移入回收站，可在回收站恢复。',
                  okText: '删除',
                  okButtonProps: { danger: true },
                  cancelText: '取消',
                  onOk: () => del.mutate([selected])
                });
              }
            }}
          >
            删除
          </Button>
          <span style={{ fontSize: 12 }}>忽略项</span>
          <Switch size="small" checked={showIgnored} onChange={setShowIgnored} />
        </Space>
        <Input
          size="small"
          allowClear
          prefix={<SearchOutlined />}
          placeholder="文件名搜索"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div style={{ flex: 1, overflow: 'auto' }} data-testid="file-tree">
          {filter.length > 0 ? (
            (searchData?.results ?? []).length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无匹配文件" />
            ) : (
              (searchData?.results ?? []).map((r) => (
                <div
                  key={r.path}
                  style={{ padding: '2px 4px', cursor: 'pointer', borderRadius: 4 }}
                  onClick={() => r.kind === 'file' && setSelected(r.path)}
                >
                  <FileOutlined /> {r.path}
                </div>
              ))
            )
          ) : isLoading ? (
            <div style={{ padding: 12, opacity: 0.6 }}>加载中…</div>
          ) : error !== undefined && error !== null ? (
            <Alert type="error" message={error instanceof Error ? error.message : '加载失败'} />
          ) : (
            <Tree
              showIcon
              blockNode
              treeData={treeData}
              loadData={async (node) => {
                const rel = String(node.key);
                await loadChildren(rel);
              }}
              onSelect={(keys) => {
                const key = keys[0];
                if (typeof key === 'string' && !key.endsWith('/')) setSelected(key);
              }}
              titleRender={(node) => <span>{typeof node.title === 'function' ? '' : node.title}</span>}
            />
          )}
        </div>
      </div>
      <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
        {selected === null ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="选择左侧文件打开" style={{ marginTop: 64 }} />
        ) : isImage ? (
          <ImagePreview projectId={projectId} path={selected} />
        ) : (
          <EditorPane projectId={projectId} path={selected} />
        )}
      </div>
      <NewEntryModal projectId={projectId} parent={''} kind={newEntry?.kind ?? null} onClose={() => setNewEntry(null)} />
      <RenameModal projectId={projectId} path={renameTarget} onClose={() => setRenameTarget(null)} />
    </div>
  );
}

function toAntdTree(nodes: TreeNode[], _parent: string, _load: (rel: string) => void): DataNode[] {
  return nodes.map((n) => {
    const key = n.path;
    const gitColor = n.gitState !== undefined ? GIT_COLORS[n.gitState] : undefined;
    return {
      key,
      title: (
        <span style={{ color: gitColor }} title={`${n.name}${n.gitState !== undefined ? ` (${n.gitState})` : ''}`}>
          {n.name}
          {n.ignored === true ? '（忽略）' : ''}
        </span>
      ),
      icon: n.kind === 'dir' ? <FolderOutlined /> : <FileOutlined />,
      isLeaf: n.kind !== 'dir',
      path: n.path,
      kind: n.kind
    } as unknown as DataNode;
  });
}

export function NewEntryModal({ projectId, parent, kind, onClose }: {
  projectId: string; parent: string; kind: 'file' | 'dir' | null; onClose: () => void;
}): React.JSX.Element | null {
  void parent;
  const [name, setName] = useState('');
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: () => api.post('/api/fs/entry', { projectId, parentPath: parent, name, kind: kind ?? 'file' }),
    onSuccess: () => {
      void message.success('已创建');
      void queryClient.invalidateQueries({ queryKey: ['tree', projectId] });
      onClose();
      setName('');
    },
    onError: (e) => void message.error(e instanceof ApiClientError ? e.message : '创建失败')
  });
  if (kind === null) return null;
  return (
    <Modal
      title={kind === 'file' ? '新建文件' : '新建文件夹'}
      open
      onCancel={onClose}
      onOk={() => create.mutate()}
      okText="创建"
      cancelText="取消"
    >
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="名称不能包含非法字符或 Windows 保留名" autoFocus />
    </Modal>
  );
}

export function RenameModal({ projectId, path, onClose }: {
  projectId: string; path: string | null; onClose: () => void;
}): React.JSX.Element | null {
  const [name, setName] = useState('');
  const [confirmDir, setConfirmDir] = useState(false);
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  if (path === null) return null;
  const isDir = path.includes('/') || true;
  void isDir;
  const doRename = (): void => {
    void api
      .post('/api/fs/rename', { projectId, path, newName: name, confirm: confirmDir })
      .then(() => {
        void message.success('已重命名');
        void queryClient.invalidateQueries({ queryKey: ['tree', projectId] });
        onClose();
      })
      .catch((e: unknown) => {
        const msg = e instanceof ApiClientError ? e.message : '重命名失败';
        if (e instanceof ApiClientError && e.code === 'CONFIRM_REQUIRED') {
          modal.confirm({
            title: '目录重命名（L3 破坏性操作）',
            content: '会连带改变目录内所有路径，外部引用（Git/IDE/脚本）可能失效。确认继续？',
            okText: '继续重命名',
            okButtonProps: { danger: true },
            cancelText: '取消',
            onOk: () => {
              setConfirmDir(true);
              void api.post('/api/fs/rename', { projectId, path, newName: name, confirm: true }).then(() => {
                void message.success('已重命名');
                void queryClient.invalidateQueries({ queryKey: ['tree', projectId] });
                onClose();
              });
            }
          });
          return;
        }
        void message.error(msg);
      });
  };
  return (
    <Modal
      title={`重命名：${path}`}
      open
      onCancel={onClose}
      onOk={doRename}
      okText="重命名"
      cancelText="取消"
    >
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="新名称" autoFocus />
    </Modal>
  );
}
