/**
 * 项目操作菜单共享模块（评审 P2）：项目卡片（ProjectCard）与卡片墙表格视图
 * （Workbench）共用同一份菜单定义与动作分发——此前表格操作列只有一个「打开」
 * 链接、行也无右键，与卡片能力不对等。
 * 设计：菜单 = 纯数据 + 动作回调。无状态动作（Git 跳转/复制路径/资源管理器/
 * 终端）内置；确认类动作（重定位/移除登记/删除/归属集合）由消费方注入——
 * 各自持有确认弹窗与请求逻辑，本模块不持有 mutation。
 */
import type { MenuProps } from 'antd';
import { App as AntdApp } from 'antd';
import {
  AimOutlined,
  AppstoreOutlined,
  FileMarkdownOutlined,
  InboxOutlined,
  BranchesOutlined,
  CopyOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  ReloadOutlined,
  StarFilled,
  StarOutlined,
} from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError, downloadWithToken } from '@/lib/api';
import type { ProjectSummary } from '@ttfolio/shared';
import { useAppStore } from '@/app/store';

/** 导出 Markdown 报告（FR-13.12 / T-110）：blob 下载 + 成功/失败提示。 */
export async function downloadProjectReport(p: ProjectSummary): Promise<string> {
  await downloadWithToken(`/api/projects/${p.id}/report`, `${p.alias ?? p.diskName}-报告.md`);
  return `${p.alias ?? p.diskName} 报告已导出`;
}

/**
 * 归档/取消归档（评审二.5：PATCH 与「已归档」视图都在，但没有任何入口，
 * 视图成为死路）。归档前确认（归档后从总览/卡片墙消失，入口在卡片墙工具栏
 * 「已归档」按钮）；取消归档直接执行。
 */
export function useArchiveProject(): (p: ProjectSummary) => void {
  const { modal, message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  return (p: ProjectSummary): void => {
    const archiving = p.status !== 'archived';
    const run = (): Promise<unknown> =>
      api
        .patch(`/api/projects/${p.id}`, { rev: p.rev, status: archiving ? 'archived' : 'active' })
        .then(() => {
          void message.success(archiving ? '已归档（卡片墙工具栏「已归档」可找回）' : '已取消归档');
          return queryClient.invalidateQueries({ queryKey: ['projects'] });
        })
        .catch((e: unknown) => void message.error(e instanceof ApiClientError ? e.message : '操作失败'));
    if (archiving) {
      modal.confirm({
        title: `归档「${p.alias ?? p.diskName}」？`,
        content:
          '归档后从工作台总览与卡片墙隐藏（磁盘文件不受影响）；卡片墙工具栏的「已归档」按钮可查看与恢复。',
        okText: '归档',
        onOk: () => run(),
      });
    } else {
      void run();
    }
  };
}

/**
 * 移除登记 / 移除并删除文件（FR-2.5 / T-011 语义，T-129 三处调用点收敛：
 * 卡片/表格菜单、侧栏右键共用一份确认弹窗与请求——移除=L1 仅索引库软删、
 * 删除=L3 整目录进回收站（?mode=delete&confirm=1 双确认），审计在服务端）。
 */
export function useRemoveProject(): (p: ProjectSummary, mode: 'unregister' | 'delete') => void {
  const { modal, message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: ({ p, mode }: { p: ProjectSummary; mode: 'unregister' | 'delete' }) =>
      api.del(`/api/projects/${p.id}${mode === 'delete' ? '?mode=delete&confirm=1' : '?mode=unregister'}`),
    onSuccess: () => {
      void message.success('已移除');
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (e) => void message.error(e instanceof ApiClientError ? e.message : '操作失败'),
  });
  return (p, mode) => {
    const name = p.alias ?? p.diskName;
    if (mode === 'unregister') {
      modal.confirm({
        title: `仅移除「${name}」的登记？`,
        content: '只删除 ttFolio 里的索引记录，不会动磁盘上的任何文件。之后可重新添加。',
        okText: '移除登记',
        okButtonProps: { danger: true },
        onOk: () => remove.mutateAsync({ p, mode }),
      });
    } else {
      modal.confirm({
        title: `移除登记并删除「${name}」的文件？`,
        content: '整个项目目录将移入 ttFolio 回收站（可在回收站恢复原路径）。',
        okText: '移入回收站',
        okButtonProps: { danger: true },
        onOk: () => remove.mutateAsync({ p, mode }),
      });
    }
  };
}

export interface ProjectMenuHandlers {
  /** 打开项目：跟随设置 defaultProjectTab */
  onOpen: () => void;
  /** 打开文件页：强制 files（此前卡片菜单两入口同调 onOpen，默认页签=总览时言不符实） */
  onOpenFiles: () => void;
  onPin: () => void;
  onAnalyze: () => void;
  /** 打开归属集合弹窗 */
  onCollections: () => void;
  /** 归档/取消归档（useArchiveProject） */
  onArchive: () => void;
  /** 失效项目重定位弹窗 */
  onRelocate: () => void;
  /** 仅移除登记（消费方负责确认弹窗 + 请求） */
  onUnregister: () => void;
  /** 移除并删除文件（消费方负责确认弹窗 + 请求） */
  onDelete: () => void;
  /** 导出 Markdown 报告（FR-13.12 / T-110，可选：未注入则不显示菜单项） */
  onReport?: () => void;
  message: { success: (msg: string) => void };
}

export function buildProjectMenu(
  p: ProjectSummary,
  h: ProjectMenuHandlers,
): {
  items: MenuProps['items'];
  onAction: (key: string) => void;
} {
  const items: MenuProps['items'] = [
    ...(p.pathOk === false
      ? [{ key: 'relocate', label: '重新定位到新目录…', icon: <AimOutlined /> }, { type: 'divider' as const }]
      : []),
    { key: 'open', label: '打开项目', icon: <FolderOpenOutlined /> },
    { key: 'files', label: '打开文件页', icon: <FileTextOutlined /> },
    { key: 'git', label: '查看 Git', icon: <BranchesOutlined />, disabled: !p.gitIsRepo },
    { type: 'divider' as const },
    { key: 'copy', label: '复制路径', icon: <CopyOutlined /> },
    { key: 'explorer', label: '在资源管理器中显示', disabled: p.pathOk === false },
    { key: 'terminal', label: '在此打开终端', disabled: p.pathOk === false },
    { type: 'divider' as const },
    { key: 'analyze', label: '重新分析', icon: <ReloadOutlined />, disabled: p.pathOk === false },
    {
      key: 'pin',
      label: p.isPinned ? '取消固定' : '固定',
      icon: p.isPinned ? <StarFilled /> : <StarOutlined />,
    },
    { key: 'collections', label: '归属集合…', icon: <AppstoreOutlined /> },
    { key: 'archive', label: p.status === 'archived' ? '取消归档' : '归档…', icon: <InboxOutlined /> },
    ...(h.onReport !== undefined
      ? [{ key: 'report', label: '导出 Markdown 报告', icon: <FileMarkdownOutlined /> }]
      : []),
    { type: 'divider' as const },
    { key: 'unregister', label: '仅从 ttFolio 移除登记' },
    { key: 'delete', label: '移除并删除文件（进回收站）', danger: true, disabled: p.pathOk === false },
  ];
  const onAction = (key: string): void => {
    switch (key) {
      case 'relocate':
        h.onRelocate();
        break;
      case 'open':
        h.onOpen();
        break;
      case 'files':
        h.onOpenFiles();
        break;
      case 'git':
        useAppStore
          .getState()
          .openTab(
            { kind: 'project', projectId: p.id, targetPath: null, subTab: 'git', scroll: 0 },
            p.alias ?? p.diskName,
          );
        break;
      case 'copy':
        void navigator.clipboard.writeText(p.dirPath);
        h.message.success('已复制路径');
        break;
      case 'explorer':
        void api.post('/api/open', { target: 'explorer', projectId: p.id });
        break;
      case 'terminal':
        void api.post('/api/open', { target: 'terminal', projectId: p.id });
        break;
      case 'analyze':
        h.onAnalyze();
        break;
      case 'pin':
        h.onPin();
        break;
      case 'collections':
        h.onCollections();
        break;
      case 'archive':
        h.onArchive();
        break;
      case 'report':
        h.onReport?.();
        break;
      case 'unregister':
        h.onUnregister();
        break;
      case 'delete':
        h.onDelete();
        break;
    }
  };
  return { items, onAction };
}
