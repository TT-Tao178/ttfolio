/**
 * 项目卡片（卡片墙 / 工作台总览共用）。
 * 从 Workbench.tsx 原地抽出：总览（Dashboard）也要放项目卡片，而 Workbench 已引用 Dashboard，
 * 若 Dashboard 反向 import Workbench 会形成循环依赖。
 */
import { App, Avatar, Card, Dropdown, Tag } from 'antd';
import {
  AimOutlined, BranchesOutlined, CopyOutlined, FileTextOutlined, FolderOpenOutlined, MoreOutlined,
  ReloadOutlined, StarFilled, StarOutlined, WarningOutlined
} from '@ant-design/icons';
import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ProjectSummary } from '@ttfolio/shared';
import { useAppStore } from '@/app/store';
import { LanguageBar } from '@/components/LanguageBar';
import { relTime } from '@/lib/format';
import { typeLabel } from '@/components/DetailPanel';
import { RelocateModal } from '@/features/workbench/RelocateModal';
import { SEMANTIC } from '@/theme/tokens';

export function ProjectCard({ p, onOpen, onPin, onAnalyze }: {
  p: ProjectSummary; onOpen: () => void; onPin: () => void; onAnalyze: () => void;
}): React.JSX.Element {
  const { message, modal } = App.useApp();
  const queryClient2 = useQueryClient();
  const [relocateOpen, setRelocateOpen] = useState(false);
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

  const menu = {
    items: [
      ...(p.pathOk === false
        ? [
            { key: 'relocate', label: '重新定位到新目录…', icon: <AimOutlined />, onClick: () => setRelocateOpen(true) },
            { type: 'divider' as const }
          ]
        : []),
      { key: 'open', label: '打开项目', icon: <FolderOpenOutlined />, onClick: onOpen },
      { key: 'files', label: '打开文件页', icon: <FileTextOutlined />, onClick: onOpen },
      { key: 'git', label: '查看 Git', icon: <BranchesOutlined />, disabled: !p.gitIsRepo, onClick: () => useAppStore.getState().openTab({ kind: 'project', projectId: p.id, targetPath: null, subTab: 'git', scroll: 0 }, p.alias ?? p.diskName) },
      { type: 'divider' as const },
      { key: 'copy', label: '复制路径', icon: <CopyOutlined />, onClick: () => { void navigator.clipboard.writeText(p.dirPath); void message.success('已复制路径'); } },
      { key: 'explorer', label: '在资源管理器中显示', disabled: p.pathOk === false, onClick: () => { void api.post('/api/open', { target: 'explorer', projectId: p.id }); } },
      { key: 'terminal', label: '在此打开终端', disabled: p.pathOk === false, onClick: () => { void api.post('/api/open', { target: 'terminal', projectId: p.id }); } },
      { type: 'divider' as const },
      { key: 'analyze', label: '重新分析', icon: <ReloadOutlined />, disabled: p.pathOk === false, onClick: onAnalyze },
      { key: 'pin', label: p.isPinned ? '取消固定' : '固定', icon: p.isPinned ? <StarFilled /> : <StarOutlined />, onClick: onPin },
      { type: 'divider' as const },
      { key: 'unregister', label: '仅从 ttFolio 移除登记', onClick: confirmUnregister },
      { key: 'delete', label: '移除并删除文件（进回收站）', danger: true, disabled: p.pathOk === false, onClick: confirmDelete }
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
          {p.pathOk === false
            ? <Tag style={{ flexShrink: 0 }} color="error" icon={<WarningOutlined />}>目录失效</Tag>
            : <Tag style={{ flexShrink: 0 }} color="blue">{typeLabel(p.type)}</Tag>}
        </span>
      }
      extra={
        <Dropdown menu={menu} trigger={['contextMenu', 'click']}>
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
    </Card>
  );
}
