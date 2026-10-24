/**
 * 集合视图「从已登记项目中添加」弹窗（FR-2.7 补全 / T-130）：列出全部已登记项目
 * （active）供勾选，确认后批量加入该集合——补齐「已登记项目进集合只能逐个右键
 * 归属集合」的入口空白。与「添加项目」（登记新文件夹）互为补充不混淆。
 * 复用 POST /api/collections/:id/members 追加语义（replace 缺省 false，服务端
 * INSERT OR IGNORE 对重复成员幂等）；已在本集合的成员不出现（入口处排除）。
 * 服务端成员写入是单事务批量，请求要么整体成功要么整体失败，失败如实展示原因。
 * 用法：父组件条件渲染并带 key={collectionId}，每次打开全新挂载（勾选态即开即用）。
 */
import { App, Button, Checkbox, Empty, Input, Modal } from 'antd';
import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError } from '@/lib/api';
import type { CollectionInfo, ProjectSummary } from '@ttfolio/shared';

export function CollectionAddMembersModal({
  collectionId,
  onClose,
}: {
  collectionId: string;
  onClose: () => void;
}): React.JSX.Element {
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [q, setQ] = useState('');
  // 全部已登记项目与集合列表均与侧栏/工具条共享缓存（集合视图打开时已就绪）
  const { data: projects } = useQuery({
    queryKey: ['projects', 'sidebar'],
    queryFn: () => api.get<ProjectSummary[]>('/api/projects', { status: 'active' }),
  });
  const { data: collections } = useQuery({
    queryKey: ['collections'],
    queryFn: () => api.get<CollectionInfo[]>('/api/collections'),
  });
  const collection = (collections ?? []).find((c) => c.id === collectionId);
  // 已在集合内的成员不重复出现（验收项）；缓存未就绪时不排除（开窗瞬间集合必已加载）
  const memberIds = new Set(collection?.projectIds ?? []);
  const nameOf = (p: ProjectSummary): string => p.alias ?? p.diskName;
  const candidates = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return (projects ?? [])
      .filter((p) => !memberIds.has(p.id))
      .filter(
        (p) =>
          kw === '' ||
          nameOf(p).toLowerCase().includes(kw) ||
          p.diskName.toLowerCase().includes(kw) ||
          p.dirPath.toLowerCase().includes(kw),
      );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projects, collections, q]);

  const add = useMutation({
    mutationFn: () => api.post(`/api/collections/${collectionId}/members`, { projectIds: [...checked] }),
    onSuccess: () => {
      void message.success(`已加入 ${checked.size} 个项目到「${collection?.name ?? '集合'}」`);
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
      void queryClient.invalidateQueries({ queryKey: ['collections'] });
      onClose();
    },
    onError: (e) => void message.error(e instanceof ApiClientError ? e.message : '加入失败'),
  });

  const allVisibleChecked = candidates.length > 0 && candidates.every((p) => checked.has(p.id));
  return (
    <Modal
      title={`从已登记项目添加到「${collection?.name ?? '集合'}」`}
      open
      onCancel={onClose}
      onOk={() => add.mutate()}
      okText={`加入所选（${checked.size}）`}
      okButtonProps={{ loading: add.isPending, disabled: checked.size === 0 }}
      cancelText="取消"
      width={460}
      data-testid="collection-add-members-modal"
    >
      <Input.Search
        allowClear
        placeholder="搜索项目名 / 别名 / 路径"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        style={{ marginBottom: 8 }}
        data-testid="collection-add-members-search"
      />
      {candidates.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={q.trim() === '' ? '全部已登记项目都已在集合内' : '没有匹配的项目'}
          data-testid="collection-add-members-empty"
        />
      ) : (
        <div
          style={{ maxHeight: 300, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}
          data-testid="collection-add-members-list"
        >
          {candidates.map((p) => (
            <Checkbox
              key={p.id}
              checked={checked.has(p.id)}
              onChange={(e) => {
                setChecked((prev) => {
                  const next = new Set(prev);
                  if (e.target.checked) next.add(p.id);
                  else next.delete(p.id);
                  return next;
                });
              }}
            >
              {nameOf(p)}
              <span
                className="tt-mono tt-ellipsis"
                style={{
                  fontSize: 11,
                  opacity: 0.55,
                  marginLeft: 6,
                  maxWidth: 240,
                  display: 'inline-block',
                  verticalAlign: 'bottom',
                }}
                title={p.dirPath}
              >
                {p.dirPath}
              </span>
            </Checkbox>
          ))}
        </div>
      )}
      {candidates.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <Button
            size="small"
            type="link"
            style={{ padding: 0 }}
            onClick={() =>
              setChecked((prev) => {
                const next = new Set(prev);
                for (const p of candidates) {
                  if (allVisibleChecked) next.delete(p.id);
                  else next.add(p.id);
                }
                return next;
              })
            }
            data-testid="collection-add-members-toggle-all"
          >
            {allVisibleChecked ? '取消全选本页' : '全选本页'}
          </Button>
        </div>
      )}
    </Modal>
  );
}
