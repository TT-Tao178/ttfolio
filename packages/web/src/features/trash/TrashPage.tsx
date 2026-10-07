/** 回收站页（FR-4.9）：列表/预览/恢复/彻底删除/清空/保留策略清理。 */
import { Alert, App, Button, Empty, List, Modal, Space, Tag } from 'antd';
import { DeleteOutlined, UndoOutlined } from '@ant-design/icons';
import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError } from '@/lib/api';
import type { TrashItem } from '@ttfolio/shared';
import { fmtBytes, relTime } from '@/lib/format';
import { StateView } from '@/components/StateView';

export function TrashPage(): React.JSX.Element {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<TrashItem | null>(null);
  const { data: items, isLoading, error } = useQuery({ queryKey: ['trash'], queryFn: () => api.get<TrashItem[]>('/api/trash') });
  const { data: previewData } = useQuery({
    queryKey: ['trash-preview', preview?.id],
    queryFn: () => api.get<{ entries: string[] }>(`/api/trash/${preview?.id}/preview`),
    enabled: preview !== null
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['trash'] });
  };

  const restore = useMutation({
    mutationFn: (id: string) => api.post('/api/trash/restore', { id }),
    onSuccess: () => {
      void message.success('已恢复到原路径');
      invalidate();
    },
    onError: (e) => void message.error(e instanceof ApiClientError ? e.message : '恢复失败')
  });

  const purge = useMutation({
    mutationFn: (id: string) => api.del(`/api/trash/${id}`, { confirm: '1' }),
    onSuccess: () => {
      void message.success('已彻底删除');
      invalidate();
    }
  });

  const empty = useMutation({
    mutationFn: () => api.post('/api/trash/empty', { confirm: true }),
    onSuccess: () => {
      void message.success('清空完成');
      invalidate();
    }
  });

  return (
    <div style={{ padding: 16, height: '100%', overflow: 'auto' }} data-testid="trash-page">
      <Space style={{ marginBottom: 12 }}>
        <strong>回收站</strong>
        <span style={{ fontSize: 12, opacity: 0.7 }}>{(items ?? []).length} 条 · {fmtBytes((items ?? []).reduce((a, t) => a + t.sizeBytes, 0))} · 默认保留 30 天（到期在设置页提示清理，不自动删）</span>
        <div style={{ flex: 1 }} />
        <Button
          danger
          size="small"
          disabled={(items ?? []).length === 0}
          onClick={() =>
            modal.confirm({
              title: '清空回收站？',
              content: '将彻底删除回收站内全部内容，不可恢复、不进任何回收站。项目文件中未被删除的部分不受影响。',
              okText: '清空（L3）',
              okButtonProps: { danger: true },
              cancelText: '取消',
              onOk: () => empty.mutate()
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
              onOk: () => void api.post('/api/trash/purge-old').then(invalidate)
            })
          }
        >
          清理超过保留期的条目
        </Button>
      </Space>
      <StateView loading={isLoading} error={error} empty={(items ?? []).length === 0} emptyText="回收站是空的">
        <List
          dataSource={items ?? []}
          renderItem={(t) => (
            <List.Item style={{ padding: '6px 0' }}>
              <span style={{ display: 'inline-flex', gap: 8, width: '100%', alignItems: 'center' }}>
                <Tag color={t.kind === 'dir' ? 'blue' : 'default'}>{t.kind === 'dir' ? '目录' : '文件'}</Tag>
                <strong>{t.name}</strong>
                <span className="tt-ellipsis tt-mono" style={{ fontSize: 12, flex: 1, opacity: 0.7 }}>{t.originPath}</span>
                <span style={{ fontSize: 12, opacity: 0.6 }}>{fmtBytes(t.sizeBytes)} · {relTime(t.deletedAt)}</span>
                <Space>
                  <Button size="small" onClick={() => setPreview(t)}>预览</Button>
                  <Button size="small" type="primary" icon={<UndoOutlined />} onClick={() => restore.mutate(t.id)}>恢复</Button>
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
                        onOk: () => purge.mutate(t.id)
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
        <Modal title={`预览：${preview.name}（前 50 条）`} open onCancel={() => setPreview(null)} footer={[<Button key="c" onClick={() => setPreview(null)}>关闭</Button>]}>
          {(previewData?.entries ?? []).length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无法读取内容（可能已损坏）" />
          ) : (
            <Alert type="info" message={<div style={{ maxHeight: 300, overflow: 'auto' }}>{(previewData?.entries ?? []).map((e) => <div key={e} className="tt-mono" style={{ fontSize: 12 }}>{e}</div>)}</div>} />
          )}
        </Modal>
      )}
    </div>
  );
}
