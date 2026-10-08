/**
 * 归属集合弹窗（第 28 轮新增；第 31 轮评审后修正）：把项目加入/移出集合。
 * 交互：勾选列表（勾选态=当前所属）+ 底部快捷新建；保存时只对发生变化的集合调接口——
 * 加入走 members 追加语义（replace 缺省 false，不动已有成员），
 * 移出走专用 DELETE /api/collections/:id/members/:projectId（单成员删除，
 * 不再以弹窗快照全量替换——多窗口并发编辑不再互相覆盖）。
 * 竞态修复：弹窗内新建的集合在 ['collections'] 缓存刷新完成前不在列表里，
 * 立即点保存会漏发成员请求——新建结果额外保存在本地 createdCols 并参与保存循环。
 * 用法：父组件条件渲染并带 key={project.id}，每次打开都是全新挂载，
 * 勾选态取打开瞬间的 project.collections 快照，保存 diff 与之对齐。
 */
import { App, Button, Checkbox, Empty, Input, Modal, Space } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError } from '@/lib/api';
import type { CollectionInfo, ProjectSummary } from '@ttfolio/shared';
import { useAppStore } from '@/app/store';

export function CollectionPickerModal({
  project,
  onClose,
}: {
  project: ProjectSummary;
  onClose: () => void;
}): React.JSX.Element {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [checked, setChecked] = useState<Set<string>>(() => new Set(project.collections));
  const [newName, setNewName] = useState('');
  /** 弹窗内新建的集合：缓存刷新完成前也参与勾选展示与保存 diff（评审竞态修复） */
  const [createdCols, setCreatedCols] = useState<CollectionInfo[]>([]);
  const { data: collections } = useQuery({
    queryKey: ['collections'],
    queryFn: () => api.get<CollectionInfo[]>('/api/collections'),
  });
  const fetched = collections ?? [];
  // 展示与保存统一用合并视图：服务端列表 + 本地新建（去重，刷新落地后自然收敛）
  const cols = [...fetched, ...createdCols.filter((c) => !fetched.some((x) => x.id === c.id))];
  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['projects'] });
    await queryClient.invalidateQueries({ queryKey: ['collections'] });
  };

  const save = useMutation({
    mutationFn: async (): Promise<void> => {
      const calls: Promise<unknown>[] = [];
      for (const c of cols) {
        const was = project.collections.includes(c.id);
        const now = checked.has(c.id);
        if (was === now) continue;
        if (now) {
          calls.push(api.post(`/api/collections/${c.id}/members`, { projectIds: [project.id] }));
        } else {
          calls.push(api.del(`/api/collections/${c.id}/members/${project.id}`));
        }
      }
      await Promise.all(calls);
    },
    onSuccess: () => {
      void message.success('已更新集合归属');
      void invalidate();
      onClose();
    },
    onError: (e) => void message.error(e instanceof ApiClientError ? e.message : '保存失败'),
  });

  const create = useMutation({
    mutationFn: () => api.post<CollectionInfo>('/api/collections', { name: newName.trim() }),
    onSuccess: (c) => {
      if (c !== null) {
        setCreatedCols((prev) => [...prev, c]);
        setChecked((prev) => new Set(prev).add(c.id));
      }
      setNewName('');
      void queryClient.invalidateQueries({ queryKey: ['collections'] });
      void message.success(`已创建集合「${c?.name ?? ''}」并勾选`);
    },
    onError: (e) => void message.error(e instanceof ApiClientError ? e.message : '创建失败'),
  });

  const goSettings = (): void => {
    useAppStore
      .getState()
      .openTab(
        { kind: 'settings', projectId: null, targetPath: null, subTab: 'collections', scroll: 0 },
        '设置',
      );
    onClose();
  };

  const changed = cols.some((c) => project.collections.includes(c.id) !== checked.has(c.id));

  return (
    <Modal
      title={`归属集合：${project.alias ?? project.diskName}`}
      open
      onCancel={onClose}
      onOk={() => save.mutate()}
      okText="保存"
      okButtonProps={{ loading: save.isPending, disabled: !changed }}
      cancelText="取消"
      width={420}
      data-testid="collection-picker-modal"
    >
      {cols.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="还没有集合"
          data-testid="collection-picker-empty"
        >
          <Button type="primary" onClick={goSettings}>
            去设置页创建
          </Button>
        </Empty>
      ) : (
        <div
          style={{ maxHeight: 280, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}
          data-testid="collection-picker-list"
        >
          {cols.map((c) => (
            <Checkbox
              key={c.id}
              checked={checked.has(c.id)}
              onChange={(e) => {
                setChecked((prev) => {
                  const next = new Set(prev);
                  if (e.target.checked) next.add(c.id);
                  else next.delete(c.id);
                  return next;
                });
              }}
            >
              {c.name}
              <span style={{ fontSize: 12, opacity: 0.55, marginLeft: 6 }}>{c.memberCount} 个项目</span>
            </Checkbox>
          ))}
        </div>
      )}
      <Space.Compact style={{ width: '100%', marginTop: 12 }}>
        <Input
          size="small"
          placeholder="新集合名称（回车创建并勾选）"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onPressEnter={() => {
            if (newName.trim() !== '') create.mutate();
          }}
        />
        <Button
          size="small"
          icon={<PlusOutlined />}
          disabled={newName.trim() === ''}
          loading={create.isPending}
          onClick={() => create.mutate()}
        >
          新建并勾选
        </Button>
      </Space.Compact>
    </Modal>
  );
}
