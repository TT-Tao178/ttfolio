/** 添加项目弹窗（登记新文件夹：粘贴路径/系统对话框/父目录批量/桌面版拖入）。
 *  2026-11-03 自 Workbench.tsx 抽出并提升到 App 层挂载——此前 nonce 只由 Workbench
 *  消费且弹窗只在总览/卡片墙分支渲染，非工作台标签触发信号要么强切标签要么延迟
 *  弹出；现在任意屏可用。集合上下文经 requestAddProject(collectionId) 传入：
 *  登记成功后项目随即加入该集合（追加语义，不影响其他成员）。 */
import { App, Button, Input, Modal, Space, Tag } from 'antd';
import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError } from '@/lib/api';
import type { CollectionInfo } from '@ttfolio/shared';
import { useAppStore } from '@/app/store';
import { SEMANTIC } from '@/theme/tokens';
import { markPendingAnalysis } from './pendingAnalyze';

export function AddProjectModal({
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
  // 拖拽登记（T-118）：仅桌面版（preload 桥存在）可用；drop 高亮态
  const canDrop = typeof window.ttfolioNative?.getPathForFile === 'function';
  const [dragOver, setDragOver] = useState(false);
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

  // 拖拽登记（T-118）：全局 drop 收集到的路径在弹窗打开时消费一次（App 级 drop → store → 这里）
  useEffect(() => {
    if (!open) return;
    const prefill = useAppStore.getState().addProjectPrefill;
    if (prefill !== null && prefill !== '') {
      setText(prefill);
      useAppStore.getState().setAddProjectPrefill(null);
    }
  }, [open]);

  const dropPathsOf = (e: React.DragEvent): string[] =>
    Array.from(e.dataTransfer.files)
      .map((f) => window.ttfolioNative?.getPathForFile?.(f) ?? '')
      .filter((p) => p !== '');

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
      // 分析完成反馈（T-119）：新登记的项目在 project.analyzed SSE 到达时 toast 一次
      markPendingAnalysis(r.added);
      if (r.added.length > 0) {
        if (collectionId !== null) {
          if (r.joined) void message.success(`已登记 ${r.added.length} 个项目并加入集合，正在分析…`);
          else void message.warning('项目已登记，但加入集合失败——可稍后在项目右键「归属集合…」中补加', 5);
        } else {
          void message.success(`已登记 ${r.added.length} 个项目，正在分析…`);
        }
        // 登记后留在当前屏（2026-11-03 拍板）：不再强制跳「全部项目」卡片墙——
        // 原跳转是修「添加了但没反应」的过渡方案，真正缺的是数据失效刷新（下方
        // invalidate 即时反映到总览项目格/卡片墙/集合墙）；当前屏看得见就不跳。
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
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          // 拖拽登记（T-118）：桌面版整个弹窗都是落点，拖近时虚线高亮
          ...(canDrop
            ? {
                border: `1px dashed ${dragOver ? SEMANTIC.primary : SEMANTIC.split}`,
                borderRadius: 8,
                padding: dragOver ? 11 : 12,
                background: dragOver ? SEMANTIC.primaryBg : undefined,
                transition: 'border-color 0.15s ease, background-color 0.15s ease',
              }
            : {}),
        }}
        onDragOver={(e) => {
          if (!canDrop) return;
          e.preventDefault();
          e.stopPropagation();
          setDragOver(true);
        }}
        onDragLeave={(e) => {
          if (!canDrop) return;
          e.stopPropagation();
          setDragOver(false);
        }}
        onDrop={(e) => {
          if (!canDrop) return;
          e.preventDefault();
          e.stopPropagation();
          setDragOver(false);
          const paths = dropPathsOf(e);
          if (paths.length === 0) {
            void message.info('没有可识别的拖入内容');
            return;
          }
          setText((cur) => (cur.trim() === '' ? paths.join('\n') : `${cur}\n${paths.join('\n')}`));
          void message.info(`已填入 ${paths.length} 个路径，点「登记以上目录」确认（非文件夹会被自动跳过）`);
        }}
      >
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
        {canDrop ? (
          <div style={{ fontSize: 12, opacity: 0.65 }}>
            提示：桌面版支持把项目文件夹直接拖进本窗口或本弹窗——路径会自动填入上方输入框确认后登记；
            混入的文件会被自动跳过，只登记文件夹。也可以粘贴多行路径、用系统对话框或父目录批量登记。
          </div>
        ) : (
          <div style={{ fontSize: 12, opacity: 0.65 }}>
            提示：浏览器安全限制拿不到拖拽文件夹的绝对路径，Web 模式下拖拽添加不可用——请用上方三种入口
            （粘贴路径 / 系统对话框 / 父目录批量登记）。桌面版支持直接拖入。
          </div>
        )}
      </div>
    </Modal>
  );
}
