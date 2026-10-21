/** 批量操作条（FR-13.10 / T-107）：选中 N 个项目后的浮动操作条（打标签/入集合/归档/重分析/移除登记）。 */
import { App, Button, Select, Space, Tag } from 'antd';
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
}: {
  selectedIds: string[];
  onClear: () => void;
}): React.JSX.Element {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [tagId, setTagId] = useState<string | undefined>();
  const [collectionId, setCollectionId] = useState<string | undefined>();
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
        position: 'fixed',
        bottom: 44,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 900,
        background: SEMANTIC.layoutBg,
        border: `1px solid ${SEMANTIC.split}`,
        borderRadius: 10,
        boxShadow: '0 6px 20px rgba(0, 0, 0, 0.18)',
        padding: '8px 12px',
      }}
    >
      <Space wrap size={8}>
        <Tag color="processing" style={{ marginInlineEnd: 0 }}>
          已选 {selectedIds.length} 个
        </Tag>
        <Select
          placeholder="选择标签"
          style={{ minWidth: 130 }}
          value={tagId}
          onChange={setTagId}
          showSearch
          optionFilterProp="label"
          options={(tags ?? []).map((t) => ({ value: t.id, label: t.name }))}
        />
        <Button
          disabled={tagId === undefined}
          loading={run.isPending}
          onClick={() => {
            if (tagId !== undefined) run.mutate({ action: 'tag', tagId });
          }}
        >
          打标签
        </Button>
        <Select
          placeholder="选择集合"
          style={{ minWidth: 130 }}
          value={collectionId}
          onChange={setCollectionId}
          showSearch
          optionFilterProp="label"
          options={(collections ?? []).map((c) => ({ value: c.id, label: c.name }))}
        />
        <Button
          disabled={collectionId === undefined}
          onClick={() => {
            if (collectionId !== undefined) run.mutate({ action: 'collection', collectionId });
          }}
        >
          加入
        </Button>
        <Button onClick={confirmArchive}>归档</Button>
        <Button icon={<ReloadOutlined />} loading={analyze.isPending} onClick={() => analyze.mutate()}>
          重新分析
        </Button>
        <Button danger onClick={confirmUnregister}>
          移除登记
        </Button>
        <Button type="text" onClick={onClear}>
          取消
        </Button>
      </Space>
    </div>
  );
}
