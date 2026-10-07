/**
 * 文件页签（FR-4.1..4.10）：懒加载树 + 编辑器/预览分流 + 新建/重命名/删除 + 文件名搜索。
 *
 * 本次修复（用户报障 2）：
 * 1) 「点文件夹报文件系统错误：EISDIR」——原实现在 onSelect 里只用 `!key.endsWith('/')` 判断，
 *    而目录 key 是 n.path（不以 / 结尾），于是目录被当成文件交给编辑器去读 → 后端 EISDIR。
 *    现在按节点自身 kind 分流：目录只选中（并作为"新建"的落点），只有文件才进编辑器。
 * 2) 懒加载的子节点原先只写进 react-query 缓存、没有回写 treeData，rc-tree 的展开因此拿不到子节点
 *    （表现为"点了文件夹没展开"）。现在 loadChildren 把子节点合并进 treeData（rc-tree 的标准用法）。
 * 3) 「前进/后退」原先无历史可退：openFile 是死代码（`void openFile;`），选择文件从不写标签历史。
 *    现在编辑器打开哪个文件由标签的 targetPath 驱动，选中文件即写入历史，前进/后退可直接回放。
 */
import { Alert, Button, Empty, Input, Menu, Modal, Space, Switch, Tree, App } from 'antd';
import type { DataNode } from 'antd/es/tree';
import {
  CopyOutlined, DeleteOutlined, EditOutlined, FileOutlined, FolderOpenOutlined, FolderOutlined, ReloadOutlined, ScissorOutlined, SearchOutlined,
  FileAddOutlined, FolderAddOutlined, LinkOutlined
} from '@ant-design/icons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError, rawUrl } from '@/lib/api';
import type { ProjectDetail, TreeNode, TreeResponse } from '@ttfolio/shared';
import { useAppStore } from '@/app/store';
import { useSettings } from '@/app/settings';
import { SEMANTIC } from '@/theme/tokens';
import { EditorPane } from './EditorPane';
import { PaneSplit } from '@/components/PaneSplit';
import { ImagePreview } from './ImagePreview';
import { MoveCopyModal } from './MoveCopyModal';

const GIT_COLORS: Record<string, string> = {
  modified: SEMANTIC.warning,
  added: SEMANTIC.success,
  untracked: SEMANTIC.success,
  deleted: SEMANTIC.error,
  renamed: SEMANTIC.primary,
  conflicted: SEMANTIC.error
};

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'];

function extOf(p: string): string {
  return (p.split('.').pop() ?? '').toLowerCase();
}

/** 当前标签正在编辑的文件（后退/前进也走这里，编辑器随之切换）。 */
function useOpenPath(): string | null {
  return useAppStore((s) => {
    const t = s.tabs.find((x) => x.id === s.activeTabId);
    return t?.targetPath ?? null;
  });
}

function dirnameOf(p: string): string {
  const i = p.lastIndexOf('/');
  return i <= 0 ? '' : p.slice(0, i);
}

/** 在已加载的树里找节点类型（只对已渲染的节点调用，必然命中）。 */
function findKind(nodes: DataNode[], key: string): 'dir' | 'file' | null {
  for (const n of nodes) {
    if (String(n.key) === key) {
      const k = (n as unknown as { kind?: string }).kind;
      return k === 'dir' ? 'dir' : 'file';
    }
    const kids = n.children;
    if (kids !== undefined && kids.length > 0) {
      const hit = findKind(kids, key);
      if (hit !== null) return hit;
    }
  }
  return null;
}

/** 把某目录的子节点挂到树上（保留其余分支的已加载内容）。 */
function attachChildren(nodes: DataNode[], parentKey: string, children: DataNode[]): DataNode[] {
  return nodes.map((n) => {
    if (String(n.key) === parentKey) return { ...n, children };
    if (n.children === undefined || n.children.length === 0) return n;
    return { ...n, children: attachChildren(n.children, parentKey, children) };
  });
}

/** 根列表刷新时保留已展开分支的 children，避免每次 refetch 都把树"合上"。 */
function mergeRoots(prev: DataNode[], next: DataNode[]): DataNode[] {
  const byKey = new Map(prev.map((p) => [String(p.key), p]));
  return next.map((n) => {
    const old = byKey.get(String(n.key));
    if (old === undefined || old.children === undefined) return n;
    return { ...n, children: old.children };
  });
}

export function FilesTab({ projectId }: { projectId: string }): React.JSX.Element {
  const { settings, setSetting } = useSettings();
  const showIgnored = settings.showIgnored;
  const openPath = useOpenPath();
  /** 树上选中的节点（可能是目录）：作为"删除/新建"的作用对象，与"编辑器打开的文件"分开 */
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [treeData, setTreeData] = useState<DataNode[]>([]);
  /** 受控展开（面包屑目录段点击时逐层展开定位；普通点击仍走 rc-tree 内部） */
  const [expandedKeys, setExpandedKeys] = useState<React.Key[]>([]);
  const [filter, setFilter] = useState('');
  const [newEntry, setNewEntry] = useState<{ kind: 'file' | 'dir' } | null>(null);
  const [renameTarget, setRenameTarget] = useState<string | null>(null);
  /** 展开失败的节点：懒加载失败必须可见（rc-tree 会吞掉 rejection） */
  const [failedPaths, setFailedPaths] = useState<string[]>([]);
  const failedRef = useRef<string[]>([]);
  failedRef.current = failedPaths;
  const { message, modal } = App.useApp();

  // 右键菜单（第 27 轮重构为容器委托 + 受控固定定位菜单）：mcTarget 是复制/移动弹窗，
  // dirPath 为复制绝对路径所需的项目根（与详情页共享查询缓存）
  const [mcTarget, setMcTarget] = useState<{ items: string[]; mode: 'move' | 'copy' } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; path: string } | null>(null);
  const { data: detailData } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.get<ProjectDetail>(`/api/projects/${projectId}`)
  });
  const dirPathRef = useRef<string | null>(null);
  dirPathRef.current = detailData?.dirPath ?? null;
  /** 剪贴板写入兜底：非安全上下文或权限拒绝时给出可见提示，不静默失败 */
  const writeClipboard = (text: string, okMsg: string): void => {
    navigator.clipboard.writeText(text).then(
      () => { void message.success(okMsg); },
      () => { void message.error('复制失败：浏览器未授权剪贴板，请手动选择路径文本复制'); }
    );
  };

  const { data: rootData, isLoading, error, refetch } = useQuery({
    queryKey: ['tree', projectId, '', showIgnored],
    queryFn: () => api.get<TreeResponse>('/api/fs/tree', { projectId, path: '', showIgnored: showIgnored ? '1' : '0' })
  });
  const { data: searchData } = useQuery({
    queryKey: ['fssearch', projectId, filter],
    queryFn: () => api.get<{ results: Array<{ name: string; path: string; kind: string }> }>('/api/fs/search', { projectId, q: filter }),
    enabled: filter.length > 0
  });

  // 根节点 → 树（合并而非重建：保住已展开分支）
  useEffect(() => {
    setTreeData((prev) => mergeRoots(prev, toAntdTree(rootData?.nodes ?? [], failedRef.current, projectId)));
  }, [rootData, projectId]);

  // 「打开项目默认展开第一个文件」：打开项目落「文件」页签时入口会设置 pendingAutoOpenProject，
  // 这里消费一次——自动选中第一个文本文件（没有文本文件就选第一个文件）；用户主动回到
  // 文件列表（点面包屑「文件」/清空 targetPath）不会触发，保持上一轮"回列表"的行为。
  const pendingAuto = useAppStore((s) => s.pendingAutoOpenProject);
  useEffect(() => {
    if (pendingAuto !== projectId) return;
    if (openPath !== null) {
      useAppStore.setState({ pendingAutoOpenProject: null });
      return;
    }
    const nodes = rootData?.nodes ?? [];
    if (nodes.length === 0) return; // 树未就绪，等下一轮
    const textRe = /\.(md|markdown|txt|json|ya?ml|toml|ini|cfg|conf|xml|html?|css|scss|less|styl|vue|svelte|astro|jsx?|tsx?|[cm]js|py|java|kt|go|rs|cs|c|cpp|hpp|php|rb|swift|dart|scala|groovy|sh|bash|ps1|bat|cmd|sql|graphql|gql|proto)$/i;
    const pick = nodes.find((n) => n.kind === 'file' && textRe.test(n.name)) ?? nodes.find((n) => n.kind === 'file');
    useAppStore.setState({ pendingAutoOpenProject: null });
    if (pick !== undefined) useAppStore.getState().updateActiveLocation({ targetPath: pick.path }, true);
  }, [pendingAuto, projectId, openPath, rootData]);

  // 标签里的目标路径变化（含前进/后退）时，让树上的选中态跟随
  useEffect(() => {
    if (openPath !== null) setSelectedPath(openPath);
  }, [openPath]);

  // 展开时懒加载：必须把子节点写回 treeData，否则 rc-tree 拿不到 children（点了不展开）
  const loadChildren = useCallback(
    async (rel: string): Promise<void> => {
      try {
        const r = await api.get<TreeResponse>('/api/fs/tree', {
          projectId,
          path: rel,
          showIgnored: showIgnored ? '1' : '0'
        });
        setTreeData((prev) => attachChildren(prev, rel, toAntdTree(r.nodes ?? [], failedRef.current, projectId)));
        setFailedPaths((prev) => prev.filter((p) => p !== rel));
      } catch (e) {
        const code = e instanceof ApiClientError ? e.code : '';
        const hint =
          code === 'PERMISSION_DENIED'
            ? '权限不足：请检查该文件夹的访问权限'
            : code === 'NOT_FOUND'
              ? '目录已不存在（可能被移动或删除）'
              : code === 'PATH_OUT_OF_SCOPE'
                ? '该路径不被允许访问（符号链接指向项目外部？）'
                : e instanceof Error
                  ? e.message
                  : '加载失败';
        setFailedPaths((prev) => (prev.includes(rel) ? prev : [...prev, rel]));
        void message.error(`展开「${rel}」失败：${hint}`);
      }
    },
    [projectId, showIgnored, message]
  );

  // 面包屑目录段点击（第 26 轮）：逐层懒加载展开到目标目录并选中——
  // loadChildren 幂等（attachChildren 直接替换该层 children），已展开层重复加载无副作用。
  const treeLocate = useAppStore((s) => s.treeLocate);
  const locateNonceRef = useRef(0);
  useEffect(() => {
    if (treeLocate === null || treeLocate.projectId !== projectId) return;
    if (locateNonceRef.current === treeLocate.nonce) return;
    locateNonceRef.current = treeLocate.nonce;
    const segs = treeLocate.path.split('/').filter((s) => s !== '');
    void (async () => {
      let cur = '';
      const toExpand: React.Key[] = [];
      for (const seg of segs) {
        cur = cur === '' ? seg : `${cur}/${seg}`;
        try {
          await loadChildren(cur);
        } catch {
          /* 失败已由 loadChildren 提示；后续层无法展开，停在已到达处 */
          break;
        }
        toExpand.push(cur);
      }
      setExpandedKeys((prev) => Array.from(new Set([...prev, ...toExpand])));
      setSelectedPath(cur);
    })();
  }, [treeLocate, projectId, loadChildren]);

  // 右键菜单（第 27 轮定稿）：document 级原生 contextmenu 监听——React 合成事件挂在
  // root 容器上，树重渲染与事件派发存在时序竞争（右键偶发不弹的根因）；原生监听挂在
  // document 上，不经过 React 调度，任何渲染状态下都稳定触发。
  useEffect(() => {
    const onCtx = (e: MouseEvent): void => {
      const t = e.target as HTMLElement;
      if (t.closest?.('[data-testid="tree-ctx-menu"]') !== null) return;
      const treeEl = t.closest('[data-testid="file-tree"]');
      if (treeEl === null) return;
      const el = t.closest('[data-path]') ?? t.closest('.ant-tree-treenode')?.querySelector('[data-path]') ?? null;
      if (el === null) return;
      e.preventDefault();
      const x = Math.min(e.clientX, window.innerWidth - 210);
      const y = Math.min(e.clientY, window.innerHeight - 240);
      setCtxMenu({ x, y, path: el.getAttribute('data-path') ?? '' });
    };
    document.addEventListener('contextmenu', onCtx);
    return () => document.removeEventListener('contextmenu', onCtx);
  }, [projectId]);

  // 右键菜单打开时，点击任意其它位置/滚动/Esc 关闭（菜单容器 onMouseDown 已阻止冒泡，内部点击不受影响）
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

  const del = useMutation({
    mutationFn: (paths: string[]) => api.post('/api/fs/delete', { projectId, paths, confirm: true }),
    onSuccess: () => {
      void message.success('已移入回收站（可在回收站恢复）');
      setSelectedPath(null);
      void refetch();
    },
    onError: (e) => void message.error(e instanceof ApiClientError ? e.message : '删除失败')
  });

  /** 删除确认（顶部按钮 / Delete 键 / 右键菜单三处共用，评审前只有按钮一处） */
  const confirmDelete = (path: string): void => {
    modal.confirm({
      title: `删除 ${path}？`,
      content: '将移入回收站，可在回收站恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => del.mutate([path])
    });
  };

  // F2 重命名 / Delete 删除（评审：帮助文案承诺了这两个键但无任何监听）。
  // 挂在树容器上，焦点在树内时生效；与顶部「删除」按钮共用确认逻辑。
  const onTreeKeyDown = (e: React.KeyboardEvent): void => {
    if (selectedPath === null) return;
    if (e.key === 'F2') {
      e.preventDefault();
      setRenameTarget(selectedPath);
    } else if (e.key === 'Delete') {
      e.preventDefault();
      confirmDelete(selectedPath);
    }
  };

  const selKind = selectedPath === null ? null : findKind(treeData, selectedPath);
  /** 「新建」落点：选中目录→该目录；选中文件→其所在目录；未选→项目根 */
  const newParent = selectedPath === null ? '' : selKind === 'dir' ? selectedPath : dirnameOf(selectedPath);
  const isImage = openPath !== null && IMAGE_EXT.includes(extOf(openPath));

  return (
    <div style={{ height: '100%', overflow: 'hidden' }}>
      <PaneSplit
        sizeKey="treeWidth"
        defaultSize={300}
        min={200}
        max={640}
        testId="split-tree"
        left={
          <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 6, paddingRight: 8 }}>
        <Space size={4} style={{ flexWrap: 'wrap' }}>
          <Button size="small" icon={<ReloadOutlined />} onClick={() => void refetch()} title="重新读取目录" />
          <Button size="small" icon={<FileAddOutlined />} onClick={() => setNewEntry({ kind: 'file' })} title={newParent === '' ? '在项目根新建文件' : `在 ${newParent}/ 新建文件`} />
          <Button size="small" icon={<FolderAddOutlined />} onClick={() => setNewEntry({ kind: 'dir' })} title={newParent === '' ? '在项目根新建文件夹' : `在 ${newParent}/ 新建文件夹`} />
          <Button
            size="small"
            danger
            disabled={selectedPath === null}
            onClick={() => { if (selectedPath !== null) confirmDelete(selectedPath); }}
          >
            删除
          </Button>
          <span style={{ fontSize: 12 }}>忽略项</span>
          {/* 忽略项开关走全局设置（原先只有本地 state，设置页里的 show_ignored 是死键） */}
          <Switch size="small" checked={showIgnored} onChange={(v) => setSetting('showIgnored', v)} />
        </Space>
        <Input
          size="small"
          allowClear
          prefix={<SearchOutlined />}
          placeholder="文件名搜索"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div
          style={{ flex: 1, overflow: 'auto' }}
          data-testid="file-tree"
          onKeyDown={onTreeKeyDown}
        >
          {filter.length > 0 ? (
            (searchData?.results ?? []).length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无匹配文件" />
            ) : (
              (searchData?.results ?? []).map((r) => (
                <div
                  key={r.path}
                  style={{ padding: '2px 4px', cursor: 'pointer', borderRadius: 4 }}
                  onClick={() => {
                    if (r.kind === 'file') {
                      setSelectedPath(r.path);
                      useAppStore.getState().updateActiveLocation({ targetPath: r.path }, true);
                    } else {
                      // 目录结果此前点击零反馈（评审）：清搜索回树视图，复用面包屑的
                      // treeLocate 通道逐层懒加载展开到该目录并选中
                      setFilter('');
                      setSelectedPath(r.path);
                      useAppStore.getState().setTreeLocate({ projectId, path: r.path });
                    }
                  }}
                >
                  <FileOutlined /> {r.path}
                </div>
              ))
            )
          ) : isLoading ? (
            <div style={{ padding: 12, opacity: 0.6 }}>加载中…</div>
          ) : error !== undefined && error !== null ? (
            <Alert type="error" message={error instanceof Error ? error.message : '加载失败'} />
          ) : treeData.length === 0 ? (
            // 空态必须区分两种情形（原先两者都只剩一片空白，用户无法判断"是空的"还是"坏了"）
            (rootData?.hiddenCount ?? 0) > 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={`内容被忽略规则隐藏（${rootData?.hiddenCount ?? 0} 项，如 node_modules / dist）`}
                data-testid="tree-empty-hidden"
              >
                <Button size="small" type="primary" onClick={() => setSetting('showIgnored', true)}>
                  显示忽略项
                </Button>
              </Empty>
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="这个目录里还没有文件"
                data-testid="tree-empty"
              >
                <Button size="small" onClick={() => setNewEntry({ kind: 'file' })}>新建文件</Button>
              </Empty>
            )
          ) : (
            <Tree
              showIcon
              blockNode
              treeData={treeData}
              selectedKeys={selectedPath === null ? [] : [selectedPath]}
              expandedKeys={expandedKeys}
              onExpand={(keys) => setExpandedKeys(keys)}
              loadData={async (node) => {
                // 自己 catch：rc-tree 会吞掉 loadData 的 rejection，不接住就表现为"点了没反应"
                try {
                  await loadChildren(String(node.key));
                } catch {
                  /* loadChildren 已处理提示与失败标记 */
                }
              }}
              onSelect={(keys) => {
                const key = keys[0];
                // 点已选中的节点时 rc-tree 会"反选"，keys 为空数组 → key 不是 string。
                // 原实现在这里直接 return，于是"后退回到未打开文件 → 再点同一个文件"没有任何反应
                // （选中态还在、编辑器却不再打开），必须改点别的文件才能恢复。
                // 现在改为读当前选中态：反选语义只作用于目录（清掉选中高亮），文件仍然照常打开。
                const resolved = typeof key === 'string' ? key : selectedPath;
                if (resolved === null) return;
                const kind = findKind(treeData, resolved);
                if (kind === 'file') useAppStore.getState().updateActiveLocation({ targetPath: resolved }, true);
                setSelectedPath(kind === 'file' ? resolved : (typeof key === 'string' ? key : null));
              }}
            />
          )}
        </div>
          </div>
        }
        right={
          <div style={{ height: '100%', overflow: 'auto', minHeight: 0 }}>
            {openPath === null ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={selKind === 'dir' ? `已选中目录 ${selectedPath ?? ''}（点左侧箭头展开，或用上方按钮在其中新建）` : '选择左侧文件打开'}
                style={{ marginTop: 64 }}
              />
            ) : isImage ? (
              <ImagePreview projectId={projectId} path={openPath} />
            ) : (
              <EditorPane projectId={projectId} path={openPath} />
            )}
          </div>
        }
      />
      <NewEntryModal projectId={projectId} parent={newParent} kind={newEntry?.kind ?? null} onClose={() => setNewEntry(null)} />
      <RenameModal projectId={projectId} path={renameTarget} onClose={() => setRenameTarget(null)} />
      <MoveCopyModal
        projectId={projectId}
        items={mcTarget?.items ?? []}
        mode={mcTarget?.mode ?? null}
        onClose={() => setMcTarget(null)}
        onDone={() => {
          // 移动/复制后已展开子层是本地缓存，invalidate 根查询清不掉——整树收起强制重读，
          // 用户重新展开看到的一定是新结构
          setExpandedKeys([]);
          void refetch();
        }}
      />

      {/* 右键菜单（第 27 轮）：固定定位受控菜单——document mousedown 关闭，
          容器 onMouseDown 阻止冒泡保证菜单内点击先于关闭执行 */}
      {ctxMenu !== null && (
        <div
          data-testid="tree-ctx-menu"
          style={{ position: 'fixed', left: ctxMenu.x, top: ctxMenu.y, zIndex: 1050, borderRadius: 8, background: SEMANTIC.layoutBg, boxShadow: '0 6px 16px rgba(0, 0, 0, 0.16)', padding: 4 }}
          onMouseDown={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          <Menu
            selectable={false}
            style={{ border: 'none', background: 'transparent' }}
            onClick={({ key }) => {
              const path = ctxMenu.path;
              setCtxMenu(null);
              if (key === 'rename') setRenameTarget(path);
              else if (key === 'delete') confirmDelete(path);
              else if (key === 'copy-to') setMcTarget({ items: [path], mode: 'copy' });
              else if (key === 'move-to') setMcTarget({ items: [path], mode: 'move' });
              else if (key === 'explorer') void api.post('/api/open', { target: 'explorer', projectId, path });
              else if (key === 'copy-rel') writeClipboard(path, `已复制相对路径：${path}`);
              else if (key === 'copy-abs') {
                const dir = dirPathRef.current;
                if (dir === null) { void message.error('项目信息尚未加载'); return; }
                const abs = absJoin(dir, path);
                writeClipboard(abs, `已复制绝对路径：${abs}`);
              }
            }}
            items={[
              { key: 'rename', label: '重命名…', icon: <EditOutlined /> },
              { key: 'delete', label: '删除（进回收站）', icon: <DeleteOutlined />, danger: true },
              { type: 'divider' as const },
              { key: 'copy-to', label: '复制到…', icon: <CopyOutlined /> },
              { key: 'move-to', label: '移动到…', icon: <ScissorOutlined /> },
              { key: 'explorer', label: '在资源管理器中打开', icon: <FolderOpenOutlined /> },
              { type: 'divider' as const },
              { key: 'copy-rel', label: '复制相对路径' },
              { key: 'copy-abs', label: '复制绝对路径' }
            ]}
          />
        </div>
      )}
    </div>
  );
}

/** 相对路径 → 绝对路径（项目根 + 相对段，Windows 分隔符） */
function absJoin(dir: string, rel: string): string {
  const sep = dir.endsWith('\\') || dir.endsWith('/') ? '' : '\\';
  return `${dir}${sep}${rel.split('/').join('\\')}`;
}

function toAntdTree(nodes: TreeNode[], failed: string[] = [], projectId = ''): DataNode[] {
  return nodes.map((n) => {
    const key = n.path;
    const gitColor = n.gitState !== undefined ? GIT_COLORS[n.gitState] : undefined;
    // 链接四态：项目内目录链接可展开；项目外/断裂链接必须灰显禁用并说明原因，
    // 不能让用户点了才报错（实测原实现把 junction 当文件、标成叶子，完全无法展开）。
    const linkDisabled = n.symlink === true && (n.linkOutside === true || n.linkTarget === 'unknown');
    const linkNote =
      n.symlink === true
        ? n.linkTarget === 'unknown'
          ? '符号链接：目标不可访问或已断裂'
          : n.linkOutside === true
            ? '符号链接：指向项目目录之外，出于安全考虑不展开'
            : `符号链接：指向项目内的${n.linkTarget === 'dir' ? '目录' : '文件'}`
        : '';
    const isFailed = failed.includes(key);
    const tip = [isFailed ? '展开失败（权限不足或路径已失效）' : '', linkNote, n.gitState !== undefined ? `Git: ${n.gitState}` : '']
      .filter((s) => s !== '')
      .join(' · ');
    // 右键菜单（第 27 轮重构）：节点只带 data-path 标记，菜单由树容器级
    // onContextMenu 委托 + 受控固定定位菜单实现——不依赖 trigger 落点，
    // 右键节点任意位置（含行空白）都能弹，且与 React mousedown 重渲染无竞争。
    const title = (
      <span data-path={key} style={{ color: isFailed ? SEMANTIC.error : gitColor, opacity: linkDisabled ? 0.5 : 1 }} title={tip}>
        {n.name}
        {n.symlink === true && <LinkOutlined style={{ marginLeft: 4, opacity: 0.55, fontSize: 11 }} />}
        {n.ignored === true ? '（忽略）' : ''}
        {isFailed ? '（展开失败）' : ''}
      </span>
    );
    return {
      key,
      title,
      icon:
        n.kind !== 'dir' && IMAGE_EXT.includes(n.name.split('.').pop()?.toLowerCase() ?? '') ? (
          /* 图片文件：icon 槽显示 16px 缩略图（/raw 只读代理），加载失败隐藏自身 */
          <img
            src={rawUrl(projectId, key)}
            alt=""
            loading="lazy"
            data-testid="tree-thumb"
            onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
            style={{ width: 16, height: 16, objectFit: 'cover', borderRadius: 2, border: '1px solid rgba(128,128,128,0.25)' }}
          />
        ) : n.kind === 'dir' ? (
          <FolderOutlined />
        ) : (
          <FileOutlined />
        ),
      // 未知/越界的链接当叶子且不可选：点了也读不到，不如明确禁用
      isLeaf: linkDisabled ? true : n.kind !== 'dir',
      disabled: linkDisabled,
      selectable: !linkDisabled,
      path: n.path,
      kind: n.kind
    } as unknown as DataNode;
  });
}

export function NewEntryModal({ projectId, parent, kind, onClose }: {
  projectId: string; parent: string; kind: 'file' | 'dir' | null; onClose: () => void;
}): React.JSX.Element | null {
  const [name, setName] = useState('');
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: () => api.post('/api/fs/entry', { projectId, parentPath: parent, name, kind: kind ?? 'file' }),
    onSuccess: () => {
      void message.success(parent === '' ? '已创建' : `已在 ${parent}/ 创建`);
      void queryClient.invalidateQueries({ queryKey: ['tree', projectId] });
      onClose();
      setName('');
    },
    onError: (e) => void message.error(e instanceof ApiClientError ? e.message : '创建失败')
  });
  if (kind === null) return null;
  return (
    <Modal
      title={`${kind === 'file' ? '新建文件' : '新建文件夹'}${parent === '' ? '（项目根）' : `（${parent}/）`}`}
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
