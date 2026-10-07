/**
 * 项目卡片（卡片墙 / 工作台总览共用）。
 * 从 Workbench.tsx 原地抽出：总览（Dashboard）也要放项目卡片，而 Workbench 已引用 Dashboard，
 * 若 Dashboard 反向 import Workbench 会形成循环依赖。
 */
import { App, Avatar, Card, Dropdown, Menu, Tag } from 'antd';
import { MoreOutlined, StarFilled, WarningOutlined } from '@ant-design/icons';
import React, { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ProjectSummary } from '@ttfolio/shared';
import { useAppStore } from '@/app/store';
import { LanguageBar } from '@/components/LanguageBar';
import { relTime } from '@/lib/format';
import { typeLabel } from '@/components/DetailPanel';
import { RelocateModal } from '@/features/workbench/RelocateModal';
import { CollectionPickerModal } from '@/features/workbench/CollectionPickerModal';
import { buildProjectMenu } from '@/features/workbench/projectMenu';
import { SEMANTIC } from '@/theme/tokens';

export function ProjectCard({ p, onOpen, onPin, onAnalyze }: {
  p: ProjectSummary; onOpen: () => void; onPin: () => void; onAnalyze: () => void;
}): React.JSX.Element {
  const { message, modal } = App.useApp();
  const queryClient2 = useQueryClient();
  const [relocateOpen, setRelocateOpen] = useState(false);
  // 右键菜单（第 28 轮）：受控固定定位菜单——「…」图标的 Dropdown 只覆盖图标本身，
  // 卡片主体右键此前弹的是浏览器默认菜单。菜单 items 与「…」Dropdown 共用一份。
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  // 归属集合弹窗：条件渲染 + key=项目 id，每次打开全新挂载（勾选态取打开瞬间快照）
  const [pickerOpen, setPickerOpen] = useState(false);
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
  const confirmUnregister = (): void => {
    modal.confirm({
      title: `仅移除「${p.alias ?? p.diskName}」的登记？`,
      content: '只删除 ttFolio 里的索引记录，不会动磁盘上的任何文件。之后可重新添加。',
      okText: '移除登记',
      okButtonProps: { danger: true },
      onOk: () => remove.mutateAsync('unregister')
    });
  };
  const confirmDelete = (): void => {
    modal.confirm({
      title: `移除登记并删除「${p.alias ?? p.diskName}」的文件？`,
      content: '整个项目目录将移入 ttFolio 回收站（可在回收站恢复原路径）。',
      okText: '移入回收站',
      okButtonProps: { danger: true },
      onOk: () => remove.mutateAsync('delete')
    });
  };

  // 「打开文件页」强制 files；「打开项目」跟随默认页签设置（onOpen）
  const openFiles = (): void => {
    useAppStore.getState().requestAutoOpenProject(p.id);
    useAppStore.getState().openTab({ kind: 'project', projectId: p.id, targetPath: null, subTab: 'files', scroll: 0 }, p.alias ?? p.diskName);
    void api.post(`/api/projects/${p.id}/open`);
  };
  // 菜单定义与分发收敛到共享模块（与表格视图共用一份，评审 P2）：确认类动作注入
  const menu = buildProjectMenu(p, {
    onOpen,
    onOpenFiles: openFiles,
    onPin,
    onAnalyze,
    onCollections: () => setPickerOpen(true),
    onRelocate: () => setRelocateOpen(true),
    onUnregister: confirmUnregister,
    onDelete: confirmDelete,
    message
  });

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

  return (
    <Card
      hoverable
      size="small"
      style={{ borderColor: p.pathOk ? undefined : SEMANTIC.error }}
      onClick={(e) => {
        // 三类点击要忽略（都沿 React 树冒泡到卡片，会造成「点弹窗按钮却打开项目/切页」）：
        // 1) Dropdown 菜单项：弹层 DOM 挂在触发器父节点（卡片内），closest 可识别
        if ((e.target as HTMLElement).closest('.ant-dropdown') !== null) return;
        // 2) 受控右键菜单：菜单项 click 冒泡到卡片会误开项目
        if ((e.target as HTMLElement).closest('[data-testid="project-ctx-menu"]') !== null) return;
        // 3) Modal 弹窗内按钮：portal 到 body，DOM 上不在卡片内——用 contains 识别
        if (!e.currentTarget.contains(e.target as Node)) return;
        onOpen();
      }}
      onContextMenu={(e) => {
        // 弹层/Modal 内的右键不接管（弹层挂卡片外或 body，contains 可识别）
        if (!e.currentTarget.contains(e.target as Node)) return;
        e.preventDefault();
        // 边界收口：贴右边留菜单宽度、贴底下留菜单高度（14 项约 520px），小窗口下保底 8px
        setCtxMenu({
          x: Math.min(e.clientX, window.innerWidth - 232),
          y: Math.min(e.clientY, Math.max(8, window.innerHeight - 520))
        });
      }}
      data-testid="project-card"
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, maxWidth: '100%' }}>
          <Avatar style={{ background: SEMANTIC.primary, flexShrink: 0 }} size={24}>
            {(p.alias ?? p.diskName).charAt(0).toUpperCase()}
          </Avatar>
          <span className="tt-ellipsis">{p.alias ?? p.diskName}</span>
          {p.alias !== null && <Tag style={{ flexShrink: 0 }}>别名</Tag>}
          {p.pathOk === false
            ? <Tag style={{ flexShrink: 0 }} color="error" icon={<WarningOutlined />}>目录失效</Tag>
            : <Tag style={{ flexShrink: 0 }} color="blue">{typeLabel(p.type)}</Tag>}
        </span>
      }
      extra={
        // 卡片主体右键已由受控菜单接管，这里收窄为纯点击触发，避免两种右键菜单并存
        <Dropdown menu={{ items: menu.items, onClick: ({ key }) => menu.onAction(key) }} trigger={['click']}>
          <MoreOutlined onClick={(e) => e.stopPropagation()} />
        </Dropdown>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {/* 起了别名时同时展示原名（用户要求：别名与原始名都要能看到）；无别名时不重复显示 */}
        {p.alias !== null && (
          <div className="tt-ellipsis" style={{ fontSize: 12, opacity: 0.75 }}>
            原名 <span className="tt-mono">{p.diskName}</span>
          </div>
        )}
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
      <RelocateModal
        projectId={p.id}
        name={p.alias ?? p.diskName}
        dirPath={p.dirPath}
        open={relocateOpen}
        onClose={() => setRelocateOpen(false)}
      />
      {pickerOpen && (
        <CollectionPickerModal key={p.id} project={p} onClose={() => setPickerOpen(false)} />
      )}
      {/* 受控右键菜单（第 28 轮，文件树 0.2.3 同款模式）：固定定位 + document mousedown 关闭，
          容器 onMouseDown 阻止冒泡保证菜单内点击先于关闭执行；卡片 onClick 已排除本容器 */}
      {ctxMenu !== null && (
        <div
          data-testid="project-ctx-menu"
          style={{ position: 'fixed', left: ctxMenu.x, top: ctxMenu.y, zIndex: 1050, borderRadius: 8, background: SEMANTIC.layoutBg, boxShadow: '0 6px 16px rgba(0, 0, 0, 0.16)', padding: 4 }}
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
      )}
    </Card>
  );
}
