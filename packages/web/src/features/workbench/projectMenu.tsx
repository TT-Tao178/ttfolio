/**
 * 项目操作菜单共享模块（评审 P2）：项目卡片（ProjectCard）与卡片墙表格视图
 * （Workbench）共用同一份菜单定义与动作分发——此前表格操作列只有一个「打开」
 * 链接、行也无右键，与卡片能力不对等。
 * 设计：菜单 = 纯数据 + 动作回调。无状态动作（Git 跳转/复制路径/资源管理器/
 * 终端）内置；确认类动作（重定位/移除登记/删除/归属集合）由消费方注入——
 * 各自持有确认弹窗与请求逻辑，本模块不持有 mutation。
 */
import type { MenuProps } from 'antd';
import {
  AimOutlined, AppstoreOutlined, BranchesOutlined, CopyOutlined, FileTextOutlined, FolderOpenOutlined,
  ReloadOutlined, StarFilled, StarOutlined
} from '@ant-design/icons';
import { api } from '@/lib/api';
import type { ProjectSummary } from '@ttfolio/shared';
import { useAppStore } from '@/app/store';

export interface ProjectMenuHandlers {
  /** 打开项目：跟随设置 defaultProjectTab */
  onOpen: () => void;
  /** 打开文件页：强制 files（此前卡片菜单两入口同调 onOpen，默认页签=总览时言不符实） */
  onOpenFiles: () => void;
  onPin: () => void;
  onAnalyze: () => void;
  /** 打开归属集合弹窗 */
  onCollections: () => void;
  /** 失效项目重定位弹窗 */
  onRelocate: () => void;
  /** 仅移除登记（消费方负责确认弹窗 + 请求） */
  onUnregister: () => void;
  /** 移除并删除文件（消费方负责确认弹窗 + 请求） */
  onDelete: () => void;
  message: { success: (msg: string) => void };
}

export function buildProjectMenu(p: ProjectSummary, h: ProjectMenuHandlers): {
  items: MenuProps['items'];
  onAction: (key: string) => void;
} {
  const items: MenuProps['items'] = [
    ...(p.pathOk === false
      ? [
          { key: 'relocate', label: '重新定位到新目录…', icon: <AimOutlined /> },
          { type: 'divider' as const }
        ]
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
    { key: 'pin', label: p.isPinned ? '取消固定' : '固定', icon: p.isPinned ? <StarFilled /> : <StarOutlined /> },
    { key: 'collections', label: '归属集合…', icon: <AppstoreOutlined /> },
    { type: 'divider' as const },
    { key: 'unregister', label: '仅从 ttFolio 移除登记' },
    { key: 'delete', label: '移除并删除文件（进回收站）', danger: true, disabled: p.pathOk === false }
  ];
  const onAction = (key: string): void => {
    switch (key) {
      case 'relocate': h.onRelocate(); break;
      case 'open': h.onOpen(); break;
      case 'files': h.onOpenFiles(); break;
      case 'git': useAppStore.getState().openTab({ kind: 'project', projectId: p.id, targetPath: null, subTab: 'git', scroll: 0 }, p.alias ?? p.diskName); break;
      case 'copy': void navigator.clipboard.writeText(p.dirPath); h.message.success('已复制路径'); break;
      case 'explorer': void api.post('/api/open', { target: 'explorer', projectId: p.id }); break;
      case 'terminal': void api.post('/api/open', { target: 'terminal', projectId: p.id }); break;
      case 'analyze': h.onAnalyze(); break;
      case 'pin': h.onPin(); break;
      case 'collections': h.onCollections(); break;
      case 'unregister': h.onUnregister(); break;
      case 'delete': h.onDelete(); break;
    }
  };
  return { items, onAction };
}
