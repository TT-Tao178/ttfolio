/** 回收站页（FR-4.9）：列表/预览/恢复/彻底删除/清空/保留策略清理。 */
import { Alert, App, Button, Empty, List, Modal, Select, Space, Tag } from 'antd';
import { DeleteOutlined, DiffOutlined, UndoOutlined } from '@ant-design/icons';
import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError } from '@/lib/api';
import type { ProjectSummary, TrashItem } from '@ttfolio/shared';
import { fmtBytes, relTime } from '@/lib/format';
import { StateView } from '@/components/StateView';
import { useAppStore } from '@/app/store';
import { encodeCompareSpec } from '@/features/compare/compareShared';

/** 路径归一（前斜杠 + 去尾分隔 + 小写），用于「原路径属于哪个登记项目」的前缀匹配。 */
function normPath(p: string): string {
  return p
    .replace(/[\\/]+/g, '/')
    .replace(/\/$/, '')
    .toLowerCase();
}

export function TrashPage(): React.JSX.Element {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<TrashItem | null>(null);
  const {
    data: items,
    isLoading,
    error,
  } = useQuery({ queryKey: ['trash'], queryFn: () => api.get<TrashItem[]>('/api/trash') });
  const { data: previewData } = useQuery({
    queryKey: ['trash-preview', preview?.id],
    queryFn: () => api.get<{ entries: string[] }>(`/api/trash/${preview?.id}/preview`),
    enabled: preview !== null,
  });
  const { data: projects } = useQuery({
    queryKey: ['projects', 'trash-page'],
    queryFn: () => api.get<ProjectSummary[]>('/api/projects', { status: 'active' }),
  });

  /** 原路径命中的登记项目（前缀匹配）；未登记返回 null（无法与当前文件对比）。 */
  const matchProject = (originPath: string): ProjectSummary | null => {
    const o = normPath(originPath);
    return (projects ?? []).find((p) => o.startsWith(`${normPath(p.dirPath)}/`)) ?? null;
  };

  /** 与当前文件对比（FR-13.9 / T-106b）：左=项目内现存原路径，右=回收站副本。 */
  const openCompare = (t: TrashItem): void => {
    const p = matchProject(t.originPath);
    if (p === null) return;
    const rel = normPath(t.originPath).slice(normPath(p.dirPath).length + 1);
    useAppStore.getState().openTab(
      {
        kind: 'compare',
        projectId: null,
        targetPath: encodeCompareSpec({
          left: { projectId: p.id, path: rel },
          right: { trashId: t.id, name: t.name },
        }),
        subTab: null,
        scroll: 0,
      },
      `对比 ${t.name}`,
    );
  };

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['trash'] });
  };

  // 按项目筛选（FR-13.11 / T-108）；合计随筛选走
  const [scopeProject, setScopeProject] = useState<string | undefined>(undefined);
  const filtered = (items ?? []).filter((t) => scopeProject === undefined || t.projectId === scopeProject);

  const restore = useMutation({
    mutationFn: (v: { id: string; targetDir?: string; overwrite?: boolean }) =>
      api.post('/api/trash/restore', v),
    onSuccess: (_r, v) => {
      void message.success(v.overwrite === true ? '已恢复（覆盖原位置文件）' : '已恢复');
      invalidate();
    },
    onError: (e, v) => {
      // 原路径被占用（服务端 409 TRASH_PATH_TAKEN）：提供三条路——覆盖原位置（FR-13.11 /
      // T-108，二次确认）、指定其他目录恢复、取消
      if (e instanceof ApiClientError && e.code === 'TRASH_PATH_TAKEN') {
        modal.confirm({
          title: '原路径已被占用',
          content: '可以覆盖原位置的现有文件后恢复（现有内容将丢失、不可恢复），或指定其他目录。',
          okText: '覆盖原位置',
          okButtonProps: { danger: true },
          cancelText: '取消',
          onOk: () => restore.mutate({ id: v.id, overwrite: true }),
          onCancel: () => {
            modal.confirm({
              title: '恢复到其他目录',
              content: '可指定其他目录恢复（将保持条目原名）。',
              okText: '选择目录…',
              cancelText: '取消',
              onOk: async () => {
                try {
                  void message.info('正在弹出系统对话框；若被其他窗口挡住，请按 Alt+Tab 查看', 5);
                  const r = await api.post<{ paths: string[] }>('/api/dialogs/pick-folder');
                  const dir = r.paths[0];
                  if (dir !== undefined) restore.mutate({ id: v.id, targetDir: dir });
                  else void message.info('未选择目录');
                } catch {
                  void message.error('打开系统对话框失败');
                }
              },
            });
          },
        });
        return;
      }
      void message.error(e instanceof ApiClientError ? e.message : '恢复失败');
    },
  });

  const purge = useMutation({
    mutationFn: (id: string) => api.del(`/api/trash/${id}`, { confirm: '1' }),
    onSuccess: () => {
      void message.success('已彻底删除');
      invalidate();
    },
  });

  const empty = useMutation({
    mutationFn: () => api.post('/api/trash/empty', { confirm: true }),
    onSuccess: () => {
      void message.success('清空完成');
      invalidate();
    },
  });

  return (
    <div style={{ padding: 16, height: '100%', overflow: 'auto' }} data-testid="trash-page">
      <Space style={{ marginBottom: 12 }} wrap>
        <strong>回收站</strong>
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="按项目筛选"
          style={{ minWidth: 160 }}
          value={scopeProject}
          onChange={setScopeProject}
          options={(projects ?? []).map((p) => ({ value: p.id, label: p.alias ?? p.diskName }))}
          data-testid="trash-project-filter"
        />
        <span style={{ fontSize: 12, opacity: 0.7 }}>
          {filtered.length} 条 · {fmtBytes(filtered.reduce((a, t) => a + t.sizeBytes, 0))} · 默认保留 30
          天（到期在设置页提示清理，不自动删）
        </span>
        <div style={{ flex: 1 }} />
        <Button
          danger
          size="small"
          disabled={(items ?? []).length === 0}
          onClick={() =>
            modal.confirm({
              title: '清空回收站？',
              content:
                '将彻底删除回收站内全部内容，不可恢复、不进任何回收站。项目文件中未被删除的部分不受影响。',
              okText: '清空（L3）',
              okButtonProps: { danger: true },
              cancelText: '取消',
              onOk: () => empty.mutate(),
            })
          }
        >
          清空回收站
        </Button>
        {/* 「清理超期」是批量不可恢复操作（与单条彻底删除同级 L3），此前无确认直接执行——评审后补齐 */}
        <Button
          size="small"
          onClick={() =>
            modal.confirm({
              title: '清理超过保留期的条目？',
              content: '将彻底删除所有超过 30 天保留期的条目，不可恢复。',
              okText: '清理（L3）',
              okButtonProps: { danger: true },
              cancelText: '取消',
              onOk: () => void api.post('/api/trash/purge-old').then(invalidate),
            })
          }
        >
          清理超过保留期的条目
        </Button>
      </Space>
      <StateView
        loading={isLoading}
        error={error}
        empty={(items ?? []).length === 0}
        emptyText="回收站是空的"
      >
        <List
          dataSource={filtered}
          renderItem={(t) => (
            <List.Item style={{ padding: '6px 0' }}>
              <span style={{ display: 'inline-flex', gap: 8, width: '100%', alignItems: 'center' }}>
                <Tag color={t.kind === 'dir' ? 'blue' : 'default'}>{t.kind === 'dir' ? '目录' : '文件'}</Tag>
                <strong>{t.name}</strong>
                <span className="tt-ellipsis tt-mono" style={{ fontSize: 12, flex: 1, opacity: 0.7 }}>
                  {t.originPath}
                </span>
                <span style={{ fontSize: 12, opacity: 0.6 }}>
                  {fmtBytes(t.sizeBytes)} · {relTime(t.deletedAt)}
                </span>
                <Space>
                  <Button size="small" onClick={() => setPreview(t)}>
                    预览
                  </Button>
                  {t.kind === 'file' && matchProject(t.originPath) !== null && (
                    <Button
                      size="small"
                      icon={<DiffOutlined />}
                      onClick={() => openCompare(t)}
                      title="与项目内的当前文件并排对比（仅文本 ≤5MB）"
                    >
                      对比
                    </Button>
                  )}
                  <Button
                    size="small"
                    type="primary"
                    icon={<UndoOutlined />}
                    onClick={() => restore.mutate({ id: t.id })}
                  >
                    恢复
                  </Button>
                  <Button
                    size="small"
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() =>
                      modal.confirm({
                        title: `彻底删除 ${t.name}？`,
                        content: '不可恢复。回收站内容删除后无法找回。',
                        okText: '彻底删除（L3）',
                        okButtonProps: { danger: true },
                        cancelText: '取消',
                        onOk: () => purge.mutate(t.id),
                      })
                    }
                  />
                </Space>
              </span>
            </List.Item>
          )}
        />
      </StateView>
      {preview !== null && (
        <Modal
          title={`预览：${preview.name}（前 50 条）`}
          open
          onCancel={() => setPreview(null)}
          footer={[
            <Button key="c" onClick={() => setPreview(null)}>
              关闭
            </Button>,
          ]}
        >
          {(previewData?.entries ?? []).length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无法读取内容（可能已损坏）" />
          ) : (
            <Alert
              type="info"
              message={
                <div style={{ maxHeight: 300, overflow: 'auto' }}>
                  {(previewData?.entries ?? []).map((e) => (
                    <div key={e} className="tt-mono" style={{ fontSize: 12 }}>
                      {e}
                    </div>
                  ))}
                </div>
              }
            />
          )}
        </Modal>
      )}
    </div>
  );
}
