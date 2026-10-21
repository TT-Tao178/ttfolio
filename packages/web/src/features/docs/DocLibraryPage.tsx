/** 文档库浏览（FR-13.12 / T-110）：按文档根分组浏览全库文档（最近编辑排序）；
 *  文本原样只读预览（文档根图片无代理通道，Markdown 不渲染防裂图——诚实降级）、
 *  Office 走 OfficePreview（自定义 loader）。 */
import { Empty, Select, Space, Table, Tag, Typography } from 'antd';
import { useQuery } from '@tanstack/react-query';
import React, { useCallback, useMemo, useState } from 'react';
import { api, fetchDocRootRaw } from '@/lib/api';
import type { DocRoot } from '@ttfolio/shared';
import { fmtBytes, relTime } from '@/lib/format';
import { OfficePreview } from '@/features/docs/OfficePreview';

interface RootFile {
  rel: string;
  name: string;
  size: number;
  mtime: string;
  kind: 'text' | 'office';
}

export function DocLibraryPage(): React.JSX.Element {
  const { data: roots } = useQuery({
    queryKey: ['doc-roots'],
    queryFn: () => api.get<DocRoot[]>('/api/doc-roots'),
  });
  const enabled = (roots ?? []).filter((r) => r.enabled);
  const [rootId, setRootId] = useState<string | undefined>();
  const activeRoot = enabled.find((r) => r.id === (rootId ?? enabled[0]?.id));
  const { data: files, isLoading } = useQuery({
    queryKey: ['doclib-files', activeRoot?.id],
    queryFn: () => api.get<RootFile[]>(`/api/doc-roots/${activeRoot?.id ?? ''}/files`),
    enabled: activeRoot !== undefined,
  });
  const [selected, setSelected] = useState<RootFile | null>(null);
  const activeFile = useMemo(() => {
    if (selected === null || activeRoot === undefined) return null;
    return (files ?? []).find((f) => f.rel === selected.rel) ?? null;
  }, [selected, files, activeRoot]);
  const loader = useCallback(
    () => fetchDocRootRaw(activeRoot?.id ?? '', activeFile?.rel ?? ''),
    [activeRoot, activeFile],
  );
  const { data: textDoc } = useQuery({
    queryKey: ['doclib-text', activeRoot?.id, activeFile?.rel],
    queryFn: () =>
      api.get<{ content: string }>(`/api/doc-roots/${activeRoot?.id ?? ''}/file`, {
        rel: activeFile?.rel ?? '',
      }),
    enabled: activeFile !== null && activeFile.kind === 'text',
  });

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '12px 16px' }} data-testid="doclib-page">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <Typography.Title level={4} style={{ margin: 0 }}>
          文档库
        </Typography.Title>
        <Select
          style={{ minWidth: 220 }}
          placeholder={enabled.length === 0 ? '尚无文档根（设置页可添加）' : '选择文档根'}
          value={activeRoot?.id}
          onChange={(v) => {
            setRootId(v);
            setSelected(null);
          }}
          options={enabled.map((r) => ({ value: r.id, label: r.label ?? r.path }))}
          disabled={enabled.length === 0}
          data-testid="doclib-root-select"
        />
        <span style={{ fontSize: 12, opacity: 0.6 }}>{(files ?? []).length} 个文档 · 按最近编辑排序</span>
      </div>
      {enabled.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="还没有文档根；到 设置 → 数据源与根目录 添加后即可在这里跨项目浏览"
        />
      ) : (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Table
            size="small"
            rowKey="rel"
            loading={isLoading}
            dataSource={files ?? []}
            pagination={{ pageSize: 15, hideOnSinglePage: true }}
            onRow={(r) => ({ onClick: () => setSelected(r), style: { cursor: 'pointer' } })}
            rowClassName={(r) => (activeFile?.rel === r.rel ? 'ant-table-row-selected' : '')}
            columns={[
              { title: '文件', dataIndex: 'name', ellipsis: true },
              {
                title: '路径',
                dataIndex: 'rel',
                ellipsis: true,
                render: (v) => (
                  <span className="tt-mono" style={{ fontSize: 11, opacity: 0.7 }}>
                    {v}
                  </span>
                ),
              },
              { title: '大小', dataIndex: 'size', width: 90, render: (v) => fmtBytes(v) },
              { title: '最近编辑', dataIndex: 'mtime', width: 100, render: (v) => relTime(v) },
              {
                title: '类型',
                dataIndex: 'kind',
                width: 70,
                render: (k) => <Tag>{k === 'office' ? 'Office' : '文本'}</Tag>,
              },
            ]}
          />
          {activeFile !== null && activeRoot !== undefined && (
            <div>
              <Typography.Title level={5} style={{ marginTop: 0 }}>
                {activeFile.rel}
              </Typography.Title>
              {activeFile.kind === 'office' ? (
                <OfficePreview path={activeFile.rel} mountId={null} loader={loader} />
              ) : textDoc === undefined ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="加载中…" />
              ) : (
                <pre
                  className="tt-mono"
                  style={{
                    fontSize: 12,
                    lineHeight: 1.5,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    background: 'transparent',
                    border: '1px solid rgba(128,128,128,0.25)',
                    borderRadius: 6,
                    padding: 12,
                    maxHeight: '60vh',
                    overflow: 'auto',
                  }}
                  data-testid="doclib-text-preview"
                >
                  {textDoc.content}
                </pre>
              )}
            </div>
          )}
        </Space>
      )}
    </div>
  );
}
