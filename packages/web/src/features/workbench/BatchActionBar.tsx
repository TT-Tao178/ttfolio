/**
 * 批量操作条（FR-13.10 / T-107；第 90 轮改版）：选择模式下的底部固定操作条
 * （打标签/入集合/归档/重分析/移除登记，走 POST /api/projects/batch-action）。
 * 第 90 轮（用户点名）：由悬浮圆岛改为页面内固定底条（文件页多选 T-128 同款范式）——
 * sticky 贴滚动容器底、进选择模式常驻，含 全选/清空/完成；0 选中时批量操作禁用。
 */
import { App, Button, Select, Tag } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useState } from 'react';
import { api, ApiClientError } from '@/lib/api';
import type { CollectionInfo } from '@ttfolio/shared';
import { SEMANTIC } from '@/theme/tokens';

interface TagInfo {
  id: string;
  name: string;
  color: string | null;
  projectCount: number;
}

const ACTION_LABELS: Record<string, string> = {
  archive: '归档',
  unarchive: '取消归档',
  tag: '批量打标签',
  collection: '批量加入集合',
  unregister: '移除登记',
};

export function BatchActionBar({
  selectedIds,
  onClear,
  onExit,
  onToggleAll,
  allSelected,
}: {
  selectedIds: string[];
  /** 只清空选中集（保留选择模式） */
  onClear: () => void;
  /** 退出选择模式（清空选中 + 收条） */
  onExit: () => void;
  /** 全选/取消全选当前视图 */
  onToggleAll: () => void;
  allSelected: boolean;
}): React.JSX.Element {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [tagId, setTagId] = useState<string | undefined>();
  const [collectionId, setCollectionId] = useState<string | undefined>();
  const none = selectedIds.length === 0;
  const { data: tags } = useQuery({
    queryKey: ['tags'],
    queryFn: () => api.get<TagInfo[]>('/api/tags'),
  });
  const { data: collections } = useQuery({
    queryKey: ['collections'],
    queryFn: () => api.get<CollectionInfo[]>('/api/collections'),
  });

  const run = useMutation({
    mutationFn: (body: { action: string; tagId?: string; collectionId?: string }) =>
      api.post<{ done: number; failed: string[] }>('/api/projects/batch-action', {
        projectIds: selectedIds,
        ...body,
      }),
    onSuccess: async (res, vars) => {
      await queryClient.invalidateQueries({ queryKey: ['projects'] });
      // 移除登记/归档会改变侧栏集合计数（2026-10-31 报障）：集合失效与 CollectionAddMembersModal 同款双失效
      if (vars.action === 'unregister' || vars.action === 'archive' || vars.action === 'unarchive') {
        await queryClient.invalidateQueries({ queryKey: ['collections'] });
      }
      const label = ACTION_LABELS[vars.action] ?? vars.action;
      if (res.failed.length > 0) {
        void message.warning(`${label}：成功 ${res.done} 个，失败 ${res.failed.length} 个`);
      } else {
        void message.success(`已对 ${res.done} 个项目完成${label}`);
      }
      onClear();
    },
    onError: (e) => void message.error(e instanceof ApiClientError ? e.message : '批量操作失败'),
  });
  const analyze = useMutation({
    mutationFn: () => api.post('/api/projects/analyze', { projectIds: selectedIds }),
    onSuccess: () => {
      void message.success(`已开始重新分析 ${selectedIds.length} 个项目`);
      onClear();
    },
  });

  const confirmArchive = (): void => {
    modal.confirm({
      title: `归档选中的 ${selectedIds.length} 个项目？`,
      content: '归档后从卡片墙与侧栏主列表消失，可在「已归档」视图恢复。',
      okText: '归档',
      onOk: () => run.mutate({ action: 'archive' }),
    });
  };
  const confirmUnregister = (): void => {
    modal.confirm({
      title: `仅移除 ${selectedIds.length} 个项目的登记？`,
      content: '只删除 ttFolio 里的索引记录，不会动磁盘上的任何文件；之后可重新添加。',
      okText: '移除登记',
      okButtonProps: { danger: true },
      onOk: () => run.mutate({ action: 'unregister' }),
    });
  };

  return (
    <div
      data-testid="batch-bar"
      style={{
        position: 'sticky',
        bottom: 0,
        zIndex: 800,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: 'wrap',
        background: SEMANTIC.layoutBg,
        borderTop: `1px solid ${SEMANTIC.split}`,
        padding: '8px 2px',
        fontSize: 12,
      }}
    >
      <Tag color="processing" style={{ marginInlineEnd: 0 }}>
        已选 {selectedIds.length} 个
      </Tag>
      <Button size="small" onClick={onToggleAll}>
        {allSelected ? '取消全选' : '全选'}
      </Button>
      <Select
        placeholder="选择标签"
        size="small"
        style={{ minWidth: 130 }}
        value={tagId}
        onChange={setTagId}
        disabled={none}
        showSearch
        optionFilterProp="label"
        options={(tags ?? []).map((t) => ({ value: t.id, label: t.name }))}
      />
      <Button
        size="small"
        disabled={none || tagId === undefined}
        loading={run.isPending}
        onClick={() => {
          if (tagId !== undefined) run.mutate({ action: 'tag', tagId });
        }}
      >
        打标签
      </Button>
      <Select
        placeholder="选择集合"
        size="small"
        style={{ minWidth: 130 }}
        value={collectionId}
        onChange={setCollectionId}
        disabled={none}
        showSearch
        optionFilterProp="label"
        options={(collections ?? []).map((c) => ({ value: c.id, label: c.name }))}
      />
      <Button
        size="small"
        disabled={none || collectionId === undefined}
        onClick={() => {
          if (collectionId !== undefined) run.mutate({ action: 'collection', collectionId });
        }}
      >
        加入
      </Button>
      <Button size="small" disabled={none} onClick={confirmArchive}>
        归档
      </Button>
      <Button
        size="small"
        icon={<ReloadOutlined />}
        disabled={none}
        loading={analyze.isPending}
        onClick={() => analyze.mutate()}
      >
        重新分析
      </Button>
      <Button size="small" danger disabled={none} onClick={confirmUnregister}>
        移除登记
      </Button>
      <Button size="small" type="text" onClick={onClear}>
        清空
      </Button>
      <Button size="small" type="primary" onClick={onExit} data-testid="batch-bar-done">
        完成
      </Button>
    </div>
  );
}
