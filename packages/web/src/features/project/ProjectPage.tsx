/** 项目页（3.3）：页签固定 概览→文件→Git→架构图→文档，快捷键 1–5，默认落「文件」。 */
import { Alert, Button, Descriptions, Form, Input, Modal, Progress, Space, Tabs, Tag, App } from 'antd';
import { ReloadOutlined, StarOutlined, StarFilled, CopyOutlined, FolderOpenOutlined } from '@ant-design/icons';
import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError } from '@/lib/api';
import type { ProjectDetail } from '@ttfolio/shared';
import { useAppStore } from '@/app/store';
import { fmtBytes, fmtMs, relTime } from '@/lib/format';
import { LanguageBar } from '@/components/LanguageBar';
import { StateView } from '@/components/StateView';
import { typeLabel } from '@/components/DetailPanel';
import { FilesTab } from '@/features/files/FilesTab';
import { GitTab } from '@/features/git/GitTab';
import { ArchivesTab } from '@/features/archives/ArchivesTab';
import { DocsTab } from '@/features/docs/DocsTab';
import { TodoList } from '@/features/todos/TodoList';
import { SEMANTIC } from '@/theme/tokens';

export function ProjectPage({ projectId, subTab }: { projectId: string; subTab: string | null }): React.JSX.Element {
  const { data: p, isLoading, error, refetch } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.get<ProjectDetail>(`/api/projects/${projectId}`)
  });
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const active = subTab ?? 'files';
  const [aliasOpen, setAliasOpen] = useState(false);

  const notFound = error instanceof ApiClientError && error.code === 'NOT_FOUND';
  const retry = (): void => {
    void refetch();
  };
  const closeThisTab = (): void => {
    const st = useAppStore.getState();
    const t = st.tabs.find((x) => x.kind === 'project' && x.projectId === projectId);
    if (t !== undefined) st.closeTab(t.id);
  };
  const backToWorkbench = (): void => {
    closeThisTab();
    useAppStore
      .getState()
      .openTab({ kind: 'overview', projectId: null, targetPath: null, subTab: null, scroll: 0 }, '工作台');
  };

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch(`/api/projects/${projectId}`, { rev: p?.rev, ...body }),
    onSuccess: () => {
      void message.success('已保存');
      void queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
    }
  });

  // 项目已被移除登记（会话恢复出的旧标签、或在别处删除了登记）：
  // 必须给出明确出口，而不是让页签区域永远空白。
  if (notFound) {
    return <ProjectGone projectId={projectId} onClose={closeThisTab} onBack={backToWorkbench} />;
  }

  if (p !== undefined && p.pathOk === false) {
    return <RelocateNotice projectId={projectId} dirPath={p.dirPath} name={p.alias ?? p.diskName} />;
  }

  return (
    <div style={{ padding: 12, height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Space>
          <Button
            size="small"
            icon={p?.isPinned === true ? <StarFilled style={{ color: SEMANTIC.warning }} /> : <StarOutlined />}
            onClick={() => patch.mutate({ isPinned: p?.isPinned !== true })}
          />
          <Button size="small" icon={<ReloadOutlined />} onClick={() => void api.post(`/api/projects/${projectId}/analyze`).then(() => message.info('已开始重新分析'))}>
            重新分析
          </Button>
          <Button size="small" icon={<CopyOutlined />} onClick={() => { void navigator.clipboard.writeText(p?.dirPath ?? ''); void message.success('已复制路径'); }}>
            复制路径
          </Button>
          <Button size="small" icon={<FolderOpenOutlined />} onClick={() => void api.post('/api/open', { target: 'explorer', projectId })}>
            资源管理器
          </Button>
          <Button size="small" onClick={() => setAliasOpen(true)}>改别名（L1）</Button>
        </Space>
      </div>
      {/* 项目页五页签（对齐原型 3.3）：鼠标可达；快捷键 1–5 走同一套 updateActiveLocation */}
      <Tabs
        size="small"
        activeKey={active}
        onChange={(k) => useAppStore.getState().updateActiveLocation({ subTab: k }, true)}
        data-testid="project-tabs"
        style={{ marginBottom: 4 }}
        items={[
          { key: 'overview', label: '概览' },
          { key: 'files', label: '文件' },
          {
            key: 'git',
            label:
              p?.gitIsRepo === false
                ? 'Git'
                : p?.gitDirty === true
                  ? 'Git ●'
                  : 'Git'
          },
          { key: 'archives', label: p?.hasArch === true ? '架构图 ✓' : '架构图' },
          { key: 'docs', label: p?.hasDocs === true ? '文档 ✓' : '文档' }
        ]}
      />
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }} data-testid="project-subtab" data-active={active}>
        {active === 'overview' && (
          <StateView
            loading={isLoading}
            error={error}
            empty={p === undefined}
            emptyText="项目信息不可用"
            emptyAction={{ label: '重试', onClick: retry }}
            onRetry={retry}
          >
            {p !== undefined && (
              <div style={{ overflow: 'auto', height: '100%', paddingRight: 4 }}>
                {p.analyzePartial && p.analyzeError !== null && (
                  <Alert type="warning" showIcon message={`分析部分成功：${p.analyzeError}`} style={{ marginBottom: 8 }}
                    action={<Button size="small" onClick={() => void api.post(`/api/projects/${projectId}/analyze`)}>重试</Button>} />
                )}
                <Descriptions title="项目属性" column={2} size="small" bordered>
                  <Descriptions.Item label="别名">{p.alias ?? '—'}</Descriptions.Item>
                  <Descriptions.Item label="磁盘目录名">{p.diskName}</Descriptions.Item>
                  <Descriptions.Item label="类型">
                    {typeLabel(p.type)}
                    <Tag style={{ marginLeft: 6 }} color={p.typeSource === 'manual' ? 'blue' : 'default'}>
                      {p.typeSource === 'manual' ? '手动指定' : '自动分析'}
                    </Tag>
                  </Descriptions.Item>
                  <Descriptions.Item label="路径">{p.dirPath}</Descriptions.Item>
                </Descriptions>
                <div style={{ marginTop: 16 }}>
                  <strong>语言占比</strong>
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 560 }}>
                    <LanguageBar languages={p.languages} />
                    {p.languages.map((l) => (
                      <div key={l.language} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ width: 90, fontSize: 12 }}>{l.language}</span>
                        <Progress percent={l.percent} size="small" style={{ flex: 1, marginBottom: 0 }} showInfo={false} />
                        <span style={{ fontSize: 12, width: 48, textAlign: 'right' }}>{l.percent}%</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ marginTop: 16, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {p.techStack.map((t) => <Tag key={t} color="blue">{t}</Tag>)}
                  {p.techStack.length === 0 && <span style={{ opacity: 0.6 }}>—</span>}
                </div>
                <Descriptions title="分析信息" column={2} size="small" style={{ marginTop: 16 }} bordered>
                  <Descriptions.Item label="分析时间">{relTime(p.analyzedAt)}</Descriptions.Item>
                  <Descriptions.Item label="耗时">{fmtMs(p.analyzeMs)}</Descriptions.Item>
                  <Descriptions.Item label="文件数">{p.fileCount}</Descriptions.Item>
                  <Descriptions.Item label="总体积">{fmtBytes(p.sizeBytes)}</Descriptions.Item>
                  <Descriptions.Item label="Git">
                    {p.gitIsRepo ? `${p.gitBranch ?? '—'} · ${p.gitDirty ? '有未提交改动' : '干净'} · 未跟踪 ${p.gitUntracked}` : '非 git 仓库'}
                  </Descriptions.Item>
                  <Descriptions.Item label="最近提交">{relTime(p.gitLastCommitAt)}（{p.gitLastCommitAuthor ?? '—'}）</Descriptions.Item>
                  <Descriptions.Item label="文档">{p.hasDocs ? '✓ 有' : '✗ 无'}</Descriptions.Item>
                  <Descriptions.Item label="架构图">{p.hasArch ? '✓ 有' : '✗ 无（可由外部工具生成后登记）'}</Descriptions.Item>
                </Descriptions>
                <div style={{ marginTop: 16, maxWidth: 640 }}>
                  <TodoList projectId={projectId} />
                </div>
              </div>
            )}
          </StateView>
        )}
        {active !== 'overview' && p !== undefined && (
          active === 'files' ? <FilesTab projectId={projectId} />
          : active === 'git' ? <GitTab projectId={projectId} />
          : active === 'archives' ? <ArchivesTab projectId={projectId} />
          : active === 'docs' ? <DocsTab projectId={projectId} />
          : (
            <StateView loading={false} empty emptyText={`未知页签：${active}`}><div /></StateView>
          )
        )}
        {/* 项目管理信息未就绪时，任何页签都必须给出加载/错误/重试三态，
            而不是留一片空白（原先只有 files/git/archives/docs 在 p===undefined 时什么都不渲染） */}
        {active !== 'overview' && p === undefined && (
          <StateView
            loading={isLoading}
            error={error}
            empty={!isLoading && (error === null || error === undefined)}
            emptyText="项目信息不可用（可能已被移除登记）"
            emptyAction={{ label: '重试', onClick: retry }}
            onRetry={retry}
            errorExtra={<Button size="small" onClick={backToWorkbench}>回到工作台</Button>}
          >
            <div />
          </StateView>
        )}
      </div>
      <Modal
        title="改别名（仅写索引库，不动磁盘，L1）"
        open={aliasOpen}
        onCancel={() => setAliasOpen(false)}
        onOk={() => {
          const v = (document.getElementById('alias-input') as HTMLInputElement | null)?.value ?? '';
          patch.mutate({ alias: v });
          setAliasOpen(false);
        }}
      >
        <Form layout="vertical">
          <Form.Item label={`当前磁盘目录名：${p?.diskName ?? ''}（保持不变）`}>
            <Input id="alias-input" placeholder={p?.alias ?? '输入新别名，留空清除'} defaultValue={p?.alias ?? ''} maxLength={100} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

/**
 * 项目已不在索引库中（NOT_FOUND）。
 * 典型来源：会话恢复出的旧标签（该项目已被「移除登记」或索引库被清空）——
 * 必须给出「关闭标签 / 回到工作台」两个出口，否则用户看到的是一个再也点不动的空页。
 */
function ProjectGone({ projectId, onClose, onBack }: { projectId: string; onClose: () => void; onBack: () => void }): React.JSX.Element {
  return (
    <div style={{ padding: 32 }}>
      <Alert
        type="warning"
        showIcon
        message="该项目已不在索引库中"
        description={
          <div>
            <p style={{ marginTop: 0 }}>
              项目 id <code className="tt-mono">{projectId}</code> 查不到登记记录：可能已被「仅从 ttFolio 移除登记」、
              已随索引库清空而消失，或这个标签来自更早的会话。
            </p>
            <p style={{ marginBottom: 12 }}>项目文件不受影响；如果需要继续使用，请回到工作台重新登记。</p>
            <Space>
              <Button onClick={onBack} type="primary" data-testid="back-to-workbench">回到工作台</Button>
              <Button onClick={onClose} data-testid="close-gone-tab">关闭此标签</Button>
            </Space>
          </div>
        }
      />
    </div>
  );
}

function RelocateNotice({ projectId, dirPath, name }: { projectId: string; dirPath: string; name: string }): React.JSX.Element {
  const [newPath, setNewPath] = useState('');
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const relocate = useMutation({
    mutationFn: () => api.post(`/api/projects/${projectId}/relocate`, { dirPath: newPath }),
    onSuccess: () => {
      void message.success('已重新定位');
      void queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    },
    onError: (e) => void message.error(e instanceof Error ? e.message : '失败')
  });
  return (
    <div style={{ padding: 32 }}>
      <Alert
        type="error"
        message={`项目目录失效：${name}`}
        description={
          <div>
            <p>原路径不存在（可能被移动、改名或删除）：{dirPath}</p>
            <Space.Compact style={{ width: 480 }}>
              <Input value={newPath} onChange={(e) => setNewPath(e.target.value)} placeholder="输入新路径，原索引数据将保留" data-testid="relocate-input" />
              <Button type="primary" disabled={newPath === ''} onClick={() => relocate.mutate()} data-testid="relocate-btn">重新定位</Button>
            </Space.Compact>
          </div>
        }
      />
    </div>
  );
}
