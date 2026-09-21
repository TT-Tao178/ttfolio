/** 右侧详情栏（3.1 规则 5）：卡片墙显示选中项目摘要；项目页显示属性。 */
import { Descriptions, Tag } from 'antd';
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { ProjectSummary } from '@ttfolio/shared';
import { fmtBytes, relTime } from '@/lib/format';
import { useAppStore } from '@/app/store';

export function DetailPanel({ projectId }: { projectId: string | null }): React.JSX.Element {
  const { data: p } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.get<ProjectSummary>(`/api/projects/${projectId ?? ''}`),
    enabled: projectId !== null
  });

  return (
    <div style={{ padding: 12, overflow: 'auto', height: '100%' }}>
      <Descriptions title="项目属性" column={1} size="small">
        <Descriptions.Item label="名称">{p?.alias ?? p?.diskName ?? '—'}</Descriptions.Item>
        <Descriptions.Item label="别名">
          {p?.alias != null ? <Tag>别名</Tag> : null}
          {p?.diskName ?? '—'}
        </Descriptions.Item>
        <Descriptions.Item label="类型">{typeLabel(p?.type)}</Descriptions.Item>
        <Descriptions.Item label="主语言">{p?.primaryLanguage ?? '未分析'}</Descriptions.Item>
        <Descriptions.Item label="规模">{p === undefined ? '—' : `${p.fileCount} 个文件 / ${fmtBytes(p.sizeBytes)}`}</Descriptions.Item>
        <Descriptions.Item label="Git">
          {p?.gitIsRepo === true ? `${p.gitBranch ?? '—'}${p.gitDirty ? '（有改动）' : '（干净）'}` : '非 git 仓库'}
        </Descriptions.Item>
        <Descriptions.Item label="最近提交">{relTime(p?.gitLastCommitAt)}</Descriptions.Item>
        <Descriptions.Item label="最后打开">{relTime(p?.lastOpenedAt)}（{p?.openCount ?? 0} 次）</Descriptions.Item>
        <Descriptions.Item label="路径">{p?.pathOk === false ? <Tag color="error">失效</Tag> : null}<span className="tt-ellipsis" style={{ maxWidth: 180 }}>{p?.dirPath ?? '—'}</span></Descriptions.Item>
      </Descriptions>
    </div>
  );
}

export function typeLabel(t: string | undefined): string {
  switch (t) {
    case 'frontend': return '纯前端';
    case 'backend': return '后端';
    case 'fullstack': return '全栈';
    case 'split': return '前后端分离';
    case 'monolith': return '单体';
    case 'microservice': return '微服务';
    case 'script': return '脚本工具';
    case 'assets': return '素材仓库';
    case 'unknown': return '未识别';
    default: return '未分析';
  }
}

export function useSelectedProjectId(): string | null {
  const { tabs, activeTabId } = useAppStore();
  const tab = tabs.find((t) => t.id === activeTabId);
  return tab?.projectId ?? null;
}
