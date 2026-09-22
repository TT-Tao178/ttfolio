/**
 * 提交详情（FR-5.x）：独立 git 标签的正文。
 * 用户报障：提交历史点开是空的——根因是历史列表 openTab 出 kind:'git' 的标签，
 * 但 App 壳没有渲染这种标签的分支（落到空 div）。本组件补上正文：
 * 元信息 + 变更文件列表 + 完整 patch（接口 GET /api/git/:projectId/commit/:hash）。
 */
import { Alert, Button, Empty, List, Space, Spin, Tag } from 'antd';
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { GitLogEntry } from '@ttfolio/shared';
import { relTime } from '@/lib/format';
import { DiffView } from './DiffView';

interface CommitDetail extends GitLogEntry {
  files: Array<{ path: string; status: string }>;
  patch: string;
  truncated?: boolean;
}

export function CommitView({ projectId, hash }: { projectId: string; hash: string }): React.JSX.Element {
  const { data, isLoading, error } = useQuery({
    queryKey: ['git', projectId, 'commit', hash],
    queryFn: () => api.get<CommitDetail>(`/api/git/${projectId}/commit/${encodeURIComponent(hash)}`)
  });

  if (isLoading) return <Spin style={{ margin: '48px auto', display: 'block' }} />;
  if (error !== undefined && error !== null) {
    return <Alert type="error" message={error instanceof Error ? error.message : '读取提交失败'} />;
  }
  if (data === undefined) return <Empty description="没有这个提交" />;

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: 12 }} data-testid="commit-view">
      <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Tag className="tt-mono" color="blue">{data.short}</Tag>
        <strong style={{ fontSize: 14 }}>{data.subject}</strong>
        <span style={{ fontSize: 12, opacity: 0.65 }}>{data.author} · {relTime(data.date)}</span>
        <span style={{ flex: 1 }} />
        <Button size="small" className="tt-mono" onClick={() => { void navigator.clipboard.writeText(data.hash); }}>
          复制完整 hash
        </Button>
      </div>
      <List
        size="small"
        header={<strong>变更文件（{data.files.length}）</strong>}
        dataSource={data.files}
        locale={{ emptyText: '无变更文件' }}
        renderItem={(f) => (
          <List.Item style={{ padding: '2px 0' }}>
            <span className="tt-mono tt-ellipsis" style={{ fontSize: 12, flex: 1 }}>{f.path}</span>
            <Tag style={{ fontSize: 10 }}>{f.status}</Tag>
          </List.Item>
        )}
      />
      <Space direction="vertical" style={{ width: '100%', marginTop: 8 }}>
        {data.patch === '' ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="这个提交没有文本差异（可能是空提交或纯二进制变更）" />
        ) : (
          <DiffView patch={data.patch} truncated={data.truncated === true} />
        )}
      </Space>
    </div>
  );
}
