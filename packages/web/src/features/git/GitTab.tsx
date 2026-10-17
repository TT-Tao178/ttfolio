/** Git 页签（FR-5.1..5.9）：变更分组、diff、暂存/放弃、提交、历史、分支、降级。 */
import { Alert, App, Button, Empty, Input, List, Select, Space, Spin, Tag, Tooltip, Tree } from 'antd';
import React, { useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiClientError } from '@/lib/api';
import type { GitBranch, GitLogEntry, GitStatus } from '@ttfolio/shared';
import { relTime } from '@/lib/format';
import { useAppStore } from '@/app/store';
import { PaneSplit } from '@/components/PaneSplit';
import { DiffView } from './DiffView';

export function GitTab({ projectId }: { projectId: string }): React.JSX.Element {
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [stagedView, setStagedView] = useState(false);
  const [commitMsg, setCommitMsg] = useState('');
  const [limit, setLimit] = useState(50);

  const {
    data: status,
    isLoading,
    error,
  } = useQuery({
    queryKey: ['git', projectId, 'status'],
    queryFn: () => api.get<GitStatus>(`/api/git/${projectId}/status`),
  });
  const { data: log, isFetching } = useQuery({
    queryKey: ['git', projectId, 'log', limit],
    queryFn: () => api.get<GitLogEntry[]>(`/api/git/${projectId}/log`, { limit: String(limit) }),
    enabled: status?.isRepo === true,
    // 「加载更多」增大 limit 时 queryKey 变化：没有 placeholderData 的话 data 会先变 undefined，
    // 列表闪空 → 页面高度骤减把滚动钳回顶部（用户报障"点了只是跳转到开头"）。
    placeholderData: keepPreviousData,
  });
  // 返回条数 < limit 说明提交历史已经全部加载，按钮没有存在意义（点了也拉不到更多）
  const logExhausted = log !== undefined && log.length < limit;
  const { data: branches } = useQuery({
    queryKey: ['git', projectId, 'branches'],
    queryFn: () => api.get<GitBranch[]>(`/api/git/${projectId}/branches`),
    enabled: status?.isRepo === true,
  });

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['git', projectId] });
    void queryClient.invalidateQueries({ queryKey: ['projects'] });
    void queryClient.invalidateQueries({ queryKey: ['project', projectId] });
  };

  const gitOp = useMutation({
    mutationFn: ({ op, body }: { op: string; body?: unknown }) =>
      api.post(`/api/git/${projectId}/${op}`, body),
    onSuccess: invalidate,
    onError: (e) => {
      if (e instanceof ApiClientError && e.code === 'GIT_DIRTY') {
        modal.confirm({
          title: '工作区有未提交改动',
          content: '切换分支会带走/可能冲突这些改动，确认切换？',
          okText: '仍然切换',
          okButtonProps: { danger: true },
          cancelText: '取消',
          onOk: () => {
            // 体检 P1：mutation 触发重渲染后 onError 读的是新渲染闭包——
            // 必须经 ref 取值，渲染期局部变量在回调里恒为初始值（曾致空分支名重试必败）
            void api
              .post(`/api/git/${projectId}/checkout`, {
                branch: pendingBranchRef.current,
                confirmDirty: true,
              })
              .then(() => {
                invalidate();
                void message.success('已切换');
              });
          },
        });
        return;
      }
      void message.error(e instanceof ApiClientError ? e.message : '操作失败');
    },
  });
  const pendingBranchRef = useRef('');

  if (isLoading) return <Spin style={{ display: 'block', margin: '64px auto' }} />;
  if (error !== undefined && error !== null) {
    return <Alert type="error" message={error instanceof Error ? error.message : '加载失败'} />;
  }
  if (status === undefined) return <Empty />;

  if (!status.isRepo) {
    return (
      <Alert
        type="info"
        message="该目录不是 git 仓库"
        description={
          <span>ttFolio 只管理已有仓库，不会自动 git init。可在终端中进入项目目录后执行 git init。</span>
        }
      />
    );
  }
  if (status.inProgress !== null) {
    return (
      <Alert
        type="warning"
        message={`仓库处于 ${status.inProgress === 'merge' ? 'merge' : 'rebase'} 状态`}
        description="请先在命令行完成该操作，ttFolio 的暂存/提交在解决后可用。"
      />
    );
  }

  const treeData = [
    {
      key: 'staged',
      title: `已暂存（${status.staged.length}）`,
      children: status.staged.map((e) => ({ key: `s:${e.path}`, title: e.path })),
    },
    {
      key: 'unstaged',
      title: `未暂存（${status.unstaged.length}）`,
      children: status.unstaged.map((e) => ({ key: `u:${e.path}`, title: e.path })),
    },
    {
      key: 'untracked',
      title: `未跟踪（${status.untracked.length}）`,
      children: status.untracked.map((e) => ({ key: `t:${e.path}`, title: e.path })),
    },
    ...(status.conflicted.length > 0
      ? [
          {
            key: 'conflict',
            title: `冲突（${status.conflicted.length}）`,
            children: status.conflicted.map((e) => ({ key: `c:${e.path}`, title: e.path })),
            selectable: false,
          },
        ]
      : []),
  ];

  return (
    <div style={{ height: '100%', overflow: 'hidden' }}>
      <PaneSplit
        sizeKey="gitListWidth"
        defaultSize={320}
        min={220}
        max={640}
        testId="split-git-list"
        left={
          <div
            style={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              overflow: 'auto',
              paddingRight: 8,
            }}
          >
            <Space>
              <Select
                size="small"
                style={{ width: 150 }}
                placeholder={status.branch ?? '(detached)'}
                value={status.branch ?? undefined}
                onChange={(b) => {
                  pendingBranchRef.current = String(b);
                  gitOp.mutate({ op: 'checkout', body: { branch: b } });
                }}
                options={(branches ?? []).map((b) => ({
                  value: b.name,
                  label: `${b.current ? '● ' : ''}${b.name}`,
                }))}
              />
              <Button
                size="small"
                onClick={() => {
                  const name = window.prompt('新分支名');
                  if (name !== null && name !== '') gitOp.mutate({ op: 'branch', body: { branch: name } });
                }}
              >
                新建分支
              </Button>
            </Space>
            <div style={{ fontSize: 12, opacity: 0.7 }}>
              身份：
              {status.identity === null
                ? '未配置（git config user.name / user.email）'
                : `${status.identity.name} <${status.identity.email}>`}
              {status.upstreamHint !== null && (
                <div>上游：{status.upstreamHint}（ttFolio 不做 push/pull）</div>
              )}
            </div>
            <Tree
              defaultExpandAll
              blockNode
              treeData={treeData}
              selectedKeys={selectedPath !== null ? [`${stagedView ? 's' : 'u'}:${selectedPath}`] : []}
              onSelect={(keys) => {
                const k = String(keys[0] ?? '');
                const idx = k.indexOf(':');
                if (idx > 0) {
                  const prefix = k.slice(0, idx);
                  const p = k.slice(idx + 1);
                  setSelectedPath(p);
                  setStagedView(prefix === 's');
                }
              }}
              titleRender={(node) => <span>{String(node.title)}</span>}
            />
            {status.truncated && <Alert type="warning" message="变更超过 5000 项，仅显示部分" />}
          </div>
        }
        right={
          <div
            style={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              overflow: 'auto',
              minHeight: 0,
            }}
          >
            {selectedPath !== null && (
              <div>
                <Space style={{ marginBottom: 6 }}>
                  <span className="tt-mono">{selectedPath}</span>
                  <Button
                    size="small"
                    onClick={() => gitOp.mutate({ op: 'stage', body: { paths: [selectedPath] } })}
                  >
                    暂存
                  </Button>
                  <Button
                    size="small"
                    onClick={() => gitOp.mutate({ op: 'unstage', body: { paths: [selectedPath] } })}
                  >
                    取消暂存
                  </Button>
                  <Button
                    size="small"
                    danger
                    onClick={() => {
                      modal.confirm({
                        title: `放弃 ${selectedPath} 的改动？`,
                        content:
                          '已跟踪文件将回到 HEAD 状态；未跟踪文件将移入回收站。此操作无法通过 Ctrl+Z 撤销。',
                        okText: '放弃改动（L3）',
                        okButtonProps: { danger: true },
                        cancelText: '取消',
                        onOk: () =>
                          gitOp.mutate({ op: 'discard', body: { paths: [selectedPath], confirm: true } }),
                      });
                    }}
                  >
                    放弃改动
                  </Button>
                </Space>
                <DiffQuery projectId={projectId} path={selectedPath} staged={stagedView} />
              </div>
            )}
            <div>
              <Input.TextArea
                rows={2}
                placeholder="提交信息（多行；Ctrl+Enter 提交；信息经 stdin 传入，绝不自动 push）"
                value={commitMsg}
                onChange={(e) => setCommitMsg(e.target.value)}
                onKeyDown={(e) => {
                  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && commitMsg.trim() !== '') {
                    gitOp.mutate({ op: 'commit', body: { message: commitMsg } });
                    setCommitMsg('');
                  }
                }}
                data-testid="commit-message"
              />
              <Button
                type="primary"
                size="small"
                style={{ marginTop: 6 }}
                disabled={commitMsg.trim() === '' || status.staged.length === 0}
                onClick={() => {
                  gitOp.mutate({ op: 'commit', body: { message: commitMsg } });
                  setCommitMsg('');
                }}
                data-testid="commit-btn"
              >
                提交（{status.staged.length} 个已暂存文件）
              </Button>
              {status.staged.length === 0 && (
                <span style={{ marginLeft: 8, fontSize: 12, opacity: 0.6 }}>
                  先暂存文件（一次提交只包含用户暂存的文件）
                </span>
              )}
            </div>
            <div>
              <strong>提交历史</strong>
              <List
                size="small"
                rowKey="hash"
                dataSource={log ?? []}
                renderItem={(item) => (
                  <List.Item
                    style={{ padding: '4px 0', cursor: 'pointer' }}
                    onClick={() =>
                      useAppStore
                        .getState()
                        .openTab(
                          { kind: 'git', projectId, targetPath: item.hash, subTab: 'commit', scroll: 0 },
                          `提交 ${item.short}`,
                        )
                    }
                  >
                    <span style={{ display: 'inline-flex', gap: 8, width: '100%' }}>
                      <Tag className="tt-mono">{item.short}</Tag>
                      <span className="tt-ellipsis" style={{ flex: 1 }}>
                        {item.subject}
                      </span>
                      <span style={{ opacity: 0.6, fontSize: 12, flexShrink: 0 }}>
                        {item.author} · {relTime(item.date)}
                      </span>
                    </span>
                  </List.Item>
                )}
                footer={
                  logExhausted ? (
                    <span style={{ fontSize: 12, opacity: 0.6 }}>已加载全部 {log?.length ?? 0} 条提交</span>
                  ) : (
                    <Button size="small" loading={isFetching} onClick={() => setLimit(limit + 100)}>
                      加载更多
                    </Button>
                  )
                }
              />
            </div>
          </div>
        }
      />
    </div>
  );
}

function DiffQuery({
  projectId,
  path,
  staged,
}: {
  projectId: string;
  path: string;
  staged: boolean;
}): React.JSX.Element {
  const { data, isLoading } = useQuery({
    queryKey: ['git', projectId, 'diff', path, staged],
    queryFn: () =>
      api.get<{
        path: string;
        binary: boolean;
        truncated: boolean;
        patch: string;
        additions: number;
        deletions: number;
      }>(`/api/git/${projectId}/diff`, { path, staged: staged ? '1' : '0' }),
  });
  if (isLoading) return <Spin size="small" />;
  if (data === undefined) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无 diff" />;
  if (data.binary) return <Alert type="info" message="二进制文件不可 diff" />;
  return <DiffView patch={data.patch} truncated={data.truncated} />;
}

export function CommitDetail({ projectId, hash }: { projectId: string; hash: string }): React.JSX.Element {
  const { data, isLoading, error } = useQuery({
    queryKey: ['git', projectId, 'commit', hash],
    queryFn: () =>
      api.get<{ entry: GitLogEntry; files: Array<{ path: string; status: string }>; patch: string }>(
        `/api/git/${projectId}/commit/${hash}`,
      ),
  });
  if (isLoading) return <Spin style={{ display: 'block', margin: '48px auto' }} />;
  if ((error !== undefined && error !== null) || data === undefined) {
    return <Alert type="error" message={error instanceof Error ? error.message : '加载失败'} />;
  }
  return (
    <div style={{ padding: 12, overflow: 'auto', height: '100%' }}>
      <Space direction="vertical" style={{ width: '100%' }} size={4}>
        <Space>
          <Tag className="tt-mono">{data.entry.short}</Tag>
          <strong>{data.entry.subject}</strong>
        </Space>
        <span style={{ opacity: 0.7 }}>
          {data.entry.author} · {data.entry.date}
        </span>
      </Space>
      <div style={{ marginTop: 8 }}>
        {data.files.map((f) => (
          <div key={f.path} className="tt-mono" style={{ fontSize: 12 }}>
            · {f.path}
          </div>
        ))}
      </div>
      <div style={{ marginTop: 12 }}>
        <DiffView patch={data.patch} truncated={false} />
      </div>
    </div>
  );
}

export function GitOverview(): React.JSX.Element {
  const { data, isLoading } = useQuery({
    queryKey: ['git-overview'],
    queryFn: () =>
      api.get<{
        gitAvailable: boolean;
        items: Array<{
          projectId: string;
          name: string;
          isRepo: boolean;
          branch: string | null;
          dirty: boolean;
          untracked: number;
          lastCommitAt: string | null;
          pathOk: boolean;
        }>;
      }>('/api/git/overview'),
  });
  if (isLoading) return <Spin style={{ display: 'block', margin: '64px auto' }} />;
  const items = data?.items ?? [];
  return (
    <div style={{ padding: 16, overflow: 'auto', height: '100%' }}>
      {data?.gitAvailable === false && (
        <Alert
          type="warning"
          message="未检测到 git"
          description="请安装 git 后重启 ttFolio。"
          style={{ marginBottom: 12 }}
        />
      )}
      <List
        dataSource={items}
        header={<strong>跨项目 Git 总览（{items.filter((i) => i.dirty).length} 个项目有未提交改动）</strong>}
        renderItem={(it) => (
          <List.Item style={{ padding: '4px 0' }}>
            <span style={{ display: 'inline-flex', gap: 8, width: '100%' }}>
              <strong style={{ width: 160 }} className="tt-ellipsis">
                {it.name}
              </strong>
              {!it.isRepo ? (
                <Tag>非仓库</Tag>
              ) : (
                <>
                  <Tag className="tt-mono">{it.branch ?? '—'}</Tag>
                  {it.dirty ? <Tag color="warning">有改动</Tag> : <Tag color="success">干净</Tag>}
                  {it.untracked > 0 && (
                    <Tooltip title="未跟踪文件数">
                      <Tag>{it.untracked} 未跟踪</Tag>
                    </Tooltip>
                  )}
                </>
              )}
              <span style={{ marginLeft: 'auto', opacity: 0.6, fontSize: 12 }}>
                {it.lastCommitAt !== null ? relTime(it.lastCommitAt) : ''}
              </span>
            </span>
          </List.Item>
        )}
      />
    </div>
  );
}
