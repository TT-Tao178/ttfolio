/** 标签中枢（FR-13.10 / T-107）：重命名 / 合并 / 删除 / 颜色，按使用计数排序。 */
import { App, Button, ColorPicker, Empty, Input, List, Modal, Select, Space, Tag } from 'antd';
import { DeleteOutlined, MergeOutlined, EditOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import React, { useState } from 'react';
import { api, ApiClientError } from '@/lib/api';

interface TagInfo {
  id: string;
  name: string;
  color: string | null;
  projectCount: number;
}

export function TagHub(): React.JSX.Element {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [renaming, setRenaming] = useState<TagInfo | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [mergeSource, setMergeSource] = useState<TagInfo | null>(null);
  const [mergeTarget, setMergeTarget] = useState<string | undefined>();
  const { data: tags } = useQuery({
    queryKey: ['tags'],
    queryFn: () => api.get<TagInfo[]>('/api/tags'),
  });
  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['tags'] });
    await queryClient.invalidateQueries({ queryKey: ['projects'] });
  };
  const patch = useMutation({
    mutationFn: (v: { id: string; body: { name?: string; color?: string | null } }) =>
      api.patch(`/api/tags/${v.id}`, v.body),
    onSuccess: () => {
      void message.success('已更新');
      void invalidate();
      setRenaming(null);
    },
    onError: (e) => void message.error(e instanceof ApiClientError ? e.message : '更新失败'),
  });
  const merge = useMutation({
    mutationFn: (v: { sourceId: string; targetId: string }) =>
      api.post<{ moved: number }>('/api/tags/merge', v),
    onSuccess: async (res: { moved: number }) => {
      void message.success(`已合并，迁移 ${res.moved} 条引用`);
      await invalidate();
      setMergeSource(null);
      setMergeTarget(undefined);
    },
    onError: (e) => void message.error(e instanceof ApiClientError ? e.message : '合并失败'),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.del<{ affectedProjects: number }>(`/api/tags/${id}`),
    onSuccess: async (res) => {
      void message.success(`已删除标签（清理 ${res.affectedProjects} 个项目的引用）`);
      await invalidate();
    },
    onError: (e) => void message.error(e instanceof ApiClientError ? e.message : '删除失败'),
  });

  // 按使用计数排序（FR-13.10：中枢以治理视角看标签）
  const sorted = [...(tags ?? [])].sort(
    (a, b) => b.projectCount - a.projectCount || a.name.localeCompare(b.name, 'zh'),
  );

  const confirmDelete = (t: TagInfo): void => {
    modal.confirm({
      title: `删除标签「${t.name}」？`,
      content: `${t.projectCount} 个项目上的这个标签将被移除（项目本身不受影响）。`,
      okText: '删除标签',
      okButtonProps: { danger: true },
      onOk: () => del.mutateAsync(t.id),
    });
  };
  const confirmMerge = (): void => {
    if (mergeSource === null || mergeTarget === undefined) return;
    modal.confirm({
      title: `把「${mergeSource.name}」合并到目标标签？`,
      content: '引用将迁移到目标标签（重复自动去重），源标签删除，可在活动中心查审计。',
      okText: '合并',
      onOk: () => merge.mutateAsync({ sourceId: mergeSource.id, targetId: mergeTarget }),
    });
  };

  if ((tags ?? []).length === 0) {
    return (
      <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有标签；在项目详情右栏输入即可创建" />
    );
  }

  return (
    <div data-testid="tag-hub">
      <List
        size="small"
        dataSource={sorted}
        rowKey="id"
        renderItem={(t) => (
          <List.Item
            style={{ padding: '5px 0' }}
            actions={[
              <Button
                key="rename"
                size="small"
                type="text"
                icon={<EditOutlined />}
                onClick={() => {
                  setRenaming(t);
                  setRenameValue(t.name);
                }}
              >
                重命名
              </Button>,
              <Button
                key="merge"
                size="small"
                type="text"
                icon={<MergeOutlined />}
                disabled={(tags ?? []).length < 2}
                onClick={() => {
                  setMergeSource(t);
                  setMergeTarget(undefined);
                }}
              >
                合并到…
              </Button>,
              <Button
                key="delete"
                size="small"
                type="text"
                danger
                icon={<DeleteOutlined />}
                onClick={() => confirmDelete(t)}
              />,
            ]}
          >
            <span style={{ display: 'inline-flex', gap: 10, width: '100%', alignItems: 'center' }}>
              <ColorPicker
                size="small"
                value={t.color ?? '#8c8c8c'}
                onChange={(c) => patch.mutate({ id: t.id, body: { color: c.toHexString() } })}
                presets={[
                  {
                    label: '常用',
                    colors: [
                      '#1677ff',
                      '#52c41a',
                      '#faad14',
                      '#f5222d',
                      '#722ed1',
                      '#13c2c2',
                      '#eb2f96',
                      '#8c8c8c',
                    ],
                  },
                ]}
              />
              <span style={{ fontWeight: 600 }}>{t.name}</span>
              <Tag style={{ marginInlineEnd: 0 }}>{t.projectCount} 个项目</Tag>
            </span>
          </List.Item>
        )}
      />
      <Modal
        title={`重命名「${renaming?.name ?? ''}」`}
        open={renaming !== null}
        onCancel={() => setRenaming(null)}
        onOk={() => {
          if (renaming === null) return;
          const v = renameValue.trim();
          if (v === '') {
            void message.warning('标签名不能为空');
            return;
          }
          patch.mutate({ id: renaming.id, body: { name: v } });
        }}
        okText="保存"
        destroyOnClose
      >
        <Input
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          placeholder="新名称（重名会被拒绝）"
          onPressEnter={() => {
            if (renaming === null) return;
            const v = renameValue.trim();
            if (v !== '') patch.mutate({ id: renaming.id, body: { name: v } });
          }}
        />
      </Modal>
      <Modal
        title={`合并「${mergeSource?.name ?? ''}」到…`}
        open={mergeSource !== null}
        onCancel={() => setMergeSource(null)}
        onOk={confirmMerge}
        okText="下一步"
        okButtonProps={{ disabled: mergeTarget === undefined }}
        destroyOnClose
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Select
            placeholder="选择目标标签（引用将迁移过去）"
            style={{ width: '100%' }}
            value={mergeTarget}
            onChange={setMergeTarget}
            showSearch
            optionFilterProp="label"
            options={(tags ?? [])
              .filter((t) => t.id !== mergeSource?.id)
              .map((t) => ({ value: t.id, label: `${t.name}（${t.projectCount}）` }))}
          />
        </Space>
      </Modal>
    </div>
  );
}
