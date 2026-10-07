/**
 * 右侧详情栏（3.1 规则 5）：卡片墙显示选中项目摘要；项目页显示属性。
 * 评审后补齐两个"后端就绪、前端缺失"的编辑能力：标签（/api/tags 与项目打标
 * 接口此前零调用）与备注（PATCH notes 此前零调用）。
 */
import { App as AntdApp, Descriptions, Input, Select, Tag } from 'antd';
import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError } from '@/lib/api';
import type { ProjectSummary } from '@ttfolio/shared';
import { fmtBytes, relTime } from '@/lib/format';
import { useAppStore } from '@/app/store';

interface TagRow { id: string; name: string; color: string | null }

export function DetailPanel({ projectId }: { projectId: string | null }): React.JSX.Element {
  const { data: p } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.get<ProjectSummary>(`/api/projects/${projectId ?? ''}`),
    enabled: projectId !== null
  });
  const { message } = AntdApp.useApp();
  const queryClient = useQueryClient();
  const pid = projectId ?? '';
  const invalidate = async (): Promise<void> => {
    await queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    await queryClient.invalidateQueries({ queryKey: ['projects'] });
  };

  // ---- 标签（tags 表存量做候选；按名字 diff 增删，删除需要 id → 从 /api/tags 映射） ----
  const { data: allTags } = useQuery({
    queryKey: ['tags'],
    queryFn: () => api.get<TagRow[]>('/api/tags')
  });
  const tagIdByName = new Map((allTags ?? []).map((t) => [t.name, t.id]));
  const addTag = useMutation({
    mutationFn: (name: string) => api.post(`/api/projects/${pid}/tags`, { name }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['tags'] });
      void invalidate();
    },
    onError: (e) => void message.error(e instanceof ApiClientError ? e.message : '添加标签失败')
  });
  const removeTag = useMutation({
    mutationFn: (tagId: string) => api.del(`/api/projects/${pid}/tags/${tagId}`),
    onSuccess: () => void invalidate(),
    onError: (e) => void message.error(e instanceof ApiClientError ? e.message : '移除标签失败')
  });
  const onTagsChange = (names: string[]): void => {
    if (p === undefined) return;
    const before = new Set(p.tags);
    const after = new Set(names);
    for (const n of after) if (!before.has(n)) addTag.mutate(n);
    for (const n of before) {
      if (after.has(n)) continue;
      const id = tagIdByName.get(n);
      if (id !== undefined) removeTag.mutate(id);
      else void message.warning(`标签「${n}」暂无法移除（未取到其 id），请稍后重试`);
    }
  };

  // ---- 备注（blur/回车保存，受控值与服务端同步——沿用设置页 ArchDirInput 的教训） ----
  const [notes, setNotes] = useState('');
  useEffect(() => {
    setNotes(p?.notes ?? '');
  }, [p?.notes]);
  const saveNotes = useMutation({
    mutationFn: () => {
      if (p === undefined) return Promise.resolve();
      return api.patch(`/api/projects/${pid}`, { rev: p.rev, notes: notes.trim() === '' ? null : notes });
    },
    onSuccess: () => {
      void message.success('已保存备注');
      void invalidate();
    },
    onError: (e) => void message.error(e instanceof ApiClientError ? e.message : '保存备注失败')
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
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 4 }}>标签</div>
        <Select
          mode="tags"
          size="small"
          style={{ width: '100%' }}
          placeholder="输入新标签回车，或选择已有标签"
          value={p?.tags ?? []}
          options={(allTags ?? []).map((t) => ({ value: t.name, label: t.name }))}
          onChange={onTagsChange}
          disabled={p === undefined}
          data-testid="detail-tags"
        />
      </div>
      <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 4 }}>备注（失焦保存）</div>
        <Input.TextArea
          rows={3}
          size="small"
          value={notes}
          placeholder="记录这个项目的注意事项…"
          onChange={(e) => setNotes(e.target.value)}
          onBlur={() => {
            if (p !== undefined && notes !== (p.notes ?? '')) saveNotes.mutate();
          }}
          onPressEnter={() => {
            if (p !== undefined && notes !== (p.notes ?? '')) saveNotes.mutate();
          }}
          disabled={p === undefined}
          data-testid="detail-notes"
        />
      </div>
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
